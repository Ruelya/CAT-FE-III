# Findings round 3

## meta
- task: `.trellis/tasks/08-07-ortho-frontend-phase-2-workbench-skeleton`
- branch: `implement/ortho-frontend`
- head_sha: `949989631ce2eec356b1bfda35f62e78a488b7fe`
- round: 3
- resume_basis: post-fix working tree judged against `prd.md`, `design.md`, `implement.md`, `review/findings-2.md`, and the full `review/verify-1.md`

## need_verify
- required: false

### Verify mission
- none — the remaining major is demonstrable from the current focus/scroll code and does not need Electron runtime evidence before another fix. The unavailable `target/debug/translunar-engine.exe` remains an accepted environment residual from `verify-1.md`; do not repeat an Electron mission solely for that binary.

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:406-427`, `apps/desktop/src/renderer/Workbench.tsx:1476-1517`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:296-335`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.test.tsx:171-197`
- problem: **Fixed by code and focused unit evidence.** Matrix storage is now sized from the authoritative document total and populated by `segment.ordinal`; unresolved ordinals remain `null`. Matrix click navigation resolves an ordinal directly and clears incompatible status/text projections before loading an off-window ordinal. Aggregation now remains neutral whenever any bucket member is unresolved, while fully known buckets keep the required error-first precedence.
- minimal_fix: none
- status: fixed

### F2
- severity: major
- files: `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:126-130`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:181-219`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:227-269`, `apps/desktop/src/renderer/styles/10-components/matrix.css:49-52`, `apps/desktop/src/renderer/styles/10-components/matrix.css:94-97`, `apps/desktop/src/renderer/Workbench.tsx:1520-1531`
- problem: **Partially fixed; remains major.** Wheel forwarding and bracket pointer callbacks now reach the real grid, and the component tests prove those callbacks fire. The required Matrix keyboard navigation is still not a usable roving-focus implementation: `Tab` focuses the `.doc-matrix` container, every dot remains `tabIndex={-1}`, arrows only update an internal `focusCell`, there is no `aria-activedescendant`, and CSS has no `[data-focus]` treatment. Actual DOM focus therefore never lands on the current dot as specified, arrow movement has no visible or assistive indication, and `Enter` can activate a target the keyboard user cannot identify. In addition, bracket drag sends a raw ratio to the current grid scroll range; with a status/text filter active that range is filtered-list space while the Matrix is document-ordinal space, so dragging to a document ratio can land on a different ordinal. The z-indexed bracket also intercepts pointer input over the dots inside its rectangle, making those dots unavailable to the click navigation path.
- minimal_fix: Implement a real composite focus contract: either rove `tabIndex=0` plus DOM focus among dot buttons, or keep container focus with stable dot ids, `aria-activedescendant`, and a visible `[data-focus]` state. On entry, select/announce the active cell; arrows/Home/End must visibly and accessibly move it; Enter must activate that cell; Escape must return to the grid. Map bracket drag through document ordinal navigation (including clearing incompatible filters/search), or otherwise prove a filter-safe ordinal mapping, and keep the bracket hit target from masking dot clicks. Add focused tests that assert `document.activeElement` or `aria-activedescendant`, visible focus state, Enter’s exact ordinal, filtered bracket seek, and the Workbench grid owner’s `scrollTop` rather than callback invocation alone.
- status: open

### F3
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:1385-1404`, `apps/desktop/src/renderer/Workbench.tsx:2320-2336`, `apps/desktop/src/renderer/Workbench.tsx:3054-3088`
- problem: **Fixed by exhaustive close-path inspection.** `openCommandPalette` captures the invocation owner, `closeCommandPalette` restores it with a connected-node guard and editor-region fallback, and every palette dismissal path now uses that helper: Escape, outside pointer dismissal, close button, disabled command, and successful command dispatch. There are no remaining direct `setCommandPaletteOpen(false)` calls outside the helper.
- minimal_fix: none
- status: fixed

### F4
- severity: minor
- files: `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:44-59`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:222-291`, `apps/desktop/src/renderer/i18n/messages.ts:1069-1082`, `apps/desktop/src/renderer/i18n/messages.ts:2926-2939`, `apps/desktop/src/renderer/i18n/messages.ts:4763-4776`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.test.tsx:70-100`
- problem: **Fixed.** Matrix landmark, title, state/range tooltips, and the five-state legend including neutral/loading are injected from both supported locale catalogs. Focused tests cover English and Chinese rendering.
- minimal_fix: none
- status: fixed

### F5
- severity: minor
- files: `docs/design-ii/09-implementation.md:161-171`, `apps/desktop/src/renderer/Workbench.tsx:2438-2517`, `apps/desktop/src/renderer/styles/30-surfaces/workbench.css:376-407`
- problem: **Fixed by the bounded documentation choice requested in round 2.** The implementation record now states that Phase 2 intentionally mounts the legacy flex host (`workbench-app` / `workbench-layout` / `editor-grid-row`), identifies `.wb` and `data-stack` as deferred/dead Phase 4 CSS, and no longer represents that CSS grid as the live Phase 2 layout.
- minimal_fix: none
- status: fixed

### F6
- severity: minor
- files: `.opencode/package.json`, `AGENTS.md`
- problem: **Fixed.** Both unrelated files are clean in the current working tree; the plugin upgrade and instruction edit no longer travel with this task.
- minimal_fix: none
- status: fixed

### F7
- severity: minor
- files: `apps/desktop/tests/e2e/workbench.spec.ts:6343-6346`, `apps/desktop/tests/e2e/workbench.spec.ts:6683-6685`, `apps/desktop/tests/e2e/workbench.spec.ts:6785-6795`
- problem: **Partially fixed; remains open.** The main Masthead, document-switcher, keyboard Global Search, Matrix-presence, and hidden-scrollbar assertions were retargeted, and Matrix unit coverage expanded. Two Workbench visual E2E paths still query removed `.project-identity strong` markup, so `getComputedStyle(null)` / the contrast helper will fail once Electron can run. The same visual-polish case still looks for an exact visible `Confirm` button and Shift+Tabs to it even though Phase 2 removed the rail Confirm control; `hasMatrix` is collected but never asserted. There is still no integration-level assertion for palette focus restoration or the Workbench Matrix scroll bridge.
- minimal_fix: Retarget both remaining identity selectors to the live Masthead (`.identity__name` against `.masthead`/`.identity`), replace the removed rail-Confirm focus sequence with the surviving row/shortcut confirmation contract, and assert `hasMatrix`. Add the smallest renderer-level integration seam needed to cover F2’s grid-scroll/focus behavior and F3’s palette focus return; keep Electron execution recorded as unavailable rather than retaining selectors known statically to be stale.
- status: open

### F8
- severity: nit
- files: `apps/desktop/src/renderer/styles/30-surfaces/workbench.css:476`
- problem: `git diff --check` fails on a new blank line at end of file.
- minimal_fix: Remove the extra blank EOF line and re-run `git diff --check`.
- status: open

## assumptions
- Independent post-fix validation in this review passed: `pnpm --filter @translunar/desktop typecheck` exited 0, and `pnpm --filter @translunar/desktop test` passed **195/195 tests across 32 files**. These results validate compilation and the current unit assertions; they do not override F2’s missing keyboard/filter-safe behavior or F7’s statically stale E2E paths.
- No Engine/Rust, generated/business contract, preload, main-process, or persistence file is changed by the task diff.
- The document switcher still awaits `persistAllSegments()` before the App-owned `loadWorkspace` path, so the save-before-navigation contract remains intact by code inspection.
- The Phase 2 match selector remains intentionally renderer-only: `All` is live and every other vocabulary option is disabled/deferred; no score, bucket, or RPC field was added.
- Live Electron geometry at 1250×744, 1680×942, and 1920×1080 remains unobserved because the Engine binary is unavailable. This is an explicitly retained residual risk, not the reason for the current `need_fix` verdict.

## summary_for_orchestrator
- F1, F3, F4, F5, and F6 are verified fixed. F2 remains the sole open major because Matrix arrows update invisible, unannounced state rather than real roving focus, and bracket dragging still conflates full-document ratio with filtered-list scroll space while masking dots under the bracket. F7 remains a cheap static test-maintenance minor, and F8 is whitespace cleanup. Send one narrow `trellis-fix` pass for F2 first, then F7/F8; no verify worker is needed before that fix.

## verdict
- result: need_fix
- open_counts: `blocker 0 / major 1 / minor 1 / nit 1 / needs_evidence 0`
- next_step: `trellis-fix` F2, then F7 and F8; resume `trellis-review` on the resulting diff.
