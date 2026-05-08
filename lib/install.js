import checkbox from '@inquirer/checkbox';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SKILLS_SRC = path.join(PACKAGE_ROOT, 'skills');
const TARGET_CHOICES = [
  { value: 'claude', label: 'Claude Code', dir: '.claude/skills/' },
  { value: 'codex', label: 'Codex CLI', dir: '.codex/skills/' }
];

export async function init({ cwd, input = process.stdin, output = process.stdout }) {
  const targets = await askTargets({ input, output });
  if (targets.length === 0) {
    output.write('Ничего не выбрано — выходим.\n');
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
