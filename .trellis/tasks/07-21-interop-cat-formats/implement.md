# Implementation Plan: External CAT Interchange Formats

## Ordered Checklist

- [x] Add shared bounded XML/ZIP validation helpers or reuse existing
      `filter-office-core` primitives without duplicating publication logic.
- [x] Implement SDLXLIFF adapter with import/export, state/comment/tag mapping,
      dialect probes, and fixture tests.
- [x] Implement MQXLIFF adapter and MQXLZ envelope round-trip with raw-copy
      auxiliary entries and adversarial ZIP tests.
- [x] Register descriptors in Engine, update workspace manifests, and regenerate
      contracts if the descriptor catalog changes.
- [x] Extend `scripts/engine-smoke.mjs` through XML/ZIP success, restart,
      malformed/no-clobber and unknown-path cases.
- [x] Run focused Rust tests, then Node format/lint/typecheck/unit/build and
      the full Electron suite; run Linux/VPS Rust, smoke, release and GNU gates.
- [x] Update backend spec with the private-format boundary and archive limits;
      record exact evidence before commit/archive.

## Risk Files

`Cargo.toml`, `crates/filter-*/Cargo.toml`, new interop crate sources,
`crates/engine/src/lib.rs`, generated contracts, `scripts/engine-smoke.mjs`, and
backend boundary specs.

## Rollback Points

- Keep new filter registration behind passing fixture tests.
- Do not modify existing `filter-xliff` behavior to satisfy private fixtures.
- Never overwrite a destination or persist a document after a partial parse.

## Verification Evidence

Local checks used the repository-supported Node.js 22 line (22.18.0 during the
initial gate and bundled 22.17.0 during the final rerun) and the current
combined worktree:

- The initial `pnpm format:check` passed. The final rerun passed `cargo fmt`
  and task-scoped Prettier checks; the full-tree Prettier scan currently also
  visits unrelated untracked `.devin/` skill files and reports their existing
  formatting, so those files were left untouched.
- `pnpm exec eslint apps packages/contracts/src` passed.
- `pnpm typecheck` passed.
- `pnpm -r --if-present test` passed: 5 files, 17 desktop tests.
- `pnpm build:desktop` passed.
- With `TRANSLUNAR_ENGINE_PATH` set to the synchronized Windows GNU release
  binary, `pnpm --filter @translunar/desktop test:e2e` passed: 8 passed,
  1 pre-existing conditional skip.

The isolated VPS tree `/home/ubuntu/workspaces/cat-interop-20260721` passed:

- `cargo fmt --all -- --check`
- `cargo test --workspace` (including 15 interop, 25 Engine, and 32 storage
  tests)
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo build -p translunar-engine`
- `node scripts/engine-smoke.mjs`
- `cargo build -p translunar-engine --release --target x86_64-pc-windows-gnu`

The local `pnpm contracts:check` process could not link its Rust schema helper
because Git's `link.exe` shadows the unavailable MSVC linker. The equivalent
project-prescribed split gate passed: VPS Rust generated the schema, local
Node 22 generated TypeScript with the locked `json2ts`, and both normalized
outputs matched the committed contract files byte-for-byte.

Focused adversarial tests use real central-directory duplicate names and
encryption flags plus forged oversized metadata, a deflate ratio bomb,
traversal paths, XML DTD/depth/size violations, duplicate stable paths,
unknown export paths, and stale output destinations.

Post-review regression additions (2026-07-22) also cover explicit segmented
source/target marker identity mismatches and duplicate target IDs, strict
unknown-entity rejection with legal CDATA, nested vendor-qualified attributes,
decompression bounded by each ZIP entry's declared size, multi-segment note/
finding ownership, paired `bpt/ept`, `sc/ec`, and `it` inline codes, indexed
child/ID lookup, root-outside text, malformed comments/processing instructions,
unescaped attribute `<`, forbidden `]]>` character data, and ZIP64 central
extra/sentinel metadata. The synchronized VPS rerun passed 15 focused interop
tests, `cargo test --workspace`, strict workspace Clippy, and the stdio smoke
after these changes. The refreshed Windows GNU release was synchronized as
`.local-cache/translunar-engine-interop-20260722.exe` (SHA-256
`CA775638301DF6B76139DC597372550AAB99BBC28A9EF34C7840FB9803AFDDFC`), and
the real-Engine Electron suite passed again with 8 passed and 1 conditional
skip. Rust-generated schema and locally generated TypeScript contracts also
matched their committed files byte-for-byte.
