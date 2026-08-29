# Миграция на eda 3.3

Версия 3.0 перенесла все рабочие результаты скилов в `docs/artifacts/`; постоянная документация проекта остаётся непосредственно в `docs/`. Версия 3.1 дополнительно переработала проверку плана, ревью кода и циклы полировки. Версия 3.2 обновила commit-flow и расположение проектных Codex-скиллов. В npm 3.0 не публиковалась, поэтому переход с 2.x выполняется сразу на актуальную версию 3.x.

## Обновление

```bash
npm install -g @gian-tiaga/eda@3
eda --version
eda update
```

Версия CLI должна начинаться с `3.2`. После обновления перезапусти Claude Code или Codex CLI, чтобы среда перечитала новые скилы и агентов.

Для нескольких проектов:

```bash
eda update-all /path/to/projects
```

`eda init` устанавливает новую версию компонентов, но не переносит старые артефакты. Для существующего проекта используй `eda update`.

## Новое расположение Codex-скиллов

Проектные скиллы Codex устанавливаются в `.agents/skills/<skill>/SKILL.md`. Агенты и manifest владения остаются соответственно в `.codex/agents/` и `.codex/eda-manifest.json`.

При `eda update` и `eda update-all` актуальные скиллы записываются в `.agents/skills/`, а известные принадлежащие `eda` копии из старых форматов `.codex/skills/<skill>/` и `.codex/skills/<skill>.md` удаляются. Чужие скиллы в старом каталоге не изменяются.

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

Версия npm-пакета и версия схемы настроек независимы: в eda 3.3 актуальным остаётся `docs/settings.yaml` с `version: 3`.

Установщик по-прежнему сохраняет полный валидный v3 байт-в-байт — кроме случая, когда в файле остались устаревшие ключи: тогда он перезаписывает файл без вопросов и печатает, что именно убрал. Старый, неизвестный или неполный YAML нормализуется: известные валидные значения переносятся, а отсутствующие спрашиваются в TTY или получают defaults без TTY.

В `eda update-all` режим `configure` один раз спрашивает общий профиль v3 и записывает его во все проекты. Режим `skip` сохраняет полный v3, индивидуально переносит остальные конфиги и создаёт defaults только при отсутствии файла.

## Ревью и полировка

Что в 3.x изменится в уже настроенном проекте:

- **Удалены двенадцать агентов `eda-plan-review-*`.** Проверку плана целиком выполняет один субагент по фиксированному чек-листу. `eda update` стирает файлы этих агентов из `.claude/agents/` и `.codex/agents/`.
- **Секция `plan-review.agents` больше не читается.** Начиная с 3.1.1 `eda update` находит её в готовом файле настроек и убирает вместе с другими устаревшими ключами — `review-check`, `review.strict`, `review.include_code_quality`. Дефолт `plan-review.threshold` — `100`, `plan-polish.limit` — `2`.
- **У `eda-polish` больше нет порога.** Цикл завершается только при нуле находок и останавливается досрочно, если за круг число открытых находок не сократилось. Аргумент вида `args: "threshold 90 limit 2"` в шаге оркестратора `eda update` приводит к виду `args: "limit 2"`.
- **Формат ревью дополнен.** У каждой находки появилось поле `repro` — чем проблема воспроизводится, — а в отчёт добавлен раздел «Отклонено» с причинами отклонения. `eda-fix-by-review` может отклонить находку, но только фактически неверную и с обоснованием в отчёте. Старые файлы ревью читаются как есть.

## Проверка миграции

После `eda update` проверь:

- старые рабочие каталоги исчезли из `docs/`, а файлы находятся в `docs/artifacts/`;
- `docs/business.md`, `docs/business/`, `docs/references.md`, `docs/references/`, `docs/arch.md` и `docs/rules.md` остались на месте;
- `docs/settings.yaml` содержит `version: 3`;
- `eda --version` выводит версию `3.3.x`;
- в `docs/settings.yaml` нет секции `plan-review.agents` и аргумента `threshold N` у шага `eda-polish`;
- в `.claude/agents/` и `.codex/agents/` не осталось файлов `eda-plan-review-*`;
- Claude-скиллы установлены в `.claude/skills/`, Codex-скиллы — в `.agents/skills/`, агенты — в `.claude/agents/` и `.codex/agents/`.

Установщик не создаёт и не перезаписывает корневой `AGENTS.md` пользовательского проекта и не удаляет чужие skills/agents.
