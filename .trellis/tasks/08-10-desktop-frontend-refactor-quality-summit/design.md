# Desktop frontend refactor quality summit - design

## Architecture boundary

The program improves the existing renderer in place:

```text
Electron main/preload + Rust Engine (unchanged authority)
  -> DesktopApi / generated contracts
  -> use-app-controller + dedicated feature controllers
  -> App surface selection
  -> shell / surfaces / workbench / insights
  -> tokens.css + styles.css + bundled fonts
```

No child may bypass `DesktopApi`, move domain policy into React, or create a
parallel component framework. Presentational extraction is allowed when it
reduces real duplication and preserves current ownership.

## Visual system layers

1. **Foundation tokens** - canvas/surface/text/border/accent/semantic colors,
   type roles, spacing, radius, elevation, motion, focus, layer index.
2. **Primitives** - buttons, icon buttons, fields, tabs, menus, tables, status,
   skeleton/empty/error states, dialogs, panel chrome.
3. **Shell** - title strip, identity, navigation, engine state, window controls.
4. **Workflow surfaces** - lifecycle, editor, assets/insights, P4 domains.
5. **Cross-cutting quality** - accessibility, responsive/zoom behavior,
   performance, and visual evidence.

The design is solid-surface editorial tooling. Depth comes from tone, border,
spacing, and restrained tinted shadow. Backdrop blur and decorative floating
cards are prohibited.

## Task dependency graph

```text
visual-foundation
  -> shell-navigation-system-states
       -> project-lifecycle-workflow-surfaces
       -> workbench-editor-experience
       -> insights-assets-experience
       -> p4-experience
            -> accessibility-responsive-state-audit
            -> renderer-performance-delivery
                 -> visual-release-qualification
```

The four domain-surface tasks run serially even where the graph permits logical
parallelism because they share `styles.css`, `App.tsx`, and the same E2E
harness. Research and screenshot review may run in parallel; product edits may
not overlap on shared files.

## Compatibility strategy

- Keep stable DOM landmarks and accessible names used by P0-P4 E2E unless a
  planned test update demonstrates the new semantic contract.
- Prefer CSS-class and semantic-markup improvements over controller changes.
- Preserve all async command signatures and operation token ownership.
- Keep appearance storage key and session storage key unchanged.
- Apply bundled fonts before system fallbacks and preserve CJK coverage.
- Use feature-level rollbacks: each child owns a coherent file set and must be
  revertible without reverting completed earlier children.

## State and motion

State communication uses semantic attributes (`disabled`, `aria-current`,
`aria-selected`, `aria-expanded`, `aria-busy`, `aria-live`) first, then tokens
for visual expression. Motion is limited to shell/panel continuity, state
transition, and direct action feedback. It must be interruptible, avoid layout
properties, and collapse under `prefers-reduced-motion`.

## Verification architecture

- Vitest owns pure state and component interaction contracts.
- Playwright Electron owns production-build geometry, axe, keyboard, real
  Engine flows, theme persistence, screenshots, and console/page errors.
- Static searches own forbidden material/icon checks and inline-style debt.
- Visual evidence uses named viewport/theme/state files, numeric geometry
  tolerances, and no exact pixel assertions that are fragile under Windows DPI.
- Final qualification consumes each child's evidence; it does not substitute a
  shallow final smoke test for missing child coverage.

## Rollout and rollback

Each child begins from the previous green child commit on
`refactor/frontend-3`. A red child is fixed or reverted before the next child
starts. Token changes land first; broad token rollback must not require
reverting domain-surface behavior. The parent closes only after the final
qualification task proves all cross-child acceptance criteria.
