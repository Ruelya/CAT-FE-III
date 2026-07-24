# Implementation Plan: Local API and CLI

## Ordered work

1. [x] Converged PRD/design/implement + research note + jsonl
2. [ ] Local auth token helper (keyring + test backend)
3. [ ] Local HTTP API module + unit/integration tests
4. [ ] `translunar` CLI: token/serve/project/run
5. [ ] Focused smoke script scope `api`
6. [ ] Spec update + scoped commits

## Validation

```bash
cargo test -p translunar-engine --lib local_
cargo build -p translunar-engine --bin translunar
TRANSLUNAR_SMOKE_SCOPE=api node scripts/engine-smoke.mjs
pnpm contracts:check
cargo clippy -p translunar-engine --all-targets -- -D warnings
```
