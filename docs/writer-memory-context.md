# Source-grounded memory in Writer

[English](writer-memory-context.md) | [简体中文](writer-memory-context.zh-CN.md)

This stage-three increment connects disclosed novel evidence to Writer generation. It does not introduce the stage-four Agent, autonomous tools, or automatic graph extraction.

## Using it

Open **chapter body generation**, **continuation** or **polishing** in Writer and enable **Use retrieved memory evidence** (`使用记忆检索依据`). It is off by default. Enter the fact or clue to find, select **Disclosed through** (`已披露至`), then choose **Search and preview** (`检索并预览`). The cutoff cannot extend beyond the actual chapter being written.

Every candidate starts unselected. Review the exact passages, chapter revisions, match indicators and explicit/inferred/author-confirmed labels, then select individual passages or complete relationships and choose **I have checked these sources; use the selected evidence for this generation** (`已核对，将所选依据用于本次生成`). Only selected items enter the generation attachment. Enabling memory requires this approval before generation; an empty selection cannot be approved. Changing the selection, query, cutoff or source clears previous approval. Match indicators always leave answerability unverified; see [evidence review](memory-evidence-review.md). Generation and applying its result retain the ordinary Writer controls.

If another tab edits the same novel, its saved change invalidates the preview. The existing save-conflict protection may also block a new search: copy any unsaved draft, refresh and reopen the novel, reconcile the draft, then save and prepare evidence again. Retrieval does not overwrite the other tab's change; see [persistence coordination](persistence-coordination.md).

The disclosure constraint covers this retrieved attachment. Manually entered instructions, outlines and selected existing materials continue through their own established flows; they are not retrospectively redacted for future plot information.

## Source and disclosure contract

The evidence comes from the current saved novel, rather than a detached copy of Memory Lab results. A preparation reads committed chapters, restricts them to the selected disclosure cutoff, and synchronizes that prefix into the local retrieval index. Narrative chapter order determines disclosure; event time and chapter IDs do not.

Retrieved passages retain chapter IDs, titles, SHA-256 source revisions, UTF-16 source ranges and exact quotations. Included graph relations retain their original explicit/inferred category, author/model creator and author-confirmation flag. Every premise of a relation must refer to current, disclosed text. Author confirmation cannot rescue a stale source or disclose a later premise early.

Free-form annotation text is not automatically source-grounded. If a relationship's predicate does not occur verbatim in one cited quotation, the preview and generation attachment use the neutral label **Source relation** (`原文关联`) or **Inference to verify** (`待核对推断`) instead. Clue labels likewise use a generic label. This prevents a later identity written into an otherwise early, valid annotation from bypassing the disclosure boundary; the saved graph annotation itself is not rewritten.

The source snapshot is checked again after preparation and immediately before generation transport. An old-chapter edit, chapter reorder/deletion, graph change or failed committed-source read prevents the prepared evidence from being sent. The author must prepare evidence again from the current source; old quotations are never silently rebound to new text. The writing model also runs this guard at each actual HTTP dispatch, including SDK retries, and the completed result is checked again before acceptance. Continuation/polishing recheck before their first editor mutation, including after the full-replace confirmation dialog; a failed save retains an already-applied draft for retry without inserting it twice. Cancellation during preparation cannot launch a delayed model request. Data already received by an external service cannot be recalled, and the generated prose still requires author review.

## Bounded context

The Writer interface uses a **6,000 UTF-16-character** evidence budget; the underlying service accepts **1,000–16,000 characters**. The budget applies to the entire appended evidence block, including its instructions and source metadata. Complete source units are admitted to the bounded preview before the author chooses which to use; the implementation does not truncate a quotation and continue to describe it as the original exact source range. A budget may therefore leave available space unused or omit candidates that do not fit.

This is an additional evidence-block limit, not a promise that the full model request fits every model's context window. The original writing task, existing user-selected material, model output allowance and provider limits also consume context. Finding a valid source does not establish that it answers the question, and model inference is not upgraded to an explicit fact by placing it in a prompt.

Initial preparation still builds an index of the disclosed manuscript. Repeated preparation with the same source can reuse it; shrinking the disclosed prefix and subsequently expanding it may require substantial indexing again. A small final attachment does not imply a small preparation cost for a very long novel.

## Optional external retrieval

Local keyword and clue retrieval works without a retrieval API. The optional embedding and reranking switches are independent and off by default. Enabling them and searching sends the query and eligible disclosed passages to the configured service; that service needs browser CORS support and may charge for requests. The writing model's normal API is still used when generation starts.

Embedding/reranking settings and credentials remain in the current Writer page session and are not written into novels or backups. Changing an endpoint or protocol clears the corresponding credential. Each outbound embedding batch, query embedding and rerank request rechecks the committed source before dispatch. A source change blocks the operation; an ordinary provider failure is reported as a local-retrieval fallback, which still requires source review.

## Reproduce the capacity checks

```bash
node --expose-gc --import tsx scripts/stress-writer-memory.ts
node --expose-gc --import tsx scripts/stress-writer-memory.ts --profile=million
node --expose-gc --import tsx scripts/stress-writer-memory.ts --profile=ten-million
```

The two deterministic Chinese-fiction workloads contain **600 chapters / 1.44 million UTF-16 characters** and **2,500 chapters / 10.5 million characters**. Their graph documents contain **1,801** and **7,501** relationships. Later relationships are stored before earlier ones to test that source eligibility and disclosure checks precede output limits.

The suite uses the real memory index and Writer evidence preparation service. It checks distributed exact-source queries, distant clue aliases, small and large evidence budgets, confirmed multi-premise inferences, later identity disclosure, old-chapter edits, batch edits, reordered/deleted chapters and source/graph changes before transport. A controlled rerank adapter checks outbound passages and rejects a stale-source race; it never calls a real provider. The suite records exact-source checks, prepared block sizes, preparation timings, index synchronization work and memory measurements in `artifacts/writer-memory-stress/`.

The capacity fixture retains 24 mixed Chinese/code queries separately. The historical PR #34 implementation could rank short passages matching only common Chinese words above the exact source for `白银封蜡FS00001`, while the isolated `FS00001` identifier recovered it. The [mixed-query follow-up](memory-mixed-query-recall.md) fixes that local candidate/ranking path and appends 24 hard assertions per size using the full original queries with graph and remote retrieval disabled. The original 68-preparation workload and mixed-query rows remain available for comparison.

The [evidence-review follow-up](memory-evidence-review.md) keeps the original 12-group / 92-preparation checkpoint, then adds no-answer boundary and explicit-selection assertions. Selections are counted separately from preparations.

Each size runs in a separate Node process with an in-memory committed-source adapter. These are synthetic source-integrity and capacity checks, not a literary benchmark or a real-model quality evaluation. Node measurements exclude browser IndexedDB hydration, Worker serialization, editor rendering and physical-device behavior; single-run wall times depend on the machine. Sampled heap can miss synchronous peaks, so process maximum RSS is reported separately. No paid model calls are required.

## Historical PR #34 local results — 2026-10-08

Both sizes passed **11 scenario groups and 68 successful preparations each**: **136 preparations, 778 exact-source checks**, and zero real external requests in total. Each size made one mocked rerank request and blocked the next request after a source change. Production-source and test-script checksums were verified before accepting these results.

| Workload | Cold preparation | Warm preparation p50 / p95 | Largest block at the 6,000-character budget | Process peak RSS |
| --- | ---: | ---: | ---: | ---: |
| 600 chapters / 1.44M characters / 1,801 relations | 8.55 s | 95 / 111 ms | 5,930 characters | 878 MiB |
| 2,500 chapters / 10.5M characters / 7,501 relations | 61.01 s | 614 / 701 ms | 5,996 characters | 2,053 MiB |

Warm timings cover the 24 exact-identifier preparations immediately after the initial index. They are single-run measurements, not a before/after speedup or a browser responsiveness guarantee. The large case still has a costly cold start and approximately 2 GiB peak process memory.

| Fixed query family | 1.44M quoted-source hits | 10.5M quoted-source hits | Graph evidence hits |
| --- | ---: | ---: | ---: |
| Unique identifiers | 24/24 | 24/24 | Not used as the quoted-source success criterion |
| Mixed Chinese/code queries | 0/24 | 24/24 | 24/24 in both sizes |

These historical mixed-query results reflect different chunk/short-passage distributions, not a monotonic quality improvement with novel length. The original miss rows remain unchanged; current fix results and new graph-disabled acceptance are recorded [separately](memory-mixed-query-recall.md).

Raw evidence: [1.44M report](testing/writer-memory-2026-10-08/million.json), [10.5M report](testing/writer-memory-2026-10-08/ten-million.json), [measurement summary](testing/writer-memory-2026-10-08/summary.json).

Use the current PR's CI and its raw reports for the final verification status. Existing keyword/semantic recall, no-answer detection, graph quality and capacity limits remain relevant; see [long-novel stress testing](memory-stress-tests.md) and [the fact-graph contract](memory-fact-graph.md).
