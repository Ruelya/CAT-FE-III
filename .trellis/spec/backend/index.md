# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide                                           | Description                                                         | Status  |
| ----------------------------------------------- | ------------------------------------------------------------------- | ------- |
| [M0 Engine Boundary](./engine-boundary.md)      | Headless engine, JSON-RPC, storage, DOCX, and transaction contracts | Active  |
| [Directory Structure](./directory-structure.md) | Module organization and file layout                                 | To fill |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations                                   | To fill |
| [Error Handling](./error-handling.md)           | Error types, handling strategies                                    | To fill |
| [Quality Guidelines](./quality-guidelines.md)   | Code standards, forbidden patterns                                  | To fill |
| [Logging Guidelines](./logging-guidelines.md)   | Structured logging, log levels                                      | To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

## Pre-Development Checklist

- Read [M0 Engine Boundary](./engine-boundary.md) before changing any Rust
  crate, protocol payload, migration, DOCX behavior, engine CLI, or persistence
  side effect.
- Keep `crates/protocol` authoritative and regenerate TypeScript contracts for
  every wire change.
- Map a write through protocol -> engine service -> storage transaction before
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
