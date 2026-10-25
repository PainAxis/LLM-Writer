# Planning Contract v1: exact-revision planning context

[English](writer-campaign-planning.md) | [简体中文](writer-campaign-planning.zh-CN.md)

**Offline fixture only. Planning intent is not established prose truth.** This slice adds a reusable production validation and context boundary to the [Campaign durability foundation](writer-campaign-foundation.md) and [v2 storage accounting](writer-campaign-storage.md). Fixed bilingual responses exercise it; they are not autonomous creative decisions. Semantic consistency, autonomous novel generation and whole-work audit remain **NOT RUN**.

## Try the bounded production path

Open `/#/campaigns`, then explicitly choose **中文规划案例（3 章）** or **English planning fixture (3 chapters)**. The older short fixtures remain separate and unchanged. The registered new profile is `planning-contract-v1-three-chapter`; the separately measured capacity profile is `planning-contract-v1-compact-60`. Unknown versions in the planning-profile namespace are refused rather than interpreted as legacy prose. These two fixed workloads are the only registered fixtures: the contract’s 60-chapter ceiling is not an arbitrary-N creation/import API. Each fixture’s body target is the exact scalar count of its frozen short body texts, not the legacy million-scalar target.

Creation and reopening do not execute anything. Each explicit **step** advances at most one durable task:

1. Outline.
2. Character bible, depending on the outline.
3. Detailed outline, depending on the outline and bible.
4. All three chapter outlines, each depending on all three global plans.
5. Short plain-text body fixtures, in chapter order, each depending on every plan and its preceding body when present.

Nine tasks are not nine autonomous writing decisions. The fixed short body text is not a million-character novel. The final [long-form acceptance contract](writer-agent-longform-acceptance.md) still requires independently audited Chinese and English works of 1,000,000 body Unicode scalars each.

### Read-only chapter preview

After all chapter outlines have been accepted, select any chapter to compile its exact local context. Selection calls the production `previewPlanningContext(campaignId, chapterOrdinal)` entry, not the adapter. It performs a fresh bounded verified read and a final source/head fence. No request is reserved or dispatched, no response is retained and no body is saved.

The preview displays the selected immutable chapter address, exact source revisions/hashes, canon-base and full-plan roots, scope, digest and actual UTF-8/UTF-16 size. Its expandable packet is escaped read-only local text. Its purpose is `planning_preview`, never `body_fixture_dispatch`. Selecting chapter three before chapter one exists does not invent preceding body evidence or make chapter three eligible to run. `nextEligibleBodyTaskId` is the separately computed eligible body, or `null`.

Missing, pending or invalidated plans; unknown profile; changed source; expired runtime/source identity; cancellation; timeout and unsupported context produce an explicit refusal rather than partial readiness. A refresh, step, stop or campaign selection clears the displayed preview. Newer chapter selection and unmount suppress late UI results. Cross-tab changes are checked during compilation; an already displayed packet is not a continuing authority grant. Every later body step independently recomputes eligibility and compiles a distinct dispatch packet.

## What is structurally validated

The four planning kinds carry canonical JSON in the existing immutable artifact text. Their closed `campaign-plan-v1` envelope contains exactly `protocol`, `stage`, `language`, ordered exact `dependencies` and the stage-specific `payload`. Chapter bodies stay plain text, so JSON labels and planning material never count as body progress. No new persistence record type or migration is introduced, and existing v2 text counting/hashes are unchanged.

The closed records cover genre rules, richer lore entities, author-declared world facts, promises, initially frozen intentionally-open threads, characters, states, epistemic states, transitions, beats, obligations, chapter entries and scenes. References use an exact artifact identity, record kind and stable record ID; they are not paths, URLs, fuzzy names or asserted body quotations. Self references resolve only inside their own payload; ancestor references resolve against exact eligible accepted revisions.

Validation checks known fields/types, canonical spelling, scalar validity, unique IDs, exact reference types/revisions, complete declared premise edges, chapter assignments, causal ordering, required scene actions and scheduled disclosure. Lore/fact adjacency may be cyclic; causal predecessors may not. Malformed or future payloads, duplicate JSON keys, prose wrappers, stale references and unsupported shapes are refused, not repaired.

V1 supports linear narrative chapter-boundary transitions only. A transition at chapter K's end keeps the old state active through K and starts its successor at K+1, supported by a final beat in K. Same-chapter learning followed by use, nonlinear story-time inference and final-chapter transitions without a successor chapter are not certified. Missing epistemic rows mean unmodeled knowledge, not access to all world facts. A planned `knows` row is a declaration, not evidence that the prose established knowledge.

A semantically contradictory but structurally valid claim can still pass these structural checks. Inferred truth, persuasive motivation, undeclared clues, actual prose spoilers, literary quality and continuity are not judged. No planning reference is converted into an established-body fact anchor.


State/knowledge checks apply to explicitly declared references. A cast-only scene, an uncited expired state interval, capability-support implications or an undeclared knowledge use do not establish complete character-state coverage. An epistemic claim can refer to a historical or believed fact; its type does not assert simultaneous world truth or decide whether a belief is false. These unmodeled semantics remain unreviewed. Epistemic/narrator current/future/past partitions describe author-planned schedules, not permission to disclose them to readers; `readerVisibleFactRefs` follows the world fact’s declared `readerNotBefore` and never promotes an epistemic subject to truth.

## Deterministic bounded context

The canon-base root binds the contract, manifest and ordered exact outline/bible/detailed-outline refs. The full-plan root additionally binds every accepted chapter outline. No body request is eligible before the full-plan root exists. Replacing any chapter outline invalidates every body; replacing a global plan also invalidates its descendants. Planning replacement is explicit candidate editing, not semantic repair. New-profile body replacement is refused; legacy replacement behavior remains unchanged.

The chapter and body packet includes the **complete** global planning canon: all three global payloads, their refs and root, with a separate **32,768-byte** serialized cap. It also includes the selected chapter's entire outline where available, deterministic declared-reference closure and explicit planning/knowledge/reader-disclosure partitions. Other chapter-outline texts are not included; their exact refs/full-plan root are identity bindings, not supplied narrative content. The scope is `complete_global_planning_canon_and_selected_chapter` with an explicit omitted-outline count.

Closure rows are closed `{container, recordKind, recordId}` references to complete payloads already present in the packet. `early_outline` and `early_character_bible` resolve to `earlyPlanning.outline` / `earlyPlanning.characterBible` and exact `sourceRefs[0]` / `[1]`; `global_outline`, `global_character_bible` and `global_detailed_outline` resolve to the corresponding complete global payload and exact `globalCanon.sources[0]` / `[1]` / `[2]`. The compiler checks payload presence, allowed record kind, record membership and exact source identity before omitting the redundant per-row artifact ref. This reduces repeated wire metadata only: no record, premise, payload, root, source ref or scope is dropped.

Body fixture dispatch includes the complete immediately preceding body if any, only when the entire packet fits. It never substitutes a tail or summary. Its prose scope is planning-only with at most previous-body coverage; it is not complete realized-world memory. Planning-only preview contains no established body evidence. A role or size conflict refuses rather than leaking, truncating, ranking away required material or silently lowering a target.

`declaredReferenceCoverage: complete` describes registered references only. `semanticCompleteness: not_reviewed` and separate realized-body coverage prevent that label from being mistaken for semantic completeness. Labels do not prove a generative model would avoid leaking future information.

| Stage | Maximum prepared input | Maximum response text |
|---|---:|---:|
| Outline | 12 KiB | 8 KiB |
| Character bible | 20 KiB | 16 KiB |
| Detailed outline | 48 KiB | 32 KiB |
| Chapter outline | 56 KiB | 6 KiB |
| Body fixture | 64 KiB | 64 KiB |

Bounds apply to exact serialized text, including JSON keys, escaping and refs. A stricter aggregate cap wins; individual maxima are not a promise that every maximum fits simultaneously. The whole active plan is capped at 512 KiB, with at most 512 planning records, 2,048 reference edges, depth 12 and 16,384 JSON nodes per payload. These are byte/structure ceilings, not provider token or quality estimates.

## Repository enforcement and durable recovery

The reusable compiler runs before reservation. The repository independently rederives the entire prepared-input string from the registered profile and exact historical/current source view at reserve, rather than trusting a matching attacker-supplied digest or a plausible source list. Stage response reservation must match the stage's actual cap. Acceptance and replacement validate exact retained planning text; no normalization rewrites a retained response. Replay rechecks historical accepted payloads and request inputs against sources that were active at that event, not only the final index.

Action-private exact-raw proof reuse remains an optimization of already verified state, not permission to skip new typed validation. Read-local planning objects are bounded and discarded after the read; there is no durable canon cache or cross-read trust cache. All new production modules and frozen profile/prompt code participate in Campaign core-source identity. Old builds remain inspectable without acquiring execution permission under changed identity.

The existing durable dispatch intent is still the only dispatch authorization point. Invalid bounded responses may remain locally retained but are not accepted, settled or counted; save-only recovery applies the same validator without another invocation. Unknown intent is never redispatched merely because the fixture is deterministic. CAS, operation receipts, acceptance/settlement atomicity, cancellation races and old-candidate storage obligations remain unchanged.

The existing 128-task, 64-MiB W+U+P, 1-MiB record, 3-second IO, 5-second fixture-dispatch and 10-second action limits remain. Compilation checks the existing action's cancellation/deadline; it does not start a second allowance. A timeout/refusal is a failed gate, not successful scale representation.

## Verification and evidence boundaries

New-profile acceptance is separate from the older Campaign 12-case suite, author-Agent 90-case suite, native storage boundaries and historical million-scalar geometry profiles. Required new evidence includes:

- Closed wire, identity, scheduling, closure, deterministic packet/digest and exact byte-bound tests.
- Low-level repository bypass, historical replay, planning replacement/body replacement refusal, cancellation, unknown-intent and valid/invalid save-only recovery, atomicity and ACK-loss tests.
- Both languages' three-chapter/nine-task built-app native IndexedDB flows, including plan freeze, read-only preview, reload/process reopen and stale-source cases.
- Separate Chinese/English compact N=60 runs in both injected-IO Node and native IndexedDB: 123 real committed tasks, short bodies at most 256 scalars each, exact receipts/counts, cold reopen identity, W/U/P and measured read/write/time observations. Geometry alone does not pass this gate.
- Existing regressions, strict type/lint/build checks, independent exact-tree review, necessary exact-head CI and merged-main verification.

This document specifies scope and gates; it is not itself a test result. Completed runs and any failures must be reported with their own exact source/harness/profile identities and denominators. The compact typed plan profile is not a substitute for unchanged legacy million-scalar storage runs or for the final literary acceptance.

Generated packets, bodies, backups, raw traces and reconstructable request/response stores remain local. Only approved closed source-free derived reports may be archived; unknown report fields fail, and raw exceptions/snippets/paths are not copied. Ordinary Writer backup/restore still excludes Campaign data. No live model, credentials, API configuration, external tools, Writer mutation, imported user material, extraction/audit/repair loop or new disclosure permission is added.
