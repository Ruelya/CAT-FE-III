# Workbench visual polish evidence

Verified on Windows with the production Electron renderer and real Rust
Engine on 2026-07-25.

## Automated gates

- `pnpm lint`: passed (ESLint + Rust clippy).
- `pnpm --filter @translunar/desktop typecheck`: passed.
- `pnpm --filter @translunar/desktop test`: 23 files, 142 tests passed.
- `cargo build -p translunar-engine`: passed.
- `pnpm --filter @translunar/desktop build`: passed.
- `pnpm exec playwright test tests/e2e/workbench.spec.ts --grep "applies the workbench visual polish"`: passed (19.3s).

The focused E2E verifies global and inverse selection, WebKit scrollbar paint,
keyboard-only focus, success flash and auto-clear, real revision-conflict
failure without flash, 1ms reduced-motion animation, dark-mode contrast of at
least 4.5:1 for app chrome/source/status text, and an empty renderer
console/page-error collection.

## Screenshots

- `screenshots/workbench-polish-light-1250x744.png`
- `screenshots/workbench-polish-light-1680x942.png`
- `screenshots/workbench-polish-light-1920x1080.png`
- `screenshots/workbench-polish-dark-1250x744.png`
- `screenshots/workbench-polish-dark-1680x942.png`
- `screenshots/workbench-polish-dark-1920x1080.png`

Electron/Windows DPI produces physical PNG dimensions slightly above the
requested CSS viewport dimensions. Assertions use CSS geometry and numeric
tolerances, per the frontend quality specification.

The full desktop E2E suite is deferred to the main Electron 41 integration
gate so it runs once against the final shared toolchain state.
