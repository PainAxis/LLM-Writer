# LLM-Writer Roadmap

[English](ROADMAP.md) | [简体中文](ROADMAP.zh-CN.md)

See [Project Structure](PROJECT_STRUCTURE.md) for the current implementation layout and [Changelog](CHANGELOG.md) for released changes.

Completed foundations:

- PR/main CI enforces zero lint warnings, type checking, production builds, 77 smoke suites and 129 real Chromium scenarios with synthetic data/providers, including nine long-novel stress scenarios.
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

The first batch of existing-feature repairs is complete: exact ShortStory selection replacement, stable chapter/event links, a persistent book-analysis reference library, and isolated API draft testing/model synchronization.

The second batch is implemented:

- Shared rich-text conversion preserves visible text, entities and paragraph boundaries for AI context, copying, exports, previews and word counts; generated prose is escaped before editor insertion.
- Chapter management keeps both stored total fields consistent; legacy exports use actual chapter content. Named empty corpus drafts round-trip through portable files. Both goal entry points support chapter units and exclude non-word progress from word statistics, retaining historical units after edits.
- Book analysis uses whole-line headings and requires explicit chapter selection when chapters are detected. Batch outlines require complete chapter structures and the requested count; invalid replies remain visible for retry. Outline requests tolerate incidental autosave changes, and polishing substitutes the latest passage literally.
- Tool templates respect the selected novel/chapter identities and current form parameters; incompatible templates are rejected without changing the saved prompt catalog.
- Billing filters use normalized request types, exact model IDs and complete local-calendar days. Recorded usage drives trend/distribution charts, and failures without usage evidence do not invent token consumption.
- Placeholder chapter sorting/batch editing controls are explicitly disabled; the Settings placeholder for testing all connections is removed.

API settings now include persisted output ceilings and model-aware thinking controls, with actual SDK wire coverage and a settings-to-generation browser scenario. See [generation budgets](docs/generation-budgets.md).

The configured regression set now contains 77 smoke suites and 129 browser scenarios, with separately invoked local/hybrid memory stress workloads. CI results for the reviewed revision are the validation record. Implementation details remain in [Project Structure](PROJECT_STRUCTURE.md) and the unreleased changelog.

## Feature roadmap

Stage 1 is implemented: opt-in assistant project tools, remote MCP connections and writing Skills. Protocol/import/authorization tests and built-app browser scenarios are part of CI; see [writing extensions](docs/extensions.md).

Stage 2 remains planned: incremental chapter persistence, million-character editing and shared chapter/volume summaries. Stage 3 is being developed independently through a bounded retrieval prototype. A bounded writing Agent follows once project tools and memory are stable. Local stdio MCP, script Skills and unattended tasks require an optional companion runtime.

The isolated [stage-three retrieval prototype](docs/memory-prototype.md) combines keyword and author-clue retrieval with optional semantic embeddings and reranking. It checks chapter revisions and disclosure boundaries before external requests and evidence display, with session-only provider credentials and explicit local fallback. Unchanged validated sources reuse their keyword index; affected chapters and clues can update incrementally. Focus/storage invalidation preserves the completed Worker baseline but requires fresh committed-source synchronization before retrieval. See [incremental indexing and recovery boundaries](docs/memory-incremental-index.md). [Long-novel stress tests](docs/memory-stress-tests.md) cover up to 10.5 million characters and a separate real Jina workload, while documenting cold-start, full-build recovery/compaction, memory and no-answer limits. The [fact relationship graph](docs/memory-fact-graph.md) adds source-anchored author relationships and optional model proposals, a Cytoscape.js view, exact chapter/revision/quote evidence and author review. Every premise must remain current and disclosed; author confirmation cannot preserve stale evidence. Automatic whole-novel extraction and stage-two chapter persistence remain future work. An embedded Agent belongs to stage four and is outside this implementation.

Actual-novel graph backup/restore and mobile drawer navigation are covered in [the stage-three follow-up](docs/graph-backup-mobile.md). Opt-in [Writer retrieval context](docs/writer-memory-context.md) now covers chapter-body generation, continuation and polishing, with approved current/disclosed evidence and separate optional-provider consent. Stage-four Agent work remains deferred.

## Remaining stage-three priorities

1. **Local mixed Chinese/code recall — this increment:** add exact-code candidates and verify complete queries with graph retrieval disabled. Keep the historical miss rates and comparable workloads visible; see [the focused fix](docs/memory-mixed-query-recall.md).
2. **No-answer and low-relevance handling — next:** define abstention and evidence-quality acceptance so a non-empty result list cannot be mistaken for an answer. Include ordinary Chinese queries and questions without an answer in the disclosed source.
3. **Indexing and semantic capacity:** reduce expensive cold builds and source-read/validation costs, and design behavior when manuscripts exceed the current vector or request budgets. Measure browser costs separately from Node retrieval.

Whole-novel automatic extraction needs a separate design and review contract; selected-source model proposals do not complete it. This list does not resume stage-two persistence/editor work or the deferred stage-four Agent.
