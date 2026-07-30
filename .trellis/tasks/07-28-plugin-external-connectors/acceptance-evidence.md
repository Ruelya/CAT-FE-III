# Acceptance evidence: External System Connector SDK

## Final review

Independent review of `c55cbe7` found that all lifecycle registrations used a
deterministic in-process fixture host. That contradicted R3 and production tier
semantics and left AC-02/AC-03 unproved. Production registrations now select a
real Tier 1 blocking HTTP host, Tier 2 QuickJS host, or Tier 3 supervised process
host; the deterministic fixture host is test-only. Review also fixed a late
exact-generation finalization race, V2 process normalization for connector-only
plugins, SDK limit merging, generated method-catalog drift, and keyring status
reconciliation.

## Acceptance mapping

| AC | Executable evidence |
| --- | --- |
| AC-01 | `translunar-plugin-runtime external_connector` tests cover closed descriptors, request/failure bounds, unknown fields and required operations; SDK suite passes 37 tests. |
| AC-02 | `official_external_connector_fixture_runs_all_exchange_operations_through_process_host` starts the public-SDK-only official fixture through `PluginProcess` and completes authenticated pull/push/poll plus HMAC-signed webhook; invalid signature is a closed authentication failure. |
| AC-03 | Tier routing is explicit in `plugin.rs`; Tier 1 HTTP and Tier 2 named-credential tests pass, and the official Tier 3 process test passes. Existing sandbox/process timeout, malformed response, cancellation and recovery tests remain green. |
| AC-04 | Engine uses the dedicated `translunar-cat.external-connector` keyring namespace and injects memory storage in tests. SQLite stores slot presence only; storage tests assert checkpoint/config payloads contain no secret. Invocation contexts clear/zeroize credential values on every exit path. |
| AC-05 | Registration and invocation call `external.connector` for the exact contribution/operation and `network.connect` for every normalized origin. Lifecycle capability tests cover deny/revoke isolation. |
| AC-06 | `finalize_external_connector_success` atomically finalizes the invocation and CAS checkpoint. `failure_does_not_advance_checkpoint`, restart round-trip, and the post-host exact-generation check cover failure/cancel/stale-generation no-advance. |
| AC-07 | Store claim/replay returns completed same-hash receipts and rejects changed hashes; checkpoint tests cover stable replay. No connector job or outbox schema was added. |
| AC-08 | Exact owner tokens include plugin/version/activation/contribution/contract. Existing enable/restart/disable/upgrade/rollback/degrade/uninstall lifecycle tests pass except the unrelated declarative-filter baseline listed below; candidate compensation tests remain green. |
| AC-09 | Registry collision preflight and exact detach tests protect unrelated connectors and built-ins; cross-plugin lifecycle tests remain green. |
| AC-10 | Generated contracts, SDK/examples, docs, typecheck, strict workspace Clippy and focused Rust suites pass. Full-gate baseline failures are recorded below. |
| AC-11 | `docs/plugins/external-connector-sdk.md` and fixture README assign durable jobs, retries, webhook HTTP routing, application writes and X-07 to automation. Fixture source imports only `@translunar/plugin-sdk`. |
| AC-12 | This file maps all twelve ACs to code/tests, records supported-toolchain commands, secret scan results, ordinary Engine health and cross-plugin coverage, and residual risk. |

## Validation record

Supported toolchains: Node `24.17.0`; repository Rust toolchain; alternate
`CARGO_TARGET_DIR=W:\cargo-target-plugin-external-connectors` after the local K:
target exhausted disk/PDB capacity.

Passing commands:

- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `pnpm lint` (ESLint plus strict workspace Clippy)
- `pnpm --filter @translunar/plugin-sdk test` (37 passed)
- `node --test scripts/external-connector-examples.test.mjs` (2 passed)
- `pnpm contracts:check`, `pnpm typecheck`, `pnpm docs:check`
- `cargo test -p translunar-plugin-runtime external_connector`
- `cargo test -p translunar-storage external_connector`
- `cargo test -p translunar-engine plugin_external_connector --lib` (2 passed)
- `cargo test -p translunar-plugin-runtime official_external_connector_fixture_runs_all_exchange_operations_through_process_host --lib`
- `cargo test -p translunar-plugin-runtime sandbox::tests::named_credential_slots_are_ephemeral_and_cleared_together --lib`
- The final combined Rust rerun exceeded the command wrapper while linking on
  Windows; after the background linker completed, the storage and Engine focused
  suites reran cleanly (2/2 each), and all three plugin-runtime focused suites
  had already completed successfully before that wrapper timeout.
- `pnpm test` reached 174/174 desktop tests and the full Rust matrix before the stable baseline Engine failure below.

Repository baseline/environment failures, reproduced independently of connector
changes:

- GitHub Actions run `30511971473` for PR #2 stops at the same three pre-task
  gates as `master` run `30494253588`: Linux Rust format reports the repository's
  existing CRLF newline baseline, while both Node jobs stop at Electron's SUID
  sandbox integrity check. The matching `master` failure proves these red gates
  are not introduced by the connector diff; no downstream CI step ran.
- `pnpm format:check`: repository-wide Prettier baseline reports 185 files;
  every task-owned JS/TS/JSON/Markdown file passes targeted Prettier, and Rust fmt
  passes.
- `cargo test --workspace` / `pnpm test`: stable unrelated failure
  `plugin::tests::declarative_toolkit_runs_without_a_process_and_survives_restart`
  (`source contains no declarative filter units`). A parallel workspace run also
  saw one timing-sensitive AI-core deadline assertion, which passed immediately
  in isolation and on the subsequent `pnpm test` run.
- `$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs`: existing
  plugin rollback assertion `failed candidate rolls back to the active projection
  with audited revisions`.
- `pnpm test:e2e:engine`: existing smoke fixture/environment failure importing
  `fixtures/pdf/text-layout.pdf` (`no filter matched the source`).

## Secret and boundary review

- Task evidence/docs/generated contracts were scanned for the fixture credential;
  no value was found. The deterministic credential literal remains confined to
  official fixture implementation code; the Rust acceptance test constructs it
  without embedding the complete value in diagnostics/evidence.
- SQLite stores configuration/checkpoint/result hashes and credential presence,
  never credential values. Safe failures use closed messages and reject secret
  markers; Tier 1 response bodies/headers and process diagnostics are not echoed.
- No automation jobs, outbox tables, webhook listener, CAT application writes,
  direct database handle, filesystem path, or generic Engine invoke API was added.

## Residual risk

1. Tier 1 maps non-GET operation envelopes beneath the fixed JSON `request` key.
   This is closed and bounded, but vendor-specific body templates remain future
   contract work rather than silently accepting plugin-selected paths.
2. Synchronous Tier 1 and Tier 3 calls cannot be interrupted inside reqwest/child
   call polling after detach; teardown marks the lease canceled and now rejects
   every late result before durable finalization, while the configured deadline
   bounds host completion.
3. Management UI and public webhook ingress remain intentionally out of scope.
