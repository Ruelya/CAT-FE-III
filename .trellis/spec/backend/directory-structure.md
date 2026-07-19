# Backend Directory Structure

## Scope

The backend is a Rust workspace. Keep domain behavior, wire contracts,
persistence, document filters, and process orchestration in separate crates.
Electron is a client of this workspace and must not become a second backend.

## Workspace Layout

```text
crates/
|-- domain/src/lib.rs          # domain entities and pure normalization/QA helpers
|-- protocol/src/lib.rs        # JSON-RPC methods, payloads, errors, schema catalog
|-- protocol/src/bin/          # generated-contract tooling
|-- storage/src/               # SQLite connection, migrations, repositories
|-- filter-docx/src/           # DOCX extraction, validation, and reconstruction
|-- segmentation-srx/src/      # SRX parser, built-in profiles, byte ranges
|-- filter-text/src/           # TXT/Markdown extraction and range replacement
|-- filter-html/src/           # HTML/XHTML tokenizer, attributes, inline tags
|-- filter-xliff/src/          # XLIFF 1.2/2.x conservative interchange
|-- filter-office-core/src/    # bounded OOXML ZIP/XML/relationship helpers
|-- filter-xlsx/src/           # worksheet selection and cell-level round trip
|-- filter-pptx/src/           # slides/tables/SmartArt/notes/master round trip
`-- engine/src/                # application service, dispatcher, stdio executable
packages/contracts/src/        # generated TypeScript projection of protocol
scripts/                       # cross-process smoke and contract drift checks
```

The dependency direction is inward:

```text
domain <- protocol
domain <- storage
domain <- filter-docx
filter-core <- segmentation-srx + filter-text + filter-html + filter-xliff
filter-core <- filter-office-core <- filter-docx + filter-xlsx + filter-pptx
domain + protocol + storage + filters <- engine
protocol schema -> packages/contracts -> Electron
```

`crates/domain/src/lib.rs` must not depend on SQLite, Electron, or a document
container. `crates/storage/src/store.rs` persists domain values but does not
define wire payloads. `crates/engine/src/lib.rs` is the composition layer that
coordinates storage and filters.

## Module Placement

- Put cross-format entities and pure rules in `crates/domain`.
- Put every public RPC method, request, result, and stable error code in
  `crates/protocol` before adding a client call.
- Put schema changes in `crates/storage/src/migrations.rs`; put query and
  transaction behavior in `store.rs`; put storage failures in `error.rs`.
- Give each format its own `crates/filter-*` crate. Format crates exchange
  domain translation units and never open the application database.
- Keep `crates/engine/src/main.rs` limited to CLI/process concerns. Reusable
  dispatch and service behavior belongs in `crates/engine/src/lib.rs`.
- Commit generated schema and TypeScript contracts under
  `packages/contracts/src`; never hand-edit them.

## Naming

Crates use `translunar-*`; directories and Rust modules use snake_case. Domain
types use singular PascalCase (`Segment`, `QaIssue`), while operations use
verb-led snake_case (`update_target`, `run_document_qa`). Protocol method
strings use a namespaced lower-camel form such as `segment.updateTarget`.

## Source-Backed Examples

- `RpcDispatcher` in `crates/engine/src/lib.rs` parses protocol payloads and
  calls `EngineService`; it does not embed SQL.
- `Store::confirm_segment` in `crates/storage/src/store.rs` owns the atomic
  segment/TM/QA transition.
- `extract_docx` and `export_docx` in `crates/filter-docx/src/lib.rs` own OOXML
  details without knowing about projects or RPC.
- `publish_bytes_noclobber` in `crates/filter-core` owns shared atomic byte
  publication; each format crate still owns parsing and revalidation.

## Avoid

- Do not open SQLite from `apps/desktop` or a format crate.
- Do not introduce an RPC payload only in Electron or duplicate a generated
  contract by hand.
- Do not put reusable application behavior in a binary `main.rs`.
- Do not create a generic `utils` module for feature-owned behavior; keep a
  helper beside its owner until at least two modules genuinely share it.
