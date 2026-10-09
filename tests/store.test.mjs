import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "../skills/ps/lib/store.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const now = () => Date.parse("2026-09-24T08:00:00Z");
const config = JSON.parse(await readFile(path.join(root, "skills/ps/config/products.json"), "utf8"));

async function dataDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ps-store-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function request(candidate, overrides = {}) {
  return { productId: "zava-shop", candidateId: candidate.id, evidenceHash: candidate.evidenceHash, decision: "approved", reviewer: "Product owner", note: "Confirm checkout scope with engineering.", ...overrides };
}

test("only explicit approval persists to timeline; rejection is isolated; evidence survives restart", async (t) => {
  let store;
  t.after(async () => { if (store) await store.close(); });
  const dataDir = await dataDirectory(t);
  store = await openStore({ root, dataDir, now });
  assert.equal(store.getState().products[0].timeline.length, 0);
  const candidate = store.getState().products[0].candidates[0];
  await assert.rejects(store.review(request(candidate, { reviewer: "" })), /reviewer/);
  await assert.rejects(store.review(request(candidate, { evidenceHash: "changed" })), /Evidence changed/);
  await assert.rejects(store.review(request(candidate, { productId: "contoso-crm" })), /Evidence changed/);
  await store.review(request(candidate));
  await assert.rejects(store.review(request(candidate)), /already been reviewed/);
  const second = store.getState().products[0].candidates[1];
  await store.review(request(second, { decision: "rejected" }));
  const state = store.getState();
  assert.equal(state.products[0].timeline.length, 1);
  assert.equal(state.products[1].timeline.length, 0);
  assert.equal(state.products[0].candidates[1].review.decision, "rejected");
  assert.deepEqual(state.products[0].timeline[0].candidate.evidence, candidate.evidence);
  assert.equal((await stat(path.join(dataDir, "state.json"))).mode & 0o777, 0o600);
  await store.close();
  store = null;
  store = await openStore({ root, dataDir, now });
  assert.equal(store.getState().products[0].timeline.length, 1);
  assert.equal(store.getState().products[0].timeline[0].note, "Confirm checkout scope with engineering.");
});

test("multiple stores share current state and serialize concurrent reviews", async (t) => {
  const dataDir = await dataDirectory(t);
  const first = await openStore({ root, dataDir, now });
  const second = await openStore({ root, dataDir, now });
  t.after(() => Promise.all([first.close(), second.close()]));
  await assert.rejects(stat(path.join(dataDir, "writer.lock")), { code: "ENOENT" });
  const candidates = first.getState().products[0].candidates;
  const results = await Promise.allSettled([
    first.review(request(candidates[0])), second.review(request(candidates[0])),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.match(results.find(result => result.status === "rejected").reason.message, /already been reviewed/);
  await Promise.all([
    first.review(request(candidates[1])), second.refreshFixtures("contoso-crm"),
  ]);
  assert.deepEqual(first.getState(), second.getState());
  assert.equal(second.getState().products[0].timeline.length, 2);
  await first.close();
  assert.equal(second.getState().products[0].timeline.length, 2);
  await second.close();
});

test("dead writer locks recover without changing persisted reviews", async (t) => {
  const dataDir = await dataDirectory(t);
  const store = await openStore({ root, dataDir, now });
  await store.review(request(store.getState().products[0].candidates[0]));
  await store.close();
  const before = await readFile(path.join(dataDir, "state.json"), "utf8");
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(child, "exit");
  await writeFile(path.join(dataDir, "writer.lock"), String(child.pid));
  const results = await Promise.allSettled([
    openStore({ root, dataDir, now }), openStore({ root, dataDir, now }),
  ]);
  const winners = results.filter((result) => result.status === "fulfilled");
  assert.equal(winners.length, 2);
  const reopened = winners[0].value;
  try {
    assert.equal(reopened.getState().products[0].timeline.length, 1);
    assert.equal(await readFile(path.join(dataDir, "state.json"), "utf8"), before);
    await assert.rejects(stat(path.join(dataDir, "writer.lock")), { code: "ENOENT" });
    await assert.rejects(stat(path.join(dataDir, "writer.lock.recovery")), { code: "ENOENT" });
  } finally { await Promise.all(winners.map(result => result.value.close())); }
});

test("malformed and symlink locks are never removed", async (t) => {
  const dataDir = await dataDirectory(t);
  const lockPath = path.join(dataDir, "writer.lock");
  for (const contents of ["not-a-pid", "0", "99999999999999999999"]) {
    await writeFile(lockPath, contents);
    await assert.rejects(openStore({ root, dataDir, now }), /data lock/);
    assert.equal(await readFile(lockPath, "utf8"), contents);
    await assert.rejects(stat(path.join(dataDir, "writer.lock.recovery")), { code: "ENOENT" });
  }
  const { unlink, symlink } = await import("node:fs/promises");
  await unlink(lockPath);
  const target = path.join(dataDir, "other-file");
  await writeFile(target, "not a lock");
  await symlink(target, lockPath);
  await assert.rejects(openStore({ root, dataDir, now }), /regular file/);
  assert.equal(await readFile(target, "utf8"), "not a lock");
});

test("a recovery already in progress is never bypassed", async (t) => {
  const dataDir = await dataDirectory(t);
  const lockPath = path.join(dataDir, "writer.lock");
  await writeFile(lockPath, String(process.pid));
  await writeFile(`${lockPath}.recovery`, "in progress");
  await assert.rejects(openStore({ root, dataDir, now }), /data lock/);
  assert.equal(await readFile(lockPath, "utf8"), String(process.pid));
  assert.equal(await readFile(`${lockPath}.recovery`, "utf8"), "in progress");
});

test("stale evidence cannot be approved and malformed state fails instead of resetting", async (t) => {
  const dataDir = await dataDirectory(t);
  const store = await openStore({ root, dataDir, now: () => now() + 48 * 3_600_000 });
  await assert.rejects(store.review(request(store.getState().products[0].candidates[0])), /stale evidence/);
  await store.close();
  await writeFile(path.join(dataDir, "state.json"), '{"schemaVersion": "invalid"}');
  await assert.rejects(openStore({ root, dataDir, now }), /Invalid saved/);
  await assert.rejects(stat(path.join(dataDir, "writer.lock")), { code: "ENOENT" });
});

test("live ingest, baseline comparison, evidence changes and concurrent duplicate reviews", async (t) => {
  let store;
  t.after(async () => { if (store) await store.close(); });
  const directory = await dataDirectory(t);
  const customRoot = path.join(directory, "release");
  await mkdir(path.join(customRoot, "skills/ps/config"), { recursive: true });
  const liveConfig = structuredClone(config);
  liveConfig.products = [liveConfig.products[0]];
  liveConfig.products[0].repositories = ["zava/shop"];
  await writeFile(path.join(customRoot, "skills/ps/config/products.json"), JSON.stringify(liveConfig));
  store = await openStore({ root: customRoot, dataDir: path.join(directory, "state"), now });
  assert.equal(store.getState().products[0].assessment.status, "Unknown");
  const snapshot = JSON.parse(await readFile(path.join(root, "skills/ps/fixtures/zava-shop.json"), "utf8"));
  snapshot.mode = "live";
  snapshot.fetchedAt = new Date(now()).toISOString();
  snapshot.issues.forEach((issue) => { issue.url = `https://github.com/${issue.repository}/issues/${issue.number}`; });
  await store.ingestSnapshot(snapshot);
  const candidate = store.getState().products[0].candidates[0];
  const results = await Promise.allSettled([store.review(request(candidate)), store.review(request(candidate))]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  snapshot.issues[0].summary = "Changed acceptance criteria.";
  await store.ingestSnapshot(snapshot);
  assert.equal(store.getState().products[0].changes.items.length, 1);
  assert.equal(store.getState().products[0].candidates[0].review, null);
  assert.notEqual(store.getState().products[0].timeline[0].candidate.evidence[0].summary, snapshot.issues[0].summary);
  await assert.rejects(store.review(request(candidate)), /Evidence changed/);
  snapshot.fetchedAt = "2026-09-24T07:59:00Z";
  await assert.rejects(store.ingestSnapshot(snapshot), /newer snapshot/);
});

test("new unconfigured products start unknown instead of inventing data", async (t) => {
  let store;
  t.after(async () => { if (store) await store.close(); });
  const directory = await dataDirectory(t);
  await mkdir(path.join(directory, "skills/ps/config"), { recursive: true });
  const custom = structuredClone(config);
  custom.products = [{ ...custom.products[0], id: "new-product", name: "New Product" }];
  await writeFile(path.join(directory, "skills/ps/config/products.json"), JSON.stringify(custom));
  store = await openStore({ root: directory, dataDir: path.join(directory, "state"), now });
  assert.equal(store.getState().products[0].snapshot.coverage.status, "unavailable");
  assert.equal(store.getState().products[0].snapshot.issues.length, 0);
  assert.equal(store.getState().products[0].previewSources, null);
});

test("preview data is product-scoped, isolated and not persisted by browsing or review", async (t) => {
  let store;
  t.after(async () => { if (store) await store.close(); });
  const dataDir = await dataDirectory(t);
  let clock = now();
  store = await openStore({ root, dataDir, now: () => clock });
  const state = store.getState();
  const [shop, crm] = state.products;
  assert.equal(shop.previewSources.mode, "fixture");
  assert.equal(crm.previewSources.mode, "fixture");
  assert.notDeepEqual(shop.previewSources.stories.items, crm.previewSources.stories.items);
  assert.ok(shop.previewSources.appMonitoring.logs.length > 0);
  assert.notDeepEqual(shop.previewSources.appMonitoring.logs, crm.previewSources.appMonitoring.logs);
  assert.notDeepEqual(shop.previewSources.appMonitoring.requests, crm.previewSources.appMonitoring.requests);
  assert.equal(shop.previewSources.appMonitoring.availability.state, "outage");
  assert.notDeepEqual(shop.previewSources.appMonitoring.availability, crm.previewSources.appMonitoring.availability);
  for (const source of ["adoption", "support", "business"]) {
    assert.ok(shop.previewSources[source]);
    assert.ok(crm.previewSources[source]);
    assert.notDeepEqual(shop.previewSources[source], crm.previewSources[source]);
  }
  assert.equal(shop.previewSources.stale, false);
  const original = structuredClone(shop.previewSources);
  shop.previewSources.stories.items[0].title = "Client mutation";
  shop.previewSources.appMonitoring.logs[0].message = "Client mutation";
  shop.previewSources.appMonitoring.availability.summary = "Client mutation";
  shop.previewSources.support.cases[0].title = "Client mutation";
  shop.previewSources.business.metrics[0].current = 0;
  shop.previewSources.adoption.features[0].name = "Client mutation";
  assert.deepEqual(store.getState().products[0].previewSources, original);
  await assert.rejects(stat(path.join(dataDir, "state.json")), { code: "ENOENT" });
  await store.review(request(shop.candidates[0]));
  const saved = JSON.parse(await readFile(path.join(dataDir, "state.json"), "utf8"));
  assert.equal(saved.previews, undefined);
  assert.equal(saved.previewSources, undefined);
  assert.equal(saved.reviews.length, 1);
  assert.ok(saved.reviews[0].candidate.evidence.every(item => item.repository));
  const before = await readFile(path.join(dataDir, "state.json"), "utf8");
  clock += 48 * 3_600_000;
  assert.equal(store.getState().products[0].previewSources.stale, true);
  assert.equal(await readFile(path.join(dataDir, "state.json"), "utf8"), before);
  await assert.rejects(store.ingestSnapshot(JSON.parse(await readFile(path.join(root, "skills/ps/fixtures/zava-shop.preview.json"), "utf8"))));
});

test("optional previews are unavailable when missing and malformed fixtures fail with lock cleanup", async (t) => {
  let store;
  t.after(async () => { if (store) await store.close(); });
  const directory = await dataDirectory(t);
  const customRoot = path.join(directory, "release");
  const fixtures = path.join(customRoot, "skills/ps/fixtures");
  await mkdir(path.join(customRoot, "skills/ps/config"), { recursive: true });
  await mkdir(fixtures, { recursive: true });
  const custom = structuredClone(config);
  custom.products = [custom.products[0]];
  const configFile = path.join(customRoot, "skills/ps/config/products.json");
  await writeFile(configFile, JSON.stringify(custom));
  await writeFile(path.join(fixtures, "zava-shop.json"), await readFile(path.join(root, "skills/ps/fixtures/zava-shop.json")));
  const dataDir = path.join(directory, "state");
  store = await openStore({ root: customRoot, dataDir, now });
  assert.equal(store.getState().products[0].previewSources, null);
  await store.close();
  store = null;
  const legacyPreview = JSON.parse(await readFile(path.join(root, "skills/ps/fixtures/zava-shop.preview.json"), "utf8"));
  delete legacyPreview.appMonitoring;
  delete legacyPreview.adoption;
  delete legacyPreview.support;
  delete legacyPreview.business;
  await writeFile(path.join(fixtures, "zava-shop.preview.json"), JSON.stringify(legacyPreview));
  store = await openStore({ root: customRoot, dataDir, now });
  assert.ok(store.getState().products[0].previewSources.stories.total > 0);
  assert.equal(store.getState().products[0].previewSources.appMonitoring, null);
  for (const source of ["adoption", "support", "business"]) assert.equal(store.getState().products[0].previewSources[source], null);
  await store.close();
  store = null;
  await writeFile(path.join(fixtures, "zava-shop.preview.json"), "{broken");
  await assert.rejects(openStore({ root: customRoot, dataDir, now }), /Cannot read/);
  await assert.rejects(stat(path.join(dataDir, "writer.lock")), { code: "ENOENT" });
  custom.products[0].repositories = ["zava/shop"];
  await writeFile(configFile, JSON.stringify(custom));
  store = await openStore({ root: customRoot, dataDir, now });
  assert.equal(store.getState().products[0].snapshot.mode, "live");
  assert.equal(store.getState().products[0].previewSources, null);
});

test("separate session processes retain both concurrent updates", async (t) => {
  const dataDir = await dataDirectory(t);
  const module = new URL("../skills/ps/lib/store.mjs", import.meta.url).href;
  const children = [];
  try {
    for (const index of [0, 1]) {
      const child = spawn(process.execPath, ["--input-type=module", "-e", `
        import { openStore } from ${JSON.stringify(module)};
        const store = await openStore({root: process.argv[1], dataDir: process.argv[2], now: () => ${now()}});
        process.send({ready: true});
        process.once("message", async () => {
          try {
            const candidate = store.getState().products[0].candidates[${index}];
            await store.review({productId: "zava-shop", candidateId: candidate.id,
              evidenceHash: candidate.evidenceHash, decision: "approved", reviewer: "Test owner"});
            process.send({revision: store.getState().revision});
          } catch (error) { process.send({error: error.message}); }
          finally { await store.close(); process.disconnect(); }
        });
      `, root, dataDir], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
      children.push(child);
      const [ready] = await once(child, "message");
      assert.equal(ready.ready, true);
    }
    const responses = children.map(child => once(child, "message"));
    const exits = children.map(child => once(child, "exit"));
    for (const child of children) child.send("review");
    for (const [result] of await Promise.all(responses)) assert.equal(result.error, undefined);
    for (const [code] of await Promise.all(exits)) assert.equal(code, 0);
    const store = await openStore({ root, dataDir, now });
    try {
      assert.equal(store.getState().revision, 2);
      assert.equal(store.getState().products[0].timeline.length, 2);
    } finally { await store.close(); }
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
  }
});

test("opening waits for a short transaction without stealing its live lock", async (t) => {
  const dataDir = await dataDirectory(t);
  const lockPath = path.join(dataDir, "writer.lock");
  await writeFile(lockPath, String(process.pid));
  const { unlink } = await import("node:fs/promises");
  const opening = openStore({ root, dataDir, now });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await readFile(lockPath, "utf8"), String(process.pid));
  await unlink(lockPath);
  const store = await opening;
  await store.close();
  await assert.rejects(store.refreshFixtures(), /closed/);
  assert.throws(() => store.getState(), /closed/);
});
