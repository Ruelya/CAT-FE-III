# Desktop frontend refactor quality summit - program plan

## Planning-only status

This file defines future execution. During the current turn, do not run
`task.py start`, create product branches, edit `apps/desktop`, or execute an
implementation/check loop.

## Ordered child execution

- [ ] 1. Complete `08-10-desktop-visual-foundation`.
  - Exit gate: bundled typography and semantic tokens/primitives are green in
    light/dark, with focused token/appearance tests and no forbidden material.
- [ ] 2. Complete `08-10-desktop-shell-navigation-system-states`.
  - Exit gate: shell/window controls, context navigation, boot/reconnect,
    recovery, and dialogs are keyboard/geometry verified.
- [ ] 3. Complete `08-10-desktop-project-lifecycle-workflow-surfaces`.
  - Exit gate: Welcome, lifecycle, Search, QA, and Export surface states are
    complete while P0/P1 workflows remain green.
- [ ] 4. Complete `08-10-desktop-workbench-editor-experience`.
  - Exit gate: dense editor, command/panel/TM/PDF/reimport paths retain IME,
    save, virtualization, and real-Engine behavior.
- [ ] 5. Complete `08-10-desktop-insights-assets-experience`.
  - Exit gate: Insights and all Asset Hub domains are scan-friendly, complete,
    responsive, and P2/P3 green.
- [ ] 6. Complete `08-10-desktop-p4-experience`.
  - Exit gate: AI/Plugins/Collaboration/Settings remain security- and
    authority-correct with all always-on P4 checks green.
- [ ] 7. Complete `08-10-desktop-accessibility-responsive-state-audit`.
  - Exit gate: cross-surface axe, keyboard, focus, zoom, reduced motion, and
    state inventory have no open blocker/major finding.
- [ ] 8. Complete `08-10-desktop-renderer-performance-delivery`.
  - Exit gate: recorded startup/bundle/font/frame/CLS budgets pass in the
    production Electron build.
- [ ] 9. Complete `08-10-desktop-visual-release-qualification`.
  - Exit gate: complete evidence matrix and full repository quality gates pass.

## Shared validation commands

Focused child checks should run first. Final child runs the complete matrix:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build:desktop
rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer
pnpm test:e2e:desktop
```

Also inspect 1250x744, 1680x942, and 1920x1080 in light/dark, 125% text
scaling, and reduced motion. Record fixture-gated skips separately.

## Program control points

- Before each child: refresh from the last green child, read its task artifacts
  and relevant `.trellis/spec/frontend/` files, then run `trellis-before-dev`.
- During each child: keep `styles.css` ownership exclusive; do not mix product
  domains not named by that child.
- After each child: run focused review/check/fix until green, update durable
  specs only for verified conventions, commit the child, then proceed.
- If implementation discovers a behavior/spec conflict, return that child to
  planning and update its PRD/design before continuing.
- Parent completion requires every child archived or explicitly accepted with
  documented residual risk; no skipped child is inferred complete.

## Rollback points

- Foundation rollback: tokens/fonts/primitives only.
- Shell rollback: shell components and shell-owned CSS/tests only.
- Domain rollback: owning surfaces/workbench/insights/P4 files plus their CSS
  block and focused tests.
- Cross-cutting rollback: a11y/performance change isolated to the failing
  contract, preserving already-green visual work.
- Qualification does not introduce broad redesign; any major visual defect
  returns to the owning child task.
