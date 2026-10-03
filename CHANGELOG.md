# Changelog

## [Unreleased]

- Add an isolated Memory Lab prototype with Orama keyword/author-clue retrieval in a Web Worker, content-derived chapter revisions, pre-ranking disclosure filters and exact source evidence. Include an editable 80-chapter private demo and read-only retrieval of committed novels; no AI API is called and existing generation tools are unchanged.
- Add memory correctness and million-character synthetic capacity checks, plus eight built-app Chromium acceptance scenarios. Configured CI coverage is 65 smoke suites and 53 browser scenarios; see [prototype scope and walkthrough](docs/memory-prototype.md).

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
- Add `writer-content`, `management-correctness`, `billing-correctness` and `tools-workspace` smoke suites and browser scenarios 29–33. Configured coverage is now 58 smoke suites and 34 Chromium scenarios; CI records validation for each reviewed revision.

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
