# How to use Product Scout

Product Scout supports a **product owner who wants to understand and investigate
their product independently**, without always waiting for the team to assemble
reports or surface insights. It combines a visual overview with Copilot chat
in GitHub Copilot App.

It is not the primary tool for operations, issue tracking, customer support or
business reporting. Those systems remain the systems of record. Product Scout
helps the product owner notice important findings, understand the evidence,
ask better questions and explore possible responses. Independence means easier
access to authorized evidence and analysis, not bypassing permissions or the
team's responsibility for execution.

This guide records the intended product experience. The
[current implementation](#what-works-today) demonstrates cross-source reasoning
with authored sample data. Live reads support configured GitHub Issues only;
periodic live retrieval and automatic Copilot-generated card findings are not
enabled yet.

## The hybrid workflow

The intended loop is:

```text
Periodically gather configured product data
    -> Copilot identifies lightweight evidence-backed findings within each card
    -> Dashboard colors and summaries bring attention to those findings
    -> The product owner visually reviews the evidence
    -> The product owner investigates further with Copilot chat
    -> Analyst and Challenger investigate, challenge and refine a response
    -> The product owner decides what to do in the appropriate team or source system
```

Product Scout does the routine watching; the product owner spends time
understanding and deciding. They should not need to ask Copilot repeatedly
whether anything changed before useful findings can be surfaced.

The dashboard and chat are complementary, not competing interfaces:

| Use the dashboard to | Use Copilot chat to |
| --- | --- |
| Scan a large amount of information visually | Explore a particular finding in depth |
| Compare observations, metrics and trends | Ask what might explain a change and what evidence is missing |
| Identify changes worth reviewing | Retrieve additional scoped data from available sources |
| Inspect evidence, freshness and limitations | Compare solutions, trade-offs and recommended mitigations |
| Move between product topics | Investigate related questions not represented by a card |

The dashboard is a read-only view of source data, not an editing console.
Read-only does not mean non-interactive: navigation, filtering, expansion and
investigation handoff help people inspect information. The main working
pattern is **view visually, then discuss with Copilot**, not read a dashboard
and leave, and not replace the dashboard with long chat answers.

Product Scout speaks in ordinary language in chat: brief confirmations,
evidence-backed explanations, clear errors and useful next steps. It does not
reply with JSON objects or technical response envelopes. Structured data stays
behind the dashboard and internal processing, including when another skill
returns a source snapshot, refresh result or version report.

## A product owner's working session

The following describes the intended experience as live capabilities are
implemented, not a claim that all connectors work today. The same interaction
can be demonstrated with the supplied authored sample data, using a normal
dashboard presentation without fixture/sample/demo labels. Internal provenance
remains intact; live customer connections are an adaptation step, not a
prerequisite for illustrating the workflow:

1. **Open the product overview.** Scan cached card summaries and their visual
   attention states. Check when the evidence was observed and whether coverage
   is sufficient. Opening the view does not itself query sources.
2. **Choose a finding worth understanding.** Open its card and examine the
   supporting records or metrics. Distinguish an observed fact from Copilot's
   interpretation and suggested action.
3. **Continue in Copilot chat.** Refer to the finding or use a supported
   investigation handoff. Ask for explanation, additional evidence or options.
   Copilot should use the same product context and evidence you are viewing.
   For substantive investigation, the workflow automatically applies
   the [Analyst and Challenger](#two-agent-investigation) roles; the
   user does not need to request agents or switch models manually.
4. **Go beyond the displayed information when needed.** Ask Copilot to inspect
   a different period, related records or another configured source. A fixed
   card layout must not define the limits of the conversation. Retrieval still
   requires an available source skill, authorized access and a clear scope.
5. **Evaluate the response.** Challenge assumptions and request supporting
   evidence. Newly retrieved information may differ from the cached dashboard;
   Copilot should explain the difference and its freshness.
6. **Decide the next step.** Discuss proposed mitigations or follow up in the
   appropriate source system or with the responsible team. A recommendation
   is not an executed change or a commitment from another person.

Example questions, not claims about actual findings:

```text
Explain the finding on this card and show the supporting evidence.
```

```text
What changed compared with the previous period, and what remains uncertain?
```

```text
Can you retrieve more detail from the configured source to test this explanation?
```

```text
What mitigation options should I consider, and what are their trade-offs?
```

These prompts express the intended conversation. In the current release, live
investigation is limited to configured GitHub Issues; other providers are
samples, not available retrieval capabilities.

## Two-agent investigation

The dashboard helps you notice a finding; Copilot chat helps you investigate it.
For deeper questions, Copilot uses two complementary agents automatically.
You ask a normal question, without choosing agents or switching models.

For example, after inspecting a Customer Support card, you might ask:

> Should I reprioritize work because of these support cases?

### How the agents work together

1. **Analyst:** assesses the scoped evidence prepared by the source skills and
   develops possible responses. The agent itself has no retrieval tools.
2. **Challenger:** checks the assessment against that evidence, looking for
   unsupported assumptions, alternative explanations, missing information and
   trade-offs in the recommendations.
3. **Analyst:** revises the answer in light of the challenge, keeping any
   unresolved uncertainty visible.

This is one analysis, challenge and revision cycle, not an endless debate.
For example, the Challenger might point out that more support cases do not
necessarily mean worsening customer experience if the number of users also
increased. The final answer distinguishes what the evidence establishes from
what needs further investigation.

### When it runs

The two-agent workflow handles questions that explain findings, assess a
situation, compare options, prioritize work or explore mitigations. Simple
lookups, such as showing a count, use a lightweight response instead.
Opening cards, navigating and polling the dashboard do not start the agents.

The workflow is independent of the dashboard:

- **Source skills** obtain evidence through your authorized connections.
- **The investigation workflow** coordinates the two agents in Copilot chat.
- **The dashboard** shows lightweight findings and supplies relevant context
  when you start from a card.

You can also start directly in chat without opening the dashboard. Copilot uses
the product and scope from your question, asking for clarification when needed.
Questions can go beyond displayed cards when suitable sources are available.
With a card open, the investigation starts from its relevant snapshot and
evidence, and distinguishes any newly retrieved information.

### Model choice for each task

**Analyst and Challenger are roles, not fixed models.** Each can use a different
model, including models from different providers, selected to suit the task.
The workflow can favor deeper reasoning for a complex assessment or a faster,
lower-cost model for a simpler question, within the available models and your
organization's policies.

You are free to configure the model choices for both roles. The workflow
normally chooses from available, permitted models based on the task, preferring
a different provider for the Challenger. Explicit user choices take precedence.
It applies those choices automatically during investigation, so the product owner
does not need to switch models or coordinate agents for each question.
Copilot announces which models it selected and proceeds without asking routine
permission. It first uses available host discovery rather than asking you to
choose a pair. It asks only when something blocks the choice, such as missing
access, unavailable model assignment or inability to establish two different
providers. A same-provider fallback needs your decision unless you already
explicitly requested that pairing. You can specify models for either role at
any time; those instructions take precedence within host permissions.
The product context and evidence stay consistent whichever models are used.

This is a key advantage of the GitHub Copilot approach: the same product-owner
workflow can use models across providers rather than being tied to one model
family. The value is choosing suitable intelligence for each task, not assuming
that using two providers automatically produces a better or correct answer.

**Bring your own expertise, not just choose a model.** An organization could
adapt the same workflow to use a compatible company-specific model deployed
through Microsoft Foundry, for example as a Challenger familiar with its
security review conventions. This is an extension option, not a verified
integration in the sample or a substitute for security controls.
See [model extensibility and competitive positioning](../README.md#bring-your-own-expertise-not-just-choose-a-model)
for supported-platform references and verification boundaries.

### What you receive

Copilot returns one concise answer with supporting evidence, important
uncertainties, recommended options and their trade-offs. When the challenge
materially changes the recommendation, the answer briefly explains the
correction rather than presenting two separate agent reports.

Two agents agreeing does not prove a conclusion.
If a source or the Challenger is unavailable, Copilot makes that limitation
clear rather than claiming a completed check.

You remain responsible for evaluating the recommendation and deciding what to
do. The agents do not execute mitigations or approve decisions on your behalf.

## Visual attention and optional notifications

External notifications are optional extensions, not excluded capabilities.
They are not implemented or required today; adding them needs an explicitly
agreed scope, authorized channels and recipient/data-sharing controls.
Product Scout is not an incident-paging service, and it does not guarantee
that a person will notice an urgent event while the dashboard is closed.

| State | Meaning |
| --- | --- |
| Normal: light gray | Informational summary with no supported attention condition in the available evidence; not a health or release-readiness certificate |
| Attention: blue | A supported finding worth reviewing or following up |
| Critical / error: pink-magenta | An explicitly supported urgent condition or failure, not an inference from missing data |
| Unknown: explicitly identified | Evidence is missing, stale, incomplete or insufficient to assess the situation reliably |

Keep summaries, evidence and accessible status descriptions alongside colors;
color must not be the only way to understand a finding. Stale supported findings
keep their blue or pink-magenta colors, with last-known explanations on cards
and details. Headers show an "Updated ... ago" pill instead of an attention
label; hover over the pill for the exact update time. The displayed age advances
without refreshing the source. Current status remains unknown.
A stale critical observation is historical evidence, not proof of an ongoing
incident. Unflagged stale cards remain Unknown rather than showing an all-clear.
Viewing historical findings does not refresh data or enable approval.

## Shared context between the dashboard and Copilot

Opening Product Scout with `/ps` shows My Products. The first dashboard-opening
reply in a conversation includes a short chat quick start: choose a product,
open a card, expand a finding or highlight text, and ask Copilot about it.
It also explains the update-time label and that browsing does not refresh
sources. If guidance was missed, the next view/open/switch request supplies it.
It is not repeated on every reopen or switch; ask "How do I use Product Scout?"
to see it again, or ask to skip introductions. Direct questions and refresh
results are not interrupted with onboarding. Opening failures receive
troubleshooting rather than a welcome.

"Copilot sees what the human sees" means explicit shared context, not screen
vision. Open a card or expand an issue/concern inline, optionally highlight some text,
then ask "Explain this" in Copilot chat. No checkboxes or send-selection button
are needed, and selecting alone never starts an investigation.

The dashboard shares identity, bounded text and snapshot metadata; Copilot
resolves the full records and configuration from the matching cached state:

- The product, selected card and finding under discussion.
- The displayed snapshot identity, relevant records/metrics and reporting scope.
- Observation time, coverage, provenance and limitations.
- The configured source bindings and available retrieval capabilities.

Issue rows expand and collapse in place rather than opening a popup. Click the
row or use its title button with Enter/Space. One issue is expanded at a time.
Expanded content uses plain labeled fields and action links/buttons, without
chevrons or decorative evidence badges. Evidence fields remain unboxed.
Related concerns appear in a nested table within that row, with the heading and
table grouped in one card, without a redundant column header. Magenta row titles
indicate that they are clickable. Click an insight row
or use its title button with Enter/Space to expand its fields and actions; only
one related insight is expanded at a time. "Explore evidence" and preserved
timeline evidence also expand inline. Investigation actions and explicit review
controls remain beside their evidence.
Investigation buttons send the request to Copilot chat and show a brief,
nonblocking confirmation, not a modal containing the sent prompt. Your expanded
finding stays open. Failed handoffs show an error instead of a success message.

The current view is the default scope. Expanded issue/concern details narrow it
to that finding; highlighted text narrows it further. A highlight survives
moving focus into chat. Clicking elsewhere in the dashboard, pressing Escape,
changing product/card/role or receiving a new snapshot clears the selection.
Collapsing details returns to the card (or the parent issue for a nested concern).
Review-form fields are never captured.
The small context status line confirms sharing or reports a failure.

Wait for an answer before changing cards during an investigation. Navigation
changes the context for the next question; keeping the view stable avoids
ambiguity while Copilot resolves the current evidence.

Copilot reads the context only when needed for your question, identifies what
you mean and uses the corresponding cached evidence. If multiple canvases are
active, context expired, or the data changed, it asks rather than guessing.
Context is temporary and not saved in product history. A hidden canvas's context
expires after two minutes; revisit it to make it current again.

Copilot should reason from this shared evidence, and request additional
authorized data when the user's question needs it. It must not pretend that
sample sources are connected, claim access it lacks or silently replace the
displayed context with an unrelated snapshot.

Background refresh, visual browsing and interactive investigation have separate
responsibilities. Current sample refresh shifts fictional observation dates
without generating new analysis; browsing reads cached state; explicit
investigation can gather more evidence from configured, authorized live sources.
When a validated update is
published, the dashboard may reflect it through cache polling. Reading,
switching products or expanding a panel must not trigger source retrieval.

## Human review and responsibility

Human review primarily means **examining, questioning and interpreting what
Copilot found**. It does not require approving every card or completing a
formal approval form before asking follow-up questions.

Product Timeline is an optional, separate way to retain explicitly reviewed
findings. When used, its approval remains a deliberate human action; Copilot
must never approve on the person's behalf or treat ordinary discussion as
approval. Local reviewed memory is not an enterprise audit service.

Product Scout does not replace operational ownership, source-system workflows
or professional judgment. Keep facts, derived concerns and recommendations
distinct. Do not invent causes, financial impact, owners or deadlines.
Respect permissions and preserve evidence boundaries. GitHub access remains
read-only; proposed mitigations do not automatically create tasks, send messages
or change source systems.

## What works today

| Area | Current implementation |
| --- | --- |
| Visual workspace | My Products landing page; authored products show all six populated cards by default without a preview checkbox or fixture/sample/demo labels; configured live products remain Issues-only |
| Card findings and colors | Deterministic assessments and authored fixture observations, not scheduled Copilot-generated analysis |
| Sample refresh | Manual and scheduled refresh re-date fictional working copies for another demo day; no live retrieval or changes to real evidence |
| Copilot insights section | UI-only "Coming soon" sample, distinct from the intended automatic findings within each card |
| Conversation and retrieval | Implemented handoff and read-only GitHub Issues workflow; actual host operation and access must be verified in the installed App |
| Two-agent investigation | Analyst/Challenger profiles and `ps-investigate` coordinate chat analysis, challenge and revision; registration and automatic model selection must be verified in the installed host |
| Shared context | Current product/card, open issue/concern or preserved review, and bounded highlighted text are shared through `ps_get_context`; no automatic analysis on selection |
| Additional sources | Confluence, Application Insights, Zendesk and Power BI remain fixture previews |
| Review history | Explicit local human-review workflow; not required merely to inspect findings or chat |

The disabled live refresh and sample-only sources are implementation limitations,
not a redefinition of the intended product. This guide does not enable them or
authorize new source access. Email/Teams notifications remain a possible future
extension; their absence is not a gap in the current scope.

### Keeping the samples fresh

In Copilot chat, ask:

```text
/ps Refresh all sample data.
```

Or name one product: `/ps Refresh sample data for Zava Shop.` Refresh shifts
sample observations and reporting periods to the current time while keeping
their relative ages and comparisons intact. It does not query any source,
change release target dates or rewrite human-reviewed history. The original
packaged samples remain unchanged; chat and the dashboard use saved working
copies. Products with live bindings are skipped, never made artificially fresh.

Then try:

```text
/ps-investigate Use the refreshed sample data for Zava Shop only.
Should I prioritize payment resilience or guest order tracking for v4.2?
Do not query live sources.
```

This still requires the registered investigation skill and agents. Refresh
itself uses neither agent. Samples age normally again after refresh; browsing
does not refresh them automatically.

Setup always offers a daily local refresh for **all products**, at `09:00` by
default. You review an App import dialog, choose the project, local execution,
model and time, and confirm Create; no schedule is created automatically.
An existing refresh job should be updated rather than duplicated. Each run
only refreshes fictional working-copy dates once, without source queries or
Analyst/Challenger analysis. Your local environment must be running. Daily means
the chosen wall-clock time, not exactly 24 hours across daylight-saving changes.

Components live in native `~/.copilot/skills/`, `agents/` and `extensions/`
directories, not a standalone application folder. Your source checkout is not
needed at runtime. Updates preserve private state/history: pause the daily job,
stop the extension and resume only after verification.

For installation, use [setup](setup.md). For implementation boundaries and
verification, use [development](development.md). GitHub Copilot adding,
changing or removing a source must follow
[Managing a datasource](managing-a-datasource.md) and preserve this hybrid
product-owner experience.
