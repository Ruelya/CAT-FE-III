# Implementation Plan: Complete Desktop MVP and Frontend Fidelity

## Preconditions

- Keep the existing Electron + React + Rust engine + SQLite boundary.
- Run `trellis-before-dev` before editing application code.
- Preserve unrelated user changes and do not regenerate design artifacts unless
  a visual audit proves a source discrepancy.
- Keep the OpenDesign project `cat-translunar-opendesign` and its Grok Build
  configuration (`grok-4.5`, high reasoning) as reference evidence only.

## 1. Planning and Evidence Gate

- [x] Read the prior M0 task, product PRD, design notes, OpenDesign DESIGN.md,
      prototype pages, and generated QA screenshots.
- [x] Record the bounded MVP and explicit exclusions in `prd.md`.
- [x] Record renderer boundaries, motion, rendering, and rollback decisions in
      `design.md`.
- [x] Run the PRD convergence pass and review all acceptance mappings before
      activating the task.

## 2. Renderer Foundation

- [x] Load project-specific pre-development guidance.
- [x] Introduce shared surface/navigation types and pure fixture helpers without
      duplicating engine payload parsing.
- [x] Refactor `App`/`Workbench` presentation boundaries while retaining the
      existing engine orchestration and E2E-compatible labels.
- [x] Add a small `WorkbenchPages` surface for QA review, export review, and TM
      projections; every button must have a real callback or be omitted.

## 3. Workbench Fidelity and Interaction

- [x] Rebuild app chrome against the OpenDesign anchor: integer grid tracks,
      corrected font stacks, single contiguous Suggestions title block, one
      Translunar Band, and localized dot matrices.
- [x] Restore toolbar controls: filters, match selector presentation, in-file
      search, issue navigation, and view options/overflow navigation.
- [x] Keep the editable bilingual grid and IME-safe save/confirm flow intact;
      add visible focus, saving, conflict/error, empty, and disabled states.
- [x] Implement symmetric Suggestions dock/collapse/maximize transitions and
      attached collapsed rail.
- [x] Implement symmetric preview dock/collapse/maximize transitions, linked
      active-segment highlight, and bounded resize affordance.
- [x] Add Matches and Terms presentation with spacing that remains readable at
      1080p; insertion reuses the existing target update path.

## 4. Assistant MVP Surface

- [x] Add the Assistant tab with conversation selector/list, new conversation,
      model selector defaulting to `grok-4.5`, reasoning selector defaulting to
      `high`, active-segment context, quick actions, and composer.
- [x] Add deterministic offline response generation and one seeded interaction;
      label the provider honestly and keep it out of the engine contract.
- [x] Add compact response metrics and hover/focus explanations for model,
      input/cache-read/thinking/output/cache-write tokens, and elapsed time.
- [x] Add `Use in target`, insertion feedback, IME guard, and reduced-motion
      behavior.

## 5. Functional Page Projections

- [x] Add QA review projection with real issue evidence, navigate-to-segment, run
      QA, and empty/resolved state.
- [x] Add export review projection that persists pending edits, reports open QA
      issues, and invokes the existing main-owned export flow.
- [x] Add translation-memory projection using exact lookup/confirmed entries;
      omit destructive maintenance controls until an engine contract exists.
- [x] Add overflow navigation with active-page state and a back path to the
      workbench/setup surface.

## 6. Tests and Visual Verification

- [x] Add unit tests for panel-mode transitions, assistant metric formatting,
      conversation reducer behavior, and navigation/filter helpers.
- [x] Extend Electron Playwright coverage for Terms/Assistant, conversation
      selection, metrics tooltips, panel symmetry, page navigation, and export
      review while preserving the existing M0 workflow assertions.
- [x] Capture and inspect Windows screenshots at 1920x1080, 1680x942, and
      1250x744 for docked, collapsed, and maximized Suggestions/preview states.
- [x] Check renderer console/page errors, font availability/fallback, integer
      geometry at device scale, no Suggestions seam, and no text overlap.

## 7. Quality Gate

Run from repository root:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:check
pnpm test:e2e:engine
pnpm test:e2e:desktop
```

Also run a production desktop build and the documented K: launch path. Record
any environment-only limitation explicitly rather than weakening acceptance.

## 8. Risk and Rollback Points

- Before changing CSS tokens or widths, search all existing uses and update the
  owning rule only.
- Keep the first renderer refactor behavior-preserving; commit or checkpoint
  before adding page projections.
- If visual changes threaten the M0 E2E workflow, revert only the affected
  surface/component and retain the engine-backed path.
- Do not touch Rust migrations or protocol schema unless a real MVP acceptance
  criterion cannot be met with the existing contract.
