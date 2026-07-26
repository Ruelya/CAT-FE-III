# Design - Full PRD release qualification

## Qualification model

One immutable Git SHA is the release candidate. A requirement ledger joins
source PRD IDs to implementation ownership and evidence:

```text
PRD ID -> owning task/commit -> automated lane -> native/manual lane -> result
```

The ledger is append-only for a candidate. A failed product contract opens or
resumes the owning implementation task; after its fix is committed, the new SHA
is a new candidate and all invalidated lanes rerun. Qualification never patches
product behavior in place and never converts a missing result into a pass.

## Evidence structure

Store small, sanitized evidence under this task:

```text
evidence/
  ledger.json
  manifest.json
  automated/<lane>.json
  platforms/<os>-<arch>-<node>.json
  benchmarks/<fixture>.json
  fidelity/<corpus>.json
  manual/<matrix>.md
  final-report.md
```

Every record includes schema version, candidate SHA, runner OS/architecture,
tool versions, command, start/end time, exit status, artifact/test counts, and
SHA-256 references. Large installers, traces, and corpora live in CI artifact
storage; committed manifests contain hashes and stable run identifiers only.

## Lane boundaries

- `quality-node22` and `quality-node24`: clean dependency install, Electron
  integrity, format/lint/typecheck/test/contracts, Engine and desktop E2E.
- `package-windows-x64`, `package-macos-x64`, `package-macos-arm64`: native
  packaging, architecture, size, installer, launch, packaged Engine, assets,
  signing/notarization status, and timing.
- `nfr-*`: deterministic performance/capacity/reliability fixtures with raw
  sample arrays and summarized percentiles.
- `fidelity-*`: format corpora plus human layout sampling.
- `ecosystem-*`: public plugin SDK, API/CLI/automation, and two-client
  collaboration acceptance.
- `manual-*`: usability studies and native accessibility/visual review.

## Failure routing

| Failure kind | Owner |
| --- | --- |
| Product behavior or contract | Resume the implementation task that owns the PRD ID |
| Test/evidence harness defect | This qualification task |
| Platform packaging defect | Platform/product-shell task |
| Missing native credential/runner/user study | Remains an open qualification gate |
| Flaky or stale evidence | Fail the lane, fix determinism, rerun on the same candidate if code is unchanged |

## Workbench inherited gates

The visual-identity task supplies implementation and Windows automation. Native
macOS packaging must verify the four bundled families through the shipped
`file://` renderer, arbitrary Simplified Chinese coverage, local-only font
requests, and the <= 20 MiB WOFF2 payload. Native Windows/macOS manual review
uses the same light/dark/reduced-motion, keyboard, IME, contrast, and panel-mode
matrix; screenshots alone do not replace the interaction record.

## Security and reproducibility

- Evidence collectors accept only known fields and redact secrets/private paths.
- CI run IDs and artifact hashes bind external evidence to the candidate.
- Fixture generators are versioned and deterministic; benchmark conditions are
  explicit. Live provider variability cannot close deterministic acceptance.
- The final manifest is canonical JSON with SHA-256 hashes for every child
  record. A changed record invalidates the final hash.

## Rollback

Qualification tooling is additive and can be removed without changing user
data or product contracts. Product fixes use the rollback plan of their owning
task. A failed release candidate is retained as evidence and never force-updated
or relabelled as the final candidate.
