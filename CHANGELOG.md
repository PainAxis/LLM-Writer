# Changelog

## [Unreleased]

- Isolated book analysis/digest, novel description and tool generation requests; stop, source changes, dialog closure and unmount abort streams and reject late writes.
- Chapter digests retain the previous result until a replacement succeeds; closed novel forms discard pending cover reads.
- Removed simulated tool progress timers and added lifecycle module/browser regressions.

- Migrated ShortStory, BookAnalysis, NovelManagement and ToolsLibrary parent views and Workspace orchestration to TypeScript, with an enforced language rule for these pages.
- Fixed ShortStory exports containing an undefined synopsis and novel-detail chapter editing links; sparse legacy titles and numeric timestamps remain usable.
- ShortStory configuration resets now create independent default values and await persistence.
- Book imports ignore superseded results and retain the last usable document after a failed replacement.
- Novel list sorting preserves the source collection order and uses actual chapter counts.
- Tool template replacements preserve literal dollar characters in user input.
- Added module and browser regressions for these feature boundaries and refreshed the project structure and roadmap.

## [1.0.0]

Initial tagged release of LLM-Writer, a browser-based AI writing workspace.

- Modular Writer workspace with isolated generation controllers, chapter management, continuation, optimization and writing materials.
- Browser-local persistence, portable backups, IndexedDB storage for large chapter bodies and DOCX import.
- Fixed ShortStory cancellation, restart, dialog closure and unmount races across articles, stories, continuation and optimization.
- Cancelled pending editor selection events before teardown to prevent intermittent navigation errors.
- Patched the transitive undici dependency to 7.29.1 for GHSA-3wwx-pv8p-q78v.
- Added continuous lint, type checking, production builds, all smoke suites and Chromium regression with a synthetic API.
- Replaced outdated refactoring reports with separate project structure and roadmap documents.

The distribution ZIP is a static website. It requires a static HTTP server and a user-configured AI provider; it contains no credentials or user writing data.
