export function renderClaudeSkill(content, config = {}) {
  const model = config.models?.claude;
  const context = config.claude?.context;
  const agent = config.claude?.agent;
  const fields = [
    model && `model: ${model}`,
    context && `context: ${context}`,
    agent && `agent: ${agent}`
  ].filter(Boolean);

  if (fields.length === 0) return content;

  const closingMarker = content.indexOf('\n---', 4);
  if (!content.startsWith('---\n') || closingMarker === -1) {
    throw new Error('Не удалось добавить настройки Claude: некорректный front matter скила.');
  }

  return `${content.slice(0, closingMarker)}\n${fields.join('\n')}${content.slice(closingMarker)}`;
}
