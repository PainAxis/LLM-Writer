# Memory index and semantic capacity

[English](memory-capacity.md) | [简体中文](memory-capacity.zh-CN.md)

This stage-three increment measures cold indexing, committed-source reading and verification, recovery and bounded semantic-cache costs before choosing one optimization: hydrate referenced chapter bodies through the existing **single IndexedDB read transaction**. It still reads every referenced body on every committed-source read. It changes neither retrieval ranking nor any manuscript, vector, request or evidence budget.

## Scope and retained guarantees

The measured baseline is merged PR #36, main `760042683405760428688d1a7d7f0346e2ff77d3`. The measurement-only implementation preceded the production change. The focused change is in `novelPersistence.hydrateContents`: capture chapter/reference pairs before the first asynchronous wait, call `idbGetMany`, require transaction completion and all bodies, then fill the chapters and remove their references. Missing bodies or an aborted transaction cannot publish a partially hydrated source.

No reusable source-body cache is introduced. Existing committed-metadata stability checks, bounded retry, pending/failed-save handling and cross-tab coordination remain in force. Every Writer freshness boundary still reads the committed source. This is a read-path optimization; stage-two chapter persistence and editor work remain separate.

[Exact identifier recall](memory-mixed-query-recall.md), [unverified match indicators and individual evidence selection](memory-evidence-review.md), current revisions, disclosure cutoffs, complete graph premises, stale-source rejection and optional-provider consent retain their existing contracts. No numeric score is used to claim answerability. Embeddings, reranking and external services remain separately opt-in; stage-four Agent work remains deferred.

## What was measured

| Workload | Fixture and method | What it measures |
| --- | --- | --- |
| Node index | Separate processes: 600 chapters / 1,320,000 characters and 2,500 / 10,500,000; procedural Chinese corpus | Full and unchanged synchronization, retained-baseline recovery, old-chapter edit, new-instance rebuild, CPU and memory, 200 local queries per size |
| Chromium committed source | 600 chapters / 1,423,494 characters and 2,500 / 10,470,894; each alone and beside one unrelated same-sized novel | Real localStorage / IndexedDB hydration, HTML conversion, JSON comparison/cloning and independently computed chapter revisions |
| Chromium Writer service | 600-chapter profile, alone and with an unrelated novel | Cold preparation, fresh-page preparation, explicit single-source selection and real pre-transport/pre-accept freshness checks |
| Bounded semantic cache | Independent 2,001 complete chapters / 1,200,600 characters, one passage per chapter; 512 and 4,096 dimensions | Cold/warm cache, narrower/expanded disclosure, retained recovery, one old-chapter replacement, disable/restore and over-capacity fallback |
| Built-app business acceptance | Memory Lab → Writer; long manuscript with the selected exact-code source beyond the first 2,000 passages | User-visible fallback, no implicit selection, current-source approval and captured generation payloads |

Character counts and source/evidence budgets use UTF-16 code units, not word or token counts; serialized request/response sizes use UTF-8 bytes. The fixtures are intentionally different and are identified by hashes in the [compact measurement record](testing/memory-capacity-2026-10-08/review.json). The Node “million” profile here is **1.32M**, not the historical Writer 1.44M profile. The Chromium source probe bundles the actual services but does not mount the product UI; the separate built-app suite owns that acceptance.

## Pre-optimization baseline — 2026-10-08

The first Chromium baseline used three fresh pages per collection. These are descriptive medians, not latency percentiles or device guarantees. Each page starts on already committed data; “cold” excludes browser launch, downloads and an operating-system cold disk cache.

| Target / collection | Source read median | Body reads / transactions per read | Cold persistence initialization | Disclosed JSON comparison |
| --- | ---: | ---: | ---: | ---: |
| 600 chapters / one novel | 34.1 ms | 593 / 593 | 43.1 ms | 4.7 ms |
| 600 chapters / two novels | 67.1 ms | 1,186 / 1,186 | 84.8 ms | 5.0 ms |
| 2,500 chapters / one novel | 186.3 ms | 2,493 / 2,493 | 213.2 ms | 28.8 ms |
| 2,500 chapters / two novels | 405.5 ms | 4,986 / 4,986 | 470.5 ms | 28.0 ms |

`readMemoryNovel` currently hydrates the entire stored novel collection before selecting the target. The unrelated novel therefore increases real source-read cost. A 600-chapter cold Writer preparation made six committed-source reads; explicit selection made two, and each measured freshness check made one. The proposed optimization removes per-body transaction overhead while preserving these read counts and every body read. It does not remove the whole-collection hydration or JSON verification cost.

The independent Node baseline passed both sizes. The semantic run records the later measurement-only commit `3915dcf`; its production index/provider hashes still equal main, and the record retains both identities. Each ran 200 local queries; 1,112 exact-source checks passed across the two profiles, with no network requests.

| Node profile | Cold full sync | Unchanged / retained recovery | One old-chapter update | New-instance full recovery | Process maximum RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 600 chapters / 1.32M | 8.231 s | 2.056 / 1.832 ms | 30.429 ms | 8.384 s | 352 MiB |
| 2,500 chapters / 10.5M | 72.315 s | 9.333 / 6.687 ms | 85.143 ms | 71.095 s | 1,428 MiB |

These are single-phase measurements on the recorded local machine, not a speed comparison with earlier PR reports or the CI browser runner. Cold indexing is still the larger long-novel cost. A new Worker/index has no persisted index snapshot to restore and must rebuild; “retained recovery” only revalidates a completed in-memory baseline. This increment does not change the index engine.

## Bounded semantic accounting

The production limits remain **2,000 eligible passages, 32 MiB of cached Float32 payload, batches of 32 passages, 4,096 maximum dimensions and the existing remote time budget**. The cache test uses deterministic all-one responses through production provider parsing, with a full-source freshness guard before each mock request. It measures accounting and boundaries, not semantic quality or real-provider latency.

| Dimensions | 2,000-vector payload | Cold / warm 2,000 passages | Cold passage / query requests | Mock response JSON |
| --- | ---: | ---: | ---: | ---: |
| 512 | 3.906 MiB | 950.295 / 25.039 ms | 63 / 1 | 2,103,060 bytes |
| 4,096 | 31.25 MiB | 1,512.383 / 48.714 ms | 63 / 1 | 16,446,228 bytes |

Warm queries, narrowed disclosure and expansion reuse eligible vectors but still request the query embedding. Editing one old chapter embeds one replacement passage plus the query. Disabling semantics clears vectors; re-enabling rebuilds all 2,000. At **2,001 eligible passages**, both dimensions explicitly fall back to complete local retrieval with **zero passage and query embedding requests**, rather than silently indexing only the first 2,000. This preserves local exact-code/clue retrieval but forfeits semantic recall for that search. Narrowing disclosure can make semantics eligible again, but changes the permitted story range and is an author decision. These measurements keep reranking disabled; separately enabling it can still send bounded local candidates for reranking.

Across both dimensions, the baseline made 268 mock requests covering 8,002 passage items and 14 query items, passed 268 per-request source guards and 118 exact-source checks, and made zero real network requests. Narrowing or over-capacity fallback does not empty previously cached vectors: resident-payload figures are reference accounting for the tested sequence, not direct heap measurements. Float32 payload excludes metadata, JSON, transient arrays and keyword-index memory. The synthetic JSON sizes reflect all-one values, not realistic floating-point response sizes. Even 2,000 × 4,096 uses only 31.25 MiB, so this workload does **not** exercise the 32 MiB byte-limit eviction. The two dimension runs are sequential cases, not a controlled dimension-speed comparison.

## Controlled comparison

The capacity CI job runs the same current harness against fixed main and the candidate on one runner in **baseline, candidate, candidate, baseline (ABBA)** order. Each run uses fresh contexts for target-only and target-plus-unrelated collections. The comparator requires identical fixtures, source hashes, returned evidence, revisions, ranges, selected attachments, assessments, body-read counts and Writer source-read counts. Only transaction organization changes. It reports each sample and medians without enforcing a machine-dependent latency threshold.

The initial baseline above selected the optimization. Final before/after values come from this paired run, not a comparison across machines. The PR's current CI and its artifacts establish validation status.

The paired **CI #106** run passed **48 source samples, 768 measurements and 64 compared evidence records**. It used one AMD EPYC 7763 runner, Node 24.21.0 and Chromium 153.0.8010.12. The baseline is fixed main `7600426`; candidate `f763439` is GitHub's integration-test merge for PR head `b55c68d`, not a separate production change. Production dependency hashes confirm that only `novelPersistence.ts` differs. The initial CI #105 baseline used different hardware and is not used to calculate these improvements.

| Target / collection | Source read baseline → candidate | Median change | Body gets unchanged | Body transactions baseline → candidate |
| --- | ---: | ---: | ---: | ---: |
| 600 chapters / one novel | 60.40 → 27.15 ms | −55.1% | 593 | 593 → 1 |
| 600 chapters / two novels | 120.50 → 53.15 ms | −55.9% | 1,186 | 1,186 → 1 |
| 2,500 chapters / one novel | 291.75 → 137.50 ms | −52.9% | 2,493 | 2,493 → 1 |
| 2,500 chapters / two novels | 735.30 → 199.80 ms | −72.8% | 4,986 | 4,986 → 1 |

Each source-read median has **six observations per implementation**. Page-level cold persistence initialization also improved: 76.05 → 40.60, 146.35 → 75.45, 332.25 → 159.75 and 817.95 → 315.70 ms in the same row order. It still loads the complete collection.

| 600-chapter Writer service phase | One novel, baseline → candidate | Two novels, baseline → candidate | Observations per implementation |
| --- | ---: | ---: | ---: |
| Cold preparation | 1,350.40 → 1,169.15 ms | 1,717.35 → 1,282.30 ms | 2 |
| Fresh-page preparation / index rebuild | 1,354.00 → 1,177.60 ms | 1,712.80 → 1,301.50 ms | 2 |
| Explicit single-source selection | 118.80 → 63.50 ms | 236.85 → 124.05 ms | 4 |
| Freshness before transport | 58.90 → 34.50 ms | 125.30 → 49.85 ms | 4 |
| Freshness before accepting output | 56.70 → 30.15 ms | 121.50 → 60.45 ms | 4 |

Preparation still reads committed sources six times, selection twice, and each measured freshness check once; graph reads and returned characters are unchanged. Worker synchronization stayed approximately the same (one novel: 925.75 → 925.15 ms), consistent with leaving the index engine untouched. The 48 nested source calls per implementation in each 600-chapter collection case are correlated calls, not 48 independent trials. Source and Writer phase durations overlap and must not be added together. These service measurements exclude mounted Writer layout, model latency and writing quality.

**Not every phase became faster.** With two 600-chapter novels, JSON snapshot cloning rose from 1.20 to 2.85 ms (+1.65 ms). Disclosed JSON comparison rose from 6.45 to 7.00 ms for one 600-chapter novel and 39.90 to 40.70 ms for two 2,500-chapter novels; other conversion, signature and revision-hash phases also had small regressions. All phase observations, minima, maxima and positive changes remain in the compact record and complete CI artifacts. The experiment demonstrates lower repeated-read transaction overhead, not a universal speedup or a cold-index solution.

## Maintaining the frozen comparison

This CI comparison is a frozen experiment for this optimization, not a baseline that automatically follows main. It deliberately fixes main `7600426`, the 17 production dependency hashes and the baseline/candidate transaction-count contract. A future change to a related dependency must review the experiment's purpose, baseline, fixtures and equivalence assertions in that PR while preserving this report. Do not restore a green check by only replacing a SHA, loosening the dependency list or removing assertions. Main after this optimization already batches reads, so it no longer satisfies the baseline's one-transaction-per-body contract and cannot be mechanically substituted.

## Reproduce and acceptance

```bash
node --expose-gc --import tsx scripts/benchmark-memory-capacity.ts --profile=million --output=artifacts/memory-capacity
node --expose-gc --import tsx scripts/benchmark-memory-capacity.ts --profile=ten-million --output=artifacts/memory-capacity
node --expose-gc --import tsx scripts/benchmark-memory-capacity.ts --profile=semantic --output=artifacts/memory-capacity
node scripts/benchmark-memory-source.mjs --profile=all --output=artifacts/memory-source-capacity
npm run smoke:source-hydration
npm run test:browser-writer-memory
```

The source runner accepts `--source-root`, and the capacity runner accepts `--engine-root`, so the same harness can import a separate baseline checkout. The `ci-memory-capacity` job records the paired Chromium source reports. The new Node index and semantic-accounting reports above were measured locally with the listed commands; the pre-existing CI stress jobs run their own separate workloads. Reports retain environment, implementation/harness/fixture hashes, raw phase timings, IO counters and source checks. CPU and memory sampling include instrumentation; process maximum RSS covers the entire process, while sampled heaps can miss synchronous peaks. The Chromium probe reports main-page heap observations, not total browser/Worker peak memory.

The configured regression set contains **80 smoke suites and 134 browser scenarios, including 21 Writer memory scenarios**. Source hydration covers missing bodies, transaction abort after successful requests, repeated references, key capture, metadata replacement and garbage collection, bounded retries, pending and failed saves, and zero reuse of the editor cache. The added built-app scenario keeps a late exact-code passage reachable beyond 2,000 eligible passages, requires individual approval, edits an old chapter and checks current revisions, lost old facts, retained clues and future exclusion through Memory Lab and Writer continuation. The existing scenarios cover chapter-body generation and polishing separately; the new over-capacity scenario does not claim those two paths were retested at that scale. Provider calls are captured synthetic requests; this is not real-model writing-quality evidence.

The CI #106 built-app Writer run separately passed **21/21 scenarios**. Its new continuation journey used **600 chapters / 2,486,774 characters**, disclosed 598 chapters / 2,486,640 characters and consistently found **2,374 eligible passages**. The late code is in narrative chapter 588, after at least 2,333 passages. With embeddings explicitly enabled and reranking disabled, all stages displayed semantic fallback and sent **zero embedding or rerank requests**. Three captured synthetic generation requests each contained exactly one author-selected current passage, no relationship, and `answerability: unverified`; independent source hashes/ranges, old-fact exclusion, distant-clue recovery and future exclusion passed. The scenario took 68.319 seconds. This is a separate business fixture, not the 1.423M source-timing corpus, and its timing is not a before/after performance result. Future-exclusion assertions concern retrieved evidence and selected generation context; free author graph annotations do not receive automatic semantic verification, as explained in the existing [graph review contract](memory-fact-graph.md#what-the-labels-mean).

Cold full indexing, new-instance rebuild, whole-collection hydration and source serialization remain costly. The semantic ceiling and its explicit local-retrieval tradeoff remain unchanged. Persistent index snapshots, a different over-budget semantic strategy and semantic answerability need separate measured designs; whole-novel extraction, stage-two editor/persistence expansion and the stage-four Agent are not included.
