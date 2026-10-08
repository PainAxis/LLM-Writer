# Local mixed Chinese/code query recall

[English](memory-mixed-query-recall.md) | [简体中文](memory-mixed-query-recall.zh-CN.md)

This stage-three repair targets queries such as `白银封蜡FS00001`. The frozen merged-main baseline found the requested quotation in **0/24** mixed queries at 1.44M characters, although author graph evidence independently matched **24/24**. At 10.5M characters the same query family already found **24/24** passages. Different chunk and short-passage distributions explain why the larger case performed differently. The original [PR #34 measurements](writer-memory-context.md#historical-pr-34-local-results--2026-10-08) remain unchanged.

## Behavior and boundaries

The local index now stores exact code tokens from chapter passages, chapter titles and current author clue labels/aliases. It recognizes maximal ASCII runs containing at least one letter and one digit, with optional single internal hyphens or underscores, case-insensitively, up to 64 characters. Examples include `FS00001`, `AB-12` and `ZX_45`. All-digit values, ordinary alphabetic words, malformed separators and longer tokens do not use this exact-code channel. Prefix/suffix fragments such as `FS00001` inside `FS000010` do not qualify; chunk edges are checked against adjacent original source characters.

Exact-code candidates use the same index lifecycle as ordinary passages and clues. Project/disclosure eligibility is applied before bounded candidate selection. In local-only retrieval, candidates covering more distinct requested codes rank ahead of partial matches; ordinary keyword/clue retrieval remains available when a code is missing. The result reason distinguishes codes matched in the quotation, chapter title or author annotation. A title/alias match does not imply the code appears in the quoted body, and an exact code does not prove the passage answers the question.

Optional embeddings and reranking still run only when enabled, and can change the final order. This change requires no graph annotation, retrieval key or provider request. Writer retains its explicit preview/approval, current-source checks and 6,000-character attachment budget; see [Writer evidence rules](writer-memory-context.md).

The extra code channel does not add another whole-manuscript text scan at query time. Existing source reads, eligibility traversal and exact-source validation still inspect committed snapshots/evidence. This is not a sublinear end-to-end search claim, nor a solution to cold indexing or peak memory.

## Verification

```bash
npm run smoke:memory-mixed-query
node --expose-gc --import tsx scripts/stress-writer-memory.ts
npm run test:browser-writer-memory
```

The focused smoke suite checks the former candidate-window miss, code grammar and near matches, multiple-code coverage, title/alias provenance, chunk boundaries, project/disclosure filtering before candidate limits, edit/delete/reorder synchronization, cancellation/recovery and optional-provider ranking. Ordinary Chinese and clue retrieval remain in the existing memory suites.

The stress runner preserves the original **11 groups / 68 preparations** per size and their mixed-query-plus-graph rows. It records an `originalWorkload` checkpoint before appending **24 full original mixed-query assertions with graph, embeddings and reranking disabled**. Each profile therefore has **12 groups / 92 preparations**. Every accepted source still passes current chapter, revision, exact range/quotation and disclosure checks. Distant clues, old-chapter and batch edits, future identities and confirmed multi-premise relationships retain their original cases. No paid or live provider calls are made; one controlled mock rerank call per profile is followed by a stale-source rejection.

The built-app Writer suite retrieves an unannotated exact passage with the full query, then checks preview and the actual generation request payload, old-chapter editing and future-code cutoffs. The derived persisted fixture has 600 chapters / 1,423,494 source characters; its Writer cutoff discloses 598 chapters / 1,423,398 characters, with later exact-code and identity revelations at narrative positions 599 and 600. Its 1,539,531-character serialized novel crosses the persistence split threshold (593 split chapter bodies). All four original graph anchors remain intact, but none covers the tested passage. These browser measurements are separate from the Node workload. Current configured coverage is **77 smoke suites / 129 browser scenarios**, including **16 Writer memory scenarios**. Validation status is established by the reviewed revision's CI.

## Comparable local measurements

Character counts are JavaScript UTF-16 code units, matching the source ranges and attachment budget; they are not word, token or byte counts.

The before run uses frozen merged main `af1fcf57a5663ca13372000b759fd8dc7e660863` and the unchanged original runner. Both before/after profiles run in separate child processes on the same host. The procedural source fixture is unchanged. Source/test hashes and all 24 mixed-query outcomes per size are retained in the [comparison record](testing/memory-mixed-query-2026-10-08/comparison.json). Full raw run output is produced by the command above and retained in CI artifacts.

Both after profiles passed **12 groups / 92 preparations each**: **184 preparations and 1,066 exact-source checks** overall, with zero real external requests. The original 68-preparation checkpoints each retain 11 groups and together account for 778 source checks.

| Workload | Before mixed-query passage hits | After mixed-query passage hits | Added after assertions with graph/remote disabled |
| --- | ---: | ---: | ---: |
| 600 chapters / 1.44M characters | 0/24 | 24/24 | 24/24 |
| 2,500 chapters / 10.5M characters | 24/24 | 24/24 | 24/24 |

The original mixed-query rows retain graph-evidence hits of 24/24 at both sizes before and after; graph success is counted separately from passage success.

| Original 68-preparation workload | Snapshot | Cold preparation | Warm p50 / p95 | Process peak RSS at 68 preparations |
| --- | --- | ---: | ---: | ---: |
| 1.44M | Before | 8.51 s | 102 / 128 ms | 837 MiB |
| 1.44M | After | 8.68 s | 99 / 105 ms | 846 MiB |
| 10.5M | Before | 64.02 s | 621 / 773 ms | 2,015 MiB |
| 10.5M | After | 64.12 s | 611 / 667 ms | 2,045 MiB |

The full 92-preparation after runs peaked at **846 MiB / 2,062 MiB RSS**. Their largest complete evidence blocks under the 6,000-character limit were **5,930 / 5,996 characters**. The larger manuscript still takes about 64 seconds to prepare cold and roughly 2 GiB of process memory.

Compare cold preparation, the original 24 exact-identifier warm preparations and process peak RSS at the original 68-preparation checkpoint. Final after-run RSS includes the added graph-disabled work and is reported separately. These are single runs, not a claimed speedup or a browser/device responsiveness guarantee. The synthetic passages test exact source retrieval and provenance, not literary realism or general Chinese semantic recall.

## Remaining stage-three work

1. **No-answer and low-relevance handling:** retrieval may still return partial matches for absent codes or questions without disclosed evidence. Source validity and non-empty results are insufficient evidence of an answer; define and test abstention separately.
2. **Indexing and semantic capacity:** cold builds, full committed-source reads/validation, recovery/compaction and bounded semantic caches remain expensive or capacity-limited. Node measurements exclude IndexedDB hydration, Worker transfer, editor rendering and real-provider latency.

Whole-novel automatic extraction remains a separately designed enhancement. This increment does not expand stage-two persistence/editing or resume the stage-four Agent.
