# Cited support checks: retained engineering evidence

[English](REPORT.md) | [简体中文](REPORT.zh-CN.md)

> [Browser CI follow-up and production owner correction](CI-FOLLOWUP.md).

Date: 2026-10-22. Base: merged full-scan revision `73e730a848c3272ad5a243d028cec65ad5b72c8b`. Scope: stage-three track 3, not completion of the whole stage or stage-four Agent. See the [feature contract](../../memory-support-checks.md).

## Revision-bound follow-up

The original local, stress and live observations below retain their original revision scope. The later owner-lifecycle correction changes three production files and has a new 366-path source/config/harness manifest: `ci-owner-fix-validation.json`. Production build, zero-warning ESLint and all 91 smoke suites passed on that unchanged snapshot. The exact current revision still requires all necessary CI, including browser and Writer stress; neither was rerun locally for this correction. The retained failure evidence (the first CI log excerpt and the second/third complete browser reports) is not a full-suite pass.

## Local regression

Strict ESLint with zero warnings, TypeScript/production build, **all 91 dynamically discovered smoke suites**, and both Writer stress profiles passed. Commands, exit statuses, timings and raw logs are retained here. The first build generated the expected `MemorySupportCheck` global component declaration; this is explicitly recorded rather than pretending the pre-build manifest was unchanged. Final lint/build were repeated after that declaration was generated. The subsequent smoke/stress runs used that final source tree.

The five added smoke runners cover the engine, actual SDK transport, shared UI lifecycle, private Writer selection bridge and default-mocked code integration. Existing regressions remain in the aggregate. Failure fixtures deliberately exercise rejected sources and storage/transport errors; these are not omitted from the logs.

`ci-memory-support` is a separate necessary browser job. The old `test:browser` runner does not include it. **No local browser pass is claimed**: local Chromium execution was restricted; no installation, launch or alternative route bypassed that restriction. The reviewed PR's GitHub CI establishes executed browser acceptance.

## Frozen semantic protocol fixture

- 33 fixed novel cases: 25 semantic cases and eight operational rejections.
- Controlled responses: supported **12/12**, insufficient **6/6**, uncertain **7/7**; all eight operational cases blocked safely.
- 26 required premises, 27 valid current-source citations; 25 controlled engine calls, **zero real model calls** in this suite.
- An always-insufficient mutation fails **19/25**; always-supported fails **13/25**. Positive cases must genuinely traverse the production parser and citation map, not merely produce a safe refusal.
- Largest measured controlled engine input: 2,443 UTF-16 units / 2,579 UTF-8 bytes; largest model text: 255 units / 369 bytes. These fixture sizes are not quality thresholds.
- Mechanical citation validity cannot prove entailment. The suite intentionally retains a source-valid but semantically wrong outcome as a quality failure, rather than asserting that the parser can detect all hallucinations.

See `memory-support-controlled.json`. Fixture SHA-256: `ebf0a7ea662e6ddd3e2079598954888cd553c72ae74c666691ae822704b20c2d`.

## Configured built-app acceptance, pending execution

The new browser runner requires **52 scenarios**, including all 25 frozen semantic cases through production parsing, citation mapping and visible UI; malformed/oversized/broken-stream/provider failures; stale-source and publication races; cancellation and late success; independent check questions; mobile layout; and separately approved Writer generation.

The separate `support-enabled-long-novel-v1` profile has **600 chapters / 1,388,902 characters**, with **599 chapters / 1,388,828 characters** disclosed. Exact evidence lies at chapters 588 and 590; chapter 600 is an excluded future-information canary. Lab and each of chapter-body generation, continuation and polishing must exercise support enabled. This capacity/lifecycle profile is not added to the 25-case semantic denominator.

Configured assertions: 50 support requests, three writing requests and 62 selected-source transmissions overall; the long profile separately requires four support requests, three writing requests, zero retrieval-provider requests and eight support-source transmissions. These are assertions awaiting CI execution, not invented successful measurements. All browser providers are synthetic loopback fixtures, never the real Go service.

## Existing Writer stress, feature disabled

Both existing profiles passed 13 scenarios and 103 preparations each. Together they validated **1,159 exact-source evidence checks**, with zero external requests and one controlled rerank request per profile. Twenty-four distributed mixed-code queries per profile recovered both passage and graph evidence: 48/48 for each channel in total. Weak/no-answer cases stayed unverified; old/future facts remained excluded and selections remained explicit.

| Profile | Characters | Relations | Evidence checks | Elapsed | Sampled heap peak | Sampled RSS peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| million | 1,440,000 | 1,801 | 578 | 23,646.376 ms | 756.954 MiB | 900.340 MiB |
| ten-million | 10,500,000 | 7,501 | 581 | 179,289.071 ms | 1,672.376 MiB | 2,138.262 MiB |

These are functional stress observations, not paired optimization benchmarks or enabled-support quality results. The enabled-support long-novel browser flow is separately required. Retained raw files: `writer-million.json`, `writer-ten-million.json`, `writer-report.json`. Existing full-body/source validation costs remain; no low-total-memory claim is made.

## Separately authorized Go attempt: unsuccessful

The seven-case synthetic **code/document** fixture is separate from the novel fixture. Its default mock runner passed 7/7 via production preparation → API → actual SDK → protocol/citation validation. Its SHA-256 is `6012bdccee930f3e8a260c430043d8b13fd08e44ae8cf1fc939b478878de9f1e`; see `code-mock.json`.

A separately authorized real attempt used the user-specified `https://opencode.ai/inference/go/v1/chat/completions`, model `glm-5.3-flash`, default reasoning, and a 600-total-output-token ceiling for GO01. **Exactly one attempt** was initiated. It failed as `transport` after **688 ms**, with no recorded HTTP status and zero received response bytes. No case was assessed; **GO02–GO07 were not run**. No retry, alternate route/model, embedding request or novel text was sent. The unused six-call allowance was not consumed automatically.

The transport intentionally suppresses raw diagnostics. Its generic category combines request errors and response interruptions; the retained evidence cannot identify DNS/TLS/network causes, establish whether the service received the complete request, or conclude that the key or route is invalid. The documented Go route differs from the user-specified route; no alternative was probed with credentials. There is **no successful live-provider, model-quality or browser-CORS result**.

Usage is unavailable. Any `0` fields in the failed local billing record are placeholders, **not measured zero tokens or zero charges**. Requested output allowance is not actual usage. The key was passed only through process stdin, held in memory, excluded from logs/configuration/files, and cleared; no persistent credential or account access was created. The retained report contains no key, headers, novel text or raw reasoning.

`go-live-attempt.json` is preserved unchanged. The before/after 205-file digest matched within the attempt. The subsequent build's sole source change was the generated declaration noted above. `source-snapshots.json` independently reconstructs both the original live digest and final mocked digest from that one difference; it does not relabel the failed attempt as a test of a later hash.

## Remaining gates and limits

- Blocker-free final review and all necessary CI on the exact published tree, including the new support browser job.
- No claim of real model accuracy, successful Go compatibility, real embeddings, browser CORS or general novel-writing quality. Selected-evidence limits do not establish whole-novel absence.
- Advisory results never approve or enter Writer prompts automatically. Model inference still requires author judgment; source validation is not a truth badge.
- Stage-three track 4, whole-disclosed-novel candidate extraction with author review, remains separate and unimplemented in this change. Stage four begins only after all stage-three tracks and shared gates pass.
