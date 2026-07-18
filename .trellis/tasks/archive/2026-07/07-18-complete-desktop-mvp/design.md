# Technical Design: Complete Desktop MVP and Frontend Fidelity

## 1. Release Boundary

This release is a complete local-first DOCX translation product, not the full
long-term format and connector roadmap in `docs/PRD.md`.

Included and complete:

- project setup with source/target language and domain;
- one or more imported DOCX documents represented by the existing engine;
- editable bilingual segments with debounced persistence, IME-safe confirmation,
  engine-derived counts, exact TM suggestions, number QA, restart recovery, and
  validated DOCX export;
- a high-fidelity desktop workbench matching the OpenDesign anchor, including
  Matches, Terms, and Assistant suggestion states, document preview, and every
  docked/collapsed/maximized panel state;
- a local Assistant interaction surface with model/reasoning/conversation
  controls, deterministic offline responses, target insertion, and compact
  response usage metadata. It is explicitly an offline preview provider; no
  external model request or cloud capability is implied by this release;
- navigable QA review, export review, and translation-memory views built from
  authoritative workspace data. Actions shown on these views are limited to
  operations that the existing engine can actually complete.

Deferred rather than partially implemented:

- external AI connectors, API-key storage, streaming model calls, and batch
  pretranslation;
- PDF/OCR, XLSX, PPTX, HTML, Markdown, XLIFF, and other format filters;
- fuzzy/CJK TM retrieval, full termbase persistence/import/export, collaboration,
  plugins, public API/CLI, installers, and automatic updates.

## 2. Existing Boundary to Preserve

```text
React renderer
  -> context-isolated preload DesktopApi
  -> Electron main
  -> JSON-RPC stdio engine client
  -> Rust domain/storage/filter services
  -> SQLite WAL + managed DOCX files
```

The Rust engine remains the sole owner of segment transitions, counts, TM
provenance, QA reconciliation, document processing, SQLite, and export. No new
renderer-side business rule may replace an engine response. The Assistant
offline response generator is presentation-only and operates on the active
segment already supplied by the engine.

## 3. Renderer State Model

`App` owns the current surface and the loaded workspace:

```text
setup | workbench | qa-review | export-review | translation-memory
```

`Workbench` owns ephemeral presentation state:

- active segment, filter, in-file search, active suggestion tab;
- Suggestions and document preview modes: `docked`, `collapsed`, `maximized`;
- preview height and follow-active-segment toggle;
- save/action busy state and transient toast;
- Assistant conversations, selected model/reasoning level, transcript, and
  compact response metrics (persisted only as UI preferences/session data).

Engine responses replace `segments`, `counts`, `issues`, and TM results. Local
state never invents a confirmed/draft/untranslated transition.

### Component boundaries

- `App.tsx`: workspace restore, surface navigation, and page shell callbacks.
- `SetupView.tsx`: project/document creation form; preserve existing E2E labels.
- `Workbench.tsx`: editor orchestration and shared workbench chrome.
- `AssistantPanel.tsx`: offline conversation state and accessible metrics.
- `WorkbenchPages.tsx`: QA, export review, and TM read-only projections with
  real callbacks into the workbench/engine.
- `workbench-utils.ts`: pure filter/IME/navigation/fixture helpers.
- `styles.css`: one token layer and state classes; no inline layout styles.

The split is intended to reduce the current 1,000-line component without
rewriting the product or duplicating engine orchestration.

## 4. Interaction and Motion Contracts

### Suggestions

- Use one contiguous header title block (`clip-path` on the single element) and
  one dot field underneath it. Do not join a pseudo-element triangle to a second
  background shape.
- Expanded header contains one collapse chevron and one maximize/restore control.
- Collapsed state retains a 48px right rail with exactly one expand chevron and a
  vertical Suggestions label.
- Width transitions use the same 220ms easing in both directions. Content fades
  and translates while the rail crossfades; the DOM remains mounted so collapse
  never becomes an abrupt `display:none` operation.
- Maximized mode sets the editor track to zero and gives the Suggestions surface
  the complete work area; restoring returns to the prior docked geometry.

### Document preview

- Default height is 200px, collapsed height is 32px, and maximized mode gives the
  editor grid zero height while retaining the preview header and content.
- Collapse/expand uses the same stateful control and 200-220ms grid-track motion.
- A visible divider/height affordance is present where space allows; resizing is
  pointer and keyboard safe, clamped to 120-320px, and persisted as a UI
  preference.
- Active segment remains highlighted and focus is not moved by panel animation.

### Assistant

- Default conversation contains one deterministic response for segment 418 so the
  interaction is inspectable on first open.
- Model defaults to `grok-4.5`; reasoning defaults to `high`, matching the
  approved OpenDesign configuration. Changing either updates the next response's
  metadata; it does not claim a network request.
- Conversation selector opens an anchored list with new/select/archive actions.
- Quick actions and the composer create user/assistant turns. Ctrl/Cmd+Enter
  submits outside IME composition only.
- Each assistant response renders compact icon+value metrics for model, input,
  cache-read, thinking, output, cache-write, and elapsed time. `title`, focusable
  labels, and a hover/focus tooltip expose the full meaning.
- `Use in target` reuses the existing editor insertion path and therefore remains
  IME-safe and debounced.

## 5. Rendering Strategy

- Replace unavailable web-font-first stacks with Windows-hinted system stacks:
  `Segoe UI Variable`/`Segoe UI`/`Microsoft YaHei UI` for body, `Bahnschrift` or
  `Segoe UI Variable Display` for display text, and `Cascadia Mono`/`Consolas` for
  metadata. Keep the OpenDesign hierarchy and weights while ensuring the chosen
  fonts exist on the supported Windows target.
- Remove `-webkit-font-smoothing: antialiased` as a global prescription; use
  normal platform antialiasing, `text-rendering: optimizeLegibility`, and
  `font-kerning: normal`.
- Eliminate fractional panel widths at supported breakpoints. Suggestions uses
  integer CSS widths (400px desktop, 352px compact, 48px rail) and an internal
  border rather than two adjacent fractional borders.
- Keep one-pixel rules on layout boundaries, avoid transforms on readable text,
  and animate only shells, opacity, and non-text guides.
- Dot matrices are CSS backgrounds in dedicated empty chrome elements only. They
  are never assembled from image tiles or placed behind source/target prose.

## 6. Data Flow

```text
engine project.get / segment.list / qa.list
  -> App workspace snapshot
  -> Workbench presentation state
  -> user edit
  -> segment.updateTarget (expected revision)
  -> returned Segment replaces local row

active source
  -> tm.lookupExact
  -> Matches tab

Run QA / confirm
  -> qa.runDocument or segment.confirm
  -> returned issues/counts/TM entry
  -> workbench + QA review projections

Export review
  -> persist pending edits
  -> document.exportDocx
  -> main-owned save dialog
  -> validated output toast
```

No new protocol method is required for this release. Avoiding a speculative
assistant/backend contract keeps the MVP honest and preserves the tested Rust
surface.

## 7. Compatibility and Recovery

- Existing Playwright selectors and M0 flows remain valid; labels such as
  `Choose file`, `Create and import`, `Confirm`, `Run QA`, `Export`, `Collapse
  Suggestions`, `Open Suggestions`, and preview state labels remain stable.
- Existing localStorage session recovery remains the fast path. Invalid sessions
  return to setup as today.
- UI preferences use a separate versioned key and can be discarded without
  affecting engine data.
- Existing Rust tests, protocol schema, and DOCX behavior must remain unchanged
  unless a test exposes a real regression.

## 8. Risks and Rollback

- **Font availability:** system stacks have explicit fallbacks; visual checks run
  on Windows and Linux to catch metric drift.
- **Panel animation regressions:** retain the old three-mode class contract and
  assert numeric geometry after transitions in E2E.
- **Large component change:** split by pure presentation boundaries first; revert
  a page component independently if it threatens the core workbench path.
- **Prototype/engine mismatch:** omit or label any control for which the engine
  has no real operation; never add a fake persistence action.
- **Disk pressure:** build and test on the existing K: workspace/VPS paths and do
  not create redundant asset bundles.
