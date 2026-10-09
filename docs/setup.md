# Product Scout setup

Product Scout is a reference template, not a standalone application to install
unchanged for every organization. First agree on the intended owner workflow and
integrations, customize the source, and validate it. An explicitly requested
fixture walkthrough may use the supplied sample unchanged.

A Copilot plugin is the intended distribution format for a customized workflow.
Plugin packaging is not yet implemented here. The procedure below is the
**current native-copy path for testing samples or validated customizations**,
not a plugin installation procedure.

Copy components directly into **GitHub Copilot App's native
user-level directories**. The default common root is `~/.copilot`; there is no
enclosing `ps` application folder and no full-repository installation.
The source checkout or release is an installation input, never a runtime dependency.

For the product-owner workflow and current preview limits, read
[How to use Product Scout](how-to-use-product-scout.md).
A successful copy does not prove the App loaded the components or created a
schedule. Verify each separately.

## Before copying components

Establish whether the user wants the supplied fixture walkthrough or a customized
workflow. For customization, agree on datasources, MCP access, owner context,
cards, signals, agents/models and refresh behavior before deployment. Follow
[Managing a datasource](managing-a-datasource.md) and
[Development](development.md) to implement and validate the agreed changes.
Never treat fixture cards as configured live integrations.

Do not ask for an "installation parent" or propose an Applications directory,
`product-scout-install`, or a parent beneath which to create `ps`. A source
checkout path is not a deployment destination. Use the native root below unless
the user explicitly selects project scope.

If a session proposes that old layout, stop before writing. Re-read this guide
and `skills/ps-update/SKILL.md` from the user's current source, check which skill
copy the host loaded, and resolve stale or conflicting instructions. Reload the
appropriate customization or start a fresh session as needed; do not delete old
copies or private state automatically.

## Copy-paste installation prompt

```text
Read docs/setup.md from my provided current source. Confirm whether I want the fixture walkthrough or a customized workflow; complete and validate agreed customizations before copying anything. Use the current native-copy path into ~/.copilot, not an installation parent or enclosing ps folder. Show the dry run for approval and offer the daily local all-products sample-refresh import for my review.
```

## Copy-paste update prompt

```text
Read docs/setup.md from my provided current source and update my native Product Scout components from the validated customized release. Use the existing native Copilot root, not a new installation parent. Preserve local customizations/configuration/history, show the dry run for approval, and review the existing daily refresh registration without duplicating it.
```

For checkout-based development, use the
[development prompts](development.md#copy-paste-development-installation-prompt).

## Agent operating rules

- Establish sample versus customization intent before deployment; do not assume
  every organization wants the unchanged template.
- Use the confirmed user-level layout by default. Never ask for an installation
  parent or append `ps` to a destination. Ask only for missing source,
  App/profile or consequential choices; never invent a repository or product binding.
- Explain progress briefly: validate, preview, approve, copy, reload, verify.
  Never print credentials, private state or capability-bearing canvas URLs.
- Obtain approval for the displayed file plan and host changes. Stop on conflicts,
  unsupported APIs or permissions; do not force-copy or substitute a standalone app.
- Always offer the daily local sample-refresh import during setup. Offering and
  opening its draft are not permission to create a schedule automatically.

## 1. Collect inputs and check prerequisites

| Input | Decision |
| --- | --- |
| `SOURCE` | Required trusted local checkout/release path; no default remote or automatic download |
| `COPILOT_HOME` | Common component root, default `~/.copilot` |
| App profile | App instance/profile and project/session that will load the components |
| Product mode | Authored fixtures by default; real bindings only when supplied |
| Daily refresh | Offer local all-products sample refresh at `09:00` by default; the user reviews time and confirms creation |

An explicitly approved project-local alternative uses **`PROJECT/.github` as
the common root**. Skills, agents and extension must all be siblings under that
same root; do not mix project and user roots. Check for shadowing registrations.
An explicit `--host-root` must be an **absolute path whose final directory name
is `.copilot` or `.github`**; `/`, your home directory and other broad targets
are rejected. Source and component root must not overlap. Project-local
deployment therefore requires a **separate trusted source checkout**: never
deploy a checkout into its own `.github`. Quote paths and replace placeholders
with approved paths before executing examples. `"$HOME/.copilot"` expands the
default correctly; a quoted `"~/.copilot"` is not shell tilde expansion.

| Prerequisite | Check |
| --- | --- |
| Python >=3.9 | Run `python3 --version` for version/update tooling. The helper uses only the standard library: no pip, virtual environment or package installation. |
| Node.js >=22 | Run `node --version` in the App's execution environment. Runtime, Copilot adapter, refresh and automation-import helpers still require Node. Obtain approval for prerequisite installation if needed. |
| GitHub Copilot App | Verify skills, custom agents, extension-hosted canvases and local automations in the installed build. |
| Host SDK | Verify `@github/copilot-sdk/extension` through App diagnostics, not an unrelated terminal's module resolution. |
| Agent models | Verify native delegation and supported per-call model selection/catalog; do not invent APIs or model IDs. |
| Trusted source | Read its version manifest, `ps-update` skill and extension manifest/entrypoint. |
| GitHub MCP | Optional for explicit live investigation only; use supported read-only integration and interactive sign-in. |

There is no npm install, standalone launcher or browser fallback. Other preview
providers require no connectors. If given only a trusted repository URL, follow
the [checkout procedure](development.md#agent-development-installation); do not
guess a remote or borrow another project.

## 2. Validate the source and preview changes

Run the source's lifecycle helper:

```sh
python3 "<SOURCE>/skills/ps-update/scripts/lifecycle.py" version --source "<SOURCE>"
python3 "<SOURCE>/skills/ps-update/scripts/lifecycle.py" check --source "<SOURCE>"
python3 "<SOURCE>/skills/ps-update/scripts/lifecycle.py" install --source "<SOURCE>" --host-root "<COPILOT_HOME>"
```

`install` requires `--source`; omitting `--host-root` selects `~/.copilot`.
The retired `--target` option is rejected. `check --source SOURCE` validates
source packaging; add `--host-root COPILOT_HOME` to compare a deployment.
`version` alone may read its own sibling `ps-version` manifest.

The last command is a **dry run**: no copied files or receipt. Inspect JSON and
exit status together. Source validation must report `valid: true`; review
`changes` and resolve all `conflicts`. `applied: false` can mean dry run,
already current or blocked, not success by itself. Compare every component
version, not just pipeline compatibility. Manifest schema `2.0` lists each skill,
agent, extension and automation by name; there are no shared category versions.
There is no `managed` array or `components` property. Artifact paths are derived
from the exact named maps; listed artifacts must exist, while unlisted neighboring
artifacts are ignored, not traversed. `ps-update` and `ps-version` must be declared,
and automation entries require `ps-data-refresh`. The Python helper's `GUIDES`
constant defines packaging for README and the five documentation guides; tests
are neither deployed nor scanned by inventory.
Lifecycle CLI schema `2.0` reports these in `versions` and lists individual
`versionChanges` (`name`, `from`, `to`) alongside file changes. Older native
receipts have unknown prior artifact versions (`from: null`); do not infer them
from a bundle version. An approved update records individual versions while
preserving existing file-hash collision protection.

Show the actual root, destination files, versions and changes. Obtain approval
before applying; repeat the dry run if the source changes after review.

## 3. Apply the approved installation or update

Before an update, **pause the daily automation and stop the Product Scout
extension/runtime** through supported App controls. Closing a canvas does not
stop the runtime. Never kill unrelated processes or bypass a live lock.

```sh
python3 "<SOURCE>/skills/ps-update/scripts/lifecycle.py" install --source "<SOURCE>" --host-root "<COPILOT_HOME>" --apply
python3 "<SOURCE>/skills/ps-update/scripts/lifecycle.py" check --source "<SOURCE>" --host-root "<COPILOT_HOME>"
```

Use the same approved root in both commands. After applying, comparison must
show no changes or conflicts. Record any backup path. An already-current
deployment may need no apply.

For installations using the former JavaScript lifecycle helper, existing native
receipts remain valid. An approved update backs up and removes an unchanged,
previously managed `lifecycle.mjs` and installs `lifecycle.py`. An edited old
helper is a conflict, not permission to overwrite it or bypass its receipt.

The managed native layout is:

```text
COPILOT_HOME/
  skills/ps/                         # runtime, dashboard, config and fixtures
  skills/ps-*/                       # interactive skills and helpers
  agents/ps-analyst.agent.md
  agents/ps-challenger.agent.md
  extensions/ps-runtime/
  .ps/deployment.json                # lifecycle receipt
  .ps/backups/                       # update backups
  .ps/deploy.lock                    # deployment lock
  .ps/state.json                     # private runtime state, not deployment content
  .ps/writer.lock                    # transaction-scoped data writer lock
```

Only approved component files are copied. Documentation is packaged under
`skills/ps-update/references/docs/` and `references/README.md`, with relative
Markdown links remapped during copying. Tests and checkout-only instructions
are not installed. Automation metadata is packaged under
`skills/ps-data-refresh/references/automations/ps-data-refresh/`; its instruction
file is `automation.md`, not a nested `SKILL.md` that might be discovered as a
second skill.

Sibling component directories preserve relative imports, including the
extension's `../../skills/ps/lib/` imports. No symlinks, checkout imports or
detached extension copies are needed. Do not copy the whole repository into
the host or overwrite unrelated skills, agents, extensions or host configuration.

The receipt protects all managed copies, including native agent profiles.
Local edits/deletions and unmanaged collisions block replacement, even when a
colliding file has identical bytes. Unsafe paths and symlinks are rejected.
Never force an update, delete/edit receipts to bypass checks, or clear locks
without establishing that their owners have stopped.

## Host registration

Native directories are the deployment destinations, not a second set of
unmanaged registration copies. Inspect the installed App's supported discovery
and enablement controls; preserve unrelated settings and obtain approval for
configuration changes. See GitHub's
[canvas extension guidance](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions).

1. Confirm discovery of `ps`, `ps-investigate`, `ps-issues`, `ps-timeline`,
   `ps-version`, `ps-update` and `ps-data-refresh` under the chosen `skills/`.
2. Confirm `extensions/ps-runtime/` is loaded. Its manifest is
   `copilot-extension.json`, entrypoint `extension.mjs`, name `ps-runtime`.
   The manifest's integer `version` is a format version; compare `releaseVersion`
   with the source, not necessarily the runtime version.
3. Check agent discovery below, then reload/restart and begin a fresh session.
   Report required user interaction instead of claiming a reload occurred.
4. Offer the [daily refresh import](#optional-scheduled-refresh). Files alone
   never create a scheduled job.

### Agent registration and model selection

The lifecycle helper copies the canonical source profiles directly to
`COPILOT_HOME/agents/ps-analyst.agent.md` and
`COPILOT_HOME/agents/ps-challenger.agent.md` (default `~/.copilot/agents/`).
The same deployment receipt tracks
and updates them; **do not create separate discovery copies**. Preserve local
profile edits and check project/user scopes for shadowing/duplicate names.

Verify both agents in `/agent` or the App picker. Then verify actual delegation
and requested/observed model identity where exposed; listing a profile alone
does not prove model execution.

The [investigation policy](../skills/ps-investigate/references/model-selection.md)
selects permitted models by task, preferably across providers. Profiles have no
fixed model. Use supported per-delegation selection, never prompt text as a
substitute. An approved set of exact picker IDs can supplement a missing
catalog; inability to assign delegated models is a blocker, not permission to
change global settings or silently use a fixed-model fallback.

**Chat-only use:** supplied scoped evidence can be analyzed by `ps-investigate`
and these tool-free profiles without opening a canvas. Source skills still own
retrieval. Native deployment does not make investigation dependent on a running
dashboard.

## 4. Verify after reload

If the extension is discovered but tools never appear, inspect its startup log
under `~/.copilot/logs/extensions/` and confirm the loaded entrypoint path.
An import followed by `peer-closed-before-ready` and exit code `0`, without an
exception, can indicate an older entrypoint with a direct-execution guard.
The current `extension.mjs` registers on import and loads its sibling
`adapter.mjs`. Compare the loaded files with the source and its version manifest.
Deploy the complete extension through the
approved update flow, reload extensions and verify registration in a fresh
session. Do not treat discovery or a zero exit code as successful registration.
For other failures, retain the actual error rather than assuming the same cause.

If registration succeeds but the App says "The extension canvas did not finish
loading. Try again.", verify the dashboard/runtime version as well.
Older dashboards rewrote the URL during startup, conflicting with the App's
exact-URL load check. The current dashboard preserves the host-issued URL and
keeps product selection in session storage. Compare the skill-owned dashboard
with the current source and version manifest. Update the dashboard
and version manifest through the approved flow, then reload/reopen the canvas.
Updating the extension alone does not update the skill-owned dashboard. Do not remove locks,
disable authorization or start a standalone server to bypass the error.

Report each layer separately:

1. **Files:** source validation and deployment comparison pass; all components
   exist in the native sibling layout, independent of the source.
2. **Discovery:** seven skills, two profiles and the expected extension
   path/version are loaded without stale duplicates.
3. **Runtime:** discover the actual schemas for `ps_get_state`,
   `ps_ingest_snapshot`, `ps_refresh_fixtures` and `ps_get_context`. Read cached state; do not ingest
   fixtures or approve/reject memory to prove installation.
4. **Canvas:** invoke `/ps` and the discovered open operation for canvas ID `ps`,
   not an assumed `ps_open`. My Products is the landing page. Open either authored
   product and verify all six cards, including Issues, are populated by default,
   without a preview checkbox or fixture/sample/demo labels. Configured live
   products stay Issues-only. "Coming soon" insights remain deterministic wording,
   not generated Copilot output. The extension retains the legacy
   `previewSources` boolean for compatibility; it cannot control visibility.
   Open a finding and highlight text, then ask "Explain this" in chat. Confirm
   the session invokes `ps_get_context`, identifies the same product/finding
   and uses cached evidence without treating selection as instructions.
   Verify issue rows and evidence expand/collapse inline without a finding popup.
   Collapsing details returns to the card; navigation clears selections. With
   multiple active canvases or expired context, the session must clarify.
5. **Investigation:** for a requested bounded fixture assessment, verify that
   Copilot discovers eligible models, announces the selected pair and proceeds
   without routine model approval. Verify explicit user model choices are
   honored and real blockers (including an unrequested same-provider fallback)
   prompt a focused question. Verify handoff, analysis/challenge/revision and
   actual model metadata separately; an announcement is not execution proof.
   Test a simple fact separately; it must not invoke the pair.
6. **Live access:** only if requested and configured, test a read-only GitHub
   query. Never equate access failure with a successful empty result.
7. **Automation:** record whether the user declined, left a draft or confirmed
   creation/update. Verify registration and execution history separately.

Fixtures age normally. Do not silently re-date them for a healthy screenshot;
use only explicit refresh. Offline tests are not live App certification.
Keep canvas capability URLs and private state private. Resume a paused daily
job only after verifying the updated components and its intended registration.

## Product configuration and safe updates

Keep product configuration in a private approved source copy, preserving stable
IDs and schema version. Never commit private bindings. See the
[data contract](data-contract.md). Live-bound products are skipped by mock
refresh and cannot receive fixture previews; missing flags never certify readiness.

Before changing configuration, pause automation, stop the runtime and privately
back up configuration and state. Merge bindings into the new source, not over
new code or manifests, and validate from that source root:

```sh
node --input-type=module -e 'import { readFile } from "node:fs/promises"; import { validateConfig } from "./skills/ps/lib/model.mjs"; validateConfig(JSON.parse(await readFile("./skills/ps/config/products.json", "utf8"))); console.log("Product configuration valid");'
```

Then validate packaging and review a new dry run. If installed files were
edited outside the managed update flow, stop for an approved reconciliation;
do not restore stock config or discard a receipt just to unblock deployment.
Private `COPILOT_HOME/.ps/state.json` stays outside managed component content.
Both extension and refresh CLI share it across concurrent sessions. Updates use
`writer.lock` briefly, reloading current state before writing; browsing never
holds it for a session's lifetime. Each open store has a `runtime-<UUID>.lock`
lease that blocks component updates, not other sessions. Never fall back to a
different store to evade contention.

**Legacy full-install migration is manual and approval-gated.** Inventory the
old installation, bindings, review history and registrations. Pause its job and
stop both runtimes. Back up privately, merge configuration into a trusted source,
review the native deployment plan and explicitly migrate compatible state.
Do not copy writer locks. Reconcile old registrations with approval to avoid
duplicates, reload and verify preserved products/history. Never automatically
delete the old installation or its receipt, history or backups.

## Optional scheduled refresh

**Always offer this during setup:** daily local sample refresh for **all
products**, at `09:00` unless the user chooses another
time. Creation remains optional and user-confirmed; no separate request is
needed to receive the offer. If `ps-data-refresh` is already registered, review
and update that job rather than creating a duplicate.

After agreement to review the import, run:

```sh
node "$HOME/.copilot/skills/ps-data-refresh/scripts/import-automation.mjs" --time 09:00
```

Use the chosen root and `HH:mm` time; omitting `--time` defaults to `09:00`.
The helper emits confirmation-required JSON with `appLink` containing a
`ghapp://automations/new?name=ps-data-refresh&trigger=daily&time=...&prompt=...`
deep link and `launcherUrl` containing the official launcher URL. It does not
create a schedule. URLs
contain no customer paths, bindings or data. Do not add such data to them.

Open the generated import link through the supported App launcher. The user
reviews the draft dialog, selects the project, **local execution**, model and
time, and explicitly confirms **Create**. An existing job must instead be
updated through the App's controls. Do not write internal scheduler databases.
GitHub documents [deep links as draft dialogs requiring confirmation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/open-with-deep-links)
and [automation execution and scheduling](https://docs.github.com/en/copilot/how-tos/github-copilot-app/using-automations).

Each run invokes `ps-data-refresh` once for **all products**. It only shifts dates
in fictional working copies, preserving relative windows, fixture provenance,
release dates and reviewed history. Live-bound/sample-less products are skipped.
It performs no source queries, ingestion or Analyst/Challenger investigation.
Use `ps_refresh_fixtures` when connected, or the refresh CLI on the same private
store even with other sessions open; updates serialize through the writer lock.

Local automation requires the local environment to be running. The App trigger
is a daily wall-clock time, **not guaranteed 86,400-second spacing across DST**.
Verify actual registration and run history before claiming it works; a generated
link or a test of the helper is not a verified scheduled run.

## Recovery and final report

Use the exact reported backup path under `COPILOT_HOME/.ps/backups/`. Backups
can contain private configuration. For interrupted updates, pause automation
and stop the runtime, inspect the rollback plan and obtain approval before
restoring only listed managed files and the previous receipt. Check subsequent
edits before removing any listed newly added files. Never recursively delete a
host root, private state or unrelated components.

Compare with the matching prior source, reload and verify before resuming the
job. Preserve incomplete recovery backups. Confirmed-dead `.ps/writer.lock`
owners recover automatically. Stale `.ps/deploy.lock` and writer recovery guards
require manual inspection; deleting a receipt or an active lock is never recovery.
A runtime lease with a confirmed-dead PID does not block deployment.

Report source/root, release/component versions, changes, backups, file checks,
App discovery, canvas/model/live checks and the daily import decision separately.
Mark unperformed checks **not verified** and state required reload, sign-in or
user confirmation. No host behavior is proven solely by offline tests.
