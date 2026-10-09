const $ = (selector) => document.querySelector(selector);
const DASHBOARD_VERSION = "0.7.14";
const params = new URLSearchParams(location.search);
const tokenKey = `ps-capability:${location.host}`;
const token = params.get("token") ?? sessionStorage.getItem(tokenKey);
if (token) sessionStorage.setItem(tokenKey, token);
params.delete("token");
// The host checks this document's exact URL before revealing the canvas.
const viewKey = `ps-view:${location.pathname}?${params}`;
const viewParams = new URLSearchParams(sessionStorage.getItem(viewKey) ?? params.toString());

let state;
let selectedId = viewParams.get("productId") ?? viewParams.get("product") ?? null;
let selectedRole = "Product Owner";
let tab = selectedId ? "overview" : "products";
let filter = "all";
let search = "";
let toastTimer;
let refreshInFlight = false;
let contextViewId;
let contextSequence = 0;
let contextQueue = Promise.resolve();
let contextError = "";
let contextReady = false;
let contextSignature = "";
let contextSentAt = 0;
let activeFinding = null;
let findingIssueId = null;
let selectedText = "";
let selectionFinding = null;
let selectedSource = null;
let selectionTruncated = false;
let selectionTimer;
// Datasource wiring spans these maps, status, routes and renderers; see docs/managing-a-datasource.md.
const viewNames = { issues: "GitHub Issues", stories: "User Stories", adoption: "Product Adoption & Value", appMonitoring: "Operations", support: "Customer Support", business: "Business Reporting", timeline: "Product Timeline" };
const previewViews = ["stories", "adoption", "appMonitoring", "support", "business"];
const sourceProviders = { issues: "GitHub", stories: "Confluence", adoption: "Azure Application Insights", appMonitoring: "Azure Application Insights", support: "Zendesk", business: "Power BI" };
const sourceTopics = { ...viewNames, issues: "Issues" };
const sourceDescriptions = { stories: "Product scope & acceptance", adoption: "Usage, activation, retention & outcomes", appMonitoring: "Operational reliability, performance & diagnostics", support: "Customer-reported friction & escalations", business: "Business outcomes & target progress" };
const insightDisclosure = new Map();
const roleFocus = {
  "Product Owner": { label: "Scope, blockers and decisions", priority: ["needs-decision", "release-blocker", "dependency"] },
  "Engineering Lead": { label: "Technical blockers and dependencies", priority: ["release-blocker", "dependency", "security"] },
  "Developer": { label: "Actionable issues and implementation work", priority: ["release-blocker", "bug", "dependency"] },
  "Leadership": { label: "Delivery risks and significant decisions", priority: ["release-blocker", "needs-decision", "security"] },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, className, action) {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", (event) => {
    const selection = document.getSelection();
    if (event?.detail && selection?.rangeCount && !selection.isCollapsed
      && node.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
    action(event);
  });
  return node;
}
function append(parent, ...children) {
  parent.append(...children.filter(Boolean));
  return parent;
}
function badge(text, variant) { return el("span", `badge ${variant}`, text); }
function sourceStatus(current, source) {
  if (source === "issues") {
    if (current.snapshot.coverage.status !== "complete") return "unknown";
    if (current.assessment.attentionCount > 0) return "warning";
    return current.assessment.stale ? "unknown" : "none";
  }
  const preview = current.previewSources;
  const data = preview?.[source];
  if (!data) return "unknown";
  if (source === "appMonitoring" && data.availability?.state === "outage") return "error";
  if (data.concern) return "warning";
  if (preview.stale) return "unknown";
  if ((source === "stories" && data.total === 0)
    || (source === "adoption" && (data.activationRate === null || data.retentionRate === null
      || !data.features.length || data.features.some(item => item.adoptionRate === null)
      || !data.outcomes.length || data.outcomes.some(item => item.current === null)))
    || (source === "business" && (!data.metrics.length || data.unknownCount > 0))
    || (source === "appMonitoring" && (data.requests.total === 0 || data.availability?.state === "unknown"))) return "unknown";
  return "none";
}
function statusDescription(status, source, stale = false) {
  const historical = stale && (status === "warning" || status === "error");
  const text = { none: "Normal", warning: "Attention", error: "Critical / error", unknown: "Unknown" }[status];
  const label = el("span", status === "unknown" ? "source-status-unknown" : "visually-hidden",
    historical ? `Last-known: ${text}` : text);
  if (source) label.id = `source-status-${source}`;
  return label;
}
function updatedAgo(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid last data update timestamp.");
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "Updated just now";
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]]) {
    if (seconds >= size) return `Updated ${new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(-Math.floor(seconds / size), unit)}`;
  }
}
function sourceMetadata(status, source, stale, fetchedAt) {
  const metadata = append(el("span", "source-metadata"), statusDescription(status, source, stale));
  if (fetchedAt) {
    const pill = el("time", "source-updated-pill", updatedAgo(fetchedAt));
    pill.dateTime = fetchedAt;
    pill.title = `Last data update: ${new Date(fetchedAt).toISOString()}`;
    metadata.append(pill);
  }
  return metadata;
}
function updateTimePills() {
  for (const pill of document.querySelectorAll(".source-updated-pill")) pill.textContent = updatedAgo(pill.dateTime);
}
function sourceIcon(source) {
  const paths = {
    issues: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 7v6m0 3v.1"],
    stories: ["M6 3h9l4 4v14H6Z", "M14 3v5h5M9 12h7m-7 4h7"],
    adoption: ["M4 20V10m6 10V6m6 14v-7m5 7H2", "m14 7 7-5m-5 0h5v5"],
    appMonitoring: ["M3 12h4l3-8 4 16 3-8h4"],
    support: ["M4 4h16v12H9l-5 4Z", "M8 8h8m-8 4h5"],
    business: ["M3 3v18h18", "M7 17v-5h3v5m4 0V7h3v10"],
  };
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("class", "source-glyph");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  for (const d of paths[source]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    icon.append(path);
  }
  return append(el("span", "source-icon"), icon);
}
function sourceHeading(source, detail = false) {
  const provider = el("span", "summary-provider", sourceProviders[source]);
  provider.id = `source-provider-${source}`;
  return append(el(detail ? "div" : "span", detail ? "source-heading" : "summary-title-row"), sourceIcon(source),
    append(el(detail ? "div" : "span", "source-title-text"), el(detail ? "h3" : "span", "summary-title", sourceTopics[source]),
      provider));
}
function product() { return state.products.find((item) => item.id === selectedId); }
function date(value) { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }
function time(value) { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function setError(message) {
  $("#error-banner").textContent = message;
  $("#error-banner").hidden = !message;
}
function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 5000);
}
async function api(route, body, options = {}) {
  const response = await fetch(route, {
    headers: { Authorization: `Bearer ${token ?? ""}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    ...options,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
  return result;
}
function action(run) {
  return async (event) => {
    const target = event?.currentTarget;
    if (target) target.disabled = true;
    try { await run(); }
    catch (error) { setError(error.message); }
    finally { if (target) target.disabled = false; }
  };
}

function contextStatus() {
  const status = $("#context-status");
  status.hidden = !state;
  status.dataset.error = String(Boolean(contextError));
  const text = contextError || (!contextReady ? "Sharing dashboard context with Copilot..."
    : selectedText ? `Text selected for your next Copilot question${selectionTruncated ? " (first 2,000 characters)" : ""}.`
    : activeFinding ? "Expanded finding is the context for your next Copilot question."
    : "Current view is the context for your next Copilot question.");
  if (status.textContent !== text) status.textContent = text;
}
function publishContext(closed = false) {
  if (!state) return contextQueue;
  contextViewId ??= crypto.randomUUID();
  const current = product();
  const view = current ? selectedSource ?? tab : "products";
  // An unavailable card has no evidence context; do not substitute another source.
  const unavailable = previewViews.includes(view) && (!current?.previewSources?.[view] || current.snapshot.mode !== "fixture");
  const input = {
    viewId: contextViewId, revision: state.revision,
    context: closed || unavailable ? null : {
      productId: current?.id ?? null, view, role: selectedRole,
      finding: selectedText ? selectionFinding : activeFinding, selectedText, selectionTruncated,
    },
  };
  const signature = JSON.stringify([input.revision, input.context]);
  if (!closed && signature === contextSignature && contextReady && !contextError && Date.now() - contextSentAt < 30_000) return contextQueue;
  input.sequence = ++contextSequence;
  if (signature !== contextSignature) contextReady = false;
  contextSignature = signature;
  contextStatus();
  const send = async () => {
    try {
      const result = await api("/api/context", input, { signal: AbortSignal.timeout(5000), keepalive: true });
      if (input.sequence === contextSequence) {
        contextReady = result.accepted;
        contextSentAt = Date.now();
        contextError = unavailable ? "This card has no data to share with Copilot."
          : result.accepted ? "" : "Dashboard context changed before it could be shared. Select the finding again.";
      }
    } catch (error) {
      if (input.sequence === contextSequence) {
        contextError = `Dashboard context could not be shared: ${error.message}. Name the product and finding in chat instead.`;
      }
    }
    contextStatus();
  };
  // Serialize updates; sequence numbers also protect against unload requests overtaking them.
  if (closed) return send();
  contextQueue = contextQueue.then(send);
  return contextQueue;
}
function clearSelection() {
  clearTimeout(selectionTimer);
  selectedText = "";
  selectionFinding = null;
  selectedSource = null;
  selectionTruncated = false;
}
function clearFinding() {
  activeFinding = null;
  findingIssueId = null;
  clearSelection();
}
function captureSelection() {
  const selection = document.getSelection();
  // Focus moving to chat can collapse the DOM selection; keep the last deliberate selection.
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element = container.nodeType === 1 ? container : container.parentElement;
  const root = $("#main");
  if (!element || !root.contains(element) || element.closest("input, textarea, form, [contenteditable], [inert], [aria-hidden='true']")) return;
  if ([...root.querySelectorAll("form, input, textarea, [contenteditable]")].some(node => range.intersectsNode(node))) return;
  const text = selection.toString().trim();
  if (!text) return;
  selectedText = text.slice(0, 2000);
  const finding = element.closest("[data-finding-kind]");
  selectionFinding = finding ? { kind: finding.dataset.findingKind, id: finding.dataset.findingId } : null;
  selectedSource = element.closest("[data-source]")?.dataset.source ?? null;
  selectionTruncated = text.length > 2000;
  void publishContext();
}

// Cache polling only; source retrieval belongs to skills, never viewing or navigation.
async function refresh(force = false) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    updateTimePills();
    const next = await api("/api/state");
    if (state && state.revision !== next.revision) clearFinding();
    const changed = !state || state.revision !== next.revision
      || JSON.stringify(state.products.map((p) => [p.assessment, p.previewSources?.stale]))
        !== JSON.stringify(next.products.map((p) => [p.assessment, p.previewSources?.stale]));
    state = next;
    if (selectedId && !state.products.some((item) => item.id === selectedId)) {
      selectedId = null;
      tab = "products";
    }
    setError("");
    if (changed || force) render();
    await publishContext();
  } catch (error) { setError(error.message); }
  finally { refreshInFlight = false; }
}

function selectProduct(id) {
  selectedId = id;
  tab = "overview";
  filter = "all";
  search = "";
  navigate("overview");
}

function navigate(view) {
  clearFinding();
  tab = view;
  if (view === "products") selectedId = null;
  saveView();
  render();
  $("#main h1")?.focus();
  void publishContext();
}

function saveView() {
  viewParams.delete("product");
  if (selectedId === null) viewParams.delete("productId");
  else viewParams.set("productId", selectedId);
  viewParams.delete("previewSources");
  sessionStorage.setItem(viewKey, viewParams.toString());
}

function renderNavigation(current) {
  const list = $("#breadcrumb-list");
  list.replaceChildren();
  const home = current ? button("My Products", "breadcrumb-button", () => navigate("products")) : el("span", "breadcrumb-label", "My Products");
  if (!current) home.setAttribute("aria-current", "page");
  list.append(append(el("li"), home));
  if (!current) return;
  const name = tab === "overview" ? el("span", "breadcrumb-label", current.name) : button(current.name, "breadcrumb-button", () => navigate("overview"));
  if (tab === "overview") name.setAttribute("aria-current", "page");
  const switcher = el("details", "product-switcher");
  const toggle = el("summary", "", "⌄");
  toggle.setAttribute("aria-label", "Switch product");
  const menu = el("ul", "product-menu");
  menu.setAttribute("aria-label", "My Products");
  for (const item of state.products) {
    const choice = button(item.name, "", () => selectProduct(item.id));
    choice.setAttribute("aria-current", String(item.id === selectedId));
    menu.append(append(el("li"), choice));
  }
  append(switcher, toggle, menu);
  list.append(append(el("li"), name, switcher));
  if (tab !== "overview") {
    const section = el("span", "breadcrumb-label", viewNames[tab]);
    section.setAttribute("aria-current", "page");
    list.append(append(el("li"), section));
  }
}

function heading(title, back) {
  const hero = el("section", "hero");
  const row = el("div", "hero-row");
  if (back) {
    const control = button("←", "title-back", back.action);
    control.setAttribute("aria-label", back.label);
    row.append(control);
  }
  const h1 = el("h1", "", title);
  h1.tabIndex = -1;
  append(hero, append(row, h1));
  return hero;
}

function render() {
  $("#version").textContent = `Product Scout ${state.version} · Dashboard ${DASHBOARD_VERSION}`;
  $("#connection-label").textContent = state.hostConnected ? "Copilot connected" : "Copilot disconnected";
  const roleSelect = $("#role-select");
  if (!roleSelect.options.length) for (const role of state.roles) append(roleSelect, el("option", "", role));
  roleSelect.value = selectedRole;
  const current = product();
  renderNavigation(current);
  document.body.dataset.view = tab;
  const main = $("#main");
  const previousInsights = $("#copilot-insights");
  if (previousInsights) insightDisclosure.set(previousInsights.dataset.productId, previousInsights.dataset.expanded === "true");
  const restoreInsightFocus = previousInsights?.dataset.productId === current?.id
    && document.activeElement === previousInsights?.querySelector(".copilot-insights-toggle");
  main.replaceChildren();
  if (!current || tab === "products") {
    renderProducts(main);
    return;
  }
  if (tab === "overview") renderOverview(main, current);
  else {
    main.append(heading(viewNames[tab], { label: `Back to ${current.name}`, action: () => navigate("overview") }));
    if (tab === "timeline") renderTimeline(main, current);
    else if (previewViews.includes(tab)) renderPreviewDetail(main, current, tab);
    else renderIssues(main, current);
  }
  if (restoreInsightFocus) $("#copilot-insights-toggle")?.focus();
}

function renderProducts(main) {
  const hero = heading("My Products");
  hero.append(el("p", "muted", "Your saved products and cached product data."));
  main.append(hero);
  const table = el("table", "products-table");
  table.setAttribute("aria-label", "My Products");
  const head = el("tr");
  for (const label of ["Product", "Release", "Issue status", "Attention", "Last updated"]) {
    const th = el("th", "", label);
    th.scope = "col";
    head.append(th);
  }
  const body = el("tbody");
  for (const item of state.products) {
    append(body, append(el("tr"),
      append(el("td"), button(item.name, "product-open", () => selectProduct(item.id))),
      el("td", "", item.release.version),
      el("td", "", item.assessment.status),
      el("td", "", item.snapshot.coverage.status === "unavailable" ? "Unknown" : `${item.assessment.attentionCount} issues`),
      el("td", "", `${time(item.snapshot.fetchedAt)}${item.assessment.stale ? " · stale" : ""}`)));
  }
  append(table, append(el("thead"), head), body);
  main.append(append(el("div", "table-scroll"), table));
}

function renderOverview(main, current) {
  const hero = heading(current.name, { label: "Back to My Products", action: () => navigate("products") });
  hero.append(el("p", "muted product-context", `${current.release.version}${current.release.targetDate ? ` · Target ${date(current.release.targetDate)}` : ""}`));
  main.append(hero);
  if (current.snapshot.mode === "fixture") main.append(renderCopilotInsights(current));
  const overview = el("section", "summary-grid");
  overview.setAttribute("aria-label", "Insights");
  const card = button("", "summary-card", () => navigate("issues"));
  card.setAttribute("aria-label", "GitHub Issues — view details");
  card.setAttribute("aria-describedby", "source-provider-issues source-status-issues");
  card.dataset.source = "issues";
  card.dataset.attention = sourceStatus(current, "issues");
  const issueHeadline = current.snapshot.coverage.status !== "complete"
    ? "Issue coverage needs a refresh before assessing attention."
    : current.assessment.attentionCount ? `${current.assessment.attentionCount} issues need attention for ${current.release.version}.`
    : "No configured attention signals in the current snapshot.";
  append(card,
    append(el("span", "summary-card-top"),
      sourceHeading("issues"), sourceMetadata(card.dataset.attention, "issues", current.assessment.stale,
        current.snapshot.coverage.status === "unavailable" ? null : current.snapshot.fetchedAt)),
    el("span", "summary-headline", current.assessment.stale && current.snapshot.coverage.status === "complete"
      ? `Last-known snapshot: ${issueHeadline} Current status is unknown.` : issueHeadline),
    el("span", "summary-period", `${current.assessment.stale ? "Stale · " : ""}${current.snapshot.coverage.status} · Snapshot ${time(current.snapshot.fetchedAt)}`));
  const metrics = el("span", "summary-metrics");
  for (const [value, label] of [[current.assessment.openCount, "Open"], [current.assessment.attentionCount, "Attention"], [current.assessment.decisionCount, "Decisions"]]) {
    metrics.append(append(el("span", "metric-chip"), el("strong", "", current.snapshot.coverage.status === "unavailable" ? "—" : value), el("span", "", label)));
  }
  append(card, metrics, el("span", "summary-action", "View details →"));
  main.append(append(overview, card));
  if (current.snapshot.mode === "fixture") {
    overview.dataset.preview = "true";
    for (const source of previewViews) overview.append(previewCard(current, source));
  }
}

// UI-only fixture synthesis, not generated insights or reviewed Timeline evidence.
function renderCopilotInsights(current) {
  const panel = el("section", "copilot-insights");
  panel.id = "copilot-insights";
  panel.dataset.productId = current.id;
  panel.setAttribute("aria-labelledby", "copilot-insights-title");
  const title = el("h2", "copilot-insights-title", "Copilot insights");
  title.id = "copilot-insights-title";
  const header = append(el("div", "copilot-insights-header"), title, badge("Coming soon", "derived"));
  const body = el("div", "copilot-insights-body");
  const preview = current.previewSources;
  const stories = preview?.stories;
  const adoption = preview?.adoption;
  const app = preview?.appMonitoring;
  const support = preview?.support;
  const business = preview?.business;
  append(body,
    el("p", "copilot-insights-note", "Summary of cached observations. Not generated by Copilot; no sources are queried or refreshed."),
    el("p", "copilot-insights-note", `GitHub snapshot: ${previewTime(current.snapshot.fetchedAt)}${preview ? ` · Other sources: ${previewTime(preview.fetchedAt)}` : " · Other sources unavailable"}${current.assessment.stale || preview?.stale ? " · Stale observations: current product status is unknown." : ""}`));
  const grid = el("div", "copilot-insights-grid");
  const situation = append(el("section"), el("h3", "", "Product situation"));
  const completeIssues = current.snapshot.coverage.status === "complete";
  const situationText = completeIssues
    ? `${current.name} has ${current.assessment.openCount} open GitHub issues for ${current.release.version}.`
    : `${current.name}'s GitHub coverage is incomplete; its issue situation is unknown.`;
  situation.append(el("p", "", `${situationText} ${stories
    ? `${stories.accepted} of ${stories.total} user stories are marked accepted.`
    : "User story evidence is unavailable."}`));
  function sourceLinks(sources) {
    const links = el("div", "copilot-insights-links");
    for (const source of sources) links.append(button(viewNames[source], "insight-link", () => navigate(source)));
    return links;
  }
  situation.append(sourceLinks(stories ? ["issues", "stories"] : ["issues"]));
  const items = [];
  const issueAttention = completeIssues && current.assessment.attentionCount > 0;
  const storyAttention = stories && (stories.acceptanceGaps > 0 || stories.decisions > 0);
  if (issueAttention || storyAttention) items.push({
    concern: [
      issueAttention ? `${current.assessment.attentionCount} issues carry attention labels.` : "",
      storyAttention ? `Stories show ${stories.acceptanceGaps} criteria gaps and ${stories.decisions} scope decisions.` : "",
    ].filter(Boolean).join(" "),
    action: `Review flagged delivery work and resolve supported scope or acceptance decisions for ${current.release.version}.`,
    sources: [issueAttention && "issues", storyAttention && "stories"].filter(Boolean),
  });
  const adoptionAttention = adoption && adoption.belowTargetCount > 0;
  const supportAttention = support && support.escalatedCases > 0;
  if (adoptionAttention || supportAttention) items.push({
    concern: [
      adoptionAttention ? `${adoption.belowTargetCount} feature${adoption.belowTargetCount === 1 ? " is" : "s are"} below the adoption target.` : "",
      supportAttention ? `${support.escalatedCases} unresolved support cases are escalated; cases are not unique customers.` : "",
    ].filter(Boolean).join(" "),
    action: adoptionAttention
      ? "Review the affected feature cohorts and any escalated customer feedback before choosing improvements."
      : "Review the unresolved escalated support cases and their themes before choosing follow-up.",
    sources: [adoptionAttention && "adoption", supportAttention && "support"].filter(Boolean),
  });
  const appOutage = app?.availability?.state === "outage";
  const appAttention = app && (appOutage || app.errorEvents > 0 || app.warningEvents > 0 || app.slowOperationCount > 0 || app.requests.failed > 0);
  const businessAttention = business && business.offTargetCount > 0;
  if (appAttention || businessAttention) items.push({
    concern: [
      appOutage ? "Operations record a production outage at the observation time."
        : appAttention ? `Operations show ${app.requests.failed} failed requests and ${app.slowOperationCount} slow operations.` : "",
      businessAttention ? `${business.offTargetCount} reported business metrics miss targets; no causal link is established.` : "",
    ].filter(Boolean).join(" "),
    action: appOutage
      ? "Review the outage observation and verify current availability before deciding a response. Do not infer its cause from window-wide request metrics."
      : appAttention && businessAttention
        ? "Review operational diagnostics and business target gaps separately before attributing impact or choosing an intervention."
        : appAttention ? "Review operational diagnostics and validate current availability before choosing an intervention."
        : "Review the reported business target gaps and metric definitions before choosing an intervention.",
    sources: [appAttention && "appMonitoring", businessAttention && "business"].filter(Boolean),
  });
  const attention = append(el("section"), el("h3", "", "Needs attention"), badge("OBSERVATIONS", "derived"));
  const actions = append(el("section"), el("h3", "", "Recommended next steps"), badge("SUGGESTIONS ONLY", "recommendation"));
  const concerns = el("ol");
  const recommendations = el("ol");
  for (const item of items) {
    concerns.append(append(el("li"), el("p", "", item.concern), sourceLinks(item.sources)));
    recommendations.append(append(el("li"), el("p", "", item.action), sourceLinks(item.sources)));
  }
  attention.append(items.length ? concerns : el("p", "", "No attention items are shown. This does not establish release readiness."));
  actions.append(items.length ? recommendations : el("p", "", "No next steps are suggested without supporting observations."));
  append(grid, situation, attention, actions);
  const content = append(el("div", "copilot-insights-content"), grid);
  content.id = "copilot-insights-content";
  const toggle = button("", "copilot-insights-toggle", () => {
    if (!panel.isConnected) return;
    const expanded = panel.dataset.expanded !== "true";
    insightDisclosure.set(current.id, expanded);
    setExpanded(expanded);
  });
  toggle.id = "copilot-insights-toggle";
  toggle.setAttribute("aria-controls", content.id);
  const chevron = el("span", "insights-chevron");
  chevron.setAttribute("aria-hidden", "true");
  toggle.append(chevron);
  function setExpanded(expanded) {
    panel.dataset.expanded = String(expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} Copilot insights`);
    content.inert = !expanded;
    content.setAttribute("aria-hidden", String(!expanded));
  }
  setExpanded(insightDisclosure.get(current.id) ?? false);
  return append(panel, header, body, content, toggle);
}

function percent(value) { return value === null ? "Unknown" : `${value.toFixed(1)}%`; }
function seconds(value) { return value === null ? "Unknown" : `${(value / 1000).toFixed(2)}s`; }
function signed(value, suffix) { return value === null ? "No baseline" : `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`; }
function previewTime(value) { return `${new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`; }

// Presentation only: retain authoring provenance in saved observations and agent evidence.
function observationText(value) {
  const text = value
    .replace(/; this is an authored sample/g, "")
    .replace(/, not a connected report or the entire business/g, "; coverage does not represent the entire business")
    .replace(/\bauthored sample of\s+/gi, "")
    .replace(/\b(?:authored|fictional|synthetic|simulated)\s+/gi, "")
    .replace(/\bsampled\b/gi, "observed")
    .replace(/\bsamples\b/gi, "observations")
    .replace(/\bsample\b/gi, "snapshot");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function metricValue(value, unit) {
  if (value === null) return "Unknown";
  if (unit === "percent") return percent(value);
  const number = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit === "USD" ? `USD ${number}` : unit === "hours" ? `${number} h` : unit === "minutes" ? `${number} min` : number;
}

// Fixture-only presentation: live sources need their own validated coverage and provenance.
function previewPresentation(source, data) {
  switch (source) {
    case "stories": return {
      headline: `${data.acceptanceGaps} acceptance gaps and ${data.decisions} scope decisions to resolve.`,
      metrics: [[`${data.accepted}/${data.total}`, "Accepted"], [data.acceptanceGaps, "Criteria gaps"], [data.decisions, "Decisions"]],
      detailMetrics: [[data.total, "Stories in scope"], [data.accepted, "Accepted"], [data.acceptanceGaps, "Criteria gaps"], [data.decisions, "PO decisions"]],
    };
    case "adoption": return {
      headline: `${data.activeUsers.toLocaleString()} active users; ${data.belowTargetCount} feature${data.belowTargetCount === 1 ? "" : "s"} below adoption targets.`,
      metrics: [[data.activeUsers.toLocaleString(), "Active users"], [percent(data.activationRate), "Activation"], [percent(data.retentionRate), "Retention"]],
      detailMetrics: [[data.activeUsers.toLocaleString(), "Active users"], [signed(data.activeUserChangePct, "%"), "Active-user change"], [percent(data.activationRate), "Activation"], [percent(data.retentionRate), "Returning cohort"]],
    };
    case "appMonitoring": return {
      headline: data.availability?.state === "outage" ? "Production outage: service unavailable at the observation time."
        : data.requests.total === 0 ? "No request traffic observed; operational reliability is unknown."
        : `${data.requests.failed.toLocaleString()} failed requests and ${data.slowOperationCount} slow operations in the reporting window.`,
      metrics: [[percent(data.requests.failureRate === null ? null : 100 - data.requests.failureRate), "Window success"], [data.requests.failed, "Failed"], [data.slowOperationCount, "Slow operations"]],
      detailMetrics: [[percent(data.requests.failureRate === null ? null : 100 - data.requests.failureRate), "Request success"], [data.requests.failed, "Failed requests"], [data.slowOperationCount, "Slow operations"], [seconds(data.requests.p95Ms), "Request p95"]],
    };
    case "support": return {
      headline: `${data.openCases} unresolved cases; ${data.escalatedCases} escalated for follow-up.`,
      metrics: [[data.openCases, "Open / pending"], [data.escalatedCases, "Escalated"], [data.oldestOpenDays === null ? "Unknown" : `${Math.floor(data.oldestOpenDays)}d`, "Oldest open"]],
      detailMetrics: [[data.totalCases, "Cases"], [data.openCases, "Open / pending"], [data.escalatedCases, "Escalated"], [data.oldestOpenDays === null ? "Unknown" : `${Math.floor(data.oldestOpenDays)}d`, "Oldest unresolved"]],
    };
    case "business": return {
      headline: data.metrics.length && data.offTargetCount === 0 && data.unknownCount === 0
        ? `${data.onTargetCount} business metrics meet their targets.`
        : `${data.offTargetCount} business metrics miss targets; ${data.unknownCount} without a current observation.`,
      metrics: [[data.onTargetCount, "On target"], [data.offTargetCount, "Off target"], [data.unknownCount, "Unknown"]],
      detailMetrics: [[data.metrics.length, "Reported metrics"], [data.onTargetCount, "On target"], [data.offTargetCount, "Off target"], [data.unknownCount, "Unknown"]],
    };
    default: throw new Error(`Unknown preview source: ${source}`);
  }
}

function previewCard(current, source) {
  const preview = current.previewSources;
  const data = preview?.[source];
  const presentation = data ? previewPresentation(source, data) : null;
  const card = button("", "summary-card", () => navigate(source));
  card.setAttribute("aria-label", `${viewNames[source]} — view details`);
  card.setAttribute("aria-describedby", `source-provider-${source} source-status-${source}`);
  card.dataset.source = source;
  card.dataset.attention = sourceStatus(current, source);
  const headline = !data ? "No data is available for this source."
    : preview.stale ? `Last-known snapshot: ${presentation.headline} Current status is unknown.`
    : presentation.headline;
  append(card,
    append(el("span", "summary-card-top"),
      sourceHeading(source), sourceMetadata(card.dataset.attention, source, preview?.stale, data ? preview.fetchedAt : null)),
    el("span", "summary-headline", headline),
    el("span", "summary-period", data ? `${preview.stale ? "Stale · " : ""}Snapshot ${previewTime(preview.fetchedAt)}` : "Unavailable"));
  const metrics = el("span", "summary-metrics");
  if (presentation) {
    for (const [value, label] of presentation.metrics) metrics.append(append(el("span", "metric-chip"), el("strong", "", value), el("span", "", label)));
  }
  append(card, metrics, el("span", "summary-action", "View details →"));
  return card;
}

function previewMetrics(values) {
  const metrics = el("div", "metrics");
  for (const [value, label] of values) metrics.append(append(el("div", "metric"), el("div", "metric-value", value), el("div", "metric-label", label)));
  return metrics;
}

function previewConcern(data, stale, collapseEvidence = false) {
  const concern = data.concern;
  const box = el("section", "preview-insight");
  append(box, badge(concern ? "DERIVED CONCERN" : "ASSESSMENT", concern ? "derived" : "unknown"),
    el("h3", "", concern
      ? `${stale ? "Last-known: " : ""}${observationText(concern.title)}`
      : stale ? "Historical observations — current impact is unknown" : "No concern derived from these observations"));
  if (concern) {
    const evidence = el("ul", "preview-evidence");
    for (const fact of concern.evidence) evidence.append(el("li", "", observationText(fact)));
    box.append(collapseEvidence
      ? append(el("details", "preview-observations"), el("summary", "", `Supporting observations (${concern.evidence.length})`), evidence)
      : evidence);
    append(box, badge("RECOMMENDATION", "recommendation"), el("p", "", observationText(concern.recommendation)));
  } else box.append(el("p", "", "Absence of a concern is not evidence that the product is ready to release."));
  return box;
}

function previewProvenance(preview, source) {
  const details = append(el("details", "source-details"), el("summary", "", "Source & coverage"));
  append(details,
    el("p", "", `Snapshot ${previewTime(preview.fetchedAt)}${preview.stale ? " · stale" : ""}. Viewing this data does not refresh it.`),
    el("p", "", source === "stories"
      ? "Accepted stories and defined criteria are observations, not a release-readiness certificate. These concerns are not approved timeline entries."
      : source === "appMonitoring"
        ? "Request failures, exception/dependency events and warning traces are different observations and may overlap; do not add them as incidents. Log rows group events by message and show occurrence counts, not raw production logs. Operations are a non-overlapping subset of requests, not complete application coverage. p95 values are observed, not averaged; performance targets are product thresholds, not Azure SLAs. No causal link to a release is established."
      : source === "adoption"
        ? "Usage, activation and retention use the stated event and cohort definitions. Feature users may overlap: do not sum them as unique users. Zero eligible users means an unknown rate, not 0% adoption. Observed outcome changes are not proof that a feature caused them."
      : source === "support"
        ? "Counts cover only the listed cases. Open includes pending; escalations count unresolved cases only. Case age is measured at the fixed snapshot, not today. Cases are not distinct customers, confirmed defects or incidents; no SLA breach is inferred."
        : "Reported metrics use the stated scope, units, comparison windows and target direction. Missing observations remain unknown. Business results are not attributed to usage, defects or operational events without evidence."));
  return details;
}

function renderPreviewDetail(main, current, source) {
  const preview = current.snapshot.mode === "fixture" ? current.previewSources : null;
  const card = el("section", "card source-card preview-detail");
  card.dataset.attention = preview ? sourceStatus(current, source) : "unknown";
  card.setAttribute("aria-label", viewNames[source]);
  card.setAttribute("aria-describedby", `source-provider-${source} source-status-${source}`);
  append(card, append(el("div", "card-top"), sourceHeading(source, true),
    sourceMetadata(card.dataset.attention, source, preview?.stale, preview?.[source] ? preview.fetchedAt : null)));
  if (!preview?.[source]) {
    card.append(el("p", "empty", `No ${viewNames[source]} data is available for this product.`));
    main.append(card);
    return;
  }
  const data = preview[source];
  append(card, append(el("p", "source-context"), preview.stale && badge("STALE", "unknown"),
    el("span", "", sourceDescriptions[source])));
  if (preview.stale) card.append(el("p", "source-context", "Last-known findings from a stale snapshot. Current status is unknown; refresh before treating these findings as current."));
  card.append(previewMetrics(previewPresentation(source, data).detailMetrics));
  if (data.window) card.append(el("p", "preview-window", `Current ${previewTime(data.window.start)} – ${previewTime(data.window.end)} · Compared with ${previewTime(data.baselineWindow.start)} – ${previewTime(data.baselineWindow.end)}`));
  if (source === "support") card.append(el("p", "preview-window", `Case snapshot ${previewTime(data.asOf)} · All counts refer to the listed cases.`));
  card.append(previewConcern(data, preview.stale, source !== "stories"));
  switch (source) {
    case "stories": renderStories(card, data); break;
    case "adoption": renderAdoption(card, data); break;
    case "appMonitoring": renderOperations(card, data, preview.stale); break;
    case "support": renderSupport(card, data); break;
    case "business": renderBusiness(card, data); break;
  }
  card.append(previewProvenance(preview, source));
  main.append(card);
}

function renderOperations(card, data, stale) {
  const requests = data.requests;
  if (data.availability) {
    const availability = data.availability;
    append(card, append(el("section", "availability-observation"),
      el("h3", "", availability.state === "outage"
        ? stale ? "Historical production outage" : "Production outage"
        : `${stale ? "Historical production availability" : "Production availability"}: ${availability.state}`),
      el("p", "", observationText(availability.summary)),
      el("p", "", `Observation ${previewTime(availability.observedAt)} · Environment: ${availability.environment}`),
      el("p", "", "Availability is an explicit observation, not inferred from request failure rates. Request metrics below cover the entire historical window, not just the outage.")));
  }
  append(card,
    append(el("div", "table-toolbar"), badge("OBSERVED FACTS & CALCULATED RATES", "fact")),
    el("p", "app-request-summary", "Operational reliability is based on observed requests, not an uptime SLA or a complete incident feed. Prioritize failing and slow operations, then inspect their diagnostics."),
    el("p", "app-request-summary", `${requests.failed.toLocaleString()} failed of ${requests.total.toLocaleString()} requests. Failure-rate change: ${signed(requests.failureDeltaPp, " pp")} (previous ${percent(requests.baselineFailureRate)}). Request p95 change: ${signed(requests.p95ChangePct, "%")} (previous ${seconds(requests.baselineP95Ms)}); target ${seconds(requests.targetP95Ms)}.`),
    el("h3", "app-section-title", "Operation performance"));
  const operations = el("table", "preview-table app-table");
  operations.setAttribute("aria-label", "Operational performance");
  const header = el("tr");
  for (const label of ["Operation", "Requests", "Failed", "p95 duration", "Target", "Signal"]) {
    const cell = el("th", "", label);
    cell.scope = "col";
    header.append(cell);
  }
  const body = el("tbody");
  for (const operation of data.operations) {
    body.append(append(el("tr"),
      el("td", "", operation.name), el("td", "", operation.requests.toLocaleString()), el("td", "", operation.failed.toLocaleString()),
      el("td", "", seconds(operation.p95Ms)), el("td", "", seconds(operation.targetP95Ms)),
      append(el("td"), badge(operation.requests === 0 ? "No traffic · Unknown" : operation.atRisk ? "Needs attention" : "Within target", operation.atRisk ? "attention" : "unknown"))));
  }
  if (!data.operations.length) {
    const empty = el("td", "empty", "No operation observations available.");
    empty.colSpan = 6;
    body.append(append(el("tr"), empty));
  }
  append(operations, append(el("thead"), header), body);
  append(card, append(el("div", "preview-table-scroll"), operations),
    el("h3", "app-section-title", "Operational diagnostics"),
    el("p", "app-request-summary", `${data.errorEvents} error events and ${data.warningEvents} warning events in grouped observations, newest first. These are not unique incidents or users.`));
  const toolbar = el("div", "table-toolbar");
  const filters = el("div", "filter-group");
  const searchInput = el("input", "search");
  searchInput.type = "search";
  searchInput.placeholder = "Search operational logs";
  searchInput.setAttribute("aria-label", "Search operational logs");
  const table = el("table", "preview-table app-table");
  table.setAttribute("aria-label", "Operational diagnostic logs");
  const headings = el("tr");
  for (const label of ["Last observed (UTC)", "Severity / kind", "Operation / message", "Occurrences"]) {
    const cell = el("th", "", label);
    cell.scope = "col";
    headings.append(cell);
  }
  const logs = el("tbody");
  let severity = "all";
  const controls = [];
  function renderLogs() {
    logs.replaceChildren();
    const query = searchInput.value.trim().toLowerCase();
    for (const log of data.logs.filter(log => (severity === "all" || log.severity === severity)
      && `${log.operation} ${log.message} ${log.kind}`.toLowerCase().includes(query))) {
      logs.append(append(el("tr"),
        el("td", "", previewTime(log.timestamp)),
        append(el("td"), badge(log.severity, log.severity === "error" ? "error" : log.severity === "warning" ? "attention" : "unknown"), el("p", "preview-outcome", log.kind)),
        append(el("td"), el("strong", "", log.operation), el("p", "preview-outcome", observationText(log.message))),
        el("td", "", log.occurrences.toLocaleString())));
    }
    if (!logs.children.length) {
      const empty = el("td", "empty", "No logs match these filters.");
      empty.colSpan = 4;
      logs.append(append(el("tr"), empty));
    }
    for (const [control, value] of controls) {
      control.classList.toggle("active", severity === value);
      control.setAttribute("aria-pressed", String(severity === value));
    }
  }
  for (const [label, value] of [["All logs", "all"], ["Errors", "error"], ["Warnings", "warning"]]) {
    const control = button(label, "filter", () => { severity = value; renderLogs(); });
    controls.push([control, value]);
    filters.append(control);
  }
  searchInput.addEventListener("input", renderLogs);
  renderLogs();
  append(table, append(el("thead"), headings), logs);
  append(card, append(toolbar, filters, searchInput), append(el("div", "preview-table-scroll"), table));
}

function renderStories(card, data) {
  const toolbar = el("div", "table-toolbar");
  const filters = el("div", "filter-group");
  const table = el("table", "preview-table");
  table.setAttribute("aria-label", "User stories and product-owner decisions");
  const head = el("tr");
  for (const label of ["User story & outcome", "Status", "Acceptance criteria", "Owner / decision"]) {
    const cell = el("th", "", label);
    cell.scope = "col";
    head.append(cell);
  }
  const body = el("tbody");
  const choices = [];
  function rows(decisionsOnly) {
    body.replaceChildren();
    for (const story of data.items.filter(item => !decisionsOnly || item.decision !== null)) {
      const status = { draft: "Draft", "in-progress": "In progress", accepted: "Accepted" }[story.status];
      body.append(append(el("tr"),
        append(el("td"), el("strong", "", story.title), el("p", "preview-outcome", story.outcome)),
        append(el("td"), badge(status, story.status === "accepted" ? "fact" : "unknown")),
        append(el("td"), badge(story.acceptance === "defined" ? "Defined" : "Missing", story.acceptance === "defined" ? "fact" : "attention")),
        append(el("td"), el("span", "", story.owner), el("p", story.decision ? "preview-decision" : "preview-outcome", story.decision ?? "No open decision"))));
    }
    if (!body.children.length) {
      const cell = el("td", "empty", "No open product-owner decisions.");
      cell.colSpan = 4;
      body.append(append(el("tr"), cell));
    }
    for (const [control, value] of choices) {
      control.classList.toggle("active", value === decisionsOnly);
      control.setAttribute("aria-pressed", String(value === decisionsOnly));
    }
  }
  for (const [label, value] of [["All stories", false], ["Needs my decision", true]]) {
    const control = button(label, "filter", () => rows(value));
    choices.push([control, value]);
    filters.append(control);
  }
  rows(false);
  append(table, append(el("thead"), head), body);
  append(card, append(toolbar, badge("OBSERVED FACTS", "fact"), filters), append(el("div", "preview-table-scroll"), table));
}

function previewTable(label, columns) {
  const table = el("table", "preview-table app-table");
  table.setAttribute("aria-label", label);
  const heading = el("tr");
  for (const column of columns) {
    const cell = el("th", "", column);
    cell.scope = "col";
    heading.append(cell);
  }
  const body = el("tbody");
  append(table, append(el("thead"), heading), body);
  return { body, wrapper: append(el("div", "preview-table-scroll"), table) };
}

function emptyPreviewRows(body, columns, message) {
  if (body.children.length) return;
  const cell = el("td", "empty", message);
  cell.colSpan = columns;
  body.append(append(el("tr"), cell));
}

function renderOutcomeTable(card, items, label) {
  const { body, wrapper } = previewTable(label, ["Metric / definition", "Current", "Previous", "Target", "Change", "Target status"]);
  for (const metric of items) {
    const change = metric.change === null ? metric.current === null ? "No current value" : "No baseline" : metric.unit === "percent"
      ? signed(metric.change, " pp") : `${metric.change > 0 ? "+" : ""}${metricValue(metric.change, metric.unit)}`;
    body.append(append(el("tr"),
      append(el("td"), el("strong", "", observationText(metric.name)), metric.definition && el("p", "preview-outcome", observationText(metric.definition))),
      el("td", "", metricValue(metric.current, metric.unit)), el("td", "", metricValue(metric.baseline, metric.unit)),
      el("td", "", `${metric.direction === "increase" ? "At least" : "At most"} ${metricValue(metric.target, metric.unit)}`),
      el("td", "", change),
      append(el("td"), badge(metric.meetsTarget === null ? "Unknown" : metric.meetsTarget ? "On target" : "Off target", metric.meetsTarget === false ? "attention" : "unknown"))));
  }
  emptyPreviewRows(body, 6, "No outcome observations available.");
  card.append(wrapper);
}

function renderAdoption(card, data) {
  append(card, append(el("div", "table-toolbar"), badge("OBSERVED COHORTS & CALCULATED RATES", "fact")),
    el("p", "app-request-summary", `Active users: ${observationText(data.definitions.activeUsers)} Previous window: ${data.baselineActiveUsers.toLocaleString()} active users.`));
  const cohorts = el("div", "cohort-grid");
  for (const [name, rate, count, eligible, definition] of [
    ["Activation", data.activationRate, data.activation.activatedUsers, data.activation.eligibleUsers, data.definitions.activation],
    ["Retention", data.retentionRate, data.retention.returningUsers, data.retention.cohortUsers, data.definitions.retention],
  ]) cohorts.append(append(el("article", "cohort-card"), el("h3", "", name), el("p", "cohort-rate", percent(rate)),
    el("p", "preview-outcome", `${count.toLocaleString()} of ${eligible.toLocaleString()} eligible users`), el("p", "preview-outcome", observationText(definition))));
  append(card, cohorts, el("h3", "app-section-title", "Feature adoption"));
  const { body, wrapper } = previewTable("Feature adoption", ["Feature", "Users adopting", "Eligible users", "Adoption", "Target", "Signal"]);
  for (const feature of data.features) body.append(append(el("tr"),
    el("td", "", feature.name), el("td", "", feature.adoptedUsers.toLocaleString()), el("td", "", feature.eligibleUsers.toLocaleString()),
    el("td", "", percent(feature.adoptionRate)), el("td", "", percent(feature.targetRate)),
    append(el("td"), badge(feature.adoptionRate === null ? "Unknown" : feature.belowTarget ? "Below target" : "On target", feature.belowTarget ? "attention" : "unknown"))));
  emptyPreviewRows(body, 6, "No feature observations available.");
  append(card, wrapper, el("h3", "app-section-title", "Observed product value"),
    el("p", "app-request-summary", "Outcome observations are separate from feature usage. Changes do not establish that a feature caused an improvement."));
  renderOutcomeTable(card, data.outcomes, "Observed product value");
}

function renderSupport(card, data) {
  const themes = el("div", "support-themes");
  for (const theme of data.themes) themes.append(append(el("span", "metric-chip"), el("strong", "", theme.openCases), el("span", "", theme.name)));
  if (!data.themes.length) themes.append(el("p", "preview-outcome", "No unresolved case themes."));
  append(card, append(el("div", "table-toolbar"), badge("OBSERVED CASES", "fact")),
    el("h3", "app-section-title", "Recurring themes in unresolved cases"), themes,
    el("p", "app-request-summary", "Escalations indicate recorded follow-up needs, not confirmed defects. Multiple cases may come from the same customer."));
  const filters = el("div", "filter-group");
  const { body, wrapper } = previewTable("Customer support cases", ["Case / theme", "Status", "Priority", "Escalated", "Age at snapshot", "Last updated"]);
  const controls = [];
  function rows(filter) {
    body.replaceChildren();
    for (const item of data.cases.filter(item => filter === "all" || (item.status !== "resolved" && (filter === "open" || item.escalated)))) {
      body.append(append(el("tr"),
        append(el("td"), el("strong", "", item.title), el("p", "preview-outcome", item.theme)),
        el("td", "", item.status), append(el("td"), badge(item.priority, item.priority === "normal" ? "unknown" : "attention")),
        el("td", "", item.escalated ? item.status === "resolved" ? "Previously" : "Yes" : "No"),
        el("td", "", `${Math.floor(item.ageDays)} days`), el("td", "", previewTime(item.updatedAt))));
    }
    emptyPreviewRows(body, 6, "No cases match this filter.");
    for (const [control, value] of controls) {
      control.classList.toggle("active", value === filter);
      control.setAttribute("aria-pressed", String(value === filter));
    }
  }
  for (const [label, value] of [["All cases", "all"], ["Open / pending", "open"], ["Escalated", "escalated"]]) {
    const control = button(label, "filter", () => rows(value));
    controls.push([control, value]);
    filters.append(control);
  }
  rows("all");
  append(card, append(el("div", "table-toolbar"), filters), wrapper);
}

function renderBusiness(card, data) {
  append(card, append(el("div", "table-toolbar"), badge("REPORTED METRICS", "fact")),
    el("p", "app-request-summary", observationText(data.scopeNote)),
    el("h3", "app-section-title", "Business outcomes against targets"),
    el("p", "app-request-summary", "Targets follow each metric's direction. Percentage-metric changes are percentage points; monetary values use USD. Missing observations are unknown, not zero."));
  renderOutcomeTable(card, data.metrics, "Business outcome metrics");
}

function renderIssues(main, current) {
  const card = el("section", "card source-card");
  card.dataset.attention = sourceStatus(current, "issues");
  card.setAttribute("aria-label", "GitHub Issues");
  card.setAttribute("aria-describedby", "source-provider-issues source-status-issues");
  const source = sourceHeading("issues", true);
  const issuesLink = el("a", "github-issues-link", "Open GitHub Issues ↗");
  issuesLink.href = "https://github.com/issues";
  issuesLink.target = "_blank";
  issuesLink.rel = "noopener noreferrer";
  const actions = append(el("div", "source-actions"), issuesLink);
  append(card, append(el("div", "card-top"), source, append(el("div", "source-controls"),
    sourceMetadata(card.dataset.attention, "issues", current.assessment.stale,
      current.snapshot.coverage.status === "unavailable" ? null : current.snapshot.fetchedAt), actions)),
    el("p", "source-context", `${current.snapshot.coverage.repositories.join(", ") || "No repository coverage"} · ${current.release.version}`));
  if (current.assessment.stale) card.append(el("p", "source-context", "Last-known findings from a stale snapshot. Current status is unknown; refresh before treating these findings as current."));
  const unknownCounts = current.snapshot.coverage.status === "unavailable";
  const metrics = el("div", "metrics");
  for (const [value, label, accent] of [[current.assessment.openCount, "Open in snapshot", false], [current.assessment.attentionCount, "Need attention", true], [current.assessment.decisionCount, "Decision-labeled issues", false], [current.assessment.closedCount, "Closed in snapshot", false]]) {
    append(metrics, append(el("div", `metric ${accent ? "accent" : ""}`), el("div", "metric-value", unknownCounts ? "—" : value), el("div", "metric-label", label)));
  }
  card.append(metrics);
  const insight = current.candidates.find((candidate) => candidate.kind === "correlation") ?? current.candidates[0];
  if (insight) {
    const reference = { kind: "candidate", id: insight.id };
    const expanded = activeFinding?.kind === "candidate" && activeFinding.id === insight.id && !findingIssueId;
    const box = el("div", "insight-callout");
    append(box, el("span", "insight-spark", "✧"), append(el("div"), badge("DERIVED INSIGHT", "derived"), el("h3", "", insight.title),
      el("p", "", `${insight.evidence.length} linked issue${insight.evidence.length === 1 ? "" : "s"} point to a potential delivery concern. Review the facts before drawing a conclusion.`),
      findingButton(reference, `Explore evidence${insight.review ? ` · ${insight.review.decision}` : ""}`, "insight-link", () => showCandidate(current, insight), expanded)));
    card.append(box);
    const details = inlineDetails(reference, expanded ? candidateDetails(current, insight) : el("div"));
    details.hidden = !expanded;
    card.append(append(el("div", "insight-details"), details));
  } else card.append(el("p", "scope-note empty", unknownCounts ? "Issue data is unavailable. Connect repositories and investigate through Copilot." : "No configured attention signals in this snapshot. This does not establish release readiness."));
  const toolbar = el("div", "table-toolbar");
  const filters = el("div", "filter-group");
  for (const [key, label] of [["all", "All issues"], ["attention", "Needs attention"], ["open", "Open"], ["closed", "Closed"]]) {
    const control = button(label, `filter ${filter === key ? "active" : ""}`, () => { clearFinding(); filter = key; render(); void publishContext(); });
    control.setAttribute("aria-pressed", String(filter === key));
    filters.append(control);
  }
  const input = el("input", "search");
  input.type = "search";
  input.placeholder = "Search issues...";
  input.setAttribute("aria-label", "Search issues");
  input.value = search;
  input.addEventListener("input", () => { search = input.value; renderRows(body, current); });
  append(toolbar, filters, input);
  card.append(toolbar);
  const table = el("table", "issue-table");
  const head = el("tr");
  for (const text of ["ISSUE", "STATE", "SIGNALS", "UPDATED"]) {
    const th = el("th", "", text);
    th.scope = "col";
    head.append(th);
  }
  const body = el("tbody");
  append(table, append(el("thead"), head), body);
  card.append(table);
  renderRows(body, current);
  append(card, append(el("div", "card-footer"),
    el("span", "", `Snapshot ${time(current.snapshot.fetchedAt)} · ${current.snapshot.coverage.status} coverage${current.assessment.stale ? " · stale" : ""}`),
    el("span", "", current.changes.hasBaseline ? `${current.changes.items.length} changed since previous snapshot` : "Changes since previous snapshot: no baseline")));
  card.append(sourceDetails(current));
  main.append(card);
}

function renderRows(body, current) {
  body.replaceChildren();
  const attentionLabels = [...current.rules.blockingLabels, ...current.rules.attentionLabels];
  const focus = roleFocus[selectedRole].priority;
  const score = (issue) => issue.state === "closed" ? 100 : Math.min(50, ...issue.labels.map((label) => focus.includes(label) ? focus.indexOf(label) : 50));
  const issues = current.snapshot.issues.filter((issue) =>
    (filter === "all" || (filter === "attention" ? issue.state === "open" && issue.labels.some((label) => attentionLabels.includes(label)) : issue.state === filter))
    && `${issue.title} ${issue.id} ${issue.labels.join(" ")}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => score(a) - score(b) || b.updatedAt.localeCompare(a.updatedAt));
  const expandedIssueId = activeFinding?.kind === "issue" ? activeFinding.id : findingIssueId;
  if (expandedIssueId && !issues.some(issue => issue.id === expandedIssueId)) {
    clearFinding();
    void publishContext();
  }
  if (!issues.length) {
    const cell = el("td", "empty", "No issues match this view.");
    cell.colSpan = 4;
    body.append(append(el("tr"), cell));
  }
  for (const issue of issues) {
    const expanded = activeFinding?.kind === "issue" && activeFinding.id === issue.id || findingIssueId === issue.id;
    const reference = { kind: "issue", id: issue.id };
    const row = findingRow(reference, expanded, () => showIssue(current, issue));
    const title = append(el("td"), findingButton(reference, issue.title, "issue-title", () => showIssue(current, issue), expanded),
      el("div", "issue-meta", `#${issue.number} · ${issue.repository} · ${issue.milestone ?? "No milestone"}`));
    const status = append(el("td"), el("span", `issue-state ${issue.state}`, `${issue.state === "open" ? "◉" : "✓"} ${issue.state === "open" ? "Open" : "Closed"}`));
    const signals = el("td");
    for (const label of issue.labels.filter((label) => !label.startsWith(current.rules.componentPrefix))) {
      append(signals, el("span", `issue-label ${current.rules.blockingLabels.includes(label) ? "risk" : label === "needs-decision" ? "decision" : ""}`, label));
    }
    append(row, title, status, signals, el("td", "issue-meta", date(issue.updatedAt)));
    body.append(row);
    const cell = el("td");
    cell.colSpan = 4;
    cell.append(inlineDetails(reference, expanded ? issueDetails(current, issue) : el("div")));
    const detailRow = append(el("tr", "issue-detail-row"), cell);
    detailRow.hidden = !expanded;
    body.append(detailRow);
  }
}

function renderTimeline(main, current) {
  const card = el("section", "card");
  append(card, append(el("div", "card-top"), append(el("div"), el("h3", "", "Product Timeline"), el("p", "source-subtitle", "Human-reviewed insights. Original evidence preserved."))));
  if (!current.timeline.length) {
    append(card, append(el("div", "empty"), el("h3", "", "Your product memory starts with a decision."), el("p", "", "Explore an issue or derived insight, inspect its evidence, and explicitly approve it. Unreviewed and rejected insights never appear here.")));
  }
  for (const review of current.timeline) {
    const item = append(el("article", "timeline-item"), badge("HUMAN-REVIEWED INSIGHT", "approved"), el("h3", "", review.candidate.title),
      el("div", "timeline-meta", `${time(review.reviewedAt)} · ${review.reviewer} · ${review.candidate.release}`),
      el("p", "", review.note || review.candidate.explanation),
      findingButton({ kind: "review", id: review.id }, `View preserved evidence (${review.candidate.evidence.length})`, "insight-link",
        () => showCandidate(current, { ...review.candidate, review }, true),
        activeFinding?.kind === "review" && activeFinding.id === review.id));
    const expanded = activeFinding?.kind === "review" && activeFinding.id === review.id;
    const details = inlineDetails({ kind: "review", id: review.id }, expanded ? candidateDetails(current, { ...review.candidate, review }, true) : el("div"));
    details.hidden = !expanded;
    item.append(details);
    card.append(item);
  }
  main.append(card);
  main.append(el("p", "scope-note", "An approval records a reviewed insight, not an objective fact, a shipped release or a GitHub change."));
}

function findingKey(reference, issueId = null) {
  return `${reference.kind}-${encodeURIComponent(reference.id)}${issueId ? `-in-${encodeURIComponent(issueId)}` : ""}`;
}
function findingRow(reference, expanded, run) {
  const row = el("tr", expanded ? "issue-expanded" : "");
  row.dataset.findingKind = reference.kind;
  row.dataset.findingId = reference.id;
  row.addEventListener("click", event => {
    if (event.target.closest("button, a, input, textarea, select") || document.getSelection()?.toString().trim()) return;
    run();
  });
  return row;
}
function findingButton(reference, title, className, run, expanded, issueId = null) {
  const key = findingKey(reference, issueId);
  const control = button(title, `${className} finding-toggle`, run);
  control.id = `finding-toggle-${key}`;
  control.setAttribute("aria-expanded", String(expanded));
  control.setAttribute("aria-controls", `finding-panel-${key}`);
  return control;
}
function inlineDetails(reference, content, issueId = null) {
  const key = findingKey(reference, issueId);
  content.id = `finding-panel-${key}`;
  content.className = "inline-details";
  content.dataset.findingKind = reference.kind;
  content.dataset.findingId = reference.id;
  content.setAttribute("role", "region");
  content.setAttribute("aria-labelledby", `finding-toggle-${key}`);
  return content;
}
function renderFinding(reference, issueId = null) {
  clearSelection();
  render();
  $(`[id="finding-toggle-${findingKey(reference, issueId)}"]`)?.focus();
  void publishContext();
}
function detailField(label, value, wide = false) {
  return append(el("div", wide ? "detail-field wide" : "detail-field"), el("dt", "", label),
    typeof value === "string" ? el("dd", "", value) : append(el("dd"), value));
}
function evidence(issue) {
  const fields = append(el("dl", "detail-fields"),
    detailField("Title", issue.title, true),
    detailField("Summary", issue.summary, true),
    detailField("Issue", `#${issue.number}`),
    detailField("Repository", issue.repository),
    detailField("Status", issue.state === "open" ? "Open" : "Closed"),
    detailField("Milestone", issue.milestone ?? "Not available"),
    detailField("Labels", issue.labels.join(", ") || "None"),
    detailField("Updated", time(issue.updatedAt)));
  if (issue.url) {
    const link = el("a", "", "Open source issue");
    link.href = issue.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    fields.append(detailField("Source issue", link, true));
  } else fields.append(detailField("Source issue", "No external source URL is attached.", true));
  return append(el("article", "evidence-item"), fields);
}
function sourceDetails(current) {
  const content = append(el("details", "source-details"), el("summary", "", "Source & coverage"));
  if (current.snapshot.mode === "live") append(content, el("p", "", current.snapshot.coverage.note),
    el("p", "evidence-source", `GitHub MCP snapshot · ${current.snapshot.source}`));
  append(content,
    el("p", "", `Fetched ${time(current.snapshot.fetchedAt)} · ${current.snapshot.coverage.status}${current.assessment.stale ? " · stale" : ""}`),
    current.repositories.length && el("p", "", `Configured repositories: ${current.repositories.join(", ")}`),
    el("p", "", current.assessment.limitations));
  if (current.changes.hasBaseline) {
    append(content, el("h3", "", `Changes since ${time(current.changes.since)}`));
    if (!current.changes.items.length) content.append(el("p", "", "No observed issue changes between these snapshots."));
    for (const change of current.changes.items) content.append(el("p", "", `${change.change}: ${change.id} — ${change.title}`));
  } else content.append(el("p", "", "There is no previous comparable snapshot. No change trend is inferred."));
  return content;
}
function showIssue(current, issue) {
  const reference = { kind: "issue", id: issue.id };
  const expanded = activeFinding?.kind === "issue" && activeFinding.id === issue.id || findingIssueId === issue.id;
  activeFinding = expanded ? null : reference;
  findingIssueId = null;
  renderFinding(reference);
}
function issueDetails(current, issue) {
  const content = el("div");
  content.append(evidence(issue));
  const candidates = current.candidates.filter((candidate) => candidate.evidence.some((item) => item.id === issue.id));
  if (candidates.length) {
    const section = append(el("section", "card detail-section related-insights-card"),
      append(el("div", "card-top"), el("h3", "", "Related derived insights")));
    const table = el("table", "related-insights-table");
    table.setAttribute("aria-label", "Related derived insights");
    const body = el("tbody");
    table.append(body);
    for (const candidate of candidates) {
      const reference = { kind: "candidate", id: candidate.id };
      const expanded = activeFinding?.kind === "candidate" && activeFinding.id === candidate.id && findingIssueId === issue.id;
      const toggle = () => showCandidate(current, candidate, false, issue.id);
      const row = findingRow(reference, expanded, toggle);
      row.append(append(el("td"), findingButton(reference, candidate.title, "issue-title", toggle, expanded, issue.id)));
      const details = inlineDetails(reference, expanded ? candidateDetails(current, candidate) : el("div"), issue.id);
      details.hidden = !expanded;
      const detailRow = append(el("tr", "related-insight-detail-row"), append(el("td"), details));
      detailRow.hidden = !expanded;
      append(body, row, detailRow);
    }
    section.append(table);
    content.append(section);
  }
  content.append(append(el("div", "dialog-actions"), button("Investigate this issue ↗", "primary", action(() => investigate("Investigate this issue, verify its current state and explain its impact.", { issueId: issue.id })))));
  return content;
}
function showCandidate(current, candidate, historical = false, issueId = null) {
  const reference = { kind: historical ? "review" : "candidate", id: historical ? candidate.review.id : candidate.id };
  const expanded = activeFinding?.kind === reference.kind && activeFinding.id === reference.id && findingIssueId === issueId;
  activeFinding = expanded ? (issueId ? { kind: "issue", id: issueId } : null) : reference;
  findingIssueId = expanded ? null : issueId;
  renderFinding(reference, issueId);
}
function candidateDetails(current, candidate, historical = false) {
  const content = el("div");
  const fields = append(el("dl", "detail-fields"),
    detailField("Title", candidate.title, true),
    detailField("Assessment type", "Derived insight - not a confirmed fact", true),
    detailField("Explanation", candidate.explanation, true),
    detailField("Recommendation", candidate.recommendation, true),
    detailField("Snapshot", time(candidate.fetchedAt)),
    detailField("Coverage", candidate.coverage.status));
  if (candidate.mode === "live") fields.append(detailField("Source", "GitHub MCP"));
  content.append(fields);
  const facts = append(el("section", "detail-section"), el("h3", "", `Supporting evidence (${candidate.evidence.length})`));
  candidate.evidence.forEach((issue) => facts.append(evidence(issue)));
  content.append(facts);
  if (candidate.review) {
    content.append(append(el("dl", "detail-fields review-details"),
      detailField("Decision", candidate.review.decision),
      detailField("Reviewed by", candidate.review.reviewer),
      detailField("Reviewed on", time(candidate.review.reviewedAt)),
      detailField("Decision note", candidate.review.note || "No additional decision note.", true)));
  } else {
    content.append(reviewForm(current, candidate));
  }
  if (!historical) content.append(append(el("div", "dialog-actions"), button("Investigate deeper with Copilot ↗", "", action(() => investigate("Investigate this derived concern. Verify source facts, challenge the correlation and identify the decision required.", { candidateId: candidate.id })))));
  return content;
}

function reviewForm(current, candidate) {
  const form = el("form", "review-form");
  append(form, el("h3", "", "Make a deliberate decision"), el("p", "scope-note", "Approval adds this exact insight and evidence to your local Product Timeline. It does not change GitHub."));
  const reviewer = el("input");
  reviewer.id = "reviewer";
  reviewer.required = true;
  reviewer.minLength = 2;
  reviewer.maxLength = 120;
  reviewer.placeholder = "Your name or team";
  const reviewerLabel = el("label", "", "Reviewed by");
  reviewerLabel.htmlFor = reviewer.id;
  const note = el("textarea");
  note.id = "review-note";
  note.maxLength = 2000;
  note.placeholder = "Optional: the decision, rationale or next step you want remembered";
  const noteLabel = el("label", "", "Decision note");
  noteLabel.htmlFor = note.id;
  const confirmed = el("input");
  confirmed.type = "checkbox";
  confirmed.required = true;
  const confirmLabel = append(el("label", "review-check"), confirmed, el("span", "", "I reviewed the wording and supporting evidence, and choose to record this decision."));
  const error = el("div", "inline-error");
  error.setAttribute("role", "alert");
  const blocked = current.assessment.stale || current.snapshot.coverage.status !== "complete";
  if (blocked) append(form, el("p", "inline-error", "Refresh stale or incomplete evidence before reviewing."));
  const approve = button("Approve to timeline", "primary", () => {});
  approve.type = "submit";
  approve.value = "approved";
  const reject = button("Reject insight", "", () => {});
  reject.type = "submit";
  reject.value = "rejected";
  approve.disabled = reject.disabled = blocked;
  append(form, reviewerLabel, reviewer, noteLabel, note, confirmLabel, error, append(el("div", "dialog-actions"), reject, approve));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const decision = event.submitter?.value;
    if (!["approved", "rejected"].includes(decision)) return;
    approve.disabled = reject.disabled = true;
    error.textContent = "";
    try {
      await api("/api/review", { productId: current.id, candidateId: candidate.id, evidenceHash: candidate.evidenceHash, decision, reviewer: reviewer.value, note: note.value });
      clearFinding();
      await refresh(true);
      toast(decision === "approved" ? "Insight approved. Evidence preserved in Product Timeline." : "Insight rejected. It was not added to Product Timeline.");
    } catch (failure) {
      error.textContent = failure.message;
      approve.disabled = reject.disabled = false;
    }
  });
  return form;
}
async function investigate(question, context = {}) {
  const response = await api("/api/investigate", { productId: selectedId, role: selectedRole, question, ...context });
  if (response.dispatched !== true) throw new Error("Copilot did not confirm the investigation handoff. Reopen Product Scout in GitHub Copilot App.");
  toast("Sent to Copilot. Continue the investigation in chat.");
}

$("#theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("ps-theme", next);
});
$("#role-select").addEventListener("change", (event) => { selectedRole = event.target.value; clearFinding(); render(); void publishContext(); });
$("#settings-toggle").addEventListener("click", () => {
  const panel = $("#canvas-settings");
  panel.hidden = !panel.hidden;
  $("#settings-toggle").setAttribute("aria-expanded", String(!panel.hidden));
});
$("#brand-link").addEventListener("click", (event) => { event.preventDefault(); navigate("products"); });
for (const root of [$("#main")]) {
  root.addEventListener("pointerdown", () => {
    clearSelection();
    void publishContext();
  });
  root.addEventListener("input", () => {
    clearSelection();
    void publishContext();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && selectedText) { clearSelection(); void publishContext(); }
  });
}
document.addEventListener("selectionchange", () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(captureSelection, 100);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
window.addEventListener("pagehide", () => { void publishContext(true); });
window.addEventListener("pageshow", (event) => { if (event.persisted) void refresh(); });
await refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
