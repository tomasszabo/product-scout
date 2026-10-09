# Source and memory contracts

Schema version `1.0`, pipeline version `0.1.0`. The runtime accepts exactly the documented fields; extra raw bodies, credentials and arbitrary metadata are rejected.

These are internal dashboard and processing contracts, not chat response
formats. All user-facing Product Scout replies use concise natural language.
Skills preserve exact structured payloads for validation and handoffs while
separately explaining their actual outcomes, limitations and next steps.

## GitHub Issues snapshot

```json
{
  "schemaVersion": "1.0",
  "pipelineVersion": "0.1.0",
  "productId": "your-product",
  "source": "github-issues",
  "mode": "live",
  "fetchedAt": "2026-09-24T08:00:00.000Z",
  "coverage": {
    "status": "complete",
    "note": "All configured repositories and requested pages read successfully.",
    "repositories": ["your-org/your-repository"]
  },
  "issues": [
    {
      "id": "your-org/your-repository#42",
      "repository": "your-org/your-repository",
      "number": 42,
      "title": "Observed issue title",
      "summary": "Concise factual summary without credentials or unnecessary sensitive details.",
      "state": "open",
      "labels": ["needs-decision", "component:checkout"],
      "milestone": "v4.2",
      "url": "https://github.com/your-org/your-repository/issues/42",
      "updatedAt": "2026-09-24T07:00:00.000Z"
    }
  ]
}
```

The example uses placeholders, not a real source. Issue identifiers must equal `repository#number`. Live URLs must exactly match `https://github.com/{repository}/issues/{number}`; pull requests must be excluded by the source reader. Labels are nonempty strings; absent milestones are `null`. Empty summary is not accepted: use a short factual description such as "No description supplied in the issue" when that is what the source reports.

Coverage is `complete`, `partial` or `unavailable`. Complete means all configured repositories' open and closed issue pages were exhausted. The first specialist has a bounded pagination budget; any narrower search, filtered investigation, unexhausted cursor or access failure makes combined coverage partial, even if a focused query succeeded. Counts always describe the snapshot. With no successful reads, use unavailable and an empty issue array; never show an access failure as zero issues. At most 5,000 issues / 50 repositories are accepted by the runtime; the specialist's default read budget is deliberately smaller. A source record can contain at most 50 labels.

The `fixture` mode exists for authored samples and their explicitly re-dated
local working copies. External ingest rejects fixture mode. Fixtures have null
URLs and their provenance remains attached to candidates and memory.
Configured live products do not load fixture data.

The dashboard presents authored products with all six cards populated by
default, without fixture/sample/demo labels. This presentation does not change
the `fixture` mode, null source URLs, validation, evidence or memory provenance.
Configured live products remain Issues-only; no sample fallback is permitted.

Future timestamps beyond five minutes of local time and older replacement snapshots are rejected. Product-specific freshness rules control the UI's stale status. Approvals require complete, nonstale coverage.

## Runtime state

Native deployments use `COPILOT_HOME/.ps/state.json`, default
`~/.copilot/.ps/state.json`. The extension and refresh CLI share this private
store. Multiple App sessions may open it concurrently; their canvas context,
capabilities and chat handoffs remain session-local. Each state read reloads and
validates the latest atomically published file. Updates acquire `.ps/writer.lock`
only for the transaction, reload the latest state before applying changes, and
release the lock immediately afterward. Contention waits up to five seconds,
then reports an explicit error without changing state. Neither runtime nor CLI
may select another directory to evade contention.

Confirmed-dead writer PIDs recover automatically under an exclusive
`writer.lock.recovery` guard. Live/unknown owners, malformed locks and symlinks
are never displaced. A leftover recovery guard requires manual inspection.
Each open store also registers a `runtime-<UUID>.lock` lease with its PID and
removes it on close; these leases prevent component deployment while any session
is active, but never block another session from opening the data. Deployment
ignores leases whose owners are confirmed dead without deleting them.

The store contains no credentials. Component updates do not manage or overwrite
state. The lifecycle receipt `.ps/deployment.json`, deployment lock
`.ps/deploy.lock` and `.ps/backups/` are separate deployment metadata. Pause daily
automation and stop all runtimes before approved updates or migration. Preserve
configuration and reviewed history; never migrate writer locks, recovery guards
or runtime leases, or automatically delete an older installation.

`getState()` returns `schemaVersion`, `pipelineVersion`, `version`, `revision`, `roles` and `products[]`. Each product includes its configuration plus:

- `snapshot`: current source result.
- `assessment`: issues-only status, staleness, counts and explicit readiness limitations.
- `candidates[]`: derived insight, explanation, recommendation, evidence, content hash, source provenance, and optional existing review.
- `timeline[]`: approved reviews, newest first.
- `changes`: whether a comparable baseline exists, its timestamp and observed issue changes.
- `previewSources`: optional-source fixture summary or null. This is derived at
  read time and is never persisted or sent through issue ingestion.

This state field is distinct from the extension's legacy `previewSources`
boolean canvas input. That input remains accepted for compatibility but does
not gate visibility; no preview preference or checkbox is required.

Private saved state may additionally contain `fixturePreviews`, a map from
configured product IDs to validated raw preview fixtures. Only explicit sample
refresh creates these working copies; the summarized `previewSources` above
remains derived at read time. Old state without this optional field continues
to load packaged previews. Malformed saved previews are errors, not permission
to fall back to packaged data.

Fixture refresh shifts `fetchedAt`, issue updates, reporting/baseline windows,
availability observations, log timestamps and support creation/update/as-of
times, preserving the relative intervals within each source. The working
snapshots stay `fixture`; values, release targets and historical review records
are unchanged. Refresh persists atomically, increments revision once, and
clears only refreshed products' comparison baselines so shifted dates do not
appear as source changes. Live-bound or sample-less products are skipped.
The same state is used after restart and by chat; packaged fixture files remain
unchanged and must not override saved working copies during investigation.
Daily local automation delegates once for all products, without agents or
source queries. Its import is always offered by setup but requires the user's
App confirmation; a daily wall-clock schedule is not a fixed 86,400-second timer.

`hostConnected` is added by the browser API, not stored as source evidence.

## Ephemeral dashboard interaction context

The canvas publishes view context to the capability-protected, same-origin
`POST /api/context` endpoint. `ps_get_context` reads that runtime's memory through
the existing extension tool API. This is not a guessed SDK selection API and
does not use `session.send`, source retrieval, ingestion or review.

Input contains `viewId` (one random UUID per document), increasing `sequence`,
the displayed state `revision`, and `context`. A null context closes that
document's selection. Otherwise its exact fields are `productId`, `view`, `role`,
`finding`, `selectedText` and `selectionTruncated`. Findings reference a current
issue/candidate or a preserved timeline review by kind and ID, validated within
the product. Text is bounded to 2,000 characters and is untrusted quoted context,
not a source fact or permission to execute instructions.

The tool returns `schemaVersion: "1.0"`, `status` and `context`. Only `available`
returns context, enriched with canonical identity and source provenance.
`unavailable`, `ambiguous` (multiple active documents) and `outdated` (changed
revision/referent) require clarification, never a guessed active product.
Historical review context uses its preserved evidence.

Context is isolated to the extension runtime/session, never written to
`state.json`, browser storage, timeline or logs. At most eight document slots
are retained; each expires after 120 seconds without updates. Sequence numbers
prevent late updates resurrecting a cleared selection. Active visible canvases
renew unchanged context every 30 seconds through existing cache polling; this
does not change the observation or selection timestamp. Closing the canvas or
runtime clears context; page unload also attempts a bounded clear request.
An expired hidden canvas must be revisited before its selection can be used.

Navigation, role changes and new state revisions clear selections/open findings.
Findings expand inline, with one issue row expanded at a time. Collapsing a
finding returns to the card context; collapsing a nested concern returns to its
parent issue. Highlighted text is scoped to its containing finding rather than
an unrelated expanded row. Text selections are restricted to
rendered dashboard/evidence content, excluding editable controls and review forms.
Moving focus to chat preserves the last selection; clicking another dashboard
area, pressing Escape there or navigating clears it. Selecting text does not
trigger a question, agent or source request. Publication failures are visible.

## Chat investigation handoffs

`ps-investigate` passes prepared evidence between the tool-free `ps-analyst`
and `ps-challenger` profiles using the
[investigation contract](../skills/ps-investigate/references/contract.md).
Packets bind evidence to one product and investigation, preserve snapshot
provenance and use local citation references. Agent JSON is checked by the
coordinator before forwarding; host execution metadata, not an agent's claim,
establishes which model ran.

These handoffs are conversation context only, not a new persisted state field
or an input to `ps_ingest_snapshot`. No agent assessment becomes reviewed
memory automatically. Source retrieval still uses the canonical source
validators; fixture and live evidence must never be silently substituted.

## Optional source fixtures

`skills/ps/fixtures/{productId}.preview.json` is a strict, separate fixture
contract, validated by `preview-model.mjs`. It is not an external-source snapshot
or an ingestion format. Files contain:

```text
{
  schemaVersion: "1.0", pipelineVersion: "0.1.0", productId,
  mode: "fixture", fetchedAt,
  sourceUrls: {confluence: null, applicationInsights: null},
  stories: [{localKey, title, outcome, owner,
             status: "draft" | "in-progress" | "accepted",
             acceptance: "defined" | "missing", decision: string | null}],
  monitoring: {
    window: {start, end}, baselineWindow: {start, end},
    journeys: [{localKey, name, attempts, successes, affectedUsers, p95Ms,
                baselineAttempts, baselineSuccesses, baselineP95Ms,
                targetSuccessRate, targetP95Ms}]
  }
}
```

Keys identify local examples, never Confluence pages or Azure resources. Counts
are nonnegative safe integers; successes cannot exceed attempts. Affected users
are distinct failure-affected users **within a journey**, capped by its failures,
and never summed across journeys. The comparable windows have equal duration
and are adjacent; observations end no later than `fetchedAt`.

Success is `100 * successes / attempts`; its baseline change is percentage
points, not percent. No attempts means an unknown/null success rate, not 100%.
p95 values are supplied observations in milliseconds; baseline change is
`100 * (current - baseline) / baseline`, unknown if the baseline is zero/absent.
Targets are sample product targets, not Azure SLAs. A journey is off target when
its measured success rate is below its sample target or p95 exceeds its target.
Do not average p95 values or assume correlations demonstrate causality.

Story counts and journey metrics feed separate derived concerns and suggested
PO actions. Freshness follows the product's `maxAgeHours`; stale summaries remain
historical examples, never current release verdicts. Missing files yield null,
while malformed files fail explicitly. Only products already showing fixture
Issues with no real repository bindings may load these previews. They do not
generate review candidates or timeline entries. Explicit fixture refresh may
re-date private working copies but never modifies these packaged source files.

### Operations (legacy internal key `appMonitoring`)

The `monitoring` field above remains readable for older fixtures but no longer
has a UI view. It is not reused as adoption data. An optional sibling
`appMonitoring` field supplies **Operations** technical
telemetry from the same fictional Application Insights source:

```text
appMonitoring: {
  window: {start, end}, baselineWindow: {start, end},
  requests: {total, failed, p95Ms, baselineTotal, baselineFailed,
             baselineP95Ms, targetP95Ms},
  operations: [{localKey, name, requests, failed, p95Ms, targetP95Ms}],
  availability?: {state: "outage" | "operational" | "unknown",
                   environment: "production", observedAt, summary},
  logs: [{localKey, timestamp, severity: "error" | "warning" | "information",
          kind: "exception" | "trace" | "dependency", operation, message,
          occurrences}]
}
```

Omitting this field keeps old preview fixtures valid; the derived value is null
and the card is unavailable. All object keys are validated. Windows are adjacent,
equal-length and bounded by the snapshot time. Log timestamps fall within the
current window; `timestamp` denotes the last observation of a grouped message.
Local keys are not source-system identifiers and no resource links are invented.

Failure rate is `100 * failed / total`; baseline difference is percentage points.
Zero traffic yields null rates and p95, not healthy or zero latency. Observed p95
is measured in milliseconds, with a percent change against a nonzero baseline.
Operations form a distinct, non-overlapping subset of requests: summed request
and failure counts cannot exceed the corresponding totals. Operations exceeding
their sample p95 targets count as slow; they are not automatically incidents.

Error/warning totals sum grouped-log occurrences of that severity. Log groups
sort newest first and support severity and case-insensitive message/operation
search. Exceptions, dependency errors, warning traces and request failures may
overlap and must not be added as unique incidents or users. The technical card
does not replace journey outcomes or imply causality. Like other previews, its
concerns are read-only recommendations, never automatically reviewed memory.

Optional `availability` is an explicitly authored observation, never inferred
from failed-request counts, error logs or zero traffic. Its bounded summary and
production environment are validated; `observedAt` must fall within the current
window (inclusive boundaries) and no later than `fetchedAt`. Absence summarizes
as null. An explicit outage adds its own supporting evidence to the concern even
with no recorded failed requests. An operational or unknown observation alone
does not establish overall health. Window-wide request metrics remain separate
from point-in-time availability. Both built-in products include a clearly
simulated production outage; there are no live resource IDs or incident links.

Overview and detail share the same status resolution: blue Attention for supported
concerns and pink/magenta Critical / error for an explicit outage. Stale supported
findings retain those colors with visible last-known explanations on cards and
details; current status remains unknown, and stale outages are historical.
Stale unflagged, missing or incomplete evidence stays Unknown; only fresh
sufficient observations without a concern use light-gray Normal.
Internal status keys remain `warning`, `error`, `unknown` and `none`.
Unknown denominators and missing metrics never produce an all-clear. Status
descriptions remain available to screen readers without visible status pills;
Unknown stays visible as plain text. Header attention labels are screen-reader
text only; a time pill shows "Updated ... ago" from that source's `fetchedAt`,
with the exact UTC time in its tooltip. Cache polling updates the displayed age,
not the timestamp. Missing/unavailable source data has no update-time pill.
This presentation
does not change assessment freshness, timestamps or review eligibility.
Detail tables have neutral surfaces, with
status backgrounds confined to the upper insight and availability panels.
Normal is an informational summary, not a release-readiness or overall-health claim.

### Product Adoption & Value

The optional `adoption` field contains separate event/cohort observations, not
renamed journey-success rates:

```text
adoption: {
  window: {start, end}, baselineWindow: {start, end},
  activeUsers, baselineActiveUsers,
  definitions: {activeUsers, activation, retention},
  activation: {eligibleUsers, activatedUsers},
  retention: {cohortUsers, returningUsers},
  features: [{localKey, name, eligibleUsers, adoptedUsers, targetRate}],
  outcomes: [{localKey, name, unit: "minutes" | "percent" | "count",
              current: number | null, baseline: number | null, target,
              direction: "increase" | "decrease"}]
}
```

Windows are adjacent and equal-duration. Definitions state the active-user
event, first-value activation milestone and prior-period retention cohort.
Numerators cannot exceed denominators. Activation, retention and feature
adoption are numerator/denominator percentages; a zero denominator is null,
not 0% or 100%. Feature cohorts may overlap and are never summed as unique users.
Active-user change is a relative percentage against a nonzero baseline.
Observed value outcomes are independently supplied samples, not inferred effects
of adoption. Outcome changes are absolute differences (percentage points for
percent units); target direction determines whether higher or lower is desired.

### Customer Support

```text
support: {
  provider: "Zendesk", sourceUrl: null, asOf,
  cases: [{localKey, title, theme, status: "open" | "pending" | "resolved",
           priority: "normal" | "high" | "urgent", escalated,
           createdAt, updatedAt}]
}
```

All counts describe this authored case set, not a claimed entire account.
Open counts include pending cases. Escalation counts and theme counts use only
unresolved cases. Case ages use the fixed `asOf` snapshot, not current time.
Creation precedes update, which is no later than `asOf`/`fetchedAt`. Cases are
not distinct customers or automatically confirmed product defects. No SLA,
remote ticket identity or customer details are invented.

### Business Reporting

```text
business: {
  provider: "Power BI", sourceUrl: null,
  window: {start, end}, baselineWindow: {start, end}, scopeNote,
  metrics: [{localKey, name, unit: "USD" | "percent" | "count" | "hours",
             current: number | null, baseline: number | null, target,
             direction: "increase" | "decrease", definition}]
}
```

Each metric names its reporting scope and definition. Missing current values
are unknown and do not count as either on or off target. Percent values are
bounded by 0–100. Absolute percent-metric changes are percentage points; monetary
values use USD. Relative changes require a nonzero baseline. Increasing metrics
meet targets at or above the target; decreasing metrics meet them at or below.
No business change is attributed to operational errors or feature usage.

These three domains are optional for compatibility. An absent domain summarizes
as null and its card shows unavailable; no old journey or issue data is used
as a fallback. They share fixture provenance and do not alter ingestion,
review, storage or mock-refresh contracts.

## Review boundary

The browser posts `{productId,candidateId,evidenceHash,decision,reviewer,note}`. `decision` is `approved` or `rejected`. The current candidate ID and content hash must match; the server freezes the exact original candidate/evidence. Reviewer identity is self-attested, not enterprise authentication. Duplicate decisions are rejected, including concurrent requests. A changed fact, release context, rule or interpretation produces a new candidate identity and requires another review.

Approvals preserve derived status: "human-reviewed insight" does not mean the source proves it true. A recommendation is not executed merely because its related insight was approved. Rejection is retained locally for review state but never added to Product Timeline.

## Integration boundaries

Skills access GitHub MCP; deterministic runtime code has no external-source client. The Copilot adapter is the ingest boundary, not a public web endpoint. Runtime error responses contain explicit actionable errors. Browser source text is rendered with DOM `textContent`; retrieved text is never executable HTML or trusted orchestration instructions.
