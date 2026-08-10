# Closeout summary — Frontend rebuild P1 project lifecycle

**Task:** `.trellis/tasks/08-10-frontend-rebuild-p1-project-lifecycle`  
**Branch:** `task/08-10-frontend-rebuild-p1-project-lifecycle`  
**Base:** `refactor/frontend-3`  
**Review verdict:** `green_for_closeout` (`review/findings-3.md`)  
**Date:** 2026-08-10

## What shipped

P1 extends the P0 Workbench-first Electron renderer with a coherent project-lifecycle and discoverability slice. Engine remains authoritative; React owns transient interaction state only. Session-v1 stays identity-only. No main/preload product change was required.

| ID | Capability | Outcome |
| --- | --- | --- |
| S9 | Document switcher | Engine-ordered project documents in Workbench; flush before switch; hydrate then session commit; stable `document-switcher` / `document-switcher-select` landmarks |
| S10 | Multi-file import | `selectSourceDocuments` → one `project.batchImport` (`bestEffort`, `{ path }` items); cancel = empty array; mixed diagnostics; Workbench add-files retains active doc |
| S11 | Templates | List/get/create/update/delete + create-from-template; unknown-preserving definition merge; built-in read/use only; Import without premature session |
| S12 | Recycle | `recycle.delete` / list / restore / purge with distinct confirms; post-delete document routing; exclusion from Home/default search |
| S13 | Global search | `search.global` with `includeRecycled: false`; save-before-nav from Workbench; hit classification + authoritative hydrate |
| S14 | Insights | Compact `project.analytics.get` projection; unavailable metrics not zeroed; no bento / no `analysis.*` |
| S15 | Example project | `openExampleProject` candidate IDs validated via Engine before session/Workbench |
| S16 | Project lifecycle | Active/archived Home filters; `project.update`; archive/unarchive via `setLifecycle` only (`active`/`archived`); recycle is a separate path |

### Primary code areas

- Surfaces: `Templates`, `RecycleBin`, `GlobalSearch`, `ProjectInsights`; extended `ProjectHome`, `ImportDocument`, `Workbench`, `Welcome`
- Workbench: `DocumentSwitcher`, `BatchImportSummary`
- Shell: `ConfirmDialog`, `ModalDialog`; extended `AppChrome`
- State: `document-navigation`, `template-definition`, `search-navigation`, `analytics-view`; extended `app-state`, `use-app-controller`
- Tests: `App.p1.integration.test.tsx`, helper unit tests, `tests/e2e/p1-project-lifecycle.spec.ts`; P0 E2E Open selector hardened
- Fake: extended `test/fake-desktop-api.ts` for P1 methods

### Quality evidence (findings-3 / verify-2)

- Desktop typecheck, 188 renderer unit/integration tests, touched ESLint/Prettier green
- Production desktop + Engine build green
- Real-Engine Playwright focused matrix **5/5** (P0 + P1 lifecycle paths, including S9–S10, restore/purge/exclusion, S15 identity + relaunch)
- No open blocker / major / minor issues

## Specs touched (this closeout)

| Path | Why |
| --- | --- |
| `.trellis/spec/frontend/project-lifecycle.md` | **New** durable P1 code-spec: multi-doc session, batch import, templates, recycle vs lifecycle, search save-before-nav, feature op tokens, switcher testids (7-section contract) |
| `.trellis/spec/frontend/index.md` | Index + pre-dev checklist pointer |
| `.trellis/spec/frontend/state-management.md` | Multi-doc session cache, expanded flush destinations, feature ops, recycle vs lifecycle |
| `.trellis/spec/frontend/directory-structure.md` | P1 surfaces/workbench/state/shell tree |
| `.trellis/spec/frontend/electron-workbench.md` | Layout + batch import / recycle / search / flush contracts |
| `.trellis/spec/frontend/component-guidelines.md` | Document switcher landmarks; ConfirmDialog focus |
| `.trellis/spec/frontend/quality-guidelines.md` | P1 test matrix + stable testids; P0 Open vs Open example |
| `.trellis/spec/frontend/type-safety.md` | P1 surface unions; template definition unknown-preserving |
| `.trellis/spec/frontend/hook-guidelines.md` | Feature op tokens; pure helpers vs controller |

## Residual risks (accepted, not quality blockers)

1. **Forced Engine failure / picker-cancel / reconnect races** — covered by unit/integration and static guards; not fully re-exercised in Playwright. Reopen if stale feature completions clobber a newer surface after reconnect.
2. **Keyboard depth** — shared modal focus, Cancel-first asserts, sampled axe, no-console, compact overflow are green; every new control was not exhaustively keyboard-replayed.
3. **Manual `pnpm dev:desktop` AC23 transcript** — waived; production Electron real-Engine matrix covers closeout-critical lifecycle + relaunch.
4. **Git staging** — working tree includes unrelated agent/task edits. Orchestrator must stage **task-owned** product + frontend specs + this task directory only.

## Suggested commit message

**Subject:**

```text
feat(desktop): P1 project lifecycle and discoverability
```

**Body:**

```text
Extend the P0 Workbench-first renderer with multi-document switching,
canonical bestEffort batch import, templates, recycle, global search,
compact insights, example open, and project update/archive.

- SessionContext.documents via bounded Engine-ordered document.list
- Save-before-transition for switch, Search, Insights, and destructive
  active-document actions; feature op tokens invalidate on reconnect
- recycle.delete for soft-delete; setLifecycle only active/archived
- Unknown-preserving template definition merge; create-from-template → Import
- Unit/integration + real-Engine Playwright P1 matrix; frontend code-specs

Residual: forced-failure/reconnect E2E depth and full keyboard matrix
accepted as non-product evidence risk.
```

## Closeout notes

- Do **not** archive the task in this step; Orchestrator archives after merge
  per finish-work policy.
- Do **not** commit from closeout; Orchestrator owns git.
- No further Verify mission required unless residual risks are revoked or a
  real regression appears.
