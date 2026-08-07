# Findings round 2

## meta
- task: `.trellis/tasks/08-07-ortho-frontend-phase-2-workbench-skeleton`
- branch: `implement/ortho-frontend`
- head_sha: `949989631ce2eec356b1bfda35f62e78a488b7fe`
- round: 2
- evidence_source: `review/verify-1.md` (read in full)

## need_verify
- required: false

### Verify mission
- none — `verify-1.md` was consumed. The remaining Electron viewport uncertainty is an environment limitation caused by the missing `target/debug/translunar-engine.exe`, not an evidence gap that blocks fix prioritization. Do not open another verify loop for that limitation alone.

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:402-422`, `apps/desktop/src/renderer/Workbench.tsx:953-974`, `apps/desktop/src/renderer/Workbench.tsx:1357-1395`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:138-169`
- problem: **Verified by V1.** Matrix coordinates remain in filtered query index space rather than authoritative document ordinal space. With filter/search active, `editorTotal` and `editorOffset` describe the current query, so a dot can represent the wrong document position and `navigateMatrix` can seek the wrong segment. Mixed known/null buckets also discard nulls before choosing a dominant state, allowing unknown positions to inherit a definitive color.
- minimal_fix: Project loaded rows by their authoritative document ordinal, or explicitly resolve/clear incompatible filter/search projections before Matrix seeking. Preserve neutral/unknown aggregate state when any member is unresolved. Add focused tests for filtered, searched, off-window, and mixed-null navigation.
- status: open

### F2
- severity: major
- files: `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:98-127`, `apps/desktop/src/renderer/styles/10-components/matrix.css:65-76`, `apps/desktop/src/renderer/Workbench.tsx:1029-1045`
- problem: **Verified by V2.** The native grid scrollbar is hidden, but Matrix interaction is click-only. There is no wheel forwarding, viewport-bracket drag, or Matrix keyboard/roving navigation; the bracket is `aria-hidden` and `pointer-events: none`. The real grid still scrolls when directly interacted with, but the documented scroll-takeover affordances are absent.
- minimal_fix: Add a renderer-only bridge to the existing grid scroll owner for Matrix wheel deltas, bracket pointer capture/seek, and keyboard entry/arrow/Enter/Escape behavior. Do not create a second scroll position, and preserve active textarea/IME focus semantics. Add tests for grid `scrollTop` and focus stability.
- status: open

### F3
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:1300-1305`, `apps/desktop/src/renderer/Workbench.tsx:2183-2198`, `apps/desktop/src/renderer/Workbench.tsx:2913-2941`
- problem: **Verified by V3.** Global Search restores focus, but command-palette outside-click, close-button, disabled-command, and successful-command paths directly call `setCommandPaletteOpen(false)` without restoring focus to a stable Workbench owner. This fails the explicit close/focus acceptance criterion and the shell navigation focus contract.
- minimal_fix: Centralize command-palette dismissal with a requestAnimationFrame focus restore to the invocation owner, falling back to `editorRegionRef`. Use the helper for every close path, including Escape, outside click, close button, disabled commands, and successful commands.
- status: open

### F4
- severity: minor
- files: `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:98-117`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:172-185`, `docs/design-ii/03-signatures.md:200-208`
- problem: **Verified by V4.** The Live Matrix has no visible title/legend, and its accessible landmark and tooltip vocabulary is hardcoded Chinese. The English locale therefore exposes Chinese Matrix labels and users lack an explanation of the state encodings.
- minimal_fix: Add localized Matrix title/legend content, including neutral/loading, and move landmark/range/state labels into the existing message catalogs. Update the component tests so both supported locales are covered.
- status: open

### F5
- severity: minor
- files: `apps/desktop/src/renderer/Workbench.tsx:2259-2302`, `apps/desktop/src/renderer/Workbench.tsx:2355-2372`, `apps/desktop/src/renderer/styles/30-surfaces/workbench.css:10-31`
- problem: **Confirmed by V5.** The documented `.wb` grid is dead CSS: the mounted tree uses `workbench-app` plus the legacy flex hierarchy, with no `.wb` root or active `data-stack` area ownership. The implementation record presents the Phase 2 skeleton as delivered even though the responsive `.wb` grid contract is not live.
- minimal_fix: Prefer the low-risk bounded fix of documenting the legacy flex layout as the intentional Phase 2 implementation, removing or qualifying the dead `.wb` skeleton claim in the Phase 2 implementation record, and recording the required-width limitation. Only mount `.wb` if the implementer can do so without broad Stack/preview regression.
- status: open

### F6
- severity: minor
- files: `.opencode/package.json:3`, `AGENTS.md:61`
- problem: The unrelated `@opencode-ai/plugin` upgrade and instruction-file edit remain dirty in the task worktree. They are outside the Phase 2 renderer scope and can introduce unrelated tooling or instruction drift.
- minimal_fix: Revert both files before handoff. Keep only the renderer/UI, focused tests/styles/i18n, App wiring, implementation record, and required Trellis task artifacts in this task diff.
- status: open

### F7
- severity: minor
- files: `apps/desktop/tests/e2e/workbench.spec.ts:5845-5988`, `apps/desktop/tests/e2e/workbench.spec.ts:6743-6791`, `apps/desktop/src/renderer/components/workbench/ActiveAxis.test.tsx:1-21`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.test.tsx:1-56`, `apps/desktop/src/renderer/components/workbench/FilterRail.test.tsx:1-109`
- problem: **Confirmed by V6.** Existing E2E assertions still target removed `.document-switcher`, `.global-search-command`, app-bar “More actions”, and a visible 10px native scrollbar. The new unit coverage remains isolated (188/188 desktop Vitest is green; 13/13 focused Phase 2 tests), with no Masthead or Workbench integration coverage for Matrix projection, palette focus, document switching, or layout.
- minimal_fix: If inexpensive, retarget the stale E2E selectors/assertions to the Phase 2 Masthead/FilterRail/Matrix/hidden-scrollbar contract and add focused integration checks. If the missing Engine prevents execution, still update statically stale selectors now and record the live-Electron limitation for final validation rather than treating 188 unit passes as full acceptance evidence.
- status: open

## assumptions
- V8 confirms `pnpm --filter @translunar/desktop typecheck` is clean and the full desktop Vitest suite is 188/188 across 32 files; this is positive evidence only and does not close F1–F4 or F7.
- V1–V4 are direct confirmatory evidence for the three majors and F4; no new verify mission is needed to prioritize their fixes.
- V5 provides sufficient static evidence to move F5 from `needs_evidence` to `open`. The recommended fix is to document the intentional legacy layout rather than mount `.wb` as a broad redesign.
- V6 provides sufficient static evidence to move F7 from `needs_evidence` to `open`; the stale E2E selectors are known independently of the unavailable Electron runtime.
- V7 is an environment residual only: live viewport geometry and integrated interaction remain unobserved because `target/debug/translunar-engine.exe` is missing. This does not waive the verified code-path failures and does not justify another verify loop by itself.
- V9 and the current worktree confirm F6 remains open.
- The deferred match selector remains an intentional Phase 2 residual: `All` is live, other vocabulary is non-operative, and no Engine/RPC projection should be invented.
- No Engine, Rust, contract/generated-contract, preload, main-process, or persistence files are changed.

## fix_priority_for_trellis_fix
1. **F1 — Matrix ordinal and unknown-state projection:** correct coordinate space and neutral aggregation before changing interactions; this is the source-of-truth issue for every Matrix seek and viewport state.
2. **F2 — Matrix scroll takeover:** add wheel, bracket drag, and keyboard behavior against the existing grid scroll owner; retain active textarea/IME focus behavior.
3. **F3 — Command-palette focus restoration:** centralize all close paths and restore the invocation owner or stable editor-region fallback.
4. **F4 — Matrix legend and localization:** add localized title/legend and catalog-backed accessible labels/tooltips; update the isolated tests.
5. **F6 — Scope hygiene:** revert `.opencode/package.json` and `AGENTS.md` so unrelated tooling/instruction changes do not travel with the feature.
6. **F5 — Document the intentional legacy layout:** qualify/remove the dead `.wb` implementation claim in the Phase 2 record rather than mounting the grid unless a low-risk mount is demonstrated.
7. **F7 — Cheap test maintenance:** update stale E2E selectors/assertions and add integration coverage where practical; do not block fixes on the missing Engine binary.

## summary_for_orchestrator
- `verify-1.md` confirms the three majors F1–F3 and minor F4, while also confirming F5 and F7 as open static/layout-test issues. Typecheck and 188/188 Vitest pass, document-switch persistence wiring is correct by code inspection, and ActiveAxis is mutually exclusive in isolation. The task remains `need_fix` with no new verify mission: the missing Engine binary is a residual environment limit, not a reason to repeat verification before fixing the confirmed issues.

## verdict
- need_fix: yes
- blocker/major/minor/needs_evidence: `0 / 3 / 4 / 0`
