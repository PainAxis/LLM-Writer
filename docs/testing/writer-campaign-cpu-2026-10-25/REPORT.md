# Campaign validation CPU repair

[English](REPORT.md) | [简体中文](REPORT.zh-CN.md)

Status: local lint, strict TypeScript, production build and all 122 smoke suites passed on unchanged native sources. Both repaired Node capacity profiles also passed. Native browser CI and merged-main acceptance remain pending.

## Preserved failure and exact baseline

PR #45 passed all 13 jobs on its reviewed tree `b7609ad577272901ea3623416a2f2884057192b5`. Its merged-main run was different evidence: [run 40163096714](https://github.com/PainAxis/LLM-Writer/actions/runs/40163096714), commit `a0edc99f1b7e649d27ae5cb70050d42e9c123b08`, had 12 successful jobs and one failed storage job. The main source and harness digests matched the successful PR run. Neither that prior success nor the native results replace the failed Node gate.

The Node Chinese profile stopped with `operation_timeout` at 966,686 body scalars, 120 committed tasks, 121 fixture invocations and 486 committed operations. It preserved one open allocation with 1,927,388 outstanding bytes; accounting mismatches remained zero. Its failed-step wall observation was 14,014 ms including error handling/recovery. The original report did not identify whether the 3-second operation timer or remaining 10-second action time selected the timeout, so the exact boundary is **not collected**, not inferred.

Node English completed 1,000,000 scalars. Actual native IndexedDB completed both language profiles at 1,000,000 scalars each, all eight allocation/settlement boundary cases and exact cold-process restart verification. Native Chinese maximum step was 9,733 ms, close to the unchanged 10-second action ceiling. Main evidence therefore supports a narrow timing margin, not a proved platform fault or permission to raise limits.

The compact [baseline observation](BASELINE-MAIN.json) contains only source-free counters, identities and hashes of the retained local summaries. Original logs/reports remain unchanged locally. All 15 main archives, 161 members and 1,702 projected request rows passed the existing allowlist audit; no full backup, trace or reconstructable source collection was added.

## Intended repair boundary

- Reuse the byte length of an exact event string within its existing bounded history-read batch for write-accounting and retained-size checks. The public parser still measures and validates its own input. No caller-supplied trusted length, cross-read cache or skipped raw/hash/context validation is introduced.
- Calculate immutable request allowance geometry once within one accounting invocation, then derive the existing phase and future obligations from that same validated result. Unknown, cancelled, detached and failed obligations are not refunded.
- Reuse a freshly calculated value length within final write-entry verification. The independent final serialization measurement remains.
- Add bounded, source-free, monotonic timeout observations so future failures can identify the selected operation/action boundary and phase. Diagnostics do not grant authority, alter outcomes, persist state or disclose payloads.

These are CPU/diagnostic changes, not reduced repository IO. Keep the exact history-read sequence, final head/catalog/successor guards, canonical spelling, SHA-256 identities, ledger transitions, CAS checks and all existing limits. No new planning/canon feature is part of this repair.

## Bounded diagnostic semantics

The engine-local getter returns a detached snapshot with at most eight events and a saturated overflow counter. Events contain only a frozen phase, timer/action-check trigger, operation/action/tie selection, configured limits and monotonic elapsed/remaining times. Timer elapsed is sampled before synchronous abort listeners, but an event is retained only after the original timeout wins and settlement/abort occurs. Instrumentation failures cannot change runtime outcomes. A phase identifies where expiry was observed, not necessarily which preceding CPU work consumed the time. There is no callback, persistent trace or source-bearing identifier.

New storage reports use schema 2. Strict schema 1 input may be projected as derived schema 2 with explicit `not_collected` diagnostics; that does not add observations to historical evidence. A present collector with no retained event is `not_observed`, not a universal assertion that no timeout happened. Unknown fields, raw errors or source-bearing payloads are rejected.

## Focused checks

The frozen old-accounting oracle and candidate matched in 3,113 comparisons, including 602 identical refusals. The test also verified 18 actual-byte write measurements, six complete read sequences and 24 corrupt-raw refusals. Per-apply UTF-8 encode counts changed from six to two for reserve and four to two for other request phases; event raw is still measured twice, at the bounded frontier and independently by the public parser. These are work-count observations, not measured latency improvement.

An independent reviewer reran the CPU oracle, accounting, read-batches, store, engine (44 cases), UI and timeout diagnostic (15 cases) suites. The closed report suite passed 89 checks in the implementation run. These focused results do not replace the following gates.

The first strict-type run exposed an overbroad return annotation in the new CPU smoke helper. Narrowing it to exclude `create` changed no emitted JavaScript; the original failed log/manifests were retained, then the entire lint/type/build/122-suite sequence passed. The final 464-path native manifest was identical before and after that successful run.

## Frozen Node capacity observation

The clean measured code revision was `34593bfd40b565675c617d76aa7f8e5efc307b0e`, tree `b0f252e802dfcf150117c458b10f35359dab5c9b`. Source digest: `19dc196840d25aec8689f22116b094fdc47e8cf22413864eba9c251b50cc918b`; harness digest: `b8a9128073dabb959ca058d0832c79aaa655c996bc61980ee6c2eff962bf7f2a`. All 464 native paths stayed identical through full regression and both profiles. Later evidence/document changes do not change those measured bytes; exact final-head CI remains necessary.

| Metric | Chinese | English |
|---|---:|---:|
| Accepted body scalars / tasks / fixture calls | 1,000,000 / 123 / 123 | 1,000,000 / 123 / 123 |
| Committed transactions | 494 | 494 |
| Cumulative writes W | 37,019,200 B | 23,151,368 B |
| Outstanding U / protected P | 0 / 524,288 B | 0 / 524,288 B |
| Released allowance S | 170,064,291 B | 138,098,593 B |
| Total repository reads | 10,316,910,310 B / 23,500 calls | 6,237,580,750 B / 23,500 calls |
| Execution / maximum step | 478,994 / 8,471 ms | 397,301 / 7,253 ms |
| Cold repository read | 1,774 ms / 67 calls | 1,345 ms / 67 calls |
| Accounting mismatches / open allocations | 0 / 0 | 0 / 0 |
| Retained timeout observations | 0 | 0 |

The [compact observation](NODE-OBSERVATION.json) retains further exact ledger/read counters and the original report hash. All shared non-timing profile fields match the prior successful PR45 CI Node report, whose commit/tree provenance fields were also populated. This is an equality of workload/accounting observations across different revisions, not identity of source or a paired latency experiment. No statistical speedup, universal hardware guarantee, reduced IO amplification or browser pass is inferred. The 10.32/6.24 GB read cost remains. Timing includes the measurement adapter's own byte-counting work.

The new profile never encountered a timeout, so it does not retrospectively identify the old failure's timer. Deterministic tests separately establish the diagnostic distinctions. Both million-scalar bodies are fixed structural repetitions, not novels. See [local validation identities](LOCAL-VALIDATION.json).

## Verification required

Frozen-oracle equivalence, corruption/refusal and timeout diagnostics tests precede full lint/type/build/smoke regression. Both unchanged bilingual Node profiles and native IndexedDB profiles must pass on the final source, alongside all 13 necessary CI jobs and merged-main follow-through. Successful historical runs are not combined across revisions into a repair pass. Record actual source/harness identities and timing without presenting a single comparison as a statistical speedup claim.

Full synthetic narratives, request/response collections, backups and traces remain local. Public CI evidence is closed-schema derived metadata. Temporary scratch copies are cleaned only after all testing; functional code, formal tests, validation reports, CI artifacts and original local backups are retained.

Autonomous novel generation, real-model writing quality and the two complete million-character literary/continuity audits remain **NOT RUN**.
