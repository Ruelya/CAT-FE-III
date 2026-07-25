# Accessibility acceptance matrix

Supported viewports: **1250×744**, **1680×942**, **1920×1080**.

| Area | Automated evidence in this repository | Manual evidence required before release |
| --- | --- | --- |
| Keyboard-only navigation | Product-shell Playwright smoke checks dialog focus and Escape at all three viewports; this is not a full-workbench audit. | Native Windows and macOS pass through Project Home → Settings → Tutorial → Workbench, with evidence attached to the release. |
| Focus restoration / modal trapping | Product-shell dialog focus check; tutorial reducer/unit coverage exists. | Verify every in-app dialog and tutorial step on a native runner, including opening, canceling, Escape, and return focus. |
| Semantic labels / status | Product-shell E2E checks named settings/tutorial controls and the reconnect/status regions it reaches. | Screen-reader spot-check of workbench, QA, export, backup/restore, updater, and recovery announcements. |
| Contrast | No repository-wide automated contrast result is recorded. | Capture contrast checks for paper/dark themes and status/error lamps at each supported viewport. |
| Reduced motion | Shared `prefers-reduced-motion` CSS path is present; no full interaction evidence is recorded. | Enable OS reduced motion and verify transitions, focus handoff, and dialogs on Windows and macOS. |
| Icon-only controls | Product-shell dialog has an unlabeled-button regression assertion; this does not qualify all workbench panels. | Review every icon-only command, panel toggle, and overflow menu with keyboard and assistive technology. |
| Axe (or equivalent) | `apps/desktop/tests/e2e/product-shell.spec.ts` runs axe against the settings dialog at 1250×744, 1680×942, and 1920×1080. | Run the equivalent check across the remaining product surfaces before release; no claim is made here that those surfaces passed. |

## Evidence boundary

The automated evidence above is limited to the product-shell E2E and focused
unit checks that are present in this repository. A row marked as manual is an
acceptance task, not a completed qualification claim; attach runner, commit,
viewport, and failure details before marking it passed.

## Release notes

- Product shell strings use the bilingual catalog; controls exposed in Settings
  and Tutorial must remain named for AT.
- Engine reconnect banners use `role="status"`.
- Draft recovery and restore dialogs are modal with explicit close controls.
