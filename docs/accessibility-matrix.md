# Accessibility acceptance matrix

> **Historical record (pre-greenfield).** This matrix measured the previous
> renderer, which was removed in the greenfield reset along with the test
> harnesses it cites (`ui:shots`, `ui:audit`, the old spec files). The current
> renderer has not been through this qualification; none of these results
> carry over.

Supported viewports: **1180×700** (the BrowserWindow minimum), **1250×744**,
**1680×942**, **1920×1080**. Both themes. 100 % and 125 % text scaling.

Last measured: 2026-08-12, Linux validation lane, against a real Rust Engine
build in Electron. Commands: `pnpm test:e2e:desktop`, `pnpm ui:shots:matrix`,
`pnpm ui:audit`.

## Automated coverage

| Area | Evidence in this repository | Result |
| --- | --- | --- |
| axe, every impact level | `a11y-keyboard.spec.ts` audits welcome, create-project, the invalid create-project form, import, workbench, the editor overflow menu while open, search, AI Control, Plugins, both Settings sections, and the command palette. `p0`, `p1`, `p2`, and `p4` specs additionally audit project home, QA, export, insights, assets, templates, recycle, and the P2 workbench. | zero violations at every impact level |
| axe in dark theme | `a11y-keyboard.spec.ts` audits welcome, workbench, and QA with the dark theme persisted and applied before load. | zero violations |
| Contrast | **Included**, not excluded. `color-contrast` runs as part of the axe audits above. Token-level contrast is additionally proven in `state/appearance.test.ts`: every text role clears 4.5:1 on all four surfaces in both themes, control boundaries clear 3:1, semantic colours clear 4.5:1 on canvas, surface, and their own soft backgrounds, and the accent derivation is verified for ten seeds including pure black and pure white. | pass |
| Keyboard-only operation | `a11y-keyboard.spec.ts` reaches the Workbench and drives it without the pointer: the command palette navigates to QA and back, the editor toolbar is a single tab stop with Arrow and Home moving inside it, the overflow menu takes focus and returns it on Escape, an editor panel returns focus to its opener on close, and Ctrl+Enter confirms a segment. | pass |
| Menu and toolbar patterns | `RowMenu.test.tsx` and `EditorCommandBar.test.tsx` assert the full APG menu-button model: open on ArrowDown, open onto the last item on ArrowUp, Arrow, Home, End, type-ahead, disabled items skipped, Escape closes and restores the trigger. | pass, 18 cases |
| Focus restoration and modal trapping | `ConfirmDialog.test.tsx`, `RecoveryDialog.test.tsx`, `use-destructive-confirm.test.tsx`, and `CommandPalette.test.tsx` cover initial focus on the safest action, Tab trapping, non-destructive Escape, and opener restoration. `a11y-keyboard.spec.ts` asserts a destructive confirmation shows a computed focus ring of at least 2px even when opened with the pointer. | pass |
| Surface transitions | `use-surface-announcement.test.tsx` asserts the new surface is announced through a permanently mounted polite live region, that stranded focus is rescued to the surface container, and that focus is **not** taken from a control the user already reached. | pass |
| Reduced motion | `a11y-keyboard.spec.ts` asserts computed transition duration collapses to zero under `prefers-reduced-motion`. `ui-shots --reduced-motion` re-checks the full route matrix. | pass |
| Icon-only controls | `pnpm ui:audit` rule R6 fails the build when an icon-only button lacks either `title` or `aria-label`, using a JSX scanner rather than a regex that a multi-line attribute can defeat. | pass, zero findings |
| Target size | `ui-shots` fails any state containing an interactive control under 32×32 CSS pixels, with one documented exception marked `data-hit-area="extended"` for the PDF overlay chip whose hit area is extended by a pseudo-element. | pass |
| Layout integrity | `ui-shots` fails on document-level horizontal overflow, a control clipped outside the viewport, an overlapping interactive pair, untitled truncation, and a control cut off by a clipping ancestor. | pass across 102 states in both themes at three viewports, plus 34 at 125 % scaling and 34 under reduced motion |
| Console cleanliness | Every E2E spec and every `ui-shots` run fails on a renderer console error or page error. | zero errors |

## Semantics corrected during this qualification

- Seven surfaces declared `role="tab"` with `aria-selected` while implementing
  none of the tab keyboard model. All seven now use one `SectionNav` primitive:
  a native `nav` with `aria-current`, which is the honest semantic for
  route-like section switching and is fully operable with Tab and Enter.
- The exact TM dock, the PDF dock, and the ten editor panels were `aside`
  elements nested inside `main`, a landmark-structure violation. They are named
  regions now.
- Eleven action columns rendered an empty `th`. axe's `empty-table-header`
  requires visible text, so a screen-reader-only label does not satisfy it; the
  columns carry a visible label.
- Twenty-seven sections rendered the bare strings `Loading` or `Empty`. Each is
  now a named empty state or a skeleton whose geometry matches the settled
  content.
- Five destructive commands ran on a single click with no confirmation. All now
  use a Cancel-first dialog that stays mounted through the async call.

## Known gap: visible labels on dense form controls

Twenty-six controls across the Asset Hub and P4 sections have a programmatic
name and pass axe, but no on-screen label: their only visual affordance is a
placeholder or their position in a row. That satisfies the accessibility
contract and violates the design language rule against a placeholder standing
in for a label.

Converting them would restructure six Asset Hub sections and two P4 sections,
so it is recorded as debt rather than rushed. Reproduce the list with a probe
that selects every visible `input`, `select`, and `textarea` with neither a
`label[for]` nor a wrapping `label`, walking each section of each surface.

Two controls in that set had no accessible name at all, the Plugins permissions
plugin select and the Collaboration member role select. Both are fixed, and the
section sweep described above exists so that class of defect cannot hide behind
a tab again.

## Manual and platform gates still required

These cannot be produced in this environment and are **not** claimed:

- **Native screen readers.** NVDA or JAWS on Windows, VoiceOver on macOS. axe is
  one signal and does not substitute for assistive-technology testing.
- **macOS.** VoiceOver, native focus ring, native traffic-light geometry, and
  reduced-motion behaviour on a macOS runner.
- **Windows high-DPI.** Fractional CSS pixel geometry at 125 % and 150 % Windows
  display scaling on real hardware.
- **Forced colors.** Windows high-contrast mode.

Three scripted walkthroughs of the built application were performed by driving
the GUI rather than the test harness. They found defects the automated checks
could not: a row overflow menu clipped by a container's `overflow: hidden`,
that menu then painted over by a later sibling because an entrance animation
left a stacking context, counts too small and too tightly spaced to read
reliably, and a modal focus ring suppressed by `:focus-visible` on a
pointer-opened dialog. All four were fixed and each has a regression test. A
walkthrough is not a substitute for a human study with real translators.

## Evidence boundary

A row marked pass above has a command that reproduces it. A gate listed as
manual is an acceptance task, not a completed claim; attach runner, commit,
viewport, and result before marking it passed.
