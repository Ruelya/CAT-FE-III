# Acceptance evidence: External System Connector SDK

## Summary

Implemented the P-08 external connector V1 contract end-to-end:

- Closed Rust contract + validators (`crates/plugin-runtime/src/external_connector.rs`)
- Dual inventory/executable descriptor in plugin-runtime
- Public TypeScript SDK (`packages/plugin-sdk/src/external-connector.ts`)
- Protocol RPC surface under `externalConnector.*`
- SQLite migration v23 + Store APIs for profiles/credentials/checkpoints/idempotency
- Engine registry, keyring-backed credentials, invoke path, lifecycle attach/detach
- Deterministic fixture + docs + focused tests

## Acceptance mapping

| AC | Evidence |
| --- | --- |
| AC-01 | `cargo test -p translunar-plugin-runtime external_connector`; SDK validators reject missing exchange ops / bad origins |
| AC-02 | `examples/plugins/external-connector-fixture` uses only public SDK APIs; no paid/network dependency |
| AC-03 | Same request/result envelopes across tiers; fixture host maps cancel/timeout/auth/rate/hostCrash; registry detach isolates generations |
| AC-04 | Keyring namespace `translunar-cat.external-connector`; SQLite stores presence only; storage tests assert no secret in payload JSON |
| AC-05 | `external.connector` operation scopes + `network.connect` origins enforced at registration/invoke |
| AC-06 | `finalize_external_connector_success` CAS checkpoint; failure finalization leaves checkpoint absent |
| AC-07 | Idempotency claim replay same hash; conflict on different hash; no job/outbox tables |
| AC-08 | Exact owner token + activation revision; detach_generation restores isolation |
| AC-09 | Registry collision preflight; detach only matching owner generation |
| AC-10 | Focused plugin-runtime/storage/engine/SDK tests; contracts generate from protocol |
| AC-11 | `docs/plugins/external-connector-sdk.md` + fixture README assign jobs/webhooks/writes to automation |
| AC-12 | This evidence file maps requirements; secret scans covered by storage/SDK tests |

## Residual risks

1. Tier 1 declarative HTTP host currently uses the deterministic fixture host rather than a full outbound HTTPS client implementation; mapping validation is closed, execution path still needs production HTTP wiring for non-fixture vendors.
2. Process-tier child JSON-RPC for external connectors is SDK-side complete; Engine process bridge still routes executable registrations through the fixture host for deterministic Engine tests.
3. Full workspace `cargo test` / desktop E2E gates should be re-run after contract regeneration on the target CI Node/Rust toolchains.
4. Management UI for connector profiles is intentionally out of scope.

## Secret-redaction notes

- Fixture secret string appears only in keyring test backends and fixture handler code, not in SQLite rows, protocol results, or evidence dumps.
- Safe failures reject messages containing `password`/`secret`/`authorization`.
