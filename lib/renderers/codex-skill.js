// Codex обрезает середину длинного вывода команды, и агент принимает остаток за прочитанный файл.
// Блок вставляется после front matter каждого скила, как адаптер OpenCode.
export const CODEX_READING_RULE = 'Читай файлы полностью. Вывод с пометкой `tokens truncated` или `truncated output` — не прочитанный файл: дочитай пропущенный диапазон по строкам (`sed -n \'A,Bp\'`) до последней строки. Файл больше 400 строк или 20 КБ сразу читай частями. Документы рамки (`AGENTS.md`, `docs/rules*`, `docs/arch*`, карточки `docs/business/` и `docs/references/`) и план — только целиком.';

const CODEX_INSTRUCTIONS = `## Среда исполнения: Codex

Этот раздел адаптирует только платформенные механизмы инструкции ниже; её scope, режимы исполнения, подтверждения и контракты результатов сохраняются.

- ${CODEX_READING_RULE}
- \`AskUserQuestion\` в инструкции — блокирующий вопрос: \`request_user_input\`, если инструмент доступен, иначе короткий вопрос с вариантами в чат и остановка до ответа. В \`codex exec\` не читай stdin, верни \`blocked: нужен ответ пользователя\`.
- \`Agent\` в инструкции — \`spawn_agent\` с \`fork_turns: "none"\`.
- Если инструкция требует Plan Mode, а Plan mode не включён, покажи полный текст в чате и остановись до подтверждения. План — документ из инструкции; \`update_plan\` его не заменяет.

`;

export function renderCodexSkill(content) {
  const closingMarker = content.indexOf('\n---', 4);
  if (!content.startsWith('---\n') || closingMarker === -1) {
    throw new Error('Не удалось добавить настройки Codex: некорректный front matter скила.');
  }
  const bodyStart = closingMarker + '\n---'.length;
  return `${content.slice(0, bodyStart)}\n\n${CODEX_INSTRUCTIONS}${content.slice(bodyStart).trimStart()}`;
}
