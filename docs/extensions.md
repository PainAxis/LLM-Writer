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
