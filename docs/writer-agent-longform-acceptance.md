# Stage-four final acceptance: autonomous long-form writing

[English](writer-agent-longform-acceptance.md) | [简体中文](writer-agent-longform-acceptance.zh-CN.md)

Status: **specification, not implemented or run**. The current increment supplies [short-case evaluation readiness](writer-agent-evaluation.md), not this final acceptance. No provider, credential access, paid run, or long-running orchestration is approved by this document.

## Required outcome and remaining architecture

Autonomously author two complete novels, one Chinese and one English. Each campaign must create, in order, an **outline → character bible → detailed outline → chapter outlines → novel body**. The target is **1,000,000 body-text characters per novel**, not English words; planning does not count. Report the exact final count and any overrun rather than truncating a coherent ending. A shortfall cannot pass, and neither padding nor copied/repeated filler can satisfy the target. Both entire works must have no drift in genre, plot, characterization, or hidden foreshadowing.

The [existing Agent](writer-author-agent.md) is not this architecture. `writerAgentProtocol.ts` permits two model calls, one retrieval and at most 2,000 UTF-16 units of draft; its prompt requests approximately 200–500 Chinese characters. It requires individual author evidence approval, has session-only authority, and has no novel-planning or revision loop. The eight-case evaluator's gold-assisted selection is not autonomous evidence selection. Repeatedly invoking it or raising its limits would not establish this contract and must not bypass its existing approval boundary.

Necessary future work, each with its own review and regression gates:

- A separately authorized, language-aware campaign state machine with finite planning, chapter generation, audit and repair budgets. An initial grant must explicitly bound automatic evidence selection, chapter commits, repairs and provider disclosure; the existing manual Agent remains unchanged.
- Versioned planning artifacts and a source-anchored canon: genre constraints, plot/chronology, character identity/motivation/development, character knowledge versus world truth, and setup/payoff obligations with planned deadlines. Author knowledge of future plans must not become premature character knowledge or reveal future prose.
- Provenance-preserving memory and context assembly that can retrieve all relevant premises or stop unresolved, not treat a summary, top-k hit or similarity score as complete canon. New facts and intentional character development require supported transitions; rewriting the plan after a contradiction cannot excuse it.
- Durable campaign checkpoints, request/budget reservations, immutable chapter revisions, dependency invalidation and crash recovery. Existing versioned IndexedDB body storage, CAS and commit receipts are foundations, not absent features. Campaign restart ownership, long-run resource behavior and complete two-novel audit remain unvalidated. Stage-two editor/storage redesign is separate; required campaign persistence and scale tests cannot be deferred merely by naming that separation.
- Independent full-work review and a source-free acceptance report tied to the final artifacts. The current local/hybrid capacity tests, mock responses and short-case results cannot replace an actual authorized real-model campaign.

## Frozen campaign and reproducible length

Before the run, freeze a local manifest: source commit/tree, implementation and prompt hashes, counting/extraction version, Python and Unicode-data versions, initial briefs, languages, model/provider identity, generation parameters, finite budgets, repair policy, reviewer protocol, retention policy and campaign IDs. Preserve autonomous choices and all four planning stages with hashes and parent revisions. Freeze the resulting canon before body generation. A material canon change creates a new candidate and invalidates dependent evidence; it cannot retroactively erase a failure. No human-authored continuation, imported novel or undisclosed manual rewrite may count as autonomous output. Operational approval or fault recovery is recorded separately from creative intervention. Reproducibility means rechecking retained artifacts, counts and evidence, not promising identical stochastic model output on a fresh run.

Count only the accepted final revision of each chapter's plain-text body. Exclude chapter titles, outlines, character notes, summaries, prompts, audit prose, discarded drafts and metadata. Pin and test the editor-to-text extractor; decode HTML exactly once, preserving literal entities correctly. Hash both original extracted text and canonical text per chapter. Do not count artificial inter-chapter separators. The artifact root must bind ordered chapter IDs, revisions, lengths and hashes, not an ambiguous concatenation.

The primary unit is a **Unicode scalar value**, not UTF-8 bytes, JavaScript UTF-16 units or grapheme clusters. Reject unpaired surrogates. Canonicalize CRLF/CR to LF, then NFC, separately for each chapter. Legitimate English spaces and paragraph newlines count; also report raw and canonical whitespace/non-whitespace counts. Do not silently impose a million non-space characters. Freeze the following whitespace set and Unicode normalization implementation; keep a source-offset map when normalization changes offsets. Production evidence still uses exact original UTF-16 anchors.

```python
import hashlib
import unicodedata

WHITE_SPACE = set(range(0x09, 0x0E)) | {
    0x20, 0x85, 0xA0, 0x1680, *range(0x2000, 0x200B),
    0x2028, 0x2029, 0x202F, 0x205F, 0x3000,
}

def measure_body(body):
    if any(0xD800 <= ord(c) <= 0xDFFF for c in body):
        raise ValueError("unpaired surrogate")
    def counts(text):
        encoded = text.encode("utf-8", errors="strict")
        spaces = sum(ord(c) in WHITE_SPACE for c in text)
        return {"scalars": len(text), "whitespace": spaces,
                "non_whitespace": len(text) - spaces,
                "utf16_units": len(text.encode("utf-16-le")) // 2,
                "utf8_bytes": len(encoded),
                "sha256": hashlib.sha256(encoded).hexdigest()}
    canonical = unicodedata.normalize("NFC", body.replace("\r\n", "\n").replace("\r", "\n"))
    return {"unicode_version": unicodedata.unidata_version,
            "raw": counts(body), "canonical": counts(canonical)}

sample = measure_body("A\u030A\r\n中😀 ")
assert sample["raw"]["scalars"] == 7
assert sample["canonical"]["scalars"] == 5
assert sample["canonical"]["whitespace"] == 2
assert sample["canonical"]["utf16_units"] == 6
```

Sum canonical scalar counts over accepted chapters for each language separately. Recompute with an independent implementation against the same pinned artifacts and test vectors, including supplementary characters, combining marks, entities, empty bodies and line endings. Counting disagreements block acceptance. Duplicate-paragraph/chapter scans and overlap metrics only flag candidates: independent review must resolve every padding/repetition finding from the actual text. Legitimate reprises are not automatically failures; unresolved findings cannot pass. Whitespace, invisible controls, summaries or repeated prose inserted merely to reach the target are not valid novel content.

## Whole-work continuity evidence, not sampling

Freeze review criteria before generation. Review each language in its own competence domain; a translated summary is not review of the English or Chinese original. Independent reviewers must not author the candidate, inherit its self-grades, or see a success label in place of evidence. Record actual reviewer identity/role, model/version if applicable, source access, conflicts and review method. A distinct process or model name alone does not prove independence or correct judgment.

For each final novel, require all of the following:

1. **Text coverage:** every final body span is read in overlapping, revision-bound windows, with no gaps, truncation or capacity skips. Keep the exact interval union and covered/total counts. Planning artifacts and every chapter outline receive complete coverage too. Record original-text access, not merely summary access.
2. **Canon and relation coverage:** independent extraction checks every window for facts, transitions, promises, knowledge states and setup/payoff cues, including ones absent from the generator's ledger. Reconcile them against the frozen canon and the entire accumulated ledger, not just neighboring windows. Resolve every registered constraint, every character/plot trajectory and every obligation at its due point and the ending. Cross-chapter relations cite all supporting or conflicting spans. Newly discovered dependencies expand this ledger; omitted, capacity-skipped or unresolved relations remain visible coverage holes.
3. **Four explicit dimensions:** genre rules/tone trajectory; plot causality, chronology and promised direction; identity, capabilities, motivation, knowledge and supported character change; all hidden setups, disclosures and payoffs. Planned unresolved threads must already be declared intentionally open in the pre-body plan, not relabeled after being forgotten. Narrative uncertainty/unreliable narration is distinguished from an unsupported contradiction with cited evidence.
4. **Independent findings and adjudication:** each claim/finding has a stable ID, canon/body hashes, exact original and canonical ranges, rationale and `supported`, `drift`, or `unresolved` disposition. All disagreements, possible padding and missed/ambiguous obligations receive evidence-based adjudication independent of the authoring process. Generator self-review is diagnostic only. Every corrected final revision is re-audited; stale citations and affected downstream judgments are invalidated, and final whole-work coverage is re-established.
5. **Audit controls:** both languages include separately labeled planted drift and clean controls for all four dimensions, long-distance dependencies, ambiguous evidence and padding. Controls are not part of either novel or its length. A missed required control or unreliable coverage accounting blocks acceptance; control success does not establish literary truth.

Full window coverage does **not** establish completeness of all semantic relations. Finite reviewers cannot prove arbitrary literary truth or the absence of every possible interpretation. This is a falsifiable, artifact-specific evidence contract, not a theorem or a weaker replacement for “no drift.” Sampling, averaged scores, similarity thresholds, generator self-certification and “no detector fired” cannot yield PASS. An identified semantic gap or unresolved question must stay non-passing rather than be concealed by a 100% text-coverage number.

## Checkpoints, recovery and finite resource plan

Persist each planning stage and each committed chapter, with canonical counts, canon revision, request IDs, audit coverage, open findings and cumulative reservations/usage. Require source-free progress checkpoints after the first chapter and at 10%, 25%, 50%, 75% and 100% of each novel's target; checkpoints do not replace per-chapter checks. Before advancing, resolve newly identified continuity blockers or enter the bounded repair state. Failed candidates and repaired versions remain in the attempt history; only a separately audited final version can pass.

Test restart after reservation, after dispatch with unknown provider outcome, before/after durable chapter commit, during repair, during audit and at budget exhaustion. Also test corrupt/stale checkpoints, concurrent edits, cancellation and storage failure. Resume only from a verified manifest and commit receipt. Never blindly re-dispatch an uncertain request, append twice, reset budgets, reuse stale evidence or silently switch models. A known uncommitted failure may use only the frozen retry policy and remaining allowance. Human creative repair breaks the autonomous result; an operational pause does not itself do so. A paused, incomplete or uncertain campaign is not a pass.

The approval plan must specify hard per-request and cumulative ceilings for requests, input/output/reasoning tokens where enforceable, elapsed time, serialized bytes, local storage, retries, repair rounds and spend/currency. Reserve before dispatch and retain unresolved reservations across restart. Stop before exceeding a ceiling; exhaustion is not permission to shrink coverage. Provider-reported usage, tokenizer estimates and configured reservations are different fields. Missing billing/usage is unknown, never zero.

Do not invent a token/character constant or a price. After separate permission, run a small, explicitly bounded calibration in **both** languages using the proposed model/tokenizer and representative beginning/middle/long-context conditions. Measure serialized input tokens, visible output tokens per canonical character, discarded/repair output, audit/extraction cost, latency, usage completeness and provider reasoning behavior. Calibration is not final acceptance and is included in the spending plan.

For language `L`, forecast visible prose output as `C_L × r_L × g_L`, where `C_L = 1,000,000`, `r_L` is measured visible tokens per canonical character and `g_L` is all generated prose characters divided by final accepted characters. Add planning, review, repair commentary and control output separately. Actual input is `sum(tokenizer(exact serialized request_j))` over **all** requests, including failed attempts and repeated context; it is not just novel length. Naively resending growing history adds approximately `b × N × (N−1) / 2` characters for `N` equal `b`-character chapters, before instructions and audits. Ledger reconciliation and cross-window checks require their own measured workload, not a claimed single linear pass.

Calculate money using the provider's verified current input/cache/output/reasoning rates and charging rules, with no double counting, plus applicable fees. Report calibrated ranges and assumptions, not a definitive quote. If hidden charges or missing metering prevent enforcing the approved spend ceiling, do not launch on an assumed cap. Obtain explicit endpoint/model/disclosure/credential-use and budget approval before any live pilot, then approval for the calibrated full campaign; changing provider, budget or disclosure requires its own authorization.

## Retention, verdict and publication

Keep full synthetic novels, planning artifacts, revision history, source-bearing findings and private review packets local, outside repository/CI artifact collection, under restricted access. Freeze the retention period and local storage ceiling before launch; any backup remains local and access-controlled. Credentials, raw authentication headers, hidden reasoning and raw provider envelopes are not retained. Keep bounded request identity/usage metadata, not public reconstructable request/response collections. No full stories, private packets, backups or traces may be uploaded. Later authorized provider processing of explicitly disclosed synthetic inputs is distinct from artifact publication. Do not claim control over provider retention without verified terms.

Public evidence contains only allowlisted source-free campaign/version IDs, whole-artifact hashes, counts, budgets/observed usage, audit statistics and verdicts. Local authoritative evidence must remain accessible to authorized independent reviewers; a public hash alone proves neither review quality nor content truth. Retention expiry, lost artifacts or inaccessible evidence make a later verification unknown, not a recreated pass.

- **PASS:** both final novels meet the length/content/autonomy requirements; all four planning stages and all four continuity dimensions have complete current evidence; zero confirmed drift, zero unresolved findings and zero known coverage holes; budget/recovery/integrity checks pass. Blocker-free independent code review and all necessary CI must also pass for the exact implementation revision. CI success alone cannot award literary acceptance.
- **FAIL:** a final submitted candidate has confirmed drift, invalid padding, a length shortfall, a broken autonomy/integrity rule or another demonstrated contract violation. Record each failure without hiding it behind a later repair; a repaired candidate needs a new identified verdict.
- **UNKNOWN / NOT RUN:** generation or review is unfinished, a request/commit is uncertain, evidence/coverage is missing, reviewers disagree without resolution, or authorization/resources are absent. Confirmed failures remain FAIL even if other dimensions are unknown. Neither unknown nor not-run may be collapsed into PASS.

Current status: both million-character campaigns and their whole-work audits are **NOT RUN**. Required orchestration, independent review capacity, provider/disclosure authorization and calibrated resource approval remain open. The short-case readiness PR closes none of those final gates.
