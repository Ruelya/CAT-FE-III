# Implementation Plan: Interoperability, Alignment, And Offline Review

## 1. Task Tree And Order

- [ ] `interop-cat-formats`: SDLXLIFF, MQXLIFF/MQXLZ, dialect XLIFF fixtures,
      native conservative writeback, Engine registry and desktop selection.
- [ ] `interop-bilingual-docx`: bilingual review DOCX diff/apply and generic
      DOCX/XLSX bilingual table-to-TM preview/apply.
- [ ] `alignment-reference-corpora`: alignment sessions/editor/TM apply and
      project-mounted reference corpus search/AI grounding.
- [ ] `offline-task-packages`: bounded task export, validation, three-way
      conflict preview and transactional selected merge.
- [ ] `discussion-project-snapshots`: threaded discussion, mentions, named
      snapshot preview/restore and integrated history.
- [ ] Run parent integration review and map AC1..AC8 to child evidence.

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
