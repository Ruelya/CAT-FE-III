# AI AutoSuggest：对照 IDE，挂在当前段上

> **Historical record (pre-greenfield).** This research/contract targeted the
> previous implementation (`editor.suggest`, `crates/engine`), which was
> removed in the greenfield reset. Methods and paths named here do not exist
> in the current tree. See [architecture.md](./architecture.md) for the
> current AI surface (asynchronous `ai.assist.*` requests and the agent).

日期：2026-08-15。性质：调研 + 实现合同。P1–P3 已挂到目标框；无密钥时 AI 车道静默。
本文回答：Cursor / VS Code / Devin 的补全到底是什么，以及本项目应如何
做**上下文感知**的 AI 自动补全，而不新开引擎协议、不把聊天或代理当成主入口。

对照物：本仓库已交付的 `editor.suggest`（T6）与 `ai.run` + `build_grounding`。
主参照：VS Code Inline Completions、GitHub Copilot、Cursor Tab、Devin Agent；
CAT 侧参照 Trados AutoSuggest / AI Assistant（docs.rws.com）。

---

## 1. IDE 补全实际分成三层，不能混为一谈

| 层 | 代表 | 形态 | 延迟预算 | 上下文 | 接受 |
| --- | --- | --- | --- | --- | --- |
| 符号补全 | VS Code IntelliSense / LSP | 下拉列表 | <100ms，同步 | 当前文件符号、语言服务 | Enter / Tab |
| 行内续写 | Copilot、Cursor Tab、VS Code InlineCompletions | 光标后幽灵字 | 200–400ms，异步可取消 | 当前文件 + 近邻 + 最近编辑 +（Cursor）仓库索引 | Tab 全收、Esc 弃、Ctrl+→ 收一词 |
| 代理改写 | Devin、Copilot Agent、Cursor Composer | 任务计划 → 多文件 diff / PR | 秒到分钟 | 整仓、终端、测试 | 人审 PR，不是按键 |

Cursor Tab 的官方合同（cursor.com/help/ai-features/tab）：根据**最近编辑、
周围代码、linter 错误**出幽灵字；Tab 全收、Esc 或继续打字即弃；可一词接受；
还可预测下一编辑位置（jump）甚至跨文件。底层是为「大上下文、小输出」训的
专用模型（Fusion / MoE），不是把 ChatGPT 塞进每个按键。

Devin **不是补全**。它是沙箱里的代理：计划、改多文件、跑测试、开 PR。
对应本产品的是预翻译 / 批处理，不是目标框里的 AutoSuggest。

VS Code 把两套 API 分开：`CompletionItemProvider`（下拉）与
`InlineCompletionItemProvider`（幽灵字）。多 provider 并行，可用 `yieldTo`
让确定性源压过慢的 AI 源。取消靠 `CancellationToken`。

**对本项目的结论：** 要抄的是「两套 API、两套延迟、一套光标」，不是 Cursor
的自定义模型、跨文件 jump，也不是 Devin 的代理。

---

## 2. 映射到段级编辑器（不能按代码编辑器原样搬）

| IDE 概念 | 本产品对应 | 已有落点 |
| --- | --- | --- |
| 当前文件 | **当前段**（源 + 正在打的目标 + 光标） | 网格活动行 |
| 打开的邻文件 / 前后函数 | 前后段双语 | `GroundingOptions.includeContext`，默认 ±2 |
| LSP 符号 | 术语 preferred / forbidden、源文不可译 | `editor.suggest` 的 term / nonTranslatable |
| 最近编辑 | 刚确认写入 TM 的句、本段未 flush 的草稿 | TM search；**草稿必须进 prompt**（见 §5） |
| linter | 本行 QA / 缺标签 | 行标记；补全 v1 不读 QA |
| 仓库索引 | 项目 TM + 语料 | grounding 的 tm / corpus |
| Tab 收幽灵字 | 收下拉或收幽灵续写 | 已有 Tab/Enter 收下拉 |
| 下一编辑 jump | 确认后跳下一段 | 已有 Ctrl+Enter |
| 跨文件 portal | 同 source_hash 传播 | 已有 confirm 传播 |
| Agent / PR | 预翻译、批量 AI | T8 / `ai.run` batch；**不要做成打字补全** |

翻译补全的输出必须是**目标语言的续写或词补全**，且受术语约束。代码补全
可以猜 API；译错一个 preferred 术语是产品事故。

---

## 3. 本仓库今天已经有什么

### 3.1 确定性 AutoSuggest（T6，已交付）

- 协议：`editor.suggest`（`EditorSuggestParams`：`projectId`、`segmentId`、
  `targetText`、`caret`、`limit`）。
- 引擎：`suggest_for_editor` 从**当前段源文**抽不可译、查术语、查 TM 片段，
  `rank_suggestions` 排序：不可译 > 术语 > 记忆片段；前缀匹配、去重。
- 渲染：`useSuggestions` 90ms 防抖、至少 2 字符、generation token 丢弃过期
  响应、Esc 后同一 prefix 不再弹出。
- UI：`SuggestionPopup` 锚在光标上方；Tab / Enter 接受，Esc 关。
- **上下文缺口：** 只用当前段源文。不看前后段、不看已打的整句目标（只看
  caret 词前缀）、不看 AI、不看 QA。

### 3.2 段内 AI（A1 半交付）

- `useSegmentAi` → `ai.run.start` + poll `ai.run.get`。动作是整段
  translate / improve，结果进 IntelDock，**Apply to target** 整段替换。
- 引擎 `build_grounding` **已经**打包：术语（含 forbidden）、TM（带前后
  hash）、语料、前后段、标签骨架、当前已存目标。默认
  `include_terms/tm/corpus/context/style = true`，`context_before/after = 2`。
- ** complementary，不是补全：** 人按一次 Generate，不是每个键。无密钥时
  IntelDock 诚实提示。

### 3.3 键位冲突（实现时必须先守住）

| 键 | 现在 | AI 幽灵字时 |
| --- | --- | --- |
| Tab / Enter | 有下拉则接受候选；QuickPlace 打开则放置 | **下拉优先**；仅当下列表空且有幽灵字时 Tab 收幽灵字 |
| Ctrl+Enter | 确认本段 | 永不改成接受补全 |
| Esc | 关下拉 | 同时取消进行中的 `ai.run` 视图 |
| Ctrl+→ | 未占用 | 一词接受（P3） |
| IME 组合 | 不弹下拉 | 不发 AI、不抢候选窗 |

行内第一钮仍是 Confirm。隐藏 `textarea` 的 testid 合同不变。

目标框里已有的 `data-ghost` 是**未闭合标签**，不是补全。补全预览用
`data-testid="inline-completion"`，不得写入 `serializeTaggedEditor`。

---

## 4. 目标形态：两条车道，一个光标

```
按键
  ├─ 90ms  → editor.suggest     → 下拉（词/短语，确定性）
  │                              └─ 可选：第一条的「未打完后缀」画成幽灵字
  └─ 400ms → ai.run.start        → 仅当有 credential
             action=freeform
             options=GroundingOptions 默认（术语+TM+前后段）
             prompt = 活草稿 + 光标 +「只返回续写」
             poll / 过期丢弃
             └─ 幽灵字（句级续写），不得自动写入
```

对标 VS Code：下拉 = CompletionItemProvider，幽灵字 =
InlineCompletionItemProvider，`yieldTo` = 确定性源压过 AI。

对标 Cursor：抄「幽灵字 + 可取消 + 过期丢弃 + 周围上下文」，不抄
next-edit jump、跨文件 portal、自研 Tab 模型、按接受率做 RL。

对标 Devin：整单/批量才走代理；打字补全禁止变成「AI 把这一单做完」。

对标 Trados：AutoSuggest 仍是多源下拉；AI Assistant 仍是段内候选。
本方案把 AI Assistant 的「生成」压到光标上，但不取代术语/TM 下拉。

---

## 5. 上下文感知：复用 grounding，活草稿走 prompt

**禁止**为补全新开 `editor.suggestAi` / `ai.complete`。上下文打包已经在
`crates/engine/src/ai.rs` 的 `build_grounding` + `build_grounded_prompt`。

`ai.run.start` **没有 `model` 字段**。补全只能在已有 runnable profile 里挑。
`pickSuggestAiProfile` 给 `gemini-3.5-flash-lite` 最高分；网关上若只有
`gemini-3.1-flash-lite` / 其它 flash+lite，就用那个。思考链 / grok 排最后。
无 flash profile 时仍用唯一 runnable，不静默失败。

`ai.run.start` 传入：

```ts
{
  action: "freeform",
  profileId,
  projectId,
  segmentId,
  expectedRevision, // 只读，不写段
  prompt: AI_COMPLETE_PROMPT, // 见下
  options: {
    includeTerms: true,
    includeTm: true,
    includeCorpus: true,
    includeContext: true,
    includeStyle: true,
    tmTopN: 5,
    corpusTopN: 3,
    contextBefore: 2,
    contextAfter: 2,
    maxChars: 8000, // 补全要比整段生成更瘦
    styleInstruction: "",
    systemInstruction: "",
  },
}
```

`build_grounding` 读到的 `current_target` 是 **SQLite 里上次保存的目标**。
打字中的草稿在 SaveCoordinator，通常还没 flush。每键 flush 太重。

因此 **活目标 + 光标必须写进 `prompt`**（协议已有该字段），例如：

```
Continue the target translation from the caret. Return only the completion
suffix (do not repeat text already typed; do not translate the source from
scratch; do not explain; do not invent tags).
Honor preferred terms; never use forbidden terms.
Live target (caret marked with ⌂):
「{before}⌂{after}」
```

引擎 grounding 仍负责：源文、术语、TM、前后段、标签骨架。渲染进程不自己
拼邻段——网格里的邻段可能过期，以引擎为准。

过期丢弃（与 `useSuggestions` 同一纪律）：

`generation + segmentId + prefix + caret + targetText`

离开段、Esc、IME 开始、prefix 变化：bump generation，幽灵字立刻清掉。
引擎 run 可在后台跑完，但**不得**再画到新段上。

无 credential：不弹窗、不报错、不每键闪 `ai-no-profile`。诚实空态只留在
IntelDock / Settings。补全失败同样静默。

---

## 6. 实现切片（按这个做，不要一次做完 Cursor）

### P1 · 确定性幽灵字（已挂）

- 挂载点：`TargetEditor` 光标后，`data-testid="inline-completion"`。
- 把当前高亮候选里「比 prefix 长的后缀」画成灰色幽灵字。
- Tab：有下拉时仍收下拉；下拉与幽灵字是同一条时只插入一次。
- 单测：后缀计算、IME 不画、换段清空。
- 不改协议。`suggest-gate` 必须仍绿。

### P2 · AI 续写（已挂）

- hook：`use-ai-suggest.ts`，对标 `use-ocr-ai` / `use-segment-ai`。
- 条件：`autocomplete !== false`、credential 齐全、prefix≥2、非 IME、
  非 QuickPlace。
- 防抖 400ms；同时只允许 1 个 in-flight；新请求只丢弃**视图**。
- 提案必须能接在活目标后面（prefix / 整段 startsWith）。接不上就丢，
  避免把整段 translate 结果糊在半句上。
- Fake `ai.run.start`：补全 prompt 返回 `已打前缀 + " completed"`。
- 无密钥路径用 hook 测，不接真云。

### P3 · 一词接受（已挂）

- Ctrl+→ 接受幽灵字到下一个空白（CJK：下一个字）。
- 不占用 Confirm / QuickPlace。

### 明确不做

- 新引擎方法、手改 `protocol.generated.ts`。
- 自研补全模型、推测解码、按接受率 RL。
- 跨段 / 跨文件 jump portal（确认跳段与传播已存在）。
- 把 Devin 式代理做成打字补全。
- 无密钥时假装有云端质量。
- 自动把 AI 续写写入目标或确认。

---

## 7. 验收

| 项 | 怎么算过 |
| --- | --- |
| 确定性下拉 | 打 `pow` 仍出术语/记忆；Tab 接受；`suggest-gate` 绿 |
| 幽灵字 | 第一条后缀可见；Esc 掉；换段掉 |
| 上下文 | `ai.run.start` 的 `options.includeContext/includeTerms/includeTm` 为 true；prompt 含活草稿与 ⌂ |
| 过期 | 打完下一个字后，旧 run 不得改目标、不得留幽灵字 |
| 诚实 | 无 profile 不发 `ai.run.start`；不 toast |
| 键位 | Ctrl+Enter 仍确认；行内第一钮仍是 Confirm |
| 回归 | desktop vitest、`suggest-gate`、`intel-gate`、`tags-gate` |

---

## 8. 和 A1 的边界

| | IntelDock AI（A1） | AI AutoSuggest（本文） |
| --- | --- | --- |
| 触发 | 人按 Generate | 打字防抖 |
| 输出 | 整段候选，Apply 替换 | 光标后续写 |
| 无密钥 | 窗内诚实提示 | 静默 |
| 协议 | `ai.run.start` | 同一个，`freeform` + 更瘦 grounding |

两者共享 profile 与 grounding，不共享 UI。不要在情报窗里做补全，也不要
在补全层做整段改写。
