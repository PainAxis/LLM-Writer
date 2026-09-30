# LLM-Writer Roadmap

[English](ROADMAP.md) | [简体中文](ROADMAP.zh-CN.md)

See [Project Structure](PROJECT_STRUCTURE.md) for the current implementation layout and [Changelog](CHANGELOG.md) for released changes. The order below is a suggested priority, not a release commitment.

Completed foundations:

- PR/main CI enforces zero lint warnings, type checking, production builds, module smoke suites and real Chromium regression with a synthetic API.
- The main ruleset requires GitHub Actions `ci-quality` and `ci-browser` checks and an up-to-date branch before merging.
- ShortStory uses isolated generation scopes for articles, stories, continuation and optimization, with cancellation/restart/clear/dialog-close/unmount coverage.
- BookAnalysis, NovelManagement and ToolsLibrary generation use isolated scopes covering stop, source changes, dialog closure and unmount; tool progress no longer uses simulated timers.
- The undici patch is included in [v1.0.0](https://github.com/PainAxis/LLM-Writer/releases/tag/v1.0.0). Releases include a static ZIP, checksum and source/CI metadata.
- ShortStory, BookAnalysis, NovelManagement and ToolsLibrary parent views and Workspace controllers are fully typed. `vue/block-lang` requires `lang="ts"` for these four pages; unrelated legacy views retain their migration exception.

Next work:

1. **Add editable mind maps.** Define how edits are validated and written back to the novel store before enabling editing in the current read-only view.
2. **Support per-assistant context policies.** Connect the reserved `AssistantInfo.contextPolicy` field to configuration and runtime policy selection; assistants currently use the global policy.

Further candidates:

- Migrate other legacy views and gradually remove their TypeScript language-rule exceptions.
- Virtualize long assistant message lists.
- Consolidate the legacy store corpus and Writer's `corpusData`.
- Adjust the mind-map canvas background for dark mode.
