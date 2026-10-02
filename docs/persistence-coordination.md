# Persistence and cross-tab coordination

The shared storage layer reports a successful mutation only after its durable write succeeds. Prompt and genre forms, assistant management, API configuration and context settings keep their previous published state on failure. Forms retain the draft for retry. An assistant reply that finishes while storage is unavailable remains visible with a save-only retry action; that action does not issue another AI request. Unsaved content must be saved or copied before closing the page.

## Novels

Each page tracks the novel versions it actually loaded. A queued save records which projects changed, including edits followed by a revert and edits following a failed save. Before committing, persistence reads and hydrates the latest durable collection, then merges changes by project ID:

- Changes to different projects are preserved together, including projects created or deleted in another tab.
- If another tab changed the same project, the stale save fails and retains the local draft. Retrying does not force an overwrite.
- Full replacement during backup restore and clearing novels also check projects added by another tab. A failed replacement or clear does not publish the proposed collection into the page cache.
- Duplicate or invalid project IDs fail validation instead of silently collapsing records.

The conflict boundary is one complete project, including chapters and writing materials. To resolve a conflict, copy the local draft first, refresh the whole page, reopen the project and merge the changes. Navigating away and back alone does not reload the editing baseline. The page cache intentionally stays tied to that baseline; receiving a storage event must not silently authorize a stale editor to overwrite a newer project.

Large chapter bodies are staged as unique immutable IndexedDB blobs. The localStorage metadata swap is the commit point. A short synchronous commit gate compares the metadata with the version read before staging; if it changed, persistence rereads and merges again. Unreferenced blobs are cleaned up after commit. Readers retry hydration when another tab changes metadata while they are loading chapter bodies.

## Commit gate and goals

Browser commits use a readwrite transaction on the existing IndexedDB store as a same-origin gate. Its callback is synchronous and only checks/writes localStorage; asynchronous callbacks are rejected. If IndexedDB is entirely unavailable, the gate can use Web Locks. Failure to open an available IndexedDB database is reported rather than switching coordination mechanisms. Environments without either mechanism report a save error. Node regression tests use a process-local queue, while the browser suite exercises real multi-page IndexedDB coordination.

Goal mutations reread the committed goal list inside this gate before applying their update. Concurrent progress increments therefore accumulate and preserve separate history records. Page-level save queues publish updated state only on success.

This protocol coordinates novels and writing goals across pages running this version. Other collections still use their existing localStorage writes; they do not gain cross-tab conflict detection. Older open application versions must be refreshed to participate in the protocol.

## Backup and clear

Backups read the committed, fully hydrated novel collection without advancing the open editor's baseline. They include unrelated projects saved by other tabs. A pending or failed local novel save prevents backup/restore from silently omitting that draft; wait for saving to finish or retain the draft before resolving the failure. Backup creation also rejects if another local mutation starts during its read.

Clearing all data first awaits the novel backend's conflict-checked deletion. A novel conflict therefore leaves ordinary settings, prompts, goals and assistant data intact. Only then are ordinary keys removed under the commit gate. Multiple localStorage keys are not one browser transaction: unexpected storage errors during a later removal or backup rollback can still leave a partial operation, and are reported to the user.

## Regression coverage

`smoke:persistence`, `smoke:storage-coordination` and `smoke:storage-conflicts` cover staged blob failures, failed/retried writes, queue ordering, conflict detection, full replacement, clear and concurrent goal increments. `smoke:backup`, `smoke:config-persistence`, `smoke:prompt-catalog` and `smoke:assistant-policy` cover their respective persistence boundaries. Browser regression adds isolated first-entry template loading, two-page novel saves/conflicts and two-page goal progress updates.
