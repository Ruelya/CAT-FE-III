# Implementation Plan: Complete Plugin Ecosystem

## Foundation baseline

The Tier 3 process-filter foundation is present in commits `7f41b5b`,
`e8f3c49`, `9b7cb1f`, and `4e68481`. It remains regression coverage and is not
treated as completion of P-01..P-10.

## Independently archived child sequence

1. `07-26-plugin-tier3-foundation` (archived): qualify the existing process
   filter foundation with fail-closed duplicate install, typed crash/deadline
   propagation, durable degraded state, SDK dogfood, and real desktop evidence.
2. `07-26-plugin-multitier-runtime` (archived; depends on 1): tier-aware manifest, storage,
   protocol, lifecycle, migration, upgrade, and compatibility.
3. `07-26-plugin-permission-grants` (archived; depends on 2): consent, scoped
   grants, revoke, enforcement, and audit.
4. `07-27-plugin-tier1-declarative` (archived; depends on 2-3): declarative filter/provider/
   regex-QA/pipeline evaluation and examples.
5. `07-27-plugin-tier2-sandbox` (planning; depends on 2-3): bounded JS worker and isolated UI
   panel host.
6. `plugin-engine-connectors` (create after 2-3): P-03/F-12 registry lifecycle,
   SDK, official example, failure isolation, and E2E.
7. `plugin-qa-pipeline-sdk` (create after 4): QA and pipeline contracts,
   registries, examples, and qualification.
8. `plugin-ai-ui-host` (create after 5-6): AI actions and UI contributions with
   permissioned host APIs.
9. `plugin-external-connectors` (create with automation X-07): connector SDK,
   auth scopes, deterministic example, and end-to-end validation.
10. `plugin-management-release` (last): desktop permission/contribution/
   upgrade/diagnostic UX, packaging, public docs, and full lifecycle E2E.

Only the next dependency-ready children are materialized under `.trellis/tasks`;
later names stay in this queue until their predecessors archive.

## Parent validation commands

```powershell
pnpm contracts:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm test:e2e:engine
pnpm test:e2e:desktop
pnpm docs:check
```

Each child adds focused SDK/example/runtime/desktop tests and records exact
commands in its own evidence before commit and archive.

## Parent completion gate

- [ ] All ten child contracts are archived with task-owned evidence.
- [ ] P-01..P-10 map to child acceptance criteria without an MVP exclusion.
- [ ] Existing Tier 3 installs and hello-SRT remain compatible across upgrades.
- [ ] Full repository, Engine, desktop, SDK/example, and plugin E2E gates pass.

## Rollback points

- Each tier host and contribution adapter remains independently capability-
  gated until its child task passes.
- Schema and manifest changes are additive and retain legacy reads until the
  compatibility child proves migration and restart.
- A failed host never removes built-in contributions or rewrites plugin package
  state; disable only the affected plugin version.
