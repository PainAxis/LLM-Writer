# Optional cited semantic support checks

[English](memory-support-checks.md) | [简体中文](memory-support-checks.zh-CN.md)

Stage-three track 3 adds an optional, explicitly started chat-model check of **one question against individually selected, current, disclosed original excerpts**. It works with ordinary local retrieval and completed optional semantic retrieval. It is not another retrieval mode, a whole-novel absence detector, or the stage-four Agent.

## Three judgments, not a verification badge

| Model judgment | Meaning within the selected excerpts |
| --- | --- |
| `supported` | The model considers its answer supported, with citations for every stated premise. An explicitly established negative or corrective answer can be supported. |
| `insufficient` | A necessary fact or premise is missing from this selection. This does **not** establish that the novel contains no answer. Partial premises and missing information remain visible. |
| `uncertain` | Conflicting accounts, ambiguous identity/time, unconfirmed reports or an inferential gap prevent a reliable answer. The relevant cited premises remain visible. |

The application validates the response protocol and current source positions. **It does not prove entailment or the model's reasoning.** A source-valid but semantically wrong answer remains possible. No similarity score or numeric threshold is converted into confidence. Existing literal/code indicators and their `answerability: unverified` remain unchanged beside this separate advisory panel.

Disabled, not run, canceled, unavailable, stale, timed out, malformed and failed requests remain **unverified**, not successful `insufficient` or `uncertain` judgments. Source silence cannot support a negative answer. A question's own premise, title, alias or author annotation is not evidence. A complete simple multi-premise chain may be supported; rejecting every question is not acceptable validation.

## Author workflow

In Memory Lab, complete a search, explicitly check original passages, and enable the separate support-check option. In Writer, keep the existing individual passage / whole-relationship selection. Every selected relationship contributes all its original premises; one stale or undisclosed premise invalidates the whole selection.

The editable check question starts with the retrieval query. Changing this question invalidates the check without silently broadening the selected evidence or automatically searching again. Prepare a **local-only preview**, inspect the question, exact quotations, source revisions, configured chat model/destination and budgets, then explicitly send. Preparing makes no provider request. Embedding, reranking and full-scan permissions do not enable this chat request. An unfinished full scan supplies no selectable partial evidence.

The result shows each model-described premise beside its exact original quotations, plus the answer, explanation and missing/unresolved information. Text is rendered as text, not executable HTML or Markdown. Only the question and original quotes enter the model payload; chapter/project titles, annotations, relationship predicates, retrieval scores and full chapters do not.

Starting a Writer check revokes existing generation approval and blocks approval while checking. Completion, including `supported`, never selects or approves evidence. Chapter-body generation, continuation and polishing still require explicit approval of the selected references and all existing dispatch/completion/application freshness checks. **The check's answer and explanation are not added to the writing prompt or manuscript.** An author may still use current reference material after reviewing an insufficient/uncertain/unverified warning and explicitly approving it.

Closing or switching a Writer dialog synchronously revokes its pending support check, preview, candidates, selection and approval, including responses that ignore cancellation. Reopening the same route may retain the author's enabled switches; it does not retain permission or results. New Writer instances start disabled. The existing chapter-generation controller closes its dialog before requesting text: only its private, synchronous, already-approved launch handoff preserves the writing lease, and even that handoff clears the separate support-check capability and output.

Checks, plans and results are route-session state, not persisted graph facts or backups. Chat credentials use the existing configuration; the feature adds no new credential store. Usage records omit question, quotes, response and reasoning content while retaining available usage metadata. A destination preview excludes URL credentials, query strings and header values; a configured proxy's origin is disclosed too.

## Explicit input and request budgets

These are input/cost limits, **not credibility thresholds**. Over-budget selection is rejected; the service never silently clips a quote or drops a relationship premise.

| Limit | Bound |
| --- | --- |
| Question | 1–500 UTF-16 code units |
| Source selection | 1–8 unique complete anchors; each at most 2,000 units; total at most 8,000 units |
| Complete system + JSON user input | At most 16,000 UTF-16 units and 48,000 UTF-8 bytes |
| Provider attempts | At most one HTTP generation dispatch per prepared plan |
| Requested output | At most 1,200 total output tokens, including applicable reasoning allocation |
| Returned output | At most 8,000 model-text units and 65,536 decoded HTTP response bytes, including error/reasoning envelope |
| Processing | 45 seconds total after Start; provider at most 30 seconds; each source guard at most 10 seconds, all limited by remaining total time |
| Local preparation | 10 seconds across UI preparation, including Writer's pre-engine committed reads |
| Ready plan | Expires after five minutes; preparation must be repeated |

The request-local adapter disables SDK retries, tools, repair loops, model fallback and redirects. It bounds the streamed HTTP body **before** SDK JSON parsing, even with absent/false Content-Length, an oversized error or a stalled stream. Exact serialized source text, including control characters and non-BMP text, is preserved on the wire. Ordinary calls without these optional limits keep their prior behavior.

Provider-specific token settings remain enforced. In particular, bounded Qwen calls require a finite compatible separate thinking allocation or explicitly disabled thinking; visible plus thinking allocation must fit the requested total. Reasoning-only models retain their existing model policy. Unsupported settings fail closed rather than receiving an unlimited allocation or silent model change.

Cancel settles the request even when a dependency ignores its signal; late output cannot revive it. Double clicks reuse the one-use result and cannot dispatch twice. A new check is a new explicit request, never an automatic retry. Error text is a safe category, not raw provider diagnostics or headers.

## Current sources at every boundary

Input copies are captured privately before asynchronous work. The service validates project/cutoff identity, manifest consistency, all source revisions, exact UTF-16 ranges, complete quotations and surrogate boundaries. Selected chapter hashes are checked independently; committed sources are reread after hashing as well as before dispatch and publication.

The route also binds query, independent check question, selection, actual Writer target, graph and private provider configuration identity. Changing any of them invalidates an old plan/result. Storage/focus/visibility refreshes are additional safeguards, not substitutes for committed reads. Failed saves, old editor drafts, future sources and author confirmation cannot override validation.

Source or graph validation failure, including a stalled source guard, clears the old preview/candidates/selection and requires a new search. A provider-only failure may retain genuinely current references, but approval remains revoked and a later use still requires freshness and explicit author approval. No extra processing allowance is added for final parsing, citation mapping or publication.

## Frozen acceptance and interpretation

The [novel fixture](../scripts/fixtures/support-check-fixture-v1.json) has **33 fixed cases**: 25 semantic cases (12 supported, six insufficient, seven uncertain) and eight operational rejections. Its SHA-256 is `ebf0a7ea662e6ddd3e2079598954888cd553c72ae74c666691ae822704b20c2d`. It was frozen before implementation comparisons. Gold includes paraphrases, explicit negatives, unanswered literal questions, missing and complete multi-premise chains, contradictory accounts, ambiguity, future-only answers and injected instructions.

Controlled replies exercise the production parser, private citation mapping and lifecycle. The semantic cases require 26 designated premises and resolve 27 citations. An always-insufficient mutation fails 19/25 cases, including all 12 positives; an always-supported mutation fails 13/25. The parser deliberately cannot detect every semantically wrong answer with a valid citation; the gold evaluator must count that as a quality failure rather than claim it impossible.

The built-app suite separately runs all 25 semantic cases, malformed/oversized/interrupted/failed responses, false citations, source changes at transport/publication boundaries, late successful responses, selection/configuration/query/cutoff changes, full-scan incompleteness and a narrow mobile view. A separate `support-enabled-long-novel-v1` profile contains 600 chapters and 1,388,902 characters, of which 1,388,828 are disclosed through chapter 599. Exact evidence at chapters 588/590 is checked in Lab and all three Writer generation paths; the chapter-600 future canary is excluded. This expansion does not change the frozen semantic denominator. The complete suite requires 52 scenarios, 50 support requests, three writing requests and 62 selected-source transmissions. The long profile separately requires four support and three writing requests, zero retrieval-provider requests and eight support-source transmissions. These are configured assertions, not an unexecuted browser pass. A passing Node test is not a browser result.

The separately frozen seven-case **code/document** fixture tests the same integration path. Its hash is `6012bdccee930f3e8a260c430043d8b13fd08e44ae8cf1fc939b478878de9f1e`. Its default runner is fully mocked and never requires a key. Any separately authorized real-provider observations must identify model, fixture, attempted/failed cases, bounds, latency and usage; they are not novel-quality measurements. No metric may quietly exclude invalid output, failures or refusals.

```bash
npm run smoke:memory-support
npm run smoke:memory-support-transport
npm run smoke:memory-support-ui
npm run smoke:writer-memory-support
npm run smoke:memory-support-code          # Mocked; never live by default
npm run build
npm run test:browser-memory-support
npm run smoke:all
```

CI includes the separate necessary `ci-memory-support` job plus all previous jobs. The dynamic `smoke:all` runner includes all 91 registered smoke suites. `test:browser-memory-support` is intentionally a separate browser runner invoked by that CI job, not part of the older generic `test:browser` runner; do not treat running the latter alone as support-check acceptance. The reviewed revision's CI result is the browser/merge acceptance record. Local Chromium execution remains unavailable in the current engineering environment; that restriction was not bypassed. Controlled fixtures establish engineering behavior, not live model accuracy, browser-provider CORS support or general novel-writing quality.

The [retained evidence](testing/memory-support-checks-2026-10-22/REPORT.md) distinguishes controlled results and the separately authorized real-provider attempt.

Track 3 does not finish stage three. Author-started whole-disclosed-novel relationship and foreshadowing/recovery candidate extraction, its coverage/budget/review contract and the shared gates remain track 4. The bounded stage-four Agent follows only after those gates pass; stage-two persistence/editor redesign is separate.
