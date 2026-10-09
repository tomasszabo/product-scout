---
name: ps-data-refresh
description: Run one host-scheduled Product Scout sample-date refresh through ps-data-refresh; no source retrieval or live timestamp changes.
domain: automation
capabilities: scheduled-data-refresh, skill-delegation, refresh-status
---

# Product Scout Data Refresh Automation

## Purpose

Describe one daily, local host-scheduled invocation of the reusable data-refresh skill.
The automation owns scheduling metadata only, not retrieval or ingestion logic.
The manifest is project metadata, not a standard host scheduler API. Setup
offers a draft import using `skills/ps-data-refresh/scripts/import-automation.mjs`.
The user reviews the App dialog and confirms Create; no file copy creates a job.

## Inputs

All configured products, as declared in `manifest.json`. The host supplies a
daily schedule (nominally every 24 hours) and non-overlap enforcement.
Registration requires user confirmation. The user selects local execution,
the project, model and daily time in the import dialog. Local scheduling
requires the machine and App to be available; daylight-saving transitions may
change the elapsed interval. Do not promise unattended cloud execution.
No GitHub credentials or source budgets are needed during the mock-data phase.

## Workflow

1. Invoke `skills/ps-data-refresh/SKILL.md` once with all-products scope.
   This is the interactive skill directory, not this automation; do not recurse
   into `automations/ps-data-refresh/SKILL.md`.
2. Return the skill's actual result unchanged. `refreshed` means local sample
   dates changed, not retrieval or successful ingestion. Live products are skipped.
3. Report skill errors explicitly and stop. Do not retry, fall back to a source
   reader, discover GitHub tools or call `ps_ingest_snapshot`. Do not run a
   portfolio loop or schedule another invocation.

## Safety

No source access, direct data writes, canvas opening, automatic review or GitHub writes.
The automation must not duplicate the skill's refresh implementation. Preserve
sample values/provenance, live timestamps, release targets and reviewed history.
Only the skill may re-date fictional working copies. Installed does not mean scheduled.
During setup, prompt for the daily import rather than silently omitting it.
On update, review the existing `ps-data-refresh` automation instead of creating
a duplicate. Pause it before updating components and resume after verification.

## Output contract

Forward the strict JSON from `skills/ps-data-refresh/SKILL.md` without an envelope
or markdown. It includes schemaVersion, pipelineVersion, skillName, skillVersion,
productId, status, reason, retrieved, ingested, changed, refreshedAt, revision,
products and note. Status is refreshed, unchanged or skipped; retrieved and
ingested remain false. Forward failures as errors, never as success.

## Product Scout Versioning

- Pipeline version: 0.1.0
- Skill version: 0.4.0
- Last updated: 2026-09-24
- User-facing product name: Product Scout
- Internal namespace: ps
- Output version fields come from the invoked skill; automation component version
  is held in this file and manifest.json.
