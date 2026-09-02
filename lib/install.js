import checkbox from '@inquirer/checkbox';
import select from '@inquirer/select';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

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
  { value: 'codex', label: 'Codex CLI', dir: '.agents/skills/' }
];
const UPDATE_ALL_MAX_DEPTH = 2;
const UPDATE_ALL_SKIP_DIRS = new Set(['.git', '.agents', '.claude', '.codex', 'node_modules']);
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
  'plan-review.agents',
  'review-check',
  'review.strict',
  'review.include_code_quality'
];
const MANIFEST_FILE = 'eda-manifest.json';
const SETTINGS_VERSION = 3;
const REVIEW_AGENT_DEFINITIONS = [
  {
    key: 'correctness',
    description: 'Проверяет ошибки в логике, крайние случаи и обработку ошибок.',
    auto: 'Эта базовая проверка по умолчанию запускается всегда.',
    mode: 'always',
    claude: 'sonnet',
    codex: 'gpt-5.6-terra'
  },
  {
    key: 'architecture',
    description: 'Проверяет архитектурные границы, зависимости и разделение ответственности.',
    auto: 'В auto запускается при изменении модулей, зависимостей, публичных контрактов или границ системы.',
    mode: 'auto',
    claude: 'opus',
    codex: 'gpt-5.6-sol'
  },
  {
    key: 'rules',
    description: 'Проверяет соблюдение AGENTS.md, CLAUDE.md и docs/rules.md.',
    auto: 'Эта базовая проверка по умолчанию запускается всегда.',
    mode: 'always',
    claude: 'haiku',
    codex: 'gpt-5.6-luna'
  },
  {
    key: 'references',
    description: 'Проверяет соответствие применимым карточкам из docs/references/.',
    auto: 'В auto запускается только когда для изменений выбраны применимые карточки.',
    mode: 'auto',
    claude: 'haiku',
    codex: 'gpt-5.6-luna'
  },
  {
    key: 'business',
    description: 'Проверяет изменённое поведение по применимым карточкам из docs/business/.',
    auto: 'В auto запускается только когда изменения затрагивают поведение с применимой business-карточкой.',
    mode: 'auto',
    claude: 'sonnet',
    codex: 'gpt-5.6-terra'
  },
  {
    key: 'plan_alignment',
    description: 'Проверяет, что реализация соответствует указанному или однозначно найденному плану.',
    auto: 'В auto запускается только когда у ревью есть конкретный план.',
    mode: 'auto',
    claude: 'sonnet',
    codex: 'gpt-5.6-terra'
  },
  {
    key: 'code_quality',
    description: 'Проверяет читаемость, сложность, дублирование и поддерживаемость кода.',
    auto: 'Эта базовая проверка по умолчанию запускается всегда.',
    mode: 'always',
    claude: 'sonnet',
    codex: 'gpt-5.6-terra'
  },
  {
    key: 'tests',
    description: 'Проверяет достаточность, корректность и устойчивость тестов.',
    auto: 'Эта базовая проверка по умолчанию запускается всегда.',
    mode: 'always',
    claude: 'sonnet',
    codex: 'gpt-5.6-terra'
  },
  {
    key: 'security',
    description: 'Проверяет уязвимости, права доступа, валидацию и работу с чувствительными данными.',
    auto: 'В auto запускается для auth, permissions, внешнего ввода, файлов, сети, секретов и криптографии.',
    mode: 'auto',
    claude: 'opus',
    codex: 'gpt-5.6-sol'
  },
  {
    key: 'performance',
    description: 'Проверяет запросы, циклы, память, конкурентность и другие риски производительности.',
    auto: 'В auto запускается при изменении запросов, пакетной обработки, кешей, конкурентности или горячих путей.',
    mode: 'auto',
    claude: 'sonnet',
    codex: 'gpt-5.6-terra'
  },
  {
    key: 'frontend',
    description: 'Проверяет фронтенд-код, UI, UX, адаптивность и состояния интерфейса.',
    auto: 'В auto обязательно запускается при изменении компонентов, стилей, клиентских маршрутов или состояния UI.',
    mode: 'auto',
    claude: 'sonnet',
    codex: 'gpt-5.6-terra'
  },
  {
    key: 'api',
    description: 'Проверяет API-контракты, совместимость, валидацию и обработку ошибок.',
    auto: 'В auto запускается при изменении маршрутов, handlers, DTO, схем API, GraphQL или RPC.',
    mode: 'auto',
    claude: 'sonnet',
    codex: 'gpt-5.6-terra'
  },
  {
    key: 'database',
    description: 'Проверяет схемы, миграции, запросы, индексы и целостность данных.',
    auto: 'В auto запускается при изменении миграций, моделей хранения, SQL, схем или транзакций.',
    mode: 'auto',
    claude: 'opus',
    codex: 'gpt-5.6-sol'
  },
  {
    key: 'documentation',
    description: 'Проверяет, обновлена ли документация для изменившегося пользовательского поведения.',
    auto: 'В auto запускается при изменении публичного API, CLI, настроек или документируемого поведения.',
    mode: 'auto',
    claude: 'haiku',
    codex: 'gpt-5.6-luna'
  },
  {
    key: 'previous_reviews',
    description: 'Перепроверяет незакрытые замечания предыдущих ревью для удалённого PR или MR.',
    auto: 'В auto запускается только для ссылки на PR/MR или другой цели с доступными удалёнными обсуждениями.',
    mode: 'auto',
    claude: 'haiku',
    codex: 'gpt-5.6-luna'
  }
];
const DEFAULT_REVIEW_AGENTS = Object.fromEntries(REVIEW_AGENT_DEFINITIONS.map(agent => [
  agent.key,
  {
    mode: agent.mode,
    model: {
      claude: agent.claude,
      codex: agent.codex
    }
  }
]));
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
    review: true,
    size: 'normal',
    decisionMode: 'recommend_and_ask',
    testStrategy: 'ask_each_time',
    loggingStrategy: 'ask_each_time'
  },
  planReview: {
    threshold: 100
  },
  planPolish: {
    limit: 2
  },
  planExecute: {
    mode: 'auto'
  },
  manualTest: {
    depth: 'full'
  },
  review: {
    execution: 'subagents',
    agents: DEFAULT_REVIEW_AGENTS
  },
  sendReview: {
    closePreviousReviews: false
  },
  discoverAutomations: {
    includePlans: false
  }
};
const SETTINGS_SECTION_NAMES = [
  'orhestra',
  'aim',
  'explore',
  'plan',
  'plan-review',
  'plan-polish',
  'plan-execute',
  'manual-test',
  'review',
  'send-review',
  'discover-automations'
];
const SETTINGS_CHOICES = [
  {
    section: 'explore',
    key: 'explore.strict',
    value: 'exploreStrict',
    name: 'Strict по умолчанию для eda-explore',
    checked: DEFAULT_SETTINGS.explore.strict
  },
  {
    section: 'plan',
    key: 'plan.strict',
    value: 'planStrict',
    name: 'Strict по умолчанию для eda-plan',
    checked: DEFAULT_SETTINGS.plan.strict
  },
  {
    section: 'plan',
    key: 'plan.review',
    value: 'planReview',
    name: 'Запускать eda-plan-review внутри eda-plan',
    checked: DEFAULT_SETTINGS.plan.review
  },
  {
    section: 'send-review',
    key: 'sendReview.closePreviousReviews',
    value: 'sendReviewClosePreviousReviews',
    name: 'Закрывать предыдущие ревью eda-send-review',
    checked: DEFAULT_SETTINGS.sendReview.closePreviousReviews
  },
  {
    section: 'discover-automations',
    key: 'discoverAutomations.includePlans',
    value: 'discoverAutomationsIncludePlans',
    name: 'Анализировать планы в eda-discover-automations по умолчанию',
    checked: DEFAULT_SETTINGS.discoverAutomations.includePlans
  }
];
const ORHESTRA_MODE_CHOICES = [
  {
    value: 'automatic',
    name: 'Автоматически пройти план, выполнение, ревью и ручные тесты'
  },
  {
    value: 'manual',
    name: 'Писать план вместе с человеком и передавать ему вопросы'
  }
];
const AIM_MODE_CHOICES = [
  {
    value: 'automatic',
    name: 'Автоматически отвечать на безопасные рабочие вопросы'
  },
  {
    value: 'manual',
    name: 'Передавать рабочие вопросы человеку'
  }
];
const ORHESTRA_POLISH_LIMIT_CHOICES = [1, 2, 3, 5, 10].map(value => ({
  value,
  name: `${value} ${value === 1 ? 'итерация' : value < 5 ? 'итерации' : 'итераций'}`
}));
const PLAN_REVIEW_THRESHOLD_CHOICES = [80, 90, 100].map(value => ({
  value,
  name: `${value}/100`
}));
const PLAN_POLISH_LIMIT_CHOICES = [1, 2, 3].map(value => ({
  value,
  name: `${value} ${value === 1 ? 'итерация' : value < 5 ? 'итерации' : 'итераций'}`
}));
const PLAN_EXECUTE_MODE_CHOICES = [
  {
    value: 'auto',
    name: 'Решать по плану: один контекст для простого плана, субагенты для остальных'
  },
  {
    value: 'subagents',
    name: 'Каждую фазу выполнять отдельным изолированным субагентом'
  },
  {
    value: 'single',
    name: 'Выполнять весь план одним контекстом без субагентов'
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
const MANUAL_TEST_DEPTH_CHOICES = [
  {
    value: 'full',
    name: 'Полная проверка всех областей: API, база, консоль, интерфейс, алгоритмы'
  },
  {
    value: 'smoke',
    name: 'Только smoke: запуск и основной сценарий изменённой области'
  },
  {
    value: 'ask_each_time',
    name: 'Спрашивать глубину проверки каждый раз'
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
const REVIEW_MODE_CHOICES = [
  { value: 'always', name: 'always — запускать при каждом ревью' },
  { value: 'auto', name: 'auto — запускать только когда проверка применима' },
  { value: 'off', name: 'off — отключить проверку' }
];
const REVIEW_EXECUTION_CHOICES = [
  {
    value: 'subagents',
    name: 'Каждую review-проверку выполнять отдельным специализированным субагентом'
  },
  {
    value: 'single',
    name: 'Все review-проверки выполнять одним агентом в общем контексте'
  }
];
const CLAUDE_REVIEW_MODEL_CHOICES = [
  { value: 'haiku', name: 'haiku — быстрая проверка' },
  { value: 'sonnet', name: 'sonnet — сильная проверка кода' },
  { value: 'opus', name: 'opus — максимальная глубина' }
];
const CODEX_REVIEW_MODEL_CHOICES = [
  { value: 'gpt-5.6-luna', name: 'gpt-5.6-luna — быстрая проверка' },
  { value: 'gpt-5.6-terra', name: 'gpt-5.6-terra — сильная проверка кода' },
  { value: 'gpt-5.6-sol', name: 'gpt-5.6-sol — максимальная глубина' }
];
const UPDATE_ALL_SETTINGS_MODE_CHOICES = [
  {
    value: 'configure',
    name: 'Настроить один общий профиль и записать его во все проекты'
  },
  {
    value: 'skip',
    name: 'Skip — сохранить полный v3, остальные конфиги перенести с defaults'
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
        const migrated = migrateSettingsContent(existingContent);
        if (migrated.version === SETTINGS_VERSION && migrated.missingKeys.size === 0 && migrated.retiredPaths.length === 0) {
          output.write(`Полный файл настроек сохранён: ${SETTINGS_RELATIVE_PATH}\n`);
        } else {
          await writeSettingsContent(projectDir, formatSettings(migrated.settings));
          output.write(migrated.retiredPaths.length > 0
            ? `Из файла настроек убраны устаревшие ключи (${migrated.retiredPaths.join(', ')}): ${SETTINGS_RELATIVE_PATH}\n`
            : `Старый или неполный файл настроек перенесён на version: ${SETTINGS_VERSION}: ${SETTINGS_RELATIVE_PATH}\n`);
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
  const shouldAsk = key => missingKeys === null || missingKeys.has(key);
  const booleanChoices = SETTINGS_CHOICES.filter(choice => (
    requestedSections.has(choice.section) && shouldAsk(choice.key)
  ));
  const selected = booleanChoices.length > 0
    ? await checkboxPrompt({
        message: 'Какие настройки включить?',
        instructions: 'Стрелки — выбрать, Space — отметить, Enter — продолжить',
        choices: booleanChoices.map(({ section, key, ...choice }) => choice)
      }, { input, output })
    : [];

  if (requestedSections.has('explore') && shouldAsk('explore.strict')) {
    settings.explore.strict = selected.includes('exploreStrict');
  }
  if (requestedSections.has('plan') && shouldAsk('plan.strict')) {
    settings.plan.strict = selected.includes('planStrict');
  }
  if (requestedSections.has('plan') && shouldAsk('plan.review')) {
    settings.plan.review = selected.includes('planReview');
  }
  if (requestedSections.has('send-review') && shouldAsk('sendReview.closePreviousReviews')) {
    settings.sendReview.closePreviousReviews = selected.includes('sendReviewClosePreviousReviews');
  }
  if (requestedSections.has('discover-automations') && shouldAsk('discoverAutomations.includePlans')) {
    settings.discoverAutomations.includePlans = selected.includes('discoverAutomationsIncludePlans');
  }

  if (requestedSections.has('orhestra') && shouldAsk('orhestra.mode')) {
    settings.orhestra.mode = await selectPrompt({
      message: 'Как eda-orhestra должен вести полный цикл по умолчанию?',
      choices: ORHESTRA_MODE_CHOICES,
      default: settings.orhestra.mode
    }, { input, output });
  }

  if (requestedSections.has('orhestra') && shouldAsk('orhestra.steps')) {
    const enabledSteps = await checkboxPrompt({
      message: 'Какие этапы eda-orhestra включить по умолчанию?',
      instructions: 'Порядок можно изменить вручную в docs/settings.yaml',
      choices: ORHESTRA_STEP_DEFINITIONS.map(step => ({
        name: step.name,
        value: step.skill,
        checked: settings.orhestra.steps.find(item => item.skill === step.skill)?.enabled !== false
      }))
    }, { input, output });
    const codePolishLimit = enabledSteps.includes('eda-polish')
      ? await selectPrompt({
        message: 'Сколько итераций разрешить eda-polish внутри eda-orhestra?',
        choices: ORHESTRA_POLISH_LIMIT_CHOICES,
        default: 5
      }, { input, output })
      : 5;
    settings.orhestra.steps = DEFAULT_ORHESTRA_STEPS.map(step => ({
      ...step,
      enabled: enabledSteps.includes(step.skill),
      ...(step.skill === 'eda-polish' ? { args: `limit ${codePolishLimit}` } : {})
    }));
  }

  const scalarPrompts = [
    ['aim', 'aim.mode', settings.aim, 'mode', 'Как eda-aim должен отвечать на рабочие вопросы по умолчанию?', AIM_MODE_CHOICES],
    ['explore', 'explore.decisionMode', settings.explore, 'decisionMode', 'Как принимать важные решения в eda-explore?', DECISION_MODE_CHOICES],
    ['plan', 'plan.size', settings.plan, 'size', 'Какой размер плана eda-plan использовать по умолчанию?', PLAN_SIZE_CHOICES],
    ['plan', 'plan.decisionMode', settings.plan, 'decisionMode', 'Как принимать важные решения в eda-plan?', DECISION_MODE_CHOICES],
    ['plan', 'plan.testStrategy', settings.plan, 'testStrategy', 'Какую стратегию тестов eda-plan использовать по умолчанию?', TEST_STRATEGY_CHOICES],
    ['plan', 'plan.loggingStrategy', settings.plan, 'loggingStrategy', 'Какую стратегию логирования eda-plan использовать по умолчанию?', LOGGING_STRATEGY_CHOICES],
    ['plan-review', 'planReview.threshold', settings.planReview, 'threshold', 'Какой порог готовности использовать в eda-plan-review?', PLAN_REVIEW_THRESHOLD_CHOICES],
    ['plan-polish', 'planPolish.limit', settings.planPolish, 'limit', 'Сколько review-итераций разрешить eda-plan-polish?', PLAN_POLISH_LIMIT_CHOICES],
    ['plan-execute', 'planExecute.mode', settings.planExecute, 'mode', 'Как eda-plan-execute должен выполнять фазы по умолчанию?', PLAN_EXECUTE_MODE_CHOICES],
    ['manual-test', 'manualTest.depth', settings.manualTest, 'depth', 'Какую глубину ручной проверки использовать в eda-manual-test по умолчанию?', MANUAL_TEST_DEPTH_CHOICES],
    ['review', 'review.execution', settings.review, 'execution', 'Как eda-review должен выполнять проверки по умолчанию?', REVIEW_EXECUTION_CHOICES]
  ];
  for (const [section, key, target, property, message, choices] of scalarPrompts) {
    if (!requestedSections.has(section) || !shouldAsk(key)) continue;
    target[property] = await selectPrompt({ message, choices, default: target[property] }, { input, output });
  }

  if (requestedSections.has('review')) {
    settings.review.agents = await askReviewAgentSettings({
      input,
      output,
      selectPrompt,
      seedAgents: settings.review.agents,
      missingKeys,
      skipModels: settings.review.execution === 'single'
    });
  }
  return settings;
}

export async function askReviewAgentSettings({
  input = process.stdin,
  output = process.stdout,
  selectPrompt = select,
  seedAgents = DEFAULT_REVIEW_AGENTS,
  missingKeys = null,
  skipModels = false
} = {}) {
  return askAgentSettings({
    input,
    output,
    selectPrompt,
    definitions: REVIEW_AGENT_DEFINITIONS,
    seedAgents,
    missingKeys,
    keyPrefix: 'review.agents',
    label: 'review',
    skipModels
  });
}

async function askAgentSettings({ input, output, selectPrompt, definitions, seedAgents, missingKeys, keyPrefix, label, skipModels = false }) {
  const configuredAgents = structuredClone(seedAgents);
  const shouldAsk = key => missingKeys === null || missingKeys.has(key);
  for (const agent of definitions) {
    const modeKey = `${keyPrefix}.${agent.key}.mode`;
    const claudeKey = `${keyPrefix}.${agent.key}.model.claude`;
    const codexKey = `${keyPrefix}.${agent.key}.model.codex`;
    let mode = configuredAgents[agent.key].mode;
    if (shouldAsk(modeKey)) {
      mode = await selectPrompt({
        message: `Когда запускать ${label}-проверку ${agent.key}?`,
        choices: REVIEW_MODE_CHOICES,
        default: mode
      }, { input, output });
    }

    let claude = configuredAgents[agent.key].model.claude;
    let codex = configuredAgents[agent.key].model.codex;
    if (!skipModels && mode !== 'off' && shouldAsk(claudeKey)) {
      claude = await selectPrompt({
        message: `Какой моделью Claude проверять ${agent.key}?`,
        choices: CLAUDE_REVIEW_MODEL_CHOICES,
        default: claude
      }, { input, output });
    }
    if (!skipModels && mode !== 'off' && shouldAsk(codexKey)) {
      codex = await selectPrompt({
        message: `Какой моделью Codex проверять ${agent.key}?`,
        choices: CODEX_REVIEW_MODEL_CHOICES,
        default: codex
      }, { input, output });
    }
    configuredAgents[agent.key] = { mode, model: { claude, codex } };
  }
  return configuredAgents;
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
  const { skillsDir, agentsDir, manifestPath, legacySkillsDir } = getTargetPaths(cwd, target);
  return await dirExists(skillsDir)
    || (legacySkillsDir !== null && await dirExists(legacySkillsDir))
    || await dirExists(agentsDir)
    || await fileExists(manifestPath);
}

async function hasInstalledPackage(cwd, target) {
  const { skillsDir, agentsDir, manifestPath, legacySkillsDir } = getTargetPaths(cwd, target);
  const agentExtension = target === 'claude' ? '.md' : '.toml';
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

  const migrated = migrateSettingsContent(existingContent);
  const needsMigration = migrated.version !== SETTINGS_VERSION || migrated.missingKeys.size > 0;
  if (!needsMigration && migrated.retiredPaths.length === 0) {
    output.write(`Настройки уже есть: ${SETTINGS_RELATIVE_PATH}\n`);
    return;
  }

  if (migrated.retiredPaths.length > 0) {
    output.write(`Убираю устаревшие настройки: ${migrated.retiredPaths.join(', ')}.\n`);
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

  const migrated = migrateSettingsContent(existingContent);
  const needsMigration = migrated.version !== SETTINGS_VERSION || migrated.missingKeys.size > 0;
  if (!needsMigration && migrated.retiredPaths.length === 0) {
    output.write(`Настройки ${SETTINGS_RELATIVE_PATH} версии ${SETTINGS_VERSION} полные — вопросы не требуются.\n`);
    return;
  }

  if (migrated.retiredPaths.length > 0) {
    output.write(`Убираю устаревшие настройки: ${migrated.retiredPaths.join(', ')}.\n`);
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
  const transfer = (key, value, validator, setter) => {
    if (validator(value)) setter(value);
    else missingKeys.add(key);
  };
  const oneOf = values => value => values.includes(value);
  const bool = value => typeof value === 'boolean';
  const positiveInt = value => Number.isInteger(value) && value > 0;
  const score = value => Number.isInteger(value) && value >= 1 && value <= 100;

  const legacyDefaults = objectValue(raw.defaults);
  const orhestra = objectValue(raw.orhestra);
  transfer('orhestra.mode', orhestra.mode, oneOf(['automatic', 'manual']), value => { settings.orhestra.mode = value; });
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
  transfer('plan.review', plan.review ?? plan.meta_review, bool, value => { settings.plan.review = value; });
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
    oneOf(['after_each_phase', 'tdd_each_phase', 'end_of_plan', 'ask_each_time']),
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
    planExecute.mode,
    oneOf(['subagents', 'single', 'auto']),
    value => { settings.planExecute.mode = value; }
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
    review.execution,
    oneOf(['subagents', 'single']),
    value => { settings.review.execution = value; }
  );
  transferAgentSettings({
    rawAgents: objectValue(review.agents),
    settingsAgents: settings.review.agents,
    definitions: REVIEW_AGENT_DEFINITIONS,
    prefix: 'review.agents',
    missingKeys
  });
  if (typeof review.include_code_quality === 'boolean' && !objectValue(review.agents).code_quality) {
    settings.review.agents.code_quality.mode = review.include_code_quality ? 'always' : 'off';
    missingKeys.delete('review.agents.code_quality.mode');
  }

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
    retiredPaths: findRetiredSettingsPaths(raw),
    version: Number.isInteger(raw.version) ? raw.version : null
  };
}

function transferAgentSettings({ rawAgents, settingsAgents, definitions, prefix, missingKeys }) {
  const allowedModes = ['always', 'auto', 'off'];
  const allowedClaudeModels = CLAUDE_REVIEW_MODEL_CHOICES.map(choice => choice.value);
  const allowedCodexModels = CODEX_REVIEW_MODEL_CHOICES.map(choice => choice.value);
  for (const definition of definitions) {
    const configured = objectValue(rawAgents[definition.key]);
    const model = objectValue(configured.model);
    if (allowedModes.includes(configured.mode)) settingsAgents[definition.key].mode = configured.mode;
    else missingKeys.add(`${prefix}.${definition.key}.mode`);
    if (allowedClaudeModels.includes(model.claude)) settingsAgents[definition.key].model.claude = model.claude;
    else missingKeys.add(`${prefix}.${definition.key}.model.claude`);
    if (allowedCodexModels.includes(model.codex)) settingsAgents[definition.key].model.codex = model.codex;
    else missingKeys.add(`${prefix}.${definition.key}.model.codex`);
  }
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
  const formatAgents = (definitions, configuredAgents, defaults) => definitions.map(agent => {
    const configured = configuredAgents[agent.key] ?? defaults[agent.key];
    return `    # ${agent.description}
    # ${agent.auto}
    ${agent.key}:
      # always — всегда, auto — когда применимо, off — отключено.
      mode: ${configured.mode}
      model:
        # Модель для Claude Code.
        claude: ${configured.model.claude}
        # Модель для Codex.
        codex: ${configured.model.codex}`;
  }).join('\n\n');
  const reviewAgents = formatAgents(REVIEW_AGENT_DEFINITIONS, settings.review.agents, DEFAULT_REVIEW_AGENTS);

  return `version: ${SETTINGS_VERSION}

orhestra:
  # Режим полного цикла eda-orhestra.
  # automatic | manual
  mode: ${orhestra.mode ?? 'automatic'}
  # Упорядоченная цепочка. Шаги можно отключать, удалять и переставлять.
  steps:
${orhestraSteps}

aim:
  # Режим ответов на рабочие вопросы eda-aim.
  # automatic | manual
  mode: ${aim.mode ?? 'automatic'}

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
  # Запускает изолированный цикл eda-plan-polish.
  # true | false
  review: ${settings.plan.review !== false ? 'true' : 'false'}
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

plan-review:
  # Доля закрытых пунктов чек-листа, при которой план считается готовым.
  # 1..100
  threshold: ${settings.planReview.threshold}

plan-polish:
  # Максимальное число подтверждающих review-итераций.
  # Положительное целое число.
  limit: ${settings.planPolish.limit}

plan-execute:
  # Где eda-plan-execute выполняет фазы плана.
  # subagents — каждая фаза в отдельном субагенте, single — весь план одним контекстом, auto — решает по плану.
  mode: ${settings.planExecute.mode}

manual-test:
  # Глубина ручной проверки в eda-manual-test.
  # full — закрыть все применимые области: API, база, консольные команды, интерфейс, алгоритмы, фон, права, конфигурацию, логи и регрессии рядом.
  # smoke — только запуск и основной сценарий изменённой области.
  # full | smoke | ask_each_time
  depth: ${settings.manualTest.depth}

review:
  # Где eda-review выполняет выбранные проверки.
  # subagents — отдельный специализированный агент на проверку, single — все проверки одним агентом.
  execution: ${settings.review.execution ?? 'subagents'}
  # Каждая проверка имеет собственный режим запуска; модели применяются только в subagents.
  agents:
${reviewAgents}

send-review:
  # После успешной отправки скрывает предыдущие сводки eda-send-review и резолвит их inline-треды.
  # true | false
  close_previous_reviews: ${settings.sendReview.closePreviousReviews ? 'true' : 'false'}

discover-automations:
  # Добавляет docs/artifacts/plans/ в обычный запуск eda-discover-automations.
  # true | false
  include_plans: ${settings.discoverAutomations.includePlans ? 'true' : 'false'}
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
    const extension = target === 'claude' ? '.md' : '.toml';
    const rendered = target === 'claude'
      ? renderClaudeAgent(agent, agent.prompt)
      : renderCodexAgent(agent, agent.prompt);
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

  const label = target === 'claude' ? 'Claude Code' : 'Codex CLI';
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

  const extension = target === 'claude' ? '.md' : '.toml';
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
