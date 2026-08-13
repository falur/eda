import checkbox from '@inquirer/checkbox';
import select from '@inquirer/select';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listAgents, listSkills } from './catalog.js';
import { renderClaudeAgent } from './renderers/claude-agent.js';
import { renderClaudeSkill } from './renderers/claude-skill.js';
import { renderCodexAgent } from './renderers/codex-agent.js';
import { renderCodexSkill } from './renderers/codex-skill.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SKILLS_SRC = path.join(PACKAGE_ROOT, 'skills');
const AGENTS_SRC = path.join(PACKAGE_ROOT, 'agents');
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, 'package.json');
const SETTINGS_RELATIVE_PATH = 'docs/settings.yaml';
const TARGET_CHOICES = [
  { value: 'claude', label: 'Claude Code', dir: '.claude/skills/' },
  { value: 'codex', label: 'Codex CLI', dir: '.codex/skills/' }
];
const UPDATE_ALL_MAX_DEPTH = 2;
const UPDATE_ALL_SKIP_DIRS = new Set(['.git', '.claude', '.codex', 'node_modules']);
const RETIRED_SKILLS = ['eda-research'];
const RETIRED_AGENTS = [];
const MANIFEST_FILE = 'eda-manifest.json';
const DEFAULT_SETTINGS = {
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
};
const SETTINGS_CHOICES = [
  {
    value: 'exploreStrict',
    name: 'Strict по умолчанию для eda-explore',
    checked: DEFAULT_SETTINGS.explore.strict
  },
  {
    value: 'planStrict',
    name: 'Strict по умолчанию для eda-plan',
    checked: DEFAULT_SETTINGS.plan.strict
  },
  {
    value: 'planPolishStrict',
    name: 'Strict по умолчанию для eda-plan-polish',
    checked: DEFAULT_SETTINGS.planPolish.strict
  },
  {
    value: 'reviewStrict',
    name: 'Strict по умолчанию для eda-review',
    checked: DEFAULT_SETTINGS.review.strict
  },
  {
    value: 'reviewIncludeCodeQuality',
    name: 'Проверять качество кода в eda-review',
    checked: DEFAULT_SETTINGS.review.includeCodeQuality
  },
  {
    value: 'reviewCheckStrict',
    name: 'Strict по умолчанию для eda-review-check',
    checked: DEFAULT_SETTINGS.reviewCheck.strict
  },
  {
    value: 'reviewCheckIncludeCodeQuality',
    name: 'Запускать quality-check в eda-review-check',
    checked: DEFAULT_SETTINGS.reviewCheck.includeCodeQuality
  },
  {
    value: 'automateIncludePlans',
    name: 'Анализировать планы в eda-automate по умолчанию',
    checked: DEFAULT_SETTINGS.automate.includePlans
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
  await syncPackage(cwd, targets, output, { action: 'install' });
}

export async function update({ cwd, input = process.stdin, output = process.stdout }) {
  const targets = await detectTargets(cwd);
  if (targets.length === 0) {
    output.write('Не нашёл установленного пакета eda в этом проекте. Запусти `eda init`.\n');
    return;
  }
  output.write(`Найдены установленные среды: ${targets.join(', ')}\n`);
  await ensureSettings(cwd, { input, output });
  await syncPackage(cwd, targets, output, { action: 'update' });
}

export async function updateAll({
  root = process.cwd(),
  output = process.stdout,
  maxDepth = UPDATE_ALL_MAX_DEPTH
} = {}) {
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error('Глубина поиска должна быть неотрицательным целым числом.');
  }

  const rootDir = path.resolve(root);
  const rootStat = await statIfExists(rootDir);
  if (!rootStat?.isDirectory()) {
    throw new Error(`Директория не найдена: ${rootDir}`);
  }

  output.write(`Ищу проекты с установленным пакетом eda в ${rootDir} (глубина ${maxDepth}).\n`);

  const projects = await findInstalledProjects(rootDir, maxDepth);
  if (projects.length === 0) {
    output.write('Не нашёл проектов с установленным пакетом eda.\n');
    return {
      root: rootDir,
      maxDepth,
      projects,
      updatedProjects: [],
      skippedProjects: [],
      failedProjects: []
    };
  }

  output.write(`Найдено ${formatProjectCount(projects.length)}: ${projects.map(project => formatProjectPath(rootDir, project)).join(', ')}\n`);

  const updatedProjects = [];
  const skippedProjects = [];
  const failedProjects = [];

  for (const projectDir of projects) {
    const projectLabel = formatProjectPath(rootDir, projectDir);
    output.write(`\n=== ${projectLabel} ===\n`);

    try {
      const targets = await detectInstalledTargets(projectDir);
      if (targets.length === 0) {
        output.write('Пропускаю: установленные среды исчезли во время обхода.\n');
        skippedProjects.push(projectDir);
        continue;
      }

      output.write(`Найдены установленные среды: ${targets.join(', ')}\n`);
      const result = await syncPackage(projectDir, targets, output, {
        action: 'update',
        writeDone: false
      });
      updatedProjects.push({
        path: projectDir,
        targets,
        changedSkills: result.changedSkills,
        changedAgents: result.changedAgents
      });
    } catch (err) {
      failedProjects.push({ path: projectDir, error: err });
      output.write(`Ошибка: ${err.message}\n`);
    }
  }

  output.write(`\nСводка: обновлено ${formatProjectCount(updatedProjects.length)}, пропущено ${formatProjectCount(skippedProjects.length)}, ошибки: ${formatErrorCount(failedProjects.length)}.\n`);
  if (failedProjects.length > 0) {
    output.write('Ошибки по проектам:\n');
    for (const failedProject of failedProjects) {
      output.write(`  - ${formatProjectPath(rootDir, failedProject.path)}: ${failedProject.error.message}\n`);
    }
  }

  return {
    root: rootDir,
    maxDepth,
    projects,
    updatedProjects,
    skippedProjects,
    failedProjects
  };
}

export async function askTargets({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) {
    output.write('Нет интерактивного терминала — устанавливаю Claude Code и Codex CLI.\n');
    return TARGET_CHOICES.map(choice => choice.value);
  }

  return checkbox({
    message: 'Куда устанавливать пакет eda?',
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
    return structuredClone(DEFAULT_SETTINGS);
  }

  const selected = await checkbox({
    message: 'Какие настройки включить?',
    instructions: 'Стрелки — выбрать, Space — отметить, Enter — продолжить',
    choices: SETTINGS_CHOICES
  }, {
    input,
    output
  });

  const exploreDecisionMode = await select({
    message: 'Как принимать важные решения в eda-explore?',
    choices: DECISION_MODE_CHOICES,
    default: DEFAULT_SETTINGS.explore.decisionMode
  }, {
    input,
    output
  });

  const planSize = await select({
    message: 'Какой размер плана eda-plan использовать по умолчанию?',
    choices: PLAN_SIZE_CHOICES,
    default: DEFAULT_SETTINGS.plan.size
  }, {
    input,
    output
  });

  const planDecisionMode = await select({
    message: 'Как принимать важные решения в eda-plan?',
    choices: DECISION_MODE_CHOICES,
    default: DEFAULT_SETTINGS.plan.decisionMode
  }, {
    input,
    output
  });

  const testStrategy = await select({
    message: 'Какую стратегию тестов eda-plan использовать по умолчанию?',
    choices: TEST_STRATEGY_CHOICES,
    default: DEFAULT_SETTINGS.plan.testStrategy
  }, {
    input,
    output
  });

  const loggingStrategy = await select({
    message: 'Какую стратегию логирования eda-plan использовать по умолчанию?',
    choices: LOGGING_STRATEGY_CHOICES,
    default: DEFAULT_SETTINGS.plan.loggingStrategy
  }, {
    input,
    output
  });

  return {
    explore: {
      strict: selected.includes('exploreStrict'),
      decisionMode: exploreDecisionMode
    },
    plan: {
      strict: selected.includes('planStrict'),
      size: planSize,
      decisionMode: planDecisionMode,
      testStrategy,
      loggingStrategy
    },
    planPolish: {
      strict: selected.includes('planPolishStrict')
    },
    review: {
      strict: selected.includes('reviewStrict'),
      includeCodeQuality: selected.includes('reviewIncludeCodeQuality')
    },
    reviewCheck: {
      strict: selected.includes('reviewCheckStrict'),
      includeCodeQuality: selected.includes('reviewCheckIncludeCodeQuality')
    },
    automate: {
      includePlans: selected.includes('automateIncludePlans')
    }
  };
}

async function detectTargets(cwd) {
  const targets = [];
  if (await targetStructureExists(cwd, 'claude')) targets.push('claude');
  if (await targetStructureExists(cwd, 'codex')) targets.push('codex');
  return targets;
}

// При массовом обходе среда считается установленной по eda-скилу, eda-агенту
// или manifest владения. Одних пустых/чужих каталогов skills и agents недостаточно.
async function detectInstalledTargets(cwd) {
  const targets = [];
  if (await hasInstalledPackage(cwd, 'claude')) targets.push('claude');
  if (await hasInstalledPackage(cwd, 'codex')) targets.push('codex');
  return targets;
}

async function targetStructureExists(cwd, target) {
  const root = path.join(cwd, `.${target}`);
  return await dirExists(path.join(root, 'skills'))
    || await dirExists(path.join(root, 'agents'))
    || await fileExists(path.join(root, MANIFEST_FILE));
}

async function hasInstalledPackage(cwd, target) {
  const root = path.join(cwd, `.${target}`);
  const agentExtension = target === 'claude' ? '.md' : '.toml';
  return await fileExists(path.join(root, MANIFEST_FILE))
    || await hasInstalledSkill(path.join(root, 'skills'))
    || await hasInstalledAgent(path.join(root, 'agents'), agentExtension);
}

async function hasInstalledSkill(skillsDir) {
  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(err?.code)) return false;
    throw err;
  }
  // eda-скилы лежат как папка eda-* (новый layout) или файл eda-*.md (старый Codex layout).
  return entries.some(entry => entry.name.startsWith('eda-'));
}

async function hasInstalledAgent(agentsDir, extension) {
  let entries;
  try {
    entries = await fs.readdir(agentsDir, { withFileTypes: true });
  } catch (err) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(err?.code)) return false;
    throw err;
  }
  return entries.some(entry => entry.isFile() && entry.name.startsWith('eda-') && entry.name.endsWith(extension));
}

async function syncPackage(cwd, targets, output = process.stdout, { action = 'update', writeDone = true } = {}) {
  const skills = await listSkills(SKILLS_SRC);
  if (skills.length === 0) {
    throw new Error(`В пакете нет скилов (искал в ${SKILLS_SRC}).`);
  }
  const agents = await listAgents(AGENTS_SRC);
  const packageVersion = JSON.parse(await fs.readFile(PACKAGE_JSON_PATH, 'utf8')).version;
  output.write(`Скилы для установки: ${skills.map(s => s.name).join(', ')}\n`);
  if (agents.length > 0) {
    output.write(`Агенты для установки: ${agents.map(agent => agent.name).join(', ')}\n`);
  }

  const changedSkills = new Set();
  const changedAgents = new Set();
  if (targets.includes('claude')) {
    const result = await installTarget(cwd, 'claude', skills, agents, packageVersion, output);
    for (const skillName of result.changedSkills) changedSkills.add(skillName);
    for (const agentName of result.changedAgents) changedAgents.add(agentName);
  }
  if (targets.includes('codex')) {
    const result = await installTarget(cwd, 'codex', skills, agents, packageVersion, output);
    for (const skillName of result.changedSkills) changedSkills.add(skillName);
    for (const agentName of result.changedAgents) changedAgents.add(agentName);
  }

  const actionLabel = action === 'install' ? 'Установлено' : 'Обновлено';
  const changedSkillNames = skills
    .map(skill => skill.name)
    .filter(skillName => changedSkills.has(skillName));
  const changedAgentNames = agents
    .map(agent => agent.name)
    .filter(agentName => changedAgents.has(agentName));
  output.write(formatChangedSkills(actionLabel, changedSkillNames));
  output.write(formatChangedAgents(actionLabel, changedAgentNames));
  if (writeDone) output.write('\nГотово.\n');
  return { changedSkills: changedSkillNames, changedAgents: changedAgentNames };
}

async function findInstalledProjects(rootDir, maxDepth) {
  const projects = [];

  async function walk(dir, depth) {
    const targets = await detectInstalledTargets(dir);
    if (targets.length > 0) projects.push(dir);
    if (depth >= maxDepth) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err?.code === 'EACCES' || err?.code === 'EPERM') return;
      throw err;
    }

    const childDirs = entries
      .filter(entry => !entry.isSymbolicLink() && entry.isDirectory() && !UPDATE_ALL_SKIP_DIRS.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of childDirs) {
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }

  await walk(rootDir, 0);
  return projects;
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
  return `version: 2

explore:
  # Включает кросс-CLI ревью в eda-explore.
  # true | false
  strict: ${settings.explore.strict ? 'true' : 'false'}
  # Определяет, как eda-explore ведёт исследовательские развилки.
  # autonomous | recommend_and_ask | ask_each_time
  decision_mode: ${settings.explore.decisionMode}

plan:
  # Включает кросс-CLI ревью в eda-plan.
  # true | false
  strict: ${settings.plan.strict ? 'true' : 'false'}
  # Задаёт размер плана.
  # normal | short | ask_each_time
  size: ${settings.plan.size}
  # Определяет, как eda-plan принимает существенные решения.
  # autonomous | recommend_and_ask | ask_each_time
  decision_mode: ${settings.plan.decisionMode}
  # Задаёт стратегию тестов.
  # after_each_phase | tdd_each_phase | end_of_plan | ask_each_time
  test_strategy: ${settings.plan.testStrategy}
  # Задаёт стратегию логирования.
  # debug_precise | standard | ask_each_time
  logging_strategy: ${settings.plan.loggingStrategy}

plan-polish:
  # Включает кросс-CLI ревью в eda-plan-polish.
  # true | false
  strict: ${settings.planPolish.strict ? 'true' : 'false'}

review:
  # Задаёт strict-режим по умолчанию для eda-review.
  # true | false
  strict: ${settings.review.strict ? 'true' : 'false'}
  # Добавляет проверку качества кода в первичное ревью.
  # true | false
  include_code_quality: ${settings.review.includeCodeQuality ? 'true' : 'false'}

review-check:
  # Включает кросс-CLI ревью в eda-review-check.
  # true | false
  strict: ${settings.reviewCheck.strict ? 'true' : 'false'}
  # Добавляет meta-reviewer quality-check.
  # true | false
  include_code_quality: ${settings.reviewCheck.includeCodeQuality ? 'true' : 'false'}

automate:
  # Добавляет docs/plans/ в обычный запуск eda-automate.
  # true | false
  include_plans: ${settings.automate.includePlans ? 'true' : 'false'}
`;
}

async function installTarget(cwd, target, skills, agents, packageVersion, output = process.stdout) {
  const targetRoot = path.join(cwd, `.${target}`);
  const skillsDir = path.join(targetRoot, 'skills');
  const agentsDir = path.join(targetRoot, 'agents');
  const manifestPath = path.join(targetRoot, MANIFEST_FILE);
  await assertManagedDirectory(targetRoot);
  await assertManagedDirectory(skillsDir);
  await assertManagedDirectory(agentsDir);
  const previousManifest = await readManifest(manifestPath);
  const changedSkills = [];
  const changedAgents = [];

  await fs.mkdir(skillsDir, { recursive: true });
  for (const skill of skills) {
    const desiredFiles = await buildSkillFiles(skill, target);
    const changed = await syncManagedDirectory(path.join(skillsDir, skill.name), desiredFiles);
    if (changed) changedSkills.push(skill.name);
    if (target === 'codex') await removeObsoleteCodexFile(skillsDir, skill.name);
  }

  if (agents.length > 0) await fs.mkdir(agentsDir, { recursive: true });
  for (const agent of agents) {
    const extension = target === 'claude' ? '.md' : '.toml';
    const rendered = target === 'claude'
      ? renderClaudeAgent(agent, agent.prompt)
      : renderCodexAgent(agent, agent.prompt);
    const changed = await writeManagedFile(path.join(agentsDir, `${agent.name}${extension}`), rendered);
    if (changed) changedAgents.push(agent.name);
  }

  await removeRetiredComponents(targetRoot, target, previousManifest, skills, agents);
  await writeManifest(manifestPath, {
    schemaVersion: 1,
    packageVersion,
    skills: skills.map(skill => skill.name),
    agents: agents.map(agent => agent.name)
  });

  const label = target === 'claude' ? 'Claude Code' : 'Codex CLI';
  output.write(`  ✓ ${label}: ${targetRoot} (скилы: ${formatSkillCount(changedSkills.length)}, агенты: ${formatAgentCount(changedAgents.length)})\n`);
  return { changedSkills, changedAgents };
}

async function buildSkillFiles(skill, target) {
  const files = await readSourceDirectory(skill.sourceDir, new Set(['skill.json']));
  const entrypoint = files.get('SKILL.md');
  if (!entrypoint) throw new Error(`У скила ${skill.name} нет SKILL.md.`);

  const content = entrypoint.toString('utf8');
  const rendered = target === 'claude'
    ? renderClaudeSkill(content, skill.config)
    : renderCodexSkill(content, skill.config);
  files.set('SKILL.md', Buffer.from(rendered));
  return files;
}

async function syncManagedDirectory(directoryPath, desiredFiles) {
  const currentFiles = await readInstalledDirectory(directoryPath);
  if (fileMapsEqual(currentFiles, desiredFiles)) return false;

  await fs.rm(directoryPath, { recursive: true, force: true });
  for (const [relativePath, content] of desiredFiles) {
    const destination = path.join(directoryPath, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
  return true;
}

async function readSourceDirectory(root, excludedFiles = new Set()) {
  const files = new Map();

  async function walk(directory, relativeDirectory = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (relativeDirectory === '' && excludedFiles.has(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlink не поддерживается в исходниках пакета: ${path.join(root, relativePath)}`);
      }
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), relativePath);
      } else if (entry.isFile()) {
        files.set(relativePath, await fs.readFile(path.join(directory, entry.name)));
      }
    }
  }

  await walk(root);
  return files;
}

async function readInstalledDirectory(root) {
  const files = new Map();
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch (err) {
    if (err?.code === 'ENOENT') return files;
    throw err;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    files.set('', Buffer.from('__not_a_directory__'));
    return files;
  }

  async function walk(directory, relativeDirectory = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        files.set(relativePath, Buffer.from('__symlink__'));
      } else if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), relativePath);
      } else if (entry.isFile()) {
        files.set(relativePath, await fs.readFile(path.join(directory, entry.name)));
      }
    }
  }

  await walk(root);
  return files;
}

function fileMapsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const [filePath, content] of right) {
    if (!left.get(filePath)?.equals(content)) return false;
  }
  return true;
}

async function writeManagedFile(filePath, content) {
  const currentStat = await lstatIfExists(filePath);
  let previousContent = null;

  if (currentStat?.isFile() && !currentStat.isSymbolicLink()) {
    previousContent = await fs.readFile(filePath, 'utf8');
  } else if (currentStat) {
    await fs.rm(filePath, { recursive: true, force: true });
  }

  if (previousContent === content) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return true;
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

function formatChangedAgents(actionLabel, agentNames) {
  if (agentNames.length === 0) return `${actionLabel} 0 агентов.\n`;
  return `${actionLabel} ${formatAgentCount(agentNames.length)}: ${agentNames.join(', ')}.\n`;
}

function formatSkillCount(count) {
  return `${count} ${pluralizeSkill(count)}`;
}

function formatAgentCount(count) {
  return `${count} ${pluralizeAgent(count)}`;
}

function formatProjectPath(rootDir, projectDir) {
  const relative = path.relative(rootDir, projectDir);
  return relative === '' ? '.' : relative;
}

function formatProjectCount(count) {
  return `${count} ${pluralizeProject(count)}`;
}

function pluralizeProject(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'проект';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'проекта';
  return 'проектов';
}

function formatErrorCount(count) {
  return `${count} ${pluralizeError(count)}`;
}

function pluralizeError(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ошибка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ошибки';
  return 'ошибок';
}

function pluralizeSkill(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'скил';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'скила';
  return 'скилов';
}

function pluralizeAgent(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'агент';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'агента';
  return 'агентов';
}

async function removeObsoleteCodexFile(dst, skillName) {
  try {
    await fs.rm(path.join(dst, `${skillName}.md`));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

async function removeRetiredComponents(targetRoot, target, previousManifest, skills, agents) {
  const currentSkills = new Set(skills.map(skill => skill.name));
  const currentAgents = new Set(agents.map(agent => agent.name));
  const staleSkills = new Set([
    ...RETIRED_SKILLS,
    ...(previousManifest?.skills ?? []).filter(name => !currentSkills.has(name))
  ].filter(isManagedComponentName));
  const staleAgents = new Set([
    ...RETIRED_AGENTS,
    ...(previousManifest?.agents ?? []).filter(name => !currentAgents.has(name))
  ].filter(isManagedComponentName));

  for (const skillName of staleSkills) {
    await fs.rm(path.join(targetRoot, 'skills', skillName), { recursive: true, force: true });
    await fs.rm(path.join(targetRoot, 'skills', `${skillName}.md`), { force: true });
  }

  const extension = target === 'claude' ? '.md' : '.toml';
  for (const agentName of staleAgents) {
    await fs.rm(path.join(targetRoot, 'agents', `${agentName}${extension}`), { force: true });
  }
}

async function readManifest(manifestPath) {
  try {
    const manifestStat = await fs.lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) return null;
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.skills) || !Array.isArray(manifest.agents)) {
      return null;
    }
    return manifest;
  } catch (err) {
    if (err?.code === 'ENOENT' || err instanceof SyntaxError) return null;
    throw err;
  }
}

async function writeManifest(manifestPath, manifest) {
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeManagedFile(manifestPath, content);
}

function isManagedComponentName(name) {
  return typeof name === 'string' && /^eda-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
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

async function statIfExists(p) {
  try {
    return await fs.stat(p);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    return null;
  }
}

async function lstatIfExists(p) {
  try {
    return await fs.lstat(p);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    return null;
  }
}

async function assertManagedDirectory(directoryPath) {
  const directoryStat = await lstatIfExists(directoryPath);
  if (!directoryStat) return;
  if (directoryStat.isSymbolicLink()) {
    throw new Error(`Управляемый каталог не должен быть symlink: ${directoryPath}`);
  }
  if (!directoryStat.isDirectory()) {
    throw new Error(`Ожидался каталог: ${directoryPath}`);
  }
}
