# Memory retrieval prototype

[English](memory-prototype.md) | [简体中文](memory-prototype.zh-CN.md)

Open **记忆检索 · 原型** in the sidebar (`#/memory`). Start development with `npm ci && npm run dev`. Production remains a static website; HTTPS or localhost is required for content SHA-256 hashes.

This stage-three prototype exercises three acceptance goals: exclude outdated facts after chapter edits, recover distant foreshadowing and prevent future plot disclosure. It is not a complete long-term memory system, and does not complete stage-two million-character editing foundations.

## Scope

- Orama 3.1.18 and its official Mandarin tokenizer, supplemented by Han-character bigrams for unfamiliar names. Local indexing and retrieval run in a page-owned Web Worker.
- Local retrieval combines BM25 over chapter bodies/titles with author-marked clue text, labels and aliases. Exact ASCII letter/digit codes add an indexed candidate channel, and complete code coverage ranks ahead of partial local matches; see [mixed-query recall](memory-mixed-query-recall.md). Optional embeddings add a semantic retrieval channel; reciprocal rank fusion combines the channels. Optional reranking can reorder the resulting candidates.
- The current chapter-list order defines disclosure order. Project and chapter-cutoff checks apply before ranking and before source text is sent to an external provider. Results pass revision, exact-source-span and disclosure checks again before display. If the selected cutoff chapter is deleted from the same project, refreshing clears the cutoff and requires an explicit new selection; repeated refreshes cannot automatically widen disclosure.
- Chapter revisions are SHA-256 hashes of the title and plain-text body. Clues bind to a revision and an exact source span; edits do not silently transfer them to a new revision.
- The evidence panel displays the source quote, chapter, revision and UTF-16 range, with deterministic full-query/code signals and missing-code indicators. These do not verify answerability; see [review semantics](memory-evidence-review.md). Text interpolation displays source content without executing it as HTML.
- An editable 80-chapter synthetic demo is saved separately in IndexedDB. Searches of actual novels read the latest committed text each time; the prototype does not write to those novels.
- A [Cytoscape.js fact graph](memory-fact-graph.md) links people, events, objects and places to exact chapter evidence. Its local annotations are stored independently; optional model proposals use selected disclosed excerpts and the active generation API configuration.
- External retrieval services are optional and disabled by default. Local retrieval needs no API key and makes no model calls.

## Try the acceptance cases

1. **Edit an old chapter:** choose “查旧章事实”. In the demo's first chapter, replace “银钥匙” with “铜钥匙”, save and rebuild, then search again. Evidence must show the new source and revision. A search for an old term may retrieve new text with shared words, but must not return the old fact.
2. **Recover a clue:** choose “找回伏笔”, search for “接应信号” and set the cutoff to chapter 40. The author-marked clue in chapter 2 about the bell and west ferry should appear with its original source. This alias is part of the demo fixture; it is not automatically inferred foreshadowing.
3. **Prevent future disclosure:** choose “检查未来身份”. A cutoff at chapter 10 must not reveal the masked character's true name. It becomes searchable at chapter 80. Moving the cutoff back immediately clears old results and evidence.

Select an actual novel in the same interface. To change its text, save the change in Writer and return to the prototype; unsaved Writer drafts are not retrieval sources.

## Optional embeddings and reranking

Use the Memory Lab's provider controls to enable embeddings, reranking, or both. These settings are separate from the generation model's API settings. Both services are disabled by default.

| Setting | Default and supported configuration |
| --- | --- |
| Embedding protocol | Jina or OpenAI-compatible |
| Embedding endpoint | `https://api.jina.ai/v1/embeddings`; enter a complete endpoint URL |
| Embedding model and dimensions | `jina-embeddings-v3`, 512 dimensions; editable for the selected provider |
| Reranking endpoint | `https://api.jina.ai/v1/rerank`; Jina-compatible request/response format |
| Reranking model | `jina-reranker-v2-base-multilingual`; editable |
| API credentials | Separate API keys for embedding and reranking |

These are editable starting values, not a promise that a model is available to every account. Settings and credentials remain in the current route session, are excluded from local storage and backups, and are removed when you leave or reload the page. Changing a service endpoint or protocol clears its key.

Enabling a service authorizes requests to the configured endpoint when searching. Embedding requests contain the query and eligible source passages; reranking requests contain the query and eligible candidates. Chapters beyond the selected cutoff are excluded before either request. The endpoint must allow the application's browser origin through CORS. Remote endpoints require HTTPS; loopback development endpoints may use HTTP. Enter the final endpoint without URL credentials, query parameters or fragments; redirects are rejected. OpenAI-compatible embedding services must accept the configured `dimensions` and return indexed float vectors of that exact size.

Embedding processes at most 2,000 disclosed passages, in batches of 32. If the disclosed source exceeds this limit, semantic retrieval falls back explicitly to local retrieval rather than embedding a silent subset. Reranking receives at most 60 fused candidates. Provider requests have a 15-second per-request timeout and a 65-second total remote budget.

The semantic channel ranks eligible vectors by an exact cosine-similarity scan. Source vectors use an in-memory cache bounded by 2,000 entries and 32 MiB of vector data, scoped to source revisions and provider/model/dimension settings. Identical eligible passages can reuse cached vectors; queries are embedded again. Changing the source or embedding configuration cannot reuse incompatible vectors. The cache is derived data and is not part of a novel backup. For actual novels, window focus or novel-storage invalidation immediately clears visible evidence and blocks retrieval until a fresh committed-source synchronization; the surviving Worker can reuse its completed index and compatible vectors. Returning from Writer in another tab therefore need not re-embed unchanged chapters. Explicit cancellation, provider changes, the cache-clear control, project switches and leaving or reloading the route still discard the Worker and its caches.

Provider errors leave local keyword and clue retrieval available with an explicit fallback message. The results identify which retrieval stages actually ran. Cancellation or changes to the source, query, cutoff or provider settings invalidate pending results; a late provider response cannot restore stale evidence.

External retrieval is an experimental option, not a prerequisite for the three local acceptance cases above. Automated provider regressions use deterministic responses; they do not establish the semantic quality of a real model or the availability of a paid service.

## Revision and runtime boundaries

The keyword index is derived in-memory data. Every search reads and validates the current committed source. A completely unchanged source reuses the validated index. Same-project edits can update affected chapters and clues incrementally, retaining unchanged chapter revisions and indexed documents. Chapter order remains part of the disclosure boundary. Well-formed stale clues retain their exclusion; malformed clue data takes the validation path. Cold builds, project changes, interrupted index mutations and periodic metadata compaction can still require a full build. No index snapshot is persisted. See [incremental indexing and cache lifecycle](memory-incremental-index.md) for the exact reuse and recovery boundaries.

Starting synchronization invalidates old asynchronous work before checking for reuse. Source invalidation can retain a completed baseline privately, but that baseline cannot serve searches until fresh synchronization succeeds. A failed build reports an error instead of continuing to serve previous facts. Index epochs and page request versions reject results from outdated requests.

Every piece of evidence comes from the current chapter snapshot. Whole-book summaries, character settings, worldbuilding and external material are not indexed because they do not yet have item-level disclosure boundaries and source revisions. Author-provided clue labels and aliases are treated as information known at the source chapter; authors must ensure they do not contain later secrets. Automatic whole-novel clue extraction and clue-resolution inference remain future work. The separate [fact graph](memory-fact-graph.md) now provides manually created relationships and optional model proposals with its own exact-source checks and review provenance; it does not automatically add relationships to retrieval ranking.

The standalone prototype does not change `writing_search`. The separate opt-in [Writer integration](writer-memory-context.md) now applies current-revision and disclosure gates to retrieved evidence for chapter-body generation, continuation and polishing. Manually supplied materials, outlines and other generation paths are not automatically filtered.

The private demo is outside novel backups. Resetting it overwrites only that independent test copy. Local-only mode does not upload source text; enabling an external retrieval service sends the eligible query and source text described above.

## Validation commands

```bash
npm run smoke:memory
npm run smoke:memory-incremental
npm run smoke:memory-client
npm run smoke:memory-providers
npm run smoke:memory-hybrid
npm run smoke:memory-fact-graph
npm run smoke:memory-fact-store
npm run smoke:memory-fact-extraction
npm run build
npm run test:browser-memory
npm run test:browser-memory-hybrid
npm run test:browser-memory-fact-graph
```

Core regressions cover chapter edits/deletion, ordering changes, project isolation, stale clues, failed builds, concurrent snapshots and a million-character synthetic manuscript. Provider/hybrid regressions check wire formats, invalid responses, semantic fusion, cache reuse, cancellation and fallback. Browser regressions exercise the actual built application, demo editing/restoration, evidence, committed-novel reads and optional providers. The configured project has 79 smoke suites and 133 browser scenarios, including nine long-novel scenarios; validation status comes from the reviewed revision's CI results. Synthetic data and deterministic provider responses test engineering boundaries; they do not measure real-novel semantic recall.

For larger workloads, see the [long-novel stress tests](memory-stress-tests.md), which separate local capacity, hybrid-provider behavior, browser workflows and real-novel recall, with explicit measurement and fallback boundaries.

For an optional real-service check, set `JINA_API_KEY` in the process environment and run:

```bash
npm run test:memory-live
```

This test is separate from CI and incurs the configured Jina account's usage charges. It exercises the production retrieval engine and provider adapters against three synthetic chapters, with four acceptance checks and a budget of 20 requests / 30,000 input characters. It does not use manuscripts saved in the application. The run writes a key-free result summary to `artifacts/memory-live/report.json`. A successful run establishes compatibility for that account and model at that time, not production recall quality or whole-novel capacity.

On **2026-10-04**, the [recorded Jina run](testing/memory-jina-2026-10-04.json) passed all four checks with `jina-embeddings-v3` (512 dimensions) and `jina-reranker-v2-base-multilingual`: 11 requests and 632 input characters. It exercised the production engine and adapters through a temporary local curl fetch bridge to the environment proxy after native Node fetch timed out. Real Jina browser CORS was not tested; browser regressions use a local synthetic provider. This synthetic acceptance run is not a semantic-quality or production-capacity benchmark.

## Open-source components

Direct dependencies `@orama/orama` and `@orama/tokenizers` 3.1.18 come from [oramasearch/orama](https://github.com/oramasearch/orama), under Apache-2.0, Copyright 2023 OramaSearch Inc. Upstream source is unmodified. Copyright notices and license copies are in `public/licenses/` and ship with the static build.

Orama Cloud, Answer Engine and persistence plugins are not included. The fact graph uses Cytoscape.js under the MIT license; see [its scope and license](memory-fact-graph.md). Future generation integrations must retain chapter-revision and disclosure constraints.
