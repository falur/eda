# Миграция на eda 3.0

Версия 3.0 переносит все рабочие результаты скилов в `docs/artifacts/`. Постоянная документация проекта остаётся непосредственно в `docs/`.

## Обновление

```bash
npm install -g @gian-tiaga/eda@3
eda --version
eda update
```

Версия CLI должна начинаться с `3.0`. После обновления перезапусти Claude Code или Codex CLI, чтобы среда перечитала новые скилы и агентов.

Для нескольких проектов:

```bash
eda update-all /path/to/projects
```

`eda init` устанавливает новую версию компонентов, но не переносит старые артефакты. Для существующего проекта используй `eda update`.

## Новая структура

Из управляемых eda файлов в корне `docs/` остаются постоянные документы:

```text
docs/
├── settings.yaml
├── rules.md
├── arch.md
├── business.md
├── business/
├── references.md
├── references/
└── artifacts/
```

Рабочие каталоги получают общий префикс `docs/artifacts/`:

| До 3.0 | Начиная с 3.0 |
|---|---|
| `docs/aims/` | `docs/artifacts/aims/` |
| `docs/automations/` | `docs/artifacts/automations/` |
| `docs/executions/` | `docs/artifacts/executions/` |
| `docs/fixes/` | `docs/artifacts/fixes/` |
| `docs/manual-tests/` | `docs/artifacts/manual-tests/` |
| `docs/plan-review-fixes/` | `docs/artifacts/plan-review-fixes/` |
| `docs/plan-reviews/` | `docs/artifacts/plan-reviews/` |
| `docs/plans/` | `docs/artifacts/plans/` |
| `docs/project-starts/` | `docs/artifacts/project-starts/` |
| `docs/researches/` | `docs/artifacts/researches/` |
| `docs/review-fixes/` | `docs/artifacts/review-fixes/` |
| `docs/reviews/` | `docs/artifacts/reviews/` |
| `docs/roadmaps/` | `docs/artifacts/roadmaps/` |

## Автоматический перенос

`eda update` и `eda update-all` перед обновлением настроек и компонентов рекурсивно объединяют каждый старый каталог с соответствующим каталогом в `docs/artifacts/`.

- Неконфликтующие файлы и вложенные каталоги перемещаются.
- Если одинаковый относительный путь уже существует в `docs/artifacts/`, новый объект сохраняется, а старый удаляется.
- Содержимое файлов не переписывается, поэтому SHA-256 планов и ревью не меняется.
- Старые пути, записанные внутри исторических Markdown-файлов, остаются текстом как есть и могут больше не открываться.
- Неизвестные пользовательские файлы и каталоги в `docs/` не переносятся и не удаляются.
- Повторный запуск безопасен: при отсутствии старых каталогов перенос ничего не меняет.

После обновления скилы работают только с путями внутри `docs/artifacts/`. Fallback на старые каталоги и path aliases не поддерживаются.

## Настройки

Версия npm-пакета и версия схемы настроек независимы: в eda 3.0 актуальным остаётся `docs/settings.yaml` с `version: 3`.

Установщик по-прежнему сохраняет полный валидный v3 байт-в-байт. Старый, неизвестный или неполный YAML нормализуется: известные валидные значения переносятся, а отсутствующие спрашиваются в TTY или получают defaults без TTY.

В `eda update-all` режим `configure` один раз спрашивает общий профиль v3 и записывает его во все проекты. Режим `skip` сохраняет полный v3, индивидуально переносит остальные конфиги и создаёт defaults только при отсутствии файла.

## Проверка миграции

После `eda update` проверь:

- старые рабочие каталоги исчезли из `docs/`, а файлы находятся в `docs/artifacts/`;
- `docs/business.md`, `docs/business/`, `docs/references.md`, `docs/references/`, `docs/arch.md` и `docs/rules.md` остались на месте;
- `docs/settings.yaml` содержит `version: 3`;
- `eda --version` выводит версию `3.0.x`;
- в `.claude/` или `.codex/` установлены обновлённые скилы и агенты.

Установщик не создаёт и не перезаписывает корневой `AGENTS.md` пользовательского проекта и не удаляет чужие skills/agents.
