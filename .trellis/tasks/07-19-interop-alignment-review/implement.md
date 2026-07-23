# Implementation Plan: Interoperability, Alignment, And Offline Review

## 1. Task Tree And Order

- [x] `interop-cat-formats`: SDLXLIFF, MQXLIFF/MQXLZ, dialect XLIFF fixtures,
      native conservative writeback, Engine registry and desktop selection.
- [x] `interop-bilingual-docx`: bilingual review DOCX diff/apply and generic
      DOCX/XLSX bilingual table-to-TM preview/apply.
- [x] `alignment-reference-corpora`: alignment sessions/editor/TM apply and
      project-mounted reference corpus search/AI grounding.
- [x] `offline-task-packages`: bounded task export, validation, three-way
      conflict preview and transactional selected merge.
- [x] `discussion-project-snapshots`: threaded discussion, mentions, named
      snapshot preview/restore and integrated history.
- [x] Run parent integration review and map AC1..AC8 to child evidence.

## 2. Per-Child Execution

For every child, in dependency order:

1. Read parent and child PRD/design/implement artifacts plus applicable specs.
2. Add pure domain/format primitives and adversarial fixtures first.
3. Add additive migration/storage transactions when durable state is needed.
4. Add protocol structs/catalog/dispatch and regenerate TypeScript contracts.
5. Extend stdio smoke through success, stale, malformed, no-clobber and restart.
6. Add desktop orchestration and real-Engine Electron workflow where required.
7. Run focused checks, then the full local/VPS gate; update executable specs.
8. Commit and archive the child before starting its dependent successor.

## 3. Validation Commands

```powershell
pnpm format:check
pnpm exec eslint apps packages/contracts/src
pnpm typecheck
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
pnpm test:e2e:desktop
```

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm contracts:check
node scripts/engine-smoke.mjs
cargo build --release -p translunar-engine
cargo build --release --target x86_64-pc-windows-gnu -p translunar-engine
```

Child-specific tests add XML/ZIP adversarial corpora, DOCX rendering/re-import,
alignment quality fixtures, corpus ranking/grounding, task-package conflict
matrices, snapshot round trips, and screenshot/overflow checks.

## 4. Review Gates

- Native output reparses in the vendor-specific adapter and preserves every
  unowned entry/namespace/attribute required by its fixture manifest.
- No renderer code imports filesystem, XML, ZIP, DOCX, scoring or merge logic.
- Every apply operation is expected-revision protected, atomic and restart-safe.
- Credentials, private provider payloads and unrelated shared assets never
  enter packages, snapshots, logs, errors or renderer state.
- Existing format/editor/AI/QA/lifecycle smoke and Electron suites stay green.

## 5. Rollback Points

- Do not reuse ordinary project archives as offline task packages; their merge
  and identity semantics differ.
- Do not make the general XLIFF filter silently claim private-format fidelity.
- Do not write alignment candidates or imported table rows to TM before an
  explicit preview/apply boundary.
- Do not make snapshots overwrite shared libraries or erase current history.

## 6. Parent Integration Evidence (2026-07-23)

### Child closure

- `07-21-interop-cat-formats` and `07-21-interop-bilingual-docx` are archived
  with fixture-backed native round trips, bounded XML/ZIP/DOCX/XLSX handling,
  review/table transactions, and real-Engine coverage.
- `07-21-alignment-reference-corpora` is archived with deterministic alignment,
  provenance-bearing TM apply, corpus lifecycle/search, concordance/grounding,
  and responsive Electron coverage.
- `07-21-offline-task-packages` is archived with canonical package validation,
  complete conflict previews, atomic selected merge, restart/idempotence, and
  assignment/return Electron coverage.
- `07-21-discussion-project-snapshots` is archived with revision-bound threads,
  immutable snapshots, stale/duplicate/missing/rollback handling, restart
  recovery, and Project Insights coverage.

### Final cross-child gates

- Local Windows Node `v22.17.0` / pnpm `10.18.3`: Rust format check, generated
  contract drift, scoped ESLint, desktop Electron/renderer/E2E typecheck, 7
  Vitest files (25 tests), and the production desktop build passed.
- The real-Engine Electron suite ran against the current Windows GNU Engine:
  13 tests ran, 12 passed, and one explicit optional-PDF test was skipped. It
  covered all five child workflows, restart/stale/no-clobber paths, named
  controls, console/page errors, responsive screenshots, and the 10,000-segment
  performance budget.
- The regenerated discussion/snapshot captures at 1250x744, 1680x942, and
  1920x1080 were manually inspected after the final run; the narrow two-column
  and wide three-column layouts had no overlap, clipping, or text escape.
- The authoritative Windows GNU Engine was cross-built on the synchronized
  VPS tree and copied to the local E2E harness. SHA-256:
  `912481606a52578773b27f59c28e4178e1840cc696da51da9d3c96c879ebbea2`.
- VPS `/home/ubuntu/workspaces/cat-translunar-m0` passed `cargo fmt --check`,
  strict workspace Clippy, `cargo test --workspace` (including Engine 52 and
  Storage 78 tests), contract drift, and the real `scripts/engine-smoke.mjs`.
  Linux release and Windows GNU release builds both completed; the Linux
  release SHA-256 is
  `e35a848c1021765e13b7974b8bc4006a1a36fbafc2379e0fdd519f6b93a12d1d`.

### Acceptance mapping

| Parent AC | Evidence | Result |
| --- | --- | --- |
| AC1 | CAT-format archive evidence, adversarial filter tests, smoke round trips, and Electron interop flow | Pass |
| AC2 | Bilingual review archive evidence, manifest/tamper/stale tests, atomic apply, restart, and E2E | Pass |
| AC3 | Bilingual table archive evidence, DOCX/XLSX row tests, TM provenance/rollback tests, and E2E | Pass |
| AC4 | Alignment/corpus archive evidence, deterministic/link/TM/corpus tests, grounding smoke, and E2E | Pass |
| AC5 | Offline package archive evidence, conflict/hash/rollback/idempotence tests, smoke, and E2E | Pass |
| AC6 | Discussion/snapshot archive evidence, history/restart/restore tests, smoke, and E2E | Pass |
| AC7 | Combined stdio smoke and real-Engine Electron suite with stale/error/restart, accessibility, console, and overflow assertions | Pass |
| AC8 | Local Node 22 lint/typecheck/unit/build/Electron plus isolated VPS format/Clippy/contracts/workspace tests/smoke/release/Windows GNU build | Pass |

The local Windows cross-compile was also attempted and is blocked only by the
host's missing `bcryptprimitives.dll_imports.lib` and
`ntdll.dll_imports.lib`; the required Windows GNU artifact was produced on the
VPS and verified by hash before Electron acceptance.
