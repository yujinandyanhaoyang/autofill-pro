# Repository Guidelines

## Project Structure & Module Organization
This repository is currently in bootstrap stage. At the moment, the tracked workspace contains `start_codex.bat`, which starts Codex with local proxy variables. As the browser autofill extension is added, keep the layout explicit:

- `src/` for extension source code such as background scripts, content scripts, popup UI, and shared utilities
- `tests/` for automated tests mirroring `src/` structure
- `assets/` for icons, screenshots, and static files
- `docs/` for design notes, permission rationale, and browser-specific behavior

Prefer feature-based folders once multiple extension surfaces exist, for example `src/content/`, `src/popup/`, and `src/core/`.

## Build, Test, and Development Commands
Current command:

- `start_codex.bat` launches Codex with `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` configured for local development

When build tooling is introduced, expose standard entry points and document them here, for example:

- `npm install` to install dependencies
- `npm run dev` to watch and rebuild the extension
- `npm test` to run the test suite
- `npm run lint` to check formatting and static issues

Do not add one-off scripts when a standard package script will do.

## Coding Style & Naming Conventions
Use 2-space indentation for JavaScript, TypeScript, JSON, and CSS. Prefer TypeScript for new logic. Use:

- `camelCase` for variables and functions
- `PascalCase` for classes and UI components
- `kebab-case` for file names such as `form-parser.ts`

Keep modules small and single-purpose. Name files by behavior, not by vague helpers.

## Testing Guidelines
Place tests under `tests/` or beside source as `*.test.ts`. Mirror source paths so ownership is obvious. Focus tests on field detection, mapping rules, and failure cases across different DOM structures. Add regression tests for every autofill bug that reaches code review.

## Commit & Pull Request Guidelines
This repository has no commit history yet, so adopt a consistent format now: `type(scope): summary`, for example `feat(content): detect address fields`. Keep commits narrow and explain why the change exists, not just what changed.

Pull requests should include a short problem statement, the chosen approach, screenshots or recordings for UI changes, and test evidence. Link any related issue or task explicitly.

## Security & Configuration Tips
Do not commit real user data, API keys, or browser profile exports. Keep proxy or environment-specific settings out of extension runtime code unless they are required and documented.
