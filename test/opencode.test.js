import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { parse } from 'yaml';

import { init, update, updateAll } from '../lib/install.js';
import { listAgents } from '../lib/catalog.js';
import { renderOpenCodeAgent } from '../lib/renderers/opencode-agent.js';
import { renderOpenCodeSkill } from '../lib/renderers/opencode-skill.js';

function output() {
  const stream = new PassThrough();
  stream.resume();
  return stream;
}

function frontmatter(content) {
  return parse(content.split('---')[1]);
}

test('OpenCode agents use V2 permissions and inherit models unless explicitly configured', async () => {
  const agents = await listAgents(new URL('../agents/', import.meta.url).pathname);
  for (const agent of agents) {
    const rendered = renderOpenCodeAgent(agent, agent.prompt);
    const metadata = frontmatter(rendered);
    assert.equal(metadata.mode, 'subagent');
    assert.equal(metadata.model, undefined);
    assert.ok(rendered.endsWith(`${agent.prompt.trimEnd()}\n`));
    assert.equal(metadata.permission, undefined);
    assert.equal(metadata.tools, undefined);
    if (agent.access === 'read-only') {
      const effect = (action, resource = 'src/main.js') => metadata.permissions.filter(rule => (
        (rule.action === '*' || rule.action === action)
        && (rule.resource === '*' || (rule.resource === '*.env' && resource.endsWith('.env')))
      )).at(-1)?.effect;
      for (const action of ['edit', 'shell', 'subagent', 'execute', 'mcp_write']) {
        assert.equal(effect(action), 'deny');
      }
      assert.equal(effect('read'), 'allow');
      assert.equal(effect('read', '.env'), 'ask');
      assert.equal(effect('grep'), 'allow');
    } else if (agent.access === 'git-write') {
      assert.deepEqual(metadata.permissions, [{ action: 'edit', resource: '*', effect: 'deny' }]);
    } else {
      assert.equal(metadata.permissions, undefined);
    }
  }
  const agent = { ...agents[0], models: { opencode: 'provider/model#high' } };
  assert.equal(frontmatter(renderOpenCodeAgent(agent, agent.prompt)).model, 'provider/model#high');
});

test('OpenCode skill renderer preserves frontmatter and adds native workflow adapter', () => {
  const content = "---\nname: eda-test\ndescription: 'Тест.'\n---\n\n# Скил\n";
  const rendered = renderOpenCodeSkill(content);
  assert.deepEqual(frontmatter(rendered), frontmatter(content));
  assert.match(rendered, /eda-skill-runner/);
  assert.match(rendered, /question/);
  assert.ok(rendered.endsWith('# Скил\n'));
  assert.throws(() => renderOpenCodeSkill('no frontmatter'), /front matter/);
});

test('catalog validates optional OpenCode model IDs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-opencode-catalog-'));
  const directory = path.join(root, 'eda-test');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'prompt.md'), 'Тестовая роль.');
  const config = {
    schemaVersion: 1, name: 'eda-test', description: 'Тест.',
    access: 'read-only', models: { claude: 'sonnet', codex: 'gpt-5.6-terra' }
  };
  for (const model of ['provider/model', 'provider/model#high', 'sonnet', '', 42]) {
    config.models.opencode = model;
    await fs.writeFile(path.join(directory, 'agent.json'), JSON.stringify(config));
    if (typeof model === 'string' && model.startsWith('provider/')) {
      assert.equal((await listAgents(root))[0].models.opencode, model);
    } else {
      await assert.rejects(listAgents(root), /models.opencode/);
    }
  }
});

test('OpenCode-only update is idempotent, preserves foreign files and removes stale owned components', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-opencode-'));
  await fs.mkdir(path.join(cwd, '.opencode/agents'), { recursive: true });
  await fs.mkdir(path.join(cwd, '.opencode/skills/eda-old'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.opencode/agents/eda-old.md'), 'old');
  await fs.writeFile(path.join(cwd, '.opencode/agents/team.md'), 'keep');
  await fs.writeFile(path.join(cwd, '.opencode/opencode.jsonc'), '{ /* keep */ }');
  await fs.writeFile(path.join(cwd, '.opencode/eda-manifest.json'), JSON.stringify({
    schemaVersion: 1, skills: ['eda-old'], agents: ['eda-old']
  }));
  await update({ cwd, output: output() });
  const installed = path.join(cwd, '.opencode/skills/eda-review/SKILL.md');
  assert.match(await fs.readFile(installed, 'utf8'), /Среда исполнения: OpenCode V2/);
  assert.ok(await fs.stat(path.join(cwd, '.opencode/skills/eda-review/references/review-matrix.md')));
  assert.equal(await fs.readFile(path.join(cwd, '.opencode/agents/team.md'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(cwd, '.opencode/opencode.jsonc'), 'utf8'), '{ /* keep */ }');
  for (const name of ['.claude', '.codex', '.agents', '.opencode/skills/eda-old', '.opencode/agents/eda-old.md']) {
    await assert.rejects(fs.stat(path.join(cwd, name)), { code: 'ENOENT' });
  }
  const before = (await fs.stat(installed)).mtimeMs;
  await update({ cwd, output: output() });
  assert.equal((await fs.stat(installed)).mtimeMs, before);
});

test('OpenCode update-all detects skills, agents and manifests, skips config-only and internal projects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-opencode-all-'));
  const seed = async (name, file) => {
    const destination = path.join(root, name, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, '{}');
  };
  await seed('skills', '.opencode/skills/eda-plan/SKILL.md');
  await seed('agents', '.opencode/agents/eda-review-correctness.md');
  await seed('manifest', '.opencode/eda-manifest.json');
  await seed('config', '.opencode/opencode.json');
  await seed('.opencode/nested', '.opencode/eda-manifest.json');
  const result = await updateAll({ root, output: output() });
  assert.deepEqual(result.updatedProjects.map(project => path.basename(project.path)).sort(), ['agents', 'manifest', 'skills']);
  assert.ok(result.updatedProjects.every(project => project.targets.join() === 'opencode'));
  assert.equal(result.failedProjects.length, 0);
});

test('OpenCode update rejects symlinked managed roots without changing their destinations', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-opencode-symlink-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-opencode-outside-'));
  await fs.mkdir(path.join(outside, 'agents'));
  await fs.writeFile(path.join(outside, 'agents/team.md'), 'keep');
  await fs.symlink(outside, path.join(cwd, '.opencode'));
  await assert.rejects(update({ cwd, output: output() }), /не должен быть symlink/);
  assert.deepEqual(await fs.readdir(outside), ['agents']);
  assert.equal(await fs.readFile(path.join(outside, 'agents/team.md'), 'utf8'), 'keep');
});

test('non-interactive init installs OpenCode resources without Claude-only metadata', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-opencode-init-'));
  await init({ cwd, output: output() });
  const skill = await fs.readFile(path.join(cwd, '.opencode/skills/eda-commit/SKILL.md'), 'utf8');
  assert.equal(frontmatter(skill).model, undefined);
  await assert.rejects(fs.stat(path.join(cwd, '.opencode/skills/eda-commit/skill.json')), { code: 'ENOENT' });
  assert.equal(frontmatter(await fs.readFile(path.join(cwd, '.opencode/agents/eda-skill-runner.md'), 'utf8')).mode, 'subagent');
});
