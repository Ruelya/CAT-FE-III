<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# Channel dispatch policy (CAT)

Session-level rule (not per-task). Workflow is channel-driven and uses Claude
for both implementation and independent quality checks unless the user
explicitly requests another provider.

## Implement → Claude

When Phase 2 needs implementation, main session:

```bash
trellis channel spawn impl-<topic> \
  --agent implement --provider claude --as implement \
  …
```

- Card: `.trellis/agents/implement.md` (`provider: claude`). Pass
  `--provider claude` explicitly so the durable channel log records routing.
- Implement workers edit the shared worktree directly with focused edits and
  run their scoped validation. Do not default to a diff-only handoff for the
  main session to re-apply; return a diff only when direct editing is genuinely
  unavailable or unsafe.
- Do **not** put this choice in `task.py start` / PRD.
- Main session only — workers must not re-spawn channel peers.

## Dispatch handshake (mandatory)

The main session must treat channel dispatch as a readiness protocol, not as
fire-and-forget process creation. For every targeted worker, keep this order:

```text
create → spawn → durable spawned/error → strict send → turn_started → wait done/error
```

- `channel spawn` is successful only when it returns after a new durable
  `spawned` event. A supervisor PID, a pid sidecar, or a zero exit status before
  that event is not a worker handle or a delivery acknowledgement.
- Every targeted prompt uses
  `--delivery-mode requireRunningWorker`. A non-zero `send` (including an
  `undeliverable` event) is a dispatch failure; stop and inspect raw events
  instead of waiting for a worker result.
- After a successful send, confirm a `turn_started` event for the target before
  beginning a long `done`/`error` wait. Use `trellis channel messages <name>
  --raw` when diagnosing any gap.
- Keep create, spawn, readiness confirmation, and the first send in one host
  execution context when possible; short-lived shells may reap a detached
  supervisor before it finishes its startup handshake.
- Do not use `--tag`, infer completion from message text, or mechanically
  re-apply a worker's diff when the worker can edit the shared worktree. A diff
  handoff is only a fallback when direct editing is genuinely unavailable or
  unsafe.

## Check / other → stock template

```bash
trellis channel spawn cr-<topic> --agent check --provider claude --as check …
# optional cross-provider: --provider claude|codex --as check-cc|check-cx
```

Claude remains the default for check, research, and finish steps.

Check prompts follow the same readiness and strict-delivery handshake above;
the main session reads raw events and retains final judgment.

# Code Retrieval Guide
1. **基础检索 (Foundational Retrieval)**：
   * 禁止基于假设（Assumption）回答。
   * 任何需要理解代码上下文、探索性搜索、或通过自然语言定位代码的场景，**优先使用** `mcp__fast_context__fast_context_search`。
   * 使用自然语言（NL）构建语义查询（Where / What / How），获取项目上下文，尤其适用于新任务开始前的代码调研、架构理解、业务逻辑分析与调用链追踪。
   * **必须使用 `fast_context_search` 的场景**：
     - 探索性搜索（不确定代码所在文件或目录）
     - 用自然语言描述要找的逻辑（如“XX部署流程”“XX事件处理”）
     - 理解业务逻辑和调用链路
     - 跨模块、跨层级查询（如从 router 追到 service 再到 model）
     - 新任务开始前的代码调研和架构理解
     - 中文或中英文混合语义搜索
   * **根据需求选择工具**：
     - 语义搜索 / 不确定位置 → `fast_context_search`
     - 精确关键词搜索 → `Grep`
     - 已知文件路径，查看内容 → `Read`
     - 按文件名模式查找 → `Glob`
     - 编辑已有文件 → `Edit`
   * **`fast_context_search` 参数调优建议**：
     - `tree_depth=1, max_turns=1`：快速粗查，适合小项目或初步定位
     - `tree_depth=3, max_turns=3`：平衡精度与速度，适合大多数场景
     - `max_turns=5`：深度搜索，适合复杂调用链追踪
     - `project_path`：指定搜索的项目根目录，默认为当前工作目录
   * **完整性检查**：必须获取相关类、函数、变量的完整定义与签名。若 `fast_context_search` 返回的上下文仍不足，必须继续使用 `Read`、`Grep` 等工具补全定义；若仍不清晰，触发后续检索步骤。# Write your prompt here
