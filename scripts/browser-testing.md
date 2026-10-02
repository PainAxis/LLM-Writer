# Browser testing

## Continuous integration

The `CI` workflow runs on pull requests targeting `main`, pushes to `main`, and manual dispatch. Its check names are `ci-quality` and `ci-browser`.

- `ci-quality` installs locked dependencies, rejects lint warnings, builds the app (including type checking), and runs all 63 suites in `npm run smoke:all` sequentially.
- `ci-browser` builds the same revision and runs 35 baseline Chromium scenarios and 9 extension scenarios against a local preview and synthetic API. It uploads `artifacts/browser` and `artifacts/browser-extensions` as `browser-evidence-<attempt>` for seven days, including failure screenshots and a Playwright trace when browser execution starts.

Both jobs use Node 24 and read-only repository permissions. Browser regression never needs real API credentials or a public tunnel. The current CI results are the validation record for each commit.

Run locally from the repository root:

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
npm run test:browser
```

`test:browser` verifies the preview boundary, starts its own server on an available localhost port, runs the browser scenarios, and closes the server on completion or failure. `BROWSER_ARTIFACT_DIR` can override the output directory. The default `artifacts/` directory is ignored by Git.

The scenarios cover API setup, editor persistence after reload, streaming cancellation, chapter-switch cancellation, DOCX import and invalid-file recovery, backup restoration and large-content IndexedDB round trips. Feature coverage includes ShortStory template selection/cancellation/restart/clearing/dialog closure/route unmount and text export; novel metadata validation and persistence (status, tags and cover removal), novel-detail chapter navigation; tool generation/download; book/novel/tool cancellation; mind-map editing, deletion confirmation, reload persistence and draft cancellation; assistant custom/global/summary request payloads, complete local histories and policy backup restoration. Writing-goal regression creates and updates through both entry points, checks notes/history and local activity streaks, then reloads through the UI.

Scenarios 22–24 exercise the reliability boundaries:

- **22 — First-visit templates:** independent clean browser contexts open BookAnalysis or Tools before Writer or the prompt library, select default templates and confirm the initialized catalog contains both book-analysis and outline categories.
- **23 — Novel commits across tabs:** two tabs save different novels without losing either edit; a stale tab then edits the same novel, receives a conflict error, retains its draft and cannot overwrite the newer saved text through an unresolved retry.
- **24 — Goal increments across tabs:** two tabs submit increments of 100 and 50 with separate notes; the committed goal reaches 150 with two distinct history entries, and both pages show the same result after reload.

Scenarios 25–28 cover the first batch of existing-feature repairs:

- **25 — Exact short-story selection:** select the second repeated passage with the keyboard, optimize it through the mock API and replace only that editor range.
- **26 — Chapter/event links:** move and delete chapters in chapter management, then delete in Writer; verify event labels and persisted links after reload.
- **27 — Reference reports:** save a book-analysis report, reload without the source book, reopen it, clear/rewrite and update the same record, then delete and reload.
- **28 — API drafts:** test successful and failed unsaved configurations without replacing committed settings; close the dashboard configuration dialog during pending requests and reject late results.

Scenarios 29–33 cover the second batch of existing-feature repairs:

- **29 — Book selection boundaries:** detect whole-line headings, require a selected chapter and inspect the synthetic request to ensure only the chosen chapter is analyzed; clearing the selection disables analysis again.
- **30 — Outline and polishing results:** retain an invalid raw outline reply without creating chapters, then retry a complete requested-count response while autosave runs; verify polishing uses the latest editor text and resolves its passage placeholder.
- **31 — Management totals and units:** import stale chapter counts, preview decoded text with paragraph boundaries, delete a chapter and verify both saved totals after reload; add two chapters of goal progress without increasing today's word count and verify both goal entry points.
- **32 — Tool inputs and templates:** choose a specific novel and rich-text reference chapter, inspect synopsis/character requests for the selected source and form parameters, exclude incompatible templates and preserve literal dollar/placeholder-like user text.
- **33 — Usage records and charts:** restore synthetic usage records, verify normalized request-type and exact model filters, include the selected end date's late-night records, check 7/30/90-day chart totals and distributions, then restore an empty ledger and verify honest empty states.

Four added smoke suites complement these flows: `smoke:writer-content` checks safe rich-text conversion/rendering and editor update ownership; `smoke:management-correctness` checks actual exports, legacy totals and safe previews; `smoke:billing-correctness` checks usage evidence, exact filters and local-calendar trends; `smoke:tools-workspace` exercises the real generation handlers and template/source contracts. Expanded existing suites cover empty-corpus round trips with failed-save retry, goal unit edits with historical units, strict outline parsing and autosave, and explicit book-analysis ranges.

The first-batch module suites exercise rich-text and multi-paragraph ranges, report storage failures/retries, draft probes, proxy/header snapshots, endpoint-scoped model caches and request timeouts. Backup regressions include reference-library round trips, strict report validation and preserving reports when restoring older backups.

The module suites additionally inject storage failures for prompt creation/editing/deletion/import, API/configuration, genre and assistant management. They verify draft retention, success only after commit and retry. Summary tests verify covered-message cursors, pending/failed compaction and backup compatibility. `smoke:storage-coordination` and `smoke:storage-conflicts` exercise commit ordering and conflict handling. Uncaught page errors fail browser regression.

Cross-tab coordination protects novels and writing goals, rather than every storage key. A conflict on one novel requires copying the retained draft, refreshing/reopening that novel and merging manually; repeatedly clicking retry does not resolve it. See [persistence coordination](../docs/persistence-coordination.md).

The main ruleset requires the exact check names `ci-quality` and `ci-browser` for pull requests to `main`, with the branch up to date before merging. The existing pull-request, deletion and force-push protections remain active. These rules are repository settings, separate from the workflow file.

## Optional temporary preview

The separate `Writer browser tunnel` workflow remains available for manual interaction. Push `test/writer-browser-tunnel` or dispatch that workflow to start it. Its `preview` job exposes the built app through a Cloudflare Quick Tunnel and publishes the URL in the job summary and a `writer-preview-url-<hostname>` artifact. The preview expires after 40 minutes; cancelling the run also stops it. A commit containing `[stop preview]` cancels the previous run without starting another preview.

The preview serves only `dist` assets and the three synthetic DOCX fixtures under `/__test/fixtures/`. It does not expose repository files, accept uploads, proxy external APIs, or store novel content on the server. `/__test/health` identifies the revision; `/__test/metrics` reports aggregate mock request counts without storing prompts.

Configure a custom API with the preview origin plus `/__test/v1`, key `preview-test-key`, and model `writer-mock` or `writer-mock-slow`. The slow model allows cancellation to be exercised. These values are synthetic test configuration.

[Cloudflare Quick Tunnels do not support SSE](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/#limitations). Use the public preview for page interactions; the local Chromium job verifies incremental streaming and cancellation.

The extension workflow (`npm run test:browser-extensions`) uses actual local HTTP MCP and OpenAI-compatible fixtures. It covers server create/edit/discovery, explicit tool authorization, resource/prompt previews, Skill imports, project access, tool traces, stopping a pending MCP request, reload and session-token exclusion.
