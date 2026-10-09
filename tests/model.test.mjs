import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateConfig, validateSnapshot, correlate, assess, changesSince, investigationPrompt } from "../skills/ps/lib/model.mjs";

const config = JSON.parse(await readFile(new URL("../skills/ps/config/products.json", import.meta.url), "utf8"));
const snapshot = JSON.parse(await readFile(new URL("../skills/ps/fixtures/zava-shop.json", import.meta.url), "utf8"));
const product = config.products[0];
const now = Date.parse("2026-09-24T08:00:00Z");
const options = { now, allowFixture: true };

test("configuration and authored snapshots satisfy the contract", () => {
  assert.equal(validateConfig(config), config);
  assert.equal(validateSnapshot(snapshot, product, options), snapshot);
  assert.throws(() => validateSnapshot(snapshot, product, { now }), /Only live/);
});

test("strict contract rejects hidden fields, identity mismatch, malformed dates and duplicates", () => {
  for (const mutate of [
    (data) => { data.secret = "must not persist"; },
    (data) => { data.issues[0].rawBody = "not part of contract"; },
    (data) => { data.productId = "another"; },
    (data) => { data.fetchedAt = "2026-02-30T08:00:00Z"; },
    (data) => { data.fetchedAt = "2027-09-24T08:00:00Z"; },
    (data) => { data.issues[0].id = "other/repo#12"; },
    (data) => { data.issues[0].number = -1; },
    (data) => { data.issues[0].labels.push(data.issues[0].labels[0]); },
    (data) => { data.issues.push(data.issues[0]); },
    (data) => { data.coverage.status = "unavailable"; },
    (data) => { data.issues[0].url = "javascript:alert(1)"; },
  ]) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.throws(() => validateSnapshot(changed, product, options));
  }
});

test("live sources are scoped and source links must match exact issue identity", () => {
  const configured = { ...product, repositories: ["zava/shop", "zava/mobile"] };
  const live = structuredClone(snapshot);
  live.mode = "live";
  live.issues.forEach((issue) => { issue.url = `https://github.com/${issue.repository}/issues/${issue.number}`; });
  assert.throws(() => validateSnapshot(live, configured, { now }), /every configured/);
  live.coverage.status = "partial";
  assert.equal(validateSnapshot(live, configured, { now }), live);
  live.issues[0].url = "https://evil.example/issues/142";
  assert.throws(() => validateSnapshot(live, configured, { now }), /Issue URL/);
  live.issues[0].url = "https://github.com/zava/shop/issues/142";
  live.coverage.repositories.push("unconfigured/repo");
  assert.throws(() => validateSnapshot(live, configured, { now }), /unconfigured/);
});

test("only explicit component + release relationships generate a correlation", () => {
  const candidates = correlate(product, snapshot);
  const correlation = candidates.find((item) => item.kind === "correlation");
  assert.deepEqual(correlation.evidence.map((item) => item.id), ["zava/shop#142", "zava/shop#156"]);
  assert.match(correlation.explanation, /not a proven dependency/);
  assert.equal(correlation.classification, "Derived insight");
  assert.equal(candidates.length, 5);
  const changed = structuredClone(snapshot);
  changed.issues[1].milestone = "v5.0";
  assert.equal(correlate(product, changed).filter((item) => item.kind === "correlation").length, 0);
});

test("material evidence and rules changes invalidate previous review identity", () => {
  const before = correlate(product, snapshot)[0];
  const changed = structuredClone(snapshot);
  changed.issues[0].summary += " Updated impact.";
  assert.notEqual(correlate(product, changed)[0].id, before.id);
  const rulesChanged = structuredClone(product);
  rulesChanged.rules.attentionLabels.push("urgent");
  assert.notEqual(correlate(rulesChanged, snapshot)[0].evidenceHash, before.evidenceHash);
});

test("coverage and exact freshness boundary never imply universal release readiness", () => {
  assert.equal(assess(product, snapshot, now).status, "Attention required");
  const edge = Date.parse(snapshot.fetchedAt) + 24 * 3_600_000;
  assert.equal(assess(product, snapshot, edge).stale, false);
  assert.equal(assess(product, snapshot, edge + 1).status, "Unknown");
  assert.equal(assess(product, { ...snapshot, coverage: { ...snapshot.coverage, status: "partial" } }, now).status, "Unknown");
  assert.equal(assess(product, { ...snapshot, issues: [] }, now).status, "No issue flags");
  assert.match(assess(product, { ...snapshot, issues: [] }, now).limitations, /readiness is unknown/);
});

test("changes require comparable snapshots and missing items do not imply closure", () => {
  assert.deepEqual(changesSince(null, snapshot), { hasBaseline: false, items: [] });
  assert.equal(changesSince(snapshot, { ...snapshot, mode: "live" }).hasBaseline, false);
  const next = structuredClone(snapshot);
  next.issues.shift();
  assert.equal(changesSince(snapshot, next).items.length, 0);
  next.issues[0].state = "closed";
  assert.equal(changesSince(snapshot, next).items[0].change, "Closed");
});

test("role-aware investigation preserves provenance, scope and safety boundaries", () => {
  const prompt = investigationPrompt(product, snapshot, { role: "Engineering Lead", question: "Investigate checkout", issueId: "zava/shop#142" }, correlate(product, snapshot));
  assert.match(prompt, /Engineering Lead/);
  assert.match(prompt, /fixture/);
  assert.match(prompt, /none — ask for repository bindings/);
  assert.match(prompt, /Do not approve memory/);
  assert.throws(() => investigationPrompt(product, snapshot, { role: "Admin", question: "Why?" }, []), /Invalid role/);
});

test("reserved identifiers and invalid target dates fail explicitly", () => {
  const changed = structuredClone(config);
  changed.products[0].id = "constructor";
  assert.throws(() => validateConfig(changed), /Invalid product id/);
  changed.products[0].id = "zava-shop";
  changed.products[0].release.targetDate = "2026-02-30";
  assert.throws(() => validateConfig(changed), /valid date/);
});
