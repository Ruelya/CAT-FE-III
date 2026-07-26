# Plugin Permission Grants and Audit

## Goal

Replace the foundation's blanket requested-permission approval with a durable,
default-deny capability system covering every plugin tier and contribution kind.
Users can review, scope, grant, deny, revoke, and audit authority, and the Engine
enforces the decision at both registration and each privileged operation.

## Background

- The foundation stores requested/granted arrays and can grant all requested
  permissions through one install/enable flag.
- The full PRD requires explicit capabilities, consent, isolation, and lifecycle
  behavior. A stored permission that is not enforced is not accepted.
- This child depends on the normalized tier/runtime/contribution model from
  `07-26-plugin-multitier-runtime`.

## Requirements

### R1. Versioned capability vocabulary

- Define typed capability IDs and scope schemas for filesystem source/output,
  bounded network origins, asset/project reads and writes, Engine connector,
  QA/pipeline registration, AI actions, UI panels, external connectors, and
  diagnostics.
- Unknown or malformed required capabilities fail closed. Optional unsupported
  capabilities remain visible but confer no authority.

### R2. Durable grant lifecycle

- Persist requested capability, decision (`pending|granted|denied|revoked`),
  normalized scope, plugin/version, actor, reason, revision, and timestamps.
- Install creates pending requests only. Enable is allowed only when every
  required capability has a valid grant for the active version and scope.
- Upgrade diffs requests; unchanged grants carry forward only when semantically
  identical, and expanded/new scopes return to pending.

### R3. Central enforcement

- One Engine capability service computes effective authority and is called by
  host startup, contribution registration, and every privileged host API call.
- Revocation detaches affected contributions and cancels/rejects new privileged
  operations without terminating the Engine or unrelated plugins.
- Denials use stable typed errors with bounded, secret-free details.

### R4. Consent and audit surfaces

- Generated protocol supports request listing, review, grant, deny, revoke, and
  audit paging with expected revisions.
- Desktop provides a named permission review flow showing human-readable effect,
  scope, tier, contribution, risk, version change, and current decision. It never
  exposes secrets or turns install into implicit consent.

### R5. Evidence

- Cover missing/denied/partial/expired-or-revoked grants, scope mismatch,
  upgrade expansion, restart, concurrent revision, operation-time revocation,
  audit order, and cross-plugin isolation for all capability families.

## Out of Scope

- Native OS sandbox claims, hosted signing/marketplace trust, and enterprise
  organization policy distribution.
- Implementing Tier 1/Tier 2 hosts or domain contribution adapters; fixtures may
  exercise stub privileged calls against the common enforcement service.

## Acceptance Criteria

- [x] AC1: Install creates pending requests and grants no authority by default.
- [x] AC2: Grant/deny/revoke is revision-safe, scoped, durable across restart,
      and recorded in immutable ordered audit evidence.
- [x] AC3: Enable and every privileged operation fail closed on missing,
      denied, revoked, malformed, or out-of-scope authority with typed errors.
- [x] AC4: Revocation detaches affected contributions and blocks new work while
      preserving Engine health, unrelated plugins, and inspectable state.
- [x] AC5: Upgrade preserves only semantically identical grants and requires new
      consent for capability or scope expansion.
- [x] AC6: Desktop permission review is keyboard accessible, bilingual-ready,
      secret-safe, and supports grant, deny, revoke, version diff, and audit.
- [x] AC7: Storage/Engine/protocol/SDK/desktop tests cover every capability
      family plus restart, concurrency, denial, isolation, and audit ordering.

## Dependencies and Risks

- Requires archived `07-26-plugin-multitier-runtime` evidence.
- Later Tier 1, Tier 2, connector, QA/pipeline, AI/UI, and external connector
  children depend on this enforcement contract.
- Main risk is confusing a stored decision with runtime authority; operation-
  boundary tests are mandatory.
