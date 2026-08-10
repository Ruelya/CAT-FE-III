# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory describes the Electron/React desktop boundaries and the
renderer interaction patterns currently used by Translunar CAT.

---

## Guidelines Index

| Guide                                             | Description                                                                   | Status  |
| ------------------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| [Electron Workbench](./electron-workbench.md)     | Main/preload/renderer boundary, state ownership, packaging, and E2E contracts | Active  |
| [Project Lifecycle](./project-lifecycle.md)       | P1 multi-doc, batch import, templates, recycle vs lifecycle, search, feature ops | Active  |
| [Editor & Assets](./editor-assets.md)             | P2 editor ops, command registry/keyboard, Asset Hub domains, curation rollback | Active  |
| [Interop & PDF (P3)](./interop-pdf.md)            | PDF dock/OCR, Insights interop + task packages, reimport, P3 e2e fixtures       | Active  |
| [AI / Plugins / Collab / Settings (P4)](./ai-plugins-settings.md) | AI Control, plugins/connectors, local collab, product settings, appearance-v1 | Active  |
| [Directory Structure](./directory-structure.md)   | Module organization and file layout                                           | Active  |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition                                        | Active  |
| [Hook Guidelines](./hook-guidelines.md)           | Custom hooks, data fetching patterns                                          | Active  |
| [State Management](./state-management.md)         | Local state, global state, server state                                       | Active  |
| [Quality Guidelines](./quality-guidelines.md)     | Code standards, testing, accessibility, and visual checks                     | Active  |
| [Type Safety](./type-safety.md)                   | Generated contracts, narrowing, and TypeScript rules                          | Active  |

---

## Maintenance

The files below are source-backed rules. Update the relevant file when a
verified implementation convention changes; do not add aspirational rules that
the desktop package does not yet enforce.

## Pre-Development Checklist

- Read [Electron Workbench](./electron-workbench.md) before changing Electron
  main/preload, renderer RPC orchestration, workbench panels, Vite, desktop
  tests, or custom title-bar / window-chrome (BrowserWindow frame, drag
  regions, Minimize/Maximize/Close bridge).
- Read [Directory Structure](./directory-structure.md) for the renderer
  layout (`shell/`, `routes/`, `surfaces/`, `workbench/`, `state/`, `lib/`).
  Do not reintroduce the deleted root `Workbench.tsx` monolith.
- For multi-document, batch import, templates, recycle, search, insights, or
  project archive work, read [Project Lifecycle](./project-lifecycle.md).
- For Workbench editor commands/panels, find/replace, undo/history, review
  queue, or Asset Hub (TM/TB/alignment/corpus/catalog/curation), read
  [Editor & Assets](./editor-assets.md).
- For Workbench PDF page review/OCR, Insights interop review/table, offline
  task packages, or document reimport, read
  [Interop & PDF (P3)](./interop-pdf.md).
- For AI Control, Plugins (lifecycle/permissions/actions/panels/connectors),
  project Collaboration, Product Settings (locale/data/backup/restore/updates/
  tutorial), or renderer appearance-v1, read
  [AI / Plugins / Collab / Settings (P4)](./ai-plugins-settings.md).
- Search the generated method catalog before adding a preload method or local
  payload type.
- Decide whether state is presentation-only or engine-owned before adding it to
  React. Drafts/saves go through `SaveCoordinator`; session identity is
  versioned project/document IDs only. Workbench exits use one
  save-before-transition boundary (including document switch, Search, Assets,
  and P4 destinations).
- Feature async domains use independent operation tokens; reconnect invalidates
  them all. Editor mutations use a separate mut/read token pair; Asset Hub uses
  per-domain list + mutation counters; P4 AI/plugin/collab/settings controllers
  use the same generation-scoped ownership pattern. See Project Lifecycle,
  Editor & Assets, and P4.
- New renderer icons: Phosphor (`@phosphor-icons/react`). Appearance: versioned
  `translunar.renderer.appearance.v1` (light default + advanced-brown seed
  `#765847`, optional dark + custom seed); no glass (`backdrop-filter`); never
  store appearance in `ProductShellSettings`. Title-strip chrome uses the same
  solid tokens (no raw black close-active mixes).

## Quality Check

- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
  `pnpm test:e2e:desktop`.
- Confirm no renderer matches for `backdrop-filter` or new `lucide-react`.
- Verify there are no renderer console errors and no exact-pixel assertions
  where Windows DPI can produce fractional CSS pixels.

---

**Language**: All documentation should be written in **English**.
