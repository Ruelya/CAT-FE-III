# Implementation Plan: Complete Plugin Ecosystem

## Foundation baseline

The Tier 3 process-filter foundation is present in commits `7f41b5b`,
`e8f3c49`, `9b7cb1f`, and `4e68481`. It remains regression coverage and is not
treated as completion of P-01..P-10.

## Independently archived child sequence

All ten implementation children are archived (`status=completed`) with
task-owned evidence. Paths:

| # | Task dir | Archive | Focus |
| --- | --- | --- | --- |
| 1 | `07-26-plugin-tier3-foundation` | `archive/2026-07/` | process filter foundation qualify |
| 2 | `07-26-plugin-multitier-runtime` | `archive/2026-07/` | tier-aware control plane / migration |
| 3 | `07-26-plugin-permission-grants` | `archive/2026-07/` | consent, scopes, audit, enforce |
| 4 | `07-27-plugin-tier1-declarative` | `archive/2026-07/` | Tier 1 declarative hosts |
| 5 | `07-27-plugin-tier2-sandbox` | `archive/2026-07/` | Tier 2 sandbox + UI panel host |
| 6 | `07-27-plugin-engine-connectors` | `archive/2026-07/` | Engine connector SDK (P-03/F-12) |
| 7 | `07-27-plugin-qa-pipeline-sdk` | `archive/2026-07/` | QA + pipeline public contracts |
| 8 | `07-28-plugin-ai-ui-host` | `archive/2026-07/` | AI actions + workbench panels |
| 9 | `07-28-plugin-external-connectors` | `archive/2026-07/` | external connector SDK (X-07) |
| 10 | `07-30-plugin-management-release` | `archive/2026-08/` | desktop UX, `.tlplugin`, bundled catalog |

P-01..P-10 map onto this sequence without an MVP exclusion of a requirement
family. Feature-level AC evidence lives in each child's archive (and
`acceptance-evidence.md` where present), not re-run at parent closeout.

## Parent validation commands

Reference matrix for **release qualification** (not re-executed on this parent
closeout):

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

Each child recorded focused SDK/example/runtime/desktop commands in its own
evidence before commit and archive. Parent closeout does **not** invent green
for the full monorepo matrix.

## Parent completion gate

- [x] All ten child contracts are archived with task-owned evidence.
- [x] P-01..P-10 map to child acceptance criteria without an MVP exclusion.
- [x] Existing Tier 3 installs and hello-SRT remain compatible across upgrades
      (multitier migration + management-release / foundation child evidence;
      not re-proved on the parent branch at closeout).
- [ ] Full repository, Engine, desktop, SDK/example, and plugin E2E gates pass
      on one immutable release candidate.

### Residual ownership (honest)

The unchecked full monorepo / plugin E2E matrix and any workspace-wide clippy
or non-plugin desktop lanes are **not claimed green** by this parent archive.
They move to:

- **`.trellis/tasks/07-19-full-prd-release-qualification`** — WP2 clean quality
  lanes, WP3 plugin-crash isolation at NFR scale, WP5 ecosystem/integration
  developer exercises and permission/crash acceptance.

Child-level residuals carried forward (non-blocking for parent feature archive;
re-audit at release qual):

- Plugins **Versions** dialog / UI rollback / stale-revision recovery Electron E2E
- Reduced-motion not specially tested on Plugins surfaces
- Full workspace clippy / monorepo non-plugin E2E not reclaimed green on last
  management-release candidate

## Rollback points

- Each tier host and contribution adapter remains independently capability-
  gated until its child task passes.
- Schema and manifest changes are additive and retain legacy reads until the
  compatibility child proves migration and restart.
- A failed host never removes built-in contributions or rewrites plugin package
  state; disable only the affected plugin version.
