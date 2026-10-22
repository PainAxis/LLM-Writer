# LLM-Writer Roadmap

[English](ROADMAP.md) | [简体中文](ROADMAP.zh-CN.md)

See [Project Structure](PROJECT_STRUCTURE.md) for the current implementation layout and [Changelog](CHANGELOG.md) for released changes.

Completed foundations:

- PR/main CI enforces zero lint warnings, type checking, production builds, 86 smoke suites and built-app Chromium suites with synthetic data/providers, including long-novel stress and explicit full-range scan scenarios.
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

The configured regression set now contains 86 smoke suites and built-app browser suites, with separately invoked local/hybrid memory stress workloads and full-range scan capacity/browser acceptance. CI results for the reviewed revision are the validation record. Implementation details remain in [Project Structure](PROJECT_STRUCTURE.md) and the unreleased changelog.

## Feature roadmap

Stage 1 is implemented: opt-in assistant project tools, remote MCP connections and writing Skills. Protocol/import/authorization tests and built-app browser scenarios are part of CI; see [writing extensions](docs/extensions.md).

Stage 2 remains a separate, unstarted scope: incremental chapter-body persistence, million-character editing and shared chapter/volume summaries. Stage 3 advances independently through the finite completion contract below. After its four tracks and shared gates pass, work proceeds to the bounded stage-four writing Agent. Local stdio MCP, script Skills and unattended tasks remain optional-companion-runtime work, not prerequisites for this transition.

The isolated [stage-three retrieval prototype](docs/memory-prototype.md) combines keyword and author-clue retrieval with optional semantic embeddings and reranking. It checks chapter revisions and disclosure boundaries before external requests and evidence display, with session-only provider credentials and explicit local fallback. Unchanged validated sources reuse their keyword index; affected chapters and clues can update incrementally. Focus/storage invalidation preserves the completed Worker baseline but requires fresh committed-source synchronization before retrieval. See [incremental indexing and recovery boundaries](docs/memory-incremental-index.md). [Long-novel stress tests](docs/memory-stress-tests.md) cover up to 10.5 million characters and a separate historical real Jina workload. The [fact relationship graph](docs/memory-fact-graph.md) adds source-anchored author relationships and optional selected-source model proposals, a Cytoscape.js view, exact chapter/revision/quote evidence and author review. Every premise must remain current and disclosed; author confirmation cannot preserve stale evidence.

Actual-novel graph backup/restore and mobile drawer navigation are covered in [the stage-three follow-up](docs/graph-backup-mobile.md). Opt-in [Writer retrieval context](docs/writer-memory-context.md) covers chapter-body generation, continuation and polishing, with individually selected current/disclosed evidence and separate optional-provider consent. These are implemented foundations, not a claim that whole-novel extraction or stage three is complete.

## Stage-three completion contract

Stage-three completion is bounded to the following four tracks: track 1 is merged, track 2 is entering final acceptance, and tracks 3 and 4 remain to be implemented. Their acceptance must use fixed, versioned synthetic fixtures and controlled providers, with engineering correctness reported separately from model quality. No paid service or newly provisioned credential is required to close this engineering scope. Optional real-model evaluation must report its provider, model, sample and limitations separately; mock output cannot establish general semantic or writing quality.

1. **Cold indexing, new-instance recovery and source loading.** Establish reproducible before/after measurements at 1.32M and 10.5M characters, with unchanged sources, retrieval results and budgets. The [historical hydration comparison](docs/memory-capacity.md) already measures reduced source-read transaction overhead. The focused [cold-index change](docs/memory-cold-index.md) replaces repeated token-frequency scans while preserving exact Orama scoring; the controlled local comparison reports lower cold/new-instance build times at both sizes without changing returned results. PR #38 is merged at `ed83bfef9903e8870ecf8b2b7ff2f47da6d2b5fc`, and its main CI passed. This track is complete for the bounded cold-index scope; later tracks still require their own shared acceptance gates. Acceptance requires measured improvement in the targeted cold/new-instance paths, reported CPU/memory and unchanged recovery, cancellation, failed-save and committed-source freshness behavior. A new instance still rebuilds; persistent snapshots and eliminating every full-collection cost are not required for this bounded track.
2. **Explicit full-range semantic capacity.** The separately opt-in [full-range scan](docs/memory-full-range-semantics.md) is implemented, with focused synthetic checks and frozen production-adapter resource measurements complete; full current-revision regression/browser CI and independent review remain acceptance gates. It replaces the earlier local-candidate-only plan: fixed sampling and routing experiments retained too many known-premise misses or required optimistic representation assumptions. Default behavior remains unchanged: up to 2,000 passages uses the ordinary semantic path; above it, the complete local channels remain with zero embedding requests unless full scanning is explicitly enabled. Explicit scans apply cumulative budgets at any size, prepare a zero-request plan, then require Start; they stream all eligible disclosed passages with the existing 2,000-entry / 32 MiB vector cache, report coverage and pause for author decisions. Use-local discards all partial semantics and stops reranking; stale sources cannot fall back as success. Acceptance requires same-vector streaming equivalence, exact-source/all-premise coverage, honest cold/warm costs and failure/lifecycle/Writer checks. Synthetic 46/46 probe recovery is engineering evidence, not real-model semantic quality or answerability validation.
3. **Optional cited semantic support checks.** Add opt-in checks that distinguish supported, insufficient and uncertain evidence, cite current disclosed source anchors, and expose invalid output or failure without converting it into a verified answer. Cover answerable, unanswered, contradictory and multi-premise cases in the fixed fixtures, retaining individual Writer evidence selection. Literal matches and existing numeric scores remain unverified for answerability. A system that refuses every question cannot pass: report supported-case recovery as well as unsupported claims and appropriate uncertainty. Controlled responses validate the protocol and lifecycle, not a real model's accuracy; when disabled, unavailable or unvalidated, preserve an honest unverified state.
4. **Author-started whole-disclosed-novel candidate extraction.** Add an explicitly started, bounded scan of the selected novel's entire disclosed range, not just manually selected excerpts. Show covered/remaining/skipped chapters and current revisions, progress, request/time budgets, cancellation, partial failures and safe retry behavior. Produce source-anchored relationship and foreshadowing/recovery candidates for author review. Partial or budget-limited coverage must be visible and cannot be called a complete scan; no automatic confirmation, manuscript edits or preservation of stale proposals. Fixed fixtures must exercise both candidate types, multi-chapter premises, incomplete coverage and review decisions.

### Shared acceptance gates

- Keep old facts out after source edits; validate every cited revision, exact range and quote. Enforce disclosure and future-information exclusion before retrieval, optional external requests, evidence display and Writer use. Every relationship premise must pass; confirmation cannot override a stale or undisclosed premise.
- Preserve explicit evidence selection and approval. Reject stale, canceled, late and superseded results; retain safe behavior after failed saves/requests and concurrent-tab changes. Never substitute editor drafts for committed-source verification.
- Run built production-app Memory Lab → Writer acceptance for chapter-body generation, continuation and polishing. Include long-range/over-budget retrieval, optional-provider modes, candidate review and the lifecycle failures relevant to each track; do not infer coverage of one Writer mode from another.
- Freeze fixture versions and expected safety outcomes before comparing results. Report fixture coverage, source/evidence checks, misses and resource costs without hiding regressions. Keep engineering pass/fail distinct from separately labeled model-quality observations.
- Require blocker-free code review, all necessary CI for the reviewed revision, and matching English/Simplified Chinese scope, reproduction and limitation documentation. A focused PR closes only the gates its evidence actually covers.

Exact Chinese/code recall and deterministic low-relevance review are already implemented: see [the focused recall fix](docs/memory-mixed-query-recall.md) and [the evidence-review contract](docs/memory-evidence-review.md). They support the four tracks but do not replace semantic support checks or whole-novel extraction. Neither cold indexing nor full-range scanning alone completes stage three.

## Stage-four entry

Once the four bounded tracks and shared gates above are complete, begin the stage-four loop: **authorized tools → retrieval → draft → author review**. Define explicit tool allowlists, maximum steps, time/request budgets, cancellation, stale-result rejection and a user-visible audit trail before expanding the loop. Drafting must not silently apply manuscript edits or grant additional tool permissions. Stage-two chapter-body storage, editor redesign and shared summaries remain outside this handoff; they are not an indefinite reason to postpone the bounded Agent.
