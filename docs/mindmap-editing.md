# Mind-map editing protocol

The normal map remains a derived overview. Editing switches to five fixed categories: chapters, characters, world settings, events and corpus. The root edits the novel title; entity nodes edit a chapter/title or character name. Entities can be added, removed and reordered inside their category. Deeper nesting, category changes, cross-category moves, duplicate identities, blank/overlong names, arrows and summary nodes are rejected. Limits are 500 characters per name and 10,000 total nodes.

`buildEditableMindMapData` binds existing nodes to their category and index in the editing snapshot. `applyMindMapEdits` validates the complete exported tree, then copies each retained source entity and changes only its title/name and modification time. Bodies, descriptions, IndexedDB references, tags and unknown extension fields survive. New nodes receive stable numeric identities and empty/default domain fields. Deleted chapters remove their bodies; the UI confirms all deletions and explicitly identifies chapter-body removal before committing.

Chapter reorder/delete adjusts numeric event chapter references. Deleting characters removes their id/name references; renamed characters update legacy name references. Unknown legacy links remain intact. Chapter counts and body totals are updated when chapter membership changes.

`useMindMapDraft` compares the latest cached novel with the editing snapshot before every save. Changes made elsewhere cause a conflict instead of an overwrite. It replaces only the selected novel in a freshly loaded collection, then awaits the standard `storageSet(novels)` commit, including IndexedDB shards and persistence retries. On failure the editable graph stays open, with stable new-node identities/timestamps for retry; its own pending snapshot is accepted during a retry, while unrelated changes are rejected. Existing global persistence retry behavior applies to an attempted save.

Editing is disabled during persistence. Switching novels or leaving the route requires discarding a dirty draft; browser unload is guarded while dirty or saving. Cancelling an edit before saving writes nothing. Rendering and dynamic library initialization reject stale selection/unmount work.

Validation: `npm run smoke:mindmap-editing` covers identity, structure, preserved data, repaired references, conflicts and asynchronous save/retry. Chromium regression covers graph editing, entity creation/removal, deletion confirmation, reload and draft cancellation through the visible UI.
