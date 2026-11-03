import { cancel, intro, isCancel, log, multiselect, outro, select, updateSettings } from '@clack/prompts';

updateSettings({ messages: { cancel: 'Отменено', error: 'Ошибка' } });

// Промпты принимают { message, choices: [{ value, name, description, checked }], default },
// поэтому установщик и тесты не зависят от API конкретной TUI-библиотеки.
// Подсказки clack по клавишам англоязычные, поэтому они отключены и заменены своими.

export async function selectPrompt({ message, choices, default: initialValue }, { input, output } = {}) {
  const value = await select({
    message,
    options: choices.map(toOption),
    initialValue,
    showInstructions: false,
    input,
    output
  });
  return unlessCancelled(value, output);
}

export async function checkboxPrompt({ message, choices, required = false }, { input, output } = {}) {
  for (;;) {
    const value = unlessCancelled(await multiselect({
      message: `${message}\nПробел — отметить, Enter — продолжить`,
      options: choices.map(toOption),
      initialValues: choices.filter(choice => choice.checked).map(choice => choice.value),
      required: false,
      showInstructions: false,
      input,
      output
    }), output);
    if (!required || value.length > 0) return value;
    log.warn('Отметьте хотя бы один вариант.', { output });
  }
}

export function startPrompts(title, { output } = {}) {
  intro(title, { output });
}

export function finishPrompts(message, { output } = {}) {
  outro(message, { output });
}

function toOption({ value, name, description }) {
  return { value, label: name, ...(description ? { hint: description } : {}) };
}

function unlessCancelled(value, output) {
  if (!isCancel(value)) return value;
  cancel('Установка прервана.', { output });
  throw new Error('Установка прервана пользователем.');
}
