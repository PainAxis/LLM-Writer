# LLM-Writer Roadmap

[English](ROADMAP.md) | [简体中文](ROADMAP.zh-CN.md)

See [Project Structure](PROJECT_STRUCTURE.md) for the current implementation layout and [Changelog](CHANGELOG.md) for released changes.

Completed foundations:

- PR/main CI enforces zero lint warnings, type checking, production builds, 53 smoke suites and 28 real Chromium scenarios with a synthetic API.
- The main ruleset requires GitHub Actions `ci-quality` and `ci-browser` checks and an up-to-date branch before merging.
- ShortStory uses isolated generation scopes for articles, stories, continuation and optimization, with cancellation/restart/clear/dialog-close/unmount coverage.
- BookAnalysis, NovelManagement and ToolsLibrary generation use isolated scopes covering stop, source changes, dialog closure and unmount; tool progress no longer uses simulated timers.
- The undici patch is included in [v1.0.0](https://github.com/PainAxis/LLM-Writer/releases/tag/v1.0.0). Releases include a static ZIP, checksum and source/CI metadata.
- All views use TypeScript, and `vue/block-lang` requires `lang="ts"` throughout `src/views`. Shared domain types cover management data, form handles and legacy timestamps. The four feature Workspace controllers are fully typed.
- Editable mind maps validate title/entity changes, preserve retained bodies and metadata, repair links, reject stale snapshots and await persistence; see [the editing protocol](docs/mindmap-editing.md).
- Assistants can follow global or custom context policies across configuration, sending, compaction and retry. Legacy assistants follow global settings; full local histories and backup compatibility are preserved. See [policy semantics](docs/assistant-context-policy.md).
- Assistant message lists use measured virtual rows and preserve scroll intent while streaming; full history remains in context processing and backups.
- Corpus has one source in each novel's `corpusData`; Writer imports legacy standalone JSON, exports portable files and waits for atomic persistence. See [corpus data](docs/corpus.md).
- Mind maps follow light, dark and system themes without replacing the editable graph; PNG exports use the active background.
- Both writing-goal entry points share persistence, notes/history and local-calendar activity streaks. ShortStory and BookAnalysis have separate typed feature components and page-owned editor/generation controllers. The development dependency patch is complete.

The final four reliability workstreams are complete:

- Shared prompt initialization and migration work from every entry point, preserve user records/deletions and surface malformed stored data without overwriting it.
- Prompt, API/configuration, genre and assistant management report success only after storage commits; failed operations retain state or drafts for retry.
- Novel and writing-goal commits coordinate across tabs. Different novels merge independently; conflicting changes to one novel keep the local draft and require copying it, refreshing/reopening the novel and merging manually. Concurrent goal increments retain both histories. This coordination is scoped to novels/goals; see [the persistence protocol](docs/persistence-coordination.md).
- Assistant summaries record their covered message boundary, so sending combines a committed summary with uncovered originals. Failed or pending compaction retains the previous usable boundary and full local history.

The first batch of existing-feature repairs is complete: exact ShortStory selection replacement, stable chapter/event links, a persistent book-analysis reference library, and isolated API draft testing/model synchronization. Further feature work starts with the remaining user workflow findings before adding new capabilities. Implementation details and validation remain documented in [Project Structure](PROJECT_STRUCTURE.md), CI and the unreleased changelog.
