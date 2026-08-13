export function renderClaudeSkill(content, config = {}) {
  const model = config.models?.claude;
  if (!model) return content;

  const closingMarker = content.indexOf('\n---', 4);
  if (!content.startsWith('---\n') || closingMarker === -1) {
    throw new Error('Не удалось добавить Claude model override: некорректный front matter скила.');
  }

  return `${content.slice(0, closingMarker)}\nmodel: ${model}${content.slice(closingMarker)}`;
}
