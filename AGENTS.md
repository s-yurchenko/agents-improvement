# Repository Instructions

This repository stores a personal Codex marketplace and custom plugins for improving agent workflows.

## Project Shape

- Keep the marketplace manifest at `.agents/plugins/marketplace.json`.
- Keep plugin folders under `plugins/<plugin-name>/`.
- Keep each plugin manifest at `plugins/<plugin-name>/.codex-plugin/plugin.json`.
- Keep skill folders under `plugins/<plugin-name>/skills/<skill-name>/`.
- Use `docs/plans/` for implementation plans before building new plugins or major workflow changes.

## Current Source of Truth

- The first planned implementation is described in `docs/plans/2026-05-11-agents-improvement-marketplace.md`.
- Do not invent additional plugins or automation beyond that plan unless the user asks for it.

## Git Workflow Preferences

- Default branch: `master`.
- Commit messages and PR descriptions should be in Russian unless a project-specific instruction says otherwise.
- Use Conventional Commits for commit messages:
  - allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`;
  - optional scope;
  - Russian summary.
- Before proposing a commit or PR, inspect `git status` and `git diff`, then run obvious project checks when they exist.
- Show the proposed commit message and PR body before creating a real commit or PR.
- Do not run `git commit`, `git push`, or PR creation commands without explicit user approval for that action.

## Editing Guidelines

- Prefer small, focused changes.
- Preserve existing marketplace and plugin manifest fields unless a task explicitly changes them.
- Validate JSON manifests after editing them.
- Keep instructions concise and practical; move long examples or reference material into `references/` files inside the relevant skill.
