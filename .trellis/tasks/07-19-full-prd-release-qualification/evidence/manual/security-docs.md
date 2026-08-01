# Security / docs / governance spot check

**Candidate:** `8c8df12`

## Docs presence (`pnpm docs:check`) — pass

- `docs/packaging.md`, `docs/tutorial.md`, `docs/contributing.md`
- `docs/plugins/README.md`, `docs/plugins/external-connector-sdk.md`
- `docs/release-signing.md`, `docs/accessibility-matrix.md`
- `LICENSE` (Apache-2.0), `SECURITY.md`, `CODE_OF_CONDUCT.md`

## Code-level signals (unit evidence, not full audit)

| Control | Evidence | Status |
| --- | --- | --- |
| OS keyring for AI credentials | `crates/engine/src/ai.rs` keyring entry + unit tests (`unavailable_keyring…`, credential lifecycle) | partial |
| Loopback API token auth | local_api / local_auth tests + `TRANSLUNAR_SMOKE_SCOPE=api` | pass (focused) |
| Token not persisted in SQLite | `local_auth` unit test | pass |
| Backup excludes secrets | storage backup unit tests | pass |
| Path safety (desktop) | `path-safety.test.ts` | pass |
| Telemetry default off | not re-audited end-to-end this run | not-run |
| Signing secrets | absent; unsigned package only | blocked-external |

## Verdict

**partial** for AC9: documentation inventory green; full security campaign and redaction audit not completed as a dedicated release lane.
