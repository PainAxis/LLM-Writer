# Support checks: accepted PR revision

[English](ACCEPTANCE.md) | [简体中文](ACCEPTANCE.zh-CN.md)

[PR #40](https://github.com/PainAxis/LLM-Writer/pull/40) merged at `7e2ae7d50c96f59894a8c96c9efb5d53aac4bfb9` after blocker-free independent review and **all ten necessary PR jobs passed** in [run 39844019935, attempt 2](https://github.com/PainAxis/LLM-Writer/actions/runs/39844019935). This accepts stage-three track 3, not track 4 or the whole stage. The [post-merge run 39848961580](https://github.com/PainAxis/LLM-Writer/actions/runs/39848961580) is a separate observation; it was still running when this record was captured at 20:29 UTC and is not represented as a passed main run.

## Exact identity

- Reviewed local snapshot: `294b5376738f4ce5a0983d836b6d4c01d6b95ccc`.
- PR head: `e6402cd4c6b87b18c585c8bd5ad3a2d287278073`.
- Actual Actions synthetic checkout: `56cc874d85519614c5977b7b18f152e4fb5d51c9`, whose parents are the preceding main `73e730a848c3272ad5a243d028cec65ad5b72c8b` and that PR head.
- Reviewed, tested and merged tree: **`8f3b7d00c735ec79529483d70b29ebce67f133d5`**. Commit identities are intentionally not conflated.

## Executed acceptance

The controlled production-browser report records **52/52 passed**, 25 semantic cases, **50 support + 3 writing + 101 retrieval mock calls**, **62 selected sources, 27 valid citations and 26/26 necessary premises**. Supported recovery is 12/12, appropriate insufficiency 6/6 and appropriate uncertainty 7/7. The original response-consumption mutation actually read HTTP 200 to EOF (504 bytes). Closing and reopening the same Writer document, then releasing an abort-ignoring response, caused **zero new requests during the complete close/reopen window**, with no old selection/preview/result/approval revival. Browser errors, fixture errors, blocked requests and unmocked external calls are all zero.

The separate 600-chapter / 1,388,902-unit long-novel profile passed Memory Lab and chapter/continuation/polish Writer paths. It does not expand the frozen 25-case semantic denominator. The seven code/document cases also passed with the real SDK intercepted at HTTP; they are mock integration evidence, not successful live Go calls.

Writer retry job `120063850325` passed all 21 browser scenarios and its full stress process. Stress covers 1,440,000 and 10,500,000 original units, 206 preparations and 1,159 exact-source checks, with zero external requests. Its six recorded source/harness SHA256 values independently match the merged tree. Runtime/resource values remain in the raw report and describe this CI machine, not the separate cold-index comparison or a universal memory limit.

## The cancelled first Writer attempt is not a pass

Attempt 1 passed nine required jobs. Writer's Chromium setup used 10m24s of its 20-minute job cap; browser execution then passed 21 scenarios in about 5m57s. The stress scenario lines reached PASS, but cancellation interrupted the final process boundary. That cancelled attempt was **not** accepted. Exactly one same-head Writer job retry completed successfully at 20:25:28 UTC. No source, workflow, test denominator, assertion or timeout was changed to obtain the result; no earlier-head pass was substituted.

## Durable raw evidence and limits

`accepted-ci-39844019935/` retains the original browser, code and Writer stress JSON reports, both Writer job logs, a derived summary and its own six-file `SHA256SUMS`. These are additive to the earlier 43 proof files; historical failures, measurements and hashes were not rewritten. The downloaded support archive SHA256 is `f88a958939078e5831f07f341b27eb62f85fce2a949231797cf2c8816bdaabed`; the successful stress archive is `d61313278d8ee439b2e1f12d68880189e47075b9b8920add0095caaa8b6968f7`. The raw browser report SHA256 is `e70a65ddfdd854c4a3172241029a7e240ce130b6447cd6faf390b5d38ce65aed`.

All browser execution was CI-hosted; no local browser installation or execution is claimed. These are engineering and controlled-semantic-fixture results, not general model quality. The earlier authorized real Go request remains **one transport failure, zero assessed outputs, six not run, actual usage/cost unknown**. It was not retried.
