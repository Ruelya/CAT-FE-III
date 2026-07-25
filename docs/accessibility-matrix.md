# Accessibility acceptance matrix

Supported viewports: **1250×744**, **1680×942**, **1920×1080**.

| Area | Automated evidence in this repository | Manual evidence required before release |
| --- | --- | --- |
| Keyboard-only navigation | `product-shell-accessibility.spec.ts` asserts keyboard focus reaches Project Home, the Settings dialog (focus-trapped), and the Tutorial overlay at all three viewports, using a real Engine build. `product-shell.spec.ts` additionally checks dialog focus/Escape. Workbench, QA review, and Export review are **not** covered by axe/keyboard here (see below). | Native Windows and macOS pass through Project Home → Setup → Settings → Tutorial → Workbench → QA → Export, with evidence attached to the release. |
| Focus restoration / modal trapping | `product-shell-accessibility.spec.ts` asserts Settings and Tutorial focus entry plus Escape-to-close; tutorial reducer/unit coverage exists. | Verify every in-app dialog and tutorial step on a native runner, including opening, canceling, Escape, and return focus. |
| Semantic labels / status | E2E checks named Settings/Tutorial/Backup/Update controls (bilingual aria labels) and the reconnect/status regions it reaches; the backup flow waits on the `.surface-success` status notice. | Screen-reader spot-check of workbench, QA, export, backup/restore, updater, and recovery announcements. |
| Contrast | **Explicitly excluded from automated axe** (`color-contrast` is disabled in `runScopedAxe`) because the shared visual stylesheet is owned by a separate task. No repository-wide automated contrast result is recorded. | Capture contrast checks for paper/dark themes and status/error lamps at each supported viewport — this remains a manual acceptance gate. |
| Reduced motion | Shared `prefers-reduced-motion` CSS path is present (tutorial scroll honors it); no full interaction evidence is recorded. | Enable OS reduced motion and verify transitions, focus handoff, and dialogs on Windows and macOS. |
| Icon-only controls | Product-shell dialog has an unlabeled-button regression assertion; this does not qualify all workbench panels. | Review every icon-only command, panel toggle, and overflow menu with keyboard and assistive technology. |
| Axe (or equivalent) | `product-shell-accessibility.spec.ts` runs axe (minus `color-contrast`) against Project Home, the Settings dialog (including Backup/Restore and Update controls), and the Tutorial overlay at 1250×744, 1680×942, and 1920×1080. `product-shell.spec.ts` runs axe against the settings dialog at the same viewports. | Run the equivalent check across Workbench, QA review, and Export review before release; no claim is made here that those surfaces passed axe/keyboard. |

## Coverage boundary (automated, this task)

Covered by axe + keyboard in `product-shell-accessibility.spec.ts` at all three
viewports against a real Rust Engine build:

- **Project Home** — axe-clean, `complementary` workspace-view landmark present,
  keyboard focus reaches the shell.
- **Settings dialog** — axe-clean, focus-trapped, Escape closes; Backup/Restore
  and Update controls present and named.
- **First-run Tutorial overlay** — axe-clean, keyboard-operable, Skip dismisses.
- **Tutorial completion / Open Example** — advances through the reducer and
  opens the bundled example project offline through the real Engine import path
  (asserted by the workbench "Translation segments" region appearing).
- **Workspace backup** — runs through the Settings UI with the deterministic
  `TRANSLUNAR_TEST_BACKUP_DESTINATION` seam and asserts the Engine actually
  wrote `manifest.json` at the destination (not merely a mocked status).

**Explicitly pending (not claimed as covered here):**

- **Workbench**, **QA review**, and **Export review** axe + keyboard. These
  surfaces keep only their layout-overflow coverage in `workbench.spec.ts`.
  Adding axe/keyboard for them could not be done safely without touching the
  protected `Workbench.tsx`/`styles.css` in this scope, so they remain a manual
  acceptance task and a follow-up automation gap.
- **Setup view** axe/keyboard beyond boot smoke.
- **color-contrast** at every viewport (excluded from automated axe by design;
  manual only).

## Native / platform limitations

- The Electron E2E runs on the CI host platform only; **native screen-reader**
  behavior (NVDA/JAWS on Windows, VoiceOver on macOS) is not exercised by axe
  and must be verified manually.
- **macOS**-specific behavior (VoiceOver, reduced-motion, and native focus ring)
  is not covered by these Windows-oriented runs and remains a manual gate.
- axe runs in Playwright legacy mode inside Electron's `BrowserContext`; it does
  not substitute for assistive-technology testing.

## Evidence boundary

The automated evidence above is limited to the product-shell E2E and focused
unit checks that are present in this repository. A row marked as manual, or a
surface listed as pending, is an acceptance task — not a completed qualification
claim; attach runner, commit, viewport, and failure details before marking it
passed.

## Release notes

- Product shell strings use the bilingual catalog; controls exposed in Settings
  and Tutorial must remain named for AT.
- Engine reconnect banners use `role="status"`.
- Draft recovery and restore dialogs are modal with explicit close controls.
