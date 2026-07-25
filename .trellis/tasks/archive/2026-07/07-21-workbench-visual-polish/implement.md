# Implement — Workbench visual polish

Ordered checklist. Steps 1–4 are pure CSS and independently shippable;
step 5 is the only TSX touch; step 6 is verification.

## 1. Tokens + dead-rule cleanup (R7)
- [x] `:root`: add `--surface-raised`, `--surface-sunken`, `--accent-hover`,
      `--neutral`, `--focus-ring`.
- [x] `.theme-dark` and `theme-system` dark media query: add matching values.
- [x] Replace `#d94f13` with `var(--accent-hover)` (export + primary button).
- [x] Replace `#9a9288` ×2 with `var(--neutral)`.
- [x] Delete dead `clip-path: none` / `::after { content: none }` rules in
      `.suggestions-header > strong`.

## 2. Global paint (R1, R3, R4)
- [x] `::selection` global + ink-surface inverse variant.
- [x] Grain SVG data-URI layer on `body` (light only; dark overrides to
      remove the layer).
- [x] Webkit scrollbar rules for: `.segment-grid`, `.suggestion-scroll`,
      `.assistant-transcript`, `.preview-lines`, `.qa-table-body`.

## 3. Depth ladder (R2)
- [x] `.suggestion-scroll` → sunken backdrop (keep dot texture layer).
- [x] `.match-card, .qa-card` → raised background.
- [x] `.preview-lines` → sunken mix.

## 4. Focus ring (R5)
- [x] `:focus-visible` rules on the control groups listed in design.md.
- [x] Keyboard pass: focused E2E reaches Confirm with `Shift+Tab` and verifies
      the `:focus-visible` ring; existing named controls and shared selector
      coverage protect toolbar, tabs, cards, and composer controls.

## 5. Confirm flash (R6, TSX)
- [x] CSS: `@keyframes lamp-pop`, `@keyframes row-flash`,
      `.status-lamp.just-confirmed i`, `.segment-row.row-flash td`.
- [x] `Workbench.tsx`: add `flashSegmentId` state; set on successful
      `confirmSegment`; clear via 500ms timeout registered in `timersRef`;
      add `row-flash` class in row className composition; add
      `just-confirmed` to StatusLamp via prop for the same segment.
- [x] Verify failure path does NOT flash: focused E2E creates a real revision
      conflict and asserts neither `row-flash` nor `just-confirmed` appears.

## 6. Verification gates
- [x] `pnpm --filter @translunar/desktop typecheck` — passed
- [x] `pnpm --filter @translunar/desktop test` — 23 files, 142 tests passed
- [x] `pnpm --filter @translunar/desktop build` — passed
- [x] `pnpm lint` — passed (workspace ESLint + Rust clippy)
- [x] Focused Electron E2E — passed against the real Engine in 19.3s. Full
      desktop E2E remains part of the main Electron 41 integration gate.
- [x] Visual pass: light + dark at all three viewports; selection, scrollbar,
      keyboard focus, confirm feedback, reduced motion, >=4.5:1 dark chrome/
      editor/status contrast, and no console/page errors verified.
- [x] Diff scope: production code remains confined to `styles.css` and
      `Workbench.tsx`; `workbench.spec.ts` and this task directory contain
      focused regression/evidence only.

## Rollback points
- After each numbered step the app must still build; if a check fails,
  revert the step's hunks only (each step is an independent CSS block).
- Full rollback: revert the single commit.

## Notes
- Do NOT commit as part of this session's main-task flow; commit only when
  the user asks, and keep it a standalone commit isolated from the
  interop tasks' working tree changes (stage by file path).
