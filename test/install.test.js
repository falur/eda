import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { askSettings, askTargets, init, update } from '../lib/install.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SKILLS_SRC = path.join(ROOT, 'skills');

function silentOutput() {
  const output = new PassThrough();
  output.resume();
  return output;
}

async function listSkillFiles() {
  const entries = await fs.readdir(SKILLS_SRC);
  return entries
    .filter(name => /^eda-.*\.md$/.test(name))
    .sort((a, b) => a.replace(/\.md$/, '').localeCompare(b.replace(/\.md$/, '')));
}

test('cli prints package version with --version', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));

  const { stdout } = await execFileAsync(process.execPath, [path.join(ROOT, 'bin/cli.js'), '--version']);

  assert.equal(stdout, `${packageJson.version}\n`);
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

test('init prints installed skills count', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-init-count-'));
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', chunk => outputChunks.push(chunk));
  const skillNames = (await listSkillFiles()).map(file => file.replace(/\.md$/, ''));
  const skillCount = skillNames.length;

  await init({ cwd, output });

  const stdout = Buffer.concat(outputChunks).toString('utf8');
  assert.match(stdout, new RegExp(`Установлено ${skillCount} скил(?:а|ов)?: ${skillNames.join(', ')}\\.`));
  assert.match(stdout, new RegExp(`Claude Code: .*\\(изменилось ${skillCount} скил(?:а|ов)?\\)`));
  assert.match(stdout, new RegExp(`Codex CLI: .*\\(изменилось ${skillCount} скил(?:а|ов)?\\)`));
});

test('update prints updated skills count', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-update-count-'));
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', chunk => outputChunks.push(chunk));
  const skillNames = (await listSkillFiles()).map(file => file.replace(/\.md$/, ''));
  const skillCount = skillNames.length;
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });

  await update({ cwd, output });

  const stdout = Buffer.concat(outputChunks).toString('utf8');
  assert.match(stdout, new RegExp(`Обновлено ${skillCount} скил(?:а|ов)?: ${skillNames.join(', ')}\\.`));
  assert.match(stdout, new RegExp(`Codex CLI: .*\\(изменилось ${skillCount} скил(?:а|ов)?\\)`));
});

test('update lists only skills whose installed content changed', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-update-changed-only-'));
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', chunk => outputChunks.push(chunk));
  const dst = path.join(cwd, '.codex/skills');
  await fs.mkdir(dst, { recursive: true });

  for (const file of await listSkillFiles()) {
    const skillName = file.replace(/\.md$/, '');
    await fs.mkdir(path.join(dst, skillName), { recursive: true });
    const source = await fs.readFile(path.join(SKILLS_SRC, file), 'utf8');
    await fs.writeFile(path.join(dst, skillName, 'SKILL.md'), source);
  }
  await fs.writeFile(path.join(dst, 'eda-plan/SKILL.md'), 'old plan');
  await fs.writeFile(path.join(dst, 'eda-review/SKILL.md'), 'old review');

  await update({ cwd, output });

  const stdout = Buffer.concat(outputChunks).toString('utf8');
  assert.match(stdout, /Обновлено 2 скила: eda-plan, eda-review\./);
  assert.match(stdout, /Codex CLI: .*\(изменилось 2 скила\)/);
  assert.doesNotMatch(stdout, /Обновлено .*eda-commit/);
});

test('update prints zero changed skills when installed content is current', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-update-unchanged-'));
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', chunk => outputChunks.push(chunk));
  const dst = path.join(cwd, '.codex/skills');
  await fs.mkdir(dst, { recursive: true });

  for (const file of await listSkillFiles()) {
    const skillName = file.replace(/\.md$/, '');
    await fs.mkdir(path.join(dst, skillName), { recursive: true });
    const source = await fs.readFile(path.join(SKILLS_SRC, file), 'utf8');
    await fs.writeFile(path.join(dst, skillName, 'SKILL.md'), source);
  }

  await update({ cwd, output });

  const stdout = Buffer.concat(outputChunks).toString('utf8');
  assert.match(stdout, /Обновлено 0 скилов\./);
  assert.match(stdout, /Codex CLI: .*\(изменилось 0 скилов\)/);
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
    strict: false,
    planSize: 'normal',
    decisionMode: 'recommend_and_ask',
    testStrategy: 'ask_each_time',
    loggingStrategy: 'ask_each_time',
    includePlans: false,
    includeCodeQuality: true
  });
});

test('update creates default docs/settings.yaml when it is missing', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-settings-'));
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });

  await update({ cwd, output: silentOutput() });

  const settings = await fs.readFile(path.join(cwd, 'docs/settings.yaml'), 'utf8');
  assert.equal(settings, `version: 1

defaults:
  # Включает strict-режим по умолчанию для eda-explore, eda-plan и eda-review.
  # true | false
  strict: false
  # Задаёт размер плана по умолчанию для eda-plan.
  # normal | short | ask_each_time
  plan_size: normal
  # Определяет, как eda-explore ведёт исследовательские развилки, а eda-plan принимает существенные решения.
  # autonomous | recommend_and_ask | ask_each_time
  decision_mode: recommend_and_ask
  # Задаёт стратегию тестов по умолчанию для eda-plan.
  # after_each_phase | tdd_each_phase | end_of_plan | ask_each_time
  test_strategy: ask_each_time
  # Задаёт стратегию логирования по умолчанию для eda-plan.
  # debug_precise | standard | ask_each_time
  logging_strategy: ask_each_time

automate:
  # Добавляет docs/plans/ в обычный запуск eda-automate.
  # true | false
  include_plans: false

review:
  # Добавляет в eda-review проверку качества кода и meta-reviewer quality-check.
  # true | false
  include_code_quality: true
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
  assert.match(stdout, /# autonomous \| recommend_and_ask \| ask_each_time/);
  assert.match(stdout, /decision_mode: recommend_and_ask/);
  assert.match(stdout, /# after_each_phase \| tdd_each_phase \| end_of_plan \| ask_each_time/);
  assert.match(stdout, /test_strategy: ask_each_time/);
  assert.match(stdout, /# debug_precise \| standard \| ask_each_time/);
  assert.match(stdout, /logging_strategy: ask_each_time/);
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
  assert.match(plan, /defaults\.decision_mode: recommend_and_ask/);
  assert.match(plan, /defaults\.decision_mode` \| `autonomous`, `recommend_and_ask`, `ask_each_time`/);

  const explore = await fs.readFile(path.join(SKILLS_SRC, 'eda-explore.md'), 'utf8');
  assert.match(explore, /defaults\.decision_mode: recommend_and_ask/);
  assert.match(explore, /значимые развилки/);

  const automate = await fs.readFile(path.join(SKILLS_SRC, 'eda-automate.md'), 'utf8');
  assert.match(automate, /automate\.include_plans: false/);
  assert.match(automate, /automate\.include_plans: true/);

  const review = await fs.readFile(path.join(SKILLS_SRC, 'eda-review.md'), 'utf8');
  assert.match(review, /review\.include_code_quality: true/);
  assert.match(review, /quality-check/);
});

test('eda-review reports only problems, not completed work', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-review.md'), 'utf8');

  assert.match(content, /Ревью содержит только проблемы/);
  assert.match(content, /Не перечисля/);
  assert.match(content, /Проблемы сверки с планом/);
  assert.doesNotMatch(content, /Статус: <выполнено/);
});

test('eda-review keeps technical details below a readable problem summary', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-review.md'), 'utf8');

  assert.match(content, /Основная часть замечания — главный ответ/);
  assert.match(content, /первый экран пункта можно было прочитать без глубокого знания кода/);
  assert.match(content, /Технические детали/);
  assert.match(content, /Не начинай с имён классов, методов, строк, SQL, DTO, конфигов/);
  assert.match(content, /Что подтверждает проблему/);
});

test('eda-plan no longer requires a research selection question by default', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-plan.md'), 'utf8');

  assert.doesNotMatch(content, /Через `AskUserQuestion` спроси про релевантное исследование/);
  assert.match(content, /если в сообщении есть описание задачи без research-файла/);
  assert.match(content, /не спрашивай research автоматически/);
});

test('eda-plan final format keeps risks and execution order inside phases', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-plan.md'), 'utf8');

  assert.doesNotMatch(content, /^## Риски$/m);
  assert.doesNotMatch(content, /^## Порядок выполнения$/m);
  assert.match(content, /Риски не выносятся в отдельный обязательный раздел/);
  assert.match(content, /линейный порядок задаётся номерами фаз/);
});

test('eda-plan and eda-review prefer Codex subagents for normal meta reviews', async () => {
  const plan = await fs.readFile(path.join(SKILLS_SRC, 'eda-plan.md'), 'utf8');
  const review = await fs.readFile(path.join(SKILLS_SRC, 'eda-review.md'), 'utf8');

  assert.match(plan, /Codex interactive \(`spawn_agent`\)/);
  assert.match(plan, /Не используй отдельные `codex exec` для обычного мета-ревью, когда субагенты доступны/);
  assert.match(plan, /Codex exec \/ non-interactive fallback/);

  assert.match(review, /Codex interactive: если доступен инструмент субагентов \(`spawn_agent` или аналог\)/);
  assert.match(review, /не используй отдельные `codex exec` для обычного мета-ревью, когда субагенты доступны/);
  assert.match(review, /Codex exec \/ неинтерактивный fallback/);
});

test('eda-plan requires implementation contracts for data and api changes', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-plan.md'), 'utf8');

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
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-plan.md'), 'utf8');

  assert.match(content, /обязательная рамка планирования, а не справочный контекст/);
  assert.match(content, /передай их в Plan Mode как обязательные требования/);
  assert.match(content, /не финализируй план/);
  assert.match(content, /план строго следует `docs\/rules\.md` и `docs\/arch\.md`/);
  assert.match(content, /Считать `docs\/rules\.md` и `docs\/arch\.md` просто контекстом/);
});

test('eda-roadmap creates non-implementation task roadmaps', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-roadmap.md'), 'utf8');

  assert.match(content, /docs\/roadmaps/);
  assert.match(content, /## Задачи/);
  assert.match(content, /Аутентификация через email, ВК и Яндекс/);
  assert.match(content, /Roadmap — не план реализации/);
  assert.match(content, /не содержат деталей реализации/);
  assert.match(content, /файлов, библиотек, API/);
});

test('eda-explore asks about meaningful forks and requires concrete output', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-explore.md'), 'utf8');

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

test('eda-send-review keeps safe comment modes inline but confirms state-changing reviews', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-send-review.md'), 'utf8');

  assert.match(content, /`comment` означает обычный комментарий PR/);
  assert.match(content, /`review-comment` — review без статуса/);
  assert.match(content, /Если тип отправки указан в тексте и это `comment` или `review-comment`, используй его без дополнительного выбора/);
  assert.match(content, /`approve` и `request-changes` всегда подтверждай через `AskUserQuestion`/);
});

test('worktree skills document naming and merge contract', async () => {
  const create = await fs.readFile(path.join(SKILLS_SRC, 'eda-worktree.md'), 'utf8');
  const merge = await fs.readFile(path.join(SKILLS_SRC, 'eda-merge-worktree.md'), 'utf8');

  assert.match(create, /name: eda-worktree/);
  assert.match(create, /\{name\}-work-\{n\}/);
  assert.match(create, /git worktree add -b/);
  assert.match(create, /Базовую ветку берёт из текста рядом с вызовом/);

  assert.match(merge, /name: eda-merge-worktree/);
  assert.match(merge, /`work-1`/);
  assert.match(merge, /`1`/);
  assert.match(merge, /git merge "\$SOURCE_BRANCH"/);
  assert.match(merge, /не удаляет worktree и ветку/);
});

test('readme lists worktree skills', async () => {
  const content = await fs.readFile(path.join(ROOT, 'README.md'), 'utf8');

  assert.match(content, /тринадцать скилов/);
  assert.match(content, /`eda-worktree`/);
  assert.match(content, /`eda-merge-worktree`/);
  assert.match(content, /\{name\}-work-\{n\}/);
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

test('eda-execute treats project rules and architecture as mandatory execution frame', async () => {
  const content = await fs.readFile(path.join(SKILLS_SRC, 'eda-execute.md'), 'utf8');

  assert.match(content, /`docs\/rules\.md` и `docs\/arch\.md` обязательны к исполнению/);
  assert.match(content, /Выполняй план только в той форме, которая строго следует правилам и архитектуре проекта/);
  assert.match(content, /Перед правкой сверяешь действие с `docs\/rules\.md` и `docs\/arch\.md`/);
  assert.match(content, /Исполнять план, который противоречит правилам или архитектуре проекта/);
  assert.match(content, /Обходить правило или архитектурное ограничение без явного решения пользователя/);
});

test('update installs Claude and Codex copies identical to packaged skills', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-install-both-'));
  await fs.mkdir(path.join(cwd, '.claude/skills'), { recursive: true });
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });

  await update({ cwd, output: silentOutput() });

  for (const file of await listSkillFiles()) {
    const skillName = file.replace(/\.md$/, '');
    const source = await fs.readFile(path.join(SKILLS_SRC, file), 'utf8');
    const claude = await fs.readFile(path.join(cwd, '.claude/skills', skillName, 'SKILL.md'), 'utf8');
    const codex = await fs.readFile(path.join(cwd, '.codex/skills', skillName, 'SKILL.md'), 'utf8');

    assert.equal(claude, source, `${skillName} Claude copy must match skills`);
    assert.equal(codex, source, `${skillName} Codex copy must match skills`);
  }
});
