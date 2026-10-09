import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, access, mkdtemp, rm, mkdir, writeFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { refreshData, redateFixture } from "../skills/ps-data-refresh/scripts/refresh.mjs";
import { automationDraft, main as importAutomation } from "../skills/ps-data-refresh/scripts/import-automation.mjs";
import { openStore } from "../skills/ps/lib/store.mjs";
import { validateSnapshot } from "../skills/ps/lib/model.mjs";
import { validatePreview } from "../skills/ps/lib/preview-model.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(await readFile(path.join(root, "skills/ps/config/products.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "skills/ps-version/version-manifest.json"), "utf8"));
const command = path.join(root, "skills/ps-data-refresh/scripts/refresh.mjs");
const run = promisify(execFile);
const day = 86_400_000;
const initialTime = Date.parse("2026-09-24T08:00:00Z");
const fixtures = new Map(await Promise.all((await readdir(path.join(root, "skills/ps/fixtures"))).map(async name =>
  [name, await readFile(path.join(root, "skills/ps/fixtures", name), "utf8")])));

async function workspace(t, close = async () => {}) {
  const directory = await mkdtemp(path.join(root, "tests", "refresh-"));
  t.after(async () => {
    try { await close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  return directory;
}

async function customRelease(directory, configuration = config) {
  const release = path.join(directory, "release");
  await mkdir(path.join(release, "skills/ps/config"), { recursive: true });
  await writeFile(path.join(release, "skills/ps/config/products.json"), JSON.stringify(configuration));
  await cp(path.join(root, "skills/ps/fixtures"), path.join(release, "skills/ps/fixtures"), { recursive: true });
  return release;
}

function assertShifted(original, shifted, offset) {
  if (typeof original === "string" && /^\d{4}-\d\d-\d\dT/.test(original)) {
    assert.equal(Date.parse(shifted) - Date.parse(original), offset, original);
  } else if (original && typeof original === "object") {
    assert.deepEqual(Object.keys(shifted), Object.keys(original));
    for (const key of Object.keys(original)) assertShifted(original[key], shifted[key], offset);
  } else {
    assert.deepEqual(shifted, original);
  }
}

test("re-dating shifts every observation and window equally without altering facts or provenance", () => {
  const time = initialTime + 3 * day;
  for (const product of config.products) {
    for (const suffix of [".json", ".preview.json"]) {
      const original = JSON.parse(fixtures.get(product.id + suffix));
      const before = structuredClone(original);
      const shifted = redateFixture(original, time);
      assertShifted(original, shifted, time - Date.parse(original.fetchedAt));
      assert.equal(shifted.mode, "fixture");
      if (suffix === ".json") validateSnapshot(shifted, product, { now: time, allowFixture: true });
      else validatePreview(shifted, product, { now: time });
      assert.deepEqual(original, before);
      assert.deepEqual(redateFixture(shifted, time), shifted);
    }
  }
  assert.throws(() => redateFixture({ mode: "live" }, initialTime), /Only fixture/);
  const sample = JSON.parse(fixtures.get("zava-shop.json"));
  assert.throws(() => redateFixture(sample, NaN), /Invalid refresh time/);
  assert.throws(() => redateFixture(sample, Date.parse(sample.fetchedAt) - 1), /backwards/);
});

test("all-product refresh makes every sample source fresh and persists through restart and the next day", async t => {
  let store;
  const dataDir = await workspace(t, () => store?.close());
  let clock = initialTime + 2 * day;
  store = await openStore({ root, dataDir, now: () => clock });
  const original = store.getState();
  assert.ok(original.products.every(product => product.assessment.stale && product.previewSources.stale));
  const result = await refreshData(undefined, store);
  assert.equal(result.skillVersion, manifest.skills["ps-data-refresh"]);
  assert.equal(result.status, "refreshed");
  assert.equal(result.productId, null);
  assert.equal(result.retrieved, false);
  assert.equal(result.ingested, false);
  assert.equal(result.revision, 1);
  assert.equal(result.products.length, config.products.length);
  const first = store.getState();
  for (const product of first.products) {
    assert.equal(product.assessment.stale, false);
    assert.equal(product.previewSources.stale, false);
    assert.equal(product.snapshot.fetchedAt, new Date(clock).toISOString());
    assert.equal(product.previewSources.fetchedAt, new Date(clock).toISOString());
    assert.deepEqual(product.release, config.products.find(item => item.id === product.id).release);
    assert.equal(product.changes.hasBaseline, false);
  }
  const persisted = JSON.parse(await readFile(path.join(dataDir, "state.json"), "utf8"));
  for (const product of config.products) {
    for (const [key, suffix] of [["snapshots", ".json"], ["fixturePreviews", ".preview.json"]]) {
      const sample = JSON.parse(fixtures.get(product.id + suffix));
      assertShifted(sample, persisted[key][product.id], clock - Date.parse(sample.fetchedAt));
    }
  }
  const unchanged = await refreshData(undefined, store);
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.revision, 1);
  await store.close();
  store = null;
  store = await openStore({ root, dataDir, now: () => clock });
  assert.deepEqual(store.getState(), first);
  clock += day + 1;
  assert.ok(store.getState().products.every(product => product.previewSources.stale && product.assessment.stale));
  assert.equal((await refreshData(undefined, store)).revision, 2);
  assert.ok(store.getState().products.every(product => !product.previewSources.stale && !product.assessment.stale));
  for (const [name, content] of fixtures) assert.equal(await readFile(path.join(root, "skills/ps/fixtures", name), "utf8"), content);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "skills/ps/config/products.json"), "utf8")), config);
});

test("single-product refresh preserves other products and exact human-reviewed history", async t => {
  let store;
  const dataDir = await workspace(t, () => store?.close());
  let clock = initialTime;
  store = await openStore({ root, dataDir, now: () => clock });
  const candidate = store.getState().products[0].candidates[0];
  await store.review({
    productId: "zava-shop", candidateId: candidate.id, evidenceHash: candidate.evidenceHash,
    decision: "approved", reviewer: "Fixture test reviewer", note: "Isolated test only",
  });
  const before = store.getState();
  const reviews = JSON.parse(await readFile(path.join(dataDir, "state.json"), "utf8")).reviews;
  clock += day;
  const result = await refreshData("zava-shop", store);
  const after = store.getState();
  assert.deepEqual(result.products, [{ productId: "zava-shop", status: "refreshed", reason: "fixture-dates" }]);
  assert.deepEqual(after.products[0].timeline, before.products[0].timeline);
  assert.equal(after.products[0].candidates[0].review, null);
  assert.deepEqual(after.products[1].snapshot, before.products[1].snapshot);
  assert.equal(after.products[1].previewSources.fetchedAt, before.products[1].previewSources.fetchedAt);
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, "state.json"), "utf8")).reviews, reviews);
});

test("mixed portfolio skips live evidence and missing samples rather than making them fresh", async t => {
  let store;
  const directory = await workspace(t, () => store?.close());
  const configuration = structuredClone(config);
  configuration.products[1].repositories = ["contoso/crm"];
  configuration.products.push({ ...structuredClone(configuration.products[0]), id: "no-samples" });
  const release = await customRelease(directory, configuration);
  let clock = initialTime;
  store = await openStore({ root: release, dataDir: path.join(directory, "state"), now: () => clock });
  const live = JSON.parse(fixtures.get("contoso-crm.json"));
  live.mode = "live";
  live.fetchedAt = new Date(clock).toISOString();
  live.issues.forEach(issue => { issue.url = `https://github.com/${issue.repository}/issues/${issue.number}`; });
  await store.ingestSnapshot(live);
  clock += 2 * day;
  const before = store.getState();
  const result = await refreshData(undefined, store);
  assert.deepEqual(result.products.map(item => item.reason), ["fixture-dates", "live-refresh-disabled", "no-fixture"]);
  const after = store.getState();
  assert.equal(after.products[0].assessment.stale, false);
  assert.deepEqual(after.products.slice(1), before.products.slice(1));
  assert.equal(after.products[1].assessment.stale, true);
  const saved = await readFile(path.join(directory, "state/state.json"), "utf8");
  assert.equal((await refreshData("contoso-crm", store)).status, "skipped");
  assert.equal(await readFile(path.join(directory, "state/state.json"), "utf8"), saved);
});

test("missing optional previews remain absent and invalid requests never mutate state", async t => {
  let store;
  const directory = await workspace(t, () => store?.close());
  const release = await customRelease(directory);
  await rm(path.join(release, "skills/ps/fixtures/zava-shop.preview.json"));
  store = await openStore({ root: release, dataDir: path.join(directory, "state"), now: () => initialTime });
  const before = store.getState();
  for (const id of [null, "", "../zava-shop", "unknown-product", 42]) {
    await assert.rejects(refreshData(id, store), /Unknown product/);
    assert.deepEqual(store.getState(), before);
  }
  await refreshData("zava-shop", store);
  assert.equal(store.getState().products[0].previewSources, null);
});

test("failed persistence publishes no partial refresh, releases the queue and cleans temporary files", async t => {
  let store;
  const dataDir = await workspace(t, () => store?.close());
  store = await openStore({ root, dataDir, now: () => initialTime });
  const before = store.getState();
  await mkdir(path.join(dataDir, "state.json"));
  await assert.rejects(refreshData(undefined, store), /EISDIR|EPERM|EEXIST/);
  await assert.rejects(async () => store.getState(), /EISDIR|EPERM/);
  const entries = await readdir(dataDir);
  assert.equal(entries.filter(name => name.startsWith("runtime-")).length, 1);
  assert.equal(entries.filter(name => !name.startsWith("runtime-")).join(), "state.json");
  await rm(path.join(dataDir, "state.json"), { recursive: true });
  assert.deepEqual(store.getState(), before);
  const results = await Promise.all([refreshData(undefined, store), refreshData(undefined, store)]);
  assert.deepEqual(results.map(result => result.status), ["refreshed", "unchanged"]);
  assert.equal(store.getState().revision, 1);
});

test("a clock regression in the second product aborts the entire refresh without partial publication", async t => {
  let store;
  const dataDir = await workspace(t, () => store?.close());
  let clock = initialTime + day;
  store = await openStore({ root, dataDir, now: () => clock });
  await refreshData("contoso-crm", store);
  const before = store.getState();
  const saved = await readFile(path.join(dataDir, "state.json"), "utf8");
  clock = initialTime;
  await assert.rejects(refreshData(undefined, store), /backwards|timestamp is in the future/);
  clock = initialTime + day;
  assert.deepEqual(store.getState(), before);
  assert.equal(await readFile(path.join(dataDir, "state.json"), "utf8"), saved);
});

test("malformed persisted previews fail explicitly and fixture-to-live migration hides refreshed samples", async t => {
  let store;
  const directory = await workspace(t, () => store?.close());
  const release = await customRelease(directory);
  const dataDir = path.join(directory, "state");
  store = await openStore({ root: release, dataDir, now: () => initialTime });
  await refreshData(undefined, store);
  await store.close();
  store = null;
  const stateFile = path.join(dataDir, "state.json");
  const saved = await readFile(stateFile, "utf8");
  const broken = JSON.parse(saved);
  broken.fixturePreviews["zava-shop"].appMonitoring.logs[0].timestamp = "invalid";
  await writeFile(stateFile, JSON.stringify(broken));
  await assert.rejects(openStore({ root: release, dataDir, now: () => initialTime }), /timestamp/);
  await assert.rejects(access(path.join(dataDir, "writer.lock")), { code: "ENOENT" });
  await writeFile(stateFile, saved);
  const configuration = structuredClone(config);
  configuration.products[0].repositories = ["zava/shop"];
  await writeFile(path.join(release, "skills/ps/config/products.json"), JSON.stringify(configuration));
  store = await openStore({ root: release, dataDir, now: () => initialTime });
  const product = store.getState().products[0];
  assert.equal(product.snapshot.mode, "live");
  assert.equal(product.previewSources, null);
  assert.equal((await refreshData("zava-shop", store)).status, "skipped");
});

test("CLI works outside release cwd and shares state with an active session", async t => {
  let store;
  const dataDir = await workspace(t, () => store?.close());
  const options = { cwd: path.join(root, "skills/ps-data-refresh") };
  const { stdout, stderr } = await run(process.execPath, [command, "--all", "--data-dir", dataDir], options);
  assert.equal(stderr, "");
  assert.equal(JSON.parse(stdout).status, "refreshed");
  store = await openStore({ root, dataDir });
  assert.ok(store.getState().products.every(product => !product.assessment.stale && !product.previewSources.stale));
  const refreshed = await run(process.execPath, [command, "zava-shop", "--data-dir", dataDir]);
  assert.equal(JSON.parse(refreshed.stdout).status, "refreshed");
  assert.equal(store.getState().revision, JSON.parse(refreshed.stdout).revision);
  for (const args of [[], ["--live"], ["zava-shop", "--live"], ["unknown-product", "--data-dir", path.join(dataDir, "invalid")]]) {
    await assert.rejects(run(process.execPath, [command, ...args]), error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.equal(typeof JSON.parse(error.stderr).error, "string");
      return true;
    });
  }
});

test("manual and scheduled refresh share the fixture-only skill contract", async () => {
  const automation = JSON.parse(await readFile(path.join(root, "automations/ps-data-refresh/manifest.json"), "utf8"));
  assert.equal(automation.skill, "skills/ps-data-refresh/SKILL.md");
  assert.equal(automation.permissions.github, "none");
  assert.equal(automation.permissions.fixtureDateRefresh, true);
  assert.equal(automation.permissions.timelineApproval, false);
  assert.equal(automation.enabledByDefault, false);
  assert.equal(automation.importOnSetup, true);
  assert.equal(automation.scheduling.trigger, "daily");
  assert.equal(automation.scheduling.intervalHours, 24);
  assert.equal(automation.scheduling.execution, "local");
  assert.equal(automation.inputs.scope, "all");
  const scheduled = await readFile(path.join(root, "automations/ps-data-refresh/SKILL.md"), "utf8");
  assert.match(scheduled, /Invoke `skills\/ps-data-refresh\/SKILL.md` once/);
  const parent = await readFile(path.join(root, "skills/ps/SKILL.md"), "utf8");
  assert.match(parent, /Route data refresh requests to `ps-data-refresh`/);
  assert.match(parent.replace(/\s+/g, " "), /without running steps 5-6/);
  const skill = await readFile(path.join(root, automation.skill), "utf8");
  assert.match(skill, /ps_refresh_fixtures/);
  assert.match(skill, /--all/);
  const example = JSON.parse(skill.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(example.skillVersion, manifest.skills["ps-data-refresh"]);
  assert.equal(example.status, "refreshed");
  assert.equal(example.retrieved, false);
  assert.equal(example.ingested, false);
});

test("automation import opens a documented daily draft, not an already-created scheduler", async () => {
  const automation = JSON.parse(await readFile(path.join(root, "automations/ps-data-refresh/manifest.json"), "utf8"));
  const result = await automationDraft("07:35");
  assert.equal(result.status, "confirmation-required");
  assert.equal(result.execution, "local");
  assert.equal(result.scope, "all");
  assert.equal(result.intervalHours, 24);
  assert.match(result.note, /no automation has been created/);
  const appLink = new URL(result.appLink);
  assert.equal(appLink.protocol, "ghapp:");
  assert.equal(appLink.hostname, "automations");
  assert.equal(appLink.pathname, "/new");
  assert.deepEqual(Object.fromEntries(appLink.searchParams), {
    name: "ps-data-refresh", trigger: "daily", time: "07:35", prompt: automation.prompt,
  });
  assert.equal(new URL(result.launcherUrl).origin, "https://github.com");
  assert.equal(new URL(result.launcherUrl).pathname, "/copilot/app/launch");
  assert.equal(new URL(result.launcherUrl).searchParams.get("open"), result.appLink);
  assert.equal((await automationDraft()).time, "09:00");
  assert.equal(new URL((await automationDraft("23:59")).appLink).searchParams.get("time"), "23:59");
  for (const time of ["7:35", "24:00", "09:60", "", "09:00&trigger=hourly", null, 9]) {
    await assert.rejects(automationDraft(time), /HH:mm/);
  }
  for (const args of [["--time"], ["--create"], ["--time", "09:00", "--apply"]]) {
    await assert.rejects(importAutomation(args), /Usage/);
  }
  const { stdout } = await run(process.execPath, [
    path.join(root, "skills/ps-data-refresh/scripts/import-automation.mjs"), "--time", "07:35",
  ], { cwd: path.join(root, "tests") });
  assert.deepEqual(JSON.parse(stdout), result);
});
