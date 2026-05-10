import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { askSettings, askTargets, update } from '../lib/install.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SKILLS_SRC = path.join(ROOT, 'skills');

async function listSkillFiles() {
  const entries = await fs.readdir(SKILLS_SRC);
  return entries
    .filter(name => /^eda-.*\.md$/.test(name))
    .sort();
}

test('update installs Codex skills as skill directories with SKILL.md', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-install-'));
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codex/skills/eda-plan.md'), 'old layout');

  await update({ cwd });

  const skill = await fs.readFile(path.join(cwd, '.codex/skills/eda-plan/SKILL.md'), 'utf8');
  assert.match(skill, /name: eda-plan/);
  await assert.rejects(
    fs.stat(path.join(cwd, '.codex/skills/eda-plan.md')),
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

  await update({ cwd });

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
    strict: false,
    planSize: 'normal',
    includePlans: false,
    includeCodeQuality: true
  });
});

test('update creates default docs/settings.yaml when it is missing', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-settings-'));
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });

  await update({ cwd });

  const settings = await fs.readFile(path.join(cwd, 'docs/settings.yaml'), 'utf8');
  assert.equal(settings, `version: 1

defaults:
  strict: false
  plan_size: normal

automate:
  include_plans: false

review:
  include_code_quality: true
`);
});

test('update preserves existing docs/settings.yaml', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-settings-existing-'));
  const settingsPath = path.join(cwd, 'docs/settings.yaml');
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, 'version: 1\ncustom: true\n');

  await update({ cwd });

  const settings = await fs.readFile(settingsPath, 'utf8');
  assert.equal(settings, 'version: 1\ncustom: true\n');
});

test('all packaged eda skills describe inline user-message input', async () => {
  for (const file of await listSkillFiles()) {
    const content = await fs.readFile(path.join(SKILLS_SRC, file), 'utf8');
    assert.equal(
      content.match(/^## Вход из сообщения пользователя$/gm)?.length ?? 0,
      1,
      `${file} must contain one inline-input section`
    );
  }
});

test('config-aware skills read docs/settings.yaml', async () => {
  const strictSkills = ['eda-explore.md', 'eda-plan.md', 'eda-review.md'];

  for (const file of strictSkills) {
    const content = await fs.readFile(path.join(SKILLS_SRC, file), 'utf8');
    assert.match(content, /docs\/settings\.yaml/, `${file} must mention docs/settings.yaml`);
    assert.match(content, /defaults\.strict: false/, `${file} must document strict default`);
  }

  const plan = await fs.readFile(path.join(SKILLS_SRC, 'eda-plan.md'), 'utf8');
  assert.match(plan, /defaults\.plan_size: normal/);
  assert.match(plan, /defaults\.plan_size` \| `normal`, `short`, `ask_each_time`/);

  const automate = await fs.readFile(path.join(SKILLS_SRC, 'eda-automate.md'), 'utf8');
  assert.match(automate, /automate\.include_plans: false/);
  assert.match(automate, /automate\.include_plans: true/);

  const review = await fs.readFile(path.join(SKILLS_SRC, 'eda-review.md'), 'utf8');
  assert.match(review, /review\.include_code_quality: true/);
  assert.match(review, /quality-check/);
});

test('eda-plan no longer requires a research selection question by default', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-plan.md'), 'utf8');

  assert.doesNotMatch(content, /Через `AskUserQuestion` спроси про релевантное исследование/);
  assert.match(content, /если в сообщении есть описание задачи без research-файла/);
  assert.match(content, /не спрашивай research автоматически/);
});

test('eda-explore asks only blocking questions and requires concrete output', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-explore.md'), 'utf8');

  assert.doesNotMatch(content, /Не уходи дальше, пока цель не подтверждена/);
  assert.match(content, /Если входа достаточно, продолжай без подтверждения/);
  assert.match(content, /## Суть/);
  assert.match(content, /## Решение/);
  assert.match(content, /## Ответы на вопросы/);
  assert.match(content, /## Итог/);
  assert.match(content, /чтобы `eda-plan` не задавал их повторно/);
  assert.match(content, /ASCII-диаграммы/);
  assert.match(content, /context7/);
  assert.match(content, /web search/);
});

test('eda-send-review keeps safe comment modes inline but confirms state-changing reviews', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-send-review.md'), 'utf8');

  assert.match(content, /`comment` означает обычный комментарий PR/);
  assert.match(content, /`review-comment` — review без статуса/);
  assert.match(content, /Если тип отправки указан в тексте и это `comment` или `review-comment`, используй его без дополнительного выбора/);
  assert.match(content, /`approve` и `request-changes` всегда подтверждай через `AskUserQuestion`/);
});

test('eda-fix-by-review supports inline review text without a review file', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-fix-by-review.md'), 'utf8');

  assert.match(content, /\$REVIEW_SOURCE=review_text/);
  assert.match(content, /Файла ревью нет: не пытайся читать `\$REVIEW_FILE`/);
  assert.match(content, /Если `\$REVIEW_SOURCE=review_text`, не дописывай ссылку в исходное ревью/);
  assert.match(content, /Короткое сообщение: путь к ревью или «источник: текст из сообщения»/);
});

test('eda-execute forbids suppressing failing checks', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-execute.md'), 'utf8');

  assert.match(content, /Проверки нельзя подавлять/);
  assert.match(content, /Пиши и правь код так, чтобы проверки проходили по сути/);
  assert.match(content, /не добавляй игноры, исключения из проверок/);
  assert.match(content, /Запрещено делать проверки зелёными через подавление ошибок/);
  assert.match(content, /Подавлять ошибки линтеров, тестов, typecheck или других проверок вместо исправления кода/);
});

test('update installs Claude and Codex copies identical to packaged skills', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-install-both-'));
  await fs.mkdir(path.join(cwd, '.claude/skills'), { recursive: true });
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });

  await update({ cwd });

  for (const file of await listSkillFiles()) {
    const skillName = file.replace(/\.md$/, '');
    const source = await fs.readFile(path.join(SKILLS_SRC, file), 'utf8');
    const claude = await fs.readFile(path.join(cwd, '.claude/skills', skillName, 'SKILL.md'), 'utf8');
    const codex = await fs.readFile(path.join(cwd, '.codex/skills', skillName, 'SKILL.md'), 'utf8');

    assert.equal(claude, source, `${skillName} Claude copy must match skills`);
    assert.equal(codex, source, `${skillName} Codex copy must match skills`);
  }
});
