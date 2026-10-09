---
name: ps-timeline
description: Inspect Product Scout reviewed memory or guide a person through explicit canvas review of evidence-linked product concerns and recommendations.
domain: product-memory
capabilities: review-handoff, approved-timeline, evidence-explanation
---

# Product Scout Timeline

## Purpose

Explain reviewed memory and direct explicit human review, without creating an
agent approval path.

## Inputs

Configured product ID; runtime state; optional candidate/entry ID actually
returned by the runtime; a user's review or timeline request.

## Workflow

1. Discover `ps_get_state` and the host-advertised canvas-open
   operation for canvas ID `ps`, then read exact same-product state.
   The opener's name is SDK/host-generated; do not invent `ps_open`.
   If unavailable, say so and provide the local canvas start instructions.
2. Separate pending candidates from approved Product Timeline entries. Show
   evidence IDs, frozen reviewed evidence and timestamps from actual state.
3. For a review request, open the canvas with its supported arguments and direct
   the person to inspect facts, derived concern and recommendation, enter reviewer
   identity and explicitly approve or reject. Never invent an entry/candidate ID.
4. Do not invoke an approval tool: none exists. Do not automate clicks, call
   private review endpoints, infer approval from a chat request or review while
   running as an automation. The person must take the canvas action.
5. Only after a fresh runtime read confirms an approved entry may it be reported
   as approved. Rejected candidates are absent from Product Timeline. Source
   refresh does not rewrite reviewed evidence; changed evidence needs new review.

## Safety

This is single-user local reviewed memory, not an enterprise audit service.
Do not overwrite frozen evidence or confuse recommendations with decisions.
An open canvas or a user's stated intention does not prove a review completed.

## Output contract

User-facing replies use concise natural language, never JSON objects or JSON
code blocks. Explain the selected product's reviewed entries, evidence and
timestamps, or the explicit human action still needed in the canvas.
If unavailable, state the actual blocker and safe next step. Cite only entry
IDs verified in runtime state; no pending candidate is described as approved.
Runtime state and review payloads remain internal dashboard data.

## Product Scout Versioning

- Pipeline version: 0.1.0
- Skill version: 0.5.1
- Last updated: 2026-09-25
- User-facing product name: Product Scout
- Internal namespace: ps
- User-facing chat has no structured response envelope; persisted review
  contracts are unchanged.
