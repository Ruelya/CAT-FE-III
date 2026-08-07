# Verify report round 1

## mission_echo
- purpose: Re-evidence typecheck/tests and integrated Workbench Phase 2 behavior that isolated component tests do not cover (virtual-window Matrix indexing, hidden-scrollbar takeover, focus return, document switching, supported-width layout).
- questions_addressed:
  - Q1: **pass (unit/typecheck)** — Desktop typecheck is clean; full `@translunar/desktop` vitest run is **188/188** passed across **32** files. Focused workbench component suite is **13/13**. No unit-test assertion failures or stale unit selectors observed. E2E could not re-prove the integrated path (see environment).
  - Q2: **fail (layout contract) / inconclusive (live viewports)** — Mounted tree is legacy `workbench-app` + `workbench-layout` / `editor-column`, **not** `.wb`. Masthead, three FilterRail groups, and Matrix-adjacent-to-grid flex exist in source. Live overflow/clipping at 1250×744 / 1680×942 / 1920×1080 was **not** measured because Electron harness cannot open a window (missing engine binary).
  - Q3: **fail** — Matrix projection and seek operate in **filtered query index space** (`editorOffset + index` over `editorTotal` from `segment.editor.list`), not authoritative document ordinals. Mixed known+null cells aggregate to the known dominant state (unknown positions can inherit a definitive color). Confirms F1.
  - Q4: **fail** — Native `.segment-grid` scrollbar is hidden, but Matrix only supports **click-to-navigate**. Viewport bracket is `aria-hidden` + `pointer-events: none`; no wheel forwarding, bracket drag, or Matrix keyboard/roving handlers. Grid remains scrollable via its own wheel/keyboard/programmatic path when the pointer is over the grid. Confirms F2. `navigateMatrix` intentionally does not focus the translation textarea.
  - Q5: **partial** — `Ctrl+Shift+K` opens GlobalSearch and `closeGlobalSearch` restores focus to `editorRegionRef`. Command palette (`Ctrl+K` / `editor.palette`) closes via direct `setCommandPaletteOpen(false)` with **no** focus restoration (overlay click, close button, disabled/success command paths). Document switcher calls `await persistAllSegments()` before `onOpenDocument` (code-path correct; not runtime-proven). Confirms F3 for palette focus.
  - Q6: **partial** — ActiveAxis residence is mutually exclusive (`row` | `chip` | `hidden`) so at most one `[data-axis="active"]` is intended; isolated tests assert singleton per render, not full Workbench DOM. Masthead identity plate is the sole bevel surface. Live Matrix has **no** title/legend and hardcodes Chinese `aria-label`/tooltips (`文档段落矩阵`, state vocabulary), so en-US a11y is wrong. Confirms F4.

## environment
- cwd: `D:\Workbench\CAT-design-ii`
- branch: `implement/ortho-frontend`
- head_sha: `949989631ce2eec356b1bfda35f62e78a488b7fe` (matches findings-1 meta)
- OS: Windows; shell bash
- package: `@translunar/desktop` (apps/desktop)
- toolchain: vitest 4.1.10; Playwright electron project present; `dist/electron` and `dist/renderer` artifacts exist
- **Electron/Playwright:** could **not** run integrated Workbench. Harness launches Electron then dies before `firstWindow`:
  - Root cause: `target/debug/translunar-engine.exe` (and non-Windows engine) **missing**
  - Symptom: `electronApplication.firstWindow: Target page, context or browser has been closed`
- deviations from suggested commands:
  - Ran full `pnpm --filter @translunar/desktop test` (not only workbench path) to record real suite count.
  - Attempted selective Playwright `workbench.spec.ts --grep "opens app-bar global search"` — harness launch failed (infra), so Q2–Q6 interaction answers rely on code-path tracing + unit tests.
  - Did **not** run full monorepo / Rust / Engine tests (honored avoid).

## actions

### A1
- command: `pnpm --filter @translunar/desktop typecheck`
- exit_code: 0
- duration_note: contracts prebuild + tsc electron/renderer/e2e
- log_excerpt: |
    > @translunar/desktop@0.1.0 typecheck
    > tsc -p tsconfig.electron.json --noEmit && tsc -p tsconfig.renderer.json && tsc -p tsconfig.e2e.json
    (no TypeScript errors)
- interpretation: Typecheck success criterion met. No type errors in renderer/electron/e2e projects.

### A2
- command: `pnpm --filter @translunar/desktop test`
- exit_code: 0
- duration_note: ~14s
- log_excerpt: |
    Test Files  32 passed (32)
         Tests  188 passed (188)
    Notable Phase 2 files:
      ✓ DocumentMatrix.test.tsx (3)
      ✓ FilterRail.test.tsx (8)
      ✓ ActiveAxis.test.tsx (2)
      ✓ WorkbenchVisualState.test.tsx (2)
      ✓ editor-commands.test.ts (4)  # includes Ctrl+Shift+K reserved
- interpretation: Full desktop vitest green at **188** tests. Phase 2 adds isolated component coverage only; no Workbench integration / Masthead / Matrix virtual-window / overlay-focus / viewport tests in unit suite.

### A3
- command: `pnpm --filter @translunar/desktop exec vitest run src/renderer/components/workbench`
- exit_code: 0
- duration_note: ~2.4s
- log_excerpt: |
    Test Files  3 passed (3)
         Tests  13 passed (13)
- interpretation: Focused Phase 2 component suite is green. Coverage is markup/props only (three FilterRail groups, ActiveAxis variants, neutral Matrix null dots, Chinese landmark name).

### A4
- command: `pnpm exec playwright test tests/e2e/workbench.spec.ts --grep "opens app-bar global search" --reporter=line` (cwd apps/desktop)
- exit_code: non-zero (test failed; shell pipeline may mask status)
- duration_note: failed at harness launch
- log_excerpt: |
    Error: electronApplication.firstWindow: Target page, context or browser has been closed
      at launchHarness (tests/e2e/workbench.spec.ts:165)
- interpretation: Selective E2E not usable for acceptance evidence on this machine without building/providing `translunar-engine`.

### A5
- command: node Playwright `_electron.launch` probe + `ls target/debug/translunar-engine*`
- exit_code: launch fail (2)
- log_excerpt: |
    engine exists false D:\Workbench\CAT-design-ii\target\debug\translunar-engine.exe
    app closed event
    LAUNCH_FAIL electronApplication.firstWindow: Target page, context or browser has been closed
- interpretation: Confirms infra root cause is missing Engine binary, not merely a flaky test selector. Live viewport/Matrix/focus/document-switch interaction remains unmeasured.

### A6 — static path tracing (scope files)

#### Matrix projection & seek (Q3 / F1)
- `Workbench.tsx` `matrixSegmentStates` (~402–422): array length = `editorTotal`; loaded rows placed at `slot = editorOffset + index`.
- `loadEditorWindow` (~953–974): `segment.editor.list` with `filter` + `query: search`; `setEditorTotal(result.total)` is **query total**, not full-document count when filtered.
- `navigateMatrix` (~1357–1395): treats `index` as offset into that same list space (`index - editorOffset`, then load window around index). When out of window, clamps to loaded window relative index — can land on nearest loaded row rather than a true document ordinal when filter/search remaps indices.
- `DocumentMatrix.dominantState` (~159–169): filters out nulls, then picks error > untranslated > draft > confirmed among **known only** → mixed known+unknown buckets paint as known.

#### Scroll takeover (Q4 / F2)
- `DocumentMatrix.tsx` render (~98–128): only `onClick` on dots; no `onWheel`, pointer drag, or keyboard handlers.
- `matrix.css` `.doc-matrix__viewport` (~67–74): `pointer-events: none`.
- `workbench.css` (~397–407): `.workbench-app .segment-grid` hides scrollbar (`scrollbar-width: none`, webkit display none / width 0).
- Grid still has `overflow: auto` + `onScroll={onEditorScroll}` — native scroll owner remains `.segment-grid` when interacted with directly.
- `navigateMatrix` comment explicitly avoids focusing translation textarea (seek does not steal IME focus).

#### Shortcuts / focus / document switch (Q5 / F3)
- `GLOBAL_SEARCH_SHORTCUT = "Ctrl+Shift+K"`; `onWorkbenchKeyDown` opens global search.
- `closeGlobalSearch` (~1302–1306): closes + `editorRegionRef.current?.focus()` next frame.
- Command palette UI (~2913–2941): `onMouseDown` / close button / `runEditorCommand` all `setCommandPaletteOpen(false)` with **no** focus restore helper.
- `editor.palette` shortcut is `Ctrl+K` (`editor-commands.ts`).
- Masthead document select → `selectDocument` (~1323–1335): `await persistAllSegments()` then `onOpenDocument(documentId)`.

#### Layout skeleton (Q2 / F5)
- Root render (~2259–2301): `className` includes `workbench-app`; body uses `main.workbench-layout` / `editor-column` / `editor-main-row` / `editor-grid-row` + optional Matrix.
- Grep for mounted `className` containing `wb` as surface root: **no matches** in renderer TSX.
- `workbench.css` `.wb { display:grid; grid-template-areas: ... }` (~10–31) is therefore **dead CSS** for the mounted tree; Phase 2 adjacency uses flex `.editor-grid-row` instead (~376–395).
- FilterRail documents three groups (status / match / issues) and unit test asserts them.
- Masthead: `header.masthead` with `.identity` / `.docswitch` / Run QA / Export — not legacy `.document-switcher` / `.global-search-command` buttons.

#### ActiveAxis / Matrix legend-i18n (Q6 / F4)
- `axisResidence` (~430–436): `row` if `activeId`, else `chip` if filter, else `hidden` — mutually exclusive mounts at `ActiveAxis variant="row"` (segment cell) vs chip under FilterRail.
- Matrix `aria-label="文档段落矩阵"` and `formatTooltip` Chinese state labels hardcoded (~103, 172–185); no legend/title UI.
- No `Masthead.test.tsx`.

#### Stale E2E (F7)
- `workbench.spec.ts` still expects:
  - `.document-switcher`, `.global-search-command`, banner “Global search” button, “More actions”
  - three viewports asserting those legacy app-bar boxes
  - visual polish: `.document-switcher span` + **scrollbarWidth === "10px"** on `.segment-grid` (contradicts Phase 2 hidden scrollbar)
- ~14 matching stale selector lines in that file for the Phase 2 contract break.

## findings_for_reviewer

### V1
- severity: major
- related_review_ids: F1
- title: Matrix uses filtered list indices; mixed null cells paint as known
- evidence: `Workbench.tsx:402-422`, `Workbench.tsx:953-974`, `Workbench.tsx:1357-1395`, `DocumentMatrix.tsx:159-169`
- detail: With filter/search active, Matrix length/slots follow `segment.editor.list` total/offset, so dots are not document-ordinal positions. Aggregation ignores nulls when any known state exists, so unloaded members of a bucket inherit a definitive color. Unit tests only cover isolated null vs known dots, not filtered/virtual-window seek correctness.
- suggested_next: fix_recipe_hint — project Matrix in document ordinal space (or clear incompatible filters before Matrix); keep unknown aggregate when any null in bucket; add integration tests for filtered/search/off-window seek.

### V2
- severity: major
- related_review_ids: F2
- title: Scrollbar hidden without Matrix wheel/drag/keyboard takeover
- evidence: `workbench.css:397-407`, `DocumentMatrix.tsx:98-127`, `matrix.css:67-74`, no wheel/key handlers in DocumentMatrix
- detail: Phase 2 hides the grid scrollbar and presents Matrix as the visual affordance, but Matrix only has clickable dots. Viewport bracket cannot receive pointer events. Wheel-over-Matrix and arrow-key Matrix navigation are absent. Grid scroll still works only when the user interacts with the grid itself.
- suggested_next: fix_recipe_hint — forward wheel to grid scroll owner; bracket pointer capture/seek; keyboard entry with arrows/Enter/Escape; retain native grid a11y scroll; add tests for scrollTop + textarea focus stability.

### V3
- severity: major
- related_review_ids: F3
- title: Command palette close paths do not restore Workbench focus
- evidence: `Workbench.tsx:2913-2941`, `Workbench.tsx:2183-2198` vs `closeGlobalSearch` at `1302-1306`
- detail: Global search has an explicit focus-return helper. Command palette overlay dismiss, close button, and command dispatch only flip state. Keyboard users can be left on `body` or a detached node after `Ctrl+K`.
- suggested_next: fix_recipe_hint — centralize close + rAF focus restore (invocation owner or `editorRegionRef`); wire Escape/outside/close/disabled/success paths.

### V4
- severity: minor
- related_review_ids: F4
- title: Matrix lacks legend/title and hardcodes Chinese a11y copy
- evidence: `DocumentMatrix.tsx:103`, `DocumentMatrix.tsx:172-185`; `DocumentMatrix.test.tsx` asserts Chinese landmark name
- detail: No visible title/legend for state encoding. Tooltips and `aria-label` use fixed Chinese vocabulary, so en-US locale presents Chinese Matrix labels. Unit tests encode the Chinese string as expected, locking the bug in.
- suggested_next: fix_recipe_hint — localized title/legend + i18n keys for states/range; update tests for both locales.

### V5
- severity: minor
- related_review_ids: F5
- title: `.wb` grid skeleton is not mounted; legacy layout is the live skeleton
- evidence: `Workbench.tsx:2259-2302`, `Workbench.tsx:2355-2372`; grep no TSX `className` root `wb`; dead CSS `workbench.css:10-31`
- detail: Implementation record “Workbench skeleton” via `.wb` areas is not live. Masthead/FilterRail/Matrix reuse some class names under legacy flex hierarchy. Responsive `data-stack` overlay/collapsed columns do not apply to the mounted root.
- suggested_next: fix_recipe_hint — either mount `.wb` with area ownership or document legacy layout as intentional Phase 2 bound and prove three widths against that contract.

### V6
- severity: minor
- related_review_ids: F7
- title: E2E suite still asserts removed app-bar controls and 10px grid scrollbar
- evidence: `tests/e2e/workbench.spec.ts:5845-5988`, `:6743-6791`; product Masthead uses `.docswitch` / no `.global-search-command`
- detail: Even after Engine is available, these cases will fail against Phase 2 DOM (no `.document-switcher`, no app-bar Global search button, scrollbar width 0/hidden). Unit suite does not catch this. No Masthead or Workbench integration tests exist.
- suggested_next: fix_recipe_hint — retarget E2E to Masthead/FilterRail/Matrix/hidden-scrollbar; add focused integration coverage; re-run after Engine binary present.

### V7
- severity: info
- related_review_ids: new
- title: Electron harness blocked — Engine binary missing
- evidence: `target/debug/translunar-engine.exe` absent; A4/A5 launch failures
- detail: Prevents runtime answers for Q2 viewports, Q3 seek behavior, Q4 scroll takeover, Q5 focus/document-switch timing, Q6 live DOM counts. Not a product code regression by itself, but blocks acceptance evidence.
- suggested_next: re-run_with — build or point `TRANSLUNAR_ENGINE_PATH` at a valid engine, then selective Playwright workbench greps for overflow/toolbar/scroll/global search/visual.

### V8
- severity: info
- related_review_ids: new
- title: Typecheck + unit suite green (actual count recorded)
- evidence: A1 exit 0; A2 **188** tests / **32** files; A3 **13** workbench component tests
- detail: Implementation claim of clean typecheck/tests is true for the vitest desktop package. It does **not** include E2E and does not exercise integrated Matrix/virtual-window/focus/layout contracts.
- suggested_next: out_of_scope for product fix; reviewer should not treat 188 green as Phase 2 acceptance.

### V9
- severity: info
- related_review_ids: F6
- title: Unrelated worktree edits not re-verified in this mission
- evidence: findings-1 F6 (`.opencode/package.json`, `AGENTS.md`); mission scope excluded product-unrelated cleanup
- detail: Verify mission did not git-diff scope hygiene; still open for orchestrator/closeout if branch still dirty.
- suggested_next: out_of_scope for verify runtime; orchestrator/fix should revert if still present.

## unanswered
- Live geometric layout at 1250×744, 1680×942, 1920×1080 (overflow, clipping, control reachability, Matrix adjacency pixels) — blocked_infra (no Engine / Electron window).
- Runtime Matrix seek landing exact segment after multi-window + filter/search + QA refresh — static fail signals strong; not runtime-confirmed.
- Runtime wheel-over-Matrix / bracket drag / Matrix keyboard navigation and post-seek textarea focus — static fail for takeover; grid-native scroll not exercised in harness.
- Runtime command-palette focus after Escape/outside/close; GlobalSearch Escape vs overlay paths under real focus graph.
- Runtime document-switch draft persistence race (persist completes before new workspace paint) — code path awaits persist; not instrumented.
- Live DOM count of `[data-axis="active"]` and masthead bevel uniqueness under real multi-row render.
- Whether a full `pnpm build` + Engine build would clear A4 without further Electron packaging issues.

## overall
- mission_status: **partial**
- summary_for_reviewer: |
    Scoped typecheck and the full desktop vitest suite are clean (**188** tests; **13** Phase 2 component tests). That re-evidence supports the implementation’s unit/type claims only. Integrated Phase 2 acceptance is **not** met on code inspection: Matrix is not document-ordinal under filter/search and mis-paints mixed unknown cells (F1/V1); scrollbar is hidden without Matrix scroll takeover (F2/V2); command palette lacks focus restore (F3/V3); Matrix legend/i18n and dead `.wb` skeleton remain (F4/V4, F5/V5); E2E still encodes pre–Phase 2 selectors and a 10px scrollbar (F7/V6). Electron/Playwright could not launch because `translunar-engine` is missing (V7), so the three required viewports and interactive Matrix/focus/document-switch paths were not observed live. ActiveAxis singleton and document-switch `persistAllSegments` paths look correct by construction but lack integration proof. Review should keep F1–F3 open as majors, treat F5/F7 as confirmed needs_evidence→open, and not green the task on unit exit codes alone.
- recommended_review_focus: |
    1. Keep F1–F3 as blocking majors; V1–V3 are confirmatory static evidence.
    2. Require fix + integration tests for Matrix ordinal/unknown, Matrix scroll bridge, palette focus restore before another verify round.
    3. On next verify: provide Engine binary and re-run selective Playwright (viewports, Matrix, shortcuts, scrollbar) plus any new integration unit tests.
    4. Decide F5 product choice (mount `.wb` vs document legacy) and update F7 E2E in the same fix wave.
    5. F6 unrelated diff hygiene is outside this report’s runtime scope.
