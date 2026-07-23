# Backend Quality Guidelines

## Required Design Properties

- Rust owns domain rules, persistence, formats, QA, TM, and pipelines.
- `crates/protocol` is the wire source of truth; generated TypeScript and JSON
  Schema are committed and checked for drift.
- Every mutable domain operation states its transaction, revision, and
  rollback behavior.
- Import preserves an immutable managed source. Export changes only owned
  structures and validates before publication.
- Collections crossing a boundary have deterministic ordering and explicit
  pagination/limits where they can grow.

Use pure helpers for normalization, hashing, token comparison, and projections.
Keep I/O in storage/filter/service boundaries. Follow the existing
`Store -> EngineService -> RpcDispatcher` path rather than bypassing a layer.

## Forbidden Patterns

- SQL, ZIP/XML parsing, or domain transitions in Electron.
- Handwritten TypeScript mirrors of Rust protocol structs.
- Runtime `unwrap`/`expect`, ignored `Result`, or a panic for user data.
- Floating writes without an expected revision or transaction.
- Editing a released migration or mutating an export destination before
  validation succeeds.
- Tests that only assert a mock returns the value configured on that mock.

## Tests By Layer

- Domain: pure normalization, hashes, tags/numbers, state invariants, and edge
  cases including CJK and empty values.
- Storage: fresh/upgrade migration, restart recovery, conflict, rollback,
  ordering, uniqueness, and cascade behavior against real temporary SQLite.
- Format: representative fixtures, malformed input, complete extraction,
  round-trip, and preservation of unowned package parts.
- Protocol/engine: serde casing, method catalog, handshake, typed error data,
  capability reporting, and full service flows.
- Process: `scripts/engine-smoke.mjs` drives the actual stdio binary and checks
  restart, persistence, QA/TM, and exported output.

Tests may use `expect` for setup clarity. Production code should return a
typed failure. A regression test must fail if the behavior being protected is
removed; avoid tautological assertions.

## Quality Gate

Run with the repository-supported Rust toolchain:

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm contracts:check
pnpm test:e2e:engine
```

When a change crosses into Electron, also run `pnpm typecheck`, `pnpm test`,
and the desktop E2E suite. On this Windows workstation, if native linking is
unavailable, run the same Rust commands in the clean VPS checkout and record
the exact revision; do not replace compilation with static inspection.

## Review Checklist

- Contract, migration, generated output, and all consumers changed together.
- Error code/data remain stable and no sensitive content is exposed.
- Side effects are atomic and retry behavior is explicit.
- IDs/locales/timestamps/counts survive a storage and JSON round trip.
- Tests cover good, base, malformed, stale, and restart cases.
- `cargo fmt`, strict clippy, unit/integration tests, contract drift, and the
  relevant process smoke all pass.

## Evidence And Cross-Platform Builds

When the Windows linker is unavailable locally, run Rust fmt/clippy/tests,
schema generation, the real stdio smoke, and (when needed) the Windows GNU
cross-build on `ssh moehub`. Compare the VPS-generated schema and locally
generated TypeScript to the committed files; do not claim a local
`contracts:check` pass from static inspection. Use `TRANSLUNAR_ENGINE_PATH` in
the Electron E2E harness to test a synchronized binary without replacing an
engine process currently in use.

Before counting that Electron run, compare the copied Engine SHA-256 with the
cross-build output and run one focused test that calls a method added by the
current task. An older binary can still initialize successfully and then
return `unknown method`, which otherwise looks like a renderer action failure.

```text
sha256sum target/x86_64-pc-windows-gnu/release/translunar-engine.exe
(Get-FileHash target/e2e/translunar-engine-current.exe -Algorithm SHA256).Hash
pnpm --filter @translunar/desktop exec playwright test <spec> -g <current-flow>
```
