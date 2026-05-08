---
review: docs/reviews/2026-05-08_17-33_uncommitted-inline-prompt-context.md
date: 2026-05-08 17:43
status: done
---

# Фиксы по ревью: Незакоммиченные изменения inline-входа eda-скиллов

## Применённые правки
| # | Замечание | Файлы | Тесты | Статус |
|---|-----------|-------|-------|--------|
| 1 | Конфликт в `eda-send-review` между обязательным подтверждением типа отправки и inline `comment` / `review-comment` | `docs/skills/eda-send-review.md`, `.codex/skills/eda-send-review/SKILL.md`, `.claude/skills/eda-send-review/SKILL.md`, `test/install.test.js` | `npm test` — 8 passed | применено |
| 2 | `eda-fix-by-review` разрешает inline-замечания без файла, но дальше требует `$REVIEW_FILE` | `docs/skills/eda-fix-by-review.md`, `.codex/skills/eda-fix-by-review/SKILL.md`, `.claude/skills/eda-fix-by-review/SKILL.md`, `test/install.test.js` | `npm test` — 8 passed | применено |
| 3 | Добавить content-тесты на специальные сценарии `eda-send-review` и `eda-fix-by-review` | `test/install.test.js` | `npm test` — 8 passed | применено |

## Финальная проверка
| Команда | Результат | Заметки |
|---------|-----------|---------|
| `npm test` | ok | 8 тестов прошли |
| `npm_config_cache=/tmp/eda-npm-cache npm pack --dry-run` | ok | пакет собирается, tarball не создан |
| `git diff --check` | ok | whitespace-проблем нет |
| Сравнение `docs/skills` с `.codex/skills` и `.claude/skills` | ok | расхождений нет |

## Открытые вопросы
Нет.
