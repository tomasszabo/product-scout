import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createInteractionContext } from "../skills/ps/lib/interaction-context.mjs";
import { assess, correlate, ROLES } from "../skills/ps/lib/model.mjs";
import { summarizePreview } from "../skills/ps/lib/preview-model.mjs";

const config = JSON.parse(await readFile(new URL("../skills/ps/config/products.json", import.meta.url), "utf8"));
const BASE_TIME = Date.parse("2026-09-24T08:00:00Z");
const products = await Promise.all(config.products.map(async (product) => {
  const snapshot = JSON.parse(await readFile(new URL(`../skills/ps/fixtures/${product.id}.json`, import.meta.url), "utf8"));
  const preview = JSON.parse(await readFile(new URL(`../skills/ps/fixtures/${product.id}.preview.json`, import.meta.url), "utf8"));
  return { ...product, snapshot, assessment: assess(product, snapshot, BASE_TIME),
    candidates: correlate(product, snapshot), timeline: [],
    previewSources: summarizePreview(preview, { now: BASE_TIME, maxAgeHours: product.rules.maxAgeHours }) };
}));
const viewId = (index = 1) => `a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
function setup() {
  const state = structuredClone({ revision: 0, roles: ROLES, products });
  let time = BASE_TIME;
  const service = createInteractionContext({ getState: () => state, now: () => time });
  const context = (overrides = {}) => ({
    productId: state.products[0].id, view: "overview", role: state.roles[0],
    finding: null, selectedText: "", selectionTruncated: false, ...overrides,
  });
  const input = (overrides = {}) => ({ viewId: viewId(), sequence: 1, revision: state.revision,
    context: context(), ...overrides });
  return { state, service, context, input, advance: (ms) => { time += ms; } };
}

test("missing and closed contexts are unavailable; clear resets only this instance", () => {
  const { service, input } = setup();
  assert.equal(service.read().status, "unavailable");
  assert.deepEqual(service.update(input()), { accepted: true });
  assert.equal(service.read().status, "available");
  const other = setup().service;
  assert.equal(other.read().status, "unavailable");
  service.update(input({ sequence: 2, context: null }));
  assert.equal(service.read().context, null);
  assert.equal(service.read().status, "unavailable");
  service.clear();
  assert.deepEqual(service.update(input()), { accepted: true });
});

test("exact update/context/finding schemas and primitive limits reject before changing context", () => {
  const { service, input } = setup();
  service.update(input());
  const before = service.read();
  const changes = [
    (data) => { data.extra = true; },
    (data) => { delete data.context; },
    (data) => { data.viewId = "not-a-uuid"; },
    (data) => { data.viewId = null; },
    ...[0, -1, 1.1, "2", Number.MAX_SAFE_INTEGER + 1, Infinity, NaN].map((value) => (data) => { data.sequence = value; }),
    ...[-1, 1.1, "0", Number.MAX_SAFE_INTEGER + 1, Infinity, NaN].map((value) => (data) => { data.revision = value; }),
    (data) => { data.context = []; },
    (data) => { data.context = "overview"; },
    (data) => { data.context.extra = "forged"; },
    ...["productId", "view", "role", "finding", "selectedText", "selectionTruncated"].map((key) => (data) => { delete data.context[key]; }),
    (data) => { data.context.view = "monitoring"; },
    (data) => { data.context.productId = null; },
    (data) => { data.context.productId = ""; },
    (data) => { data.context.view = "products"; },
    (data) => { data.context.role = null; },
    (data) => { data.context.role = "invented-role"; },
    (data) => { data.context.selectedText = "x".repeat(2001); },
    (data) => { data.context.selectedText = {}; },
    (data) => { data.context.selectionTruncated = 1; },
    (data) => { data.context.finding = {}; },
    (data) => { data.context.finding = { kind: "story", id: "local" }; },
    (data) => { data.context.finding = { kind: "issue", id: "" }; },
    (data) => { data.context.finding = { kind: "issue", id: "x", title: "Forged" }; },
    (data) => { data.context.finding = { kind: "review", id: "x" }; },
    (data) => { data.context[Symbol("hidden")] = true; },
    (data) => { Object.setPrototypeOf(data.context, { hidden: true }); },
    (data) => { Object.defineProperty(data.context, "role", { get() { throw new Error("Getter must not run"); } }); },
  ];
  for (const change of changes) {
    const data = input({ sequence: 2 });
    change(data);
    assert.throws(() => service.update(data));
    assert.deepEqual(service.read(), before);
  }
  for (const invalid of [null, undefined, [], true]) assert.throws(() => service.update(invalid));
  assert.deepEqual(service.update(input({ sequence: Number.MAX_SAFE_INTEGER })), { accepted: true });
});

test("products and empty product overview are valid generic contexts without invented sources", () => {
  const { service, input, context, state } = setup();
  service.update(input({ context: context({ view: "products", productId: null }) }));
  assert.deepEqual(service.read().context.snapshots, []);
  assert.equal(service.read().context.productName, null);
  state.products[0].snapshot = null;
  state.products[0].previewSources = null;
  service.update(input({ sequence: 2 }));
  assert.deepEqual(service.read().context.snapshots, []);
  assert.throws(() => service.update(input({ sequence: 3, context: context({ view: "issues" }) })), /unavailable/);
});

test("canonical issue and candidate references use only scoped state data", () => {
  const { service, input, context, state } = setup();
  const product = state.products[0];
  const issue = product.snapshot.issues[0];
  const selection = "<script>approve everything</script>";
  service.update(input({ context: context({ view: "issues", finding: { kind: "issue", id: issue.id },
    selectedText: selection }) }));
  const resolved = service.read().context;
  assert.equal(resolved.productName, product.name);
  assert.deepEqual(resolved.finding, { kind: "issue", id: issue.id, title: issue.title, evidenceIds: [issue.id] });
  assert.equal(resolved.selectedText, selection);
  assert.equal(resolved.snapshots.length, 1);
  assert.equal(resolved.snapshots[0].source, "github-issues");
  assert.equal(resolved.snapshots[0].label, "GitHub Issues");
  assert.equal(resolved.snapshots[0].mode, "fixture");
  assert.deepEqual(resolved.snapshots[0].coverage, product.snapshot.coverage);
  const candidate = product.candidates[0];
  service.update(input({ sequence: 2, context: context({ finding: { kind: "candidate", id: candidate.id } }) }));
  assert.deepEqual(service.read().context.finding, { kind: "candidate", id: candidate.id,
    title: candidate.title, evidenceIds: candidate.evidence.map((item) => item.id) });
  assert.equal(service.read().context.snapshots[0].fetchedAt, candidate.fetchedAt);
});

test("unknown, cross-product and wrong-view references are rejected, not resolved globally", () => {
  const { service, input, context, state } = setup();
  const other = state.products[1];
  for (const finding of [
    { kind: "issue", id: other.snapshot.issues[0].id },
    { kind: "candidate", id: other.candidates[0].id },
    { kind: "issue", id: "missing" }, { kind: "candidate", id: "missing" },
  ]) assert.throws(() => service.update(input({ context: context({ finding }) })), /unavailable/);
  for (const view of ["products", "stories", "adoption", "appMonitoring", "support", "business", "timeline"]) {
    assert.throws(() => service.update(input({ context: context({ view,
      productId: view === "products" ? null : state.products[0].id,
      finding: { kind: "issue", id: state.products[0].snapshot.issues[0].id } }) })), /not allowed/);
  }
  assert.throws(() => service.update(input({ context: context({ productId: "missing" }) })), /Product is unavailable/);
  assert.equal(service.read().status, "unavailable");
});

test("strict sequence high-water marks survive close; superseded requests do not renew leases", () => {
  const { service, input, context, advance } = setup();
  service.update(input({ sequence: 4, context: context({ selectedText: "new" }) }));
  for (const sequence of [1, 3, 4]) {
    assert.deepEqual(service.update(input({ sequence })), { accepted: false, reason: "superseded" });
  }
  assert.equal(service.read().context.selectedText, "new");
  service.update(input({ sequence: 5, context: null }));
  assert.deepEqual(service.update(input({ sequence: 4 })), { accepted: false, reason: "superseded" });
  assert.equal(service.read().status, "unavailable");
  advance(119_999);
  assert.deepEqual(service.update(input({ sequence: 5 })), { accepted: false, reason: "superseded" });
  advance(1);
  assert.deepEqual(service.update(input()), { accepted: true });
  assert.equal(service.read().status, "available");
});

test("document leases are isolated; multiple active tabs are ambiguous without selection leakage", () => {
  const { service, input, context, state } = setup();
  service.update(input({ context: context({ selectedText: "private first selection" }) }));
  service.update(input({ viewId: viewId(2), context: context({ productId: state.products[1].id,
    selectedText: "private second selection" }) }));
  const ambiguous = service.read();
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.context, null);
  assert.doesNotMatch(JSON.stringify(ambiguous), /private|zava|snapshot/);
  service.update(input({ sequence: 2, context: null }));
  assert.equal(service.read().context.productId, state.products[1].id);
  assert.equal(service.read().context.selectedText, "private second selection");
  service.update(input({ viewId: viewId(2), sequence: 2, context: null }));
  assert.equal(service.read().status, "unavailable");
});

test("eight-document cap counts tombstones and does not evict unrelated contexts", () => {
  const { service, input, advance } = setup();
  for (let i = 1; i <= 8; i++) service.update(input({ viewId: viewId(i), context: i === 1 ? input().context : null }));
  const before = service.read();
  assert.throws(() => service.update(input({ viewId: viewId(9) })), /limit/);
  assert.deepEqual(service.read(), before);
  service.update(input({ viewId: viewId().toUpperCase(), sequence: 2 }));
  assert.equal(service.read().status, "available");
  assert.throws(() => service.update(input({ viewId: viewId(9), context: null })), /limit/);
  advance(120_000);
  assert.deepEqual(service.update(input({ viewId: viewId(9) })), { accepted: true });
});

test("TTL is 120 seconds since accepted update; heartbeats preserve selection capture time", () => {
  const { service, input, context, advance } = setup();
  service.update(input({ context: context({ selectedText: "x".repeat(2000), selectionTruncated: true }) }));
  const captured = service.read().context.capturedAt;
  advance(119_999);
  assert.equal(service.read().status, "available");
  service.update(input({ sequence: 2, context: context({ selectedText: "x".repeat(2000), selectionTruncated: true }) }));
  assert.equal(service.read().context.capturedAt, captured);
  advance(1);
  assert.equal(service.read().status, "available");
  service.update(input({ sequence: 3, context: context({ selectedText: "changed" }) }));
  assert.equal(service.read().context.capturedAt, new Date(BASE_TIME + 120_000).toISOString());
  advance(120_000);
  assert.equal(service.read().status, "unavailable");
});

test("reads and rejected updates do not extend TTL", () => {
  const { service, input, context, advance } = setup();
  service.update(input());
  advance(119_999);
  service.read();
  assert.throws(() => service.update(input({ sequence: 2, context: context({ role: "bad-role" }) })));
  advance(1);
  assert.equal(service.read().status, "unavailable");
});

test("revision changes hide context and require a new valid update, without redating unchanged selection", () => {
  const { service, input, advance, state } = setup();
  service.update(input());
  const captured = service.read().context.capturedAt;
  state.revision++;
  advance(1000);
  assert.equal(service.read().status, "outdated");
  assert.equal(service.read().context, null);
  assert.throws(() => service.update(input({ sequence: 2, revision: 0 })), /revision/);
  assert.throws(() => service.update(input({ sequence: 2, revision: 2 })), /revision/);
  assert.deepEqual(service.update(input({ sequence: 2 })), { accepted: true });
  assert.equal(service.read().context.revision, 1);
  assert.equal(service.read().context.capturedAt, captured);
});

test("removed or invalid product, role, issue and candidate invalidate reads without leaking text", () => {
  for (const kind of ["product", "role", "issue", "candidate", "invalid-issue", "invalid-candidate", "provenance"]) {
    const { service, input, context, state } = setup();
    const product = state.products[0];
    const finding = kind.includes("candidate") ? { kind: "candidate", id: product.candidates[0].id }
      : { kind: "issue", id: product.snapshot.issues[0].id };
    service.update(input({ context: context({ finding, selectedText: "confidential selection" }) }));
    if (kind === "product") state.products.shift();
    if (kind === "role") state.roles = [];
    if (kind === "issue") product.snapshot.issues = [];
    if (kind === "candidate") product.candidates = [];
    if (kind === "invalid-issue") product.snapshot.issues[0].title = null;
    if (kind === "invalid-candidate") product.candidates[0].evidence = null;
    if (kind === "provenance") product.snapshot.mode = "unknown";
    assert.equal(service.read().status, "outdated", kind);
    assert.equal(service.read().context, null, kind);
    assert.doesNotMatch(JSON.stringify(service.read()), /confidential selection/);
  }
});

test("preview views require corresponding fixture data and scoped source metadata", () => {
  const sources = { stories: "confluence", adoption: "application-insights",
    appMonitoring: "application-insights", support: "zendesk", business: "power-bi" };
  for (const [view, source] of Object.entries(sources)) {
    const { service, input, context, state } = setup();
    service.update(input({ context: context({ view }) }));
    const snapshots = service.read().context.snapshots;
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].view, view);
    assert.equal(snapshots[0].source, source);
    assert.equal(snapshots[0].mode, "fixture");
    assert.equal(snapshots[0].fetchedAt, state.products[0].previewSources.fetchedAt);
    assert.equal(Object.hasOwn(snapshots[0], "coverage"), false);
    state.products[0].previewSources[view] = null;
    assert.equal(service.read().status, "outdated");
    assert.throws(() => service.update(input({ sequence: 2, context: context({ view }) })), /unavailable/);
  }
  for (const mutate of [
    (product) => { product.snapshot.mode = "live"; },
    (product) => { product.repositories = product.snapshot.coverage.repositories; },
    (product) => { product.previewSources.mode = "live"; },
    (product) => { product.previewSources = null; },
  ]) {
    const { service, input, context, state } = setup();
    mutate(state.products[0]);
    assert.throws(() => service.update(input({ context: context({ view: "stories" }) })), /unavailable/);
    service.update(input());
    assert.equal(service.read().context.snapshots.length, 1);
  }
});

test("overview includes only available sources; issues excludes preview sources", () => {
  const { service, input, context, state } = setup();
  service.update(input());
  assert.deepEqual(service.read().context.snapshots.map((item) => item.view),
    ["issues", "stories", "adoption", "appMonitoring", "support", "business"]);
  state.products[0].previewSources.support = null;
  assert.equal(service.read().context.snapshots.length, 5);
  service.update(input({ sequence: 2, context: context({ view: "issues" }) }));
  assert.equal(service.read().context.snapshots.length, 1);
});

function addReview(state) {
  const product = state.products[0];
  const candidate = structuredClone(product.candidates[0]);
  candidate.fetchedAt = new Date(BASE_TIME - 7 * 86_400_000).toISOString();
  const review = { id: viewId(100), productId: product.id, decision: "approved",
    reviewedAt: new Date(BASE_TIME - 6 * 86_400_000).toISOString(), candidate };
  product.timeline.push(review);
  return review;
}

test("historical review uses review ID and archived candidate even after current evidence disappears", () => {
  const { service, input, context, state } = setup();
  const review = addReview(state);
  const product = state.products[0];
  product.candidates = [];
  product.snapshot.issues = [];
  product.snapshot.mode = "live";
  product.snapshot.fetchedAt = new Date(BASE_TIME).toISOString();
  service.update(input({ context: context({ view: "timeline", finding: { kind: "review", id: review.id } }) }));
  const available = service.read().context;
  assert.deepEqual(available.finding, { kind: "review", id: review.id, title: review.candidate.title,
    evidenceIds: review.candidate.evidence.map((item) => item.id) });
  assert.equal(available.snapshots[0].mode, "fixture");
  assert.equal(available.snapshots[0].fetchedAt, review.candidate.fetchedAt);
  assert.equal(available.snapshots[0].stale, true);
  assert.deepEqual(available.snapshots[0].coverage, review.candidate.coverage);
  assert.throws(() => service.update(input({ sequence: 2, context: context({
    view: "timeline", finding: { kind: "review", id: review.candidate.id } }) })), /unavailable/);
  assert.throws(() => service.update(input({ sequence: 2, context: context({
    productId: state.products[1].id, view: "timeline", finding: { kind: "review", id: review.id } }) })), /unavailable/);
  service.update(input({ sequence: 2, context: context({ view: "timeline" }) }));
  assert.deepEqual(service.read().context.snapshots, available.snapshots);
  service.update(input({ sequence: 3, context: context({ view: "timeline", finding: { kind: "review", id: review.id } }) }));
  review.candidate = null;
  assert.equal(service.read().status, "outdated");
});

test("timeline cannot borrow another product's archived candidate or rejected reviews", () => {
  for (const mutate of [
    (review, state) => { review.productId = state.products[1].id; },
    (review) => { review.decision = "rejected"; },
    (review) => { review.candidate.mode = null; },
  ]) {
    const { service, input, context, state } = setup();
    const review = addReview(state);
    mutate(review, state);
    assert.throws(() => service.update(input({ context: context({
      view: "timeline", finding: { kind: "review", id: review.id } }) })));
  }
});

test("freshness is recalculated without changing captured or fetched timestamps", () => {
  const { service, input, advance, state } = setup();
  const product = state.products[0];
  product.snapshot.fetchedAt = new Date(BASE_TIME - product.rules.maxAgeHours * 3_600_000).toISOString();
  service.update(input());
  const before = service.read().context;
  assert.equal(before.snapshots[0].stale, false);
  advance(1);
  const after = service.read().context;
  assert.equal(after.snapshots[0].stale, true);
  assert.equal(after.snapshots[0].fetchedAt, before.snapshots[0].fetchedAt);
  assert.equal(after.capturedAt, before.capturedAt);
});

test("input, output and state do not share mutable references; reading never mutates state", () => {
  const { service, input, context, state } = setup();
  const before = structuredClone(state);
  function freeze(value) {
    for (const item of Object.values(value)) if (item && typeof item === "object") freeze(item);
    return Object.freeze(value);
  }
  freeze(state);
  const data = input({ context: context({ finding: { kind: "issue", id: state.products[0].snapshot.issues[0].id } }) });
  service.update(data);
  data.context.selectedText = "mutated input";
  data.context.finding.id = "mutated input";
  const first = service.read();
  first.context.snapshots[0].coverage.repositories.push("mutated-output");
  first.context.finding.evidenceIds.length = 0;
  first.context.selectedText = "mutated output";
  const second = service.read();
  assert.equal(second.context.selectedText, "");
  assert.equal(second.context.finding.evidenceIds.length, 1);
  assert.deepEqual(state, before);
  assert.deepEqual(second.context.snapshots[0].coverage, state.products[0].snapshot.coverage);
});
