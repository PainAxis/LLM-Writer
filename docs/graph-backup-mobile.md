# Graph backups and mobile navigation

[English](graph-backup-mobile.md) | [简体中文](graph-backup-mobile.zh-CN.md)

This stage-three follow-up covers actual-novel fact-graph backups and usable narrow-screen navigation. It does not connect retrieval evidence to Writer generation prompts or introduce the stage-four Agent.

## Backup and restore

In **Settings → Data management**, choose **Export all data** or **Novel data**. Both include committed novel content and its complete saved fact graphs. Import that JSON through **Choose backup file**, with the novels category selected, then confirm and reload.

The version-2 envelope has an optional `data.factGraphs` sidecar paired with `data.novels`. Relationships retain IDs, entity types/names, predicates, explicit/inferred origin, author/model creator, author confirmation, and every chapter ID, SHA-256 source revision, UTF-16 range and exact quote. Stale and undisclosed relationships are included in the backup, not just the currently visible canvas. Backup files therefore contain the full manuscript and later plot information; the selected disclosure cutoff is a viewing constraint, not export redaction.

Restoration never relocates quotes or assigns current chapter revisions to old anchors. The graph's storage revision is refreshed so an editor opened before restoration cannot silently overwrite it. If the restored chapter title/body differs from an anchor's source, that relationship remains excluded, even when author-confirmed. Restoring the exact original title/body can make the content-hash anchor valid again. All evidence must be disclosed before a multi-premise relation becomes visible.

| Import content | Behavior |
| --- | --- |
| Novels and graph sidecar | Restore the supplied graph state for imported novel IDs, including an explicitly empty graph |
| Legacy backup without graph sidecar | Restore selected categories, preserving existing graph records; current-source filtering still applies |
| Other categories only | Do not modify graphs |
| Invalid/cross-project graph | Reject before writing any selected data |

Graph documents use the same size and relation limits as normal graph storage. Unknown project IDs and duplicate identities are rejected. Export fails rather than silently omitting a corrupt stored graph. Graph replacements use one IndexedDB compare-and-swap transaction; handled failures attempt rollback, and concurrent graph changes must not be overwritten. The importing page reloads after completion; refresh other open tabs before continuing work.

Only actual novels present in the exported collection are covered. The private Memory Lab demo and orphan graph records for removed novels are excluded. Plain TXT/manuscript exports do not include annotations. Older application versions that do not recognize `factGraphs` reject these new backups; use the updated application to restore them.

Restoring novels and graphs spans the application's existing storage systems. It is not a crash-proof transaction across localStorage and IndexedDB: interruption, browser termination or a rollback failure can require another import from the retained file. Back up before replacing data. No automatic stale-record cleanup, historic chapter browser or cross-device synchronization is introduced.

## Narrow-screen operation

At widths up to 768 CSS pixels, navigation starts closed and opens from **Open navigation** in the header. Its modal drawer has an explicit close button, backdrop dismissal, Escape support and keyboard focus containment. Selecting a destination closes it. The page behind the open drawer is inert. Desktop navigation retains its existing expanded/collapsed behavior.

The Memory Lab, relationship form, source evidence and Settings backup controls wrap within narrow viewports. Evidence revisions and long quotes remain readable without pushing the page sideways. The equivalent relation list remains available alongside the Cytoscape canvas.

## Reproduce acceptance

```bash
npm run smoke:backup
npm run smoke:graph-backup
npm run smoke:memory-fact-store
npm run smoke:memory-fact-graph
npm run build
npm run test:browser-graph-backup
npm run test:browser-mobile
```

The dedicated CI job runs the built application in Chromium and uploads reports, screenshots and failure traces. Backup tests use the real Settings download/upload flow; mobile tests exercise actual controls and graph interaction. Synthetic fixtures and blocked external requests keep the tests local; no paid model calls are required.

The graph-backup core suite round-trips 600 chapters, 1,411,959 source characters and 5,400 relations (3,700,899 serialized backup characters). Nine backup browser scenarios use three isolated contexts; sixteen mobile scenarios run at 390×844 and 320×640. These are correctness and interaction checks, not performance benchmarks.

Use the current PR's CI for results. Chromium viewport/touch emulation does not certify Safari, Firefox, physical phones, on-screen keyboards or every unrelated page in the application. Existing graph model-quality and retrieval capacity limitations still apply; see [the graph contract](memory-fact-graph.md) and [long-novel testing](memory-stress-tests.md).
