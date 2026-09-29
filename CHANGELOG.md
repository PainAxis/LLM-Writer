# Changelog

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
