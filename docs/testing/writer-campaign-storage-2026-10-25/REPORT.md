# Campaign v2 storage accounting and bounded history verification

Status: both frozen Node structural profiles passed. Local full regression passed; independent final-head binding and real IndexedDB / required CI acceptance are still pending. This is not literary or autonomous-longform acceptance.

Baseline: PR #44, main `84e704afff08921763d4b83136d881a39946900a`, tree `cc53d33565ff574fd6bbce2f76bdcca9aecda406`; [main CI 40154748857](https://github.com/PainAxis/LLM-Writer/actions/runs/40154748857) passed twelve jobs, 90 author-Agent scenarios and 12 Campaign cases. The new storage work requires its own final-source tests, independent review and thirteen CI jobs.

## What is measured

The frozen structural profile has 123 tasks, including 60 body tasks totaling 1,000,000 Unicode scalars in each language. Body text is deterministic repeated synthetic characters; it is not a novel. The 64 MiB storage ceiling, 3-second IO limit and 10-second action limit are unchanged. No live provider is configured or called.

V2 separates cumulative actual key/value write bytes W, outstanding request allowances U and the protected recovery pool P. Only accepting an eligible exact retained response and artifact settles its remaining allocation. Unknown, failed, cancelled and detached obligations remain charged. The proof covers fixed-width storage fields, complete historical ledger replay, exact request identity, atomic receipt/acceptance, v1 read-only preservation and independent 128-open-row admission.

Node Map-backed atomic IO is not browser IndexedDB. Browser evidence uses the default production repository with native IndexedDB and a separate instrumented test driver. A browser process restart is not a new repository instance. The reports label these distinctions explicitly.

## Historical capacity and first exploratory v2 observation

V1 stopped on its permanent storage-reservation envelope at 200,004 Chinese / 350,007 English scalars, with only 6,346,657 / 6,618,786 cumulative bytes written. Those observations remain historical; they are not silently rewritten as v2 measurements.

The first exploratory v2 run released unused allowances correctly but reached the unchanged action deadline:

| Observation | Chinese | English |
| --- | ---: | ---: |
| Committed body scalars | 450,009 | 550,011 |
| Committed tasks / planned | 58 / 123 | 69 / 123 |
| Fixture entries / reserved attempts | 59 / 59 | 70 / 70 |
| Committed transactions | 238 | 282 |
| W, cumulative written bytes | 15,355,192 | 11,168,002 |
| U, outstanding bytes | 1,974,008 | 1,025,035 |
| P, recovery bytes remaining | 494,230 | 491,479 |
| Released allocation bytes | 81,034,185 | 79,160,594 |
| Cumulative repository read bytes | 4,880,234,533 | 3,557,698,247 |
| Repository read calls | 104,988 | 146,950 |
| Cold repository read milliseconds | 1,396 | 1,393 |
| Cold repository read bytes / calls | 25,392,946 / 493 | 15,647,051 / 585 |
| Execution milliseconds | 275,076 | 335,997 |
| Accounting mismatches | 0 | 0 |
| Result | operation_timeout | operation_timeout |

These are truncated workloads, not a complete capacity pass or a speed comparison. During this exploratory process, one metadata task-count validation line was added to `budget.ts` after module loading. The before/after manifest records that drift explicitly; this run is not final-frozen-source acceptance. The source-free report and log are retained locally with hashes. A clean final-source rerun is mandatory.

Read-path inspection found seven full reads per normal engine step and a second active-reference/parent traversal after full historical verification. The bounded correction must retain every history event and all eligibility, ledger, corruption, rollback, head/catalog and CAS checks. Reuse is confined to the same read, with explicit wanted-record coverage and finite entry/serialized-byte bounds. No cross-read trust cache or timeout increase is used.

## Same-source batched-reader measurement, still not a pass

The next run froze 460 native source/configuration paths before and after execution. Both manifests were identical, canonical SHA-256 `a2818007ec404f96133cbc7129cb0906ffd4554ef8862b4ffae3944fa2f7a38a`. This run used complete historical-event batching, same-read reference reuse and five full verifications per step; it did not use a cross-read cache.

| Observation | Chinese | English |
| --- | ---: | ---: |
| Committed body scalars / tasks | 800,016 / 100 | 883,351 / 110 |
| Fixture entries / reserved attempts | 101 / 101 | 111 / 111 |
| W, cumulative written bytes | 29,008,575 | 20,152,380 |
| U / P bytes | 1,942,421 / 483,706 | 1,301,569 / 481,204 |
| Released allowance bytes | 138,790,867 | 124,048,628 |
| Read bytes / calls | 6,759,881,822 / 16,632 | 4,985,014,258 / 19,655 |
| Cold repository ms / bytes / calls | 1,976 / 28,933,873 / 55 | 2,014 / 20,068,645 / 60 |
| Whole profile ms | 464,933 | 482,050 |
| Maximum awaited step ms | 14,086 | 14,220 |
| Accounting mismatches / result | 0 / operation_timeout | 0 / operation_timeout |

Maximum awaited step includes the existing separate, bounded failure-recovery read/commit after the 10-second active action window expires. It is not a raised dispatch/execution authorization window. Both stopped campaigns retained one unresolved allocation. The source-free report SHA-256 is `c6fe5b968db6a00c9635628837b35b88fdf482b306d34532d0881cb18a1a6620`.

This failed result is retained as a failed result, not overwritten by a later pass. Remaining CPU duplication was identified in canonical task/reference comparison and re-encoding already validated checkpoint/receipt JSON solely to recount its byte length. The follow-up preserves full schema/hash/context checks, compares all fields of the closed task/ref shape and uses the actual just-read canonical raw byte lengths for D. Its own frozen rerun remains required.

## Frozen production / Node capacity result

The final CPU-corrected run passed both unchanged structural profiles. All 461 native source/configuration paths were identical before and after, canonical SHA-256 `f54a7e542a607a45df319f483772ee7531429034b6892c3068bc6ef32ffa9a55`. Core source digest: `e956d58eb59f1127f45fc3513793e1225c646608df796fd85614961a4fddec2a`; measured harness digest: `4e40ec16cbc7a8834c514bd2c2ff4e82d027ffb62bcb9b026d4c72f631e96dc6`. Source-free report: 4,423 bytes, SHA-256 `6f47d028ae9fa04d1348e48fc4743669e9c1ffdbc4a4f82996cdacd53a220db9`.

| Observation | Chinese | English |
| --- | ---: | ---: |
| Committed body scalars | 1,000,000 | 1,000,000 |
| Committed tasks | 123 | 123 |
| Fixture entries / reserved attempts | 123 | 123 |
| Committed transactions | 494 | 494 |
| W, cumulative actual write bytes | 37,019,124 | 23,151,292 |
| L, cumulative allocated bytes | 207,040,098 | 161,206,568 |
| Q, allocation-consumed bytes | 36,975,807 | 23,107,975 |
| S, released bytes | 170,064,291 | 138,098,593 |
| U, outstanding bytes | 0 | 0 |
| P, remaining recovery bytes | 524,288 | 524,288 |
| Open allocations | 0 | 0 |
| Live serialized key/value bytes | 36,856,619 | 22,988,787 |
| Live record count | 1,606 | 1,606 |
| Total repository read bytes | 10,316,863,418 | 6,237,533,858 |
| Total repository read calls | 23,500 | 23,500 |
| Maximum read batch keys | 33 | 33 |
| Maximum read batch bytes | 1,381,528 | 1,381,446 |
| Cold repository read milliseconds | 1,836 | 1,424 |
| Cold repository read bytes | 36,924,625 | 23,056,793 |
| Cold repository read calls | 67 | 67 |
| Execution milliseconds | 519,718 | 411,663 |
| Maximum awaited step milliseconds | 9,177 | 7,227 |
| Accounting mismatches | 0 | 0 |
| Result | pass | pass |

Each profile has 60 body tasks and 123 total tasks. Both retain the 67,108,864-byte cap, 3-second IO and 10-second action limits. There are zero live-model requests. A cold repository object read is **not** a browser process restart. JavaScript heap/RSS and real browser throughput have not been measured by this Node run. The 10.32 / 6.24 GB cumulative reads remain a substantial full-history verification cost; completing this fixed geometry does not establish arbitrary task counts or unlimited revisions.

The final implementation-only change from the preceding frozen failed run is a CPU optimization, not an IO reduction: all eight observed matched successful prefixes have equal body/task/attempt/operation/write/read counters. At the 69-task prefix, Chinese execution was 204,132 → 150,242 ms and English 166,632 → 119,563 ms, with 8,492 read calls in both versions. These are single observations, not ABBA trials or a statistical speed guarantee. Do not compare complete-run time against a truncated failed workload as a speedup.

After this measured run, five browser-only proof/observer files were strengthened: actual fault-hit assertions, old-command replay while running, exact orphan allocation/budget comparisons, and a private checkpoint identity across real process restart. The production modules and shared capacity fixture were not changed. A later strict test-type check found three inference errors in the Node profile, store smoke and UI smoke; explicit types fixed them, with byte-identical ES2022/ESNext erased JavaScript verified for all three. The initial strict-check failure is retained, not represented as a full-suite pass. The measured report/harness digest is retained exactly; it is not relabelled as the later harness tree. Final-head CI must rerun both Node and native-IDB profiles, and final regression manifests bind the later harness bytes separately.

The new independent thirteenth job has a 20-minute Node step, based on 931.381 measured seconds (15.52 minutes); an initial unmeasured 30-minute native-IDB allowance, roughly twice that Node duration; and a 60-minute total including installation, build and bounded archive work. These orchestration limits do not change production action/IO authorization. The original twelve jobs are unchanged. Native IDB S01–S08 and both process-restart profiles remain **NOT RUN locally**, not passed by static review or the native-event model.

## Final local regression

Lint with `--max-warnings 0`, selected strict TypeScript scripts, production vue-tsc/Vite build and all **120 smoke suites** passed. All 461 native paths were equal before/after, canonical SHA-256 `73cf1d81177e336ed944c46af1f2c6bacef3291185316173592d41244a65b010`. The complete local log SHA-256 is `8738342ca00aec31be045526663b0d78531e3da3af501a4fdec3783954ba7cc0`. The first strict-type failure and the three byte-identical erased-JavaScript correction proofs are retained separately.

Independent review also executed seven core suites: store; accounting (9 cases, 49 decimal vectors, 144 phase prefixes); history reads (21 cases, 17 corruption refusals, two concurrent retries); the 263-transaction / 128-open-allocation boundary; 1,185 comparison checks / 27 invalid-shape refusals; engine (44 cases); and UI. The 129th open allocation was refused before CAS with 3,186,445 bytes of cap headroom, proving the independent row bound rather than incidental capacity exhaustion. Final cancel retained all 128 obligations. Native meter model (11 checks) and closed evidence (57 checks) are not actual-browser results.

See [compact validation evidence](LOCAL-VALIDATION.json) for changed-source hashes, exact measured-snapshot distinction, source-free capacity counters and hashes of retained local reports. No full raw log, store dump, generated manuscript or request/response collection is copied into this directory.

## Required remaining evidence

- All original twelve CI jobs, plus the independent native-IDB storage job with S01–S08 and both complete profiles.
- Exact source/build/harness identities and closed-archive validation; no raw text or backup collections.
- Independent review bound to the final local and remote trees.

Final Chinese and English autonomous million-character novels, live-model writing quality and full-work continuity acceptance remain NOT RUN. Formal tests, reports and CI artifacts are retained. Temporary generated material is cleaned only after all testing; original local-only backups are preserved.
