# Frontend rebuild P0 vertical slice

## Status

- Phase: planning
- Priority: P0
- Target branch: `task/08-08-frontend-rebuild-p0-vertical-slice`
- Base branch: `refactor/frontend-3`

## Problem

The Electron renderer is an intentional wipe scaffold while the main process, preload bridge, `DesktopApi`, contracts, and Engine remain authoritative. The product needs one end-to-end renderer workflow that is useful and demonstrable without recreating the entire historical UI or introducing renderer-owned domain state.

## Goal

Deliver a complete, light-default CAT vertical slice:

1. boot and recover safely;
2. show a brand welcome when there are no projects, or a concise project home when projects exist;
3. create a project and import one source document;
4. hydrate an Engine-owned editing session;
5. edit and confirm segments with exact TM assistance;
6. run QA and inspect issues;
7. enforce the QA gate and export;
8. restart and resume a valid session.

The kept surfaces must be production-quality for their scope: accessible, resilient to RPC failure, IME-safe, visually coherent, and covered by unit and desktop E2E tests.

## Product principles

- The Engine owns projects, documents, segments, revisions, statuses, counts, QA, TM results, and export eligibility. The renderer only projects Engine responses and captures interaction.
- The shell is workbench-first: no global navigation for unavailable features and no empty feature shells.
- P0 defaults are fixed: light appearance and a low-saturation advanced-brown interactive accent. Theme and accent settings do not exist in this slice.
- Elevation comes from border, tone, spacing, and restrained shadow. Frosted glass, backdrop blur, and translucent glass panels are prohibited.
- New renderer icons use Phosphor. Icon-only controls have accessible names.
- Motion supports orientation and feedback; reduced-motion preferences are honored.
- UI copy is concise and functional. Do not add filler subtitles, guiding microcopy, or contrast-copy constructions using “不是”.

## In-scope surfaces

| ID | Surface | Required outcome |
| --- | --- | --- |
| S0 | Boot / Recovery | Light-first boot, Engine status, retry/restart, reconnect rehydration, and recover/discard handling for a non-empty draft journal. |
| S1a | Brand Welcome | Brand treatment and primary Create action when `project.list` is empty. No tile wall. |
| S1b | Project Home | Short masthead and Engine-backed project list when projects exist and there is no valid session. Rows open a project. |
| S2 | Create project | Minimal validated form invoking `project.create`; success continues to import. |
| S3 | Import one document | Native source picker followed by `document.import`; cancellation is a no-op and errors remain actionable. |
| S4 | Hydrate | Project/document/segment data is fetched from the Engine. Only versioned session identity is persisted in `localStorage`. |
| S5 | Workbench | Segment grid, target editing, IME-safe update/confirm, exact TM panel, panel collapse, authoritative statuses/counts, and safe save flushing. |
| S6 | QA | Run QA, list Engine issues, and jump to a referenced segment when the issue response provides a usable segment identity. |
| S7 | Export | Check `qa.gate.check`, block on a failed gate, then choose a path and invoke `document.export` only after a passing gate. |
| S8 | Resume | A valid persisted session rehydrates to Workbench; malformed, missing-domain, or recycled identities are cleared and resolve to Home. |

## Requirements

### R1 — Renderer boundary

- All domain reads and mutations go through `window.translunar` and canonical Engine methods.
- The renderer must not invent domain revisions, progress, counts, QA status, confirmation status, or export eligibility.
- Locally typed target text may be shown as an explicit pending draft, but domain status changes only after an Engine response.
- Main, preload, Engine, and generated contract behavior remain authoritative and are not redesigned for this task.

### R2 — Light-first visual foundation

- The document background and initial renderer styles are light before React hydration, preventing a dark flash.
- CSS custom properties define light surfaces, advanced-brown accent states, typography, borders, semantic colors, focus, spacing, radius, shadow, and motion.
- Success, warning, and error colors remain semantically distinct from the brown accent.
- Brand ribbon colors may appear in the brand mark only; interactive controls continue to use advanced brown.
- Renderer icons are provided by `@phosphor-icons/react` (or the selected official Phosphor React package), with no new Lucide use.
- No CSS `backdrop-filter`, frosted-glass surface, or glass-style translucent panel is introduced.

### R3 — Boot, Engine status, and reconnect

- Boot is gated until Engine initialization/status and startup routing have resolved; partially hydrated product surfaces are not interactive.
- The shell exposes connected, connecting/reconnecting, and failed/disconnected states without replacing valid content during a transient reconnect.
- Failed initialization offers Retry; an unrecoverable/disconnected state offers Engine restart through `restartEngine`.
- `onEngineStatus` and `onEngineReconnected` subscriptions are cleaned up correctly under React Strict Mode.
- Reconnection triggers authoritative revalidation/rehydration of the current session before editing actions are re-enabled.

### R4 — Draft recovery and save safety

- Startup reads the preload draft journal. A recoverable non-empty journal is presented before normal editing with explicit Recover and Discard actions.
- Recovery validates referenced domain identities before applying draft text. Stale or unreadable journal data is not silently presented as restored.
- Target edits are journaled through the `DesktopApi` journal methods; domain save/confirm success clears the corresponding recovered/pending journal state at the appropriate point.
- Leaving Workbench for Home, QA, Export, or another document-facing surface awaits pending target-save work.
- A failed flush keeps the user in Workbench, preserves the draft, and shows a typed actionable error.

### R5 — Session identity and startup routing

- Use one namespaced, versioned `localStorage` record containing only the minimum session identity required to reopen a project/document.
- Parsing is total and side-effect-free; malformed JSON, unsupported versions, missing required IDs, and non-object values are invalid.
- A syntactically valid record is still validated with Engine RPC before use.
- A valid project/document session resolves to Workbench and hydrates via RPC.
- An invalid, deleted, or recycled domain identity is removed from storage and routes to Home.
- With no valid session, `project.list` selects Brand Welcome for an empty list and Project Home for a non-empty list.
- Disposable panel collapse state may use a separate local UI preference; no Engine/domain data is cached in `localStorage`.

### R6 — Welcome and project home

- Brand Welcome contains the brand treatment and one primary Create action. An example-project action is optional and is not required for P0 acceptance.
- Project Home contains a concise masthead and Engine-backed project rows with an Open action.
- Opening a project validates it, lists its documents, and routes an empty project to Import. For the P0 single-document workflow, an available Engine-returned document can establish the active session and hydrate Workbench.
- Loading, empty, and typed error states are explicit and do not create dead controls.

### R7 — Create project

- The form exposes only fields required for a valid canonical `project.create` request.
- Client validation prevents an empty/invalid submission but does not duplicate domain policy beyond the contract.
- Duplicate submission is prevented while the request is pending.
- Success uses the returned Engine identity and routes to Import; failure stays on the form and preserves entered values.

### R8 — Import one source document

- Import starts with `selectSourceDocument`; picker cancellation causes no mutation and leaves the surface usable.
- A selected path is sent through canonical `document.import` for the active project.
- Duplicate import submission is prevented while pending.
- Success stores the minimum versioned session identity, fetches the authoritative document/segment state, and enters Workbench.
- Failure stays on Import with a typed error and Retry path; no imported-document status is invented.

### R9 — Workbench layout and projection

- Workbench uses persistent product chrome, a document/action header, the main segment grid, and a docked/collapsible exact-TM panel.
- The grid presents stable Engine segment identities, source, editable target, and Engine-owned confirmation/status information.
- Active selection and local dirty state are renderer interaction state; counts and progress are recomputed only from fresh Engine responses or displayed directly from Engine-provided values.
- Loading, no-segment, and RPC-error states are complete and keyboard reachable.
- QA and Export are the only product-level workbench destinations in P0; unavailable roadmap features have no navigation entries or dead links.

### R10 — Target edit, confirm, and IME safety

- Editing maintains an explicit local draft and uses `segment.editor.updateTarget` for persistence.
- Confirm serializes any pending target update before `segment.editor.confirm`, then rehydrates affected authoritative segment/progress data.
- An explicit Confirm control and its keyboard shortcut share one guarded action.
- While composition is active, including keyboard events reporting `keyCode`/`which` 229, no confirm, target mutation request, or automatic focus movement occurs.
- Focus advances only after successful confirmation and never as the result of a failed or stale request.
- Out-of-order update/confirm responses cannot overwrite a newer local draft or active selection.

### R11 — Exact TM

- The docked panel requests `tm.lookupExact` for the active segment using canonical request data.
- Results are rendered as Engine-provided suggestions; an empty result has a deliberate empty state.
- A collapsed panel remains available through an accessible named control.
- Stale lookup responses are ignored when active segment/session identity changes.

### R12 — QA review

- Run invokes `qa.run` for the active document/project context and then refreshes `qa.issue.list`.
- Issues display Engine-provided severity/message and stable identity data that is available in the canonical response.
- Jump-to-segment is enabled only when an issue carries a valid reference resolvable in the hydrated grid; otherwise no dead jump control is rendered.
- Returning to Workbench restores/focuses the referenced segment after required save flushing.
- Empty and failure states remain rerunnable and do not report a successful run without Engine confirmation.

### R13 — Gated export

- Export first invokes `qa.gate.check` for the active document context.
- A failing gate prevents `document.export`, displays the Engine result, and provides a route to QA when useful.
- Only after a passing gate does the renderer request a destination via `selectExportPath` and invoke `document.export` with the selected path.
- Picker cancellation causes no export mutation.
- Success and failure are reported from the Engine result; repeated clicks cannot create concurrent exports.

### R14 — Accessibility, resilience, and tests

- All controls are native-semantic where practical; form fields are labelled; icon-only buttons have accessible names; dialogs/recovery affordances manage focus; and keyboard focus is visibly styled.
- Text and interactive states meet WCAG AA contrast for normal desktop use.
- Motion is restrained in workbench interactions and disabled/reduced under `prefers-reduced-motion`.
- Every asynchronous action has pending, success where needed, error, and cancellation behavior; pending controls cannot submit duplicate operations.
- Unit coverage includes session parsing/routing decisions, IME guards, and appearance token defaults/forbidden material rules.
- Component/integration coverage uses the `DesktopApi` boundary and asserts canonical method calls, failure retention, and authoritative rendering.
- Desktop E2E uses new stable `data-testid` contracts and a real Engine for the P0 workflow.

## Acceptance criteria

- [ ] **AC1 — Light boot and recovery:** A cold Electron launch renders a light background without a dark flash, resolves Engine status before enabling domain interactions, and presents retry/restart when startup cannot connect. A non-empty valid draft journal offers Recover and Discard before editing.
- [ ] **AC2 — Empty home:** With `project.list` returning no projects and no valid session, the brand welcome is shown with a working Create action, no tile wall, no glass material, and no roadmap navigation.
- [ ] **AC3 — Existing-project home:** With projects and no valid session, the short project masthead/list renders Engine data; opening an empty project reaches Import and opening a usable project reaches a hydrated Workbench.
- [ ] **AC4 — Create and import:** A user can submit the minimal project form, choose one source document, import it, and reach Workbench. Cancellation performs no import; create/import failures preserve context and can be retried.
- [ ] **AC5 — Authoritative hydration:** Workbench source, targets, identities, statuses, and counts come from `project.get`, `document.list|get`, and `segment.editor.list` responses. No stored domain snapshot is used.
- [ ] **AC6 — Edit, confirm, and TM:** Editing a target persists via `segment.editor.updateTarget`; confirming serializes pending save then invokes `segment.editor.confirm`; successful completion rehydrates authoritative data; the active segment loads exact TM results in a docked/collapsible panel.
- [ ] **AC7 — IME contract:** Unit/component tests prove composition start through composition end and key code 229 cannot trigger mutation, confirmation, or focus movement; normal guarded confirmation still works afterward.
- [ ] **AC8 — Save-before-leave:** QA, Export, Home, and applicable session transitions await pending saves. A forced save failure leaves the current Workbench and draft intact with a typed error.
- [ ] **AC9 — QA:** Run QA invokes `qa.run`, refreshes `qa.issue.list`, renders empty/issues/errors accurately, and jumps to the referenced segment only when the response supports it.
- [ ] **AC10 — Gated export:** A failed `qa.gate.check` results in zero `document.export` calls. A passing gate plus selected destination invokes one export; picker cancellation invokes none.
- [ ] **AC11 — Resume:** After a successful import, restarting the renderer/Electron app with the valid versioned identity revalidates via RPC and opens Workbench. Malformed, deleted, and recycled identities are cleared and route to Welcome or Project Home according to `project.list`.
- [ ] **AC12 — Reconnect:** A transient Engine disconnect disables unsafe actions, retains current projection/draft, and rehydrates before re-enabling interactions after `onEngineReconnected`.
- [ ] **AC13 — Visual contract:** The renderer uses Phosphor for new UI icons, light-default tokens, advanced-brown interactive accents, independent semantic colors, visible focus, and no `backdrop-filter`/glass surfaces. Brand ribbon colors, if used, are limited to the brand mark treatment.
- [ ] **AC14 — Accessibility:** Keyboard-only traversal reaches all actions and segment editing; icon-only controls have accessible names; recovery focus is contained/restored appropriately; automated axe checks have no serious or critical violations on Welcome, Project Home, Workbench, QA, and Export.
- [ ] **AC15 — Automated workflow:** New desktop E2E selectors cover launch → welcome/home → create → import → edit and confirm → QA → gated export → restart/resume against the real Engine, with deterministic document and destination fixtures.
- [ ] **AC16 — Quality gates:** Focused renderer unit tests, the desktop test suite, desktop TypeScript typecheck, touched-path ESLint/Prettier checks, desktop build, and desktop E2E pass. Any unrelated repository-wide baseline failure is recorded separately and does not hide a touched-path failure.
- [ ] **AC17 — Manual demo:** From `pnpm dev:desktop`, the real-Engine workflow launch → welcome/home → create → import → edit and confirm → QA → gated export → restart/resume completes without DevTools intervention or renderer console errors.

## Out of scope

- Templates, batch operations, recycle bin, insights, and global search.
- Advanced editor operations: split/merge, find/replace, comments, spellcheck, and other professional-editor extensions.
- TM administration, termbase, alignment, reference corpora, and asset-management surfaces.
- PDF OCR and advanced import pipelines.
- Interop/task packages, plugins, AI, collaboration, and cloud services.
- Full settings: backup, restore, updates, data-directory management, install history, or settings navigation.
- Full tutorial/onboarding product.
- Theme switcher, dark theme, accent customization, or persistence of theme/accent in `ProductShellSettings`.
- Multi-document project management beyond opening an Engine-returned document for this single-document vertical slice.
- Drag-and-drop import, multi-file/folder import, and additional picker families.
- React Bits, global bento layouts, or motion-heavy workbench behavior.
- Changes to Engine domain rules, preload exposure, `DesktopApi`, generated protocol contracts, or main-process architecture unless a verified blocker is escalated to the Orchestrator.
- Long-term frontend spec correction from Lucide to Phosphor; closeout owns that guideline update.

## Assumptions

| ID | Assumption | Confidence |
| --- | --- | --- |
| A1 | Canonical request/response/error types for every listed method are available through the intact Desktop API/contracts, and implementation will bind to those types rather than duplicate them. | High |
| A2 | A versioned session identity containing project and document IDs is sufficient to validate and rehydrate Workbench; exact property names can follow canonical ID types. | Medium-high |
| A3 | For an existing P0 project with more than one Engine-returned document and no stored document identity, selecting the first document in Engine-provided order is an acceptable deterministic fallback; no renderer-derived recency is claimed. | Medium |
| A4 | The authoritative `DraftJournal` type contains enough identity/content information to validate and recover an in-progress target. The renderer will adapt to its actual shape rather than invent a parallel journal schema. | Medium-high |
| A5 | `qa.issue.list` may not guarantee a segment reference on every issue; jump controls are conditional by design. | High |
| A6 | The optional example-project action is omitted unless it can be added without weakening the required path. Its absence does not block P0. | High |
| A7 | Existing Vitest, Testing Library, Playwright, and axe dependencies are the intended test stack; no second UI/test framework is needed. | High |
| A8 | Desktop E2E can use deterministic fixture paths while retaining the real Engine. Native picker behavior itself may be covered at the API-boundary/component level if OS dialog automation is unreliable. | Medium |
| A9 | Renderer source changes, desktop tests/E2E, `apps/desktop/package.json`, and `pnpm-lock.yaml` are sufficient. Main/preload changes should be treated as a scope blocker and reported before proceeding. | High |

## Success boundary

P0 is complete only when the retained workflow is coherent end to end. It is acceptable to omit an optional example action or every later feature; it is not acceptable to ship dead navigation, fake domain state, unsafe IME behavior, ungated export, lossy navigation, inaccessible icon controls, or placeholder surfaces inside S0–S8.
