---
plan: docs/plans/2026-05-08_15-00_skill-inline-prompt-context.md
started: 2026-05-08 17:15
finished: 2026-05-08 17:20
status: done
---

# Журнал: Учёт текста рядом с вызовом eda-скиллов

## Шаги
| # | Шаг | Файлы | Тесты | Статус |
|---|-----|-------|-------|--------|
| 1 | Добавить общее правило входа во все скиллы | `docs/skills/eda-*.md`, `.codex/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md` | `rg -c "^## Вход из сообщения пользователя$" docs/skills .codex/skills .claude/skills` | done |
| 2 | Исправить `eda-plan` | `docs/skills/eda-plan.md`, `.codex/skills/eda-plan/SKILL.md`, `.claude/skills/eda-plan/SKILL.md` | `npm test` | done |
| 3 | Уточнить скиллы, которые выбирают файл или диапазон | `docs/skills/eda-execute.md`, `docs/skills/eda-fix-by-review.md`, `docs/skills/eda-send-review.md`, `docs/skills/eda-automate.md`, `docs/skills/eda-docs.md` и локальные копии | `npm test` | done |
| 4 | Уточнить скиллы, которые уже близки к нужному поведению | `docs/skills/eda-research.md`, `docs/skills/eda-fix.md`, `docs/skills/eda-review.md`, `docs/skills/eda-commit.md` и локальные копии | `npm test` | done |
| 5 | Добавить тесты на содержание скиллов | `test/install.test.js` | `npm test` — 6 passed | done |
| 6 | Проверить синхронизацию и пакет | `docs/skills/eda-*.md`, `.codex/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md`, `package.json` | `npm test` — 6 passed; `npm_config_cache=/tmp/eda-npm-cache npm pack --dry-run` — ok; `git diff --check` — ok | done |

## Заметки
- Выполнение в текущей ветке `main` по выбору пользователя.
- `docs/rules.md` и `docs/arch.md` отсутствуют.

## Изменения в docs
- Новых правил для `docs/rules.md` или `docs/arch.md` не требуется; файлы отсутствуют и задача касается только текстов скиллов.

## Финальная проверка
| Команда | Результат | Заметки |
|---------|-----------|---------|
| `npm test` | ok | 6 тестов прошли |
| `npm_config_cache=/tmp/eda-npm-cache npm pack --dry-run` | ok | пакет собирается, tarball не создан |
| `git diff --check` | ok | whitespace-проблем нет |
