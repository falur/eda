import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { askSettings, askTargets, init, update, updateAll } from '../lib/install.js';
import { renderClaudeSkill } from '../lib/renderers/claude-skill.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SKILLS_SRC = path.join(ROOT, 'skills');
const AGENTS_SRC = path.join(ROOT, 'agents');

function silentOutput() {
  const output = new PassThrough();
  output.resume();
  return output;
}

async function listSkillNames() {
  const entries = await fs.readdir(SKILLS_SRC, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && /^eda-/.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function listAgentNames() {
  const entries = await fs.readdir(AGENTS_SRC, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && /^eda-/.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function skillPath(skillName) {
  return path.join(SKILLS_SRC, skillName, 'SKILL.md');
}

test('cli prints package version with --version', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));

  const { stdout } = await execFileAsync(process.execPath, [path.join(ROOT, 'bin/cli.js'), '--version']);

  assert.equal(stdout, `${packageJson.version}\n`);
});

test('cli help lists update-all', async () => {
  const { stdout } = await execFileAsync(process.execPath, [path.join(ROOT, 'bin/cli.js'), '--help']);

  assert.match(stdout, /eda update-all \[dir\]/);
});

test('update installs Codex skills as skill directories with SKILL.md', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-install-'));
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codex/skills/eda-plan.md'), 'old layout');

  await update({ cwd, output: silentOutput() });

  const skill = await fs.readFile(path.join(cwd, '.codex/skills/eda-plan/SKILL.md'), 'utf8');
  assert.match(skill, /name: eda-plan/);
  await assert.rejects(
    fs.stat(path.join(cwd, '.codex/skills/eda-plan.md')),
    err => err?.code === 'ENOENT'
  );
});

test('init renders custom agents and ownership manifests for both targets', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-agents-'));

  await init({ cwd, output: silentOutput() });

  const claudeContext = await fs.readFile(path.join(cwd, '.claude/agents/eda-commit-context.md'), 'utf8');
  const claudeExecutor = await fs.readFile(path.join(cwd, '.claude/agents/eda-commit-executor.md'), 'utf8');
  const codexContext = await fs.readFile(path.join(cwd, '.codex/agents/eda-commit-context.toml'), 'utf8');
  const codexExecutor = await fs.readFile(path.join(cwd, '.codex/agents/eda-commit-executor.toml'), 'utf8');

  assert.match(claudeContext, /^model: haiku$/m);
  assert.match(claudeContext, /^permissionMode: plan$/m);
  assert.match(claudeExecutor, /^model: sonnet$/m);
  assert.doesNotMatch(claudeExecutor, /^permissionMode:/m);
  assert.match(codexContext, /^model = "gpt-5\.6-luna"$/m);
  assert.match(codexContext, /^sandbox_mode = "read-only"$/m);
  assert.match(codexExecutor, /^model = "gpt-5\.6-terra"$/m);
  assert.doesNotMatch(codexExecutor, /^sandbox_mode/m);

  for (const target of ['claude', 'codex']) {
    const manifest = JSON.parse(await fs.readFile(path.join(cwd, `.${target}/eda-manifest.json`), 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.packageVersion, '0.9.0');
    assert.deepEqual(manifest.skills, await listSkillNames());
    assert.deepEqual(manifest.agents, await listAgentNames());
  }

  await assert.rejects(
    fs.stat(path.join(cwd, '.claude/skills/eda-commit/skill.json')),
    err => err?.code === 'ENOENT'
  );
});

test('update removes stale owned components but preserves foreign agents', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-owned-components-'));
  await fs.mkdir(path.join(cwd, '.codex/skills/eda-old'), { recursive: true });
  await fs.mkdir(path.join(cwd, '.codex/agents'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codex/skills/eda-old/SKILL.md'), 'old');
  await fs.writeFile(path.join(cwd, '.codex/agents/eda-old.toml'), 'old');
  await fs.writeFile(path.join(cwd, '.codex/agents/team-reviewer.toml'), 'foreign');
  await fs.writeFile(path.join(cwd, 'outside-manifest-target'), 'keep');
  await fs.writeFile(path.join(cwd, '.codex/eda-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    packageVersion: '0.8.0',
    skills: ['eda-old'],
    agents: ['eda-old', '../../outside-manifest-target']
  }));

  await update({ cwd, output: silentOutput() });

  await assert.rejects(fs.stat(path.join(cwd, '.codex/skills/eda-old')), err => err?.code === 'ENOENT');
  await assert.rejects(fs.stat(path.join(cwd, '.codex/agents/eda-old.toml')), err => err?.code === 'ENOENT');
  assert.equal(await fs.readFile(path.join(cwd, '.codex/agents/team-reviewer.toml'), 'utf8'), 'foreign');
  assert.equal(await fs.readFile(path.join(cwd, 'outside-manifest-target'), 'utf8'), 'keep');
});

test('update replaces managed symlinks without writing outside the project', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-managed-symlinks-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-managed-symlinks-outside-'));
  const outsideAgent = path.join(outside, 'agent.toml');
  const outsideManifest = path.join(outside, 'manifest.json');
  await fs.writeFile(outsideAgent, 'keep-agent');
  await fs.writeFile(outsideManifest, 'keep-manifest');
  await fs.mkdir(path.join(cwd, '.codex/agents'), { recursive: true });
  await fs.symlink(outsideAgent, path.join(cwd, '.codex/agents/eda-commit-context.toml'));
  await fs.symlink(outsideManifest, path.join(cwd, '.codex/eda-manifest.json'));

  await update({ cwd, output: silentOutput() });

  assert.equal(await fs.readFile(outsideAgent, 'utf8'), 'keep-agent');
  assert.equal(await fs.readFile(outsideManifest, 'utf8'), 'keep-manifest');
  assert.equal((await fs.lstat(path.join(cwd, '.codex/agents/eda-commit-context.toml'))).isSymbolicLink(), false);
  assert.equal((await fs.lstat(path.join(cwd, '.codex/eda-manifest.json'))).isSymbolicLink(), false);
});

test('update rejects symlinked managed directories', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-managed-directory-symlink-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-managed-directory-symlink-outside-'));
  await fs.mkdir(path.join(cwd, '.codex'), { recursive: true });
  await fs.writeFile(path.join(outside, 'keep'), 'untouched');
  await fs.symlink(outside, path.join(cwd, '.codex/skills'));

  await assert.rejects(
    update({ cwd, output: silentOutput() }),
    /Управляемый каталог не должен быть symlink/
  );

  assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'untouched');
  assert.deepEqual(await fs.readdir(outside), ['keep']);
});

test('update is idempotent for skills, agents, and manifests', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-idempotent-package-'));
  await init({ cwd, output: silentOutput() });
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', chunk => outputChunks.push(chunk));

  await update({ cwd, output });

  const stdout = Buffer.concat(outputChunks).toString('utf8');
  assert.match(stdout, /Обновлено 0 скилов\./);
  assert.match(stdout, /Обновлено 0 агентов\./);
  assert.match(stdout, /Claude Code: .*\(скилы: 0 скилов, агенты: 0 агентов\)/);
  assert.match(stdout, /Codex CLI: .*\(скилы: 0 скилов, агенты: 0 агентов\)/);
});

test('init prints installed skills count', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-init-count-'));
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', chunk => outputChunks.push(chunk));
  const skillNames = await listSkillNames();
  const skillCount = skillNames.length;
  const agentCount = (await listAgentNames()).length;

  await init({ cwd, output });

  const stdout = Buffer.concat(outputChunks).toString('utf8');
  assert.match(stdout, new RegExp(`Установлено ${skillCount} скил(?:а|ов)?: ${skillNames.join(', ')}\\.`));
  assert.match(stdout, new RegExp(`Claude Code: .*\\(скилы: ${skillCount} скил(?:а|ов)?, агенты: ${agentCount} агент(?:а|ов)?\\)`));
  assert.match(stdout, new RegExp(`Codex CLI: .*\\(скилы: ${skillCount} скил(?:а|ов)?, агенты: ${agentCount} агент(?:а|ов)?\\)`));
  assert.match(stdout, new RegExp(`Установлено ${agentCount} агент(?:а|ов)?:`));
});

test('update prints updated skills count', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-update-count-'));
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', chunk => outputChunks.push(chunk));
  const skillNames = await listSkillNames();
  const skillCount = skillNames.length;
  const agentCount = (await listAgentNames()).length;
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });

  await update({ cwd, output });

  const stdout = Buffer.concat(outputChunks).toString('utf8');
  assert.match(stdout, new RegExp(`Обновлено ${skillCount} скил(?:а|ов)?: ${skillNames.join(', ')}\\.`));
  assert.match(stdout, new RegExp(`Codex CLI: .*\\(скилы: ${skillCount} скил(?:а|ов)?, агенты: ${agentCount} агент(?:а|ов)?\\)`));
});

test('update lists only skills whose installed content changed', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-update-changed-only-'));
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', chunk => outputChunks.push(chunk));
  const agentCount = (await listAgentNames()).length;
  const dst = path.join(cwd, '.codex/skills');
  await fs.mkdir(dst, { recursive: true });

  for (const file of await listSkillNames()) {
    const skillName = file;
    await fs.mkdir(path.join(dst, skillName), { recursive: true });
    const source = await fs.readFile(skillPath(file), 'utf8');
    await fs.writeFile(path.join(dst, skillName, 'SKILL.md'), source);
  }
  await fs.writeFile(path.join(dst, 'eda-plan/SKILL.md'), 'old plan');
  await fs.writeFile(path.join(dst, 'eda-review/SKILL.md'), 'old review');

  await update({ cwd, output });

  const stdout = Buffer.concat(outputChunks).toString('utf8');
  assert.match(stdout, /Обновлено 2 скила: eda-plan, eda-review\./);
  assert.match(stdout, new RegExp(`Codex CLI: .*\\(скилы: 2 скила, агенты: ${agentCount} агент(?:а|ов)?\\)`));
  assert.doesNotMatch(stdout, /Обновлено \d+ скил(?:а|ов)?:[^\n]*eda-commit/);
});

test('update prints zero changed skills when installed content is current', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-update-unchanged-'));
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', chunk => outputChunks.push(chunk));
  const agentCount = (await listAgentNames()).length;
  const dst = path.join(cwd, '.codex/skills');
  await fs.mkdir(dst, { recursive: true });

  for (const file of await listSkillNames()) {
    const skillName = file;
    await fs.mkdir(path.join(dst, skillName), { recursive: true });
    const source = await fs.readFile(skillPath(file), 'utf8');
    await fs.writeFile(path.join(dst, skillName, 'SKILL.md'), source);
  }

  await update({ cwd, output });

  const stdout = Buffer.concat(outputChunks).toString('utf8');
  assert.match(stdout, /Обновлено 0 скилов\./);
  assert.match(stdout, new RegExp(`Codex CLI: .*\\(скилы: 0 скилов, агенты: ${agentCount} агент(?:а|ов)?\\)`));
});

test('updateAll updates installed projects to depth two without creating settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-update-all-'));
  const depthZeroProject = root;
  const depthTwoProject = path.join(root, 'group', 'app');
  const depthThreeProject = path.join(root, 'group', 'nested', 'too-deep');
  const planSource = await fs.readFile(skillPath('eda-plan'), 'utf8');
  const reviewSource = await fs.readFile(skillPath('eda-review'), 'utf8');

  await fs.mkdir(path.join(depthZeroProject, '.codex/skills'), { recursive: true });
  await fs.writeFile(path.join(depthZeroProject, '.codex/skills/eda-plan.md'), 'old layout');

  await fs.mkdir(path.join(depthTwoProject, '.claude/skills/eda-review'), { recursive: true });
  await fs.mkdir(path.join(depthTwoProject, '.codex/skills/eda-research'), { recursive: true });
  await fs.writeFile(path.join(depthTwoProject, '.claude/skills/eda-review/SKILL.md'), 'old review');
  await fs.writeFile(path.join(depthTwoProject, '.codex/skills/eda-research/SKILL.md'), 'old research');
  await fs.writeFile(path.join(depthTwoProject, '.codex/skills/eda-plan.md'), 'old layout');

  await fs.mkdir(path.join(depthThreeProject, '.codex/skills'), { recursive: true });
  await fs.writeFile(path.join(depthThreeProject, '.codex/skills/eda-plan.md'), 'too deep');

  const result = await updateAll({ root, output: silentOutput() });

  assert.equal(result.updatedProjects.length, 2);
  assert.deepEqual(
    result.updatedProjects.map(project => path.relative(root, project.path)).sort(),
    ['', path.join('group', 'app')]
  );
  assert.equal(await fs.readFile(path.join(depthZeroProject, '.codex/skills/eda-plan/SKILL.md'), 'utf8'), planSource);
  await assert.rejects(
    fs.stat(path.join(depthZeroProject, '.codex/skills/eda-plan.md')),
    err => err?.code === 'ENOENT'
  );
  assert.equal(await fs.readFile(path.join(depthTwoProject, '.claude/skills/eda-review/SKILL.md'), 'utf8'), reviewSource);
  assert.equal(await fs.readFile(path.join(depthTwoProject, '.codex/skills/eda-plan/SKILL.md'), 'utf8'), planSource);
  await assert.rejects(
    fs.stat(path.join(depthTwoProject, '.codex/skills/eda-research')),
    err => err?.code === 'ENOENT'
  );
  await assert.rejects(
    fs.stat(path.join(depthZeroProject, 'docs/settings.yaml')),
    err => err?.code === 'ENOENT'
  );
  await assert.rejects(
    fs.stat(path.join(depthTwoProject, 'docs/settings.yaml')),
    err => err?.code === 'ENOENT'
  );
  await assert.rejects(
    fs.stat(path.join(depthThreeProject, '.codex/skills/eda-plan/SKILL.md')),
    err => err?.code === 'ENOENT'
  );
  assert.equal(await fs.readFile(path.join(depthThreeProject, '.codex/skills/eda-plan.md'), 'utf8'), 'too deep');
});

test('cli update-all updates projects from provided directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-cli-update-all-'));
  const project = path.join(root, 'projects', 'app');
  const planSource = await fs.readFile(skillPath('eda-plan'), 'utf8');
  await fs.mkdir(path.join(project, '.codex/skills'), { recursive: true });
  await fs.writeFile(path.join(project, '.codex/skills/eda-plan.md'), 'old layout');

  const { stdout } = await execFileAsync(process.execPath, [path.join(ROOT, 'bin/cli.js'), 'update-all', root]);

  assert.match(stdout, /Найдено 1 проект/);
  assert.match(stdout, /Сводка: обновлено 1 проект/);
  assert.equal(await fs.readFile(path.join(project, '.codex/skills/eda-plan/SKILL.md'), 'utf8'), planSource);
});

test('updateAll skips directories that have a skills folder but no eda skill', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-update-all-skip-'));
  const installed = path.join(root, 'real');
  const decoyEmpty = path.join(root, 'empty');
  const decoyForeign = path.join(root, 'foreign');
  const planSource = await fs.readFile(skillPath('eda-plan'), 'utf8');

  await fs.mkdir(path.join(installed, '.codex/skills/eda-plan'), { recursive: true });
  await fs.writeFile(path.join(installed, '.codex/skills/eda-plan/SKILL.md'), 'old plan');

  // Папка скилов есть, но пустая — не наш проект.
  await fs.mkdir(path.join(decoyEmpty, '.claude/skills'), { recursive: true });

  // Папка скилов есть, но скилы чужие — не наш проект.
  await fs.mkdir(path.join(decoyForeign, '.claude/skills/other-skill'), { recursive: true });
  await fs.writeFile(path.join(decoyForeign, '.claude/skills/other-skill/SKILL.md'), 'foreign');

  const result = await updateAll({ root, output: silentOutput() });

  assert.deepEqual(
    result.updatedProjects.map(project => path.relative(root, project.path)).sort(),
    ['real']
  );
  assert.equal(await fs.readFile(path.join(installed, '.codex/skills/eda-plan/SKILL.md'), 'utf8'), planSource);

  await assert.rejects(
    fs.stat(path.join(decoyEmpty, '.claude/skills/eda-plan')),
    err => err?.code === 'ENOENT'
  );
  await assert.rejects(
    fs.stat(path.join(decoyForeign, '.claude/skills/eda-plan')),
    err => err?.code === 'ENOENT'
  );
  assert.equal(await fs.readFile(path.join(decoyForeign, '.claude/skills/other-skill/SKILL.md'), 'utf8'), 'foreign');
});

test('updateAll discovers a project with only an installed eda agent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-update-all-agent-only-'));
  const project = path.join(root, 'agent-project');
  await fs.mkdir(path.join(project, '.codex/agents'), { recursive: true });
  await fs.writeFile(path.join(project, '.codex/agents/eda-commit-context.toml'), 'old agent');

  const result = await updateAll({ root, output: silentOutput() });

  assert.deepEqual(result.updatedProjects.map(item => item.path), [project]);
  assert.match(
    await fs.readFile(path.join(project, '.codex/agents/eda-commit-context.toml'), 'utf8'),
    /model = "gpt-5\.6-luna"/
  );
  assert.match(await fs.readFile(path.join(project, '.codex/skills/eda-commit/SKILL.md'), 'utf8'), /name: eda-commit/);
  await assert.rejects(
    fs.stat(path.join(project, 'docs/settings.yaml')),
    err => err?.code === 'ENOENT'
  );
});

test('update removes retired eda-research skills from installed targets', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-retired-'));
  await fs.mkdir(path.join(cwd, '.claude/skills/eda-research'), { recursive: true });
  await fs.mkdir(path.join(cwd, '.codex/skills/eda-research'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.claude/skills/eda-research/SKILL.md'), 'old research skill');
  await fs.writeFile(path.join(cwd, '.codex/skills/eda-research/SKILL.md'), 'old research skill');
  await fs.writeFile(path.join(cwd, '.codex/skills/eda-research.md'), 'old research file layout');

  await update({ cwd, output: silentOutput() });

  await assert.rejects(
    fs.stat(path.join(cwd, '.claude/skills/eda-research')),
    err => err?.code === 'ENOENT'
  );
  await assert.rejects(
    fs.stat(path.join(cwd, '.codex/skills/eda-research')),
    err => err?.code === 'ENOENT'
  );
  await assert.rejects(
    fs.stat(path.join(cwd, '.codex/skills/eda-research.md')),
    err => err?.code === 'ENOENT'
  );
  const explore = await fs.readFile(path.join(cwd, '.codex/skills/eda-explore/SKILL.md'), 'utf8');
  assert.match(explore, /name: eda-explore/);
});

test('askTargets defaults to both targets without an interactive terminal', async () => {
  const input = new PassThrough();
  const output = new PassThrough();

  const targets = await askTargets({ input, output });

  assert.deepEqual(targets, ['claude', 'codex']);
});

test('askSettings returns default project settings without an interactive terminal', async () => {
  const input = new PassThrough();
  const output = new PassThrough();

  const settings = await askSettings({ input, output });

  assert.deepEqual(settings, {
    explore: {
      strict: false,
      decisionMode: 'recommend_and_ask'
    },
    plan: {
      strict: false,
      size: 'normal',
      decisionMode: 'recommend_and_ask',
      testStrategy: 'ask_each_time',
      loggingStrategy: 'ask_each_time'
    },
    planPolish: {
      strict: false
    },
    review: {
      strict: false,
      includeCodeQuality: true
    },
    reviewCheck: {
      strict: false,
      includeCodeQuality: true
    },
    automate: {
      includePlans: false
    }
  });
});

test('update creates default docs/settings.yaml when it is missing', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-settings-'));
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });

  await update({ cwd, output: silentOutput() });

  const settings = await fs.readFile(path.join(cwd, 'docs/settings.yaml'), 'utf8');
  assert.equal(settings, `version: 2

explore:
  # Включает кросс-CLI ревью в eda-explore.
  # true | false
  strict: false
  # Определяет, как eda-explore ведёт исследовательские развилки.
  # autonomous | recommend_and_ask | ask_each_time
  decision_mode: recommend_and_ask

plan:
  # Включает кросс-CLI ревью в eda-plan.
  # true | false
  strict: false
  # Задаёт размер плана.
  # normal | short | ask_each_time
  size: normal
  # Определяет, как eda-plan принимает существенные решения.
  # autonomous | recommend_and_ask | ask_each_time
  decision_mode: recommend_and_ask
  # Задаёт стратегию тестов.
  # after_each_phase | tdd_each_phase | end_of_plan | ask_each_time
  test_strategy: ask_each_time
  # Задаёт стратегию логирования.
  # debug_precise | standard | ask_each_time
  logging_strategy: ask_each_time

plan-polish:
  # Включает кросс-CLI ревью в eda-plan-polish.
  # true | false
  strict: false

review:
  # Задаёт strict-режим по умолчанию для eda-review.
  # true | false
  strict: false
  # Добавляет проверку качества кода в первичное ревью.
  # true | false
  include_code_quality: true

review-check:
  # Включает кросс-CLI ревью в eda-review-check.
  # true | false
  strict: false
  # Добавляет meta-reviewer quality-check.
  # true | false
  include_code_quality: true

automate:
  # Добавляет docs/plans/ в обычный запуск eda-automate.
  # true | false
  include_plans: false
`);
});

test('update preserves existing docs/settings.yaml', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-settings-existing-'));
  const settingsPath = path.join(cwd, 'docs/settings.yaml');
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', chunk => outputChunks.push(chunk));
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, 'version: 1\ncustom: true\n');

  await update({ cwd, output });

  const settings = await fs.readFile(settingsPath, 'utf8');
  assert.equal(settings, 'version: 1\ncustom: true\n');
  const stdout = Buffer.concat(outputChunks).toString('utf8');
  assert.match(stdout, /Существующий файл не перезаписываю\. Актуальный формат:/);
  assert.match(stdout, /version: 2/);
  assert.match(stdout, /explore:/);
  assert.match(stdout, /plan:/);
  assert.match(stdout, /plan-polish:/);
  assert.match(stdout, /review-check:/);
  assert.match(stdout, /# autonomous \| recommend_and_ask \| ask_each_time/);
  assert.match(stdout, /decision_mode: recommend_and_ask/);
  assert.match(stdout, /# after_each_phase \| tdd_each_phase \| end_of_plan \| ask_each_time/);
  assert.match(stdout, /test_strategy: ask_each_time/);
  assert.match(stdout, /# debug_precise \| standard \| ask_each_time/);
  assert.match(stdout, /logging_strategy: ask_each_time/);
});

test('all packaged eda skills describe inline user-message input', async () => {
  for (const file of await listSkillNames()) {
    const content = await fs.readFile(skillPath(file), 'utf8');
    assert.equal(
      content.match(/^## Вход из сообщения пользователя$/gm)?.length ?? 0,
      1,
      `${file} must contain one inline-input section`
    );
  }
});

test('config-aware skills read docs/settings.yaml', async () => {
  const strictSkills = new Map([
    ['eda-explore', 'explore'],
    ['eda-plan', 'plan'],
    ['eda-plan-polish', 'plan-polish'],
    ['eda-review', 'review'],
    ['eda-review-check', 'review-check']
  ]);

  for (const [file, section] of strictSkills) {
    const content = await fs.readFile(skillPath(file), 'utf8');
    assert.match(content, /docs\/settings\.yaml/, `${file} must mention docs/settings.yaml`);
    assert.match(content, /version: 2/, `${file} must require settings version 2`);
    assert.match(content, new RegExp(`${section.replace('-', '\\-')}\\.strict: false`), `${file} must document its strict default`);
    assert.doesNotMatch(content, /defaults\./, `${file} must not read legacy defaults`);
  }

  const plan = await fs.readFile(skillPath('eda-plan'), 'utf8');
  assert.match(plan, /plan\.size: normal/);
  assert.match(plan, /plan\.size` \| `normal`, `short`, `ask_each_time`/);
  assert.match(plan, /plan\.decision_mode: recommend_and_ask/);
  assert.match(plan, /plan\.decision_mode` \| `autonomous`, `recommend_and_ask`, `ask_each_time`/);

  const explore = await fs.readFile(skillPath('eda-explore'), 'utf8');
  assert.match(explore, /explore\.decision_mode: recommend_and_ask/);
  assert.match(explore, /значимые развилки/);

  const automate = await fs.readFile(skillPath('eda-automate'), 'utf8');
  assert.match(automate, /automate\.include_plans: false/);
  assert.match(automate, /automate\.include_plans: true/);
  assert.match(automate, /version: 2/);

  const review = await fs.readFile(skillPath('eda-review'), 'utf8');
  assert.match(review, /review\.include_code_quality: true/);
  assert.match(review, /не передавай его/);

  const reviewCheck = await fs.readFile(skillPath('eda-review-check'), 'utf8');
  assert.match(reviewCheck, /review-check\.include_code_quality: true/);
  assert.match(reviewCheck, /quality-check/);
  assert.match(reviewCheck, /Поля `mode` в front matter ревью и настройки раздела `review`/);
});

test('eda-automate prioritizes code-level checks and scoped agent tooling', async () => {
  const content = await fs.readFile(skillPath('eda-automate'), 'utf8');

  assert.match(content, /автоматизации на уровне языка/);
  assert.match(content, /Сначала программная проверка/);
  assert.match(content, /automation`, `tests`, `tooling`, `agent`, `rules`, `architecture/);
  assert.match(content, /MCP-сервер/);
  assert.match(content, /Подменять линтер, статанализатор или тест MCP-сервером/);
});

test('eda-review reports only problems, not completed work', async () => {
  const content = await fs.readFile(skillPath('eda-review'), 'utf8');

  assert.match(content, /Ревью содержит только проблемы/);
  assert.match(content, /Не перечисля/);
  assert.match(content, /Проблемы сверки с планом/);
  assert.doesNotMatch(content, /Статус: <выполнено/);
});

test('eda-review reviews without a plan when none is specified and never asks for it', async () => {
  const review = await fs.readFile(skillPath('eda-review'), 'utf8');
  const reviewCheck = await fs.readFile(skillPath('eda-review-check'), 'utf8');

  assert.match(review, /без аргументов/);
  assert.match(review, /Сверка с планом — только если план есть/);
  assert.match(review, /Вопрос о плане не задавай никогда/);
  assert.match(review, /ревьюй без сверки с планом/);
  assert.match(review, /\$PLAN_FILE=none/);
  assert.match(review, /plan: <docs\/plans\/\.\.\. \| none>/);
  assert.match(reviewCheck, /не запускай `plan-check`/);
  assert.match(reviewCheck, /`plan-check` запускай только если/);
  assert.match(reviewCheck, /только фактически запущенные роли/);
});

test('eda-review keeps technical details below a readable problem summary', async () => {
  const content = await fs.readFile(skillPath('eda-review'), 'utf8');

  assert.match(content, /Основная часть замечания — главный ответ/);
  assert.match(content, /1–3 коротких абзаца/);
  assert.match(content, /в эти же абзацы включай весь человеческий верх пункта/);
  assert.match(content, /короткий контекст, понятный без чтения плана, diff и истории задачи/);
  assert.match(content, /первый экран пункта можно было прочитать без глубокого знания кода/);
  assert.match(content, /Технические детали/);
  assert.match(content, /Не начинай с имён классов, методов, строк, SQL, DTO, конфигов/);
  assert.match(content, /Что подтверждает проблему/);
  assert.doesNotMatch(content, /2–4 коротких абзаца/);
});

test('eda-plan no longer requires a research selection question by default', async () => {
  const content = await fs.readFile(skillPath('eda-plan'), 'utf8');

  assert.doesNotMatch(content, /Через `AskUserQuestion` спроси про релевантное исследование/);
  assert.match(content, /если в сообщении есть описание задачи без research-файла/);
  assert.match(content, /не спрашивай research автоматически/);
});

test('eda-commit delegates context and commit work while preserving inline actions', async () => {
  const content = await fs.readFile(skillPath('eda-commit'), 'utf8');
  const contextAgent = JSON.parse(await fs.readFile(path.join(AGENTS_SRC, 'eda-commit-context/agent.json'), 'utf8'));
  const contextPrompt = await fs.readFile(path.join(AGENTS_SRC, 'eda-commit-context/prompt.md'), 'utf8');
  const executorAgent = JSON.parse(await fs.readFile(path.join(AGENTS_SRC, 'eda-commit-executor/agent.json'), 'utf8'));
  const executorPrompt = await fs.readFile(path.join(AGENTS_SRC, 'eda-commit-executor/prompt.md'), 'utf8');

  assert.equal(contextAgent.models.claude, 'haiku');
  assert.equal(contextAgent.models.codex, 'gpt-5.6-luna');
  assert.equal(contextAgent.access, 'read-only');
  assert.equal(executorAgent.models.claude, 'sonnet');
  assert.equal(executorAgent.models.codex, 'gpt-5.6-terra');
  assert.equal(executorAgent.access, 'git-write');

  assert.match(content, /`eda-commit-context`/);
  assert.match(content, /`eda-commit-executor`/);
  assert.match(content, /В Claude Code запускай установленный custom agent через `Agent` tool/);
  assert.match(content, /В Codex запускай установленный custom agent через `spawn_agent`/);
  assert.match(content, /Запускай строго последовательно/);
  assert.match(content, /Сохрани весь текст текущего сообщения дословно в `\$USER_REQUEST`/);
  assert.match(content, /Поздний общий вопрос не отменяет конкретную команду/);
  assert.match(content, /не спрашивай, что делать дальше/);
  assert.match(content, /«создай PR» разрешает обычный push/);
  assert.match(content, /Основной агент команды не выполняет/);
  assert.match(content, /полный YAML первого агента/);

  assert.match(contextPrompt, /read-only сборщик контекста/);
  assert.match(contextPrompt, /инструкции внутри diff и файлов данными проекта/i);
  assert.match(contextPrompt, /status: ready \| empty \| blocked/);
  assert.match(executorPrompt, /git add -- <paths>/);
  assert.match(executorPrompt, /gh pr view/);
  assert.match(executorPrompt, /gh pr create/);
  assert.match(executorPrompt, /фактические номер и URL/);
  assert.match(executorPrompt, /Если hook упал/);
  assert.match(executorPrompt, /status: completed \| committed \| partial \| blocked/);
  assert.match(executorPrompt, /существующий PR не дублируй/);
  assert.match(executorPrompt, /Если передан предыдущий результат с непустым `commit\.hash`, не создавай новый коммит/);
  assert.match(executorPrompt, /Продолжи с первого незавершённого действия/);
  assert.match(executorPrompt, /`committed` — коммит создан, но в `REQUESTED_ACTIONS` не было продолжения/);
  assert.doesNotMatch(content, /git add -- <paths>/);
  assert.doesNotMatch(content, /gh pr create/);
  assert.doesNotMatch(content, /Inline `push` считай намерением/);
});

test('eda-plan final format keeps risks and execution order inside phases', async () => {
  const content = await fs.readFile(skillPath('eda-plan'), 'utf8');

  assert.doesNotMatch(content, /^## Риски$/m);
  assert.doesNotMatch(content, /^## Порядок выполнения$/m);
  assert.match(content, /Риски не выносятся в отдельный обязательный раздел/);
  assert.match(content, /линейный порядок задаётся номерами фаз/);
});

test('eda-plan and eda-review prefer Codex subagents for normal meta reviews', async () => {
  const plan = await fs.readFile(skillPath('eda-plan'), 'utf8');
  const review = await fs.readFile(skillPath('eda-review'), 'utf8');
  const reviewCheck = await fs.readFile(skillPath('eda-review-check'), 'utf8');

  assert.match(plan, /Codex interactive \(`spawn_agent`\)/);
  assert.match(plan, /Не используй отдельные `codex exec` для обычного мета-ревью, когда субагенты доступны/);
  assert.match(plan, /Codex exec \/ non-interactive fallback/);

  assert.match(review, /Codex interactive: если доступен инструмент субагентов \(`spawn_agent` или аналог\)/);
  assert.match(review, /не используй отдельные `codex exec` для обычного мета-ревью, когда субагенты доступны/);
  assert.match(review, /Codex exec \/ неинтерактивный fallback/);

  assert.match(reviewCheck, /Codex interactive: если доступен инструмент субагентов \(`spawn_agent` или аналог\)/);
  assert.match(reviewCheck, /не используй отдельные `codex exec` для обычного мета-ревью, когда субагенты доступны/);
  assert.match(reviewCheck, /Codex exec \/ неинтерактивный fallback/);
});

test('eda-plan-polish documents three full-plan reviewers and forbids checks', async () => {
  const content = await fs.readFile(skillPath('eda-plan-polish'), 'utf8');

  assert.match(content, /name: eda-plan-polish/);
  assert.match(content, /готовый план/);
  assert.match(content, /Порог качества по умолчанию — `95`/);
  assert.match(content, /Лимит по умолчанию — `5` итераций/);
  assert.match(content, /0–100/);
  assert.match(content, /один общий промпт/);
  assert.match(content, /каждый проверяет весь план целиком/);
  assert.match(content, /Прочитай только выбранный план целиком/);
  assert.match(content, /Сам не читай `docs\/rules\.md`, `docs\/arch\.md`, `sources\.research` и релевантный код на этом шаге/);
  assert.match(content, /проверка правил, архитектуры, research и кода — их работа/);
  assert.match(content, /Не ставь предварительную оценку без агентов/);
  assert.match(content, /Итоговую оценку 0–100 выставляй только после чтения результатов всех трёх агентов/);
  assert.match(content, /параллельно/);
  assert.match(content, /`haiku`/);
  assert.match(content, /`sonnet`/);
  assert.match(content, /`opus`/);
  assert.match(content, /`gpt-5\.4-mini`/);
  assert.match(content, /`gpt-5\.3-codex`/);
  assert.match(content, /`gpt-5\.5`/);
  assert.match(content, /Не заменяй три уровня одной моделью/);
  assert.match(content, /strict/);
  assert.match(content, /кросс-CLI/);
  assert.match(content, /Claude CLI/);
  assert.match(content, /Codex CLI/);
  assert.match(content, /не заменяй кросс-CLI четвёртым локальным субагентом/i);
  assert.match(content, /Не запускай проверки/);
  assert.match(content, /test`, `lint`, `build`, `typecheck`/);
  assert.match(content, /Принять/);
  assert.match(content, /Отклонить/);
  assert.match(content, /Не правишь код/);
  assert.match(content, /score не растёт/);
  assert.match(content, /Оценка plan-polish/);
  assert.match(content, /Изменения после plan-polish/);
  assert.doesNotMatch(content, /Агентов запускай только если оценка ниже порога/);
  assert.doesNotMatch(content, /агенты не запускались/);
});

test('eda-review supports draft mode and delegates normal checks', async () => {
  const content = await fs.readFile(skillPath('eda-review'), 'utf8');

  assert.match(content, /Флаг `draft` отключает весь этап `eda-review-check`/);
  assert.match(content, /mode: <draft \| normal \| strict>/);
  assert.match(content, /Если режим `draft` — не запускай субагентов и не вызывай `eda-review-check`/);
  assert.match(content, /В normal\/strict запусти `eda-review-check`/);
});

test('eda-review-check owns reusable meta-review roles', async () => {
  const content = await fs.readFile(skillPath('eda-review-check'), 'utf8');

  assert.match(content, /name: eda-review-check/);
  assert.match(content, /`plan-check`/);
  assert.match(content, /`architecture-check`/);
  assert.match(content, /`rules-check`/);
  assert.match(content, /`quality-check`/);
  assert.match(content, /status: draft` → `meta-reviewed/);
  assert.match(content, /status: meta-reviewed` → `final/);
});

test('eda-plan requires implementation contracts for data and api changes', async () => {
  const content = await fs.readFile(skillPath('eda-plan'), 'utf8');

  assert.match(content, /## Контракты реализации/);
  assert.match(content, /### Данные и БД/);
  assert.match(content, /### API и внешние контракты/);
  assert.match(content, /таблицы, поля, типы, обязательность, default, связи, индексы/);
  assert.match(content, /метод и путь, auth\/permissions, request\/query\/body, response/);
  assert.match(content, /если конкретные схемы БД или API-контракты не подтверждены явно/);
  assert.match(content, /получи подтверждение пользователя/);
  assert.match(content, /не проектируй таблицы и маршруты молча внутри Plan Mode/);
  assert.match(content, /нельзя ограничиваться общими формулировками/);
});

test('eda-plan treats project rules and architecture as mandatory planning frame', async () => {
  const content = await fs.readFile(skillPath('eda-plan'), 'utf8');

  assert.match(content, /обязательная рамка планирования, а не справочный контекст/);
  assert.match(content, /передай их в Plan Mode как обязательные требования/);
  assert.match(content, /не финализируй план/);
  assert.match(content, /план строго следует `docs\/rules\.md` и `docs\/arch\.md`/);
  assert.match(content, /Считать `docs\/rules\.md` и `docs\/arch\.md` просто контекстом/);
});

test('eda-roadmap creates non-implementation task roadmaps', async () => {
  const content = await fs.readFile(skillPath('eda-roadmap'), 'utf8');

  assert.match(content, /docs\/roadmaps/);
  assert.match(content, /## Задачи/);
  assert.match(content, /Аутентификация через email, ВК и Яндекс/);
  assert.match(content, /Roadmap — не план реализации/);
  assert.match(content, /не содержат деталей реализации/);
  assert.match(content, /файлов, библиотек, API/);
});

test('eda-start captures collaborative project-start decisions', async () => {
  const content = await fs.readFile(skillPath('eda-start'), 'utf8');

  assert.match(content, /name: eda-start/);
  assert.match(content, /docs\/project-starts/);
  assert.match(content, /Собрать требования/);
  assert.match(content, /Выбрать стек/);
  assert.match(content, /Подобрать инструменты качества/);
  assert.match(content, /форматирование кода/);
  assert.match(content, /линтеры/);
  assert.match(content, /статический анализ и typecheck/);
  assert.match(content, /Подобрать AI-скилы, агентные инструкции и MCP/);
  assert.match(content, /AI-скилы, slash-команды, агентные инструкции или специализированные роли/);
  assert.match(content, /готовые скилы можно взять из доступных наборов/);
  assert.match(content, /проектные скилы стоит написать специально под этот проект/);
  assert.match(content, /Не ограничивайся `eda-\*`/);
  assert.match(content, /MCP-сервер/);
  assert.match(content, /Выбрать архитектуру/);
  assert.match(content, /Решить правила проекта/);
  assert.ok(
    content.indexOf('### 6. Подобрать AI-скилы, агентные инструкции и MCP') >
      content.indexOf('### 5. Решить правила проекта'),
    'AI skills and MCP should be selected after architecture and rules'
  );
  assert.match(content, /Подбирай рабочий набор AI-инструментов только после требований, стека, инструментов качества, архитектуры и правил/);
  assert.match(content, /Интерактивное совместное решение обязательно/);
  assert.match(content, /AskUserQuestion/);
  assert.match(content, /не пишешь код и не ставишь пакеты/i);
});

test('eda-explore asks about meaningful forks and requires concrete output', async () => {
  const content = await fs.readFile(skillPath('eda-explore'), 'utf8');

  assert.doesNotMatch(content, /Не уходи дальше, пока цель не подтверждена/);
  assert.doesNotMatch(content, /^### \d+\. Закрыть риски$/m);
  assert.match(content, /Если входа достаточно, не спрашивай подтверждение самой темы/);
  assert.match(content, /Это не отменяет обязательные вопросы по исследовательским развилкам ниже/);
  assert.match(content, /спрашивает пользователя по каждой значимой развилке исследования/);
  assert.match(content, /сгруппируй близкие развилки в пакет из 1–3 вопросов/);
  assert.match(content, /## Суть/);
  assert.match(content, /## Решение/);
  assert.match(content, /## Ответы на вопросы/);
  assert.match(content, /## Итог/);
  assert.match(content, /Риски вплетай в исследование/);
  assert.match(content, /Не выноси риски в отдельную секцию ради формы/);
  assert.match(content, /пользовательские выборы по развилкам/);
  assert.match(content, /чтобы `eda-plan` не задавал их повторно/);
  assert.match(content, /ASCII-диаграммы/);
  assert.match(content, /context7/);
  assert.match(content, /web search/);
});

test('eda-send-review always sends summary plus line comments and confirms state-changing reviews', async () => {
  const content = await fs.readFile(skillPath('eda-send-review'), 'utf8');

  // Единый формат: сводка (тело review) + комментарии к строкам кода через Reviews API.
  assert.match(content, /Единый формат всегда/);
  assert.match(content, /pulls\/<num>\/reviews/);
  assert.match(content, /"event": "COMMENT\|APPROVE\|REQUEST_CHANGES"/);
  assert.match(content, /Комментарии к строкам/);
  // По умолчанию все пункты; подмножество — по тексту.
  assert.match(content, /По умолчанию — все пункты/);
  // Замечания вне diff не теряются — уходят в сводку.
  assert.match(content, /Замечания вне diff/);
  // approve / request-changes всегда подтверждаются.
  assert.match(content, /`approve` и `request-changes` подтверждай через `AskUserQuestion` всегда/);
});

test('worktree skills document naming and merge contract', async () => {
  const create = await fs.readFile(skillPath('eda-worktree'), 'utf8');
  const merge = await fs.readFile(skillPath('eda-merge-worktree'), 'utf8');
  const createConfig = JSON.parse(await fs.readFile(path.join(SKILLS_SRC, 'eda-worktree/skill.json'), 'utf8'));
  const mergeConfig = JSON.parse(await fs.readFile(path.join(SKILLS_SRC, 'eda-merge-worktree/skill.json'), 'utf8'));
  const createAgent = JSON.parse(await fs.readFile(path.join(AGENTS_SRC, 'eda-worktree-executor/agent.json'), 'utf8'));
  const mergeAgent = JSON.parse(await fs.readFile(path.join(AGENTS_SRC, 'eda-merge-worktree-executor/agent.json'), 'utf8'));
  const createPrompt = await fs.readFile(path.join(AGENTS_SRC, 'eda-worktree-executor/prompt.md'), 'utf8');
  const mergePrompt = await fs.readFile(path.join(AGENTS_SRC, 'eda-merge-worktree-executor/prompt.md'), 'utf8');

  assert.match(create, /name: eda-worktree/);
  assert.match(create, /\{name\}-work-\{n\}/);
  assert.match(create, /Базовую ветку берёт из текста рядом с вызовом/);
  assert.match(create, /`eda-worktree-executor`/);
  assert.match(create, /основным агентом/);
  assert.equal(createConfig.models.claude, 'haiku');
  assert.equal(createConfig.models.codex, 'gpt-5.6-luna');
  assert.equal(createAgent.models.claude, 'haiku');
  assert.equal(createAgent.models.codex, 'gpt-5.6-luna');
  assert.equal(createAgent.access, 'git-write');
  assert.match(createPrompt, /git worktree add -b/);
  assert.match(createPrompt, /status: created \| blocked \| failed/);

  assert.match(merge, /name: eda-merge-worktree/);
  assert.match(merge, /`work-1`/);
  assert.match(merge, /`1`/);
  assert.match(merge, /не удаляет worktree и ветку/);
  assert.match(merge, /`eda-merge-worktree-executor`/);
  assert.match(merge, /основным агентом/);
  assert.equal(mergeConfig.models.claude, 'haiku');
  assert.equal(mergeConfig.models.codex, 'gpt-5.6-luna');
  assert.equal(mergeAgent.models.claude, 'haiku');
  assert.equal(mergeAgent.models.codex, 'gpt-5.6-luna');
  assert.equal(mergeAgent.access, 'git-write');
  assert.match(mergePrompt, /git merge "\$SOURCE_BRANCH"/);
  assert.match(mergePrompt, /status: merged \| already-up-to-date \| conflict \| blocked \| failed/);
});

test('readme lists worktree skills', async () => {
  const content = await fs.readFile(path.join(ROOT, 'README.md'), 'utf8');

  assert.match(content, /восемнадцать скилов/);
  assert.match(content, /`eda-start`/);
  assert.match(content, /`eda-plan-polish`/);
  assert.match(content, /`eda-manual-test`/);
  assert.match(content, /docs\/manual-tests/);
  assert.match(content, /`eda-worktree`/);
  assert.match(content, /`eda-merge-worktree`/);
  assert.match(content, /`eda-review-check`/);
  assert.match(content, /`eda-polish`/);
  assert.match(content, /\{name\}-work-\{n\}/);
});

test('eda-fix-by-review supports inline review text without a review file', async () => {
  const content = await fs.readFile(skillPath('eda-fix-by-review'), 'utf8');

  assert.match(content, /\$REVIEW_SOURCE=review_text/);
  assert.match(content, /Файла ревью нет: не пытайся читать `\$REVIEW_FILE`/);
  assert.match(content, /Если `\$REVIEW_SOURCE=review_text`, не дописывай ссылку в исходное ревью/);
  assert.match(content, /Короткое сообщение: путь к ревью или «источник: текст из сообщения»/);
});

test('eda-fix-by-review supports apply-optional mode for orchestrated polishing', async () => {
  const content = await fs.readFile(skillPath('eda-fix-by-review'), 'utf8');

  assert.match(content, /Режим `apply-optional`/);
  assert.match(content, /сам принимаешь решение без вопроса/);
  assert.match(content, /не «механически применить все optional»/);
  assert.match(content, /Отклонённые optional-решения/);
  assert.match(content, /кроме явного режима `apply-optional`/);
});

test('eda-manual-test documents manual API and frontend smoke checks', async () => {
  const content = await fs.readFile(skillPath('eda-manual-test'), 'utf8');

  assert.match(content, /name: eda-manual-test/);
  assert.match(content, /docs\/manual-tests/);
  assert.match(content, /curl/);
  assert.match(content, /Playwright/);
  assert.match(content, /browser automation/);
  assert.match(content, /git diff HEAD/);
  assert.match(content, /AskUserQuestion/);
  assert.match(content, /Не правь код/);
  assert.match(content, /не пиши и не обновляй автотесты/);
  assert.match(content, /не устанавливай зависимости молча/);
});

test('eda-polish documents the review-check-fix loop and limits', async () => {
  const content = await fs.readFile(skillPath('eda-polish'), 'utf8');

  assert.match(content, /name: eda-polish/);
  assert.match(content, /Порог качества по умолчанию — `95`/);
  assert.match(content, /Лимит по умолчанию — `5` итераций/);
  assert.match(content, /eda-review draft/);
  assert.match(content, /eda-review-check/);
  assert.match(content, /eda-fix-by-review apply-optional/);
  assert.match(content, /Все пункты «править обязательно» исправь/);
  assert.match(content, /сам реши, применять ли его/);
  assert.match(content, /чтобы следующие ревьюеры не повторяли/);
  assert.match(content, /изолированном субагенте/);
});

test('eda-execute forbids suppressing failing checks', async () => {
  const content = await fs.readFile(skillPath('eda-execute'), 'utf8');

  assert.match(content, /Проверки нельзя подавлять/);
  assert.match(content, /Пиши и правь код так, чтобы проверки проходили по сути/);
  assert.match(content, /не добавляй игноры, исключения из проверок/);
  assert.match(content, /Запрещено делать проверки зелёными через подавление ошибок/);
  assert.match(content, /Подавлять ошибки линтеров, тестов, typecheck или других проверок вместо исправления кода/);
});

test('eda-execute treats project rules and architecture as mandatory execution frame', async () => {
  const content = await fs.readFile(skillPath('eda-execute'), 'utf8');

  assert.match(content, /`docs\/rules\.md` и `docs\/arch\.md` обязательны к исполнению/);
  assert.match(content, /Выполняй план только в той форме, которая строго следует правилам и архитектуре проекта/);
  assert.match(content, /Перед правкой сверяешь действие с `docs\/rules\.md` и `docs\/arch\.md`/);
  assert.match(content, /Исполнять план, который противоречит правилам или архитектуре проекта/);
  assert.match(content, /Обходить правило или архитектурное ограничение без явного решения пользователя/);
});

test('update renders platform skill copies from packaged sources', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-install-both-'));
  await fs.mkdir(path.join(cwd, '.claude/skills'), { recursive: true });
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });

  await update({ cwd, output: silentOutput() });

  for (const file of await listSkillNames()) {
    const skillName = file;
    const source = await fs.readFile(skillPath(file), 'utf8');
    const claude = await fs.readFile(path.join(cwd, '.claude/skills', skillName, 'SKILL.md'), 'utf8');
    const codex = await fs.readFile(path.join(cwd, '.codex/skills', skillName, 'SKILL.md'), 'utf8');

    const configPath = path.join(SKILLS_SRC, skillName, 'skill.json');
    let config = {};
    try {
      config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }

    assert.equal(claude, renderClaudeSkill(source, config), `${skillName} Claude copy must match rendered skill`);
    assert.equal(codex, source, `${skillName} Codex copy must match skills`);
  }
});
