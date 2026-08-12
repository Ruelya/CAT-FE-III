# Research: Desktop frontend UX, accessibility, and responsive audit

- Query: Which current desktop renderer UX, accessibility, responsive-layout, and verification gaps should the quality-summit implementation prioritize while preserving existing product workflows?
- Scope: internal mixed review of current Electron/React source, renderer CSS/tokens, E2E/unit test coverage, and Trellis frontend specifications; external standards are listed for interpretation only
- Date: 2026-08-10

## Findings

### Executive assessment

The desktop frontend has a coherent shell, typed surface transitions, dedicated controllers, semantic dialogs, shared appearance tokens, and real-Engine E2E coverage. The highest-value work is contract completion and verification depth, not a wholesale navigation rewrite. Several controls advertise ARIA widget semantics without implementing the interaction model those semantics require, and a number of asynchronous/form states are visible only to sighted mouse users. Responsive concerns are credible from the CSS geometry but remain hypotheses until measured at the BrowserWindow minimum and with long localized content.

Severity uses P0 (workflow/data-loss or blocking accessibility), P1 (cross-surface keyboard or announcement failure), P2 (repeatable usability/label defect), and P3 (polish or coverage gap). Confidence is **confirmed** when the source directly demonstrates the issue, and **hypothesis** when runtime geometry or platform behavior still needs a test.

### Confirmed defects

#### P1: ARIA tabs are click-only pseudo-tab widgets

Seven surfaces use `role="tablist"` and `role="tab"` with `aria-selected`, but do not implement roving `tabIndex`, Arrow/Home/End handling, tab IDs, `aria-controls`, or a named/associated tabpanel. Examples are [AiControl.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/AiControl.tsx:64), [Plugins.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Plugins.tsx:148), [Collaboration.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Collaboration.tsx:56), [ProductSettings.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/ProductSettings.tsx:48), [AssetHub.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/AssetHub.tsx:73), [ProjectHome.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/ProjectHome.tsx:242), and the Interop sub-navigation in [ProjectInsights.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/ProjectInsights.tsx:227). A native `nav` plus `aria-current` pattern already exists in [InsightsSectionNav.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/insights/InsightsSectionNav.tsx:26), so the least risky choice is either to use that semantic pattern for route-like sections or to complete the APG tab pattern consistently.

#### P1: Editor overflow menu does not implement menu keyboard behavior

The More button exposes `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls`, and the popup exposes `role="menu"`/`role="menuitem"` in [EditorCommandBar.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/workbench/EditorCommandBar.tsx:108). Opening leaves focus on More rather than moving to the first enabled item; Arrow/Home/End navigation is absent; Escape only changes state and does not restore focus to More ([EditorCommandBar.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/workbench/EditorCommandBar.tsx:59)). This is a semantic interaction mismatch, not merely missing test coverage. The menu item CSS also suppresses the global focus outline ([styles.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/styles.css:773)).

#### P1: Non-modal editor panel close loses the invoking control

`EditorPanels` renders a Close button for each panel ([EditorPanels.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/workbench/EditorPanels.tsx:33)), while `useEditorOperations.closePanel` only clears state and errors ([use-editor-operations.ts](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/state/use-editor-operations.ts:451)). There is no opener ref, close-time focus handoff, or fallback target. When the panel unmounts, keyboard users can be returned to document/body focus.

#### P1/P2: Recovery initial focus violates the project’s safest-action contract

The shared frontend contract requires recovery/destructive dialogs to focus Cancel first, trap focus, treat Escape as non-destructive, and restore prior focus ([component-guidelines.md](/D:/Workbench/CAT-FE-III/.trellis/spec/frontend/component-guidelines.md:183)). [RecoveryDialog.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/shell/RecoveryDialog.tsx:28) focuses `primaryRef`; in recoverable mode that is Recover, and in stale mode it is Retry ([RecoveryDialog.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/shell/RecoveryDialog.tsx:93)). Existing tests codify the opposite expectation ([RecoveryDialog.test.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/shell/RecoveryDialog.test.tsx:12)). Recover may be the domain-safer action when it preserves a draft, so the implementation must either change to Cancel-first or document and test an explicit, product-approved exception rather than silently diverging from the spec.

#### P1: Dynamic status and error feedback is inconsistent and often not announced

Several stable P0-P3 states use plain paragraphs/divs without `role="status"`, `role="alert"`, or `aria-live`:

- Workbench transition/journal errors and Confirming state ([Workbench.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Workbench.tsx:127), [Workbench.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Workbench.tsx:145)).
- Confirm dialog errors ([ConfirmDialog.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/shell/ConfirmDialog.tsx:123)).
- Create form validation/server errors ([CreateProject.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/CreateProject.tsx:110)).
- QA and export loading/errors/results ([QaReview.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/QaReview.tsx:73), [ExportReview.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/ExportReview.tsx:88)).
- Interop, task-package, and reimport notices/status/errors ([InteropReviewPanel.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/insights/InteropReviewPanel.tsx:118), [InteropTablePanel.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/insights/InteropTablePanel.tsx:129), [TaskPackagePanel.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/insights/TaskPackagePanel.tsx:157), [ReimportDialog.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/insights/ReimportDialog.tsx:83)).

P4 top-level errors often do use `role="alert"` (for example [Plugins.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Plugins.tsx:169) and [ProductSettings.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/ProductSettings.tsx:69)), which is a useful baseline to standardize rather than invent a new notification system.

#### P1/P2: Form errors are not connected to fields or focused after submit

[CreateProject.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/CreateProject.tsx:34) validates state in the submit handler, but inputs have no `aria-invalid`/`aria-describedby`; the error nodes at lines 110-112 are not live and no first-invalid focus is performed. The template create/use forms have the same pattern ([Templates.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Templates.tsx:303), [Templates.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Templates.tsx:450)). Add stable field IDs, error IDs, `aria-invalid`, and a summary or first-invalid focus contract.

#### P2: Several controls are unlabeled, placeholder-only, or ambiguous in repeated rows

- Collaboration actor/member ID and role controls rely on surrounding layout or a placeholder; the new-member input is placeholder-only ([Collaboration.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Collaboration.tsx:84), [Collaboration.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Collaboration.tsx:98)).
- Plugin permission selector has no programmatic label beyond the placeholder option ([Plugins.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Plugins.tsx:441)).
- Product Settings wraps a color input and a hex text input inside one `label`, so the visible “Accent” label is not uniquely associated with either control ([ProductSettings.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/ProductSettings.tsx:126)).
- Asset curation reason/run inputs are placeholder-only ([AssetHub.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/AssetHub.tsx:1493)); similar curation IDs/reasons appear nearby.
- Repeated project/template/recycle row actions use generic names such as Open, Use, Edit, Delete, Restore, and Purge without item names in the accessible name ([ProjectHome.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/ProjectHome.tsx:283), [Templates.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Templates.tsx:117), [RecycleBin.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/RecycleBin.tsx:78)).

#### P2: Icon-only buttons miss the required visible tooltip/title contract

[PanelChrome.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/workbench/PanelChrome.tsx:13), [PdfPageReview.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/workbench/PdfPageReview.tsx:64), and [TaskPackagePanel.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/insights/TaskPackagePanel.tsx:103) provide `aria-label` but no `title`. The frontend spec explicitly requires both `title` and `aria-label` for icon-only controls ([quality-guidelines.md](/D:/Workbench/CAT-FE-III/.trellis/spec/frontend/quality-guidelines.md:134)).

#### P2: PDF page selection and collapse semantics are incomplete

PDF page controls render visual active state but no `aria-current`, `aria-selected`, or `aria-pressed` state ([PdfPageReview.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/workbench/PdfPageReview.tsx:109)). Collapse applies `inert`/`aria-hidden` to content, but does not provide the explicit focus handoff required by the component contract; the exact-TM implementation is the stronger comparison pattern. The OCR “Correct” control is only `min-height: 1.25rem` ([styles.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/styles.css:1464)), creating a compact-target risk.

#### P1: Destructive actions bypass the cancel-first confirmation lock

Direct delete/remove handlers are present for AI profiles ([AiControl.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/AiControl.tsx:186)), collaboration members ([Collaboration.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Collaboration.tsx:142)), connector profiles ([Plugins.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Plugins.tsx:973)), and connector credentials ([Plugins.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Plugins.tsx:1073)). Some other operations, such as corpus removal, correctly use `ConfirmDialog` ([AssetHub.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/AssetHub.tsx:1673)); standardize the protected path across all destructive commands.

#### P3: Developer-facing/raw data presentation leaks into production surfaces

Raw JSON/preformatted dumps remain in AI and Plugin surfaces ([AiControl.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/AiControl.tsx:1062), [Plugins.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Plugins.tsx:350)). Product Settings exposes technical boolean/key-value copy ([ProductSettings.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/ProductSettings.tsx:181)), and Collaboration tables foreground raw actor IDs and ISO timestamps ([Collaboration.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/surfaces/Collaboration.tsx:190)). Treat this as information architecture/visual quality debt; only remove text when it is genuinely explanatory filler, because the project copy rules prohibit filler subtitles and “不是” contrast copy but do not prohibit necessary technical values.

#### P2: Surface transitions have no app-level heading/focus announcement

[App.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/App.tsx:358) keeps a single `main` and conditionally swaps all surfaces through line 794. There is no route-change effect that focuses the new surface heading/main landmark or announces the new surface. Individual dialogs and some local components manage focus, but a keyboard/screen-reader user navigating Home → Workbench → QA/P4 has no consistent transition target. This is confirmed at the composition level; exact assistive-technology impact should be validated with an automated focus test and manual screen-reader pass.

### Responsive and visual risks (hypotheses pending runtime measurement)

- `styles.css` has no width breakpoint; its only media query is reduced motion ([tokens.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/tokens.css:119)). This is not itself a defect in a desktop app, but it means compact-window adaptations are implicit rather than explicit.
- Non-wrapping action groups and mastheads can compress or clip long labels: `.surface__masthead` ([styles.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/styles.css:502)), `.project-row` ([styles.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/styles.css:538)), dialog actions ([styles.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/styles.css:616)), and Workbench header actions ([styles.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/styles.css:657)).
- Workbench reserves fixed rails/panels (`--tm-panel-width: 320px`, `--tm-rail-width: 36px`) and PDF columns ([tokens.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/tokens.css:79), [styles.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/styles.css:663)). At the configured minimum BrowserWindow width, simultaneous PDF + TM + long localized commands need measurement.
- P4 tables are dense and rely on panel scrolling; no source proof of document-level overflow was found. Test row-level scroll containers and keyboard reachability at 1180x700, 1250x744, and with CJK/long IDs.
- The PDF OCR correction control is below common 44px touch-target guidance, although this is a desktop-first product; retain a larger keyboard/focus hit area even if visual density stays compact.

### Positive baselines to preserve

- Global `:focus-visible` ring is defined at [styles.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/styles.css:176), and the app uses Phosphor icons consistently in new controls.
- Reduced motion is tokenized to `0ms` for both themes ([tokens.css](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/tokens.css:119)). Verify computed transitions, but retain this architecture.
- Light/dark semantic tokens are independent of the accent seed, with documented contrast calculations in the prior codebase audit; do not replace them with per-screen colors.
- `ConfirmDialog` and `ModalDialog` already capture opener focus, focus Cancel by default, trap Tab, handle Escape non-destructively, and restore focus ([ConfirmDialog.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/shell/ConfirmDialog.tsx:43), [ModalDialog.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/shell/ModalDialog.tsx:33)). Reuse these primitives.
- Boot and engine status surfaces already use `role="status"`/`aria-live="polite"` ([BootGate.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/shell/BootGate.tsx:18), [EngineStatusBanner.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/shell/EngineStatusBanner.tsx:27)).
- Insights section navigation uses semantic `nav` and `aria-current`, a good fit for route-like P4 section switching ([InsightsSectionNav.tsx](/D:/Workbench/CAT-FE-III/apps/desktop/src/renderer/insights/InsightsSectionNav.tsx:26)).

### Verification gaps

- Axe helpers in P0/P1/P2/P4 filter to only `serious`/`critical` violations ([p0-vertical-slice.spec.ts](/D:/Workbench/CAT-FE-III/apps/desktop/tests/e2e/p0-vertical-slice.spec.ts:108), [p1-project-lifecycle.spec.ts](/D:/Workbench/CAT-FE-III/apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:98), [p2-editor-assets.spec.ts](/D:/Workbench/CAT-FE-III/apps/desktop/tests/e2e/p2-editor-assets.spec.ts:97), [p4-ai-plugins-settings.spec.ts](/D:/Workbench/CAT-FE-III/apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:97)). Moderate/minor findings can therefore ship silently.
- P3 has no axe audit at all; its E2E case mainly exercises the PDF/reimport workflow and console guard ([p3-interop-pdf.spec.ts](/D:/Workbench/CAT-FE-III/apps/desktop/tests/e2e/p3-interop-pdf.spec.ts:82)).
- P4 tab coverage is click-only ([p4-ai-plugins-settings.spec.ts](/D:/Workbench/CAT-FE-III/apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:136)); there are no Arrow/Home/End assertions.
- P4 overflow checks run only the current Settings state at 1250x744, 1680x942, and 1920x1080 ([p4-ai-plugins-settings.spec.ts](/D:/Workbench/CAT-FE-III/apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:247)). They do not cover every P4 section, the configured 1180x700 minimum, or zoom/text scaling.
- P2 has horizontal-overflow checks for the seeded Workbench and Assets states ([p2-editor-assets.spec.ts](/D:/Workbench/CAT-FE-III/apps/desktop/tests/e2e/p2-editor-assets.spec.ts:103)), and P1 checks selected Insights/Search states at 1250x744 ([p1-project-lifecycle.spec.ts](/D:/Workbench/CAT-FE-III/apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:104)). These are useful baselines, not full responsive qualification.
- Playwright is serial Electron-only with no default viewport in config ([playwright.config.ts](/D:/Workbench/CAT-FE-III/apps/desktop/playwright.config.ts:3)); tests set viewport ad hoc. Add a shared matrix instead of relying on incidental defaults.
- No automated coverage was found for menu focus, tab Arrow keys, panel close focus restoration, route-heading focus, live announcements, forced-colors, 200% zoom, reduced-motion computed styles, or keyboard access to PDF page selection.

## Prioritized recommendations

1. **P0/P1 interaction contracts:** choose one semantic model for route-like section navigation; implement a reusable keyboard tab primitive only where true tabs are intended. Add IDs/`aria-controls`/tabpanel naming, roving focus, Arrow/Home/End, and tests for disabled items and selection announcements.
2. **P1 focus continuity:** track the More opener and each editor-panel opener; move focus into the menu/panel on open, return focus on Escape/Close, and provide a stable fallback when the opener unmounts. Add an app-level surface-heading focus/announcement effect keyed by `surface.kind`.
3. **P1 feedback:** normalize busy/success/error announcements with `role="status"` for progress and `role="alert"` for actionable failures. Keep regions mounted where possible so screen readers receive changes without focus theft.
4. **P1 recovery/destructive safety:** resolve the Recover-vs-Cancel product decision against the written spec, then update implementation and tests. Wrap every AI/plugin/collaboration/credential delete in the existing Cancel-first `ConfirmDialog`; keep dialogs mounted through async completion.
5. **P2 form semantics:** connect every validation message to its field, mark invalid controls, focus the first invalid field after submit, and give every placeholder-only control a visible or programmatic label. Include item identity in repeated-row action names.
6. **P2/P3 visual controls:** restore `title` alongside `aria-label` for icon-only buttons; preserve the global focus ring in menu CSS; expose PDF page selected/current state and a full-size keyboard target for OCR correction.
7. **P2 responsive qualification:** measure document and nested scroll overflow at 1180x700 (BrowserWindow minimum), 1250x744, 1680x942, and 1920x1080 across Home, Workbench with PDF/TM combinations, every P4 section, Insights, Assets, dialogs, and long CJK/ID fixtures. Add 200% zoom and forced-colors checks where Electron supports them.
8. **P3 test policy:** make axe output all impacts in CI (or explicitly baseline moderate/minor IDs with owners), add an axe pass to P3, and add keyboard/focus assertions to every state transition. Retain existing console guards and real-Engine/fixture gating.
9. **P3 information hierarchy:** replace raw JSON/pre dumps and unexplained internal IDs with structured, collapsible technical detail that remains available to power users; format timestamps and identify entities in action labels without adding prohibited filler copy.

## Acceptance and test matrix

| Area | Required assertion | Suggested states/viewports |
| --- | --- | --- |
| Section navigation | Tab/roving focus, Arrow/Home/End, selected announcement, correct panel association | Project Home, Insights Interop, Assets, AI, Plugins, Collaboration, Settings; 1180x700 and 1250x744 |
| Overflow menu | Open focuses first enabled item; Arrow navigation; Escape/outside click closes and restores More focus | Workbench with busy/disabled and all overflow commands |
| Editor panels | Open focus target; Close/Escape returns opener or documented fallback | Find/Tags/Comments/History/Preferences/Review/Structure |
| Surface transitions | New heading/main landmark receives focus or a live route announcement; prior focus is not lost | Home, Workbench, QA, Export, Insights, Assets, each P4 surface |
| Dialogs | Cancel-first (or documented exception), trap, non-destructive Escape, restore opener, async errors announced | Recovery, ConfirmDialog, ModalDialog, Reimport |
| Forms | Visible labels, `aria-invalid`, `aria-describedby`, first-invalid focus, error recovery | Create Project; Template create/use/edit; P4 credential/profile forms |
| Destructive actions | Confirmation before delete/remove/purge; cancel leaves state unchanged; success closes and announces | AI profile/credential, connector profile/credential, member removal, corpus/purge |
| Async feedback | Busy, success, and failure are announced without stealing focus; duplicate actions disabled | Workbench save/confirm, QA, Export, Interop, Task Package, Reimport, Asset curation |
| PDF | Selected/current page semantics; collapse moves focus to expand control; OCR action has full keyboard target | PDF open/collapsed/maximized, OCR overlay |
| Responsive | No document overflow; nested tables scroll intentionally; controls wrap or remain reachable | 1180x700, 1250x744, 1680x942, 1920x1080; long CJK and long IDs |
| Visual/accessibility modes | Focus ring visible, contrast AA, reduced motion computed to zero, forced-colors remains legible | Light/dark themes, `prefers-reduced-motion`, Windows forced colors, 200% zoom |
| E2E quality | Axe reports all impacts or owned baselines; no console/page errors | P0-P4 stable and fixture-backed states |

## Files found

### Current implementation

| Path | Description |
| --- | --- |
| `apps/desktop/src/renderer/App.tsx` | Root shell composition and conditional surface transitions. |
| `apps/desktop/src/renderer/surfaces/{AiControl,Plugins,Collaboration,ProductSettings,AssetHub,ProjectHome,ProjectInsights}.tsx` | Tab-like section navigation and P4/P1/P2 surface controls. |
| `apps/desktop/src/renderer/workbench/EditorCommandBar.tsx` | Primary commands and overflow menu. |
| `apps/desktop/src/renderer/workbench/EditorPanels.tsx` | Non-modal editor panel rendering and Close controls. |
| `apps/desktop/src/renderer/state/use-editor-operations.ts` | Editor panel state/open/close operations. |
| `apps/desktop/src/renderer/workbench/{PanelChrome,PdfPageReview}.tsx` | Shared panel controls and PDF page/OCR interaction. |
| `apps/desktop/src/renderer/shell/{ConfirmDialog,ModalDialog,RecoveryDialog,BootGate,EngineStatusBanner}.tsx` | Dialog focus primitives and status baselines. |
| `apps/desktop/src/renderer/surfaces/{CreateProject,Templates,Workbench,QaReview,ExportReview}.tsx` | Form, busy, error, QA, export, and workbench feedback states. |
| `apps/desktop/src/renderer/insights/{InteropReviewPanel,InteropTablePanel,TaskPackagePanel,ReimportDialog,InsightsSectionNav}.tsx` | Interop/task/reimport feedback and stronger navigation baseline. |
| `apps/desktop/src/renderer/styles.css` | Focus, layout, rails, action bars, and compact control CSS. |
| `apps/desktop/src/renderer/tokens.css` | Theme tokens and reduced-motion policy. |

### Verification

| Path | Description |
| --- | --- |
| `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts` | P0 real-Engine flow and serious/critical axe helper. |
| `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts` | P1 lifecycle/search/insights flow and selected viewport overflow checks. |
| `apps/desktop/tests/e2e/p2-editor-assets.spec.ts` | Workbench/Assets axe and horizontal-overflow checks. |
| `apps/desktop/tests/e2e/p3-interop-pdf.spec.ts` | P3 interop/PDF/reimport flow and console guard; no axe helper. |
| `apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts` | P4 surface checks, click-only tab coverage, and selected overflow matrix. |
| `apps/desktop/playwright.config.ts` | Serial Electron Playwright configuration without a shared viewport default. |
| `apps/desktop/src/renderer/shell/RecoveryDialog.test.tsx` | Recovery focus/trap/Escape expectations currently favor primary action. |

## Code patterns

- Surface state is selected centrally in `App.tsx`, while feature operations live in hooks/controllers. Accessibility fixes should stay in presentational components plus shared primitives; do not put DOM focus logic into Engine/state reducers.
- `ConfirmDialog`/`ModalDialog` are reusable focus-management primitives. Extend their contracts only when a new behavior is required, then cover all callers.
- `InsightsSectionNav` demonstrates route navigation semantics (`nav` + `aria-current`) without overloading the tab role. Use it as the comparison point before introducing a new tab abstraction.
- The project already uses semantic `role="status"`/`aria-live="polite"` in BootGate and EngineStatusBanner; normalize other transient states to the same pattern.
- Existing CSS uses tokenized spacing, color, motion, and focus values. Preserve tokens and remove local focus suppression rather than adding component-specific colors or arbitrary timings.

## External references

- WAI-ARIA Authoring Practices 1.2, Tabs pattern: required tab/tabpanel relationships, roving focus, and Arrow/Home/End behavior. Consult the version current at implementation time.
- WAI-ARIA Authoring Practices 1.2, Menu Button pattern: focus placement, menuitem navigation, Escape return to trigger, and `aria-expanded`/`aria-controls`.
- WCAG 2.2 Success Criteria 2.1.1 (Keyboard), 2.4.3 (Focus Order), 2.4.7/2.4.11 (Focus Visible/Not Obscured), 3.3.1/3.3.3 (Error Identification/Error Suggestion), and 4.1.2/4.1.3 (Name, Role, Value/Status Messages).
- `@axe-core/playwright` 4.10.2 and `@playwright/test` 1.61.1 are the versions declared by `apps/desktop/package.json`; Electron is 41.10.3 and React is 19.2.7. Treat automated axe results as one signal, not a replacement for keyboard and screen-reader tests.
- Local UI/UX review guidance (`ui-ux-pro-max`) prioritizes keyboard navigation, visible focus, labeled forms, no horizontal scroll, semantic feedback, reduced motion, and stable interaction targets. These criteria align with the project specs and were used to order recommendations.

## Related specs

- `.trellis/spec/frontend/component-guidelines.md` — semantic HTML, inert collapsed content, focus-visible treatment, Cancel-first recovery/destructive dialogs, concise UI copy.
- `.trellis/spec/frontend/quality-guidelines.md` — keyboard reachability/names, icon `title` + `aria-label`, live status, focus preservation, no filler copy, and test-quality requirements.
- `.trellis/spec/frontend/electron-workbench.md` — Workbench layout, document switcher landmarks, panel composition, and keyboard behavior.
- `.trellis/spec/frontend/editor-assets.md` — editor/PDF/Asset Hub contracts, collapsed-panel focus handoff, no viewport overflow, and destructive actions.
- `.trellis/spec/frontend/project-lifecycle.md` — project row/action naming and lifecycle navigation expectations.
- `.trellis/spec/frontend/interop-pdf.md` — Interop/PDF/reimport state and review surfaces.
- `.trellis/spec/frontend/ai-plugins-settings.md` — P4 destructive-dialog, solid-surface, reduced-motion, and viewport locks.
- `.trellis/spec/frontend/index.md` and `.trellis/spec/guides/index.md` — frontend/spec entry points and cross-cutting guidance.

## Caveats / Not Found

- No product code, spec, test, or git files were modified by this research pass; the only intended write is this report.
- No Electron build, Playwright run, axe execution, screenshot, forced-colors session, 200% zoom session, or manual screen-reader test was run. Findings marked hypothesis require runtime verification.
- The report does not claim that every moderate/minor axe violation currently exists; it identifies that the test helpers would not fail on them.
- Recover-first focus may be a deliberate domain decision because Recover can preserve user work. The conflict with the written Cancel-first rule needs a product decision, not an automatic code change.
- Desktop BrowserWindow minimum dimensions and current test viewports are source evidence, not proof of actual overflow at every state. Long translations, CJK glyphs, Windows DPI scaling, and OS titlebar behavior can change geometry.
- No external web search was needed; standards references are named for implementation follow-up, not quoted as a fresh conformance certification.
- Existing `codebase-history-audit.md` and `history-requirements.md` in the task research directory were read only for context and remain unchanged.
