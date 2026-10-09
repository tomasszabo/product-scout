import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { openStore } from "./store.mjs";
import { createInteractionContext } from "./interaction-context.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const STATIC = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/theme.js", ["theme.js", "text/javascript"]],
  ["/styles.css", ["styles.css", "text/css"]],
]);

export async function startRuntime({ root = DEFAULT_ROOT, dataDir = path.join(root, ".ps"), sendPrompt, port = 0, now } = {}) {
  const service = await openStore({ root, dataDir, now });
  const interaction = createInteractionContext({ getState: () => service.getState(), ...(now ? { now } : {}) });
  const token = randomBytes(32).toString("hex");
  let origin;
  let closing = false;
  const server = http.createServer(async (request, response) => {
    const respond = (status, payload) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(payload));
    };
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
    try {
      if (request.headers.host !== new URL(origin).host) return respond(403, { error: "Unrecognized host." });
      const url = new URL(request.url, origin);
      if (request.method === "GET" && STATIC.has(url.pathname)) {
        const [name, mime] = STATIC.get(url.pathname);
        const content = await readFile(path.join(root, "skills/ps/dashboard", name));
        response.writeHead(200, { "content-type": `${mime}; charset=utf-8` });
        response.end(content);
        return;
      }
      const authorization = request.headers.authorization ?? "";
      const supplied = Buffer.from(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return respond(401, { error: "Reopen the Product Scout canvas in GitHub Copilot App." });
      if (request.headers.origin && request.headers.origin !== origin) return respond(403, { error: "Cross-origin requests are not allowed." });
      if (request.method === "GET" && url.pathname === "/api/state") {
        return respond(200, { ...service.getState(), hostConnected: Boolean(sendPrompt) });
      }
      if (request.method !== "POST" || !["/api/review", "/api/investigate", "/api/context"].includes(url.pathname)) return respond(404, { error: "Unknown endpoint." });
      if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") return respond(415, { error: "Expected application/json." });
      let body = "";
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 32_768) {
          respond(413, { error: "Request exceeds 32 KiB." });
          return;
        }
        body += chunk;
      }
      let input;
      try { input = JSON.parse(body); }
      catch { return respond(400, { error: "Invalid JSON body." }); }
      if (!input || typeof input !== "object" || Array.isArray(input)) return respond(400, { error: "Expected a JSON object." });
      if (url.pathname === "/api/context") return respond(200, interaction.update(input));
      if (url.pathname === "/api/review") return respond(200, await service.review(input));
      if (!sendPrompt) return respond(503, { error: "No Copilot session is connected. Reopen Product Scout in GitHub Copilot App. No investigation has run." });
      const prompt = service.prompt(input);
      await sendPrompt(prompt);
      return respond(200, { dispatched: true, prompt });
    } catch (error) {
      console.error(`[ps] ${request.method} ${request.url?.split("?")[0]}: ${error.message}`);
      if (!response.headersSent) respond(400, { error: error.message });
      else response.end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    await service.close();
    throw error;
  }
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${origin}/?token=${token}`,
    service,
    interaction,
    async close() {
      if (closing) return;
      closing = true;
      interaction.clear();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await service.close();
    },
  };
}
