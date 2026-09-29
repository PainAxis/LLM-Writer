# LLM-Writer Project Structure

[English](PROJECT_STRUCTURE.md) | [简体中文](PROJECT_STRUCTURE.zh-CN.md)

This overview describes the current source layout. Planned work is tracked in the [roadmap](ROADMAP.md).

## Top Level

| Path | Purpose |
|------|---------|
| `src/` | Application source |
| `public/` | Static assets, including the favicon |
| `scripts/` | Module smoke tests, browser regression, preview tools, release validation and deployment scripts |
| `scripts/fixtures/` | Synthetic document-import fixtures |
| `.github/workflows/` | Continuous validation, CI-gated releases and the optional temporary browser preview |
| `package.json`, `package-lock.json` | Dependencies, locked versions and npm commands |
| `vite.config.ts`, `tsconfig.json`, `eslint.config.js` | Build, TypeScript and lint configuration |
| `Dockerfile`, `docker-compose.yml`, `nginx.conf` | Development and production deployment |

## Source

| Path | Purpose |
|------|---------|
| `src/main.ts`, `src/App.vue` | Application startup, persistence initialization and loading/error states |
| `src/style.css` | Shared design tokens, Element Plus variables and dark theme |
| `src/router/index.ts` | Hash routing, lazy-loaded views and the fallback page |
| `src/views/` | Feature pages: Writer, novel management, short stories, book analysis, assistants and other tools |
| `src/components/` | Shared UI and feature components, including Writer panels, dialogs and editor |
| `src/composables/` | Reactive workflows for writing, AI streaming, prompt selection and themes |
| `src/services/api.ts`, `src/services/aiProviders.ts`, `src/services/apiConfig.ts` | AI SDK facade, provider adapters, model discovery and shared API configuration |
| `src/services/novelPersistence.ts`, `src/services/blobStore.ts` | Queued novel saves, versioned IndexedDB content shards and startup hydration |
| `src/services/backup.ts`, `src/services/billing.ts` | Backup validation/restoration and local usage/cost bookkeeping |
| `src/stores/novel.ts`, `src/stores/assistant.ts` | Pinia state for writing and assistant conversations |
| `src/utils/storage.ts`, `src/utils/aiRequestScope.ts` | Central storage access and isolated, cancellable AI requests |
| `src/utils/writer/` | Writer prompt builders and response parsers |
| `src/utils/` | Context budgets/compaction, corpus retrieval, book imports, chapter parsing, event and mind-map data |
| `src/types/` | Shared API, Writer, ShortStory, book-analysis, novel-management and tool types, plus library declarations |
| `src/config/` | Default prompts, ShortStory defaults, typed tool definitions and announcements |

## Writer Workspace

| Path | Responsibility |
|------|----------------|
| `src/views/Writer.vue` | Compose the workspace UI and connect its controllers |
| `src/components/writer/WriterEditor.vue` | Rich-text editor boundary and editor lifecycle |
| `src/components/writer/panels/` | Chapter, character, worldview, corpus and event panels |
| `src/components/writer/dialogs/` | Generation, editing and prompt-selection dialogs |
| `src/composables/useWriterProject.ts` | Project loading, chapter switching, autosave and persistence retry |
| `src/composables/useWriterGenerationArbiter.ts` | Coordinate AI operation ownership and persistence barriers |
| `src/composables/useChapterContentWorkspace.ts` | Chapter-content dialog state, selected materials and generation context |
| `src/composables/` | Separate Writer controllers for CRUD, continuation, polishing, generation and prompt orchestration |
| `src/utils/writer/`, `src/types/writer.ts` | Prompt/parsing helpers and shared Writer contracts |

## Other Feature Boundaries

| Feature | Modules and responsibilities |
|---------|-----------------------------|
| ShortStory | `components/short-story/ShortStoryPromptSelector.vue`; `useShortStoryConfig.ts` for fresh defaults and async persistence; `useShortStoryGeneration.ts` for independent cancellable requests; `utils/shortStoryPrompts.ts` for prompt construction |
| BookAnalysis | `components/book-analysis/BookFileImportPanel.vue`; `useBookAnalysisFile.ts` for latest-import ownership and encoding; `utils/bookAnalysisContext.ts` for chapter detection, selected ranges and prompts |
| NovelManagement | `components/novel-management/NovelMetadataForm.vue` for create/edit fields; `utils/novelList.ts` for filters and non-mutating sorting |
| ToolsLibrary | `components/tools/ToolCatalog.vue`; `config/tools.ts` as the tool registry; `utils/toolForms.ts` for required fields; `utils/toolPrompts.ts` for templates and selected novel/chapter context |
| Editor teardown | `utils/destroyEditor.ts` cancels wangEditor selection throttling before destroying an editor |

All paths in this table are relative to `src/`; `use*.ts` controllers are under `src/composables/`. Parent views still own the remaining orchestration.

## Validation and Releases

- [Browser testing](scripts/browser-testing.md): CI checks, local Chromium regression and optional preview.
- [Releasing](scripts/releasing.md): validated static build, checksum and source/CI metadata.
- [Changelog](CHANGELOG.md): published changes and unreleased work.
