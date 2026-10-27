# Arbitrary brief to three chapters — Creative Pilot v4

[English](writer-creative-pilot.md) | [简体中文](writer-creative-pilot.zh-CN.md)

Status: local implementation and offline-readiness validation. This document does not award the pending exact-head CI gates or authorize any external provider, credential transmission, paid run or publication of manuscript data.

## The concrete writing path

Campaign Lab accepts a new Chinese or English author brief, not a choice of fixture story. One explicit author grant advances this fixed graph:

1. Outline.
2. Character bible.
3. Detailed outline.
4. Chapter outlines 1, 2 and 3.
5. Chapter bodies 1, 2 and 3.

That is **nine lifetime requests**, with no retry, repair, extra chapter or hidden tool request. Every body depends on all six accepted plans and every preceding accepted body. Chapter 3 receives the complete exact text of bodies 1 and 2, not a summary, hash substitute or truncated window. The synthetic test endpoint derives its replies from the actual SDK request; production code does not import its recipes or brief corpus.

The default application has **no transport host**. Authors can prepare and inspect a brief, but Start remains disabled and the engine independently refuses calls. Only a separately installed opaque offline-control host can use the real bounded SDK, and its destination is restricted to loopback. Query strings, local storage and saved campaign records do not grant a host. This is a working offline vertical, not approval to send a real novel to a provider.

## Author controls and disclosure

- **Prepare** creates a fresh Campaign v4, records the exact brief and fixes a 15-minute expiry. A draft alone creates no campaign or call. One language is fixed for the run.
- **Replace brief** allows one explicit durable replacement before any request reservation. It changes candidate/source identities and exact future input, invalidates the previous preview, and neither renews expiry nor resets allowances. A spent or unknown reservation cannot be renamed into a fresh nine-task grant.
- **Dry prepare** shows the exact system/prompt, source identities, supplied/omitted inventory and endpoint/model readiness. It makes no model call. Editing, selection changes and Stop revoke the preview/consent.
- **Start** requires fresh explicit consent for the current candidate and fixed scope. The disclosure says that later stages will automatically send newly generated planning and complete prior bodies; their future text cannot truthfully be called already previewed.
- **Stop** revokes this runtime's creative authority. **Resume** is a separate explicit action and never renews the original request deadline or spent quota. Reload is inspection only.
- **Resolve retained** performs local validation and acceptance only; it cannot call the SDK or advance the next task. **Close without publication** can account for a known response without pretending valid prose is a compiler failure. **Cancel** durably revokes the campaign; it cannot undo a request already sent or erase an unknown obligation.

Planning intent is not realized-body evidence or character knowledge. Each prepared input separates author-only versus reader-visible facts, character/narrator state by schedule, applicable obligations/transitions, and actual prior bodies. A body request supplies the complete global canon and its selected chapter outline. The other two chapter-outline texts are explicitly listed as omitted; their references and full-plan root do not claim those texts were supplied. No retrieval, fact-graph mutation, audit loop or repair loop is added.

## Raw response, named compile, local review

The actual SDK HTTP body is checked and hashed before dispatch intent. A complete bounded response is retained before content validation, including invalid planning JSON, invalid scalar text or an incomplete finish. The lossless visible-text representation preserves lone surrogates for an explicit refusal. Raw HTTP bytes, headers, credentials and hidden reasoning/tool content are not persisted; hidden-content observations become only a closed anomaly inventory.

Planning responses use a named closed schema. The deterministic compiler resolves catalog tokens to exact source identities, applies the existing planning grammar and canon/schedule rules, and records the raw-to-derived relationship. Expansion is checked against the derived stage-byte cap before the unchanged legacy parser; exceeding it is `compiled_capacity`, not a silent truncation or legacy limit increase. Body text is kept exact, while counts use the existing `crlf-lf-nfc-scalar-v1` rule.

Reported model and usage evidence comes from own fields in the bounded, fatal-UTF-8, duplicate-key-checked compatible HTTP JSON, not SDK convenience defaults. Missing counters remain null, not zero. An absent/mismatched reported model, hidden reasoning/tools, invalid content shape, non-stop finish or compiler failure is a retained refusal. Offline partial/unavailable usage does not establish a live cost bound. Accepted artifacts are explicitly **semantic status: not reviewed**. The Lab shows raw response, compiled plans/bodies, identities, refusals, unknown obligations and last-verified budgets; it does not save text into an ordinary Writer novel.

## Durable invocation and finite accounting

V4 is a new aggregate at the ordinary Campaign head, with separate immutable `v4:` children and the existing 32-campaign catalog. It does not migrate v2/v3 campaigns, hide fields in v2, or add a second storage allowance. Old APIs and their limits remain unchanged; old writers cannot overwrite a v4 head through stale CAS.

Each request follows `reserved → dispatch_intent → [outcome_unknown] → response_retained → resolved`. Only a fresh, positively acknowledged winning intent CAS can dispatch once. Receipt replay, uncertain ACK, reload or saved JSON cannot dispatch. Verified reserved/no-intent state can continue only under the original admission/deadline; an intent or unknown outcome never replays. Duplicate Start shares the same in-flight promise. A complete known reply arriving after Stop/Cancel is retained under the still-live original settlement deadline, but cannot publish or advance. Explicit standalone recovery has its own bounded slot, not a new generation grant.

| Limit | V4 contract |
| --- | --- |
| Author brief | Combined 1,024 UTF-16 units / 4,096 UTF-8 bytes; 0–8 constraints |
| Body target / accepted interval | 512 / 256–1,024 canonical scalars per chapter |
| Raw body | 2,048 UTF-16 units / 8,192 UTF-8 bytes |
| Prepared input by stage | 12 / 20 / 48 / 56 / 64 KiB |
| Actual HTTP request / response | 64 KiB each |
| Planning raw and derived text | Outline 8 KiB; characters 16 KiB; details 32 KiB; each chapter outline 6 KiB |
| SDK output | 4,096 tokens per call; 36,864 reserved over nine calls |
| SDK / stage owner | 30 seconds / 60 seconds; fixed original deadlines |
| V4 verified read, mutation or metadata owner | 10 seconds total; each actual IO/CAS wait at most 3 seconds |
| Metadata | Create, one replacement, at most three standalone recoveries, one protected Cancel |
| Active reservation | At most 600,000 ms; ordinary success reserves 550,000 ms |
| Storage | One 64 MiB `W + U + P` pool; protected recovery starts at 524,288 bytes |
| Request storage reservation | 1,900,544 bytes; unused U releases only on a proven terminal outcome |
| Ledger / observation | At most 48 operations; 173 stored rows plus absent successor, batches at most 33 keys |

Byte/UTF-16 counts are **not input tokens**. Input-token reservation is null and enforcement is `not_enforced_offline_control`; no live-input token or monetary ceiling is implied. The separate campaign SDK policy does not change the ordinary API's 1,200-token limit. Temperature 0.7 is checked in the actual HTTP string, not inserted into the integer-only campaign canonical format.

Each full read revalidates immutable records, graph, compiler result and conservation, then fences every observed literal raw row plus catalog/head/absent successor. No caller-supplied map or post-restart cache is trusted. V4's explicit 10-second verification operation is not a claim that legacy 3-second reads became faster. Cancellation, stalled hashes and late ACKs remain bounded by the original owner; there is no timer reset or background execution grant.

## Separate acceptance populations

The frozen plan distinguishes six Node campaigns (54 real local SDK tasks), two real built-App/native-IDB campaigns (18 tasks), 24 compiler controls, six metamorphic controls, 63 ACK cuts, 20 engine controls, 16 App interruptions and 16 report/archive controls. Focused component tests do not count as real App execution. Native/App journeys run only in authorized CI. Every previous compatibility and performance gate remains required; a passing new pilot cannot waive an old failure.

The new archive contains exactly `node-summary.json`, `browser-summary.json` and `manifest.json`: closed bounded identities, counts, outcomes and hashes only. It contains no brief, prompt, body, response, raw store, backup, screenshot or free-form diagnostic. Raw failure maps stay private for diagnosis, including unknown request identity and outstanding liability.

This closes the short autonomous planning-to-writing path, not literary quality or the final million-character test. Before a live pilot, a separate decision must identify the exact endpoint/model, credential route, real author brief/language, maximum requests/output tokens, enforceable input-token and money limits, and permission to transmit the disclosed/generated text. The live literary review must then examine the actual three chapters and all plan/body consistency claims; offline structural success cannot substitute for it. Longer runs still require full-work consistency coverage, bounded repair and resource calibration before the two autonomous 1,000,000-character novels can be accepted.
