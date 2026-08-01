# Advanced AI and quality intelligence

## Goal

Add explainable quality-intelligence foundations on top of the existing AI and QA
stacks: offline QE scoring with route bands, semantic QA findings, and
terminology candidate extraction. Optional provider judges may enrich results
but offline heuristics must work without network access.

## Confirmed baseline

- Grounded interactive/batch AI, provider catalog, and usage tracking exist.
- Mechanical QA profiles/runs/issues/gates exist.
- Curation already has offline quality scores and term mining for TM units.
- No dedicated QE route API, semantic-QA issue family, or document term-extract
  workflow is exposed yet.

## Scope (this child MVP)

### R1. Offline QE scoring and routing (F-08)

- Score each segment 0–100 with deterministic offline features (length ratio,
  number/placeholder retention, source-equals-target, emptiness, punctuation).
- Map scores to routes: `auto` (≥85), `review` (60–84), `human` (<60).
- Return per-segment explanation factors; never silently alter export gates.

### R2. Semantic QA findings (H-10 / G-05)

- Produce structured semantic findings distinct from mechanical QA rule IDs.
- Offline detectors cover: empty/missing translation, source equals target,
  likely negation mismatch, number token loss/gain, and obvious length collapse.
- Findings include segment id, code, severity, confidence basis points, and
  bounded evidence text.

### R3. Terminology candidate extraction (E-06)

- Extract bounded candidate source terms from a document's source segments with
  frequency and example segment ids.
- Suggest a target candidate when the same source co-occurs with a stable target
  string; otherwise leave target empty for human confirmation.
- Do not auto-write termbases; callers must upsert explicitly later.

### R4. Engine protocol surface

- Additive methods:
  - `ai.quality.scoreDocument`
  - `ai.quality.semanticQa`
  - `ai.quality.extractTerms`
- Advertise `ai.quality.offline` capability.

## Out of scope (later increments / still open)

- COMET/local embedding model bundling, project RAG sidepanel, agentic multi-step
  pipelines, multimodal OCR assist, style cards, fuzzy repair auto-apply,
  adaptive few-shot memory, and provider-only judges as hard requirements.
- Changing default export gate behavior based on QE without explicit user action.

## Acceptance criteria

- [x] AC-01: Scoring a fixture document returns one score+route per segment with
      explanations and is deterministic across runs.
- [x] AC-02: Semantic QA returns structured findings for planted empty/equal/
      number-mismatch cases without requiring a provider.
- [x] AC-03: Term extraction returns bounded candidates with frequencies for a
      repeated-source fixture and never writes the termbase by itself.
- [x] AC-04: Focused unit tests and Engine smoke scope `ai-quality` pass; desktop
      stdio path remains compatible.

## Constraints

- Heavy models stay optional; offline heuristics are the default path.
- Preserve unrelated dirty worktree paths.
