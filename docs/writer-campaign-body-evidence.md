# Body Evidence & Coverage v1

[English](writer-campaign-body-evidence.md) | [简体中文](writer-campaign-body-evidence.zh-CN.md)

**Source and structure validation, not semantic review.** This bounded slice connects actual accepted Campaign body revisions to a reusable, read-only local proposal validator. A matching quotation does not establish that a statement is true, that a character knows it, that a narrator is reliable, or that a payoff resolves an obligation. Semantic extraction, adjudication, autonomous generation and whole-work audit remain **NOT RUN**.

This builds on [Planning Contract v1](writer-campaign-planning.md) and the existing v2 repository. It adds no durable evidence ledger, task kind, request, settlement or Writer graph mutation. The [final long-form standard](writer-agent-longform-acceptance.md)—two independently reviewed autonomous novels, Chinese and English, each with 1,000,000 body Unicode scalars—has not been satisfied by these short fixed fixtures.

## Production path

In `/#/campaigns`, explicitly create a Chinese or English **body evidence fixture (3 chapters)**. Its registered profile is `planning-contract-v1-body-evidence-three-chapter`. It uses the existing nine-task, all-plans-first graph and ordinary offline step/recovery behavior. Creation never executes a task. Its exact short-body target is derived from its frozen source texts, not the million-character target. Older planning/legacy fixtures keep their prior literal responses, graphs and target behavior for identical inputs; new source/build identity naturally changes newly created hashes.

After bodies have been accepted:

1. Select an accepted contiguous prefix, chapters 1 through K.
2. Explicitly load a fixed proposal example, or edit the local canonical JSON draft.
3. Choose **Validate local proposals**. This calls the production `previewBodyEvidence(campaignId, proposalText)` method—not a fixture-only shortcut.
4. Inspect source identities, exact quotes, supplied/declared-examined coverage, packet sizes and the explicit **not reviewed** semantic status.

The generic entry accepts other supported closed proposal inventories against the current sources. It does not require fixture-specific statements or meanings. Only the optional fixed-example builder checks its registered literal fixture sources. Edited input remains unauthenticated, even if its producer field says `offline_fixture`. Drafts and results are session-local; neither is saved or dispatched. Raw drafts, packets and source-bearing observations must not be uploaded as CI artifacts.

The richer fixture deliberately includes an attributed belief inconsistent with planning, a proposed unreliable narrator, claimed learning and forgetting, a long-distance multi-premise payoff, and a wrong interpretation attached to a valid quotation. Their source/structure checks can pass while their semantics remain unreviewed. This is a boundary test, not a claim that a literary reviewer detected or resolved those issues.

## Identity and exact original-body anchors

“Original” means the exact accepted immutable `CampaignArtifact.text` as stored. It is not unavailable pre-accept provider/editor text. No new normalization is applied. Each span identifies an active accepted body artifact and half-open original UTF-16 interval, plus its exact literal quote and UTF-8 SHA-256. The validator rejects mismatched quotes/hashes, stale or foreign revisions, unsupported source identity, unaccepted sources, out-of-prefix references, invalid ranges and surrogate-splitting endpoints. It never fuzzy-relocates a quotation.

The body-prefix root binds manifest and current candidate, complete plan roots, K, and ordered exact source refs with task revision, artifact candidate lineage and stored-text metrics. It is not concatenated prose. Historical artifact candidate IDs may remain valid in active lineage; equal current-candidate spelling alone is not proof. A source table supplies every exact prefix source identity once; packet spans and coverage rows use checked indices into that table.

Fresh verified repository reads bracket compilation. Runtime/source identity, expiry, campaign cancellation and final exact raw-head equality are checked. Campaigns created under an older runtime/source identity remain inspectable but cannot acquire preview or execution permission under the new build; create a new explicit fixture to exercise the current path. The returned head is a dated observation, not a continuing capability or passive cross-tab subscription. Later execution cannot reuse it as authorization.

V2 hashing/counting and already-stored bytes are unchanged. Original UTF-16 positions remain distinct from scalar counts, NFC normalization and line-ending conversion. In particular, the existing v2 versus final-long-form lone-CR normalization difference is not silently repaired. Any future normalized extraction needs its own explicit version and source-offset mapping.

## Closed proposals and complete declared premises

The canonical `campaign-body-evidence-proposals-v1` JSON envelope has a fixed field set and local-author-only purpose. Unknown fields/versions, duplicate keys, malformed scalar text and noncanonical encodings refuse rather than repair.

Five proposal kinds are supported:

- **World assertion:** a proposed affirmative or negative statement, not world truth.
- **Attributed belief:** an exact planned character and planned world-fact topic with a declared attitude. The topic binding does not prove that the prose and plan mean the same thing.
- **Narrator claim:** a claim and proposed reliability label, not a reliability verdict.
- **Character change:** body-anchored before/after proposals, an exact planned character and declared state/knowledge-change kind. Knowledge endpoints retain the same holder and topic.
- **Setup/payoff:** every declared setup, payoff and context premise, plus an exact planned obligation used only for comparison.

Every submitted proposal and span remains in the packet. Missing required references, inconsistent declared types, support cycles, forward narrative premises and over-budget closure refuse the entire result. Position rules concern declared linear narrative order; they do not infer story-time causality, actual learning or persuasive character development. Future author plans in required planning-reference closure remain planning intent and are not subject to body-position ordering.

V1 deliberately does not resolve new body-origin character/entity identities. Unrepresentable typed subjects or obligations refuse instead of being silently dropped or invented in the plan. Natural-language ambiguity, undeclared dependencies and semantic contradictions cannot be detected merely by these checks.

All required planning records are supplied with their complete values and transitive registered references. Omitted addressable global records are counted separately from omitted chapter-outline/scene text. A full-plan root binds those outlines but does not claim their text was supplied. No ranking, summary, shortened quotation or top-k fallback may remove a required premise to fit the packet.

## Four distinct observations

| Observation | Meaning |
|---|---|
| **Available prefix** | Exact accepted source bodies 1..K and their original UTF-16 denominator. A repository read is not semantic examination. |
| **Supplied** | Union of literal original spans actually serialized in this packet, with per-source gaps. Hashes and source metadata are not supplied prose. |
| **Producer-declared examined** | An unauthenticated declaration whose ranges/identity are checked. It must be contained in supplied ranges. Absent declaration means NOT RUN. |
| **Semantic review** | Always `not_reviewed`, zero reviewed units and relation completeness `not_assessed`. Full supplied/examined range union cannot promote it. |

The exact declared-premise closure may be complete while semantic relation completeness is unknown. There is no single overall coverage percentage, “no drift” score, established-fact badge or semantic PASS. The only supported exposure is `local_author_only`; reader-, character- and provider-scoped requests are unsupported. Local access to a future plan is not disclosure permission or actual character knowledge.

## Lifecycle and finite bounds

Planning and body previews share one bounded preview owner per engine, separate from durable execution Runs. New previews supersede older ones. Editor changes, prefix changes, example-load starts and refresh revoke only preview work. Existing campaign navigation/create/explicit-stop behavior still revokes Runs where it did previously. An async example loader is separately fenced by campaign, K, editor revision and ownership, so it cannot overwrite a newer draft.

Each async preview read/compile wait is abort-aware and limited by the smaller of 3 seconds or the remaining single 10-second preview allowance. Checks surround bounded synchronous work and hashes; timers do not pretend to preempt synchronous JavaScript. Late aborted/timed-out promises cannot publish. No second allowance, retry-for-luck or automatic recompilation against changed sources is introduced.

New bounds, with aggregate limits taking precedence:

- Proposal and complete serialized packet: each at most **65,536 UTF-8 bytes and 65,536 UTF-16 units**.
- Up to 60 sources, 128 proposals, 256 quoted spans, 256 examination windows and 1,024 explicit/payload reference occurrences.
- Up to 16 references per ordinary field; setup/payoff lists each 1–8, context 0–16; quote at most 8,192 UTF-16 units and statement at most 512.
- JSON depth 12, 16,384 nodes; unchanged planning record/edge/size ceilings.

A maximum in one dimension does not guarantee all maxima fit together. Overflow is refusal, not truncation. Existing 128-task, 64-MiB W+U+P, 1-MiB record, 3-second IO, 5-second fixture dispatch and 10-second action limits are not increased. Preview does not spend additional request or durable operation budget.

## Bounded verified-read reuse

Repository reads still validate every retained record, replay every historical operation, and perform the same final fresh-head fence. Within a single read attempt, the private validator parses each immutable raw record into its own object and reuses its exact canonical members when checking the record hash. Public object validators and mutable returned snapshots keep their existing behavior.

Historical checkpoints alone are privately frozen. Their exact task-array identity may reuse an already encoded fragment for operation-digest verification, bounded to 32 entries and 1 MiB per history batch. Capacity overflow falls back to ordinary canonical encoding. Fragments are released after use and cleared on batch completion, failure, conflict retry and read exit; late completions cannot refill a closed batch. There is no cross-read cache or skipped source check. Canonical bytes, hash domains, refusal order and complexity limits remain unchanged.

## Acceptance gates and evidence limits

Required acceptance is separate from earlier planning, Campaign, Writer Agent and legacy million-scalar geometry results:

- Closed wire, exact source/Unicode anchors, typed relation/premise closure, interval-union/complement, deterministic serialization and cap/cap+1 checks.
- Real production repository/engine generic-input path with observed zero preview writes/provider entries; stale/replacement, corruption, cancellation, expiry, timeout, late settlement and cold-reopen boundaries.
- Bilingual nine-task native-IDB sources and actual built Lab editor/preview flows, including interrupted and repeated actions. Local native execution is NOT RUN in the restricted cloud environment; only authorized CI supplies that evidence.
- Separate Chinese/English N60 runs in injected-IO Node and native IndexedDB: 123 real committed tasks, full short-prefix supply and declared examination, long-distance declared support, fresh read/compile measurements, unchanged storage/budgets and actual cold reopen. Geometry or synthetic packet sizing alone cannot pass.
- Closed source-free archive/report validation, independent exact-tree review, full regressions, necessary exact-head CI and distinct merged-main verification.

This document specifies required behavior and gates, not a completed test report. Reports must preserve failed/not-run outcomes, exact denominators and source/core/harness/profile identities. Capability expectations and measured authority counters are separate; literal zeros do not substitute for observations. No live model, credentials, external provider grant, autonomous extraction, durable adjudication or repair loop is included.
