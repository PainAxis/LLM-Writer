# LLM-Writer Roadmap

[English](ROADMAP.md) | [简体中文](ROADMAP.zh-CN.md)

See [Project Structure](PROJECT_STRUCTURE.md) for the current implementation layout and [Changelog](CHANGELOG.md) for released changes. The order below is a suggested priority, not a release commitment.

Completed foundations:

- PR/main CI enforces zero lint warnings, type checking, production builds, module smoke suites and real Chromium regression with a synthetic API.
- ShortStory uses isolated generation scopes for articles, stories, continuation and optimization, with cancellation/restart/clear/dialog-close/unmount coverage.
- The undici patch is included in [v1.0.0](https://github.com/PainAxis/LLM-Writer/releases/tag/v1.0.0). Releases include a static ZIP, checksum and source/CI metadata.
- The first extraction increment separates typed prompt/config/import/list modules and UI components from ShortStory, BookAnalysis, NovelManagement and ToolsLibrary. Their parent scripts are not yet fully migrated to TypeScript.

Next work:

1. **Require CI before merging into main.** Add the existing `ci-quality` and `ci-browser` checks to the main ruleset; workflow execution alone does not enforce a merge gate.
2. **Unify remaining generation lifecycles.** Migrate BookAnalysis analysis/summary, NovelManagement description generation and ToolsLibrary generation to isolated controllers. Cover source changes, dialog closure, unmount, late results and progress timer cleanup.
3. **Continue TypeScript migration in views.** Move remaining orchestration into typed controllers, then migrate parent pages to `lang="ts"` in the order ShortStory → BookAnalysis → NovelManagement → ToolsLibrary. Restore `vue/block-lang` once the view migration is complete.
4. **Add editable mind maps.** Define how edits are validated and written back to the novel store before enabling editing in the current read-only view.
5. **Support per-assistant context policies.** Connect the reserved `AssistantInfo.contextPolicy` field to configuration and runtime policy selection; assistants currently use the global policy.

Further candidates:

- Virtualize long assistant message lists.
- Consolidate the legacy store corpus and Writer's `corpusData`.
- Adjust the mind-map canvas background for dark mode.
