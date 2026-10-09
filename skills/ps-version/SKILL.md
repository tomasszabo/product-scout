---
name: ps-version
description: Show the local Product Scout release and component versions or check a supplied local release and installed managed files without changing them.
domain: lifecycle
capabilities: local-version, manifest-validation, dry-run-comparison
---

# Product Scout Version

## Purpose

Read local release metadata and compare deployed Copilot components without network
access, updates or filesystem writes.

This skill owns `version-manifest.json`, the single release and component version
authority. The shared lifecycle helper reads it at
`skills/ps-version/version-manifest.json` within the selected release. Artifact
paths are derived from the named entries; the manifest contains no packaging
inventory. Documentation-copy rules are local to the helper and tests are not
scanned or deployed. Do not maintain a duplicate root-level manifest.
Manifest schema `2.0` records every artifact independently in `skills`,
`automations`, `extensions` and `agents` maps keyed by its exact name.
`runtimeVersion` tracks shared runtime/canvas code; `version` is pipeline
compatibility, not a version assigned to all artifacts. Equal initial values
do not couple future releases. Never copy a bundle version across all entries.

## Inputs

For version only, optional local source; otherwise use the helper's sibling
`ps-version` manifest. Source validation and component comparison require an
explicit source checkout/release. Comparison also requires the Copilot root,
normally `~/.copilot`. No upstream is configured.

## Workflow

1. Locate the deployed helper or trusted source helper, not the host's arbitrary
   current directory. Use Python 3.9+ (standard library only) to invoke
   `skills/ps-update/scripts/lifecycle.py` by absolute path with `version`.
2. Report each named artifact's version. For validation run
   `python3 skills/ps-update/scripts/lifecycle.py check --source SOURCE`.
   Every named artifact must exist at its derived path. Undeclared neighbors
   are not traversed.
3. For comparison add `--host-root COPILOT_HOME`, normally `~/.copilot`.
   The root contains native skills, agents and extension directories, not an
   enclosing `ps/` application. Never run source inventory on a shared host root.
   Preserve actual CLI conflicts and exit status. Never pass `--apply`.
   Report `versionChanges` independently of file changes. A null `from` means
   no recorded prior artifact version (new deployment or older receipt), not
   a guessed bundle-derived version. A null `to` means the artifact was removed.
4. Explain that “latest” cannot be determined from local version metadata. Ask
   for a trusted local release if a newer version is requested; do not invent or
   fetch an upstream URL. Route installation intent to `ps-update`.

## Safety

Read-only. Never copy unrelated projects, install packages, read credentials or substitute
an untrusted remote source. A conflict is not a successful update.

## Output contract

User-facing replies use concise natural language, never JSON objects or JSON
code blocks. Show named component versions in prose or a small table, explain
validation/comparison results and report exact conflicts or errors. Do not claim
that local metadata proves a release is the latest.

The exact strict JSON emitted by the lifecycle CLI remains internal: version responses
use schemaVersion `"2.0"` and contain `namespace`, `version`, `runtimeVersion`,
`skills`, `automations`, `extensions`, `agents`; source checks
contain `schemaVersion`, `command`, `version`, `valid`, `files`, `componentFiles`,
`versions`; comparisons
contain `schemaVersion`, `namespace`, `version`, `command`, `applied`,
`destination`, `changes` (`path`, `action`: `add|update|remove`), `conflicts`,
`backup`, `versions`, `versionChanges` (`name`, `from`, `to`).
`versions` contains `runtimeVersion` and the four named artifact maps.
Failures contain `schemaVersion`, `error`. Summarize the actual result rather
than pasting its JSON into chat; do not change the CLI format.

## Product Scout Versioning

- Pipeline version: 0.1.0
- Skill version: 0.7.1
- Last updated: 2026-09-25
- User-facing product name: Product Scout
- Internal namespace: ps
- Lifecycle JSON requires schemaVersion `"2.0"`; the CLI's `version` is pipeline
  compatibility, not a hardcoded skill version. Source/state schemas stay unchanged.
