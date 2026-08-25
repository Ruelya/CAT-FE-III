# Design language conformance

> **Historical record (pre-greenfield).** This conformance report measured the
> previous renderer, which was removed in the greenfield reset along with its
> evidence harnesses (`ui-audit`, `ui-shots`, `ui:perf`). The current renderer
> uses the INSTRUMENT token set in `packages/ui/src/tokens.css` and has not
> been through this qualification.

A per-item check of the renderer against
[`.trellis/spec/frontend/design-language.md`](../.trellis/spec/frontend/design-language.md).
Every row names the evidence, so a reviewer can reproduce the claim instead of
taking it on trust. Anything not realised is listed as such rather than quietly
omitted.

Last checked: 2026-08-12.

## The three dials

| Dial | Claimed | How it is realised | Evidence |
| --- | --- | --- | --- |
| Variance 6/10 | Deliberate hierarchy inside predictable desktop workflows; no marketing composition | Surfaces are width-constrained lists, tables, and forms. No hero, bento, marquee, or equal-weight feature cards exist in the renderer. | `grep -r "hero\|bento\|marquee" apps/desktop/src/renderer` returns nothing |
| Motion 5/10 | Broad coverage, small amplitude, always causal | Seven named classes, all `transform` or `opacity` only, all collapsing to zero under reduced motion | `styles/motion.css`; table below |
| Density 8/10 | Professional density with a 32 px interactive floor | `--control-h-sm` is the floor and `ui-shots` fails any state with a smaller interactive target | `scripts/ui-shots.mjs` MIN_TARGET; zero findings across 136 states |

## Colour

| Claim | Evidence |
| --- | --- |
| Four-step surface ladder, adjacent CIE L\* delta at least 2.5, both themes | `appearance.test.ts` "keeps at least 2.5 CIE L\* between adjacent surface steps"; measured deltas 4.25 / 3.49 / 3.39 light and 2.85 / 4.93 / 4.86 dark |
| Cool green-grey structural axis against warm paper | Light `--color-border` `#82857e`, `--color-text-muted` `#585c57` against `--color-surface` `#f7f4ee`; the neutrals sit at a lower red channel than the surfaces |
| Every text role clears 4.5:1 on every surface | `appearance.test.ts` "keeps every text role at 4.5:1 on every surface", three roles by four surfaces by two themes |
| Control boundaries clear 3:1 | `appearance.test.ts` "keeps control boundaries at 3:1 on every surface they sit on" |
| Semantic colours are independent of the accent seed and readable on their soft backgrounds | `appearance.test.ts` "keeps semantic colours readable and independent of the accent" |
| Brand ribbon promoted to a functional data palette | `--color-series-*` drives the Workbench document progress bar; `primitives.css` `.progress-bar__segment--confirmed` uses `--color-series-teal`, `--draft` uses `--color-series-ochre` |
| Series remain distinguishable, including in grayscale | `appearance.test.ts` "keeps the brand data palette distinguishable"; minimum L\* separation 3.4 light, 6.0 dark |
| One accent, no second accent anywhere | `ui-audit` R4 forbids raw colour outside `tokens.css`; a second accent would have to be a token, and none exists |
| Custom accent seeds stay readable | `appearance.test.ts` "stays readable for every seed in both themes" over ten seeds including `#000000` and `#ffffff` |
| No glass material | `ui-audit` R1; `appearance.test.ts` "forbids glass material anywhere in the renderer stylesheet" |

## Typography

| Claim | Evidence |
| --- | --- |
| Four bundled roles, no network fetch | `appearance.test.ts` "bundles all four type roles locally with swap"; the test also asserts no `http` URL appears in `fonts.css` |
| Display for titles, UI for body, mono for figures, CJK for content | `--font-display` used in 7 files, `--font-mono` in 7, `--font-cjk` in 2 (segment source, target editor, TM match), `--font-ui` as the body default |
| Tabular numerals wherever figures align | `font-variant-numeric: tabular-nums` in `base.css`, `primitives.css`, `surfaces.css`, `insights.css`, `workbench.css` |
| The 7.42 MB CJK face never loads for a Latin-only session | `pnpm ui:perf` measures 3 font requests before CJK content is on screen and 4 after |
| Radius scale is exactly 4/6/8/full | `appearance.test.ts` "uses only the approved radius scale"; `ui-audit` R4 rejects any other radius |

## Motion, class by class

| Class | Realised as | Applied at |
| --- | --- | --- |
| M1 surface transition | `.surface-enter`, transform only | `App.tsx`, keyed on the surface kind |
| M2 panel continuity | `grid-template-columns` and opacity transitions | `.workbench__body`, `.tm-panel`, `.pdf-panel` |
| M3 row focus | `tl-emphasis`, a left bar scaling in | `.segment-row--active` |
| M4 async lifecycle | `.skeleton` with settled-matching geometry | Projects, QA, Export, Search, Templates, Recycle, and `InlineState` |
| M5 settle feedback | `.settle-pulse`, one scale pulse | Export result |
| M6 list entrance | `.row-enter`, staggered, capped at eight rows, no overshoot | `lib/dom.ts` `rowEnterProps`, used by Projects and QA |
| M7 press | `translateY(1px)` on `:active` | `.btn` in `primitives.css` |

M7 is implemented directly on `.btn` rather than as a separate utility class,
deliberately: two implementations of one behaviour are how they drift apart. A
`.pressable` utility, a `.content-enter` class, and a `.skeleton-line` size that
were defined but never applied have been deleted, because a stylesheet that
declares motion the product does not perform is a claim without a fact.

Reduced motion is verified by computed style, not by reading the stylesheet:
`a11y-keyboard.spec.ts` "reduced motion collapses every transition to zero".

## Components and states

| Claim | Evidence |
| --- | --- |
| One primary action per surface | Duplicate CTA intents were removed from the QA, Export, Templates, and Projects empty states; the rule is written into the design language |
| Route-like sections use `nav` and `aria-current`, never a partial tab | No `role="tab"` remains in the renderer; all seven former pseudo-tabs use `SectionNav` |
| Menus implement the full APG pattern | `RowMenu.test.tsx` 10 cases, `EditorCommandBar.test.tsx` 8 cases, one shared `useMenuKeyboard` |
| Dialogs focus the safest action, trap, restore, and survive async | `use-destructive-confirm.test.tsx` 7 cases; `a11y-keyboard.spec.ts` asserts a visible ring on the armed button |
| Every collection has loading, empty, and error states | 27 bare `Loading` and `Empty` strings replaced by named states and skeletons; 21 data tables have a `TableEmpty` body |
| Icon-only controls carry `title` and `aria-label` | `ui-audit` R6, JSX scanner rather than a regex |
| No placeholder is the accessible name | Eight controls that relied on one were given explicit labels; two controls with no name at all were named |

## Copy

`ui-audit` R7 fails the build on an em dash or en dash, a `不是` contrast
construction, or a marketing filler word, across every renderer source file. It
currently reports zero findings.

## Not realised

- **Visible labels on 26 dense form controls.** They have programmatic names
  and pass axe, but their only on-screen affordance is a placeholder or
  position. Converting them would restructure six Asset Hub sections and two P4
  sections; recorded as debt rather than rushed. The list is reproducible by
  running the label probe described in `release-readiness.md`.
- **`AssetHub.tsx` remains one 1765-line file.** Its six sections share a dozen
  pieces of local state declared at the top of the component.
- **Loading and error states are not captured as screenshots.** `ui-shots`
  captures the settled state of each route plus whatever empty states occur
  naturally in a fresh project. Loading is transient and error states need
  injected failures; both are covered by unit and integration tests instead.
