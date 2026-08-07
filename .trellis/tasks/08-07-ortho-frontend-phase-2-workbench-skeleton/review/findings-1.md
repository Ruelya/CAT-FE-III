# Findings round 1

## meta
- task: `.trellis/tasks/08-07-ortho-frontend-phase-2-workbench-skeleton`
- branch: `implement/ortho-frontend`
- head_sha: `949989631ce2eec356b1bfda35f62e78a488b7fe`
- round: 1

## need_verify
- required: true

### Verify mission (required if need_verify)
- purpose: The implementation note and worker claim report clean typecheck/tests, but the Phase 2 acceptance depends on integrated Workbench behavior that the new isolated component tests do not exercise: virtual-window Matrix indexing, hidden-scrollbar takeover, focus return, document switching, and supported-width layout.
- questions:
  - Q1: Does the desktop renderer typecheck and does the renderer test run pass with the Phase 1 baseline plus the new Phase 2 coverage? What is the actual test count, and are there failures or stale assertions rather than merely an exit code?
  - Q2: At 1250×744, 1680×942, and 1920×1080, does the mounted Workbench have a visible Masthead, exactly three reachable FilterRail groups, a Matrix beside the actual grid, no page-level horizontal overflow, and no control overlap or clipping? Is the `.wb` grid actually mounted, or is the legacy layout serving as the intentional equivalent?
  - Q3: With more than one virtual window and with status/search filters active, do Matrix cells retain document-order/ordinal meaning, avoid coloring unknown positions as known states, and navigate to the exact requested segment while the real grid scrolls to it? After a QA refresh or document replacement, do Matrix states and the viewport bracket update without stale projection?
  - Q4: Does Matrix interaction provide the documented scroll takeover (wheel over Matrix, viewport-bracket seeking/drag, keyboard entry/navigation/activation) while native grid scrolling remains available by wheel, keyboard, programmatic, and accessibility paths? Does seeking leave an active translation textarea focused?
  - Q5: Does `Ctrl+Shift+K` open GlobalSearchPanel and `Ctrl+K` open the command palette, with Escape/close/outside-click for either returning focus to a stable Workbench owner? Does changing the native Masthead document switcher persist drafts before loading the selected document?
  - Q6: Does the live DOM have at most one Workbench `[data-axis="active"]`, one Masthead bevel, and an interpretable Matrix with title/legend and localized accessible labels?
- success_criteria:
  - `pnpm --filter @translunar/desktop typecheck` completes without TypeScript errors.
  - `pnpm --filter @translunar/desktop test` (or the repository's renderer-equivalent command) passes, including the prior baseline and focused Phase 2 tests; the report records the real count and does not silently omit stale Workbench coverage.
  - At all three required desktop sizes, the actual rendered controls remain visible/reachable, the page and Workbench do not gain horizontal overflow, and the Matrix is visibly adjacent to the grid.
  - Matrix seek resolves the same document ordinal/segment that its dot represents across unloaded windows and filters; unknown/unloaded cells remain neutral rather than inheriting a guessed known state.
  - Wheel/keyboard/programmatic grid scroll remains functional after scrollbar hiding; Matrix seeking/dragging updates that one grid scroll owner and does not focus or blur the active translation textarea unexpectedly.
  - Both shortcuts open their intended overlays and every close path restores focus to a surviving Workbench owner; document switching leaves drafts persisted before the new workspace is displayed.
  - The Workbench contains no more than one `[data-axis="active"]`; the Matrix has a visible legend/title or equivalent localized state explanation, and its accessible labels follow the active locale.
- failure_signals:
  - Any type error, focused test failure, stale selector/assertion for removed controls, unreported test-count mismatch, or console error in the exercised Workbench path.
  - A Matrix click on a filtered/search result targets the wrong ordinal, a dot with unknown members is rendered as a definitive state, or a virtual-window seek lands on the first/nearest row rather than the requested row.
  - Wheel over Matrix does not move the grid, bracket dragging is impossible, arrow-key Matrix navigation is absent, or the hidden grid cannot still be scrolled by keyboard/programmatic APIs.
  - Closing the command palette leaves focus on `body`, a removed masthead control, or an unfocusable node; document switching shows the new document before the save-before-navigation path finishes or loses a draft.
  - Any overlap/clipping/page overflow at the required widths, more than one active axis, or a Matrix whose state colors cannot be understood in the current locale.
- suggested_commands:
  - `pnpm --filter @translunar/desktop typecheck`
  - `pnpm --filter @translunar/desktop test`
  - `pnpm --filter @translunar/desktop exec vitest run src/renderer/components/workbench`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/workbench.spec.ts --grep "global search|virtual|overflow|toolbar|scroll|visual"`
  - Use the existing desktop/Electron harness or an equivalent targeted Playwright run to inspect the three required viewport sizes, DOM focus after overlay close, Matrix/grid scroll positions, and draft persistence.
- scope: `apps/desktop/src/renderer/{App.tsx,Workbench.tsx,components/workbench/**,styles/30-surfaces/workbench.css,i18n/messages.ts}`, focused renderer tests, and the selective Workbench E2E cases needed for Matrix, shortcuts, focus, document switching, overflow, and scrollbar behavior.
- avoid: Full Rust/Engine or monorepo test runs; changes to product code, contracts, generated files, preload/main boundaries, or unrelated E2E suites. Do not treat a build-only exit code as proof of interaction behavior.
- related_issues: F1, F2, F3, F4, F5, F7

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:402-422`, `apps/desktop/src/renderer/Workbench.tsx:1357-1395`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:138-169`
- problem: The Matrix projection is not document-order when a filter or search is active, and its virtual-window coordinates are treated as if they were document ordinals. `editorTotal` is the current query's result count and `editorOffset` is that query's offset; `slot = editorOffset + index` therefore places the first matching segment at Matrix position 0 even when its document ordinal is later. `navigateMatrix` sends that same filtered index back through `segment.editor.list`, so a Matrix seek can resolve a different document segment than the dot represents. In addition, a cell containing both known and null virtual-window positions is reduced to the known dominant state, so unknown positions can receive a definitive color instead of remaining neutral. This violates the PRD/design requirement for document-order state projection and truthful unknown/unloaded representation.
- minimal_fix: Keep Matrix coordinates in authoritative document ordinal space (or explicitly clear/resolve incompatible filter/search projections before seeking), using each loaded segment's ordinal rather than query position. Preserve full-document slots when the Matrix is meant to answer document position. During aggregation, retain an unknown/neutral aggregate whenever a bucket includes unresolved positions unless the API explicitly represents a known aggregate; add integration coverage for off-window, filtered, searched, and mixed-null cells.
- status: open

### F2
- severity: major
- files: `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:98-127`, `apps/desktop/src/renderer/styles/10-components/matrix.css:65-76`, `apps/desktop/src/renderer/Workbench.tsx:1029-1045`
- problem: Hiding the native `.segment-grid` scrollbar is shipped, but the replacement Matrix only has clickable buttons. The viewport bracket is `aria-hidden` and has `pointer-events: none`; there are no wheel forwarding handlers, pointer drag handlers, or Matrix keyboard/roving-navigation handlers. Consequently, wheel-over-Matrix does not scroll the grid and the documented bracket-seeking/drag and arrow-key paths are absent. The actual grid remains scrollable only when the user happens to interact with the grid itself, so the Phase 2 “scroll takeover” is incomplete and the visual replacement removes a primary affordance without providing its promised equivalent.
- minimal_fix: Give Matrix an explicit bridge to the existing grid scroll owner: forward Matrix wheel deltas, implement bracket pointer capture/seek, and provide a single keyboard entry with arrow navigation/Enter/Escape semantics. Keep all actions as intent against the real grid (no second scroll state), retain native wheel/keyboard/programmatic/accessibility scrolling on `.segment-grid`, and add runtime tests that verify scroll position and active-textarea focus.
- status: open

### F3
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:1300-1305`, `apps/desktop/src/renderer/Workbench.tsx:2913-2941`
- problem: Global search has a new stable focus return, but the command palette does not. The overlay click, close button, Escape/command paths, and `runEditorCommand` all call `setCommandPaletteOpen(false)` directly with no focus restoration. After `Ctrl+K`, keyboard users can be left on a removed/hidden trigger or `body`, contrary to the acceptance criterion that closing either overlay returns focus to a remaining stable Workbench owner and to the shell navigation focus contract.
- minimal_fix: Centralize command-palette close behavior in a helper that closes the overlay and restores focus (preferably to the recorded invocation owner, with `editorRegionRef` as the stable fallback) on the next animation frame. Use it for Escape, outside click, close button, disabled-command paths, and successful command dispatch; preserve IME guards.
- status: open

### F4
- severity: minor
- files: `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:98-117`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.tsx:172-185`, `docs/design-ii/03-signatures.md:200-208`
- problem: The mounted Live Matrix has no visible title or legend, even though the design signature makes a legend/title mandatory for every Live Matrix. Its only explanation is a hardcoded Chinese `aria-label`/tooltip vocabulary (`文档段落矩阵`, `段`, `未翻译`, `草稿`, `已确认`, `有问题`, `…`), so the English catalog presents Chinese state names to screen readers and tooltips. Users cannot reliably interpret the state colors, and the two supported locales are inconsistent.
- minimal_fix: Add a localized Matrix title/legend for the four state encodings (including neutral/loading), pass localized labels through the existing locale catalog, and keep the accessible label/tooltip range text truthful for both `en-US` and `zh-CN`.
- status: open

### F5
- severity: minor
- files: `apps/desktop/src/renderer/Workbench.tsx:2260-2302`, `apps/desktop/src/renderer/styles/30-surfaces/workbench.css:10-30`
- problem: The documented `.wb` grid skeleton is not mounted. The Workbench root is still `workbench-app` with the legacy `workbench-layout`/`editor-column` hierarchy, while the new Masthead/FilterRail only happen to use some `.wb` stylesheet selectors. Therefore the declared `grid-template-areas`, `data-stack` overlay/collapsed behavior, and explicit Matrix/grid/dock/Stack grid columns are dead CSS rather than the implemented skeleton. This leaves the Phase 2 layout/responsive contract dependent on the legacy flex layout and makes the implementation record's “Workbench skeleton” claim incomplete.
- minimal_fix: Either mount the Workbench surface under `.wb` and provide the stack state attributes/area ownership, or explicitly remove the dead `.wb` claim and document the legacy layout as the intentional bounded implementation. In either case, prove the three required widths and the narrow/stack behavior in the focused visual pass.
- status: needs_evidence

### F6
- severity: minor
- files: `.opencode/package.json:3`, `AGENTS.md:61`
- problem: The Phase 2 worktree contains unrelated changes: an `@opencode-ai/plugin` dependency upgrade and an instruction-file newline/placeholder edit. Neither contributes to the Workbench presentation task, and the dependency change can alter tooling resolution outside the requested renderer scope.
- minimal_fix: Revert both unrelated files before handoff; keep the task diff limited to the renderer, its focused tests/styles/i18n, the App wiring, and the scoped implementation record/task artifacts.
- status: open

### F7
- severity: minor
- files: `apps/desktop/src/renderer/components/workbench/ActiveAxis.test.tsx:1-21`, `apps/desktop/src/renderer/components/workbench/DocumentMatrix.test.tsx:1-56`, `apps/desktop/src/renderer/components/workbench/FilterRail.test.tsx:1-109`, `apps/desktop/tests/e2e/workbench.spec.ts:5845-5988`, `apps/desktop/tests/e2e/workbench.spec.ts:6743-6791`
- problem: The new tests cover isolated component markup only; there is no Masthead test or Workbench integration test for the projection, navigation, focus, document-switch save path, singleton precedence, or supported-width layout. Meanwhile unchanged E2E assertions still require the removed `.global-search-command`/`.document-switcher`/overflow controls and a visible 10px native scrollbar. Thus a claimed green renderer/frontend validation either omits the E2E regression set or is not testing the Phase 2 contract, and the stale assertions will fail if that E2E suite is run.
- minimal_fix: Update the affected E2E expectations to the Phase 2 Masthead/FilterRail/hidden-scrollbar contract and add focused integration coverage for Matrix virtual navigation, overlay focus return, document-switch persistence, one-axis DOM count, and the three required viewport sizes. Record the actual command and count in the implementation note.
- status: needs_evidence

## assumptions
- No product Engine, Rust, contract/generated-contract, preload, or persistence files are changed in the current diff. The boundary check is clean for those protected layers; `App.tsx` only adds renderer wiring to the existing `openWorkspace` path.
- The deferred match selector is treated as an intentional Phase 2 residual: `All` is live and the other vocabulary is disabled/non-operative; no match score, bucket projection, or Engine/RPC field is introduced. The future bucket projection remains unimplemented and should not be “fixed” by fabricating data.
- Virtual-window null Matrix slots are treated as an explicit residual risk only where the implementation can demonstrate they remain neutral and ordinal-correct; the mixed-known/null aggregation and filtered-index behavior are currently open in F1.
- The `.wb` CSS grid is an incomplete/residual architecture boundary in this round, not evidence that contracts or Engine logic should be expanded.
- The implementation record is dated `2026-04` while the task is dated `2026-08-07`; this is documentation drift, but not a product behavior finding unless the Orchestrator wants the history corrected.

## summary_for_orchestrator
- The Phase 2 extraction is directionally present and stays within the renderer boundary, with Masthead, FilterRail, Matrix, ActiveAxis, i18n keys, and document wiring added. It is not ready for green review: three major behavior gaps remain (Matrix ordinal/unknown projection, incomplete scroll takeover, and command-palette focus restoration), while Matrix legend/localization, dead `.wb` layout CSS, unrelated worktree edits, and stale/missing integration coverage remain. A Verify mission is required to re-run the scoped typecheck/tests and exercise the integrated Workbench at all required widths and interaction paths; after fixes, resume review with the full verify report.
