# Frontend rebuild P4 — AI, plugins, collaboration, and product settings

## 1. Goal

Complete the frontend rebuild program on top of the shipped P0–P3 Workbench by delivering real, Engine-backed AI Control, plugin and external-connector management, project-scoped collaboration panels, and product settings including user-selectable light/dark appearance and custom accent seed.

P4 must preserve the existing Workbench safety and visual contracts: Engine authority, typed generated RPC, `SaveCoordinator`/IME behavior, save-before-navigation, reconnect generation guards, Phosphor icons, solid surfaces, light default, advanced-brown default accent, and no dead navigation.

## 2. Product outcomes

- Users can configure and operate AI providers, inspect grounding, manage interactive and batch work, apply a successful proposal, inspect usage, run offline quality helpers, and manage durable conversations where project context exists.
- Users can inspect, install, permission, enable, disable, upgrade, roll back, and uninstall plugins; run supported plugin AI actions; and open/revoke authorized plugin UI panels.
- Users can configure and invoke external connector profiles without loading plugin code or secrets into renderer persistence.
- Users can use local collaboration membership, locks, presence, assignments, and operation-log projections for the current project with truthful empty/error states.
- Users can manage locale, workspace data location, backup/restore, updates, tutorial state, theme, and accent from a real Settings destination.
- P0–P3 routes and tests remain green, and every P4 chrome action reaches a complete surface.

## 3. Requirements

### R01 — Inherited architecture and safety

P4 shall extend the current `App` surface machine, `AppChrome`, `use-app-controller`, feature generation, typed `lib/rpc`, and dedicated feature-controller pattern in place. Engine and shell results remain authoritative. React may own forms, selection, cursors, polling state, panel open state, and presentation formatting only. Any transition out of a dirty Workbench shall await `SaveCoordinator.flush()` and remain in Workbench on failure. IME composition behavior shall remain unchanged.

### R02 — Real routing and chrome

P4 shall add real destinations for AI Control, Plugins, Collaboration, and Settings without adding a URL router or global state dependency. AI Control, Plugins, and Settings shall be available after boot resolves. Collaboration shall be exposed only when a current project context exists. Entering a P4 destination from Workbench shall flush first; returning to Workbench shall rehydrate the retained identity through the Engine. No visible tab, icon, menu item, or button may lead to an unimplemented panel.

### R03 — AI provider, credential, and policy control

AI Control shall support:

- `ai.provider.catalog/list/create/update/delete/test`;
- schema-driven built-in and plugin provider configuration with exact source/owner/version/availability projection;
- `ai.credential.status/delete` and credential writes only through `DesktopApi.setAiCredential`;
- `ai.settings.get/update`, including enabled, interactive/batch policy, default profile, origin allowlist, and monthly token budget;
- revision-safe mutations and authoritative reload after mutation.

Credential values shall stay only in the active password control, shall clear only after a successful write, and shall never enter Engine generic invoke params, localStorage, logs, diagnostics, URL/query strings, or durable React state.

### R04 — AI grounding, interactive runs, conversations, and apply

With a valid project/document/segment context, AI Control shall support grounding preview; conversation list/create/update/archive and message paging; interactive run start/get/list/events; cancel/resume; streamed/event progress; proposal display; and explicit `ai.result.apply`. Polling shall use Engine event sequence cursors, stop on unmount without canceling Engine work, and resume from durable Engine state. Apply shall send exact run and segment revisions, retain a failed proposal, and treat the returned editor mutation as authoritative.

Without segment context, segment-dependent controls shall be absent rather than disabled dead UI. Without an enabled credential-backed profile, AI Control shall render a truthful empty/unavailable state and shall not imply a network result.

### R05 — AI batch, usage, and quality

With project context, AI Control shall support `ai.batch.start/get/list/items/cancel/resume`, including Engine status/counts, item paging, exact revision commands, and terminal-state guards. It shall expose `ai.usage.query` with authoritative nullable/zero values and paging. With document context, it shall expose report-only `ai.quality.scoreDocument`, `ai.quality.semanticQa`, and `ai.quality.extractTerms`; quality output shall not mutate QA, termbase, segment state, or routing.

### R06 — Plugin inventory and lifecycle

Plugins shall provide complete installed and bundled inventory with paging and truthful loading/empty/error states. It shall support `plugin.list/get/inspect/install/enable/disable/uninstall/version.list/upgrade/rollback/bundled.list/bundled.apply`. Local install/upgrade shall use `DesktopApi.selectPluginPackage`, inspect before mutation, show compatibility/provenance/distribution/diagnostics, and mutate only after explicit confirmation. Lifecycle commands shall use current revisions where required and reload authoritative plugin/contribution/provider/permission projections after completion instead of patching status optimistically.

### R07 — Plugin permissions

Plugins shall support permission request list/review, grant, deny, revoke, and audit list. Risk, required/optional status, requested/granted scope, decision state, actor, reason, and revision shall come from Engine projections. Destructive or authority-changing actions shall use the shared accessible confirmation pattern, reject blank required actor/reason fields, and remain open on failure.

### R08 — Plugin AI actions and UI panels

Plugins shall list active/degraded/detached AI-action and UI-panel contributions with exact owner identity. Supported plugin AI actions shall use schema-driven configuration, bounded active editor context when available, invoke/cancel/history operations, and show authoritative proposal/usage/failure outcomes. Unsupported schema field kinds or detached/degraded actions shall remain visible and unavailable rather than receiving a fabricated editor.

An active UI panel shall open only through `DesktopApi.issuePluginPanelSession`, mount only the issued `translunar-plugin:` URL, and revoke through `DesktopApi.revokePluginPanelSession` on close/navigation/unmount. `onPluginPanelRevoked` shall immediately unmount the matching panel and show a safe state. Renderer code shall not execute plugin code or expose Node/Electron/Engine authority to the iframe.

### R09 — External connectors

The Plugins destination shall include an External Connectors section supporting `externalConnector.catalog`, profile list/create/update/delete, credential status/set/delete, invoke, and checkpoint get. Catalog entries shall join exact plugin contribution metadata for supported typed configuration fields and credential-slot labels. Configuration updates shall preserve unknown existing keys and remain Engine-validated. Secret inputs shall be ephemeral and never logged or persisted.

Invocation shall expose only operations declared by the selected connector, build one bounded version-1 request through a shared typed boundary, show replay/checkpoint/result state honestly, and never claim that a pull/push/webhook result has modified CAT project data. Arbitrary plugin code, network access, checkpoint CAS, and permission enforcement remain Engine/runtime responsibilities.

### R10 — Project-scoped collaboration

A Collaboration destination shall be available only with a current project and shall support:

- member list/add/remove;
- lock list/acquire/release/heartbeat for valid document/segment context;
- presence list and bounded heartbeat lifecycle while the panel is active;
- assignment list/create/complete with exact assignment revision;
- append-only operation-log paging by `afterSequence`.

The UI shall label and behave as local collaboration state. It shall not imply remote synchronization, CRDT merging, enterprise RBAC, or server push. Each panel shall have usable success, empty, loading, and typed error states; unknown op-log payloads shall not be interpreted as new domain facts.

### R11 — Locale and shell settings

Settings shall load locale through `getShellSettings`/`getSystemLocale`, update only `{ locale }` through `updateShellSettings`, and reflect the committed result. Locale selection shall update the document language and the main-owned dialog preference. P4 shall not add theme, accent, data-directory, update, backup, restore, or tutorial fields to `ShellLocalePreferencePatch`.

### R12 — Data directory, backup, and restore

Settings shall support data-directory status, trusted directory selection, validation, explicit migration confirmation, and authoritative migration outcome. It shall support backup destination selection and backup creation. Restore shall use trusted source selection, decode and display only a valid preview summary, require explicit confirmation, and submit the main-issued confirmation token unchanged. Cancel shall make no destructive call; failure shall retain preview/error for retry. Successful migration shall rehydrate the current identity; successful restore shall invalidate stale feature work and restart routing from authoritative shell/Engine state.

### R13 — Update manager and tutorial state

Settings shall support update status, mode changes, manual check, defer, download, install, rollback, and open-installer commands according to the authoritative status snapshot. Duplicate or invalid state transitions shall be blocked in both UI and command code. It shall load and update the existing versioned tutorial state, including reset to the first step, skip, and complete controls, without inventing a second tutorial persistence path.

### R14 — Versioned renderer appearance

P4 shall replace the fixed P0 appearance constants with a versioned renderer-local preference at `translunar.renderer.appearance.v1` containing only:

- `version: 1`;
- `theme: "light" | "dark"`;
- `accentSeed: "#RRGGBB"`.

The default shall remain light with advanced-brown seed `#765847`. Parsing shall be total; unavailable storage, malformed JSON, unsupported versions, invalid themes, or invalid seeds shall fall back safely. Theme and derived accent variables shall apply before the React surface renders, persist across reload, and reset to defaults on command. Appearance shall never be written to `ProductShellSettings`.

Dark mode shall use solid theme tokens and valid `color-scheme`. Accent derivation shall preserve a usable custom hue while maintaining readable control/focus contrast. Success, warning, and error colors shall use theme semantic tokens independent from the accent seed.

### R15 — Async ownership, errors, and secrets

AI, plugin, connector, collaboration, and settings async domains shall have independent operation counters or equivalent finite-state ownership tied to app `featureGeneration`. Reconnect/navigation/unmount shall invalidate stale completions. Duplicate mutations shall be blocked in command code, not only with disabled buttons. Typed errors shall remain visible at the owning panel and shall not be converted into false empty/success states. No secret, provider response body beyond the generated safe projection, managed path, plugin diagnostic stack, or collaboration payload shall be persisted in renderer localStorage.

### R16 — Visual, accessibility, and copy quality

P4 shall use Phosphor icons, solid surfaces, compact workbench-first composition, confined panel scrolling, visible focus, semantic controls, accessible names/tooltips for icon-only buttons, Cancel-first destructive dialogs, non-destructive Escape, reduced-motion behavior, and no viewport-level horizontal overflow at 1250×744, 1680×942, or 1920×1080. It shall add no `backdrop-filter`, glass material, new renderer `lucide-react`, marketing bento, filler subtitle, guiding microcopy, or “不是”-style contrast construction.

### R17 — Program completion and regression quality

P4 shall add focused pure/controller/integration coverage and `p4-ai-plugins-settings.spec.ts` against the built Electron app and real Engine. The existing P0, P1, P2, and P3 Playwright suites shall remain green. Environment-dependent plugin/provider/connector fixture paths may skip only with an explicit reason; reachability, honest empty/error behavior, local collaboration, appearance persistence, and non-destructive Settings flows shall remain always-on. Renderer console/page errors fail acceptance.

## 4. Acceptance criteria

- **AC01 — P4 routing:** After boot resolves, AI, Plugins, and Settings chrome controls reach real surfaces; Collaboration appears only with project context. Workbench entry flushes first, flush failure stays in Workbench, and return rehydrates the retained session.
- **AC02 — No dead navigation:** Every visible P4 chrome control, section, tab, and primary action has a complete handler and observable loading/empty/error/success behavior; unavailable context-specific sections are absent.
- **AC03 — Provider lifecycle:** A catalog-backed provider can be created, edited, tested, enabled/disabled, and deleted with exact generated params; plugin source identity and unavailable/degraded state remain truthful; each mutation reloads Engine projections.
- **AC04 — AI credentials/settings:** Credential status loads; failed credential write retains the password only in its current control; successful write clears it; delete refreshes status. AI settings update uses the fetched revision and retains the form on conflict.
- **AC05 — Grounding and conversation:** With a current segment, grounding preview shows Engine sections/truncation/hash state, a conversation can be created/selected/archived with paged messages, and the first run binds to the returned conversation ID.
- **AC06 — Interactive run/apply:** Start → events/get → terminal proposal works; cancel/resume uses current run revision; apply uses current run/segment revisions, retains proposal on error, and authoritative rehydration shows the applied target.
- **AC07 — Batch:** Batch start/list/get/items and cancel/resume show Engine counts/statuses, retain paged item errors, prevent duplicate commands, and never mark a non-terminal batch complete locally.
- **AC08 — Usage/quality:** Usage queries preserve Engine aggregates/records and explicit unavailable/empty states. All three quality helpers render reports from a real document and produce no mutation RPC.
- **AC09 — Plugin lifecycle:** Local picker cancel makes no RPC. A selected package is inspected before install/upgrade. Installed and bundled operations, enable/disable, version list, rollback, and uninstall use authoritative results and refresh inventory.
- **AC10 — Permissions:** Request review, grant/deny/revoke, and audit paging show exact scopes/revisions. Blank actor/reason is blocked. A failed decision keeps the confirmation/panel open with its error.
- **AC11 — Plugin AI actions:** Active actions invoke with declared schema/context, cancellation/history are usable, detached/degraded/unsupported actions remain visible but unavailable, and proposal/usage values come from the Engine result.
- **AC12 — Plugin panels:** An active panel receives an issued session and renders only its issued URL. Close/navigation revokes it. A matching revocation event unmounts it, and a stale/revoked session cannot remain interactive.
- **AC13 — External profiles/credentials:** Exact-owner schema and credential slots render; create/update preserves unedited configuration keys; set/delete refreshes status; a secret appears only in the intentional `externalConnector.credential.set` request and current password control, never in other projections, logs, storage, URLs, or displayed errors.
- **AC14 — External invocation:** Only declared operations can be submitted. Invalid request input stays in the form with a typed error; a successful invoke shows request ID, operation, replay status, result, and checkpoint revision without claiming project mutation. Checkpoint lookup uses exact profile/stream identity.
- **AC15 — Collaboration members/locks:** Member add/remove and lock acquire/release/heartbeat use the active project/context. Lock conflict keeps authoritative holder data. Empty lists are labeled; no remote-sync claim appears.
- **AC16 — Collaboration presence/assignments/log:** Presence heartbeat is active only while owned by the mounted panel, assignments complete with exact revision, and op-log Load more advances `afterSequence` from the highest Engine-returned item sequence without interpreting unknown payload fields.
- **AC17 — Locale:** Locale commit calls `updateShellSettings({ locale })` only, updates the document language, survives reload via shell settings, and does not alter appearance or other shell fields.
- **AC18 — Data directory:** Status renders returned health/free-space values; picker cancel is a no-op; validation precedes confirmation/migration; failure retains current active path and error; success follows returned `activePath` and rehydrates.
- **AC19 — Backup/restore:** Backup picker cancel is a no-op. Restore preview rejects malformed `data`, valid preview requires explicit confirmation, apply sends the opaque token unchanged, failure retains preview, and success routes from fresh authoritative state.
- **AC20 — Updates/tutorial:** Controls are enabled only for valid authoritative update states and refresh after every command. Tutorial reset/skip/complete round-trip through `getTutorialState`/`updateTutorialState` with versioned state.
- **AC21 — Appearance persistence:** Default first paint is light/advanced brown. Selecting dark plus a valid custom seed applies immediately, survives renderer reload, and reset restores defaults. Malformed/unsupported storage never prevents boot.
- **AC22 — Appearance semantics:** Light and dark palettes meet automated contrast checks for text, primary controls, and focus indication. Semantic success/warning/error token values do not derive from or alias the custom accent.
- **AC23 — Async/error safety:** Deferred fake-API tests prove stale completions after navigation/reconnect do not update the new owner; duplicate mutation guards make one RPC; typed failures remain visible and retryable.
- **AC24 — Static/a11y/layout:** No renderer `lucide-react` or `backdrop-filter`; all new icon buttons have names/titles; destructive dialogs are Cancel-first and Escape-safe; three target viewports have no horizontal overflow; reduced motion remains honored.
- **AC25 — Regression and P4 E2E:** Desktop typecheck, unit/integration suite, production build, P0–P3 Playwright specs, and P4 Playwright spec pass with a real Engine; fixture-dependent skips name the missing fixture while always-on P4 cases remain green and console/page-error free.
- **AC26 — Contract scope:** `pnpm contracts:check` remains green with no new Engine method or protocol regeneration. If an enumerated method is genuinely absent, implementation stops and reports the exact gap rather than inventing a renderer contract.
- **AC27 — Completion:** No visible rebuild-era placeholder or obsolete P0 fixed-appearance assertion remains, and the shipped app exposes a coherent path to every in-scope P4 capability.

## 5. Out of scope

- New Engine methods, protocol/schema regeneration, storage migrations, or changes to plugin/external/collaboration runtime authority unless a proven missing contract is separately approved.
- Remote collaboration transport, multi-node synchronization, CRDT/OT merging, enterprise RBAC, or server administration.
- Executing plugin code in React, giving plugin iframes a generic Engine bridge, or parsing plugin packages in the renderer.
- Automatically importing external connector results into projects, segments, TM, or termbase; invocation is an explicit connector operations console only.
- Billing/currency/cost estimates, provider marketplace marketing, or synthetic network success.
- Rebuilding P0–P3 workflows, adding a route library/global state framework, or introducing glass/marketing bento/React Bits as a requirement.
- Re-translating every P0–P3 hard-coded renderer label. P4 owns shell locale selection, document language, existing catalog reuse where present, and P4 functional labels.
- New tutorial walkthrough content. P4 manages the existing versioned tutorial state with real controls.
- Persisting appearance through `ProductShellSettings` or syncing it across machines.

## 6. Assumptions

- **High confidence:** The generated catalog already contains every AI, plugin, external connector, and collaboration method listed in this PRD; `DesktopApi` already contains plugin package/panel, AI credential, shell settings, data, backup/restore, update, and tutorial APIs.
- **High confidence:** P4 can remain frontend-focused. Main/preload changes are unnecessary unless implementation proves an existing DesktopApi path is broken.
- **High confidence:** The current custom `AppSurface` machine and dedicated feature hooks are the intended architecture; no URL router or global store is needed.
- **High confidence:** External connector catalog entries can be joined to exact-owner plugin contribution descriptors to recover bounded configuration schema and credential metadata; unsupported or missing descriptors remain read-only/unavailable.
- **Medium-high confidence:** Locale acceptance is the shell preference and dialog/document-language behavior described above, not full re-localization of the rebuilt P0–P3 UI.
- **Medium confidence:** Existing bundled/official plugin fixtures and a deterministic loopback provider can cover deep P4 E2E. Where a platform fixture is unavailable, only that deep case may skip with explicit evidence; core P4 reachability and local paths remain mandatory.

## 7. Dependencies

- Base branch: `refactor/frontend-3` with P0–P3 shipped.
- Task branch: `task/08-10-frontend-rebuild-p4-ai-plugins-settings`.
- Generated contracts in `@translunar/contracts` and existing public plugin SDK request types where a typed external-connector request builder needs them.
- Existing `DesktopApi`, main/preload trusted IPC, official plugin resources/fixtures, and real Rust Engine E2E harness.
