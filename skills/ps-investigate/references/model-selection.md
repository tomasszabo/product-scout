# Task-based model selection

The coordinator selects models, not the dashboard or either specialist.
Agent profiles intentionally omit `model`: a static value would pin the role
instead of allowing a task-specific choice. Omission alone means inheritance,
not automatic selection; the coordinator must explicitly apply this policy.

For a user-requested investigation, select and proceed without routine model
approval. Announce the chosen Analyst and Challenger models and a brief reason;
do not ask "may I use these models?" or wait for confirmation when the available
choices satisfy the user's instructions and host policy. Explicit user choices
take precedence. Ask only to resolve a real blocker or an unrequested loss of
provider diversity; model selection is not human approval of an insight.

## Discover, choose, execute, report

1. Discover the host's actual available/permitted model catalog and delegation
   schema using its supported tools or configuration UI. First inspect exposed
   delegation tool schemas (including enumerated model IDs), registered profile
   settings and any supported catalog/configuration reads available in the
   session. Reuse still-valid host discovery or explicit user choices already
   in context. A missing dedicated catalog tool alone is not a reason to ask.
   Do not invent a
   `/models` command, SDK field, provider, model ID or capability. A public model
   list is not proof of availability to this user. Use current host data.
2. Respect an explicit user role/model choice or administrative restriction
   before automatic preferences. Never override a fixed profile model or host
   policy silently. Resolve a conflict before delegating.
3. Classify the substantive question:
   - **Standard:** explaining bounded facts or comparing well-defined options.
   - **Deep:** causal hypotheses, ambiguous/conflicting evidence, cross-source
     trade-offs or consequential prioritization/mitigation decisions.
   Simple fact lookups do not reach model selection.
4. For the Analyst, choose a model the host describes as suitable for the task.
   For deep questions prefer strong reasoning; for standard questions prefer
   lower latency/cost among suitable models when those characteristics are
   actually known. Do not invent prices, rankings or numerical scores.
5. For the Challenger, choose a suitable allowed model from a **different
   provider** by default. If the initially considered pair is unsuitable, use
   known permitted alternatives before asking. If no suitable cross-provider
   pair can be established, explain the observed limitation and ask before using
   a different model from the same provider. If only one model is suitable,
   offer separate agent contexts with that model and disclose the lack of model
   diversity; wait for the user's choice. Unknown provider identity is not
   evidence of a different provider. If the user already explicitly chose a
   same-provider or same-model pair, honor it and disclose its diversity without
   asking again. State the selection reason briefly as information, not a
   permission question, then continue automatically for an eligible pair.
6. Pass the exact selected IDs through the host's supported per-delegation model
   selector and named-profile mechanism. A model name in prose does not switch
   models. Keep the Analyst choice for revision; do not let an agent pick its own
   model, create another agent or rewrite its profile.
7. Read actual execution metadata where available. Record requested and actual
   model/provider separately in conversation context. If actual identity is not
   exposed, say "requested; execution identity unverified." Do not infer actual
   identity from generated text. An unexpected substitution must be disclosed,
   including loss of cross-provider diversity.

## Missing capabilities

Only after the supported discovery paths above cannot establish eligible
models, ask once for the missing exact IDs visible in the host's picker and
their known providers/capabilities. Explain what could not be established;
do not ask for blanket model-usage approval. Reuse the resulting choices; do
not ask on every investigation phase. Do not probe inaccessible models with
private product data.

If the host cannot assign a model per delegated profile, stop automatic selection
and report the limitation. Offer setup of explicit `model` values in private,
approved profile copies as a separately agreed fixed-model alternative. Do not
silently inherit a session model and advertise task-based selection.

Unavailable or denied models are explicit failures, not permission to call a
provider directly, add credentials or bypass organization policy. Never change
global model settings or managed release profiles to execute one investigation.
Two providers can share blind spots: diversity is a selection preference, not
proof of correctness or an enterprise policy guarantee. An unrequested
same-provider fallback nevertheless needs the user's decision, not silent
degradation.
