# Bounded Writer Agent evaluation readiness

[English](writer-agent-evaluation.md) | [简体中文](writer-agent-evaluation.zh-CN.md)

This is an evaluation tool for the existing [author-reviewed Agent](writer-author-agent.md), not a new autonomous writing feature. Its deliverable is reproducible evaluation **readiness**. No live provider or human literary-quality results are claimed in this increment.

The first Agent loop was accepted in [PR #42](https://github.com/PainAxis/LLM-Writer/pull/42), merged as `266ca856396c46780512f1293725aeefef4a9bfe`, tree `f78cc175da84023cd73ab6e7afb6dfc0be82de69`. Its [merged-main run](https://github.com/PainAxis/LLM-Writer/actions/runs/39998090341) passed all twelve jobs on attempt 1, including 18/18 Agent groups and 90/90 browser scenarios. Those results establish the earlier engineering baseline, not this increment's CI or model quality. Earlier failure records remain unchanged.

The user’s final stage-four standard is [two autonomous million-character novels](writer-agent-longform-acceptance.md), one Chinese and one English, produced from outlines and character design without genre/plot/persona/foreshadowing drift. This short-case harness is only a prerequisite. It neither authorizes the heavy run nor establishes whole-work consistency.

## What is actually exercised

`createWriterAgent` uses its production planning/draft prompts, strict protocol, private evidence approvals, guards and budgets. Its real `prepareWriterMemoryContext` path executes the production `MemoryIndex`; `APIService` and the installed SDK produce and parse the actual HTTP envelopes. Offline mode replaces only HTTP responses, plus synthetic in-memory source/storage ports. It does not replace the planner/parser, pre-insert a gold retrieval hit or hand a fabricated evidence capability to drafting.

This Node path is **not** the browser Worker transport, editor application, browser CORS, or actual committed-source persistence. Existing twelve-job CI and the 90-case built-app suite remain necessary regressions. The evaluator never acquires/consumes an application lease, modifies a manuscript, or saves a proposal.

The model sees only the production brief and saved target tail when planning. It does not receive expected facts, gold queries, future sources, rubric answers or controlled replies. After real retrieval, a **gold-assisted fixed evaluator selection** finds a minimum-size, deterministically tie-broken set of current, disclosed, exact source spans covering every required premise. This is not a realistic measurement of human evidence choice or autonomous selection. Missing even one premise stops before the draft request; it stays a reported retrieval miss, not a successful refusal. Empty-gold negative cases do not authorize drafting.

## Frozen corpus and independent result lanes

The versioned [fixture](../scripts/fixtures/writer-agent-quality-v1.json) has eight short, synthetic Chinese story tasks, not eight full novels or a representative literary benchmark:

1. An earlier promise with negation and uncertainty.
2. A decision requiring two separated premises.
3. A changed current fact; first populate the old index, then synchronize the revised saved source.
4. Future disclosure and character-attribution boundaries.
5. Instructions quoted inside the story, including a deliberately bad controlled output.
6. A genuinely unresolved author decision.
7. Lexical distractors hiding a required premise outside returned evidence.
8. A low-lexical-overlap retrieval challenge.

Each has exact chapter/revision/UTF-16 anchors, forbidden observations, author direction, and permissible creative freedom. New actions and sensory details are not automatically false historical claims. A chapter cutoff alone cannot establish what a character knows; that requires review.

Three lanes remain separate:

- **Mechanical integrity:** exact source/selection/disclosure, input exclusions, protocol, requests, reservations, usage provenance, source stability, zero application and zero manuscript writes.
- **Observed behavior:** planning outcomes, required-premise coverage, stops, output-canary flags, latency and request-level usage. Keyword/canary checks are limited detectors, not semantic proof. The intentional bad output must remain visibly flagged even when the harness correctly detects its negative control.
- **Manual literary judgments:** factual consistency, actual premise use, direction/style and narrative usefulness. They start `null`/not reviewed. Each score is 0, 1 or 2 against the fixture's explicit anchors, with a rationale and exact quotations from both source and output. There is no automatic overall score, pass threshold, similarity score or model self-judge.

An absent draft cannot receive a prose score. Abstention or retrieval-miss appropriateness may be reviewed separately; truly not-run cases cannot be rated. A recorded operator judgment is not proof that a human genuinely made it or that it is correct, independent or blind. Mock-output review must not be relabelled live-model quality.

## Reproduce locally, with no credential or external call

Use the repository's existing dependencies and Node version. Run serially while source files are stable:

```sh
npm run eval:writer-agent
mkdir -p /tmp/llm-writer-evaluation
npm run eval:writer-agent -- --private-packet /tmp/llm-writer-evaluation/packet.json
npm run eval:writer-agent-review -- --template --packet /tmp/llm-writer-evaluation/packet.json --output /tmp/llm-writer-evaluation/ratings.json
```

The evaluator's stdout is the closed, source-free summary. Its default mock transport blocks external networking and uses no saved credential. A detailed packet is created only when explicitly requested, outside the repository, with exclusive creation and restrictive file mode. Existing files are not silently replaced. Retain the fixture alongside the packet identity when doing a local review; the packet does not duplicate every story.

The template contains all eight cases. Read the frozen fixture's `humanRubric`, case facts and allowed creative freedom, then edit the **local** ratings file. Supply a reviewer label and UTC time for any entered judgment. Source citations name a chapter and exact UTF-16 start/end/quote; draft citations have exact start/end/quote. Endpoints cannot split a surrogate pair. Scores without rationale, missing source/output citations, duplicate/unknown fields, wrong case IDs, changed outputs or mismatched packet/fixture/source hashes are rejected.

```sh
npm run eval:writer-agent-review -- --packet /tmp/llm-writer-evaluation/packet.json --ratings /tmp/llm-writer-evaluation/ratings.json --output /tmp/llm-writer-evaluation/review-summary.json
```

The derived review summary contains only IDs, hashes, counts and enum/score values. Reviewer identity, explanations and quotations remain local. Decision-review status and literary-review status are distinct. A valid review file proves schema/identity/citation consistency only, not the truth of its judgments.

## Future live pilot is a separate action

No live run, credential retrieval, provider discovery, model-list request or purchase is included in this increment. The old stopped Go test approval is not reused. The [Go usage guidance](https://opencode.ai/v2/docs/console/go/) asks for typical coding-agent traffic; that is a subscription-use consideration, not a claim that its models lack writing ability. Do not disguise these story requests as coding work. A suitable general-purpose provider and explicit authorization are still needed for real writing-quality observations.

The live CLI requires `--live --plan /outside/repo/approved-plan.json` and a single credential line through **non-TTY stdin**, never argv, environment, repository, saved configuration or logs. The plan fixes an exact HTTPS chat-completions endpoint, model, fixture hash, one or two selected case IDs, corpus disclosure and the gold-assisted selection policy. The maximum is two cases, four requests, 1,200 configured output tokens per request and 4,800 total. Production 30-second/65,536-byte response bounds and no-retry/no-redirect behavior remain. These are not a monetary cap or a general guarantee about hidden reasoning charges.

A plan's boolean flags are technical admission checks, **not evidence of user consent**. Obtain action-specific permission for credential transmission and the bounded test before invoking it. There is no fallback endpoint/model, implicit continuation to the other cases or automatic repair. Integrity/egress/credential failures stop remaining work. Unselected/stopped cases remain not-run in the full eight-case denominator. An ordinary poor output or retrieval miss is a recorded observation, not a reason to rerun selectively.

## Evidence and completion boundaries

Private packets, full backups, exports, traces and complete request/response collections must not be uploaded. The runner retains no raw response envelope or reasoning trace; request hashes/bytes and bounded visible results suffice. Never feed a private packet into the generic CI report collector. No new artifact-upload outlet is introduced by this increment. Existing fail-closed artifact allowlists remain in force.

Harness tests include controlled live-dispatch simulations with synthetic credentials; they are not real model calls. New smoke suites enter the existing dynamic aggregate. Final acceptance requires fixture/mutation checks, complete runtime-to-SDK offline observations, manual-review import rejection tests, zero-warning lint/build/full regression, independent review, and all twelve necessary exact-head CI checks. Source hashes and observed denominators must match the tested revision. Readiness can be accepted with zero live calls; real-model quality cannot.

## Current local validation

The [compact validation record](evidence/writer-agent-evaluation/LOCAL-VALIDATION.json) binds the unchanged tested source to zero-warning lint, build and all 107 smoke suites, plus focused strict type checking. The independent reviewer also ran the three new offline suites. The standalone mock CLI observed 8 cases and 13 mock HTTP requests: 5 draft-ready controls, 1 author-input outcome and 2 retrieval-insufficiency stops. One deliberately bad output is flagged; that is detector validation, not good prose. There were zero live calls and zero actual human judgments. Exact-head CI is still a release gate, not supplied by these local results.
