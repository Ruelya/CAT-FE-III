# Implementation Plan: Local API and CLI

## Ordered work

1. [x] Converged PRD/design/implement + research note + jsonl
2. [x] Local auth token helper (keyring + test backend)
3. [x] Local HTTP API module + unit/integration tests
4. [x] `translunar` CLI: token/serve/project/run
5. [x] Focused smoke script scope `api`
6. [x] Spec update (engine-boundary Local API/CLI full contract); commits = Orchestrator
7. [x] Quality loop F1–F6 closed (findings-3 green)

## Validation

```bash
cargo test -p translunar-engine --lib local_
cargo build -p translunar-engine --bin translunar
TRANSLUNAR_SMOKE_SCOPE=api node scripts/engine-smoke.mjs
pnpm contracts:check
cargo clippy -p translunar-engine --all-targets -- -D warnings
```

## Implement notes (2026-08-01 / closeout 2026-08-02)

- Auth: `local_auth` keyring service `translunar-cat.local-api` + account
  `default`. Tokens: 32 CSPRNG bytes, base64url unpadded; accept ≥32 decoded
  bytes. Test memory backend only when `TRANSLUNAR_API_TEST_MODE=1`; optional
  `TRANSLUNAR_API_TEST_TOKEN` validated or fails loudly (names the env var).
- HTTP: loopback TCP JSON under `/v1` (projects/import/export/qa/filters/tm/
  termbases); `/health` unauthenticated. Errors preserve Engine snake_case
  codes; bearer failures → HTTP 401 `unauthorized`.
- CLI: `translunar` — `token ensure|status|rotate`, `serve` (`--allow-remote`),
  `project list|create`, `run` (+ optional `--project-id`, `--json`).
- Tests: auth + import fixture; token never in SQLite; taxonomy unit; non-loopback
  reject; `run_pipeline` reuse; invalid test-token injection.
- Smoke `TRANSLUNAR_SMOKE_SCOPE=api`: fixed valid 32-byte base64url token; CLI
  run + second-process project list + separate `serve` document ID assert.

## Acceptance honesty

| AC | Status | Notes |
| --- | --- | --- |
| AC-01 loopback + bearer | met | verify-1 + findings-3 |
| AC-02 authenticated workflow | met | unit + smoke/verify HTTP path |
| AC-03 CLI durability | met | second-process list + serve document assert |
| AC-04 token storage | met (test memory) | OS keyring path not live-exercised in disposable runs |
| AC-05 stdio + gates | met | stdio probe + focused local_ tests + api smoke + clippy |

Residual / out of scope: live OS keyring prompts; X-03..X-07 automation.
