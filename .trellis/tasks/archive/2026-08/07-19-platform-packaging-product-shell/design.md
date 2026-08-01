# Technical design: complete packaging and product shell

## 1. Boundary invariant

```text
Renderer (React presentation/state)
  -> context-isolated DesktopApi
  -> Electron main (dialogs, locale/update settings, draft journal,
                    data-directory quiesce/swap, process ownership)
  -> versioned JSON-RPC / EngineClient
  -> Rust Engine (allowlist policy, health, backup, durable workspace truth)
  -> SQLite + workspace-relative managed files
```

The renderer never reads the filesystem, SQLite, archives, credentials, or
update feeds. New durable behavior is an Engine/protocol service; OS-facing
behavior is an explicit main/preload method with a typed result. All failures
cross the IPC boundary as structured `{ code, message, data? }` values.

## 2. Shell settings and state

Add a small `ProductShellSettings` model in the main process, persisted under
the Electron user-data settings path (not the Engine workspace). It contains
only disposable preferences and non-secret feed/timing choices:

- locale (`en-US` or `zh-CN`);
- update mode (`automatic`, `manual`, `disabled`) and deferred-until time;
- tutorial state (version, step, skipped/completed);
- last known data-directory path and bounded backup/update history metadata.

Validate the file as `unknown` on read and fall back field-by-field. Never put
source/target text, API keys, backup bytes, or draft bodies in this settings
file or `localStorage`.

## 3. Data directory, backup, and restore flow

The main process owns a `DataDirectoryManager` with these states:

```text
ready
  -> validating(target)
  -> staging-copy
  -> health-check(staged)
  -> stopping-engine
  -> swapping
  -> restarting-engine
  -> committed
```

Any failure enters `rollback`, restarts the original Engine, and leaves the
source untouched. The manager validates resolved absolute paths, ancestor/
descendant relationships, free space, manifest schema/hash, and destination
non-overwrite before copying. Copy uses a sibling temporary directory and an
atomic rename; cleanup is bounded and reported.

The existing `data.createBackup` RPC remains the authoritative backup writer.
The desktop adds destination selection, history projection, and restore
orchestration. Restore first validates the manifest in a disposable/staged
workspace, opens the Engine there for `engine.initialize` + `data.checkHealth`,
then swaps only after success. A restore never overwrites an existing target.

## 4. Engine lifecycle and draft journal

`EngineClient` gets an explicit exit callback/state machine. Unexpected exits
are retried at most three times with bounded exponential backoff; intentional
stop/restart is not treated as a crash. Pending calls receive a typed process
error containing only a bounded stderr tail. After a successful restart, main
emits a `engine:reconnected` event to the renderer.

The renderer writes changed segment drafts through a narrow `draftJournal`
preload API. Main stores an atomic, size-bounded journal under the active data
directory (one record per segment: project/document/segment ID, expected
revision, target text, updated timestamp, and checksum). It is not SQLite
truth and is cleared only after the Engine acknowledges the same revision.
On reconnect/startup the renderer requests the journal, compares revisions
with `segment.editor.list`, and presents `restore`, `discard`, or `copy` for
stale entries. Applying a draft uses the normal `segment.updateTarget` RPC.

## 5. Allowlist policy

Add one Rust helper that loads the project snapshot and checks the selected
provider profile ID against `ProjectConfiguration.engine_allowlist`. Empty is
permissive; non-empty is exact ID matching. Call it before creating an
interactive AI run, an AI batch, and the pipeline AI-pretranslation step. Use a
stable `invalid_state`/`policy_denied` error data shape with project/profile
IDs. The UI reads and writes the generated project configuration and disables
known-invalid selections, while Engine enforcement remains authoritative.

## 6. Localization architecture

Replace the catalog-only helper with a typed message registry:

- `MessageKey` and per-key metadata are generated/checked in one file;
- `formatMessage(locale, key, vars)` supports interpolation, plural branches,
  date and number formatting via `Intl`;
- `LocaleProvider`/`useLocale` initializes from main's system-locale result,
  persists a selected locale through main, and records missing-key diagnostics
  in tests only;
- dialog titles, renderer labels, status/error copy, tutorial/update/backup
  surfaces and aria labels all call the shared helper.

Technical/provider diagnostics can remain an audited code-to-message mapping,
but no broad English JSX literals remain. Both bundles are checked for equal
key sets, non-empty translations, and Chinese-specific text.

## 7. Update service

Implement an `UpdateManager` adapter behind an interface so production can use
`electron-updater`/Electron feed metadata while tests use a deterministic local
fixture. Its state machine is:

```text
idle -> checking -> available -> downloading -> ready
                         \-> deferred/disabled
checking/downloading -> failed -> retry/manual
ready -> backup -> install -> health-ok | rollback-required
```

The renderer sees only typed status snapshots and commands (`check`, `defer`,
`setMode`, `install`). Main performs backup before install and never installs
while unsaved renderer drafts or a migration are pending. Signing and
notarization hooks are environment-gated and no-op with an explicit unsigned
result when credentials are absent.

## 8. Tutorial and example project

Add a versioned `TutorialOverlay` driven by a reducer (`welcome`, `create`,
`import`, `edit`, `qa`, `export`, `complete`) with real DOM target IDs and
keyboard/focus handling. State is persisted in the shell settings file; skip
and restart are explicit commands. Bundle a small Apache-2.0-compatible text
fixture and a manifest under the desktop package resources. “Open example”
copies it through the normal source-selection/import path and opens the result
in the workbench, so it exercises real Engine behavior offline.

## 9. Packaging, NFR, and governance

- Keep electron-builder config platform-specific and deterministic; use
  `extraResources` for only the matching Engine binary.
- Add scripts that measure the final artifact directory, verify expected files,
  launch the installed binary with an isolated data directory, and fail at
  200 MB or a three-minute readiness deadline.
- Add separate Windows and macOS GitHub Actions jobs with cache, package,
  signing/notarization hook steps, install smoke, and artifact upload. The
  macOS job declares the supported minimum version; no Linux package claim is
  made.
- Add Playwright/axe checks and a manual accessibility matrix; reduced-motion
  uses a shared media-query preference and keeps focus behavior intact.
- Add Apache-2.0, security response, code-of-conduct, issue forms, and release
  runbook documents.

## 10. Test and rollback strategy

Focused unit tests cover locale formatting, settings validation, path safety,
update state transitions, draft checksum/revision guards, tutorial reducer,
and package-size/readiness helpers. Rust tests cover allowlist policy,
backup/restore validation and rollback. Electron E2E covers locale switching,
backup/restore, data migration, Engine crash/reconnect, stale draft recovery,
tutorial completion, keyboard/axe checks, and no-login startup. CI package
smoke uses isolated temporary workspaces and never touches a developer's live
data directory.

Every migration/swap has a preflight and explicit rollback point. If a new
protocol method or schema is not needed, do not add one merely to move logic
into the renderer; reuse existing Engine methods and generated contracts.
