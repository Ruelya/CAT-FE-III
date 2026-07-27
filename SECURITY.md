# Security Policy

## Supported versions

Security fixes target the latest `master`/`main` branch and the most recent
tagged desktop release.

## Reporting a vulnerability

Please report security issues privately. Do **not** open a public GitHub issue
for unfixed vulnerabilities.

Preferred channel:

1. Email the maintainers listed in the repository profile / `CODEOWNERS` (if
   present), or open a private security advisory on GitHub.
2. Include a clear reproduction, impact assessment, and whether you plan to
   publish a write-up.
3. Allow a reasonable disclosure window after a fix is available.

## Scope notes

- AI provider secrets and the local API bearer token must remain in the OS
  credential store. They must never appear in SQLite, backup manifests, logs,
  or renderer `localStorage`.
- Desktop packages may ship unsigned for development. Production signing and
  notarization secrets must stay in CI secret stores.
- Backup archives contain workspace files and hashes, never credentials.

## Local hardening expectations

- Electron runs with `contextIsolation`, `sandbox`, and no Node integration in
  the renderer.
- Engine stdio is the only domain boundary; the renderer never opens SQLite or
  provider APIs directly.

## Tier 2 plugin isolation

Tier 2 JavaScript runs in an Engine-owned QuickJS runtime with fixed heap,
stack, module, queue, payload, call-count, and wall-clock limits. It receives no
Node, filesystem, network, environment, process, shell, native-module, or raw
Engine globals. Host calls use a closed method registry and reauthorize the
exact active plugin version, contribution, operation, capability, and scope at
the time of use.

Plugin documents use opaque expiring `translunar-plugin://` sessions, strict
response CSP and security headers, and an iframe with only `allow-scripts`.
They have an opaque origin and no preload, Node, Electron IPC, or top-level
`window.translunar`. The bridge is a one-time nonce-bound transferred
`MessagePort` with closed, bounded schemas.

These are application-level isolation measures. They are not AppContainer,
seccomp, filesystem virtualization, a browser security boundary, or
multi-tenant containment. QuickJS and its Rust bindings execute native code in
the Engine process; Electron, QuickJS, their bindings, and other native host
dependencies remain part of the trusted computing base. A memory-safety defect
or a compromised host application can invalidate these guarantees. Tier 3
native/process plugins are governed by their separate process boundary and are
not made safe by the Tier 2 host.
