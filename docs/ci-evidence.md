# Bounded CI evidence archives

Tests still create and assert against their complete local inputs and raw reports. A separate `scripts/prepare-ci-evidence.mjs` step prepares each of the 13 evidence groups; it does not alter a test result, source report, fixture, assertion or denominator.

Only the exact files in `scripts/ci-evidence-files.mjs` are eligible. All test-report JSON attachments are newly generated `*.summary.json` documents, explicitly labelled as derived summaries with the original path, byte count and SHA256. They are **not raw reports**. Request collections in the whole-novel scan, support, Writer-memory, fact-graph and graph-backup reports retain bounded scalar metadata, sizes, counts and hashes, not request/response bodies. This prevents a collection of individually bounded requests from reconstructing a whole manuscript. Necessary bounded synthetic assertion excerpts elsewhere remain evidence, not a full-backup attachment. Free-text failure, console and DOM diagnostics are replaced with size/hash metadata, because even a short assertion diff might contain a complete small backup.

Both the main CI and the optional browser-tunnel workflow use this preparation boundary. The tunnel’s separate exact `preview-url.json` attachment contains only preview URL metadata, not a report or backup. Release assets remain the built application ZIP, checksum and build metadata, not test directories.

Only named UI screenshots are copied. Full backup/round-trip/corpus exports, downloaded text files, exported mind-map images and trace ZIPs are excluded. Preparation writes into a fresh isolated directory, rejects symlinks and invalid JSON, and records missing inputs instead of inventing passing results. An upload requires successful preparation and a non-cancelled job. A failing test remains a failing job even when its diagnostic summary uploads successfully.

Full raw reports and backup exports stay local to the execution environment. A GitHub runner's local files are temporary, **not a durable backup**. The previously retained full synthetic backup remains in the existing engineering workspace's persistent local directory. This archive change neither uploads that backup nor deletes existing remote artifacts.

## Historical boundary

The initial PR #42 run [39975345262](https://github.com/PainAxis/LLM-Writer/actions/runs/39975345262) used inherited directory uploads. Some full exports, traces and raw request collections were uploaded before/during cancellation; cancellation did not undo those uploads. Its artifacts are historical and have not been deleted. The temporary containment head disabled all 13 upload steps. The replacement archive policy applies to subsequent runs of the corrected workflow; it is not a claim that earlier artifacts were already bounded.

All twelve required CI jobs must pass on the final proposed head. A summary, a successful upload or results combined across different heads cannot substitute for that gate.
