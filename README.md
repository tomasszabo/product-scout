# Product Scout

**Your product, in focus.** A reference template for building evidence-backed,
accountable-owner workflows inside GitHub Copilot App.

Product Scout is intended to be customized before installation, not installed
unchanged by every organization. Adapt its integrations, skills, agents and
dashboard to your organization's needs. Copilot plugin distribution is the
intended future delivery format; packaging is not yet implemented. The current
prototype uses native component copying for testing.

Product Scout helps product owners investigate independently rather than always
waiting for the team to assemble insights. Two complementary experiences support
that work:

- **Visualize the evidence:** scan a large amount of information, move between
  product perspectives, and inspect observations, freshness and gaps.
- **Investigate with Copilot:** ask about what you are viewing, compare evidence
  across sources, and weigh challenged interpretations and next steps.

People decide what happens next in the appropriate team or source system.
Product Scout supports, rather than replaces, those workflows. Periodic live
collection and automatic Copilot-generated card findings are intended extensions,
not current capabilities.

**Product Scout demonstrates a reusable pattern for accountable owners:
understand signals across specialist systems, investigate without waiting for
a prepared briefing, and make better-informed decisions.**

Read [How to use Product Scout](docs/how-to-use-product-scout.md) for the product
vision, working pattern and current implementation limits.

## Try the sample workflow

This prototype demonstrates six product perspectives with fictional, authored
data. Live investigation currently supports configured read-only GitHub Issues
only; the other cards do not connect to their named systems.

1. Follow the [setup guide](docs/setup.md), explicitly choosing the supplied
   sample walkthrough. Review the native-copy plan, then verify the extension
   and agents in a fresh Copilot App session.
2. Open the dashboard:

   ```text
   /ps Open My Products
   ```

3. Open **Zava Shop**, scan its cards, then open **Operations** and inspect the
   checkout/payment observations. Ask:

   ```text
   Which support cases have symptoms similar to these failures? Compare the evidence.
   ```

4. Wait for the answer before navigating. Open **Customer Support**, inspect
   the cases, and ask:

   ```text
   Which GitHub issues could address these symptoms, and what remains uncovered?
   ```

5. Wait for the answer, open **Issues**, then ask:

   ```text
   Across these sources, what deserves attention first—and why?
   ```

6. Return to the overview and consider the proposed next step. Similar symptoms
   do not establish causality, and stale samples do not establish current impact.
   Ordinary investigation requires no formal approval; saving an insight to the
   Product Timeline requires explicit human review.

Opening or navigating the dashboard does not refresh sources or invoke
investigation agents. The current view supplies context for the next question.

## Customize first, distribute second

The intended lifecycle is **start from the template -> customize for the
organization -> validate -> package as a plugin -> install in Copilot App**.

The reusable pattern combines signals from specialist systems, evidence-backed
dashboard findings, shared-context investigation and challenged recommendations.
It preserves citations and uncertainty while leaving decisions and explicit
review with the accountable owner. Product ownership is the example here;
the pattern can be adapted to other accountable-owner roles.

Each organization selects and adapts:

- Datasources, MCP connections and authentication.
- Product or other owner-specific context.
- Cards, signals, thresholds and investigation instructions.
- Agents, model choices and refresh behavior.

The plugin is the intended delivery format for the customized solution, not a
replacement for customization. **Plugin packaging is not yet implemented in this
repository**; the current [setup guide](docs/setup.md) uses native component
copying. See [Managing a datasource](docs/managing-a-datasource.md) for integration
changes and [Development](docs/development.md) for implementation and validation.

## Success measures

Success means a product owner can identify a concern, investigate its supporting
evidence, consider a challenged recommendation and decide their next step,
without first requesting a team-prepared briefing. Another field team should be
able to reproduce that workflow using the supplied setup and sample data.

Evaluate time to an evidence-backed assessment, preservation of citations and
uncertainty, usefulness of the proposed next step, and whether another team can
complete the sample workflow without author assistance. These are evaluation
goals, not measured results or claims of proven time savings.

## Dashboard: six product cards

- **My Products:** a compact product table. Open Zava Shop or Contoso CRM; use breadcrumbs and the product dropdown to navigate.
- **GitHub Issues:** a compact overview summary card opens the existing Issues detail view with issue state, attention signals, search, filters and role-aware prioritization.
- **Evidence:** inspect observed facts separately from derived concerns and recommendations.
- **Investigation:** hand a product-scoped question to the current Copilot App session. A missing or disconnected session is an explicit error, not a browser fallback.
- **Shared context:** open a card or finding, optionally highlight text, then ask
  "Explain this" in chat. Copilot can read temporary product/card/finding context
  through `ps_get_context`; selection alone never starts an investigation.
  Navigation clears selections; ambiguous or expired context needs clarification.
- **Human-reviewed memory:** approve or reject exact candidate wording with its evidence. Only approved insights appear on the Product Timeline.
- **Lifecycle:** independently versioned skills, a safe local installation/update workflow and a host-scheduled data refresh definition that delegates to the refresh skill.

For the authored products, Issues and these five additional cards are populated
from the existing sample data and visible by default in the Copilot App renderer:

- **User Stories / Confluence:** accepted scope, acceptance-criteria gaps, user
  outcomes, owners and a "Needs my decision" filter.
- **Product Adoption & Value / Azure Application Insights:** active users,
  activation and retention cohorts, feature adoption and observed value outcomes.
- **Operations / Azure Application Insights:** request reliability, failed and
  slow operations, baseline performance and searchable operational diagnostics.
- **Customer Support / Zendesk:** unresolved cases, escalations, recurring themes
  and case age, with filters for open and escalated cases.
- **Business Reporting / Power BI:** business outcomes against directional
  targets, comparison-period values, units, definitions and unknown observations.

My Products is the landing page. The dashboard omits fixture/sample/demo labels to illustrate a
normal workflow, but the supplied data remains authored samples, not live
integrations. Configured live products remain Issues-only, with no sample
fallback or implied connectors. No card certifies release readiness.

The authored product overview includes collapsible **Copilot insights** above the cards:
Product situation, Needs attention, and Recommended next steps. This is UI-only
deterministic wording over the existing fixture values, headed **Coming soon**,
not generated Copilot output.
It does not query or refresh sources. Expand it to inspect the cached overview;
use chat for an actual Copilot investigation.

The canvas supports breadcrumbs, product selection, card navigation and detail
views. Role and theme controls live under Settings. Product Scout runs inside
GitHub Copilot App; it has no standalone launcher. Inspect each card's
**Source & coverage** disclosure for evidence boundaries.

## Governance and human oversight

- **Authorized, read-only sources:** source skills own retrieval; the workflow
  does not modify GitHub or replace source-system permissions.
- **Evidence boundaries:** facts, derived concerns and recommendations remain
  distinct. Sample provenance, freshness, coverage gaps and uncertainty are
  preserved. No card certifies release readiness.
- **Human decisions:** Copilot proposes interpretations and options; people
  decide and act in the appropriate system. Automations cannot perform human
  review or approve insights.
- **Optional reviewed memory:** only explicitly approved candidate wording and
  its evidence enter the Product Timeline. Investigation itself needs no
  formal approval.
- **Private local state:** snapshots and review history may be sensitive.
  Protect the local store and canvas capability URL; component updates preserve
  configuration and history. Apply organizational data-handling rules to every
  participating model.

## Use with Copilot App

Start with the [customization and setup guide](docs/setup.md). Agree on and
validate your customizations first, or explicitly choose the supplied fixture
walkthrough. Until plugin packaging is implemented, use the guide's native-copy
installation and update prompts to test the workflow. Components install
directly into `~/.copilot/skills/ps*`, `~/.copilot/agents/ps-*.agent.md` and
`~/.copilot/extensions/ps-runtime/`. There is no enclosing `ps` application
directory or full-repository copy; the source is installation input only.
An explicit project-local deployment uses `PROJECT/.github` as the common
root for all components. For source work, use the [development prompts](docs/development.md).

Setup always offers a **user-confirmed daily local refresh for all products**
(default `09:00`). The import opens an App draft; you review project, local
execution, model and time, then confirm Create. Existing jobs are updated, not
duplicated. Nothing creates a schedule automatically.

The extension requires Node.js 22 or newer and the host-provided Copilot SDK.
It starts and stops the loopback canvas runtime; no separate server command or
package installation is needed. Keep the canvas capability URL private.
Version/update tooling alone uses Python 3.9+ through
`python3 skills/ps-update/scripts/lifecycle.py`, with no pip or virtual
environment. Runtime, adapter, refresh and automation import still use Node;
browser JavaScript is unchanged.

### Reusable chat investigation

[Analyst](agents/ps-analyst.agent.md) and
[Challenger](agents/ps-challenger.agent.md) cooperate through the
[ps-investigate skill](skills/ps-investigate/SKILL.md). A substantive product
question automatically follows analysis, challenge and revision; a simple
fact lookup stays lightweight. Models are selected from host-available,
permitted choices based on the task, preferably across providers.

Use it directly in chat with scoped evidence or from a dashboard investigation.
It does not require an open canvas, run refresh or connect preview
providers. The profiles are tool-free; source skills retain retrieval ownership.
The investigation skill and independently versioned agents keep this workflow separate from
deterministic sample refresh.

Follow [agent registration and model selection](docs/setup.md#agent-registration-and-model-selection)
after installation. Source profiles in `agents/` are copied directly to the
native agent directory and managed by the same lifecycle receipt as the skills
and extension, not separate registration copies.
Offline tests verify the packaged instructions and lifecycle, not live
delegation, model identity or source permissions.

Use the [sample walkthrough](#try-the-sample-workflow) to investigate from the
dashboard, or provide scoped evidence directly in chat.

Live reads require configured repositories, an available authenticated GitHub MCP integration and the Product Scout extension connected to the current Copilot App session. Fictional snapshots do not imply live GitHub access.

## Bring your own expertise, not just choose a model

**Product Scout's reusable investigation workflow can be adapted to use approved
general-purpose models alongside compatible organization-specific models,
including models deployed through Microsoft Foundry.** Keep the workflow and
scoped evidence consistent while choosing suitable intelligence for each role.

For example, an Analyst could assess delivery and usage evidence with an
approved general-purpose model, while a Challenger uses a company-specific
model adapted to recognize its security concerns or review conventions.
This is a possible enterprise adaptation, not a claim that the sample includes
such a model or guarantees a better answer.

The [Copilot App's own-model support](https://docs.github.com/en/copilot/how-tos/github-copilot-app/use-byok-models)
includes Microsoft Foundry and OpenAI-compatible endpoints.
[Enterprise custom-model documentation](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/enable-custom-models)
also explicitly supports fine-tuned models, subject to testing.
These capabilities are public preview as documented on 24 September 2026;
endpoint compatibility, model quality and availability in the installed host
must be verified.

The competitive distinction is broader model-family and custom-model choice,
not exclusive access to Foundry or multiple agents.
[Claude Code also supports Foundry](https://code.claude.com/docs/en/microsoft-foundry)
for Claude deployments; its [gateway documentation](https://code.claude.com/docs/en/llm-gateway)
states that routing to non-Claude models is not supported.

**Verification boundary:** a custom Foundry model is an extension option, not
an integration verified by this repository. Confirm actual Analyst/Challenger
execution and model assignments before presenting it as demonstrated.
A security-specialized model remains an adviser, not a policy enforcement or
compliance control. Data-handling requirements apply to every participating
model; a privately hosted Challenger does not make the entire workflow private.

## Configuration and sample data

[Product configuration](skills/ps/config/products.json) defines identity, release dates, repository bindings and label conventions. The supplied Zava Shop and Contoso CRM data is **fictional, authored example data**, not retrieved GitHub content. These fictional repositories are not configured as real bindings, and their issues have no fabricated source links. All six cards use the normal dashboard presentation without fixture/sample/demo labels. Internal fixture provenance, validation and source boundaries remain unchanged.

To prepare samples for another demo day, ask `/ps Refresh all sample data`
or name one product. Manual refresh and `ps-data-refresh` automation invoke the
same [`ps-data-refresh` skill](skills/ps-data-refresh/SKILL.md). It shifts
fictional observations and reporting windows to the refresh time in private
working copies, preserving relative ages, metrics and fixture provenance.
Packaged files, release targets and reviewed history stay unchanged.
Live-bound products are skipped: no sources are queried or ingested and no
real evidence timestamps are rewritten. The automation runs this once for
all products, without investigation agents. Setup offers scheduling, but only
your confirmation creates it. Daily local execution needs the local environment
running and follows wall-clock time, not guaranteed 24-hour spacing through DST.

Explicit live issue investigation remains a separate `ps-issues` workflow and
requires real configured `owner/repository` bindings and host GitHub access.
Configured products start with unknown coverage until an actual snapshot arrives.
Samples age normally between explicit refreshes. Stale coverage remains visible;
opening the dashboard or investigating never re-dates evidence automatically.

Private state is stored at `COPILOT_HOME/.ps/state.json` (default
`~/.copilot/.ps/state.json`) with local file permissions and no credentials.
It contains snapshots, comparison data, review decisions and refreshed fixture
previews; treat it as potentially sensitive. Extension and refresh CLI share
that store across multiple App sessions. A short-lived `writer.lock` serializes
each update; reads reload current shared state. Per-session runtime leases keep
component updates blocked until all runtimes stop. Deployment uses a separate `deployment.json`
receipt, `backups/` and `deploy.lock` in `.ps/`. Pause the daily job and stop
the extension before updates; resume after verification.

## Architecture and development

Implementation resources are skill-owned: [`skills/ps/`](skills/ps/) contains
the runtime, canvas, product registry and fictional snapshots.
[`skills/ps-update/`](skills/ps-update/) contains the standard-library Python lifecycle CLI.
[`skills/ps-version/version-manifest.json`](skills/ps-version/version-manifest.json)
is the single version authority, with independent entries for every skill,
agent, extension and automation. Only changed artifacts receive version bumps;
pipeline compatibility and the shared runtime version are tracked separately.
See the manifest for current versions and the development guide for packaging
and lifecycle rules.
[`extensions/ps-runtime/`](extensions/ps-runtime/) is only the host SDK adapter.
Developer tests run with `node --test tests/*.test.mjs`, including the Python
lifecycle safety suite; see
[development](docs/development.md) for syntax and lifecycle validation.

- [Architecture and ownership](docs/development.md#architecture-and-ownership)
- [Development and validation](docs/development.md)
- [Managing a datasource with GitHub Copilot](docs/managing-a-datasource.md)
- [Copilot extension boundaries](docs/development.md#copilot-extension-contract)
- [Snapshot data contract](docs/data-contract.md)

## Limitations

This is a local prototype for an individual user, with shared state across that
user's App sessions, not a shared enterprise service. Six-source investigation
is demonstrated with authored samples; live reads are limited to configured
GitHub Issues. Periodic live collection, automatic Copilot-generated overview
insights and plugin packaging are not implemented.

The workflow does not modify GitHub, run security scans, infer shipped releases
from closed issues or automatically approve insights. The App owns scheduling;
local daily sample refresh is not live monitoring. Repository tests use a host
mock, so registration, delegation, actual model identity and source permissions
must be verified in the installed Copilot App build. No measured time savings,
ROI or enterprise deployment readiness is claimed.
