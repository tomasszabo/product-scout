import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, access, unlink, readdir, cp, rename, mkdtemp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const manifestPath = 'skills/ps-version/version-manifest.json';
const helperPath = 'skills/ps-update/scripts/lifecycle.py';
const guides = [
  'README.md', 'docs/setup.md', 'docs/data-contract.md', 'docs/development.md',
  'docs/managing-a-datasource.md', 'docs/how-to-use-product-scout.md',
];
const read = name => readFile(path.join(root, name), 'utf8');
const manifest = JSON.parse(await read(manifestPath));

async function lifecycle(args, helper = path.join(root, helperPath), cwd = root) {
  const { stdout, stderr } = await run('python3', ['-B', helper, ...args], { cwd });
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}

async function checkLinks(base, name, anchors = false) {
  for (const match of (await readFile(path.join(base, name), 'utf8')).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(match[1])) continue;
    const [target, anchor] = match[1].split('#');
    const resolved = target ? path.resolve(base, path.dirname(name), target) : path.join(base, name);
    assert.ok(resolved.startsWith(`${path.resolve(base)}${path.sep}`), `${name}: outside root ${match[1]}`);
    await access(resolved);
    if (anchors && anchor) {
      const destination = await readFile(resolved, 'utf8');
      const headings = [...destination.matchAll(/^#{1,6} (.+)$/gm)]
        .map(heading => heading[1].toLowerCase().replace(/[^\w -]/g, '').replace(/ /g, '-'));
      assert.ok(headings.includes(anchor), `${name}: missing anchor ${match[1]}`);
    }
  }
}

test('Python lifecycle safety suite covers dry runs, updates, collisions and unsafe paths', async () => {
  const { stdout, stderr } = await run('python3', [
    '-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_lifecycle.py',
  ], { cwd: root });
  assert.match(stderr, /Ran [1-9]\d* tests?/);
  assert.match(stderr, /\bOK\b/);
  assert.equal(stdout, '');
});

test('version and inventory use named artifacts, not a managed list or test tree', async () => {
  assert.equal(manifest.managed, undefined);
  assert.equal(manifest.components, undefined);
  const version = await lifecycle(['version'], undefined, path.join(root, 'tests'));
  assert.equal(version.schemaVersion, '2.0');
  assert.equal(version.version, manifest.version);
  assert.equal(version.runtimeVersion, manifest.runtimeVersion);
  for (const group of ['skills', 'agents', 'extensions', 'automations']) {
    assert.deepEqual(version[group], manifest[group]);
  }
  const inventory = await lifecycle(['check', '--source', root]);
  assert.equal(inventory.valid, true);
  assert.equal(inventory.files, inventory.componentFiles);
  assert.deepEqual(inventory.versions.skills, manifest.skills);
  await assert.rejects(access(path.join(root, 'skills/ps-update/scripts/lifecycle.mjs')), { code: 'ENOENT' });
});

test('agent guides provide Python lifecycle prompts and resolve their local documentation links', async () => {
  const setup = await read('docs/setup.md');
  const development = await read('docs/development.md');
  const datasource = await read('docs/managing-a-datasource.md');
  const usage = await read('docs/how-to-use-product-scout.md');
  const instructions = await read('.github/copilot-instructions.md');
  const skillInstructions = await read('.github/instructions/skills.instructions.md');
  for (const title of ['Copy-paste installation prompt', 'Copy-paste update prompt', 'Host registration', 'Recovery and final report']) {
    assert.ok(setup.includes(`## ${title}`), title);
  }
  for (const title of ['Copy-paste development installation prompt', 'Copy-paste maintenance and update prompt', 'Architecture and ownership', 'Copilot extension contract', 'Validation']) {
    assert.ok(development.includes(`## ${title}`), title);
  }
  assert.ok(setup.includes('python3 "<SOURCE>/skills/ps-update/scripts/lifecycle.py" install --source "<SOURCE>" --host-root "<COPILOT_HOME>" --apply'));
  assert.ok(setup.includes('check --source "<SOURCE>" --host-root "<COPILOT_HOME>"'));
  assert.ok(development.includes('node --test tests/*.test.mjs'));
  assert.ok(development.includes("python3 -B -m unittest discover -s tests -p 'test_lifecycle.py'"));
  assert.ok(datasource.includes('GitHub Copilot'));
  for (const title of ['Establish scope before editing', 'Current boundaries', 'Integration map',
    'Add a datasource', 'Change an existing datasource', 'Remove a datasource', 'Verification and completion']) {
    assert.ok(datasource.includes(`## ${title}`), title);
  }
  for (const text of [development, instructions, skillInstructions]) {
    assert.match(text, /\[Managing a datasource\]\([^)]*managing-a-datasource\.md\)/);
  }
  for (const title of ['The hybrid workflow', 'Two-agent investigation', 'Visual attention and optional notifications',
    'Shared context between the dashboard and Copilot', 'Human review and responsibility', 'What works today']) {
    assert.ok(usage.includes(`## ${title}`), title);
  }
  for (const text of [setup, development, datasource, instructions]) {
    assert.match(text, /\[How to use Product Scout\]\([^)]*how-to-use-product-scout\.md\)/);
  }
  for (const name of [...guides, '.github/copilot-instructions.md', '.github/instructions/skills.instructions.md']) {
    await checkLinks(root, name, true);
  }
});

test('each skill and automation matches its own named version and output examples', async () => {
  assert.deepEqual((await readdir(path.join(root, 'skills'))).sort(), Object.keys(manifest.skills).sort());
  for (const group of ['skills', 'automations']) {
    for (const [name, version] of Object.entries(manifest[group])) {
      const body = await read(`${group}/${name}/SKILL.md`);
      assert.ok(body.startsWith(`---\nname: ${name}\n`));
      for (const field of ['description', 'domain', 'capabilities']) assert.match(body, new RegExp(`\\n${field}: .+`));
      for (const section of ['Purpose', 'Inputs', 'Workflow', 'Safety', 'Output contract', 'Product Scout Versioning']) {
        assert.ok(body.includes(`## ${section}\n`));
      }
      assert.ok(body.includes(`Pipeline version: ${manifest.version}`));
      assert.ok(body.includes(`Skill version: ${version}`));
      assert.ok(body.includes('Internal namespace: ps'));
      for (const match of body.matchAll(/"skillVersion": "([^"]+)"/g)) assert.equal(match[1], version);
    }
  }
  const automation = JSON.parse(await read('automations/ps-data-refresh/manifest.json'));
  assert.equal(automation.version, manifest.automations['ps-data-refresh']);
  assert.equal(automation.pipelineVersion, manifest.version);
  assert.equal(automation.enabledByDefault, false);
  assert.equal(automation.permissions.githubWrites, false);
  assert.equal(automation.permissions.timelineApproval, false);
  assert.equal(automation.permissions.github, 'none');
  assert.equal(automation.permissions.localSnapshotIngest, false);
  assert.equal(automation.skill, 'skills/ps-data-refresh/SKILL.md');
});

test('release resources remain skill-owned without root-level application directories', async () => {
  for (const name of ['lib', 'web', 'fixtures', 'config', 'scripts', 'version-manifest.json', 'package.json', 'skills/ps/scripts/serve.mjs', 'skills/ps/web']) {
    await assert.rejects(access(path.join(root, name)), { code: 'ENOENT' });
  }
  for (const name of ['skills/ps/lib/server.mjs', 'skills/ps/dashboard/index.html',
    'skills/ps/config/products.json', 'skills/ps/fixtures/zava-shop.json', helperPath, manifestPath]) {
    await access(path.join(root, name));
  }
});

test('Python-deployed components work without source checkout and keep Node runtime behavior', async t => {
  const directory = await mkdtemp(path.join(root, 'tests/.lifecycle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const hostRoot = path.join(directory, '.copilot');
  const sourcePaths = [...guides, ...['skills', 'agents', 'extensions', 'automations'].flatMap(group =>
    Object.keys(manifest[group]).map(name => `${group}/${name}${group === 'agents' ? '.agent.md' : ''}`))];
  for (const name of sourcePaths) {
    await mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await cp(path.join(root, name), path.join(source, name), { recursive: true });
  }
  const installArgs = ['install', '--source', source, '--host-root', hostRoot];
  const preview = await lifecycle(installArgs);
  assert.equal(preview.applied, false);
  assert.deepEqual(preview.conflicts, []);
  await assert.rejects(access(hostRoot), { code: 'ENOENT' });
  assert.equal((await lifecycle([...installArgs, '--apply'])).applied, true);
  const helper = path.join(hostRoot, helperPath);
  assert.deepEqual((await lifecycle(['check', '--source', source, '--host-root', hostRoot], helper)).changes, []);
  for (const name of Object.keys(manifest.agents)) {
    const relative = `agents/${name}.agent.md`;
    assert.equal(await readFile(path.join(hostRoot, relative), 'utf8'), await read(relative));
  }
  const receipt = JSON.parse(await readFile(path.join(hostRoot, '.ps/deployment.json')));
  assert.ok(receipt.files[helperPath]);
  assert.ok(!Object.keys(receipt.files).some(name => name.startsWith('tests/')));
  for (const name of Object.keys(receipt.files).filter(name => name.endsWith('.md'))) {
    await checkLinks(hostRoot, name, true);
  }
  for (const name of ['ps', 'tests', 'docs', 'README.md', 'automations', 'skills/ps-update/scripts/__pycache__']) {
    await assert.rejects(access(path.join(hostRoot, name)), { code: 'ENOENT' });
  }
  await rename(source, `${source}-offline`);
  const version = await lifecycle(['version'], helper, directory);
  assert.equal(version.version, manifest.version);
  assert.deepEqual(version.skills, manifest.skills);
  const draft = await run(process.execPath, [
    path.join(hostRoot, 'skills/ps-data-refresh/scripts/import-automation.mjs'), '--time', '07:30',
  ], { cwd: directory });
  assert.equal(JSON.parse(draft.stdout).status, 'confirmation-required');
  assert.equal(new URL(JSON.parse(draft.stdout).appLink).searchParams.get('time'), '07:30');
  const { startRuntime } = await import(pathToFileURL(path.join(hostRoot, 'skills/ps/lib/server.mjs')));
  await writeFile(path.join(hostRoot, '.ps/deploy.lock'), 'deploying');
  await assert.rejects(startRuntime(), /component deployment is active/);
  await assert.rejects(access(path.join(hostRoot, '.ps/writer.lock')), { code: 'ENOENT' });
  await unlink(path.join(hostRoot, '.ps/deploy.lock'));
  const runtime = await startRuntime();
  try {
    await assert.rejects(access(path.join(hostRoot, '.ps/writer.lock')), { code: 'ENOENT' });
    await assert.rejects(run('python3', ['-B', helper,
      'install', '--source', `${source}-offline`, '--host-root', hostRoot, '--apply']),
    error => /runtime is active/.test(error.stderr));
    assert.equal(runtime.service.getState().products.length, 2);
    assert.ok(runtime.service.getState().products.every(product => product.snapshot.mode === 'fixture'));
    for (const name of ['', 'app.js', 'theme.js', 'styles.css']) {
      const response = await fetch(new URL(`/${name}`, runtime.url));
      assert.equal(response.status, 200);
      assert.ok((await response.text()).length > 0);
    }
  } finally {
    await runtime.close();
  }
  const { createExtensionDefinition } = await import(pathToFileURL(path.join(hostRoot, 'extensions/ps-runtime/adapter.mjs')));
  const extension = createExtensionDefinition({ createCanvas: value => value, CanvasError: Error });
  try {
    const state = JSON.parse(await extension.definition.tools[0].handler({}));
    assert.equal(state.products.length, 2);
    const refresh = extension.definition.tools.find(tool => tool.name === 'ps_refresh_fixtures');
    assert.equal(JSON.parse(await refresh.handler({})).status, 'refreshed');
    const refreshed = JSON.parse(await extension.definition.tools[0].handler({}));
    assert.ok(refreshed.products.every(product => !product.assessment.stale && !product.previewSources.stale));
    const canvas = await extension.definition.canvases[0].open({ input: {} });
    const response = await fetch(canvas.url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Product Scout/);
  } finally {
    await extension.close();
  }
  await assert.rejects(access(path.join(hostRoot, '.ps/writer.lock')), { code: 'ENOENT' });
  const refreshed = await run(process.execPath, [
    path.join(hostRoot, 'skills/ps-data-refresh/scripts/refresh.mjs'), '--all',
  ], { cwd: directory });
  assert.equal(JSON.parse(refreshed.stdout).status, 'refreshed');
  await rename(`${source}-offline`, source);
  const comparison = await lifecycle(installArgs);
  assert.deepEqual(comparison.changes, []);
  assert.deepEqual(comparison.versionChanges, []);
  assert.deepEqual(comparison.conflicts, []);
});

test('issue reader documents runtime composite identity and non-null live URLs', async () => {
  const skill = await read('skills/ps-issues/SKILL.md');
  assert.ok(skill.includes('`${repository}#${number}`'));
  assert.match(skill, /Never use a\s+raw GitHub numeric ID, node ID or array index/);
  assert.doesNotMatch(skill, /stringifying an observed GitHub issue/);
  assert.match(skill, /milestone: string \| null, url: string,/);
  assert.doesNotMatch(skill, /url: string \| null/);
  assert.match(skill, /runtime validation rejects null live URLs/);
  assert.ok((await read('docs/development.md')).includes('`${repository}#${number}`'));
});

test('parent routes product analysis to investigation and source reads to issues, not software lifecycle', async () => {
  const skill = await read('skills/ps/SKILL.md');
  assert.match(skill, /product release\/readiness analysis, to `ps-investigate`/);
  assert.match(skill, /straightforward live issue lookups go to `ps-issues`/);
  assert.match(skill, /`ps-version` exclusively for the \*\*Product Scout software\*\*/);
  assert.match(skill, /`ps-update` exclusively for\s+\*\*Product Scout software\*\*/);
  assert.doesNotMatch(skill, /release\/version goes to `ps-version`/);
});
