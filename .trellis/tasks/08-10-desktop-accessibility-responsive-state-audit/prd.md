# Desktop accessibility, responsive, and state audit

## Goal

Close cross-surface accessibility, keyboard, focus, feedback, compact-window,
text-scaling, and interaction-state gaps after the six visual/product children
are green. The task turns the renderer into one consistently operable desktop
application without changing Engine behavior or concealing unresolved native
evidence.

## Background

- The BrowserWindow minimum is 1180x700, while the existing viewport matrix
  begins at 1250x744 and `styles.css` has no width-dependent breakpoint.
- The parent UX audit found semantic interaction mismatches in tab-like section
  navigation and the Workbench overflow menu, focus loss after panel/surface
  changes, incomplete live announcements and field-error association, and
  unlabeled or ambiguous controls.
- Existing axe helpers ignore moderate/minor findings and P3 has no axe pass.
- Native assistive technology, real OS IME, forced colors, macOS behavior, and
  several zoom/reduced-motion checks remain evidence gaps.

## Dependencies and ownership

- Runs after `08-10-desktop-p4-experience`; all earlier visual and surface tasks
  must be green so this audit evaluates the integrated product.
- Owns cross-surface semantic/focus/state fixes and the shared accessibility and
  geometry test matrix. Product-domain redesign returns to the owning child.
- May change renderer presentation components, shared primitives, CSS, unit
  tests, and E2E helpers. It must not change generated contracts, Engine rules,
  save ordering, security boundaries, or invent a global focus/state store.

## Requirements

### R1 - Semantic interaction models

- Route-like section navigation uses semantic `nav` plus `aria-current`; true
  in-surface tabs implement the complete tab/tabpanel model with IDs,
  association, roving focus, Arrow keys, Home, and End.
- The editor overflow menu implements focus entry, enabled-item traversal,
  Escape closure, opener restoration, and a visible focus ring matching its
  advertised menu semantics.
- Selected/current/expanded/busy states use native semantics or the matching
  ARIA state, with no role that lacks its required keyboard interaction.

### R2 - Focus continuity

- Dialogs trap focus, expose a non-destructive Escape route, and restore the
  invoking control or a documented stable fallback.
- Editor panels and collapsible PDF/TM regions move focus to the visible owner
  on close/collapse and return it predictably on reopen.
- Surface transitions provide a consistent heading/main focus or live
  announcement contract without stealing focus during local updates.
- Recovery initial focus must be resolved before implementation: retain the
  current Recover-first behavior only if the project spec is deliberately
  updated with a work-preservation exception; otherwise adopt Cancel-first.

### R3 - Names, forms, and status feedback

- Every control has a stable accessible name. Repeated-row actions include the
  item identity; icon-only controls include `aria-label` and `title`.
- Visible labels are associated with one control. Invalid fields expose
  `aria-invalid`, related error IDs, and first-invalid focus after submit.
- Progress and settled informational feedback use non-interruptive status
  announcements; actionable failures use alert semantics near the affected
  control while preserving user input and focus.
- Destructive AI, plugin, connector, collaboration, asset, recycle, and data
  actions use the shared confirmed path and stay mounted through completion.

### R4 - Compact desktop and text resilience

- Validate 1180x700, 1250x744, 1680x942, and 1920x1080 in both themes with
  long CJK labels, long project/document identities, long IDs, and table data.
- Validate 125% text scaling as the program gate and 200% zoom as an
  accessibility stress lane. No document-level horizontal overflow, overlap,
  clipped primary action, obscured focus, or unreachable nested content is
  allowed.
- Intentional table/panel scroll areas remain labeled and keyboard reachable.
  Layout adapts by content ownership rather than deleting capabilities.
- Dense desktop controls retain at least 32x32 CSS pixel hit areas; primary,
  destructive, and touch-relevant controls receive larger stable targets.

### R5 - Visual accessibility modes

- All themes and accent seeds meet WCAG 2.2 AA foreground/background and focus
  contrast; semantic status colors remain distinguishable without color alone.
- Reduced motion removes nonessential transitions and preserves state/focus
  continuity. Windows forced-colors remains legible where Electron supports it.
- CJK composition and keyCode/which 229 continue to block target mutation and
  focus advance until composition ends.

### R6 - Honest evidence

- Axe evaluates all impacts; any owned baseline is explicit, justified, and
  assigned rather than silently filtered.
- Automated checks cover keyboard/focus/navigation/status contracts on every
  route family. Manual evidence records native AT, real OS IME, macOS chrome,
  forced colors, and any platform behavior automation cannot prove.
- A hypothesis from static CSS inspection is not marked fixed until runtime
  geometry evidence exists.

## Acceptance criteria

- [ ] AC1: Every route-like nav, true tab set, menu, dialog, panel, and
      selectable PDF control exposes semantics matching its keyboard behavior.
- [ ] AC2: Focus entry, containment, Escape, close/collapse, surface transition,
      and restoration tests pass, including the documented recovery-focus rule.
- [ ] AC3: All controls and fields have unambiguous names/labels; invalid forms
      announce and focus errors; busy/success/failure states are announced.
- [ ] AC4: No unconfirmed destructive P0-P4 action remains.
- [ ] AC5: The four viewport matrix, both themes, 125% text scaling, long CJK/
      identity fixtures, and the 200% stress lane show no incoherent overflow,
      clipping, overlap, hidden primary action, or obscured focus.
- [ ] AC6: Contrast, non-color meaning, reduced motion, forced-colors where
      supported, keyboard-only operation, and IME guards pass their matrices.
- [ ] AC7: Axe covers P0-P4 without silently dropping impacts; native/manual
      residuals name runner, platform, result, and evidence location.
- [ ] AC8: Focused unit/integration/E2E checks plus the complete desktop quality
      gates pass with zero unexpected renderer console or page errors.

## Out of scope

- A mobile layout, mobile navigation model, touch-first redesign, or support
  below the configured BrowserWindow minimum.
- Rewriting product workflows, changing Engine contracts, or replacing React's
  current surface machine.
- Claiming NVDA, VoiceOver, real IME, or macOS behavior from axe/source review.

## Blocking questions

None for task creation. Recovery initial-focus divergence is an explicit
implementation gate: the worker must reconcile the current code/test with the
current spec before choosing either behavior.
