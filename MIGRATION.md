# Миграция на eda 1.0

Версия 1.0 переводит `eda` с набора файлов-скилов на пакет с каноническими скилами и специализированными агентами для Claude Code и Codex CLI. Начиная с `1.0.2`, `eda update` заново спрашивает полный профиль настроек и записывает актуальный `docs/settings.yaml` версии 2 перед обновлением компонентов.

## Короткий путь

Обнови глобальный пакет:

```bash
npm install -g @gian-tiaga/eda@1
eda --version
```

Команда должна вывести актуальную версию ветки `1.0.x`.

В одном проекте выполни:

```bash
cd /path/to/project
eda update
```

Для нескольких проектов внутри одной директории можно выполнить:

```bash
eda update-all /path/to/projects
```

`update-all` ищет проекты на глубине до двух уровней, один раз спрашивает полный профиль настроек и записывает одинаковый `docs/settings.yaml` версии 2 во все найденные проекты. В non-TTY запуске вопросы не задаются: во все проекты записывается один профиль defaults.

После обновления перезапусти Claude Code или Codex CLI, чтобы среда перечитала установленные скилы и агентов.

## Что обновится автоматически

- Скилы будут синхронизированы в `.claude/skills/<skill>/SKILL.md` и `.codex/skills/<skill>/SKILL.md`.
- Старые управляемые Codex-файлы `.codex/skills/<skill>.md` будут удалены после установки соответствующего скила в новом формате.
- Установятся пакетные агенты в `.claude/agents/` и `.codex/agents/`.
- Retired-компоненты будут удалены только там, где ими владеет `eda`; чужие скилы и агенты установщик не удаляет.
- Корневые `AGENTS.md` и `CLAUDE.md` проекта установщик не создаёт и не перезаписывает.

Локальные изменения внутри управляемых `.claude/skills/eda-*`, `.codex/skills/eda-*`, `.claude/agents/eda-*` и `.codex/agents/eda-*` будут заменены. Если такие изменения нужны, сохрани их отдельно до запуска `eda update`.

## Переименованные и удалённые скилы

Обнови упоминания в документации, пользовательских командах и сохранённых workflow:

| До 1.0 | В 1.0 | Что изменилось |
|---|---|---|
| `eda-start` | `eda-new-project` | Стартовый бриф нового проекта и обязательный запуск `eda-prepare-ai` |
| `eda-docs` | `eda-prepare-ai` | Полный технический bootstrap: архитектура, правила, проверки, references и AI/MCP-процесс |
| `eda-execute` | `eda-plan-execute` | Выполнение плана по фазам через изолированных субагентов |
| `eda-automate` | `eda-discover-automations` | Полный baseline gap-аудит автоматизаций даже без истории |
| `eda-review-check` | `eda-review` | Специализированные проверки встроены в единый review-workflow |
| `eda-research` | `eda-explore` | Старое имя окончательно выведено из эксплуатации |

Установщик удалит старые управляемые копии, но не перепишет ссылки на имена скилов в документах проекта.

## Миграция `docs/settings.yaml`

Версия 1.0 поддерживает только формат настроек `version: 2`. При `eda update` ответь на полный набор вопросов: команда соберёт новый профиль и атомарно заменит прежний файл независимо от его версии. `eda update-all` задаст эти вопросы только один раз и применит ответы ко всем проектам.

`eda init` ведёт себя осторожнее: если конфиг уже существует, v2 и неизвестные версии сохраняются, а v1 автоматически мигрируется с переносом поддерживаемых значений. При update-командах прежний файл заменяется выбранным полным профилем, поэтому перед запуском сохрани нестандартные поля отдельно.

Основное соответствие полей:

| `version: 1` | `version: 2` |
|---|---|
| `defaults.strict` | `explore.strict`, `plan.strict`, `plan-polish.strict` |
| `defaults.plan_size` | `plan.size` |
| `defaults.decision_mode` | `explore.decision_mode`, `plan.decision_mode` |
| `defaults.test_strategy` | `plan.test_strategy` |
| `defaults.logging_strategy` | `plan.logging_strategy` |
| `automate.include_plans` | `discover-automations.include_plans` |
| `review.include_code_quality: true` | `review.agents.code_quality.mode: always` |
| `review.include_code_quality: false` | `review.agents.code_quality.mode: off` |

У старого `review.strict` нет прямого аналога. В 1.0 каждая проверка в `review.agents` отдельно получает режим `always`, `auto` или `off` и модели для Claude/Codex. Раздел `review-check` больше не используется.

Результат переноса старых общих настроек выглядит так:

```yaml
version: 2

explore:
  strict: false
  decision_mode: recommend_and_ask

plan:
  strict: false
  size: normal
  decision_mode: recommend_and_ask
  test_strategy: ask_each_time
  logging_strategy: ask_each_time

plan-polish:
  strict: false

discover-automations:
  include_plans: false
```

Новые разделы `orhestra`, `aim`, `review.agents` и `send-review` заполняются ответами на вопросы; в non-TTY запуске используются сбалансированные defaults. Полный актуальный пример приведён в [README](README.md).

## Проверка после миграции

Проверь версию CLI:

```bash
eda --version
```

Затем в каждом проекте проверь:

- в `docs/settings.yaml` указано `version: 2`;
- старые имена скилов больше не используются в документации и workflow;
- для выбранных сред появились каталоги скилов и агентов;
- `git status` показывает только ожидаемые изменения проекта.

Если среда ещё не была установлена в проект, используй `eda init` вместо `eda update`.
