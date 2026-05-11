# Личный Marketplace `agents-improvement`

## Summary

Создать отдельный repo-local marketplace в `C:\Users\AFP\Git\agents-improvement`. Первый плагин будет `git-workflow` со skill `draft-commit-pr`, который формирует commit message и PR description по правилам пользователя, но не создает commit/PR без явного подтверждения.

## Key Changes

- Создать новый репозиторий:
  - root: `C:\Users\AFP\Git\agents-improvement`
  - marketplace: `.agents/plugins/marketplace.json`
  - plugins root: `plugins/`
  - plan file: `docs/plans/2026-05-11-agents-improvement-marketplace.md`
- Marketplace:
  - `name: "agents-improvement"`
  - `interface.displayName: "Agents Improvement"`
  - entry для `git-workflow`
  - `source.path: "./plugins/git-workflow"`
  - `policy.installation: "AVAILABLE"`
  - `policy.authentication: "ON_INSTALL"`
  - `category: "Productivity"`
- Plugin:
  - `plugins/git-workflow/.codex-plugin/plugin.json`
  - `skills: "./skills/"`
  - display name: `Git Workflow`
  - назначение: правила для git commit и PR подготовки.
- Skill:
  - `plugins/git-workflow/skills/draft-commit-pr/SKILL.md`
  - trigger: использовать, когда пользователь просит подготовить commit message, PR title/body, или просит сделать commit/PR.

## Commit / PR Rules

- Commit format: Conventional Commits.
- Типы: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
- `scope` опционален.
- Summary на русском.
- Перед финальным текстом Codex должен посмотреть `git status`, `git diff`, понять смысл изменений, найти и запустить очевидные проверки проекта, затем указать, что запускалось.
- PR body format:
  - `Summary`
  - `Tests`
  - `Notes/Risks` только если есть реальные риски, миграции, breaking changes или ручные действия.
- Codex сначала показывает proposed commit message и PR body. Реальный `git commit` или `gh pr create` выполняется только после явного подтверждения.

## Test Plan

- Проверить JSON-валидность `marketplace.json` и `plugin.json`.
- Проверить, что plugin entry указывает на `./plugins/git-workflow`.
- Проверить skill metadata: имя в kebab-case, description содержит реальные trigger-фразы.
- Прогнать сценарии: docs-only, feature + tests, fix с риском регрессии, и запрос "просто закоммить".
- Проверить, что skill не выполняет commit/PR без подтверждения.

## Assumptions

- Папка `C:\Users\AFP\Git` уже существует.
- Репозиторий будет создан как `C:\Users\AFP\Git\agents-improvement`.
- Plan file будет сохранен как `docs/plans/2026-05-11-agents-improvement-marketplace.md`.
- Plugin и skill имена: `git-workflow` и `draft-commit-pr`.
- Язык commit message и PR description: русский.
- На первом шаге делаем skill-инструкции без GitHub/GH automation scripts.
