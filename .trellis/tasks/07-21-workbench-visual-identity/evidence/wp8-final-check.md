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

## Local gates

```text
focused Prettier (11 changed source/test files)       pass
pnpm lint                                             pass
pnpm typecheck                                        pass
pnpm test                                             pass
desktop Vitest                                        24 files / 145 tests
pnpm build:desktop                                    pass
focused affected Workbench E2E                       5 passed
complete workbench.spec.ts                            18 passed / 5.9m
pnpm test:e2e:desktop                                 27 passed, 1 skipped / 6.4m
raw 3/5/7/9px radius audit                            0 matches
task-owned Workbench sub-11px audit                   0 matches
WOFF2 payload                                         7,963,684 bytes
```

The first full desktop run exposed a focus race in the Preview keyboard resize
test: after the End transition, Home could be sent without the separator still
owning focus. The test now focuses before each phase and asserts the semantic
120/200/320 `aria-valuenow` state before checking animated geometry. The rerun
passed all runnable tests.

Root `pnpm format:check` still reports 53 committed files outside this task's
change set, including generated `.devin` Trellis assets and unrelated renderer,
contract, plugin SDK, example, and script files. Every file changed by this task
passes focused Prettier. The repository-wide baseline is not represented as a
WP8 pass.

## Acceptance map

| AC | Local evidence | State |
| --- | --- | --- |
| AC1 | `wp1-fonts.md`, production build, 7,963,684-byte payload, Windows font assertions | Windows complete; native macOS package/font evidence open |
| AC2 | State unit tests and five empty-state screenshots; loading semantics and reduced-motion assertions | Runtime screenshots for all three loading states plus full dark/reduced-motion matrix open |
| AC3 | Global-search real-Engine E2E, save-failure retention, EN/ZH three-width screenshots | Complete on Windows |
| AC4 | Panel transition/focus E2E and WP4 screenshot matrix | Complete on Windows |
| AC5 | IME/commands at 125%, 10,000-row 60-second performance case, three-width screenshots | Complete on Windows |
| AC6 | Truthful non-PDF E2E/matrix and PDF loading/error code paths | Poppler/Tesseract PDF runtime and nine-image PDF matrix open |
| AC7 | WP7 audit and six light/dark screenshots | Complete for task-owned Workbench surfaces |
| AC8 | Axe, contrast, named controls, keyboard/focus, IME, dark/reduced-motion automation | Manual native keyboard/CJK/contrast review open |
| AC9 | lint/typecheck/test/build/full desktop E2E and focused formatting pass | Root format baseline and external PDF/macOS lanes open |

## External blockers

`pdftoppm` and `tesseract` are unavailable on this Windows PATH, so the
conditional PDF E2E remains the one skipped desktop test. This host cannot
produce native macOS package/font evidence. These gaps remain acceptance gates;
the task stays active and must not be archived until they are supplied or
explicitly reassigned to a fully planned release-qualification task without
dropping the original criteria.
