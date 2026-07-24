# Design: Advanced AI quality MVP

## Crate

`crates/ai-quality-core` owns pure deterministic analyzers:

- `score_segments(&[QualitySegment]) -> QualityScoreReport`
- `semantic_qa(&[QualitySegment]) -> SemanticQaReport`
- `extract_terms(&[QualitySegment], TermExtractOptions) -> TermExtractReport`

No SQLite, no network.

## Wire

Protocol module `ai_quality` with params/results. Engine methods load document
segments from Store, call pure core, return reports. No durable tables in MVP
(stateless analysis).

## Routing bands

| Score | Route |
| --- | --- |
| 85–100 | auto |
| 60–84 | review |
| 0–59 | human |

## Semantic finding codes

- `semantic.empty_target`
- `semantic.source_equals_target`
- `semantic.number_mismatch`
- `semantic.negation_mismatch`
- `semantic.length_collapse`
