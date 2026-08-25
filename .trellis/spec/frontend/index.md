# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory describes the Electron/React desktop boundaries and the
renderer interaction patterns currently used by Translunar CAT.

---

## Guidelines Index

| Guide                                             | Description                                                                   | Status                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| [Design Language](./design-language.md)           | Design principles; token values and script gates are pre-greenfield           | See greenfield status note   |
| [Electron Workbench](./electron-workbench.md)     | Main/preload/renderer boundary, state ownership, packaging, and E2E contracts | Historical (pre-greenfield)  |
| [Project Lifecycle](./project-lifecycle.md)       | P1 multi-doc, batch import, templates, recycle vs lifecycle, search, feature ops | Historical (pre-greenfield)  |
| [Editor & Assets](./editor-assets.md)             | P2 editor ops, command registry/keyboard, Asset Hub domains, curation rollback | Historical (pre-greenfield)  |
| [Interop & PDF (P3)](./interop-pdf.md)            | PDF dock/OCR, Insights interop + task packages, reimport, P3 e2e fixtures       | Historical (pre-greenfield)  |
| [AI / Plugins / Collab / Settings (P4)](./ai-plugins-settings.md) | AI Control, plugins/connectors, local collab, product settings, appearance-v1 | Historical (pre-greenfield)  |
| [Directory Structure](./directory-structure.md)   | Module organization and file layout                                           | Historical (pre-greenfield)  |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition                                        | Active (see greenfield note) |
| [Hook Guidelines](./hook-guidelines.md)           | Custom hooks, data fetching patterns                                          | Active (see greenfield note) |
| [State Management](./state-management.md)         | Local state, global state, server state                                       | Active (see greenfield note) |
| [Quality Guidelines](./quality-guidelines.md)     | Code standards, testing, accessibility, and visual checks                     | Historical (pre-greenfield)  |
| [Type Safety](./type-safety.md)                   | Generated contracts, narrowing, and TypeScript rules                          | Active (see greenfield note) |

---

## Maintenance

The files below are source-backed rules. Update the relevant file when a
verified implementation convention changes; do not add aspirational rules that
the desktop package does not yet enforce.

## Pre-Development Checklist

- Read `docs/architecture.md` for the current renderer boundary: `views/` +
  `components/` with the RPC seam in `lib/engine.ts`, tokens in
  `packages/ui/src/tokens.css`.
- Read the greenfield status note in [Design Language](./design-language.md)
  before any change that renders visible UI: the interaction principles bind
  new work; the concrete token values there are pre-greenfield.
- Search the generated method catalog (`@translunar/contracts`) before adding
  a preload method or local payload type.
- Decide whether state is presentation-only or engine-owned before adding it
  to React. The engine is authoritative for projects, documents, segments,
  TM, terms, and QA; a successful RPC response replaces the affected object.
- The historical P1–P4 guides describe removed surfaces; consult them only as
  design records when reintroducing a comparable feature.

## Quality Check

- Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm contracts:check`, and `pnpm test:e2e:desktop` (the same gates as
  `.github/workflows/ci.yml`).
- On Linux, wrap the Electron suite in `./scripts/linux-display.sh` when no
  `DISPLAY` is available.
- Verify there are no renderer console errors and no exact-pixel assertions
  where Windows DPI can produce fractional CSS pixels.

---

**Language**: All documentation should be written in **English**.
