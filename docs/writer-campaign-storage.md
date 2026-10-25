# Campaign storage allocation and settlement

[English](writer-campaign-storage.md) | [简体中文](writer-campaign-storage.zh-CN.md)

Status: PR #45 passed all 13 jobs and real-IDB bilingual million-scalar profiles before merge. Same-tree main follow-through then failed Node Chinese at 966,686 scalars, despite native profiles passing again. The [focused CPU repair and preserved failure](testing/writer-campaign-cpu-2026-10-25/REPORT.md) track this unresolved timing gate without raising limits. Historical local measurements below are unchanged; this is not autonomous novel or literary acceptance.

The preceding [durability foundation](writer-campaign-foundation.md) was accepted in PR #44: merge `84e704afff08921763d4b83136d881a39946900a`, tree `cc53d33565ff574fd6bbce2f76bdcca9aecda406`. [Main run 40154748857](https://github.com/PainAxis/LLM-Writer/actions/runs/40154748857) passed all twelve jobs, including all 90 author-Agent scenarios and all 12 Campaign cases. Those results do not validate the new accounting implementation.

## Scope and unchanged boundaries

This change addresses the foundation's permanent worst-case storage reservations. It does not raise the 67,108,864-byte ceiling, remove history checks, authorize live providers or add autonomous novel generation. Campaign remains isolated from ordinary Writer saves, fact graphs, API settings and ordinary backups. The Lab at `/#/campaigns` is an offline QA surface; opening or resuming never dispatches automatically.

The final requirement remains separate Chinese and English novels, each 1,000,000 body characters, autonomously planned and written with independently verified genre, plot, persona and foreshadowing consistency. Repeated synthetic characters measure storage geometry, not writing quality, creativity or absence of drift. See the [long-form acceptance contract](writer-agent-longform-acceptance.md).

## Versioned, exact accounting

New campaigns use schema/protocol v2. Existing v1 campaigns remain inspectable with their original integrity checks, but are read-only and are not rewritten, migrated, normalized on disk or given newly calculated credit. A current-looking runtime identity cannot authorize a v1 mutation. Unknown versions and corrupt records are rejected while preserving bytes.

Three quantities have different meanings:

- **W:** cumulative UTF-8 key-plus-value bytes of successful durable writes, including each overwritten head. It never decreases.
- **U:** remaining future-write allowances for all unresolved request allocations, including those detached from the active candidate/task index.
- **P:** remaining protected recovery storage. The initial pool is 524,288 bytes; it is part of the same ceiling, not additional capacity.

Every committed state must satisfy `W + U + P <= 67,108,864`. Live retained-map bytes, cumulative writes, physical IndexedDB quota and provider billing are different measurements. Neither settlement nor cancellation deletes historical records or promises physical disk availability.

Each request has an immutable allowance and identity. Actual request-phase writes increase W and consume the same amount from that allowance, so consumption alone does not create capacity. Only successful acceptance of that exact retained response as its artifact atomically releases the remaining allowance. Request revision, artifact, task eligibility, body count, checkpoint, receipt and settlement share one CAS.

Unknown, failed, cancelled and replaced requests are not refunded. Their open allocation rows remain independently reachable after active task references change. The open index has an explicit maximum of 128 rows; a 129th unresolved allocation is refused before another reserve/intent. This is not a promise that 128 maximum-sized allocations fit simultaneously. Historical operation/attempt limits remain finite and separate.

Readers reconstruct allocated, consumed, released and outstanding totals from immutable receipts and verify the checkpoint index. An unchanged active task list is not proof that no obligation exists. Exact receipt replay makes no second write or release. A changed business payload under an old operation ID is rejected. Lost acknowledgement remains unknown until verified receipt/fencing evidence establishes the actual result; save-only recovery does not call the provider again.

## Finite byte representation and envelopes

All persisted storage-byte fields use exactly sixteen ASCII decimal digits, decoded only as bounded safe integers with one canonical spelling. The repository freezes record shape and identities, measures with fixed-width placeholders, fills computed counters/hashes, then independently recounts final key/value bytes. The final count must equal the measured charge before CAS.

This representation avoids a real sizing pitfall: variable-width charged bytes `x` and residual `100-x` can yield `f(x)=87+digits(x)+digits(100-x)`, which cycles between 90 and 91. Bounded iteration alone would reject a valid operation despite sufficient capacity. Fixed-width feedback-dependent fields and hashes make the size function constant for a frozen legal shape. Array membership, keys and field presence cannot depend on a guessed charge.

The longest charged request path is reserve → intent → optional unknown → retain → accept: five request/checkpoint/receipt/head writes and one artifact at acceptance. Only retained and committed request revisions contain the response; the artifact is its third persisted text copy. No generic reconcile path may append arbitrary extra request phases or batch unrelated allocations.

The conservative initial allowance is `A = 5M + 5Q + 3X + G`, where:

- `M = 16,384 + 1,024*T + 512*128` covers a complete metadata transaction at the full future task/open-index bound.
- `Q = 8,192 + S`, with S the exact UTF-8 size of `JSON.stringify(preparedInput)`, including the outer string encoding of the already assembled input document.
- `X = 6*R + 2` bounds one unknown response string with UTF-8 ceiling R, including JSON escaping.
- `G = 4,096 + 256*T` covers artifact metadata and its dependency references.

For T <= 128 and 65,536-byte input/response limits, the allowance is at most 4,288,528 bytes. Loose individual-value bounds are 794,628 bytes for a request, 430,082 for an artifact and 212,992 for a checkpoint, below the unchanged 1 MiB record limit. A multi-record transaction may exceed 1 MiB without any individual record doing so. These are serialization bounds, not measured browser throughput.

The protected final-cancel envelope is `F(T)=16,384+1,024*T+512*128`, at most 212,992 bytes, a subset of P. Non-cancel recovery must leave F plus the existing final operation/time allowance untouched. Final cancel charges its actual bytes, does not settle unknown allocations, and cannot guarantee success against browser quota/open/transaction failures.

## Dispatch and ownership remain separate

Durable dispatch intent remains the authorization linearization point. Cancellation cannot retract an already authorized in-flight invocation or establish zero provider cost. It rejects new intents and late artifact acceptance. A new epoch, absent adapter record or reproducible fixture text cannot turn unknown into not-sent. Candidate replacement invalidates dependent eligibility while preserving historical obligations. Fixed-width storage accounting grants no new external capability or manual Writer permission.

## Validation and capacity claims

The frozen baseline targets 123 tasks and 60 body chapters per language. V1 stopped at 200,004 Chinese / 350,007 English body scalars under the same 64 MiB ceiling, despite only 6,346,657 / 6,618,786 cumulative written bytes. The reservation gap was conservative headroom, not unexplained disk growth. Those historical observations remain unchanged.

V2 must be measured on that unchanged geometry, not a smaller task graph or an increased cap. Node injected-atomic-IO and browser default-repository/native-IDB profiles are separate results. Preserve real action/IO deadlines. Report committed tasks/scalars, actual fixture entries, W/U/P, released bytes, live bytes, per-record/batch peaks, cumulative reads and cold-restart costs. Refusal, timeout or incomplete execution must remain visible, not be relabelled capacity success.

Accounting regressions cover exact write-byte oracles; all phase prefixes and escaping; encoding boundaries; unknown/orphan allocations; simultaneous acceptance, cancellation and replacement; abort and ACK loss; duplicate commands; final-cancel reserve; v1 read-only and future-version preservation. The existing twelve Campaign cases and ninety author-Agent scenarios remain required. Additional real-IDB accounting cases do not retroactively change those denominators.

Full-history verification remains intact. The reader fetches each historical request/artifact event once in head-guarded batches of at most 32 keys plus the head, replays all contextual eligibility/ledger/write-byte checks, and captures only exact final-index references already validated in those events. Every wanted key/id/revision/hash must be covered. Retention is bounded to 512 distinct wanted records and at most the cumulative W / 64 MiB serialized key/value payload; this is not a JavaScript heap measurement. The open-request replay map is separately limited to 128 and shares validated objects. No raw duplicate or cross-read cache is retained. Parent chains remain proven from the empty genesis and each chronological event. Checkpoint/receipt byte charges reuse only the actual UTF-8 raw lengths measured after their complete canonical/schema/hash validation, not a guessed size or skipped check. Task/reference equality compares every field in the closed validated shape, retains shape guards, and is tested against the prior canonical-JSON oracle with 1,185 comparisons and 27 malformed-input refusals. Final head/catalog/successor checks and commit CAS remain.

The engine removes two refreshes already dominated by the following full-verification commit, reducing the normal successful path from seven full reads to five. It still cannot rebase a stale response or issue a permit after a conflicting intent. Clock/run checks and original deadlines remain. Repeated IO and cold costs are measured separately; no head-only trust or workload reduction is used to make a profile pass. An external mutation after a record's last read without updating the repository head is not promised to be detectable at every instant; each subsequent read must reload and validate the entire history.

## Current Node observation and remaining native gate

On one frozen production snapshot, Chinese and English each completed 1,000,000 body scalars / 123 tasks / 494 commits. W was 37,019,124 / 23,151,292 bytes; U and open allocations were zero; P remained 524,288 bytes. Execution took 519,718 / 411,663 ms, with maximum steps 9,177 / 7,227 ms. Full-history verification still read 10,316,863,418 / 6,237,533,858 bytes; cold repository reads took 1,836 / 1,424 ms. These are single Node observations, not browser process-restart or heap measurements. Eight matched prefixes confirm the final CPU correction changed no read/write counters; no statistical speed claim is made.

The thirteen-job CI retains all twelve existing jobs and adds native-IDB S01–S08 plus both full profiles. The new job uses 20 minutes for the measured 15.52-minute Node workload, an initial unmeasured 30-minute browser allowance (roughly twice Node), and 60 minutes total for installation/build/measurement/archive. Production limits remain unchanged. The native proof checks actual fault entry, duplicate receipts while running, complete retained obligations and a private exact checkpoint identity across process restart. That private identity is never added to public report rows.

## Evidence and cleanup

CI archives only exact allowlisted, dedicated closed-schema derived summaries and manifests. Unknown fields fail preparation. No full backup, trace, store dump, generated narrative or reconstructable request/response collection is uploaded; diagnostic errors are bounded enums/hashes, not raw stacks or DOM text. Source/build/probe identities distinguish production modules from test-only observers. The current core-source digest covers twelve named files, including the v1 read-only verifier and v2 accounting module; it is not a full compiler/dependency attestation. For a local uncommitted run, report.commit identifies the checked-out base, not the edited content; exact source/harness digests and the before/after manifest bind the measured source bytes. In the Node report, buildSha256 is this core-source digest, not a compiled binary hash. In the browser report it hashes the emitted test-driver asset set; harnessSha256 separately binds the driver and observer sources. Repository cold reads and actual browser-process reopen reads are reported separately. An all-zero browser buildSha256 is only an unavailable sentinel for setup that did not produce measured assets, never a successful build attestation.

Formal source, tests, validation reports and CI artifacts are retained. Disposable generated profiles and intermediate scratch material are cleaned only after testing is complete; original local-only backups and user files are not classified as disposable. No live-model or literary-quality acceptance is claimed by this storage work.
