# Product Scout

Read `docs/setup.md`, `docs/development.md` and
`docs/data-contract.md` before changing this project. Node.js >=22 for runtime,
adapter, refresh and automation import; dependency-free ES modules and node:test.
Version/update tooling alone uses Python >=3.9 and the standard library, without
pip or a virtual environment. Keep all work in this repository.

Product Scout is a reusable workflow template, customized and validated before
deployment; the unchanged fixtures are for an explicitly requested walkthrough.
Plugin distribution is intended but not yet implemented. Current setup copies
native components for testing; it is not standalone application installation.
Never ask for an installation parent or propose creating a separate `ps` folder.
Read setup from the user's current source before deployment; if a loaded skill
or prior conversation proposes the old layout, stop and resolve that conflict
before writing. Do not remove existing copies or private state automatically.

Read [How to use Product Scout](../docs/how-to-use-product-scout.md) to preserve
the product intent: independent product-owner investigation through a read-only
visual dashboard and shared-context Copilot chat. Dashboard colors are sufficient
for now; email, Teams or other notifications remain possible future extensions.
Formal approval is not required for ordinary use.
Periodic collection/analysis is the intended workflow, not a
claim that current mock refresh performs it.

For substantive product investigation, use `skills/ps-investigate/SKILL.md`:
native Analyst -> Challenger -> Analyst revision with task-based model selection.
Canonical agent profiles live in source `agents/`; lifecycle deploys them directly
to native `COPILOT_HOME/agents/` under the same receipt as skills and extension.
Preserve chat-only use, source-skill ownership and
the lightweight path for facts. Opening or refreshing the dashboard must not
invoke these agents.

When a user asks GitHub Copilot to add, change or remove a datasource, read and
follow [Managing a datasource](../docs/managing-a-datasource.md). Cover UI,
data contracts, persistence, manual/scheduled refresh, tests and packaging;
do not implement only the card or silently enable live refresh.

Skills own host MCP orchestration; runtime owns deterministic validation,
correlation, local persistence and canvas rendering. Preserve My Products as the
landing page. Authored products show all six populated cards by default without
a preview checkbox or fixture/sample/demo labels; configured live products stay
Issues-only with no sample fallback. Internal fixture/live provenance remains
mandatory, and setup/developer documentation must identify authored data honestly.
Never infer release readiness from missing
issue flags. Keep facts, derived concerns and recommendations distinct.

All user-facing Product Scout chat uses concise natural language, not JSON.
JSON remains internal for dashboard data, validation and handoffs. Summarize
child-skill/tool results instead of forwarding machine payloads into chat,
preserving errors, skips, uncertainty and explicit human-review requirements.

GitHub access is read-only. Human review is explicit and cannot be performed by
automations. Fixture versus live provenance is mandatory. Do not introduce
extraction, fabricated repositories, IDs, sources, remote updater URLs or secrets.

For lifecycle changes, test dry runs, updates, collision protection and unsafe
paths with `node --test tests/lifecycle.test.mjs` (Python safety suite plus native
runtime integration). Python-only tests use
`python3 -B -m unittest discover -s tests -p 'test_lifecycle.py'`; avoid bytecode caches.

Use `python3 skills/ps-update/scripts/lifecycle.py`. Manifest schema `2.0` has
exact named skill/agent/extension/automation maps, no `managed` or `components`.
Derive paths from these entries; validate declared artifacts and ignore unlisted
neighbors, never scan whole categories or tests. Require `ps-update` and
`ps-version`, plus `ps-data-refresh` for automation entries. The Python `GUIDES`
constant owns packaging for README and five docs. Only `ps-update` and
`ps-version` advance to `0.7.0` for this port. Existing native receipts remain valid:
approved updates replace the unchanged old JS lifecycle helper with Python,
backing it up first; edited old helpers conflict.

Deploy approved components into one native Copilot root, default `~/.copilot`
(explicit project alternative `PROJECT/.github`). No enclosing `ps` folder,
full-repo copy, mixed roots or runtime dependency on the checkout. Use mandatory
`--source` and optional `--host-root`, never retired `--target`.
Preserve `.ps/deployment.json`, local edits, unrelated host components and private
`.ps/state.json`; deployment uses `deploy.lock`, runtime/refresh share `writer.lock`.
Pause daily automation and stop the extension before updates; verify before resuming.
Legacy migration is manual and approved, never automatic deletion or copying locks.

Workspace preference: after validating requested changes, automatically apply
updates to the previously approved Copilot component root without repeated
deployment approval prompts. Still dry-run, check and back up; preserve
configuration/history, refuse conflicts or unsafe paths, and coordinate runtime
and automation shutdown/resumption safely. This standing authorization does not
cover unrelated changes, new destinations or destructive state resets.

Setup always offers user-confirmed daily local all-products sample-refresh import,
default `09:00`. The helper emits draft links, never creates a schedule. The user
reviews project/local execution/model/time and confirms Create; update existing
jobs instead of duplicating them. Refresh invokes no agents or source queries.
Local execution needs the environment running; daily is wall-clock time, not a
guaranteed 86,400-second interval through DST.
