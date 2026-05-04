import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SKILLS_SRC = path.join(PACKAGE_ROOT, 'docs/skills');

const BEGIN_MARK = '<!-- BEGIN eda-skills (auto-generated, не править вручную) -->';
const END_MARK = '<!-- END eda-skills -->';

export async function init({ cwd }) {
  const targets = await askTargets();
  if (targets.length === 0) {
    process.stdout.write('Ничего не выбрано — выходим.\n');
    return;
  }
  await syncSkills(cwd, targets);
}

export async function update({ cwd }) {
  const targets = await detectTargets(cwd);
  if (targets.length === 0) {
    process.stdout.write('Не нашёл установленных скилов в этом проекте. Запусти `eda init`.\n');
    return;
  }
  process.stdout.write(`Найдены установленные среды: ${targets.join(', ')}\n`);
  await syncSkills(cwd, targets);
}

async function askTargets() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    'Куда устанавливать скилы?\n' +
    '  [1] Claude Code (.claude/skills/)\n' +
    '  [2] Codex CLI (AGENTS.md)\n' +
    '  [3] Обе среды\n' +
    'Выбор [3]: '
  );
  rl.close();
  const choice = answer.trim() || '3';
  switch (choice) {
    case '1': return ['claude'];
    case '2': return ['codex'];
    case '3': return ['claude', 'codex'];
    default:
      process.stdout.write(`Неизвестный выбор «${choice}» — выходим.\n`);
      return [];
  }
}

async function detectTargets(cwd) {
  const targets = [];
  if (await dirExists(path.join(cwd, '.claude/skills'))) targets.push('claude');
  if (await fileContains(path.join(cwd, 'AGENTS.md'), BEGIN_MARK)) targets.push('codex');
  return targets;
}

async function syncSkills(cwd, targets) {
  const skills = await listSkills();
  if (skills.length === 0) {
    throw new Error(`В пакете нет скилов (искал в ${SKILLS_SRC}).`);
  }
  process.stdout.write(`Скилы для установки: ${skills.map(s => s.name).join(', ')}\n`);

  if (targets.includes('claude')) await installToClaude(cwd, skills);
  if (targets.includes('codex')) await installToCodex(cwd, skills);

  process.stdout.write('\nГотово.\n');
}

async function listSkills() {
  const entries = await fs.readdir(SKILLS_SRC);
  return entries
    .filter(f => f.endsWith('.md'))
    .map(f => ({ name: f.replace(/\.md$/, ''), path: path.join(SKILLS_SRC, f) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function installToClaude(cwd, skills) {
  const dst = path.join(cwd, '.claude/skills');
  await fs.mkdir(dst, { recursive: true });
  for (const skill of skills) {
    const skillDir = path.join(dst, skill.name);
    await fs.mkdir(skillDir, { recursive: true });
    const content = await fs.readFile(skill.path, 'utf-8');
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), content);
  }
  process.stdout.write(`  ✓ Claude Code: ${dst}\n`);
}

async function installToCodex(cwd, skills) {
  const agentsPath = path.join(cwd, 'AGENTS.md');
  let agents = '';
  try {
    agents = await fs.readFile(agentsPath, 'utf-8');
  } catch {
    agents = '# AGENTS.md\n\nИнструкции для AI-агентов в этом репозитории.\n\n';
  }

  // вырезаем все прошлые блоки между маркерами (могло остаться несколько от прежних кривых версий установщика)
  agents = stripAllBlocks(agents);
  agents = agents.replace(/\n{3,}$/, '\n\n').trimEnd() + '\n\n';

  // собираем свежий блок; в теле скилов экранируем любые случайные совпадения маркеров
  const parts = [
    BEGIN_MARK,
    '',
    '## Скилы проекта eda',
    '',
    'Это набор пошаговых инструкций для типовых задач. Когда пользователь просит выполнить одну из них — следуй соответствующему скилу строго и целиком.',
    '',
  ];
  for (const skill of skills) {
    const raw = await fs.readFile(skill.path, 'utf-8');
    const safe = escapeMarkers(raw.trim());
    parts.push('---', '', `### Скил: \`${skill.name}\``, '', safe, '');
  }
  parts.push(END_MARK);

  await fs.writeFile(agentsPath, agents + parts.join('\n') + '\n');
  process.stdout.write(`  ✓ Codex CLI: ${agentsPath}\n`);
}

function stripAllBlocks(text) {
  let out = text;
  while (true) {
    const begin = out.indexOf(BEGIN_MARK);
    if (begin === -1) break;
    const end = out.indexOf(END_MARK, begin);
    if (end === -1) {
      // открытый маркер без закрытия — оставляем как есть, не ломаем
      break;
    }
    out = out.slice(0, begin) + out.slice(end + END_MARK.length);
  }
  return out;
}

function escapeMarkers(text) {
  return text
    .replaceAll(BEGIN_MARK, '<!-- BEGIN eda-skills [пример в теле скила] -->')
    .replaceAll(END_MARK, '<!-- END eda-skills [пример в теле скила] -->');
}

async function dirExists(p) {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function fileContains(p, needle) {
  try {
    const content = await fs.readFile(p, 'utf-8');
    return content.includes(needle);
  } catch {
    return false;
  }
}
