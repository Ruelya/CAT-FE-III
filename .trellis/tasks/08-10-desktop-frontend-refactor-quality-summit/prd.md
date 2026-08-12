# Desktop frontend refactor quality summit

## Goal

Complete the current Electron renderer rebuild as a coherent, release-grade CAT
desktop product. The finished frontend must preserve every shipped P0-P4
workflow while raising visual hierarchy, interaction feedback, accessibility,
compact-desktop resilience, performance, and verification evidence to a single
professional standard.

This parent task is a planning and integration program. Product implementation
belongs to the child tasks listed below; the parent owns scope, ordering,
cross-child invariants, and final completion evidence.

## Confirmed baseline

- The authoritative renderer is the React 19 application under
  `apps/desktop/src/renderer/`, composed by `App.tsx` from `shell/`, `surfaces/`,
  `workbench/`, `insights/`, `state/`, and `lib/`.
- P0-P4 workflow tasks and the custom title bar are merged on
  `refactor/frontend-3`; their archived PRDs and frontend specs remain the
  behavioral source of truth.
- Engine/domain state remains Rust-owned. The renderer owns only presentation,
  transient interaction state, and the existing versioned appearance/session
  preferences.
- `tokens.css` currently implements the solid light/dark advanced-brown palette,
  while bundled Space Grotesk, Chivo, Space Mono, and Noto Sans SC assets already
  exist but are not the active token font stack.
- Component styling is centralized in `styles.css`; all child implementation
  tasks that touch this file must run serially to avoid visual and merge drift.
- Existing desktop acceptance suites cover P0-P4 and title-bar behavior with a
  real Engine. Their behavior must remain green throughout the visual refactor.
- The generic `ui-ux-pro-max` recommendation was evaluated at variance 6,
  motion 4, and density 8. Its density, focus, contrast, restrained motion, and
  responsive guidance are retained. Its Inter, pink accent, glass, dark-primary,
  marketing-hero, and mobile haptic recommendations conflict with project
  contracts and are rejected.

## Design direction

Read this as a professional translation desktop workbench for long sessions:
quiet editorial structure, warm paper and ink, advanced-brown interaction,
precise industrial controls, high information density, and selective brand
geometry. It must feel authored and unmistakably Translunar without becoming a
marketing site, a glass dashboard, or a decorative card collection.

Design dials:

| Dial | Value | Meaning |
| --- | ---: | --- |
| Variance | 6/10 | Deliberate asymmetry and hierarchy within predictable desktop workflows |
| Motion | 4/10 | Fast causal feedback; no ambient or decorative motion |
| Density | 8/10 | Scan-friendly professional density with stable hit targets and readable type |

## Program task map

| Order | Child task | Independently verifiable outcome |
| ---: | --- | --- |
| 1 | `08-10-desktop-visual-foundation` | Typography, tokens, primitives, light/dark foundation |
| 2 | `08-10-desktop-shell-navigation-system-states` | Custom chrome, navigation, boot/reconnect/recovery/dialog system |
| 3 | `08-10-desktop-project-lifecycle-workflow-surfaces` | Welcome through project lifecycle, Search, QA, and Export surfaces |
| 4 | `08-10-desktop-workbench-editor-experience` | Core segment editor, commands, TM, PDF/OCR, and reimport experience |
| 5 | `08-10-desktop-insights-assets-experience` | Insights, interop/task packages, and Asset Hub workspace |
| 6 | `08-10-desktop-p4-experience` | AI, Plugins, Collaboration, and Settings experience |
| 7 | `08-10-desktop-accessibility-responsive-state-audit` | Cross-surface a11y, zoom, compact layout, and state completeness |
| 8 | `08-10-desktop-renderer-performance-delivery` | Startup, bundle, font, rendering, and production asset budgets |
| 9 | `08-10-desktop-visual-release-qualification` | Final screenshot, axe, console, interaction, and full quality evidence |

## Requirements

### R1 - Preserve product behavior and ownership

- Keep all P0-P4 Engine method sequences, save-before-navigation boundaries,
  IME guards, stale-operation protection, session identity, permission/security
  contracts, and custom-window behavior unchanged unless an implementation task
  proves a defect against the current spec.
- Do not add renderer-owned domain rules, duplicate contracts, optimistic counts
  or revisions, filesystem parsing, a URL router, or a global state library.
- Visual work must reuse the existing React/Vite/vanilla-CSS stack and Phosphor
  dependency. A framework or design-system migration is out of scope.

### R2 - One visual system

- Continue the existing warm paper/ink identity, advanced-brown interactive
  accent, five-color brand ribbon, solid surfaces, and light-default paint.
- Use locally bundled Space Grotesk for display, Chivo for interface/body,
  Space Mono for metadata, and Noto Sans SC for CJK/editor content with safe
  fallbacks and `font-display` behavior.
- Converge spacing, typography, radii, borders, elevation, focus, motion, and
  z-index into semantic tokens. Rectangular UI follows the approved 4/6/8
  radius hierarchy unless a documented geometry exception requires a circle or
  square.
- Dark theme and custom accent seed remain token-derived and visually equal in
  quality; semantic success/warning/error colors stay independent of the seed.
- No `backdrop-filter`, glass material, AI-purple/pink accent drift, new Lucide
  import, hand-drawn icon path, emoji structural icon, nested decorative card,
  or arbitrary inline layout style may be introduced.

### R3 - Operational information architecture

- Keep the Workbench visually dominant and densest. Secondary surfaces use
  compact lists, tables, forms, and unframed sections rather than marketing
  bento layouts.
- Chrome exposes only valid destinations for the current context, provides a
  clear current-location state, and keeps title-bar drag/no-drag and platform
  window controls intact.
- Each surface has one clear primary action. Secondary and destructive actions
  are visually subordinate and retain semantic labels, confirmations, and
  keyboard access.

### R4 - Copy discipline

- Product copy is concise, functional, and domain-accurate.
- Do not add descriptive subtitles, explanatory filler, guiding microcopy,
  future-feature copy, or contrast constructions using the Chinese word
  `not` (`\u4e0d\u662f`).
- Labels, errors, empty states, and statuses may state the fact and available
  recovery action; they must not become feature narration.

### R5 - Complete interaction states

- Every asynchronous user action has an explicit pending state, duplicate
  guard, settled success where needed, typed error, cancellation behavior, and
  recovery path.
- Loading skeletons match settled geometry. Empty states are bounded,
  intentional, and expose only a real action. Error states remain close to the
  affected control and preserve user input/context.
- Hover, pressed, selected, disabled, current, and focus-visible states are
  distinct without changing layout bounds. Motion expresses cause and effect,
  uses transform/opacity where animated, and is removed under reduced motion.

### R6 - Accessibility and compact desktop resilience

- Meet WCAG 2.2 AA for text, focus, controls, status communication, dialog
  behavior, reading order, and non-color-only meaning in both themes.
- Preserve complete keyboard workflows, CJK IME behavior, programmatic labels,
  safe focus restoration, and modal focus containment.
- Remain usable at 1250x744, 1680x942, and 1920x1080, plus 125% text scaling.
  No document-level horizontal overflow, overlap, clipped controls, unreadable
  truncation, or hidden primary action is allowed.
- Dense desktop targets must remain at least 32x32 CSS pixels, with larger
  targets for primary/destructive actions and touch-capable contexts.

### R7 - Performance and delivery

- Measure the current startup, renderer bundle, font payload, route cost,
  interaction latency, and layout stability before choosing optimizations.
- Split heavy feature surfaces when it reduces initial renderer cost without
  breaking Electron production loading, error recovery, or test determinism.
- Preserve segment-grid virtualization and keep interaction work within a
  16 ms frame budget for ordinary scrolling/editing on the supported desktop
  hardware baseline.
- Production output must keep Vite relative assets, local fonts, preload/main
  output, and Electron packaging paths valid.

### R8 - Evidence-driven completion

- Each child task must define focused unit/integration/E2E checks and capture
  visual evidence for the surfaces it owns before closeout.
- Final qualification must exercise all route families, both themes, all three
  supported viewports, 125% scaling, reduced motion, keyboard navigation,
  axe, renderer console/page errors, build output, and real-Engine workflows.
- A fixture-gated skipped path is recorded as residual risk and never counted as
  pass evidence.

## Cross-child acceptance criteria

- [ ] AC1: All nine child tasks have approved planning artifacts and explicit
      dependencies, then complete in the recorded order without behavior loss.
- [ ] AC2: P0-P4 and title-bar user workflows retain their Engine calls,
      guards, focus/IME semantics, session safety, and security boundaries.
- [ ] AC3: Every renderer surface uses one coherent Translunar design system in
      light and dark themes, with bundled typography and no glass/Lucide drift.
- [ ] AC4: All visible copy is concise and functional; no new descriptive
      subtitle, guiding microcopy, placeholder feature, or prohibited contrast
      construction remains.
- [ ] AC5: All route families expose complete loading, empty, error, pending,
      cancellation, current, focus, and disabled states without layout shift.
- [ ] AC6: The full desktop UI is keyboard-operable, WCAG AA, reduced-motion
      aware, CJK/IME-safe, and visually intact at the required viewports and
      125% scaling.
- [ ] AC7: Initial renderer delivery and dense Workbench interaction meet the
      measured performance budgets defined by the performance child task.
- [ ] AC8: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build:desktop`,
      static material/icon audits, and `pnpm test:e2e:desktop` pass on the
      supported Node lane.
- [ ] AC9: Named visual evidence covers every owned surface/state with zero
      unexpected renderer console/page errors, overlap, clipping, or viewport
      overflow.

## Out of scope

- New Engine methods, backend/domain features, data migrations, or generated
  protocol changes unless a child proves an existing frontend blocker and
  returns to planning.
- A public landing page, marketing copy, mobile app, new illustration language,
  3D scene, ambient animation, or brand redesign.
- Replacing React, Vite, Electron, vanilla CSS, the existing controller model,
  or the Phosphor icon family.
- Claiming fixture-gated AI/plugin/interop scenarios as verified when fixtures
  are absent.

## Blocking questions

None. The user selected continuation of the existing frontend style, the
repository defines the behavior and brand constraints, and this planning turn
is explicitly limited to creating tasks rather than starting implementation.
