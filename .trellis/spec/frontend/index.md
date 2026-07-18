# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide                                             | Description                                                                   | Status  |
| ------------------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| [Electron Workbench](./electron-workbench.md)     | Main/preload/renderer boundary, state ownership, packaging, and E2E contracts | Active  |
| [Directory Structure](./directory-structure.md)   | Module organization and file layout                                           | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition                                        | To fill |
| [Hook Guidelines](./hook-guidelines.md)           | Custom hooks, data fetching patterns                                          | To fill |
| [State Management](./state-management.md)         | Local state, global state, server state                                       | To fill |
| [Quality Guidelines](./quality-guidelines.md)     | Code standards, forbidden patterns                                            | To fill |
| [Type Safety](./type-safety.md)                   | Type patterns, validation                                                     | To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

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
- Inspect the 1250x744 and 1680x942 screenshots for overlap and panel boundary
  regressions.
- Verify there are no renderer console errors and no exact-pixel assertions
  where Windows DPI can produce fractional CSS pixels.

---

**Language**: All documentation should be written in **English**.
