# Implementation Plan: Public Plugin QA And Pipeline SDK

## Preconditions And Boundaries

- Dependencies `07-27-plugin-tier1-declarative`,
  `07-26-plugin-permission-grants`, `07-26-plugin-multitier-runtime`, and
  `07-27-plugin-tier2-sandbox` are archived and green.
- Read the curated backend/frontend specs and `research/findings.md` before
  editing. Preserve unrelated dirty work and released migrations.
- This child owns QA-rule and pipeline-step public contracts/adapters/examples.
  It does not implement AI actions, external connectors, new automation UX, or
  semantic AI QA.

## 1. Contract And SDK Foundation

- [ ] Replace provisional QA/step `Value` fields with closed versioned Rust
      descriptors, invocation/result/error/config/checkpoint/usage types while
      preserving valid Tier 1 manifest-v2 JSON.
- [ ] Add compatibility/version negotiation and shared payload-budget
      validation to plugin-runtime; add Rust golden/negative/fuzz-style tests.
- [ ] Mirror types, builders, validators, sandbox factories, and process
      handlers in `@translunar/plugin-sdk`; share golden fixtures and prove no
      private Engine imports.
- [ ] Extend Tier 2 operations and Tier 3 handshake/dispatch/cancel codecs for
      QA evaluate and pipeline execute/resume with sanitized typed failures.

## 2. Engine Registries And Lifecycle

- [ ] Add owner/generation-aware QA registry and plugin pipeline owner/adapters;
      keep built-in registrations reserved and deterministic.
- [ ] Generalize prepared activation across declarative/sandbox/process QA and
      pipeline contributions with exact registration grants, collision
      preflight, all-or-nothing attach, reverse detach, and host cleanup.
- [ ] Route enable/restart/disable/uninstall/revoke/deny/stale activation and
      host-invalidating failure through generation-safe attach/detach.
- [ ] Integrate candidate upgrade/rollback preparation, grant carry/fresh
      consent, version pinning, injected attach failure compensation, and
      degraded fallback without disturbing other owners.

## 3. QA Execution And Persistence

- [ ] Replace private appended-regex flow with a snapshot of tier-neutral QA
      executors while retaining Tier 1 behavior and current profile selection.
- [ ] Build bounded segment inputs; enforce exact per-call grants, deadlines,
      cancellation, deterministic ordering, candidate/span/evidence validation,
      activation lease recheck, and fail-atomic reconciliation.
- [ ] Persist plugin rule-set provenance/status/usage/failure with QA runs/items;
      incorporate it into snapshot hashes, reports, waivers/reopen, live QA,
      project/document runs, and export gates.
- [ ] Add QA-core/storage/Engine tests for deterministic fixtures, Unicode,
      invalid/oversized findings, revoke/cancel/timeout/crash, no partial commit,
      restart, and historical provenance after detach/upgrade/uninstall.

## 4. Pipeline Execution And Persistence

- [ ] Add public config-schema validation at definition creation/execution and
      adapters for Tier 1 transforms, sandbox steps, and process steps using
      existing artifact compatibility.
- [ ] Bridge Engine cancellation/deadlines to each host; validate and
      canonicalize output/checkpoint/usage; preserve cancellation race wins and
      isolate timeout/crash/protocol/resource failures.
- [ ] Persist plugin/version/contribution/activation and descriptor/config/
      checkpoint schema versions plus hashes, usage and bounded failure on step
      runs, with backward-compatible built-in rows.
- [ ] Implement immutable-version resume and explicit checkpoint compatibility/
      migration; test restart, missing/incompatible handlers, late results,
      upgrade pinning, cancel grace/kill, and subsequent Engine health.

## 5. Protocol, Desktop, Examples, And Documentation

- [ ] Add additive Engine inventory/history projections and capabilities,
      regenerate protocol schema/TypeScript, and extend stdio smoke.
- [ ] Extend Plugins inventory, QA run/finding details, and pipeline step/run
      history to show authoritative owner/tier/version/state/grant/provenance/
      bounded failure through generated contracts only.
- [ ] Ship public-SDK deterministic QA and resumable pipeline examples plus a
      Tier 2 executable fixture; include fixtures, package validation, docs,
      security/limit/cancel/upgrade guidance, and normal lifecycle commands.
- [ ] Add desktop unit and real-Engine E2E for install/consent/enable/run,
      cancel/resume/restart, revoke/degraded, upgrade/rollback/disable/uninstall;
      capture and inspect 1250x744, 1680x942, and 1920x1080.

## 6. Full Qualification And Finish

- [ ] Map AC-01..AC-10 to focused tests, smoke, E2E, screenshots, and exact
      command output in task evidence; verify logs/history contain no payloads,
      credentials, stderr, or document text.
- [ ] Run scoped gates after each layer, then the complete commands below.
- [ ] Run independent Codex check against PRD/specs, fix verified findings, and
      repeat affected gates until green.
- [ ] Update source-backed specs for the verified public QA/pipeline patterns,
      commit only owned changes, finish, and archive this child before advancing
      the parent.

## Validation Commands

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm contracts:check
pnpm docs:check
pnpm test
pnpm --filter @translunar/plugin-sdk test
pnpm --filter @translunar/desktop build
```

```powershell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm test:e2e:engine
pnpm test:e2e:desktop
```

Focused implementation should additionally run targeted `cargo test -p`
commands for `translunar-plugin-runtime`, `translunar-qa-core`,
`translunar-pipeline`, `translunar-storage`, and `translunar-engine`, plus the
QA/pipeline Electron spec before the full suites.

## High-Risk Files And Rollback Points

- Manifest/SDK/protocol shapes must change together; golden fixtures and
  `contracts:check` are the drift gate.
- QA reconciliation is transactional. A plugin failure or stale activation
  must not persist a partial run/candidate batch or reuse an old waiver under a
  new provenance key.
- Pipeline completion must recheck both cancellation and activation generation
  before publishing output/checkpoint. Late host responses are discarded.
- Upgrade/rollback preflight occurs before registry mutation. Compensation
  matches full owner generation and never unregisters another plugin or newer
  activation.
- New persistence is additive and historical. Restore the automatic
  pre-migration backup for schema rollback; never edit released migrations or
  historical run payloads in place.

## Planning Completion Gate

- [x] Parent R10, P-04/H-12, and P-05 mapped to testable child requirements.
- [x] Existing Tier 1, QA, pipeline, SDK, permission, and host boundaries
      researched with complete symbol definitions.
- [x] Product choices resolved conservatively; no blocking open question.
- [x] `prd.md`, `design.md`, `implement.md`, and real implement/check JSONL
      contexts prepared.
- [ ] Main session presents the final planning summary and obtains fresh user
      approval before `task.py start` or implementation.
