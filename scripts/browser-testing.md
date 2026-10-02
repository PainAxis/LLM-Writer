# Browser testing

## Continuous integration

The `CI` workflow runs on pull requests targeting `main`, pushes to `main`, and manual dispatch. Its check names are `ci-quality` and `ci-browser`.

- `ci-quality` installs locked dependencies, rejects lint warnings, builds the app (including type checking), and runs `npm run smoke:all` sequentially.
- `ci-browser` builds the same revision and runs Chromium against a local preview and synthetic API. It uploads `artifacts/browser` as `browser-evidence-<attempt>` for seven days, including failure screenshots and a Playwright trace when browser execution starts.

Both jobs use Node 24 and read-only repository permissions. Browser regression never needs real API credentials or a public tunnel. The current CI results are the validation record for each commit.

Run locally from the repository root:

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
npm run test:browser
```

`test:browser` verifies the preview boundary, starts its own server on an available localhost port, runs the browser scenarios, and closes the server on completion or failure. `BROWSER_ARTIFACT_DIR` can override the output directory. The default `artifacts/` directory is ignored by Git.

The scenarios cover API setup, editor persistence after reload, streaming cancellation, chapter-switch cancellation, DOCX import and invalid-file recovery, backup restoration, large-content IndexedDB round trips, ShortStory template selection/cancellation/restart/clearing/dialog closure/route unmount, novel metadata validation and persistence (status, tags and cover removal), novel-detail chapter navigation, ShortStory text export, tool generation with result download, and book/novel/tool cancellation on source changes, dialog closure and unmount, plus mind-map editing, deletion confirmation, reload persistence and draft cancellation; assistant custom/global/summary request payloads, complete local histories and policy backup restoration. Writing-goal regression creates and updates through both entry points, checks notes/history and local activity streaks, then reloads through the UI. Uncaught page errors fail the run.

The main ruleset requires the exact check names `ci-quality` and `ci-browser` for pull requests to `main`, with the branch up to date before merging. The existing pull-request, deletion and force-push protections remain active. These rules are repository settings, separate from the workflow file.

## Optional temporary preview

The separate `Writer browser tunnel` workflow remains available for manual interaction. Push `test/writer-browser-tunnel` or dispatch that workflow to start it. Its `preview` job exposes the built app through a Cloudflare Quick Tunnel and publishes the URL in the job summary and a `writer-preview-url-<hostname>` artifact. The preview expires after 40 minutes; cancelling the run also stops it. A commit containing `[stop preview]` cancels the previous run without starting another preview.

The preview serves only `dist` assets and the three synthetic DOCX fixtures under `/__test/fixtures/`. It does not expose repository files, accept uploads, proxy external APIs, or store novel content on the server. `/__test/health` identifies the revision; `/__test/metrics` reports aggregate mock request counts without storing prompts.

Configure a custom API with the preview origin plus `/__test/v1`, key `preview-test-key`, and model `writer-mock` or `writer-mock-slow`. The slow model allows cancellation to be exercised. These values are synthetic test configuration.

[Cloudflare Quick Tunnels do not support SSE](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/#limitations). Use the public preview for page interactions; the local Chromium job verifies incremental streaming and cancellation.
