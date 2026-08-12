# Release readiness

Status of the release gates, measured on the current tree rather than inherited
from an earlier freeze. Anything that could not be executed in this environment
is marked `blocked-external` with its exact prerequisite. Nothing is marked
green on the strength of an argument.

Last measured: 2026-08-12, Linux validation lane (Node 24.17.0, pnpm 10.18.3,
Electron 41.10.3), Xvfb with a window manager via `./scripts/linux-display.sh`.

## Quality gates

| Gate | Command | Result |
| --- | --- | --- |
| Format | `pnpm format:check` | pass |
| Lint | `pnpm lint` (eslint + clippy) | pass |
| Types | `pnpm typecheck` | pass |
| Unit and Rust tests | `pnpm test` | pass, 366 desktop renderer tests |
| Contracts | `pnpm contracts:check` | pass |
| Docs presence | `pnpm docs:check` | pass |
| Design system audit | `pnpm ui:audit` | pass, zero findings |
| Renderer build | `pnpm build:desktop` | pass |
| Engine smoke | `pnpm test:e2e:engine` | pass |
| Desktop E2E | `pnpm test:e2e:desktop` | 19 passed, 0 failed, 4 fixture-gated skips |
| Delivery budgets | `pnpm ui:perf` | pass, see `performance-budgets.md` |
| Visual and geometry | `pnpm ui:shots:matrix` | pass, zero findings, zero console errors |
| Packaging | `pnpm package:dir && pnpm release:package:check` | pass |

`format:check` and `lint` were red for a long time on this lane for a reason
that had nothing to do with code quality: `rustfmt.toml` pinned
`newline_style = "Windows"`, so every Rust file failed the check when checked
out with LF. That is now `Auto`, which is correct on both platforms.

## Historic hard blockers

The previous release qualification recorded ten hard blockers. Current status:

| ID | Blocker | Status now |
| --- | --- | --- |
| HB1 | Windows package missing the Engine binary | **resolved and verified.** `pnpm package:dir` emits `resources/engine/translunar-engine` and `release:package:check` confirms the architecture. Verified on Linux; the Windows path uses the same relative staging directory. |
| HB2 | Package size over the ceiling | **resolved for the unpacked tree.** 322.50 MB against the 420 MB unpacked limit. The 200 MiB installer ceiling still needs a real installer build on a Windows or macOS runner. |
| HB3 | PDF import failed without Poppler | **superseded** by the MinerU OCR pipeline, and the real-Engine PDF path is now an always-on E2E case rather than a skip. |
| HB4 | Format, rustfmt, and eslint red | **resolved.** See the table above. |
| HB5 | Node 22 lane not executed | `blocked-external`. Only Node 24.17.0 is installed here. Prerequisite: a runner with Node 22.17 or newer 22.x. |
| HB6 | macOS native package, fonts, VoiceOver | `blocked-external`. Prerequisite: a macOS runner. Nothing in this repository can substitute for it. |
| HB7 | 1M TM and multi-tier capacity campaign | `blocked-external`. Prerequisite: the large TM corpora, which are not in the repository. `pnpm benchmark:storage` covers the 100k tier only. |
| HB8 | Two-client collaboration acceptance | `blocked-external`. Prerequisite: a second client against a shared Engine. Local collaboration primitives are covered by unit tests and an always-on E2E case. |
| HB9 | Human usability and productivity studies | `blocked-external`. Prerequisite: human participants. Three scripted walkthroughs of the built application were performed instead and their findings were fixed; that is not a substitute for a study and is not claimed as one. |
| HB10 | Desktop E2E not zero-skip | **improved, not closed.** Seven skips became four. See below. |

## Remaining E2E skips

Three of the original seven fixture-gated skips were closed by making the test
produce its own fixture through the product rather than waiting for the
environment to supply one:

- **PDF review** now runs against the checked-in `fixtures/pdf/text-layout.pdf`
  by default. Poppler is a documented prerequisite of the build and is present.
- **Interop review** exports the bilingual review document through the product,
  then reads the same path back, so the export and import halves verify each
  other.
- **Interop table** reuses that exported document, which is what the bilingual
  table filter accepts.

Four skips remain, each with a precise prerequisite:

| Skipped case | Gate | Prerequisite to run it |
| --- | --- | --- |
| Task package open and preview | `TRANSLUNAR_TEST_TASK_PACKAGE_INPUT` | A `.tltask` file. The same export round trip was attempted and did not settle within the timeout, so it stays gated rather than shipping as a flaky always-on case. |
| Deep AI provider, run, apply | `TRANSLUNAR_P4_LOOPBACK_AI=1` | A loopback AI endpoint. The product is offline-first and ships no provider. |
| Deep plugin install and panel | `TRANSLUNAR_P4_PLUGIN_FIXTURE=1` | A packaged plugin artifact from `pnpm plugins:package`. |
| External connector console | `TRANSLUNAR_P4_CONNECTOR_FIXTURE=1` | A connector fixture and its credential. |

A skip is recorded as residual risk. It is never counted as pass evidence.

## What this does and does not claim

It claims that on the Linux validation lane, with the current tree, every
automated gate that can run here passes, the packaged application contains its
Engine, the renderer meets its delivery budgets, and the interface passes axe at
every impact level in both themes across four viewports, at 125 % text scaling,
and under reduced motion.

It does not claim macOS readiness, Node 22 readiness, installer size compliance,
capacity at one million translation units, two-client collaboration, or any
human-subject result. Those need the runners and fixtures named above.
