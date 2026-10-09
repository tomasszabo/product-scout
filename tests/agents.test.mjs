import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = file => readFile(new URL(file, root), "utf8");
const manifest = JSON.parse(await read("skills/ps-version/version-manifest.json"));
const skill = await read("skills/ps-investigate/SKILL.md");
const policy = await read("skills/ps-investigate/references/model-selection.md");
const contract = await read("skills/ps-investigate/references/contract.md");

test("two canonical tool-free agents are packaged with independent versions and dynamic model selection", async () => {
  assert.deepEqual((await readdir(new URL("agents/", root))).sort(), [
    "ps-analyst.agent.md", "ps-challenger.agent.md",
  ]);
  assert.deepEqual(Object.keys(manifest.agents).sort(), ["ps-analyst", "ps-challenger"]);
  for (const name of ["ps-analyst", "ps-challenger"]) {
    const profile = await read(`agents/${name}.agent.md`);
    assert.ok(profile.startsWith(`---\nname: ${name}\n`));
    const frontmatter = profile.split("---")[1];
    assert.match(frontmatter, /\ndescription: .+/);
    assert.match(frontmatter, /\ntools: \[\]\n/);
    assert.doesNotMatch(frontmatter, /\nmodel:|\nmcp-servers:/);
    for (const section of ["Purpose", "Inputs", "Model selection", "Workflow", "Safety", "Output contract", "Product Scout Versioning"]) {
      assert.ok(profile.includes(`## ${section}\n`), `${name}: ${section}`);
    }
    assert.ok(profile.includes(`Agent version: ${manifest.agents[name]}`));
    assert.ok(profile.includes(`Pipeline version: ${manifest.version}`));
    assert.ok(profile.includes(`agentVersion: "${manifest.agents[name]}"`));
    assert.match(profile, /untrusted data/);
    assert.match(profile, /invalid-input/);
    assert.match(profile, /investigationId, productId/);
  }
});

test("investigation routes intent before runtime access and uses a bounded three-call workflow", () => {
  assert.match(skill, /Classify|Route intent before requiring runtime tools/);
  assert.match(skill, /No two-agent overhead/);
  assert.match(skill, /No dashboard is required|without an open canvas/);
  assert.match(skill, /`ps_get_state` alone does not identify browser selection/);
  assert.match(skill, /at most three agent calls: analysis, challenge and revision/);
  assert.ok(skill.indexOf('**Analyze.**') < skill.indexOf('**Challenge.**'));
  assert.ok(skill.indexOf('**Challenge.**') < skill.indexOf('**Revise.**'));
  assert.match(skill, /same selected Analyst model/);
  assert.match(skill, /ordinary inline role-play/);
  assert.match(skill, /ps-data-refresh/);
  assert.match(skill, /Never bypass a skip/);
  assert.match(skill, /never as fallback after failed\s+live access/);
  assert.match(skill, /New evidence or further exploration is a subsequent user-requested investigation/);
});

test("model policy discovers eligible models, announces choices and asks only about blockers", async () => {
  for (const fragment of [
    "available/permitted model catalog",
    "explicit user role/model choice",
    "**Standard:**",
    "**Deep:**",
    "**different provider**",
    "different model from the same",
    "only one model is suitable",
    "Unknown provider identity",
    "exact selected IDs",
    "requested; execution identity unverified",
    "unexpected substitution",
    "stop automatic selection",
  ]) {
    assert.ok(policy.replace(/\s+/g, " ").includes(fragment), fragment);
  }
  assert.match(policy, /Do not\s+silently inherit a session model/);
  assert.match(policy, /Do not invent prices, rankings or numerical scores/);
  assert.match(policy, /Never change\s+global model settings/);
  assert.match(policy, /without routine model\s+approval/);
  assert.match(policy, /delegation tool schemas \(including enumerated model IDs\)/);
  assert.match(policy, /missing dedicated catalog tool alone is not a reason to ask/);
  assert.match(policy, /Only after the supported discovery paths above cannot establish eligible\s+models, ask once/);
  assert.match(policy, /ask before using\s+a different model from the same provider/);
  assert.match(policy, /already explicitly chose a\s+same-provider or same-model pair/);
  assert.match(policy, /without\s+asking again/);
  assert.doesNotMatch(policy, /If unavailable, choose a suitable different model/);
  assert.match(skill, /Do not ask for routine model approval; proceed automatically/);
  const parent = await read("skills/ps/SKILL.md");
  assert.match(parent, /Announce the selection, not an\s+approval question/);
  assert.match(parent, /respecting explicit user model choices/);
  assert.doesNotMatch(await read("docs/setup.md"), /with approval for model usage/);
});

test("handoff contract protects identities, citations, limitations and evidence from role instructions", async () => {
  for (const fragment of [
    "not a persisted snapshot", "at most 50 evidence entries", "2,000 characters",
    "No other fields are accepted", "Citation labels exist in the immutable packet",
    "exactly once to every", "with no unknown IDs", "host invocation metadata",
  ]) {
    assert.ok(contract.replace(/\s+/g, " ").includes(fragment), fragment);
  }
  const analyst = await read("agents/ps-analyst.agent.md");
  const challenger = await read("agents/ps-challenger.agent.md");
  assert.match(analyst, /at most three findings and three options/);
  assert.match(analyst, /same evidence\s+packet/);
  assert.match(challenger, /at most five challenges/);
  assert.match(challenger, /no-material-issues/);
  assert.match(challenger, /empty evidenceRefs is valid/);
  assert.match(skill, /failed or\s+malformed critique is not `no-material-issues`/);
  assert.match(skill, /If analysis fails, report failure/);
  assert.match(skill, /explicitly incomplete/);
  assert.match(skill, /Do not store packets or agent transcripts/);
});

test("source reader and parent route analysis without recursion or canvas dependencies", async () => {
  const parent = await read("skills/ps/SKILL.md");
  const reader = await read("skills/ps-issues/SKILL.md");
  assert.ok(parent.indexOf("Classify intent") < parent.indexOf("discover the exact schemas"));
  assert.match(parent, /to `ps-investigate`/);
  assert.match(parent, /Plain source\s+lookups use `ps-issues`/);
  assert.match(parent, /forward the concise `ps-investigate` answer/);
  assert.match(reader, /Do not delegate back/);
  assert.match(skill, /Only `ps-issues`\s+currently retrieves live data/);
  assert.match(skill, /never ingest agent prose as a snapshot/);
});

test("all interactive skills use natural language for users and keep machine payloads internal", async () => {
  for (const name of Object.keys(manifest.skills)) {
    const body = await read(`skills/${name}/SKILL.md`);
    const output = body.split("## Output contract\n")[1].split("## Product Scout Versioning")[0].replace(/\s+/g, " ");
    assert.match(output, /User-facing replies use concise natural language, never JSON objects or JSON code blocks/, name);
    assert.doesNotMatch(body, /Return strict JSON|Return the actual JSON unchanged|Forward fixture refresh results unchanged/, name);
  }
  const parent = await read("skills/ps/SKILL.md");
  assert.doesNotMatch(parent, /```json|"schemaVersion"|"routedTo"/);
  for (const text of [
    "Never forward a child skill's JSON unchanged into chat",
    "refreshed, unchanged, skipped and failed products",
    "do not claim visual success without confirmation",
    "never ingest the prose",
  ]) assert.ok(parent.replace(/\s+/g, " ").includes(text), text);
  const reader = await read("skills/ps-issues/SKILL.md");
  assert.match(reader, /internal source-read handoff/);
  assert.match(reader, /only the normalized snapshot JSON/);
  assert.match(reader, /machine data, not the final chat reply/);
  const refresh = await read("skills/ps-data-refresh/SKILL.md");
  assert.match(refresh, /strict JSON remains unchanged for internal callers/);
  for (const name of ["ps-update", "ps-version"]) {
    assert.match(await read(`skills/${name}/SKILL.md`), /JSON.*internal/);
  }
});

test("parent gives a concise canvas quick start once per conversation without extra actions", async () => {
  const parent = (await read("skills/ps/SKILL.md")).replace(/\s+/g, " ");
  for (const instruction of [
    "A bare `/ps` activation with no other task is a request to open My Products",
    "A usage/help request gets the quick start below without requiring a canvas",
    "After an accepted canvas-open request",
    "Use conversation history, including retained summaries",
    "Do not persist an onboarding flag",
    "give it on the next view/open/switch request",
    "Do not repeat it on subsequent opens, product switches or skill activations",
    "Repeat or expand it when the user asks for help",
    "honor a request to skip introductions",
    "On a failed or unavailable canvas-open operation",
    "A later successful retry can still receive the quick start",
    "Do not append onboarding to fact lookups, investigations, refresh, timeline or lifecycle results",
    "Guidance itself invokes no agents, source queries, refresh or review",
    "Use at most four short bullets",
    "**My Products**", "expand or collapse", "highlight dashboard text",
    '**"Explain this"**', '**"What should I focus on?"**', '**"Updated ... ago"**',
    "Do not add a confirmation question",
  ]) assert.ok(parent.includes(instruction), instruction);
  const original = await read("skills/ps/SKILL.md");
  const quickStart = original.split("Use at most four short bullets")[1].split("For a product already selected")[0];
  assert.equal((quickStart.match(/^- /gm) ?? []).length, 4);
});

test("deployment guidance manages native agent files and preserves model edits", async () => {
  const setup = await read("docs/setup.md");
  const update = await read("skills/ps-update/SKILL.md");
  const development = await read("docs/development.md");
  for (const text of [setup, update, development]) {
    assert.match(text, /discovery/);
    assert.match(text, /model/);
  }
  assert.match(setup, /\.ps\/deployment\.json/);
  assert.match(setup, /~\/\.copilot\/agents/);
  assert.match(setup, /shadowing\/duplicate names/);
  assert.match(setup, /Chat-only use/);
  assert.match(update, /preserve\s+local model\/tool edits and name collisions/);
});

test("agent and investigation reference links resolve within the release", async () => {
  for (const file of [
    "agents/ps-analyst.agent.md", "agents/ps-challenger.agent.md",
    "skills/ps-investigate/SKILL.md",
    "skills/ps-investigate/references/model-selection.md",
    "skills/ps-investigate/references/contract.md",
  ]) {
    for (const match of (await read(file)).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = new URL(match[1], new URL(file, root));
      assert.ok(target.href.startsWith(root.href), `Outside release: ${target}`);
      await access(target);
    }
  }
});
test("deictic questions resolve explicit ephemeral context without trusting selected text as instructions", async () => {
  for (const name of ["ps", "ps-investigate"]) {
    const skill = await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
    assert.match(skill, /`ps_get_context`/);
    assert.match(skill, /status: available/);
    assert.match(skill, /ambiguous or outdated|ambiguous\s+or outdated/);
    assert.match(skill, /untrusted quoted content/);
    assert.match(skill, /revision/);
    assert.match(skill, /preserved|archived/);
  }
});
