# Closeout summary: 07-19-advanced-ai-quality

## What shipped

Offline quality-intelligence MVP on top of existing AI/QA stacks:

| Surface | Behavior |
| --- | --- |
| Crate `translunar-ai-quality-core` | Pure deterministic analyzers: `score_segments` / `semantic_qa` / `extract_terms` (no SQLite, no network) |
| Engine methods | `ai.quality.scoreDocument`, `ai.quality.semanticQa`, `ai.quality.extractTerms` — load segments from Store, return reports only |
| Capability | `ai.quality.offline` advertised on initialize |
| QE scoring (R1) | Per-segment 0–100 with factors; routes `auto` (≥85) / `review` (60–84) / `human` (<60); does not alter export gates |
| Semantic QA (R2) | Codes: `semantic.empty_target`, `semantic.source_equals_target`, `semantic.number_mismatch`, `semantic.negation_mismatch`, `semantic.length_collapse` |
| Term extraction (R3) | Bounded candidates + frequency + example segment ids; **no** termbase writes |

### Quality fixes closed (findings-2 green)

- **F1 (major, fixed):** `suggestedTarget` uses **strict majority** only (`count * 2 > frequency`); 50/50 ties leave target empty. Unit: `suggested_target_uses_strict_majority_not_tie`.
- **F2 (minor, fixed):** Offline QE includes `punctuation_mismatch` (−15) via language-safe ASCII/CJK sentence-mark kind multiset. Unit: `punctuation_mismatch_factor_affects_score`.
- **F3 (major, fixed):** Independent `review/verify-1.md` with `mission_status: satisfied` (core tests, protocol tests, engine build, `pnpm contracts:check`, focused `ai-quality` smoke).

## Specs touched

| Path | Change |
| --- | --- |
| `.trellis/spec/backend/engine-boundary.md` | Extended **Offline AI quality intelligence**: punctuation factor contract, route bands, strict-majority term suggestion rule (F1/F2 codified briefly) |

No new layer docs or index changes required.

## Task artifacts (for commit)

- `prd.md` / `design.md` / `implement.md` / `task.json` / `research/ai-quality-baseline.md`
- `review/findings-1.md`, `review/findings-2.md`, `review/verify-1.md`
- `closeout-summary.md` (this file)
- Product delta still uncommitted at closeout time: `crates/ai-quality-core/src/lib.rs` (+F1/F2)

## Suggested commit

**Subject:**

```text
feat(ai-quality): offline QE, semantic QA, term extract + strict majority
```

**Body:**

```text
Add ai-quality-core analyzers and Engine ai.quality.* report-only methods
with ai.quality.offline capability.

- QE: deterministic segment scores/routes including punctuation_mismatch
- Semantic QA: offline empty/equal/number/negation/length findings
- Term extract: bounded candidates; suggestedTarget only under strict majority
  (count*2 > frequency); never writes termbase
- Codify offline quality contracts in engine-boundary
- Task review green (findings-2); residual thin smoke assertions accepted
```

## Residual risks

| Id | Severity | Notes |
| --- | --- | --- |
| **V4** | accepted residual | Focused smoke (`TRANSLUNAR_SMOKE_SCOPE=ai-quality`) asserts `scores.length >= 2`, one semantic code (`source_equals_target`), and actuator term candidate only — not full AC wording (exact score-row count, all planted semantic codes, offline capability string on initialize, `maximumCandidates` truncation, termbase read-back). Unit tests + static wiring cover implemented behavior; optional later smoke hardening. |
| **V5** | optional | `maximumCandidates` truncate path exists but is not unit-forced with max=1 multi-candidate fixture. |
| Commit scope | process | Orchestrator must include uncommitted `ai-quality-core` F1/F2 fix + task/spec artifacts; do not archive until merge policy runs. |

## Ready for Orchestrator

- Quality: **green** (`ready_for_closeout: yes` in findings-2)
- Closeout: specs updated for F1/F2; summary written
- **No git commit/merge** performed by closeout worker
- **No task archive** (Orchestrator / finish-work policy)
