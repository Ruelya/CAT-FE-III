# AI Actions And Workbench Panels SDK

Public Tier 2 contracts for executable AI actions and isolated workbench panels.
Descriptors are versioned independently from operation protocol, config schema,
and panel bridge versions.

## AI actions

### Descriptor (executable V1)

Use `defineAiAction` from `@translunar/plugin-sdk`:

```ts
import { defineAiAction, defaultAiActionLimits } from "@translunar/plugin-sdk";

export const terminology = defineAiAction({
  id: "example.terminology",
  version: "1.0.0",
  displayName: "Terminology rewrite",
  label: "Rewrite terminology",
  placement: "editorSelection", // or "assistantSidebar"
  input: { type: "object" },
  inputFields: ["selectionText", "sourceLocale", "targetLocale"],
  resultModes: ["replaceSelection"],
  configSchema: { schemaVersion: 1, fields: [] },
  limits: defaultAiActionLimits(),
});
```

Required capability:

```json
{
  "capabilityId": "ai.action",
  "required": true,
  "scope": {
    "kind": "contributions",
    "contributionIds": ["example.terminology"]
  },
  "contributionId": "example.terminology"
}
```

### Operation

- Operation name: `ai.action.invoke`
- Protocol version: `1`
- Host builds a bounded `AiActionInvocationV1` (selection/segment text, locales,
  tags, declared config, deadline). Plugins never receive credentials, SQLite,
  arbitrary Engine RPC, or renderer APIs.
- Result is a closed proposal union: `replaceSelection`, `replaceTarget`, or
  `assistantContent`. The Engine validates and canonicalizes output; Desktop
  shows the proposal. Accepting text uses ordinary segment draft/save mutation.

### Failure codes

`invalid_request`, `permission_denied`, `timeout`, `cancelled`,
`invalid_result`, `host_failed`, `stale_activation`, `protocol_error`,
`resource_limit`.

### History and audit

`plugin.aiAction.history.list` returns durable provenance: owner token, status,
failure code, canonical SHA-256, and usage counts. It never stores selected
text, prompts, model output, credentials, or package paths.

## Workbench panels

### Descriptor (executable V1)

Use `defineUiPanel`:

```ts
import { defineUiPanel } from "@translunar/plugin-sdk";

export const panel = defineUiPanel({
  id: "example.panel",
  version: "1.0.0",
  displayName: "Terminology",
  label: "Terminology",
  placement: "editorSidebar", // editorSidebar | assistantSidebar | bottomPanel
  surface: "panel/index.html",
  methods: ["panelContext"],
  order: 10,
});
```

Required capability: `ui.panel` scoped to the contribution id.

### Isolation

- Surface files load only through an opaque, expiring `translunar-plugin://`
  session URL owned by Electron main.
- Iframe uses `sandbox="allow-scripts"` without `allow-same-origin`.
- Bridge: single transferred `MessagePort`, 256-bit nonce, bridge version 1.
- Closed methods: `panel.context`, `panel.activeSelection`,
  `panel.projectContext`, `panel.proposeReplacement`. Each method is
  capability-mapped and bounded. Navigation, replay, oversize, timeout, revoke,
  upgrade, or lifecycle mutation closes the session.

## Lifecycle

Enable attaches authorized actions and panels with the plugin generation
(`pluginId + versionId + activationRevision + contributionId`). Disable,
uninstall, revoke, upgrade, rollback, restart, and failure detach only that
generation. In-flight action results and panel messages for a stale generation
are ignored.

## Example

`examples/plugins/sandbox-toolkit` provides a deterministic terminology rewrite
action and a related editor panel using only public SDK types.

## Honest isolation limits

QuickJS and the isolated iframe are application-level containment, not an
OS sandbox. Do not claim process isolation beyond the published bounds.
