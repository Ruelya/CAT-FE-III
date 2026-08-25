# Security Policy

## Supported versions

Security fixes target the current default branch. There are no tagged desktop
releases or installers yet.

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

- AI provider credentials are supplied at runtime through `ai.configure` and
  held in engine memory only (a redacting `SecretString`). They are never
  written to the `engine.sqlite` database, logs, protocol error text, or
  renderer `localStorage`.
- Packaging currently produces only an unsigned directory artifact; there is
  no installer or signing pipeline yet. When one lands, production signing
  and notarization secrets must stay in CI secret stores, and unsigned
  packages remain valid for development.

## Local hardening expectations

- Electron runs the renderer with `contextIsolation: true` and
  `nodeIntegration: false`. The Chromium `sandbox` flag is currently disabled
  in the development shell; re-enabling it is expected work for the packaged
  application.
- Engine stdio is the only domain boundary; the renderer never opens the
  engine data directory or provider APIs directly.
