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
