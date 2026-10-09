import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { VERSION } from "../skills/ps/lib/model.mjs";
import { validatePreview, summarizePreview } from "../skills/ps/lib/preview-model.mjs";

const config = JSON.parse(await readFile(new URL("../skills/ps/config/products.json", import.meta.url), "utf8"));
const fixtures = await Promise.all(["zava-shop", "contoso-crm"].map(async (id) =>
  JSON.parse(await readFile(new URL(`../skills/ps/fixtures/${id}.preview.json`, import.meta.url), "utf8"))));
const now = Date.parse("2026-09-24T08:00:00Z");
const options = { now };
const product = config.products.find((item) => item.id === "zava-shop");
const [zava, contoso] = fixtures;
const copy = () => structuredClone(zava);
const summaryKeys = ["mode", "fetchedAt", "stale", "sourceUrls", "stories", "monitoring", "appMonitoring", "adoption", "support", "business"];
const storyKeys = ["total", "accepted", "acceptanceGaps", "decisions", "items", "concern"];
const monitoringKeys = ["window", "baselineWindow", "journeys", "underTargetCount", "lowestSuccessRate", "concern"];
const derivedKeys = ["successRate", "baselineSuccessRate", "successDeltaPp", "p95ChangePct", "atRisk"];

function onlyKeys(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function zeroCurrent(journey) {
  Object.assign(journey, { attempts: 0, successes: 0, affectedUsers: 0, p95Ms: 0 });
}

function zeroBaseline(journey) {
  Object.assign(journey, { baselineAttempts: 0, baselineSuccesses: 0, baselineP95Ms: 0 });
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test("both opt-in resources use the strict fictional contract and stable original identity", () => {
  for (const snapshot of fixtures) {
    const configured = config.products.find((item) => item.id === snapshot.productId);
    assert.equal(validatePreview(snapshot, configured, options), snapshot);
    assert.equal(snapshot.schemaVersion, "1.0");
    assert.equal(snapshot.pipelineVersion, VERSION);
    assert.equal(snapshot.mode, "fixture");
    assert.equal(snapshot.fetchedAt, "2026-09-24T06:00:00Z");
    assert.deepEqual(snapshot.sourceUrls, { confluence: null, applicationInsights: null });
    assert.equal(snapshot.stories.length, 7);
    assert.equal(snapshot.monitoring.journeys.length, 4);
    assert.deepEqual(new Set(snapshot.stories.map((story) => story.status)), new Set(["accepted", "in-progress", "draft"]));
    assert.deepEqual(snapshot.monitoring.window, { start: "2026-09-23T06:00:00Z", end: snapshot.fetchedAt });
    assert.deepEqual(snapshot.monitoring.baselineWindow, { start: "2026-09-22T06:00:00Z", end: "2026-09-23T06:00:00Z" });
    for (const item of [...snapshot.stories, ...snapshot.monitoring.journeys]) assert.match(item.localKey, /^sample-/);
  }
});

test("summaries contain exactly the requested fields and preserve all raw facts", () => {
  for (const snapshot of fixtures) {
    const summary = summarizePreview(snapshot, options);
    onlyKeys(summary, summaryKeys);
    onlyKeys(summary.stories, storyKeys);
    onlyKeys(summary.monitoring, monitoringKeys);
    assert.equal(summary.mode, "fixture");
    assert.equal(summary.fetchedAt, snapshot.fetchedAt);
    assert.deepEqual(summary.sourceUrls, snapshot.sourceUrls);
    assert.deepEqual(summary.stories.items, snapshot.stories);
    assert.deepEqual(summary.monitoring.window, snapshot.monitoring.window);
    assert.deepEqual(summary.monitoring.baselineWindow, snapshot.monitoring.baselineWindow);
    for (const section of [summary.stories, summary.monitoring]) {
      onlyKeys(section.concern, ["title", "evidence", "recommendation"]);
      assert.ok(section.concern.evidence.every((item) => typeof item === "string"));
      assert.equal(typeof section.concern.recommendation, "string");
    }
    summary.monitoring.journeys.forEach((journey, index) => {
      const raw = snapshot.monitoring.journeys[index];
      onlyKeys(journey, [...Object.keys(raw), ...derivedKeys]);
      for (const field of Object.keys(raw)) assert.equal(journey[field], raw[field]);
    });
    assert.doesNotMatch(JSON.stringify(summary), /readiness|ready|healthy|overallScore/i);
  }
});

test("Zava derived counts, rates, percentage-point changes and latency changes are exact", () => {
  const summary = summarizePreview(zava, options);
  assert.deepEqual(
    [summary.stories.total, summary.stories.accepted, summary.stories.acceptanceGaps, summary.stories.decisions],
    [7, 2, 2, 2],
  );
  assert.deepEqual(summary.monitoring.journeys.map((journey) => derivedKeys.map((key) => journey[key])), [
    [92, 97, -5, 50, true],
    [98, 95, 3, -25, false],
    [95, 98, -3, 20, true],
    [100, 99, 1, -25, false],
  ]);
  assert.equal(summary.monitoring.underTargetCount, 2);
  assert.equal(summary.monitoring.lowestSuccessRate, 92);
});

test("Contoso includes true improvements and regressions without cross-product data", () => {
  const summary = summarizePreview(contoso, options);
  assert.deepEqual(
    [summary.stories.total, summary.stories.accepted, summary.stories.acceptanceGaps, summary.stories.decisions],
    [7, 3, 2, 2],
  );
  assert.deepEqual(summary.monitoring.journeys.map((journey) => derivedKeys.map((key) => journey[key])), [
    [90, 95, -5, 50, true],
    [95, 90, 5, -20, false],
    [99, 98, 1, -37.5, false],
    [95, 98, -3, 50, true],
  ]);
  assert.equal(summary.monitoring.underTargetCount, 2);
  assert.equal(summary.monitoring.lowestSuccessRate, 90);
  assert.doesNotMatch(JSON.stringify(summary), /zava|checkout|payment/i);
});

test("story concern cites each missing criterion and actual owner decision separately from recommendations", () => {
  for (const snapshot of fixtures) {
    const concern = summarizePreview(snapshot, options).stories.concern;
    assert.equal(concern.evidence.length, 4);
    for (const story of snapshot.stories) {
      const evidence = concern.evidence.filter((line) => line.startsWith(`${story.title}:`));
      assert.equal(evidence.length, Number(story.acceptance === "missing") + Number(story.decision !== null));
      evidence.forEach((line) => assert.ok(line.includes(story.owner)));
      if (story.decision) assert.ok(evidence.some((line) => line.includes(story.decision)));
    }
    assert.match(concern.recommendation, /product owner/);
    assert.match(concern.recommendation, /scope decisions/);
  }
});

test("monitoring concern cites measured impact, target misses and comparable baselines without aggregate users or causality", () => {
  const concern = summarizePreview(zava, options).monitoring.concern;
  assert.equal(concern.evidence.length, 2);
  assert.equal(concern.evidence[0], "Checkout completion: 920/1000 successful attempts (92%; target 98%); 80 failed attempts; 60 affected users within this journey; baseline 970/1000 (97%; change -5 percentage points); observed p95 2400 ms (target 2000 ms); baseline observed p95 1600 ms; change 50%.");
  assert.equal(concern.evidence[1], "Payment completion: 760/800 successful attempts (95%; target 99%); 40 failed attempts; 28 affected users within this journey; baseline 980/1000 (98%; change -3 percentage points); observed p95 1800 ms (target 1600 ms); baseline observed p95 1500 ms; change 20%.");
  assert.match(concern.recommendation, /association is not causality/);
  assert.match(concern.recommendation, /Do not add affected users across journeys/);
  assert.ok(concern.evidence.every((line) => !line.includes("caused") && !line.includes("recommend")));
});

test("risk counts each journey once for either target miss and excludes equality", () => {
  const changed = copy();
  changed.monitoring.journeys = [changed.monitoring.journeys[0]];
  const journey = changed.monitoring.journeys[0];
  journey.targetSuccessRate = 92;
  journey.targetP95Ms = 2400;
  assert.equal(summarizePreview(changed, options).monitoring.underTargetCount, 0);
  assert.equal(summarizePreview(changed, options).monitoring.journeys[0].atRisk, false);
  journey.targetSuccessRate = 93;
  assert.equal(summarizePreview(changed, options).monitoring.underTargetCount, 1);
  journey.targetSuccessRate = 92;
  journey.targetP95Ms = 2399;
  assert.equal(summarizePreview(changed, options).monitoring.underTargetCount, 1);
  journey.targetSuccessRate = 93;
  assert.equal(summarizePreview(changed, options).monitoring.underTargetCount, 1);
});

test("p95 slowdown can be a concern even when both targets are met", () => {
  const changed = copy();
  changed.monitoring.journeys = [changed.monitoring.journeys[0]];
  Object.assign(changed.monitoring.journeys[0], { targetSuccessRate: 90, targetP95Ms: 3000 });
  const summary = summarizePreview(changed, options).monitoring;
  assert.equal(summary.underTargetCount, 0);
  assert.equal(summary.journeys[0].atRisk, false);
  assert.match(summary.concern.evidence[0], /Checkout completion.*baseline observed p95 1600 ms; change 50%/);
});

test("zero current and baseline traffic remain unknown without inferred good or ready state", () => {
  const changed = copy();
  for (const journey of changed.monitoring.journeys) {
    zeroCurrent(journey);
    zeroBaseline(journey);
  }
  const summary = summarizePreview(changed, options);
  for (const journey of summary.monitoring.journeys) {
    assert.deepEqual(derivedKeys.map((key) => journey[key]), [null, null, null, null, false]);
  }
  assert.equal(summary.monitoring.lowestSuccessRate, null);
  assert.equal(summary.monitoring.underTargetCount, 0);
  assert.equal(summary.monitoring.concern, null);
  onlyKeys(summary.monitoring, monitoringKeys);
});

test("zero current traffic does not turn existing baseline success into a current rate", () => {
  const changed = copy();
  changed.monitoring.journeys = [changed.monitoring.journeys[0]];
  zeroCurrent(changed.monitoring.journeys[0]);
  const summary = summarizePreview(changed, options).monitoring;
  assert.deepEqual(derivedKeys.map((key) => summary.journeys[0][key]), [null, 97, null, null, false]);
  assert.equal(summary.lowestSuccessRate, null);
  assert.equal(summary.concern, null);
});

test("missing baseline traffic leaves comparisons unknown but retains current target misses", () => {
  const changed = copy();
  changed.monitoring.journeys = [changed.monitoring.journeys[0]];
  zeroBaseline(changed.monitoring.journeys[0]);
  const summary = summarizePreview(changed, options).monitoring;
  assert.deepEqual(derivedKeys.map((key) => summary.journeys[0][key]), [92, null, null, null, true]);
  assert.match(summary.concern.evidence[0], /baseline success unknown \(0 attempts\)/);
  assert.match(summary.concern.evidence[0], /p95 percentage comparison unavailable/);
  assert.doesNotMatch(summary.concern.evidence[0], /NaN|Infinity/);
});

test("zero baseline latency never divides by zero; observed latency is not recomputed from counts", () => {
  const changed = copy();
  const journey = changed.monitoring.journeys[0];
  journey.baselineP95Ms = 0;
  let summary = summarizePreview(changed, options).monitoring.journeys[0];
  assert.equal(summary.p95ChangePct, null);
  assert.equal(summary.p95Ms, 2400);
  assert.equal(summary.successDeltaPp, -5);
  Object.assign(journey, { attempts: 100, successes: 92, affectedUsers: 5 });
  summary = summarizePreview(changed, options).monitoring.journeys[0];
  assert.equal(summary.p95Ms, 2400);
  assert.equal(summary.successRate, 92);
});

test("lowest success rate excludes unknown journeys without pooling or averaging rates", () => {
  const changed = copy();
  zeroCurrent(changed.monitoring.journeys[0]);
  assert.equal(summarizePreview(changed, options).monitoring.lowestSuccessRate, 95);
});

test("empty arrays and no measured concerns do not imply readiness", () => {
  const changed = copy();
  changed.stories = [];
  changed.monitoring.journeys = [];
  const summary = summarizePreview(changed, options);
  assert.deepEqual(summary.stories, { total: 0, accepted: 0, acceptanceGaps: 0, decisions: 0, items: [], concern: null });
  assert.equal(summary.monitoring.concern, null);
  assert.equal(summary.monitoring.lowestSuccessRate, null);
  assert.equal(summary.monitoring.underTargetCount, 0);
  const improving = copy();
  improving.stories.forEach((story) => { story.acceptance = "defined"; story.decision = null; });
  improving.monitoring.journeys = [improving.monitoring.journeys[1]];
  assert.equal(summarizePreview(improving, options).stories.concern, null);
  assert.equal(summarizePreview(improving, options).monitoring.concern, null);
});

test("freshness is strict at the threshold and never changes authored fetchedAt", () => {
  const fetched = Date.parse(zava.fetchedAt);
  for (const maxAgeHours of [1, 24, 720]) {
    const edge = fetched + maxAgeHours * 3_600_000;
    assert.equal(summarizePreview(zava, { now: edge, maxAgeHours }).stale, false);
    assert.equal(summarizePreview(zava, { now: edge + 1, maxAgeHours }).stale, true);
    assert.equal(summarizePreview(zava, { now: edge + 1, maxAgeHours }).fetchedAt, zava.fetchedAt);
  }
  assert.equal(summarizePreview(zava, { now: fetched }).stale, false);
  assert.equal(summarizePreview(zava, { now: fetched + 24 * 3_600_000 + 1 }).stale, true);
  for (const maxAgeHours of [0, -1, 721, NaN, Infinity, "24", null]) {
    assert.throws(() => summarizePreview(zava, { now, maxAgeHours }), /maxAgeHours/);
  }
  for (const invalidNow of [NaN, Infinity, "2026-09-24", null, 9e20]) {
    assert.throws(() => validatePreview(zava, product, { now: invalidNow }), /now/);
    assert.throws(() => summarizePreview(zava, { now: invalidNow }), /now/);
  }
});

test("validation rejects additional or missing fields at every object level", () => {
  for (const locate of [
    (snapshot) => snapshot,
    (snapshot) => snapshot.sourceUrls,
    (snapshot) => snapshot.stories[0],
    (snapshot) => snapshot.monitoring,
    (snapshot) => snapshot.monitoring.window,
    (snapshot) => snapshot.monitoring.baselineWindow,
    (snapshot) => snapshot.monitoring.journeys[0],
  ]) {
    const extra = copy();
    locate(extra).remoteId = "not allowed";
    assert.throws(() => validatePreview(extra, product, options), /exactly/);
    const missing = copy();
    delete locate(missing)[Object.keys(locate(missing))[0]];
    assert.throws(() => validatePreview(missing, product, options), /exactly/);
    const hidden = copy();
    Object.defineProperty(locate(hidden), "hidden", { value: 1 });
    assert.throws(() => validatePreview(hidden, product, options), /exactly/);
    const symbol = copy();
    locate(symbol)[Symbol("remote")] = 1;
    assert.throws(() => validatePreview(symbol, product, options), /exactly/);
  }
});

test("identity, fixture provenance, duplicate and remote-looking local keys fail closed", () => {
  assert.throws(() => validatePreview(zava, config.products.find((item) => item.id === "contoso-crm"), options), /product/);
  assert.throws(() => validatePreview(zava, null, options), /product/);
  for (const mutate of [
    (snapshot) => { snapshot.productId = "../zava-shop"; },
    (snapshot) => { snapshot.productId = "constructor"; },
    (snapshot) => { snapshot.schemaVersion = "2.0"; },
    (snapshot) => { snapshot.pipelineVersion = "0.2.0"; },
    (snapshot) => { snapshot.mode = "live"; },
    (snapshot) => { snapshot.mode = "preview"; },
    (snapshot) => { snapshot.sourceUrls.confluence = "https://example.invalid"; },
    (snapshot) => { snapshot.sourceUrls.applicationInsights = "javascript:alert(1)"; },
    (snapshot) => { snapshot.sourceUrls.applicationInsights = ""; },
    (snapshot) => { snapshot.stories.push(snapshot.stories[0]); },
    (snapshot) => { snapshot.monitoring.journeys.push(snapshot.monitoring.journeys[0]); },
    (snapshot) => { snapshot.monitoring.journeys[0].localKey = snapshot.stories[0].localKey; },
    (snapshot) => { snapshot.stories[0].localKey = "123456"; },
    (snapshot) => { snapshot.stories[0].localKey = "sample-../page"; },
    (snapshot) => { snapshot.stories[0].localKey = "page-123"; },
  ]) {
    const changed = copy();
    mutate(changed);
    assert.throws(() => validatePreview(changed, product, options));
    assert.throws(() => summarizePreview(changed, options));
  }
});

test("malformed timestamps, impossible calendar dates and any future fetch are rejected", () => {
  for (const date of ["2026-09-24", "2026-02-30T06:00:00Z", "2026-09-24T25:00:00Z", "2026-09-24T06:00:00+00:00", "2026-09-24T06:00:00.0000Z", 1790229600000, null]) {
    for (const change of [
      (snapshot) => { snapshot.fetchedAt = date; },
      (snapshot) => { snapshot.monitoring.window.start = date; },
      (snapshot) => { snapshot.monitoring.baselineWindow.start = date; },
    ]) {
      const changed = copy();
      change(changed);
      assert.throws(() => validatePreview(changed, product, options), /timestamp|valid date/);
    }
  }
  assert.throws(() => validatePreview(zava, product, { now: Date.parse(zava.fetchedAt) - 1 }), /future/);
  const changed = copy();
  changed.fetchedAt = "2026-09-24T08:00:00.001Z";
  assert.throws(() => validatePreview(changed, product, options), /future/);
  changed.fetchedAt = "2026-09-24T06:00:00.123Z";
  assert.equal(validatePreview(changed, product, options), changed);
});

test("baseline comparisons require ordered, adjacent, equal-duration windows not beyond fetch", () => {
  for (const mutate of [
    (snapshot) => { snapshot.monitoring.window.start = snapshot.monitoring.window.end; },
    (snapshot) => { snapshot.monitoring.window.end = "2026-09-25T06:00:00Z"; },
    (snapshot) => { snapshot.monitoring.window.start = "2026-09-23T07:00:00Z"; },
    (snapshot) => { snapshot.monitoring.baselineWindow.start = "2026-09-22T07:00:00Z"; },
    (snapshot) => { snapshot.monitoring.baselineWindow.end = "2026-09-23T05:00:00Z"; },
    (snapshot) => { snapshot.monitoring.baselineWindow.end = "2026-09-23T07:00:00Z"; },
    (snapshot) => { snapshot.monitoring.baselineWindow = { ...snapshot.monitoring.window }; },
    (snapshot) => { snapshot.monitoring.baselineWindow.start = "2026-09-24T06:00:00Z"; },
  ]) {
    const changed = copy();
    mutate(changed);
    assert.throws(() => validatePreview(changed, product, options), /window|Window/);
  }
});

test("counts, percentage targets, latency and baseline observations reject impossible values", () => {
  for (const field of ["attempts", "successes", "affectedUsers", "baselineAttempts", "baselineSuccesses"]) {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "100", null]) {
      const changed = copy();
      changed.monitoring.journeys[0][field] = value;
      assert.throws(() => validatePreview(changed, product, options), /safe integer/);
    }
  }
  for (const field of ["p95Ms", "baselineP95Ms", "targetP95Ms"]) {
    for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "100", null]) {
      const changed = copy();
      changed.monitoring.journeys[0][field] = value;
      assert.throws(() => validatePreview(changed, product, options), /milliseconds/);
    }
  }
  for (const value of [-1, 100.01, NaN, Infinity, "99", null]) {
    const changed = copy();
    changed.monitoring.journeys[0].targetSuccessRate = value;
    assert.throws(() => validatePreview(changed, product, options), /percentage/);
  }
  for (const mutate of [
    (journey) => { journey.successes = journey.attempts + 1; },
    (journey) => { journey.baselineSuccesses = journey.baselineAttempts + 1; },
    (journey) => { journey.affectedUsers = journey.attempts - journey.successes + 1; },
    (journey) => { journey.affectedUsers = journey.attempts + 1; },
    (journey) => { journey.targetP95Ms = 0; },
    (journey) => { zeroCurrent(journey); journey.p95Ms = 10; },
    (journey) => { zeroBaseline(journey); journey.baselineP95Ms = 10; },
    (journey) => { journey.baselineP95Ms = Number.MIN_VALUE; },
  ]) {
    const changed = copy();
    mutate(changed.monitoring.journeys[0]);
    assert.throws(() => validatePreview(changed, product, options));
  }
});

test("valid extreme rates, fractional latencies and failed-attempt user bounds are supported", () => {
  const changed = copy();
  const journey = changed.monitoring.journeys[0];
  journey.affectedUsers = journey.attempts - journey.successes;
  journey.p95Ms = 1250.5;
  for (const rate of [0, 99.95, 100]) {
    journey.targetSuccessRate = rate;
    assert.equal(validatePreview(changed, product, options), changed);
  }
  Object.assign(journey, { attempts: 10, successes: 0, affectedUsers: 10, baselineAttempts: 10, baselineSuccesses: 10 });
  const summary = summarizePreview(changed, options).monitoring.journeys[0];
  assert.equal(summary.successRate, 0);
  assert.equal(summary.baselineSuccessRate, 100);
  assert.equal(summary.successDeltaPp, -100);
});

test("story types, enums, text bounds and collection bounds are validated", () => {
  for (const field of ["title", "outcome", "owner", "decision"]) {
    for (const value of ["", " ", 1, false, {}, "a".repeat(2001)]) {
      const changed = copy();
      changed.stories[0][field] = value;
      assert.throws(() => validatePreview(changed, product, options), /string/);
    }
  }
  for (const mutate of [
    (snapshot) => { snapshot.stories[0].status = "done"; },
    (snapshot) => { snapshot.stories[0].acceptance = "unknown"; },
    (snapshot) => { snapshot.monitoring.journeys[0].name = ""; },
    (snapshot) => { snapshot.stories = {}; },
    (snapshot) => { snapshot.monitoring.journeys = null; },
    (snapshot) => { snapshot.stories = Array(1001).fill(snapshot.stories[0]); },
    (snapshot) => { snapshot.monitoring.journeys = Array(101).fill(snapshot.monitoring.journeys[0]); },
    (snapshot) => { delete snapshot.stories[0]; },
    (snapshot) => { delete snapshot.monitoring.journeys[0]; },
    (snapshot) => { snapshot.stories[0] = null; },
    (snapshot) => { snapshot.monitoring.window = []; },
    (snapshot) => { snapshot.monitoring = new Date(); },
  ]) {
    const changed = copy();
    mutate(changed);
    assert.throws(() => validatePreview(changed, product, options));
  }
  assert.throws(() => validatePreview(null, product, options), /object/);
  assert.throws(() => summarizePreview(null, options), /object/);
});

test("validation and summarization neither mutate input nor expose writable references", () => {
  for (const snapshot of fixtures) {
    const changed = structuredClone(snapshot);
    const before = structuredClone(changed);
    const configured = config.products.find((item) => item.id === changed.productId);
    freeze(changed);
    assert.equal(validatePreview(changed, configured, options), changed);
    const summary = summarizePreview(changed, options);
    assert.deepEqual(changed, before);
    summary.sourceUrls.confluence = "changed locally";
    summary.stories.items[0].title = "changed locally";
    summary.monitoring.window.start = "changed locally";
    summary.monitoring.baselineWindow.end = "changed locally";
    summary.monitoring.journeys[0].successes = 0;
    summary.stories.concern.evidence.push("changed locally");
    summary.appMonitoring.window.start = "changed locally";
    summary.appMonitoring.baselineWindow.end = "changed locally";
    summary.appMonitoring.requests.failed = 0;
    summary.appMonitoring.operations[0].name = "changed locally";
    summary.appMonitoring.logs[0].message = "changed locally";
    summary.appMonitoring.availability.summary = "changed locally";
    summary.appMonitoring.concern.evidence.push("changed locally");
    summary.adoption.window.start = "changed locally";
    summary.adoption.baselineWindow.end = "changed locally";
    summary.adoption.definitions.activation = "changed locally";
    summary.adoption.activation.activatedUsers = 0;
    summary.adoption.retention.returningUsers = 0;
    summary.adoption.features[0].adoptedUsers = 0;
    summary.adoption.outcomes[0].current = 0;
    assert.equal(summary.adoption.concern, null);
    summary.support.cases[0].status = "resolved";
    summary.support.themes[0].openCases = 0;
    summary.support.concern.evidence.push("changed locally");
    summary.business.window.start = "changed locally";
    summary.business.baselineWindow.end = "changed locally";
    summary.business.metrics[0].current = 0;
    assert.equal(summary.business.concern, null);
    assert.deepEqual(changed, before);
    assert.deepEqual(summarizePreview(changed, options), summarizePreview(before, options));
  }
});

function noAppTraffic(app, { baseline = true, logs = true, availability = false } = {}) {
  Object.assign(app.requests, { total: 0, failed: 0, p95Ms: null });
  if (baseline) Object.assign(app.requests, { baselineTotal: 0, baselineFailed: 0, baselineP95Ms: null });
  app.operations.forEach((operation) => Object.assign(operation, { requests: 0, failed: 0, p95Ms: null }));
  if (logs) app.logs = [];
  if (!availability) delete app.availability;
}

test("app monitoring remains optional without changing existing story and journey summaries", () => {
  for (const fixture of fixtures) {
    const legacy = structuredClone(fixture);
    delete legacy.appMonitoring;
    const configured = config.products.find((item) => item.id === legacy.productId);
    assert.equal(validatePreview(legacy, configured, options), legacy);
    const summary = summarizePreview(legacy, options);
    assert.equal(summary.appMonitoring, null);
    const { appMonitoring, ...current } = summarizePreview(fixture, options);
    const { appMonitoring: absent, ...previous } = summary;
    assert.deepEqual(current, previous);
    assert.ok(appMonitoring);
    assert.equal(absent, null);
  }
  for (const value of [null, undefined, false, [], "fixture"]) {
    const changed = copy();
    changed.appMonitoring = value;
    assert.throws(() => validatePreview(changed, product, options), /plain object/);
  }
});

test("app monitoring exact contract preserves observed metrics and sorts copied logs newest first", () => {
  for (const fixture of fixtures) {
    const raw = fixture.appMonitoring;
    const summary = summarizePreview(fixture, options).appMonitoring;
    onlyKeys(summary, ["window", "baselineWindow", "requests", "operations", "logs", "errorEvents", "warningEvents", "slowOperationCount", "availability", "concern"]);
    onlyKeys(summary.requests, [...Object.keys(raw.requests), "failureRate", "baselineFailureRate", "failureDeltaPp", "p95ChangePct"]);
    onlyKeys(summary.concern, ["title", "evidence", "recommendation"]);
    assert.deepEqual(summary.window, fixture.monitoring.window);
    assert.deepEqual(summary.baselineWindow, fixture.monitoring.baselineWindow);
    assert.equal(summary.operations.length, 4);
    assert.equal(summary.logs.length, 6);
    for (const field of Object.keys(raw.requests)) assert.equal(summary.requests[field], raw.requests[field]);
    summary.operations.forEach((operation, index) => {
      onlyKeys(operation, [...Object.keys(raw.operations[index]), "atRisk"]);
      for (const field of Object.keys(raw.operations[index])) assert.equal(operation[field], raw.operations[index][field]);
    });
    assert.deepEqual(summary.logs, [...raw.logs].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)));
    assert.deepEqual(summary.logs.map((log) => log.timestamp.slice(11, 16)), ["05:50", "05:40", "05:20", "04:00", "03:40", "02:10"]);
    assert.ok(summary.logs.some((log) => log.severity === "error" && log.kind === "exception"));
    assert.ok(summary.logs.some((log) => log.severity === "warning" && log.kind === "trace"));
    assert.ok(summary.logs.some((log) => log.severity === "warning" && log.kind === "dependency"));
    assert.ok(summary.logs.some((log) => log.severity === "information" && /recover/i.test(log.message)));
    assert.ok(summary.logs.every((log) => log.message.startsWith("Synthetic")));
    assert.doesNotMatch(JSON.stringify(raw), /https?:\/\/|stackTrace|resourceId|pageId|apiKey|password/i);
  }
});

test("app monitoring exact totals separate grouped log events from request failures and slow operations", () => {
  const expected = [
    { fixture: zava, rates: [3, 2, 1, 37.5], totals: [115, 150, 2], risks: [true, true, true, false], sampled: [10000, 340] },
    { fixture: contoso, rates: [2, 3, -1, -25], totals: [55, 100, 2], risks: [true, true, true, true], sampled: [7000, 155] },
  ];
  for (const { fixture, rates, totals, risks, sampled } of expected) {
    const summary = summarizePreview(fixture, options).appMonitoring;
    assert.deepEqual(["failureRate", "baselineFailureRate", "failureDeltaPp", "p95ChangePct"].map((field) => summary.requests[field]), rates);
    assert.deepEqual([summary.errorEvents, summary.warningEvents, summary.slowOperationCount], totals);
    assert.deepEqual(summary.operations.map((operation) => operation.atRisk), risks);
    assert.deepEqual(["requests", "failed"].map((field) => summary.operations.reduce((total, operation) => total + operation[field], 0)), sampled);
    assert.notEqual(summary.errorEvents, summary.requests.failed);
    assert.notEqual(summary.warningEvents, summary.requests.failed);
    assert.notEqual(summary.errorEvents + summary.warningEvents, summary.requests.failed);
  }
});

test("app concern cites actual failed requests, operation performance and named grouped log observations", () => {
  const summary = summarizePreview(zava, options).appMonitoring;
  assert.equal(summary.concern.evidence[0], "Application requests: 360/12000 failed requests (3%); baseline 200/10000 (2%; change 1 percentage points); observed p95 2200 ms (target 1800 ms); baseline observed p95 1600 ms; change 37.5%.");
  assert.equal(summary.concern.evidence[1], "Submit checkout: 200/4000 failed requests; observed p95 2400 ms (target 1800 ms).");
  assert.equal(summary.concern.evidence.length, 9);
  assert.ok(summary.concern.evidence.includes("Read delivery status: 30 warning events in grouped dependency observation at 2026-09-24T05:20:00Z: Synthetic dependency observation: delivery status lookup used a cached response after a timeout."));
  for (const log of summary.logs.filter((log) => log.severity !== "information")) {
    assert.ok(summary.concern.evidence.some((line) => line.includes(log.message) && line.includes(log.operation) && line.includes(`${log.occurrences} ${log.severity} events`)));
  }
  assert.match(summary.concern.recommendation, /engineering/);
  assert.match(summary.concern.recommendation, /not proof of causality/);
  assert.match(summary.concern.recommendation, /may overlap/);
  assert.match(summary.concern.recommendation, /not combined incidents or counts of failed requests/);
  assert.doesNotMatch(JSON.stringify(summary), /readiness|ready|healthy|incidentCount/);
  const improved = summarizePreview(contoso, options).appMonitoring;
  assert.match(improved.concern.evidence[0], /change -1 percentage points/);
  assert.match(improved.concern.evidence[0], /change -25%/);
});

test("app zero traffic requires null latency and produces unknown rates and comparisons", () => {
  const changed = copy();
  noAppTraffic(changed.appMonitoring);
  assert.equal(validatePreview(changed, product, options), changed);
  const summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.requests.p95Ms, null);
  assert.equal(summary.requests.baselineP95Ms, null);
  for (const field of ["failureRate", "baselineFailureRate", "failureDeltaPp", "p95ChangePct"]) {
    assert.equal(summary.requests[field], null);
  }
  assert.ok(summary.operations.every((operation) => operation.p95Ms === null && !operation.atRisk));
  assert.deepEqual([summary.errorEvents, summary.warningEvents, summary.slowOperationCount], [0, 0, 0]);
  assert.equal(summary.concern, null);
  changed.appMonitoring.operations = [];
  assert.deepEqual(summarizePreview(changed, options).appMonitoring.operations, []);
});

test("app no current traffic does not reuse baseline rates and independent logs remain observations", () => {
  const changed = copy();
  noAppTraffic(changed.appMonitoring, { baseline: false, logs: false });
  const summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.requests.failureRate, null);
  assert.equal(summary.requests.baselineFailureRate, 2);
  assert.equal(summary.requests.failureDeltaPp, null);
  assert.equal(summary.requests.p95ChangePct, null);
  assert.equal(summary.errorEvents, 115);
  assert.equal(summary.warningEvents, 150);
  assert.equal(summary.concern.evidence.length, 4);
  assert.ok(summary.concern.evidence.every((line) => line.includes("events in grouped")));
});

test("app absent baseline traffic or zero baseline latency leaves comparison unknown", () => {
  const changed = copy();
  Object.assign(changed.appMonitoring.requests, { baselineTotal: 0, baselineFailed: 0, baselineP95Ms: null });
  let summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.requests.failureRate, 3);
  assert.equal(summary.requests.baselineFailureRate, null);
  assert.equal(summary.requests.failureDeltaPp, null);
  assert.equal(summary.requests.p95ChangePct, null);
  assert.match(summary.concern.evidence[0], /baseline failure rate unknown \(0 requests\)/);
  assert.match(summary.concern.evidence[0], /p95 percentage comparison unavailable/);
  assert.doesNotMatch(JSON.stringify(summary), /NaN|Infinity/);
  Object.assign(changed.appMonitoring.requests, { baselineTotal: 100, baselineFailed: 0, baselineP95Ms: 0 });
  summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.requests.baselineFailureRate, 0);
  assert.equal(summary.requests.failureDeltaPp, 3);
  assert.equal(summary.requests.p95ChangePct, null);
});

test("app risk is failed requests or target latency miss; equality is not slow", () => {
  const changed = copy();
  const app = changed.appMonitoring;
  delete app.availability;
  app.logs = [];
  app.operations = [app.operations[0]];
  app.requests.failed = 0;
  app.requests.p95Ms = 1000;
  app.operations[0].failed = 0;
  app.operations[0].p95Ms = app.operations[0].targetP95Ms;
  let summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.slowOperationCount, 0);
  assert.equal(summary.operations[0].atRisk, false);
  assert.equal(summary.concern, null);
  app.operations[0].p95Ms += 0.5;
  summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.slowOperationCount, 1);
  assert.equal(summary.operations[0].atRisk, true);
  assert.equal(summary.concern.evidence.length, 1);
  app.operations[0].p95Ms = 1000;
  app.operations[0].failed = 1;
  app.requests.failed = 1;
  summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.slowOperationCount, 0);
  assert.equal(summary.operations[0].atRisk, true);
});

test("aggregate app p95 remains observed, and within-target slowdown is still a concern", () => {
  const changed = copy();
  const app = changed.appMonitoring;
  app.logs = [];
  app.operations = [];
  Object.assign(app.requests, { failed: 0, p95Ms: 1700, targetP95Ms: 1800 });
  const summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.requests.p95Ms, 1700);
  assert.equal(summary.requests.p95ChangePct, 6.25);
  assert.equal(summary.slowOperationCount, 0);
  assert.match(summary.concern.evidence[0], /observed p95 1700 ms/);
});

test("app grouped events can exceed requests without being counted as request failures", () => {
  const changed = copy();
  changed.appMonitoring.logs[1].occurrences = 20000;
  const summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.errorEvents, 20045);
  assert.equal(summary.requests.failed, 360);
  assert.equal(summary.requests.failureRate, 3);
});

test("app validation rejects unknown and missing keys at every new object level", () => {
  for (const locate of [
    (snapshot) => snapshot.appMonitoring,
    (snapshot) => snapshot.appMonitoring.requests,
    (snapshot) => snapshot.appMonitoring.window,
    (snapshot) => snapshot.appMonitoring.baselineWindow,
    (snapshot) => snapshot.appMonitoring.operations[0],
    (snapshot) => snapshot.appMonitoring.logs[0],
  ]) {
    for (const mutate of [
      (value) => { value.url = "not allowed"; },
      (value) => { delete value[Object.keys(value).find((key) => key !== "availability")]; },
      (value) => { value[Symbol("hidden")] = 1; },
      (value) => { Object.defineProperty(value, "resourceId", { value: "not allowed" }); },
    ]) {
      const changed = copy();
      mutate(locate(changed));
      assert.throws(() => validatePreview(changed, product, options), /exactly/);
    }
  }
});

test("app counts, latency values, nullability and safe aggregate bounds are strict", () => {
  for (const locate of [
    (app) => [app.requests, ["total", "failed", "baselineTotal", "baselineFailed"]],
    (app) => [app.operations[0], ["requests", "failed"]],
    (app) => [app.logs[0], ["occurrences"]],
  ]) {
    for (const invalid of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
      const sample = copy();
      const [, fields] = locate(sample.appMonitoring);
      for (const field of fields) {
        const changed = copy();
        locate(changed.appMonitoring)[0][field] = invalid;
        assert.throws(() => validatePreview(changed, product, options), /safe integer/);
      }
    }
  }
  for (const locate of [
    (app) => [app.requests, ["p95Ms", "baselineP95Ms", "targetP95Ms"]],
    (app) => [app.operations[0], ["p95Ms", "targetP95Ms"]],
  ]) {
    for (const invalid of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
      const [, fields] = locate(copy().appMonitoring);
      for (const field of fields) {
        const changed = copy();
        locate(changed.appMonitoring)[0][field] = invalid;
        assert.throws(() => validatePreview(changed, product, options), /milliseconds/);
      }
    }
  }
  for (const mutate of [
    (app) => { app.requests.failed = app.requests.total + 1; },
    (app) => { app.requests.baselineFailed = app.requests.baselineTotal + 1; },
    (app) => { app.operations[0].failed = app.operations[0].requests + 1; },
    (app) => { app.requests.targetP95Ms = 0; },
    (app) => { app.operations[0].targetP95Ms = 0; },
    (app) => { app.logs[0].occurrences = 0; },
    (app) => { app.logs[1].occurrences = Number.MAX_SAFE_INTEGER; },
    (app) => { app.requests.baselineP95Ms = Number.MIN_VALUE; },
    (app) => { noAppTraffic(app); app.requests.p95Ms = 0; },
    (app) => { noAppTraffic(app); app.requests.baselineP95Ms = 0; },
    (app) => { noAppTraffic(app); app.operations[0].p95Ms = 0; },
  ]) {
    const changed = copy();
    mutate(changed.appMonitoring);
    assert.throws(() => validatePreview(changed, product, options));
  }
});

test("app non-overlapping operation subsets fit aggregate requests, failures and successes", () => {
  for (const mutate of [
    (app) => { app.operations[0].requests = app.requests.total; },
    (app) => { app.requests.failed = 339; },
    (app) => { app.requests.failed = 11000; },
    (app) => { app.operations[0].requests = Number.MAX_SAFE_INTEGER; },
  ]) {
    const changed = copy();
    mutate(changed.appMonitoring);
    assert.throws(() => validatePreview(changed, product, options), /subsets|safe integer/);
  }
  const changed = copy();
  Object.assign(changed.appMonitoring.requests, { total: 10000, failed: 340 });
  assert.equal(validatePreview(changed, product, options), changed);
});

test("app sample keys, operation names, log references, enums and bounded text are validated", () => {
  for (const mutate of [
    (snapshot) => { snapshot.appMonitoring.operations[0].localKey = snapshot.stories[0].localKey; },
    (snapshot) => { snapshot.appMonitoring.logs[0].localKey = snapshot.monitoring.journeys[0].localKey; },
    (snapshot) => { snapshot.appMonitoring.logs[0].localKey = snapshot.appMonitoring.operations[0].localKey; },
    (snapshot) => { snapshot.appMonitoring.operations[0].localKey = "remote-operation"; },
    (snapshot) => { snapshot.appMonitoring.logs[0].localKey = "1234"; },
    (snapshot) => { snapshot.appMonitoring.operations[1].name = snapshot.appMonitoring.operations[0].name; },
    (snapshot) => { snapshot.appMonitoring.operations[1].name = ` ${snapshot.appMonitoring.operations[0].name.toUpperCase()} `; },
    (snapshot) => { snapshot.appMonitoring.operations[0].name = ""; },
    (snapshot) => { snapshot.appMonitoring.operations[0].name = "a".repeat(501); },
    (snapshot) => { snapshot.appMonitoring.logs[0].operation = "not a sampled operation"; },
    (snapshot) => { snapshot.appMonitoring.logs[0].severity = "critical"; },
    (snapshot) => { snapshot.appMonitoring.logs[0].kind = "request"; },
    (snapshot) => { snapshot.appMonitoring.logs[0].message = " "; },
    (snapshot) => { snapshot.appMonitoring.logs[0].message = 1; },
    (snapshot) => { snapshot.appMonitoring.logs[0].message = "a".repeat(2001); },
  ]) {
    const changed = copy();
    mutate(changed);
    assert.throws(() => validatePreview(changed, product, options));
    assert.throws(() => summarizePreview(changed, options));
  }
});

test("app logs use current half-open window, valid ISO timestamps and matching adjacent baselines", () => {
  for (const value of ["2026-02-30T05:00:00Z", "2026-09-24", "2026-09-24T01:00:00+00:00", "2026-09-24T25:00:00Z", null,
    "2026-09-23T05:59:59.999Z", "2026-09-24T06:00:00Z", "2026-09-24T08:00:00Z"]) {
    const changed = copy();
    changed.appMonitoring.logs[0].timestamp = value;
    assert.throws(() => validatePreview(changed, product, options));
  }
  for (const value of ["2026-09-23T06:00:00Z", "2026-09-24T05:59:59.999Z"]) {
    const changed = copy();
    changed.appMonitoring.logs[0].timestamp = value;
    assert.equal(validatePreview(changed, product, options), changed);
  }
  for (const mutate of [
    (app) => { app.window.start = "2026-02-30T06:00:00Z"; },
    (app) => { app.window.end = "2026-09-25T06:00:00Z"; },
    (app) => { app.baselineWindow.end = "2026-09-23T05:00:00Z"; },
    (app) => { app.baselineWindow.start = "2026-09-22T05:00:00Z"; },
    (app) => { app.window.start = app.window.end; },
    (app) => {
      app.window = { start: "2026-09-23T05:00:00Z", end: "2026-09-24T05:00:00Z" };
      app.baselineWindow = { start: "2026-09-22T05:00:00Z", end: "2026-09-23T05:00:00Z" };
    },
  ]) {
    const changed = copy();
    mutate(changed.appMonitoring);
    assert.throws(() => validatePreview(changed, product, options), /window|Window|valid date/);
  }
});

test("app lists reject malformed containers, oversized arrays, holes and duplicate local keys", () => {
  for (const mutate of [
    (app) => { app.operations = {}; },
    (app) => { app.logs = null; },
    (app) => { app.operations = Array(101).fill(app.operations[0]); },
    (app) => { app.logs = Array(1001).fill(app.logs[0]); },
    (app) => { delete app.operations[0]; },
    (app) => { delete app.logs[0]; },
    (app) => { app.operations.push({ ...app.operations[0] }); },
    (app) => { app.logs.push({ ...app.logs[0] }); },
    (app) => { app.operations[0] = null; },
    (app) => { app.logs[0] = []; },
    (app) => { app.requests = new Date(); },
  ]) {
    const changed = copy();
    mutate(changed.appMonitoring);
    assert.throws(() => validatePreview(changed, product, options));
  }
});

test("every combination of optional preview sections remains backward compatible", () => {
  const optional = ["appMonitoring", "adoption", "support", "business"];
  const original = summarizePreview(zava, options);
  for (let mask = 0; mask < 16; mask++) {
    const changed = copy();
    optional.forEach((field, index) => { if (mask & (1 << index)) delete changed[field]; });
    assert.equal(validatePreview(changed, product, options), changed);
    const summary = summarizePreview(changed, options);
    onlyKeys(summary, summaryKeys);
    optional.forEach((field, index) => assert.deepEqual(summary[field], mask & (1 << index) ? null : original[field]));
    assert.deepEqual(summary.monitoring, original.monitoring);
    assert.deepEqual(summary.stories, original.stories);
    assert.equal(summary.fetchedAt, original.fetchedAt);
    assert.deepEqual(summary.sourceUrls, original.sourceUrls);
  }
});

test("adoption, support and business summary shapes preserve all authored raw fields", () => {
  for (const fixture of fixtures) {
    const summary = summarizePreview(fixture, options);
    onlyKeys(summary.adoption, [...Object.keys(fixture.adoption), "activeUserChangePct", "activationRate", "retentionRate", "belowTargetCount", "concern"]);
    onlyKeys(summary.support, [...Object.keys(fixture.support), "totalCases", "openCases", "escalatedCases", "oldestOpenDays", "themes", "concern"]);
    onlyKeys(summary.business, [...Object.keys(fixture.business), "offTargetCount", "onTargetCount", "unknownCount", "concern"]);
    for (const field of ["definitions", "activation", "retention", "window", "baselineWindow"]) {
      assert.deepEqual(summary.adoption[field], fixture.adoption[field]);
    }
    for (const field of ["provider", "sourceUrl", "window", "baselineWindow", "scopeNote"]) {
      assert.deepEqual(summary.business[field], fixture.business[field]);
    }
    for (const field of ["provider", "sourceUrl", "asOf"]) assert.equal(summary.support[field], fixture.support[field]);
    for (const [raw, derived, additions] of [
      [fixture.adoption.features, summary.adoption.features, ["adoptionRate", "belowTarget"]],
      [fixture.adoption.outcomes, summary.adoption.outcomes, ["change", "meetsTarget"]],
      [fixture.support.cases, summary.support.cases, ["ageDays"]],
      [fixture.business.metrics, summary.business.metrics, ["change", "changePct", "meetsTarget"]],
    ]) {
      derived.forEach((item, index) => {
        onlyKeys(item, [...Object.keys(raw[index]), ...additions]);
        for (const key of Object.keys(raw[index])) assert.deepEqual(item[key], raw[index][key]);
      });
    }
    for (const section of [summary.adoption, summary.support, summary.business]) {
      if (section.concern !== null) {
        onlyKeys(section.concern, ["title", "evidence", "recommendation"]);
        assert.ok(section.concern.evidence.every((item) => typeof item === "string"));
      }
    }
    summary.support.themes.forEach((theme) => onlyKeys(theme, ["name", "openCases"]));
    assert.equal(summary.adoption.features.length, 3);
    assert.equal(summary.adoption.outcomes.length, 2);
    assert.equal(summary.support.cases.length, 7);
    assert.equal(summary.business.metrics.length, 4);
    assert.deepEqual(fixture.adoption.window, { start: "2026-09-17T06:00:00Z", end: "2026-09-24T06:00:00Z" });
    assert.deepEqual(fixture.adoption.baselineWindow, { start: "2026-09-10T06:00:00Z", end: "2026-09-17T06:00:00Z" });
    assert.deepEqual(fixture.business.window, fixture.adoption.window);
    assert.deepEqual(fixture.business.baselineWindow, fixture.adoption.baselineWindow);
    assert.equal(fixture.support.asOf, fixture.fetchedAt);
    assert.equal(fixture.support.sourceUrl, null);
    assert.equal(fixture.business.sourceUrl, null);
    assert.match(fixture.adoption.definitions.retention, /baseline-period.*current period/);
    assert.match(fixture.adoption.definitions.activation, /New eligible.*first value/);
    assert.match(fixture.business.scopeNote, /authored.*fictional/);
    assert.doesNotMatch(JSON.stringify([fixture.adoption, fixture.support, fixture.business]), /https?:\/\/|customerId|ticketId|reportId/);
  }
});

test("adoption derives exact user-cohort rates and directional outcomes, never request success metrics", () => {
  const expected = [
    { fixture: zava, rates: [20, 60, 70], features: [[600 / 900 * 100, false], [70, false], [60, false]], below: 0, outcomes: [[-2, true], [10, true]] },
    { fixture: contoso, rates: [20, 70, 75], features: [[70, false], [65, false], [80, false]], below: 0, outcomes: [[-4, true], [5, true]] },
  ];
  for (const { fixture, rates, features, below, outcomes } of expected) {
    const summary = summarizePreview(fixture, options).adoption;
    assert.deepEqual([summary.activeUserChangePct, summary.activationRate, summary.retentionRate], rates);
    assert.deepEqual(summary.features.map((feature) => [feature.adoptionRate, feature.belowTarget]), features);
    assert.equal(summary.belowTargetCount, below);
    assert.deepEqual(summary.outcomes.map((outcome) => [outcome.change, outcome.meetsTarget]), outcomes);
    assert.doesNotMatch(JSON.stringify(summary), /attempts|successRate|p95Ms|healthy|readiness/);
  }
  const changed = copy();
  changed.monitoring.journeys.forEach((journey) => { zeroCurrent(journey); zeroBaseline(journey); });
  noAppTraffic(changed.appMonitoring);
  assert.deepEqual(summarizePreview(changed, options).adoption, summarizePreview(zava, options).adoption);
});

test("adoption evidence names actual feature denominators and independently sampled product outcomes", () => {
  const changed = copy();
  changed.adoption.features[0].adoptedUsers = 360;
  changed.adoption.features[2].adoptedUsers = 400;
  changed.adoption.outcomes[1].current = 72;
  const concern = summarizePreview(changed, options).adoption.concern;
  assert.deepEqual(concern.evidence, [
    "Express purchase setup: 360/900 eligible users adopted the feature (40%; target 60%).",
    "Saved baskets: 400/800 eligible users adopted the feature (50%; target 55%).",
    "Sampled basket-to-order completion: sampled current value 72 percent; target 75 (increase); baseline 68 percent.",
  ]);
  assert.match(concern.recommendation, /Do not sum distinct users across features/);
  assert.match(concern.recommendation, /independently sampled outcomes/);
  assert.match(concern.recommendation, /do not establish causality/);
  changed.adoption.baselineActiveUsers = 1500;
  const summary = summarizePreview(changed, options).adoption;
  assert.equal(summary.activeUserChangePct, -20);
  assert.equal(summary.concern.evidence[0], "Active users: 1200 in the current period versus 1500 in the baseline (-20% change).");
});

test("adoption allows overlapping feature users and inactive eligible users without changing denominators", () => {
  const changed = copy();
  changed.adoption.activation.eligibleUsers = 2000;
  changed.adoption.features.forEach((feature) => {
    feature.eligibleUsers = 2000;
    feature.adoptedUsers = 1000;
  });
  const summary = summarizePreview(changed, options).adoption;
  assert.equal(summary.activationRate, 9);
  assert.ok(summary.features.every((feature) => feature.adoptionRate === 50));
  assert.equal(summary.activeUsers, 1200);
  assert.equal(summary.features.reduce((total, feature) => total + feature.adoptedUsers, 0), 3000);
  assert.equal(Object.hasOwn(summary, "totalAdoptedUsers"), false);
});

test("adoption zero denominators and missing baseline preserve unknown values rather than zero rates", () => {
  const changed = copy();
  const adoption = changed.adoption;
  adoption.activeUsers = 0;
  adoption.baselineActiveUsers = 0;
  adoption.activation = { eligibleUsers: 0, activatedUsers: 0 };
  adoption.retention = { cohortUsers: 0, returningUsers: 0 };
  adoption.features.forEach((feature) => { feature.eligibleUsers = 0; feature.adoptedUsers = 0; });
  adoption.outcomes.forEach((outcome) => { outcome.current = null; outcome.baseline = null; });
  const summary = summarizePreview(changed, options).adoption;
  assert.deepEqual([summary.activeUserChangePct, summary.activationRate, summary.retentionRate], [null, null, null]);
  assert.equal(summary.belowTargetCount, 0);
  assert.equal(summary.concern, null);
  assert.ok(summary.features.every((feature) => feature.adoptionRate === null && feature.belowTarget === false));
  assert.ok(summary.outcomes.every((outcome) => outcome.change === null && outcome.meetsTarget === null));
  adoption.activeUsers = 10;
  adoption.activation = { eligibleUsers: 20, activatedUsers: 0 };
  assert.equal(summarizePreview(changed, options).adoption.activationRate, 0);
  assert.equal(summarizePreview(changed, options).adoption.activeUserChangePct, null);
});

test("adoption equality meets targets, outcome baseline null does not prevent current target assessment", () => {
  const changed = copy();
  const adoption = changed.adoption;
  adoption.features[0].targetRate = 600 / 900 * 100;
  adoption.outcomes[0].baseline = null;
  adoption.outcomes[1].current = null;
  const summary = summarizePreview(changed, options).adoption;
  assert.equal(summary.features[0].belowTarget, false);
  assert.equal(summary.outcomes[0].change, null);
  assert.equal(summary.outcomes[0].meetsTarget, true);
  assert.equal(summary.outcomes[1].change, null);
  assert.equal(summary.outcomes[1].meetsTarget, null);
});

test("support exact authored case totals, unresolved escalations, whole-day ages and theme counts", () => {
  for (const [fixture, ages, oldest, themes] of [
    [zava, [5, 3, 7, 2, 1, 8, 9], 7, [{ name: "Delivery", openCases: 2 }, { name: "Payments", openCases: 2 }, { name: "Checkout", openCases: 1 }]],
    [contoso, [6, 4, 8, 2, 1, 7, 10], 8, [{ name: "Contact import", openCases: 2 }, { name: "Follow-ups", openCases: 1 }, { name: "Onboarding", openCases: 1 }, { name: "Search", openCases: 1 }]],
  ]) {
    const summary = summarizePreview(fixture, options).support;
    assert.deepEqual([summary.totalCases, summary.openCases, summary.escalatedCases, summary.oldestOpenDays], [7, 5, 2, oldest]);
    assert.deepEqual(summary.cases.map((item) => item.ageDays), ages);
    assert.deepEqual(summary.themes, themes);
    assert.equal(summary.cases.filter((item) => item.status === "resolved").length, 2);
    assert.equal(summary.cases.filter((item) => item.escalated).length, 3);
    assert.equal(summary.themes.reduce((total, theme) => total + theme.openCases, 0), summary.openCases);
    assert.equal(summary.concern.evidence.length, 5);
    for (const item of summary.cases.filter((item) => item.status !== "resolved")) {
      assert.ok(summary.concern.evidence.some((line) => line.startsWith(`${item.title}:`) && line.includes(`${item.ageDays} elapsed days`) && line.includes(item.theme)));
    }
    assert.match(summary.concern.recommendation, /not distinct customers, incidents, SLA breaches/);
    assert.match(summary.concern.recommendation, /entire Zendesk account/);
  }
});

test("support ages are floored elapsed days at fixed asOf, independent of current time and updates", () => {
  const changed = copy();
  changed.support.cases[0].createdAt = "2026-09-23T06:00:00.001Z";
  changed.support.cases[0].updatedAt = "2026-09-24T05:00:00Z";
  const before = summarizePreview(changed, options).support;
  assert.equal(before.cases[0].ageDays, 0);
  assert.deepEqual(summarizePreview(changed, { now: now + 30 * 86_400_000 }).support, before);
  changed.support.cases[0].createdAt = "2026-09-23T06:00:00Z";
  assert.equal(summarizePreview(changed, options).support.cases[0].ageDays, 1);
  changed.support.cases[0].createdAt = changed.support.asOf;
  changed.support.cases[0].updatedAt = changed.support.asOf;
  assert.equal(summarizePreview(changed, options).support.cases[0].ageDays, 0);
});

test("support empty or fully resolved samples do not count old escalations as open", () => {
  const changed = copy();
  changed.support.cases.forEach((item) => { item.status = "resolved"; item.escalated = true; });
  let summary = summarizePreview(changed, options).support;
  assert.deepEqual([summary.totalCases, summary.openCases, summary.escalatedCases, summary.oldestOpenDays], [7, 0, 0, null]);
  assert.deepEqual(summary.themes, []);
  assert.equal(summary.concern, null);
  changed.support.cases = [];
  summary = summarizePreview(changed, options).support;
  assert.deepEqual([summary.totalCases, summary.openCases, summary.escalatedCases, summary.oldestOpenDays], [0, 0, 0, null]);
  assert.deepEqual(summary.themes, []);
  assert.equal(summary.concern, null);
});

test("business exact absolute and relative changes remain distinct for percentages", () => {
  for (const [fixture, values] of [
    [zava, [[12000, 12, true], [200, 20, true], [-10, -25, true], [16, 20, true]]],
    [contoso, [[8000, 5, true], [40, 20, true], [-6, -25, true], [12, 15, true]]],
  ]) {
    const summary = summarizePreview(fixture, options).business;
    assert.deepEqual(summary.metrics.map((metric) => [metric.change, metric.changePct, metric.meetsTarget]), values);
    assert.deepEqual([summary.offTargetCount, summary.onTargetCount, summary.unknownCount], [0, 4, 0]);
    assert.equal(summary.concern, null);
  }
});

test("business concerns still derive from true target misses rather than being masked for the demo", () => {
  for (const fixture of fixtures) {
    const changed = structuredClone(fixture);
    changed.business.metrics[0].current = 0;
    changed.business.metrics[3].current = 0;
    const summary = summarizePreview(changed, options).business;
    assert.deepEqual([summary.offTargetCount, summary.onTargetCount, summary.unknownCount], [2, 2, 0]);
    assert.equal(summary.concern.evidence.length, 2);
    for (const metric of summary.metrics.filter((metric) => metric.meetsTarget === false)) {
      assert.ok(summary.concern.evidence.some((line) => line.includes(metric.name) && line.includes(`${metric.current} ${metric.unit}`) && line.includes(metric.definition)));
    }
    assert.match(summary.concern.recommendation, /do not attribute.*application bugs/);
    assert.match(summary.concern.recommendation, /assume causality/);
  }
});

test("business nulls are unknown, zero baseline prevents percent comparison and equality meets both directions", () => {
  const changed = copy();
  const metrics = changed.business.metrics;
  metrics[0].current = null;
  metrics[1].baseline = null;
  metrics[1].target = metrics[1].current;
  metrics[2].baseline = 0;
  metrics[2].target = metrics[2].current;
  metrics[3].current = 0;
  metrics[3].baseline = 0;
  metrics[3].target = 0;
  const summary = summarizePreview(changed, options).business;
  assert.deepEqual(summary.metrics.map((metric) => [metric.change, metric.changePct, metric.meetsTarget]), [
    [null, null, null], [null, null, true], [30, null, true], [0, null, true],
  ]);
  assert.deepEqual([summary.offTargetCount, summary.onTargetCount, summary.unknownCount], [0, 3, 1]);
  assert.equal(summary.concern, null);
});

test("empty metric and feature arrays produce no assessments and retain scope definitions", () => {
  const changed = copy();
  changed.adoption.features = [];
  changed.adoption.outcomes = [];
  changed.business.metrics = [];
  const summary = summarizePreview(changed, options);
  assert.equal(summary.adoption.belowTargetCount, 0);
  assert.equal(summary.adoption.concern, null);
  assert.deepEqual([summary.business.offTargetCount, summary.business.onTargetCount, summary.business.unknownCount], [0, 0, 0]);
  assert.equal(summary.business.concern, null);
  assert.equal(summary.business.scopeNote, zava.business.scopeNote);
  assert.deepEqual(summary.adoption.definitions, zava.adoption.definitions);
});

test("new sections remain product-specific without source links or source identifiers", () => {
  const summaries = fixtures.map((fixture) => summarizePreview(fixture, options));
  const zavaSections = JSON.stringify([summaries[0].adoption, summaries[0].support, summaries[0].business]);
  const contosoSections = JSON.stringify([summaries[1].adoption, summaries[1].support, summaries[1].business]);
  assert.doesNotMatch(zavaSections, /contoso|qualified leads|contact import/i);
  assert.doesNotMatch(contosoSections, /zava|checkout|payment/i);
  for (const fixture of fixtures) {
    const all = [...fixture.adoption.features, ...fixture.adoption.outcomes, ...fixture.support.cases, ...fixture.business.metrics];
    assert.ok(all.every((item) => item.localKey.startsWith(fixture.productId === "zava-shop" ? "sample-zava-" : "sample-contoso-")));
    assert.equal(new Set(all.map((item) => item.localKey)).size, all.length);
  }
  assert.throws(() => validatePreview(zava, { id: "contoso-crm" }, options), /product/);
});

test("new optional blocks must be complete objects and cannot change fixture provenance", () => {
  for (const field of ["adoption", "support", "business"]) {
    for (const value of [null, undefined, 1, false, [], new Date()]) {
      const changed = copy();
      changed[field] = value;
      assert.throws(() => validatePreview(changed, product, options));
    }
  }
  for (const mutate of [
    (snapshot) => { snapshot.mode = "live"; },
    (snapshot) => { snapshot.support.provider = "zendesk"; },
    (snapshot) => { snapshot.business.provider = "PowerBI"; },
    (snapshot) => { snapshot.support.sourceUrl = ""; },
    (snapshot) => { snapshot.business.sourceUrl = "https://example.invalid"; },
    (snapshot) => { snapshot.sourceUrls.zendesk = null; },
    (snapshot) => { snapshot.sourceUrls.powerBi = null; },
    (snapshot) => { snapshot.adoption.productId = "contoso-crm"; },
  ]) {
    const changed = copy();
    mutate(changed);
    assert.throws(() => validatePreview(changed, product, options));
    assert.throws(() => summarizePreview(changed, options));
  }
});

test("strict new nested shapes reject extra, hidden and missing fields", () => {
  for (const locate of [
    (s) => s.adoption, (s) => s.adoption.window, (s) => s.adoption.baselineWindow,
    (s) => s.adoption.definitions, (s) => s.adoption.activation, (s) => s.adoption.retention,
    (s) => s.adoption.features[0], (s) => s.adoption.outcomes[0],
    (s) => s.support, (s) => s.support.cases[0],
    (s) => s.business, (s) => s.business.window, (s) => s.business.baselineWindow, (s) => s.business.metrics[0],
  ]) {
    for (const mutate of [
      (item) => { item.remoteId = "not allowed"; },
      (item) => { delete item[Object.keys(item)[0]]; },
      (item) => { Object.defineProperty(item, "extra", { value: 1 }); },
      (item) => { item[Symbol("extra")] = 1; },
    ]) {
      const changed = copy();
      mutate(locate(changed));
      assert.throws(() => validatePreview(changed, product, options), /exactly/);
    }
  }
});

test("adoption cohort counts reject malformed values, impossible numerators and impossible baseline cohorts", () => {
  for (const [locate, fields] of [
    [(s) => s.adoption, ["activeUsers", "baselineActiveUsers"]],
    [(s) => s.adoption.activation, ["eligibleUsers", "activatedUsers"]],
    [(s) => s.adoption.retention, ["cohortUsers", "returningUsers"]],
    [(s) => s.adoption.features[0], ["eligibleUsers", "adoptedUsers"]],
  ]) {
    for (const field of fields) {
      for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, "1"]) {
        const changed = copy();
        locate(changed)[field] = value;
        assert.throws(() => validatePreview(changed, product, options), /safe integer/);
      }
    }
  }
  for (const mutate of [
    (a) => { a.activation.activatedUsers = a.activation.eligibleUsers + 1; },
    (a) => { a.activation.eligibleUsers = 2000; a.activation.activatedUsers = a.activeUsers + 1; },
    (a) => { a.retention.returningUsers = a.retention.cohortUsers + 1; },
    (a) => { a.activeUsers = 500; },
    (a) => { a.retention.cohortUsers = a.baselineActiveUsers + 1; },
    (a) => { a.features[0].adoptedUsers = a.features[0].eligibleUsers + 1; },
    (a) => { a.features[0].eligibleUsers = 2000; a.features[0].adoptedUsers = a.activeUsers + 1; },
  ]) {
    const changed = copy();
    mutate(changed.adoption);
    assert.throws(() => validatePreview(changed, product, options), /numerator|cohort/);
  }
});

test("metric units, directions, targets, nullable values and percent/count bounds are validated", () => {
  for (const locate of [(s) => s.adoption.outcomes[0], (s) => s.business.metrics[0]]) {
    for (const field of ["current", "baseline", "target"]) {
      for (const value of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1", false]) {
        const changed = copy();
        locate(changed)[field] = value;
        assert.throws(() => validatePreview(changed, product, options), /finite non-negative/);
      }
    }
    for (const mutate of [
      (item) => { item.target = null; },
      (item) => { item.unit = "seconds"; },
      (item) => { item.direction = "up"; },
      (item) => { item.unit = "count"; item.current = 1.5; },
      (item) => { item.unit = "percent"; item.current = 101; },
      (item) => { item.unit = "percent"; item.current = 1; item.baseline = 101; },
      (item) => { item.unit = "percent"; item.current = 1; item.baseline = 1; item.target = 101; },
    ]) {
      const changed = copy();
      mutate(locate(changed));
      assert.throws(() => validatePreview(changed, product, options));
    }
  }
  for (const value of [-1, 100.01, Infinity, NaN, null, "50"]) {
    const changed = copy();
    changed.adoption.features[0].targetRate = value;
    assert.throws(() => validatePreview(changed, product, options));
  }
  const overflow = copy();
  overflow.business.metrics[0].baseline = Number.MIN_VALUE;
  assert.throws(() => validatePreview(overflow, product, options), /finite/);
  const wrongAdoptionUnit = copy();
  wrongAdoptionUnit.adoption.outcomes[0].unit = "hours";
  assert.throws(() => validatePreview(wrongAdoptionUnit, product, options), /unit/);
  const wrongBusinessUnit = copy();
  wrongBusinessUnit.business.metrics[0].unit = "minutes";
  assert.throws(() => validatePreview(wrongBusinessUnit, product, options), /unit/);
});

test("valid metric edges include percentage endpoints, zero targets, nullable baselines and fractional measures", () => {
  const changed = copy();
  changed.adoption.features[0].targetRate = 0;
  changed.adoption.features[1].targetRate = 100;
  Object.assign(changed.adoption.outcomes[0], { unit: "count", current: 0, baseline: 0, target: 0 });
  Object.assign(changed.adoption.outcomes[1], { current: 100, baseline: 0, target: 100 });
  Object.assign(changed.business.metrics[0], { current: 0.5, baseline: null, target: 0 });
  Object.assign(changed.business.metrics[2], { current: 1.25, baseline: 2.5, target: 1.25 });
  const summary = summarizePreview(changed, options);
  assert.deepEqual(summary.adoption.outcomes.map((item) => [item.change, item.meetsTarget]), [[0, true], [100, true]]);
  assert.equal(summary.business.metrics[0].changePct, null);
  assert.equal(summary.business.metrics[0].meetsTarget, true);
  assert.equal(summary.business.metrics[2].changePct, -50);
  assert.equal(summary.business.metrics[2].meetsTarget, true);
});

test("support enum, identity, text and timestamp constraints fail closed", () => {
  for (const mutate of [
    (item) => { item.status = "closed"; },
    (item) => { item.priority = "critical"; },
    (item) => { item.escalated = "true"; },
    (item) => { item.title = ""; },
    (item) => { item.theme = ""; },
    (item) => { item.theme = " Checkout "; },
    (item) => { item.createdAt = "2026-09-25T06:00:00Z"; },
    (item) => { item.updatedAt = "2026-09-18T06:00:00Z"; },
    (item) => { item.updatedAt = "2026-09-24T06:00:00.001Z"; },
    (item) => { item.createdAt = "2026-02-30T06:00:00Z"; },
    (item) => { item.updatedAt = "2026-09-23T06:00:00+00:00"; },
  ]) {
    const changed = copy();
    mutate(changed.support.cases[0]);
    assert.throws(() => validatePreview(changed, product, options));
  }
  for (const value of ["2026-09-24T06:00:00.001Z", "2026-09-24", "2026-02-30T06:00:00Z", null]) {
    const changed = copy();
    changed.support.asOf = value;
    assert.throws(() => validatePreview(changed, product, options));
  }
});

test("weekly adoption and business windows require valid, equal, adjacent seven-day periods before fetch", () => {
  for (const field of ["adoption", "business"]) {
    for (const mutate of [
      (section) => { section.window.start = "2026-02-30T06:00:00Z"; },
      (section) => { section.window.end = "2026-09-25T06:00:00Z"; },
      (section) => { section.window.start = section.window.end; },
      (section) => { section.baselineWindow.end = "2026-09-17T05:00:00Z"; },
      (section) => { section.baselineWindow.start = "2026-09-09T06:00:00Z"; },
      (section) => {
        section.window = { start: "2026-09-23T06:00:00Z", end: "2026-09-24T06:00:00Z" };
        section.baselineWindow = { start: "2026-09-22T06:00:00Z", end: "2026-09-23T06:00:00Z" };
      },
    ]) {
      const changed = copy();
      mutate(changed[field]);
      assert.throws(() => validatePreview(changed, product, options), /window|Window|Weekly|valid date/);
    }
  }
  const shifted = copy();
  shifted.business.window = { start: "2026-09-16T06:00:00Z", end: "2026-09-23T06:00:00Z" };
  shifted.business.baselineWindow = { start: "2026-09-09T06:00:00Z", end: "2026-09-16T06:00:00Z" };
  assert.throws(() => validatePreview(shifted, product, options), /match adoption/);
  delete shifted.adoption;
  assert.equal(validatePreview(shifted, product, options), shifted);
});

test("new arrays reject duplicate identities and duplicate names without prohibiting repeated case themes", () => {
  for (const locate of [
    (s) => s.adoption.features, (s) => s.adoption.outcomes, (s) => s.support.cases, (s) => s.business.metrics,
  ]) {
    for (const mutate of [
      (items) => { items.push({ ...items[0] }); },
      (items) => { items[0].localKey = "123456"; },
      (items) => { items[0].localKey = "sample-../remote"; },
      (items) => { items[0].localKey = zava.stories[0].localKey; },
      (items) => {
        const field = Object.hasOwn(items[0], "title") ? "title" : "name";
        items[1][field] = ` ${items[0][field].toUpperCase()} `;
      },
    ]) {
      const changed = copy();
      mutate(locate(changed));
      assert.throws(() => validatePreview(changed, product, options), /localKey|Duplicate/);
    }
  }
  const changed = copy();
  changed.business.metrics[0].localKey = changed.adoption.features[0].localKey;
  assert.throws(() => validatePreview(changed, product, options), /Duplicate/);
  assert.equal(validatePreview(zava, product, options), zava);
});

test("new array and string bounds reject malformed or unbounded authored input", () => {
  for (const [locate, field, max] of [
    [(s) => s.adoption, "features", 100], [(s) => s.adoption, "outcomes", 100],
    [(s) => s.support, "cases", 1000], [(s) => s.business, "metrics", 100],
  ]) {
    for (const mutate of [
      (section) => { section[field] = null; },
      (section) => { section[field] = {}; },
      (section) => { section[field] = Array(max + 1).fill(section[field][0]); },
      (section) => { delete section[field][0]; },
      (section) => { section[field][0] = null; },
    ]) {
      const changed = copy();
      mutate(locate(changed));
      assert.throws(() => validatePreview(changed, product, options));
    }
  }
  for (const [locate, field, max] of [
    [(s) => s.adoption.definitions, "activeUsers", 2000],
    [(s) => s.adoption.definitions, "activation", 2000],
    [(s) => s.adoption.definitions, "retention", 2000],
    [(s) => s.adoption.features[0], "name", 500],
    [(s) => s.adoption.outcomes[0], "name", 500],
    [(s) => s.support.cases[0], "title", 500],
    [(s) => s.support.cases[0], "theme", 120],
    [(s) => s.business, "scopeNote", 2000],
    [(s) => s.business.metrics[0], "definition", 2000],
  ]) {
    for (const value of [" ", null, false, "a".repeat(max + 1)]) {
      const changed = copy();
      locate(changed)[field] = value;
      assert.throws(() => validatePreview(changed, product, options), /string/);
    }
  }
});

test("both authored samples have neutral adoption and business with explicit outage and unchanged story/support concerns", () => {
  for (const fixture of fixtures) {
    const summary = summarizePreview(fixture, options);
    assert.equal(summary.adoption.concern, null);
    assert.equal(summary.adoption.belowTargetCount, 0);
    assert.ok(summary.adoption.features.every((feature) => feature.adoptionRate !== null && feature.adoptionRate >= feature.targetRate && !feature.belowTarget));
    assert.ok(summary.adoption.outcomes.every((outcome) => outcome.meetsTarget === true));
    assert.equal(summary.business.concern, null);
    assert.deepEqual([summary.business.onTargetCount, summary.business.offTargetCount, summary.business.unknownCount], [4, 0, 0]);
    assert.ok(summary.business.metrics.every((metric) => metric.meetsTarget === true));
    assert.ok(summary.stories.concern);
    assert.ok(summary.support.concern);
    assert.ok(summary.appMonitoring.concern);
    assert.equal(summary.appMonitoring.availability.state, "outage");
    assert.equal(summary.appMonitoring.availability.environment, "production");
    assert.match(summary.appMonitoring.availability.summary, /^Simulated production outage:/);
    assert.match(summary.appMonitoring.availability.summary, fixture.productId === "zava-shop" ? /Zava Shop/ : /Contoso CRM/);
    assert.equal([summary.stories, summary.adoption, summary.appMonitoring, summary.support, summary.business].filter((section) => section.concern === null).length, 2);
    assert.equal(fixture.fetchedAt, "2026-09-24T06:00:00Z");
    assert.equal(summary.stories.acceptanceGaps, 2);
    assert.equal(summary.stories.decisions, 2);
    assert.deepEqual([summary.support.totalCases, summary.support.openCases, summary.support.escalatedCases], [7, 5, 2]);
  }
});

test("authored neutral values are measured target comparisons with preserved baselines", () => {
  assert.deepEqual(zava.adoption.features.map((feature) => feature.adoptedUsers), [600, 700, 480]);
  assert.deepEqual(contoso.adoption.features.map((feature) => feature.adoptedUsers), [350, 260, 240]);
  assert.deepEqual(zava.adoption.outcomes.map((outcome) => [outcome.current, outcome.baseline]), [[3, 5], [78, 68]]);
  assert.deepEqual(contoso.adoption.outcomes.map((outcome) => [outcome.current, outcome.baseline]), [[8, 12], [85, 80]]);
  assert.deepEqual(zava.business.metrics.map((metric) => [metric.current, metric.baseline]), [[112000, 100000], [1200, 1000], [30, 40], [96, 80]]);
  assert.deepEqual(contoso.business.metrics.map((metric) => [metric.current, metric.baseline]), [[168000, 160000], [240, 200], [18, 24], [92, 80]]);
});

test("availability is independent of unchanged historical request, operation and grouped log metrics", () => {
  const expected = [
    [zava, [12000, 360, 2200, 10000, 200, 1600, 1800],
      [[4000, 200, 2400, 1800], [3000, 120, 1900, 1500], [2000, 20, 650, 1000], [1000, 0, 450, 700]],
      [55, 70, 30, 45, 120, 40], "2026-09-24T05:55:00Z"],
    [contoso, [8000, 160, 1500, 8000, 240, 2000, 1400],
      [[2000, 80, 2500, 2000], [1500, 50, 1600, 1800], [2500, 10, 400, 600], [1000, 15, 1200, 1000]],
      [25, 35, 40, 20, 60, 100], "2026-09-24T05:57:00Z"],
  ];
  for (const [fixture, requests, operations, occurrences, observedAt] of expected) {
    const app = fixture.appMonitoring;
    assert.deepEqual(["total", "failed", "p95Ms", "baselineTotal", "baselineFailed", "baselineP95Ms", "targetP95Ms"].map((field) => app.requests[field]), requests);
    assert.deepEqual(app.operations.map((operation) => ["requests", "failed", "p95Ms", "targetP95Ms"].map((field) => operation[field])), operations);
    assert.deepEqual(app.logs.map((log) => log.occurrences), occurrences);
    assert.equal(app.availability.observedAt, observedAt);
    const original = summarizePreview(fixture, options).appMonitoring;
    const legacy = structuredClone(fixture);
    delete legacy.appMonitoring.availability;
    assert.equal(validatePreview(legacy, { id: fixture.productId }, options), legacy);
    const summary = summarizePreview(legacy, options).appMonitoring;
    assert.equal(summary.availability, null);
    assert.deepEqual(summary.requests, original.requests);
    assert.deepEqual(summary.operations, original.operations);
    assert.deepEqual(summary.logs, original.logs);
    assert.deepEqual(original.concern.evidence.slice(0, -1), summary.concern.evidence);
    assert.equal(original.concern.evidence.at(-1), `Explicit sampled production availability: outage observed at ${observedAt}. ${app.availability.summary}`);
    assert.match(original.concern.recommendation, /historical evidence, not an inference of current availability/);
  }
});

test("explicit sampled outage alone creates concern without failures or latency evidence", () => {
  for (const fixture of fixtures) {
    const changed = structuredClone(fixture);
    noAppTraffic(changed.appMonitoring, { availability: true });
    const summary = summarizePreview(changed, options).appMonitoring;
    assert.deepEqual(summary.availability, fixture.appMonitoring.availability);
    onlyKeys(summary.availability, ["state", "environment", "observedAt", "summary"]);
    assert.equal(summary.requests.failureRate, null);
    assert.equal(summary.requests.p95ChangePct, null);
    assert.equal(summary.requests.failed, 0);
    assert.deepEqual([summary.errorEvents, summary.warningEvents, summary.slowOperationCount], [0, 0, 0]);
    assert.equal(summary.concern.evidence.length, 1);
    assert.match(summary.concern.evidence[0], /Explicit sampled production availability: outage observed at/);
    assert.ok(summary.concern.evidence[0].includes(fixture.appMonitoring.availability.summary));
    assert.ok(summary.operations.every((operation) => operation.atRisk === false));
  }
});

test("operational or unknown observations alone do not imply global health or create concern", () => {
  for (const state of ["operational", "unknown"]) {
    const changed = copy();
    noAppTraffic(changed.appMonitoring, { availability: true });
    Object.assign(changed.appMonitoring.availability, { state, summary: `Explicit sampled production observation: ${state}.` });
    const summary = summarizePreview(changed, options).appMonitoring;
    assert.equal(summary.availability.state, state);
    assert.equal(summary.concern, null);
    assert.equal(summary.requests.failureRate, null);
    assert.equal(summary.requests.baselineFailureRate, null);
    assert.equal(summary.requests.p95Ms, null);
    assert.equal(Object.hasOwn(summary, "status"), false);
    assert.doesNotMatch(JSON.stringify(summary), /healthy|readiness|ready|overallHealth/);
  }
});

test("even complete historical request failure does not infer outage or override observed availability", () => {
  const changed = copy();
  changed.appMonitoring.operations = [];
  changed.appMonitoring.logs = [];
  changed.appMonitoring.requests.failed = changed.appMonitoring.requests.total;
  delete changed.appMonitoring.availability;
  let summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.requests.failureRate, 100);
  assert.equal(summary.availability, null);
  assert.ok(summary.concern);
  assert.doesNotMatch(summary.concern.evidence.join(" "), /outage|availability: /);
  changed.appMonitoring.availability = {
    state: "operational", environment: "production", observedAt: changed.appMonitoring.window.end,
    summary: "Explicit sampled observation: production is operational at the observation time.",
  };
  summary = summarizePreview(changed, options).appMonitoring;
  assert.equal(summary.availability.state, "operational");
  assert.equal(summary.requests.failureRate, 100);
  assert.ok(summary.concern);
  assert.doesNotMatch(summary.concern.evidence.join(" "), /outage/);
});

test("availability has strict optional object shape, states, environment and bounded text", () => {
  for (const mutate of [
    (app) => { app.availability = null; },
    (app) => { app.availability = undefined; },
    (app) => { app.availability = []; },
    (app) => { app.availability = "outage"; },
    (app) => { app.availability.state = "degraded"; },
    (app) => { app.availability.state = "Outage"; },
    (app) => { app.availability.state = null; },
    (app) => { app.availability.environment = "staging"; },
    (app) => { app.availability.environment = null; },
    (app) => { app.availability.summary = ""; },
    (app) => { app.availability.summary = " "; },
    (app) => { app.availability.summary = null; },
    (app) => { app.availability.summary = 1; },
    (app) => { app.availability.summary = "a".repeat(2001); },
    (app) => { app.availability.sourceUrl = null; },
    (app) => { app.availability[Symbol("hidden")] = 1; },
    (app) => { Object.defineProperty(app.availability, "remoteId", { value: "not allowed" }); },
  ]) {
    const changed = copy();
    mutate(changed.appMonitoring);
    assert.throws(() => validatePreview(changed, product, options));
    assert.throws(() => summarizePreview(changed, options));
  }
  for (const field of ["state", "environment", "observedAt", "summary"]) {
    const changed = copy();
    delete changed.appMonitoring.availability[field];
    assert.throws(() => validatePreview(changed, product, options), /exactly/);
  }
});

test("availability timestamps are valid UTC dates within the inclusive window and not after fetch", () => {
  for (const date of ["2026-09-24", "2026-02-30T05:55:00Z", "2026-09-24T25:00:00Z", "2026-09-24T05:55:00+00:00",
    "2026-09-23T05:59:59.999Z", "2026-09-24T06:00:00.001Z", "2026-09-25T00:00:00Z", null, 0]) {
    const changed = copy();
    changed.appMonitoring.availability.observedAt = date;
    assert.throws(() => validatePreview(changed, product, options));
  }
  for (const date of ["2026-09-23T06:00:00Z", "2026-09-24T06:00:00Z", "2026-09-24T05:59:59.999Z"]) {
    const changed = copy();
    changed.appMonitoring.availability.observedAt = date;
    assert.equal(validatePreview(changed, product, options), changed);
  }
});

test("unfavorable derived concerns and availability summaries do not expose mutable input references", () => {
  const changed = copy();
  changed.adoption.features[0].adoptedUsers = 0;
  changed.business.metrics[0].current = 0;
  const before = structuredClone(changed);
  freeze(changed);
  const summary = summarizePreview(changed, options);
  summary.adoption.concern.evidence.push("changed locally");
  summary.business.concern.evidence.push("changed locally");
  summary.appMonitoring.availability.state = "operational";
  summary.appMonitoring.availability.summary = "changed locally";
  assert.deepEqual(changed, before);
  assert.deepEqual(summarizePreview(changed, options), summarizePreview(before, options));
});
