# Technical Design: Full Translunar CAT Product

## 1. Architecture Invariant

The existing boundary remains authoritative:

```text
Electron renderer
  -> context-isolated DesktopApi
  -> Electron main (dialogs, keychain, process ownership)
  -> versioned JSON-RPC transport
  -> Rust engine application services
  -> domain + filters + pipeline + assets + QA + plugins
  -> SQLite truth + rebuildable search/vector indexes + managed files
```

Team mode and open access add transports, not a second domain implementation:

```text
CLI / local HTTP API / collaboration server
  -> the same engine application-service interfaces
  -> the same transactions, filters, QA, assets, and pipelines
```

The renderer may format and orchestrate responses, but it never implements TM
scoring, terminology detection, QA rules, segment transitions, pipeline logic,
or persistence outcomes.

## 2. Workspace and Domain Model

Schema evolution is additive and migration-driven. The domain grows around
stable identifiers and provenance:

- `Project`: locales, domain, workflow/profile/template references, lifecycle;
- `Document`: format/filter identity, original and managed paths, version,
  degradation report, import state;
- `Unit`/`Segment`: source/target, state, revision, context, timestamps,
  assignment, lock, review state, comments, timing;
- `InlineTag`: stable tag id, kind, pair relation, protected payload and order;
- `AssetLibrary`: TM/TB/corpus role, locale pair, domain, writable/reference;
- `TmEntry`/`TermEntry`: provenance, quality, status, history and tombstone;
- `QaFinding`: rule, category, evidence, severity, status, ignore rationale;
- `Operation`/`Snapshot`: reversible history and collaboration synchronization;
- `PipelineDefinition`/`Run`: ordered typed steps, checkpoints and usage.

SQLite is the durable truth. Fuzzy/concordance search uses rebuildable derived
indexes; embeddings are optional derived artifacts. Every externally visible
write is one transaction and yields a revision or operation id.

## 3. Protocol and Service Evolution

`crates/protocol` continues to generate `packages/contracts`. Methods are grouped
by bounded service namespaces:

```text
project.* document.* segment.* history.*
tm.* termbase.* corpus.* curation.*
qa.* review.* analysis.*
engineConnector.* pipeline.* plugin.* settings.*
```

Large files remain path-based. Long operations use run ids plus status/cancel
methods and event notifications; they do not hold one JSON-RPC request open for
minutes. Streaming model output and progress events use a typed event channel
owned by main/preload. CLI/API adapters call service functions directly rather
than replaying JSON-RPC through the renderer.

Wire changes remain compatible within protocol v1 when additive. A breaking
rename or semantic change requires a protocol version bump and migration notes.

## 4. Filter and Pipeline Core

The current `DocumentFilter -> Vec<FilterEvent>` trait evolves into a streaming
filter contract with document metadata, unit boundaries, inline tags, notes,
structure references, and degradation records. Each filter supports declared
capabilities:

```text
probe -> import event stream -> normalized document model
normalized model + targets -> export event stream -> validation report
```

Built-in adapters register through the same runtime registry as plugins:

- core text adapters: TXT, Markdown, HTML/XHTML, XLIFF, SRX;
- Office adapters: DOCX, XLSX, PPTX;
- PDF adapter: text/layout extraction, optional OCR, reconstruction/degradation;
- exchange/review adapters: TMX, TBX, bilingual DOCX, SDLXLIFF/MQXLIFF.

Pipeline steps are typed, resumable, cancellable, and checkpointed. Import,
segmentation, TM pretranslation, AI pretranslation, QA and export are ordinary
steps with deterministic inputs and outputs.

## 5. Asset Hub

Exact/context matching remains hash-based. Fuzzy and concordance retrieval use a
CJK-aware index with normalized word and character n-gram fields, candidate
retrieval, penalties, then deterministic reranking. Benchmarks own threshold and
index decisions before they become compatibility contracts.

Asset libraries are independently writable or read-only and can be mounted by
project. Standard import is staged, validated, previewed, then committed.
Confirmed translations, API results, alignments and plugin output all sink
through one provenance-bearing service.

Curation never overwrites the only copy. A run produces findings and proposed
operations; apply creates reversible versions/tombstones. Semantic quality and
embedding providers are replaceable, optional, and clearly labelled.

## 6. AI and Connector Layer

Connectors expose a common model/provider contract for capability discovery,
streaming generation, embeddings where available, cancellation, usage, retry
classification and rate limits. Provider-specific adapters cover Anthropic,
Gemini and DeepL; OpenAI-compatible profiles cover OpenAI, DeepSeek, Qwen, GLM,
Kimi, Volcano, Baidu, Tencent, NiuTrans and local endpoints where their APIs are
compatible, with dedicated adapters where they are not.

Keys live in the OS credential store and enter the Rust connector only for a
request. Tests use deterministic local HTTP fixtures, never real credentials.
Grounding is a visible structured request assembled from TB, TM, style and
context. Batch runs persist checkpoints and usage in SQLite.

The current offline Assistant remains a development fixture until the real
connector service replaces it. The UI preserves the same conversation and usage
surface while clearly showing offline/real provider state.

## 7. QA, Review, and Editor

QA rules implement one typed trait and emit structured evidence. Mechanical,
CJK, terminology, consistency, regex and AI semantic rules are separate
providers. Profiles choose enabled rules, severity and parameters. Findings are
reconciled by fingerprint and have review/ignore history.

Editor operations are commands against segment revisions. Undo/redo records
inverse operations; split/merge/tag/comment/review changes remain durable and
conflict-aware. Large documents use paged engine queries and virtualized rows.
Search/replace previews a deterministic operation set before applying it.

Review state is configurable but begins with translation -> review -> signed.
Export gates read authoritative open errors and record explicit overrides.

## 8. Plugin Runtime

Three tiers share a versioned manifest and capability model:

1. Tier 1 declarative manifests for simple filters, provider profiles, QA regex
   packs, pipelines and AI prompt actions.
2. Tier 2 sandboxed JavaScript/UI contributions communicating through a narrow
   postMessage/host API with declared capabilities.
3. Tier 3 child-process JSON-RPC plugins for arbitrary languages and complex
   filters/connectors/steps. Crashes and timeouts are isolated.

Filesystem, network, asset and UI permissions are explicit. Local installation
is first; a signed/indexed repository is an optional later layer. Official
examples use the public SDK and are exercised in CI.

## 9. API, CLI, and Collaboration

The local API binds loopback by default and requires a random token stored in
the keychain. It exposes versioned project/document/segment/asset/pipeline/QA
operations, never Electron internals. The CLI can run the complete pipeline and
emit machine-readable progress.

Team mode hosts the engine services with WebSocket presence/locks and HTTP sync.
Assets use local replicas plus an operation log, last-writer metadata rules and
tombstones; real-time segment locks are a separate online concern. A 2-10 user
SQLite server is the default; storage remains replaceable behind repositories.

## 10. Desktop Product Shell

Electron main owns keychain, file/folder dialogs, update staging, packaging and
engine process lifecycle. Renderer localization uses typed message keys with
zh-CN/en-US bundles. The Translunar workbench design stays dense and operational.
Theme, zoom, accessibility and reduced motion are first-class preferences.

`electron-builder` or an equivalent maintained packager produces Windows and
macOS artifacts. Signing/notarization are optional credential-backed CI steps;
unsigned development packages remain reproducible. Updates back up the data
directory before applying migrations and expose rollback/manual controls.

## 11. Decisions Resolving PRD Open Questions

- Product/repository name: Translunar CAT.
- License: Apache-2.0 for core, SDK and examples.
- Asset truth: SQLite; fuzzy index is rebuildable; team sync uses an op-log.
- PDF: native extraction/reconstruction filter plus optional local
  Tesseract-compatible OCR, with explicit degradation reports.
- Local API: loopback random-token auth; remote binding is opt-in.
- QE/embedding models: optional downloads/plugins; LLM-judge and deterministic
  rule baselines work without bundling large models.
- First real connector acceptance set: OpenAI, Anthropic, Gemini, DeepL,
  DeepSeek and Qwen plus custom OpenAI-compatible endpoints; all named profiles
  are represented before full release.
- No mobile/web product is added; responsive progress views may be provided by
  the collaboration server later without entering this PRD.

## 12. Rollout and Rollback

- Each child task adds migrations and protocol methods with old-workspace tests.
- A child does not begin until dependencies are green and its own planning
  artifacts are reviewed by the main session.
- New formats/connectors ship behind capability registration until fixtures pass.
- Destructive asset operations are previewed and reversible from their first
  implementation.
- Parent completion requires all children archived, cross-child integration
  tests, packages, performance evidence and an ID-by-ID PRD audit.
