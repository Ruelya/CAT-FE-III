# Development Notes for AI Assistants

Translunar CAT is a local-first desktop CAT tool: an Electron/React renderer
in `apps/desktop` talking JSON-RPC 2.0 over stdio to a headless Rust engine
(`crates/tl-engine`). Read `docs/architecture.md` before changing either side
of that boundary, and `docs/contributing.md` for the full quality gate.

## Git identity (mandatory)

The default integration branch is `main`. Open every pull request against `main`.

Every commit's **author and committer** must be exactly:

`Ruelya <239264465+Ruelya@users.noreply.github.com>`

(`Ruelya@users.noreply.github.com` is also accepted.)

Do not use `Cursor Agent`, `cursoragent@cursor.com`, `ruelya.miko@gmail.com`,
or any other name/email. Do not add `Co-authored-by` / `Co-author` trailers.
Override the environment git config when it is `Cursor Agent`. Local hook:
`.githooks/commit-msg`. CI: `.github/workflows/commit-identity.yml`.

## Hard boundaries

- The Rust engine owns every domain rule, state transition, and persistent
  write. The renderer must not implement TM scoring, QA rules, segmentation,
  or format filtering.
- Generated protocol contracts (`packages/contracts`, generated from
  `crates/tl-protocol`) are the only renderer wire types. After a protocol
  change run `pnpm contracts:generate` and commit the result;
  `pnpm contracts:check` fails on drift.
- AI assist and the asynchronous agent degrade honestly without credentials.
  Never add a code path that pretends to work when no provider is configured,
  and keep every agent run parked at the human review gate.
- Design authority for visible UI is the INSTRUMENT token set in
  `packages/ui/src/tokens.css`. No hardcoded colors, no glass, one accent.

## Quality gate

Run from the repository root; these are the same commands CI runs
(`.github/workflows/ci.yml`):

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:check
pnpm test:e2e:engine
pnpm test:e2e:desktop   # on Linux: ./scripts/linux-display.sh pnpm test:e2e:desktop
```

## Reusable skills

`.agents/skills/` holds portable frontend-taste skills
(`design-taste-frontend`, `ui-ux-pro-max`). See `.agents/skills/README.md`
for how and when to apply them; they never override the token set.
