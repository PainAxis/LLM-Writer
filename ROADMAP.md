# LLM-Writer Roadmap

[English](ROADMAP.md) | [简体中文](ROADMAP.zh-CN.md)

The following items remain planned; their order is a suggested priority, not a release commitment. See [Project Structure](PROJECT_STRUCTURE.md) for the current implementation layout.

1. **Unify remaining streaming request lifecycles.** Migrate remaining generation entry points to `useAIStream` and isolated request scopes. Prioritize cancellation, restart and unmount behavior in `ShortStory.vue` so stale callbacks cannot update a newer operation.
2. **Add editable mind maps.** Define how edits are validated and written back to the novel store before enabling editing in the current read-only view.
3. **Support per-assistant context policies.** Connect the reserved `AssistantInfo.contextPolicy` field to configuration and runtime policy selection; assistants currently use the global policy.
4. **Continue TypeScript migration in views.** Migrate pages incrementally to `lang="ts"`, then restore the `vue/block-lang` rule once migration is complete.
5. **Eliminate remaining lint warnings.** Clean up unused variables and keep the existing lint rules effective.

Further candidates:

- Virtualize long assistant message lists.
- Consolidate the legacy store corpus and Writer's `corpusData`.
- Adjust the mind-map canvas background for dark mode.
