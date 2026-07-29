# Public Plugin AI Actions And Workbench Panels

## Goal

Complete P-06 and P-07 by turning the existing inventory-only AI action
descriptor and Plugins-page panel preview into versioned, executable public
extensions. A plugin author must be able to add a bounded AI action to the
editor selection menu or assistant sidebar and add an isolated panel to a
declared workbench placement without importing private Engine or renderer
code. Users retain explicit, revocable authority over every action and panel.

## Confirmed Baseline

- Manifest v2, immutable plugin versions, activation revisions, scoped grants,
  capability audit, Tier 2 QuickJS execution, and opaque iframe asset sessions
  are already implemented and remain authoritative.
- `AiActionContributionDescriptor` is only display metadata. It has no closed
  invocation/result/error protocol, registry, adapter, or generated list/invoke
  surface, and sandbox compatibility currently rejects executable AI actions.
- The current UI panel contract has a real isolated preview host with a bounded
  `panel.context` bridge, but it has no Engine-owned registry or workbench
  placement lifecycle. The only product entry is a preview dialog in Plugins.
- Built-in editor panels and built-in `AiAction` values remain product
  behavior that must not be replaced, shadowed, or silently rebound.

## Requirements

### R1. Closed Versioned Contracts

- Publish strict version-1 AI action and UI panel descriptors, compatibility
  projections, invocation/result/error envelopes, limits, SDK builders,
  validators, and generated Engine protocol projections.
- AI action placement is a closed set for editor selection and assistant
  surfaces. Panel placement is a closed set of supported workbench regions;
  arbitrary strings, unknown operations, versions, fields, or enum values fail
  before registration.
- Keep descriptor version, operation protocol version, bridge version, config
  schema version, and contribution version distinct. Released inventory-only
  descriptors remain readable but are reported incompatible for execution.

### R2. Engine-Owned Registries And Lifecycle

- Add owner/version/activation-aware AI action and UI panel registries.
  Built-ins have reserved identities and cannot be displaced.
- Install/enable/restart attaches authorized contributions atomically with the
  plugin generation. Disable, uninstall, revoke/deny, degradation, upgrade,
  rollback, and stale activation detach exactly the owned generation.
- Preflight descriptor validity, placement collisions, exact grants, sandbox
  operations, panel assets, and active registry conflicts before live mutation.
  Compensation must never remove another plugin or a newer activation.
- In-flight AI calls and panel sessions remain pinned to the immutable version
  and activation that created them; stale completions and messages are ignored.

### R3. AI Action Execution

- AI actions execute only through the Tier 2 bounded worker and a closed
  `ai.action.invoke` operation. Plugins receive bounded selection/segment text,
  locales, tags, declared config, and Engine-selected model/profile context,
  never credentials, raw project state, SQLite, arbitrary RPC, or renderer APIs.
- The Engine validates the action input and result, enforces deadline and
  cancellation, canonicalizes structured output, and records bounded
  provenance. A result may propose replacement text or assistant content but
  cannot mutate a segment without the ordinary user-confirmed Engine command.
- Registration and every invocation independently require exact `ai.action`
  contribution/operation authority. Any nested AI/provider, project, asset, or
  network use remains separately authorized by the existing broker.
- Timeout, cancellation, malformed/oversized output, worker loss, grant revoke,
  and late results fail closed without applying text or degrading other plugins.

### R4. Workbench Panel Registration

- Register active panel descriptors through the Engine-owned panel inventory;
  the renderer consumes generated projections and never scans manifests or
  decides lifecycle state.
- Mount panels in their declared editor/workbench locations with deterministic
  ordering, stable keyboard navigation, accessible labels, explicit open/close,
  and fallback behavior when a panel detaches. Preserve all built-in panels.
- Reuse the existing opaque session URL, strict CSP, `sandbox="allow-scripts"`,
  single-session MessagePort, nonce, size/depth limits, and revocation model.
- Extend the bridge only with closed, versioned, capability-mapped methods for
  bounded active selection/project context and explicit proposed actions. No
  generic Engine method, direct IPC, filesystem, network, Node, or Electron API
  is exposed.

### R5. Permissions, Privacy, And Audit

- UI registration/session issue requires exact `ui.panel` authority; each
  bridge method also requires its mapped project/asset/operation scope at call
  time. Revocation closes every matching session immediately.
- Audit records include plugin/version/contribution/operation, scope decision,
  bounded hashes and failure codes only. They must not contain selected text,
  prompts, model output, credentials, package paths, or raw bridge payloads.
- Desktop labels show owner, version, placement, active/detached/degraded state,
  grants, and safe last failure without inventing authority optimistically.

### R6. Desktop Product Integration

- Add plugin AI actions to the existing selection and assistant command
  surfaces without changing built-in action semantics. The user explicitly
  invokes an action and explicitly accepts any text-changing proposal.
- Add active plugin panels to the existing editor panel model and workbench
  layout. Detach, reload, grant revoke, upgrade, and crash remove or replace the
  exact contribution without leaving a blank or stale surface.
- Provide durable action history/provenance sufficient to explain which plugin
  version produced a proposal; React remains presentation-only.

### R7. SDK Examples And Documentation

- Ship one public-SDK Tier 2 plugin that provides a deterministic terminology
  rewrite action and a related editor panel. It imports no private Engine,
  protocol, main-process, or renderer module.
- Document contract versions, placements, inputs/results, limits, permission
  mapping, proposal acceptance, iframe/QuickJS boundaries, lifecycle,
  upgrade/rollback, testing, and honest isolation limitations.

### R8. Qualification

- Cover codecs, bounds, registry ownership, compensation, placement conflicts,
  permission narrowing/revoke, deadline/cancel races, stale generations, panel
  bridge security, restart/upgrade/rollback, safe diagnostics, and cross-plugin
  health with unit, Engine, SDK, smoke, and real Electron tests.
- Capture desktop evidence at 1250x744, 1680x942, and 1920x1080 for both action
  placement and a mounted workbench panel with no overlap or horizontal overflow.

## Acceptance Criteria

- [x] AC-01: Rust, SDK, and generated contracts round-trip all AI action and
      panel v1 shapes and reject unknown, malformed, or oversized forms.
- [x] AC-02: Mixed built-in/plugin registries attach and detach exact owner
      generations across enable, restart, revoke, failure, upgrade, rollback,
      disable, and uninstall without stale or cross-owner removal.
- [x] AC-03: A Tier 2 action executes through the bounded host with exact grants,
      cancellation/deadline enforcement, validated proposals, provenance, and no
      direct mutation or credential/private Engine exposure.
- [x] AC-04: Invalid, late, canceled, revoked, or failed action results never
      alter segment text, and subsequent Engine/plugin calls remain healthy.
- [x] AC-05: Active panels mount in declared workbench placements while built-ins
      remain unchanged; detach/reload/revoke/upgrade closes the exact session and
      removes the surface without stale state.
- [x] AC-06: Panel security tests preserve opaque sessions, CSP, iframe sandbox,
      nonce/port state, payload bounds, navigation/replay rejection, and
      per-method capability checks with no direct IPC/Node/network escape.
- [x] AC-07: Desktop selection/sidebar commands and workbench panels are keyboard
      and screen-reader operable and display generated owner/version/state data.
- [ ] AC-08: The official example builds and completes install, review/grant,
      enable, action invoke/accept, panel exchange, restart, revoke, recovery,
      upgrade/rollback, disable, and uninstall through public contracts only.
      (The retained focused Electron run proves install/grant/enable, action
      invoke/accept, and panel exchange. The remaining lifecycle is covered by
      focused Engine tests, not one retained real-Electron sequence.)
- [x] AC-09: Audit, history, diagnostics, and renderer state contain no selected
      text, prompt/output payload, credentials, local paths, or raw plugin data.
- [x] AC-10: Contracts, format, lint, typecheck, docs, workspace tests, strict
      Clippy, Engine smoke, desktop build/E2E, and three-viewport evidence pass
      with exact results retained under task evidence.
      (The supported Node 24 lane passes every task-owned gate, including the
      complete desktop E2E suite. Root Prettier reports only unrelated
      `codexgoal.md`; every task-owned file passes formatting.)

## Out Of Scope

- P-08 external system connectors and X-07 automation integration.
- Marketplace/index, remote signing, billing, or OS-level sandbox claims.
- Replacing built-in AI workflows, provider profiles, editor panels, or the
  existing Tier 2 QuickJS/iframe security substrate.
- Automatic application of plugin output without an explicit ordinary Engine
  mutation and user acceptance.

## Constraints And Decisions

- This task is additive under protocol v1 and manifest v2.
- AI actions are Tier 2 only. General process/declarative action execution would
  widen the trust model without a PRD requirement.
- UI surfaces reuse the existing iframe host; this task adds registry ownership,
  placement, and typed bridge methods rather than a second panel runtime.
- No blocking product question remains; the PRD already fixes the intended
  selection/sidebar action and editor-panel outcomes.
