# Remaining PRD work plan (verified 2026-07-26)

This note refines the active Trellis cards without claiming unfinished work is
complete. It is based on the current task metadata, each active card's
implementation checklist, and `docs/Full PRD gap matrix.md`.

## Current active-card audit

| Card | Verified state | Action before archive |
| --- | --- | --- |
| `07-21-workbench-visual-identity` | WP1-WP5 are implemented; WP6-WP8 remain. | Finish truthful Preview, token migration, and final cross-platform evidence; then archive this card. |
| `07-19-plugin-runtime-sdk` | Runtime, storage, protocol, SDK, example, and panel are implemented. The checklist still leaves real-Engine desktop E2E, full quality gates, and spec sync open. | Run the listed gates, add the missing E2E/spec evidence, commit, archive. |
| `07-19-api-cli-automation` | The MVP API/CLI slice is present in commit `31487ef`; the card checklist is stale and the description also includes watch, clipboard, webhooks, and connector examples. | Reconcile evidence first. Close the MVP as its own card only if its acceptance criteria are met; create a separate automation-extension card for X-03..X-07. |
| `07-19-advanced-ai-quality` | The `ai-quality-core`/Engine MVP is present in commit `c7ad469`; its checklist is still skeletal. The gap matrix identifies cache, QE provider/model, terminology workflow, prompt templates, alternatives, adaptive few-shot, RAG, diagnosis, repair, LQA, and P2 assistance as separate bodies of work. | Close the verified MVP slice with tests/specs, then split the remaining work into bounded P1/P2 cards rather than extending one unbounded card. |
| `07-19-collaboration-server` | Local members/locks/presence/assignments/op-log primitives are present in commit `cb1bece`; no server/replication/authorization/UI qualification is recorded. | Close the local-primitives slice only after its quality gate; then split server transport, replica sync, lock enforcement/authorization, and desktop board/E2E. |
| `07-19-platform-packaging-product-shell` | Node 24 and the two visual child cards are tracked; the parent implementation plan still contains localization, data-directory migration, updater, crash recovery, tutorial, allowlist, release CI, and accessibility/governance. | Finish/archived visual child first, then execute one bounded shell package at a time. |
| `07-19-full-prd-release-qualification` | Still planning with `TBD` requirements. | Do not activate until the implementation cards have current evidence; then make it the final acceptance-mapping/release-evidence task. |

## Recommended execution order

1. Finish and archive Workbench visual identity (WP6, WP7, WP8).
2. Close the already-implemented plugin/API/AI-quality/collaboration MVP
   slices with their missing tests, specs, and commits; do not mix their
   unimplemented extension scope into those closure commits.
3. Execute product-shell packages in this order: locale infrastructure,
   backup/data-directory recovery, crash-safe drafts/restart, updater, tutorial
   and example project, engine allowlist, release packaging/CI, then
   accessibility/governance.
4. Split and implement advanced AI/quality extensions by contract boundary:
   persisted QE/review artifacts; terminology/consistency workflows; cache
   and prompt templates; alternatives/adaptive few-shot; RAG/diagnosis/repair;
   LQA/plugin rules; then P2 agentic/style/multimodal assistance.
5. Split collaboration by boundary: self-hosted server/auth, replica
   bootstrap and sync, lock/role enforcement, realtime presence/assignments/
   discussions, and desktop board/two-client qualification.
6. Activate release qualification only after the above cards have been
   independently committed and archived.

## Card hygiene rules for the next sessions

- A card is not complete because an MVP commit exists; its checklist, focused
  evidence, spec update, quality gate, commit, and archive must agree.
- A new card owns one independently verifiable contract and its own evidence
  directory. Do not create a second “follow-up” directory for the same active
  card unless Trellis explicitly requires it.
- Keep parent metadata as a roll-up only. The implementation truth lives in
  the child checklist and evidence; update the parent count after archiving a
  child.
- Preserve the protected Workbench reference screenshot and never stage it as
  incidental task evidence.
