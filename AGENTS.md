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

## Multi-agent policy (project override — not managed by Trellis)

- **`trellis channel` is disabled in this project.** Do not run `trellis channel …`, do not load the `trellis-channel` skill, and do not spawn channel workers / forum boards for CAT work.
- If a `trellis update` restores `trellis-channel` skill files, still treat channel as forbidden until this section is removed.
- **Grok autoloop (preferred on Grok Build):**
  1. Main session agent **`orchestrator`** (`~/.grok/agents/orchestrator.md`) — no `write`/`search_replace`; decides + spawns + git/task.py.
  2. Workers only: `trellis-plan` / `trellis-research` / `trellis-implement` / `trellis-review` / `trellis-verify` / `trellis-fix` / `trellis-closeout`.
  3. **Research:** plan-phase batch (+ rare implement escape); **not** for review/fix. **No `trellis-check`.** Quality = review (verify **mission**) ⇄ **trellis-verify** (rich report) ⇄ fix under `{task}/review/`.
  4. Orchestrator may recommend **high-value only** skills/MCP in worker prompts.
  5. Per task branch `task/<dir>` → commit → Orchestrator merges **main**. No default worktree/PR.
  6. Contract: `.trellis/workflow.md` (Grok Autoloop Mode) + `.trellis/spec/guides/autoloop-orchestration.md`. Optional: `.grok/workflows/trellis-autoloop.rhai`.
  7. Do **not** spawn `general-purpose` / `explore` / built-in `plan` for Trellis autoloop.
- **Also ok:** Orca for worktree/handoff when explicitly needed (not the default autoloop path).
- Trellis task artifacts remain process source of truth. Worker prompts start with `Active task: <path>`.

# Code Retrieval Guide
1. **基础检索 (Foundational Retrieval)**：
   * 禁止基于假设（Assumption）回答。
   * 任何需要理解代码上下文、探索性搜索、或通过自然语言定位代码的场景，**优先使用** `mcp__fast_context__fast_context_search`。
   * 使用自然语言（NL）构建语义查询（Where / What / How），获取项目上下文，尤其适用于新任务开始前的代码调研、架构理解、业务逻辑分析与调用链追踪。
   * **必须使 用 `fast_context_search` 的场景**：
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
