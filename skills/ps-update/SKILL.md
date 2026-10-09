---
name: ps-update
description: Copy or update Product Scout skills, agents and extension in native Copilot directories, preserving other components; prompt for daily sample-refresh automation import.
domain: lifecycle
capabilities: safe-install, local-update, backup-guidance, managed-file-protection
---

# Product Scout Update

## Purpose

Deploy skills, agents and the extension directly to their Copilot discovery
directories, then prompt for the daily automation import. Do not create a
separate Product Scout application folder or copy the whole repository.

This skill owns `scripts/lifecycle.py`; `ps-version` uses the same helper for
read-only metadata and comparison. Commands below are relative to the release
root or the shared Copilot component root, not the current project by assumption.
Consume `skills/ps-version/version-manifest.json` as the single release authority;
use its individually named skill, agent, extension and automation versions,
never a shared category version. Change only affected artifacts' entries.
Artifact paths are derived from those names; no `managed` list is needed.
Documentation-copy rules belong to the helper, not the version manifest.
Tests and undeclared neighboring artifacts are not scanned or deployed.
Do not maintain a second manifest in this skill or at the release root.

## Inputs

Trusted local source release root, approved Copilot component root and explicit
apply authorization. Default user scope is `~/.copilot`; an explicitly selected
project scope uses `PROJECT/.github`. Never mix component roots. No remote
publishing endpoint is defined.

## Workflow

1. Resolve SOURCE and COPILOT_HOME explicitly. Default COPILOT_HOME is
   `~/.copilot`, not a new installation parent. Read source `docs/setup.md`
   (deployed copy: `skills/ps-update/references/docs/setup.md`).
   Validate source with the lifecycle check command. Never inventory the shared
   Copilot directory as a source release.
2. Use Python 3.9+ (standard library only; no pip or virtual environment).
   Run from the release root:
   `python3 skills/ps-update/scripts/lifecycle.py install --source SOURCE --host-root COPILOT_HOME`.
   This is a dry run and must not create the target.
3. Report every add/update/remove and conflict. Local edits or unmanaged file
   collisions block apply; ask the person to reconcile the exact files.
   Do not force overwrite or erase a receipt to bypass protection.
4. Only on explicit authorization for those changes, repeat with `--apply`.
   Stop the extension and pause its daily automation before update; do not
   remove private state. Copy `skills/ps*`, `agents/ps-*.agent.md` and
   `extensions/ps-runtime` directly into the shared Copilot root. Relative
   dependencies remain valid without a full repository copy. Guides go under
   the update skill's references; automation instructions/metadata go under
   the refresh skill's references, not a second interactive skill.
   When replacing the former Node lifecycle helper, unchanged receipt-managed
   files are backed up and retired. Local edits still block replacement.
5. Report the backup path and run `check --source SOURCE --host-root COPILOT_HOME`.
   The `.ps/deployment.json` receipt covers the actual deployed files, including
   native agent profiles; preserve local model/tool edits and name collisions.
   Follow setup's **Agent registration and model selection** procedure, checking
   shadowing/duplicate names across user and project scope.
   Verify both profiles and automatic model assignment in a fresh App session;
   do not claim registration or model execution from successful file copying.
6. Prompt the user to import local `ps-data-refresh` for all sample products
   every 24 hours (daily). Run the deployed
   `skills/ps-data-refresh/scripts/import-automation.mjs --time HH:mm` helper
   using a time the user can review, then present its draft link. It opens the
   App confirmation dialog; the user selects the project/local execution and
   confirms Create. No automation exists until that confirmation. On update,
   reconcile the existing job instead of importing a duplicate.
7. If an interrupted write needs recovery, use the backup's `rollback.json`
   guidance in setup; do not perform broad directory deletion.

## Safety

No downloads, pip/npm installs, implicit upstream, force flag, broad delete or
automatic approval. Never copy secrets. Symlinks/unsafe manifests are errors.
Backups contain potentially private product configuration and need protection.

## Output contract

User-facing replies use concise natural language, never JSON objects or JSON
code blocks. Explain the actual deployment outcome, destination, changed
components/versions, conflicts, backup location and verification or reload steps.
Use bullets or a table for file changes; never equate copied files with successful
host registration.

Keep the actual lifecycle CLI strict JSON report internal, including schemaVersion,
namespace, version, command, applied, destination, changes, conflicts and backup.
Use `versions` and `versionChanges` (`name`, `from`, `to`) from the CLI when
summarizing; do not paste the report into chat.
The receipt records individual versions alongside file hashes. Older receipts
without them retain collision protection; prior versions are reported as
unknown (`from: null`) until an approved update records the named versions.
`applied: false` may mean dry run, no change or blocked; inspect conflicts and
changes. Errors have schemaVersion and error. Do not manufacture success or
registration state.

## Product Scout Versioning

- Pipeline version: 0.1.0
- Skill version: 0.7.2
- Last updated: 2026-10-09
- User-facing product name: Product Scout
- Internal namespace: ps
- Lifecycle JSON requires schemaVersion `"2.0"` and the selected manifest's
  pipeline compatibility `version`; artifact versions come from their named entries.
