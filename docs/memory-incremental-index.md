# Incremental memory indexing

[English](memory-incremental-index.md) | [简体中文](memory-incremental-index.zh-CN.md)

Memory Lab now updates affected chapters and clues without routinely tokenizing the whole novel again. For actual novels, returning from Writer in another tab also preserves the completed Worker baseline and compatible source vectors. This extends the [retrieval prototype](memory-prototype.md); it does not change Writer persistence or connect retrieval to generation.

## Synchronization contract

Every search still reads the latest committed source and validates a complete snapshot. Index reuse depends on source identities and exact content, not save timestamps. Synchronization first makes the old index unavailable and cancels older asynchronous work.

| Source change | Index work |
| --- | --- |
| Complete source unchanged | Reuse the validated index and revisions |
| Chapter title or body changed, or chapter added | Hash and split that chapter; replace its affected keyword documents |
| Chapter deleted | Remove its passages and clues; evict incompatible source vectors |
| Clue added, changed or removed | Revalidate against the current chapter revision and exact source range; update affected clue documents |
| Chapter order changed | Update disclosure order and evidence metadata without retokenizing unchanged documents |
| Project changed or no reusable completed baseline | Build a fresh index |

Unchanged chapters retain their revisions and passages. Each clue still binds to an exact chapter revision and quote: editing its source chapter makes the old annotation stale, even if some text remains. Clue labels and aliases are not automatic fact extraction and must not reveal future events.

The completed baseline has one owner during synchronization. If a build fails or is superseded, its partially changed database cannot become searchable or serve as the next reusable baseline. The next successful build can recover from a fresh index. Searches reject outdated epochs, and source/revision/range/cutoff checks still apply before provider requests and evidence display.

Orama retains some metadata after document removal. To limit accumulation during repeated editing, the engine periodically builds a fresh database when cumulative removals, including the planned update, exceed **the greater of 1,024 or twice the next live document count**. This compaction can reuse unchanged chapter hashes and passages but reinserts all live keyword documents. Exact source vectors remain independently reusable. Incremental updates are therefore not a promise of constant-time saves or of never rebuilding.

## Worker and vector-cache lifecycle

| Event | Visible state and retained data |
| --- | --- |
| Actual novel: window focus or novel-storage invalidation | Clear results, evidence and readiness; cancel pending work. Keep only a completed baseline and compatible vectors privately. Require a fresh committed-source read and successful sync before searching. |
| Query or cutoff changed | Clear old results. Later searches enforce the current query and disclosure scope. |
| Explicit cancel, provider settings changed, cache clear or project switch | Dispose the Worker and discard its indexes/vectors. |
| Leave or reload Memory Lab | Dispose the Worker and clear route-session provider settings and credentials. |

Returning from a Writer **tab** can reuse the surviving Memory Lab Worker. Navigating away from the Memory Lab **route** still ends that lifecycle. No index or vector cache is written to persistent storage or included in backups.

Vector keys still include project, chapter revision and exact span, with provider/model/dimension/account isolation. Editing one sentence invalidates every passage vector in that chapter because its revision hashes the entire title and body. Unchanged eligible chapters can reuse vectors; each query is embedded again. The **2,000-passage / 32 MiB cache**, **32-passage batches**, **15-second request timeout**, **65-second remote budget** and **60 rerank candidates** remain unchanged. Reordering and cutoff reductions cannot make cached future passages eligible.

## Validation

```bash
npm run smoke:memory
npm run smoke:memory-incremental
npm run smoke:memory-client
npm run smoke:memory-hybrid
npm run test:memory-stress-local
npm run test:memory-stress-hybrid
npm run build
npm run test:browser-memory-hybrid
npm run test:browser-memory-stress
```

The incremental smoke suite checks source changes, stale clues, deletion/reordering, failure recovery, competing synchronization and repeated-edit compaction. The client suite checks invalidation without Worker replacement, rejected pending requests and fresh-sync recovery. Built-app tests check focus/storage invalidation, fresh committed-source reads and late provider responses.

The larger workloads retain the existing million-, multi-million- and ten-million-character fixtures. Local tests add repeated single-chapter revision saves. Controlled HTTP tests require only changed-chapter source vectors to be submitted again. The 600-chapter browser workload requires zero source re-embedding after unchanged focus and only the edited chapter's passages after an actual Writer save, while independently verifying all unedited chapter texts and future-disclosure boundaries. Explicit cancellation and cache clearing still require cold recovery.

`MemoryIndexStats.sync` records `full`, `incremental` or `unchanged`, with counts for rebuilt/reused chapters and inserted/removed/reused documents. Chapter counts describe hashing and chunking work; document counts describe keyword-index work. A compaction can reuse chapter work yet insert every document. Full-index replacement does not count discarded documents as in-place removals. Report these counters alongside latency so a fast run cannot hide skipped work or a full rebuild.

Reports are written to `artifacts/memory-stress/` and `artifacts/browser-memory-stress/`. The [PR #30 measurements](memory-stress-tests.md) remain the historical baseline, including their full-rebuild and cache-loss results. Compare fixed fixtures and identify the tested revision and environment when publishing new results; browser whole-action latency is not engine-only synchronization latency.

For a same-harness engine comparison, prepare a detached PR #30 worktree and run both engines with this revision's benchmark script:

```bash
git worktree add --detach ../LLM-Writer-memory-baseline b77327a
npm --prefix ../LLM-Writer-memory-baseline ci
node --import tsx scripts/benchmark-memory-incremental.ts --engine-root=../LLM-Writer-memory-baseline --label=before
node --import tsx scripts/benchmark-memory-incremental.ts --label=after
```

Optional `--profile=million|three-million|ten-million|all` selects the scale; `--output=...` changes the default `artifacts/memory-incremental/` directory. Each profile runs in a fresh child process. Reports retain script, fixture, engine and source hashes, synchronization work counters, memory observations and exact-source checks. Timings cover the synchronization call; preparation, cloning, explicit garbage collection, queries and report writes are excluded. No provider requests are permitted. Use comparable runtime conditions and retain failures as well as successful results.

## Recorded results — 2026-10-04

The [provenance record](testing/memory-incremental-2026-10-04/provenance.json) identifies the source commits, report checksums and individual CI outcomes. The first controlled-HTTP CI attempt exposed a test accounting race: an aborted request arriving late was counted toward the following action. The fixture now tags native HTTP requests by their issuing action and validates them against that action's exact source and cutoff, retaining strict successful-response counts. This correction changes the test harness, not the production engine; current merge readiness comes from the PR's latest CI checks.

### Same-harness engine comparison

The [before](testing/memory-incremental-2026-10-04/before.json) and [after](testing/memory-incremental-2026-10-04/after.json) reports compare PR #30 merge `b77327a` with incremental implementation `758d151`; the [comparison](testing/memory-incremental-2026-10-04/comparison.json) checks the completed reports. Each side completed **17 synchronizations, 288 queries and 2,239 exact-source checks**, with **zero network requests**. Script and fixture hashes, and every operation's source hash and resulting fingerprint, matched between versions. These checks cover current provenance and disclosure, not real-model recall.

| Source size / chapters | Edit 30 chapters: before | Edit 30 chapters: after | Cold build: before → after | Process peak RSS: before → after |
| --- | --- | --- | --- | --- |
| 1,320,000 / 600 | 10.573 s | 590.615 ms | 10.035 → 9.577 s | 485.17 → 345.24 MiB |
| 3,300,000 / 1,500 | 24.794 s | 614.428 ms | 25.928 → 23.036 s | 930.05 → 593.76 MiB |
| 10,500,000 / 2,500 | 77.903 s | 613.042 ms | 88.710 → 75.942 s | 1,972.47 → 1,372.20 MiB |

At 1.32 million characters, changing one chapter took **10.559 seconds → 23.012 milliseconds**. The new engine rehashed/rechunked one chapter, retained 599 chapters and replaced one keyword document. The 30-chapter operations each rebuilt exactly 30 chapters; unchanged chapters were reused. Reordering and deleting ten chapters required no new chapter hashes or keyword insertions. The unchanged-source calls remained in the millisecond range: **1.633 → 2.790 ms**, **6.567 → 3.708 ms** and **12.660 → 8.814 ms**. Cold builds still processed every document; these single samples do not establish a cold-start or unchanged-source speedup.

The environment was Node 24.19.0 on Linux x64, Intel Xeon Platinum 8573C, nine visible logical CPUs, 9,967.289 MiB total memory and a 2,240 MiB Node heap limit. Each profile used a fresh process, with explicit garbage collection outside timing. The shared development environment was not a dedicated benchmark machine; lint/build work could overlap the baseline and reports retain load averages. **There is one sample per operation.** Timing covers only the engine synchronization call, excluding source cloning, garbage collection, verification, queries and report writes; it is not Writer save or browser UI latency. Peak RSS covers the entire child process, including fixtures and checks, rather than isolated index allocation.

### Larger local acceptance workload

The [CI local stress report](testing/memory-incremental-2026-10-04/local.json) passed all three scales: **39 workflow checks, 849 queries and 5,727 source-evidence checks**, with zero external requests. This includes twelve consecutive single-chapter saves at each scale. All ranks matched PR #30 for the same fixed **36 natural-query probes and 144 planted identifier/clue probes**. In ascending size order, natural-query Top-5 remained **11/12, 10/12 and 8/12**, and Top-8 remained **12/12, 11/12 and 11/12**. This shows no observed ranking regression on those probes; it does not establish general retrieval quality or remove the recorded misses and no-answer limitation.

### Persisted Writer and browser workflow

All **nine browser stress scenarios** passed in [CI #78's browser-stress job](https://github.com/PainAxis/LLM-Writer/actions/runs/37184703769/job/111384107526); see the [raw browser report](testing/memory-incremental-2026-10-04/browser.json). The report records PR integration merge `7ebd888` for branch head `758d151`. It used Chromium 153.0.8010.12, Node 24.21.0, Linux x64, an AMD EPYC 9V74 runner exposing four CPUs and a 1440 × 1080 viewport. This records that job's outcome, independently of other CI jobs.

| Browser acceptance | Observed result |
| --- | --- |
| Stored manuscript | 600 chapter blobs; 1,560,000 generated prose characters / 1,559,999 indexed characters |
| Regain focus with unchanged committed source | Old evidence cleared immediately; **0 passages re-embedded, 1,200 reused** |
| Save chapter 2 through Writer in another tab | **3 passages re-embedded in one batch, 1,197 reused**; old revision excluded |
| Verify persisted source after editing | All 600 chapters checked; all 599 unedited chapter texts exactly preserved |
| 57 completed UI search actions | p50 **149 ms**, p95 **256 ms**, maximum **3,890 ms** |
| Explicit cancellation | Response in **34 ms**; late response excluded, later search recovered |

UI timings include the committed-source read, Worker synchronization, retrieval and rendered results, mixing local, cold/warm provider and recovery cases. They are not warm-only percentiles or a controlled comparison with PR #30's different runner. Cold semantic preparation still submitted all 1,200 eligible passages in 38 batches. Future-disclosure checks passed, no future-identity markers appeared in provider payloads, and no uncaught browser errors were recorded. The provider supplied local synthetic vectors and reranking; this validates cache and source behavior without establishing paid-model latency, semantic quality or Jina browser CORS.

## Remaining boundaries

Cold indexing, whole-source reads, snapshot copies and validation still scale with manuscript size. Periodic compaction and recovery remain full-build paths, and the in-memory index can consume substantial memory. Semantic capacity and real-provider cold-start limits have not increased. This change does not improve the measured no-answer behavior, provide durable background indexing, complete chapter-level persistence, or implement fact graphs and generation-context integration.
