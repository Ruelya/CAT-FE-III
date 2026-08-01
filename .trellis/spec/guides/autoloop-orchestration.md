# Autoloop Orchestration Contract (Grok)

Project-local contract for **human-starts-only**, Orchestrator-driven Trellis loops on Grok Build. Canonical process also lives in `.trellis/workflow.md` (Grok Autoloop Mode). This guide is the shared file schema and agent whitelist for workers.

## Roles

| Role | Who | Write product code? | Notes |
| --- | --- | --- | --- |
| Orchestrator | Main session (`orchestrator` agent) | No (`write` / `search_replace` disallowed) | Decide, spawn, shell for git + `task.py`, merge to main; may recommend high-value skills/MCP in worker prompts |
| trellis-plan | Subagent | Task artifacts only | Plan / design / implement checklist / jsonl; may request research |
| trellis-research | Subagent | `research/` only | **Plan-phase** evidence gatherer (batched); not used in review/fix |
| trellis-implement | Subagent | Yes | Light lint/typecheck; read code itself when stuck; may *report* need for research to Orchestrator only |
| trellis-review | Subagent | Findings + verify **briefs** | Judgment + verify missions; **never** requests research |
| trellis-verify | Subagent | Verify **reports** (rich) | Investigative verifier; run, diagnose, surface issues for review |
| trellis-fix | Subagent | Yes (findings only) | break-loop when thrashing; **never** requests research |
| trellis-closeout | Subagent | Spec / task closeout notes | `trellis-update-spec` work; no product features |

**Banned spawn targets for Trellis autoloop:** `general-purpose`, `explore`, built-in `plan`, `trellis-check` (removed).

**Depth:** only Orchestrator may `spawn_subagent` (platform max depth 1). Use `resume_from` to continue a completed worker with new evidence.

## When to spawn `trellis-research` (concentrated, not scattershot)

Research is a **plan-phase gate**, not a sticker on every step.

### Allowed

| When | How |
| --- | --- |
| **Primary:** plan reports non-empty `research_needed` | **One** `trellis-research` spawn with the **full question list** packed in one prompt (writes one or more `research/*.md`). Then plan `resume_from` / re-spawn once. |
| **Escape (optional):** implement reports it cannot proceed without broad/external evidence after self-reading code | Orchestrator may allow **at most one** extra research spawn per task, then back to implement. Prefer implement reading the tree itself. |

### Forbidden

| When | Do this instead |
| --- | --- |
| **review** needs evidence | **Verify mission** → `trellis-verify` (runtime/static on *this* change). Never spawn research for review. |
| **fix** thrashing | **`trellis-break-loop`** (+ more fix). Never spawn research for fix. |
| One question → one research agent | Always **batch** questions into a single research dispatch. |

### Quotas

- Default **≤ 2** research spawns per task (1 plan-batch + 1 implement-escape).
- Quality loop (review / verify / fix): **0** research spawns.

### Separation

| Worker | Answers |
| --- | --- |
| research | “What does the codebase / external world look like?” → `research/*.md` (before or rarely mid implement) |
| verify | “Does *this* change satisfy the review judgment?” → `review/verify-N.md` |
| review | Judgment + missions; reads existing research via jsonl if plan already attached it |

Flow:

```text
plan → (research_needed? batch once) → research → plan resume → start → implement
implement → (rare escape research) → implement
review → (need_verify) → verify → review → fix → …   # no research
```

## Orchestrator: skill / MCP recommendations

Orchestrator **may** append a short `Recommended tools` block to a worker prompt **only when** value is clear:

- Name the skill or MCP server/tool and **one line why** it helps this exact task.
- Prefer project/user skills already known useful (e.g. `trellis-before-dev` for implement context, `trellis-break-loop` for fix thrash, Context7 for library docs, firecrawl only if external pages required).
- **Do not** dump long skill menus. **Do not** recommend low-value or speculative tools.
- Workers treat recommendations as optional guidance, not mandatory if the tool is unavailable.

Example dispatch fragment:

```text
Recommended tools (optional, high value for this job):
- skill trellis-before-dev — load package Quality Check before coding crate X
- MCP context7 — confirm Foo crate API for version in Cargo.lock
```

## Git

1. Start from up-to-date `main`.
2. Per task: branch `task/<task-dir-slug>` (e.g. `task/07-31-foo` from task dir name).
3. Record branch: `python ./.trellis/scripts/task.py set-branch <name> <branch>`.
4. All worker edits happen on that branch.
5. When quality loop is green and closeout done: Orchestrator commits once (or a small coherent set for that task only), then merges into `main`.
6. Serial tasks only by default (one active task branch at a time).
7. No default worktree; no default PR.

## Quality inner loop

```text
review → (optional verify mission) verify → review (resume_from) → fix → …
```

- Default **max quality rounds** per task: **5** (Orchestrator may lower).
- Exit green: no open severity≥blocker (and major unless waived) **and** any required verify missions have usable reports (not merely exit 0 without analysis).
- Exit fail: max rounds / hard infra → `{task}/review/BLOCKED.md` and stop outer loop.

### Review → Test is a **mission**, not a command dump

When `need_verify` is true, review writes a **Verify mission** section that answers:

1. **Why** evidence is needed (what judgment is blocked without it)
2. **What question** the verifier must answer (hypothesis / risk)
3. **Success / fail criteria** in product terms (not only exit codes)
4. **Suggested commands** (starting points; verifier may adjust for selectivity)
5. **Scope** (packages, tests, paths) and **what not to run** (full monorepo unless final pass)

Bare `commands: [...]` without why/purpose is **invalid** — Orchestrator should re-dispatch review.

### Findings file

Path: `{TASK_DIR}/review/findings-{N}.md` (N = 1,2,… quality round)

```markdown
# Findings round N

## meta
- task: <path>
- branch: <name>
- head_sha: <sha or unknown>
- round: N

## need_verify
- required: true|false

### Verify mission (required if need_verify)
- purpose: <why this evidence matters for the review judgment>
- questions:
  - <Q1 the tester must answer>
  - <Q2 …>
- success_criteria:
  - <observable: e.g. typecheck clean for crate foo; tests bar::* pass>
- failure_signals:
  - <what constitutes a real problem vs noise>
- suggested_commands:
  - `cargo test -p foo --lib`
- scope: <packages/paths>
- avoid: <e.g. full workspace test unless final pass>
- related_issues: <F1, F3 ids this mission is meant to confirm/refute>

## issues
### F1
- severity: blocker|major|minor|nit
- files: `path:line` …
- problem: …
- minimal_fix: …
- status: open|fixed|wontfix|needs_evidence

## assumptions
- …

## summary_for_orchestrator
- one paragraph
```

### Verify report file (rich — not pass/fail only)

Path: `{TASK_DIR}/review/verify-{N}.md`

`trellis-verify` is an **investigative verifier**. A report that is only `pass|fail` is **incomplete**.

```markdown
# Verify report round N

## mission_echo
- purpose: <copy/summarize from findings>
- questions_addressed:
  - Q1: <answer in prose>

## environment
- cwd, toolchain notes if relevant
- deviations from suggested commands and why

## actions
### A1
- command: `…`
- exit_code: N
- duration_note: optional
- log_excerpt: |
    <tail/relevant lines only; truncate huge logs>
- interpretation: <what this result means for the mission>

## findings_for_reviewer
### V1
- severity: blocker|major|minor|info|noise
- related_review_ids: F1 | new
- title: <short>
- evidence: <file:line, test name, error code>
- detail: <what failed or was proven>
- suggested_next: fix_recipe_hint | re-run_with | out_of_scope

## unanswered
- <mission questions still open and why>

## overall
- mission_status: satisfied|partial|failed|blocked_infra
- summary_for_reviewer: <paragraph: what is now known, what is still risk>
- recommended_review_focus: <where review should look next>
```

**Rules for verify:**

- Prefer package/path-scoped commands (slow monorepo).
- If a command fails, **triage**: compile error vs test assertion vs environment; extract the primary error, not only exit code.
- Surface **new** issues discovered while verifying (even if not in original findings).
- Do not silently “pass” when logs show warnings that match `failure_signals`.
- Prefer not editing product code; tiny run-blocking config may be noted.

### Fix contract

- Read the latest `findings-*.md` with open issues **and** latest `verify-*.md` for evidence.
- Change only what those issues require.
- Do not expand scope or redesign.
- After repeated failed fixes on the same issue class, load skill `trellis-break-loop`, write `{TASK_DIR}/review/break-loop-{topic}.md`. Do **not** call for research.

## Outer / middle loops

```text
outer: until goal done
  plan ⇄ research (batch, plan-phase only; ≤2/task)
  start + branch
  implement (self-read first; rare research escape)
  quality: review ⇄ verify(mission) ⇄ fix   # no research
  closeout → commit → merge main
```

- Prefer continuing existing code over greenfield.
- Prefer **complete quality** for chosen scope (no deliberately broken “MVP” edges).

## Context manifests

- `implement.jsonl` — specs + **research/*.md** for implement.
- `check.jsonl` — specs + research for **review**. After research runs, Orchestrator/plan should add new research files to the relevant jsonl.

## resume_from

```text
spawn trellis-review with resume_from=<prior review id>
prompt: path to verify-N.md (rich report) / post-fix summary
```

Reviewer must **read the full verify report** (mission answers, V* findings), not only overall pass/fail.

## Related

- `.trellis/workflow.md` — Grok Autoloop Mode
- `.grok/agents/trellis-*.md` — worker definitions
- `~/.grok/agents/orchestrator.md` — Orchestrator
- `.grok/workflows/trellis-autoloop.rhai` — optional hard state machine
