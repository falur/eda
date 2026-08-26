---
name: eda-plan-polish
description: 'Оркестрирует review и исправления готового плана до подтверждённой оценки готовности.'
---

# Скил: Полировка плана (eda-plan-polish)

Оркестрируй цикл `eda-plan-review` → `eda-plan-review-fix apply-optional` → повторный `eda-plan-review`. Основной агент только выбирает план, запускает каждый скил в отдельном изолированном субагенте, проверяет артефакты и управляет остановкой.

## Вход из сообщения пользователя

Текст рядом с вызовом — главный вход. Разбери путь или название плана, «последний план», threshold, limit, отключённые/принудительные проверки, разовые модели и ограничения. Передавай overrides в каждый review.

Если план выбирается однозначно, продолжай без вопроса. При нескольких равных вариантах передай выбор первому `eda-plan-review` или используй `AskUserQuestion` по правилам среды.

## Настройки

Прочитай `docs/settings.yaml`, если файл есть. Поддерживается только `version: 3`; иначе используй defaults и предупреди.

- threshold берётся из `plan-review.threshold`, default `95`, допустим `1–100`;
- limit берётся из `plan-polish.limit`, default `3`, это положительное целое число;
- прямые `threshold N` и `limit N` важнее settings.

`strict` и кросс-CLI не поддерживаются. Не читай устаревшие поля настроек и не запускай соседний CLI: используй только специализированный workflow этого скилла.

## Правила

1. Каждый вызов `eda-plan-review` и `eda-plan-review-fix apply-optional` запускай отдельным изолированным субагентом с чистым контекстом.
2. Если нативные субагенты или вложенная делегация недоступны, остановись; не выполняй review/fix основным агентом и не используй CLI-fallback.
3. Успех определяется только review со статусом `ready`, без required findings и `score >= threshold`.
4. Limit считает подтверждающие review-итерации. После review на последней итерации не запускай fix, который нельзя перепроверить.
5. Основной агент не делает содержательных правок плана. После ready он может обновить только front matter: `status`, `plan_review`, `plan_review_fix`.
6. Не запускай проверки проекта и не коммить.

## Вопросы

Если вложенный скил вернул `blocked` с вопросом, передай пользователю только этот вопрос и после ответа продолжи тот же шаг с полным предыдущим контекстом.

- Claude Code: `AskUserQuestion`.
- Codex interactive: `request_user_input`, если доступен, иначе короткий вопрос с вариантами.
- Codex exec/non-interactive: остановись `blocked: нужен ответ пользователя`.

## Цикл

Сформируй `$PLAN_FILE`, `$THRESHOLD`, `$LIMIT` и внутренний журнал: iteration, review path, plan SHA-256, score, состояния findings, fix path и причина продолжения.

Для `$ITERATION` от `1` до `$LIMIT`:

1. Запусти новый изолированный субагент:

   ```text
   Используй eda-plan-review для <PLAN_FILE> с threshold <THRESHOLD>.
   Previous review: <PREVIOUS_REVIEW | none>.
   Previous fix: <PREVIOUS_FIX | none>.
   Overrides проверок и моделей: <из текущего вызова | none>.
   Верни путь, status, plan_sha256, score, required/optional ID и coverage.
   ```

2. Прочитай review-артефакт и проверь, что status/score/threshold/findings согласованы.
3. Если status `ready`, обнови front matter плана: `status: reviewed`, `plan_review: <REVIEW_FILE>`, `plan_review_fix: <последний FIX_FILE | none>`. Заверши успешно.
4. Если это последняя разрешённая review-итерация, остановись `достигнут limit`; fix не запускай.
5. Если относительно предыдущего review не изменились open/resolved/regressed/waived ID и score, остановись `blocked: review не показывает прогресса`.
6. Если ниже gate нет применимых findings, остановись `blocked: нет применимых правок для повышения оценки`.
7. Запусти новый изолированный субагент:

   ```text
   Используй eda-plan-review-fix apply-optional для <REVIEW_FILE>.
   Примени все required, самостоятельно разбери optional и сохрани waived с причинами.
   Верни путь к fix, before_sha256, after_sha256, applied и waived ID.
   ```

8. Проверь, что `before_sha256` равен `plan_sha256` review. Если `after_sha256` равен `before_sha256`, остановись `blocked: fix не изменил план`.
9. Сохрани review/fix как previous chain и начни следующую review-итерацию.

Score не повышай и не пересчитывай сам: используй только полный `eda-plan-review`.

## Финал

Сообщи результат (`ready`, limit, no progress, no applicable fixes или blocked), план, последний review/fix, score/threshold, число review-итераций, open ID и coverage warnings. При ready предложи `eda-plan-execute`; при неуспехе перечисли конкретные оставшиеся findings.

## Чего НЕ делать

- Делать review, выставлять score или исправлять содержание плана основным агентом.
- Запускать старые три общих ревью одним промптом.
- Запускать кросс-CLI, `strict`, `codex exec` или `claude -p`.
- Запускать fix после последней review-итерации.
- Ждать два одинаковых круга: один подтверждённый круг без прогресса уже останавливает цикл.
- Писать длинный журнал полировки в план, менять код или запускать проверки проекта.
