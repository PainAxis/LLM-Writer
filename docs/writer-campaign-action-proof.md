# Campaign action-private verification proof

[English](writer-campaign-action-proof.md) | [简体中文](writer-campaign-action-proof.zh-CN.md)

Status: local full regression and two same-source Node repetitions per language passed; native profiles and all 13 required CI jobs remain **NOT RUN**. This document describes the contract, limitations and acceptance gates, not an overall repair acceptance. The [storage allocation contract](writer-campaign-storage.md) and [long-form acceptance contract](writer-agent-longform-acceptance.md) remain separate.

## Preserved failure and purpose

The preceding CPU repair did not close the timing gate. PR #46 merged as `d098d27ba53a2edebbd1d7ec8dd49166cd81ec8f`, but [main run 40170296500](https://github.com/PainAxis/LLM-Writer/actions/runs/40170296500) stopped the Node Chinese profile at 966,686 committed body scalars, 120 completed tasks, 121 fixture invocations and 486 committed operations. One unresolved allocation retained U = 1,927,388 bytes. Native IndexedDB completed both languages at 1,000,000 scalars, 123 tasks and 494 operations each; those results do not replace the failed Node gate.

The diagnostic selected the remaining action budget during a commit: approximately 1,981.314 ms remained, the operation elapsed approximately 1,981.780 ms, and action age was approximately 9,999.599 ms. The configured limits were 3,000 ms per operation and 10,000 ms per action. The phase identifies where expiry was observed, not proof that this commit's CPU alone exhausted the cumulative budget. Earlier work, IO and runtime scheduling also contribute.

A normal existing-task step previously performed five full semantic history reads: its initial read, then reserve, dispatch intent, response retention and artifact acceptance. The candidate performs one complete cold semantic replay and four complete exact-raw historical observations, while fully validating every new transition. Startup, recovery and control paths can have different phase counts.

## Private authority and lifetime

`actionProof.ts` owns a repository-local pool; `store.ts` captures and verifies the proof; `engine.ts` passes an optional scope through the existing repository methods. A scope is an opaque token recognized by that repository's private `WeakMap`, not a caller-supplied flag, hash or TypeScript type assertion. It is bound to one campaign and one engine Run. The private current raw head must exactly match the caller's expected head.

The private snapshot is detached from caller-returned objects and Maps. New transitions derive their prior business state, storage baseline and active references from that private verified state, not mutable fields in a public snapshot. The caller cannot poison the proof by editing a returned checkpoint, artifact, request, receipt or Map.

Only one scope can retain a proof per repository instance, and operations on a scope are single-flight. Admission never queues another action behind the proof. Missing, foreign, expired or non-admitted capabilities grant no accelerated authority; ordinary unscoped calls remain cold. Injected repository wrappers still receive the normal read/commit calls, and wrappers that omit the optional scope remain correct without acceleration.

An action cannot transfer its proof to another command, repository, tab, recovery Run or restart. Completion, abort, timeout, stop/dispose, conflict, error, immutable mismatch or replay clears the proof as applicable. A late IO completion cannot resurrect cleared entries or grant a dispatch permit. Capacity/admission loss only disables the optimization; it cannot itself turn a valid read or confirmed durable write into failure.

## Exact observation before every accelerated transition

1. The first scoped read runs the existing complete cold verifier. It captures actual immutable key/raw-string pairs for the manifest, all checkpoints and receipts, and every historical request/artifact referenced by those receipts, including inactive revisions, settled origins, replaced artifacts and detached open obligations. A partial replay is never a proof.
2. At the next commit, the repository performs authoritative operation-receipt lookup and collision checks. It freshly reads the head, catalog and next checkpoint key. The head must match exactly, the validated catalog prefix through this campaign must remain, and the successor must be absent.
3. It fetches every captured immutable key again from IO, in batches of at most 32 immutable records plus the head. Batches also target at most 1 MiB of captured key/value bytes, permitting one individually bounded record when necessary. Every batch must return the expected head, and every historical value must literally equal the previously validated raw string for its key.
4. Missing or changed bytes fail closed. Semantically equivalent JSON, changed whitespace, same-length replacements or independently resealed records are not accepted as equivalent. Equal raw strings need not repeat historical parsing, canonical serialization, hashes, text metrics or ledger replay. This is not a hash-only, head-only, sampled or active-index-only check.
5. A fresh final head/catalog-prefix/successor fence remains. The append-only catalog prefix permits an unrelated campaign append, not reorder/removal. Every proposed transition still undergoes the complete contextual validators: state and epoch, task/candidate/dependency lineage, immutable request identity and phases, exact response acceptance, body-only counts, allocation conservation, actual serialized write charge and protected cancellation/recovery limits.
6. CAS still guards the exact old raw head and create-only immutable targets, with the existing `canCommit` boundary. Durable dispatch intent is still required before provider authorization. Only a positively acknowledged successful CAS extends the proof with the exact validated intended write strings, not whatever bytes a later reread happens to find. The following phase must reread these new entries too.

Matching prior-operation receipts or a competing identical CAS use independently verified receipt evidence and a full cold read, not an extension from a caller snapshot. Lost acknowledgement remains unknown until durable evidence resolves it; an in-memory proposed write is not proof of success. No extra provider invocation, refund, retry authority or history repair is introduced.

## Bounds, complexity and unchanged storage trust

The aggregate retained immutable key/value UTF-8 payload is at most 67,108,864 bytes per repository instance, and a sealed proof must also fit within verified cumulative written bytes W. Its entry ceiling is `4 × 2,048 + 1 = 8,193`. Caps apply while collecting, not just after sealing. Capacity exhaustion discards the whole proof; it never leaves a partially trusted history. Each action gets at most one capture attempt.

The proof retains raw strings and bounded metadata, not parsed copies of the entire history. Current parsed artifacts/requests remain bounded to 512 wanted records, including prior artifacts and open allocations, under the existing active-payload bound. The catalog prefix is bounded to 32 validated IDs. A confirmed write whose proof extension exceeds capacity remains a successful write, with subsequent verification using the cold path.

The raw-byte cap is **not a JavaScript heap cap**. UTF-16 strings, Map/key/object overhead, detached private/public active graphs, transient IO values, parser/hash allocations and garbage collection all matter. String interning is not a guaranteed saving. Multiple repository instances and browser tabs have separate pools. Report serialized retention and sampled heap separately; neither bounds total application memory.

If B is historical serialized size and k the action's transition count, the candidate still performs one full semantic read plus k full raw observations. Historical IO remains O((k + 1)B), with worst-case O(kB) raw comparison work. A growing campaign still incurs quadratic full-history IO across actions. This is not O(delta) resume, a persistent trusted index or a fix for unbounded history. Only repeated semantic work within one action is factored out.

The existing non-atomic observation-to-CAS window remains: readonly batches observe history separately, while the write transaction guards the head and new write targets, not every historical value. A raw writer can change a previously observed record without updating the head before CAS. Neither the old verifier nor this proof promises an atomic historical snapshot or detection at every instant. The next verification must observe every historical key again. Detecting such changes through the CAS linearization point requires a separately reviewed IO/transaction contract; no stronger storage immutability guarantee is assumed here.

There is no wire-schema migration, durable proof record, storage-accounting change, `blobStore.ts` change or limit increase. V2 validators and W/U/P conservation remain authoritative. V1 stays read-only; unsupported or corrupt bytes remain preserved and refused. The 128-task, 2,048-operation, 64 KiB text, 1 MiB record and 64 MiB cumulative-write limits remain finite and unchanged.

## Explicit deadline tightening

Candidate replacement now creates its Run before the initial read and passes that same Run to replacement receipt and operation-artifact replay lookups. These lookups therefore share the current action's remaining 10-second deadline, rather than receiving detached operation-only timing. This is a real tightening of enforcement, **not pure performance equivalence**: a replay that previously outlasted the cumulative action budget may now time out.

The nominal 3-second IO-operation and 10-second action ceilings are not increased or restarted at each phase. Recovery keeps its existing independently reserved behavior and does not inherit proof authority. Performance acceptance must include replacement/replay regressions as well as normal step throughput.

## Measurement and acceptance gates

Use the unchanged 123-task / 60-body-task geometry for Chinese and English in both Node injected-atomic IO and native IndexedDB. Success requires 1,000,000 committed body scalars, 123 completed tasks, exactly 123 fixture invocations, zero accounting mismatches and no unresolved allocation at completed success. Report W/U/P, committed operations, raw IO counts/bytes, bounded batch/record peaks and independent cold repository/process-restart costs. Label Node and native transaction accounting separately; their read counters are not interchangeable.

The candidate instrumentation adds bounded, source-free proof observations, sampled heap, action quantiles and a full bounded-operation timing histogram. Final-source evidence must establish their collection rather than infer observations from code:

- Proof counters distinguish cold attempts/completions, completed exact passes, matched records/bytes, validated transitions reaching CAS, retention high-water marks and allowlisted disposal/fallback reasons. Matched work can include a subsequently failed pass; transitions include cold fallback and unsuccessful CAS attempts. The `completed` disposal reason means explicit scope closure, including abort/finally cleanup, not a successful user action. None of these alone counts durable success.
- Action timing reports sample count and min/p50/p95/max using nearest-rank quantiles over at most 123 rounded step-duration samples. It must expose late-run headroom, not just total runtime or a single maximum labelled as a guarantee.
- Operation timing covers every `bounded()` winner settlement, including success/error/abort/timeout and synchronous invocation errors, not only timeout events. Fixed-phase rows contain count, outcome counts, min/max and a fixed-size histogram; late settlements are not counted again. Histogram-derived quantiles are approximate ranges, not exact samples. Retain the existing phase/selected-budget timeout diagnostics as separate evidence.
- Heap observations use Node process samples or Chromium `performance.memory` where available. Baseline, sampled peak and final usage are not a true allocation peak, live-proof memory attribution or a GC-pause measurement; Chromium values may be bucketed. Unavailable/failed collection must be marked, not filled with zero or claimed as a pass. Do not force GC or upload heap dumps.

Required regressions cover all historical record families, old inactive history, same-head corruption before/after each engine phase, caller-object mutation, foreign/disposed scopes, admission/cap boundaries, simultaneous or reentrant use, late completions, cancel/replacement, catalog/successor fences, CAS abort/false/guard-false, lost acknowledgement and save-only cold restart. Exercise critical paths through the actual engine/repository and native IDB, not only a standalone proof mock. Preserve existing independent cold-read, exact-wire, accounting, timeout, budget and UI suites, all twelve Campaign cases and ninety author-Agent scenarios.

Measure material, repeatable action/operation headroom on the designated runner, with no selected-budget timeout or newly pathological heap behavior. A single pass close to the deadline is insufficient to declare the timing problem fixed. No universal wall-time guarantee follows for arbitrarily slow hardware or runtimes.

## Measured results and remaining gates

| Exact-final-source gate | Status |
|---|---|
| Full local regression, including proof and replacement-deadline cases | PASSED: lint, strict types, build, 128 suites |
| Node Chinese / English million-scalar profiles and cold repository reads | PASSED twice per language; [local evidence](testing/writer-campaign-proof-2026-10-25/REPORT.md) |
| Native IndexedDB boundary cases, both profiles and cold-process restart | NOT RUN |
| Source-bound proof, action/operation timing and sampled-heap evidence | Node collected in both repetitions; native pending |
| All 13 necessary CI jobs and merged-main follow-through | NOT RUN |
| Actual autonomous Chinese and English million-character novels and literary/continuity audits | NOT RUN |

Pending entries require results tied to the actual final source/harness/build identities. Historical results from different revisions must not be combined into a repair pass. Synthetic repeated bodies test protocol geometry, not planning, literary quality, creativity or long-run consistency.

## Evidence handling

Keep full narratives, request/response collections, original backups, traces and store dumps local. Upload only dedicated closed-schema, source-free derived reports/manifests with allowlisted counters, timing summaries, bounded enums and source identities. Reject unknown fields; never include raw keys, campaign/operation IDs, manuscript text, credentials, raw error stacks or reconstructable payload collections. Sampled heap numbers are permitted observations; heap dumps are not.

Uncommitted-run commit IDs name the checkout base, not edited source. Exact source/harness digests and before/after manifests must bind the measured bytes; identify Node source hashes separately from actual browser build hashes. Failed/incomplete measurements remain visible. Do not clean retained original backups or formal evidence as disposable scratch, and do not claim a profile, CI or literary pass before it exists.

Local observation: action maxima were 2,220/2,365 ms (Chinese) and 1,763/1,810 ms (English), with zero timeout/error/abort. Heap and operation detail, retained baseline failure and remaining native/CI gates are in the [compact evidence](testing/writer-campaign-proof-2026-10-25/REPORT.md). This is not overall repair acceptance.
