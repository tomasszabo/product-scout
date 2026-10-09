import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import test from "node:test";
import { startRuntime } from "../skills/ps/lib/server.mjs";
import {
  bootstrap, CANVAS_ID, createExtensionDefinition, RELEASE_ROOT, RELEASE_VERSION,
} from "../extensions/ps-runtime/adapter.mjs";

class MockCanvasError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const run = promisify(execFile);
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

function importEntrypoint(joinBody) {
  const sdkUrl = moduleUrl(`
    export class CanvasError extends Error {}
    export const createCanvas = definition => definition;
    export async function joinSession(definition) { ${joinBody} }
  `);
  const loaderUrl = moduleUrl(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "@github/copilot-sdk/extension") {
        return { url: ${JSON.stringify(sdkUrl)}, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  `);
  const preloadUrl = moduleUrl(`
    import { register } from "node:module";
    register(${JSON.stringify(loaderUrl)});
  `);
  const entryUrl = new URL("../extensions/ps-runtime/extension.mjs", import.meta.url).href;
  return run(process.execPath, [
    "--import", preloadUrl, "--input-type=module", "--eval",
    `await import(${JSON.stringify(entryUrl)}); await import(${JSON.stringify(entryUrl)});`,
  ], { cwd: RELEASE_ROOT, timeout: 10_000 });
}

test("host import of the entrypoint registers tools and canvas exactly once", async () => {
  const { stdout, stderr } = await importEntrypoint(`
    console.log(JSON.stringify({
      tools: definition.tools.map(tool => tool.name),
      canvases: definition.canvases.map(canvas => canvas.id),
    }));
    return { send: async () => {} };
  `);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    tools: ["ps_get_state", "ps_ingest_snapshot", "ps_refresh_fixtures", "ps_get_context"],
    canvases: ["ps"],
  });
});

test("host import reports registration failures instead of exiting successfully", async () => {
  await assert.rejects(importEntrypoint('throw new Error("host registration rejected");'), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /host registration rejected/);
    return true;
  });
});

test("extension release matches its own named version independently of runtime and skills", async () => {
  const versions = JSON.parse(await readFile(new URL("../skills/ps-version/version-manifest.json", import.meta.url), "utf8"));
  const extension = JSON.parse(await readFile(new URL("../extensions/ps-runtime/copilot-extension.json", import.meta.url), "utf8"));
  assert.equal(extension.releaseVersion, versions.extensions["ps-runtime"]);
  assert.equal(RELEASE_VERSION, versions.extensions["ps-runtime"]);
});

function fixture(overrides = {}) {
  const calls = { starts: [], closed: 0, prompts: [], snapshots: [] };
  const runtime = {
    url: "http://127.0.0.1:12345/?capability=secret",
    close: async () => { calls.closed++; },
    interaction: { read: () => ({ status: "unavailable", context: null }), clear() {} },
    service: {
      getState: async () => ({ products: [] }),
      ingestSnapshot: async (snapshot) => {
        calls.snapshots.push(snapshot);
        return { accepted: true };
      },
    },
  };
  const adapter = {
    CanvasError: MockCanvasError,
    createCanvas: (definition) => definition,
    startRuntime: async (options) => { calls.starts.push(options); return runtime; },
    ...overrides,
  };
  const extension = createExtensionDefinition(adapter);
  extension.attachSession({ send: async (message) => { calls.prompts.push(message); } });
  return { extension, calls, runtime, adapter, canvas: extension.definition.canvases[0] };
}

test("uses the observed SDK registration shapes without review tools or actions", async () => {
  const { extension, canvas } = fixture();
  assert.deepEqual(extension.definition.tools.map((tool) => tool.name), [
    "ps_get_state", "ps_ingest_snapshot", "ps_refresh_fixtures", "ps_get_context",
  ]);
  assert.equal(canvas.id, CANVAS_ID);
  assert.equal(typeof canvas.open, "function");
  assert.equal(canvas.onOpen, undefined);
  assert.equal(typeof canvas.onClose, "function");
  assert.deepEqual(canvas.actions, []);
  const parameters = extension.definition.tools[1].parameters;
  assert.deepEqual(parameters.properties.mode.enum, ["live"]);
  assert.deepEqual(parameters.properties.coverage.properties.status.enum, ["complete", "partial", "unavailable"]);
  assert.deepEqual(parameters.properties.issues.items.properties.url.type, ["string", "null"]);
  assert.ok(parameters.required.includes("pipelineVersion"));
  const manifest = JSON.parse(await readFile(new URL(
    "../extensions/ps-runtime/copilot-extension.json", import.meta.url,
  )));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.releaseVersion, RELEASE_VERSION);
});

test("concurrent tools and canvases share one runtime, preserving its capability", async () => {
  const { extension, canvas, calls, runtime } = fixture();
  const products = [{ id: "zava shop&tab=other" }];
  runtime.service.getState = async () => ({ products });
  const stateTool = extension.definition.tools[0];
  const [state, first, second] = await Promise.all([
    stateTool.handler({}),
    canvas.open({ instanceId: "one", input: { productId: "zava shop&tab=other" } }),
    canvas.open({ instanceId: "two", input: {} }),
  ]);
  assert.deepEqual(JSON.parse(state), { products });
  assert.equal(calls.starts.length, 1);
  assert.equal(calls.starts[0].root, RELEASE_ROOT);
  assert.equal(calls.starts[0].port, 0);
  assert.equal(new URL(first.url).searchParams.get("capability"), "secret");
  assert.equal(new URL(first.url).searchParams.get("productId"), "zava shop&tab=other");
  assert.equal(new URL(first.url).searchParams.has("tab"), false);
  assert.equal(new URL(second.url).searchParams.has("productId"), false);
  assert.deepEqual(Object.keys(first).sort(), ["status", "title", "url"]);
  await calls.starts[0].sendPrompt("Investigate issue evidence");
  assert.deepEqual(calls.prompts, [{ prompt: "Investigate issue evidence" }]);
  await canvas.onClose({ instanceId: "one" });
  await canvas.onClose({ instanceId: "two" });
  await stateTool.handler({});
  assert.equal(calls.closed, 0);
  assert.equal(calls.starts.length, 1);
  await Promise.all([extension.close(), extension.close()]);
  assert.equal(calls.closed, 1);
  await assert.rejects(stateTool.handler({}), { code: "runtime_closed" });
  assert.throws(() => calls.starts[0].sendPrompt("after shutdown"), /not connected/);
});

test("snapshot validation belongs to the canonical service, including rejection", async () => {
  const { extension, runtime, calls } = fixture();
  const ingest = extension.definition.tools[1];
  const snapshot = {
    schemaVersion: "1.0", pipelineVersion: "0.1.0", productId: "zava-shop",
    source: "github-issues", mode: "live", fetchedAt: "2026-09-24T06:00:00Z",
    coverage: { status: "unavailable", note: "No repositories configured", repositories: [] }, issues: [],
  };
  assert.deepEqual(JSON.parse(await ingest.handler(snapshot)), { accepted: true });
  assert.equal(calls.snapshots[0], snapshot);
  runtime.service.ingestSnapshot = async () => { throw new Error("invalid snapshot"); };
  await assert.rejects(ingest.handler({}), /invalid snapshot/);
  runtime.service.getState = () => ({ synchronous: true });
  assert.deepEqual(JSON.parse(await extension.definition.tools[0].handler({})), { synchronous: true });
  await extension.close();
});

test("rejects invalid input and unknown products using CanvasError", async () => {
  const { canvas, calls, extension, runtime } = fixture();
  for (const input of [[], "bad", { productId: "" }, { productId: 3 }, { productId: " " },
    { previewSources: "true" }, { previewSources: 1 }, { previewSources: null }]) {
    await assert.rejects(canvas.open({ input }), (error) =>
      error instanceof MockCanvasError && error.code === "invalid_canvas_input");
  }
  assert.equal(calls.starts.length, 0);
  await assert.rejects(canvas.open({ input: { productId: "not-in-config" } }), (error) =>
    error instanceof MockCanvasError && error.code === "unknown_product");
  runtime.service.getState = () => ({ products: [{ id: "known-product" }] });
  const opened = await canvas.open({ input: { productId: "known-product" } });
  assert.equal(new URL(opened.url).searchParams.get("productId"), "known-product");
  await extension.close();
});

test("legacy preview input cannot gate cards and preserves product and capability routing", async () => {
  const { extension, canvas, runtime } = fixture();
  runtime.service.getState = () => ({ products: [{ id: "zava-shop" }] });
  assert.equal(canvas.inputSchema.properties.previewSources.type, "boolean");
  for (const previewSources of [undefined, false, true]) {
    const opened = await canvas.open({ input: { productId: "zava-shop", previewSources } });
    const url = new URL(opened.url);
    assert.equal(url.searchParams.get("previewSources"), null);
    assert.equal(url.searchParams.get("productId"), "zava-shop");
    assert.equal(url.searchParams.get("capability"), "secret");
  }
  await extension.close();
});

test("mock SDK adapter integrates with the real runtime in an isolated data directory", async (t) => {
  const dataDir = join(RELEASE_ROOT, "tests", `extension-runtime-${randomUUID()}`);
  await mkdir(dataDir);
  let runtime;
  let starts = 0;
  const { extension, canvas, calls } = fixture({
    dataDir,
    startRuntime: async (options) => {
      assert.equal(options.dataDir, dataDir);
      starts++;
      runtime = await startRuntime(options);
      return runtime;
    },
  });
  t.after(async () => {
    try { await extension.close(); } finally { await rm(dataDir, { recursive: true, force: true }); }
  });
  const [getState, ingest] = extension.definition.tools;
  const state = JSON.parse(await getState.handler({}));
  assert.ok(state.products.length > 0);
  assert.ok(state.products.every(product => product.previewSources?.mode === "fixture"));
  assert.ok(state.products.every(product => product.previewSources.appMonitoring?.logs.length > 0));
  assert.ok(state.products.every(product => product.previewSources.adoption?.features.length > 0
    && product.previewSources.support?.provider === "Zendesk" && product.previewSources.business?.provider === "Power BI"));
  const productId = state.products[0].id;
  assert.equal(typeof productId, "string");
  const opened = await canvas.open({ instanceId: "real-runtime", input: { productId, previewSources: true } });
  const url = new URL(opened.url);
  assert.equal(url.searchParams.get("productId"), productId);
  assert.equal(url.searchParams.get("previewSources"), null);
  const capabilityParameters = [...new URL(runtime.url).searchParams];
  assert.ok(capabilityParameters.length > 0);
  for (const [name, value] of capabilityParameters) assert.equal(url.searchParams.get(name), value);
  const response = await fetch(opened.url);
  assert.equal(response.status, 200);
  await response.text();
  const contextTool = extension.definition.tools.find(tool => tool.name === "ps_get_context");
  assert.equal(JSON.parse(await contextTool.handler({})).status, "unavailable");
  const contextResponse = await fetch(new URL("/api/context", url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${url.searchParams.get("token")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      viewId: "11111111-1111-4111-8111-111111111111", sequence: 1, revision: state.revision,
      context: { productId, view: "issues", role: state.roles[0], finding: null, selectedText: "Explain this card", selectionTruncated: false },
    }),
  });
  assert.equal(contextResponse.status, 200);
  assert.equal((await contextResponse.json()).accepted, true);
  const context = JSON.parse(await contextTool.handler({}));
  assert.equal(context.status, "available");
  assert.equal(context.context.selectedText, "Explain this card");
  assert.deepEqual(calls.prompts, []);
  await canvas.onClose();
  assert.equal(JSON.parse(await contextTool.handler({})).status, "unavailable");
  assert.deepEqual(JSON.parse(await getState.handler({})), state);
  const investigation = await fetch(new URL("/api/investigate", url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${url.searchParams.get("token")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ productId, role: state.roles[0], question: "What requires my decision?" }),
  });
  assert.equal(investigation.status, 200);
  const handoff = await investigation.json();
  assert.equal(handoff.dispatched, true);
  assert.deepEqual(calls.prompts, [{ prompt: handoff.prompt }]);
  assert.match(handoff.prompt, /^\/ps\n/);
  await assert.rejects(canvas.open({ input: { productId: "unknown-product" } }), { code: "unknown_product" });
  await assert.rejects(ingest.handler({}));
  await assert.rejects(ingest.handler({
    schemaVersion: "1.0", pipelineVersion: "0.1.0", productId,
    source: "github-issues", mode: "fixture", fetchedAt: new Date().toISOString(),
    coverage: { status: "complete", note: "Not permitted through ingestion", repositories: [] },
    issues: [],
  }), /live|fixture/i);
  assert.deepEqual(JSON.parse(await getState.handler({})), state);
  const refresh = extension.definition.tools.find(tool => tool.name === "ps_refresh_fixtures");
  const result = JSON.parse(await refresh.handler({}));
  assert.equal(result.status, "refreshed");
  assert.equal(result.retrieved, false);
  const refreshed = JSON.parse(await getState.handler({}));
  assert.ok(refreshed.products.every(product => !product.assessment.stale && !product.previewSources.stale));
  const cached = await fetch(new URL("/api/state", url), {
    headers: { Authorization: `Bearer ${url.searchParams.get("token")}` },
  });
  assert.equal((await cached.json()).revision, result.revision);
  assert.equal(calls.prompts.length, 1);
  await canvas.onClose({ instanceId: "real-runtime" });
  await getState.handler({});
  assert.equal(starts, 1);
});

test("fixture refresh validates its input and propagates service failures without opening a canvas", async () => {
  const { extension, calls, runtime } = fixture();
  const refresh = extension.definition.tools.find(tool => tool.name === "ps_refresh_fixtures");
  for (const input of [null, [], "zava-shop", { productId: null }, { productId: "" }, { productId: 42 }, { now: "tomorrow" }]) {
    await assert.rejects(refresh.handler(input), /optional configured productId/);
  }
  assert.equal(calls.starts.length, 0);
  runtime.service.refreshFixtures = async productId => ({ productId, status: "refreshed" });
  assert.equal(JSON.parse(await refresh.handler({ productId: "zava-shop" })).productId, "zava-shop");
  runtime.service.refreshFixtures = async () => { throw new Error("Refresh persistence failed"); };
  await assert.rejects(refresh.handler({}), /Refresh persistence failed/);
  assert.equal(calls.prompts.length, 0);
  await extension.close();
});

test("failed startup can retry and shutdown waits for an in-flight start", async () => {
  let attempts = 0;
  let release;
  let closed = 0;
  const { extension, canvas } = fixture({
    startRuntime: async () => {
      if (++attempts === 1) throw new Error("locked");
      await new Promise((resolve) => { release = resolve; });
      return { url: "http://127.0.0.1/", close: async () => { closed++; } };
    },
  });
  await assert.rejects(canvas.open({}), /locked/);
  const open = canvas.open({});
  await new Promise((resolve) => setImmediate(resolve));
  const close = extension.close();
  assert.equal(closed, 0);
  release();
  await Promise.all([open, close]);
  assert.equal(attempts, 2);
  assert.equal(closed, 1);
});

test("bootstrap registers with joinSession and closes on Node IPC disconnect", async () => {
  const { adapter, calls } = fixture();
  const hostProcess = new EventEmitter();
  const exits = [];
  hostProcess.exit = (code) => { exits.push(code); };
  let registration;
  const extension = await bootstrap({
    sdk: {
      ...adapter,
      joinSession: async (definition) => {
        registration = definition;
        return { send: async (message) => { calls.prompts.push(message); } };
      },
    },
    startRuntime: adapter.startRuntime,
    processAdapter: hostProcess,
  });
  await registration.tools[0].handler({});
  await calls.starts[0].sendPrompt("prompt");
  assert.deepEqual(calls.prompts, [{ prompt: "prompt" }]);
  hostProcess.emit("disconnect");
  await extension.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.closed, 1);
  assert.equal(hostProcess.listenerCount("SIGINT"), 0);
  assert.equal(hostProcess.listenerCount("SIGTERM"), 0);
  assert.equal(hostProcess.listenerCount("disconnect"), 0);
  assert.deepEqual(exits, [0]);
});

test("explicit bootstrap close removes signal hooks without exiting the host", async () => {
  const { adapter, calls } = fixture();
  const hostProcess = new EventEmitter();
  hostProcess.exit = () => { assert.fail("Explicit close must not exit"); };
  const extension = await bootstrap({
    sdk: { ...adapter, joinSession: async () => ({ send: async () => {} }) },
    startRuntime: adapter.startRuntime,
    processAdapter: hostProcess,
  });
  await extension.definition.tools[0].handler({});
  await extension.close();
  assert.equal(hostProcess.eventNames().length, 0);
  assert.equal(calls.closed, 1);
});

test("join failure removes process hooks", async () => {
  const { adapter } = fixture();
  const hostProcess = new EventEmitter();
  await assert.rejects(bootstrap({
    sdk: { ...adapter, joinSession: async () => { throw new Error("host unavailable"); } },
    processAdapter: hostProcess,
  }), /host unavailable/);
  assert.equal(hostProcess.eventNames().length, 0);
});
