# Assistant context policies

Each assistant chooses **Follow global** or **Custom** in its create/edit dialog. The global policy remains in System Settings. Custom mode controls token/message budgets, truncation versus rolling summary, summary threshold and retained original messages. User and assistant messages each count as one entry; a zero budget means unlimited in that dimension. Local conversation history remains complete in both strategies.

`contextPolicyMode` is optional for compatibility. Missing mode follows global settings even if a legacy assistant has the previously unused `contextPolicy` field. Only explicit `custom` mode activates that field. Normalization creates independent values, tolerates partial legacy data and bounds invalid numeric values. Cancelling the dialog leaves the saved policy unchanged.

`resolveAssistantContextPolicy` is used by the displayed budget, outgoing conversation context, post-reply summary generation and manual summary retry. Summary requests use the assistant's model override and an abort signal. Changing the effective policy clears that assistant's old summary and pending marker, preserves all original messages, and invalidates in-flight summaries. Global changes affect only assistants following global settings. Clearing/deleting conversations also aborts work and rejects late chunks/completions; deletion persists removal of the conversation.

Context preparation prevents duplicate sends while awaiting a summary decision. A summary request that loses ownership cannot restore cleared state or a pending marker. Backup v2 includes and validates the mode and policy; backups without a mode remain compatible.

Validation: `smoke:assistant-policy` exercises the real store with injected storage/transports (request payloads, per-assistant isolation, reload, compaction/retry, policy changes and late work). Backup smoke and Chromium regression cover policy round-trips, editing cancellation, custom truncation, return to global settings, rolling-summary payloads and preservation of local history.

Conversation rendering is virtualized for long histories. Measured rows keep a stable reading position; incoming chunks follow the latest message only while the reader stays near the bottom. Home/End and the return-to-latest button navigate the history. The store retains every entry; virtualization does not change context budgets, summaries or backup data.
