# Campaign durability foundation

[English](writer-campaign-foundation.md) | [简体中文](writer-campaign-foundation.zh-CN.md)

Foundation acceptance: **PR #44 is merged; exact-head and main twelve-job CI passed, Campaign 12/12 and Agent 90/90; the original million-character capacity gate remains unpassed.** This is a reusable production state/storage/budget foundation with an offline QA surface, not autonomous novel generation. The [final stage-four contract](writer-agent-longform-acceptance.md) still requires separate Chinese and English novels, each 1,000,000 body characters, from outline through character bible, detailed outline, chapter outlines and body, with complete independent continuity review. Neither a scripted task queue nor a large storage fixture satisfies that contract.

## Scope and entry

The isolated Campaign Lab is intended at `/#/campaigns`. It creates fixed short Chinese or English synthetic campaigns, executes one task per explicit step, and supports inspection, pause, resume and cancellation. Opening or reloading the page never dispatches work automatically. Resume is a state/ownership operation, not permission to replay an unknown request.

The engine handles real task kinds `outline`, `character_bible`, `detailed_outline`, `chapter_outline` and `chapter_body`, with explicit dependencies and exact artifact revisions. Its provider port and dispatch-authorization boundary are distinct from the fixture adapter. Only the offline adapter is registered in this slice. No live endpoint, model discovery, saved API configuration, credential lookup or paid call is included.

Task completion, actual body-character progress, and final literary acceptance are separate fields. A short fixture may exhaust its declared tasks while remaining far below its million-character target; this is not a completed novel. Semantic quality and final long-form acceptance remain **NOT RUN**.

The existing manual Writer Agent is unchanged: no automatic evidence approval, new append permission or relaxed ordinary-save ownership. Campaign operations do not write novels, fact graphs or API settings.

## Durable identity and atomic commits

Campaign data uses an independent stable namespace in the existing IndexedDB key/value store, reusing the application's committed-read and multi-key CAS primitives. No new file-system database, background daemon or external service is introduced.

A versioned manifest records campaign/candidate identity, language, body-character target, ordered task dependencies, adapter/fixture identity, implementation identity and finite budgets. A stored manifest is data, not a network capability. Immutable artifacts retain exact original text, revision and hash; raw and canonical Unicode scalar/UTF-16/UTF-8 counts are distinct, and planning text never counts toward body progress.

Each mutation compares the actual persisted head, including its epoch. An in-memory ownership check is supplementary, not cross-tab exclusion. Immutable checkpoint, artifact and receipt keys are create-only, except verified exact idempotent reuse. The same operation ID and bound business payload return the original receipt without another write; the same ID with a different payload is rejected.

Artifact acceptance, task eligibility, cumulative budget, checkpoint and receipt are committed together. Hashing and serialization finish before the IDB transaction; no network request or awaited callback runs inside the transaction. A successful transaction receipt establishes the commit. A delayed or failed acknowledgement does not establish that nothing was saved.

Unknown schema versions, corrupt JSON, missing referenced artifacts, hash conflicts and stale revisions are preserved and rejected, not reset into an empty campaign. The first slice uses a bounded task index and immutable chain, not a Merkle/paging framework. Reads verify the catalog and reject a rolled-back head if its next immutable checkpoint already exists. History is read in head-guarded batches of at most 32 records plus the head; capacity is measured separately from configured upper bounds.

Implementation identity binds the SHA-256 of the explicit `CAMPAIGN_CORE_PATHS` manifest in [campaign-build-identity.mjs](../scripts/campaign-build-identity.mjs), including the IDB primitive. The named set evolves with the implementation; use the manifest for the measured revision, not a historical file count. A clean build records its Git commit/tree; a dirty checkout or source archive records both as `null`, never falsely attributing changes to the parent commit. This is a core-source identity, not an attestation of the compiler, dependencies or browser. Changed identities remain inspectable but cannot mutate/resume old campaigns without a future explicit migration. The fault build separately records its probe hash and `buildMode`.

## Dispatch, cancellation and uncertain outcomes

Every dispatch first obtains a durable reservation, then a durable `dispatch_intent`. The intent is the linearization point of authorization. Only the winning execution may invoke the adapter, at most once. Persistent JSON or an inherited manual Writer grant cannot manufacture the runtime capability.

A cross-tab cancellation after intent may race with the already-authorized invocation. Cancellation therefore does **not** promise zero later calls or zero cost. It prevents new intents and rejects old results as accepted artifacts. Abort is best effort; cancelling cannot undo a previously committed artifact. UI wording must distinguish locally stopped from durably cancelled, and show an uncertain persistent outcome honestly.

| Stored evidence | Safe action |
|---|---|
| Reservation exists, but no intent, after a winning fence/coherent check | Continue the same bounded attempt with fresh authority, or stop; do not reset its ledger |
| Intent exists, but no trusted completion/result | Keep `unknown`, retain reservations and do not replay |
| Exact result was durably retained, but artifact was not accepted | Verified save-only recovery, without a second adapter invocation |
| Matching operation receipt exists | Report the known commit, even if its acknowledgement was lost or the head later advanced |
| No receipt and an old head | Do not infer failure; first fence the old commit owner and re-read before any save-only recovery |
| Corrupt/mismatched evidence or failed reads | Stay blocked/unknown and preserve the records |

A commit fence is not an external-dispatch fence. No invocation record, a new epoch, or the ability to regenerate identical fixture text proves that an authorized request was never sent. First-version reconciliation accepts only existing trusted completion evidence bound to the original request/input. Absence stays unknown. Late bounded usage evidence cannot refund unknown reservations, revive a cancelled campaign or append a chapter.

## Revisions and resource boundaries

A candidate/artifact replacement creates a new immutable revision and atomically invalidates dependent task eligibility, body counts and index state. Old in-flight results cannot attach to the new candidate. Changing candidates does not clear the campaign's budget. Automatic semantic repair and canon development are not implemented by this foundation.

Finite cumulative reservations survive restarts, failures and unknown requests. Reserved ceilings, observed usage and unavailable metering remain distinct; unknown provider cost is not zero. Request attempts, serialized input/output bounds, activity/deadline and metadata/artifact storage are bounded. Cancellation, reconciliation and save-only recovery need a finite safety envelope too; repeated identical commands cannot consume terminal allowance indefinitely.

The catalog holds at most 32 campaigns; there is no delete/export UI yet. Do not clear shared browser storage just to create another campaign, because it may contain ordinary Writer data. Each campaign’s default envelope allows at most 128 tasks/attempts, 256 artifacts, 2,048 durable operations, 64 MiB cumulative serialized payload and reserved storage, and a seven-day deadline. Each request bounds input and response to 64 KiB. Active work has a 10-second monotonic per-operation ceiling; continuation reserves a fresh envelope instead of reusing elapsed credit. A finite 16-operation/160-second and 512 KiB recovery pool is kept for terminal/recovery operations. These are ceilings, not successful capacity measurements. Reservations are conservative worst-case JSON bounds and are not refunded for unknown requests.

Serialized-payload accounting is not a physical browser-disk guarantee. Other same-origin data, IDB quota, open/transaction failures and browser data clearing remain possible. Time reservations/deadlines must not reset on process restart or clock rollback. Actual metadata growth, read batches and resume latency are measured on the production path before making a scale claim. Browser normalization/counts do not replace the independent pinned counting check required by final acceptance.

## Local data and backup limits

Campaign artifacts/checkpoints remain local to this browser profile. **Ordinary Writer backup/restore does not include or restore Campaign data in this slice.** Conversely, restoring ordinary novels must leave Campaign keys unchanged. There is no Campaign cloud sync, complete export/restore UI or automatic retention cleanup yet. Clearing the browser's data can lose these records.

Full artifacts, exports, backups, traces and reconstructable request/response collections must not be uploaded. CI may publish only a dedicated closed-schema, source-free derived summary and its manifest. Unknown fields are not recursively copied. Raw failure/source material stays local; CI stderr must not print it. Small fixed synthetic fixture source is ordinary test code, not a full generated novel or backup.

## Required validation and remaining work

Before acceptance, run deterministic production engine/repository tests plus real built-app IndexedDB restart, two-tab CAS, cancellation, unknown request/commit and acknowledgement-loss tests. Verify create-only records, exact operation replay, budget edges, candidate invalidation, corrupted/future versions and old-backup isolation. Chinese/English million-target storage-geometry profiles report the actual stopping point, including capacity refusal; they are not completed novels or literary quality tests. Real browser coverage is a fixed 12-case suite: C01–C03 use the ordinary production build; C04–C12 use a separately labelled offline-host observation/fault build with the real engine, CAS and IndexedDB. The transform does not replace state, budgeting or persistence logic. Exact adapter-entry counts are unavailable (`null`) for uninstrumented cases, not inferred from UI indicators. No browser was run in the local engineering workspace. All existing Writer/ordinary-save regressions and necessary exact-head CI still apply.

This document will be updated with measured limits and exact evidence after the implementation is frozen and reviewed. No live model, autonomous novel, whole-work semantic audit or final stage-four success is claimed here. The next architecture layers remain versioned canon/context assembly, explicitly authorized real-provider dispatch and calibration, genuine planning/chapter orchestration, independent full-work audit and bounded repair, then the two approved heavy acceptance campaigns.

## Reproduction

- `npm run smoke:writer-campaign-store`, `smoke:writer-campaign-engine`, `smoke:writer-campaign-ui`, `smoke:writer-campaign-evidence`, `smoke:writer-campaign-browser-lifecycle`, `smoke:writer-campaign-browser-probe` and `smoke:writer-campaign-browser-bootstrap` are included in `npm run smoke:all`.
- `npm run test:browser-writer-campaign` is a separate bounded step in the existing `ci-writer-agent` job, not silently added to the older aggregate browser runner. All twelve prior required CI jobs remain.
- The Campaign archive includes only `report.summary.json` and its manifest, projected from a dedicated closed report schema. Unknown fields fail preparation; no screenshot or raw report directory is uploaded.

## Measured capacity limit (not a million-character pass)

`npm run profile:writer-campaign-capacity` uses the production engine/repository with injected atomic Node IO. It generates 123 tasks/60 body chapters targeting 1,000,000 scalars per language; repeated text is storage geometry, held in memory, not narrative evidence. Chinese stops at **200,004 body scalars / 28 tasks and invocations**, with **6,309,217 live serialized bytes, 6,346,657 cumulative written bytes and 66,456,411 reserved bytes**. English stops at **350,007 scalars / 46 tasks and invocations**, with **6,557,604 / 6,618,786 / 65,625,495 bytes** respectively. Both hit `budget_exhausted` under the unchanged 67,108,864-byte cap. Long-form acceptance remains NOT RUN.

Cold verified reads took 173.89 / 236.81 ms and read 6,363,172 / 6,636,348 bytes. These are single Node observations, not browser timing guarantees. Maximum batches were 33 keys, 1,205,520 bytes for Chinese and 728,686 for English. A separate repository check covers a 64 KiB artifact, 127 tasks and 41 checkpoints.

The roughly 60.11 / 59.01 MB gap between reserved and cumulatively written bytes is conservative permanent worst-case escaping/future-write headroom, not unexplained live storage growth or physical quota exhaustion. The 37,440 / 61,182-byte cumulative-versus-live difference is overwritten-head write accounting. **Million-character capacity has not passed.** The immediate next accounting slice must separate cumulative actual writes from outstanding future-write obligations, with allocation/settlement identities. Known inputs can use exact JSON byte bounds; unknown request obligations must remain. Settlement requires crash, ACK-loss, concurrent-settlement and candidate-invalidation tests rather than a higher cap or unproved refund.

Total reads during these bounded Node profiles were 570,635,858 bytes / 10,577 batches (Chinese) and 997,803,343 bytes / 26,957 batches (English). Bounded individual batches do not bound aggregate repeated history verification to linear work. The next capacity investigation must measure that amplification as well as reservation accounting; no browser long-form throughput claim is made.

[Compact validation evidence](testing/writer-campaign-foundation-2026-10-24/REPORT.md) binds local checks and source-free capacity observations. It keeps local NOT RUN browser status distinct from subsequent exact-head CI results.

## First CI failure and harness correction

The first PR #44 run, [40121881904](https://github.com/PainAxis/LLM-Writer/actions/runs/40121881904), tested head `6e4d43b0109aa9e994f0d113ae916619d65eefad` through Actions checkout `aec4afbd1248f44a8e414d60ebf04aa9dc301d0a`; both resolve to tree `9a51afe784e9923c41b8722c1522796fde2489ab`. Eleven jobs passed; `ci-writer-agent` failed. Its existing 90-case Agent step passed, but Campaign passed 7/12 with C04/C08/C09/C10/C12 failing and five browser errors. No external or real-model requests occurred. The original source-free summary is preserved locally and identified in the compact evidence; it is not rewritten as success.

The correction changes test setup, fault injection and diagnostics, not production code or timeouts. Reload waits are armed before the restore action and prove a new document; isolation compares all ordinary IndexedDB and localStorage data; both cross-tab actors settle before checking the durable winner. Observer tabs and route modules warm before fault gates, and unmount proves the intended same-document transition rather than a timeout substitute. The old probe explicitly aborted and then threw, causing the real CAS catch to abort a second time. The replacement injects a synchronous put failure while the transaction remains active, so production performs the single rollback. A strict native-state Node model reproduces the old double-abort path and checks the replacement, but is not browser evidence or attribution of all five initial errors.

Report schema v2 retains the fixed 12-case and zero-browser-error gates. It publishes only fixed failure-stage IDs, per-case counts and at most 32 enum-category/SHA-256 error records plus overflow counts; no original message, stack or payload is copied. Captured case ownership and post-teardown checks prevent late errors from leaving a case marked passed. Unknown fields, invalid stage/category combinations and inconsistent attribution/overflow reject archive preparation. The corrected exact-head browser run remains required; local Node checks alone cannot close the original failures.

## Second CI: exact bootstrap diagnosis, restore still unresolved

Corrected run [40123957777](https://github.com/PainAxis/LLM-Writer/actions/runs/40123957777) tested head `14daf1b00770cf507d7613bcd1f9877f371dcc41`, merge checkout `cb39bd5a34753a05a7c81cb8eb7cb0667b0791a6`, tree `f54b97fe55c8e69a382b26813cb3a13257cd94f6`. Again eleven jobs passed and the old Agent 90 cases passed. Campaign improved to **8 passed / 4 failed / 0 not run**: C08 now passed, while C04/C09/C10 each reported one identical `other` error and C12 failed at the coarse reload barrier with no browser error. Zero external/live-model requests were recorded.

All three identical hashes exactly match the `SecurityError` raised when the test bootstrap accesses `localStorage` on a newly created opaque `about:blank` page. A Node VM reproduction matches the observed hash. The runner now installs its announcement/privacy observer only on the exact expected HTTP(S) app origin; opaque and unrelated pages touch no storage. Six regression checks preserve app-origin observation and unsuppressed real app-origin errors. This is a harness correction, not a production error-policy change.

C12's root cause remains **unresolved**. Its former stage included completion-dialog visibility, confirm, actual reload, return and selection. The new fixed stages separate those boundaries and verify committed empty ordinary novels plus unchanged Campaign bytes before reload, then unchanged Campaign bytes after a real new-document reload and before navigation/selection. Unexpected native dialogs in that narrow window are dismissed and fail at a fixed stage; none is automatically accepted, and reload is never forced. The next exact-head browser result is still required. All twelve cases, original timeouts and zero-error gates remain.

## Accepted baseline and accounting follow-up

On 2026-10-25, [main run 40154748857](https://github.com/PainAxis/LLM-Writer/actions/runs/40154748857) passed all twelve jobs on the first attempt at merge `84e704afff08921763d4b83136d881a39946900a`. All twelve real Campaign cases passed with zero browser errors, external requests or real-model calls; fourteen derived archives passed allowlist, manifest and ZIP-hash audits. Both earlier failures remain historical. The current strengthened C12 commit, real reload, document-identity and byte-preservation checks passed without retrospectively identifying the old coarse failure cause. Permanent-reservation capacity observations above remain v1 history. The new [v2 allocation/settlement](writer-campaign-storage.md) has separate source/test/acceptance identities; foundation success is not a new-implementation or long-form pass.
