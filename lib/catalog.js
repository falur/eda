import fs from 'node:fs/promises';
import path from 'node:path';

export async function listSkills(skillsRoot) {
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('eda-')) continue;
    if (!isComponentName(entry.name)) {
      throw new Error(`Некорректное имя скила: ${entry.name}.`);
    }

    const sourceDir = path.join(skillsRoot, entry.name);
    const entrypoint = path.join(sourceDir, 'SKILL.md');
    if (!await fileExists(entrypoint)) {
      throw new Error(`У скила ${entry.name} нет SKILL.md.`);
    }

    const configPath = path.join(sourceDir, 'skill.json');
    const config = await readJsonIfExists(configPath) ?? {};
    validateSkillConfig(entry.name, config);
    skills.push({ name: entry.name, sourceDir, entrypoint, config });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAgents(agentsRoot) {
  let entries;
  try {
    entries = await fs.readdir(agentsRoot, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }

  const agents = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('eda-')) continue;
    if (!isComponentName(entry.name)) {
      throw new Error(`Некорректное имя агента: ${entry.name}.`);
    }

    const sourceDir = path.join(agentsRoot, entry.name);
    const metadataPath = path.join(sourceDir, 'agent.json');
    const promptPath = path.join(sourceDir, 'prompt.md');
    const metadata = await readJson(metadataPath);
    const prompt = await fs.readFile(promptPath, 'utf8');
    validateAgent(entry.name, metadata, prompt);
    agents.push({ ...metadata, sourceDir, prompt });
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

function validateSkillConfig(skillName, config) {
  if (Object.keys(config).length === 0) return;
  if (config.schemaVersion !== 1) {
    throw new Error(`Скил ${skillName}: поддерживается только skill.json schemaVersion 1.`);
  }
  if (config.models && typeof config.models !== 'object') {
    throw new Error(`Скил ${skillName}: models должен быть объектом.`);
  }
}

function validateAgent(directoryName, agent, prompt) {
  if (agent.schemaVersion !== 1) {
    throw new Error(`Агент ${directoryName}: поддерживается только agent.json schemaVersion 1.`);
  }
  if (agent.name !== directoryName) {
    throw new Error(`Агент ${directoryName}: поле name должно совпадать с директорией.`);
  }
  if (!agent.description || typeof agent.description !== 'string') {
    throw new Error(`Агент ${directoryName}: description обязателен.`);
  }
  if (!agent.models?.claude || !agent.models?.codex) {
    throw new Error(`Агент ${directoryName}: нужны модели Claude и Codex.`);
  }
  if (!['read-only', 'workspace-write', 'git-write'].includes(agent.access)) {
    throw new Error(`Агент ${directoryName}: access должен быть read-only, workspace-write или git-write.`);
  }
  if (!prompt.trim()) {
    throw new Error(`Агент ${directoryName}: prompt.md пуст.`);
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Некорректный JSON в ${filePath}: ${err.message}`);
    }
    throw err;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function isComponentName(name) {
  return /^eda-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}
