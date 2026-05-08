import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { askTargets, update } from '../lib/install.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SKILLS_SRC = path.join(ROOT, 'docs/skills');

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

test('askTargets defaults to both targets without an interactive terminal', async () => {
  const input = new PassThrough();
  const output = new PassThrough();

  const targets = await askTargets({ input, output });

  assert.deepEqual(targets, ['claude', 'codex']);
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

test('eda-plan no longer requires a research selection question by default', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-plan.md'), 'utf8');

  assert.doesNotMatch(content, /Через `AskUserQuestion` спроси про релевантное исследование/);
  assert.match(content, /если в сообщении есть описание задачи без research-файла/);
  assert.match(content, /не спрашивай research автоматически/);
});

test('eda-research does not require confirmation when the topic is clear', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-research.md'), 'utf8');

  assert.doesNotMatch(content, /Не уходи дальше, пока цель не подтверждена/);
  assert.match(content, /Если тема и цель понятны/);
  assert.match(content, /продолжай без отдельного подтверждения/);
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

    assert.equal(claude, source, `${skillName} Claude copy must match docs/skills`);
    assert.equal(codex, source, `${skillName} Codex copy must match docs/skills`);
  }
});
