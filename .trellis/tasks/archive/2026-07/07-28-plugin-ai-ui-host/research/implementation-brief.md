# Implementation Brief

Active task: `.trellis/tasks/07-28-plugin-ai-ui-host`

You are already the `trellis-implement` worker. Follow
`.codex/agents/trellis-implement.toml`: implement directly in the shared
worktree and do not spawn another implement/check worker.

The worktree already contains a substantial uncommitted AI/UI implementation.
Treat it as a starting point, not as proof of completion. Review it against
every PRD requirement and acceptance criterion, then finish the complete child.

Required outcomes:

1. Strict Rust/SDK/generated AI action and panel v1 contracts, compatibility,
   bounds, and tests.
2. Engine-owned registries with full plugin/version/activation ownership,
   atomic lifecycle preflight/attach/detach/compensation, and stale-result
   protection.
3. Tier 2 action execution with exact grants, deadline/cancellation, bounded
   validated proposal output, provenance/history, and no direct mutation.
4. Real Desktop selection/assistant action integration and an explicit user
   acceptance path using ordinary revision-safe Engine mutation.
5. Real workbench panel registration/placement using the existing secure opaque
   iframe session and MessagePort boundary, with exact revoke/detach behavior.
6. Public-SDK deterministic action+panel example, docs, smoke/Electron tests,
   three-viewport evidence, and task validation evidence.
7. Update the implementation checklist and PRD AC boxes only when evidence
   proves them. Run at least format, lint, typecheck, contract drift, focused
   SDK/Rust/Desktop tests, and report remaining full-suite gates honestly.

Do not modify or stage unrelated Trellis/runtime platform-upgrade changes under
`.agent`, `.agents`, `.amp`, `.claude`, `.codex`, `.cursor`, `.devin`,
`.opencode`, `.trellis/scripts`, `.trellis/workflow.md`, `.trellis/config.yaml`,
`.trellis/.version`, `.trellis/.template-hashes.json`, or `AGENTS.md`.

Do not commit or archive. The main session owns final independent check, spec
sync, staging, commit, archive, and journal.
