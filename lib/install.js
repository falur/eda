import checkbox from '@inquirer/checkbox';
import select from '@inquirer/select';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SKILLS_SRC = path.join(PACKAGE_ROOT, 'skills');
const SETTINGS_RELATIVE_PATH = 'docs/settings.yaml';
const TARGET_CHOICES = [
  { value: 'claude', label: 'Claude Code', dir: '.claude/skills/' },
  { value: 'codex', label: 'Codex CLI', dir: '.codex/skills/' }
];
const RETIRED_SKILLS = ['eda-research'];
const DEFAULT_SETTINGS = {
  strict: false,
  planSize: 'normal',
  decisionMode: 'recommend_and_ask',
  testStrategy: 'ask_each_time',
  loggingStrategy: 'ask_each_time',
  includePlans: false,
  includeCodeQuality: true
};
const SETTINGS_CHOICES = [
  {
    value: 'strict',
    name: 'Strict по умолчанию для explore / plan / review',
    checked: DEFAULT_SETTINGS.strict
  },
  {
    value: 'includePlans',
    name: 'Анализировать планы в eda-automate по умолчанию',
    checked: DEFAULT_SETTINGS.includePlans
  },
  {
    value: 'includeCodeQuality',
    name: 'Проверять качество кода в eda-review',
    checked: DEFAULT_SETTINGS.includeCodeQuality
  }
];
const PLAN_SIZE_CHOICES = [
  {
    value: 'normal',
    name: 'Обычный план по умолчанию'
  },
  {
    value: 'short',
    name: 'Короткий plan short по умолчанию'
  },
  {
    value: 'ask_each_time',
    name: 'Спрашивать размер плана каждый раз'
  }
];
const DECISION_MODE_CHOICES = [
  {
    value: 'recommend_and_ask',
    name: 'Рекомендовать вариант и спрашивать по важным развилкам'
  },
  {
    value: 'autonomous',
    name: 'Самостоятельно выбирать по коду, правилам и рискам'
  },
  {
    value: 'ask_each_time',
    name: 'Спрашивать по каждой значимой развилке'
  }
];
const TEST_STRATEGY_CHOICES = [
  {
    value: 'after_each_phase',
    name: 'Писать и запускать тесты после каждой фазы'
  },
  {
    value: 'tdd_each_phase',
    name: 'В каждой фазе сначала тесты, затем код'
  },
  {
    value: 'end_of_plan',
    name: 'Писать тесты в конце плана отдельной фазой'
  },
  {
    value: 'ask_each_time',
    name: 'Спрашивать стратегию тестов каждый раз'
  }
];
const LOGGING_STRATEGY_CHOICES = [
  {
    value: 'standard',
    name: 'Стандартные info / warning / error по необходимости'
  },
  {
    value: 'debug_precise',
    name: 'Подробные debug-логи на важных шагах'
  },
  {
    value: 'ask_each_time',
    name: 'Спрашивать стратегию логирования каждый раз'
  }
];

export async function init({ cwd, input = process.stdin, output = process.stdout }) {
  const targets = await askTargets({ input, output });
  if (targets.length === 0) {
    output.write('Ничего не выбрано — выходим.\n');
    return;
  }
  await ensureSettings(cwd, { input, output });
  await syncSkills(cwd, targets, output, { action: 'install' });
}

export async function update({ cwd, input = process.stdin, output = process.stdout }) {
  const targets = await detectTargets(cwd);
  if (targets.length === 0) {
    output.write('Не нашёл установленных скилов в этом проекте. Запусти `eda init`.\n');
    return;
  }
  output.write(`Найдены установленные среды: ${targets.join(', ')}\n`);
  await ensureSettings(cwd, { input, output });
  await syncSkills(cwd, targets, output, { action: 'update' });
}

export async function askTargets({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) {
    output.write('Нет интерактивного терминала — устанавливаю Claude Code и Codex CLI.\n');
    return TARGET_CHOICES.map(choice => choice.value);
  }

  return checkbox({
    message: 'Куда устанавливать скилы?',
    instructions: 'Стрелки — выбрать, Space — отметить, Enter — продолжить',
    choices: TARGET_CHOICES.map(choice => ({
      name: `${choice.label} (${choice.dir})`,
      value: choice.value,
      checked: true
    }))
  }, {
    input,
    output
  });
}

export async function askSettings({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) {
    output.write(`Нет интерактивного терминала — создаю ${SETTINGS_RELATIVE_PATH} с настройками по умолчанию.\n`);
    return { ...DEFAULT_SETTINGS };
  }

  const selected = await checkbox({
    message: 'Какие настройки включить?',
    instructions: 'Стрелки — выбрать, Space — отметить, Enter — продолжить',
    choices: SETTINGS_CHOICES
  }, {
    input,
    output
  });

  const planSize = await select({
    message: 'Какой размер плана eda-plan использовать по умолчанию?',
    choices: PLAN_SIZE_CHOICES,
    default: DEFAULT_SETTINGS.planSize
  }, {
    input,
    output
  });

  const decisionMode = await select({
    message: 'Как принимать важные решения в eda-explore и eda-plan?',
    choices: DECISION_MODE_CHOICES,
    default: DEFAULT_SETTINGS.decisionMode
  }, {
    input,
    output
  });

  const testStrategy = await select({
    message: 'Какую стратегию тестов eda-plan использовать по умолчанию?',
    choices: TEST_STRATEGY_CHOICES,
    default: DEFAULT_SETTINGS.testStrategy
  }, {
    input,
    output
  });

  const loggingStrategy = await select({
    message: 'Какую стратегию логирования eda-plan использовать по умолчанию?',
    choices: LOGGING_STRATEGY_CHOICES,
    default: DEFAULT_SETTINGS.loggingStrategy
  }, {
    input,
    output
  });

  return {
    strict: selected.includes('strict'),
    planSize,
    decisionMode,
    testStrategy,
    loggingStrategy,
    includePlans: selected.includes('includePlans'),
    includeCodeQuality: selected.includes('includeCodeQuality')
  };
}

async function detectTargets(cwd) {
  const targets = [];
  if (await dirExists(path.join(cwd, '.claude/skills'))) targets.push('claude');
  if (await dirExists(path.join(cwd, '.codex/skills'))) targets.push('codex');
  return targets;
}

async function syncSkills(cwd, targets, output = process.stdout, { action = 'update' } = {}) {
  const skills = await listSkills();
  if (skills.length === 0) {
    throw new Error(`В пакете нет скилов (искал в ${SKILLS_SRC}).`);
  }
  output.write(`Скилы для установки: ${skills.map(s => s.name).join(', ')}\n`);

  const changedSkills = new Set();
  if (targets.includes('claude')) {
    const result = await installToClaude(cwd, skills, output);
    for (const skillName of result.changedSkills) changedSkills.add(skillName);
  }
  if (targets.includes('codex')) {
    const result = await installToCodex(cwd, skills, output);
    for (const skillName of result.changedSkills) changedSkills.add(skillName);
  }
  await removeRetiredSkills(cwd, targets);

  const actionLabel = action === 'install' ? 'Установлено' : 'Обновлено';
  const changedSkillNames = skills
    .map(skill => skill.name)
    .filter(skillName => changedSkills.has(skillName));
  output.write(formatChangedSkills(actionLabel, changedSkillNames));
  output.write('\nГотово.\n');
}

async function listSkills() {
  const entries = await fs.readdir(SKILLS_SRC);
  return entries
    .filter(f => f.endsWith('.md'))
    .map(f => ({ name: f.replace(/\.md$/, ''), path: path.join(SKILLS_SRC, f) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureSettings(cwd, { input = process.stdin, output = process.stdout } = {}) {
  const settingsPath = path.join(cwd, SETTINGS_RELATIVE_PATH);
  if (await fileExists(settingsPath)) {
    output.write(`Настройки уже есть: ${SETTINGS_RELATIVE_PATH}\n`);
    output.write('Существующий файл не перезаписываю. Актуальный формат:\n\n');
    output.write(formatSettings(DEFAULT_SETTINGS));
    return;
  }

  const settings = await askSettings({ input, output });
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, formatSettings(settings));
  output.write(`Создан файл настроек: ${SETTINGS_RELATIVE_PATH}\n`);
}

function formatSettings(settings) {
  return `version: 1

defaults:
  # Включает strict-режим по умолчанию для eda-explore, eda-plan и eda-review.
  # true | false
  strict: ${settings.strict ? 'true' : 'false'}
  # Задаёт размер плана по умолчанию для eda-plan.
  # normal | short | ask_each_time
  plan_size: ${settings.planSize}
  # Определяет, как eda-explore ведёт исследовательские развилки, а eda-plan принимает существенные решения.
  # autonomous | recommend_and_ask | ask_each_time
  decision_mode: ${settings.decisionMode}
  # Задаёт стратегию тестов по умолчанию для eda-plan.
  # after_each_phase | tdd_each_phase | end_of_plan | ask_each_time
  test_strategy: ${settings.testStrategy}
  # Задаёт стратегию логирования по умолчанию для eda-plan.
  # debug_precise | standard | ask_each_time
  logging_strategy: ${settings.loggingStrategy}

automate:
  # Добавляет docs/plans/ в обычный запуск eda-automate.
  # true | false
  include_plans: ${settings.includePlans ? 'true' : 'false'}

review:
  # Добавляет в eda-review проверку качества кода и meta-reviewer quality-check.
  # true | false
  include_code_quality: ${settings.includeCodeQuality ? 'true' : 'false'}
`;
}

async function installToClaude(cwd, skills, output = process.stdout) {
  const dst = path.join(cwd, '.claude/skills');
  await fs.mkdir(dst, { recursive: true });
  const changedSkills = [];
  for (const skill of skills) {
    const skillDir = path.join(dst, skill.name);
    await fs.mkdir(skillDir, { recursive: true });
    const content = await fs.readFile(skill.path, 'utf-8');
    const changed = await writeSkillFile(path.join(skillDir, 'SKILL.md'), content);
    if (changed) changedSkills.push(skill.name);
  }
  output.write(`  ✓ Claude Code: ${dst} (изменилось ${formatSkillCount(changedSkills.length)})\n`);
  return { changedSkills };
}

async function installToCodex(cwd, skills, output = process.stdout) {
  const dst = path.join(cwd, '.codex/skills');
  await fs.mkdir(dst, { recursive: true });
  const changedSkills = [];
  for (const skill of skills) {
    const skillDir = path.join(dst, skill.name);
    await fs.mkdir(skillDir, { recursive: true });
    const content = await fs.readFile(skill.path, 'utf-8');
    const changed = await writeSkillFile(path.join(skillDir, 'SKILL.md'), content);
    if (changed) changedSkills.push(skill.name);
    await removeObsoleteCodexFile(dst, skill.name);
  }
  output.write(`  ✓ Codex CLI: ${dst} (изменилось ${formatSkillCount(changedSkills.length)})\n`);
  return { changedSkills };
}

async function writeSkillFile(filePath, content) {
  const previousContent = await readFileIfExists(filePath);
  await fs.writeFile(filePath, content);
  return previousContent !== content;
}

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    return null;
  }
}

function formatChangedSkills(actionLabel, skillNames) {
  if (skillNames.length === 0) return `${actionLabel} 0 скилов.\n`;
  return `${actionLabel} ${formatSkillCount(skillNames.length)}: ${skillNames.join(', ')}.\n`;
}

function formatSkillCount(count) {
  return `${count} ${pluralizeSkill(count)}`;
}

function pluralizeSkill(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'скил';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'скила';
  return 'скилов';
}

async function removeObsoleteCodexFile(dst, skillName) {
  try {
    await fs.rm(path.join(dst, `${skillName}.md`));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

async function removeRetiredSkills(cwd, targets) {
  const targetDirs = {
    claude: path.join(cwd, '.claude/skills'),
    codex: path.join(cwd, '.codex/skills')
  };

  for (const target of targets) {
    const dst = targetDirs[target];
    if (!dst) continue;

    for (const skillName of RETIRED_SKILLS) {
      await fs.rm(path.join(dst, skillName), { recursive: true, force: true });
      await fs.rm(path.join(dst, `${skillName}.md`), { force: true });
    }
  }
}

async function dirExists(p) {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p) {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}
