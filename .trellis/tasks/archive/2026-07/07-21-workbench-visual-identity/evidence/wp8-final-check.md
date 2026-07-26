# WP8 final local quality check

Measured 2026-07-26 on Windows 10.0.26220 with Node 24.17.0 and pnpm
10.18.3. This record separates completed implementation evidence from release
qualification that cannot be produced on this host.

## Final fixes

- Removed the fixed Settings FAB from Workbench and secondary workspace
  surfaces; Settings remains reachable from their application menus and from
  the Project Home affordance.
- Reserved `Ctrl+Shift+K` for Global search and prevented memoQ/custom shortcut
  collisions through a pure validation contract with unit coverage.
- Kept loading states as bounded live status regions and changed settled empty
  states to named, non-live regions.
- Prevented the PDF page-list success transition from flashing a false empty
  page while the requested page image is still loading.
- Scoped ambiguous E2E locators, added Workbench Axe checks, 60% editor-width
  evidence, explicit light/dark contrast checks, and deterministic separator
  focus plus `aria-valuenow` assertions.
- Raised empty-state label contrast, fixed the labeled TM match scope role, and
  widened the wide-screen Global search command so its label and shortcut do
  not truncate.
- Replaced the Assistant message card's fixed light background with the active
  raised-surface token, raised its online metadata to the 11px floor, and added
  real dark-loading contrast/font-size assertions.
- Gave the live Assistant fixed grounding, transcript, run-status, and composer
  grid slots so optional online surfaces cannot create implicit overlapping
  rows at the compact viewport.

## Local gates

```text
pnpm format:check                                    pass
pnpm lint                                             pass
pnpm typecheck                                        pass
pnpm test                                             pass
desktop Vitest                                        24 files / 145 tests
pnpm build:desktop                                    pass
PDF-enabled pnpm test:e2e:desktop                     28 passed, 0 skipped / 7.4m
post-review online Assistant E2E                     1 passed / 29s
raw 3/5/7/9px radius audit                            0 matches
task-owned Workbench sub-11px audit                   0 matches
WOFF2 payload                                         7,963,684 bytes
```

The first full desktop run exposed a focus race in the Preview keyboard resize
test: after the End transition, Home could be sent without the separator still
owning focus. The test now focuses before each phase and asserts the semantic
120/200/320 `aria-valuenow` state before checking animated geometry. The rerun
passed all runnable tests.

The repository formatting baseline was normalized separately in `77e5504`;
generated `.amp/` and `.devin/` platform assets are excluded from Prettier.
Root `pnpm format:check` now passes without weakening source coverage.

## Named before/after comparison

The committed pre-task baseline is the six-image light/dark, three-viewport
matrix under
`.trellis/tasks/archive/2026-07/07-21-workbench-visual-polish/evidence/screenshots/`
(`workbench-polish-{light,dark}-{1250x744,1680x942,1920x1080}.png`). It is the
named **before** reference for the default Workbench, Suggestions/Assistant,
and Preview surfaces. The eight branded working states and truthful Preview
mode compositions did not exist as equivalent historical states, so the
baseline documents their absence instead of fabricating a like-for-like image.

The named **after** evidence is:

- default Workbench: the six `wp7-tokens-{light,dark}-*.png` images;
- all eight working states: the 16 `wp2-{loading,empty}-*.png` images;
- Suggestions modes and compact Assistant: the `wp4-suggestions-*.png` matrix;
- PDF and non-PDF Preview modes: the 18 `wp6-preview-*.png` images.

The protected workspace-only Assistant reference is not part of this evidence
set and remains untracked.

## Acceptance map

| AC | Local evidence | State |
| --- | --- | --- |
| AC1 | `wp1-fonts.md`, production build, 7,963,684-byte payload, Windows font assertions | Windows complete; native macOS package/font evidence inherited by release qualification |
| AC2 | State unit tests plus 16-image runtime light/dark-reduced matrix | Complete on Windows |
| AC3 | Global-search real-Engine E2E, save-failure retention, EN/ZH three-width screenshots | Complete on Windows |
| AC4 | Panel transition/focus E2E and WP4 screenshot matrix | Complete on Windows |
| AC5 | IME/commands at 125%, 10,000-row 60-second performance case, three-width screenshots | Complete on Windows |
| AC6 | Truthful non-PDF and real Poppler/Tesseract PDF E2E; 18-image mode/viewport matrix | Complete on Windows |
| AC7 | WP7 audit and six light/dark screenshots | Complete for task-owned Workbench surfaces |
| AC8 | Axe, contrast, named controls, keyboard/focus, IME, dark/reduced-motion automation | Native Windows/macOS manual review inherited by release qualification |
| AC9 | Root formatting, lint/typecheck/test/build and PDF-enabled full desktop E2E | Local lane complete; immutable-candidate native lanes inherited by release qualification |

## External blockers

This host cannot produce native macOS package/font evidence or a complete
native assistive-technology matrix. Those criteria are not waived: they are
explicitly inherited by `.trellis/tasks/07-19-full-prd-release-qualification`,
whose PRD/design/implementation plan binds them to the same immutable release
candidate as the remaining native Windows/macOS package, keyboard, CJK IME,
screen-reader, contrast, focus-ring, and reduced-motion gates.
