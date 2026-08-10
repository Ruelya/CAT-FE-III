# Frontend Type Safety

## Contract Source

Import engine entities and method payloads from `@translunar/contracts`.
`crates/protocol` generates `packages/contracts/src/protocol.schema.json` and
`protocol.generated.ts`; run `pnpm contracts:check` after any protocol change.
Do not hand-maintain a parallel interface in `renderer`.

Use `import type` for types. The repository ESLint configuration enforces
consistent type imports, forbids explicit `any`, and checks floating promises
and misused promises. Keep `strict` TypeScript projects passing for Electron,
renderer, and E2E configs.

## Boundary Types

Treat external/IPC values as `unknown` until the boundary validates them.
`DesktopApi` in `src/shared/desktop-api.ts` is the only renderer bridge, and
`global.d.ts` augments `Window` with that exact interface. Use generated method
maps to preserve the method-to-params/result relationship.

```ts
export interface DesktopApi {
  invoke<Method extends EngineMethod>(
    method: Method,
    params: EngineParams<Method>,
  ): Promise<EngineResult<Method>>;
}
```

In catch blocks use `unknown` and normalize through a small helper such as
`toUiError` in `lib/errors.ts`. Narrow DOM events through `currentTarget`, and
use explicit unions for finite UI states (surface kinds, save state, draft
classification, session parse result) rather than arbitrary strings.

Engine invocations go through `lib/rpc.ts` so method names stay tied to the
generated catalog. Do not hand-write parallel request/response interfaces for
Engine methods.

## Data And Reducers

Prefer discriminated unions for action-like values. Examples:

- Session: `SessionParseResult` in `state/session.ts`
- Draft journal: `DraftClassification` in `state/draft-recovery.ts`
- Startup destination: `StartupDestination` in `routes/resolveSurface.ts`
- App surface / boot machine: `state/app-state.ts` (includes P1
  `templates` | `recycle` | `search` | `insights`)
- Search hit destination: `SearchHitDestination` in `state/search-navigation.ts`
- Template definition decode: `DecodeTemplateDefinitionResult` in
  `state/template-definition.ts`
- Document aggregate / post-delete route: `state/document-navigation.ts`

Keep IDs and optional fields explicit; do not use truthiness to reinterpret a
numeric count or revision.

When a payload is `unknown`, create one decoder/type guard next to its owner
and share it. Do not cast the same JSON field independently in multiple
components.

### Convention: Unknown-preserving template definition

Template `definition` is generated as `unknown`. Only
`template-definition.ts` may narrow it:

- Decode P1 keys `sourceLocale`, `targetLocale`, `domain` from a plain object.
- Non-object definitions are `invalid-definition` for edit merge.
- Create emits a plain object with only those three keys.
- Update spreads the fetched object and overwrites only the three P1 keys so
  asset/profile/editor/reference keys survive.
- Surfaces must not `as TemplateDefinition` or rebuild definition from form
  fields alone on update.

## Avoid

- No `any`, `as any`, or `// @ts-ignore` to silence a contract mismatch.
- No stringly typed method names outside the generated method catalog.
- No non-null assertion for user/engine data; handle the absent case.
- No duplicate `Segment`/`QaIssue` declarations in renderer code.
- No converting errors to `String` until the display boundary.

## Task Package Contracts

Use `TaskPackagePreviewResult`, `TaskPackagePreviewRow`,
`TaskPackageDisposition`, and the generated method map for every package
surface. `TaskPackageApplyParams` contains only the preview ID, expected
project revision, selected row IDs, actor, and reason; do not add a local
`requestDigest` field or hash helper. `selectTaskPackageInput` returns
`string | null` and is the only renderer path for selecting a package file.

Keep `TaskPackageMode` and busy/terminal state as finite unions. Render
optional projections with explicit fallback branches and pass Engine row IDs
unchanged; do not duplicate protocol interfaces or reinterpret disposition
strings in a second decoder.
