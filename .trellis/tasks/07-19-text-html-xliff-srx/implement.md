# Implementation Plan: Text, HTML, XLIFF, And SRX Filters

## Preconditions

- Core storage/pipeline and TM/termbase tasks are archived and their contracts
  are current.
- Read `engine-boundary.md`, `database-guidelines.md`, and
  `error-handling.md` before changing shared Rust contracts.
- Keep the working tree clean of unrelated edits and use additive migrations
  only. Migration 5 is required to persist XLIFF segment notes/state that the
  pre-existing store otherwise discarded.

## 1. Shared Contract And SRX

- [x] Extend `filter-core::ImportRequest` with document namespace,
      locale/options defaults and
      update DOCX, Engine, and unit-test call sites.
- [x] Add `crates/segmentation-srx` with SRX 2.0 parser, built-in zh/en/ja/ko
      profiles, paragraph/sentence modes, offset-preserving application, and
      typed diagnostics.
- [x] Test break/no-break precedence, abbreviations, decimals, URLs, CJK
      punctuation, custom SRX, malformed XML, and Unicode offsets.
- Gate: crate fmt, strict clippy, and isolated SRX tests.

## 2. TXT And Markdown

- [x] Add `crates/filter-text` descriptors/probes for `.txt`, `.md`, and
      `.markdown`.
- [x] Implement UTF-8/BOM/newline/trailing-newline preservation and paragraph
      plus SRX sentence units with stable source ranges.
- [x] Implement Markdown protected spans for code, URLs, image destinations,
      HTML blocks, and syntax delimiters; export by range replacement.
- [x] Add round-trip fixtures, malformed UTF-8 tests, protected-tag validation,
      and destination no-clobber tests.
- Gate: filter-core collection and byte-level fixture comparisons.

## 3. HTML/XHTML

- [x] Add `crates/filter-html` with HTML5/XHTML probes and source-offset
      tokenizer/parser.
- [x] Implement excluded elements, nested inline protected tags, text units,
      configurable translatable attributes, entities/comments, and SRX mode.
- [x] Implement range-local export, reparse validation, and atomic publication.
- [x] Test HTML5, XHTML namespace, nested tags, malformed input, attributes,
      excluded content, entity spelling, and unchanged unrelated nodes.
- Gate: fixture round trips and typed degradation/error assertions.

## 4. XLIFF

- [x] Add `crates/filter-xliff` with 1.2/2.1 probes and normalized parser.
- [x] Preserve locales, IDs, existing targets, state, notes, inline tags,
      unknown namespaces/metadata, ordering, and source ranges.
- [x] Implement conservative target/state export, staged reparse validation,
      and no-clobber publication.
- [x] Test both versions, target-less/targeted units, inline code pairing,
      unknown metadata, malformed XML, unsupported versions, and duplicate IDs.
- Gate: byte/semantic round trips and generic filter contract tests.

## 5. Engine Registration And Integration

- [x] Add workspace dependencies/crates without cycles and register all built-in
      filters in deterministic order alongside DOCX.
- [x] Pass project source locale and options through generic import; retain
      legacy DOCX request behavior.
- [x] Add generic import/export/restart tests for each filter and assert failed
      imports persist no document/source.
- [x] Extend `scripts/engine-smoke.mjs` with filter catalog, TXT/Markdown,
      HTML/XHTML, XLIFF 1.2/2.1 import/export, malformed input, and overwrite
      checks.
- Gate: full Rust workspace tests and stdio smoke on VPS.

## 6. Client And Release Qualification

- [x] Regenerate protocol schema/TypeScript because optional `options` crosses
      the wire; verify hash and generated client compilation.
- [x] Run local ESLint, TypeScript, Vitest, desktop build, and Electron E2E.
- [x] Run VPS fmt, strict clippy, workspace tests, smoke, and release build.
- [x] Update backend specs with final filter, persistence, and offset contracts.
- [ ] Commit, archive this child, update parent progress, and continue the next
      dependency (`07-19-office-document-filters`).

## Verification Evidence

- VPS Rust gates all passed, including strict clippy, full workspace tests,
  extended stdio smoke, and Windows GNU release Engine build.
- Local desktop gates passed: ESLint, TypeScript, Vitest 8/8, build, and
  Electron E2E 3/3.
- Generated schema hash:
  `a5dc7cc00107e8c683bab91e1a7e07e9f576aeeb9c42139757208fe5ffa22d95`.
- `pnpm contracts:check` is the sole host-specific exception: Windows resolves
  the wrong GNU linker. The VPS schema was compared byte-for-byte with the
  committed schema and the generated TypeScript was type-checked locally.

## Validation Commands

Local desktop gates:

```powershell
$env:PATH='K:\Software\cursor\resources\app\resources\helpers;' + $env:PATH
pnpm exec eslint apps packages/contracts/src
pnpm typecheck
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
pnpm --filter @translunar/desktop test:e2e
```

VPS Rust gates:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
node scripts/engine-smoke.mjs
```

## Risk And Rollback Points

- Before shared-contract changes: revert only the new crate/registration
  changes; preserve existing DOCX behavior.
- If a parser cannot preserve an owned range, fail the import/export with a
  typed finding rather than silently rewriting the file.
- If generated protocol hashes drift, stop before client changes and regenerate
  from the VPS-built schema source.
- If an integration test fails after registration, remove that registration
  while retaining isolated crate tests and fix before proceeding.
