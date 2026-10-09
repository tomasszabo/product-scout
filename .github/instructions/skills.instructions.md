---
applyTo: "skills/**"
---

# Product Scout skill authoring

Read `docs/development.md` and `docs/data-contract.md` first. Use namespace
`ps`, never customer-specific schemas. Each skill directory must match
its frontmatter `name`. Require description, domain, capabilities, purpose,
inputs, workflow, safety, output contract and Product Scout Versioning.

For datasource additions, changes or removals, follow
[Managing a datasource](../../docs/managing-a-datasource.md), including parent
routing, UI and manual/scheduled refresh integration. Preserve the current
fixture-only date refresh unless live refresh is explicitly in the agreed scope.

Keep parent routing dynamic and children bounded. Initially route source reads
only to `ps-issues`. Discover exact host MCP schemas before calling;
never invent tool arguments, IDs, repositories, evidence or successful coverage.
User-facing replies use concise natural language, never JSON objects or JSON
code blocks. Keep strict versioned JSON for internal dashboard data, validation
and handoffs under the documented snapshot contract. Do not forward internal
source/refresh/lifecycle JSON into chat; explain actual outcomes without losing
skips, failures, partial coverage or required human actions. Paginate within
explicit budgets; report partial/unavailable honestly. No extraction, GitHub
writes, automatic approval or background scheduler.

Version each artifact independently. In manifest schema `2.0`, `skills`,
`automations`, `extensions` and `agents` map exact artifact names to SemVer.
Bump only changed artifacts, updating each one's version block/output examples
and its own manifest entry together. Do not bump siblings or automation merely
because a called skill changed. Pipeline compatibility and `runtimeVersion`
are separate; do not use a category-wide version. Only `ps-update` and `ps-version`
advance to `0.7.0` for the Python tooling port. Run relevant offline tests;
`node --test tests/lifecycle.test.mjs` includes Python safety tests and native
runtime integration. Never copy unrelated project code or secrets into this repository.

Put deterministic helpers and assets in their owning skill directory.
`ps-investigate` owns chat orchestration and task-based model selection.
The two tool-free reasoning profiles live in root `agents/`, not in skills.
Source skills still own retrieval; investigation must not become a refresh bypass.
`ps` owns the shared runtime, canvas, product configuration and fictional snapshots.
My Products remains the landing page. Authored products show all six populated
cards by default, without a preview checkbox or fixture/sample/demo labels.
Configured live products remain Issues-only; never supply sample fallback or
invent connectors. Preserve internal fixture/live provenance and honest
setup/developer guidance. The legacy `previewSources` canvas boolean remains
compatible but cannot gate visibility; skills need not request it. Copilot
insights stays deterministic "Coming soon" content, not generated output.
`ps-update` owns `scripts/lifecycle.py`, invoked with `python3` by both version
and update workflows. It uses Python >=3.9 and only the standard library: no pip
or virtual environment. Runtime, adapter, refresh and automation import remain
Node >=22. Use `-B` for Python tests/syntax checks to avoid bytecode caches.
`ps-version/version-manifest.json` is the single version authority, without
`managed` or `components`. Derive artifact paths from exact named maps; validate
listed artifacts and ignore unlisted neighbors, never scan whole categories or
tests. Declare `ps-update` and `ps-version`, plus `ps-data-refresh` when automations
are listed. Python's `GUIDES` constant owns README/five-guide packaging.
Do not reintroduce root-level `web`, `fixtures`, `scripts`, `config` or `lib`
application directories. Keep private `.ps/` state outside managed skill files.
Native deployment uses sibling `skills/`, `agents/` and `extensions/` under one
Copilot root, default `~/.copilot` or explicitly `PROJECT/.github`. Never copy the
whole checkout or create an enclosing `ps` folder. Source is install input only.
Lifecycle requires `--source`, accepts `--host-root` and rejects retired `--target`.
The same `.ps/deployment.json` receipt manages native agents; no separate copies.
Preserve edits/collisions and receipts. Pause automation and stop the extension
before updates; verify before resuming. Runtime and CLI refresh share private
`.ps/state.json` under `writer.lock`, separate from deployment's `deploy.lock`.
Package docs/README under `ps-update/references/` with relative links remapped;
do not package tests or checkout instructions. Package automation metadata under
`ps-data-refresh/references/automations/ps-data-refresh/`, with `automation.md`
instead of a nested `SKILL.md`.
GitHub Copilot App is the only supported application host. Do not add an npm
package, standalone launcher or browser-only investigation fallback.
Data refresh belongs to `skills/ps-data-refresh/`; automation only delegates to
that skill. During the mock-data phase only private fictional working copies may
be re-dated on explicit manual/scheduled refresh. Preserve relative windows,
fixture provenance, live timestamps, release dates and reviewed history.
Never edit packaged fixtures or refresh on view/poll/investigation.
Explicit live investigation is separate from data refresh.
Setup must always offer the daily local all-products refresh import, default
`09:00`, using `import-automation.mjs --time HH:mm`. It emits confirmation-required
draft links without customer paths/data; never creates a schedule. The user
selects project/local execution/model/time and confirms Create in the App.
Update existing jobs, never duplicate them. Each run invokes refresh once for
all products, with no investigation agents or source queries. Local execution
requires the environment running; daily wall-clock timing is not guaranteed
86,400-second spacing through DST.
