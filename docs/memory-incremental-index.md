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

## Remaining boundaries

Cold indexing, whole-source reads, snapshot copies and validation still scale with manuscript size. Periodic compaction and recovery remain full-build paths, and the in-memory index can consume substantial memory. Semantic capacity and real-provider cold-start limits have not increased. This change does not improve the measured no-answer behavior, provide durable background indexing, complete chapter-level persistence, or implement fact graphs and generation-context integration.
