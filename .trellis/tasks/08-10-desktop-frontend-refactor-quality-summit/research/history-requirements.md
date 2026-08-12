# Research: Historical frontend requirements

- Query: What frontend requirements, acceptance obligations, design intentions, shipped residuals, and contradictions should inform the desktop frontend refactor quality summit?
- Scope: internal
- Date: 2026-08-10

## Findings

### Authority and interpretation

Use the sources in this order when they disagree:

1. The current `.trellis/spec/frontend/` documents are the strongest source-backed contracts for the current renderer. The frontend spec index explicitly says these documents describe demonstrated repository behavior and must not be used for aspirational rules (`.trellis/spec/frontend/index.md:34`).
2. The archived P0-P4 rebuild and custom-titlebar PRDs define the acceptance intent of the replacement frontend. Their closeout summaries distinguish what shipped from what remained deferred or fixture-gated.
3. The July workbench visual-polish and visual-identity tasks record historical design intent for the pre-P0 renderer. P0 subsequently removed the root `Workbench` monolith, so these requirements are inputs to evaluate, not automatically current contracts.
4. `docs/PRD.md` is the broad product vision (version 2.0, status "pending review"), not a current implementation inventory.
5. `docs/Full PRD gap matrix.md` is explicitly a dated historical baseline and warns that parts are no longer current (`docs/Full PRD gap matrix.md:6`).

An archived task closeout proves that the task met its then-current acceptance process. It does not supersede current source-backed specs or prove that the present release candidate passes manual, native-platform, accessibility, fidelity, or usability qualification.

### Files found

| File | Relevance |
| --- | --- |
| `.trellis/workflow.md` | Defines the Trellis research and evidence workflow used for this investigation. |
| `.trellis/spec/frontend/index.md` | Defines the scope and non-aspirational authority of current frontend specs. |
| `.trellis/spec/frontend/component-guidelines.md` | Current shared component, icon, appearance, motion, and accessibility rules; also contains one appearance-persistence rule that conflicts with P4. |
| `.trellis/spec/frontend/project-lifecycle.md` | Current P1 project/document/template/recycle/search/insights lifecycle contracts. |
| `.trellis/spec/frontend/editor-assets.md` | Current P2 editor mutation and Asset Hub contracts, including the absent TM/TB import UI caveat. |
| `.trellis/spec/frontend/interop-pdf.md` | Current P3 PDF/OCR, interop, task-package, and reimport contracts. |
| `.trellis/spec/frontend/ai-plugins-settings.md` | Current P4 AI, plugins, connectors, collaboration, settings, appearance-v1, and test-evidence contracts. |
| `.trellis/spec/frontend/electron-workbench.md` | Current Electron bridge, platform chrome, drag/no-drag, window-controls, and native-evidence contracts. |
| `docs/PRD.md` | Broad local-first CAT product vision, platform targets, non-functional goals, localization, and outcome targets. |
| `docs/Full PRD gap matrix.md` | Dated historical feature-gap baseline with explicit staleness warnings. |
| `docs/accessibility-matrix.md` | Current accessibility evidence ledger and unverified/manual surfaces. |
| `.trellis/tasks/archive/2026-07/07-21-workbench-visual-polish/prd.md` | Historical paint-only warm-paper visual-polish requirements. |
| `.trellis/tasks/archive/2026-07/07-21-workbench-visual-polish/design.md` | Historical implementation design for visual tokens and effects. |
| `.trellis/tasks/archive/2026-07/07-21-workbench-visual-polish/evidence/README.md` | Historical light/dark, multi-viewport completion evidence. |
| `.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/prd.md` | Historical fonts, states, app-bar, suggestion hierarchy, density, radius, accessibility, and responsive requirements. |
| `.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/design.md` | Historical visual-identity implementation decisions, including Lucide usage. |
| `.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/evidence/wp8-final-check.md` | Final historical evidence and native/manual accessibility residuals. |
| `.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/prd.md` | P0 replacement-shell and S0-S8 workflow acceptance contract. |
| `.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/closeout-summary.md` | P0 shipped scope, verification totals, and accepted result. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p1-project-lifecycle/prd.md` | P1 S9-S16 lifecycle and transition-safety acceptance contract. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p1-project-lifecycle/closeout-summary.md` | P1 shipped scope and verification record. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/prd.md` | P2 editor-operation and six-section Asset Hub acceptance contract. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/closeout-summary.md` | P2 shipped scope and TM/TB import UI omission. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p3-interop-pdf/prd.md` | P3 PDF/OCR, interop, package, and reimport acceptance contract. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p3-interop-pdf/closeout-summary.md` | P3 shipped scope and fixture/native residuals. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/prd.md` | P4 AI, extension, local collaboration, settings, and appearance-v1 acceptance contract. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/closeout-summary.md` | P4 shipped scope and deep fixture-gated residuals. |
| `.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/prd.md` | Cross-platform custom-titlebar acceptance requirements. |
| `.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/design.md` | Platform mapping, preload bridge, drag-region, and test design. |
| `.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/closeout-summary.md` | Shipped titlebar behavior and outstanding native-platform evidence. |
| `.trellis/tasks/07-19-full-prd-release-qualification/task.json` | Shows the overall release-qualification task remains in progress. |
| `.trellis/tasks/07-19-full-prd-release-qualification/evidence/final-report.md` | Frozen 2026-08-02 release-candidate verdict and blocking gates. |
| `.trellis/tasks/07-19-full-prd-release-qualification/evidence/manual/a11y-status.md` | Manual accessibility and native assistive-technology status. |
| `.trellis/tasks/07-19-full-prd-release-qualification/evidence/manual/usability-status.md` | Status of required usability studies. |
| `.trellis/tasks/07-19-full-prd-release-qualification/evidence/fidelity/status.md` | Status of the representative corpus and human 95% fidelity review. |
| `.trellis/tasks/07-19-full-prd-release-qualification/review/BLOCKED.md` | Later blocker reconciliation, including the gates still deferred. |
| `apps/desktop/src/renderer/shell/AppChrome.tsx` | Current Phosphor-based shell and P0-P4 navigation implementation. |
| `apps/desktop/src/renderer/shell/use-window-chrome.ts` | Current renderer titlebar-platform state, including its pre-effect default. |
| `apps/desktop/src/renderer/state/appearance.ts` | Current versioned appearance-v1 persistence implementation. |
| `apps/desktop/src/renderer/tokens.css` | Current typography, radius, color, and density tokens. |
| `apps/desktop/src/main/window-chrome.ts` | Current main-process platform-to-window-chrome mapping. |

### Product-level requirements

The broad product intent is a local-first, asset-centered, plugin-extensible CAT desktop application (`docs/PRD.md:69`, `docs/PRD.md:190`). Projects, translation memories, termbases, language rules, and automation are first-class product assets rather than incidental editor state.

The committed product platforms are Windows and macOS; Linux is not a product target (`docs/PRD.md:101`, `docs/PRD.md:503`). A Linux/other titlebar fallback in current code is defensive runtime behavior, not evidence of a Linux support commitment.

The product-level non-functional obligations include responsive desktop scaling, keyboard operation, accessibility, and performance (`docs/PRD.md:520`). The outcome targets include completing a representative end-to-end job within 30 minutes, a 40% productivity improvement, and at least 95% fidelity (`docs/PRD.md:568`). These are outcome gates and cannot be inferred from unit-test counts.

Launch localization intent is zh-CN and en-US quality (`docs/PRD.md:503`). The historical gap matrix reports hard-coded English and incomplete locale integration (`docs/Full PRD gap matrix.md:871`), while P4 intentionally limited locale acceptance to the shell preference and did not retranslate P0-P3 (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/prd.md:156`). Full dual-locale product quality therefore remains unmatched by the rebuild acceptance scope.

### Historical visual direction before the rebuild

The visual-polish task established a warm paper-like canvas, ink-colored text, rust accents, a five-color brand band, and restrained dot-field motifs (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-polish/prd.md:3`). It was explicitly paint-only: layout geometry, density, and behavior were out of scope (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-polish/prd.md:16`). The accepted effects included branded selection, restrained depth, grain, custom scrollbars, visible focus, confirmation flash, and token cleanup (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-polish/prd.md:36`). Fonts, loading/empty states, and broader spacing/radius/type refactors were deferred (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-polish/prd.md:80`). Evidence covered light and dark themes at 1250x744, 1680x942, and 1920x1080 (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-polish/prd.md:88`).

The follow-up visual-identity task required bundled Space Grotesk, Chivo, Space Mono, and Noto Sans SC, including full offline Simplified Chinese coverage within a 20 MiB font budget (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/prd.md:51`). It specified exactly three loading states and five empty states (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/prd.md:70`), a stronger app-bar identity with global search that remained collision-free at compact widths (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/prd.md:100`), a quiet suggestion hierarchy, truthful preview states, 4/6/8 px radius tiers, and a disciplined spacing scale (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/prd.md:117`). It also carried explicit keyboard, focus, contrast, reduced-motion, and responsive evidence obligations (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/prd.md:176`).

The identity task's final evidence says Windows scope completed, but native macOS checks and manual assistive-technology validation remained for release qualification (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/evidence/wp8-final-check.md:78`). These historical requirements should be treated as a design-quality reference. Their Lucide, font, and radius prescriptions were later replaced or diverged from in the P0-P4 implementation.

### P0: replacement shell and vertical slice

P0 established the governing rebuild rules: the backend engine remains authoritative, visible navigation must not be dead, light is the default theme, advanced actions use the brown/rust accent, surfaces remain solid, Phosphor is the icon system, reduced motion is honored, and copy stays concise (`.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/prd.md:29`).

Its S0-S8 vertical slice covers Welcome, Home, project creation/import, Workbench, QA, Export, recovery, and session return (`.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/prd.md:39`). Durable requirements include save-before-transition, crash/recovery handling, session restoration based on stable identity, IME-safe editing, mutation error handling, and QA/export gates (`.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/prd.md:72`, `.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/prd.md:128`). Accessibility acceptance included keyboard reachability, visible focus, labels/names, contrast, reduced motion, and automated plus manual evidence (`.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/prd.md:160`).

The P0 closeout records the replacement system as shipped with 144 tests (`.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/closeout-summary.md:8`). That test total is task evidence, not current release qualification; the accessibility ledger still leaves several surfaces and native/manual checks open.

### P1: project lifecycle

P1 added multi-document projects, batch import, templates, recycle-bin behavior, project search, insights, an example workflow, and project lifecycle operations as S9-S16 (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p1-project-lifecycle/prd.md:44`). Save-before-transition remains mandatory, while persisted session state stores identity rather than a second copy of mutable project content (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p1-project-lifecycle/prd.md:34`). The current durable lifecycle contract is consolidated in `.trellis/spec/frontend/project-lifecycle.md:164` through `.trellis/spec/frontend/project-lifecycle.md:277`. The closeout records all S9-S16 surfaces as shipped (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p1-project-lifecycle/closeout-summary.md:9`).

### P2: editor and Asset Hub

P2 added editor operations and a six-section Asset Hub (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/prd.md:42`). The core invariants are engine authority, stable IDs, flushing pending editor work before a mutation or transition, and tokenizing asynchronous work so stale results cannot overwrite the current surface (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/prd.md:32`, `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/prd.md:60`). The source-backed mutation contract is now in `.trellis/spec/frontend/editor-assets.md:210` through `.trellis/spec/frontend/editor-assets.md:271`.

TM/TB import UI did not ship because the frontend lacked a trusted dialog filter/bridge for those file types (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/closeout-summary.md:20`). The current spec preserves the omission and explicitly prevents presenting a fake or unsupported import action (`.trellis/spec/frontend/editor-assets.md:292`, `.trellis/spec/frontend/editor-assets.md:492`).

### P3: PDF, OCR, interop, and task packages

P3 introduced the PDF/OCR dock, interop workflows, offline task packages, and reimport (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p3-interop-pdf/prd.md:30`). The source-backed behavior is consolidated in `.trellis/spec/frontend/interop-pdf.md:149` through `.trellis/spec/frontend/interop-pdf.md:216`.

The closeout identifies important evidence limits: real PDF, interop, table, and task-package end-to-end cases remained fixture-gated; reimport was reachable only from Workbench; and optional presentation polish remained (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p3-interop-pdf/closeout-summary.md:82`). These are residuals, not reasons to create dead controls or simulate success.

### P4: AI, extensions, collaboration, settings, and appearance

P4 added real AI flows, plugin and connector management, local collaboration, settings, and appearance-v1 (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/prd.md:3`). It retained the P0 invariants that visible navigation must resolve to a real surface and pending editor work must be flushed before leaving the editor (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/prd.md:20`).

Appearance-v1 has an exact versioned state shape and default contract (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/prd.md:94`). The source-backed P4 contracts are in `.trellis/spec/frontend/ai-plugins-settings.md:250` through `.trellis/spec/frontend/ai-plugins-settings.md:367`, and the current implementation persists that versioned state in `apps/desktop/src/renderer/state/appearance.ts:1`, `apps/desktop/src/renderer/state/appearance.ts:76`, and `apps/desktop/src/renderer/state/appearance.ts:322`.

Deep AI, plugin, and connector scenarios remain fixture-gated. The spec explicitly says those cases are not passing evidence (`.trellis/spec/frontend/ai-plugins-settings.md:447`, `.trellis/spec/frontend/ai-plugins-settings.md:575`), consistent with the P4 closeout residuals (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/closeout-summary.md:93`).

### Custom titlebar

The titlebar contract requires Windows custom window controls, macOS native hidden-inset traffic lights, an explicit Linux/other fallback, correct drag/no-drag regions, and a narrow, secure preload bridge (`.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/prd.md:17`). The current contract is detailed in `.trellis/spec/frontend/electron-workbench.md:403` through `.trellis/spec/frontend/electron-workbench.md:622`; main-process platform mapping is implemented in `apps/desktop/src/main/window-chrome.ts:1` through `apps/desktop/src/main/window-chrome.ts:44`.

The renderer hook initializes the platform state as `custom` before its effect reads the bridge (`apps/desktop/src/renderer/shell/use-window-chrome.ts:17`). That aligns with the closeout's unresolved native evidence for macOS first-frame/geometry behavior; Linux window-manager behavior also remained unproven (`.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/closeout-summary.md:69`).

### Current implementation anchors

`AppChrome` imports Phosphor icons and exposes the real P0-P4 navigation surface (`apps/desktop/src/renderer/shell/AppChrome.tsx:1`, `apps/desktop/src/renderer/shell/AppChrome.tsx:135`). This confirms that the post-P0 icon and shell rules are current.

Current tokens use Segoe/system font stacks and radius values of 6, 10, and 14 px (`apps/desktop/src/renderer/tokens.css:46`, `apps/desktop/src/renderer/tokens.css:54`). Those values demonstrate that the historical bundled-font and 4/6/8 px radius requirements are no longer source-backed implementation contracts.

### Acceptance and verification obligations

The summit should preserve or explicitly replace these cross-cutting obligations:

- **Truthful navigation:** every visible destination or action must have a real implementation; unsupported capabilities stay absent or visibly unavailable.
- **Engine authority:** frontend state may coordinate presentation and identity, but it must not become an alternate source of truth for engine-owned project data.
- **Transition safety:** flush pending edits and save before navigation, lifecycle mutation, document switching, QA, export, or other destructive transitions.
- **Async freshness:** use stable identities and request tokens/epochs so late results cannot update a superseded document or surface.
- **Recovery:** preserve crash recovery, session identity restoration, and explicit failure paths.
- **Input correctness:** keep IME-safe editing and keyboard-first workflows intact.
- **Accessibility:** require semantic names, keyboard reachability, visible focus, contrast, reduced motion, zoom/reflow, and platform/manual assistive-technology evidence where automation cannot prove behavior.
- **Responsive evidence:** test compact and wide desktop viewports, both themes where supported, long localized labels, scaled text, and native titlebar geometry.
- **Real fixtures:** distinguish mocked component coverage from real engine, PDF/OCR, interop, plugin, connector, and task-package end-to-end evidence.
- **Outcome qualification:** do not substitute implementation completion or test totals for the product's usability, productivity, fidelity, accessibility, and native-platform gates.

### Deferred and residual ledger

| Area | Historical/current status | Implication for the summit |
| --- | --- | --- |
| TM/TB import UI | Omitted in P2 because no trusted dialog filter/bridge existed. | Do not expose a fake action; add the bridge and real flow together if adopted. |
| P3 real-file E2E | PDF, interop, table, and task-package cases remained fixture-gated. | Preserve the distinction between mocked coverage and real-file qualification. |
| Reimport entry points | Shipped as Workbench-only. | Treat additional entry points as new scope, not a regression fix. |
| Deep AI/plugin/connector E2E | Fixture-gated and explicitly not pass evidence. | Require real backend/runtime fixtures before claiming release qualification. |
| macOS titlebar | Native geometry and first-frame behavior unproven. | Require native macOS evidence after chrome refactors. |
| Linux titlebar | Fallback exists, but window-manager behavior unproven and Linux is not a product target. | Keep fallback defensive; do not expand product commitments implicitly. |
| Manual accessibility | Native AT, complete keyboard/axe surface coverage, macOS, full contrast, and reduced-motion checks remain incomplete. | Carry these as explicit release gates. |
| Usability | Required studies were not run for the frozen candidate. | P0-P4 completion does not establish the 30-minute or productivity outcomes. |
| Fidelity | Representative corpus and human 95% review were not run. | Do not claim the PRD fidelity target from automated tests alone. |
| Localization | Shell preference shipped, but P0-P3 were not comprehensively retranslated. | Full zh-CN/en-US launch quality remains product-level work. |

The release-qualification task is still `in_progress` (`.trellis/tasks/07-19-full-prd-release-qualification/task.json:1`). Its frozen 2026-08-02 candidate failed overall qualification (`.trellis/tasks/07-19-full-prd-release-qualification/evidence/final-report.md:3`). Manual accessibility/native macOS gates were incomplete (`.trellis/tasks/07-19-full-prd-release-qualification/evidence/manual/a11y-status.md:6`), usability studies were not run (`.trellis/tasks/07-19-full-prd-release-qualification/evidence/manual/usability-status.md:1`), and the representative fidelity corpus/human review was not run (`.trellis/tasks/07-19-full-prd-release-qualification/evidence/fidelity/status.md:6`). A later blocker reconciliation closes or supersedes some earlier blockers, but HB6-HB8 remain deferred (`.trellis/tasks/07-19-full-prd-release-qualification/review/BLOCKED.md:6`).

### Explicit contradictions and resolutions

| Topic | Conflicting sources | Resolution for current work |
| --- | --- | --- |
| Icon system | Visual identity requires Lucide (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/prd.md:130`); P0 and current component rules require Phosphor and forbid new Lucide (`.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/prd.md:63`, `.trellis/spec/frontend/component-guidelines.md:60`). | Phosphor is current. Historical Lucide requirements are superseded. |
| Appearance persistence | `.trellis/spec/frontend/component-guidelines.md:88` still describes fixed P0 appearance and says never use localStorage; P4 and current code require versioned localStorage appearance-v1 (`.trellis/spec/frontend/ai-plugins-settings.md:125`, `apps/desktop/src/renderer/state/appearance.ts:1`). | Current implementation and P4 contract support versioned persistence. The component guideline is live spec drift and must be reconciled explicitly. |
| Typography | Visual identity requires four bundled families with offline Chinese coverage (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/prd.md:51`); current tokens use Segoe/system fonts (`apps/desktop/src/renderer/tokens.css:54`). | Treat bundled fonts as superseded historical design intent unless the summit deliberately re-adopts them with bundle and localization evidence. |
| Radius scale | Visual identity requires 4/6/8 px tiers (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/prd.md:160`); current tokens use 6/10/14 px (`apps/desktop/src/renderer/tokens.css:46`). | Current tokens describe shipped behavior; changing them is a deliberate visual-system decision, not automatic compliance work. |
| Linux platform | Product PRD limits support to Windows/macOS (`docs/PRD.md:101`); titlebar requirements and code include a Linux/other fallback (`.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/prd.md:21`, `apps/desktop/src/main/window-chrome.ts:1`). | Preserve fallback behavior without treating it as a supported-product promise. |
| Localization | Product PRD requires zh-CN/en-US launch quality (`docs/PRD.md:503`); the gap matrix and P4 scope show incomplete translation (`docs/Full PRD gap matrix.md:871`, `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/prd.md:156`). | Record full dual-locale quality as an open product mismatch rather than claiming P4 closed it. |
| Accessibility completion | Archived P0 acceptance asks for axe/keyboard coverage on Welcome, Home, Workbench, QA, and Export; the current matrix leaves Workbench, QA, Export, contrast, native AT, macOS, and reduced-motion work pending (`docs/accessibility-matrix.md:32`). | Archived closeout totals are not present-day release evidence. Carry the current evidence gaps into qualification. |

### External references and versions

No external web references were used. The research is repository-internal so that every conclusion is tied to the checked-out task archives, current source-backed specs, current code, or current evidence ledgers. `docs/PRD.md` identifies itself as version 2.0 and remains in review status; that status is part of why it is interpreted as product intent rather than an implementation contract.

### Related specs

- `.trellis/spec/frontend/index.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/project-lifecycle.md`
- `.trellis/spec/frontend/editor-assets.md`
- `.trellis/spec/frontend/interop-pdf.md`
- `.trellis/spec/frontend/ai-plugins-settings.md`
- `.trellis/spec/frontend/electron-workbench.md`

## Caveats / Not Found

- Git history was not inspected because the Trellis researcher role forbids git operations. This report reconstructs chronology from archived task artifacts and the current tree, so it cannot provide commit-by-commit provenance or prove when removed requirements disappeared.
- The visual-identity PRD cites `docs/stitch/DESIGN.md`, a reference image, and a deviation report as historical visual authorities (`.trellis/tasks/archive/2026-07/07-21-workbench-visual-identity/prd.md:17`), but those cited artifacts were not found in the current `docs/` tree. Their contents could not be independently verified.
- Role-isolated `implement.jsonl` and `check.jsonl` files were intentionally not read. Findings use PRDs, designs, closeouts, review/evidence artifacts, specs, and source code instead.
- Archived closeouts are historical acceptance records, not guarantees about the current renderer or the current release candidate.
- The appearance-persistence conflict is unresolved spec drift: two current frontend specs disagree, while P4 and the implementation align on versioned localStorage.
- Line citations describe the repository as inspected on 2026-08-10 and may move after subsequent edits.
