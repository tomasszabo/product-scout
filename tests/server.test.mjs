import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startRuntime } from "../skills/ps/lib/server.mjs";

async function runtimeFor(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ps-http-test-"));
  const runtime = await startRuntime({ dataDir, now: () => Date.parse("2026-09-24T08:00:00Z"), ...options });
  t.after(async () => { await runtime.close(); await rm(dataDir, { recursive: true, force: true }); });
  const url = new URL(runtime.url);
  const headers = { Authorization: `Bearer ${url.searchParams.get("token")}` };
  return { runtime, origin: url.origin, headers };
}

test("loopback server requires capability for data, rejects cross-origin writes and bad payloads", async (t) => {
  const { origin, headers } = await runtimeFor(t);
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  await page.text();
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  const result = await fetch(`${origin}/api/state`, { headers });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).products.length, 2);
  assert.match(result.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal((await fetch(`${origin}/api/review`, { method: "POST", headers: { ...headers, Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await fetch(`${origin}/api/review`, { method: "POST", headers, body: "{}" })).status, 415);
  assert.equal((await fetch(`${origin}/api/review`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{" })).status, 400);
  assert.equal((await fetch(`${origin}/config/products.json`, { headers })).status, 404);
  assert.equal((await fetch(`${origin}/skills/ps/config/products.json`, { headers })).status, 404);
  assert.equal((await fetch(`${origin}/api/review`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ note: "a".repeat(33_000) }) })).status, 413);
});

test("investigation without a Copilot session fails explicitly without a prompt fallback", async (t) => {
  const { origin, headers } = await runtimeFor(t);
  const response = await fetch(`${origin}/api/investigate`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ productId: "zava-shop", role: "Product Owner", question: "Why is checkout at risk?" }) });
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.match(result.error, /No Copilot session is connected/);
  assert.match(result.error, /No investigation has run/);
  assert.equal(result.dispatched, undefined);
  assert.equal(result.prompt, undefined);
});

test("context publication is protected, ephemeral and never dispatches an investigation", async (t) => {
  const sent = [];
  const { runtime, origin, headers } = await runtimeFor(t, { sendPrompt: async prompt => sent.push(prompt) });
  const state = runtime.service.getState();
  const input = {
    viewId: "11111111-1111-4111-8111-111111111111", sequence: 1, revision: state.revision,
    context: {
      productId: state.products[0].id, view: "issues", role: state.roles[0],
      finding: { kind: "issue", id: state.products[0].snapshot.issues[0].id },
      selectedText: "What explains this?", selectionTruncated: false,
    },
  };
  const post = (body = input, overrides = {}) => fetch(`${origin}/api/context`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body), ...overrides,
  });
  assert.equal((await post(input, { headers: { "Content-Type": "application/json" } })).status, 401);
  assert.equal((await post(input, { headers: { ...headers, "Content-Type": "application/json", Origin: "https://evil.example" } })).status, 403);
  assert.equal((await post(input, { headers })).status, 415);
  assert.equal((await post({ ...input, extra: true })).status, 400);
  assert.equal((await post({ ...input, context: { ...input.context, selectedText: "x".repeat(33_000) } })).status, 413);
  const accepted = await post();
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).accepted, true);
  assert.equal(runtime.interaction.read().status, "available");
  assert.equal(runtime.interaction.read().context.selectedText, input.context.selectedText);
  assert.deepEqual(runtime.service.getState(), state);
  assert.deepEqual(sent, []);
  assert.equal((await fetch(`${origin}/api/context`, { headers })).status, 404);
  assert.equal((await (await post({ ...input, context: null, sequence: 2 })).json()).accepted, true);
  assert.equal(runtime.interaction.read().status, "unavailable");
  assert.equal((await (await post()).json()).reason, "superseded");
});

test("connected investigation dispatches once and failures stay explicit", async (t) => {
  const sent = [];
  const { origin, headers } = await runtimeFor(t, { sendPrompt: async (prompt) => { sent.push(prompt); if (prompt.includes("fail-host")) throw new Error("Host disconnected."); } });
  const ask = (question) => fetch(`${origin}/api/investigate`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ productId: "contoso-crm", role: "Developer", question }) });
  assert.equal((await (await ask("What should I work on?")).json()).dispatched, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^\/ps\n/);
  assert.match(sent[0], /Contoso CRM/);
  const failed = await ask("fail-host");
  assert.equal(failed.status, 400);
  assert.equal((await failed.json()).error, "Host disconnected.");
});

test("review endpoint persists only explicitly reviewed candidates", async (t) => {
  const { runtime, origin, headers } = await runtimeFor(t);
  const candidate = runtime.service.getState().products[0].candidates[0];
  const response = await fetch(`${origin}/api/review`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ productId: "zava-shop", candidateId: candidate.id, evidenceHash: candidate.evidenceHash, decision: "approved", reviewer: "Test owner", note: "Review completed." }),
  });
  assert.equal(response.status, 200);
  assert.equal(runtime.service.getState().products[0].timeline.length, 1);
  assert.equal(runtime.service.getState().products[1].timeline.length, 0);
});

test("two App sessions share data but keep capabilities, context and prompt routing isolated", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ps-multi-session-"));
  const sessions = [];
  t.after(async () => {
    await Promise.all(sessions.map(session => session.close()));
    await rm(dataDir, { recursive: true, force: true });
  });
  const sent = [[], []];
  for (const index of [0, 1]) sessions.push(await startRuntime({
    dataDir, now: () => Date.parse("2026-09-24T08:00:00Z"),
    sendPrompt: async prompt => sent[index].push(prompt),
  }));
  const headers = sessions.map(session => ({
    Authorization: `Bearer ${new URL(session.url).searchParams.get("token")}`,
    "Content-Type": "application/json",
  }));
  const endpoint = (index, name) => new URL(`/api/${name}`, sessions[index].url);
  assert.equal((await fetch(endpoint(1, "state"), { headers: headers[0] })).status, 401);
  for (const index of [0, 1]) {
    const response = await fetch(endpoint(index, "investigate"), {
      method: "POST", headers: headers[index],
      body: JSON.stringify({ productId: "zava-shop", role: "Product Owner", question: `Session ${index}` }),
    });
    assert.equal((await response.json()).dispatched, true);
    assert.equal(sent[index].length, 1);
    assert.match(sent[index][0], new RegExp(`Session ${index}`));
  }
  const state = sessions[0].service.getState();
  sessions[0].interaction.update({
    viewId: "11111111-1111-4111-8111-111111111111", sequence: 1, revision: state.revision,
    context: { productId: "zava-shop", view: "issues", role: state.roles[0],
      finding: null, selectedText: "Session one selection", selectionTruncated: false },
  });
  assert.equal(sessions[0].interaction.read().status, "available");
  assert.equal(sessions[1].interaction.read().status, "unavailable");
  const candidate = state.products[0].candidates[0];
  await sessions[1].service.review({ productId: "zava-shop", candidateId: candidate.id,
    evidenceHash: candidate.evidenceHash, decision: "approved", reviewer: "Test owner" });
  const shared = await (await fetch(endpoint(0, "state"), { headers: headers[0] })).json();
  assert.equal(shared.products[0].timeline.length, 1);
  await sessions[0].close();
  assert.equal((await fetch(endpoint(1, "state"), { headers: headers[1] })).status, 200);
});
