# Implementation Plan: M0 Vertical Slice

## Preconditions

- Work serially; do not create parallel implementation branches.
- Preserve the fixed Electron + TypeScript / Rust engine / SQLite boundary.
- Run `trellis-before-dev` before editing implementation code.
- Do not port business rules into the renderer to make a demo pass.

## 1. Bootstrap and Contracts

- [x] Install/configure a stable Rust toolchain and record the pinned toolchain.
- [x] Create root pnpm/Cargo workspaces, formatting, linting, and test commands.
- [x] Scaffold protocol/domain/storage/filter-docx/engine crates.
- [x] Define JSON-RPC request/result/error types and protocol handshake.
- [x] Export JSON Schema and generate checked TypeScript contract types.
- [x] Gate: Rust and TypeScript contract round-trip tests pass.

## 2. Storage and Domain

- [x] Implement data-directory layout and engine-owned SQLite connection.
- [x] Add atomic versioned migrations and WAL/foreign-key configuration.
- [x] Implement project/document/segment/TM/QA repositories.
- [x] Implement segment state machine, normalization, UUIDv7 identities, hashes,
      and optimistic revision conflicts.
- [x] Gate: restart/recovery, stale-write, and migration rollback tests pass.

## 3. DOCX Filter and Pipeline

- [x] Define filter event and pipeline contracts in the domain crate.
- [x] Build deterministic DOCX fixtures with body paragraphs, table text,
      multiple runs, an untranslated paragraph, and an unrelated package part.
- [x] Implement conservative DOCX package validation and body-unit extraction.
- [x] Persist import in one transaction with managed source cleanup on failure.
- [x] Implement translated package export via ZIP/XML event copying.
- [x] Validate exported package and atomic destination publication.
- [x] Gate: round-trip tests prove translated, untranslated, and unrelated parts.

## 4. TM and QA Services

- [x] Implement transactional confirm + provenance TM upsert.
- [x] Implement exact normalized-source lookup.
- [x] Implement number-token normalization, mismatch evidence, and issue
      reconciliation.
- [x] Gate: duplicate-confirm, 30/60 mismatch, and resolved-after-correction tests
      pass.

## 5. Engine Server

- [x] Compose services behind JSON-RPC methods.
- [x] Reserve stdout for protocol and add structured stderr diagnostics.
- [x] Add request validation, stable error mapping, and graceful shutdown.
- [x] Add a scripted stdio smoke client covering the complete engine flow.
- [x] Gate: a fresh process imports, saves, restarts, confirms, queries TM/QA,
      exports, and exits cleanly.

## 6. Electron Application

- [x] Scaffold Electron main/preload/React renderer with secure BrowserWindow
      defaults.
- [x] Spawn, initialize, monitor, restart, and stop the engine from Electron main.
- [x] Expose only generated typed commands through preload.
- [x] Implement the Translunar project/import and focused editor workflow from
      the approved prototype.
- [x] Implement debounced save, composition guard, confirm-and-advance, TM/QA
      panels, engine-derived counts, and export.
- [x] Gate: renderer tests contain no duplicated domain state transitions or QA
      logic.

## 7. End-to-End Verification

- [x] Run formatter, clippy with warnings denied, Rust unit/integration tests.
- [x] Run TypeScript format/lint/type-check/unit tests and schema drift check.
- [x] Run engine process smoke test against a temporary data directory.
- [x] Run Electron/Playwright workflow at 1250x744 and 1680x942.
- [x] Restart during a saved draft and verify recovery.
- [x] Inspect exported DOCX as ZIP/XML and open it with an available office tool
      when present.
- [x] Record exact commands and known slice limitations in README documentation.

## Validation Commands

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm contracts:check
pnpm test:e2e:engine
pnpm test:e2e:desktop
```

## Risk and Rollback Points

- **Protocol drift:** generated schema/types are committed together; revert the
  protocol commit if Electron and engine cannot negotiate version 1.
- **Migration failure:** never mutate a released migration; add a new migration.
  During this unreleased slice, delete only test/temp databases, never user data.
- **DOCX corruption:** keep the original managed copy immutable and publish only a
  validated temporary export.
- **UI shortcut/IME regression:** confirmation remains engine-acknowledged and is
  suppressed for the entire composition interval.
