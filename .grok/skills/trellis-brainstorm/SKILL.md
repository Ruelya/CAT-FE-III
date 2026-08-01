---
name: trellis-brainstorm
description: "Planning method for Trellis Phase 1. Used by trellis-plan (and Orchestrator briefs): evidence-first requirements, design, and implement artifacts. Chooses the best complete approach from repo + brief — no user interview loop, no deliberately half-done MVP cuts."
---

# Trellis Brainstorm (Plan method)

Primary consumer: **`trellis-plan`** subagent under Grok Autoloop. Orchestrator supplies the brief; this skill does **not** drive a human Q&A loop.

## Contract

1. **No mid-loop user interviews.** Missing product intent → write explicit **assumptions** and pick the best coherent approach from repository evidence + Orchestrator brief.
2. **Evidence first.** Prefer code, tests, specs, prior tasks over invention.
3. **Complete quality for chosen scope.** Shrink *which* capabilities you include if needed; do **not** ship intentionally broken edges framed as “MVP”. Prefer shippable, coherent behavior for everything left in scope.
4. **Persist to task files** (`prd.md`, and for non-trivial work `design.md` + `implement.md` + curated jsonl). Chat-only plans are a failure.
5. **Do not** `task.py start`, edit product code, or commit — Orchestrator owns lifecycle and git.

## Flow

1. Ingest brief + read existing task artifacts.
2. Inspect repo (and `research/` if present) for facts and constraints.
3. Update `prd.md`: goal, background, requirements, acceptance criteria, out of scope, assumptions.
4. Non-trivial: write `design.md` (boundaries, contracts, data flow, trade-offs, rollback).
5. Non-trivial: write `implement.md` (ordered checklist, validation commands, risks).
6. Curate `implement.jsonl` and `check.jsonl` with real `{"file","reason"}` entries (seed `_example` does not count).
7. Convergence pass on `prd.md` (collapse temp sections; keep anchors and acceptance mappings).
8. Report readiness for start to Orchestrator.

## Artifact rules

**prd.md** — requirements and acceptance (not a dump of implementation steps).

**design.md** — technical design for complex tasks.

**implement.md** — execution checklist + validation; not a substitute for jsonl.

**jsonl** — context manifests for implement/review workers (`check.jsonl` feeds review, not a deleted trellis-check agent).

## Thinking (optional)

When stuck, use first-principles: restate the problem, list invariants, challenge assumptions, build up only what invariants require — still aiming at a **complete** slice, not a throwaway prototype.

## Quality bar before “plan complete”

- [ ] Acceptance criteria are testable
- [ ] Assumptions are explicit
- [ ] Complex tasks have design + implement
- [ ] jsonl curated when on sub-agent workflow
- [ ] No product code edited under this skill alone
