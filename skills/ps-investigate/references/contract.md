# Investigation handoff contract

This is an in-conversation contract between the coordinator and reasoning agents,
not a persisted snapshot, source ingestion schema or dashboard API.
Schema version `1.0`; pipeline version `0.1.0`.

## Packet

```text
{
  schemaVersion: "1.0", pipelineVersion: "0.1.0",
  investigationId: string, productId: string, question: string,
  phase: "analysis" | "challenge" | "revision",
  context: {
    origin: "chat" | "dashboard",
    card: string | null,
    displayedSnapshot: string | null,
    scope: string
  },
  evidence: [{
    ref: string, productId: string, source: string,
    snapshotRef: string, recordRef: string,
    mode: "fixture" | "live",
    observedAt: ISO timestamp,
    coverage: "complete" | "partial" | "unavailable",
    stale: boolean, summary: string, limitations: [string],
    url: validated source URL | null
  }],
  limitations: [string],
  models: {
    task: "standard" | "deep",
    analyst: {requestedId: string, provider: string | null, reason: string},
    challenger: {requestedId: string, provider: string | null, reason: string}
  }
}
```

Challenge adds `draft`; revision adds `draft` and `critique`. Their shapes are
defined in the corresponding agent profile. No other fields are accepted.
All listed fields are required; null means unknown/not applicable, not inferred.
Generate `investigationId` as a local correlation identifier, never as a remote
record ID. Reuse it and the exact product/evidence set through all three calls.

Use at most 50 evidence entries, each with a bounded concise summary (at most
2,000 characters). If evidence is narrowed to this budget, disclose the narrower
investigation scope; do not rewrite the source's original coverage. If material
evidence would be omitted, ask the user to narrow the question before analysis.
Question and scope are each at most 2,000 characters. Never pass raw bodies.

`ref` is a unique local citation label for an observed record or metric.
`recordRef` is an existing record identity or exact field path in the validated
source result; a fixture path is not a real remote ID. `snapshotRef` identifies
the source and its observed generation/revision or timestamp. Preserve whether
evidence belongs to the displayed snapshot or a subsequent retrieval. Do not
construct remote URLs from local labels. Unavailable source results belong in
limitations, not as invented evidence rows.

Scope supplied without an installed product registry must be unambiguous and
explicitly user-provided; ask for a stable product label if necessary. Do not
invent repository bindings. Product Scout snapshot validation still requires
its configured product; ad hoc user evidence is not eligible for runtime ingest.

## Checks before forwarding or using output

The coordinator checks the packet and each parsed JSON response:

- Required keys, types, versions, phase and agent identity match the profile's
  contract. Missing fields, extra fields and malformed JSON are failures.
- `productId` and `investigationId` match exactly across packet/draft/critique/
  revision. Never accept another product's result.
- Citation labels exist in the immutable packet, target IDs exist in the draft,
  and local finding/option/challenge IDs are unique. Do not repair an invented
  reference into a plausible real one.
- Findings/options have supporting references. Evidence URLs/provenance come
  from validated sources, not agent output. Preserve limitations in final prose.
- Analysis has no challenge responses. Revision responds exactly once to every
  challenge ID, with no unknown IDs. An unresolved response stays visible.
- Counts and statuses obey the profile contract; no-evidence, failed-source or
  invalid-input responses cannot be described as a completed healthy assessment.
- A critique with `no-material-issues` has no challenges and is not an approval.
- Use host invocation metadata for completion and actual model identity, not
  model names or claims inside agent text.

These checks are part of host orchestration instructions, not a new autonomous
runtime validator. Offline contract tests verify the packaged instructions;
they do not prove an LLM will follow them. Live host smoke tests must demonstrate
delegation and failure handling before claiming the installed workflow works.
