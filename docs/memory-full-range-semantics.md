# Explicit full-range semantic scans

[English](memory-full-range-semantics.md) | [简体中文](memory-full-range-semantics.zh-CN.md)

This is the separately opt-in semantic-capacity track in the [finite stage-three completion contract](../ROADMAP.md#stage-three-completion-contract). It scores every eligible original passage in the selected disclosed range before publishing semantic results. It does not verify answers, extract a whole novel's relationships, select evidence for the author, or complete stage three.

PR #39 passed strict lint, the production build, its historical 86 local smoke suites and existing local/hybrid memory stress tests, with blocker-free independent review and all nine [PR CI jobs](https://github.com/PainAxis/LLM-Writer/actions/runs/39820390395), including 16 executed full-scan browser scenarios. It merged at `73e730a848c3272ad5a243d028cec65ad5b72c8b`; its [main workflow](https://github.com/PainAxis/LLM-Writer/actions/runs/39822084525) completed successfully. These are that revision's results, not automatic acceptance of later changes. [Cold indexing](memory-cold-index.md) was merged separately in PR #38 (`ed83bfef9903e8870ecf8b2b7ff2f47da6d2b5fc`), with its main CI passing. Historical indexing and hydration measurements retain their original scope and numbers.

## What changes, and what stays unchanged

- Full-range scanning, embeddings and reranking are off by default. Provider settings, keys and scan decisions stay in the route session.
- Without `MemoryRemoteOptions.fullScan`, the ordinary path is unchanged: enabled embeddings can cover up to 2,000 eligible passages; above that limit, semantic retrieval falls back to the complete local keyword, exact-code and author-clue channels with **zero embedding requests**. Independently enabled reranking retains its existing behavior, so zero embedding requests does not mean zero external requests.
- Explicit `fullScan: { maxCalls, maxActiveMs }` uses the bounded scan protocol at **any corpus size**, including 2,000 passages or fewer. A small corpus never bypasses an explicitly requested budget.
- “Full range” means the current eligible original passages through the selected inclusive disclosure cutoff. It does not include future chapters, old revisions, hidden sources or all possible answers. Existing local clue/code channels are preserved rather than replaced by a semantic shortlist.
- The cache still has both a 2,000-entry limit and a 32 MiB Float32-vector-payload limit. The scan can cover more than 2,000 passages without retaining all their vectors. Neither limit is a total-process-memory promise.

## Author workflow

The same controls appear in Memory Lab and Writer memory context.

1. Select the committed novel, query and disclosure cutoff. Enable the embedding provider separately, then enable **扫描全部已披露原文块** (scan all disclosed original passages). Reranking remains a separate choice.
2. Review the cumulative call-attempt and processing-time allocation. The initial UI defaults are **160 attempts and 65 seconds**. Five-minute and ten-minute choices require explicit selection; the application never silently chooses a longer duration.
3. Choose **准备扫描计划** (prepare scan plan). Local preparation reports exact eligible, valid-cached and missing passage counts, source-character estimates, and cold/current-cache call estimates. Planning makes **no query, passage or rerank provider request** and exposes no selectable evidence.
4. Review the plan, then choose **开始扫描** (Start). A budget or provider pause offers explicit continuation/retry, an additive budget grant, use-local, or cancellation. Progress shows scored/eligible passages, attempted/approved calls and used/approved processing time.
5. After completion, inspect the exact current sources. In Writer, individually select and approve the excerpts or complete relationships to use. Starting or extending a scan is not evidence-selection approval and does not authorize generation or manuscript edits.

Cancel remains available while processing and while waiting for a decision. Editing the source or changing the query, disclosure range or provider settings revokes the old operation. Continuing a paused scan does not repeat Writer preparation, save/sync the novel again, or silently restart the scan.

### Stopping with local results

**使用本地结果** stops every subsequent remote request, including reranking, discards **all** partial semantic contribution, and returns only the original local-channel results after a fresh source guard. Partial semantic scores are never mixed into this result. A rejected, stale or timed-out source guard is a failure, not a successful local fallback.

Source validation itself consumes processing time. If the processing-time budget is exhausted, use-local is disabled because the current authorization cannot fund that check. Either explicitly add time and continue, or **cancel the scan, turn off both embeddings and reranking, and start a new local query**. This is a new operation, not a hidden reset of the old budget. Exhausting only the call allocation does not prevent use-local when enough processing time remains.

## Budget and session contract

The authoritative totals belong to one private Worker session and one logical `MemoryClient.search` promise. Transport pages are implementation boundaries, not new authorizations.

| Bound | Meaning |
| --- | --- |
| Initial UI allocation | 160 attempted calls and 65,000 ms processing time |
| Explicit time choices | 65 seconds, 5 minutes or 10 minutes |
| Cumulative hard maxima | 4,096 attempted calls and 3,600,000 ms processing time |
| One processing page | At most 8 attempted calls and a 50-second processing allowance |
| Backstops | 15 seconds per provider request, 30 seconds per source guard and 90 seconds per Worker RPC; the existing 65-second ordinary engine bound is not raised |
| Absolute lifetime | One hour from session creation, including author decision waits |

Initial budgets must be positive safe integers and pass validation before external work. Additive grants carry the current session/generation and a grant ID, with nonnegative integer call/time additions. A zero-addition continuation is an explicit retry within the remaining allocation, not unlimited permission. Identical duplicate grants are idempotent; conflicting duplicates and stale handles fail without partially changing totals. Pages and retries never reset the cumulative ledger.

Query embedding, passage embedding, reranking, failed adapter calls and retries each consume an attempt **before** invoking the adapter. The counter describes attempted calls, not confirmed wire transmissions, billable requests, tokens or money. Enabled reranking is reserved in the plan estimate and consumes the same total budget. If its stage lacks allowance, the scan pauses rather than issuing an unauthorized call.

Processing time includes the scan's local preparation, scoring, source guards and provider waits. Waiting for an author's decision is excluded; it does not extend the fixed one-hour expiry. Initial source loading/index synchronization before scan creation is a separate cost. End-to-end elapsed time can therefore exceed the processing-time allocation. A page ceiling bounds ongoing work; it is not a browser scheduling or total-latency guarantee.

The client settles missing/throwing decision callbacks, callback rejection, abort, newer search, synchronization/invalidation, disposal, Worker errors, RPC timeout and absolute expiry. With no decision callback, it immediately chooses validated local-only completion rather than starting remotely or waiting forever. If source validation cannot finish safely, the promise rejects. A late callback or response cannot resurrect a canceled session. Worker loss, reload and navigation do not have a durable checkpoint or automatic resume/restart.

## Streaming, cache and freshness

The engine embeds the query first, then scores **all valid eligible cached passages before inserting misses**. This order avoids evicting still-useful cache entries before they have contributed. It embeds uncovered passages in batches of 32, validating the entire response before changing the coverage bitset, cache or cursor. A malformed or failed batch commits no partial coverage; an explicitly retried batch consumes another attempt.

The checkpoint keeps one query vector, coverage bits, cursors/counters and only the semantic top `min(limit * 4, 200)` IDs/scores. It does not hold an all-passage vector matrix. Only complete coverage can contribute to the existing cosine ordering, tie-breaking and local keyword/code/clue fusion. Optional reranking follows that fusion and remains subject to the same explicit allocation. Cache keys remain tied to current source identity and provider configuration; narrowing disclosure cannot reintroduce cached future chapters.

Current-source and operation ownership checks run before every external query, passage and rerank request, after asynchronous responses, and before final evidence publication. Memory Lab re-reads the committed source; Writer preserves its committed-source/graph checks and selection/approval pipeline. Old-chapter edits, replaced indexes, failed saves and concurrent source changes cannot be accepted merely because a scan was previously authorized.

Progress and diagnostics expose safe counts/status only, not provider response bodies, credentials, credential hashes, vectors, intermediate top-K results or source-text previews. Incomplete pages contain no final evidence. Complete semantic coverage still leaves every result's `answerability` **unverified**. An empty result does not establish that the manuscript contains no answer.

## Why full coverage rather than a candidate router

The choice addresses a coverage problem, not a newly measured model-accuracy advantage. Pre-implementation screening kept the same 4,096-passage synthetic source fixture and 46 independent positive probes with 62 required premises:

- A fixed half-local/half-range candidate pool included every required premise for only **0/46, 0/46 and 1/46** probes at pool sizes 64, 128 and 256.
- Query expansion with a hand-built English-to-Chinese dictionary improved those counts to **23/46, 23/46 and 24/46**, but still missed almost half the probes. The dictionary had seen the query vocabulary and is not a held-out language test.
- Executable fine-to-coarse routing recovered **46/46** under ideal synthetic geometry; perturbed geometry fell to **31/46 and 35/46** with 128 final candidates. Direct coarse source concatenation reached 26,220 characters, above the adapter's 8,192-character per-text cap. Pooling exact passage vectors required all 4,096 passage embeddings in the first place.

Those experiments do not ship as additional selectors, dictionaries or model providers. Their failures make candidate-routing assumptions explicit; they do not prove that routing is generally impossible. Full scanning removes the candidate-admission miss for eligible sources at the cost of potentially minutes of work and more source transmission. Actual embedding relevance, multi-hop reasoning, multilingual quality and generated-answer correctness still need separate evaluation.

## Focused engineering evidence

The repository fixture, [`scripts/fixtures/memory-semantic-fixture.mjs`](../scripts/fixtures/memory-semantic-fixture.mjs), reproduces frozen version `stage3-candidate-4096-v1` and verifies SHA-256 identities before use. Its short synthetic chapters, planted facts and exact oracle axes are deliberately artificial.

| Frozen input | SHA-256 |
| --- | --- |
| Corpus | `6cb8be20910e7d313f4ebed5756f0048301cf74ed1a01472c117e4605b524b5a` |
| Cases | `8b58cbb85e41ddd3d69df99c2af3c17c649b039358370aecadd4661033b947d4` |
| Controlled vectors | `f5af160a990212bb927159ec66d4c20e91ce79ef37ea6b1cfbcf880a401959dc` |
| Mutations | `73f823065e7619bdaf19c603138253488af255897646f417b79cf9ee8683ab72` |

The focused production-adapter integration run passed the following checks with intercepted in-process responses and **no external model/network calls**:

- All **46 independent probes / 62 required premises** were recovered with every premise in Top-5 on both cold and immediate-warm scans. Matches verify exact project, chapter, current revision, quote and containing range. Cold/warm final hits, scores, order and match signals are identical.
- The cold 4,096-passage scan uses **129 attempts**: one query plus 128 passage batches. With 2,000 valid entries retained, immediate warm uses **67 attempts**: one query plus 66 batches for the remaining 2,096 passages. These counts exclude reranking and failures; a warm query is not free.
- **Four protocol positives, four local-channel regressions and four closed-fixture negatives** have separate denominators. The protocol cases are not added to the independent recall score. Late exact-code/clue results retain their local ordering; synthetic negatives are not manuscript-absence evidence.
- An HTTP 500 in a middle batch pauses and an explicit retry completes in **130 attempts** without double-counting accepted coverage. Narrowing to 2,000 passages preserves ordinary semantic fusion and excludes cached future sources.
- Session tests compare streamed and materialized top-K on the same vectors; client/UI tests cover zero-request planning, small-range budgets, invalid/duplicate/stale grants, cache-first eviction, malformed batches, time boundaries, cancellation, expiry, lost Worker/callbacks, local-only stopping and freshness rejection.

These are engineering and protocol results from oracle vectors, **not 46/46 real embedding accuracy**. No new external model or embedding service is introduced or evaluated. Whole-range scoring cannot by itself classify evidence as supported, insufficient or uncertain.

### Production-adapter capacity measurements

The 2026-10-22 run measured locally committed implementation `86eb1a2760bba172b9ab33adb262d3fd3f7bb36b`, with clean tracked production inputs and unchanged production/harness hashes throughout each run. Each dimension used one fresh Node process and three consecutive cold/immediate-warm pairs. Here cold means an empty vector cache on an already built local index, not cold local-index construction; `syncMs` records the separate initial index build. The host was Node v24.19.0, Linux x64, AMD EPYC 9V74 with nine exposed logical CPUs and explicit GC. This capacity sample uses the fixed three-premise probe `eval-multi-9`, not another 46-query quality evaluation.

| Dimensions | Cold median (range), ms | Immediate-warm median (range), ms |
| --- | ---: | ---: |
| 128 | 472.239 (454.257–491.732) | 329.134 (325.391–329.662) |
| 512 | 747.522 (746.689–910.605) | 507.086 (492.142–511.130) |
| 4,096 | 3,645.963 (3,309.931–3,760.819) | 1,883.156 (1,788.164–1,933.155) |

| Dimensions | Cold CPU median, ms | Immediate-warm CPU median, ms | Process high-water RSS, MiB |
| --- | ---: | ---: | ---: |
| 128 | 238.022 | 152.556 | 296.816 |
| 512 | 636.912 | 341.397 | 312.762 |
| 4,096 | 4,503.984 | 2,307.371 | 431.141 |

CPU is process user plus system CPU, not wall time. All 18 scans completed with 129 cold / 67 warm attempts, identical cold/warm final results and **144 exact-source checks**. Each cold scan sent 411,809 original-source UTF-16 units; each warm scan sent 210,207, excluding query text. The warm scan still embedded 2,096 passages after scoring the 2,000 retained entries. No external network request or real model was used.

At 4,096 dimensions, resident cached vectors occupied **31.25 MiB**, but sampled ArrayBuffers peaked at **52.901 MiB**, sampled heap at **195.937 MiB**, and whole-process high-water RSS at **431.141 MiB**. The cache cap therefore does not describe total memory. Dense JSON responses totaled **163,212,223 bytes cold / 83,538,213 bytes warm** across sequential calls, with a largest individual response of **1,274,789 bytes**. The response total is cumulative traffic constructed in-process, not bytes simultaneously retained or actual network traffic.

The [summary](testing/memory-full-scan-2026-10-22/summary.json) links these aggregates to the [128-dimension](testing/memory-full-scan-2026-10-22/dense-128.json), [512-dimension](testing/memory-full-scan-2026-10-22/dense-512.json) and [4,096-dimension](testing/memory-full-scan-2026-10-22/dense-4096.json) raw records. They retain environment, fixture/implementation/harness identities, each timing/CPU/memory sample, source checks, request/response sizes and result digests. Three samples per state describe these runs, not statistical confidence, a paired implementation speedup or a production latency guarantee.

[`benchmark-memory-full-scan.mjs`](../scripts/benchmark-memory-full-scan.mjs) exercises production adapter JSON/`number[][]` decoding and Float32 conversion using dense decimal synthetic responses. It includes synthetic response construction, but excludes browser Worker transfer, IndexedDB hydration, editor work and real network/model delay. Source guards inspect a fixed in-memory snapshot, not committed-storage hydration. Actual per-batch Writer/Lab freshness reads can materially increase duration; full-library source loading and source serialization remain separate limitations. Fixture construction and local indexing contribute to process high-water RSS; 10 ms sampling can miss shorter allocation peaks. These are host-specific Node capacity observations, not browser memory, an SLA or real embedding quality.

For scale only, **arithmetic projections** at a constant 100 ms per sequential request give 12.9 seconds cold / 6.7 seconds warm for 129/67 attempts. At 1,500 ms, the same arithmetic gives **193.5 seconds / 100.5 seconds** before local work, source guards, retries or reranking. These are not measured provider latencies and are not completion promises. The default 65-second allowance can legitimately pause; a longer allocation must be explicit.

## Reproduce and accept

From the repository with installed dependencies, use only the synthetic adapters for this engineering gate:

```bash
node --import tsx scripts/smoke-memory-full-scan-session.ts
node --import tsx scripts/smoke-memory-full-scan-client.ts
node --import tsx scripts/smoke-writer-full-scan-ui.ts
node --import tsx scripts/smoke-memory-full-scan.mjs

# Run sequentially in separate fresh processes, after production is frozen.
for dimensions in 128 512 4096; do
  node --expose-gc --import tsx scripts/benchmark-memory-full-scan.mjs \
    --dimensions=$dimensions --rounds=3 --label=dense-$dimensions \
    --output=artifacts/memory-full-scan
done

npm run typecheck
npm run lint
npm run smoke:all
npm run build
npm run test:browser-memory-full-scan
```

The browser script uses the built app and synthetic Playwright routes. Follow [browser setup](../scripts/browser-testing.md); do not interpret a script's presence or a local inability to run Chromium as a browser pass. Existing browser/stress suites and every necessary CI job still apply to the reviewed revision. In particular, exercise Memory Lab and each Writer mode (body generation, continuation and polishing), explicit selection, old-source changes, disclosure narrowing, held/late responses, repeated start/cancel/query changes, provider pauses and the exhausted-time local-restart guidance.

`ci-memory-full-scan` runs three fresh processes at 128/512/4,096 dimensions, with three cold/warm rounds per process, followed by the dedicated built-app browser suite. The historical cold-index ABBA job fixes both endpoints at `7739cb0` and merged `ed83bfe` with the original comparator; that experiment cannot stand in for current scan validation. Current production is separately covered by the complete dynamically discovered smoke aggregate, stress and full-scan jobs; historical suite counts remain tied to their recorded revisions.

A blocker-free review, the final resource record, matching bilingual documentation and all necessary current-revision CI are required to close **track 2 only**. Track 3, optional cited support/insufficient/uncertain checking, and track 4, author-triggered whole-disclosed-novel relationship and foreshadowing/recovery candidate extraction, remain separate unfinished work. After all four tracks and shared gates pass, stage four begins with the bounded authorized-tools → retrieval → draft → author-review loop. Stage-two storage/editor work is not an extra prerequisite.
