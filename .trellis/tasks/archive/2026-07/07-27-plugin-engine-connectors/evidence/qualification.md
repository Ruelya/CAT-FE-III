# Plugin Engine Connector Qualification

Date: 2026-07-27

## Scope

This evidence qualifies the public connector v1 contract, all three adapter
tiers, unified AI profile/execution paths, lifecycle compensation, generated
SDK/Desktop projections, official examples, and the real stdio/Electron flows.
It does not claim that the unrelated full Engine PDF/OCR path or the complete
Desktop performance suite passed when their documented prerequisites/time
window were unavailable.

## Acceptance Mapping

| AC | Evidence |
| --- | --- |
| AC-01 | `translunar-ai-core` and `translunar-plugin-runtime` codec/bound tests; SDK tests `rejects unknown fields, versions, operations, config, and every request bound`; absolute deadline, stale lease, event/result, and inventory-version regressions. |
| AC-02 | Built-in catalog compatibility test; migration 20 storage tests; exact owner/version catalog availability tests; workspace Rust suite. |
| AC-03 | Exact plugin profile/config/run/batch provenance storage and Engine tests; secret-key rejection and credential redaction tests; real connector fixture asserts the secret is absent from request bodies and UI configuration. |
| AC-04 | Tier 1 declarative, Tier 2 QuickJS, and Tier 3 process adapter tests share the closed contract; origin containment, no-redirect, bounded host/process, credential, cancellation, and recovery tests. |
| AC-05 | Registration and per-call contribution/operation/origin authorization tests; revoke/disable behavior in stdio and Electron; immutable capability audit coverage from the plugin permission suite. |
| AC-06 | Exact-source Engine profile execution/provenance tests plus focused stdio smoke exercise provider test, interactive generation, batch/pipeline plumbing, usage, restart, and project policy through the unified registry. |
| AC-07 | Shared lease tests prove cancellation precedence, stale-lease rejection, streamed/terminal reconciliation, completion hold, event ordering, response limits, and no terminal success after invalid output; adapter crash/timeout/recovery and cross-connector health tests. |
| AC-08 | Restart/disable/revoke/degrade/uninstall tests and real flows prove exact detach/cancel while built-ins, unrelated plugins, profiles, and history remain intact. |
| AC-09 | Atomic multi-profile rebind, compatible upgrade/rollback, origin/operation/schema incompatibility rejection, candidate compensation, and failed-uninstall restoration tests; production Electron flow verifies exact profile owner rebind on upgrade and rollback. |
| AC-10 | `@translunar/plugin-sdk` tests and `scripts/connector-examples.test.mjs` cover public-only imports, success, streaming, usage, authentication, rate limit, malformed response, timeout, and cancellation. |
| AC-11 | Focused real Engine stdio connector smoke completes install through uninstall including permission gates, profile/credential, test/generate, batch/cancel, restart, upgrade/rollback, revoke, explicit disable, and history. Production Electron E2E completes the visible lifecycle including exact upgrade/rollback profile rebind, revoke/re-grant, explicit disable, uninstall, and zero page/console errors. |
| AC-12 | Generated-contract drift, format, lint, typecheck, docs, strict Clippy, workspace tests, focused Engine smoke, Desktop build/typecheck, focused production Electron E2E, and three viewport screenshots are recorded below. |

## Passed Commands

Focused qualification:

```powershell
cargo test -p translunar-ai-core
cargo test -p translunar-plugin-runtime connector
cargo test -p translunar-engine plugin_connector
cargo test -p translunar-engine plugin::tests::connector_upgrade_rebinds_compatible_profiles_and_rollback_restores_owner
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop build
pnpm --filter @translunar/desktop exec playwright test tests/e2e/workbench.spec.ts --grep "uses the official OpenAI-compatible connector through its visible lifecycle" --reporter=line
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
```

Focused results after final connector changes:

- AI core: 21 passed.
- Plugin runtime connector selection: 12 passed.
- Engine connector selection: 9 passed.
- Compatible upgrade/rollback regression: 1 passed.
- Production Electron connector lifecycle: 1 passed in 16.9 seconds.
- Focused plugin-runtime Engine smoke: passed.

Final workspace gate:

```powershell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm contracts:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm docs:check
```

The final execution result is recorded in `implement.md` and the task commit.

## Desktop Viewport Evidence

The production Electron test captures:

- `plugin-connector-profile-reference-1250x744.png`
- `plugin-connector-profile-reference-1680x942.png`
- `plugin-connector-profile-reference-1920x1080.png`

Manual inspection found no plugin-card overlap, clipping, or panel horizontal
overflow. Exact owner/version IDs wrap at 1250px and remain readable. The
project-level tab strip is an intentionally scrollable navigation region at
the narrow viewport; it does not cause the connector panel to overflow.

## Recorded Full-Suite Limits

- `pnpm test:e2e:engine` reaches the pre-existing PDF import path before the
  connector slice and stops because `pdftoppm` and `tesseract` are unavailable
  in this environment (`pdftotext` is present). The focused real connector
  stdio scope is retained as connector release evidence; the full Engine suite
  is not reported as passed.
- A previous full Desktop E2E attempt reached the 10,000-segment performance
  test but the six-minute host timeout ended it without a final Playwright
  status. The focused production Electron connector lifecycle and required
  screenshots pass; the complete Desktop suite is not reported as passed.
