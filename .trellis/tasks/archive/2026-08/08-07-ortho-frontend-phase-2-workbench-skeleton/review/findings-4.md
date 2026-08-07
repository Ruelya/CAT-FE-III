# Findings round 4

## meta
- task: `.trellis/tasks/08-07-ortho-frontend-phase-2-workbench-skeleton`
- branch: `implement/ortho-frontend`
- head_sha: `949989631ce2eec356b1bfda35f62e78a488b7fe`
- round: 4
- resume_basis: second post-fix working tree judged against `prd.md`, `design.md`, `implement.md`, `review/findings-3.md`, and the full `review/verify-1.md`

## need_verify
- required: false

### Verify mission
- none — the remaining failures are statically reproducible from the current renderer/E2E markup. Package-scoped typecheck and unit evidence are sufficient for this judgment; do not reopen the unavailable Electron/Engine mission.

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:406-427`, `apps/desktop/src/renderer/Workbench.tsx:1474-1515`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:370-408`
- problem: **Remains fixed.** Matrix state and navigation stay in authoritative document-ordinal space, and mixed unknown buckets remain neutral.
- minimal_fix: none
- status: fixed

### F2
- severity: major
- files: `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:216-276`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:283-310`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.test.tsx:136-179`, `apps/desktop/src/renderer/styles/10-components/matrix.css:99-104`
- problem: **Partially fixed, but still open.** The second pass closes the prior visual/coordinate failures: arrows update a visible `data-focus` cursor, Enter sends the exact cell ordinal, bracket handles call document-ordinal `onNavigate`, the bracket body passes dot clicks through, and focused tests cover those paths. The assistive focus contract is still invalid: `.doc-matrix` has `role="navigation"` plus `aria-activedescendant`, but `aria-activedescendant` is not allowed on the navigation landmark role. Every dot remains `tabIndex={-1}`, so actual focus stays on that invalid composite owner and assistive technology cannot reliably receive the active-dot changes. A scoped run of the repository’s bundled `axe-core@4.10.3` against the current role/attribute structure reports critical `aria-allowed-attr`: `ARIA attribute is not allowed: aria-activedescendant="doc-matrix-dot-0"`. The unit test only checks that the attribute string changes and therefore locks in markup that the existing Workbench axe pass will reject when Electron becomes runnable.
- minimal_fix: Prefer the native roving-focus route already allowed by round 3: give exactly one dot `tabIndex={0}`, move real DOM focus between dot buttons on arrows/Home/End, and remove `aria-activedescendant` from the navigation landmark. Keep the visible `data-focus` styling, exact-ordinal Enter behavior, Escape-to-grid behavior, document-ordinal bracket navigation, and edge-only drag handles. Alternatively, place the active-descendant owner on an ARIA role that supports it and give descendants matching composite semantics, while retaining an outer navigation landmark. Add an axe/role assertion or an actual-focus unit assertion so the unsupported role/attribute combination cannot regress.
- status: open

### F3
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:1386-1402`, `apps/desktop/src/renderer/workbench-utils.ts:32-47`, `apps/desktop/src/renderer/workbench-utils.test.ts:33-46`
- problem: **Remains fixed.** Every command-palette close path still reaches the centralized dismiss flow. The extracted `restorePaletteOwnerFocus` helper now has unit coverage for a connected invocation owner and disconnected-owner fallback.
- minimal_fix: none
- status: fixed

### F4
- severity: minor
- files: `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:44-59`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:278-366`, `apps/desktop/src/renderer/i18n/messages.ts`
- problem: **Remains fixed.** Localized Matrix landmark, title, legend, range, and state copy remain present for both supported locales.
- minimal_fix: none
- status: fixed

### F5
- severity: minor
- files: `docs/design-ii/09-implementation.md:161-171`
- problem: **Remains fixed.** The implementation record truthfully documents the intentional Phase 2 legacy flex host and deferred `.wb`/`data-stack` migration.
- minimal_fix: none
- status: fixed

### F6
- severity: minor
- files: `.opencode/package.json`, `AGENTS.md`
- problem: **Remains fixed.** The unrelated files remain clean.
- minimal_fix: none
- status: fixed

### F7
- severity: minor
- files: `apps/desktop/tests/e2e/workbench.spec.ts:1165`, `apps/desktop/tests/e2e/workbench.spec.ts:3479`, `apps/desktop/tests/e2e/workbench.spec.ts:3812`, `apps/desktop/tests/e2e/workbench.spec.ts:3978`, `apps/desktop/tests/e2e/workbench.spec.ts:4064`, `apps/desktop/tests/e2e/workbench.spec.ts:6343-6348`, `apps/desktop/tests/e2e/workbench.spec.ts:6684-6698`, `apps/desktop/tests/e2e/workbench.spec.ts:6788-6828`
- problem: **Partially fixed, but still open.** The two stale identity selectors now target `.identity__name`; the visual-polish case asserts `hasMatrix`, replaces its removed rail Confirm path with `Ctrl+Enter`, and uses surviving chrome for focus/contrast evidence. Five other Workbench E2E flows still call `getByRole("button", { name: "Confirm", exact: true })` after editing a segment. Workbench no longer renders that rail button, so those tests are known to fail before exercising their QA, TM, review, and density assertions. The alignment-row Confirm selector at line 5385 is a different live control and is not stale.
- minimal_fix: Replace the five Workbench segment-confirm selectors at lines 1165, 3479, 3812, 3978, and 4064 with the surviving active-textarea `Control+Enter` contract, preserving each test’s existing focus/IME setup. Leave the alignment-row Confirm selector unchanged.
- status: open

### F8
- severity: nit
- files: `apps/desktop/src/renderer/styles/30-surfaces/workbench.css`
- problem: **Fixed.** `git diff --check` now exits 0; the extra EOF blank line is gone.
- minimal_fix: none
- status: fixed

## boundary_check
- `apps/desktop/src/renderer/workbench-utils.ts:32-47` is an acceptable renderer-local UI helper. `restorePaletteOwnerFocus` only checks DOM connection and calls `.focus()` on an owner/fallback; it contains no Engine, persistence, contract, command-domain, or business mutation logic. Its placement does not violate the PRD’s protected boundary. Moving it is optional organization work and is not requested for this phase.
- No Engine/Rust, generated/business contract, preload, main-process, or persistence file is changed.

## assumptions
- Independent round-4 validation passed: `pnpm --filter @translunar/desktop typecheck` exited 0, and `pnpm --filter @translunar/desktop test` passed **198/198 tests across 32 files**.
- `git diff --check` exits 0. CRLF conversion warnings are workspace normalization notices, not whitespace errors.
- The focused Matrix tests prove visible cursor movement, exact ordinal activation, ratio-to-ordinal mapping, and edge-handle structure. They do not refute axe’s critical role/attribute failure because they assert attribute presence rather than allowed ARIA semantics.
- Live Electron geometry remains an accepted environment residual from `verify-1.md` because `target/debug/translunar-engine.exe` is unavailable. It is not needed to prioritize the two current static fixes.

## summary_for_orchestrator
- F8 is closed and the renderer-local palette focus helper is boundary-safe. F7 is improved but still has five statically stale Workbench Confirm-button selectors. F2’s visual keyboard cursor, ordinal bracket mapping, and click-through handles are fixed, but the chosen `aria-activedescendant` owner is an unsupported navigation role and produces a critical axe violation; therefore F2 remains the sole open major. Send one final narrow fix for valid Matrix focus semantics plus the five E2E selectors, then resume review. No verify worker is needed first.

## verdict
- result: need_fix
- open_counts: `blocker 0 / major 1 / minor 1 / nit 0 / needs_evidence 0`
- next_step: `trellis-fix` F2’s invalid ARIA composite and F7’s five remaining stale Workbench Confirm selectors; then resume `trellis-review` for closeout judgment.
