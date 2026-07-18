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
  main/preload, renderer RPC orchestration, workbench panels, Vite, or desktop
  tests.
- Search the generated method catalog before adding a preload method or local
  payload type.
- Decide whether state is presentation-only or engine-owned before adding it to
  React.

## Quality Check

- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
  `pnpm test:e2e:desktop`.
- Inspect the 1250x744, 1680x942, and 1920x1080 screenshots for overlap,
  rendering quality, and panel boundary regressions.
- Verify there are no renderer console errors and no exact-pixel assertions
  where Windows DPI can produce fractional CSS pixels.

---

**Language**: All documentation should be written in **English**.
