# Cold memory indexing with equivalent token scores

[English](memory-cold-index.md) | [简体中文](memory-cold-index.zh-CN.md)

This focused stage-three change removes repeated token-frequency counting during Orama insertion. It does not change tokenization, ranking, evidence, disclosure or resource limits, and does not complete stage three. The [four-track completion contract](../ROADMAP.md#stage-three-completion-contract) defines the remaining work and the bounded stage-four entry.

## Why this change

Profiling the existing million-character workload concentrated the cold-build hotspot in Orama insertion and its per-token frequency scan. An exploratory CPU-profile run took approximately 9.85 seconds for cold synchronization and 9.70 seconds for a new instance. Those numbers include CPU-profiling overhead: they diagnose the hotspot and are **not** the before/after speed baseline.

Orama 3.1.18's default score hook scans a field's full token array for each token insertion. `src/services/memory/tokenScoreIndex.ts` uses the public `components.index.createIndex()` API and overrides only the document/token score hooks:

- Count each field's tokens once in a `Map`, cached by token-array identity in a `WeakMap`.
- Invalidate the count at each document-field boundary before delegating the default document-score hook. A tokenizer may reuse and mutate one array; array identity alone is not a freshness check.
- Use the same internal document ID, frequency denominator and occurrence assignments as the default hook, including duplicate/empty tokens and inherited-property behavior.
- Keep the existing MemoryIndex tokenizer and default radix/insertion/removal/search behavior and BM25 formula. No dependency patch, token deduplication, alternate scoring formula or persisted index snapshot is introduced.

For a field containing n tokens, the deterministic smoke counter observes **n² + n → 2n token visits** in this counting/insertion path. This is a complexity assertion for that path, not a claim that the complete index or every query is linear or twice as fast.

## Equivalence and safety checks

`npm run smoke:memory-token-scores` compares the complete saved Orama state and exact search scores with the default component. Cases include duplicates, empty strings/arrays, prototype keys, Unicode, multiple fields, string arrays, removal, re-addition, update, save/load and a reused mutable tokenizer array. Direct-hook edge cases retain the default behavior, including NaN from an empty denominator. The iteration assertion uses no wall-clock threshold.

The enhanced capacity harness records a SHA-256 digest of each **complete retrieval result except `searchMs`**. Evidence, chapter revisions, exact quote ranges, ordering, returned fusion scores, reasons, diagnostics and conservative assessments are included. Queries cover exact identifiers, mixed Chinese/code, author clues, natural questions, known unanswered questions, old-fact removal and disclosure boundaries. Existing misses remain visible; no query is removed merely to improve the comparison. All assessments remain `answerability: unverified`. The production `MemoryIndex` result exposes reciprocal-rank-fusion scores, not raw Orama BM25 scores; raw Orama scoring state and search scores are checked separately by `smoke:memory-token-scores`.

The comparator checks identical fixtures, source hashes, chapter fingerprints, index work, full result digests and source-check counts. It allows only the production `engine.ts` component wiring and new `tokenScoreIndex.ts` to differ. It also requires clean, identified production revisions, the same harness/environment, four completed non-overlapping runs in ABBA order and zero provider/network requests. Timing and memory are observations, not pass thresholds. `smoke:memory-cold-comparison` rejects incomplete/dirty reports, omitted or changed dependencies, changed harnesses/fixtures/machines, overlapping runs, changed source/work/results, omitted queries, hidden network/provider requests and invalid timings. It deliberately accepts equivalent reports even when every candidate timing is slower, so performance thresholds cannot filter away regressions.

These Node checks do not replace lifecycle or UI acceptance. Current-production smoke, stress and built-app suites retain cancellation, stale/late response rejection, failed-save handling, concurrent changes, every graph premise, disclosure/future exclusion and explicit Writer evidence selection. Memory Lab → Writer chapter-body generation, continuation and polishing remain separate business acceptance paths. The reviewed revision's complete CI, not this document's configured test count, establishes a pass.

## Controlled measurements

Baseline: `7739cb0f6d020e4e05d0bff8d9d18f59f3d903c0`, the merged hydration implementation. Measured candidate production revision: `b8a3c4b895ab0f8cab167194701f7a42c2bdca8b`. Each profile runs in fresh processes on one machine in **baseline, candidate, candidate, baseline (ABBA)** order, with two observations per implementation. Use the same current harness for both endpoints; the historical 2026-10-08 Node or Chromium timings are not this comparison's baseline.

The 2026-10-22 local run uses Node v24.19.0, Linux x64 and an AMD EPYC 9V74 processor with nine exposed logical CPUs, approximately 9,967 MiB total memory and a 2,240 MiB V8 heap limit. Explicit GC is enabled. Workloads use procedural Chinese fiction with frozen version-2 fixtures: 600 chapters / 1,320,000 UTF-16 characters and 2,500 chapters / 10,500,000 characters. These are neither human reading-word counts nor the earlier 1.44M Writer fixture.

### Completed 1.32M-character comparison

| Phase | Baseline median | Candidate median | Median change |
| --- | ---: | ---: | ---: |
| Cold full synchronization | 8,889.015 ms | 2,496.736 ms | −71.912% |
| New-instance full rebuild | 8,874.659 ms | 2,588.799 ms | −70.829% |
| One old-chapter incremental update | 34.562 ms | 22.365 ms | −35.290% |
| Unchanged synchronization | 2.041 ms | 2.182 ms | +6.908% |
| Retained-baseline recovery | 1.610 ms | 1.857 ms | +15.342% |

All four runs passed 240 queries and 720 exact-source checks each, with identical complete result hashes, scores and ordering and zero external requests. The unchanged and retained-recovery paths became slightly slower in these samples; they are not hidden by the cold-build improvement.

Whole-process maximum RSS ranged from 369.387 to 387.449 MiB in baseline runs and 372.344 to 372.609 MiB in candidate runs. The sampled post-cold-build heap was higher in the candidate (175.906–176.765 MiB versus 155.011–157.670 MiB). These measurements include fixtures and instrumentation; they do not establish an isolated retained-index memory reduction.

### Completed 10.5M-character comparison

| Phase | Baseline median | Candidate median | Median change |
| --- | ---: | ---: | ---: |
| Cold full synchronization | 70,816.807 ms | 21,306.515 ms | −69.913% |
| New-instance full rebuild | 76,263.052 ms | 21,700.192 ms | −71.546% |
| One old-chapter incremental update | 78.423 ms | 65.076 ms | −17.019% |
| Unchanged synchronization | 9.218 ms | 9.012 ms | −2.235% |
| Retained-baseline recovery | 9.682 ms | 8.190 ms | −15.410% |

All four runs passed 240 queries and 776 exact-source checks each, with identical complete results and zero external requests. Across both profiles this is 1,920 query comparisons and 5,984 exact-source checks in eight processes, not eight independent devices or a real-model accuracy test.

Not every phase improved: whole-source JSON cloning rose from 65.759 to 69.956 ms (+6.382%), structured cloning from 18.855 to 19.827 ms (+5.155%), and independent chapter hashing from 192.026 to 238.026 ms (+23.955%). These phases were not changed by the production patch; observations are retained without claiming the optimization caused every timing difference.

Whole-process maximum RSS ranged from 1,439.418 to 1,448.754 MiB for baseline and 1,442.848 to 1,467.609 MiB for candidate. Post-cold-build sampled heaps were 1,057.524–1,139.499 MiB and 1,081.880–1,149.342 MiB respectively. This patch demonstrates faster rebuilds in these runs, not lower memory consumption.

### CPU and measurement records

Process CPU time below is user plus system CPU during the named synchronization phase; it is not wall time or a browser responsiveness measurement.

| Workload / phase | Baseline CPU median | Candidate CPU median |
| --- | ---: | ---: |
| 1.32M / cold | 9,161.524 ms | 2,725.210 ms |
| 1.32M / new instance | 9,394.565 ms | 2,939.934 ms |
| 10.5M / cold | 73,955.674 ms | 23,954.521 ms |
| 10.5M / new instance | 79,478.126 ms | 24,348.519 ms |

The local two-profile comparison is complete; current-revision CI remains a separate validation record, and no full-CI pass is claimed here. The checked-in [1.32M record](testing/memory-cold-index-2026-10-22/million.json) and [10.5M record](testing/memory-cold-index-2026-10-22/ten-million.json) retain per-run report hashes, source/implementation/harness identities, all nine phase observations and the 240 reference query results. Raw reports are generated under `artifacts/memory-cold-index`.

### Interpretation limits

Two runs per variant provide descriptive medians, ranges and raw observations, not latency percentiles, statistical confidence, universal device guarantees or an SLA. Retain positive as well as negative timing changes, CPU user/system measurements, heap/RSS observations and fixture/implementation/harness hashes in the record. Explicit GC, corpus preparation and evidence checks sit outside measured synchronization calls; process memory includes the complete workload and sampled endpoints can miss synchronous peaks.

This is a Node engine measurement. It excludes IndexedDB source loading, Worker transfer, browser rendering, editor behavior, real-provider latency and model/writing quality. New-instance recovery remains a full rebuild. The optimization does not reduce manuscript coverage to obtain a faster result.

## Reproduce

From a clean candidate checkout with installed dependencies, create a separate baseline checkout at `7739cb0f6d020e4e05d0bff8d9d18f59f3d903c0` in `.cold-index-baseline`. Run the same candidate harness throughout, sequentially and without competing heavy workloads:

```bash
npm run smoke:memory-token-scores
npm run smoke:memory-cold-comparison
for profile in million ten-million; do
  node --expose-gc --import tsx scripts/benchmark-memory-capacity.ts --engine-root=.cold-index-baseline --profile=$profile --label=baseline-a --output=artifacts/memory-cold-index
  node --expose-gc --import tsx scripts/benchmark-memory-capacity.ts --profile=$profile --label=candidate-a --output=artifacts/memory-cold-index
  node --expose-gc --import tsx scripts/benchmark-memory-capacity.ts --profile=$profile --label=candidate-b --output=artifacts/memory-cold-index
  node --expose-gc --import tsx scripts/benchmark-memory-capacity.ts --engine-root=.cold-index-baseline --profile=$profile --label=baseline-b --output=artifacts/memory-cold-index
  node scripts/compare-memory-cold-index.mjs \
    --baseline=artifacts/memory-cold-index/baseline-a-$profile.json \
    --baseline=artifacts/memory-cold-index/baseline-b-$profile.json \
    --candidate=artifacts/memory-cold-index/candidate-a-$profile.json \
    --candidate=artifacts/memory-cold-index/candidate-b-$profile.json \
    --output=artifacts/memory-cold-index/comparison-$profile.json
done
```

`ci-memory-cold-index` runs this pair and uploads raw and comparison reports. The baseline is fixed for this scoring experiment; changing it, its fixtures or equivalence expectations requires review, not a mechanical update to main. No real API key or paid provider is needed.

## Preserve the earlier hydration experiment

`ci-memory-capacity` remains the historical committed-source experiment, now explicitly pinned at **both** endpoints: pre-hydration `760042683405760428688d1a7d7f0346e2ff77d3` and post-hydration `7739cb0f6d020e4e05d0bff8d9d18f59f3d903c0`. Its original source harness, strict 17-dependency comparison, body-read/transaction assertions and evidence comparisons remain unchanged. The [historical report](memory-capacity.md) retains its original numbers and limitations.

Freezing that pair prevents an unrelated current engine change from rewriting a historical hydration experiment. It does not weaken current tests: the other CI suites exercise current production, while the new cold-index job measures this scoring change against its own fixed baseline. Results from the two experiments must not be added together or treated as one end-to-end speedup.

## Remaining boundaries

- No persistent index snapshot: a fresh Worker/index still builds the full index. Retained-baseline revalidation is not a disk restore.
- Every committed-source read still hydrates the stored novel collection; source serialization and revision verification are not removed or cached away.
- The semantic limits remain 2,000 eligible passages and 32 MiB cached Float32 payload. Above 2,000, current embeddings explicitly fall back to local retrieval instead of silently clipping; this patch adds no whole-range or candidate-only semantic mode.
- Literal/code matches remain unverified for answerability. No semantic support evaluator or whole-disclosed-novel automatic candidate extractor is implemented here; selected-source model proposals still require author review.
- Stage-two chapter-body persistence, editor expansion and shared summaries are out of scope. Complete the four bounded stage-three tracks and shared gates, then begin the stage-four authorized-tools → retrieval → draft → author-review loop with step/time/cancellation/audit limits.
