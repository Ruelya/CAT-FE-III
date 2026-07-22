# Acceptance Evidence: External CAT Interchange Formats

Recorded on 2026-07-22 against the final combined interoperability worktree.
Rust verification ran in the isolated VPS workspace
`/home/ubuntu/workspaces/cat-interop-20260721`; desktop and contract checks used
Node 22.17.0 and the synchronized Windows GNU release Engine.

## Acceptance Matrix

| Criterion | Executable evidence |
| --- | --- |
| AC1 | `sdlxliff_round_trip_preserves_vendor_metadata_and_tags` and `sdl_segment_markers_states_comments_and_pairs_round_trip` cover stable paths, state, comments, paired inline codes, opaque metadata, and native reparse. The stdio smoke imports, edits, restarts, exports, and reparses SDLXLIFF. |
| AC2 | `mqxliff_v2_preserves_state_and_reports_unknown_vendor_metadata`, `mqxlz_round_trip_copies_auxiliary_entry_and_rejects_traversal`, and the stdio smoke cover MQXLIFF/MQXLZ state, degradation findings, translated XML, and byte-preserved auxiliary payloads. |
| AC3 | Focused tests reject ambiguous marker identities, unknown entities, malformed XML structure, DTD/depth/size violations, duplicate paths and ZIP names, traversal, encryption, ratio/size bombs, ZIP64 metadata, unknown export paths, and existing destinations. Failed imports/exports leave no partial persisted document or output. |
| AC4 | Engine workspace tests and `filter.list` smoke assertions expose `builtin.sdlxliff`, `builtin.mqxliff`, and `builtin.mqxlz` while the generated schema and TypeScript contracts remain byte-equal. Existing filters remain green in the full workspace suite. |
| AC5 | `node scripts/engine-smoke.mjs` covers XML and ZIP import/edit/restart/export, native output content, malformed input, unknown paths, and no-clobber publication. |

## Final Quality Gate

The post-audit worktree passed:

```text
cargo fmt --all -- --check
cargo test --workspace
  -> all workspace unit, binary, and doc tests passed
  -> filter-interop 20, Engine 31, Office core 6, storage 39 passed
cargo clippy --workspace --all-targets -- -D warnings
node scripts/engine-smoke.mjs
  -> Engine smoke passed
pnpm contracts:check
  -> Rust schema and generated TypeScript byte equality
cargo build -p translunar-engine --release --target x86_64-pc-windows-gnu
```

The final Windows GNU binary is
`.local-cache/translunar-engine-interop-20260722-final.exe`, SHA-256
`DD57D60648C12F0CC9CE8FBC26CE50DE6D743D265BC3DFE0666481FF614231ED`.

## Environment Note

Local MSVC Rust linking remains unavailable because Git's Unix `link.exe`
shadows the MSVC linker. Local formatting and Node checks passed; compilation,
strict Clippy, workspace tests, schema generation, stdio smoke, and the Windows
GNU release build therefore ran in the isolated VPS workspace.
