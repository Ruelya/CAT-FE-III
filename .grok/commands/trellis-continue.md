# Continue Current Task

Resume work on the current task — pick up at the right phase/step in `.trellis/workflow.md`.

---

## Step 1: Load Current Context

```bash
python ./.trellis/scripts/get_context.py
```

Confirms: current task, git state, recent commits.

## Step 2: Load the Phase Index

```bash
python ./.trellis/scripts/get_context.py --mode phase
```

Shows the Phase Index (Plan / Execute / Finish) with routing + skill mapping.

## Step 3: Decide Where You Are

`get_context.py` shows the active task's `status` field. Route by `status` + artifact presence. This command replaces the user needing to remember the Trellis flow; it does not itself approve implementation.

- `status=planning` + no `prd.md` → **1.1** (`trellis-plan` / brainstorm method)
- `status=planning` + `prd.md` only → lightweight → **1.4**; complex → **1.1** for `design.md` + `implement.md`
- `status=planning` + complex artifacts complete + jsonl seed-only → **1.3**
- `status=planning` + artifacts + jsonl ready → **1.4** (`task.py start`; Grok autoloop: no user confirm gate) + task branch
- `status=in_progress` + implementation not started → **2.1**
- `status=in_progress` + implementation done, quality not green → **2.2** (review/test/fix)
- `status=in_progress` + quality green → **3.3** closeout → **3.4** commit + merge main
- `status=completed` (rare) → archive flow

Canonical detail: `.trellis/workflow.md` **Grok Autoloop Mode**.

Phase rules (full detail in `.trellis/workflow.md`):

1. Run steps **in order** within a phase — `[required]` steps must not be skipped
2. `[once]` steps are already done if the required output exists. `prd.md` alone can be enough only for lightweight tasks; complex tasks also need `design.md` and `implement.md`.
3. You may go back to an earlier phase if discoveries require it

## Step 4: Load the Specific Step

Once you know which step to resume at:

```bash
python ./.trellis/scripts/get_context.py --mode phase --step <X.X> --platform grok
```

Follow the loaded instructions. After each `[required]` step completes, move to the next.

---

## Reference

Full workflow and detailed phase steps live in `.trellis/workflow.md`. This command is only an entry point — the canonical guidance is there.
