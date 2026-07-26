# Design: Tier 1 Declarative Host

## Architecture

```text
manifest v2 (runtime=declarative, entry=manifest)
  -> strict typed definition validation
  -> capability request/grant review
  -> Tier1DeclarativeHost::prepare(active version)
       -> DeclarativeDocumentFilter
       -> PluginQaPackRegistry entry
       -> DeclarativePipelineStep
  -> collision/capability preflight
  -> atomic registry publication
  -> operation-time authorization + audit
```

The Tier 1 host executes only Rust-owned, versioned data models. It never loads
package code, spawns a process, evaluates expressions, interpolates shell text,
or gives a contribution an Engine/SQLite handle.

## Definition contracts

The existing contribution descriptor metadata remains stable. Tier 1 adds a
tagged `declarative` definition to the filter and pipeline descriptors, while
the QA descriptor's existing `definition` is narrowed to a typed regex-pack
schema when runtime tier is declarative.

```text
DeclarativeFilterDefinitionV1
  encoding=utf8
  probeHeaderPattern?
  unitPattern (required named `source` capture; optional `id`/`context`)
  limits { maxSourceBytes, maxUnits, maxUnitBytes }

DeclarativeQaPackDefinitionV1
  rules[] -> QaRegexRule (field, bounded pattern, severity, message, hint?)

DeclarativePipelineDefinitionV1
  input/output ArtifactKind
  operations[] = select | set | assert | regexReplace
  maxOutputBytes
```

All JSON fields deny unknown names. Definitions are normalized once, compiled
before registry mutation, and stored only through the existing normalized
manifest/version record. No new SQLite migration is expected.

## Filter data flow

`probe` verifies the extension, bounded file length, UTF-8 decoding, and the
optional header expression. `import` applies one precompiled unit expression,
requires non-overlapping non-empty `source` captures, and emits start/unit/end
events whose structural path includes a deterministic ordinal and optional
manifest ID capture.

`export` reparses the immutable source and matches Engine segments by structural
path. Owned source spans are replaced from the end of the file toward the
beginning, so earlier byte offsets stay valid. The adapter reparses its staged
bytes, compares unit identities, and uses `publish_bytes_noclobber`; failure
removes staging and never replaces a destination.

## QA integration

Add an Engine-owned registry keyed by `(plugin_id, contribution_id)` whose
entries contain the active version, compiled rules, and authorizer. QA execution
resolves the normal stored profile, snapshots currently authorized plugin
rules, then evaluates both in deterministic ID order. The QA run snapshot hash
includes the serialized plugin rule snapshot. User profile rows are not
modified, and historic run items remain immutable after detach.

## Pipeline integration

`DeclarativePipelineStep` implements the existing `PipelineStep` trait over a
bounded JSON value. Operations use explicit JSON paths and precompiled regexes;
they cannot dispatch Engine methods. `StepRegistry` gains unregister and
owner-aware preflight semantics matching `FilterRegistry`. Cancellation is
checked before every operation and before returning the bounded output.

## Atomic lifecycle

`Tier1DeclarativeHost::prepare` returns inert compiled adapters. Engine checks:

1. active version and exact grants;
2. contribution IDs and built-in/reserved collisions;
3. complete definition compilation and limits;
4. every target registry preflight.

Only then are adapters published. If any publication unexpectedly fails,
already-published adapters are removed in reverse order and the plugin remains
disabled/inspectable. Disable, revoke, upgrade, rollback, and uninstall remove
entries by owner and active version, never by a stale bare ID.

## Compatibility

- Manifest v1 stays process-only and decodes unchanged.
- Existing manifest v2 descriptors without executable Tier 1 definitions stay
  valid inventory but remain incompatible with a typed reason; they are not
  silently assigned behavior.
- Tier 3 process filter behavior, package hashes, migrations 16-19, protocol v1,
  and existing plugin summaries remain additive and compatible.

## Rollback

- Capability advertisement for Tier 1 is added only after all registries pass
  restart and detach tests.
- A bad declarative candidate remains staged/diagnosable and cannot replace an
  enabled previous version.
- Removing Tier 1 advertisement leaves stored manifests and decisions intact;
  built-ins and Tier 3 continue operating.
