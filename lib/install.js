import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { expandIncludes, listAgents, listSkills } from './catalog.js';
import { checkboxPrompt as checkbox, finishPrompts, selectPrompt as select, startPrompts } from './prompts.js';
import { renderClaudeAgent } from './renderers/claude-agent.js';
import { renderClaudeSkill } from './renderers/claude-skill.js';
import { renderCodexAgent } from './renderers/codex-agent.js';
import { renderCodexSkill } from './renderers/codex-skill.js';
import { renderOpenCodeAgent } from './renderers/opencode-agent.js';
import { renderOpenCodeSkill } from './renderers/opencode-skill.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SKILLS_SRC = path.join(PACKAGE_ROOT, 'skills');
const AGENTS_SRC = path.join(PACKAGE_ROOT, 'agents');
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, 'package.json');
const SETTINGS_RELATIVE_PATH = 'docs/settings.yaml';
const ARTIFACTS_RELATIVE_PATH = 'docs/artifacts';
const ARTIFACT_DIRECTORY_NAMES = [
  'aims',
  'automations',
  'executions',
  'fixes',
  'manual-tests',
  'plan-review-fixes',
  'plan-reviews',
  'plans',
  'project-starts',
  'researches',
  'review-fixes',
  'reviews',
  'roadmaps'
];
const TARGET_CHOICES = [
  { value: 'claude', label: 'Claude Code', dir: '.claude/skills/' },
  { value: 'codex', label: 'Codex CLI', dir: '.agents/skills/' },
  { value: 'opencode', label: 'OpenCode', dir: '.opencode/skills/' }
];
// В вопросах платформы показываются в этом порядке; установка идёт в порядке TARGET_CHOICES.
const TARGET_PROMPT_ORDER = ['claude', 'opencode', 'codex'];
const UPDATE_ALL_MAX_DEPTH = 2;
const UPDATE_ALL_SKIP_DIRS = new Set(['.git', '.agents', '.claude', '.codex', '.opencode', 'node_modules']);
const RETIRED_SKILLS = [
  'eda-research',
  'eda-review-check',
  'eda-execute',
  'eda-automate',
  'eda-docs',
  'eda-start'
];
const RETIRED_AGENTS = [
  'eda-commit-context',
  'eda-plan-review-requirements',
  'eda-plan-review-rules',
  'eda-plan-review-architecture',
  'eda-plan-review-feasibility',
  'eda-plan-review-execution',
  'eda-plan-review-verification',
  'eda-plan-review-api',
  'eda-plan-review-database',
  'eda-plan-review-security',
  'eda-plan-review-frontend',
  'eda-plan-review-performance',
  'eda-plan-review-previous'
];
const RETIRED_SETTINGS_PATHS = [
  'plan.review',
  'plan.meta_review',
  'plan-review.agents',
  'review-check',
  'review.strict',
  'review.include_code_quality'
];
const MANIFEST_FILE = 'eda-manifest.json';
const SETTINGS_VERSION = 3;
// Состав проверок выбирает eda-review-triage по содержимому ревью. В настройках у роли одна строка:
// default — модель установленного агента — или provider/model#variant, где provider и variant необязательны.
const REVIEW_AGENT_KEYS = [
  'triage',
  'correctness',
  'architecture',
  'rules',
  'references',
  'business',
  'plan_alignment',
  'code_quality',
  'tests',
  'security',
  'performance',
  'frontend',
  'api',
  'database',
  'infra',
  'seo',
  'documentation',
  'previous_reviews'
];
const DEFAULT_REVIEW_AGENTS = Object.fromEntries(REVIEW_AGENT_KEYS.map(key => [key, 'default']));
const REVIEW_AGENT_MODEL_PATTERN = /^[\w.:-]+(?:\/[\w.:-]+)*(?:#[\w.-]+)?$/;
const ORHESTRA_STEP_DEFINITIONS = [
  {
    id: 'plan',
    skill: 'eda-plan',
    name: 'Планирование без проверок через eda-plan',
    enabled: true,
    args: 'без проверок'
  },
  {
    id: 'plan-polish',
    skill: 'eda-plan-polish',
    name: 'Полировка плана через eda-plan-polish',
    enabled: true,
    args: ''
  },
  {
    id: 'execute',
    skill: 'eda-plan-execute',
    name: 'Управляемое выполнение плана через eda-plan-execute',
    enabled: true,
    args: ''
  },
  {
    id: 'polish',
    skill: 'eda-polish',
    name: 'Ревью и исправления через eda-polish',
    enabled: true,
    args: 'limit 5'
  },
  {
    id: 'manual-test',
    skill: 'eda-manual-test',
    name: 'Ручная проверка через eda-manual-test',
    enabled: true,
    args: '',
    onFailure: {
      skill: 'eda-fix',
      args: '',
      then: ['manual-test'],
      maxCycles: 5
    }
  }
];
const DEFAULT_ORHESTRA_STEPS = ORHESTRA_STEP_DEFINITIONS.map(({ name, ...step }) => step);
const DEFAULT_SETTINGS = {
  orhestra: {
    mode: 'automatic',
    execution: 'subagents',
    steps: DEFAULT_ORHESTRA_STEPS
  },
  aim: {
    mode: 'automatic'
  },
  explore: {
    strict: false,
    decisionMode: 'recommend_and_ask'
  },
  plan: {
    strict: false,
    size: 'normal',
    decisionMode: 'recommend_and_ask',
    testStrategy: 'phase_tests_final_checks',
    loggingStrategy: 'standard'
  },
  planReview: {
    threshold: 100
  },
  planPolish: {
    limit: 5
  },
  planExecute: {
    mode: 'main'
  },
  polish: {
    execution: 'subagents'
  },
  manualTest: {
    depth: 'full'
  },
  review: {
    execution: 'main',
    agents: DEFAULT_REVIEW_AGENTS
  },
  sendReview: {
    closePreviousReviews: true
  },
  discoverAutomations: {
    includePlans: false
  }
};
// Разделы идут по ходу работы: исследование, план, его проверка, выполнение, ревью,
// ручные тесты; оркестраторы, которые собирают остальные скилы, — в конце.
const SETTINGS_SECTION_NAMES = [
  'explore',
  'plan',
  'plan-review',
  'plan-polish',
  'plan-execute',
  'review',
  'polish',
  'manual-test',
  'send-review',
  'discover-automations',
  'orhestra',
  'aim'
];
// Варианты ответа: первым — значение по умолчанию, дальше — от ближайшего к дальнему,
// «Спрашивать каждый раз» всегда последним.
const PLAN_SIZE_CHOICES = [
  { value: 'normal', name: 'normal', description: 'обычный план до 40 КБ' },
  { value: 'short', name: 'short', description: 'до 12 КБ и 2 фаз' },
  { value: 'ask_each_time', name: 'Спрашивать каждый раз' }
];
const DECISION_MODE_CHOICES = [
  { value: 'recommend_and_ask', name: 'Рекомендовать и спрашивать', description: 'вопрос только по существенным развилкам' },
  { value: 'autonomous', name: 'Самостоятельно', description: 'агент выбирает сам и записывает причину' },
  { value: 'ask_each_time', name: 'Спрашивать по каждой развилке' }
];
const TEST_STRATEGY_CHOICES = [
  { value: 'phase_tests_final_checks', name: 'Тесты в фазах, проверки в конце', description: 'в фазе — только её тесты, остальные проверки в конце плана' },
  { value: 'tdd_each_phase', name: 'TDD', description: 'в каждой фазе сначала тесты, затем код и все проверки фазы' },
  { value: 'after_each_phase', name: 'После каждой фазы', description: 'тесты и все проверки после каждой фазы' },
  { value: 'end_of_plan', name: 'В конце плана', description: 'тесты и все проверки один раз в конце' },
  { value: 'ask_each_time', name: 'Спрашивать каждый раз' }
];
const PLAN_EXECUTE_MODE_CHOICES = [
  { value: 'main', name: 'Основной агент', description: 'весь план одним контекстом' },
  { value: 'auto', name: 'auto', description: 'по плану: небольшой — одним контекстом, остальные — субагентами' },
  { value: 'subagents', name: 'Субагенты', description: 'каждая фаза — отдельный субагент с независимой проверкой' }
];
const REVIEW_EXECUTION_CHOICES = [
  { value: 'main', name: 'Основной агент', description: 'все проверки в одном контексте' },
  { value: 'subagents', name: 'Субагенты', description: 'разведчик и отдельный агент на каждую проверку' }
];
const POLISH_EXECUTION_CHOICES = [
  { value: 'subagents', name: 'Субагенты', description: 'каждое ревью и исправление — отдельный субагент' },
  { value: 'main', name: 'Основной агент', description: 'ревью и исправления в одном контексте' }
];
const MANUAL_TEST_DEPTH_CHOICES = [
  { value: 'full', name: 'Полная', description: 'API, БД, консоль, интерфейс, алгоритмы, фон, права, логи, регрессии' },
  { value: 'smoke', name: 'Smoke', description: 'запуск и основной сценарий изменённой области' },
  { value: 'ask_each_time', name: 'Спрашивать каждый раз' }
];
const ORHESTRA_MODE_CHOICES = [
  { value: 'automatic', name: 'automatic', description: 'сам отвечает на безопасные рабочие вопросы' },
  { value: 'manual', name: 'manual', description: 'план пишется с человеком, вопросы передаются ему' }
];
const ORHESTRA_EXECUTION_CHOICES = [
  { value: 'subagents', name: 'Субагенты', description: 'каждый этап — отдельный субагент' },
  { value: 'main', name: 'Основной агент', description: 'цепочку ведёт текущий агент, вложенные скилы — по своим настройкам' },
  { value: 'main_propagated', name: 'Основной агент везде', description: 'plan-execute, polish и review тоже без субагентов' }
];
// План и выполнение в оркестраторе включены всегда; спрашиваются только необязательные этапы.
const ORHESTRA_OPTIONAL_STEPS = ['eda-plan-polish', 'eda-polish', 'eda-manual-test'];
const UPDATE_ALL_SETTINGS_MODE_CHOICES = [
  { value: 'configure', name: 'Настроить общий профиль', description: 'ответить один раз и записать во все проекты' },
  { value: 'skip', name: 'Skip', description: 'сохранить актуальные конфиги, старые перенести с defaults' }
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

export async function update({ cwd, input = process.stdin, output = process.stdout, checkboxPrompt = checkbox }) {
  const installedTargets = await detectTargets(cwd);
  if (installedTargets.length === 0) {
    output.write('Не нашёл установленного пакета eda в этом проекте. Запусти `eda init`.\n');
    return;
  }
  output.write(`Найдены установленные среды: ${installedTargets.join(', ')}\n`);
  const targets = await askUpdateTargets({ installedTargets, input, output, checkboxPrompt });
  await migrateArtifactDirectories(cwd, output);
  await configureSettings(cwd, { input, output });
  await syncPackage(cwd, targets, output, { action: 'update' });
}

export async function updateAll({
  root = process.cwd(),
  input = process.stdin,
  output = process.stdout,
  maxDepth = UPDATE_ALL_MAX_DEPTH,
  settingsMode
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
  const resolvedSettingsMode = settingsMode ?? await askUpdateAllSettingsMode({ input, output });
  if (!['configure', 'skip'].includes(resolvedSettingsMode)) {
    throw new Error(`Неизвестный режим настроек update-all: ${resolvedSettingsMode}.`);
  }

  let sharedSettingsContent;
  if (resolvedSettingsMode === 'configure') {
    output.write('Настройки будут запрошены один раз и записаны одинаково во все найденные проекты.\n');
    const sharedSettings = await askSettings({ input, output });
    sharedSettingsContent = formatSettings(sharedSettings);
  } else {
    output.write(`Режим skip: полный version: ${SETTINGS_VERSION} сохраняется, старые конфиги переносятся, отсутствующие создаются с defaults.\n`);
    sharedSettingsContent = formatSettings(structuredClone(DEFAULT_SETTINGS));
  }

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
      await migrateArtifactDirectories(projectDir, output);
      const projectSettingsPath = path.join(projectDir, SETTINGS_RELATIVE_PATH);
      if (resolvedSettingsMode === 'skip' && await fileExists(projectSettingsPath)) {
        const existingContent = await fs.readFile(projectSettingsPath, 'utf8');
        const { migrated, needsMigration, rendered, formatChanged } = resolveSettingsUpdate(existingContent);
        if (!needsMigration && migrated.retiredPaths.length === 0 && !formatChanged) {
          output.write(`Полный файл настроек сохранён: ${SETTINGS_RELATIVE_PATH}\n`);
        } else {
          await writeSettingsContent(projectDir, rendered);
          if (migrated.legacyReviewAgents) {
            output.write(`review.agents переведён на формат 4.0, все роли — default: ${SETTINGS_RELATIVE_PATH}\n`);
          }
          if (migrated.resetReviewAgents.length > 0) {
            output.write(`Недопустимые модели review.agents заменены на default (${migrated.resetReviewAgents.join(', ')}): ${SETTINGS_RELATIVE_PATH}\n`);
          }
          output.write(migrated.retiredPaths.length > 0
            ? `Из файла настроек убраны устаревшие ключи (${migrated.retiredPaths.join(', ')}): ${SETTINGS_RELATIVE_PATH}\n`
            : migrated.normalizedPaths.length > 0
              ? `Переименованы значения настроек (${migrated.normalizedPaths.join(', ')}): ${SETTINGS_RELATIVE_PATH}\n`
              : needsMigration
                ? `Старый или неполный файл настроек перенесён на version: ${SETTINGS_VERSION}: ${SETTINGS_RELATIVE_PATH}\n`
                : `Файл настроек обновлён до актуального формата, значения сохранены: ${SETTINGS_RELATIVE_PATH}\n`);
        }
      } else {
        await writeSettingsContent(projectDir, sharedSettingsContent);
        output.write(resolvedSettingsMode === 'skip'
          ? `Создан файл настроек с defaults: ${SETTINGS_RELATIVE_PATH}\n`
          : `Записан общий файл настроек: ${SETTINGS_RELATIVE_PATH}\n`);
      }
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
    settingsMode: resolvedSettingsMode,
    projects,
    updatedProjects,
    skippedProjects,
    failedProjects
  };
}

export async function askTargets({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) {
    output.write('Нет интерактивного терминала — устанавливаю Claude Code, Codex CLI и OpenCode.\n');
    return TARGET_CHOICES.map(choice => choice.value);
  }

  const selected = await checkbox({
    message: 'Куда установить eda?',
    choices: targetPromptChoices().map(choice => ({
      name: choice.label,
      value: choice.value,
      description: choice.dir,
      checked: false
    })),
    required: true
  }, {
    input,
    output
  });
  return TARGET_CHOICES.map(choice => choice.value).filter(target => selected.includes(target));
}

export async function askUpdateTargets({
  installedTargets,
  input = process.stdin,
  output = process.stdout,
  checkboxPrompt = checkbox
}) {
  if (!input.isTTY || !output.isTTY) return [...installedTargets];

  // Установленные платформы обновляются всегда: снятая с них отметка ничего не удаляет.
  const selected = await checkboxPrompt({
    message: 'Какие платформы обновить? Установленные уже отмечены.',
    choices: targetPromptChoices().map(choice => ({
      name: choice.label,
      value: choice.value,
      description: installedTargets.includes(choice.value) ? 'установлена — обновится в любом случае' : choice.dir,
      checked: installedTargets.includes(choice.value)
    }))
  }, { input, output });

  return TARGET_CHOICES.map(choice => choice.value)
    .filter(target => installedTargets.includes(target) || selected.includes(target));
}

function targetPromptChoices() {
  return TARGET_PROMPT_ORDER.map(value => TARGET_CHOICES.find(choice => choice.value === value));
}

export async function askUpdateAllSettingsMode({
  input = process.stdin,
  output = process.stdout,
  selectPrompt = select
} = {}) {
  if (!input.isTTY || !output.isTTY) {
    output.write(`Нет интерактивного терминала — использую режим skip: сохраняю полный v3, старые конфиги переношу с defaults.\n`);
    return 'skip';
  }

  return selectPrompt({
    message: `Как обновить ${SETTINGS_RELATIVE_PATH} в найденных проектах?`,
    choices: UPDATE_ALL_SETTINGS_MODE_CHOICES,
    default: 'configure'
  }, {
    input,
    output
  });
}

// Спрашиваются только основные настройки в порядке работы. Редкие получают defaults и
// меняются вручную в docs/settings.yaml, как и модели review.agents.
export async function askSettings({
  input = process.stdin,
  output = process.stdout,
  sections = SETTINGS_SECTION_NAMES,
  checkboxPrompt = checkbox,
  selectPrompt = select,
  seedSettings = DEFAULT_SETTINGS,
  missingKeys = null
} = {}) {
  const settings = structuredClone(seedSettings);
  if (!input.isTTY || !output.isTTY) {
    output.write(`Нет интерактивного терминала — использую перенесённые значения и defaults ${SETTINGS_RELATIVE_PATH}.\n`);
    return settings;
  }

  const requestedSections = new Set(sections);
  const shouldAsk = (section, key) => requestedSections.has(section) && (missingKeys === null || missingKeys.has(key));
  const scalarPrompts = [
    ['plan', 'plan.size', settings.plan, 'size', 'eda-plan · размер плана', PLAN_SIZE_CHOICES],
    ['plan', 'plan.decisionMode', settings.plan, 'decisionMode', 'eda-plan · как принимать существенные решения', DECISION_MODE_CHOICES],
    ['plan', 'plan.testStrategy', settings.plan, 'testStrategy', 'eda-plan · когда писать тесты и запускать проверки', TEST_STRATEGY_CHOICES],
    ['plan-execute', 'planExecute.mode', settings.planExecute, 'mode', 'eda-plan-execute · где выполнять фазы плана', PLAN_EXECUTE_MODE_CHOICES],
    ['review', 'review.execution', settings.review, 'execution', 'eda-review · где выполнять проверки', REVIEW_EXECUTION_CHOICES],
    ['polish', 'polish.execution', settings.polish, 'execution', 'eda-polish · где выполнять ревью и исправления', POLISH_EXECUTION_CHOICES],
    ['manual-test', 'manualTest.depth', settings.manualTest, 'depth', 'eda-manual-test · глубина ручной проверки', MANUAL_TEST_DEPTH_CHOICES],
    ['orhestra', 'orhestra.mode', settings.orhestra, 'mode', 'eda-orhestra · как вести полный цикл', ORHESTRA_MODE_CHOICES]
  ].filter(([section, key]) => shouldAsk(section, key));
  const askSteps = shouldAsk('orhestra', 'orhestra.steps');
  const askOrhestraExecution = shouldAsk('orhestra', 'orhestra.execution');
  if (scalarPrompts.length === 0 && !askSteps && !askOrhestraExecution) return settings;

  startPrompts(`Настройки ${SETTINGS_RELATIVE_PATH}`, { output });
  for (const [, , target, property, message, choices] of scalarPrompts) {
    target[property] = await selectPrompt({ message, choices, default: target[property] }, { input, output });
  }
  if (askSteps) {
    const enabledSteps = await checkboxPrompt({
      message: 'eda-orhestra · какие этапы включить, кроме плана и выполнения',
      choices: ORHESTRA_STEP_DEFINITIONS
        .filter(step => ORHESTRA_OPTIONAL_STEPS.includes(step.skill))
        .map(step => ({
          name: step.name,
          value: step.skill,
          checked: settings.orhestra.steps.find(item => item.skill === step.skill)?.enabled !== false
        }))
    }, { input, output });
    settings.orhestra.steps = DEFAULT_ORHESTRA_STEPS.map(step => ({
      ...step,
      enabled: !ORHESTRA_OPTIONAL_STEPS.includes(step.skill) || enabledSteps.includes(step.skill)
    }));
  }
  if (askOrhestraExecution) {
    settings.orhestra.execution = await selectPrompt({
      message: 'eda-orhestra · где выполнять этапы',
      choices: ORHESTRA_EXECUTION_CHOICES,
      default: settings.orhestra.execution
    }, { input, output });
  }
  finishPrompts(`Остальные настройки — в ${SETTINGS_RELATIVE_PATH}`, { output });
  return settings;
}

async function detectTargets(cwd) {
  const targets = [];
  for (const { value } of TARGET_CHOICES) {
    if (await targetStructureExists(cwd, value)) targets.push(value);
  }
  return targets;
}

// При массовом обходе среда считается установленной по eda-скилу, eda-агенту
// или manifest владения. Одних пустых/чужих каталогов skills и agents недостаточно.
async function detectInstalledTargets(cwd) {
  const targets = [];
  for (const { value } of TARGET_CHOICES) {
    if (await hasInstalledPackage(cwd, value)) targets.push(value);
  }
  return targets;
}

async function targetStructureExists(cwd, target) {
  const { skillsDir, agentsDir, manifestPath, legacySkillsDir } = getTargetPaths(cwd, target);
  return await dirExists(skillsDir)
    || (legacySkillsDir !== null && await dirExists(legacySkillsDir))
    || await dirExists(agentsDir)
    || await fileExists(manifestPath);
}

async function hasInstalledPackage(cwd, target) {
  const { skillsDir, agentsDir, manifestPath, legacySkillsDir } = getTargetPaths(cwd, target);
  const agentExtension = target === 'codex' ? '.toml' : '.md';
  return await fileExists(manifestPath)
    || await hasInstalledSkill(skillsDir)
    || (legacySkillsDir !== null && await hasInstalledSkill(legacySkillsDir))
    || await hasInstalledAgent(agentsDir, agentExtension);
}

async function hasInstalledSkill(skillsDir) {
  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(err?.code)) return false;
    throw err;
  }
  // eda-скилы лежат как папка eda-* или как файл eda-*.md в старом Codex layout.
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
  for (const { value } of TARGET_CHOICES) {
    if (!targets.includes(value)) continue;
    const result = await installTarget(cwd, value, skills, agents, packageVersion, output);
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

async function migrateArtifactDirectories(cwd, output = process.stdout) {
  const docsDir = path.join(cwd, 'docs');
  const artifactsDir = path.join(cwd, ARTIFACTS_RELATIVE_PATH);
  const legacyDirectories = [];

  for (const directoryName of ARTIFACT_DIRECTORY_NAMES) {
    const legacyPath = path.join(docsDir, directoryName);
    const legacyStat = await lstatIfExists(legacyPath);
    if (!legacyStat) continue;
    if (!legacyStat.isDirectory() || legacyStat.isSymbolicLink()) {
      throw new Error(`Ожидался каталог артефактов: ${legacyPath}`);
    }
    legacyDirectories.push({ directoryName, legacyPath });
  }

  if (legacyDirectories.length === 0) {
    return { migratedDirectories: 0, movedFiles: 0, discardedFiles: 0 };
  }

  const artifactsStat = await lstatIfExists(artifactsDir);
  if (artifactsStat && (!artifactsStat.isDirectory() || artifactsStat.isSymbolicLink())) {
    throw new Error(`Ожидался каталог артефактов: ${artifactsDir}`);
  }
  await fs.mkdir(artifactsDir, { recursive: true });

  const result = {
    migratedDirectories: legacyDirectories.length,
    movedFiles: 0,
    discardedFiles: 0
  };
  for (const { directoryName, legacyPath } of legacyDirectories) {
    await mergeArtifactEntry(legacyPath, path.join(artifactsDir, directoryName), result);
  }

  output.write(
    `Артефакты перенесены в ${ARTIFACTS_RELATIVE_PATH}/: каталогов ${result.migratedDirectories}, `
    + `файлов перемещено ${result.movedFiles}, конфликтующих старых файлов удалено ${result.discardedFiles}.\n`
  );
  return result;
}

async function mergeArtifactEntry(sourcePath, destinationPath, result) {
  const sourceStat = await fs.lstat(sourcePath);
  const destinationStat = await lstatIfExists(destinationPath);

  if (!destinationStat) {
    result.movedFiles += await countArtifactFiles(sourcePath, sourceStat);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.rename(sourcePath, destinationPath);
    return;
  }

  const mergeDirectories = sourceStat.isDirectory()
    && !sourceStat.isSymbolicLink()
    && destinationStat.isDirectory()
    && !destinationStat.isSymbolicLink();
  if (!mergeDirectories) {
    result.discardedFiles += await countArtifactFiles(sourcePath, sourceStat);
    await fs.rm(sourcePath, { recursive: true, force: true });
    return;
  }

  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    await mergeArtifactEntry(
      path.join(sourcePath, entry.name),
      path.join(destinationPath, entry.name),
      result
    );
  }
  await fs.rmdir(sourcePath);
}

async function countArtifactFiles(entryPath, entryStat = null) {
  const stat = entryStat ?? await fs.lstat(entryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return 1;

  let count = 0;
  const entries = await fs.readdir(entryPath, { withFileTypes: true });
  for (const entry of entries) {
    count += await countArtifactFiles(path.join(entryPath, entry.name));
  }
  return count;
}

async function ensureSettings(cwd, { input = process.stdin, output = process.stdout } = {}) {
  const settingsPath = path.join(cwd, SETTINGS_RELATIVE_PATH);
  const existingContent = await readFileIfExists(settingsPath);
  if (existingContent === null) {
    const settings = await askSettings({ input, output });
    await writeSettingsContent(cwd, formatSettings(settings));
    output.write(`Создан файл настроек: ${SETTINGS_RELATIVE_PATH}\n`);
    return;
  }

  const { migrated, needsMigration, rendered, formatChanged } = resolveSettingsUpdate(existingContent);
  if (!needsMigration && migrated.retiredPaths.length === 0) {
    if (!formatChanged) {
      output.write(`Настройки уже есть: ${SETTINGS_RELATIVE_PATH}\n`);
      return;
    }
    await writeSettingsContent(cwd, rendered);
    output.write(`Обновил ${SETTINGS_RELATIVE_PATH} до актуального формата: значения сохранены.\n`);
    return;
  }

  if (migrated.retiredPaths.length > 0) {
    output.write(`Убираю устаревшие настройки: ${migrated.retiredPaths.join(', ')}.\n`);
  }
  if (migrated.legacyReviewAgents) {
    output.write('Перевожу review.agents на формат 4.0: все роли — default, нужные модели впишите вручную.\n');
  }
  if (migrated.resetReviewAgents.length > 0) {
    output.write(`Заменяю недопустимые модели review.agents на default: ${migrated.resetReviewAgents.join(', ')}.\n`);
  }
  if (needsMigration) {
    output.write(`Переношу ${SETTINGS_RELATIVE_PATH} на version: ${SETTINGS_VERSION}; спрашиваются только отсутствующие значения.\n`);
  }
  const settings = await askSettings({
    input,
    output,
    seedSettings: migrated.settings,
    missingKeys: migrated.missingKeys
  });
  await writeSettingsContent(cwd, formatSettings(settings));
  output.write(`Переписан файл настроек: ${SETTINGS_RELATIVE_PATH} → version: ${SETTINGS_VERSION}.\n`);
}

async function configureSettings(cwd, { input = process.stdin, output = process.stdout } = {}) {
  const settingsPath = path.join(cwd, SETTINGS_RELATIVE_PATH);
  const existingContent = await readFileIfExists(settingsPath);
  if (existingContent === null) {
    output.write(`Настраиваю ${SETTINGS_RELATIVE_PATH} заново.\n`);
    const settings = await askSettings({ input, output });
    await writeSettingsContent(cwd, formatSettings(settings));
    output.write(`Записан файл настроек: ${SETTINGS_RELATIVE_PATH}\n`);
    return;
  }

  const { migrated, needsMigration, rendered, formatChanged } = resolveSettingsUpdate(existingContent);
  if (!needsMigration && migrated.retiredPaths.length === 0) {
    if (!formatChanged) {
      output.write(`Настройки ${SETTINGS_RELATIVE_PATH} версии ${SETTINGS_VERSION} полные — вопросы не требуются.\n`);
      return;
    }
    await writeSettingsContent(cwd, rendered);
    output.write(`Обновил ${SETTINGS_RELATIVE_PATH} до актуального формата: значения сохранены, вопросы не требуются.\n`);
    return;
  }

  if (migrated.retiredPaths.length > 0) {
    output.write(`Убираю устаревшие настройки: ${migrated.retiredPaths.join(', ')}.\n`);
  }
  if (migrated.legacyReviewAgents) {
    output.write('Перевожу review.agents на формат 4.0: все роли — default, нужные модели впишите вручную.\n');
  }
  if (migrated.resetReviewAgents.length > 0) {
    output.write(`Заменяю недопустимые модели review.agents на default: ${migrated.resetReviewAgents.join(', ')}.\n`);
  }
  if (needsMigration) {
    output.write(`Переношу ${SETTINGS_RELATIVE_PATH} на version: ${SETTINGS_VERSION}; спрашиваются только отсутствующие значения.\n`);
  }
  const settings = await askSettings({
    input,
    output,
    seedSettings: migrated.settings,
    missingKeys: migrated.missingKeys
  });
  await writeSettingsContent(cwd, formatSettings(settings));
  output.write(`Переписан файл настроек: ${SETTINGS_RELATIVE_PATH} → version: ${SETTINGS_VERSION}.\n`);
}

// Конфиг несёт подсказки и списки допустимых значений, поэтому при обновлении пакета
// его форма пересобирается заново: значения пользователя переносятся, текст догоняет актуальный.
function resolveSettingsUpdate(existingContent) {
  const migrated = migrateSettingsContent(existingContent);
  const needsMigration = migrated.version !== SETTINGS_VERSION
    || migrated.missingKeys.size > 0
    || migrated.normalizedPaths.length > 0
    || migrated.legacyReviewAgents
    || migrated.resetReviewAgents.length > 0;
  const rendered = formatSettings(migrated.settings);
  return { migrated, needsMigration, rendered, formatChanged: rendered !== existingContent };
}

async function writeSettingsContent(cwd, content) {
  const settingsPath = path.join(cwd, SETTINGS_RELATIVE_PATH);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  if (await fileExists(settingsPath)) {
    await writeFileAtomically(settingsPath, content);
    return;
  }
  await fs.writeFile(settingsPath, content);
}

function migrateSettingsContent(content) {
  let raw = {};
  try {
    const parsed = parseYaml(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed;
  } catch {
    // Некорректный YAML пересобирается из defaults; в TTY все отсутствующие значения будут запрошены.
  }

  const settings = structuredClone(DEFAULT_SETTINGS);
  const missingKeys = new Set();
  const normalizedPaths = [];
  const transfer = (key, value, validator, setter) => {
    if (validator(value)) setter(value);
    else missingKeys.add(key);
  };
  const oneOf = values => value => values.includes(value);
  const bool = value => typeof value === 'boolean';
  const positiveInt = value => Number.isInteger(value) && value > 0;
  const score = value => Number.isInteger(value) && value >= 1 && value <= 100;
  const normalizeExecutionValue = (key, value, aliases) => {
    if (!Object.hasOwn(aliases, value)) return value;
    normalizedPaths.push(key);
    return aliases[value];
  };

  const legacyDefaults = objectValue(raw.defaults);
  const orhestra = objectValue(raw.orhestra);
  transfer('orhestra.mode', orhestra.mode, oneOf(['automatic', 'manual']), value => { settings.orhestra.mode = value; });
  transfer(
    'orhestra.execution',
    normalizeExecutionValue('orhestra.execution', orhestra.execution, {
      single: 'main',
      single_propagated: 'main_propagated'
    }),
    oneOf(['subagents', 'main', 'main_propagated']),
    value => { settings.orhestra.execution = value; }
  );
  const steps = normalizeStoredOrhestraSteps(orhestra.steps);
  transfer('orhestra.steps', steps, value => Array.isArray(value), value => { settings.orhestra.steps = value; });

  const aim = objectValue(raw.aim);
  transfer('aim.mode', aim.mode, oneOf(['automatic', 'manual']), value => { settings.aim.mode = value; });

  const explore = objectValue(raw.explore);
  const legacyStrict = legacyDefaults.strict;
  transfer('explore.strict', explore.strict ?? legacyStrict, bool, value => { settings.explore.strict = value; });
  transfer(
    'explore.decisionMode',
    explore.decision_mode ?? legacyDefaults.decision_mode,
    oneOf(['autonomous', 'recommend_and_ask', 'ask_each_time']),
    value => { settings.explore.decisionMode = value; }
  );

  const plan = objectValue(raw.plan);
  transfer('plan.strict', plan.strict ?? legacyStrict, bool, value => { settings.plan.strict = value; });
  transfer(
    'plan.size',
    plan.size ?? legacyDefaults.plan_size,
    oneOf(['normal', 'short', 'ask_each_time']),
    value => { settings.plan.size = value; }
  );
  transfer(
    'plan.decisionMode',
    plan.decision_mode ?? legacyDefaults.decision_mode,
    oneOf(['autonomous', 'recommend_and_ask', 'ask_each_time']),
    value => { settings.plan.decisionMode = value; }
  );
  transfer(
    'plan.testStrategy',
    plan.test_strategy ?? legacyDefaults.test_strategy,
    oneOf(['after_each_phase', 'phase_tests_final_checks', 'tdd_each_phase', 'end_of_plan', 'ask_each_time']),
    value => { settings.plan.testStrategy = value; }
  );
  transfer(
    'plan.loggingStrategy',
    plan.logging_strategy ?? legacyDefaults.logging_strategy,
    oneOf(['debug_precise', 'standard', 'ask_each_time']),
    value => { settings.plan.loggingStrategy = value; }
  );

  const planReview = objectValue(raw['plan-review']);
  transfer('planReview.threshold', planReview.threshold, score, value => { settings.planReview.threshold = value; });

  const planPolish = objectValue(raw['plan-polish']);
  transfer('planPolish.limit', planPolish.limit, positiveInt, value => { settings.planPolish.limit = value; });

  const planExecute = objectValue(raw['plan-execute']);
  transfer(
    'planExecute.mode',
    normalizeExecutionValue('plan-execute.mode', planExecute.mode, { single: 'main' }),
    oneOf(['subagents', 'main', 'auto']),
    value => { settings.planExecute.mode = value; }
  );

  const polish = objectValue(raw.polish);
  transfer(
    'polish.execution',
    normalizeExecutionValue('polish.execution', polish.execution, { single: 'main' }),
    oneOf(['subagents', 'main']),
    value => { settings.polish.execution = value; }
  );

  const manualTest = objectValue(raw['manual-test']);
  transfer(
    'manualTest.depth',
    manualTest.depth,
    oneOf(['full', 'smoke', 'ask_each_time']),
    value => { settings.manualTest.depth = value; }
  );

  const review = objectValue(raw.review);
  transfer(
    'review.execution',
    normalizeExecutionValue('review.execution', review.execution, { single: 'main' }),
    oneOf(['subagents', 'main']),
    value => { settings.review.execution = value; }
  );
  const { legacyReviewAgents, resetReviewAgents } = transferReviewAgents(objectValue(review.agents), settings.review.agents);

  const sendReview = objectValue(raw['send-review']);
  transfer(
    'sendReview.closePreviousReviews',
    sendReview.close_previous_reviews,
    bool,
    value => { settings.sendReview.closePreviousReviews = value; }
  );
  const discoverAutomations = objectValue(raw['discover-automations']);
  const legacyAutomate = objectValue(raw.automate);
  transfer(
    'discoverAutomations.includePlans',
    discoverAutomations.include_plans ?? legacyAutomate.include_plans,
    bool,
    value => { settings.discoverAutomations.includePlans = value; }
  );

  return {
    settings,
    missingKeys,
    normalizedPaths,
    legacyReviewAgents,
    resetReviewAgents,
    retiredPaths: findRetiredSettingsPaths(raw),
    version: Number.isInteger(raw.version) ? raw.version : null
  };
}

// Формат до 4.0 ({ mode, model } по платформам) не переносится: при мажорном обновлении
// все роли получают default. Иное значение не в формате default | provider/model#variant тоже
// заменяется на default.
function transferReviewAgents(rawAgents, settingsAgents) {
  const legacyReviewAgents = Object.values(rawAgents).some(value => value && typeof value === 'object');
  const resetReviewAgents = [];
  if (legacyReviewAgents) return { legacyReviewAgents, resetReviewAgents };
  for (const key of REVIEW_AGENT_KEYS) {
    if (!Object.hasOwn(rawAgents, key)) continue;
    const value = typeof rawAgents[key] === 'string' ? rawAgents[key].trim() : '';
    if (REVIEW_AGENT_MODEL_PATTERN.test(value)) settingsAgents[key] = value;
    else resetReviewAgents.push(key);
  }
  return { legacyReviewAgents, resetReviewAgents };
}

// У eda-polish больше нет порога: цикл завершается по нулю находок.
function stripRetiredStepArgs(skill, args) {
  if (skill !== 'eda-polish') return args;
  return args.replace(/\bthreshold\s+\d+\s*/gi, '').replace(/\s+/g, ' ').trim();
}

function normalizeStoredOrhestraSteps(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const steps = [];
  for (const step of value) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
    if (typeof step.id !== 'string' || step.id.length === 0) return null;
    if (typeof step.skill !== 'string' || step.skill.length === 0) return null;
    if (step.enabled !== undefined && typeof step.enabled !== 'boolean') return null;
    if (step.args !== undefined && typeof step.args !== 'string') return null;
    const normalized = {
      id: step.id,
      skill: step.skill,
      enabled: step.enabled !== false,
      args: stripRetiredStepArgs(step.skill, step.args ?? '')
    };
    const onFailure = objectValue(step.on_failure);
    if (Object.keys(onFailure).length > 0) {
      if (typeof onFailure.skill !== 'string' || onFailure.skill.length === 0) return null;
      if (onFailure.args !== undefined && typeof onFailure.args !== 'string') return null;
      if (!Array.isArray(onFailure.then) || !onFailure.then.every(item => typeof item === 'string')) return null;
      if (onFailure.max_cycles !== undefined && (!Number.isInteger(onFailure.max_cycles) || onFailure.max_cycles <= 0)) return null;
      normalized.onFailure = {
        skill: onFailure.skill,
        args: onFailure.args ?? '',
        then: onFailure.then,
        maxCycles: onFailure.max_cycles ?? 5
      };
    }
    steps.push(normalized);
  }
  return steps;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function findRetiredSettingsPaths(raw) {
  const found = [];
  for (const settingPath of RETIRED_SETTINGS_PATHS) {
    let current = raw;
    let present = true;
    for (const segment of settingPath.split('.')) {
      if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
        present = false;
        break;
      }
      current = current[segment];
    }
    if (present && current !== undefined) found.push(settingPath);
  }
  return found;
}

async function writeFileAtomically(filePath, content) {
  const currentStat = await fs.stat(filePath);
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(tempPath, content, { mode: currentStat.mode & 0o777 });
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

function formatSettings(settings) {
  const orhestra = settings.orhestra ?? DEFAULT_SETTINGS.orhestra;
  const aim = settings.aim ?? DEFAULT_SETTINGS.aim;
  const orhestraSteps = (orhestra.steps ?? DEFAULT_ORHESTRA_STEPS).map(step => {
    const onFailureThen = step.onFailure?.then
      ?.map(stepId => `          - ${stepId}`)
      .join('\n');
    const onFailure = step.onFailure
      ? `
      # Обработка failed-результата этого шага.
      on_failure:
        skill: ${step.onFailure.skill}
        args: ${JSON.stringify(step.onFailure.args ?? '')}
        # После исправления повторно запускаются включённые шаги с этими id.
        then:
${onFailureThen}
        max_cycles: ${step.onFailure.maxCycles ?? 5}`
      : '';
    return `    - id: ${step.id}
      skill: ${step.skill}
      enabled: ${step.enabled !== false ? 'true' : 'false'}
      # Строка аргументов передаётся скиллу как часть текущего вызова.
      args: ${JSON.stringify(step.args ?? '')}${onFailure}`;
  }).join('\n');
  const reviewAgents = REVIEW_AGENT_KEYS
    .map(key => `    ${key}: ${settings.review.agents[key] ?? DEFAULT_REVIEW_AGENTS[key]}`)
    .join('\n');

  return `version: ${SETTINGS_VERSION}

explore:
  # Включает кросс-CLI ревью в eda-explore.
  # false | true
  strict: ${settings.explore.strict ? 'true' : 'false'}
  # Как eda-explore ведёт исследовательские развилки.
  # recommend_and_ask | autonomous | ask_each_time
  decision_mode: ${settings.explore.decisionMode}

plan:
  # Размер плана.
  # normal | short | ask_each_time
  size: ${settings.plan.size}
  # Как eda-plan принимает существенные решения.
  # recommend_and_ask | autonomous | ask_each_time
  decision_mode: ${settings.plan.decisionMode}
  # Когда писать тесты и запускать автоматические проверки.
  # phase_tests_final_checks | tdd_each_phase | after_each_phase | end_of_plan | ask_each_time
  test_strategy: ${settings.plan.testStrategy}
  # Стратегия логирования.
  # standard | debug_precise | ask_each_time
  logging_strategy: ${settings.plan.loggingStrategy}
  # Включает кросс-CLI ревью в eda-plan.
  # false | true
  strict: ${settings.plan.strict ? 'true' : 'false'}

plan-review:
  # Доля закрытых пунктов чек-листа, при которой план считается готовым.
  # 1..100
  threshold: ${settings.planReview.threshold}

plan-polish:
  # Максимальное число итераций «проверка + исправление».
  # Положительное целое число.
  limit: ${settings.planPolish.limit}

plan-execute:
  # Где eda-plan-execute выполняет фазы плана.
  # main — весь план одним контекстом, auto — решает по плану, subagents — каждая фаза в отдельном субагенте.
  mode: ${settings.planExecute.mode}

review:
  # Где eda-review выполняет выбранные проверки.
  # main — все проверки основным агентом без субагентов, subagents — разведчик и отдельный агент на проверку.
  execution: ${settings.review.execution ?? 'main'}
  # Какие проверки нужны, решает eda-review-triage по содержимому ревью.
  # Модель роли в subagents: default — модель установленного агента, иначе provider/model#variant,
  # например anthropic/claude-opus-5-5#high или deepseek/deepseek-flash-4.1; variant задаёт effort.
  # Если среда не может запустить модель, роль идёт на модели агента с предупреждением в ревью.
  # В main все проверки выполняет текущая модель.
  agents:
${reviewAgents}

polish:
  # Где eda-polish выполняет review и исправления цикла полировки.
  # subagents — каждое review и каждое исправление в отдельном изолированном субагенте, main — оба контракта основным агентом.
  execution: ${settings.polish.execution ?? 'subagents'}

manual-test:
  # Глубина ручной проверки в eda-manual-test.
  # full — закрыть все применимые области: API, база, консольные команды, интерфейс, алгоритмы, фон, права, конфигурацию, логи и регрессии рядом.
  # smoke — только запуск и основной сценарий изменённой области.
  # full | smoke | ask_each_time
  depth: ${settings.manualTest.depth}

send-review:
  # После успешной отправки скрывает предыдущие сводки eda-send-review и резолвит их inline-треды.
  # true | false
  close_previous_reviews: ${settings.sendReview.closePreviousReviews ? 'true' : 'false'}

discover-automations:
  # Добавляет docs/artifacts/plans/ в обычный запуск eda-discover-automations.
  # false | true
  include_plans: ${settings.discoverAutomations.includePlans ? 'true' : 'false'}

orhestra:
  # Режим полного цикла eda-orhestra.
  # automatic | manual
  mode: ${orhestra.mode ?? 'automatic'}
  # Где выполняются этапы и передаётся ли main совместимым вложенным скилам.
  # subagents | main | main_propagated
  execution: ${orhestra.execution ?? 'subagents'}
  # Упорядоченная цепочка. Шаги можно отключать, удалять и переставлять.
  steps:
${orhestraSteps}

aim:
  # Режим ответов на рабочие вопросы eda-aim.
  # automatic | manual
  mode: ${aim.mode ?? 'automatic'}
`;
}

async function installTarget(cwd, target, skills, agents, packageVersion, output = process.stdout) {
  const {
    targetRoot,
    skillsRoot,
    skillsDir,
    agentsDir,
    manifestPath,
    legacySkillsDir
  } = getTargetPaths(cwd, target);
  await assertManagedDirectory(targetRoot);
  if (skillsRoot !== targetRoot) await assertManagedDirectory(skillsRoot);
  await assertManagedDirectory(skillsDir);
  await assertManagedDirectory(agentsDir);
  if (legacySkillsDir !== null) await assertManagedDirectory(legacySkillsDir);
  const previousManifest = await readManifest(manifestPath);
  const changedSkills = [];
  const changedAgents = [];

  await fs.mkdir(skillsDir, { recursive: true });
  for (const skill of skills) {
    const desiredFiles = await buildSkillFiles(skill, target);
    const changed = await syncManagedDirectory(path.join(skillsDir, skill.name), desiredFiles);
    if (changed) changedSkills.push(skill.name);
  }

  if (agents.length > 0) await fs.mkdir(agentsDir, { recursive: true });
  for (const agent of agents) {
    const extension = target === 'codex' ? '.toml' : '.md';
    const renderAgent = { claude: renderClaudeAgent, codex: renderCodexAgent, opencode: renderOpenCodeAgent }[target];
    const rendered = renderAgent(agent, agent.prompt);
    const changed = await writeManagedFile(path.join(agentsDir, `${agent.name}${extension}`), rendered);
    if (changed) changedAgents.push(agent.name);
  }

  await removeRetiredComponents(skillsDir, agentsDir, target, previousManifest, skills, agents);
  if (legacySkillsDir !== null) {
    await removeLegacyCodexSkills(legacySkillsDir, previousManifest, skills);
  }
  await writeManifest(manifestPath, {
    schemaVersion: 1,
    packageVersion,
    skills: skills.map(skill => skill.name),
    agents: agents.map(agent => agent.name)
  });

  const label = TARGET_CHOICES.find(choice => choice.value === target).label;
  const location = skillsDir === path.join(targetRoot, 'skills')
    ? targetRoot
    : `${skillsDir}; ${agentsDir}`;
  output.write(`  ✓ ${label}: ${location} (скилы: ${formatSkillCount(changedSkills.length)}, агенты: ${formatAgentCount(changedAgents.length)})\n`);
  return { changedSkills, changedAgents };
}

function getTargetPaths(cwd, target) {
  const targetRoot = path.join(cwd, `.${target}`);
  const skillsRoot = target === 'codex' ? path.join(cwd, '.agents') : targetRoot;
  return {
    targetRoot,
    skillsRoot,
    skillsDir: path.join(skillsRoot, 'skills'),
    agentsDir: path.join(targetRoot, 'agents'),
    manifestPath: path.join(targetRoot, MANIFEST_FILE),
    legacySkillsDir: target === 'codex' ? path.join(targetRoot, 'skills') : null
  };
}

async function buildSkillFiles(skill, target) {
  const files = await readSourceDirectory(skill.sourceDir, new Set(['skill.json']));
  const entrypoint = files.get('SKILL.md');
  if (!entrypoint) throw new Error(`У скила ${skill.name} нет SKILL.md.`);

  const content = await expandIncludes(`Скил ${skill.name}`, entrypoint.toString('utf8'), PACKAGE_ROOT);
  const renderSkill = { claude: renderClaudeSkill, codex: renderCodexSkill, opencode: renderOpenCodeSkill }[target];
  const rendered = renderSkill(content, skill.config);
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

async function removeRetiredComponents(skillsDir, agentsDir, target, previousManifest, skills, agents) {
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
    await fs.rm(path.join(skillsDir, skillName), { recursive: true, force: true });
    await fs.rm(path.join(skillsDir, `${skillName}.md`), { force: true });
  }

  const extension = target === 'codex' ? '.toml' : '.md';
  for (const agentName of staleAgents) {
    await fs.rm(path.join(agentsDir, `${agentName}${extension}`), { force: true });
  }
}

async function removeLegacyCodexSkills(legacySkillsDir, previousManifest, skills) {
  const managedSkillNames = new Set([
    ...skills.map(skill => skill.name),
    ...RETIRED_SKILLS,
    ...(previousManifest?.skills ?? [])
  ].filter(isManagedComponentName));

  for (const skillName of managedSkillNames) {
    await fs.rm(path.join(legacySkillsDir, skillName), { recursive: true, force: true });
    await fs.rm(path.join(legacySkillsDir, `${skillName}.md`), { force: true });
  }

  try {
    await fs.rmdir(legacySkillsDir);
  } catch (err) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(err?.code)) throw err;
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
