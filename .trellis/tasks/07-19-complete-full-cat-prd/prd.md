# Complete Full CAT Product PRD

## Goal

Deliver the complete Translunar CAT product described by `docs/PRD.md` v2.0.
The existing DOCX MVP is the starting point, not the finish line. The product
must become a local-first, cross-platform, AI-capable CAT and translation-asset
hub for individual translators and small internal teams, while preserving the
PRD's non-goals around customer portals, billing, procurement, heavy enterprise
RBAC, and compliance marketing.

The work also closes and archives `00-bootstrap-guidelines` by documenting the
actual repository conventions before further implementation.

## Product Boundary

Included:

- project and multi-file lifecycle, recovery, archive, templates, search, and
  analytics;
- a unified filter/pipeline model with DOCX, XLSX, PPTX, TXT, Markdown, HTML,
  XLIFF, SRX, and layered PDF/OCR support;
- a professional bilingual editor with protected tags, TM/TB/MT/LLM panels,
  search/replace, split/merge, comments, spelling, keyboard workflows,
  undo/redo, preview, themes, zoom, and accessibility;
- local multi-library TM and termbase assets with open-standard exchange,
  fuzzy/context/CJK matching, concordance, provenance, and automatic sinking;
- BYOK engine connectors, OpenAI-compatible endpoints, grounded prompts,
  streaming interaction, batch pretranslation, retry/resume, AI actions, and
  explicit usage/source controls;
- mechanical QA, CJK and terminology QA, consistency checks, reports, review
  states, revision acceptance, LQA foundations, and export gates;
- alignment, bilingual review packages, asset curation, quality scoring,
  terminology mining, drift reports, explainable rollback, and datasets;
- internal and public plugin runtime/SDK, local API, CLI, automation hooks,
  and a lightweight self-hosted collaboration mode;
- Windows/macOS packaging, secure key storage, backup/restore, updates,
  zh-CN/en-US localization, tutorial/example project, accessibility, CI, and
  release documentation.

Excluded by the source PRD:

- customer portals, quotations, rates, invoices, procurement, marketplaces,
  external delivery operations, heavy enterprise isolation/RBAC/audit, and
  compliance dashboards;
- mobile/web-only progress products, self-trained MT, and speech
  interpretation. Those remain extension points where the PRD says so.

## Confirmed Baseline

- Electron + TypeScript renderer, context-isolated preload, Rust headless
  engine, SQLite WAL, and DOCX filter are already established.
- The current renderer delivers a real single-DOCX workflow: import, editable
  target, IME-safe confirmation, exact TM, number QA, restart recovery, export,
  OpenDesign workbench states, and an offline Assistant preview.
- The current engine protocol has 11 methods and one schema migration. It does
  not yet expose multi-file orchestration, fuzzy TM, TB, formats, AI, plugins,
  API, collaboration, or the broader QA/editor contracts.
- The repository is a Windows development workspace; Linux VPS builds are
  available for Rust validation. macOS evidence will be supplied by CI or a
  macOS runner, not fabricated locally.

## Requirements

### R0. Bootstrap and engineering truth

- Complete all backend/frontend bootstrap guideline files with real examples,
  anti-patterns, and current commands; archive the bootstrap task.
- Every later child task has a bounded PRD, technical design, implementation
  checklist, focused tests, and a quality record.
- The Rust protocol remains authoritative; generated TypeScript contracts are
  regenerated for every wire change.

### R1. Core domain, persistence, and pipeline

- Projects support multiple documents, source/target locales, domains,
  mounted assets/engines, lifecycle state, snapshots, history, and recovery.
- The engine owns a format-neutral document/unit/tag model and composable
  filter/pipeline steps. Renderer code does not duplicate domain rules.
- SQLite migrations preserve existing workspaces, use transactions for all
  writes, keep provenance and content/context identity, and support repair and
  backup semantics.
- Internal format and engine implementations exercise the same extension
  contracts that public plugins will use.

### R2. Formats and fidelity

- Deliver the PRD's P0 formats and segmentation: DOCX, XLSX, PPTX, TXT,
  Markdown, HTML/XHTML, XLIFF 1.2/2.1, SRX, and layered PDF/OCR.
- Import failures are typed and actionable; no content is silently dropped.
- Export preserves owned and unowned structures, reports degradation, and is
  covered by representative round-trip fixtures.

### R3. Professional editor

- Implement C-01 through C-20 at their stated priority, including protected
  inline tags, auto-propagation, concordance, search/replace, split/merge,
  comments, spelling, CJK behavior, OpenCC conversion, keyboard customization,
  undo/redo, themes, zoom, context navigation, and plugin panels.
- A 10,000-segment project remains usable under the PRD latency target and a
  new user can complete import -> translate -> export without documentation.

### R4. Asset hub

- Implement D-01 through D-08 and E-01 through E-05 as core capabilities:
  multi-library TM/TB, exact/context/fuzzy/CJK matching, metadata filters,
  concordance, TMX/TBX/CSV/Excel exchange, terminology highlighting and
  insertion, banned terms, and automatic confirmed-result sinking.
- Every asset records source/project/document/segment provenance and can be
  exported without vendor lock-in.

### R5. AI and engine integration

- Implement F-01 through F-05 at P0, including at least six real providers and
  a complete custom OpenAI-compatible endpoint; support all named provider
  profiles through the shared connector contract where transport is compatible.
- Grounded translation visibly injects configurable terminology, banned terms,
  top TM examples, style instructions, and document context.
- Batch pretranslation is cancellable, rate-limited, retryable, resumable, and
  reports token/latency usage. Interactive generation is streamed and can be
  retried or discarded.
- G-01 and G-12 are complete at P0. All AI output is source-labelled,
  reversible, disableable globally and per project, and never silently trains
  on user data.

### R6. QA and review

- Implement H-01 through H-08 at P0: live and batch QA, mechanical rules,
  CJK punctuation, terminology, consistency, report export, and segment
  location links.
- Implement I-01/I-02 at P0 with translation -> review -> sign-off states,
  revision acceptance/rejection, and review statistics. Export gates enforce
  unresolved error behavior with an explicit, recorded override.

### R7. Lifecycle and analytics

- Implement A-01/A-02/A-03/A-06, then A-04/A-05/A-07/A-08; support drag/drop,
  multi-file progress, archive packages, restore, templates, re-import, global
  search, recycle/history, and safe project deletion.
- Implement K-01/K-02 and then K-03/K-04/K-05 without introducing pricing or
  billing semantics.

### R8. Interoperability and alignment

- Implement L-01/L-02 at P0 and L-03 through L-06 at P1 with conservative
  parsing, original-format return where promised, bilingual DOCX, and
  round-trip regression fixtures.
- Implement J-01 at P0 and J-02/J-03 at P1; alignment must be reviewable before
  writing TM and reference corpora must be usable by grounded retrieval.
- Implement I-03/I-04/I-07/I-09 at P1 for offline review packages, comments,
  discussion history, and snapshots.

### R9. Asset curation

- Implement AC-01/AC-02 at the asset-hub stage, then AC-03 through AC-08 at P1:
  rule and semantic cleaning, quality scoring, terminology mining, drift
  reports, explainable previews, rollback, and original-version retention.
- Implement AC-09/AC-10/AC-11 when the scheduler/plugin foundations exist.

### R10. Plugins and open access

- Implement internal pluginization first, then P-01 through P-10: manifests,
  lifecycle, filter/engine/QA/pipeline/AI/UI/external extension points,
  explicit permissions, isolation, local distribution, and developer examples.
- Implement X-01/X-02 at P1 with a loopback-authenticated local API and a CLI
  able to import, pretranslate, QA, export, and sink results without the GUI.
- Implement X-03 through X-07 when the automation and plugin contracts are
  stable. The API never becomes a billing or customer portal.

### R11. Collaboration

- Implement I-05 through I-08 at P2 as a self-hosted 2-10-person mode: local
  asset replicas/op-log sync, segment locks, presence, progress board, simple
  roles, assignments, and mentions. Offline local-first mode remains complete
  without a server.

### R12. Product shell and NFR

- Implement M-01/M-02/M-04, N-01 through N-05/N-07 at P0; M-03/M-05 and
  N-06/N-08 at P1. Secrets use OS credential storage, telemetry defaults off,
  and backups precede migrations/updates.
- Deliver Windows and macOS packages under 200MB where technically possible,
  unsigned development artifacts plus signing hooks when credentials are not
  available, deterministic update/rollback behavior, bilingual UI, tutorial,
  accessibility, and CI.
- Validate cold start, capacity, TM/query, editor frame time, batch QA,
  reliability, accessibility, internationalization, plugin crash isolation,
  and the success standards in §10 with reproducible fixtures or explicitly
  labelled external-run evidence.

## Acceptance Criteria

- [ ] The bootstrap task is complete and archived; all project specs describe
      actual code with examples and quality commands.
- [ ] Every PRD requirement ID is mapped to a child task and either implemented
      with evidence or explicitly excluded only under §2.5.
- [ ] A fresh Windows install can create a multi-file project, import each P0
      format including text-layer/scanned PDF, translate, review, QA, export,
      recover, and restore an archive without developer intervention.
- [ ] DOCX/XLSX/PPTX/TXT/Markdown/HTML/XLIFF/PDF round-trip fixtures pass with
      typed degradation reports and no silent loss.
- [ ] TM/TB supports standard exchange, exact/context/fuzzy/CJK retrieval,
      provenance, terminology QA, concordance, and confirmed-result sinking.
- [ ] At least six real AI connectors plus custom OpenAI-compatible endpoints
      support grounded streaming and resumable batch pretranslation with secure
      BYOK and auditable usage.
- [ ] Editor operations C-01..C-20 and QA/review operations H/I at their
      accepted priority are keyboard-accessible, IME-safe, persistent, and
      covered by unit/integration/Electron tests.
- [ ] Asset curation catches the PRD dirty-data fixture at the stated rate,
      never permanently deletes an asset without a reversible record, and
      produces explainable drift/quality reports.
- [ ] Plugin hello-world filter and connector examples run through documented
      SDKs; plugin failure is isolated and permissions are enforced.
- [ ] Local API and CLI complete the same import -> translate -> QA -> export
      path without opening the GUI, and results sink into the same asset hub.
- [ ] Collaboration mode passes two-client lock/presence/sync/reconnect tests
      without weakening single-user offline behavior.
- [ ] Windows/macOS packages, zh-CN/en-US localization, secure secrets,
      backups, update rollback, tutorial, accessibility, and CI evidence exist.
- [ ] Full quality gate is green: formatting, lint, typecheck, Rust tests,
      protocol check, unit/integration/Electron E2E, performance fixtures,
      package smoke, and release audit.

## Constraints and Decisions

- Keep Electron + TypeScript + Rust + SQLite; do not migrate the product to a
  different UI or engine stack.
- Choose Apache-2.0 for the repository and keep plugin SDK examples permissive;
  record the license before publishing packages.
- Use local-first SQLite with derived Tantivy-style indexes that can be rebuilt;
  use an explicit op-log for shared assets rather than multi-writer SQLite.
- Use PDF text extraction/reconstruction plus optional local Tesseract-compatible
  OCR behind a filter boundary; never claim pixel-perfect PDF fidelity.
- Use OS keychain credentials, loopback random-token API auth, and no telemetry
  by default. Cloud AI remains BYOK and optional.
- Keep heavy QE/embedding models optional downloads or plugins; do not silently
  bundle multi-gigabyte models into the installer.
- No external user confirmation is required for ordinary implementation choices;
  blockers caused by missing credentials or platform runners are recorded with a
  reproducible local substitute and revisited in release qualification.

## Out of Scope

The source PRD's customer operations, billing, procurement, heavy enterprise
compliance/RBAC/audit, speech interpretation, self-trained MT, and mobile/web
products remain out of scope. Plugin/API work must not smuggle those features
back into the product.
