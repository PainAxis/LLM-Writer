# Whole-disclosed-source candidate scan

[English](memory-novel-scan.md) | [简体中文](memory-novel-scan.zh-CN.md)

Status, 2026-10-22: stage-three track 4 is implemented but not yet accepted. Production build, zero-warning lint and all 97 smoke suites passed again after the support-mount integration; its 383-path snapshot is recorded separately in `post-support-mount-fix/validation.json`; see [retained evidence](testing/memory-novel-scan-2026-10-22/REPORT.md). Exact-revision independent review and all necessary CI remain required. The 20 browser scenarios below are written but **NOT RUN locally**; GitHub CI must establish their result. This finite product/engineering contract does not prove real-model quality or stage-three completion. See the [roadmap](../ROADMAP.md#stage-three-completion-contract).

## Product boundary and author workflow

Memory Lab offers a separate, default-off scan of the selected novel's saved text through the selected chapter, inclusive. Existing retrieval, full-range embedding and support-check consent do not start this scan.

1. Save and synchronize the manuscript, choose the disclosure cutoff, enable the feature and prepare a **zero-request preview**. It identifies the work, cutoff, chapter/character counts, exact A-window count, provider/model/endpoint, six cumulative budgets and per-call limits.
2. Explicitly start A to collect source-grounded routing cues from every eligible original-text window. A never starts B automatically.
3. Review the B preview and explicitly start B. It reports retained cues, enumerated route counts and a cumulative minimum call count. B planning is lazy: the singleton anchor-set minimum and the currently known jobs are lower bounds, not an exact total or remaining-call estimate.
4. Pause, add bounded authorization, retry one identified failed job, explicitly skip it, or stop the batch for partial review. A review-capacity pause has an exit: stop the batch, save or ignore every proposal, then start a new segment to continue unprocessed B before remaining A.
5. Review and save or ignore each proposal individually. Saving defaults to **not author-confirmed**. Confirmation in the relationship/plot list is a separate action, as are selecting and approving any current original evidence for Writer.

Scanning does not edit manuscripts, confirm proposals, select/approve Writer evidence, or run tools/Skills. There is no autonomous search, candidate feedback loop or unattended restart. Empty results do not prove that a relationship, setup or recovery is absent. A setup candidate does not mean “never recovered”; a possible recovery is not proof of author intent.

## A: exact original-text coverage

The planner uses the saved chapter order, not numeric IDs or story chronology. Every nonempty chapter through the inclusive cutoff is split into consecutive source atoms, each at most 1,000 UTF-16 units. Atoms are deterministically shortened to fit actual JSON-escaped character and UTF-8-byte limits, without normalization, truncation, sampling or splitting surrogate pairs. They never cross chapters. Whitespace and legal control characters remain source data.

Each A window has at most six primary atoms, plus at most one preceding and one following atom in the same chapter. The complete system instruction and serialized payload must fit the per-call limits; the primary count shrinks when necessary. Primary intervals partition the disclosed original exactly once. Repeated context increases sent-input cost, not covered-source counts. Empty chapters remain explicit coverage records.

A returns strict version-1 JSON: zero to four cues, each with one to four literal keys (at most 80 UTF-16 units each), one or two unique submitted references, and a routing kind (`relation`, `setup`, `recovery`, `bridge` or `event`). Every key must occur verbatim in cited text, and every cue must cite a primary atom. These are routing hints, not facts, summaries or canonical aliases. The model cannot supply offsets, application IDs or confirmation flags. A `saturated` response records a representation miss; the application does not silently ask again for more cues.

A window advances only after the entire response and current sources pass validation. The UI separates eligible, processed, remaining, skipped and failed characters/windows and displays per-chapter revisions. Failed characters are still part of remaining work until successfully retried or explicitly skipped. `sourceCoverage: complete` means all primary windows succeeded, not that every semantic fact was extracted.

## B: finite connection coverage

B rereads only the exact original atoms associated with retained cues. It does not receive A's assertions, book/chapter metadata, character profiles, existing graph descriptions, summaries, future chapters or hidden aliases. It enumerates:

- A singleton for every cue.
- Every adjacent pair and triple in cue order, sorted by earliest source atom and cue ID. Adjacency means adjacent retained cues, not every pair of adjacent chapters, and needs no shared literal key.
- Every unordered pair in each shared-literal-key bucket, regardless of chapter distance.
- Every three-cue shared-key bridge: a central cue shares a literal key with each of two others. An explicit A/B alias passage can supply both keys, but routing never establishes identity, causation or recovery by itself.

A job uses at most three cues and thus at most six original anchors. Duplicate original-atom sets are dispatched once; the first enumerated route owns their route count. Planning retains at most 65,536 distinct job IDs and yields after bounded planning work. Dense shared-name buckets can reach the planning or time limit before all combinations are enumerated.

`connectionCoverage: complete_for_contract` means the retained-cue routes have been exhausted without skipped/failed jobs, saturation or recorded connection gaps. It is separate from A coverage. The final `reviewing_complete_for_contract` state additionally requires complete A coverage. A later A segment adding cues reopens connection planning; an earlier B completion is not a completion claim for the new cues.

The contract does **not** promise distant semantic links without a common literal key or adjacency, cues/keys A failed to produce, arbitrary four-or-more-cue chains, context beyond submitted windows, or aliases only disclosed later. Source coverage is not arbitrary relationship completeness. The frozen evaluation retains these misses in its denominators.

## Budgets and finite capacity

All six dimensions accumulate across A, B, retries and segments of the same campaign. Grants are additive, identity-bound and idempotent by grant ID; neither continuation nor a new segment resets usage.

| Dimension | Default authorization | Campaign hard maximum |
| --- | ---: | ---: |
| Attempts | 64 | 4,096 |
| Active processing time, ms | 65,000 | 3,600,000 |
| System + serialized input, UTF-16 units | 1,024,000 | 65,536,000 |
| System + serialized input, UTF-8 bytes | 3,072,000 | 196,608,000 |
| Reserved output tokens | 76,800 | 4,915,200 |
| Reserved response bytes | 4,194,304 | 268,435,456 |

A dispatch reserves one attempt, exact serialized input, 1,200 output tokens and 65,536 response bytes before calling the provider, including failed attempts. Observed response bytes and attempted original-source characters are reported separately. Reservations are not actual token consumption, a monetary ceiling or a provider bill. The scan active-time ledger covers engine planning, scan/continuation guards, requests, parsing and publication work, not idle time or time spent waiting for an author decision. The next-segment input builder runs lazily inside the engine’s bounded active operation, so its committed-source/database preparation is charged to scan `activeMs`, not performed before accounting begins. Engine preparation (`preparationMs`) and explicit local review validation (`reviewMs`) are separately observed timings, not deductions from scan `activeMs` or a new background authorization. Engine review guards retain their 10-second bound, so exhausting scan allowance does not prevent local review/save. Saving invokes the engine’s review guard and an explicit pre-save `audit`, both recorded in `reviewMs`; only the actual own-CAS return advances the baseline before the post-save guard. The entire UI save workflow has a 10-second outer deadline. UI presentation and graph-store reads/writes outside those engine operations are not included in engine timings.

Per-call limits are 8,000 original-source units, 16,000 system-plus-JSON units, 48,000 UTF-8 bytes, 1,200 output tokens, 65,536 decoded response bytes and at most 30 seconds. The production bounded SDK adapter permits one attempt, no hidden retries, redirects, streaming, history, tools or content usage logging. Truncated output, invalid JSON, duplicate/extra fields, forged references and oversized responses fail the entire job.

Other bounds:

- Engine preparation and each engine source guard: 10 seconds; ready preview: up to five minutes; campaign lifetime: one hour, including pauses.
- Per-segment cue capacity: 2,048 by default, explicitly adjustable up to 8,192. The campaign's retained provenance index is independently bounded to 8,192 cues and 16 MiB of serialized cue/anchor data.
- Review pool: 512 candidates and 8 MiB serialized payload. Reserve up to four A cues or two B candidates before dispatch rather than evicting existing entries.
- Miss ledger: at most 128 detailed entries plus three scope-specific overflow lower bounds. Entries identify source chapter/revision/range/windows or connection route/job/atoms and segment where applicable, never manuscript text.

These are application payload/planning bounds, **not total browser/process-memory limits**. Captured manuscript text, source atoms, guards and other runtime objects consume additional memory. Repeated committed-source reads and hashing remain real long-novel costs; this track does not redesign stage-two storage.

## Pause, failure and cross-segment continuation

The normal sequence is `ready_a → running_a → ready_b → running_b → reviewing_*`, with explicit paused and terminal states. Start/advance operations share an in-flight promise, so repeated clicks do not create duplicate dispatches. Each advance performs at most one provider job; the UI advances while already authorized and running.

Pause waits for the current bounded request; Cancel aborts it, revokes the campaign and clears unsaved proposals. Cancellation cannot retract an already dispatched request or establish zero cost. Provider/protocol failures preserve the failed job and require an explicit retry or skip. A retry is a new charged attempt, not automatic authorization to keep retrying. Late responses cannot advance coverage or appear as candidates. Source/owner/configuration/graph changes, expiry and source-guard timeout invalidate instead of falling back to stale proposals.

At a full review pool, finish the batch and review its proposals individually. After all are saved or ignored, `nextSegment` validates the same sources, disclosure, configuration and known graph baseline, creates a new segment/generation, and retains the campaign ledger, source coverage, bounded provenance index, completed-job set and independent B cursor. **When A is already 100% covered, unfinished B still continues without resending completed B jobs.** Remaining A is offered after that B plan finishes. Failed work carried into the next segment still needs its explicit retry/skip decision.

A full provenance index is not silently evicted; explicitly skipping the remaining A range records source ranges and a connection gap. Planning capacity is a campaign hard stop, not bypassable by another segment or grant. Saturation and genuine capacity skips keep the result partial. Ordinary 512-pool batching itself is not a permanent miss or an excuse to restart B.

Starting a fresh preview creates a **new campaign and new authorization**, not a continuation. Within the current route, the UI keeps aggregate used costs and original-source attempts, plus the last eight stopped campaign ledgers and stop reasons. The stop-time snapshot is not a final provider invoice and does not acquire late response content. It contains no manuscript, model content or credentials. Navigation/reload discards the session, intermediate cues/proposals and route history; there is no cross-refresh resume or recoverable historical ledger, and absence of that history does not imply zero prior cost.

## Source safety, review and graph v2

There is no periodic whole-manuscript polling while idle, paused or reviewing. Visible previews/candidates/plot entries are the last validated snapshot and can become stale between operations; an unobserved external edit is not evidence of current validation. Explicit source/configuration/storage/focus events invalidate the affected session. Before dispatch, after asynchronous replies, before accepting checkpoints/publication, when opening evidence and around saves, action guards re-read committed sources and the expected graph revision. Independently checked chapter revisions, exact UTF-16 ranges/quotes, disclosure and ownership must all agree. No storage event is required to detect a conflicting committed edit. A candidate is published only after the final guard; if that guard runs out of budget, the scan pauses rather than showing unverified success.

Relationship candidates retain all support anchors and an `explicit` or `inferred` model label. Plot candidates are typed `setup_candidate` or `possible_recovery` records with every `setup`, `recovery` and `context` premise. Possible recovery requires both setup and recovery. The application assigns campaign/segment/job/candidate provenance. `semanticValidation: protocol-and-current-sources` validates protocol and citation currency, **not meaning or correctness**.

Each explicit save uses the existing graph compare-and-swap (CAS). Only the revision returned by an actual successful own save advances the review baseline; unrelated graph writes invalidate the remaining proposals. Exact duplicate content plus all anchors is ignored without another write. Failed or uncertain saves are not reported as success and must not be blindly repeated. If a save committed before subsequent source invalidation, the author data remains stored but stale evidence is hidden; it is not automatically deleted. Novel storage and graph CAS are separate transactions, not an atomic cross-domain save.

The graph document is now version 2 with both `relations` and `plotLinks`:

- Reading valid v1 normalizes an empty `plotLinks` array **in memory only**. It does not rewrite storage; an explicit save writes v2. The historical storage key is retained.
- Ordinary relation and plot saves preserve the other array. Plot entries retain every typed premise, full quote, range, revision and provenance. Limits remain explicit: 10,000 relations, 2,000 plot links, 8,000,000 aggregate quote units and 24,000,000 serialized document units.
- Unknown future versions are `unsupported-version`, not corrupt legacy data. Read, save, import, backup and restore reject them without overwriting existing graph bytes. Explicit restore may repair malformed or invalid known-version data, not an unsupported future schema.
- Backup/export retains author annotations regardless of current visibility; restore uses CAS and fresh graph revisions. Normalized export does not silently migrate the stored v1 document.
- After an observed source/disclosure change or the next action’s revalidation, editing an old cited chapter or narrowing disclosure hides the entire relation/plot link if any required premise is stale or undisclosed. Author confirmation never bypasses this check or changes the original inference label.

The saved plot panel exposes last-validated original evidence, rechecks it on actions, and offers separate confirmation and deletion; its search/display limit is 200 entries. Candidate review is paginated at 20 and chapter coverage at 50. Plot links and model explanations are not Writer evidence. Chapter generation, continuation and polishing continue to require separately selected/approved, current disclosed original sources; scanner results never automatically enter any of their prompts.

## Controlled evidence and limitations

The following are recorded local synthetic checks, not final-revision CI acceptance or real-model observations. The 10.5M measurements describe the recorded sample run, not an automatic rerun or performance claim for subsequent code revisions:

| Evidence | Observed bounded result | What it does not establish |
| --- | --- | --- |
| Engine and lifecycle checks | Focused protocol, budget, cancellation, freshness, failure/retry and segmentation checks passed during implementation. A controlled full run made 270 A + 807 B = 1,077 dispatches and produced 1,614 candidates across four review batches without repeated B dispatch; the continuation control explicitly ignores earlier batches rather than persisting them. | No claim that all later review edits passed final CI; no model-quality estimate. |
| Frozen version-1 corpus | 24 cases: 12 in-contract positives, six negative controls, six capability misses. Real engine → parser → review → v2 CAS path with a controlled provider. | Recorded gold responses do not demonstrate a real model's discovery or reasoning quality. |
| Geometry | 1,317,800 disclosed units across 599 chapters covered exactly; a separate 156,554-unit control-character/escaping input fits deterministic serialized windows. | Geometry alone does not run every window through a real provider or browser. |
| Production transport | Nine intercepted HTTP dispatches through the actual bounded SDK path, plus zero-dispatch rejection checks, using only mock responses. | No live service, real credentials, billing measurement or semantic assessment. |
| 10.5M capacity, retained 2026-10-22 19:32 sample (`f80dd12`) | 10,500,000 units, 500 chapters, 10,500 atoms, 2,000 windows; actual preparation and one controlled generator call followed by a one-call-budget pause. Suite elapsed 3.504 s, CPU 3.800613 s, cancellation 4 ms; RSS after 154,124,288 bytes (154.1 decimal MB), process maximum 151,412 KiB. Exact raw observation: `testing/memory-novel-scan-2026-10-22/capacity.log`. | Not a complete 10.5M A+B scan, real storage/browser benchmark, universal performance target or 16 MiB process-memory guarantee. |

Frozen fixture: [`novel-candidate-scan-v1.json`](../scripts/fixtures/novel-candidate-scan-v1.json), SHA-256 `6d54c1cc1a02d0fe1b4b7580b21c8e5fb02d13f15e9f712b853e6721b67a8206`. Report all three recovery denominators together: **12/18 all-story targets, 12/17 currently disclosed targets and 12/12 in-contract controlled targets**. Negative controls are separate, not extra recovered targets. Known capability misses cannot be removed from the broad denominator. An always-empty provider and a wrong-meaning response with valid anchors must fail the gold checks; valid citations alone are not semantic success.

The dedicated built-app suite currently defines 20 scenarios and is **NOT RUN**. Its targets are 1,501 intercepted scan HTTP requests plus three Writer HTTP requests, including 537 B jobs across the 512-candidate pool, a 599-A/9-B long-novel path, all three Writer modes, stale-source/disclosure rejection, backup/restore and 390px review/cancellation. These are expected counts, not observed browser results. `ci-memory-novel-scan` is a necessary independent acceptance job and intentionally stays outside the old `test:browser` aggregate to avoid duplicate execution.

No real model was called for this track. The earlier, separate authorized Go support-check observation had one transport failure, zero assessed cases, six not run and unknown cost; it is not candidate-scan quality evidence. There is no authorization here for another live-model attempt.

## Reproduction and finite acceptance gate

Use the repository's existing dependencies and supported Node version. These commands are instructions for reproducibility, not a statement that they have all run on the current revision:

```sh
npm run smoke:memory-novel-scan-engine
npm run smoke:memory-novel-scan-fixture
npm run smoke:memory-novel-scan-transport
npm run smoke:memory-novel-scan-ui
npm run smoke:memory-plot-links
npm run smoke:memory-novel-scan-capacity
# Deliberately expected to fail the frozen gold assertions:
node --import tsx scripts/smoke-memory-novel-scan-fixture.ts --mutant=always-empty
node --import tsx scripts/smoke-memory-novel-scan-fixture.ts --mutant=wrong-meaning

npm run typecheck
npm run lint -- --max-warnings=0
npm run smoke:all
npm run build
npm run test:browser
npm run test:browser-memory-novel-scan
```

Final acceptance requires blocker-free independent code review and **all necessary CI on the exact reviewed revision**, including the separate candidate browser job and existing graph/backup/full-scan/support-check/Writer gates. Verify zero-request previews and separate A/B starts; exact primary coverage and all-premise payloads; six-dimensional cumulative budgets; full-pool continuation without replay/reset; precise partial/miss reporting; stale/late/failed-save/concurrent-write rejection; v1/v2/future-version behavior; and each Writer mode independently. Matching English/Chinese scope, reproduction and resource/quality limitations are part of the gate.

A focused passing suite or this implementation closes only its own demonstrated scope. Tracks 1 and 2 are merged; track 3 and this track still require current-revision acceptance. Stage three remains open. Only after all four tracks and shared gates pass does the authorized stage-four draft/review loop begin using the existing models and tools, without introducing a Pi architecture.
