# Generation budgets

Open **Settings → API配置** to configure output and thinking. These saved settings apply to the shared AI service, including streamed and non-streamed writing, tools, analysis and assistant requests.

## Output

- **输出预算** sets the output-token ceiling. New configurations start at 16,384 tokens; existing saved limits are preserved.
- **服务商默认** omits the application's explicit ceiling. The provider or native SDK still applies its own defaults and model limits; this is not unlimited generation. Toggling this option preserves the previous numeric value.
- For most reasoning models, the output ceiling includes thinking and visible text. A small ceiling can be exhausted before any prose appears. DashScope's `max_tokens` instead limits the answer separately from its thinking allowance.
- A numeric per-request `maxTokens` overrides the global setting. An omitted or legacy `null` override inherits it. The application rejects invalid integers before sending a request.

## Thinking

**服务商默认** sends no reasoning override. The other choices depend on the model and API protocol. A token budget is not a universal hard limit: some models treat it as a target. Effort levels are not token counts.

| API/model family | Available controls | Request mapping |
| --- | --- | --- |
| Supported OpenAI GPT-5 / o-series / GPT-OSS | Model-specific effort; off only where supported | `reasoning_effort` |
| DeepSeek | On/off; V4 effort | `thinking.type`, `reasoning_effort` |
| GLM | On/off on older models; GLM 5.3 effort only | `thinking.type`, `reasoning_effort` |
| MiMo | On/off | `thinking.type` |
| Qwen through DashScope | On/off or token budget on supported thinking models | `enable_thinking`, `thinking_budget` |
| Native Claude manual-thinking models | Token budget; off | `thinking.budget_tokens`, minimum 1,024 |
| Native Claude 4.6+ | Adaptive thinking, effort, off; manual budget also available on 4.6 | `thinking.type`, `output_config.effort` |
| Native Gemini 2.5 | Dynamic or numeric budget; off except Pro | `generationConfig.thinkingConfig.thinkingBudget` |
| Native Gemini 3 | Model-specific effort | `generationConfig.thinkingConfig.thinkingLevel` |

Claude/Gemini numeric thinking budgets must leave space inside the total output ceiling for visible text. The native Claude SDK adds its thinking allowance to `maxOutputTokens`; the application compensates before calling it so an explicit total is not increased. Known native Claude adapter limits also constrain the thinking budget. Provider model limits can still reduce or reject an output setting.

Compatible APIs are not interchangeable in their reasoning extensions. Automatic detection uses known model families; DashScope budget detection additionally checks the provider/endpoint. Unknown aliases stay on provider defaults. Use **思考协议** only after confirming the gateway's accepted fields. Selecting a format does not change the API endpoint or make an unsupported model callable. Changing provider, model or format resets the thinking mode to default. OpenAI Pro models may require a Responses-compatible gateway; this application uses Chat Completions for OpenAI-compatible providers.

Modern OpenAI reasoning models and MiMo use `max_completion_tokens`; other compatible models retain `max_tokens`. Sampling temperature is omitted where the selected reasoning mode rejects or ignores it. The request's effective model, including assistant model overrides, determines validation and serialization. An incompatible override fails before network access instead of silently dropping the saved thinking setting.

## Persistence and verification

Saving validates the draft before replacing active settings. Connection tests and model discovery remain read-only checks of endpoint/authentication and do not prove budget compatibility. Existing settings without thinking fields retain provider-default thinking; backups preserve the new fields and reject malformed values before restoring data.

`smoke:generation-budget` exercises the installed SDKs against a guarded localhost server: compatible stream/non-stream mappings, native Claude/Gemini payloads, model overrides, total/default semantics, invalid settings before fetch, fresh-process reload, and backup round trips/rejection. Browser scenario 34 saves and reloads the visible settings and checks a subsequent Tools request. These controlled tests establish application behavior, not every live gateway's parameter support.

## Maintenance references

Capability rules were checked on 2026-10-02 against the pinned SDK implementation and these primary references. Recheck model-specific rules when updating models or SDKs.

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [GPT-5 Pro](https://developers.openai.com/api/docs/models/gpt-5-pro), [GPT-5.2 Pro](https://developers.openai.com/api/docs/models/gpt-5.2-pro)
- [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/) and [Chat API](https://api-docs.deepseek.com/api/create-chat-completion/)
- [GLM 5.3](https://docs.z.ai/guides/llm/glm-5.3)
- [MiMo OpenAI-compatible API](https://mimo.mi.com/docs/en-US/api/chat/openai-api)
- [DashScope thinking](https://www.alibabacloud.com/help/en/model-studio/deep-thinking) and [Chat API token semantics](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions)
- [Claude extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Groq reasoning differences for hosted Qwen](https://console.groq.com/docs/reasoning)
