# Design: Plugin Capability Grants

## Authority model

```text
manifest request
  -> normalized CapabilityRequest(id, required, scope)
  -> CapabilityDecision(pending/granted/denied/revoked, revision, actor/reason)
  -> EffectiveAuthority(plugin version, operation context)
  -> registration/host API allow or typed deny
  -> immutable audit event
```

Requested, decided, and effective authority are separate types. No boolean
`grantRequested` shortcut survives in the user-facing lifecycle.

## Storage and migration

Add normalized request/decision/audit tables using the next available migration.
Legacy granted arrays migrate as explicit legacy decisions only for the exact
active version and exact normalized scopes; ambiguous entries become pending.
Every mutation uses expected revision and one transaction.

## Enforcement boundary

`PluginCapabilityService` lives in Engine/runtime infrastructure and exposes:

- validate and diff requests for install/upgrade;
- review mutations and audit paging;
- effective-authority checks for host startup, registry attach, and host calls;
- revocation notifications that adapters use to detach/cancel safely.

Adapters cannot cache grants beyond one operation. Audit payloads contain IDs,
scope summaries, decisions, outcomes, and bounded error codes, not credentials,
document bodies, prompts, or connector secrets.

## Desktop

The Plugins surface opens an in-app permission dialog. Required capabilities,
scope expansion, and risk descriptions remain visible before actions. Buttons
use generated methods, expected revisions, named focus handling, and explicit
success/error status. Later management work may refine inventory layout but
cannot replace this consent contract.

## Rollback

- Keep legacy grant reads until migration/restart tests pass.
- New enforcement is capability-advertised and can be disabled without changing
  stored requests/decisions.
- A failed revocation detaches authority first and leaves the plugin disabled
  and inspectable rather than restoring unsafe access.
