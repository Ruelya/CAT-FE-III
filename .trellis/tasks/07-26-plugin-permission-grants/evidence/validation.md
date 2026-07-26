# Validation Evidence

## Outcome

All acceptance criteria in `prd.md` are implemented and verified. The final
implementation keeps plugin installation default-deny, persists revisioned
capability decisions and immutable audit evidence, enforces active-version
scope at registration and operation boundaries, and exposes the complete
consent lifecycle through generated contracts, the public SDK, and the desktop
permission review dialog.

## Final Quality Gates

- `pnpm lint`: passed, including ESLint and workspace Clippy with
  `-D warnings`.
- `pnpm typecheck`: passed for contracts, plugin SDK, Electron, renderer, and
  desktop E2E TypeScript projects.
- `pnpm contracts:check`: passed; generated schema and TypeScript contracts are
  current.
- `pnpm format:check`: passed for Prettier and `cargo fmt`.
- `pnpm docs:check`: passed.
- `pnpm test`: passed, including plugin SDK 14/14, desktop 145/145, Engine
  78/78, storage 97/97, and the remaining Rust workspace and doc tests.
- Focused Engine plugin tests: 9/9 passed.
- Migration 19 legacy-grant and immutable-audit test: passed.
- Focused real Engine stdio plugin smoke: passed with
  `TRANSLUNAR_SMOKE_SCOPE=plugin`.
- Full desktop Electron E2E: 29 passed, 1 skipped; the real plugin consent,
  lifecycle, crash-isolation, and visual regression scenarios passed.

## Visual Evidence

The permission dialog was inspected at each supported viewport:

- `screenshots/plugin-permissions-1250x744.png`
- `screenshots/plugin-permissions-1680x942.png`
- `screenshots/plugin-permissions-1920x1080.png`

The dialog remains contained, its checkboxes do not inherit the global
full-width input rule, labels and actions do not overlap, and unsupported
capabilities remain visible with Grant disabled.

## Environment Note

The complete `pnpm test:e2e:engine` suite cannot reach its plugin scenario on
this workstation because the earlier PDF fixture requires `pdfinfo`,
`pdftoppm`, and `tesseract`; only `pdftotext` is installed. This is an external
tooling limitation rather than a plugin failure. The task-specific real Engine
stdio smoke passed, and the full real-Engine Electron suite passed.
