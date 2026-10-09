---
name: ps-data-refresh
description: Refresh fictional Product Scout sample dates for one product or all products, manually or from automation. Preserve relative windows, live timestamps, release targets and reviewed history; never query sources.
domain: product-data
capabilities: data-refresh, fixture-date-refresh, refresh-status
---

# Product Scout Data Refresh

## Purpose

Make existing fictional samples fresh for another demo day. Re-date issue
observations and all available preview domains in private working state,
preserving relative ages, window durations, baseline adjacency, metrics and
fixture provenance. Packaged fixtures and configuration are never edited.
Live refresh is disabled; real evidence timestamps must never be rewritten.

## Inputs

One exact configured product ID, or an explicit request for all products.
No source credentials or model delegation are needed. The helper is for the
Copilot App skill, not a standalone application.

## Workflow

1. Resolve the requested scope against canonical configuration. Ask if scope
   is ambiguous; "refresh all sample data" means all configured products.
   An unknown scheduled product is an error, not an all-products fallback.
2. Discover `ps_refresh_fixtures` and its actual schema. In a connected runtime,
   invoke it once with the product ID, or omit `productId` for an explicitly
   requested all-products refresh. This updates the running cache and persists
   it atomically. Dashboard polling sees the new revision without reopening.
3. Only when the runtime tool is unavailable and the runtime is stopped, run
   the deployed helper from the shared Copilot root (normally `~/.copilot`),
   or the source helper from the checkout root:
   `node skills/ps-data-refresh/scripts/refresh.mjs PRODUCT_ID`
   or `node skills/ps-data-refresh/scripts/refresh.mjs --all`.
   It defaults to that component root's `.ps/` state regardless of working directory.
   For an explicitly configured private state directory append
   `--data-dir PATH`. Never guess a different directory to evade a writer lock.
   A lock failure requires the connected tool or stopping the owning runtime
   through the host; never remove the lock or silently retry another writer.
4. Keep the actual JSON unchanged for internal callers; summarize it in natural
   language for the user. A successful fixture re-date is not source
   retrieval. Each live-bound or sample-less product is explicitly skipped.
   Missing preview domains stay missing. No GitHub MCP, `ps-issues`,
   `ps_ingest_snapshot`, canvas opening or investigation agents are involved.
5. Report validation or persistence failures explicitly. Never edit packaged
   fixtures, reset live freshness or claim success after an error.

## Safety

Only fictional working copies may change. Shift each source's timestamps by
the offset from its previous `fetchedAt` to the refresh time; do not set every
event to the same instant. Preserve release dates, evidence values, source
identities and all reviewed history. Re-dating does not create a source-change
baseline, retrieve evidence, certify readiness or perform human review.
No network access or internal scheduler; host scheduling is opt-in.
Setup prompts for a daily all-products automation import. Its helper,
`scripts/import-automation.mjs`, opens only a draft for user confirmation;
metadata copying is not schedule creation.

## Output contract

User-facing replies use concise natural language, never JSON objects or JSON
code blocks. State which products were refreshed, unchanged, skipped or failed
and explain material reasons. A local date refresh is not live source retrieval.
Do not claim a skipped product was refreshed or hide mixed results.

The helper/tool's strict JSON remains unchanged for internal callers, dashboard
state and automation processing. Do not paste it into chat. One-product example
of the internal result:

```json
{
  "schemaVersion": "1.0",
  "pipelineVersion": "0.1.0",
  "skillName": "ps-data-refresh",
  "skillVersion": "0.5.1",
  "productId": "zava-shop",
  "status": "refreshed",
  "reason": "fixture-dates",
  "changed": true,
  "refreshedAt": "2026-09-25T08:00:00.000Z",
  "revision": 1,
  "products": [
    { "productId": "zava-shop", "status": "refreshed", "reason": "fixture-dates" }
  ],
  "retrieved": false,
  "ingested": false,
  "note": "Local sample dates only; no sources queried. Live evidence, release dates and reviewed history are unchanged."
}
```

Values are from execution, not the example. `productId` is null for all products.
Status is `refreshed`, `unchanged` (already at that instant), or `skipped` when
there are no eligible fixtures (`reason: "no-fixture-products"` and null
`refreshedAt`). Per-product skip reasons are `live-refresh-disabled` or
`no-fixture`. Mixed results list every requested product. Revision increments
once for a changed transaction. CLI errors contain `schemaVersion` and `error`
with nonzero exit status; tool failures propagate as errors.

## Product Scout Versioning

- Pipeline version: 0.1.0
- Skill version: 0.5.1
- Last updated: 2026-09-25
- User-facing product name: Product Scout
- Internal namespace: ps
- Internal structured JSON includes schemaVersion, pipelineVersion, skillName and
  skillVersion as specified above.
