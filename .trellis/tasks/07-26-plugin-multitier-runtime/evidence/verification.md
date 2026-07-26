# Verification evidence: plugin multi-tier runtime

Date: 2026-07-26

This evidence records commands actually run for the child task. It does not
claim Tier 1 evaluation, Tier 2 sandbox execution, permission-grant policy, or
non-filter adapters; those remain owned by later children in the Full PRD
plan.

## Focused implementation checks

| Area | Command | Result |
| --- | --- | --- |
| Task context | `python ./.trellis/scripts/task.py validate 07-26-plugin-multitier-runtime` | Passed (`implement.jsonl` 7 entries, `check.jsonl` 5 entries) |
| Runtime normalization and host | `cargo test -p translunar-plugin-runtime` | Passed: 10 tests |
| Migration/version store | `cargo test -p translunar-storage` | Passed: 96 tests |
| Engine lifecycle | `cargo test -p translunar-engine` | Passed: 75 tests |
| Rust lint | focused `cargo clippy` for runtime, storage, and engine with `-D warnings` | Passed |
| Engine binary | `cargo build -p translunar-engine` | Passed |
| Protocol contracts | `pnpm contracts:check` | Passed: contracts current |
| Public SDK | `pnpm --filter @translunar/plugin-sdk test` | Passed: 9 tests |
| Public SDK build | `pnpm --filter @translunar/plugin-sdk build` | Passed |
| Plugin smoke | `$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs` | Passed |
| Whitespace | `git diff --check` | Passed; unrelated Trellis files only emitted line-ending notices |

The focused plugin smoke covers inspect/history, successful upgrade, restart,
failed candidate retention, rollback, unsupported declarative inventory, and
the existing process-plugin lifecycle.

## Repository quality gates

| Command | Result |
| --- | --- |
| `pnpm format:check` | Passed after Prettier formatting of the SDK and smoke additions |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed for contracts, SDK, Electron, renderer, and E2E configs |
| `pnpm test` | Passed: toolchain tests, SDK tests, 24 desktop unit files/145 tests, and full Rust workspace tests |
| `cargo test --workspace` (final path-normalization regression) | Passed: full workspace, including 10 plugin-runtime tests |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --workspace --all-targets -- -D warnings` | Passed |
| `pnpm build:desktop` | Passed; Vite emitted the existing informational large-chunk warning |
| `pnpm test:e2e:desktop` | Passed: 29 passed, 1 skipped, 30 total; plugin lifecycle and degraded-plugin flows passed, with no reported console/page errors |
| `pnpm docs:check` | Passed |

The skipped desktop test is the scanned-PDF workbench case. The workstation
has `pdftotext`, but not the optional `pdfinfo`, `pdftoppm`, and `tesseract`
tools documented in `docs/contributing.md`; PDF E2E is therefore skipped by
its existing environment guard.

The unscoped `pnpm test:e2e:engine` was also attempted. It stopped at the
first PDF fixture because `pdfinfo` is unavailable and the PDF probe correctly
returned `unsupported_document`/no-match. This is an environment prerequisite,
not a plugin-runtime failure; the plugin-focused smoke above is the scoped
evidence for AC2–AC5. No claim is made that the optional-tool full smoke passed.

## Acceptance mapping

- **AC1:** Migration-18 fresh/upgrade/reopen, missing-package diagnostics,
  immutable-history, FK/unique/rollback, and normalization tests pass in the
  storage suite.
- **AC2:** Legacy process manifest and hello-SRT lifecycle remain covered by
  runtime/Engine tests, focused smoke, and the existing desktop plugin flows.
- **AC3:** Runtime tests cover all three tiers and seven contribution kinds,
  camelCase v2 fields, duplicate/unknown-version rejection, path and reserved
  ID validation, and unsupported-capability inventory behavior.
- **AC4:** Engine tests and smoke cover staged hashes, immutable package roots,
  blue/green upgrade, candidate failure retention, duplicate conflicts, and
  restart-safe rollback.
- **AC5:** Storage/Engine tests cover expected-revision CAS, one-time revision
  increments, plugin isolation, quarantine uninstall, and stale crash guards.
- **AC6:** Contracts, SDK, Rust workspace, focused smoke, desktop build, and
  desktop E2E gates pass; the only unfulfilled full-gate portion is the
  optional PDF-tool-dependent unscoped smoke/test case described above.
