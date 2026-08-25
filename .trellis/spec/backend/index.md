# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory describes the Rust workspace conventions currently used by the
headless engine and its persistence/format layers.

---

## Guidelines Index

| Guide                                           | Description                                                         | Status                        |
| ----------------------------------------------- | ------------------------------------------------------------------- | ----------------------------- |
| [M0 Engine Boundary](./engine-boundary.md)      | Headless engine, JSON-RPC, storage, DOCX, and transaction contracts | Historical (pre-greenfield)   |
| [Directory Structure](./directory-structure.md) | Module organization and file layout                                 | Historical (pre-greenfield)   |
| [Database Guidelines](./database-guidelines.md) | Direct SQLite queries and migrations                                | Historical (no database yet)  |
| [Error Handling](./error-handling.md)           | Typed errors and JSON-RPC mapping                                   | Active (see greenfield note)  |
| [Quality Guidelines](./quality-guidelines.md)   | Code standards, testing, and review gates                           | Active (see greenfield note)  |
| [Logging Guidelines](./logging-guidelines.md)   | Structured stderr diagnostics                                       | Active                        |

---

## Maintenance

The files below are source-backed rules. Update the relevant file when a
verified implementation convention changes; do not add aspirational rules that
the workspace does not yet enforce.

## Pre-Development Checklist

- Read `docs/architecture.md` for the current process, protocol, and
  persistence boundaries; [M0 Engine Boundary](./engine-boundary.md) remains
  useful for the underlying principles but describes the pre-greenfield tree.
- Keep `crates/tl-protocol` authoritative and regenerate TypeScript contracts
  (`pnpm contracts:generate`, checked by `pnpm contracts:check`) for every
  wire change.
- Map a write through protocol -> engine service -> store save before
  implementation.

## Quality Check

- Run `cargo fmt --all -- --check` and
  `cargo clippy --workspace --all-targets -- -D warnings`.
- Run `cargo test --workspace`, `pnpm contracts:check`, and
  `pnpm test:e2e:engine`.
- For cross-layer changes, also run the Electron E2E workflow and prove the
  renderer did not acquire domain or persistence rules.

---

**Language**: All documentation should be written in **English**.
