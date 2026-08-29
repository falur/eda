function yamlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function renderClaudeAgent(agent, prompt) {
  const tools = agent.access === 'workspace-write'
    ? 'Read, Glob, Grep, Bash, Write, Edit, NotebookEdit'
    : 'Read, Glob, Grep, Bash';
  const lines = [
    '---',
    `name: ${agent.name}`,
    `description: ${yamlString(agent.description)}`,
    `tools: ${tools}`
  ];

  if (agent.access !== 'workspace-write') lines.push('disallowedTools: Write, Edit, NotebookEdit');
  lines.push(`model: ${agent.models.claude}`);
  if (agent.reasoning?.claude) lines.push(`effort: ${agent.reasoning.claude}`);
  if (agent.access === 'read-only') lines.push('permissionMode: plan');

  lines.push('---', '', prompt.trimEnd(), '');
  return lines.join('\n');
}
