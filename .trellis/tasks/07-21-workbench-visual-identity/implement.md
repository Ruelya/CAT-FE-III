# Implement - Workbench visual identity completion

Keep these work packages in this one task. They are sequential because several
packages touch the same renderer files; independent research/check agents may run
in parallel only when they do not edit those files. After every package, update
this checklist with commands, screenshots, and any measured values.

## Start gate

- [ ] Main session links this task to recommended parent
      `07-19-platform-packaging-product-shell` after checking task-metadata
      ownership; do not edit visual-polish or parent metadata from this worker.
- [ ] `07-21-workbench-visual-polish` is checked, committed, and archived.
- [ ] Main session confirms no concurrent worker owns the planned renderer files.
- [ ] Main session presents this final plan and receives fresh implementation
      approval before `task.py start`.
- [ ] Record a clean baseline at 1250x744, 1680x942, and 1920x1080 in light/dark,
      plus current `rg` counts for raw radii and sub-11px Workbench metadata.
- [ ] Run the pre-change focused suite and record existing environment failures;
      do not attribute a pre-existing failure to this task.

## WP1 - Local font assets and typography roles

Ownership: font/license assets, font manifest, `@font-face` declarations, base font
tokens, and focused font-loading evidence. Do not change structural layout in this
package.

- [x] Obtain pinned upstream Space Grotesk, Chivo, Space Mono, and Noto Sans SC
      WOFF2 assets; verify licenses and SHA-256 before adding them.
- [x] Vendor license/provenance and record weights, unicode coverage, individual
      size, total WOFF2 size, and packaged-app delta.
- [x] Add relative local `@font-face` sources and primary family tokens. Remove
      Bahnschrift/Segoe/YaHei from primary intended roles; retain generic/system
      fallback only after bundled families.
- [x] Apply display/body/mono/CJK roles without changing layout dimensions yet.
- [x] Add/update E2E rendering evidence to await `document.fonts.ready`, check all
      four branded families, representative SC glyphs, and no remote font request.
- [x] Gate: total WOFF2 <= 20 MiB; production renderer assets resolve under
      Electron `loadFile()`; focused typecheck/build/E2E font evidence passes.

  Evidence: `evidence/wp1-fonts.md` and
  `apps/desktop/src/renderer/assets/fonts/manifest.json`.

Rollback point: remove the asset/font commit only; no behavior or token migration
depends on it yet.

## WP2 - Eight-state visual system

Ownership: one small Workbench visual-state component/style, request-state wiring,
i18n, focused unit tests, and the exact 3 loading + 5 empty cases.

- [x] Add a presentational loading/empty primitive with variants for match card,
      Assistant response, Preview page, term/QA result, and grid.
- [x] Add generation-safe TM loading state so an unresolved lookup never flashes
      `No TM match` and a stale request cannot update the next active segment.
- [x] Show Assistant first-token skeleton only from accepted request to first
      readable chunk/terminal error; keep Stop/recovery controls available.
- [x] Replace PDF `Rendering page...` with the page/block skeleton; keep PDF error
      and no-page/no-block states distinct.
- [x] Implement the five named empty states and a real `Clear filters` action for
      empty grid. Do not add inert actions to terminal positive states.
- [x] Add English/Chinese copy, bounded live-region behavior, dark parity, and a
      static reduced-motion variant.
- [x] Unit gate: render each of 8 states, assert its name/role/action contract, and
      assert loading/error/empty are mutually exclusive.
- [x] E2E empty-state gate: capture the five named empty-state screenshots at
      representative light view, verify the named roles, console cleanliness,
      and functional `Clear filters` recovery.
- [ ] E2E loading/theme gate: capture the three loading screenshots plus the
      remaining theme/reduced-motion/manual checks; the current fixture resolves
      loading requests too quickly for stable runtime captures.

Rollback point: the shared state component and state wiring form one package; all
previous request behavior remains intact when reverted.

## WP3 - App-bar identity and global search access

Ownership: app-bar composition, reuse/extraction of existing global search,
save-before-result navigation, i18n, and focused search tests.

- [x] Re-search Project Home global search and extract only the controller/result
      behavior needed by two consumers; keep params, safe snippet parsing, paging,
      and labels in one implementation.
- [x] Replace the app-bar's misleading in-document slot with a prominent real
      global-search command/surface; retain in-file search in the editor toolbar.
- [x] Pass an explicit awaited open-result callback through App/Workbench. Flush
      pending edits before opening project/document/segment; keep current state and
      show typed error on failure.
- [x] Strengthen the 280-360px identity block using existing BrandMark/project copy
      and one restrained geometry field; keep one complete Translunar Band.
- [x] Test keyboard open/search/result selection/Escape/focus return, safe snippets,
      cross-document navigation, and failed-save retention with real Engine search.
- [x] Screenshot gate: app bar at all three widths in English/Chinese; identity,
      document, search, Run QA, Export, and overflow do not overlap.

Rollback point: app-bar/search commit reverts to the current in-document field and
Project Home search without affecting fonts or working states.

## WP4 - Suggestions header and result hierarchy

Ownership: Suggestions DOM/CSS only plus its focused panel-mode tests.

- [x] Implement the single warm-ink cut terminal, aligned dot field, and stable
      collapse/maximize controls; keep tabs on the next row.
- [x] Tune Matches/Terms/QA/AI hierarchy so content/provenance/action order is
      scannable and Assistant configuration does not dominate other resource tabs.
- [x] Preserve mounted/inert transitions, one-button collapsed rail, accessible
      names, focus handoff, and intermediate-width animation evidence.
- [x] Replace the obsolete E2E `::after content === none` assertion with semantic
      cut geometry and non-overlap checks.
- [x] Screenshot gate: all four tabs plus docked/collapsed/maximized at all three
      widths; no clipped title, dots behind content, or floating double-chevron.

  Evidence: `evidence/wp4-suggestions.md` and the `wp4-*` screenshots under
  `evidence/screenshots/`.

Rollback point: Suggestions package is independent of segment/Preview structure.

## WP5 - Segment density and virtualization

Ownership: segment table/toolbar presentation, any single overflow menu, row
geometry constant, and 10,000-row/IME/accessibility tests.

- [x] Inventory command frequency/shortcut access before moving controls. Keep
      frequent commands direct; group only verified lower-frequency commands.
- [x] Use stable 32px icon controls with Lucide, names, and tooltips. Protected
      tags and issue evidence stay visible and domain-accurate.
- [x] Raise row/status/tool metadata to the type floor and rebalance padding so
      source/target text remains the strongest element.
- [x] If measured row height changes, update the one virtualization constant and
      validate spacer math, filter/search, scroll targeting, confirm-and-advance,
      and focus restore with 10,000 rows.
- [x] Run real CJK IME composition, save, confirm, tag, issue, and keyboard menu
      tests. No command may fire or focus move during composition.
- [x] Screenshot gate: normal/active/issue/tagged rows at all three widths and 125%
      scaling; no clipping, cards, ornamental cell graphics, or control collision.

  Evidence: `evidence/wp5-segment-density.md` and the `wp5-segment-density-*`
  screenshots under `evidence/screenshots/`.

Rollback point: segment-density commit restores prior row geometry without
changing Suggestions or Preview.

## WP6 - Truthful Preview hierarchy

Ownership: DocumentPreview structure/style/navigation and its focused tests. No new
Engine preview contract in this package.

- [ ] Rebuild handle/body hierarchy with document identity, truthful position,
      grouped controls, structure/thumb rail, and paper/document canvas.
- [ ] Keep actual PDF image/page count/blocks/OCR correction and the WP2 render
      skeleton/error paths.
- [ ] Render DOCX/HTML/Markdown/TXT from ordered segments/structural paths without
      fake pages/headings/tables. Show a bounded degraded-structure explanation
      where needed.
- [ ] Make represented segments navigable through Workbench's active-row path;
      preserve target focus, pending drafts, follow-active, resize, and all three
      panel modes.
- [ ] Test pointer/keyboard resize boundaries, click navigation, focus preservation,
      active-location visibility, PDF/non-PDF truthfulness, and unsupported states.
- [ ] Screenshot gate: PDF plus one DOCX/HTML/Markdown fixture, default/collapsed/
      maximized at all three widths. The result must read as a document, not a flat
      text list, without claiming unavailable layout facts.

Rollback point: Preview package reverts independently and leaves PDF data behavior
unchanged.

## WP7 - Radius, spacing, and type-token migration

Ownership: mechanical token definitions/migration and documented exceptions. Do
not combine new structural markup with this package.

- [ ] Add 4/6/8 semantic radius tokens and 4/8/12/16/24/32 spacing tokens.
- [ ] Migrate renderer rectangular radii. Keep only reviewed `50%` true circles
      and 0/1px square indicator/registration exceptions; remove raw 3/5/7/9px
      drift and update segmented-corner syntax to use tokens.
- [ ] Migrate spacing in app bar, toolbar, segment rows, Suggestions, Preview,
      states, and Workbench dialogs; list intentional non-spacing geometry.
- [ ] Remove sub-11px metadata from task-owned Workbench surfaces without reducing
      type to fix overflow.
- [ ] Check light/dark contrast and 125% scaling after each component group.
- [ ] Gate each mechanical group with `rg` audit, focused E2E, and three-width
      screenshots before proceeding to the next group.

Rollback point: one mechanical component-group commit at a time; never revert all
concurrent renderer changes.

## WP8 - Final independent check and evidence

- [ ] Run formatting and static checks:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build:desktop
```

- [ ] Run focused desktop checks first, then the full suite:

```powershell
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop test:e2e -- tests/e2e/workbench.spec.ts
pnpm test:e2e:desktop
```

- [ ] Audit remaining token/type drift and font payload:

```powershell
rg -n "border-radius:\s*(3|5|7|9)px" apps/desktop/src/renderer/styles.css
rg -n "font-size:\s*(7|8|9|10)px" apps/desktop/src/renderer/styles.css
Get-ChildItem -Recurse -File apps/desktop/src/renderer -Include *.woff2 | Measure-Object Length -Sum
```

- [ ] Independent reviewer maps AC1-AC9 to implementation, tests, and named visual
      evidence; checks both themes, reduced motion, 125% scaling, keyboard/focus,
      CJK IME, console/page errors, and no horizontal overflow.
- [ ] Obtain native Windows and macOS font/package evidence. Windows-only
      screenshots are insufficient for AC1.
- [ ] Update stale task/spec evidence only when it records a verified executable
      contract; do not turn aspirational visual choices into coding specs.
- [ ] Commit this task separately, finish it, and archive it immediately after the
      quality gate. Do not leave a completed visual task in the active task list.

## Final handoff checklist

- [ ] Every acceptance criterion has a command, assertion, or named screenshot.
- [ ] The eight-state matrix is complete: 3 loading + 5 empty, no substitutions.
- [ ] App bar, Suggestions title, segment density, and Preview hierarchy are all
      implemented; none is deferred as optional polish.
- [ ] No unresolved question, unowned file, unrecorded platform gap, or shared-file
      conflict remains before archive.
