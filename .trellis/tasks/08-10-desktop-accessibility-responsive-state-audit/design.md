# Desktop accessibility, responsive, and state audit - design

## Boundary

Accessibility behavior stays with the visual owner:

```text
semantic component or shared shell primitive
  -> local focus refs / event handling
  -> existing controller intent
  -> unchanged Engine / DesktopApi contract
```

Do not add a global accessibility store. Shared code is justified only for a
repeated interaction contract such as true tabs, live status, focus return, or
the viewport audit harness.

## Interaction classification

Inventory each control before editing:

| Visual pattern | Semantic contract |
| --- | --- |
| Destination/section switch that changes route-like content | `nav` with named controls and `aria-current` |
| One composite widget switching local panels | tablist/tabs/tabpanels with roving focus and associations |
| Command overflow | menu button/menu/menuitem keyboard contract |
| Modal/destructive flow | shared dialog primitive, initial focus rule, trap, Escape, restoration |
| Expand/collapse | button with `aria-expanded`/`aria-controls`; hidden region inert; focus handoff |
| Async progress/error | mounted status/alert region associated with owning control |

This prevents adding ARIA labels to interaction models that remain incomplete.

## Focus architecture

- Component-local refs retain openers and visible fallback targets.
- A surface-transition helper may focus a stable heading/main target only when
  `surface.kind` changes; it must not run for state refreshes within a surface.
- Dialog primitives retain their current trap/restoration ownership.
- Recovery focus receives one documented exception or converges to the shared
  Cancel-first rule; code, tests, and spec must agree in the same task.

## Responsive architecture

- Preserve the application minimum width while adding content-driven wrap,
  constrained grid tracks, `minmax(0, 1fr)`, intentional scroll owners, and
  Workbench container-responsive behavior where measurements prove need.
- A shared Playwright matrix sets BrowserWindow size, theme, text scale/zoom,
  reduced-motion/forced-color emulation when supported, and deterministic long
  content. Geometry assertions use numeric tolerances.
- Document-level overflow is always a failure. A labeled table or panel may
  scroll horizontally only when its columns cannot meaningfully collapse.

## Evidence model

The task writes a surface/state ledger mapping each finding to automated or
manual evidence. Axe results retain impact and rule IDs. Runtime screenshots
are diagnostic evidence, while semantic/geometry assertions decide pass/fail.
Manual-only lanes remain open instead of being converted to automated claims.

## Compatibility and rollback

- Preserve stable P0-P4 testids and accessible names unless the new name is more
  specific; update assertions to the semantic contract, not CSS geometry.
- Roll back by interaction family: navigation semantics, focus, announcements,
  or responsive CSS. A failure in one family must not require reverting all
  prior surface visual work.
- Product-domain findings discovered here return to their owning child rather
  than broadening this cross-cutting task.
