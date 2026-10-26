# Single-window Body Proposal Producer — offline readiness

[English](writer-body-proposal-producer.md) | [简体中文](writer-body-proposal-producer.zh-CN.md)

Status: implementation under validation. No live provider, credential use, paid pilot, autonomous extraction or whole-work semantic acceptance is authorized. Native-IDB/UI acceptance runs only in the separately approved CI job; unexecuted gates remain NOT RUN.

## What this adds

Campaign Lab can prepare proposals from an arbitrary current accepted body window, not just load the fixed Body Evidence example. The path is explicit: adopt a completed source campaign → optionally revise its body locally → select a window and planning references → prepare exact input → invoke one registered offline-control adapter → retain its outcome → compile supported and unresolved observations for read-only review.

The default application has no authorized transport adapter. It can show and prepare the unconfigured SDK descriptor, but Invoke stays disabled and the engine independently refuses it. Engineering tests register the real bounded SDK adapter against a local synthetic endpoint. Those controls establish transport, source and durability behavior, not real-model extraction quality.

Only the existing validated 3- and 60-chapter planning graphs are supported. This is generic over their accepted body text, not support for arbitrary untyped Campaigns or ordinary Writer novels. The producer never edits Writer text, planning canon or fact graphs; it cannot schedule another window, retrieve extra evidence, retry, repair or turn proposals into established facts.

## Explicit source and persistence versions

Producer readiness uses **Campaign v3 at the existing campaign head key**. Explicit adoption first verifies a completed v2 campaign with no open writing request/allocation. It preserves every immutable v2 record, original hash/counting rule and cumulative budget. The new head fences already-loaded v2 writers through exact CAS; old readers cannot ignore an invisible producer sidecar. V3 checkpoint/receipt keys are separate, preserving v2's historical successor checks. Unknown/corrupt versions are refused without rewriting their bytes.

Local body revision is a separate author action, not an automatic producer step. It creates an identified candidate/artifact revision, preserves parents and invalidates dependent later bodies. Each re-admission requires another author action and current dependencies. A revision commit is bound to the exact head shown in its preview; another tab’s intervening change requires a new preview, never a silent rebase. Manual revisions are explicitly non-autonomous; they cannot count toward the final autonomous novel acceptance.

Producer requests/responses/reviews have closed v1 contracts beneath the v3 aggregate. The **Body Evidence producer packet is v2**, with actual registered-adapter lineage and visible inventory counts/digest. It shares the existing source/quote/reference/closure compiler core. Manual Body Evidence v1 keeps its original contract and byte-compatible packets.

## One call, including uncertain outcomes

A request follows `reserved → dispatch_intent → response_retained → resolved`, with an optional `outcome_unknown` between intent and retention.

- Prepare makes fresh verified reads, no writes and no provider call.
- Exact input, source roots, original offsets, planning closure, adapter/configuration identity and finite ceilings are frozen before invocation.
- Durable intent is committed in the bounded SDK's final pre-request guard. Only that fresh winning invocation receives a one-use runtime permit; saved JSON and replayed receipts grant no call authority.
- Duplicate clicks share one operation. An operation ID with different content is a conflict.
- A crash after intent, even before HTTP, remains unknown/spent. Timeout, cancellation, missing usage or missing response never means zero cost.
- A complete bounded response is retained before parsing. Invalid JSON is a retained refused outcome, not a successful empty inventory.
- Reload/recovery is local and explicit. Retained replies can be compiled without transport. An unknown call cannot be replayed automatically.
- Final publication checks current source/config/ownership and commits through the shared raw-head CAS. Late or stale results cannot restore cancelled ownership.

activeMs represents conservative admitted-request/committed-metadata reservations, not total elapsed CPU for every failed read or read-only preparation. Recovery checks remaining allowance before compilation; each local attempt retains its own deadline, and a failed write cannot claim a confirmed durable debit. Recovery metadata operations have explicit finite accounting; they do not extend an expired request owner or create another spending pool. A lost write acknowledgment is resolved through its exact durable receipt before any retry.

## Explicit cold-verification sessions and deadlines

The producer uses a new optional **`producer-verification-session-v1` execution contract**, not a faster or renamed legacy read. Existing public v2 reads and monolithic v3 reads keep their previous APIs and three-second operation behavior. The earlier producer N60 and saved-snapshot monolithic three-second failures remain failed evidence; this contract does not award that gate or claim a CPU-speed improvement.

An owner may begin one cold session, with one purpose: verify a completed, registered, obligation-free v2 baseline for explicit adoption, or verify the current v3 aggregate. Its absolute deadline is fixed at `min(owner.started + 10 seconds, owner.deadline)`. It is not renewed by a batch, progress callback, yield, final fence or retry. Inspect, adoption, prepare, revision, cancel and recovery retain their total ten-second owner limit. Invocation retains its total sixty-second limit; the initial session consumes its first ten seconds, not another allowance. Each actual raw IO/CAS wait remains bounded by three seconds and every enclosing deadline.

Chronological replay preserves all schema, canonical-byte, hash, lineage, source, request-state, exact-write-charge and shared-budget checks. An advance handles at most eight replay operations, even when a fetch batch contains thirty-two. Explicit host-task yielding near fifty milliseconds and a 250 ms continuous synchronous-validation ceiling are separately measured requirements; a resolved Promise alone is not a host yield. All validation, IO, scheduling and finalization consume the same fixed total deadline. Progress contains counts and phase only: no partial source or parsed state can authorize preparation, mutation or dispatch.

One repository-private proof pool covers both the adopted v2 origin and v3 tail under the existing 64 MiB / 8,193-entry / 512-active-payload ceilings. Cold-session capture is complete-or-refuse: admission or capacity loss cannot silently omit records or acquire a second pool. Before counters are verified, only absolute capture caps apply. Final admission also requires retained serialized key/value bytes to fit the fully verified aggregate W. These are serialized-retention bounds, not a JavaScript heap bound.

Before success, the session freshly re-observes every immutable raw record used by replay, with exact expected-key/count coverage, literal byte equality, complete catalog-prefix/successor fences and the actual head. The head is checked across batches and suspensions. Source movement refuses rather than rebases. This is not a historical-key transaction lock: final mutations still guard the actual head and create-only write targets with CAS. Returned snapshots are detached from the private verified state.

Successful completion destroys the continuation but retains the same exact-fenced proof for that owner's warm operations. Those operations retain their three-second repository bound, freshly recheck the origin and fully replay the v3 tail. Completion of the owner, cancellation, navigation, replacement, expiry or error destroys proof authority. A lost proof cannot be reseeded or start another cold session in that owner; an old-path cold fallback remains at most three seconds and may refuse. Existing separately bounded metadata recovery grants no provider permission. No progress is persisted: reload starts explicit verification from raw records, never a trusted saved cursor.

Adoption consumes its privately verified v2 baseline once through exact-head CAS, without a second cold replay or inline reconciliation. A false CAS or uncertain acknowledgment ends that owner. A new explicit retry may verify an already-v3 aggregate and recognize only the exact adoption receipt; it cannot roll back, re-adopt or change purpose within the old owner. Already-loaded v2 writers still fail exact-head CAS after adoption.

Cooperative checks, the final CAS gate and post-result publication use the same absolute deadlines even if timers are delayed. A late successful durable write is reconciled through its exact receipt, not treated as unwritten. Unknown provider outcomes remain spent/unknown; verification never retries HTTP or refunds reservations. If verification and its enclosing metadata operation cannot fit the fixed ten-second owner budget, validation stops rather than increasing or resetting the limit. Invocation still has sixty seconds total, with only its initial cold phase limited to the first ten seconds. A verification-completed event is not action success: a completion listener may synchronously cancel ownership, producing a subsequent cancelled event while no snapshot or dispatch authority is returned.

## Limits and shared accounting

The aggregate remains **W + U + P ≤ 67,108,864 bytes**. W is cumulative successful key-plus-value writes; U is outstanding future-write allowance; P is protected recovery capacity. Adoption, producer records, local body revisions and overwritten heads all use this same account. No second 64 MiB quota or new attempt allowance appears.

| Boundary | Initial ceiling |
| --- | --- |
| Producer requests | 8 per adopted campaign, also constrained by remaining shared budgets |
| Active dispatchable request | 1 |
| Selected body window | 1 chapter; 4,096 original UTF-16 units; scalar boundaries |
| Selected complete planning closure | 32 records / 12 KiB |
| Exact serialized wire | 32 KiB UTF-8 / 16,384 UTF-16 units |
| Output | 8 items; 16 spans; 32 subject mentions |
| Returned text / decoded HTTP body | 16 KiB / 64 KiB |
| SDK request | 1 attempt; 1,200 configured output tokens; disabled reasoning; 30 seconds |
| Producer invocation / prepared handle | 60 seconds / 5 minutes |
| Actual IO/CAS / warm repository operation | 3 seconds, also bounded by owner deadline |
| Cold session / metadata owner / existing preview | Within the same fixed 10 seconds / 10 seconds / 10 seconds |
| Verification advance / synchronous segment | 8 replay operations / 250 ms; host-task yielding near 50 ms |
| Evidence packet / complete review | 64 KiB / 96 KiB |

The producer's five-phase storage envelope is distinct from writing artifact storage. Final key-plus-value limits independently constrain origin, response and review records. Exact fixed-width measurement and final recount precede CAS. A complete terminal outcome releases only unused future-write capacity; cumulative resource reservations are never refunded. Unknown outcomes retain their open allocation across cancel, replacement, reload and expiry.

A 123-attempt N60 origin does not receive eight fresh attempts. Remaining shared attempt, active-time, operation and storage ceilings can admit fewer. Capacity refusal is not successful coverage.

## Disclosure and unresolved inventory

Only the chosen exact body window and selected, closure-complete planning records enter the producer prompt. The preparation view shows this literal input. It does not automatically send the complete planning context, titles, another body window, graph, retrieval results, tools or conversation history. Planning may contain author-only/future intent; it is not current prose truth, character knowledge or reader disclosure permission.

The first claim subset is standalone world assertions, attributed beliefs and narrator claims. Character changes, setup/payoff relations and claims needing unavailable premises remain unresolved. Returned unmapped subjects/topics, ambiguous attribution/references and capacity gaps stay visible with exact original anchors; no plan records are invented to make them pass.

Closed parsing rejects duplicate/extra keys, malformed references, split surrogates, changed quotations, oversized output and unsupported structure. It does not relocate repeated quotes, normalize text, repair JSON or discard malformed items to create a successful subset.

Requested/supplied text, completed requests, producer-declared examination and independent semantic review are separate quantities. Empty output is a completed response, not proof of no facts or no drift. Saturation adds an explicit whole-window gap. A wrong meaning attached to a correct quotation remains unreviewed. Stripping the review wrapper cannot hide that the v2 packet is only a subset: it retains unresolved counts, saturation and the inventory digest.

## Retention and remaining live gate

Requests, bounded raw replies and review packets remain local for the Campaign's lifetime, within the same capacity/request bounds. There is no automatic eviction, source-bearing export or ordinary Writer backup integration. Execution expiry does not promise erasure, refund budgets or resolve unknown requests. Clearing browser data loses evidence and makes later verification unknown.

This is **capacity-bounded offline retention**, not time-bounded deletion or live readiness. Live use additionally requires an approved endpoint/model and disclosure/credential grant, enforceable input-token/reasoning/money ceilings, producer-quality calibration in both languages, and an explicit finite retention/deletion contract. No estimated token/character constant or assumed price grants permission.

## Verification

Focused suites cover parser/compiler compatibility, actual SDK loopback transport, v3 migration/accounting/fault recovery, engine integration and UI ownership. Serial N60 profiles and CI-only native/UI controls use frozen identities and the explicit execution contracts above. `body-producer-readiness-report-v2` separately reports owner/session time, actual IO/CAS, warm operations, synchronous segments, host yields, final-fence coverage and retained proof bytes. Aggregate repository/cold-read wall time remains visible; the old monolithic-three-second producer gate is explicitly not awarded. Legacy v2 deadline gates remain mandatory. Owner terminal counters are disjoint: completed, refused, cancelled or expired. `ownersExpired` counts expiry visible to the engine owner or its admitted wait; an internally timed-out CAS wrapped as `storage_unknown` may instead count as refused. Therefore zero expired owners never substitutes for the independent raw-IO/CAS deadline checks or proves a write did not occur. Separate browser denominators cover the shipped ProducerLabPanel lifecycle matrix and a small actual App/router/CampaignLab integration journey. The actual-App journey also exercises pending-verification progress, cancellation and cold reload, independently of the panel denominator. Both use production engine/native IndexedDB/SDK; only the controlled CI build explicitly provides a loopback adapter. Normal app bootstrap supplies none and remains unconfigured. These native gates are not locally executed or credited by Node tests. Public evidence is closed source-free hashes/counts/statuses only; raw body windows, requests, replies, packets, store dumps and source-bearing traces are excluded.

The final requirement remains two autonomous novels, Chinese and English, each with one million body Unicode scalar characters and independent full-work genre/plot/character/foreshadowing evidence. Both full campaigns and their semantic audits remain **NOT RUN**. See [the final acceptance contract](writer-agent-longform-acceptance.md).
