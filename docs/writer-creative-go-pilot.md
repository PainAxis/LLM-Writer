# OpenCode Go: bounded Node pilot

[English](writer-creative-go-pilot.md) | [简体中文](writer-creative-go-pilot.zh-CN.md)

The Go integration uses the existing Creative Pilot v4 repository, compiler and nine-task engine. It does not replace the OpenAI browser pilot accepted in [PR #53](https://github.com/PainAxis/LLM-Writer/pull/53). Engineering tests intercept provider traffic; they establish no real-model writing result.

## Provider contract

- Provider: OpenCode Go; model: `mimo-v2.6-flash`.
- Base URL: `https://opencode.ai/inference/go/openai/v1`; Chat Completions only.
- Stable campaign session header and an honest LLM-Writer User-Agent. This entry runs in Node because browsers may drop a custom User-Agent.
- Thinking disabled, 4,096 output tokens, no tools, automatic retry or balance-provider fallback.
- Separate hash-bound Go grant and policy; existing OpenAI and offline records retain their original meaning.

The [Go documentation](https://opencode.ai/v2/docs/console/go/) lists input/output prices of $0.14/$0.28 per million tokens on 2026-11-02. The [MiMo specification](https://mimo.mi.com/models/en-US/mimo-v2.6-flash) and [official model configuration](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Flash-RL/raw/main/config.json) establish a 1,048,576-token context ceiling. Reserving that entire input ceiling plus 4,096 output tokens, rounded up per request, gives **$0.147948 per slot and $2.663064 for 18 slots**. This conservative reservation is not predicted usage. The existing HTTP-byte limit is not relabeled as a token limit.

Go tracks subscription allowance separately from cash charges. Retained provider evidence distinguishes `cost`, `billing_source`, `allowance` and `list_cost`; missing or inconsistent billing evidence blocks acceptance and further generation. [Billing field definitions](https://opencode.ai/v2/docs/console/api/inference/).

## Before real execution

1. Use a current, authorized Go credential through the process environment; never put it in a command argument, repository, report or saved campaign.
2. Confirm the account's **Extra Usage is off** for this execution. Go can otherwise debit a credit balance when an allowance runs out. The Go URL and an after-the-fact zero-cost response do not prove this setting.
3. Confirm the requested workload complies with Go's coding-agent usage terms. Identify the client truthfully; do not disguise fiction traffic as coding.
4. Use two invented, non-sensitive briefs and an output directory outside the repository. Preparation is local and makes zero calls. Explicit execution starts with one task; inspect its retained outcome before increasing the task limit.

Account quota and model availability must be checked on the actual account. Public plan limits are not its remaining allowance. No real run is claimed while these prerequisites remain unresolved.

## Quality review after a real run

Retain the actual briefs, plans, responses and chapter text privately. Publish only bounded, source-free aggregates. Assess each language separately:

- All six plans and three chapters compile, with complete preceding-body context.
- Each chapter obeys its outline, chronology, character knowledge and stated constraints.
- Setups and payoffs remain consistent; contradictions are listed with exact private references.
- Prose quality, scene progression and character voice receive an explicit human or separately identified reviewer judgment.
- Report completed, failed, unknown and not-run tasks; distinguish subscription allowance from cash cost.

A single accepted planning response is a connectivity/structure observation, not three-chapter quality acceptance. A successful bilingual three-chapter pilot still does not satisfy the two million-character novel target.

## Commands

First prepare and inspect the private previews (no API key or model call):

```sh
npm run pilot:go -- --state-dir /absolute/private/pilot-state \
  --confirm-extra-usage-off --confirm-transmission --max-usd 2.663064
```

After the prerequisites above are verified, supply the credential through an existing protected process environment and explicitly execute one Chinese task:

```sh
npm run pilot:go -- --state-dir /absolute/private/pilot-state \
  --execute --language zh --max-tasks 1 \
  --confirm-extra-usage-off --confirm-transmission --max-usd 2.663064
```

The credential variable is `OPENCODE_GO_API_KEY`; its value never belongs in these examples. Use the same state directory for continuation. Inspect retained outcomes before another invocation; `--language en` selects the paired English campaign. Each invocation defaults to one task; the lifetime ceiling remains nine per language. A stale execution lock requires inspection, not automatic deletion and replay. Model response text and normalized billing metadata are retained; this is not a claim to preserve complete HTTP response bytes.
