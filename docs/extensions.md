# Writing extensions: MCP and Agent Skills

This first-stage feature is available in **AI Assistants**. Ordinary Writer generation continues to use its existing workflow. Extensions are disabled by default.

## Use the feature

1. Configure a model that supports tool calls in API settings. A successful plain-text connection test does not establish tool support.
2. Open **Settings → Writing extensions** (`#/settings?tab=extensions`). Add a remote MCP endpoint, optionally enter a session token, and check the connection. Select the individual tools you want to authorize, save the selection, and enable the server.
3. In an assistant conversation, enable writing extensions. Select a novel and its permitted read-only tools, select writing Skills, and send the request. Replies include a collapsible tool execution record.

MCP requests go from the browser to the endpoint, which must allow the application's origin through CORS. HTTPS is required except for loopback development endpoints. Tokens stay in memory and must be entered again after a page reload. Changing a server URL clears its token, discovery cache and tool authorization. Tokens are excluded from configuration backups and assistant tool records.

## Supported capabilities

| Capability | First-stage support |
| --- | --- |
| Remote MCP | Streamable HTTP through `@ai-sdk/mcp`; modern `2026-07-28` and legacy `2025-11-25` have real HTTP regressions |
| MCP tools | Explicit per-server allowlists, namespaced model tool names, bounded discovery and results |
| MCP resources and prompts | Manual discovery and preview in settings; not automatically injected into conversations |
| Agent Skills | Four built-in writing workflows; import a `SKILL.md` file or a folder with text references |
| Progressive Skill loading | Only selected Skill instructions enter context; their references are read on demand through a tool |
| Local MCP / script Skills | Require a future companion runtime; the browser does not launch processes or execute Skill scripts |
| OAuth / Skills over MCP / MCP Apps | Not implemented in this stage; neither full optional-extension coverage nor arbitrary-server compatibility is claimed |

Built-in Skills cover chapter outlines, character development, continuity/foreshadowing review and prose revision. Imported packages follow the [Agent Skills file format](https://agentskills.io/specification): YAML `name` and `description`, Markdown instructions and optional supporting files. Unknown metadata is retained; metadata such as experimental `allowed-tools` does not override the application's explicit tool authorization.

Use **Import folder** to preserve `references/` paths. Importing only `SKILL.md` does not fetch linked files or URLs. Imports are limited to 64 text files, 256 KiB per file and 1 MiB per package; binary assets are not supported. Script text may be retained for portability but cannot be read by the reference tool or executed. Duplicate names, unsafe paths, malformed YAML and oversized instructions are rejected. Full selected instructions must fit the Skill budget; they are never silently shortened.

## Project tools

All six tools read a request-local snapshot of the selected novel. None writes the author's text or reaches another project.

| Tool | Operation |
| --- | --- |
| `writing_get_project` | Project metadata and material counts |
| `writing_list_chapters` | Paginated chapter IDs, titles and outlines |
| `writing_read_chapter` | Bounded chapter text or outline with source offsets |
| `writing_search` | Lexical evidence search across chapters and materials |
| `writing_list_materials` | Paginated characters, world settings, events and corpus |
| `writing_read_material` | Bounded material text with identity and offsets |

Reads are capped at 8,000 characters, lists at 20 items and searches at 10 excerpts. Search is lexical; this stage does not add embeddings, reranking, long-term memory or a fact graph.

## Execution and persistence

Each send owns its MCP connections and captured authorization. Setup, generation, tool execution and cleanup observe cancellation and timeouts. At most 64 tools, 48 tool executions and 1–12 configured model steps are permitted in one request. Reaching the step limit without a final answer is reported as incomplete. Tool schemas are reserved before fitting assistant history; later tool results are checked against the same estimated input budget.

Thinking and output settings still apply to each model call. Usage from every completed provider response is recorded even if a subsequent tool waits, fails or is cancelled. This is a bounded tool-assisted conversation, not an unattended Agent or a guarantee of creative quality.

Selected remote tools may have external side effects. Server annotations are descriptive hints, not enforced permissions. Tools in one model turn may execute concurrently. Model/network failures are not automatically retried for extension runs; manually retrying may repeat an external action that already completed. Failed or cancelled tool records remain visible and are excluded from future conversation context. Records contain names and statuses, without tool arguments or results.

Settings, imported Skills and tool records participate in full/selective backups. Stored settings are strictly validated; corrupted data is preserved until explicit reset or restoration. Restore reloads the application to initialize all stores from the restored data.

## Validation

`npm run smoke:all` includes MCP, Skill import, project tools, extension settings and actual HTTP OpenAI-compatible/Anthropic generation loops. `npm run test:browser-extensions` exercises the built application in Chromium with synthetic endpoints; it is part of required browser CI. No real API key is used by these commands.

For an opt-in live check, set `LLM_WRITER_TEST_API_KEY`, optionally `LLM_WRITER_TEST_BASE_URL`, `LLM_WRITER_TEST_OPENAI_MODEL` or `LLM_WRITER_TEST_ANTHROPIC_MODEL`, and run `npm run test:extensions-live`. The default gateway is OpenCode Go and the defaults are `mimo-v2.6-flash` for OpenAI-compatible calls and `qwen3.8-flash` for Anthropic calls. It tests both API formats against synthetic project, Skill and MCP evidence and may incur API usage. Live output contains only validation status, timing, tool counts and usage.

For real Jina research, supply `JINA_API_KEY` and `LLM_WRITER_TEST_API_KEY` through your environment and run `npm run test:jina-live`. This separate, billable harness uses the same model/base-URL overrides and tests both API formats by default; set `LLM_WRITER_TEST_PROVIDER=custom` or `anthropic` to select one. It reads a disposable novel and selected Skill, searches NPS historical lighthouse sources through Jina, reads the source pages, and checks a cited correction against the retrieved evidence and original plot. It does not edit author content or save credentials, tool bodies, or generated prose.

Each provider is limited to six model turns (five possible tool calls plus a final answer), 2,048 output tokens per turn, one search query with at most five results, two read URLs, and 90 seconds. The default Jina endpoint is `https://mcp.jina.ai/v1?include_tools=search_web,read_url&max_tokens=3500`; `JINA_MCP_URL` can override its path/query on the official host. The application still enforces its normal MCP connection/request timeouts and context limits. The JSON report includes pass/fail checks, public source paths, call counts, latency and reported **LLM** usage; it does not estimate Jina charges or establish browser CORS support.

Writing reports distinguish `integrationPassed` (selected chapter/Skill evidence, real search/read provenance, error-free tools, fresh reported usage and call limits), `generationCompleted`, and `businessPassed` (grounded historical correction and the requested scene). Overall `passed` requires all three. A truncated answer can therefore demonstrate working tool integration while still failing the business task. Historical diagnostics contain only a numeric year and fact/support flags. Grounding examines every occurrence of the cited year, requiring nearby Fresnel/lens and relevant invention or first-use language; `npm run smoke:jina-writing-evidence` checks the duplicate-year regression without network access.

Live trial record (2026-10-03): at the earlier 1,536-token limit, MiMo completed the real tool chain in four turns (14.947 s) but failed strict scene checks: its passage had 79 characters, below the 80-character assertion, and omitted the required transfer phrase. The named characters, silver key, three-day reunion, and oil lamp were present. Its historical check also exposed a harness bug: the cited NPS Ocracoke page mentions tower construction in the first occurrence of 1822 and lens design in a later occurrence; checking only the first incorrectly rejected supporting evidence. The all-occurrences regression fixes that assertion without dropping source grounding. Qwen completed the tool chain in four turns (36.594 s) but exhausted the output budget. Both cancellation trials passed, preserving reported usage. These failed business trials remain part of the record; the budget increase and diagnostic improvements do not retroactively mark them successful.

Optional `JINA_TEST_MODE` values are `preflight` (configuration check, no network), `discovery` (Jina metadata only), `auth-error` (one search with a deliberately invalid token; no model call), and `cancel` (cancel after dispatching a real Jina tool call, checking that reported model usage survives). `writing` is the default. Discovery/auth-error require only `JINA_API_KEY`; writing/cancel also require the model key. Missing keys fail before network access. Cancellation can still consume provider/Jina credits. Do not enable HTTP debug logging or capture raw request/response traces when running with real keys.

`node scripts/browser-jina-discovery.mjs` and the standalone Jina browser compatibility workflow check public MCP discovery from Chromium with a synthetic bearer token. They do not execute paid tools or call a model; the full model-backed business test remains the separate CLI harness above. For official Jina `/v1` and `/sse` endpoints, the application recognizes the observed `search_web` authentication-failure envelope even when Jina incorrectly returns `isError: false`, and presents a sanitized tool error. This compatibility handling is limited to that exact envelope and submitted query; arbitrary source prose is not interpreted as a tool error.

For an external Skill trial, set `LLM_WRITER_TEST_API_KEY` and run `npm run test:humanizer-live`. The harness imports the byte-exact, MIT-licensed [Humanizer-zh](https://github.com/op7418/Humanizer-zh) fixture pinned to `f4518a8eab97b8bfebc66a89d34320a89bef6930` through the application's file importer, saves/selects it in isolated memory, and checks its full instructions in the actual outgoing system context. Upstream `allowed-tools` metadata never grants Write, Edit or other external tools. The full Humanizer instructions exceed the assistant's default 8k context budget in this scenario; choose a larger custom context budget (the browser regression uses 32k). This is the assistant context setting, separate from the model output-token limit. A full page reload selects the first saved assistant, so reselect the intended writing assistant before continuing.

This billable A/B trial uses the same three authored Chinese passages (technical release prose, fiction, and an already clear sentence), first without the Skill selected and then with it. Defaults are MiMo Flash/OpenAI-compatible and Qwen Flash/Anthropic: four model calls total, one turn and 3,072 output tokens per call, with a 90-second timeout and no retries. `LLM_WRITER_TEST_PROVIDER=custom` or `anthropic` selects one pair; the existing model/base-URL overrides also apply. The report prints only synthetic source/output prose, deterministic fact/negation/uncertainty checks, instruction/permission evidence and fresh reported usage. Phrase counts are review aids, not AI-detection scores or proof of better writing. Failed trials remain failures; manual semantic review is still required. Credentials, headers and provider error payloads are never printed or persisted.

Humanizer trial record (2026-10-03): all four application-service calls completed, carried the full upstream instructions only when selected, made no tool calls, recorded fresh provider-reported usage, and passed the deterministic checks. Manual review confirmed the date/version, timing units and 120-request sample, three released features, planned-only memory feature, uncertain cache explanation, key handoff and retention, reunion, negations and speaker uncertainty. The clear sentence was unchanged.

| API format / model | Skill selected | Time | Reported input / output tokens |
| --- | --- | --- | --- |
| OpenAI-compatible / MiMo Flash | No | 4.131 s | 433 / 183 |
| OpenAI-compatible / MiMo Flash | Yes | 4.094 s | 6,022 / 183 |
| Anthropic / Qwen Flash | No | 19.353 s | 440 / 1,331 |
| Anthropic / Qwen Flash | Yes | 17.987 s | 5,607 / 1,084 |

All four edited outputs were identical. Both baseline and Skill-enabled runs removed the counted stock phrases while preserving the checked meaning. The baseline prompt already asked explicitly for natural prose and factual preservation, so this small trial establishes compatibility, not incremental editing quality or a latency advantage. Selecting the full Skill increased input usage by 5,589 tokens for MiMo and 5,167 for Qwen in this trial; use it for tasks that need its detailed workflow. No repeated paid trials were used to select these results.

To test a more distinctive literary voice, run the same harness with `LLM_WRITER_TEST_SKILL=luxun npm run test:humanizer-live`. It imports only the original MIT-licensed [Lu Xun perspective Skill](https://github.com/nuwa-skills/luxun-skill), pinned to `0594ab7ffafecc93644fe4fbfcec68242b9948be`. The two synthetic scenes cover circular administrative procedures and passive bystanders. Both arms use the same neutral rewriting prompt, model settings and factual constraints; the author's name and satire instructions appear only through the selected Skill. Optional upstream research/examples are not loaded, and no tools are exposed.

This profile reports integration success separately from lexical fact markers and output differences. Its `passed` field covers integration only; stylistic change and complete factual preservation require reviewing the actual prose. Length counts are descriptive, and changed wording alone is not evidence of a successful style transfer. Both providers still have one baseline and one enabled call, with the same token/time limits and no retries.

The [2026-10-03 Lu Xun trial record](validation/luxun-style-2026-10-03.md) retains all four initial attempts and one diagnostic replay. It is not an all-pass business result: the retained MiMo comparison has local stylistic changes but also factual deviations and invalid JSON; Qwen did not finish at the configured output cap. Failed visible output is now retained up to 16,000 characters for safe review, and `LLM_WRITER_TEST_ARM=baseline` or `enabled` can select a single diagnostic arm without automatically retrying. Neither this selector nor manual reading converts malformed JSON into a pass.
