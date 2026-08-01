# `.trellis/agents/` notes (CAT)

Grok Build loads project workers from **`.grok/agents/trellis-*.md`**, not from this directory.

Files here (`plan.md`, `research.md`, `architect.md`) may be used by other tools or historical flows. For Grok Autoloop, treat them as **non-authoritative**. Prefer:

| Role | Authoritative path |
| --- | --- |
| Orchestrator | `~/.grok/agents/orchestrator.md` |
| Workers | `.grok/agents/trellis-plan.md`, `trellis-research.md`, `trellis-implement.md`, `trellis-review.md`, `trellis-verify.md`, `trellis-fix.md`, `trellis-closeout.md` |
| Process | `.trellis/workflow.md` + `.trellis/spec/guides/autoloop-orchestration.md` |

There is no `trellis-check` agent on Grok.
