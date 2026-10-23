# Bounded author Agent: first continuity-draft delivery

[English](writer-author-agent.md) | [简体中文](writer-author-agent.zh-CN.md)

Status: implementation and acceptance in progress. Stage three's four bounded tracks passed their merged-main gate at `dfc316eb2fc8f376c5ac3c77892b251ba29e6902`; see the [compact handoff](testing/writer-agent-2026-10-23/stage-three-handoff.json). This document defines the new feature's acceptance contract, not a claim of completed browser validation or real-model writing quality.

## One finite outcome, not a general tool loop

Writer's opt-in continuity-draft workspace proposes a short continuation for the current **already saved** chapter:

1. The author enters a direction, explicitly chooses the current target as disclosure cutoff, and previews the exact saved tail, selected provider/model and limits. Preview sends no model request and does not save the editor.
2. A separate per-run grant authorizes one bounded planner request and one local read-only tool execution.
3. The model returns one strict JSON plan for `writer_retrieve_disclosed_context`, with only a query, or `needs_author_input`. The host validates the exact schema, reserves one execution and invokes the real committed-source retrieval adapter.
4. All retrieved candidates start unselected. Only the author's deliberate selection and approval can authorize the second request.
5. One bounded draft request receives the direction, same previewed tail and selected private source attachment. It does not receive the plan transcript or unselected candidates.
6. A completed, current draft is displayed for review. Copy/discard do not write the manuscript. A dedicated **Append and save** action can insert escaped text once, after a fresh source/owner check.

The executable boundary is real: host-owned run/call identity, author capability, input validation, reservation, private preparation and a verified receipt. A model sentence or a valid-looking UI object cannot fabricate the tool result or selected source lease. The planner chooses a query but cannot see retrieval results and replan. This is a typed single-tool protocol over the bounded non-streaming API, **not native provider function calling** or an SDK recursive tool loop.

There is no Pi framework, second model configuration system, refinement request, automatic repair/retry, remote MCP, web/URL tool, script, unattended task, chapter replacement, graph mutation, or hidden document history. Existing Assistant tool settings do not authorize this tool. Stage-two storage/editor redesign remains separate.

## Sources and explicit disclosure

The continuation target must equal the explicitly selected cutoff. An earlier cutoff blocks before reading a target tail for transmission or dispatching a planner request; the application never silently advances it. Changing chapter, source order, cutoff or configuration revokes the old grant. The author-entered direction is separately disclosed input; the application cannot certify that manually typed text contains no spoiler.

The tool wraps `prepareWriterMemoryContext` with pinned project/target/cutoff, exact expected target, `includeGraph: false`, no remote provider, limit six and a 6,000-unit attachment budget. It runs one real local Worker sync/search preparation, not the older duplicate lexical-search path. Every source retains current chapter revision, exact UTF-16 range/quote and disclosure membership. Graph-free scope avoids claiming an atomic novel-plus-graph transaction.

Only saved committed bodies are authoritative. Titles/outlines/materials/other novels, future chapters, arbitrary planner arguments and model paraphrases cannot widen source input. Once-normalized text is not normalized again; literal entities and surrogate boundaries have dedicated fixtures. Numeric retrieval scores are not semantic confidence or support judgments.

The initial preparation and its complete preview are **not** approved context. The runtime privately retains original candidates and selection functions; UI copies and copied receipt metadata cannot become authority. No retrieved excerpts leave the browser before individual author approval. A no-candidate, refused, malformed or failed plan ends visibly without a fallback draft, second search or hidden replan.

## Fixed limits

| Resource | First-delivery limit |
|---|---|
| Model requests | At most two, plan then draft; single HTTP attempt each, no automatic retry |
| Output allowance | 1,200 tokens per request; 2,400 configured output-token allowances total |
| Local tool | One `writer_retrieve_disclosed_context` execution |
| Direction / query | 1–1,000 / 1–200 UTF-16 units |
| Saved target tail | At most 2,000 units, exact excerpt range/revision, no split surrogate |
| Disclosed source geometry | At most 2,500 chapters and 12,000,000 normalized units; reject oversize, do not sample |
| Candidates / selected attachment | At most six / 6,000 units; whole source-unit packing |
| Plan / accepted prose | At most 1,200 / 2,000 units; empty, incomplete or oversized output is not trimmed into success |
| Serialized application input | At most 16,384 UTF-16 units and 65,536 UTF-8 bytes, including JSON escaping/framing |
| HTTP response | At most 65,536 decoded bytes, including error/reasoning envelopes; redirects refused |
| Model / source guard / retrieval | 30 seconds / 10 seconds / 90 seconds |
| Active pre-commit work | 180 seconds cumulative; author review does not reset it |
| Unapplied run expiry | 20 minutes absolute, including author wait |
| Audit | At most 32 bounded structured events; overflow stops, never silently discards an action |

The configured output allowance is **not a monetary cap** or a universal hidden-reasoning-cost guarantee. Existing provider-specific bounded thinking checks still apply. Actual reported usage is correlated to each request, separate from allowances; missing usage is unknown, not zero. A completed planning request keeps its usage observation if drafting later fails. No global “latest billing row” is used to infer this run's usage.

Source geometry is checked after the current persistence adapter hydrates committed data. It is not an allocation ceiling for whole-collection hydration or unrelated novels. Deadlines revoke authority promptly but cannot preempt synchronous JSON parsing or an already-issued storage read. These limits bound admitted downstream work, not whole-app CPU/RAM. A durable save that has begun is a separate non-cancellable boundary, not forced to end at the model/run deadline.

## Ownership, cancellation and source freshness

The runtime owns exact project/target/cutoff, editor HTML, brief, configuration identity, source fingerprint, run epoch and private evidence leases. Keys/headers are compared only in memory and never enter the audit. It checks ownership after awaits, at actual HTTP dispatch, after responses, before readiness and immediately before first application. Formatting-only edits also invalidate an unapplied draft.

The private read port and MemoryClient facade synchronously check ownership before and after reads/sync/search. Abort plus `dispose()` alone is insufficient because an ordinary MemoryClient can recreate a Worker later. An already-resolved guard followed by cancellation must not start a new sync/search in its continuation. Late responses, stale `finally` handlers and old approvals cannot affect a newer run.

Cancel, dialog X/Escape/overlay, changing inputs/configuration, route/chapter navigation and another generation claim share synchronous revocation. Reopen does not restore evidence, grant or a draft and does not start requests. Unmount is presentation, not authority. Cancellation cannot recall transmitted data or prove zero provider cost.

## Append, ordinary-save receipts and recovery

Apply first acquires a Writer-owned barrier, then validates the private selected lease. Before any mutation it remains cancellable. Immediately after the final await, synchronous owner/raw-HTML checks consume a one-use proposal capability, latch the original application and append escaped prose exactly once. No await separates those final checks and first mutation.

The actual editor must first prepare a one-use synchronous application port while the proposal is still unconsumed. A missing/destroyed editor at preparation fails before mutation and releases the temporary lease. After the application latch, the port runs the installed editor’s `setHtml` then `getHtml` synchronously, and the **canonical editor HTML is the first saved snapshot**. The later equivalent model/change notification must not create another snapshot; a genuine new author edit still does. This is not a newline-only transformation or a change to ordinary persistence. The first version refuses automatic application when the private draft or the actual existing editor text contains a decodable literal HTML entity (for example, the literal characters `&lt;`, `&#60;` or `&amp;`), because this installed serializer would change those characters on reload. This read-only check occurs before consumption or mutation, gives a specific explanation and keeps the draft available for Copy. Its host-owned validator is pure and synchronous; the runtime rechecks ownership afterwards. The zero-consumption refusal guarantee describes this fixed validator, not arbitrary side-effecting callbacks. Ordinary ampersands and actual angle-bracket prose are not blanket-rejected. It does not silently rewrite the text or repair the entire editor. If the port throws after mutation might have started, the proposal stays consumed, its original draft remains copyable, and the operation is unknown rather than eligible for another Append.

Saving uses the existing ordinary capture/merge/stage/CAS path, not whole-collection replacement. A request-local **metadata-only commit receipt** is generated at the actual metadata commit point. Errors in this new receipt callback cannot undo a commit or trigger another request. Existing global status-observer error propagation, including tracked backup-restore rollback, remains unchanged. Same-project changes in another tab are rejected rather than silently rebased; unrelated-project commits still merge.

Only an Agent-owned application lease uses the single Writer save handle and snapshot drain. Ordinary non-Agent saves retain their existing per-snapshot completion results, so a later failed save cannot falsely roll back an earlier committed structural edit. Concurrent header retry, global retry, autosave and disposal cannot create a duplicate pending save. Only actual new author edits create a catch-up snapshot. Ordinary author text edits remain preserved; structural changes are guarded before optimistic mutation, including after delayed delete/file-read confirmation. Existing generation and mutation barriers prevent crossing an already pending commit. Chapter CRUD waits for other owners before publishing its own barrier; its committed internal chapter selection does not re-enter that same barrier. Pure intent checks precede any scope revocation, and the final synchronous claim rejects stale forms/confirmations and newly pending owners.

The UI distinguishes:

- **Clean:** the save drain settled with no remaining unsaved edits.
- **Known failure:** retain once-applied text and allow explicit save-only retry through the same recovery token, never another Append, model call or retrieval. A conflict is not permission to refresh the CAS baseline or overwrite.
- **Pending/unknown:** keep the original operation and barrier; show Copy but no Retry/Append. After 30 seconds without a known commit or settlement, a local indicator marks that same handle unknown; it does not settle, cancel, release or retry the write. An actual commit receipt cancels the waiting timer. If uncertainty was already displayed, the overall operation may remain unknown/pending until settlement, but its initial-commit fact is shown as committed; that fact is never reset to zero or not-committed. Timeout is not rollback evidence. Late settlement belongs to the original handle.
- **Initial append committed, later catch-up failed:** preserve the initial commit fact and explain that newer author edits remain unsaved. Do not report the whole append as uncommitted.

Agent save requests are marked for explicit recovery only in process memory, never in the saved novel. Their shared cache publishes only after success; a failed Agent snapshot cannot leak into a later ordinary project save. While that same backend has a pending Agent request, a new ordinary save is rejected before changing its cache, revision or request state. Ordinary non-Agent cache/CAS behavior is unchanged.

Generic header/global retry cannot silently retry Agent recovery; the panel owns that explicit recovery action. Autosave/disposal/navigation do not implicitly retry a failed Agent save. Close/navigation waits for the actual post-append outcome; safe pre-mutation cancellation can release its temporary barrier. The existing same-project CAS is the durable protection, not an asynchronous freshness check alone.

## Visible audit and storage boundaries

The current panel shows phase, limits/reservations, correlated usage provenance, exact scope/tail, selected evidence and tool receipt. Review UI may show source excerpts or the validated query. The **copied audit excludes source text**: a query can repeat the tail, so only its digest/length is copied. Audit events exclude credentials, arbitrary URLs, provider error bodies, chain-of-thought and serialized source/tool payloads.

Run state is route-session-only. Refresh loses an unapplied proposal and approval; no hidden novel, graph, assistant-history or audit-document write occurs. Existing billing records for bounded calls omit prompt/response content. Complete backups remain local-only. The [bounded CI archive policy](ci-evidence.md) generates distinct summaries and named UI screenshots, excluding complete exports, reconstructable request collections and trace archives; it also records the initial run’s historical upload limitation.

## Frozen acceptance and current evidence status

[Fixture v1](../scripts/fixtures/writer-agent-v1.json), SHA256 `c50bae17f6a8eaf38906d181fb6307e44b81d2d5abc9fce6ad4f078991bd169f`, freezes **18 runtime groups and 18 built-app browser groups**. The browser harness registers 90 isolated scenarios within those 18 groups; variants do not inflate the group denominator. Its six-chapter synthetic corpus has an early source, target/cutoff chapter four, later canaries, an unrelated novel, literal entities, surrogate pairs and source-instruction text. The separate 600-chapter / 1,320,000-unit profile uses target/cutoff 400 and a source in chapter two; it is capacity/lifecycle evidence, not another semantic sample.

Required observations include real indexed retrieval, zero-write preview, exact two/one model/tool ceilings, strict duplicate-key rejection, author-only original evidence approval, current/disclosed source checks, every cancellation/close continuation boundary, actual save receipts and CAS, unknown recovery, no duplicate autosave, actual template mounting and 390px operation. Actual SDK wire checks for supported providers are separate from runtime mocks. Tests must report real executed groups, source/write/request counters and omissions; a fixture specification is not a passing result.

Local browser installation/execution is not performed in this environment. Built-app acceptance runs in GitHub CI after the production build. Existing eleven jobs remain required, with `ci-writer-agent` added as a twelfth independent required job. `test:browser-writer-agent` is deliberately separate from the older `test:browser` aggregate; the six Agent smoke scripts and separate archive-policy smoke enter `smoke:all` through dynamic discovery. Independent review and all necessary checks must pass on the precise proposed head. Controlled replies establish engineering behavior, not novel-writing quality. There has been no new live-model request for this increment; the earlier Go transport failure is neither a successful integration nor evidence that credentials/routes are invalid or cost zero.

### Evidence boundaries

Browser counters distinguish actual HTTP arrivals, Worker sync/search, metadata write attempts, durable commits and editor insertions. A browser cannot independently observe entry into private `prepareWriterMemoryContext` before its first read, so that counter is `null`, supplemented by exact-entry Node tests rather than fabricated as one. Likewise, a saving-indicator transition is a UI proxy, not a save-method invocation: `novelSaveAttempts` is `null`, `savingIndicatorTransitions` is reported separately, and exact call ownership uses Node integration tests. Actual metadata attempts, commit-gate entries and durable commits retain their browser assertions. Disabled/unmounted active configuration controls and same-page raw-ref races use real Vue Node integration tests; browser DOM attacks are labelled and are not described as normal author clicks. Runtime R08 empty attachments are tested at the production serializer boundary rather than by inventing an evidence capability.

The 90 scenarios and both 600-chapter viewport profiles remain **not run locally**. A passing native suite or a frozen scenario registration is not browser acceptance. The first full native run exposed a global status-listener exception regression in the existing graph-backup restore case; the listener semantics were restored without weakening that assertion, and the resulting source snapshot passed a complete rerun: lint with zero warnings, production build and all 102 smoke suites. The [compact native evidence](testing/writer-agent-2026-10-23/LOCAL-VALIDATION.json) separates this successful rerun from the retained historical failure. Subsequent CI exposed a chapter-CRUD self-wait and two harness setup/observation mistakes. Those fixes, the new archive policy and all unchanged safety assertions passed a fresh lint/build/**103-suite** run with 403 source hashes unchanged. [CI follow-up](testing/writer-agent-2026-10-23/CI-FOLLOWUP.json) preserves the partial failures and historical uploads. Exact-head CI is still required.

The next exact-head run (`39982647437`, `ff62bce`) passed the eleven existing jobs but the Agent test reached its unchanged 20-minute limit: 40/90 scenarios attempted, 5 passed, 35 failed and 50 not run. No model HTTP request arrived. A native-fetch receiver defect in the browser probe was independently reproduced with a strict-receiver Node shell; the correction binds the genuine native function, preserves its arguments/response/reader, and adds a durable probe smoke. Phase observation fails promptly on an unexpected terminal state but does not shorten production deadlines or remove scenarios. This is a harness correction, not a production change or browser success claim. All 13 actual new evidence archives passed independent content/hash checks; archive compliance does not close functional acceptance.

The corrected frozen snapshot passed lint with zero warnings, production build and all **104 smoke suites**; all **405 source hashes** stayed identical before/after. The new 12-checkpoint probe suite is Node simulation evidence, not a substitute for the next exact-head twelve-job CI.

A subsequent full browser run (`39988026209`, head `766128cb`, synthetic merge checkout `5d883e7d`, same tree `7deaabdc`) completed **90/90 scenarios: 75 passed, 15 failed, none skipped**; the eleven existing jobs passed. Nine failures observed real extra metadata writes after editor HTML normalization, not extra model calls or a fabricated save-entry counter. The first-save boundary above addresses that production defect. The remaining failures exposed five modal/entry-point assumptions and one already-selected-chapter setup race. Their correction retains all 90 scenarios and strict one-commit assertions. Literal escaping is checked by exact inert-DOM text plus zero dangerous nodes, not an entity spelling that the installed editor legitimately rewrites; viewport checks measure the inner dialog, not its full-screen overlay. The 13 actual archives passed the bounded-content audit (42 summaries, 102 UI images, 13 manifests), which does not turn these functional failures into success. A new exact-head full CI run is still required.

The resulting production-and-harness correction passed a fresh complete run: lint with zero warnings, production build and all **104 smoke suites**, with **406 source hashes unchanged**. The 20 UI checkpoint blocks and 19 probe/template checks are controlled native evidence, not 90 passing browser scenarios. One earlier focused runtime boundary wait failed without identifying its specific boundary; its unchanged-code rerun and this complete frozen run passed. Both historical logs are retained and distinguished in the compact evidence.
