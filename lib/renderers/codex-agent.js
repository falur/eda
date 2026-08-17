function tomlString(value) {
  return JSON.stringify(value);
}

export function renderCodexAgent(agent, prompt) {
  if (prompt.includes('"""')) {
    throw new Error(`Промпт агента ${agent.name} содержит неподдерживаемую последовательность тройных кавычек.`);
  }

  const lines = [
    `name = ${tomlString(agent.name)}`,
    `description = ${tomlString(agent.description)}`,
    `model = ${tomlString(agent.models.codex)}`
  ];

  if (agent.reasoning?.codex) {
    lines.push(`model_reasoning_effort = ${tomlString(agent.reasoning.codex)}`);
  }
  if (agent.access === 'read-only') lines.push('sandbox_mode = "read-only"');
  if (agent.access === 'workspace-write') lines.push('sandbox_mode = "workspace-write"');

  lines.push('developer_instructions = """', prompt.trimEnd(), '"""', '');
  return lines.join('\n');
}
