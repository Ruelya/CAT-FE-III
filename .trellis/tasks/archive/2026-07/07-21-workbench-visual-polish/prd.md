# Workbench visual polish

## Goal

Raise the perceived craft of the desktop workbench without changing any
behavior, layout geometry, or interaction contract. The app already has a
distinct editorial/paper identity (warm paper, ink, rust accent, 5-color band,
dot fields); this task makes that identity feel finished rather than drafted.

Origin: visual review against the workbench prototype
(`.trellis/workspace/Ruelya/workbench-assistant-1250x744.png`) concluded the
design system layer is solid but the refinement layer (micro-texture,
selection/scrollbar/focus branding, confirm feedback, dark-mode token gaps)
is where "fine" becomes "high-end".

## Constraints (non-negotiable)

- **No interference with in-flight main tasks.** The working tree currently
  carries uncommitted changes for `07-21-interop-cat-formats` and siblings.
  This task must touch only `apps/desktop/src/renderer/styles.css` and (for
  the confirm-flash class toggle) `Workbench.tsx`; it must not modify any
  file those tasks touch (engine, main process, contracts, fixtures).
- **No behavior changes.** No DOM structure changes, no new components, no
  changes to grid/flex/track sizes, row heights, panel widths, or scroll
  containers. Virtualized editor row geometry (`EDITOR_ROW_HEIGHT`) must stay
  exact.
- **No hard layout risk.** Every change must be additive paint-level CSS
  (color, shadow, texture, selection, scrollbar, ring, animation) or a
  class-toggle; nothing that can push content, wrap text differently, or
  alter hit areas.
- **Reduced-motion respect.** All new animation gated behind the existing
  `prefers-reduced-motion` block.
- **Dark theme parity.** Every new paint token must be defined for light,
  `.theme-dark`, and `theme-system` dark media query.

## Requirements

### R1 — Branded selection
Global `::selection` in accent-tinted paper tone; app-bar/status-bar (ink
surfaces) get a readable inverse selection. Removes the last default-blue
system remnant.

### R2 — Paper depth ladder
Introduce `--surface-raised` and `--surface-sunken` tokens and apply them to
the two flattest collisions: match/QA cards inside the suggestions scroll
(sunken scroll backdrop vs raised card) and the document preview line area.
No border color or radius changes.

### R3 — Subtle grain
One ultra-light SVG turbulence noise overlay on `body` background (light
theme only; dark theme keeps flat). Must not affect text rendering or
contrast measurably.

### R4 — Branded scrollbar
Thin webkit scrollbars using `--line`/`--line-strong`; thumb hover in accent.
Editor grid, suggestions scroll, assistant transcript, preview lines,
qa-table-body. Fallback: leave Firefox default (no `scrollbar-width`
regression risk).

### R5 — Unified focus ring
Single `--focus-ring` token; apply consistently to filter buttons, confirm
button, icon buttons, suggestion tabs, match insert buttons, assistant quick
actions and composer send, preview header controls. Keyboard-only
(`:focus-visible`); mouse interaction unchanged.

### R6 — Confirm micro-animation
On segment confirm: status lamp pops (scale keyframe) and the confirmed row
receives a one-shot warm flash sweep via a `row-flash` class that
auto-clears after the animation (~450ms). One-shot only; no loop, no
retrigger on re-render. Class toggle lives in the existing
`confirmSegment` path; failure paths must not flash.

### R7 — Token debt cleanup
- Add `--accent-hover` (#d94f13) and `--neutral` (#9a9288) tokens; replace
  the hardcoded occurrences (export hover, button primary hover, confirm
  composer hover, status-lamp/status-counts untranslated gray).
- Remove dead rules: `.suggestions-header > strong { clip-path: none }` and
  its `::after { content: none }`.

## Out of scope (explicit)

- Font changes (Bahnschrift local packaging, CJK stack) — needs license and
  bundle review; separate task.
- Skeleton screens, empty-state illustration, spacing/radius/typography
  scale refactor — layout-risk or spec-refactor work; separate task.
- Any change to `LiveAssistantPanel.tsx`, other pages, or engine code.

## Acceptance Criteria

- [x] All seven requirement groups implemented as described.
- [x] `pnpm --filter @translunar/desktop typecheck` and desktop unit tests
      pass (23 files, 142 tests).
- [x] `pnpm lint` passes, including workspace ESLint and Rust clippy.
- [x] Focused real-Engine Electron E2E passes for selection, scrollbars,
      keyboard focus, success-only confirm flash, failure no-flash, reduced
      motion, dark contrast, screenshots, and console/page errors. The full
      `pnpm test:e2e:desktop` suite is intentionally deferred to the main
      Electron 41 integration gate.
- [x] Visual review completed in light and dark at 1250x744, 1680x942, and
      1920x1080; evidence is under `evidence/screenshots/`.
- [x] No renderer console or page errors in the focused E2E.
- [x] Production behavior changes are confined to
      `apps/desktop/src/renderer/styles.css` and
      `apps/desktop/src/renderer/Workbench.tsx`; the focused regression lives
      in `apps/desktop/tests/e2e/workbench.spec.ts`.
