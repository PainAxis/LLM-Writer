# Changelog

## [Unreleased]

- Begin stage four after the final stage-three merged-main gate: [main CI 39961172049](https://github.com/PainAxis/LLM-Writer/actions/runs/39961172049) passed all eleven jobs at `dfc316eb2fc8f376c5ac3c77892b251ba29e6902`. Add an opt-in bounded author Agent with one strict planner request, one disclosed local retrieval, individual author evidence approval, one draft request and explicit once-only append/save. Request-level usage remains unknown when unreported; actual commit receipts and Agent-only recovery barriers distinguish pending, known failure and initial-commit/later-catch-up failure. [English](docs/writer-author-agent.md) and [Simplified Chinese](docs/writer-author-agent.zh-CN.md) retain limits and pending validation, not a real-model quality claim.

- Current smoke coverage is dynamically aggregated. The independent 52-scenario support and 20-scenario candidate browser gates remain outside the old `test:browser` aggregate. Accepted revision identities and observed counts are recorded in their reports, not inferred from configured coverage; no local Chromium execution is claimed.
- Implement the finite author-started disclosed-source candidate scan: explicit A/B consent, complete A source-window coverage, bounded B routes, cumulative budgets across >512-candidate review segments, individually saved graph-v2 plot links, all-premise provenance and safe Writer isolation. [PR #41 baseline acceptance](docs/testing/memory-novel-scan-2026-10-22/ACCEPTANCE.md) records all eleven successful jobs and the complete 20/20 code/harness run separately from both earlier failures; final delivery-head independent review/eleven-job CI and actual merge/main verification remain distinct delivery gates. Controlled evidence is not real-model quality; the earlier Go attempt remains one transport failure, zero assessed outputs, six stopped and unknown actual usage/cost.
- Implement optional, explicitly started cited support checks in Memory Lab and all three Writer paths. Prepare a local-only preview of selected current/disclosed original excerpts, then make one bounded chat request. Show independent `supported`, `insufficient` or `uncertain` model opinions with exact source citations; retain the original `answerability: unverified` indicators and distinguish invalid/unavailable/failed operations from successful judgments. Neither scores nor opinions become confidence or proof. Starting a Writer check revokes prior approval; no result approves evidence or injects its answer/explanation into writing. See [English](docs/memory-support-checks.md) and [Simplified Chinese](docs/memory-support-checks.zh-CN.md) for the contract.
- Freeze 25 semantic cases plus eight operational rejections and a separate seven-case code/document fixture. Add five smoke suites and built-app checks for source/citation/lifecycle/transport limits. The separate `support-enabled-long-novel-v1` profile has 600 chapters / 1,388,902 characters and covers Memory Lab plus chapter-body generation, continuation and polishing without changing the 25-case semantic denominator. Controlled responses establish engineering behavior, not live-model quality. The first authorized real Go code/document case failed in transport after 688 ms; the other six were not run. This does not establish accuracy or zero cost; detailed observation limits are recorded in the support-check guides.
- Complete the bounded full-range semantic-capacity track in [PR #39](https://github.com/PainAxis/LLM-Writer/pull/39), merged at `73e730a`; [main CI 39822084525](https://github.com/PainAxis/LLM-Writer/actions/runs/39822084525) completed successfully. Current four-track sequencing and delivery conditions are defined by the roadmap; this historical #39 acceptance is not automatic acceptance of later changes. See [English](ROADMAP.md#stage-three-completion-contract) and [Simplified Chinese](ROADMAP.zh-CN.md#第三阶段完成契约) for the stage-four entry gates.

Previously merged cold-index work:

- Replace Orama's repeated per-token frequency scans with one per-field count through its public components API, retaining the existing MemoryIndex tokenization, default index state and exact search scores. Cover duplicate/empty tokens, inherited keys, Unicode, multiple fields, arrays, remove/re-add/update/load and reused mutable tokenizer arrays; verify token visits fall from n² + n to 2n without a timing threshold. Add comparator-integrity smoke checks that reject altered/incomplete reports while retaining valid slower timings.
- Add the `ci-memory-cold-index` fixed-baseline ABBA comparison for 1.32M/10.5M-character cold and new-instance builds. Hash complete retrieval results except elapsed search time, including returned fusion scores, natural questions and known unanswered questions; preserve the earlier hydration experiment at both historical endpoints with its original dependency/transaction assertions. The two-profile local comparison reports approximately 70–72% lower cold/new-instance medians while retaining smaller timing regressions and memory observations; see [English](docs/memory-cold-index.md) and [Simplified Chinese](docs/memory-cold-index.zh-CN.md) for reproduction and limits.
- Bound the remaining stage-three roadmap to measured cold/source capacity, an explicit opt-in over-budget semantic strategy, optional cited semantic support checks, and author-started whole-disclosed-novel candidate extraction. Require common safety/business/CI gates and separate engineering from model quality before starting the bounded stage-four authorized-tools/retrieval/draft/author-review loop. This cold-index patch does not complete stage three, and does not start stage-two storage/editor/shared-summary work.

Historical stage-three increments below retain their original scope and observations; current sequencing is defined by the [roadmap](ROADMAP.md#stage-three-completion-contract).

- Measure cold indexing, recovery, committed-source validation and bounded semantic-cache costs before choosing a focused read-path optimization. Hydrate chapter bodies in one IndexedDB transaction, retaining every fresh body read and all-or-nothing publication. Keep exact-code recall, explicit evidence choice, source/disclosure guards, optional-provider consent and existing capacity limits unchanged.
- Add paired Chromium source measurements, storage-race regressions and a long Memory Lab-to-Writer workflow covering explicit semantic fallback beyond 2,000 passages. Record baseline/candidate accounting and remaining cold-build/full-collection costs in matching [English](docs/memory-capacity.md) and [Simplified Chinese](docs/memory-capacity.zh-CN.md) guides.

- Distinguish empty results, candidates and literal/code matches without score thresholds or answerability claims. Expose missing requested codes and quotation/title/author-annotation provenance; optional retrieval providers remain opt-in.
- Require individual Writer passage or complete-relationship selection before approval. Serialize only selected current/disclosed evidence, recompute its assessment and revoke approval when selection changes. Add ordinary unanswered-question and selected-context acceptance; see matching [English](docs/memory-evidence-review.md) and [Simplified Chinese](docs/memory-evidence-review.zh-CN.md) guides.

- Repair local mixed Chinese/ASCII-code recall using bounded, disclosure-filtered exact-identifier candidates and code-coverage priority in local ranking. Preserve current-source checks and ordinary keyword/clue search; optional semantic/rerank services remain separately enabled. Document the recognized code grammar and remaining no-answer/capacity limits in [English](docs/memory-mixed-query-recall.md) and [Simplified Chinese](docs/memory-mixed-query-recall.zh-CN.md).
- Add a focused identifier regression suite, graph-disabled full-query assertions at 1.44M/10.5M characters, and two built-app Writer cases. That validation set contained 77 smoke suites and 129 browser scenarios; the reviewed revision’s CI establishes the validation result.

- Add opt-in retrieval evidence to Writer chapter-body generation, continuation and polishing. Preview and approve bounded exact excerpts and graph provenance; revalidate committed revisions/disclosure before each optional provider request, model transport, completion and application. Keep semantic/rerank services off by default with route-session credentials.
- Add cancellation/application lifecycle, provider-handshake and source/budget regressions, 14 actual Writer browser scenarios including 320px/390px touch operation, and 1.44M/10.5M-character context workloads. Synchronize [English](docs/writer-memory-context.md) and [Simplified Chinese](docs/writer-memory-context.zh-CN.md) documentation. At that increment, the stage-four Agent was deferred; the current roadmap now defines its bounded entry gate.

- Include actual-novel fact graphs in full and novels-only backups, retaining review provenance and exact chapter/revision/quote anchors. Validate before restoration, replace paired graphs with atomic version checks, preserve legacy backups and avoid rebasing stale evidence.
- Replace the covering mobile sidebar with a closed-by-default modal drawer, with touch dismissal, focus containment and accessible navigation. Fit Memory Lab, evidence forms and backup controls to 320px/390px screens. Add dedicated backup round-trip and actionable mobile browser acceptance; see the matching [English](docs/graph-backup-mobile.md) and [Simplified Chinese](docs/graph-backup-mobile.zh-CN.md) notes.

- Add a Cytoscape.js fact relationship graph for people, events, objects and places, with exact chapter/revision/quote evidence, local author annotations and optional bounded model proposals. Preserve explicit/inferred basis and model/author origin separately from author confirmation.
- Exclude relationships unless every source premise remains current and disclosed, including confirmed relationships. Build node labels only from eligible source-grounded relationships; do not merge future aliases into earlier identities. Graph search can find disclosed foreshadowing relationships beyond the bounded canvas.
- Clear a deleted disclosure-cutoff selection on same-project refresh and require an explicit new choice before retrieval or graph access; repeated refreshes cannot silently widen the allowed chapter range.
- Store graph annotations in independent project-scoped IndexedDB records with atomic version checks and explicit storage errors; the original graph release excluded these records from system backups; the follow-up above adds actual-novel backup support. Add graph, storage and extraction smoke regressions plus 14 built-app Chromium scenarios; that increment’s configured coverage was 72 smoke suites and 88 browser scenarios (79 shorter plus nine long-novel scenarios), with validation established by the reviewed revision's CI results. Document scope, review semantics and limits in matching [English](docs/memory-fact-graph.md) and [Simplified Chinese](docs/memory-fact-graph.zh-CN.md) guides.

- Update affected memory chapters and clues incrementally, reuse unchanged chapter hashes/documents and enforce current disclosure order after reordering. Periodically compact retired index metadata and require a fresh build after interrupted mutations. Expose synchronization work counters without persisting derived indexes.
- Preserve completed Memory Lab indexes and compatible vectors on actual-novel focus/storage invalidation, while immediately hiding evidence and requiring a fresh committed-source synchronization. Explicit cancellation, configuration changes, cache clear, project switches and route teardown still discard caches.
- Add incremental/client smoke suites, two shorter browser cases and repeated-edit/focus-return stress checks. That validation set contained 69 smoke suites and 74 browser scenarios (65 shorter plus nine long-novel scenarios); CI results establish validation for each reviewed revision. Document the contract in matching [English](docs/memory-incremental-index.md) and [Simplified Chinese](docs/memory-incremental-index.zh-CN.md) guides.

- Add separately invoked long-novel memory stress workloads for local indexing, hybrid-provider failures, persisted browser editing and optional real Jina retrieval over pinned public-domain books. Document measurement boundaries and retained limitations in matching [English](docs/memory-stress-tests.md) and [Simplified Chinese](docs/memory-stress-tests.zh-CN.md) guides.
- Keep keyword passages competitive with numerous partial clue matches by balancing local fusion channels. Add an exact-source keyword-index reuse path while preserving fresh committed reads, revision checks and invalidation of pending requests.
- Extend Memory Lab with opt-in Jina/OpenAI-compatible embeddings and Jina-compatible reranking, reciprocal-rank fusion, a bounded revision/configuration-aware vector cache and explicit local fallback. Filter source disclosure before external requests, keep provider settings/keys in the current route session and invalidate stale asynchronous results.
- Add provider/hybrid smoke regressions and ten additional built-app Chromium scenarios, bringing configured coverage to 67 smoke suites and 63 browser scenarios. Add an optional, separately invoked Jina live test using synthetic chapters.
- Provide matching English and Simplified Chinese [memory prototype documentation](docs/memory-prototype.md), including provider setup, request/cache limits and remaining scope.

- Add an isolated Memory Lab prototype with Orama keyword/author-clue retrieval in a Web Worker, content-derived chapter revisions, pre-ranking disclosure filters and exact source evidence. Include an editable 80-chapter private demo and read-only retrieval of committed novels; local-only mode calls no AI API and existing generation tools are unchanged.
- Add memory correctness and million-character synthetic capacity checks, plus eight built-app Chromium acceptance scenarios. See [prototype scope and walkthrough](docs/memory-prototype.md).

- Add opt-in assistant writing extensions with six project-scoped read-only tools, remote Streamable HTTP MCP connections and explicit tool allowlists.
- Add four built-in Agent Skills and validated `SKILL.md`/folder imports, with selected instructions and on-demand references.
- Preserve tool execution status on failure/cancellation, reserve schema budgets before context fitting, and record reported usage across model steps. Extension settings and imported Skills participate in backups; MCP session tokens do not.
- Add protocol, import, authorization, generation-loop and Chromium business regressions. Document first-stage scope and optional live OpenCode Go validation in [writing extensions](docs/extensions.md).

- Add persisted output and model-aware thinking controls to API settings, with provider-default modes, compatible/native request mapping, budget validation and backward-compatible backup support. New configurations use a 16,384-token output ceiling; existing saved limits remain unchanged. Add SDK wire regressions and browser scenario 34.
- Let assistant summaries inherit the saved generation budget instead of overriding it with an 800-token ceiling that can be smaller than the model's thinking allocation; retain the concise summary prompt.
- Capture the current browser selection before optimizing a short-story passage, preventing rapid selection followed by a click from using a stale editor range.

- Reject provider output-limit and content-filter terminations instead of treating partial generations as successful. Explain reasoning-only budget exhaustion and preserve received text and reported usage on failure.
- Share visible-text conversion across writing, AI context, copying, exports, previews and counts. Preserve paragraphs and decoded entities, count Unicode characters without whitespace, and escape generated prose before inserting editor HTML.
- Keep chapter-management edits, copies, moves and deletions consistent with both novel total fields; derive legacy display/export totals from chapter bodies. Round-trip named empty corpus drafts without losing metadata.
- Add explicit chapter-count goals in both entry points and keep non-word units out of word statistics. Unit changes reset current progress while preserving historical units, notes and legacy custom goals.
- Require explicit detected-chapter selections in book analysis and recognize whole heading lines. Reject incomplete or wrong-count batch outlines without creating fallback chapters; retain raw replies for retry. Keep outline generation alive through incidental autosave and substitute the latest polishing passage literally.
- Align tool defaults and compatible templates with the selected novel/chapter IDs, requested quantities and form parameters. Reject unsupported templates before generation without replacing saved user templates.
- Record usage evidence separately from estimates; failures without reported usage or output no longer invent token consumption. Fix type/model/local-date filters and render recorded 7/30/90-day trends and input/output distributions with honest empty states.
- Disable placeholder chapter sorting/batch-editing controls with explanations and remove the Settings placeholder for testing all connections.
- Add `writer-content`, `management-correctness`, `billing-correctness` and `tools-workspace` smoke suites and browser scenarios 29–33. That increment’s configured coverage was 58 smoke suites and 34 Chromium scenarios; CI records validation for each reviewed revision.

- Replace optimized ShortStory text at its captured editor range, including repeated and formatted selections; source edits invalidate stale results.
- Keep event chapter links attached to chapter identities after chapter reorder or deletion, with chapter/event changes persisted and retried together.
- Persist book-analysis reports in a titled reference library with open, update and delete actions; include the library in complete and selective backups while preserving it when restoring older backups.
- Test API configuration drafts without changing the saved configuration. Model synchronization uses the draft proxy and headers, rejects stale responses, times out stalled requests and isolates caches by endpoint.

- Preserve form drafts and previously saved state when prompt, genre, assistant or configuration writes fail. Completed assistant replies expose a save-only retry without repeating the AI request.
- Coordinate novel commits across tabs, merge independent project edits, reject stale edits to the same project, and atomically apply goal progress increments. Protect failed clear/restore operations and export the latest committed, hydrated novel collection.
- Track assistant summary coverage by message ID and policy, retain every uncovered message during delayed or failed compaction, and include persona and summary text in the final estimated context budget.
- Centralize prompt catalog initialization and migration for all entry points, including fresh direct visits to BookAnalysis and ToolsLibrary; preserve intentional deletions and reject damaged stored catalogs without overwriting them.
- Add storage coordination/conflict, configuration and prompt catalog smoke suites, plus fresh-entry and real multi-tab browser regressions. That validation set contained 53 smoke suites and 28 Chromium scenarios.
- Updated the development-only brace-expansion dependency to 5.0.12; the full dependency audit is clean.
- Unified both writing-goal entry points and the homepage on a shared typed store. Progress updates preserve notes and history, serialized saves retain the last committed state on failure, and edits retain legacy metadata. Continuous writing days use actual activity on local calendar dates, including DST boundaries and progress corrections.
- Extracted ShortStory and BookAnalysis panels/dialogs into typed components with page-owned workspace contexts and feature-scoped shared styles. Moved short-story editor handling and book chapter viewing/export out of their workspace controllers.
- Added goal persistence, failure/retry, concurrency, legacy-data and calendar regressions, plus a real-browser scenario covering both goal entry points and reload.

## [1.0.2]

Complete the remaining view, conversation, corpus and theme maintenance work.

- Migrated every remaining view to TypeScript and enforced the script language rule across all views, with shared management types, typed forms and legacy date handling.
- Editing writing goals preserves progress, history and status; prompt edits isolate tag drafts and imports reject invalid field types per item.
- Virtualized assistant histories with measured variable-height rows, stable reading anchors, latest-message navigation and conditional stream following. Full histories remain available to context processing and backups.
- Unified corpus data in each novel's `corpusData`, removing unused in-memory store state. Writer imports legacy JSON and portable files without overwriting records, retains metadata, resolves ID collisions and awaits atomic persistence with rollback and project ownership checks.
- Mind maps follow light/dark/system themes without replacing editable graphs or losing drafts. Live system color-scheme changes now update the app, and PNG exports use the active background.
- Added regression coverage for legacy view data, 10,000-row virtual windows, corpus import failure/races and 2,000-message browser histories, plus portable corpus and light/dark PNG verification. Required CI runs 45 module smoke suites and 20 Chromium scenarios.
- Updated the project structure, roadmap and feature documentation; all four previously listed roadmap candidates are complete.

## [1.0.1]

Maintenance update for feature workspaces, mind-map editing and assistant context control.

- The About page now reads the package version and links to its release notes instead of displaying the obsolete v0.7.0 current-version label.
- Added opt-in per-assistant context policies for configuration, request budgets, summary compaction and retry, with legacy global defaults, backup compatibility and stale-summary guards.
- Assistant reply streams are reactive; clearing/deleting conversations cancels active work and persists cleanup.

- Added editable mind-map titles/entities with validated add/delete/reorder, retained body/metadata preservation, repaired references, conflict detection, awaited saves and retry-safe identities.

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
