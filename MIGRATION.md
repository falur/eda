# Миграция на eda 2.0

Версия 2.0 заменяет широкие итерации проверки планов специализированным workflow `eda-plan-review` → `eda-plan-review-fix` и переводит `docs/settings.yaml` на `version: 3`.

## Обновление

```bash
npm install -g @gian-tiaga/eda@2
eda --version
eda update
```

Версия CLI должна начинаться с `2.0`. После обновления перезапусти Claude Code или Codex CLI, чтобы среда перечитала новые скилы и агентов.

Для нескольких проектов:

```bash
eda update-all /path/to/projects
```

`configure` один раз спрашивает общий профиль v3 и записывает его во все проекты. `skip` сохраняет полный v3, но старые, неизвестные и неполные конфиги индивидуально переносит; отсутствующие значения получает из defaults. В non-TTY используется `skip`.

## Что изменилось

- Добавлены `eda-plan-review` и `eda-plan-review-fix`.
- Добавлены 12 read-only агентов `eda-plan-review-*` с отдельными зонами ответственности.
- `eda-plan-polish` теперь оркестрирует review/fix и по умолчанию ограничен тремя подтверждающими review-итерациями.
- Готовность требует одновременно отсутствия открытых findings и достижения threshold; любой finding блокирует `ready` независимо от score.
- У findings нет деления на required/optional: ревью сохраняет только доказанные ошибки и существенные неточности, которые обязательно исправить. ID и SHA-256 цепочка остаются стабильными.
- `eda-plan-review-fix` применяет все findings минимальным изменением плана, а `eda-plan` по `plan.review: true` запускает полный подтверждающий цикл `eda-plan-polish`.
- `eda-plan-polish strict` и `plan-polish.strict` удалены. `plan.strict` для кросс-CLI проверки самого `eda-plan` остаётся.
- npm-пакет использует `yaml` для безопасного переноса вложенного конфига.

## Умный перенос settings v3

Установщик разбирает старый файл как YAML, переносит валидные известные значения и спрашивает только отсутствующие в интерактивном терминале. После этого файл целиком атомарно записывается в нормализованном формате v3. Без TTY недостающие значения заменяются defaults.

Основные соответствия:

| Старое поле | Новое поле |
|---|---|
| `version: 1` или `version: 2` | `version: 3` |
| `plan.meta_review` | `plan.review` |
| `plan-polish.strict` | удалено |
| отсутствует | `plan-review.threshold: 95` |
| отсутствует | `plan-review.agents.*` |
| отсутствует | `plan-polish.limit: 3` |
| `defaults.strict` из v1 | `explore.strict`, `plan.strict` |
| `defaults.plan_size` из v1 | `plan.size` |
| `defaults.decision_mode` из v1 | `explore.decision_mode`, `plan.decision_mode` |
| `automate.include_plans` из v1/v2 | `discover-automations.include_plans` |

Также сохраняются валидные `orhestra.steps`, `aim`, `explore`, остальные поля `plan`, `review.agents`, `send-review` и `discover-automations`. Неизвестные пользовательские поля не входят в v3 и после нормализации удаляются.

## Новый plan-review профиль

```yaml
version: 3

plan:
  strict: false
  review: true
  size: normal
  decision_mode: recommend_and_ask
  test_strategy: ask_each_time
  logging_strategy: ask_each_time

plan-review:
  threshold: 95
  agents:
    requirements:
      mode: always
      model:
        claude: sonnet
        codex: gpt-5.6-terra
    architecture:
      mode: always
      model:
        claude: opus
        codex: gpt-5.6-sol

plan-polish:
  limit: 3
```

Полный профиль со всеми агентами создаётся установщиком и приведён в README.

## Проверка миграции

После `eda update` проверь:

- `docs/settings.yaml` содержит `version: 3`, `plan.review`, `plan-review.agents` и `plan-polish.limit`;
- в `.claude/agents/` или `.codex/agents/` установлены `eda-plan-review-*`;
- старые ссылки на `plan.meta_review` и `eda-plan-polish strict` удалены из локальных workflow;
- `git status` показывает только ожидаемую нормализацию настроек и обновление управляемых компонентов.

Установщик не создаёт и не перезаписывает корневой `AGENTS.md` пользовательского проекта и не удаляет чужие skills/agents.
