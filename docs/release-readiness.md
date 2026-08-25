# Release readiness

## Current status: not release-ready, deliberately

The tree is a greenfield vertical slice. There are no installers, no code
signing, no update channel, and no packaged artifact of any kind (see
[packaging.md](./packaging.md)). Nothing in this repository should currently
be read as a shippable release qualification.

An earlier version of this document recorded a full release qualification of
the pre-greenfield implementation: gate tables, ten hard blockers, packaging,
accessibility, and performance evidence. That implementation has been removed
and none of those results carry over to this tree. The record remains in git
history; do not cite it as evidence about the current application.

## What is verified today

The gates that exist are the CI gates in `.github/workflows/ci.yml`, run
against the current tree:

| Gate | Command |
| --- | --- |
| Format | `pnpm format:check` |
| Lint (eslint + clippy) | `pnpm lint` |
| Types | `pnpm typecheck` |
| Unit and Rust tests | `pnpm test` |
| Contract drift | `pnpm contracts:check` |
| Engine E2E over stdio | `pnpm test:e2e:engine` |
| Desktop E2E (real Electron + real engine) | `pnpm test:e2e:desktop` |

They validate the vertical slice, not a release: project creation, document
import, edit and confirm, exact and fuzzy TM, termbases, pretranslate, QA,
export, honest AI degradation without credentials, and the agent review gate.

## What release readiness would additionally require

- A packaging pipeline (electron-builder or equivalent), installer artifacts,
  and installer smoke tests on real Windows and macOS runners.
- Code signing and macOS notarization wiring.
  [release-signing.md](./release-signing.md) records the planned setup; none
  of it is implemented.
- A durable storage layer to replace the whole-state `state.json`
  persistence.
- Capacity, performance, and accessibility measurements taken on this
  implementation rather than inherited from the deleted one.
