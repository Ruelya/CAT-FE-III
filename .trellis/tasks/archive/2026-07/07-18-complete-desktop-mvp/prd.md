# Complete Desktop MVP and Frontend Fidelity

## Goal

Deliver a complete, locally runnable Translunar CAT MVP whose accepted workflows
are real end to end and whose desktop UI faithfully implements the approved
OpenDesign visual and interaction prototype. The MVP must be credible for actual
translation work, not a static design demonstration or a collection of partially
wired screens.

## Background

- The completed M0 vertical slice already provides a secure Electron/React shell,
  a Rust headless engine, engine-owned SQLite persistence, DOCX import/export,
  editable and confirmable bilingual segments, exact translation-memory lookup,
  deterministic number QA, and restart recovery.
- The approved product boundary remains local-first Electron + TypeScript for the
  desktop shell and Rust for domain logic and persistence.
- The visual source of truth is the approved OpenDesign prototype and the anchor
  image/design documentation under `docs/`, not the current renderer.
- The current renderer reproduces the broad first-screen composition but does not
  yet reproduce the prototype's operation model, panel transitions, or rendering
  quality.
- Reported defects include visibly aliased text at a 1080p Windows desktop scale,
  a Suggestions boundary assembled from separate shapes with a large seam, and
  incomplete or incorrect expand/collapse behavior and animation.
- Earlier approved interaction direction includes editable translation targets,
  independently collapsible/expandable Suggestions and document-preview regions,
  and a dedicated Assistant experience with conversation, model, reasoning-level,
  and per-response usage metadata controls.
- The recovered OpenDesign project `cat-translunar-opendesign` contains the
  canonical workbench, panel states, Assistant controls, QA/export/TM views,
  project-flow screens, and QA screenshots. Its configured design agent remains
  Grok Build using `grok-4.5` with high reasoning.

## MVP Inventory

The accepted MVP is one complete local DOCX workflow plus the complete desktop
interaction shell needed to use and evaluate that workflow.

| Area | Included outcome | Source of truth |
| --- | --- | --- |
| Project setup | Create a local project, select one DOCX, import it, and enter the workbench | Rust engine + main-owned file dialog |
| Recovery | Reopen the last valid workspace after renderer/engine/application restart | Versioned local session pointer + engine reload |
| Editor | Filter/search segments, edit Chinese targets, save revisions, confirm, and advance safely outside IME composition | Rust engine responses |
| Suggestions | Exact confirmed TM matches can be inspected and inserted; missing termbase capability has an honest empty state | Rust engine for TM; presentation-only empty state for Terms |
| Assistant | Local deterministic preview with conversation management, `grok-4.5` request profile, high reasoning profile, seeded/send/quick-action turns, target insertion, and clearly presented synthetic usage metadata | Renderer-only offline preview; no network/model claim |
| QA | Run number QA, inspect source/target evidence, navigate to the affected segment, correct it, and prove resolution | Rust engine |
| Preview | Follow the active segment in a document-context preview and use docked/collapsed/maximized states | Engine segment content + renderer presentation |
| Export | Review current QA state, select a destination, export a validated translated DOCX, and report the real result | Rust engine + main-owned save dialog |
| Reference views | Navigate between workbench, QA review, export review, and an active-source exact-TM view without dead-end enabled controls | Renderer projections over engine data |

## Requirements

### R1. Non-negotiable completeness

- Define a deliberately bounded MVP before implementation begins.
- Every workflow included in that boundary must be implemented through the real
  renderer/preload/engine/storage path where persistence or domain behavior is
  involved. The explicitly labeled offline Assistant preview is presentation
  behavior and must not imply a model request or persisted AI capability.
- Existing completed M0 behavior must remain functional and persistent.
- Features deliberately excluded from the MVP must not appear as misleading
  enabled controls.

### R2. Prototype fidelity

- Reconstruct the approved desktop information architecture, proportions,
  typography, color system, dot-matrix texture, Translunar Band, density, and
  control hierarchy from the OpenDesign evidence.
- Eliminate visible seams, accidental shape joins, overlaps, clipped text, and
  decorative geometry that masquerades as functional structure.
- Maintain a serious, dense CAT work surface suitable for sustained desktop use.

### R3. Interaction fidelity

- Translation targets remain directly editable with IME-safe save and confirm
  behavior.
- Suggestions and document-preview regions each expose unambiguous controls for
  their complete expanded and collapsed states.
- Panel state changes animate in both directions without abrupt disappearance,
  layout jumps, or content occlusion.
- Editor space is reclaimed deterministically as panels collapse and restored as
  they expand; keyboard focus and active-segment context remain stable.
- All visible primary controls have implemented hover, focus, pressed, disabled,
  loading, success, empty, and error behavior where applicable.

### R4. Windows 1080p rendering quality

- Text and one-pixel geometry render cleanly at the user's 1920x1080 Windows
  environment and supported Electron device-scale factors.
- Font loading, fallback, antialiasing-sensitive CSS, fractional layout, transforms,
  and compositor use are audited rather than hiding the defect with heavier text.
- Layout remains coherent at the existing automated 1250x744 and 1680x942
  viewports and at 1920x1080.

### R5. Functional MVP workflow

- The scope forms one complete path from local project setup and DOCX import
  through translation editing, exact-TM reuse, local Assistant preview, number
  QA review, restart recovery, and valid DOCX export.
- Reopening the last valid workspace must reload project, document, segment, and
  QA data from the engine rather than retained in-memory renderer state.
- Counts, segment states, issues, matches, and export results must come from the
  engine contract, not duplicated presentation rules.
- QA/export/TM reference views may present existing engine data but must omit any
  mutation for which no engine operation exists.

### R6. Verification and delivery

- Add focused component/unit tests for deterministic UI state and interaction
  behavior and Electron Playwright coverage for every accepted end-to-end
  workflow. Existing Rust coverage must remain green; new Rust tests are required
  only if implementation evidence forces an engine change.
- Perform screenshot-based visual review at 1250x744, 1680x942, and 1920x1080,
  including expanded and collapsed panel states.
- Verify the Windows development build locally and use the configured VPS for
  build work when local storage is insufficient.
- Update run and architecture documentation so the delivered MVP can be started
  and evaluated without reconstructing session context.

## Acceptance Criteria

- [ ] AC1: Every included user-facing control maps to the outcome in the MVP
      Inventory; excluded capabilities have no misleading enabled control.
- [ ] AC2: A user can create a project, import a DOCX, edit and confirm targets,
      reuse an exact TM result, run/fix number QA, restart/reopen the workspace,
      and export a valid translated DOCX without developer intervention.
- [ ] AC3: The workbench matches the approved OpenDesign source at desktop scale,
      with no visible Suggestions seam, shape-join artifact, overlap, clipped
      content, or misleading decorative control.
- [ ] AC4: Suggestions and document preview transition smoothly and symmetrically
      between all accepted states, reclaim the intended editor area, preserve
      focus/context, and remain operable by mouse and keyboard.
- [ ] AC5: Translation editing remains IME-safe, persists through restart, handles
      save/conflict/error states visibly, and advances only after confirmed engine
      success.
- [ ] AC6: Text and hairline rendering show no obvious aliasing regression in
      captured 1920x1080 Windows output; loaded fonts and device scale are
      programmatically observable in the visual test evidence.
- [ ] AC7: Automated visual evidence covers 1250x744, 1680x942, and 1920x1080 for
      the default workbench plus all major panel states, with no incoherent layout
      shift or content occlusion.
- [ ] AC8: Formatting, lint, type checks, unit/integration tests, protocol drift
      checks, engine smoke tests, and Electron end-to-end tests all pass.
- [ ] AC9: The documented local launch path starts the verified MVP build using
      the repository-pinned Node 22, pnpm, Electron, and engine versions.
- [ ] AC10: The Assistant tab defaults to `grok-4.5` and high reasoning, manages
      multiple local conversations, creates deterministic turns, inserts an
      accepted target through the existing save path, and exposes model/input/
      cache-read/thinking/output/cache-write/elapsed metadata through compact
      icons with hover and keyboard explanations; it is visibly an offline
      preview and never claims a real model request.
- [ ] AC11: QA review, export review, and exact-TM reference views are reachable
      and return to the workbench; every action on them calls a real existing
      workflow or is omitted.

## Constraints

- Node.js must remain on supported 22.x (`>=22.17.0 <23`); Electron 39 under
  Node.js 24 is not a supported setup.
- The renderer must not acquire filesystem, persistence, CAT state-transition,
  QA, or translation-memory business rules.
- SQLite and managed files remain exclusively engine-owned.
- Existing user-authored changes and design artifacts must be preserved.
- MVP scope may be narrow, but once a feature is selected it must be complete.

## Out of Scope

- Network AI/model connectors, API-key storage, streaming generation, batch
  pretranslation, or billing/cost accounting. Assistant metrics are synthetic
  interaction fixtures and must be identified as such.
- Persistent termbase management or term insertion; the Terms tab provides an
  honest empty state until an engine contract exists.
- Fuzzy/CJK TM retrieval and full TM browse/edit/import/export maintenance.
- Formats beyond the existing conservative DOCX filter, including PDF/OCR,
  XLSX, PPTX, TXT/Markdown, HTML, and XLIFF.
- SRX configuration, tags, split/merge, comments, spelling, replace-all,
  collaboration, plugins, or a public API/CLI.
- Installer/notarization, automatic update, macOS runtime validation, and release
  signing. The delivered artifact remains a verified development MVP build.
