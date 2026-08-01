# Closeout summary: 07-19-platform-packaging-product-shell

## Status

Quality loop **green** (`review/findings-2.md`: `ready_for_closeout: true`, no open issues).  
Head at review: `3e4dd7197e538e93828fbe6763a5fa4ea458a3b9` on branch `task/07-19-platform-packaging-product-shell`.  
Closeout does **not** commit, merge, or archive (Orchestrator owns git / finish-work).

## What shipped

Cross-platform product shell around the existing Engine / protocol / workbench:

| Area | Outcome |
| --- | --- |
| Shell settings + i18n | Main-process settings; typed `en-US`/`zh-CN` catalog; locale IPC/selector |
| Data dir / backup / restore | Main-owned migrate/swap/rollback; one-click backup; staged restore token |
| Engine allowlist | Shared Rust `enforce_project_engine_allowlist`; interactive + batch + pipeline pretranslate deny with `policy_denied` |
| Allowlist UI + errors | Product Settings allowlist; AI surfaces use `formatEngineError` → `error.allowlistDenied` |
| Crash recovery + drafts | Bounded Engine restart; atomic draft journal; stale-revision restore/discard/copy |
| Tutorial + example | First-run overlay; bundled offline example project |
| Updates | UpdateManager + fixture feed; defer/disable; pre-install backup hooks |
| Packaging / CI | electron-builder gates (size/readiness); Windows/macOS package workflows + release docs |
| A11y / governance | axe/keyboard slices; `docs/accessibility-matrix.md`; LICENSE/SECURITY/CODE_OF_CONDUCT/issue templates |

### Uncommitted delta on this branch (quality pass)

Focused allowlist + localization evidence path (post-baseline):

- `crates/engine/src/ai.rs` — interactive/batch/pipeline allowlist tests
- `crates/engine/src/lib.rs` — wire mapping touchpoints as needed
- `apps/desktop/src/renderer/workbench-utils.ts` (+ tests) — `formatEngineError`
- `apps/desktop/src/renderer/AiControlPage.tsx`, `LiveAssistantPanel.tsx` — use `formatEngineError(..., t)`
- `scripts/engine-smoke.mjs` — allowlist stdio block
- Task artifacts: `implement.md`, `review/*`

Baseline product-shell implementation was already on the branch; review treated it as supplied and verified the release-blocking allowlist evidence gate.

## Specs touched (this closeout)

| Path | Why |
| --- | --- |
| `.trellis/spec/backend/engine-boundary.md` | Grounded BYOK AI: shared allowlist helper, wire `policy_denied` data shape, call sites, tests |
| `.trellis/spec/backend/error-handling.md` | Client-facing note: branch on `code`/`data`, not English message |
| `.trellis/spec/frontend/electron-workbench.md` | AI surfaces: `formatEngineError` + catalog; Settings allowlist; packaging/localization residual for `Workbench.tsx` |

No new top-level guide file; indexes unchanged (existing Active files).

## Evidence

- `review/verify-1.md` — mission_status: **satisfied** (Rust allowlist 12/12; desktop workbench-utils/shell focused + full desktop unit suite 175/175)
- `review/findings-2.md` — F1 fixed; no open blocker/major/minor
- Optional stdio smoke did not reach the allowlist assertion (unrelated PDF import failed first); mission treated that path as optional once focused suites were green

## Residual risks (accepted, not quality blockers)

1. **Package CI install** — Native Windows/macOS installer/package install-and-launch smoke, signing/notarization hooks, and platform/minimum-OS evidence remain **CI-runner** proof (`package-windows.yml` / `package-macos.yml`). Local focused verification did not re-run full `pnpm package:win` / `package:mac` install smoke.
2. **Workbench English** — Remaining hard-coded English in `Workbench.tsx` is excluded from the catalog audit (owned by the separate visual task). Product-facing AI `policy_denied` path is localized.
3. **a11y matrix** — Automated axe/keyboard cover Project Home, Settings (incl. Backup/Update), Tutorial at three viewports. Full Workbench/QA/Export axe+keyboard, color-contrast, and native screen-reader remain **manual** per `docs/accessibility-matrix.md`.

## Suggested commit message

**Subject:**

```text
feat(shell): complete packaging product shell and allowlist localization
```

**Body:**

```text
Ship the desktop product shell for Windows/macOS packaging, bilingual catalog,
data-directory migrate/backup/restore, update service, crash/draft recovery,
tutorial/example, accessibility slices, and open-source governance docs.

Enforce project engine_allowlist in the Engine before interactive AI, batch AI,
and pipeline pretranslation with stable policy_denied data. Desktop AI surfaces
map that code through formatEngineError and error.allowlistDenied.

Specs: document allowlist RPC data, shared helper, and product-facing
localization contracts for future AI surfaces.

Residual: native package install smoke is CI evidence; Workbench.tsx English
and full a11y matrix remain follow-ups.

Task: .trellis/tasks/07-19-platform-packaging-product-shell
Review: findings-2 green; verify-1 satisfied
```

## Out of scope for closeout agent

- No git commit / merge / archive
- No new product features
- No task archive (Orchestrator / finish-work policy)
