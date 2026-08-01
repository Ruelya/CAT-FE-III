# Closeout Summary: 07-30-plugin-management-release

## What shipped

Final P1 child for public plugin management and release qualification:

- Closed `.tlplugin` ZIP materializer with adversarial extraction guards and
  directory/archive canonical hash parity (`crates/plugin-runtime`).
- Host-derived provenance (`localDirectory` | `localArchive` | `bundled`) with
  shared `classify_source_kind` on inspect/install/upgrade; migration 24
  distribution/provenance columns.
- Offline release-bundled catalog: allowlist packager, deterministic archives +
  index, Engine `--bundled-plugin-root`, `plugin.bundled.list` /
  `plugin.bundled.apply`, fail-closed catalog degradation.
- Desktop management UX: directory/`.tlplugin` picker, inspect-before-mutate,
  bundled band, source/license/hash/diagnostic projections, upgrade/history/
  rollback commands, EN+zh-CN, permission-review authority preserved.
- Qualification: focused Rust/TS tests, plugin Engine smoke extensions, fresh
  Electron E2E matrix (bundled Path A + local archive Path B after F7/F8),
  public docs, acceptance evidence with residual honesty.

Quality loop: **findings-5 ready_for_closeout** — 0 open blocker/major/minor.

## Spec updates (durable contracts)

| Path | Change |
| --- | --- |
| `.trellis/spec/backend/engine-boundary.md` | New section **Plugin Package Archive, Bundled Catalog, And Provenance** (7-section code-spec: signatures, classify consistency, validation matrix, wrong/correct) |
| `.trellis/spec/backend/database-guidelines.md` | Migration 24 provenance/`distribution_json` contract under plugin storage |
| `.trellis/spec/frontend/electron-workbench.md` | Plugins Panel extended: inspect-before-mutate, bundled RPC, no path leak, Path B fixture outside catalog root |

## Task artifacts touched at closeout

- `implement.md` — §6 E2E/smoke checkboxes closed; residual non-blockers listed
- `acceptance-evidence.md` — quality-loop evidence + honest residuals
- `closeout-summary.md` — this file
- `review/findings-*.md`, `review/verify-*.md` — already present (untracked until commit)

## Areas of product change (for commit scope)

```text
crates/plugin-runtime/          package_archive, source kinds, distribution
crates/engine/                  plugin.rs, plugin_bundled.rs, CLI bundled root
crates/storage/                 migration 24, plugin store projections
crates/protocol/ + packages/contracts/  (in feat commit) bundled RPCs
scripts/package-plugins.mjs     deterministic pack/check
scripts/engine-smoke.mjs        archive + bundled smoke
scripts/plugin-core-allowlist.json
apps/desktop/resources/plugins/ index + 5 .tlplugin + evidence-manifest
apps/desktop/src/main/          picker, --bundled-plugin-root
apps/desktop/src/renderer/      PluginsPanel UX/i18n/css
apps/desktop/tests/e2e/         inspect, bundled Path A, local archive Path B
examples/plugins/*/             LICENSE + distribution metadata
docs/plugins/README.md
.trellis/tasks/07-30-plugin-management-release/
.trellis/spec/backend|frontend  (closeout contracts)
```

**Do not stage** unrelated leftover screenshot trees under
`07-26-plugin-permission-grants/`, `07-26-plugin-tier3-foundation/`,
`07-27-plugin-tier2-sandbox/`, `07-28-plugin-ai-ui-host/` unless intentionally
re-homing evidence.

## Residual risks (from findings-5)

1. No dedicated Electron E2E for Plugins **Versions** dialog / history list /
   UI rollback (Engine + other surfaces cover RPC paths).
2. No dedicated Plugins **stale-revision** recovery E2E.
3. **Reduced-motion** not specially tested.
4. Full seven-case Electron matrix not re-run after F7/F8 focused fix
   (optional confidence; not a green-gate gap).
5. Full workspace clippy / non-plugin monorepo E2E not claimed green.
6. Worktree still dirty until Orchestrator commits task-scoped files only.

## Parent follow-up: `07-19-plugin-runtime-sdk`

| Question | Answer |
| --- | --- |
| Is this the last listed P1 management/release child? | Yes — parent implement queue item 10 / children include this task as final management-release |
| Can parent be closed immediately after this archives? | **Not automatically.** Parent remains `in_progress`. After this child archives, Orchestrator should run a **parent completion gate** against parent PRD (P-01..P-10 mapping, all children archived, full repo/desktop gates honesty). |
| Known parent list gaps | Parent `children` array may not list every historically archived sibling (e.g. AI UI host / external connectors archived separately); reconcile children + archive inventory before parent close. |
| Residuals to carry into parent evidence | Versions UI E2E, plugin stale-revision E2E, reduced-motion, full clippy/workspace if still red baselines — record as residual, do not invent green. |

**Recommendation:** After merge of this branch, treat parent as **eligible for closeout planning / evidence reconciliation**, not auto-complete.

## Suggested commit message

**Subject:**

```text
feat(plugins): ship management release packaging, catalog, and desktop UX
```

**Body:**

```text
Complete P-10 local plugin distribution and offline bundled-core management.

- Add closed .tlplugin materialization, migration-24 provenance, and Engine
  bundled catalog/apply with host-derived source classification.
- Ship deterministic core packaging, desktop inspect/bundled/lifecycle UX,
  plugin smoke and fresh Electron E2E (including local-archive Path B).
- Document residual non-blocking E2E gaps; capture durable contracts in
  engine-boundary, database-guidelines, and electron-workbench specs.

Task: .trellis/tasks/07-30-plugin-management-release
Branch: task/07-28-plugin-management-release
Quality: findings-5 green (0 open blocker/major)
```

## Orchestrator next steps (not done by closeout)

1. Stage **task-scoped** product + task + spec files only.
2. Commit with suggested message (or split if preferred).
3. Merge branch into `main` / `master` per project policy.
4. Archive task via `task.py` / finish-work policy after merge.
5. Consider parent `07-19-plugin-runtime-sdk` closeout reconciliation.
