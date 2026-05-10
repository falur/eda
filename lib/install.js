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

export async function init({ cwd, input = process.stdin, output = process.stdout }) {
  const targets = await askTargets({ input, output });
  if (targets.length === 0) {
    output.write('Ничего не выбрано — выходим.\n');
    return;
  }
  await ensureSettings(cwd, { input, output });
  await syncSkills(cwd, targets, output);
}

export async function update({ cwd, input = process.stdin, output = process.stdout }) {
  const targets = await detectTargets(cwd);
  if (targets.length === 0) {
    output.write('Не нашёл установленных скилов в этом проекте. Запусти `eda init`.\n');
    return;
  }
  output.write(`Найдены установленные среды: ${targets.join(', ')}\n`);
  await ensureSettings(cwd, { input, output });
  await syncSkills(cwd, targets, output);
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

  return {
    strict: selected.includes('strict'),
    planSize,
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

async function syncSkills(cwd, targets, output = process.stdout) {
  const skills = await listSkills();
  if (skills.length === 0) {
    throw new Error(`В пакете нет скилов (искал в ${SKILLS_SRC}).`);
  }
  output.write(`Скилы для установки: ${skills.map(s => s.name).join(', ')}\n`);

  if (targets.includes('claude')) await installToClaude(cwd, skills, output);
  if (targets.includes('codex')) await installToCodex(cwd, skills, output);
  await removeRetiredSkills(cwd, targets);

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
  strict: ${settings.strict ? 'true' : 'false'}
  plan_size: ${settings.planSize}

automate:
  include_plans: ${settings.includePlans ? 'true' : 'false'}

review:
  include_code_quality: ${settings.includeCodeQuality ? 'true' : 'false'}
`;
}

async function installToClaude(cwd, skills, output = process.stdout) {
  const dst = path.join(cwd, '.claude/skills');
  await fs.mkdir(dst, { recursive: true });
  for (const skill of skills) {
    const skillDir = path.join(dst, skill.name);
    await fs.mkdir(skillDir, { recursive: true });
    const content = await fs.readFile(skill.path, 'utf-8');
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), content);
  }
  output.write(`  ✓ Claude Code: ${dst}\n`);
}

async function installToCodex(cwd, skills, output = process.stdout) {
  const dst = path.join(cwd, '.codex/skills');
  await fs.mkdir(dst, { recursive: true });
  for (const skill of skills) {
    const skillDir = path.join(dst, skill.name);
    await fs.mkdir(skillDir, { recursive: true });
    const content = await fs.readFile(skill.path, 'utf-8');
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), content);
    await removeObsoleteCodexFile(dst, skill.name);
  }
  output.write(`  ✓ Codex CLI: ${dst}\n`);
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
