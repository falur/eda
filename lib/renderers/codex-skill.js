// Codex обрезает середину длинного вывода команды, и агент принимает остаток за прочитанный файл.
// Блок вставляется после front matter каждого скила, как адаптер OpenCode.
export const CODEX_READING_RULE = 'Читай файлы полностью. Вывод с пометкой `tokens truncated` или `truncated output` — не прочитанный файл: дочитай пропущенный диапазон по строкам (`sed -n \'A,Bp\'`) до последней строки. Файл больше 400 строк или 20 КБ сразу читай частями. Документы рамки (`AGENTS.md`, `docs/rules*`, `docs/arch*`, карточки `docs/business/` и `docs/references/`) и план — только целиком.';

// Окно request_user_input Codex сворачивает само, и пользователь не видит, что агент ждёт ответа.
// Поэтому в Codex вопросы задаются только текстом в чат — и в скилах, и в агентах.
export const CODEX_QUESTIONS_RULE = 'Интерактивного инструмента вопросов в Codex нет: не вызывай `request_user_input`, даже если он доступен, — Codex сворачивает его окно, и непонятно, что агент ждёт ответа.';

const CODEX_INSTRUCTIONS = `## Среда исполнения: Codex

Этот раздел адаптирует только платформенные механизмы инструкции ниже; её scope, режимы исполнения, подтверждения и контракты результатов сохраняются.

- ${CODEX_READING_RULE}
- ${CODEX_QUESTIONS_RULE} \`AskUserQuestion\` в инструкции — вопросы в чат по разделу «Вопросы текстом»: задав их, заверши ход этим сообщением и до ответа пользователя ничего не делай. В \`codex exec\` не читай stdin, верни \`blocked: нужен ответ пользователя\` с вопросами в том же формате.
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
