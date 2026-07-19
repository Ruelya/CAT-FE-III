# Technical Design: Professional Translation Editor

## 1. Boundary And Data Flow

```text
React virtual editor / command registry
  -> generated segment.editor.* / editor.* RPC
  -> Engine validation and orchestration
  -> Store immediate transactions
  -> segments + tags + comments + findings + revisions + operation cursor
```

The existing `segment.list/updateTarget/confirm` methods remain. A richer
editor projection and mutation namespace is additive. Renderer state is a
cache: every mutation replaces affected rows from the Engine result.

## 2. Domain And Migration

Migration 6 adds:

- `segment_editor_meta`: workflow state, source edit revision, lineage and
  split/merge eligibility;
- `segment_comments`: durable threaded comments with revision/resolution;
- `editor_operations`: reversible mutation payloads plus undone/redo branch;
- `editor_cursors`: project undo cursor and generation;
- `review_revisions`: proposed before/after target/source/tag payloads and
  accepted/rejected state;
- `user_dictionary`: normalized locale/word entries;
- `editor_preferences`: one durable workspace preference record;
- indexes for document ordinal/search, comments, operations and review state.

Target tags continue in `inline_tags` with `side='target'`; mutation replaces
only target-side rows in the same segment transaction. Imported source/target
tags are preserved. Split uses derived structural paths
`<original>#split:<lineage>:<part>`; merge stores ordered original lineage.
Only filters declaring structural editing support may export these paths.

## 3. Protocol

Additive protocol-v1 methods:

```text
segment.editor.list
segment.tag.set
segment.chinese.convert
segment.propagate
segment.find
segment.replace.preview / segment.replace.apply
segment.split / segment.merge
segment.correctSource
segment.comment.list/create/update/resolve/delete
segment.spell.check / dictionary.add/remove/list
editor.undo / editor.redo / editor.history
review.create/list/accept/reject
editor.preferences.get/update
```

`segment.editor.list` accepts document, bounded page, filter, query and stable
sort, returning rows with `Segment`, source/target tags, comment/open finding
counts and total. Mutation results return all affected rows, counts, operation
ID and optional focus segment. Preview/apply uses an opaque hash over project,
scope, query/options, ordered IDs/revisions and replacements.

`segment.chinese.convert` accepts one of the six Simplified/Traditional/Taiwan/
Hong Kong conversion profiles. The Engine applies the embedded OpenCC phrase
dictionary, clamps target tag positions to the converted text, and records the
result as one revisioned editor operation.

## 4. Commands And Transactions

A single Store mutation helper starts an immediate transaction, validates every
expected revision, captures before state, applies rows/tags/comments, recomputes
counts/hashes/findings, appends an editor operation, advances the undo cursor,
then commits. Undo applies the stored inverse only when current revisions match
the operation's result. Redo applies the forward payload under the same rule.
New mutations after undo increment a generation and make later redo records
ineligible without deleting them.

Propagation queries same-project segments by source hash and updates only
untranslated/draft rows. Replace preview never writes; apply rechecks token and
revisions inside one transaction. Split/merge renumber affected ordinals once
using a collision-safe temporary offset and update document segment_count.

## 5. Tag And Text Model

Positions are Unicode scalar indices, converted to byte offsets only at the
Rust boundary. Tag sets contain existing source-tag IDs plus target position;
payload, kind, pairing and protection are copied from source identity. Validation
checks membership, duplicates, pair completeness/order/nesting and position.
Export receives target text plus target tags; filters with inline markup rebuild
owned text from this structured representation.

Source correction rejects confirmed/signed rows, requires a reason, recomputes
source/context hashes for the row and neighbors, and resolves/reopens dependent
QA. PDF OCR paths must continue to use `pdf.correctOcr`.

## 6. Spell, CJK And Preferences

A `SpellProvider` trait exposes capability and bounded findings. The built-in
provider invokes Hunspell without a shell, with configured/platform dictionary
lookup, timeout/output limits, and user-dictionary overlay. CJK deterministic
checks are Rust-native. OpenCC conversion uses the pure-Rust
`ferrous-opencc` embedded dictionaries with no download, subprocess, or
runtime corpus lookup. Preference mutation validates theme, zoom 75..200,
command IDs, normalized accelerators, and collisions before persistence.

## 7. Renderer

Extract editor orchestration from `Workbench.tsx` into focused hooks/components:

- `useEditorRows`: paged/virtual data and mutation replacement;
- `EditorGrid`: virtual window with fixed/observed row heights and overscan;
- `SegmentEditor`: textarea plus tag overlay/capsules and IME-safe commands;
- `CommandPalette`, `FindReplaceDialog`, `CommentsPanel`,
  `EditorPreferencesPanel`, `ReviewDiffPanel`;
- central `editor-commands.ts` registry consumed by keydown and palette.

The grid requests bounded windows and retains dirty active rows until acknowledged.
Theme/zoom/nonprinting are CSS variables/classes; no export data depends on them.

## 8. Compatibility And Rollback

Migration 6 is additive and backed up before application. Old clients keep using
plain segment methods. New UI can fall back to existing segment list if the
capability is absent during development, but release tests require it. Feature
rollback hides new commands while preserving tables/history. No rollback path
rewrites immutable managed sources or deletes operation history.
