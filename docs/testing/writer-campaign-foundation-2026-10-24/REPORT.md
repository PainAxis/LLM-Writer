# Campaign foundation: bounded engineering evidence

Baseline: merged main `70b453c6ae4c5b3d19b6fb9637f592510bbd043f`. This delivery adds an isolated production task/checkpoint/budget module and offline QA route. It does not add a live provider, autonomous creative orchestration or ordinary Writer save powers.

## Evidence classes

- Local lint, application build, all 113 smoke suites and the extra strict TypeScript check are recorded in `LOCAL-VALIDATION.json`. The 440-path before/after manifest prevents silent source drift. The original foundation passed 111 suites after an explicit test-only `number` annotation. The revised harness adds two lightweight regression suites; final regression uses the corrected source bytes, not a mixture of runs.
- Independent reviewers separately inspect durability/protocol/UI and closed archive/CI boundaries. Exact commit identity and necessary CI remain separate gates.
- The fixed real-IDB browser denominator is 12: C01–C03 ordinary production build; C04–C12 separately labelled offline-host fault/observation build. It retains the actual engine, store, CAS and IDB. **Browser execution is NOT RUN locally. The first published head failed Campaign CI (7/12); corrected exact-head CI is required.** No adapter-entry count is invented for ordinary builds.
- Source-free Node profiles use the actual engine/repository over injected atomic IO. They measure storage geometry, not real browser latency, model quality or a completed novel. All generated full text stays in memory/local; no full packet, backup, export, trace or reconstructable request collection is committed or uploaded.

## Capacity is a measured limitation

| Profile | Body scalars before refusal | Completed tasks/calls | Live serialized bytes | Cumulative written bytes | Permanent reserved bytes |
|---|---:|---:|---:|---:|---:|
| Chinese | 200,004 | 28 / 28 | 6,309,217 | 6,346,657 | 66,456,411 |
| English | 350,007 | 46 / 46 | 6,557,604 | 6,618,786 | 65,625,495 |

Both target 1,000,000 scalars/123 tasks but stop with `budget_exhausted` under the unchanged 67,108,864-byte ceiling. Worst-case permanent storage reservations dominate. Unknown provider obligations are not refunded. This is **not million-character capacity acceptance**. Exact input sizing and identified storage allocations/settlements are the immediate next accounting work, with crash, ACK-loss, concurrency and invalidated-unknown-request tests.

Cold verified Node reads were 173.89 / 236.81 ms. Total profile reads were 570,635,858 / 997,803,343 bytes in 10,577 / 26,957 batches; bounded individual batches do not eliminate repeated-history amplification. These observations require browser measurement before throughput claims.

## Remaining gates and scope

All twelve existing required CI jobs must pass on the exact published head, including the new Campaign browser step. The existing Agent 90-case test remains unchanged. The only new artifact is a closed-schema source-free summary and manifest; unknown fields reject preparation. Complete local raw material is not an archive fallback.

The [bilingual contract](../../writer-campaign-foundation.md) documents local-only data, missing Campaign export/backup support, 32-campaign catalog bound, exact runtime identity, cancellation after durable intent and unknown-request non-replay. Final stage-four acceptance remains **NOT RUN**: two autonomous novels, Chinese and English, each 1,000,000 body characters with full independent genre/plot/persona/foreshadowing review. No live calls or credentials are authorized by this engineering evidence.

## Initial CI retained as failure

Run [40121881904](https://github.com/PainAxis/LLM-Writer/actions/runs/40121881904), attempt 1, tested PR head `6e4d43b0109aa9e994f0d113ae916619d65eefad` through merge checkout `aec4afbd1248f44a8e414d60ebf04aa9dc301d0a`; both trees were `9a51afe784e9923c41b8722c1522796fde2489ab`. Eleven jobs passed; `ci-writer-agent` failed after its existing Agent 90-case step passed. Campaign: **7 passed, 5 failed, 0 not run**, with C04/C08/C09/C10/C12 failing and five browser errors. External requests and real-model requests were zero. The two-member derived artifact and its manifest were verified; `ci-initial-summary.json` SHA-256 is `77e1e505b52d16401cc2a28f4fc00ff39aa3a81dff80786aa60416d9fff4a129`.

The harness correction strengthens reload identity, full ordinary-storage isolation, cross-tab durable winner checks and pre-gate route/tab readiness. The probe now injects a synchronous put failure without pre-aborting the transaction, leaving the real CAS catch to perform one rollback. A strict Node native-state model reproduces the former double-abort exception and verifies the corrected path; it does not prove actual browser success or explain all five errors. An independent seven-scenario runtime rejection audit found no unhandled rejection in its controlled Node paths, not a browser-wide guarantee.

Closed report schema v2 adds fixed stage IDs and bounded enum/hash-only error diagnostics, with case ownership, late-error failure normalization and strict overflow consistency. It retains all twelve cases, the zero-browser-error gate and existing timeouts. Production and workflow files are unchanged by this follow-up. A new exact-head run must pass all required jobs; no old-head result substitutes for it.
