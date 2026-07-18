# Text, HTML, XLIFF, And SRX Filters

## Goal

Deliver the P0 text-family and interchange filters required by `docs/PRD.md`
v2.0: TXT, Markdown, HTML/XHTML, XLIFF 1.2/2.1, and SRX segmentation. A
translator can import these formats into the existing format-neutral document
model, edit segments, and export a faithful result without renderer-side
parsing or format-specific rules.

## Source Requirements

This child implements B-04, B-05, B-06, B-10, L-01, and L-02 for the formats
listed above. It validates the internal filter-plugin architecture used by the
M0 product. TMX, TBX, and DOCX are already covered by sibling/earlier tasks;
SDLXLIFF, MQXLIFF, dialect-tolerant XLIFF, and other P1/P2 formats remain out
of scope.

## Requirements

### R1. Shared filter contract

- Register every filter through `FilterRegistry` and expose it through the
  existing generic `filter.list`, `document.import`, and `document.export`
  methods. Do not add format-specific RPC methods.
- Extend the internal import request additively with optional source locale
  and string options. Existing DOCX callers and wire contracts remain
  compatible.
- Every successful import emits a complete `StartDocument`/unit/event/
  `EndDocument` stream. A malformed input fails before a document or managed
  source is persisted.
- Structural paths are stable across a round trip and are sufficient to map
  each stored segment back to exactly one owned source range.

### R2. TXT and Markdown (B-04)

- Read UTF-8 TXT, including optional BOM, and preserve original newline style
  and trailing-newline state. Paragraphs are units; sentence mode can further
  split each paragraph through SRX.
- Markdown units include headings, paragraphs, list/quote text, and table cell
  text. Fenced and inline code, link/image destinations, HTML blocks, and
  Markdown syntax delimiters are protected; visible translatable text remains
  editable.
- Export replaces only translated owned ranges and leaves unowned bytes,
  whitespace, line endings, and syntax intact. Untranslated units are copied
  byte-for-byte.

### R3. HTML/XHTML (B-05)

- Import text nodes while excluding `script`, `style`, `code`, and `pre` by
  default. Nested inline elements become protected paired/standalone tags.
- Configurable translatable attributes include `title`, `alt`, `placeholder`,
  and `aria-label`; an option can add or remove names without exposing raw
  markup as editable text.
- Handle HTML5 and namespace-qualified XHTML, preserving tag names,
  attributes, entity spelling where possible, comments, and unrelated nodes.
- Export performs range-local text/attribute replacement, validates the result,
  and atomically publishes without overwriting an existing destination.

### R4. XLIFF interchange (B-06/L-01)

- Import and export XLIFF 1.2 (`file/body/trans-unit/source/target`) and XLIFF
  2.1 (`file/unit/segment/source/target`), including source/target locales,
  existing targets, IDs, state, notes, and inline code tags.
- Preserve unknown namespaces, metadata, attributes, ordering, and untouched
  source content. Structural paths use stable file/unit/segment identifiers,
  not ordinal-only paths.
- Export updates only owned target text and necessary target state; it must not
  discard unknown metadata. Reparse and validate a staged output before
  publication. Malformed XML and unsupported XLIFF versions return typed
  actionable errors.

### R5. SRX segmentation (B-10/L-02)

- Provide paragraph and sentence modes. Sentence mode supports SRX 2.0
  `languagerules`, `maprules`, `beforebreak`, `afterbreak`, and `break="yes|no"`.
- Ship deterministic built-in profiles for Chinese, English, Japanese, and
  Korean. Profiles protect common abbreviations, decimal numbers, URLs,
  paired punctuation, and CJK sentence boundaries.
- Apply rules without losing source offsets; split units can be exported by
  replacing their exact ranges. Custom SRX files can be parsed and applied via
  filter options, with diagnostics for invalid rules.

### R6. Safety, fidelity, and compatibility

- Parsers are bounded, non-executing, and do not interpolate input into SQL.
  Error messages and logs do not include full document text.
- Imports and exports use managed temporary files, fsync, reparse/validation,
  and atomic publication. Existing destinations remain unchanged on failure.
- Existing DOCX, TM/TB, QA, restart recovery, protocol schema generation, and
  Electron flows remain green.

## Acceptance Criteria

- [x] `filter.list` reports stable descriptors for TXT, Markdown, HTML/XHTML,
      XLIFF 1.2/2.1, SRX-enabled text filters, and DOCX after engine restart.
- [x] TXT fixtures round-trip BOM/no-BOM, LF/CRLF, trailing newline, Unicode,
      paragraph boundaries, translated and untranslated units byte-for-byte.
- [x] Markdown fixtures protect fenced/inline code, URLs, image destinations,
      HTML blocks, and delimiters while exporting translated visible text.
- [x] HTML5 and namespace-qualified XHTML fixtures preserve nested inline tags,
      excluded elements, entities, comments, and configured translatable
      attributes; malformed markup is rejected or reported as degradation
      without silent text loss.
- [x] XLIFF 1.2 and 2.1 fixtures round-trip locales, existing targets, state,
      notes, inline tags, unknown namespaces/metadata, stable IDs, and ordering;
      malformed and unsupported inputs leave no persisted document.
- [x] Built-in zh/en/ja/ko SRX tests cover sentence boundaries, abbreviations,
      decimal/URL no-break cases, CJK punctuation, paragraph mode, and exact
      source offsets. A custom SRX fixture parses, applies, and reports errors.
- [x] Generic engine import/export works for every new filter, uses source
      locale/options, validates staged output, refuses destination overwrite,
      and survives restart with persisted segments.
- [x] All existing Rust tests, strict fmt/clippy, engine stdio smoke, generated
      schema/TypeScript checks, desktop lint/typecheck/unit/build/E2E pass.

## Verification Evidence

- VPS (`/home/ubuntu/workspace/CAT-core-dev`): `cargo fmt --all -- --check`,
  strict workspace clippy, full workspace tests, extended engine stdio smoke,
  debug Engine build, and Windows GNU release Engine build all passed.
- The release artifact `target/cross/translunar-engine.exe` was produced at
  10,395,136 bytes.
- Local desktop gates passed: ESLint, TypeScript, Vitest (8/8), desktop build,
  and Electron E2E (3/3).
- Protocol schema SHA-256 is
  `a5dc7cc00107e8c683bab91e1a7e07e9f576aeeb9c42139757208fe5ffa22d95`;
  the VPS schema, committed schema, and generated TypeScript agree.
- `pnpm contracts:check` remains unavailable on this Windows host because the
  GNU toolchain resolves the Windows SDK `link.exe`; schema generation and
  generated-client type checking were independently verified instead.

## Out Of Scope

- SDLXLIFF, MQXLIFF, XLIFF dialect tolerance, XLIFF package/project formats,
  HTML visual layout rendering, CSS/JavaScript execution, Markdown reflow,
  arbitrary binary encodings, and automatic machine translation.
- SRX visual rule editor (P1), general content filtering (B-11), and external
  filter/plugin SDK (owned by later tasks).

## Constraints

- Rust owns parsing, segmentation, protected tags, offsets, validation, and
  file publication. React/Electron only renders generated protocol results.
- Keep crate dependencies acyclic: `domain <- filter-core <- filters`, with
  `segmentation-srx` shared by text/HTML filters and Engine only composing the
  registry.
- Preserve legacy `ImportRequest { source }` construction through defaults or
  additive fields, and regenerate contracts only when the wire surface changes.
- Use source ranges and local replacement rather than full-document
  serialization wherever possible; no silent normalization of user files.
