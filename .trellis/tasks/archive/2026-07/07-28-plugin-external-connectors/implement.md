# Implementation Plan: External System Connector SDK

## Preconditions

- Work from an isolated task branch/worktree based on current `origin/master`.
- Transfer only this task's reviewed planning artifacts; preserve the unrelated
  dirty main worktree.
- Planning-to-execution is approved by default under `codexgoal.md`; after this
  planning set validates, run `task.py start` without another routine approval.
- Load every entry in `implement.jsonl` before editing product code.

## Ordered Implementation

1. **Baseline and contract inventory**
   - Record current plugin/runtime/protocol/storage/SDK/example baselines.
   - Add failing contract tests for strict executable external descriptors,
     operation envelopes, limits, unknown fields, and inventory-only fallback.
   - Confirm no existing external connector methods/tables are silently reused
     as automation jobs or AI engine connector state.

2. **Rust runtime contract and public TypeScript SDK**
   - Add closed descriptor, operations, configuration/credential slots, items,
     receipts, checkpoint, failure, retry, cancellation, and lifecycle types.
   - Add validators/builders and Tier 1 definitions in `plugin-runtime`.
   - Export matching public SDK types/validators plus Tier 2/Tier 3 handler
     helpers; keep credential values out of serializable request types.
   - Preserve inventory parsing for the released skeletal descriptor.

3. **Protocol and generated contracts**
   - Add typed profile/credential/invocation/checkpoint/list/status RPC models,
     method catalog entries, capability advertisement, dispatcher wiring, and
     schema generation.
   - Regenerate `protocol.schema.json` and TypeScript contracts; do not hand-edit
     generated renderer wire types.
   - Add serde casing, unknown-field, method, capability, and drift tests.

4. **Storage and credential persistence**
   - Add a new migration for profiles, immutable bindings, credential presence,
     invocation/idempotency records, and append-only checkpoint history.
   - Implement transaction APIs for profile CAS, idempotency claim/replay,
     successful result + checkpoint atomic finalization, failure recording,
     restart lookup, and checkpoint migration history.
   - Add a dedicated keyring-backed credential store with injectable memory
     backend and slot validation.
   - Test fresh/upgrade migration, constraints, conflict, rollback, restart,
     failed/canceled no-advance, atomicity, and secret absence.

5. **Exact-generation registry and runtime adapters**
   - Implement registry preflight, attach-all, owner replacement, stale lease
     rejection, snapshot, exact detach, cancellation, and shutdown.
   - Implement Tier 1 declarative transport/mapping/signature verification,
     Tier 2 sandbox methods/closed network bridge, and Tier 3 JSON-RPC methods.
   - Map only closed safe failures and bounded retry hints; clear invocation
     credential contexts on every exit path.
   - Add adapter tests for every operation, ordered results, limits, auth,
     malformed output, timeout, cancellation, crash, and post-failure reuse.

6. **Engine service and plugin lifecycle integration**
   - Build registrations from strict descriptors and exact owner tokens.
   - Enforce `external.connector` operation/contribution scopes and
     `network.connect` origins at registration and every operation.
   - Implement profile/credential/invocation methods over Store + registry.
   - Integrate enable/restart/disable/revoke/degrade/upgrade/rollback/uninstall
     with atomic candidate compensation and exact-owner cancellation/detach.
   - Add cross-plugin collision/isolation and ordinary Engine health tests.

7. **Deterministic official fixture and documentation**
   - Add one public-SDK-only fixture with authenticated pull/push/poll/webhook,
     paging, stable idempotency, signed webhook, rate-limit, malformed, delay,
     cancellation, and crash modes.
   - Add build/test scripts and Engine smoke covering install -> review/grant ->
     enable -> profile/credential -> exchange -> restart/replay -> lifecycle
     teardown.
   - Document the public contract, tier behavior, permissions, keyring/redaction,
     checkpoint/idempotency semantics, upgrade/rollback, retry ownership, and
     explicit automation boundary.

8. **Full-scope verification and evidence**
   - Run focused tests after each layer, then the full owned-surface gates below.
   - Scan tracked evidence, logs, SQLite dumps/queries, protocol output, and
     diagnostics for fixture credentials and raw secret markers.
   - Write acceptance mapping and final review evidence under this task.
   - Dispatch Trellis check, fix all findings, rerun affected gates, and only
     then prepare the task-owned commit/PR/archive flow.

## Validation Commands

Run with the repository-supported Node 24 and Rust toolchains:

```powershell
pnpm --filter @translunar/plugin-sdk test
node --test scripts/external-connector-examples.test.mjs
pnpm contracts:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
pnpm test:e2e:engine
pnpm docs:check
```

Run focused desktop/plugin lifecycle E2E only if the implementation changes the
desktop bridge or existing Plugins surface. The later management task owns new
connector management UX.

## Review Gates

- Rust, schema, generated TypeScript, SDK, Engine dispatcher, and every consumer
  agree on the same closed contract.
- No credential value can reach a serializable request, SQLite content, audit,
  safe error, diagnostic, log, or evidence file.
- Registry and checkpoint state are exact-generation and compare-and-swap safe.
- Failure/cancellation never advances a checkpoint or leaves a visible candidate.
- Retry scheduling, jobs, outbox, webhook HTTP ownership, and CAT application
  writes have not leaked into this task.
- Existing engine connector, AI/UI, QA/pipeline, Tier 1/2/3, and ordinary Engine
  regressions stay green.

## Risky Areas and Rollback Points

- **Generated protocol drift:** commit Rust/schema/generated outputs together;
  revert the additive method family as one unit if generation fails.
- **Migration atomicity:** never edit released migrations; test old-schema backup
  and upgrade before lifecycle wiring.
- **Secret leakage:** keep credentials behind non-serializable wrappers and stop
  the task if any fixture secret appears outside the keyring test backend.
- **Partial attachment:** keep the new registry invisible until all hosts and
  bindings pass preflight; compensation must restore the prior generation.
- **Remote mutation ambiguity:** preserve stable idempotency keys across crashes;
  do not claim exactly-once delivery beyond the connector/system contract.
- **Scope creep:** do not add durable automation jobs/outbox or a new management
  UI to make the fixture work.
