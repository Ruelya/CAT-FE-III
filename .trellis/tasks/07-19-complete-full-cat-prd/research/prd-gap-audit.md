# PRD Gap Audit at Commit `dbe67f0`

## Evidence Baseline

- Rust crates: `domain`, `engine`, `filter-docx`, `protocol`, `storage`.
- Protocol: 11 methods covering initialize, project create/get, DOCX import,
  segment list/update/confirm, exact TM, number QA, and DOCX export.
- Schema: migration v1 with projects, documents, segments, one project TM,
  TM entries, and QA issues.
- Renderer: project setup, single active document, editable bilingual grid,
  workbench panel states, exact matches, honest empty termbase, offline Assistant,
  QA/export/TM projections.
- Automated evidence: 8 renderer unit tests, 3 Electron E2E tests, 18 Rust tests,
  engine smoke, contract check, Windows screenshots at three sizes.

Status meanings:

- **Complete baseline**: real end-to-end implementation for the narrow existing
  scope, not necessarily the full PRD requirement.
- **Partial**: some contract/UI exists but material PRD behavior is absent.
- **Missing**: no authoritative implementation.

## Module Audit

| Module | Current status | Evidence and major gaps | Owning child |
| --- | --- | --- | --- |
| A Project/files | Partial | A basic one-document wizard and project snapshot exist. No batch/drag-drop, mounted profiles, archive, templates, re-import, global search, recycle/history. | core; project-lifecycle |
| B Filters | Partial | DOCX body paragraphs/tables round-trip through one concrete crate. Headers/footers/textboxes/notes and all other P0 formats, SRX and plugin registry are absent. | core; text/html/xliff; office; PDF |
| C Editor | Partial | Bilingual grid, basic state filter/search, direct target edit, IME-safe confirm, preview and panel states exist. Protected tags, propagation, concordance, replace, split/merge, comments, spelling, undo, themes/zoom, virtualization and plugin panels are absent. | professional-editor |
| D TM | Partial | One writable project TM, exact hash lookup and confirmed sinking exist. No multi-library roles, 101/fuzzy/CJK, metadata filtering, TMX/CSV, maintenance or policies. | asset-hub; curation |
| E TB | Missing | Terms tab is intentionally empty; no schema, protocol or QA integration. | asset-hub |
| F Engines | Missing | Only a deterministic renderer preview exists. No keychain, network provider, grounding, streaming or batch runs. | AI grounding |
| G AI suite | Partial presentation | Offline quick actions/conversations/usage UI demonstrate interaction only. No real AI service, diff, RAG, diagnosis, semantic/tag workflows or global persisted usage policy. | AI grounding; advanced AI |
| H QA/LQA | Partial | Number mismatch reconciliation and list/run UI exist. All other mechanical/CJK/term/consistency/report/profile/LQA behaviors are absent. | QA/review; advanced AI |
| I Review/collab | Missing | No review revisions/states, packages, discussions, snapshots or team service. | QA/review; interop/review; collaboration |
| J Alignment/corpus | Missing | Confirmed TM sinking exists but no table import, aligner or reference corpus. | asset hub; interop/review |
| AC Curation | Partial | AC-02 editor confirmation sinking exists with source/document/segment ids. No unified hub, cleaning, quality, mining, drift, rollback or scheduler. | asset hub; curation |
| K Analytics | Partial | Current segment counts only. No word/CJK/repetition/match analysis, weighted effort, productivity or asset health. | project-lifecycle |
| L Standards | Missing | No XLIFF/TMX/TBX/SRX or external CAT interchange. | text/html/xliff; asset hub; interop/review |
| P Plugins | Partial architecture | One Rust `DocumentFilter` trait and event collector exist, but built-ins are not registry plugins and there is no manifest/runtime/permission/SDK. | core; plugin SDK |
| X Access | Partial internal | Private stdio JSON-RPC exists. No public local API, CLI, watch, clipboard, webhook or connector example. | API/CLI |
| M Data/settings | Partial | One local engine directory exists. No selectable location UI, keychain, whitelist, backup/restore or explicit telemetry setting. | core; AI grounding; platform |
| N Platform/install | Partial | Windows development build and crash recovery exist. No macOS evidence, installers, updater, i18n, tutorial, accessibility audit or release CI. | platform; release |

## Existing Strengths to Preserve

1. Renderer/main/preload/engine trust boundary and generated contracts.
2. SQLite WAL, foreign keys, immediate write transactions and revision conflicts.
3. Immutable managed DOCX source and validate-before-publish export.
4. Content/context hashes and provenance-bearing TM sinking.
5. IME composition guards and engine-acknowledged focus advancement.
6. OpenDesign workbench geometry, symmetric panels and multi-size Electron tests.

## Highest-Risk Gaps

1. The current document model stores plain source/target strings and structural
   paths only; inline tags and rich format fidelity require a compatible domain
   expansion before adding more filters.
2. Schema v1 assumes one project-owned TM; asset hub and collaboration require a
   migration strategy that preserves the existing MVP database.
3. The current protocol is request/response only; long-running pipelines,
   streaming AI, plugin events and progress require typed run/event contracts.
4. PDF/OCR, full Office fidelity, macOS packaging and performance targets need
   external fixtures/runners; release qualification must distinguish local
   deterministic evidence from platform/provider credentials.
5. Full PRD scope is multi-release. Serial child boundaries and integration
   gates are mandatory to keep the existing product runnable throughout.

## Requirement-to-Task Coverage

- A -> core + project lifecycle
- B -> core + text/HTML/XLIFF/SRX + Office + PDF + plugin SDK
- C -> professional editor + plugin SDK
- D/E/J-01/AC-02 -> asset hub
- F/G-01/G-12/M-02 -> AI grounding
- H/I-01/I-02 -> QA/review
- J/L/I P1 -> interoperability/alignment/review
- AC -> curation + advanced AI + plugin SDK
- K -> project lifecycle/analytics
- P -> core internal registry + public plugin runtime/SDK
- X -> API/CLI/automation
- advanced F/G/H -> advanced AI/quality
- I-05..I-08 -> collaboration server
- M/N -> core + AI + platform product shell
- NFR and §10 success standards -> release qualification

All explicit PRD modules are covered. §2.5 non-goals remain excluded.
