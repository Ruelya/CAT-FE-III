# Implementation plan: complete packaging and product shell

## Preconditions and ownership

- Active task: `.trellis/tasks/07-19-platform-packaging-product-shell`.
- Implement through the Trellis `implement` channel with the Claude provider.
  The worker edits the shared worktree directly with focused changes and must
  not commit, push, reset, archive, or revert other tasks' dirty changes.
- Preserve the existing OpenDesign/workbench visual changes and all unrelated
  task outputs. Touch only product-shell code, tests, docs, packaging, and
  generated contracts required by this plan.
- Read `implement.jsonl -> prd.md -> design.md -> implement.md` in that order;
  use Rust/protocol as the source of truth and regenerate contracts after wire
  changes.

## Ordered work packages

### 1. Shell settings and complete localization

- [ ] Add validated main-process shell settings and system-locale IPC.
- [ ] Implement typed message registry, interpolation/plural/date/number
      formatting, provider/selector, persisted locale and missing-key tests.
- [ ] Migrate product-facing renderer/main/preload/tutorial/update/backup/
      restore/error/status/aria copy; keep an audited technical-string list.
- [ ] Add bilingual layout/smoke coverage and ensure Chinese strings are not
      English placeholders.

### 2. Data directory, backup, and restore

- [ ] Add main-process directory picker, path/ancestor/free-space/workspace
      validation and typed responses.
- [ ] Implement staged copy, health/manifest validation, atomic swap, restart,
      rollback and cleanup. Keep `TRANSLUNAR_DATA_DIR` test override.
- [ ] Add one-click backup destination/history UI using `data.createBackup`.
- [ ] Add restore preview/validation and no-clobber staged restore; verify
      Engine initialize/health before committing the swap.
- [ ] Test cancellation, malformed/incompatible/low-space, overwrite, late
      restart failure, and secret exclusion.

### 3. Engine allowlist enforcement

- [ ] Add one shared Rust policy helper and stable typed denial data.
- [ ] Enforce it before interactive AI, batch AI, and pipeline pretranslation;
      test empty/permissive, exact allow, deny, disabled/missing, and existing
      project behavior.
- [ ] Wire project settings UI and generated contract updates if needed.

### 4. Crash-safe restart and drafts

- [ ] Add bounded automatic EngineClient restart/backoff and reconnect event;
      preserve intentional stop semantics and stderr-tail diagnostics.
- [ ] Add atomic size-bounded draft journal API and renderer recovery reducer;
      never use localStorage for source/target text.
- [ ] Restore/discard/copy stale drafts with expected-revision checks and clear
      acknowledged entries through the normal segment update path.
- [ ] Add unit/process/Electron crash and stale-revision tests.

### 5. Interactive tutorial/example project

- [ ] Add first-run detection, bilingual reducer-driven overlay, real target
      controls, focus trap, progress/skip/resume/restart state.
- [ ] Add a bundled permissively licensed example project and an offline
      create/open action through the normal Engine import path.
- [ ] Add packaged-resource and tutorial state tests.

### 6. Update service

- [ ] Add a main-process UpdateManager abstraction and deterministic fixture
      feed adapter.
- [ ] Implement automatic/manual checks, status, download/install, defer,
      disable, active-edit guard, pre-update backup, health validation and
      rollback/manual recovery.
- [ ] Add optional signing/notarization hooks with explicit unsigned result;
      test fixture feed transitions and failure paths.

### 7. Release packaging and CI

- [ ] Make electron-builder output deterministic and platform-specific; bundle
      only the matching release Engine binary and declare macOS minimum OS.
- [ ] Add artifact-size/readiness/no-login/install-smoke scripts with a hard
      200 MB gate and a three-minute clean-machine gate.
- [ ] Add Windows and macOS GitHub Actions package/sign/notarize/smoke/upload
      jobs plus release/signing documentation.

### 8. Accessibility and governance

- [ ] Add axe/keyboard/focus/contrast/reduced-motion checks at all supported
      viewports and document the manual acceptance matrix.
- [ ] Add Apache-2.0 `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue
      templates/forms, and release/contribution guidance.

## Required validation

Run focused checks after each package, then the full gate:

```powershell
pnpm contracts:check
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm test:e2e:engine
pnpm --filter @translunar/desktop test:e2e
pnpm package:dir
pnpm release:package:check
pnpm docs:check
```

Platform-only commands (run in their native CI job or on the documented
runner) are:

```text
pnpm package:win && pnpm release:install-smoke --platform win32
pnpm package:mac && pnpm release:install-smoke --platform darwin
```

If Windows Rust linking or macOS packaging is unavailable locally, report the
exact external runner, commit SHA, command, artifact hash, and failed/passed
checks. Static inspection is not evidence of a package smoke pass.

## Review gates and rollback points

1. Do not proceed from localization until both catalogs, locale persistence,
   and the renderer migration compile and have focused tests.
2. Do not enable data-directory swap or updater install until staged health,
   no-clobber, and rollback tests pass.
3. Do not claim allowlist completion until an Engine-level deny test proves a
   renderer cannot bypass it.
4. Do not claim crash recovery until an actual child-process exit and stale
   draft are exercised.
5. Do not claim release completion until both platform jobs, size/time/no-login
   gates, accessibility evidence, and governance files are present.

On a failed package, keep the implementation branch inspectable, record the
failure in the channel result, and narrow/re-dispatch rather than reverting
unrelated working-tree edits.

## Completion report required from worker

Report exact files changed, protocol/schema changes and generated outputs,
decisions/trade-offs, commands run with results, platform limitations, tests
added, and any remaining acceptance criterion. Do not report “done” for a
documentation/configuration stub that lacks the behavior or evidence above.
