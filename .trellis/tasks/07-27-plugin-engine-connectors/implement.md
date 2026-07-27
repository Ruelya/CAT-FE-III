# Implementation Plan: Versioned Plugin Engine Connectors

## Preconditions

- [ ] Confirm archived multi-tier, permission, Tier 1, and Tier 2 task evidence
      and load the curated backend/frontend specs plus `research/baseline.md`.
- [ ] Re-read complete current plugin lifecycle, capability authorizer,
      `AiManager`, provider profile/run/batch storage, protocol generation, SDK,
      and Desktop AI/Plugins definitions before editing.
- [ ] Review this final planning set and run `task.py start` only after the main
      session receives implementation approval.

## Ordered Implementation

1. [ ] Define strict connector descriptor/definition/request/event/result/error
       V1 contracts, closed operation enums, limits, validation, and generated
       TypeScript/SDK projections. Keep old skeletal inventory readable but
       incompatible until it supplies the executable V1 contract.
2. [ ] Refactor `ai-core` around a provider-neutral `EngineConnector` adapter
       and owner-aware registry; wrap every current built-in provider first and
       prove unchanged catalog/request/error behavior.
3. [ ] Add an append-only storage migration and protocol source union for exact
       plugin profile bindings, connector config/schema provenance, and
       run/batch/usage connector provenance. Migrate legacy rows to built-in
       sources with byte-for-byte behavioral equality.
4. [ ] Implement Tier 1 declarative connector definitions and bounded host HTTP
       execution; enforce HTTPS/loopback, no redirects, typed mappings, origin
       grants, response/event limits, cancellation, and failure mapping.
5. [ ] Implement Tier 2 sandbox and Tier 3 process connector adapters using the
       same closed codecs/state machine. Add explicit cancel/shutdown, bounded
       queues/frames/output, late-event rejection, generation checks, and safe
       diagnostic mapping.
6. [ ] Integrate connector prepare/attach/detach with reload, enable, disable,
       deny/revoke, degradation, shutdown, uninstall, upgrade, and rollback.
       Make multi-connector attachment atomic and candidate compensation restore
       the exact prior registry/profile/host state.
7. [ ] Route provider catalog/profile CRUD/test, interactive/action execution,
       batch pretranslation, pipeline pretranslation, usage, retry/resume,
       cancellation, settings, and project allowlist through registry lookup.
       Preserve existing built-in behavior and prohibit silent fallback.
8. [ ] Keep credentials Engine/keyring-owned; add operation/origin authorization,
       ephemeral secret delivery/zeroization, secret-free audit/log/events/errors,
       and fatal-host isolation with exact activation degradation.
9. [ ] Extend public SDK builders/validators/server helpers and ship deterministic
       Tier 1 plus executable connector examples backed by a local HTTP fixture.
       Document public contracts, tier trust, permissions, profiles, upgrade,
       and failure behavior using no private imports.
10. [ ] Update Desktop AI catalog/profile forms and Plugins inventory details
        through generated contracts. Add localized unavailable/degraded/config/
        origin states, keyboard-safe errors, focus handling, and responsive
        long-ID layouts without exposing credentials.
11. [ ] Add layered unit/integration/restart/migration/race/security tests, real
        stdio smoke, and production Electron E2E. Map every acceptance criterion
        to commands and retained evidence before the independent check.
12. [ ] Run the complete gate, resolve check findings, update Trellis specs,
        commit only owned files, archive immediately, and update the parent
        progress without rewriting other child plans.

## Test Matrix

- Runtime/SDK: every field/version/size/depth/count bound; closed operations;
  Tier 1 mapping; Tier 2/3 codecs; event ordering; cancellation; redaction.
- Registry/Engine: built-in collision protection; atomic multi-attach; exact
  authorization; restart; detach; old-generation failure; cross-plugin health.
- Storage/protocol: fresh and real legacy migration; profile/run/batch/usage
  round trip; conflict; historical provenance; generated-contract drift.
- AI workflows: provider test; interactive stream; action; pipeline and batch;
  retry-after; resume; project allowlist; cancellation; no partial proposal.
- Failure/security: auth/rate limit/timeout/unavailable/protocol/crash;
  malformed/late/duplicate/oversized events; origin redirect; secret byte scans.
- Lifecycle: upgrade compatible/incompatible schema, new origin/operation review,
  failed candidate compensation, rollback, revoke during work, uninstall.
- Desktop/E2E: install/review/grant/enable/profile/credential/test/use/restart/
  upgrade/rollback/revoke/disable/uninstall; accessibility, localization,
  console/page errors, and 1250x744, 1680x942, 1920x1080 overflow evidence.

## Validation Commands

```powershell
pnpm contracts:check
pnpm --filter @translunar/plugin-sdk test
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm docs:check
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
pnpm test:e2e:engine
pnpm test:e2e:desktop
```

Use deterministic loopback HTTP fixtures; external credentials are never a
release gate. If documented native PDF/OCR prerequisites block the full Engine
E2E, record the exact missing tools and retain the focused real connector stdio
flow, but do not report the skipped suite as passing.

## Review Gates

- [ ] Built-in profile/catalog/request/error/usage behavior is regression-tested
      before plugin adapters are advertised.
- [ ] No secret, prompt, source/target text, package path, stack, or runtime
      handle reaches SQLite, logs, audit, diagnostics, generated errors, or UI.
- [ ] Every public collection/payload/event/timeout has a named limit and a
      boundary test; every operation is a finite enum with a closed codec.
- [ ] Every registry/lifecycle mutation has exact owner/version cleanup and a
      tested compensation path; cancellation wins races without partial apply.
- [ ] Tier 3 trust documentation does not claim OS isolation, and Tier 2 does
      not expose generic network or Engine invocation.
- [ ] Production Electron screenshots are inspected at all required viewports;
      no overlap, clipping, horizontal overflow, console, or page errors remain.

## Risky Files and Rollback Points

- `crates/ai-core`, Engine AI manager, and storage migration: land built-in
  adapters/migration regression tests before switching lookup. Roll back plugin
  advertisement without reverting an applied migration.
- Plugin runtime/Engine lifecycle: prepare adapters inertly and attach only
  after full preflight. A failed candidate must preserve the prior live version.
- Credentials and capability service: authority and redaction are fail-closed;
  do not broaden origins or add a generic credential/list API to pass examples.
- Protocol/generated contracts/Desktop: additive protocol v1 only; regenerate
  outputs and never hand-maintain a renderer mirror.

## Completion Evidence

- [ ] AC-01 through AC-12 map to exact tests, commands, and screenshots in
      task-owned evidence.
- [ ] The final full gate runs after the last production-code change.
- [ ] Spec updates, implementation, evidence, commit, and archive contain no
      unrelated dirty-worktree files.
