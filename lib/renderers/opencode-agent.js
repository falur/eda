import { stringify } from 'yaml';

export function renderOpenCodeAgent(agent, prompt) {
  const metadata = {
    description: agent.description,
    mode: 'subagent'
  };
  // Без явного provider/model OpenCode наследует модель родительской сессии.
  if (agent.models?.opencode) metadata.model = agent.models.opencode;
  if (agent.access === 'read-only') {
    metadata.permissions = [
      { action: '*', resource: '*', effect: 'deny' },
      ...['read', 'glob', 'grep', 'webfetch', 'websearch'].map(action => ({
        action, resource: '*', effect: 'allow'
      })),
      { action: 'read', resource: '*.env', effect: 'ask' },
      { action: 'read', resource: '*.env.*', effect: 'ask' }
    ];
  } else if (agent.access === 'git-write') {
    metadata.permissions = [{ action: 'edit', resource: '*', effect: 'deny' }];
  }
  return `---\n${stringify(metadata)}---\n\n${prompt.trimEnd()}\n`;
}
