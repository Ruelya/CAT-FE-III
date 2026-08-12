# Desktop AI, plugins, collaboration, and settings experience

## Goal

Bring the four P4 product areas to the same dense, coherent Translunar desktop
quality as the core Workbench while preserving every existing security,
authority, persistence, and stale-operation contract. The surfaces must present
real capabilities and technical detail clearly without becoming raw developer
consoles, marketing panels, or fictional cloud workflows.

## Background

- P4 is already implemented through dedicated controllers and real generated
  Engine/DesktopApi contracts; this task refines presentation and interaction.
- AI, plugin, and connector deep E2E paths remain fixture-gated. Their absence
  is residual risk, not permission to simulate successful data.
- The current appearance contract is versioned local renderer storage at
  `translunar.renderer.appearance.v1`, with light and `#765847` defaults.
- The UX audit identified incomplete tab semantics, direct destructive actions,
  ambiguous form labels, raw JSON/ID presentation, and incomplete responsive
  coverage across P4 sections.

## Dependencies and ownership

- Runs after `08-10-desktop-insights-assets-experience` so shared CSS and
  navigation patterns are stable, and before the cross-surface accessibility
  audit.
- Owns `AiControl`, `Plugins`, `Collaboration`, `ProductSettings`, their P4
  presentation helpers/controllers only where interaction wiring requires it,
  P4-owned CSS, focused tests, and the P4 E2E scenario.
- It must not widen the preload bridge, add Engine methods, replace the surface
  machine, store secrets in React persistence, or change plugin sandbox rules.

## Requirements

### R1 - Shared P4 information architecture

- Each surface exposes one clear primary action for the active section, compact
  section navigation, operational status, and scan-friendly lists/forms/tables.
- Route-like section navigation uses navigation semantics rather than incomplete
  tab roles; true local tabs receive the complete keyboard/tabpanel contract.
- Dense technical data is structured into labeled fields, summaries, and
  optional bounded detail. Raw JSON or internal IDs remain visible only when
  required for expert diagnosis, never as the default hierarchy.
- Copy is concise and factual. Do not add descriptive subtitles, guiding text,
  future-feature copy, remote-collaboration claims, or prohibited contrast copy.

### R2 - AI Control

- Provider profiles, credentials, settings, grounding, conversations/runs,
  batch work, usage, and quality views retain independent loading/error states
  and Engine-returned status/counts.
- Schema-supported fields render as typed controls; unsupported schemas remain
  visible but read-only with a direct operational reason, never a raw JSON editor.
- Credentials use `setAiCredential`, remain only in the active password control,
  clear only after success, and never appear in logs, storage, errors, or generic
  invoke payloads.
- Runs are available only for enabled credential-backed profiles. Applying an
  AI result remains explicit, revision-safe, and recoverable on conflict.

### R3 - Plugins and external connectors

- Plugin inspect/install/enable/permission/version/action/panel lifecycles use
  current revisions, complete pending/settled/error states, and refreshed
  Engine projections without optimistic flags.
- Permission decisions and plugin/connector/credential removal use the shared
  Cancel-first confirmed path with actor/reason where required.
- Plugin panels mount only issued `translunar-plugin:` sessions, retain sandbox
  boundaries, revoke on close/navigation/unmount/supersession, and display a
  bounded revoked/expired recovery state.
- Connector configuration preserves unknown keys, exposes only declared
  credential slots and operations, and presents request/replay/checkpoint
  results without implying CAT project mutation.

### R4 - Local collaboration

- The surface remains explicitly project-scoped and local. Member, role, lock,
  presence, assignment, and operation-log views use Engine ownership and exact
  revisions/cursors.
- Controls have visible/programmatic labels and repeated-row actions include
  member/assignment identity. Member removal is confirmed.
- Presence timers start and stop with the owning section/surface; no remote sync,
  CRDT, server push, or optimistic lock claim is introduced.
- Opaque operation payloads are shown only as bounded expert detail and are not
  cast into invented domain meaning.

### R5 - Product Settings and appearance

- Locale remains a locale-only shell patch. Theme/accent remain renderer-local
  appearance-v1 and are never written into ProductShellSettings.
- Appearance Apply/Reset supports light/dark and custom seed, retains semantic
  status-color independence, reports persistence failures, and restores across
  relaunch with malformed-version fallback.
- Data-directory migration, backup, restore, updates, and tutorial commands use
  existing picker/preview/allowed-command guards, explicit confirmation, and
  returned state as authority.
- Color and text controls have unique labels; technical booleans and paths are
  formatted for scanning without hiding required facts.

### R6 - State, accessibility, and compact behavior

- Every async domain blocks unsafe duplicate mutations in command code, ignores
  stale completions after section leave/reconnect, and preserves form/proposal
  state on failure.
- Errors are associated with fields/actions and announced; icon-only controls
  include `aria-label` and `title`; selected/current/expanded states are semantic.
- All P4 sections remain usable in both themes at 1180x700, 1250x744, 1680x942,
  and 1920x1080, with 125% text scaling, long IDs, long profile/plugin names,
  and no document-level horizontal overflow.
- Motion is causal and reduced-motion-safe. New iconography remains Phosphor and
  all materials remain solid.

### R7 - Honest verification

- Always-on P4 reachability, appearance persistence/fallback, local collab,
  locale/settings non-destructive paths, viewport geometry, accessibility, and
  console/page-error checks must pass with the real Engine.
- Deep AI/plugin/connector scenarios run only with their named fixtures and are
  reported as fixture-gated when absent; a skip never counts as success.
- P0-P3 regression suites remain green after P4 visual work.

## Acceptance criteria

- [ ] AC1: AI, Plugins, Collaboration, and Settings share one coherent,
      scan-friendly Translunar hierarchy with no default raw-console layout,
      filler copy, glass, Lucide drift, or fake capability.
- [ ] AC2: Section navigation semantics and keyboard behavior agree; forms,
      repeated actions, status regions, and icon controls are fully named.
- [ ] AC3: AI credentials, runnable-profile filtering, run/apply conflicts,
      paging, and stale operations preserve the current security/authority rules.
- [ ] AC4: Plugin permissions/lifecycle/panels and connector profiles/
      credentials/invocations preserve revision, sandbox, revoke, declared-only,
      confirmation, and unknown-key contracts.
- [ ] AC5: Collaboration remains honest local project state with exact Engine
      member/lock/presence/assignment/op-log behavior and confirmed removal.
- [ ] AC6: Locale, appearance-v1, data/backup/restore/update/tutorial flows retain
      their existing persistence and allowed-command contracts across relaunch.
- [ ] AC7: Every P4 section passes light/dark, four-viewports, 125% scaling,
      long-content, reduced-motion, keyboard/axe, geometry, and console checks.
- [ ] AC8: Always-on real-Engine P4 and all P0-P3 regressions pass; named deep
      fixture skips remain explicit residuals rather than pass evidence.

## Out of scope

- New AI providers/features, plugin protocol or permission scopes, external
  connector operations, remote collaboration, cloud sync, billing, or RBAC.
- A generic JSON configuration console, automatic AI application, or relaxed
  plugin iframe/credential boundaries.
- Comprehensive retranslation of P0-P3; this task preserves locale preference
  behavior and plans only P4-owned copy.

## Blocking questions

None. Existing P4 contracts and the user-selected visual direction define the
scope; unavailable fixtures remain explicit qualification risks.
