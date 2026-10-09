# Developing and maintaining Product Scout

This guide is for an agent working in a source checkout, including VS Code.
Use [setup](setup.md) for installation, App registration, updates and recovery.
Product Scout itself runs only in **GitHub Copilot App**; editor-based development
does not introduce a standalone server or browser application.

Treat this repository as a reusable workflow template. Agree on organization-
specific integrations and owner needs, customize, and validate before deployment;
use the unchanged fixtures only for an explicitly requested sample walkthrough.
A Copilot plugin is the intended distribution format, but packaging is not yet
implemented. The native-copy procedure below is the current testing path.
Never ask for an installation parent or create a separate `ps` application
directory; source checkout and native Copilot component root are distinct inputs.

Read [How to use Product Scout](how-to-use-product-scout.md) for the intended
product-owner workflow: periodic findings, visual attention and shared-context
Copilot investigation. Preserve the distinction between this intent and the
current mock implementation. Dashboard colors are sufficient for now; external
notifications are a possible future extension, not a current requirement.

For datasource additions, changes or removals, GitHub Copilot must follow
[Managing a datasource](managing-a-datasource.md). It maps the complete path
through data contracts, UI, refresh, persistence, tests and packaging.

## Copy-paste development installation prompt

```text
Set up Product Scout for development in VS Code from my provided source, following docs/development.md.
```

## Copy-paste maintenance and update prompt

```text
Apply the agreed Product Scout changes and update my App installation, following docs/development.md and docs/setup.md.
```

Neither prompt authorizes GitHub writes, automated human review, a global
dependency installation or a scheduler change.

## Agent development installation

1. **Resolve the source and destinations.** Use an approved checkout path
   and the confirmed default native Copilot root `~/.copilot`. An explicit
   project-local alternative uses `PROJECT/.github` as the common root for all
   components; never mix roots. Explicit roots must be absolute paths ending in
   `.copilot` or `.github` and must not overlap the source. Use a separate trusted
   checkout for project-local deployment, never the project's own checkout into
   its `.github`. Inspect an existing checkout's branch,
   working tree and configured remote without modifying them. Preserve unrelated
   edits. No default remote is configured by this project.
2. **Obtain source only when necessary.** If the user supplies a trusted
   repository URL and requests a new checkout, use:

   ```sh
   git clone "<TRUSTED_REPOSITORY_URL>" "<CHECKOUT>"
   ```

   Replace placeholders first. Git is required for this step, not to run a
   trusted local release. Do not clone into a nonempty directory, assume the
   current workspace is the requested source, or select a branch/revision
   different from the one requested.
3. **Read local guidance.** Read `.github/copilot-instructions.md`, applicable
   `.github/instructions/`, this guide, [setup](setup.md) and the
   [data contract](data-contract.md). Resolve contradictions before editing.
4. **Check prerequisites.** Require Python >=3.9 (`python3 --version`) for
   version/update tooling and Node.js >=22 (`node --version`) for runtime,
   Copilot adapter, refresh and automation-import helpers. The lifecycle helper
   uses Python's standard library; no pip, virtual environment or package
   installation is needed. JavaScript remains dependency-free ES modules with
   `node:test`; no root npm package or standalone launcher is needed. App SDK
   registration is handled separately in setup.
5. **Validate the checkout.** Run the offline suite and release inventory check
   below. Inventory validates declared artifacts only, not test directories or
   unlisted neighboring artifacts.
6. **Deploy independent native components.** Follow setup's dry-run/approval/apply
   flow. The installer copies approved files into sibling `skills/`, `agents/`
   and `extensions/` directories under the Copilot root, not a full repository
   or enclosing `ps` folder. The checkout is input only, never a runtime dependency.
   Keep private product configuration out of Git.
7. **Discover and reload.** Verify native component discovery using the App's
   supported controls. Editing a checkout does not update deployed components
   or an already-running runtime. Always offer setup's user-confirmed daily local
   all-products sample-refresh import; do not create a schedule automatically.
8. **Verify and report.** Confirm the App's loaded extension and skill paths
   and open the canvas. Offline tests with a mock SDK are not App certification.
   Report missing capabilities, pending reload/sign-in and skipped live checks.

Give concise progress messages at these boundaries, such as "Validating the
checkout", "Reviewing the installation dry run", and "Checking the reloaded App".
Never print credentials, raw private state or capability-bearing canvas URLs.

## Architecture and ownership

Product Scout separates agent orchestration from deterministic runtime work:

```text
GitHub Copilot App
  ps parent -> bounded source / lifecycle / refresh skills
       |
       v
  validated source snapshots -> deterministic assessment -> cached canvas
                                           |
                         explicit human review -> Product Timeline
```

| Location | Responsibility |
| --- | --- |
| `skills/ps/` | Parent routing and shared runtime resources |
| `skills/ps/lib/` | Validation, correlation, local persistence and loopback hosting |
| `skills/ps/dashboard/` | Canonical HTML/CSS/JS renderer used by the App and read-only samples |
| `skills/ps/config/products.json` | Single product registry and issue-label/freshness rules |
| `skills/ps/fixtures/` | Authored, product-isolated snapshots; never fallback live evidence |
| `skills/ps-issues/` | Bounded read-only GitHub investigation |
| `agents/` | Canonical tool-free Analyst and Challenger profiles, independently deployable from the dashboard |
| `skills/ps-investigate/` | Chat orchestration, evidence handoff contract and automatic task-based model selection |
| `skills/ps-timeline/` | Explicit human-reviewed memory workflow |
| `skills/ps-data-refresh/` | Shared deterministic fixture timestamp shifting and refresh helper |
| `skills/ps-update/` | Standard-library Python version/install/update helper |
| `skills/ps-version/version-manifest.json` | Independent named artifact versions and pipeline/runtime version authority |
| `extensions/ps-runtime/` | Thin host SDK adapter, session handoff and canvas lifecycle |
| `automations/ps-data-refresh/` | Source scheduling description; deployed as reference metadata under the refresh skill |
| `tests/` | Offline fixtures, mocked host integration and regression tests |

Do not reintroduce root-level `web`, `lib`, `config`, `fixtures` or application
scripts. Keep implementation changes in this repository. No runtime import,
symlink or write dependency on another project is required.

The runtime binds to loopback, protects access with a per-process capability,
validates write origins/payloads and serves allowlisted assets. Private
`COPILOT_HOME/.ps/state.json` is ignored by Git, written atomically and protected
by `.ps/writer.lock` only during each update. Multiple sessions open the same
store, reloading validated state on reads and under the write lock before every
mutation. Lock contention waits up to five seconds; only confirmed-dead owner
PIDs recover automatically, under `writer.lock.recovery`. Per-store
`runtime-<UUID>.lock` leases prevent deployment while sessions are active.
The extension and refresh CLI share this store; context and chat routing stay
local to each session.
It holds snapshots, prior comparison data and explicit review decisions,
not credentials, transcripts or raw tool responses. This is local single-user
memory, not a multi-user or tamper-proof audit service.

## Skill and data contracts

User-facing replies use concise natural language, not JSON objects or code
blocks. This applies to the parent and direct source, refresh, investigation,
timeline and lifecycle requests. The parent must summarize internal results,
not forward JSON from a child skill. Preserve actual outcomes, skips, failures,
coverage, freshness and required human actions when translating a result.
Strict JSON remains an internal contract for dashboard snapshots, tools,
automation processing and agent handoffs; never ingest chat prose as data.

The parent skill owns a short first-use chat quick start after an accepted
canvas-open request (including bare `/ps`). Suppress repeats using conversation
history, not persistent runtime/browser flags; provide it on a later view request
if omitted, and repeat it for explicit help. Respect requests to skip it.
Never turn failed opens into welcomes, interrupt investigations/refresh results,
or launch agents/source reads just to explain usage. Contract tests verify these
instructions; host smoke tests must verify actual conversational behavior.

- Skills own host MCP orchestration; helpers consume prepared payloads and
  remain deterministic. Discover actual tool schemas rather than inventing
  arguments, IDs, successful coverage or connector behavior.
- The parent routes substantive product release/readiness analysis to
  `ps-investigate`, which uses `ps-issues` as its live source reader.
  Plain issue lookups still use `ps-issues`;
  `ps-version` and `ps-update` concern Product Scout software itself.
- Each skill needs matching directory/frontmatter `name`, description, domain,
  capabilities, purpose, inputs, workflow, safety, output contract and a Product
  Scout Versioning block. Use namespace `ps` and tool prefix `ps_`.
- GitHub access is read-only. Recommendations are suggestions, not source writes.
  Human review must remain an explicit user action; never approve through an
  agent, setup script, automation or browser smoke test.
- Keep facts, derived concerns and suggested actions distinct. Labels and
  relationships do not prove causation or release readiness. Unknown/stale/
  partial sources must not become zeros, healthy status or silent fixture fallbacks.
- Preserve stable product IDs and schema version `"1.0"`. There is one product
  registry; role changes reprioritize the same evidence, not duplicate records.
- Canonical issue identity is exactly `${repository}#${number}` from the
  configured `owner/repository` and observed positive issue number. Do not use a
  raw GitHub database/node ID. Live URLs are observed, non-null HTTPS links to
  that exact issue; fixture URLs are null.
- Review preserves the candidate wording and supporting evidence. Changed
  evidence requires a new review. Rejections do not enter Product Timeline;
  refresh never rewrites accepted historical evidence.

The full snapshot, configuration and optional preview schemas are documented in
[data contract](data-contract.md). Update producers, validators, fixtures,
store/publication paths, consumers and tests together when a contract changes.
Keep optional preview fields backward-compatible unless a breaking change is
explicitly approved.

### Investigation agents

Substantive questions route to `ps-investigate` before requiring a runtime or
canvas. The workflow gathers validated scoped evidence, selects models and
delegates Analyst -> Challenger -> Analyst revision. Agent profiles have
`tools: []`: they reason over supplied evidence and cannot bypass source skills,
write state or spawn a debate loop. Keep this distinct from lightweight factual
lookups, cache polling, mock refresh and explicit human review.

The [handoff contract](../skills/ps-investigate/references/contract.md) defines
product/investigation identity, citations and bounded JSON outputs.
The [model policy](../skills/ps-investigate/references/model-selection.md) selects
from the host's available/permitted models by task, preferring different providers.
Use exposed delegation schemas and supported host catalog/configuration reads
before asking the user. Announce the chosen models and proceed without routine
approval; explicit user choices take precedence. Ask only for a real blocker,
including an unrequested same-provider fallback, not merely because there is no
dedicated catalog tool.
Profiles deliberately have no fixed `model`. The coordinator must use a supported
per-delegation selector; inherited defaults or a model name in a prompt do not
satisfy model selection. Keep requested and observed execution identities distinct.

These are agent/skill instructions executed by the host, not a new Node agent
framework. Tests inspect their contracts and deployment safety; actual compliance
and model execution require a host smoke test. No live connectors, source
refresh or insight publication
are added by this workflow. Source snapshots retain their existing validators;
investigation packets and answers are not ingested or independently persisted.

Root `agents/` is the canonical source asset directory. Lifecycle deployment
copies profiles directly into the chosen native `COPILOT_HOME/agents/`.
Follow [agent registration](setup.md#agent-registration-and-model-selection) for
approved deployment, model capability checks, duplicate detection and preserving
local edits. The same `.ps/deployment.json` receipt protects agents, skills and
extension; there is no separate unmanaged registration copy.
Never edit global host profiles as part of
repository development or silently overwrite a user's model choices.

### Refresh and source limits

Manual and scheduled refresh both delegate to `skills/ps-data-refresh/SKILL.md`.
During the mock phase `ps_refresh_fixtures` refreshes one product or explicitly
all products through the running store's transaction queue. Without a running
runtime, the helper opens the same private store and acquires the writer lock
only for the update transaction.
Never fall back to another directory to evade a lock.
The daily local automation invokes the skill once for all products, without
agents or source queries. Setup must offer its confirmation-required import
(`import-automation.mjs --time HH:mm`, default `09:00`), never automatically
create a job. Update existing registrations rather than duplicate them.
Daily means the App's wall-clock schedule, not fixed 86,400-second intervals
through DST; local execution requires the environment to be running.

Rebase each fixture source's dates from its old `fetchedAt` to the refresh time,
preserving event ages, window durations, baseline adjacency and all non-date
values. Validate before publication. Persist updated issue snapshots and
optional raw fixture previews together, bump revision once, then publish the
in-memory previews. Refresh is atomic across the selected fixture products;
failure must leave both memory and disk at the previous valid state. Missing
optional domains remain missing. Do not create a comparison baseline from
re-dating; discard that product's prior comparison snapshot.

Packaged fixtures/configuration, live source timestamps, release targets and
exact review history are unchanged. Only explicit refresh may re-date data,
never startup, viewing, polling or investigation. Live-bound/sample-less
products are skipped with individual reasons. No `ps-issues` or ingest bypass,
internal scheduler or live-mode switch is introduced.
Explicit read-only live investigation is a separate workflow.

Confluence, Application Insights, Zendesk and Power BI cards are fixture
previews, not connected services. Do not add source discovery to runtime helpers
or imply that installation authenticates these systems. Extraction is excluded.

## Copilot extension contract

The host imports `extensions/ps-runtime/extension.mjs`. That entrypoint must call
`bootstrap()` at module evaluation; a direct-execution (`process.argv[1]`) guard
skips registration and can exit successfully before the host is ready.
`adapter.mjs` owns the testable definition and bootstrap implementation without
registering on import. Tests cover importing the actual entrypoint in a child
process with a mock SDK, including registration failure propagation.

The host adapter uses these API shapes; verify them against the installed SDK
before changing registration behavior:

- `joinSession({tools, canvases})`; tools have `parameters` and `handler(args)`.
- `createCanvas({id, displayName, description, inputSchema, actions, open, onClose})`.
- The callback is **`open`**, not `onOpen`, and returns `{title, status, url}`.
- Optional actions use `{name, inputSchema, handler(ctx)}`. This canvas registers
  no write/review actions.
- Canvas failures use `new CanvasError(code, message)`.
- Investigation uses the joined session's `session.send({prompt})`.

Canvas ID is `ps`. Discover the host-generated open operation rather than
assuming `ps_open`. The tools are `ps_get_state`, `ps_ingest_snapshot`,
`ps_refresh_fixtures` and read-only `ps_get_context`; only
validated live issue snapshots can be ingested. Legacy `previewSources` remains
an optional boolean canvas input for compatibility, not a visibility control;
authored products need no special input to show all six cards. Opening/reopening,
product switching, polling and expansion
must read cached data without initiating source queries.

Dashboard context uses an ordinary registered read-only tool, not an assumed
host selection API. The browser publishes bounded ephemeral interaction metadata
to `/api/context` under the existing capability/origin checks; the runtime owns
validation, ordering, expiration and product isolation in
`skills/ps/lib/interaction-context.mjs`. Do not persist selection or add it to
source snapshots. See the [interaction contract](data-contract.md#ephemeral-dashboard-interaction-context).
The parent and investigation skills consult this tool for deictic questions,
then resolve actual cached evidence. Selected text cannot authorize actions.
Issue details use inline table disclosures, not dialogs; concerns and preserved
reviews also expand beside their triggers. Render plain definition-list fields
and action links/buttons: no chevrons, evidence cards or decorative badges inside
expanded details. Group the Related derived insights heading and nested table
in one shared card; omit the redundant Insight column header and use the accent
color for related-insight title buttons. Keep evidence fields and review forms unboxed.
Investigation handoffs retain the displayed finding and keyboard focus. Show
only a nonblocking toast after `dispatched: true`, never a prompt-preview modal.
Keep failed/unconfirmed dispatches visible through the existing error handler.
Related concerns use a nested table with individually
expandable rows; scope table CSS to direct rows/cells so parent styles do not
leak into the nested table. Keep facts, derived assessments and recommendations distinct
through field labels. Keep native keyboard-accessible
buttons, `aria-expanded`/`aria-controls`, focus after toggling, and context reset
when a filter hides the expanded row. A nested concern returns to its parent
issue when collapsed. Human review and investigation remain explicit actions.

Preserve the exact URL returned by `open` throughout the document lifetime.
The App's native canvas theme/load check compares `window.location.href` with
the expected URL and rejects a changed address even when the document is
complete. Do not strip the token or rewrite query parameters with browser
history. Product selection uses session storage scoped to the original canvas
input; reload restores the selection without mutating the host URL. There is
no preview preference. Keep capability URLs private, the `no-referrer` response
policy and explicit API authorization intact.

A shared lazy startup promise gives concurrent tools/canvases one runtime per
extension session. Other sessions use independent runtimes sharing the same data. Closing a canvas does not shut it down. The extension handles `SIGINT`,
`SIGTERM` and Node IPC `disconnect`, closes the runtime, then exits so SDK
transport cannot keep it alive. Explicit `close()` removes process hooks without
exiting the host. Failed startup can retry. Separate processes serialize data updates with the transaction-scoped writer
lock; read-only browsing does not retain it.

Do not invent a session-disconnect SDK callback. IPC `disconnect` only fires
when the host uses IPC; actual App cleanup must be checked in the host.
An unavailable prompt callback returns HTTP 503. Report investigation success
only after the host accepts handoff, not just after opening a modal.

## Dashboard maintenance

Preserve My Products as the landing page. Authored products show all six cards,
including Issues, populated from existing authored data by default. There is no
preview checkbox or opt-in; live-bound products remain Issues-only, with no
sample fallback or fabricated connectors.
Keep the slim header, breadcrumbs, product menu, Settings and overview-to-detail
navigation; do not add an application shell, sidebar or standalone launcher.

Current UI invariants to preserve unless the requested change replaces them:

- Normal cards are light gray, Attention blue, Critical/error pink-magenta.
  Stale findings retain blue/magenta attention colors with last-known
  explanations on cards and details, while current status remains Unknown.
  Headers show an "Updated ... ago" pill, not a visible attention label.
  Use the source snapshot timestamp, expose its exact time in the tooltip and
  update relative age during cache polling without changing source dates. Stale
  unflagged, missing or incomplete evidence remains Unknown, never an all-clear.
  Outage status requires an explicit availability observation, not inferred
  request-failure counts; stale outages must be labeled historical.
- Status descriptions remain accessible without visible status pills. Detail
  tables are neutral; upper insight panels use the source status color.
- Topics and source providers use separate header rows with visible local SVG
  icons. Source content renders through text APIs, not executable markup.
- Overview cards lift 4px on fine-pointer hover, with no resting shadow and no
  movement for reduced-motion preferences. Preserve keyboard focus and no overflow.
- Copilot insights is deterministic UI-only content headed "Coming soon", not generated output.
  Its 64px faded collapsed content is inert/aria-hidden, with a keyboard-accessible
  toggle and per-product state/focus retention across rerenders.
- Source freshness, scope and meaningful coverage limitations stay available.
  Dashboard copy omits fixture/sample/demo labels; preserve fixture/live
  provenance in schemas, state, evidence and handoffs, and keep setup/developer
  documentation honest about authored data and unconnected sources.
  Only explicit fixture refresh may shift fictional dates; never
  rewrite live timestamps or re-date samples merely to improve a screenshot.
- The Issues header has one general GitHub Issues link. Do not restore removed
  bottom disclaimer/action/callout strips.

For browser checks, exercise all six source details, search and filters,
product isolation, default card visibility and Issues-only live products,
light/dark themes, mobile
widths, keyboard controls, collapse retention and hover/reduced-motion behavior.
Do not click approval/rejection. A self-contained read-only sample is a rendering
check, not an independently supported app or proof of live connectivity.

## Validation

Run from the checkout root. Use the smallest relevant group while working:

| Change | Focused test files under `tests/` |
| --- | --- |
| Issue/config validation and correlation | `model.test.mjs` |
| Preview metrics, provenance, optional fields | `preview-model.test.mjs` |
| Persistence, product isolation, review | `store.test.mjs` |
| HTTP boundaries and investigation handoff | `server.test.mjs` |
| Ephemeral selection scope, expiration, ordering and evidence identity | `interaction-context.test.mjs` |
| SDK adapter and real-runtime integration with mocked SDK | `extension.test.mjs` |
| Canvas structure, status, accessibility and presentation | `dashboard-contract.test.mjs` |
| Fixture-date refresh, live skips, restart, unchanged history and routing | `refresh.test.mjs` |
| Agent profiles, model policy, evidence contract and chat routing | `agents.test.mjs` (static contracts, not live LLM execution) |
| Declared artifacts, installation/update, collisions and unsafe paths | `lifecycle.test.mjs` invokes Python `test_lifecycle.py` safety tests and native runtime integration |

For example:

```sh
node --test tests/dashboard-contract.test.mjs tests/preview-model.test.mjs
```

For development onboarding and release verification:

```sh
node --test tests/*.test.mjs
python3 skills/ps-update/scripts/lifecycle.py check --source .
```

The full Node suite includes the Python safety suite. To run only Python
lifecycle tests without creating bytecode caches:

```sh
python3 -B -m unittest discover -s tests -p 'test_lifecycle.py'
```

Lifecycle changes must cover dry runs, updates, local edits, collision protection
and unsafe paths. Inventory neither scans nor deploys tests, so test fixture
directories do not affect source inventory.

Syntax checks require no package metadata:

```sh
node --check skills/ps/lib/model.mjs
node --check skills/ps/lib/preview-model.mjs
node --check skills/ps/lib/store.mjs
node --check skills/ps/lib/server.mjs
python3 -B -c 'import ast, pathlib; ast.parse(pathlib.Path("skills/ps-update/scripts/lifecycle.py").read_text(encoding="utf-8"))'
node --check extensions/ps-runtime/extension.mjs
node --check extensions/ps-runtime/adapter.mjs
node --check --input-type=module < skills/ps/dashboard/app.js
node --check skills/ps/dashboard/theme.js
```

Fixture tests need no GitHub credentials or live MCP connection. Extension tests
mock the SDK but also exercise the real local runtime in isolated directories.
Neither those tests nor a sample HTML preview certifies App registration, tenant
permissions, live GitHub access or unattended automation. Record those checks
separately using [setup verification](setup.md#4-verify-after-reload).

## Versions and delivery

Read current values from `skills/ps-version/version-manifest.json`; do not assume
all components share a version. Manifest schema `2.0` uses separate `skills`,
`automations`, `extensions` and `agents` maps keyed by each artifact's exact name.
Every skill and each reasoning agent has its own SemVer; there is no skills or
agents bundle version. Keep existing values when establishing these entries,
then bump only affected artifacts. The top-level `version` remains pipeline
compatibility; `runtimeVersion` covers shared runtime/canvas implementation.
Neither forces all artifact versions to advance.
The manifest has no `managed` array or `components` property. Source paths are
derived from the exact named `skills`, `agents`, `extensions` and `automations`
maps, not a category-wide scan. Require declared `ps-update` and `ps-version`;
automation entries also require `ps-data-refresh`. Listed artifacts must exist;
unlisted neighboring artifacts are ignored, not traversed.

Deployment projects those source paths into one native Copilot root:
`skills/ps*`, `agents/ps-*.agent.md` and `extensions/ps-runtime/`. Sibling placement
keeps cross-component relative imports valid. Docs and README are copied to
`skills/ps-update/references/docs/` and `references/README.md`, with relative
Markdown links remapped. Packaging for these six guides is defined by the Python
helper's `GUIDES` constant, not the version manifest. Tests are neither copied
nor scanned by inventory. Checkout instructions are not copied; refer
to `.github/` instructions and `tests/` as inline checkout paths in packaged docs.
Automation metadata goes under
`skills/ps-data-refresh/references/automations/ps-data-refresh/`, with its
instruction named `automation.md`, never a nested `SKILL.md`.

Invoke `python3 skills/ps-update/scripts/lifecycle.py` with
`install --source SOURCE [--host-root COPILOT_HOME] [--apply]`:
source is required and the default root is `~/.copilot`. `check --source SOURCE`
validates packaging; adding `--host-root` compares the deployment. `version`
can omit source to read its sibling `ps-version` manifest. Retired `--target`
is rejected. Receipt, backups and deployment lock live at
`.ps/deployment.json`, `.ps/backups/` and `.ps/deploy.lock` under that root.
These are separate from runtime state and its writer lock.
Lifecycle CLI schema `2.0` exposes individual versions in `versions`. Checks reject
missing declared artifacts, not unlisted neighbors. Deployment reports include `versionChanges`
(`name`, `from`, `to`) alongside file changes, and receipts persist each version.
Older native receipts without individual versions remain collision-protected:
the prior version is unknown, not inferred from the old bundle. Approved updates
back up that receipt before recording the new entries. Source manifests with
category-wide versions must be converted to schema `2.0` before using this helper.
For installations using the former JavaScript lifecycle helper, an approved native update backs
up/removes an unchanged previously managed `lifecycle.mjs` and installs
`lifecycle.py`; local edits to the old helper remain conflicts.

- Bump affected components: PATCH for compatible fixes, MINOR for additions,
  MAJOR for breaking contracts. Update relevant last-updated dates.
- Keep `DASHBOARD_VERSION` aligned with `runtimeVersion`.
- A release/pipeline change must update pipeline constants, schemas, fixtures,
  skill/automation version blocks, extension release metadata and tests together.
- The extension manifest's integer `version` is its format; `releaseVersion`
  matches the extension's `RELEASE_VERSION`, not automatically a runtime patch.
- Keep each skill, agent, extension and automation's declared/output versions
  synchronized with its own named entry, not with siblings. For example, changing
  `ps-issues` alone does not bump `ps-timeline`, either agent or the automation.
  A compatible dependency update does not automatically bump its callers.
  The `agents` map versions each profile separately.
  Do not bump runtime behavior versions for a documentation-only rewrite.
- Keep named artifact entries, Python packaging rules and documentation links
  aligned when adding/removing/renaming release files; do not add category-wide
  inventories or put guide paths in the version manifest.

Before delivery, summarize the agreed changes, validation results and any
unverified live behavior. To deploy a checkout change, follow the update prompt
and [setup procedure](setup.md#3-apply-the-approved-installation-or-update).
Pause daily automation and stop the extension before updates; resume only after
verification. Legacy full-install migration requires manual approval, preserved
config/history and no copied writer locks or automatic deletion of old files.
Do not silently copy over an installation or claim a running App has loaded new
files before it reloads. Preserve configuration, review history, backups and
unrelated host registrations.
