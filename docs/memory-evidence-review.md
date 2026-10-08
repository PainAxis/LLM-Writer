# Reviewing retrieved memory evidence

[English](memory-evidence-review.md) | [简体中文](memory-evidence-review.zh-CN.md)

This stage-three increment distinguishes finding current source text from establishing an answer. Memory Lab and Writer display deterministic text-match signals. Writer requires the author to select individual passages or complete relationships before approving their use. Retrieval scores are not converted into confidence, and `answerability` remains `unverified` in every state.

## What the indicators mean

| State | Meaning | What it does not establish |
| --- | --- | --- |
| `none` | No eligible evidence is present in this result or selection. | That the entire novel contains no answer. |
| `candidates` | Eligible evidence exists, but it lacks a complete-query or requested-code match in the checked fields. | That a candidate is irrelevant or cannot help the writer. |
| `matched` | At least one field contains the full query or a requested exact code. | That the passage answers the question, all requested codes were found, or a stated event happened. |

The signals distinguish quotation text, chapter title and author clue labels/aliases. A title or annotation match is not a quotation match. Exact codes follow the [existing ASCII code grammar](memory-mixed-query-recall.md). `requestedIdentifiers` and `missingIdentifiers` disclose which requested codes were found across the current candidates or selected evidence. A query containing one present code and one absent code can be `matched` while still listing the missing code.

These indicators use current disclosed sources, not provider scores or a numeric relevance threshold. Optional semantic retrieval and reranking can find or reorder candidates, but do not verify answerability. An unanswered question quoted literally in the manuscript can produce `matched`; a known object code plus a question about an event never stated in the manuscript can also produce `matched`. Both remain unverified.

Graph assessment uses the selected relationship's complete source premises. It does not turn the author's predicate or an inferred relationship into an explicit fact. Original provenance, author-confirmation state, chapter revisions and disclosure constraints remain intact.

## Selecting evidence in Writer

Open chapter-body generation, continuation or polishing, enable retrieved memory, choose the disclosed cutoff and search. Every returned passage and relationship starts **unselected**, including literal/code matches. Review the original quotations and match indicators, then select the passages or complete relationships needed for this generation. A relationship is selected with all of its premises; individual premises cannot be removed to make an otherwise ineligible inference look valid.

Only those selected items enter the generation attachment. The selected assessment is recomputed from those items, so removing the sole code match can change `matched` to `candidates` and restore missing-code indicators. An empty selection produces an empty attachment and cannot be approved. Approval records the author's choice of context, not a verified answer.

Changing the selection revokes previous approval and any pending generation permission. Query, cutoff, source and graph changes retain the existing invalidation rules. Approval, model dispatch, completion and applying generated text still require current committed sources. Selection reads a private copy of the validated, budgeted candidate snapshot; arbitrary edits to returned preview objects cannot become source evidence. Unknown or duplicate selection IDs are rejected.

The existing 6,000-character Writer attachment budget includes metadata and instructions, and the service accepts 1,000–16,000 UTF-16 characters. Selection does not expand the preview's bounded candidate set or split quotations. It does not make new embedding or rerank requests. Those services remain separately opt-in; their keys stay in the current page session.

## Regression and measurement scope

The Writer stress runner retains the original PR #34 11-group / 68-preparation checkpoint and PR #35 12-group / 92-preparation checkpoint before appending evidence-review acceptance. Historical raw reports remain unchanged. New cases cover ordinary Chinese partial matches, absent and partly matched codes, a literal unanswered question, a present topic with an unstated event, old-chapter edits, future-only codes, selected-only assessments, empty selection and complete multi-premise relationships. Selection operations are counted separately from retrieval preparations.

```bash
npm run smoke:memory-match-signals
npm run smoke:writer-memory-selection
node --expose-gc --import tsx scripts/stress-writer-memory.ts
npm run test:browser-writer-memory
```

The original profiles contain 600 chapters / 1.44M and 2,500 chapters / 10.5M UTF-16 characters. The review group appends an explicitly unanswered question only after the historical checkpoints; its added character count is recorded separately. Source revisions, exact ranges, disclosure, full attachment budgets and zero real external requests remain strict assertions. These checks test known synthetic boundaries, not a measured no-answer detection rate or generated-writing quality.

## Recorded local results — 2026-10-08

Both profiles passed **13 groups, 103 preparations and 7 successful selections each**. Each rejected one selection after an old-source edit. Across both sizes, there were **206 preparations, 14 selections, 1,159 source checks and zero real external requests**; the original controlled rerank test made one mock request per profile and blocked its stale successor. All 24 mixed-query source checks and all 24 graph-disabled checks still passed per size.

The nine recorded assessment cases per profile distinguish absent/removed/future-only codes (`none`), ordinary or missing-code fallback (`candidates`), and partial-ID, existing-topic, literal-question and revised-code matches (`matched`). Every case and selected result retained `answerability: unverified`. Removing the sole matching passage recomputed the selection to `candidates`; empty selection became `none`. The literal unanswered-question fixture added **43 characters** after the original 92-preparation checkpoint.

| Original profile | Cold preparation | Warm p50 / p95 | Process peak RSS | Largest preview / selected block |
| --- | ---: | ---: | ---: | ---: |
| 600 chapters / 1.44M characters | 10.32 s | 106 / 125 ms | 887 MiB | 5,684 / 1,995 characters |
| 2,500 chapters / 10.5M characters | 64.84 s | 622 / 690 ms | 2,252 MiB | 5,881 / 2,000 characters |

Block maxima cover the tested 6,000-character preparations and seven explicit selections; smaller selected blocks reflect those choices, not a reduced service limit. Warm timings use the original 24 exact-identifier preparations after the cold call. These are single-run measurements; assessment metadata changes serialization, so the historical checkpoints are not an isolated speed comparison. The large run still needed roughly 65 seconds cold and 2.2 GiB peak process memory.

The [review record](testing/memory-evidence-review-2026-10-08/review.json) retains commands, environment, source/helper/test SHA-256 values, both historical-workload checkpoints, all 24 recall outcomes, review states and selected IDs. All original 92 query/cutoff/budget tuples and the first 12 scenario names were checked against the prior PR #35 raw run; historical reports were not rewritten. Full raw results remain reproducible from the command above and are emitted as CI artifacts.

The configured project now has **79 smoke suites / 133 browser scenarios**, including **20 Writer memory scenarios**. The browser acceptance exercises actual preview selection, approval and captured model payloads; its CI result must be checked independently of these Node results.

Node measurements exclude browser storage hydration, Worker transfer, editor layout, real devices and live-provider latency. Cold indexing and source reading/validation remain expensive; this increment changes review behavior, not the underlying capacity limits. The next capacity work and any future semantic answerability evaluation require separate acceptance criteria. Whole-novel extraction and the stage-four Agent remain deferred; stage-two persistence/editing work is not expanded here.
