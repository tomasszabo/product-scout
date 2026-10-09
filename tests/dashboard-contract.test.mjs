import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { validateConfig, validateSnapshot, assess, correlate } from "../skills/ps/lib/model.mjs";
import { validatePreview, summarizePreview } from "../skills/ps/lib/preview-model.mjs";

async function navigationHarness(href, storage = new Map()) {
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  const location = new URL(href);
  const handlers = new Map();
  const controls = new Map();
  const source = [
    js.slice(0, js.indexOf("function el(")),
    js.slice(js.indexOf("function selectProduct("), js.indexOf("function renderNavigation(")),
    `({
      selectProduct, navigate,
      read: () => ({token, selectedId, tab}),
    })`,
  ].join("\n");
  const app = runInNewContext(source, {
    URL, URLSearchParams, location, render() {}, clearFinding() {}, publishContext() {},
    history: { replaceState: (_state, _title, url) => { location.href = new URL(url, location).href; } },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    document: {
      querySelector: selector => {
        if (!controls.has(selector)) controls.set(selector, {
          addEventListener: (event, handler) => handlers.set(`${selector}:${event}`, handler),
          focus() {},
        });
        return controls.get(selector);
      },
    },
  });
  return { app, location, storage };
}

test("canvas startup and navigation preserve the exact host-issued URL", async () => {
  const href = "http://127.0.0.1:12345/?token=non-secret-test-capability&productId=zava-shop&previewSources=true";
  const { app, location, storage } = await navigationHarness(href);
  assert.equal(location.href, href, "Host readiness rejects a changed URL");
  assert.equal(app.read().token, "non-secret-test-capability");
  assert.equal(app.read().selectedId, "zava-shop");
  app.selectProduct("contoso-crm");
  app.navigate("issues");
  assert.equal(location.href, href);
  assert.equal(app.read().tab, "issues");
  const reloaded = await navigationHarness(href, storage);
  assert.equal(reloaded.app.read().selectedId, "contoso-crm");
  assert.equal(reloaded.app.read().tab, "overview");
  reloaded.app.navigate("products");
  assert.equal(reloaded.location.href, href);
  assert.equal((await navigationHarness(href, storage)).app.read().selectedId, null);
  const other = await navigationHarness(href.replace("zava-shop", "contoso-crm"), storage);
  assert.equal(other.app.read().selectedId, "contoso-crm");
  assert.ok([...storage].filter(([key]) => key.startsWith("ps-view:")).every(([, value]) => !value.includes("previewSources")));
});

test("overview preserves Product Scout palette, typography and a replaceable placeholder mark", async () => {
  const css = await readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8");
  for (const token of [
    "--cp-bg: #ffffff", "--cp-accent: #c03bc4", "--cp-text: #000000",
    "--cp-bg: #0f172a", "--cp-accent: #e879f9", "--cp-text: #e5edf7",
  ]) assert.ok(css.includes(token), `Missing palette token ${token}`);
  assert.match(css, /"Segoe UI", Aptos, Calibri/);
  assert.match(css, /prefers-reduced-motion/);
  const html = await readFile(new URL("../skills/ps/dashboard/index.html", import.meta.url), "utf8");
  assert.match(html, /class="brand-mark"/);
  assert.match(html, /<svg viewBox=/);
  assert.match(html, /Skip to product overview/);
});

test("source data is never interpolated as executable markup and review needs explicit interaction", async () => {
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|eval\(/);
  assert.match(js, /node\.textContent = text/);
  assert.match(js, /confirmed\.required = true/);
  assert.match(js, /form\.reportValidity\(\)/);
  assert.match(js, /evidenceHash: candidate\.evidenceHash/);
  assert.match(js, /if \(response\.dispatched !== true\) throw new Error/);
  assert.doesNotMatch(js, /navigator\.clipboard|copy-prompt|Browser workspace/);
  const html = await readFile(new URL("../skills/ps/dashboard/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /copy-prompt|copy-status|Copy prompt/);
});

test("canvas uses Product Scout navigation hierarchy without an application shell", async () => {
  const [html, js, css, manifest] = await Promise.all([
    readFile(new URL("../skills/ps/dashboard/index.html", import.meta.url), "utf8"),
    readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8"),
    readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../skills/ps-version/version-manifest.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.doesNotMatch(html, /<aside|<footer|class="shell"|class="avatar"|YOUR PRODUCT, IN FOCUS/);
  assert.doesNotMatch(css, /\.sidebar\b|\.product-tile\b|\.workspace-footer\b/);
  assert.match(html, /class="topbar-inner"/);
  assert.match(html, /aria-label="Breadcrumb"/);
  assert.match(html, /id="canvas-settings"/);
  assert.match(js, /let tab = selectedId \? "overview" : "products"/);
  assert.match(js, /function renderProducts/);
  assert.match(js, /"table", "products-table"/);
  assert.match(js, /"GitHub Issues — view details"/);
  assert.match(js, /"summary-card", \(\) => navigate\("issues"\)/);
  assert.match(js, /"Back to My Products"/);
  assert.match(js, /aria-label", "Switch product"/);
  assert.match(css, /width: min\(1180px, 100%\)/);
  assert.match(css, /min-height: 52px/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(js, new RegExp(`DASHBOARD_VERSION = "${manifest.runtimeVersion.replaceAll(".", "\\.")}"`));
});

test("bottom disclaimer is omitted while source details retain coverage limitations", async () => {
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(js, /el\("p", "scope-note", current\.assessment\.limitations\)/);
  const sourceDetails = js.slice(js.indexOf("function sourceDetails("), js.indexOf("function showIssue("));
  assert.match(sourceDetails, /el\("p", "", current\.assessment\.limitations\)/);
  assert.match(sourceDetails, /el\("details", "source-details"\)/);
  assert.match(js, /card\.append\(sourceDetails\(current\)\)/);
});

test("Issues header has one safe GitHub Issues link instead of source and refresh buttons", async () => {
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  const issues = js.slice(js.indexOf("function renderIssues("), js.indexOf("function renderRows("));
  assert.match(issues, /el\("a", "github-issues-link", "Open GitHub Issues ↗"\)/);
  assert.match(issues, /issuesLink\.href = "https:\/\/github\.com\/issues"/);
  assert.match(issues, /issuesLink\.target = "_blank"/);
  assert.match(issues, /issuesLink\.rel = "noopener noreferrer"/);
  assert.match(issues, /append\(el\("div", "source-actions"\), issuesLink\)/);
  assert.doesNotMatch(issues, /button\("Source details"|Refresh with Copilot|Fetch configured repositories/);
});

test("overview ends with cards and has no bottom action links", async () => {
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  const overview = js.slice(js.indexOf("function renderOverview("), js.indexOf("function percent("));
  assert.doesNotMatch(overview, /overview-actions|Product Timeline|Investigate release/);
  assert.match(overview, /main\.append\(append\(overview, card\)\)/);
  assert.match(overview, /"summary-card", \(\) => navigate\("issues"\)/);
  const css = await readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.overview-actions\b/);
});

test("Issues detail omits the bottom investigation callout without removing evidence investigation", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8"),
    readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(js, /investigate-bar|The overview is just the starting point|Follow the evidence\. Challenge an assumption|roleFocus\[selectedRole\]\.question/);
  assert.doesNotMatch(css, /\.investigate-bar\b/);
  assert.match(js, /Investigate this issue ↗/);
  assert.match(js, /Investigate deeper with Copilot ↗/);
  assert.match(js, /const focus = roleFocus\[selectedRole\]\.priority/);
  assert.match(js, /card\.append\(sourceDetails\(current\)\);\s*main\.append\(card\);\s*\}/);
});

test("sample cards need no opt-in and separate facts from concerns and actions", async () => {
  const [js, html] = await Promise.all([
    readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8"),
    readFile(new URL("../skills/ps/dashboard/index.html", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(html, /preview-sources|Preview all product cards/);
  assert.doesNotMatch(js, /let previewSources|#preview-sources/);
  const overview = js.slice(js.indexOf("function renderOverview("), js.indexOf("function percent("));
  assert.match(overview, /if \(current\.snapshot\.mode === "fixture"\) \{[\s\S]*for \(const source of previewViews\) overview\.append\(previewCard\(current, source\)\)/);
  assert.match(js, /const previewViews = \["stories", "adoption", "appMonitoring", "support", "business"\]/);
  assert.match(js, /viewNames\[tab\]/);
  assert.match(js, /p\.previewSources\?\.stale/);
  for (const label of ["Confluence", "Azure Application Insights", "OBSERVED FACTS", "DERIVED CONCERN", "RECOMMENDATION", "Needs my decision"]) assert.ok(js.includes(label), label);
  assert.doesNotMatch(js, /FIXTURE · NOT LIVE|OBSERVED SAMPLE/);
  assert.match(js, /No \$\{viewNames\[source\]\} data is available/);
  assert.match(js, /No request traffic observed; operational reliability is unknown/);
  assert.match(js, /do not sum them as unique users/);
  const preview = js.slice(js.indexOf("function previewCard("), js.indexOf("function renderIssues("));
  assert.doesNotMatch(preview, /api\(|\/api\/review|investigate\(/);
});

test("adoption, operations, support and business reporting have distinct sources and detail content", async () => {
  const [js, html, css] = await Promise.all([
    readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8"),
    readFile(new URL("../skills/ps/dashboard/index.html", import.meta.url), "utf8"),
    readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(js, /adoption: "Product Adoption & Value", appMonitoring: "Operations", support: "Customer Support", business: "Business Reporting"/);
  assert.doesNotMatch(js, /User Journey Health|App Monitoring|renderJourneys/);
  assert.doesNotMatch(html, /fixture|preview-sources/);
  assert.match(js, /else if \(previewViews\.includes\(tab\)\) renderPreviewDetail/);
  assert.match(js, /if \(!preview\?\.\[source\]\)/);
  assert.match(js, /case "appMonitoring": renderOperations\(card, data, preview\.stale\)/);
  for (const label of ["Request success", "Slow operations", "Failed requests", "Request p95",
    "Operational performance", "Operational diagnostic logs", "Occurrences", "No logs match these filters.",
    "Search operational logs", "All logs", "Errors", "Warnings", "Zendesk", "Power BI", "Feature adoption",
    "Observed product value", "Customer support cases", "Business outcome metrics"]) assert.ok(js.includes(label), label);
  assert.match(js, /log\.severity === severity/);
  assert.match(js, /control\.setAttribute\("aria-pressed"/);
  assert.match(js, /do not add them as incidents/);
  assert.doesNotMatch(css, /repeat\(3, minmax\(0, 1fr\)\)/);
});

function previewNode(tag, className = "", text = "") {
  return {
    tag, className, text, dataset: {}, children: [], events: {}, isConnected: true,
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, listener) { this.events[name] = listener; },
  };
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
async function insightsHarness() {
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  const source = js.slice(js.indexOf("function renderCopilotInsights("), js.indexOf("function percent("));
  const navigations = [];
  const context = {
    el: previewNode,
    append: (parent, ...children) => { parent.append(...children.filter(Boolean)); return parent; },
    button: (text, className, action) => Object.assign(previewNode("button", className, text), { click: action }),
    badge: (text, variant) => previewNode("span", variant, text),
    insightDisclosure: new Map(), previewTime: (value) => value,
    viewNames: { issues: "GitHub Issues", stories: "User Stories", adoption: "Product Adoption & Value", appMonitoring: "Operations", support: "Customer Support", business: "Business Reporting" },
    navigate: (view) => navigations.push(view),
  };
  const render = runInNewContext(`${source}\nrenderCopilotInsights`, context);
  const current = {
    id: "zava-shop", name: "Zava Shop", release: { version: "v4.2" },
    snapshot: { mode: "fixture", fetchedAt: "2026-09-24T06:00:00Z", coverage: { status: "complete" } },
    assessment: { openCount: 5, attentionCount: 4, decisionCount: 2, stale: false },
    previewSources: {
      fetchedAt: "2026-09-24T06:00:00Z", stale: false,
      stories: { total: 7, accepted: 2, acceptanceGaps: 2, decisions: 2 },
      adoption: { belowTargetCount: 2 },
      appMonitoring: { requests: { failed: 360 }, errorEvents: 115, warningEvents: 150, slowOperationCount: 2 },
      support: { escalatedCases: 2 },
      business: { offTargetCount: 2 },
    },
  };
  return { render, current, navigations, js, source };
}

test("Copilot insights preview shows three bounded areas and only navigates existing sample evidence", async () => {
  const { render, current, navigations, js, source } = await insightsHarness();
  const before = JSON.stringify(current);
  const node = render(current);
  const all = descendants(node);
  assert.deepEqual(all.filter(item => item.tag === "h3").map(item => item.text), [
    "Product situation", "Needs attention", "Recommended next steps",
  ]);
  assert.deepEqual(all.filter(item => item.tag === "ol").map(item => item.children.length), [3, 3]);
  assert.ok(all.some(item => item.text.includes("2 of 7 user stories")));
  assert.ok(all.some(item => item.text === "Coming soon"));
  for (const control of all.filter(item => item.tag === "button")) control.click();
  assert.deepEqual([...new Set(navigations)], ["issues", "stories", "adoption", "support", "appMonitoring", "business"]);
  assert.equal(JSON.stringify(current), before);
  assert.doesNotMatch(source, /api\(|fetch\(|investigate\(|localStorage|sessionStorage|current\.timeline|UI PREVIEW/);
  const overview = js.slice(js.indexOf("function renderOverview("), js.indexOf("function renderCopilotInsights("));
  assert.match(overview, /if \(current\.snapshot\.mode === "fixture"\) main\.append\(renderCopilotInsights\(current\)\)/);
  assert.ok(overview.indexOf("renderCopilotInsights(current)") < overview.indexOf('"summary-grid"'));
  assert.match(js, /insightDisclosure\.set\(previousInsights\.dataset\.productId, previousInsights\.dataset\.expanded === "true"\)/);
  assert.match(js, /if \(restoreInsightFocus\) \$\("#copilot-insights-toggle"\)\?\.focus\(\)/);
});

test("insights disclosure survives rerenders and switching without sharing product state", async () => {
  const { render, current } = await insightsHarness();
  const first = render(current);
  const toggle = descendants(first).find(item => item.id === "copilot-insights-toggle");
  const content = descendants(first).find(item => item.id === "copilot-insights-content");
  assert.equal(first.tag, "section");
  assert.equal(first.dataset.expanded, "false");
  assert.equal(toggle["aria-controls"], content.id);
  assert.equal(toggle["aria-label"], "Expand Copilot insights");
  assert.equal(toggle["aria-expanded"], "false");
  assert.equal(content.inert, true);
  assert.equal(content["aria-hidden"], "true");
  toggle.click();
  assert.equal(toggle["aria-label"], "Collapse Copilot insights");
  assert.equal(toggle["aria-expanded"], "true");
  assert.equal(content.inert, false);
  assert.equal(content["aria-hidden"], "false");
  assert.equal(render(current).dataset.expanded, "true");
  assert.equal(render({ ...current, id: "contoso-crm", name: "Contoso CRM" }).dataset.expanded, "false");
  first.isConnected = false;
  toggle.click();
  assert.equal(render(current).dataset.expanded, "true");
  first.isConnected = true;
  toggle.click();
  assert.equal(render(current).dataset.expanded, "false");
  assert.equal(content.inert, true);
});

test("collapsed insights retain a faded peek and a keyboard-sized bottom toggle", async () => {
  const css = await readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.copilot-insights\[data-expanded="false"\] \.copilot-insights-content \{ max-height: 64px; overflow: hidden; mask-image: linear-gradient/);
  assert.match(css, /\.copilot-insights-toggle \{[^}]*min-height: 44px/);
  assert.match(css, /\.copilot-insights-toggle:focus-visible/);
  assert.match(css, /\.copilot-insights\[data-expanded="true"\] \.insights-chevron \{ transform: rotate\(225deg\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("insights preview never pads empty observations or treats unavailable coverage as healthy", async () => {
  const { render, current } = await insightsHarness();
  current.previewSources = null;
  current.assessment.stale = true;
  current.snapshot.coverage.status = "unavailable";
  const all = descendants(render(current));
  assert.equal(all.filter(item => item.tag === "li").length, 0);
  assert.ok(all.some(item => item.text.includes("issue situation is unknown")));
  assert.ok(all.some(item => item.text.includes("Stale observations: current product status is unknown")));
  assert.ok(all.some(item => item.text.includes("does not establish release readiness")));
  current.snapshot.coverage.status = "complete";
  assert.equal(descendants(render(current)).filter(item => item.tag === "li").length, 2);
});

test("card presentation uses cohort metrics, preserves unknowns and separates operational success", async () => {
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  const helpers = js.slice(js.indexOf("function percent("), js.indexOf("function previewCard("));
  const { previewPresentation: present, metricValue: format } = runInNewContext(`${helpers}\n({previewPresentation, metricValue})`);
  const adoption = present("adoption", {
    activeUsers: 1240, activeUserChangePct: 24, activationRate: 61, retentionRate: null, belowTargetCount: 2,
  });
  assert.equal(adoption.metrics[1][0], "61.0%");
  assert.equal(adoption.metrics[1][1], "Activation");
  assert.equal(adoption.metrics[2][0], "Unknown");
  assert.equal(adoption.detailMetrics[1][0], "+24.0%");
  const operations = present("appMonitoring", { requests: { total: 100, failed: 3, failureRate: 3, p95Ms: 2200 }, slowOperationCount: 2 });
  assert.equal(operations.metrics[0][0], "97.0%");
  assert.equal(operations.detailMetrics[2][0], 2);
  const noTraffic = present("appMonitoring", { requests: { total: 0, failed: 0, failureRate: null, p95Ms: null }, slowOperationCount: 0 });
  assert.match(noTraffic.headline, /unknown/);
  assert.equal(noTraffic.metrics[0][0], "Unknown");
  assert.equal(present("support", { totalCases: 7, openCases: 5, escalatedCases: 2, oldestOpenDays: 8.5 }).metrics[2][0], "8d");
  assert.equal(present("business", { metrics: [], onTargetCount: 1, offTargetCount: 2, unknownCount: 1 }).detailMetrics[3][0], 1);
  assert.equal(format(null, "USD"), "Unknown");
  assert.equal(format(61, "percent"), "61.0%");
  assert.equal(format(12.5, "hours"), "12.5 h");
  assert.throws(() => present("not-a-source", {}), /Unknown preview source/);
});

test("business and value tables show target direction, percentage points and unavailable comparisons", async () => {
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  const helpers = js.slice(js.indexOf("function percent("), js.indexOf("function previewCard("));
  const tables = js.slice(js.indexOf("function previewTable("), js.indexOf("function renderAdoption("));
  const render = runInNewContext(`${helpers}\n${tables}\nrenderOutcomeTable`, {
    el: previewNode,
    append: (parent, ...children) => { parent.append(...children.filter(Boolean)); return parent; },
    badge: (text, variant) => previewNode("span", variant, text),
  });
  const card = previewNode("section");
  render(card, [
    { name: "Completion", unit: "percent", current: 80, baseline: 75, target: 90, direction: "increase", change: 5, meetsTarget: false },
    { name: "Cycle time", unit: "hours", current: 4, baseline: 5, target: 4, direction: "decrease", change: -1, meetsTarget: true },
    { name: "Unreported value", unit: "USD", current: null, baseline: 100, target: 120, direction: "increase", change: null, meetsTarget: null },
  ], "Sample outcomes");
  const text = descendants(card).map(node => node.text);
  for (const expected of ["At least 90.0%", "At most 4 h", "+5.0 pp", "-1 h", "Unknown", "No current value", "Off target", "On target"]) assert.ok(text.includes(expected), expected);
});

async function sourcePresentationHarness() {
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  const constants = js.match(/^const (?:viewNames|sourceProviders|sourceTopics) = .+$/gm).join("\n");
  const helpers = js.slice(js.indexOf("function sourceStatus("), js.indexOf("function product("));
  return {
    js,
    ...runInNewContext(`${constants}\n${helpers}\n({ sourceStatus, sourceHeading, statusDescription, updatedAgo, sourceMetadata })`, {
      el: previewNode,
      append: (parent, ...children) => { parent.append(...children.filter(Boolean)); return parent; },
      document: { createElementNS: (namespace, tag) => previewNode(tag) },
    }),
  };
}

test("source status is evidence-based, distinguishes explicit outages and never treats missing data as healthy", async () => {
  const { sourceStatus: status } = await sourcePresentationHarness();
  const current = {
    assessment: { stale: false, attentionCount: 4 }, snapshot: { coverage: { status: "complete" } },
    previewSources: {
      stale: false, stories: { total: 7, concern: {} },
      appMonitoring: { availability: { state: "outage" }, concern: {}, requests: { total: 100 } },
      adoption: { concern: null, activationRate: 60, retentionRate: 70, features: [{ adoptionRate: 65 }], outcomes: [{ current: 80 }] },
      support: { totalCases: 7, concern: {} }, business: { metrics: [{}], unknownCount: 0, concern: null },
    },
  };
  const domains = ["issues", "stories", "adoption", "appMonitoring", "support", "business"];
  const before = JSON.stringify(current);
  assert.deepEqual(domains.map(source => status(current, source)), ["warning", "warning", "none", "error", "warning", "none"]);
  assert.equal(JSON.stringify(current), before);
  current.previewSources.appMonitoring.availability = null;
  assert.equal(status(current, "appMonitoring"), "warning", "Diagnostic concerns alone are not a production outage");
  current.previewSources.appMonitoring.availability = { state: "unknown" };
  current.previewSources.appMonitoring.concern = null;
  assert.equal(status(current, "appMonitoring"), "unknown");
  current.previewSources.appMonitoring.availability = { state: "outage" };
  current.previewSources.stale = current.assessment.stale = true;
  assert.deepEqual(domains.map(source => status(current, source)), ["warning", "warning", "unknown", "error", "warning", "unknown"]);
  current.assessment.attentionCount = 0;
  assert.equal(status(current, "issues"), "unknown", "An unflagged stale snapshot cannot become an all-clear");
  for (const coverage of ["partial", "unavailable"]) {
    current.assessment.attentionCount = 4;
    current.snapshot.coverage.status = coverage;
    assert.equal(status(current, "issues"), "unknown", "Historical colors cannot override incomplete coverage");
  }
  current.previewSources.stale = current.assessment.stale = false;
  current.snapshot.coverage.status = "partial";
  assert.equal(status(current, "issues"), "unknown");
  current.previewSources.business.unknownCount = 1;
  current.previewSources.adoption.features[0].adoptionRate = null;
  current.previewSources.stories = { total: 0, concern: null };
  for (const source of ["business", "adoption", "stories"]) assert.equal(status(current, source), "unknown");
  current.previewSources = null;
  assert.equal(status(current, "support"), "unknown");
});

test("cards and details share status styling, clear two-row headings and visible local SVG icons", async () => {
  const { js, sourceHeading, statusDescription } = await sourcePresentationHarness();
  const css = await readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8");
  const shapes = new Set();
  for (const [source, title, provider] of [
    ["issues", "Issues", "GitHub"], ["stories", "User Stories", "Confluence"],
    ["adoption", "Product Adoption & Value", "Azure Application Insights"],
    ["appMonitoring", "Operations", "Azure Application Insights"],
    ["support", "Customer Support", "Zendesk"], ["business", "Business Reporting", "Power BI"],
  ]) {
    for (const detail of [false, true]) {
      const all = descendants(sourceHeading(source, detail));
      assert.ok(all.some(item => item.text === title && item.tag === (detail ? "h3" : "span")));
      assert.ok(all.some(item => item.text === provider && item.className === "summary-provider"));
      const svg = all.find(item => item.tag === "svg");
      assert.equal(svg.viewBox, "0 0 24 24");
      assert.equal(svg["aria-hidden"], "true");
      assert.equal(svg.focusable, "false");
      shapes.add(all.filter(item => item.tag === "path").map(item => item.d).join(" "));
    }
  }
  assert.equal(shapes.size, 6);
  assert.deepEqual(["none", "warning", "error", "unknown"].map(status => statusDescription(status).text), ["Normal", "Attention", "Critical / error", "Unknown"]);
  assert.equal(statusDescription("error", "appMonitoring").id, "source-status-appMonitoring");
  assert.match(js, /card\.setAttribute\("aria-describedby", `source-provider-\$\{source\} source-status-\$\{source\}`\)/);
  assert.match(js, /card\.dataset\.attention = sourceStatus\(current, "issues"\)/);
  assert.match(js, /card\.dataset\.attention = preview \? sourceStatus\(current, source\) : "unknown"/);
  assert.match(css, /:is\(\.summary-card, \.source-card\)\[data-attention="warning"\][^\n]*--cp-warning-soft/);
  assert.match(css, /:is\(\.summary-card, \.source-card\)\[data-attention="error"\][^\n]*--cp-danger-soft/);
  assert.match(css, /\.summary-card \{[^\n]*box-shadow: none/);
  assert.match(css, /\.summary-card:hover:not\(:disabled\) \{ background: var\(--source-background\)/);
  assert.match(css, /\.summary-title \{[^\n]*font-size: 22px/);
  assert.match(css, /\.summary-provider \{ display: block; font-size: 14px/);
  assert.match(css, /\.source-glyph \{ width: 28px; height: 28px;[^\n]*stroke: currentColor/);
  assert.doesNotMatch(js, /"section-icon"|"source-icon", "[◉▤▥]"/);
});

test("status palette uses gray normal, blue attention and magenta critical in both themes", async () => {
  const css = await readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8");
  const light = css.slice(0, css.indexOf('html[data-theme="dark"]'));
  const dark = css.slice(css.indexOf('html[data-theme="dark"]'), css.indexOf("* { box-sizing"));
  for (const token of ["--cp-surface-soft: #f4f3f5", "--cp-warning: #0078d4", "--cp-warning-soft: rgba(0, 120, 212, 0.1)",
    "--cp-danger: #c03bc4", "--cp-danger-soft: rgba(192, 59, 196, 0.12)"]) assert.ok(light.includes(token), token);
  for (const token of ["--cp-surface-soft: #1e293b", "--cp-warning: #60a5fa", "--cp-warning-soft: rgba(96, 165, 250, 0.14)",
    "--cp-danger: #e879f9", "--cp-danger-soft: rgba(232, 121, 249, 0.18)"]) assert.ok(dark.includes(token), token);
  assert.match(css, /\.summary-card, \.source-card \{ --source-background: var\(--cp-surface-soft\)/);
  assert.match(css, /\.badge.attention \{ background: var\(--cp-warning-soft\); color: var\(--cp-warning-ink\)/);
  assert.match(css, /\.badge.error \{ background: var\(--cp-danger-soft\); color: var\(--cp-danger-ink\)/);
});

test("hover elevation is subtle, pointer-gated and respects reduced motion", async () => {
  const css = await readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.summary-card \{[^\n]*box-shadow: none; transition: transform 180ms ease, box-shadow 180ms ease/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.summary-card:hover:not\(:disabled\) \{ box-shadow: var\(--cp-shadow\); \}/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\) \{\s*\.summary-card:hover:not\(:disabled\) \{ transform: translateY\(-4px\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \* \{ transition: none !important/);
  assert.match(css, /button:focus-visible[^\n]*outline: 2px solid/);
});

test("status pills are omitted visually and detail color is limited to insight panels", async () => {
  const { statusDescription } = await sourcePresentationHarness();
  for (const state of ["none", "warning", "error"]) {
    const description = statusDescription(state, "issues");
    assert.equal(description.className, "visually-hidden");
    assert.equal(description.id, "source-status-issues");
    assert.equal(description["aria-hidden"], undefined);
  }
  assert.equal(statusDescription("unknown", "issues").className, "source-status-unknown");
  for (const [status, expected] of [["warning", "Last-known: Attention"], ["error", "Last-known: Critical / error"]]) {
    const description = statusDescription(status, "issues", true);
    assert.equal(description.className, "visually-hidden");
    assert.equal(description.text, expected);
    assert.equal(description["aria-hidden"], undefined);
  }
  const css = await readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.source-status \{/);
  assert.match(css, /\.visually-hidden \{[^\n]*position: absolute;[^\n]*clip-path: inset\(50%\)/);
  assert.match(css, /\.card.source-card \{ border-color: var\(--cp-line\); background: var\(--cp-surface\); \}/);
  for (const panel of ["preview-insight", "insight-callout", "availability-observation"]) {
    assert.match(css, new RegExp(`\\.${panel} \\{[^\\n]*background: var\\(--source-background\\)`));
  }
});

test("sample outage is reflected in the insights and card without inferring it from request rates", async () => {
  const { render, current } = await insightsHarness();
  current.previewSources.appMonitoring = {
    requests: { failed: 0 }, errorEvents: 0, warningEvents: 0, slowOperationCount: 0,
    availability: { state: "outage" },
  };
  current.previewSources.business.offTargetCount = 0;
  current.previewSources.adoption.belowTargetCount = 0;
  const text = descendants(render(current)).map(node => node.text).join("\n");
  assert.match(text, /record a production outage at the observation time/);
  assert.doesNotMatch(text, /business target gaps|affected feature cohorts/);
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  const helpers = js.slice(js.indexOf("function percent("), js.indexOf("function previewCard("));
  const present = runInNewContext(`${helpers}\npreviewPresentation`);
  const data = { requests: { total: 100, failed: 3, failureRate: 3, p95Ms: 2200 }, slowOperationCount: 2 };
  assert.doesNotMatch(present("appMonitoring", data).headline, /outage/);
  assert.match(present("appMonitoring", { ...data, availability: { state: "outage" } }).headline, /Production outage/);
});

test("both validated fixture products have two unflagged cards, three warnings and one explicit outage", async () => {
  const { sourceStatus: status } = await sourcePresentationHarness();
  const read = async path => JSON.parse(await readFile(new URL(`../skills/ps/${path}`, import.meta.url), "utf8"));
  const config = validateConfig(await read("config/products.json"));
  const now = Date.parse("2026-09-24T07:00:00Z");
  for (const product of config.products) {
    const snapshot = validateSnapshot(await read(`fixtures/${product.id}.json`), product, { now, allowFixture: true });
    const preview = validatePreview(await read(`fixtures/${product.id}.preview.json`), product, { now });
    const current = { snapshot, assessment: assess(product, snapshot, now), previewSources: summarizePreview(preview, { now }) };
    const domains = ["issues", "stories", "adoption", "appMonitoring", "support", "business"];
    assert.deepEqual(domains.map(source => status(current, source)), ["warning", "warning", "none", "error", "warning", "none"], product.id);
    assert.equal(current.previewSources.adoption.concern, null);
    assert.equal(current.previewSources.business.concern, null);
    assert.equal(current.previewSources.appMonitoring.availability.state, "outage");
  }
});

async function sampleState(now = Date.parse("2026-09-24T07:00:00Z")) {
  const read = async path => JSON.parse(await readFile(new URL(`../skills/ps/${path}`, import.meta.url), "utf8"));
  const config = validateConfig(await read("config/products.json"));
  const products = await Promise.all(config.products.map(async product => {
    const snapshot = validateSnapshot(await read(`fixtures/${product.id}.json`), product, { now, allowFixture: true });
    const preview = validatePreview(await read(`fixtures/${product.id}.preview.json`), product, { now });
    return {
      ...product, snapshot, assessment: assess(product, snapshot, now),
      candidates: correlate(product, snapshot), timeline: [], changes: { hasBaseline: false },
      previewSources: summarizePreview(preview, { now }),
    };
  }));
  return { products, roles: ["Product Owner"], version: "0.1.0", revision: 0, hostConnected: true };
}

async function canvasHarness(data, search = "", storage = new Map(), clock = { now: Date.now() }, cloneResponses = false) {
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  const roots = new Map();
  const matches = (node, selector) => selector.split(",").some(part => {
    const value = part.trim();
    return value === "[data-source]" ? Boolean(node.dataset.source)
      : value === "[data-finding-kind]" ? Boolean(node.dataset.findingKind)
      : value.startsWith('[id="') ? node.id === value.slice(5, -2)
      : value === "[inert]" ? node.inert === true
      : value === "[aria-hidden='true']" ? node["aria-hidden"] === "true"
      : value === "[contenteditable]" ? node.contenteditable === true
      : value.startsWith("#") ? node.id === value.slice(1)
      : value.startsWith(".") ? node.className.split(" ").includes(value.slice(1)) : node.tag === value;
  });
  function node(tag) {
    const item = previewNode(tag);
    item.nodeType = 1;
    item.append = (...children) => {
      for (const child of children) { child.parentElement = item; item.children.push(child); }
    };
    Object.defineProperty(item, "textContent", {
      get: () => [item.text, ...item.children.map(child => child.textContent)].join(" "),
      set: value => { item.text = String(value); item.children = []; },
    });
    Object.defineProperty(item, "options", { get: () => item.children });
    item.value = "";
    item.replaceChildren = (...children) => { item.children = []; item.append(...children); };
    item.querySelector = selector => descendants(item).slice(1).find(child => matches(child, selector)) ?? null;
    item.querySelectorAll = selector => descendants(item).slice(1).filter(child => matches(child, selector));
    item.contains = child => descendants(item).includes(child);
    item.closest = selector => {
      for (let ancestor = item; ancestor; ancestor = ancestor.parentElement) if (matches(ancestor, selector)) return ancestor;
      return null;
    };
    item.classList = { toggle: (name, on) => {
      const classes = new Set(item.className.split(" ").filter(Boolean));
      if (on) classes.add(name); else classes.delete(name);
      item.className = [...classes].join(" ");
    } };
    item.focus = () => { document.activeElement = item; };
    item.showModal = () => { item.open = true; };
    item.close = () => { item.open = false; item.events.close?.(); };
    return item;
  }
  for (const id of ["version", "connection-label", "role-select", "breadcrumb-list", "main",
    "error-banner", "theme-toggle", "settings-toggle", "canvas-settings", "brand-link",
    "toast", "context-status"]) {
    const item = node(id === "role-select" ? "select" : "div");
    item.id = id;
    roots.set(`#${id}`, item);
  }
  const document = {
    activeElement: null, body: { dataset: {} }, documentElement: { dataset: {} },
    events: {}, getSelection: () => null, addEventListener(name, listener) { this.events[name] = listener; },
    createElement: node, createElementNS: (_ns, tag) => node(tag),
    querySelectorAll: selector => [...roots.values()].flatMap(descendants).filter(item => matches(item, selector)),
    querySelector: selector => {
      if (selector === "#main h1") return roots.get("#main").querySelector("h1");
      return roots.get(selector) ?? [...roots.values()].flatMap(descendants).find(item => matches(item, selector)) ?? null;
    },
  };
  const location = new URL(`http://127.0.0.1:12345/?token=non-secret-ui-test${search}`);
  const calls = [];
  const app = await runInNewContext(`(async () => {
    ${js}
    return { selectProduct, navigate, showIssue, showCandidate, refresh, captureSelection,
      flushContext: () => contextQueue };
  })()`, {
    document, location, URLSearchParams, AbortSignal,
    crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
    window: { addEventListener() {} },
    Date: class extends Date { static now() { return clock.now; } },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setInterval() {}, clearTimeout() {}, setTimeout() {},
    fetch: async (route, options) => {
      calls.push({ route, options });
      if (route === "/api/context") {
        assert.equal(options.method, "POST");
        if (clock.contextError) return { ok: false, json: async () => ({ error: clock.contextError }) };
        return { ok: true, json: async () => ({ accepted: true }) };
      }
      if (route === "/api/investigate" && clock.investigation) {
        assert.equal(options.method, "POST");
        return { ok: clock.investigation.ok, json: async () => clock.investigation.body };
      }
      assert.equal(route, "/api/state");
      assert.equal(options.method, undefined, "Navigation must not retrieve sources, refresh dates or write reviews");
      return { ok: true, json: async () => cloneResponses ? structuredClone(data) : data };
    },
  });

  return { app, location, document, calls, main: roots.get("#main"),
    get details() { return descendants(roots.get("#main")).find(item => item.className === "inline-details" && item.children.length && !item.hidden) ?? null; } };
}

test("investigation buttons dispatch once without a prompt modal and retain errors", async () => {
  const data = await sampleState();
  const product = data.products[0];
  const issue = product.snapshot.issues[0];
  const candidate = product.candidates.find(item => item.evidence.some(evidence => evidence.id === issue.id));
  for (const target of ["issue", "candidate"]) {
    for (const response of [
      { ok: true, body: { dispatched: true, prompt: "Internal handoff content must not be displayed" } },
      { ok: true, body: { dispatched: false } },
      { ok: false, body: { error: "Session handoff unavailable" } },
    ]) {
      const canvas = await canvasHarness(data, "", new Map(), { now: Date.now(), investigation: response });
      canvas.app.selectProduct(product.id);
      canvas.app.navigate("issues");
      canvas.app.showIssue(product, issue);
      if (target === "candidate") canvas.app.showCandidate(product, candidate, false, issue.id);
      const title = target === "issue" ? "Investigate this issue ↗" : "Investigate deeper with Copilot ↗";
      const control = descendants(canvas.main).find(item => item.tag === "button" && item.text === title);
      control.focus();
      control.events.click({ currentTarget: control });
      assert.equal(control.disabled, true);
      await new Promise(setImmediate);
      assert.equal(control.disabled, false);
      assert.equal(canvas.document.activeElement, control, "Handoff does not steal focus");
      const requests = canvas.calls.filter(call => call.route === "/api/investigate");
      assert.equal(requests.length, 1);
      const payload = JSON.parse(requests[0].options.body);
      assert.equal(payload.productId, product.id);
      assert.equal(payload[target === "issue" ? "issueId" : "candidateId"], target === "issue" ? issue.id : candidate.id);
      const toast = canvas.document.querySelector("#toast");
      if (response.body.dispatched === true) {
        assert.equal(toast.hidden, false);
        assert.equal(toast.textContent, "Sent to Copilot. Continue the investigation in chat.");
      } else {
        assert.equal(toast.textContent, "");
        const error = canvas.document.querySelector("#error-banner");
        assert.equal(error.hidden, false);
        assert.match(error.textContent, response.ok ? /did not confirm/ : /Session handoff unavailable/);
      }
      assert.doesNotMatch(canvas.main.textContent, /Internal handoff content/);
      assert.equal(canvas.document.querySelector("#handoff-dialog"), null);
    }
  }
  const html = await readFile(new URL("../skills/ps/dashboard/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../skills/ps/dashboard/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /<dialog|handoff-prompt|handoff-dialog/);
  assert.doesNotMatch(js, /showModal|response\.prompt|handoff-dialog/);
});

test("issue rows and nested concerns toggle inline with accessible focus and scoped context", async () => {
  const data = await sampleState();
  const canvas = await canvasHarness(data);
  const product = data.products[0];
  const [first, second] = product.snapshot.issues;
  canvas.app.selectProduct(product.id);
  canvas.app.navigate("issues");
  const issueButton = issue => descendants(canvas.main).find(item => item.tag === "button" && item.text === issue.title);
  const expandedRows = () => descendants(canvas.main).filter(item => item.className === "issue-detail-row" && !item.hidden);
  const context = async () => {
    await canvas.app.flushContext();
    return JSON.parse(canvas.calls.filter(call => call.route === "/api/context").at(-1).options.body).context;
  };
  issueButton(first).events.click();
  assert.equal(expandedRows().length, 1);
  assert.equal(expandedRows()[0].children[0].colSpan, 4);
  assert.equal(issueButton(first)["aria-expanded"], "true");
  assert.equal(canvas.document.activeElement, issueButton(first));
  assert.equal(canvas.details.id, issueButton(first)["aria-controls"]);
  assert.match(canvas.details.textContent, new RegExp(first.summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const otherRow = issueButton(second).parentElement.parentElement;
  canvas.document.getSelection = () => ({
    rangeCount: 1, isCollapsed: false, toString: () => second.title,
    getRangeAt: () => ({ commonAncestorContainer: otherRow, intersectsNode: () => false }),
  });
  canvas.app.captureSelection();
  assert.equal((await context()).finding.id, second.id, "Highlighting another row must not borrow the expanded issue's identity");
  canvas.document.getSelection = () => null;
  const candidate = product.candidates.find(item => item.evidence.some(issue => issue.id === first.id));
  const relatedButton = () => descendants(canvas.details).find(item => item.tag === "button" && item.text === candidate.title);
  relatedButton().events.click();
  assert.equal((await context()).finding.kind, "candidate");
  assert.equal(expandedRows().length, 1);
  assert.ok(canvas.details.querySelector("form"), "Explicit review remains beside the nested evidence");
  relatedButton().events.click();
  assert.deepEqual((await context()).finding, { kind: "issue", id: first.id });
  issueButton(second).events.click();
  assert.equal(expandedRows().length, 1);
  assert.equal(issueButton(first)["aria-expanded"], "false");
  assert.equal((await context()).finding.id, second.id);
  issueButton(second).events.click();
  assert.equal(expandedRows().length, 0);
  assert.equal((await context()).finding, null);
  assert.equal(canvas.document.activeElement, issueButton(second));
  issueButton(first).events.click();
  const search = canvas.main.querySelector("input");
  search.value = "no matching issue";
  search.events.input();
  assert.equal(expandedRows().length, 0);
  assert.equal((await context()).finding, null);
  const html = await readFile(new URL("../skills/ps/dashboard/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /detail-dialog|detail-content/);
  assert.ok(canvas.calls.every(call => ["/api/state", "/api/context"].includes(call.route)));
});

test("related insights share one card with a nested table and selection scoped to each expandable row", async () => {
  const data = await sampleState();
  const product = data.products[0];
  const issue = product.snapshot.issues.find(issue =>
    product.candidates.filter(candidate => candidate.evidence.some(item => item.id === issue.id)).length > 1);
  const candidates = product.candidates.filter(candidate => candidate.evidence.some(item => item.id === issue.id));
  const canvas = await canvasHarness(data);
  canvas.app.selectProduct(product.id);
  canvas.app.navigate("issues");
  canvas.app.showIssue(product, issue);
  const table = () => canvas.details.querySelector(".related-insights-table");
  const card = canvas.details.querySelector(".related-insights-card");
  assert.ok(card.className.split(" ").includes("card"));
  assert.equal(card.querySelector(".card-top").querySelector("h3").textContent, "Related derived insights");
  assert.equal(card.querySelector("table"), table());
  assert.equal(canvas.details.querySelectorAll(".card").length, 1);
  const rows = () => table().querySelector("tbody").children;
  const control = index => rows()[index * 2].querySelector("button");
  const expanded = () => rows().filter(row => row.className === "related-insight-detail-row" && !row.hidden);
  const context = async () => {
    await canvas.app.flushContext();
    return JSON.parse(canvas.calls.filter(call => call.route === "/api/context").at(-1).options.body).context;
  };
  assert.equal(table().tag, "table");
  assert.equal(table()["aria-label"], "Related derived insights");
  assert.equal(table().querySelector("thead"), null);
  assert.equal(table().querySelector("th"), null);
  const css = await readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.related-insights-table > tbody > tr > td > \.issue-title \{ color: var\(--cp-accent\); \}/);
  assert.equal(rows().length, candidates.length * 2);
  assert.equal(expanded().length, 0);
  assert.deepEqual(candidates.map((candidate, i) => control(i).text), candidates.map(candidate => candidate.title));
  rows()[0].events.click({ target: rows()[0].children[0] });
  assert.equal(expanded().length, 1);
  assert.equal(control(0)["aria-expanded"], "true");
  assert.equal(canvas.document.activeElement, control(0));
  const region = expanded()[0].querySelector(".inline-details");
  assert.equal(region.id, control(0)["aria-controls"]);
  assert.equal(region["aria-labelledby"], control(0).id);
  assert.deepEqual((await context()).finding, { kind: "candidate", id: candidates[0].id });
  rows()[0].events.click({ target: control(0) });
  assert.equal(expanded().length, 1, "Button bubbling must not toggle the row twice");
  const second = rows()[2];
  canvas.document.getSelection = () => ({
    rangeCount: 1, isCollapsed: false, toString: () => candidates[1].title,
    getRangeAt: () => ({ commonAncestorContainer: second, intersectsNode: () => false }),
  });
  second.events.click({ target: second.children[0] });
  assert.equal(control(1)["aria-expanded"], "false", "Selecting text must not expand the row");
  canvas.app.captureSelection();
  assert.deepEqual((await context()).finding, { kind: "candidate", id: candidates[1].id });
  canvas.document.getSelection = () => null;
  control(1).events.click();
  assert.equal(expanded().length, 1);
  assert.equal(control(0)["aria-expanded"], "false");
  assert.equal(control(1)["aria-expanded"], "true");
  assert.equal(canvas.document.activeElement, control(1));
  control(1).events.click();
  assert.equal(expanded().length, 0);
  assert.deepEqual((await context()).finding, { kind: "issue", id: issue.id });
  assert.ok(canvas.calls.every(call => ["/api/state", "/api/context"].includes(call.route)));
});

test("expanded evidence uses plain labeled fields without chevrons, badges or evidence cards", async () => {
  const data = await sampleState();
  const product = data.products[0];
  const issue = product.snapshot.issues[0];
  const canvas = await canvasHarness(data);
  canvas.app.selectProduct(product.id);
  canvas.app.navigate("issues");
  canvas.app.showIssue(product, issue);
  const fields = root => Object.fromEntries(root.querySelectorAll(".detail-field")
    .map(field => [field.querySelector("dt").textContent, field.querySelector("dd").textContent]));
  const values = fields(canvas.details);
  assert.equal(values.Title, issue.title);
  assert.equal(values.Summary, issue.summary);
  assert.equal(values.Issue, `#${issue.number}`);
  assert.equal(values.Repository, issue.repository);
  assert.equal(values.Status, issue.state === "open" ? "Open" : "Closed");
  assert.equal(values.Milestone, issue.milestone);
  assert.equal(values.Labels, issue.labels.join(", "));
  assert.ok(values.Updated);
  assert.equal(values["Source issue"], "No external source URL is attached.");
  assert.equal(canvas.details.querySelector(".badge"), null);
  assert.equal(canvas.details.querySelector(".evidence-item").querySelector(".card"), null);
  assert.equal(canvas.details.querySelector(".evidence-item").className, "evidence-item");
  assert.ok(descendants(canvas.details).some(item => item.tag === "button" && item.text === "Investigate this issue ↗"));
  const candidate = product.candidates[0];
  canvas.app.showCandidate(product, candidate);
  const assessment = fields(canvas.details.querySelector(".detail-fields"));
  assert.equal(assessment["Assessment type"], "Derived insight - not a confirmed fact");
  assert.equal(assessment.Explanation, candidate.explanation);
  assert.equal(assessment.Recommendation, candidate.recommendation);
  assert.equal(canvas.details.querySelector(".badge"), null);
  const css = await readFile(new URL("../skills/ps/dashboard/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.finding-toggle[^{}]*::(?:before|after)/);
  for (const selector of ["evidence-item", "review-form"]) {
    const rule = css.match(new RegExp(`\\.${selector} \\{([^}]+)\\}`))[1];
    assert.doesNotMatch(rule, /border|background|box-shadow|padding/);
  }
});

test("preserved timeline evidence expands inline without replacing historical context", async () => {
  const data = await sampleState();
  const product = data.products[0];
  const review = { id: "ui-review", candidate: product.candidates[0], decision: "approved", reviewer: "Test owner", reviewedAt: "2026-09-24T08:00:00Z", note: "Preserved test evidence" };
  product.timeline = [review];
  const canvas = await canvasHarness(data);
  canvas.app.selectProduct(product.id);
  canvas.app.navigate("timeline");
  const control = () => descendants(canvas.main).find(item => item.tag === "button" && item.text.startsWith("View preserved evidence"));
  control().events.click();
  await canvas.app.flushContext();
  const payload = JSON.parse(canvas.calls.filter(call => call.route === "/api/context").at(-1).options.body);
  assert.deepEqual(payload.context.finding, { kind: "review", id: review.id });
  assert.equal(control()["aria-expanded"], "true");
  assert.match(canvas.details.textContent, /Preserved test evidence/);
  assert.equal(canvas.details.querySelector("form"), null);
  control().events.click();
  await canvas.app.flushContext();
  assert.equal(control()["aria-expanded"], "false");
  assert.equal(canvas.details, null);
});

test("dashboard context follows opened findings and text without triggering investigation or persisting selections", async () => {
  const data = await sampleState();
  const before = JSON.stringify(data);
  const canvas = await canvasHarness(data);
  const lastContext = () => JSON.parse(canvas.calls.filter(call => call.route === "/api/context").at(-1).options.body);
  canvas.app.selectProduct("zava-shop");
  canvas.app.navigate("issues");
  const product = data.products[0];
  canvas.app.showIssue(product, product.snapshot.issues[0]);
  await canvas.app.flushContext();
  assert.deepEqual(lastContext().context.finding, { kind: "issue", id: product.snapshot.issues[0].id });
  const selected = canvas.details.querySelector(".evidence-item");
  canvas.document.getSelection = () => ({
    rangeCount: 1, isCollapsed: false, toString: () => "Checkout observation",
    getRangeAt: () => ({ commonAncestorContainer: selected, intersectsNode: () => false }),
  });
  canvas.app.captureSelection();
  await canvas.app.flushContext();
  assert.equal(lastContext().context.selectedText, "Checkout observation");
  assert.equal(lastContext().context.finding.id, product.snapshot.issues[0].id);
  canvas.document.getSelection = () => ({ rangeCount: 0, isCollapsed: true });
  canvas.app.captureSelection();
  await canvas.app.refresh();
  await canvas.app.flushContext();
  assert.equal(lastContext().context.selectedText, "Checkout observation", "Focus moving to chat preserves selection");
  canvas.app.showIssue(product, product.snapshot.issues[0]);
  await canvas.app.flushContext();
  assert.equal(lastContext().context.finding, null);
  assert.equal(lastContext().context.selectedText, "");
  assert.equal(lastContext().context.view, "issues");
  canvas.app.navigate("overview");
  const card = descendants(canvas.main).find(item => item.dataset.source === "appMonitoring");
  canvas.document.getSelection = () => ({
    rangeCount: 1, isCollapsed: false, toString: () => "x".repeat(2100),
    getRangeAt: () => ({ commonAncestorContainer: card, intersectsNode: () => false }),
  });
  canvas.app.captureSelection();
  await canvas.app.flushContext();
  assert.equal(lastContext().context.view, "appMonitoring", "Highlighting an overview card identifies its source");
  assert.equal(lastContext().context.selectedText.length, 2000);
  assert.equal(lastContext().context.selectionTruncated, true);
  card.events.click({ detail: 1 });
  await canvas.app.flushContext();
  assert.equal(canvas.document.body.dataset.view, "overview", "Highlighting a card must not activate navigation");
  canvas.app.selectProduct("contoso-crm");
  await canvas.app.flushContext();
  assert.equal(lastContext().context.productId, "contoso-crm");
  assert.equal(lastContext().context.selectedText, "");
  assert.equal(lastContext().context.finding, null);
  assert.equal(lastContext().context.view, "overview");
  assert.ok(canvas.calls.every(call => ["/api/state", "/api/context"].includes(call.route)));
  assert.equal(JSON.stringify(data), before);
});

test("selection excludes review forms and unrelated UI, and clears on a new snapshot", async () => {
  const data = await sampleState();
  const canvas = await canvasHarness(data, "", new Map(), { now: Date.now() }, true);
  const product = data.products[0];
  canvas.app.selectProduct(product.id);
  canvas.app.navigate("issues");
  canvas.app.showCandidate(product, product.candidates[0]);
  await canvas.app.flushContext();
  const lastContext = () => JSON.parse(canvas.calls.filter(call => call.route === "/api/context").at(-1).options.body);
  const form = canvas.details.querySelector("form");
  for (const selected of [form, canvas.document.querySelector("#context-status")]) {
    canvas.document.getSelection = () => ({
      rangeCount: 1, isCollapsed: false, toString: () => "private draft",
      getRangeAt: () => ({ commonAncestorContainer: selected, intersectsNode: () => true }),
    });
    canvas.app.captureSelection();
    await canvas.app.flushContext();
    assert.equal(lastContext().context.selectedText, "");
  }
  const evidence = canvas.details.querySelector(".evidence-item");
  canvas.document.getSelection = () => ({
    rangeCount: 1, isCollapsed: false, toString: () => "source observation",
    getRangeAt: () => ({ commonAncestorContainer: evidence, intersectsNode: () => false }),
  });
  canvas.app.captureSelection();
  await canvas.app.flushContext();
  assert.equal(lastContext().context.selectedText, "source observation");
  // Return a new state object as the HTTP API does.
  data.revision++;
  await canvas.app.refresh();
  await canvas.app.flushContext();
  assert.equal(lastContext().revision, 1);
  assert.equal(lastContext().context.finding, null);
  assert.equal(lastContext().context.selectedText, "");
  assert.equal(canvas.details, null);
});

test("context failures remain visible and retries recover; unchanged polling renews only at the lease interval", async () => {
  const clock = { now: Date.now(), contextError: "Context test failure" };
  const canvas = await canvasHarness(await sampleState(), "", new Map(), clock);
  const status = canvas.document.querySelector("#context-status");
  assert.match(status.textContent, /could not be shared: Context test failure/);
  assert.equal(status.dataset.error, "true");
  clock.contextError = "";
  await canvas.app.refresh();
  assert.equal(status.dataset.error, "false");
  assert.match(status.textContent, /Current view/);
  const count = () => canvas.calls.filter(call => call.route === "/api/context").length;
  const accepted = count();
  clock.now += 29_999;
  await canvas.app.refresh();
  assert.equal(count(), accepted);
  clock.now++;
  await canvas.app.refresh();
  assert.equal(count(), accepted + 1);
  const contextCalls = canvas.calls.filter(call => call.route === "/api/context").map(call => JSON.parse(call.options.body));
  assert.ok(contextCalls.every((input, index) => index === 0 || input.sequence > contextCalls[index - 1].sequence));
});

test("first canvas load shows populated cards and details without authoring labels, including legacy saved views", async () => {
  const state = await sampleState();
  const before = JSON.stringify(state);
  const domains = ["issues", "stories", "adoption", "appMonitoring", "support", "business"];
  const noAuthoringLabels = text => assert.doesNotMatch(text, /\b(?:fixtures?|samples?|sampled|fictional|synthetic|simulated|authored)\b/i);
  for (const search of ["", "&previewSources=false", "&previewSources=true"]) {
    const storage = new Map([[
      `ps-view:/?${search.slice(1)}`,
      `productId=zava-shop&previewSources=false`,
    ]]);
    const canvas = await canvasHarness(state, search, search ? storage : new Map());
    if (!search) assert.match(canvas.main.textContent, /My Products/);
    const href = canvas.location.href;
    for (const product of state.products) {
      canvas.app.selectProduct(product.id);
      const cards = descendants(canvas.main).filter(item => item.className === "summary-card");
      assert.deepEqual(cards.map(item => item.dataset.source), domains);
      noAuthoringLabels(canvas.main.textContent);
      for (const card of cards) {
        card.events.click();
        assert.ok(descendants(canvas.main).some(item => item.tag === "tbody" && item.children.length > 0), card.dataset.source);
        noAuthoringLabels(canvas.main.textContent);
      }
      canvas.app.navigate("issues");
      canvas.app.showIssue(product, product.snapshot.issues[0]);
      noAuthoringLabels(canvas.details.textContent);
      canvas.app.navigate("issues");
      canvas.app.showCandidate(product, product.candidates[0]);
      noAuthoringLabels(canvas.details.textContent);
      assert.ok(descendants(canvas.details).some(item => item.type === "checkbox" && item.required), "Human-review confirmation remains");
      assert.equal(canvas.location.href, href, "Preserve the exact host URL across every detail view");
    }
    await canvas.app.flushContext();
    assert.equal(canvas.calls.filter(call => call.route === "/api/state").length, 1);
  }
  assert.equal(JSON.stringify(state), before, "Presentation must not mutate saved samples, provenance or evidence");
  assert.ok(state.products.every(item => item.snapshot.mode === "fixture" && item.previewSources.mode === "fixture"));
});

test("live products stay Issues-only and missing or stale observations remain explicit", async () => {
  const state = await sampleState();
  const product = state.products[0];
  product.snapshot.mode = "live";
  product.snapshot.coverage = { status: "unavailable", repositories: [], note: "Access failed; no data was retrieved." };
  product.assessment = assess(product, product.snapshot, Date.parse("2026-09-24T07:00:00Z"));
  product.previewSources = null;
  product.candidates = [];
  const canvas = await canvasHarness(state, "&previewSources=true");
  canvas.app.selectProduct(product.id);
  assert.equal(descendants(canvas.main).filter(item => item.className === "summary-card").length, 1);
  canvas.app.navigate("issues");
  assert.match(canvas.main.textContent, /Access failed; no data was retrieved/);
  canvas.app.navigate("support");
  assert.match(canvas.main.textContent, /No Customer Support data is available/);
  const sample = state.products[1];
  sample.previewSources.support = null;
  sample.previewSources.stale = true;
  sample.assessment.stale = true;
  canvas.app.selectProduct(sample.id);
  assert.equal(descendants(canvas.main).filter(item => item.className === "summary-card").length, 6);
  assert.match(canvas.main.textContent, /Last-known snapshot:.*Current status is unknown/);
  canvas.app.navigate("support");
  assert.match(canvas.main.textContent, /No Customer Support data is available/);
  canvas.app.navigate("appMonitoring");
  assert.match(canvas.main.textContent, /Historical production outage/);
});

test("stale cards and details retain last-known attention without changing data, freshness or approval", async () => {
  const state = await sampleState(Date.parse("2026-09-26T12:00:00Z"));
  const before = JSON.stringify(state);
  const canvas = await canvasHarness(state);
  for (const product of state.products) {
    assert.equal(product.assessment.stale, true);
    assert.equal(product.assessment.status, "Unknown");
    assert.equal(product.previewSources.stale, true);
    canvas.app.selectProduct(product.id);
    const cards = descendants(canvas.main).filter(item => item.className === "summary-card");
    assert.deepEqual(cards.map(item => item.dataset.attention), ["warning", "warning", "unknown", "error", "warning", "unknown"]);
    for (const card of cards) {
      assert.match(card.textContent, /Last-known snapshot:/, card.dataset.source);
      assert.match(card.textContent, /Current status is unknown/);
      assert.match(card.textContent, /Stale.*Snapshot/);
      const status = descendants(card).find(item => item.id === `source-status-${card.dataset.source}`);
      assert.equal(status.className, card.dataset.attention === "unknown" ? "source-status-unknown" : "visually-hidden");
      assert.equal(status.textContent, card.dataset.attention === "unknown" ? "Unknown"
        : card.dataset.attention === "error" ? "Last-known: Critical / error" : "Last-known: Attention");
      card.events.click();
      const detail = descendants(canvas.main).find(item => item.className.split(" ").includes("source-card"));
      assert.equal(detail.dataset.attention, card.dataset.attention);
      assert.match(detail.textContent, /Last-known findings from a stale snapshot\. Current status is unknown/);
      assert.match(detail.textContent, /Snapshot/);
      if (card.dataset.source === "appMonitoring") {
        assert.ok(descendants(detail).some(item => item.tag === "h3" && item.textContent === "Historical production outage"));
        assert.ok(!descendants(detail).some(item => item.tag === "h3" && item.textContent === "Production outage"));
      }
    }
    canvas.app.navigate("issues");
    canvas.app.showCandidate(product, product.candidates[0]);
    assert.match(canvas.details.textContent, /Refresh stale or incomplete evidence before reviewing/);
  }
  assert.equal(JSON.stringify(state), before);
  assert.equal(canvas.calls.filter(call => call.route === "/api/state").length, 1, "Viewing last-known findings only reads cached state");
});

test("update-time pills format elapsed time at boundaries and retain exact source timestamps", async () => {
  const { updatedAgo, sourceMetadata } = await sourcePresentationHarness();
  const fetchedAt = "2026-09-24T06:00:00.000Z";
  const timestamp = Date.parse(fetchedAt);
  for (const [seconds, expected] of [
    [-300, "just now"], [0, "just now"], [59, "just now"], [60, "1 minute ago"],
    [119, "1 minute ago"], [120, "2 minutes ago"], [3599, "59 minutes ago"],
    [3600, "1 hour ago"], [86399, "23 hours ago"], [86400, "1 day ago"],
    [604800, "1 week ago"], [2592000, "1 month ago"], [31536000, "1 year ago"],
  ]) assert.equal(updatedAgo(fetchedAt, timestamp + seconds * 1000), `Updated ${expected}`);
  assert.throws(() => updatedAgo("invalid"), /Invalid last data update timestamp/);
  const metadata = sourceMetadata("warning", "issues", true, fetchedAt);
  const pill = metadata.children.find(item => item.tag === "time");
  assert.equal(pill.className, "source-updated-pill");
  assert.equal(pill.dateTime, fetchedAt);
  assert.equal(pill.title, `Last data update: ${fetchedAt}`);
  assert.equal(metadata.children[0].className, "visually-hidden");
  assert.equal(sourceMetadata("unknown", "support", false, null).children.length, 1);
});

test("cards and details show source-specific age pills that advance on unchanged cache polls", async () => {
  const state = await sampleState(Date.parse("2026-09-26T12:00:00Z"));
  const current = state.products[0];
  const clock = { now: Date.parse("2026-09-26T12:00:00Z") };
  current.snapshot.fetchedAt = "2026-09-26T10:00:00.000Z";
  current.previewSources.fetchedAt = "2026-09-26T11:59:00.000Z";
  const before = JSON.stringify(state);
  const canvas = await canvasHarness(state, "", new Map(), clock);
  canvas.app.selectProduct(current.id);
  const cards = descendants(canvas.main).filter(item => item.className === "summary-card");
  for (const card of cards) {
    const pill = descendants(card).find(item => item.tag === "time");
    assert.equal(pill.textContent, card.dataset.source === "issues" ? "Updated 2 hours ago" : "Updated 1 minute ago");
    assert.equal(pill.dateTime, card.dataset.source === "issues" ? current.snapshot.fetchedAt : current.previewSources.fetchedAt);
    const status = descendants(card).find(item => item.id === `source-status-${card.dataset.source}`);
    if (card.dataset.attention !== "unknown") assert.equal(status.className, "visually-hidden");
  }
  clock.now += 60000;
  await canvas.app.refresh();
  assert.equal(descendants(canvas.main).filter(item => item.tag === "time" && item.textContent === "Updated 2 minutes ago").length, 5);
  for (const card of cards) {
    card.events.click();
    const pills = descendants(canvas.main).filter(item => item.tag === "time");
    assert.equal(pills.length, 1);
    assert.equal(pills[0].textContent, card.dataset.source === "issues" ? "Updated 2 hours ago" : "Updated 2 minutes ago");
  }
  current.previewSources.support = null;
  canvas.app.selectProduct(current.id);
  const missing = descendants(canvas.main).find(item => item.dataset.source === "support");
  assert.equal(descendants(missing).filter(item => item.tag === "time").length, 0);
  canvas.app.navigate("support");
  assert.equal(descendants(canvas.main).filter(item => item.tag === "time").length, 0);
  current.previewSources.support = JSON.parse(before).products[0].previewSources.support;
  assert.equal(JSON.stringify(state), before, "Only the displayed age changes");
});

test("live Issues retain only complete last-known warnings without exposing preview sources", async () => {
  const state = await sampleState(Date.parse("2026-09-26T12:00:00Z"));
  const product = state.products[0];
  product.snapshot.mode = "live";
  product.previewSources = null;
  const canvas = await canvasHarness(state);
  canvas.app.selectProduct(product.id);
  const cards = descendants(canvas.main).filter(item => item.className === "summary-card");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].dataset.attention, "warning");
  assert.match(cards[0].textContent, /Last-known: Attention/);
  for (const coverage of ["partial", "unavailable"]) {
    product.snapshot.coverage.status = coverage;
    canvas.app.selectProduct(product.id);
    const card = descendants(canvas.main).find(item => item.className === "summary-card");
    assert.equal(card.dataset.attention, "unknown");
    assert.doesNotMatch(card.textContent, /Last-known: Attention/);
    assert.match(card.textContent, /coverage needs a refresh/);
  }
});
