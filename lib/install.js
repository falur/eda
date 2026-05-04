import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SKILLS_SRC = path.join(PACKAGE_ROOT, 'docs/skills');

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
    '  [2] Codex CLI (.codex/skills/)\n' +
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
  if (await dirExists(path.join(cwd, '.codex/skills'))) targets.push('codex');
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
  const dst = path.join(cwd, '.codex/skills');
  await fs.mkdir(dst, { recursive: true });
  for (const skill of skills) {
    const skillDir = path.join(dst, skill.name);
    await fs.mkdir(skillDir, { recursive: true });
    const content = await fs.readFile(skill.path, 'utf-8');
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), content);
    await removeObsoleteCodexFile(dst, skill.name);
  }
  process.stdout.write(`  ✓ Codex CLI: ${dst}\n`);
}

async function removeObsoleteCodexFile(dst, skillName) {
  try {
    await fs.rm(path.join(dst, `${skillName}.md`));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
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
