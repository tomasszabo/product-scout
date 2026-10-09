import { VERSION, ensure } from "./model.mjs";

const STORY_FIELDS = ["localKey", "title", "outcome", "status", "acceptance", "decision", "owner"];
const JOURNEY_FIELDS = ["localKey", "name", "attempts", "successes", "affectedUsers", "p95Ms", "baselineAttempts", "baselineSuccesses", "baselineP95Ms", "targetSuccessRate", "targetP95Ms"];
const REQUEST_FIELDS = ["total", "failed", "p95Ms", "baselineTotal", "baselineFailed", "baselineP95Ms", "targetP95Ms"];
const OPERATION_FIELDS = ["localKey", "name", "requests", "failed", "p95Ms", "targetP95Ms"];
const LOG_FIELDS = ["localKey", "timestamp", "severity", "kind", "operation", "message", "occurrences"];
const OUTCOME_FIELDS = ["localKey", "name", "unit", "current", "baseline", "target", "direction"];
const CASE_FIELDS = ["localKey", "title", "theme", "status", "priority", "escalated", "createdAt", "updatedAt"];
const DAY_MS = 86_400_000;
const PRODUCT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCAL_KEY = /^sample-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function shape(value, fields, name, optional = []) {
  ensure(value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${name} must be a plain object.`);
  ensure(Reflect.ownKeys(value).every((key) => fields.includes(key) || optional.includes(key))
    && fields.every((key) => Object.hasOwn(value, key)), `${name} must contain exactly: ${fields.join(", ")}${optional.length ? `; optional: ${optional.join(", ")}` : ""}.`);
}

function text(value, field, max = 2000) {
  ensure(typeof value === "string" && value.trim().length > 0 && value.length <= max, `${field} must be a non-empty string (max ${max}).`);
}

function list(value, field, max) {
  ensure(Array.isArray(value) && value.length <= max, `${field} must be an array (max ${max}).`);
  for (let index = 0; index < value.length; index++) {
    ensure(Object.hasOwn(value, index), `${field} must not contain empty slots.`);
  }
}

function timestamp(value, field) {
  ensure(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)), `${field} must be an ISO UTC timestamp.`);
  ensure(new Date(value).toISOString().slice(0, 19) === value.slice(0, 19), `${field} is not a valid date.`);
  return Date.parse(value);
}

function count(value, field) {
  ensure(Number.isSafeInteger(value) && value >= 0, `${field} must be a non-negative safe integer.`);
}

function latency(value, field) {
  ensure(Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER, `${field} must be finite non-negative milliseconds.`);
}

function clock(now) {
  ensure(Number.isFinite(now) && Number.isFinite(new Date(now).getTime()), "now must be a valid epoch timestamp.");
}

function windows({ window, baselineWindow }, fetchedAt) {
  const times = [window, baselineWindow].map((value, index) => {
    const name = index ? "baselineWindow" : "window";
    shape(value, ["start", "end"], name);
    const start = timestamp(value.start, `${name}.start`);
    const end = timestamp(value.end, `${name}.end`);
    ensure(start < end && end <= fetchedAt, `${name} must have positive duration and end by fetchedAt.`);
    return { start, end };
  });
  ensure(times[0].start === times[1].end && times[0].end - times[0].start === times[1].end - times[1].start,
    "Monitoring windows must be adjacent with equal durations.");
  return times;
}

function percentage(numerator, denominator) {
  return denominator ? numerator / denominator * 100 : null;
}

function delta(current, baseline) {
  return current !== null && baseline !== null ? current - baseline : null;
}

function p95Change(current, baseline) {
  return relativeChange(current, baseline, "Latency comparison");
}

function relativeChange(current, baseline, field = "Comparison") {
  if (current === null || baseline === null || baseline === 0) return null;
  const change = (current - baseline) / baseline * 100;
  ensure(Number.isFinite(change), `${field} must be finite.`);
  return change;
}

function weeklyWindows(value, fetchedAt) {
  const times = windows(value, fetchedAt);
  ensure(times[0].end - times[0].start === 7 * DAY_MS, "Weekly windows must span seven days.");
  return times;
}

function uniqueName(value, names, field) {
  text(value, field, 500);
  const name = value.trim().toLowerCase();
  ensure(!names.has(name), `Duplicate ${field}.`);
  names.add(name);
}

function metricValue(value, unit, field, nullable = false) {
  if (nullable && value === null) return;
  ensure(Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER, `${field} must be a finite non-negative value.`);
  if (unit === "percent") ensure(value <= 100, `${field} percent must be between 0 and 100.`);
  if (unit === "count") count(value, field);
}

function validateOutcomes(items, units, localKey, business = false) {
  list(items, business ? "metrics" : "outcomes", 100);
  const names = new Set();
  for (const item of items) {
    shape(item, business ? [...OUTCOME_FIELDS, "definition"] : OUTCOME_FIELDS, business ? "metric" : "outcome");
    localKey(item.localKey);
    uniqueName(item.name, names, "metric name");
    ensure(units.includes(item.unit), "Invalid metric unit.");
    ensure(["increase", "decrease"].includes(item.direction), "Invalid metric direction.");
    metricValue(item.current, item.unit, "current", true);
    metricValue(item.baseline, item.unit, "baseline", true);
    metricValue(item.target, item.unit, "target");
    if (business) {
      text(item.definition, "metric.definition");
      relativeChange(item.current, item.baseline);
    }
  }
}

function cohort(numerator, denominator, field, activeUsers) {
  count(numerator, `${field} numerator`);
  count(denominator, `${field} denominator`);
  ensure(numerator <= denominator && numerator <= activeUsers, `${field} numerator cannot exceed its denominator or activeUsers.`);
}

function validateAdoption(adoption, fetchedAt, localKey) {
  shape(adoption, ["window", "baselineWindow", "activeUsers", "baselineActiveUsers", "definitions", "activation", "retention", "features", "outcomes"], "adoption");
  weeklyWindows(adoption, fetchedAt);
  count(adoption.activeUsers, "activeUsers");
  count(adoption.baselineActiveUsers, "baselineActiveUsers");
  shape(adoption.definitions, ["activeUsers", "activation", "retention"], "definitions");
  for (const [key, value] of Object.entries(adoption.definitions)) text(value, `definitions.${key}`);
  shape(adoption.activation, ["eligibleUsers", "activatedUsers"], "activation");
  cohort(adoption.activation.activatedUsers, adoption.activation.eligibleUsers, "activation", adoption.activeUsers);
  shape(adoption.retention, ["cohortUsers", "returningUsers"], "retention");
  cohort(adoption.retention.returningUsers, adoption.retention.cohortUsers, "retention", adoption.activeUsers);
  ensure(adoption.retention.cohortUsers <= adoption.baselineActiveUsers, "Retention cohort cannot exceed baselineActiveUsers.");
  list(adoption.features, "features", 100);
  const names = new Set();
  for (const feature of adoption.features) {
    shape(feature, ["localKey", "name", "eligibleUsers", "adoptedUsers", "targetRate"], "feature");
    localKey(feature.localKey);
    uniqueName(feature.name, names, "feature name");
    cohort(feature.adoptedUsers, feature.eligibleUsers, "feature", adoption.activeUsers);
    metricValue(feature.targetRate, "percent", "targetRate");
  }
  validateOutcomes(adoption.outcomes, ["minutes", "percent", "count"], localKey);
}

function validateSupport(support, fetchedAt, localKey) {
  shape(support, ["provider", "sourceUrl", "asOf", "cases"], "support");
  ensure(support.provider === "Zendesk" && support.sourceUrl === null, "Support must be a Zendesk fixture with null sourceUrl.");
  const asOf = timestamp(support.asOf, "support.asOf");
  ensure(asOf <= fetchedAt, "Support asOf cannot be later than fetchedAt.");
  list(support.cases, "cases", 1000);
  const titles = new Set();
  for (const item of support.cases) {
    shape(item, CASE_FIELDS, "case");
    localKey(item.localKey);
    uniqueName(item.title, titles, "case title");
    text(item.theme, "case.theme", 120);
    ensure(item.theme === item.theme.trim(), "Case theme must not have surrounding whitespace.");
    ensure(["open", "pending", "resolved"].includes(item.status), "Invalid case status.");
    ensure(["normal", "high", "urgent"].includes(item.priority), "Invalid case priority.");
    ensure(typeof item.escalated === "boolean", "Case escalated must be boolean.");
    const created = timestamp(item.createdAt, "case.createdAt");
    const updated = timestamp(item.updatedAt, "case.updatedAt");
    ensure(created <= updated && updated <= asOf, "Case dates must satisfy createdAt <= updatedAt <= asOf.");
  }
}

function validateBusiness(business, fetchedAt, localKey, adoption) {
  shape(business, ["provider", "sourceUrl", "window", "baselineWindow", "scopeNote", "metrics"], "business");
  ensure(business.provider === "Power BI" && business.sourceUrl === null, "Business must be a Power BI fixture with null sourceUrl.");
  const times = weeklyWindows(business, fetchedAt);
  if (adoption) {
    for (const [index, field] of ["window", "baselineWindow"].entries()) {
      ensure(times[index].start === Date.parse(adoption[field].start) && times[index].end === Date.parse(adoption[field].end),
        "Business windows must match adoption windows.");
    }
  }
  text(business.scopeNote, "scopeNote");
  validateOutcomes(business.metrics, ["USD", "percent", "count", "hours"], localKey, true);
}

function sum(items, field) {
  return items.reduce((total, item) => {
    const result = total + item[field];
    count(result, `sum of ${field}`);
    return result;
  }, 0);
}

function requestMetrics(total, failed, p95Ms, name) {
  count(total, `${name}.total`);
  count(failed, `${name}.failed`);
  ensure(failed <= total, `${name} failures cannot exceed requests.`);
  if (total === 0) {
    ensure(p95Ms === null, `${name} p95Ms must be null for zero traffic.`);
  } else {
    latency(p95Ms, `${name}.p95Ms`);
  }
}

function latencyTarget(value) {
  latency(value, "targetP95Ms");
  ensure(value > 0, "targetP95Ms must be positive.");
}

function validateAppMonitoring(app, journeyWindows, fetchedAt, localKey) {
  shape(app, ["window", "baselineWindow", "requests", "operations", "logs"], "appMonitoring", ["availability"]);
  const times = windows(app, fetchedAt);
  ensure(times.every((time, index) => time.start === journeyWindows[index].start && time.end === journeyWindows[index].end),
    "App monitoring windows must match journey windows.");
  if (Object.hasOwn(app, "availability")) {
    shape(app.availability, ["state", "environment", "observedAt", "summary"], "availability");
    ensure(["outage", "operational", "unknown"].includes(app.availability.state), "Invalid availability state.");
    ensure(app.availability.environment === "production", "Availability environment must be production.");
    const observedAt = timestamp(app.availability.observedAt, "availability.observedAt");
    ensure(observedAt >= times[0].start && observedAt <= times[0].end && observedAt <= fetchedAt,
      "Availability observedAt must be within the current window and no later than fetchedAt.");
    text(app.availability.summary, "availability.summary");
  }
  const { requests, operations, logs } = app;
  shape(requests, REQUEST_FIELDS, "appMonitoring.requests");
  requestMetrics(requests.total, requests.failed, requests.p95Ms, "requests");
  requestMetrics(requests.baselineTotal, requests.baselineFailed, requests.baselineP95Ms, "baseline requests");
  latencyTarget(requests.targetP95Ms);
  p95Change(requests.p95Ms, requests.baselineP95Ms);
  list(operations, "operations", 100);
  const names = new Set();
  for (const operation of operations) {
    shape(operation, OPERATION_FIELDS, "operation");
    localKey(operation.localKey);
    text(operation.name, "operation.name", 500);
    const name = operation.name.trim().toLowerCase();
    ensure(!names.has(name), "Duplicate operation name.");
    names.add(name);
    requestMetrics(operation.requests, operation.failed, operation.p95Ms, "operation");
    latencyTarget(operation.targetP95Ms);
  }
  const sampledRequests = sum(operations, "requests");
  const sampledFailures = sum(operations, "failed");
  ensure(sampledRequests <= requests.total && sampledFailures <= requests.failed
    && sampledRequests - sampledFailures <= requests.total - requests.failed, "Operation subsets exceed aggregate requests, failures or successes.");
  list(logs, "logs", 1000);
  for (const log of logs) {
    shape(log, LOG_FIELDS, "log");
    localKey(log.localKey);
    const time = timestamp(log.timestamp, "log.timestamp");
    ensure(time >= times[0].start && time < times[0].end, "Log timestamp must be within the current window [start, end).");
    ensure(["error", "warning", "information"].includes(log.severity), "Invalid log severity.");
    ensure(["exception", "trace", "dependency"].includes(log.kind), "Invalid log kind.");
    ensure(operations.some((operation) => operation.name === log.operation), "Log operation must name a sampled operation.");
    text(log.message, "log.message");
    count(log.occurrences, "log.occurrences");
    ensure(log.occurrences > 0, "Log occurrences must be positive.");
  }
  for (const severity of ["error", "warning", "information"]) {
    sum(logs.filter((log) => log.severity === severity), "occurrences");
  }
}

export function validatePreview(snapshot, product, { now = Date.now() } = {}) {
  clock(now);
  shape(snapshot, ["schemaVersion", "pipelineVersion", "productId", "mode", "fetchedAt", "sourceUrls", "stories", "monitoring"], "preview", ["appMonitoring", "adoption", "support", "business"]);
  ensure(snapshot.schemaVersion === "1.0" && snapshot.pipelineVersion === VERSION, "Unsupported preview version.");
  ensure(typeof snapshot.productId === "string" && PRODUCT_ID.test(snapshot.productId) && snapshot.productId.length < 80
    && !["constructor", "prototype"].includes(snapshot.productId) && snapshot.productId === product?.id, "Preview product does not match.");
  ensure(snapshot.mode === "fixture", "Preview must use fixture provenance.");
  const fetchedAt = timestamp(snapshot.fetchedAt, "fetchedAt");
  ensure(fetchedAt <= now, "Preview fetchedAt is in the future.");
  shape(snapshot.sourceUrls, ["confluence", "applicationInsights"], "sourceUrls");
  ensure(snapshot.sourceUrls.confluence === null && snapshot.sourceUrls.applicationInsights === null, "Fictional preview source URLs must be null.");

  const keys = new Set();
  function localKey(value) {
    ensure(typeof value === "string" && LOCAL_KEY.test(value) && value.length <= 120, "localKey must be a local sample- identifier.");
    ensure(!keys.has(value), "Duplicate localKey.");
    keys.add(value);
  }
  list(snapshot.stories, "stories", 1000);
  for (const story of snapshot.stories) {
    shape(story, STORY_FIELDS, "story");
    localKey(story.localKey);
    text(story.title, "story.title", 500);
    text(story.outcome, "story.outcome");
    text(story.owner, "story.owner", 120);
    ensure(["draft", "in-progress", "accepted"].includes(story.status), "Invalid story status.");
    ensure(["defined", "missing"].includes(story.acceptance), "Invalid story acceptance.");
    if (story.decision !== null) text(story.decision, "story.decision");
  }

  shape(snapshot.monitoring, ["window", "baselineWindow", "journeys"], "monitoring");
  const { journeys } = snapshot.monitoring;
  const times = windows(snapshot.monitoring, fetchedAt);
  list(journeys, "journeys", 100);
  for (const journey of journeys) {
    shape(journey, JOURNEY_FIELDS, "journey");
    localKey(journey.localKey);
    text(journey.name, "journey.name", 500);
    for (const field of ["attempts", "successes", "affectedUsers", "baselineAttempts", "baselineSuccesses"]) count(journey[field], field);
    for (const field of ["p95Ms", "baselineP95Ms"]) latency(journey[field], field);
    latencyTarget(journey.targetP95Ms);
    ensure(journey.successes <= journey.attempts && journey.baselineSuccesses <= journey.baselineAttempts, "Successes cannot exceed attempts in either window.");
    ensure(journey.affectedUsers <= journey.attempts - journey.successes, "affectedUsers cannot exceed failures or attempts.");
    ensure(journey.attempts !== 0 || journey.p95Ms === 0, "Zero current attempts cannot have observed p95.");
    ensure(journey.baselineAttempts !== 0 || journey.baselineP95Ms === 0, "Zero baseline attempts cannot have observed p95.");
    ensure(Number.isFinite(journey.targetSuccessRate) && journey.targetSuccessRate >= 0 && journey.targetSuccessRate <= 100, "targetSuccessRate must be a percentage from 0 to 100.");
    p95Change(journey.p95Ms, journey.baselineP95Ms);
  }
  if (Object.hasOwn(snapshot, "appMonitoring")) validateAppMonitoring(snapshot.appMonitoring, times, fetchedAt, localKey);
  if (Object.hasOwn(snapshot, "adoption")) validateAdoption(snapshot.adoption, fetchedAt, localKey);
  if (Object.hasOwn(snapshot, "support")) validateSupport(snapshot.support, fetchedAt, localKey);
  if (Object.hasOwn(snapshot, "business")) validateBusiness(snapshot.business, fetchedAt, localKey, snapshot.adoption);
  return snapshot;
}

export function summarizePreview(snapshot, { now = Date.now(), maxAgeHours = 24 } = {}) {
  validatePreview(snapshot, { id: snapshot?.productId }, { now });
  ensure(Number.isFinite(maxAgeHours) && maxAgeHours > 0 && maxAgeHours <= 720, "maxAgeHours must be greater than 0 and at most 720.");
  const items = snapshot.stories.map((story) => ({ ...story }));
  const gaps = items.filter((story) => story.acceptance === "missing");
  const decisions = items.filter((story) => story.decision !== null);
  const storyEvidence = [
    ...gaps.map((story) => `${story.title}: acceptance criteria missing; owner ${story.owner}.`),
    ...decisions.map((story) => `${story.title}: pending owner decision (${story.owner}): ${story.decision}`),
  ];
  const journeys = snapshot.monitoring.journeys.map((journey) => {
    const successRate = percentage(journey.successes, journey.attempts);
    const baselineSuccessRate = percentage(journey.baselineSuccesses, journey.baselineAttempts);
    return {
      ...journey,
      successRate,
      baselineSuccessRate,
      successDeltaPp: delta(successRate, baselineSuccessRate),
      p95ChangePct: journey.attempts && journey.baselineAttempts ? p95Change(journey.p95Ms, journey.baselineP95Ms) : null,
      atRisk: successRate !== null && (successRate < journey.targetSuccessRate || journey.p95Ms > journey.targetP95Ms),
    };
  });
  const monitoringEvidence = journeys
    .filter((journey) => journey.atRisk || journey.p95ChangePct > 0)
    .map((journey) => {
      const success = `${journey.successes}/${journey.attempts} successful attempts (${format(journey.successRate)}%; target ${journey.targetSuccessRate}%)`;
      const baseline = journey.baselineSuccessRate === null ? "baseline success unknown (0 attempts)"
        : `baseline ${journey.baselineSuccesses}/${journey.baselineAttempts} (${format(journey.baselineSuccessRate)}%; change ${format(journey.successDeltaPp)} percentage points)`;
      const latency = `observed p95 ${journey.p95Ms} ms (target ${journey.targetP95Ms} ms)`;
      const change = journey.p95ChangePct === null ? "p95 percentage comparison unavailable"
        : `baseline observed p95 ${journey.baselineP95Ms} ms; change ${format(journey.p95ChangePct)}%`;
      return `${journey.name}: ${success}; ${journey.attempts - journey.successes} failed attempts; ${journey.affectedUsers} affected users within this journey; ${baseline}; ${latency}; ${change}.`;
    });
  const rates = journeys.map((journey) => journey.successRate).filter((rate) => rate !== null);
  return {
    mode: "fixture",
    fetchedAt: snapshot.fetchedAt,
    stale: now - Date.parse(snapshot.fetchedAt) > maxAgeHours * 3_600_000,
    sourceUrls: { ...snapshot.sourceUrls },
    stories: {
      total: items.length,
      accepted: items.filter((story) => story.status === "accepted").length,
      acceptanceGaps: gaps.length,
      decisions: decisions.length,
      items,
      concern: storyEvidence.length ? {
        title: "Acceptance gaps and product-owner scope decisions",
        evidence: storyEvidence,
        recommendation: "Ask the named owners and product owner to define missing acceptance criteria and resolve the listed scope decisions before committing to the affected outcomes.",
      } : null,
    },
    monitoring: {
      window: { ...snapshot.monitoring.window },
      baselineWindow: { ...snapshot.monitoring.baselineWindow },
      journeys,
      underTargetCount: journeys.filter((journey) => journey.atRisk).length,
      lowestSuccessRate: rates.length ? Math.min(...rates) : null,
      concern: monitoringEvidence.length ? {
        title: "Customer journey target misses or observed p95 slowdown",
        evidence: monitoringEvidence,
        recommendation: "Prioritize the named customer journeys for investigation. Compare failed attempts and observed latency with the adjacent baseline and relevant changes; association is not causality. Do not add affected users across journeys because they may overlap.",
      } : null,
    },
    appMonitoring: snapshot.appMonitoring ? summarizeAppMonitoring(snapshot.appMonitoring) : null,
    adoption: snapshot.adoption ? summarizeAdoption(snapshot.adoption) : null,
    support: snapshot.support ? summarizeSupport(snapshot.support) : null,
    business: snapshot.business ? summarizeBusiness(snapshot.business) : null,
  };
}

function targetMet(item) {
  return item.current === null ? null : item.direction === "increase" ? item.current >= item.target : item.current <= item.target;
}

function summarizeAdoption(adoption) {
  const features = adoption.features.map((feature) => {
    const adoptionRate = percentage(feature.adoptedUsers, feature.eligibleUsers);
    return { ...feature, adoptionRate, belowTarget: adoptionRate !== null && adoptionRate < feature.targetRate };
  });
  const outcomes = adoption.outcomes.map((outcome) => ({
    ...outcome, change: delta(outcome.current, outcome.baseline), meetsTarget: targetMet(outcome),
  }));
  const activeUserChangePct = relativeChange(adoption.activeUsers, adoption.baselineActiveUsers);
  const evidence = [];
  if (activeUserChangePct < 0) {
    evidence.push(`Active users: ${adoption.activeUsers} in the current period versus ${adoption.baselineActiveUsers} in the baseline (${format(activeUserChangePct)}% change).`);
  }
  for (const feature of features.filter((item) => item.belowTarget)) {
    evidence.push(`${feature.name}: ${feature.adoptedUsers}/${feature.eligibleUsers} eligible users adopted the feature (${format(feature.adoptionRate)}%; target ${feature.targetRate}%).`);
  }
  for (const outcome of outcomes.filter((item) => item.meetsTarget === false)) {
    evidence.push(`${outcome.name}: sampled current value ${outcome.current} ${outcome.unit}; target ${outcome.target} (${outcome.direction}); baseline ${outcome.baseline === null ? "unknown" : `${outcome.baseline} ${outcome.unit}`}.`);
  }
  return {
    window: { ...adoption.window },
    baselineWindow: { ...adoption.baselineWindow },
    activeUsers: adoption.activeUsers,
    baselineActiveUsers: adoption.baselineActiveUsers,
    definitions: { ...adoption.definitions },
    activation: { ...adoption.activation },
    retention: { ...adoption.retention },
    activeUserChangePct,
    activationRate: percentage(adoption.activation.activatedUsers, adoption.activation.eligibleUsers),
    retentionRate: percentage(adoption.retention.returningUsers, adoption.retention.cohortUsers),
    features,
    belowTargetCount: features.filter((feature) => feature.belowTarget).length,
    outcomes,
    concern: evidence.length ? {
      title: "Sampled adoption and product value need review",
      evidence,
      recommendation: "Review the named feature adoption gaps and independently sampled outcomes with the product owner. Do not sum distinct users across features or infer outcome changes from usage; these observations do not establish causality.",
    } : null,
  };
}

function summarizeSupport(support) {
  const cases = support.cases.map((item) => ({
    ...item, ageDays: Math.floor((Date.parse(support.asOf) - Date.parse(item.createdAt)) / DAY_MS),
  }));
  const unresolved = cases.filter((item) => item.status !== "resolved");
  const themes = new Map();
  for (const item of unresolved) themes.set(item.theme, (themes.get(item.theme) ?? 0) + 1);
  return {
    provider: support.provider,
    sourceUrl: null,
    asOf: support.asOf,
    cases,
    totalCases: cases.length,
    openCases: unresolved.length,
    escalatedCases: unresolved.filter((item) => item.escalated).length,
    oldestOpenDays: unresolved.length ? Math.max(...unresolved.map((item) => item.ageDays)) : null,
    themes: [...themes].map(([name, openCases]) => ({ name, openCases })).sort((a, b) => b.openCases - a.openCases || a.name.localeCompare(b.name)),
    concern: unresolved.length ? {
      title: "Unresolved cases in the authored support sample",
      evidence: unresolved.map((item) => `${item.title}: ${item.status}, ${item.priority} priority${item.escalated ? ", escalated" : ""}; ${item.ageDays} elapsed days since creation; theme ${item.theme}.`),
      recommendation: "Review unresolved escalations and repeated themes with support owners. These are case counts in the complete authored sample, not distinct customers, incidents, SLA breaches or a claim about the entire Zendesk account.",
    } : null,
  };
}

function summarizeBusiness(business) {
  const metrics = business.metrics.map((metric) => ({
    ...metric,
    change: delta(metric.current, metric.baseline),
    changePct: relativeChange(metric.current, metric.baseline),
    meetsTarget: targetMet(metric),
  }));
  const offTarget = metrics.filter((metric) => metric.meetsTarget === false);
  return {
    provider: business.provider,
    sourceUrl: null,
    window: { ...business.window },
    baselineWindow: { ...business.baselineWindow },
    scopeNote: business.scopeNote,
    metrics,
    offTargetCount: offTarget.length,
    onTargetCount: metrics.filter((metric) => metric.meetsTarget === true).length,
    unknownCount: metrics.filter((metric) => metric.meetsTarget === null).length,
    concern: offTarget.length ? {
      title: "Sampled business outcomes outside their directional targets",
      evidence: offTarget.map((metric) => `${metric.name}: ${metric.current} ${metric.unit} versus target ${metric.target} (${metric.direction}); baseline ${metric.baseline === null ? "unknown" : `${metric.baseline} ${metric.unit}`}. Definition: ${metric.definition}`),
      recommendation: "Review the named business outcomes, definitions and reporting scope with business owners. Validate possible explanations independently; do not attribute these observations to application bugs or assume causality.",
    } : null,
  };
}

function summarizeAppMonitoring(app) {
  const availability = Object.hasOwn(app, "availability") ? { ...app.availability } : null;
  const raw = app.requests;
  const failureRate = percentage(raw.failed, raw.total);
  const baselineFailureRate = percentage(raw.baselineFailed, raw.baselineTotal);
  const requests = {
    ...raw,
    failureRate,
    baselineFailureRate,
    failureDeltaPp: delta(failureRate, baselineFailureRate),
    p95ChangePct: p95Change(raw.p95Ms, raw.baselineP95Ms),
  };
  const operations = app.operations.map((operation) => ({
    ...operation,
    atRisk: operation.requests > 0 && (operation.failed > 0 || operation.p95Ms > operation.targetP95Ms),
  }));
  const logs = app.logs.map((log) => ({ ...log })).sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  const errorEvents = sum(logs.filter((log) => log.severity === "error"), "occurrences");
  const warningEvents = sum(logs.filter((log) => log.severity === "warning"), "occurrences");
  const slowOperationCount = operations.filter((operation) => operation.p95Ms !== null && operation.p95Ms > operation.targetP95Ms).length;
  const evidence = [];
  if (raw.failed > 0 || (raw.p95Ms !== null && raw.p95Ms > raw.targetP95Ms) || requests.p95ChangePct > 0) {
    const failures = failureRate === null ? "current failure rate unknown (0 requests)"
      : `${raw.failed}/${raw.total} failed requests (${format(failureRate)}%)`;
    const baseline = baselineFailureRate === null ? "baseline failure rate unknown (0 requests)"
      : `baseline ${raw.baselineFailed}/${raw.baselineTotal} (${format(baselineFailureRate)}%; change ${format(requests.failureDeltaPp)} percentage points)`;
    const latency = raw.p95Ms === null ? "current p95 unknown" : `observed p95 ${raw.p95Ms} ms (target ${raw.targetP95Ms} ms)`;
    const latencyChange = requests.p95ChangePct === null ? "p95 percentage comparison unavailable"
      : `baseline observed p95 ${raw.baselineP95Ms} ms; change ${format(requests.p95ChangePct)}%`;
    evidence.push(`Application requests: ${failures}; ${baseline}; ${latency}; ${latencyChange}.`);
  }
  for (const operation of operations.filter((item) => item.atRisk)) {
    evidence.push(`${operation.name}: ${operation.failed}/${operation.requests} failed requests; observed p95 ${operation.p95Ms} ms (target ${operation.targetP95Ms} ms).`);
  }
  for (const log of logs.filter((item) => item.severity !== "information")) {
    evidence.push(`${log.operation}: ${log.occurrences} ${log.severity} events in grouped ${log.kind} observation at ${log.timestamp}: ${log.message}`);
  }
  if (availability?.state === "outage") {
    evidence.push(`Explicit sampled ${availability.environment} availability: outage observed at ${availability.observedAt}. ${availability.summary}`);
  }
  return {
    window: { ...app.window },
    baselineWindow: { ...app.baselineWindow },
    requests,
    operations,
    logs,
    errorEvents,
    warningEvents,
    slowOperationCount,
    availability,
    concern: evidence.length ? {
      title: availability?.state === "outage" ? "Sampled production outage and application observations" : "Application errors, warnings and observed performance",
      evidence,
      recommendation: "Ask engineering to investigate the sampled availability observation, named operations, grouped logs and observed request metrics against the baseline. Associations are not proof of causality. Log events may overlap and are not combined incidents or counts of failed requests. Window-wide request and log metrics are historical evidence, not an inference of current availability.",
    } : null,
  };
}

function format(value) {
  return Number(value.toFixed(2)).toString();
}
