# Temporary browser testing

Push the test branch `test/writer-browser-tunnel` to run `Writer browser tunnel`. The workflow leaves the default branch unchanged and runs two independent jobs:

- `preview` builds the checked-out revision, exposes it through a Cloudflare Quick Tunnel, and uploads `writer-preview-url-<hostname>` **before** waiting. Its `preview-url.json` contains the URL, revision SHA, fake API address, and expiry time. The hostname is also in the artifact name, and the full URL appears in the job summary. The server expires after 40 minutes; cancelling the run also stops it. The job has a 45-minute limit. A push whose commit message includes `[stop preview]` cancels the previous run and starts no preview.
- `browser` runs Chromium on the runner against the same production build and the local mock, then uploads `writer-browser-evidence` with the test report and screenshots.

The preview serves only files from `dist` and the three synthetic DOCX fixtures listed at `/__test/`. It has no upload endpoint, external API proxy, real API credentials, repository file server, or server-side novel storage. `/__test/health` identifies the revision and `/__test/metrics` reports aggregate mock request counts without storing prompts.

Configure a custom API in the app with the preview origin plus `/__test/v1`, key `preview-test-key`, and model `writer-mock` or `writer-mock-slow`. The slow model emits one chunk every 750 ms for about 36 seconds, allowing the stop button and chapter-switch cancellation to be checked. The three fixtures can be downloaded from `/__test/fixtures/`.

[Cloudflare documents that Quick Tunnels do not support SSE](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/#limitations). The tunnel is therefore used for page interactions; incremental streaming and abort behavior are independently checked by the runner's Chromium process against localhost. Do not count buffered Quick Tunnel responses as evidence that SSE transport works.

To run the same preview locally after building:

```sh
npm run build
node scripts/smoke-browser-preview.mjs
node scripts/browser-preview.mjs
```

Then, in another terminal with Chromium installed through Playwright:

```sh
npx playwright install chromium
node scripts/browser-regression.mjs
```

The default address is `http://127.0.0.1:4173`. `PREVIEW_PORT` changes the preview port; the browser script accepts `PREVIEW_URL` and `MOCK_API_URL` overrides. The temporary tunnel runs only on the GitHub-hosted runner.

## Verified run

Revision `2af761f1f65954059228f30588934678861ef447` passed all seven real Chromium scenarios with zero uncaught page errors in the [browser job](https://github.com/PainAxis/LLM-Writer/actions/runs/34103975835/job/101684696577): API setup, editor persistence after reload, stream cancellation, chapter-switch cancellation, DOCX import and invalid-file recovery, backup restoration, and large-content IndexedDB round trips. The [evidence artifact](https://github.com/PainAxis/LLM-Writer/actions/runs/34103975835/artifacts/10011672396) contains the report, trace, screenshots, and synthetic backups and is retained for seven days.

Manual interaction through the preceding Cloudflare preview at revision `0518b00f0fcabfb82a0219beafd3a56d7b9acb10` verified novel/chapter creation, rich-text editing and recovery after reload, and DOCX parsing with literal script-like text. A final cloud-browser health-page recheck encountered `ERR_BLOCKED_BY_CLIENT`; the final revision's complete browser regression was verified on the GitHub runner as described above.

The browser run exposed uncaught cancellation rejections in the AI SDK's unused browser telemetry path. Both generation paths now explicitly disable telemetry, and the request-scope regression also exercises the SDK's browser runtime branch. No page errors are filtered or ignored by the browser regression.

The follow-up documentation commit uses `[stop preview]` to cancel the temporary preview through workflow concurrency while preserving the successful browser job and its evidence. All work is on `test/writer-browser-tunnel`; the default branch is unchanged.
