# Long-novel memory stress tests

[English](memory-stress-tests.md) | [简体中文](memory-stress-tests.zh-CN.md)

These tests extend the [memory prototype](memory-prototype.md) acceptance checks beyond the small demonstration manuscript. They separate local capacity, retrieval correctness, provider failure handling, browser workflows and real-model recall so that passing one does not imply passing all of them.

The recorded results below belong to **PR #30** and retain that revision's full-rebuild and browser cache-loss observations. The current implementation adds [chapter-level incremental indexing and cache retention](memory-incremental-index.md); its repeated-edit and focus-return checks extend the same workloads. Historical measurements are not new-version benchmarks.

## Workloads and interpretation

| Group | Workload | What it establishes |
| --- | --- | --- |
| Local engine | Deterministic multi-volume Chinese fiction at million- and ten-million-character scales, with recurring names, locations, similar clues and planted facts | Indexing capacity, measured retrieval latency, source provenance, revision invalidation and disclosure boundaries |
| Hybrid/provider | A million-character corpus and a local HTTP provider returning controlled 512-dimensional vectors and reranking results | Production adapter requests, cache behavior, candidate boundaries, failure fallback and cancellation; not model intelligence |
| Browser | A large novel stored through the application's chapter-blob persistence format, then searched and edited in the built application | Worker integration, repeated searches, persisted source reads, multi-tab edits and visible evidence |
| Real Jina | Full public-domain Chinese novel texts and questions fixed before the run | Observed retrieval quality for those texts, questions, models and account, including misses; not general novel-writing quality |

Procedural text varies characters, locations, dates, amounts, actions, dialogue and paragraph structure. Planted identifiers make expected sources unambiguous; clues include overlapping aliases and distant source chapters. This is more varied than repeating a filler paragraph, but remains generated test data. Exact-identifier accuracy and manual-clue retrieval must not be presented as natural-language semantic recall.

All sizes use JavaScript UTF-16 code units, matching the engine's offsets and capacity checks. They are not Chinese word counts, tokens, file bytes or distinct literary words. The procedural corpus includes supplementary Unicode characters to exercise source ranges. The browser fixture generates 1,560,000 prose characters, then stores canonical Writer paragraph HTML: **1,670,912 UTF-16 code units / 4,504,280 UTF-8 bytes**. Its visible text contains **1,559,999 indexed characters** after normal outer-whitespace trimming. Every chapter's converted text is checked independently against the generated prose; generated, stored-HTML and indexed counts remain separate.

## Issues exposed and corrected

The expanded workload exposed two problems that the small acceptance fixture did not reveal:

| Problem | Before | After |
| --- | --- | --- |
| Numerous partially matching clues displaced exact body matches from the fused result list | Expected source quote appeared in Top-8 for **0/24** compound fact queries | Balanced local channel weights restored **24/24**, all at rank 2; the separate 24 clue queries retained their rank-1 result |
| Every unchanged source synchronization rebuilt the keyword index | Three repeated synchronizations of the 1,296,626-character public corpus took **9,529.63 / 9,576.07 / 10,677.62 ms** | Exact-source reuse took **2.69 / 1.51 / 1.15 ms**; cold builds remained about **9,881 ms** |

The [ranking comparison](testing/memory-stress-2026-10-04/ranking-before.json) and [corrected results](testing/memory-stress-2026-10-04/ranking-after.json) use the same frozen v1 fixture: 600 chapters, 1,320,000 characters, 1,200 body passages and 300 clues. The final capacity fixture uses a revised random generator with broader template/location coverage; do not compare its timings or quality directly against this v1 ranking experiment. The ranking correction does not imply perfect rank-1 relevance: all 24 tested fact sources remained at rank 2.

The [synchronization comparison](testing/memory-stress-2026-10-04/sync-before.json) and [reuse results](testing/memory-stress-2026-10-04/sync-after.json) measure `structuredClone` plus the production synchronization call over 1,178 public-corpus passages. They exclude browser storage, Worker messages, rendering, retrieval and provider calls. The PR #30 reuse change skipped unnecessary tokenization; it did not accelerate the first build or a changed-source rebuild. Three repeated measurements are not a percentile benchmark.

An additional legacy-format boundary remains. When an earlier fixture stored plain text directly, opening Writer and selecting chapter 2 saved the initially selected chapter 1 through wangEditor. Its blank-line conversion added 24 newline characters to that **otherwise unedited chapter**; the textual facts were unchanged. The final fixture uses canonical Writer HTML and checks all 600 visible-source hashes, allowing only the deliberately edited chapter to change. This corrects the test's storage-format assumption; it does not fix or certify whitespace-preserving round trips for legacy plain-text chapters.

## Recorded PR #30 stress results — 2026-10-04

### Local capacity and editing

The [local report](testing/memory-stress-2026-10-04/local.json) passed **36 workflow checks, 777 searches and 5,151 source-evidence checks**, with zero external requests. Each size ran in a fresh Node process. The v2 procedural fixture used all 72 cast names, 36 locations and eight paragraph templates; string uniqueness is not a claim of literary diversity.

| Characters / chapters | Body passages / clues | Cold build | Rebuild after editing 30 chapters | Unchanged sync | Repeat search p50 / p95 | Process peak RSS |
| --- | --- | --- | --- | --- | --- | --- |
| 1,320,000 / 600 | 1,200 / 300 | 7.73 s | 7.32 s | 1.92 ms | 6.09 / 10.44 ms | 621.63 MiB |
| 3,300,000 / 1,500 | 3,000 / 750 | 18.92 s | 19.20 s | 3.16 ms | 16.35 / 54.03 ms | 1,311.51 MiB |
| 10,500,000 / 2,500 | 10,000 / 1,250 | 60.69 s | 59.42 s | 6.76 ms | 42.34 / 145.42 ms | 2,005.57 MiB |

Repeated-search percentiles each use 48 engine-only queries. All three sizes retrieved the expected quote in Top-5 for all 48 planted identifier/clue probes. The separate 12 natural multi-entity questions achieved Top-5 **11/12, 10/12 and 8/12**, and Top-8 **12/12, 11/12 and 11/12**, respectively. The successful workflow assertions must not be reported as 100% natural-query recall.

The tests also retracted 30 edited chapters' stale facts/clues, hid and revealed 12 late identities at their boundaries, changed chapter order, deleted 20 chapters and switched projects reusing chapter IDs. A 20,000,001-character source was rejected before indexing; this does not demonstrate successful operation at the 20-million-character limit.

The 3.3-million- and 10.5-million-character sources have 3,000 and 10,000 passages, exceeding the semantic channel's 2,000-passage limit. Their successful results are **local retrieval capacity**, not complete-source embedding/reranking capacity.

These local measurements used Node 24.19.0 on Linux x64, an Intel Xeon Platinum 8573C environment exposing nine logical CPUs and 9.734 GiB total memory, with a 2,240 MiB Node heap limit per profile. Other test work ran in the shared environment. At that revision, the ten-million-character result exposed a practical cost: **editing required roughly a minute of rebuilding and the process reached about 2 GiB RSS**. Successful completion does not make this workload suitable for every desktop or mobile browser.

### Controlled HTTP hybrid workload

The [hybrid report](testing/memory-stress-2026-10-04/hybrid.json) passed all 11 acceptance groups over 112 synchronization/search actions. The main source has **600 chapters, 1,320,000 characters and 1,200 passages**, with 512-dimensional synthetic vectors. All **80 warm fact/clue queries** found their expected source, including 20 distant-clue queries. These are engineering correctness checks against deterministic providers.

| Measurement | Observed result |
| --- | --- |
| Cold whole action, including source sync and embedding | 9,462.77 ms; 40 HTTP requests; synthetic 25 ms delay per request |
| 80 warm whole actions, including fresh clone/sync | p50 **19.08 ms**, p95 **25.27 ms**; loopback HTTP without artificial delay |
| Warm synchronization alone | p50 2.29 ms, p95 3.02 ms |
| Warm retrieval/provider work alone | p50 16.71 ms, p95 22.45 ms |
| Edit 20 old chapters | 40 passages re-embedded, 1,160 reused, 20 stale clues excluded |
| Fail source batch 19, then retry | 576 validated vectors retained; only 604 missing passages submitted on retry |
| HTTP traffic for the complete run | 362 requests; 28,733,177 request bytes; 23,602,163 response bytes; zero outbound source violations |

429/500 responses, wrong vector dimensions, truncated JSON, invalid rerank indices and an in-flight cancellation all exercised fallback or cancellation followed by recovery. A 2,420,000-character / 2,200-passage source explicitly reported semantic fallback, with **zero embedding requests**; reranking could still run on local candidates. This is a capability-limit result, not a successful full-source hybrid test. The total-budget branch uses a disclosed **350 ms accelerated timer** for the production 65-second budget; it is a control-flow test, not a real 65-second latency observation.

Observed process peak RSS was 1,417.63 MiB, with several test indexes alive; cold-action RSS was 399.60 MiB. Neither value is an isolated per-novel allocation. Local hash vectors, lexical reranking and loopback latency do not predict real Jina quality or latency.

### Built-app browser workflow

All **eight browser stress scenarios passed** in [CI run #75](https://github.com/PainAxis/LLM-Writer/actions/runs/37171182997); see the [browser report](testing/memory-stress-2026-10-04/browser.json). This was the PR integration build, merge commit `79968f1` for branch head `2860134`, rather than a standalone Node engine test. The environment used Chromium 153.0.8010.12, Node 24.21.0, Linux x64 and an AMD EPYC 7763 runner exposing four CPUs, at a 1440 × 1080 viewport. It was a desktop test, not a mobile-device benchmark.

| Measurement | Observed result |
| --- | --- |
| Manuscript | 600 persisted chapter blobs; 1,560,000 generated prose characters / 1,559,999 indexed characters |
| Initial selected-source load | 3,883 ms |
| 56 completed UI search actions | p50 **174 ms**, p95 **4,406 ms**, maximum **4,413 ms** |
| Cold semantic scope through chapter 400 | 1,200 eligible passages in 38 batches |
| In-flight cancellation response | 40 ms; late response excluded and subsequent retrieval recovered |
| Main-thread observations | Six long tasks, maximum 138 ms; maximum visible frame gap 133.4 ms |
| Provider traffic | 125 local HTTP requests; three-dimensional synthetic vectors and controlled reranking |

The 56-query distribution combines local, cold/warm hybrid, post-edit rebuild and cancellation-recovery actions. Each measurement starts at the search click and includes committed-source reading, Worker synchronization and rendered results. It is not a warm-only retrieval benchmark. The Writer edit scenario took 27.364 seconds for its **whole step**, including opening Writer, switching chapters, saving, reading, searching and assertions; the report does not isolate save latency.

The scenarios checked 24 cross-volume queries, a distant planted passage, 12 future-identity boundaries, real Writer editing in a second tab, cancellation, reload and source evidence. All 600 chapter texts were independently verified after saving; the 599 unedited chapters remained exactly unchanged. Indexed text stayed at 1,559,999 characters. Stored HTML changed from 1,670,912 to 1,670,814 code units through editor serialization, so its size is not used as a substitute for visible-text integrity. There were no uncaught browser errors or future-identity markers in provider payloads.

The PR #30 browser run also confirmed its cache-lifecycle limitation: **returning from Writer re-embedded all 1,200 eligible passages in 38 batches**, not just the changed chapter. The same count was submitted again after the explicit cache clear and cancellation recovery. These local-provider results establish the actual UI behavior; they do not measure paid-model latency or browser CORS against Jina.

### Real Jina over the complete public-domain anthology

The [completed Jina report](testing/memory-stress-2026-10-04/jina.json) evaluated all 22 predeclared questions against **1,296,626 characters, 171 chapters and 1,178 passages**, using `jina-embeddings-v3` at 512 dimensions and `jina-reranker-v2-base-multilingual`. All 18 positive remote questions used both semantic retrieval and reranking; no fallback query is counted as successful hybrid retrieval.

| Expected-source recall, 18 positive questions | Local only | Jina hybrid plus reranking |
| --- | --- | --- |
| Top-1 | 3/18 (16.67%) | 7/18 (38.89%) |
| Top-5 | 5/18 (27.78%) | 15/18 (83.33%) |
| Top-8 | 6/18 (33.33%) | 16/18 (88.89%) |

The predeclared Top-5 target of 80% was met for this small fixed question set. Misses remain visible: the expected source for Lu Zhishen's display of strength ranked sixth; the expected passages about Red Boy's new role and the cause of the Fengxian drought were absent from Top-8. These results measure retrieval of predeclared quotes, not generated answers or general literary understanding.

Both future-disclosure checks passed, and an old-chapter replacement excluded the old fact and retrieved the replacement with the new revision. There were zero outbound source-scope violations. However, **both unanswerable questions returned eight passages in local and remote modes**. The current retriever does not reliably identify that a requested event has no source evidence; an answer-generation integration must not treat any retrieved list as proof of an answer.

**The first cold search did not complete hybrid retrieval within the production budget.** Three attempts each used approximately 65 seconds and fell back; a fourth took 26.19 seconds to complete the 1,178-passage cache and retrieval. Total preparation across attempts was 221.19 seconds. This is successful resume behavior, but not acceptable evidence of a one-shot cold search succeeding. The 18 warm positive whole actions measured p50 **10.07 seconds**, p95 **17.54 seconds**.

The complete live run took 531.72 seconds, made 92 requests and submitted 2,857,567 UTF-16 characters. The provider reported 3,508,329 total tokens; this is reported usage, not a calculated monetary charge. Requests used a temporary curl bridge through the execution environment's proxy; timing includes that transport and real browser CORS remains untested. The report records the tested engine revision and the later stale-clue reuse adjustment; this corpus has no clue annotations, so that adjustment does not change its tested source path.

## Run the tests

```bash
npm ci
npm run test:memory-stress-local
npm run test:memory-stress-hybrid
npm run build
npx playwright install chromium
npm run test:browser-memory-stress
```

The `ci-memory-stress` job runs local capacity and controlled-provider workloads; the separate `ci-memory-browser-stress` job runs the built-app Chromium workload in parallel. Existing smoke tests and shorter browser regressions remain separate; the stress scripts are not counted as additional smoke suites. The current local workload adds repeated single-chapter saves, the hybrid workload checks incremental vector reuse through those saves, and the browser workload checks unchanged-focus reuse plus partial re-embedding after a real Writer edit. See the [incremental acceptance rules](memory-incremental-index.md#validation).

For the optional paid-service run:

```bash
npm run test:memory-corpus-fetch
# Set JINA_API_KEY in the process environment without committing it.
npm run test:memory-stress-live
```

The live runner has a ceiling of 180 requests and 4,000,000 submitted UTF-16 characters, with at most eight attempts to populate the source-vector cache. Each attempt retains the production 65-second remote budget. It records whether the first cold attempt completed, whether later attempts completed, and which individual queries actually used semantic retrieval. These repeated preparation attempts must not be described as a successful single cold search.

Local and provider reports are written to `artifacts/memory-stress/`; the browser report and screenshots are under `artifacts/browser-memory-stress/`. The live report is `artifacts/memory-stress/jina.json`. Failed assertions still produce available diagnostic artifacts. Reviewed, key-free snapshots are published under `docs/testing/memory-stress-2026-10-04/` when the corresponding run is complete.

## Acceptance rules

- **Old chapters:** after editing a chapter, search and evidence must use its current title/body hash and exact current source range. Clues attached to its previous revision become stale. A query may still match unchanged words in new text; that is not evidence that the old fact survived.
- **Distant clues:** require the expected source chapter and quote, not merely a nonempty response. Distinguish author-supplied clue aliases from unannotated semantic queries.
- **Disclosure:** verify both displayed evidence and outbound provider payloads against the selected chapter boundary. Many strong future matches must not crowd out eligible earlier sources. Reordering chapters changes the disclosure order.
- **Failure and races:** invalid provider responses, exhausted budgets, cancellation and stale asynchronous requests must not resurrect an earlier project, chapter version or disclosure scope. Record explicit local fallback separately from successful hybrid retrieval.
- **Persistence:** edit through Writer, wait for its committed save, and read the changed source in Memory Lab. An in-memory fixture mutation alone does not verify the application's persistence path.

Passing a retrieval test requires the expected source and current provenance. A successful HTTP response, nonempty hit list or fallback result alone is insufficient.

## Measurements

Reports retain corpus dimensions, operation counts, success/failure details, latency distributions, memory observations and the runtime environment. They contain no API credentials or private manuscripts. Query lists and expected sources are defined before a real-service run; misses remain in the report rather than being removed from the denominator.

Engine search time measures the retrieval call. A browser search action also reads committed chapter text, synchronizes the keyword index, crosses the Worker boundary and renders the result; its latency is not comparable to an engine-only query. Synchronization reuses a completely unchanged validated snapshot and can update affected chapters incrementally. Report its synchronization mode and document-work counters alongside timing; compaction or recovery can require a full build. The hybrid stress runner likewise includes a fresh source clone and synchronization in each whole-action measurement. Cold embedding includes source-vector creation. Warm queries reuse the eligible source vectors but still embed the query and, if enabled, rerank candidates.

Use p50/p95 with the reported sample count. One run on one machine is evidence of that run, not a performance service-level guarantee. Node process RSS includes the runtime, fixture and other objects, and is not the index's isolated memory cost. Browser heap observations have a different scope and must not be compared directly with RSS.

## Current production limits

These tests exercise the existing limits rather than silently raising them:

- Each prototype search rereads and validates the complete committed source. Chapter-level incremental indexing reduces changed-source index work, but does not remove full-source reading, cloning or validation. First builds, project changes, interrupted mutations and periodic compaction can still require a full index build. Persisted index snapshots remain unimplemented; see [incremental boundaries](memory-incremental-index.md).
- Semantic retrieval accepts at most **2,000 eligible passages**, with sequential batches of **32**. A larger source explicitly falls back to local retrieval; it does not embed only an undisclosed subset.
- Each provider request has a **15-second** timeout and all remote work for one search shares a **65-second** budget. A slow cold build can exhaust that budget while a warm query succeeds. Record the actual stages and fallback reason in both cases.
- The vector cache is bounded by **2,000 entries / 32 MiB** and is lost when the route lifecycle ends. Window focus or novel-storage invalidation retains the Worker baseline but immediately hides old evidence and requires fresh committed-source synchronization. Explicit cancellation, provider changes, cache clearing and project switches still discard the caches. It is not durable background indexing.
- A chapter's title and entire body determine its revision. Editing one sentence changes the cache scope for all chunks in that chapter, even if other chunks' text is unchanged.
- Reranking sees at most **60** fused candidates. It cannot recover a relevant passage absent from those candidates.
- Existing generation tools and prompts do not yet use this prototype. Retrieval tests therefore do not demonstrate long-form generation consistency, automatic foreshadowing detection, summarization quality or a fact relationship graph.

## Corpus and remote-service boundaries

The real-text test uses Project Gutenberg's [Water Margin, seventy-chapter edition](https://www.gutenberg.org/ebooks/23863) including its prologue, and [Journey to the West, one-hundred-chapter edition](https://www.gutenberg.org/ebooks/23962). The normalized 171 chapter bodies total **1,296,626 UTF-16 code units**, including **1,022,915 Han characters**. Original UTF-8 downloads total 3,896,072 bytes. The fixture pins original-file SHA-256 checksums, validates chapter ordering and retains a probe-file checksum; no repeated padding is added.

The question file fixes **22 probes before the paid run: 18 source-recall questions, two future-disclosure checks and two unanswerable questions**. Local-only and remote searches use the same questions and cutoffs. Recall requires both the expected chapter and the predeclared source quote. Top-1/Top-5 results apply to the 18 positive questions; future exclusion and unanswerable behavior are reported separately. Nonempty retrieval for an unanswerable question is not a correct answer and is not included as successful recall.

Downloaded full texts are test artifacts rather than application content. Combining books increases index volume, but the resulting anthology is not one coherent novel and does not supply cross-book plot continuity.

Remote tests send eligible public-domain source passages and the registered questions to the configured provider. They are separately invoked and consume the account's paid quota; they do not run as part of ordinary CI. A transport bridge used to reach a provider from the execution environment adds overhead. Such a run verifies the production request/response adapters and model behavior, but not browser CORS compatibility. Browser tests use a local controlled provider unless explicitly stated otherwise.

Production acceptance still requires representative author manuscripts, realistic query distributions, target desktop/mobile devices and sustained editing sessions. These tests narrow known engineering risks; they do not establish that every million-character workflow is production-ready.
