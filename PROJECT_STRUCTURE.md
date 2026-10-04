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
| `docs/` | Data formats, editing protocols, context policies and persistence coordination |
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
| `src/services/novelPersistence.ts`, `src/services/blobStore.ts` | Queued novel saves, staged/versioned IndexedDB content shards and startup hydration |
| `src/services/storageCoordination.ts`, `src/utils/novelConcurrency.ts` | Cross-tab commit coordination for novels/goals and per-novel version checks |
| `src/services/promptCatalog.ts` | Shared prompt initialization, migration and committed updates across all five prompt entry points |
| `src/services/backup.ts`, `src/services/billing.ts` | Backup validation/restoration and local usage/cost bookkeeping |
| `src/stores/novel.ts`, `src/stores/assistant.ts`, `src/stores/writingGoals.ts` | Pinia state for writing, assistant conversations/summary coverage and writing goals |
| `src/services/mcp.ts`, `src/services/skills.ts`, `src/services/writingTools.ts`, `src/services/extensionsRuntime.ts` | Request-scoped MCP, Skills, project tools and bounded model execution; [extension semantics](docs/extensions.md) |
| `src/stores/extensions.ts`, `src/components/extensions/` | Strictly persisted extension settings, in-memory credentials and assistant opt-in controls |
| `src/views/MemoryLab.vue`, `src/services/memory/`, `src/types/memory.ts` | Isolated memory retrieval, worker-owned local index, optional embedding/reranking providers, bounded vector cache and revision/disclosure-checked evidence; [scope and provider setup](docs/memory-prototype.md) |
| `src/utils/storage.ts`, `src/utils/aiRequestScope.ts` | Central storage access and isolated, cancellable AI requests |
| `src/utils/writer/` | Writer prompt builders and response parsers, including literal passage substitution for polishing |
| `src/utils/writerContent.ts`, `src/utils/novelStats.ts` | Shared visible-text conversion, safe generated HTML, Unicode character counts and chapter-derived novel totals |
| `src/utils/chapterParser.ts` | Explicit, complete AI chapter-outline parsing; invalid structures produce no fallback chapter |
| `src/utils/` | Context budgets/compaction, corpus retrieval/portable transfer, virtual message windows, book imports, chapter parsing, event and mind-map data |
| `src/utils/generationBudget.ts` | Model-aware output/thinking capabilities, validation and SDK request options; see [budget semantics](docs/generation-budgets.md) |
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
| AssistantManagement | `stores/assistant.ts` selects global/custom policies, isolates conversations and tracks summary coverage with `coveredThroughEntryId`; only committed, policy-compatible summaries replace covered originals; `useVirtualMessages.ts` measures visible rows and preserves scroll anchors; `utils/contextPolicy.ts` normalizes and resolves policies; [policy semantics](docs/assistant-context-policy.md) |
| ShortStory | `useShortStoryWorkspace.ts`; `components/short-story/ShortStoryPromptSelector.vue`; `useShortStoryConfig.ts` for fresh defaults and async persistence; `useShortStoryGeneration.ts` for independent cancellable requests; `utils/shortStoryPrompts.ts` for prompt construction |
| BookAnalysis | `useBookAnalysisWorkspace.ts`; `components/book-analysis/BookFileImportPanel.vue`; `useBookAnalysisFile.ts` for latest-import ownership and encoding; `utils/bookAnalysisContext.ts` for whole-line chapter detection, validated explicit selections and prompts |
| NovelManagement | `useNovelManagementWorkspace.ts`; `components/novel-management/NovelMetadataForm.vue` for create/edit fields; `utils/novelList.ts` for filters and non-mutating sorting; `utils/novelStats.ts` for legacy-compatible display/export totals |
| ToolsLibrary | `useToolsLibraryWorkspace.ts`; `components/tools/ToolCatalog.vue`; `config/tools.ts` as the tool registry; `utils/toolForms.ts` for required fields; `utils/toolPrompts.ts` for compatible tool templates, stable selected novel/chapter identities and authoritative form parameters |
| Writer corpus | `corpusData` is the per-novel source; `useWriterMaterialCrud.ts` owns atomic imports and `utils/corpusTransfer.ts` validates legacy/portable files, including named empty drafts; [format](docs/corpus.md) |
| MindMap | `useMindMapDraft.ts` for conflict checks and awaited saves; `utils/mindmapEditing.ts` for editable snapshots, validation and lossless entity updates; [protocol](docs/mindmap-editing.md) |
| Editor teardown | `utils/destroyEditor.ts` cancels wangEditor selection throttling before destroying an editor |

All paths in this table are relative to `src/`; `use*.ts` controllers are under `src/composables/`. All parent views use `lang="ts"`, enforced by the shared view language rule; the four feature Workspace controllers own reactive state, generation and persistence orchestration. `useGenerationTask.ts` shares request ownership and cancellation.

## Validation and Releases

- The configured CI validation set contains 67 sequential smoke suites and 63 Chromium scenarios with synthetic data and API responses. Use the reviewed revision’s CI results to confirm validation.
- New suites: `smoke:generation-budget`, `smoke:writer-content`, `smoke:management-correctness`, `smoke:billing-correctness` and `smoke:tools-workspace`.
- [Browser testing](scripts/browser-testing.md): CI checks, local Chromium regression and optional preview.
- [Releasing](scripts/releasing.md): validated static build, checksum and source/CI metadata.
- [Changelog](CHANGELOG.md): published changes and unreleased work.

## Feature component ownership

- ShortStory uses article/story workspaces and separate style, continuation, optimization and configuration dialogs in `src/components/short-story/`. `short-storyContext.ts` shares the page-owned typed workspace; editor refs and guarded writes live in `useShortStoryEditors.ts`. `useShortStorySelection.ts` captures and validates exact editor ranges for optimization.
- BookAnalysis uses controls/results and chapter/prompt dialogs in `src/components/book-analysis/`. `book-analysisContext.ts` shares the page-owned typed workspace; `useBookChapterViewer.ts` owns chapter selection, reading and export. `useBookAnalysisLibraryWorkspace.ts` owns report dialogs and identity; `services/bookAnalysisLibrary.ts` validates and persists reports, also included in system backups.
- Shared feature CSS is limited to the page root and its teleported dialog class. Generators and cancellation remain owned by the page lifecycle.
- `stores/writingGoals.ts` owns both goal entry points and homepage state, serialized persistence, metadata-preserving edits and progress history. `utils/writingGoals.ts` normalizes legacy records, computes activity by local calendar day and counts only word-unit progress in word statistics. Explicit chapter goals use `章`; changing a unit resets current progress while retaining history with its original units.

## Persistence and Context Boundaries

- `promptCatalog.ts` initializes or migrates the prompt library on demand for Writer, PromptsLibrary, ShortStory, BookAnalysis and ToolsLibrary. Current-version deletions and user metadata are retained; malformed stored data is reported and preserved for recovery.
- Prompt, API/configuration, genre and assistant management publish saved state and success feedback after their storage writes complete. Failed saves retain retryable drafts or the last committed state.
- Novel saves stage content before a coordinated commit and compare the versions actually seen by the editor. Edits to different novels can merge; conflicting edits to the same novel retain the local draft and reject overwriting the newer saved version. Copy the draft, refresh/reopen the novel and merge it manually.
- Goal increments read the latest committed goal under the same cross-tab gate, preserving both increments and their history. This coordination protects novels and writing goals; other storage keys do not acquire cross-tab protection through this mechanism. See [persistence coordination](docs/persistence-coordination.md).
- Assistant summaries persist their text together with a coverage cursor. Sending uses that summary plus uncovered original messages; failed or pending compaction does not advance coverage. Full local histories and legacy summary backups remain available.
- `utils/eventLine.ts` remaps event chapter references by stable chapter identity for chapter management, Writer deletion and mind-map editing. Chapter management commits recalculated chapter counts and both novel total fields with the same save.
- `services/billing.ts` labels reported/estimated/unavailable usage, normalizes request types and computes exact filters and local-calendar trends; `TokenBilling.vue` renders recorded trend/distribution data and refreshes when usage changes.
- Batch outline controllers retain invalid raw responses and enforce requested chapter counts before persistence; their source checks ignore incidental autosave metadata while still rejecting meaningful source changes.
- API connection tests and model synchronization use cancellable form snapshots. Model caches are scoped to the provider endpoint and proxy, and only explicit configuration saves change active settings.
