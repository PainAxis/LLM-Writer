# Temporary browser testing

Push the test branch `test/writer-browser-tunnel` to run `Writer browser tunnel`. The workflow leaves the default branch unchanged and runs two independent jobs:

- `preview` builds the checked-out revision, exposes it through a Cloudflare Quick Tunnel, and uploads `writer-preview-url` **before** waiting. Its `preview-url.json` contains the URL, revision SHA, fake API address, and expiry time. The URL also appears in the job summary. The server expires after 40 minutes; cancelling the run also stops it. The job has a 45-minute limit.
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
