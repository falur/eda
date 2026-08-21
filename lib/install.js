import checkbox from '@inquirer/checkbox';
import select from '@inquirer/select';
import { randomUUID } from 'node:crypto';
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
const RETIRED_SKILLS = [
  'eda-research',
  'eda-review-check',
  'eda-execute',
  'eda-automate',
  'eda-docs',
  'eda-start'
];
const RETIRED_AGENTS = [];
const MANIFEST_FILE = 'eda-manifest.json';
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
    name: 'Планирование через eda-plan',
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
      then: ['polish', 'manual-test'],
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
    size: 'normal',
    decisionMode: 'recommend_and_ask',
    testStrategy: 'ask_each_time',
    loggingStrategy: 'ask_each_time'
  },
  planPolish: {
    strict: false
  },
  review: {
    agents: DEFAULT_REVIEW_AGENTS
  },
  sendReview: {
    closePreviousReviews: false
  },
  discoverAutomations: {
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
    value: 'sendReviewClosePreviousReviews',
    name: 'Закрывать предыдущие ревью eda-send-review',
    checked: DEFAULT_SETTINGS.sendReview.closePreviousReviews
  },
  {
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
const REVIEW_MODE_CHOICES = [
  { value: 'always', name: 'always — запускать при каждом ревью' },
  { value: 'auto', name: 'auto — запускать только когда проверка применима' },
  { value: 'off', name: 'off — отключить проверку' }
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
      await migrateSettingsIfNeeded(projectDir, { output, reportExisting: false });
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

  const orhestraMode = await select({
    message: 'Как eda-orhestra должен вести полный цикл по умолчанию?',
    choices: ORHESTRA_MODE_CHOICES,
    default: DEFAULT_SETTINGS.orhestra.mode
  }, {
    input,
    output
  });

  const enabledOrhestraSteps = await checkbox({
    message: 'Какие этапы eda-orhestra включить по умолчанию?',
    instructions: 'Порядок можно изменить вручную в docs/settings.yaml',
    choices: ORHESTRA_STEP_DEFINITIONS.map(step => ({
      name: step.name,
      value: step.skill,
      checked: step.enabled
    }))
  }, {
    input,
    output
  });

  const polishLimit = enabledOrhestraSteps.includes('eda-polish')
    ? await select({
        message: 'Сколько итераций разрешить eda-polish внутри eda-orhestra?',
        choices: ORHESTRA_POLISH_LIMIT_CHOICES,
        default: 5
      }, {
        input,
        output
      })
    : 5;

  const orhestraSteps = DEFAULT_ORHESTRA_STEPS.map(step => ({
    ...step,
    enabled: enabledOrhestraSteps.includes(step.skill),
    ...(step.skill === 'eda-polish' ? { args: `limit ${polishLimit}` } : {})
  }));

  const aimMode = await select({
    message: 'Как eda-aim должен отвечать на рабочие вопросы по умолчанию?',
    choices: AIM_MODE_CHOICES,
    default: DEFAULT_SETTINGS.aim.mode
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

  const reviewAgents = await askReviewAgentSettings({ input, output });

  return {
    orhestra: {
      mode: orhestraMode,
      steps: orhestraSteps
    },
    aim: {
      mode: aimMode
    },
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
      agents: reviewAgents
    },
    sendReview: {
      closePreviousReviews: selected.includes('sendReviewClosePreviousReviews')
    },
    discoverAutomations: {
      includePlans: selected.includes('discoverAutomationsIncludePlans')
    }
  };
}

export async function askReviewAgentSettings({
  input = process.stdin,
  output = process.stdout,
  selectPrompt = select
} = {}) {
  const reviewAgents = {};
  for (const agent of REVIEW_AGENT_DEFINITIONS) {
    const mode = await selectPrompt({
      message: `Когда запускать review-проверку ${agent.key}?`,
      choices: REVIEW_MODE_CHOICES,
      default: agent.mode
    }, {
      input,
      output
    });

    let claude = agent.claude;
    let codex = agent.codex;
    if (mode !== 'off') {
      claude = await selectPrompt({
        message: `Какой моделью Claude проверять ${agent.key}?`,
        choices: CLAUDE_REVIEW_MODEL_CHOICES,
        default: agent.claude
      }, {
        input,
        output
      });
      codex = await selectPrompt({
        message: `Какой моделью Codex проверять ${agent.key}?`,
        choices: CODEX_REVIEW_MODEL_CHOICES,
        default: agent.codex
      }, {
        input,
        output
      });
    }
    reviewAgents[agent.key] = { mode, model: { claude, codex } };
  }
  return reviewAgents;
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
  const existing = await migrateSettingsIfNeeded(cwd, { output });
  if (existing.exists) return;

  const settings = await askSettings({ input, output });
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, formatSettings(settings));
  output.write(`Создан файл настроек: ${SETTINGS_RELATIVE_PATH}\n`);
}

async function migrateSettingsIfNeeded(cwd, {
  output = process.stdout,
  reportExisting = true
} = {}) {
  const settingsPath = path.join(cwd, SETTINGS_RELATIVE_PATH);
  const content = await readFileIfExists(settingsPath);
  if (content === null) return { exists: false, migrated: false };

  const version = readTopLevelYamlScalar(content, 'version');
  if (version !== '1') {
    if (reportExisting) {
      output.write(`Настройки уже есть: ${SETTINGS_RELATIVE_PATH}\n`);
      if (version !== '2') {
        output.write('Автомиграция не выполнена: безопасно поддерживается только переход version: 1 → version: 2.\n');
      }
    }
    return { exists: true, migrated: false, version };
  }

  const migratedSettings = migrateSettingsV1(content);
  await writeFileAtomically(settingsPath, formatSettings(migratedSettings));
  output.write(`Мигрированы настройки ${SETTINGS_RELATIVE_PATH}: version: 1 → version: 2.\n`);
  return { exists: true, migrated: true, version: '2' };
}

function migrateSettingsV1(content) {
  const defaultsStrict = readLegacyBoolean(content, 'defaults', 'strict', false);
  const decisionMode = readLegacyEnum(
    content,
    'defaults',
    'decision_mode',
    ['autonomous', 'recommend_and_ask', 'ask_each_time'],
    DEFAULT_SETTINGS.explore.decisionMode
  );
  const reviewAgents = structuredClone(DEFAULT_REVIEW_AGENTS);
  reviewAgents.code_quality.mode = readLegacyBoolean(
    content,
    'review',
    'include_code_quality',
    true
  ) ? 'always' : 'off';

  return {
    ...structuredClone(DEFAULT_SETTINGS),
    explore: {
      strict: defaultsStrict,
      decisionMode
    },
    plan: {
      strict: defaultsStrict,
      size: readLegacyEnum(
        content,
        'defaults',
        'plan_size',
        ['normal', 'short', 'ask_each_time'],
        DEFAULT_SETTINGS.plan.size
      ),
      decisionMode,
      testStrategy: readLegacyEnum(
        content,
        'defaults',
        'test_strategy',
        ['after_each_phase', 'tdd_each_phase', 'end_of_plan', 'ask_each_time'],
        DEFAULT_SETTINGS.plan.testStrategy
      ),
      loggingStrategy: readLegacyEnum(
        content,
        'defaults',
        'logging_strategy',
        ['debug_precise', 'standard', 'ask_each_time'],
        DEFAULT_SETTINGS.plan.loggingStrategy
      )
    },
    planPolish: {
      strict: defaultsStrict
    },
    review: {
      agents: reviewAgents
    },
    discoverAutomations: {
      includePlans: readLegacyBoolean(content, 'automate', 'include_plans', false)
    }
  };
}

function readLegacyBoolean(content, section, key, fallback) {
  const value = readNestedYamlScalar(content, section, key);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function readLegacyEnum(content, section, key, allowedValues, fallback) {
  const value = readNestedYamlScalar(content, section, key);
  return allowedValues.includes(value) ? value : fallback;
}

function readTopLevelYamlScalar(content, key) {
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (match?.[1] === key) return normalizeYamlScalar(match[2]);
  }
  return null;
}

function readNestedYamlScalar(content, section, key) {
  let currentSection = null;
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;

    const sectionMatch = line.match(/^([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    if (/^\S/.test(line)) {
      currentSection = null;
      continue;
    }

    if (currentSection !== section) continue;
    const valueMatch = line.match(/^ {2}([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (valueMatch?.[1] === key) return normalizeYamlScalar(valueMatch[2]);
  }
  return null;
}

function normalizeYamlScalar(value) {
  const withoutComment = value.replace(/\s+#.*$/, '').trim();
  if (
    withoutComment.length >= 2
    && ((withoutComment.startsWith('"') && withoutComment.endsWith('"'))
      || (withoutComment.startsWith("'") && withoutComment.endsWith("'")))
  ) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
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
  const reviewAgents = REVIEW_AGENT_DEFINITIONS.map(agent => {
    const configured = settings.review.agents[agent.key] ?? DEFAULT_REVIEW_AGENTS[agent.key];
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

  return `version: 2

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
  # Каждая проверка имеет собственный режим запуска и модели для обеих сред.
  agents:
${reviewAgents}

send-review:
  # После успешной отправки скрывает предыдущие сводки eda-send-review и резолвит их inline-треды.
  # true | false
  close_previous_reviews: ${settings.sendReview.closePreviousReviews ? 'true' : 'false'}

discover-automations:
  # Добавляет docs/plans/ в обычный запуск eda-discover-automations.
  # true | false
  include_plans: ${settings.discoverAutomations.includePlans ? 'true' : 'false'}
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
