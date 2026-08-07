# Findings round 5

## meta
- task: `.trellis/tasks/08-07-ortho-frontend-phase-2-workbench-skeleton`
- branch: `implement/ortho-frontend`
- head_sha: `949989631ce2eec356b1bfda35f62e78a488b7fe`
- round: 5
- resume_basis: final narrow F2/F7 fix judged against `prd.md`, `design.md`, `implement.md`, `review/findings-4.md`, and the full `review/verify-1.md`

## need_verify
- required: false

### Verify mission
- none — the final issues are settled by current code inspection, focused unit assertions, package typecheck, and the complete desktop Vitest suite. Do not reopen a verify loop solely for the unavailable Engine binary.

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:406-427`, `apps/desktop/src/renderer/Workbench.tsx:1474-1515`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:365-403`
- problem: **Fixed.** Matrix state, active position, navigation, and neutral aggregation remain in authoritative document-ordinal space.
- minimal_fix: none
- status: fixed

### F2
- severity: major
- files: `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:217-275`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:277-307`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.test.tsx:136-183`, `apps/desktop/src/renderer/styles/10-components/matrix.css:99-141`
- problem: **Fixed.** The navigation landmark no longer owns the invalid `aria-activedescendant` attribute and is no longer itself a tab stop. Exactly one Matrix dot receives `tabIndex={0}`; arrows/Home/End move real DOM focus and the visible `data-focus` cursor among dot buttons, Enter navigates the exact document ordinal, and Escape returns focus to the grid. The focused test asserts absence of the invalid ARIA attribute, one roving tab stop, real `document.activeElement` movement, exact ordinal activation, and tab-stop handoff. Wheel forwarding, filter-safe document-ordinal bracket navigation, and edge-only drag handles remain intact.
- minimal_fix: none
- status: fixed

### F3
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:1386-1402`, `apps/desktop/src/renderer/workbench-utils.ts:32-47`, `apps/desktop/src/renderer/workbench-utils.test.ts:33-46`
- problem: **Fixed.** Command-palette dismissal restores the connected invocation owner or stable Workbench fallback through the renderer-local focus helper.
- minimal_fix: none
- status: fixed

### F4
- severity: minor
- files: `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx`, `apps/desktop/src/renderer/i18n/messages.ts`
- problem: **Fixed.** Matrix title, legend, state, range, and landmark copy remain localized for both supported locales.
- minimal_fix: none
- status: fixed

### F5
- severity: minor
- files: `docs/design-ii/09-implementation.md:161-171`
- problem: **Fixed.** The implementation record truthfully documents the intentional Phase 2 legacy flex host and deferred `.wb` migration.
- minimal_fix: none
- status: fixed

### F6
- severity: minor
- files: `.opencode/package.json`, `AGENTS.md`
- problem: **Fixed.** Both unrelated files remain clean.
- minimal_fix: none
- status: fixed

### F7
- severity: minor
- files: `apps/desktop/tests/e2e/workbench.spec.ts:1162-1167`, `apps/desktop/tests/e2e/workbench.spec.ts:3477-3482`, `apps/desktop/tests/e2e/workbench.spec.ts:3811-3816`, `apps/desktop/tests/e2e/workbench.spec.ts:3978-3983`, `apps/desktop/tests/e2e/workbench.spec.ts:4066-4070`, `apps/desktop/tests/e2e/workbench.spec.ts:5387-5393`
- problem: **Fixed.** All five stale Workbench segment-confirm selectors now exercise the surviving active-textarea `Control+Enter` contract. The only remaining exact `Confirm` button selector is scoped to an alignment row whose Confirm control still exists; it is unrelated to the removed Workbench rail button. Prior identity, Matrix-presence, hidden-scrollbar, and visual-polish selector fixes remain present.
- minimal_fix: none
- status: fixed

### F8
- severity: nit
- files: `apps/desktop/src/renderer/styles/30-surfaces/workbench.css`
- problem: **Fixed.** `git diff --check` exits 0.
- minimal_fix: none
- status: fixed

## boundary_check
- `restorePaletteOwnerFocus` remains an acceptable pure renderer/UI helper. It has no Engine, persistence, business contract, or domain mutation behavior.
- No Engine/Rust, generated/business contract, preload, main-process, or persistence file is changed.

## residual_risks
- The full Electron Workbench suite and live geometry at 1250×744, 1680×942, and 1920×1080 remain unobserved on this machine because `target/debug/translunar-engine.exe` is unavailable. `verify-1.md` established this as an environment limitation rather than a product-code failure.
- The updated E2E paths should be rerun when a valid Engine binary is available, especially the supported-width, Matrix scroll/seek, focus-return, ActiveAxis-count, document-switch persistence, and axe checks. This residual is explicitly accepted for closeout because all known static failures are fixed, the selectors now match the live Phase 2 contract, and no additional product judgment is blocked.
- The intentional legacy flex host remains the documented Phase 2 layout choice; `.wb`/`data-stack` migration stays deferred to the later Stack/preview phase.

## assumptions
- Independent final validation passed: `pnpm --filter @translunar/desktop typecheck` exited 0, and `pnpm --filter @translunar/desktop test` passed **198/198 tests across 32 files**.
- `git diff --check` exits 0. CRLF conversion warnings are workspace normalization notices only.
- The deferred match selector remains renderer-only with `All` as the sole live option and no Engine/RPC field changes.

## summary_for_orchestrator
- F2 and F7 are closed: Matrix uses valid native roving focus with exact ordinal keyboard navigation, and all stale Workbench Confirm-button E2E paths use `Control+Enter`. F1–F8 are now fixed, scoped typecheck and 198/198 desktop tests pass, diff whitespace is clean, and protected boundaries remain untouched. The missing Engine binary is retained only as an explicit live-E2E/viewport residual. The task is ready for `trellis-closeout`.

## verdict
- result: ready_for_closeout
- open_counts: `blocker 0 / major 0 / minor 0 / nit 0 / needs_evidence 0`
- next_step: run `trellis-closeout`; when an Engine binary is available, rerun the selective Workbench Electron/viewport suite as recorded residual validation.
