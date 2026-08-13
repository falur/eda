function yamlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function renderClaudeAgent(agent, prompt) {
  const lines = [
    '---',
    `name: ${agent.name}`,
    `description: ${yamlString(agent.description)}`,
    'tools: Read, Glob, Grep, Bash',
    'disallowedTools: Write, Edit, NotebookEdit',
    `model: ${agent.models.claude}`
  ];

  if (agent.reasoning?.claude) lines.push(`effort: ${agent.reasoning.claude}`);
  if (agent.access === 'read-only') lines.push('permissionMode: plan');
  if (agent.maxTurns) lines.push(`maxTurns: ${agent.maxTurns}`);

  lines.push('---', '', prompt.trimEnd(), '');
  return lines.join('\n');
}
