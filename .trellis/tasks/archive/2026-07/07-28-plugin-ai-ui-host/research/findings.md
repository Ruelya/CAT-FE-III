# Research Findings: Plugin AI Actions And Workbench Panels

## Current State

- The TypeScript AI action descriptor is metadata only; it has no executable
  request/result/error contract or handler (`packages/plugin-sdk/src/index.ts`).
- Sandbox compatibility currently accepts filters and UI panels but not AI
  actions (`crates/plugin-runtime/src/lib.rs`).
- Engine plugin activation has no AI action registry or adapter. Built-in
  `AiAction` values remain closed in `crates/ai-core` and Engine AI routing.
- The Tier 2 child implemented a real QuickJS runtime, host-call broker, opaque
  asset sessions, strict panel CSP, isolated iframe, MessagePort handshake,
  revocation, and Electron security tests.
- UI panels are still mounted only as a Plugins-page preview. The editor panel
  catalog is built-in-only and explicitly anticipates future plugin entries.
- The current panel bridge exposes only a bounded `panel.context` method. It has
  no general workbench registration or capability-mapped project/selection API.

## Decisions

- Reuse the Tier 2 runtime and iframe security substrate; do not introduce a
  second JS engine, asset server, iframe host, or generic RPC bridge.
- Make AI actions Tier 2-only, matching `docs/design-notes.md` and avoiding an
  unsupported trust-model expansion.
- Treat plugin output as a proposal. Existing Engine mutations and user
  confirmation remain authoritative for text changes.
- Add Engine-owned registries for both actions and panels so React does not
  infer lifecycle from manifest inventory.
- Use closed placement enums and reserved built-in owners.

## Primary Risks

- A stale action result or panel session could target a newer activation unless
  every call captures and rechecks the full owner lease.
- A bridge expansion could accidentally create generic Engine access. Every
  method needs a fixed schema, capability mapping, and bounded result.
- Text/prompt leakage through audit or diagnostics is more likely than raw
  transport failure; evidence must explicitly scan persisted and rendered data.
- Desktop integration can regress built-in panel order, keyboard navigation, or
  compact layouts; real Electron tests and three-viewport evidence are required.
