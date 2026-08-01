# Implement: Advanced AI quality MVP

1. [x] PRD/design/research/jsonl
2. [x] `ai-quality-core` + tests
3. [x] protocol + engine methods + contracts
4. [x] smoke scope `ai-quality`
5. [x] specs honesty in task artifacts (commit/archive = Orchestrator)

## Verified (implement self-check)

- `cargo test -p translunar-ai-quality-core` — 3 passed
- `TRANSLUNAR_SMOKE_SCOPE=ai-quality node scripts/engine-smoke.mjs` — passed
- Capability `ai.quality.offline` advertised; methods report-only (no termbase write)
