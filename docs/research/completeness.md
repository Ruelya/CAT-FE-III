# Translunar CAT 完整度审计（gf-tm-context tip）

> 核对基线：`origin/cursor/gf-tm-context-2398` @ `fc2deeb1d525c083253852aa395f333a2a606c56`（2026-08-28）。
> 审计分支：`cursor/gf-completeness-2398`。性质：**评估 + 只修明确正确性 bug**。
> 方法：逐维度读当前代码（引擎 `crates/tl-*`、桌面 `apps/desktop`、契约 `packages/contracts`），
> 每条结论给 `文件:行号` 或 RPC 名；旧文档结论一律重核，过时处见 §7。

---

## 1. 一句话结论

**产品能用，译者主链路（建项目 → 导入 → 编辑/确认 → TM/术语/QA/AI 辅助 → 导出）完整度约 90%**：
61 个 RPC 方法 + 2 个通知帧全部有 UI 消费者，四套测试（cargo 242 / vitest 411 / e2e 21 / contracts:check）
在 tip 上全绿；本轮只发现 1 个正确性 bug（快捷键对话框漏列两条已绑定和弦，已修）。
最大剩余洞是**应用级 undo 栈**（撤销仍是浏览器 `execCommand`，跨句段/确认后回退不可用）与 **PDF 导入缺席**。

## 2. 测试健康（本分支实跑，全绿）

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm contracts:check` | ✅ OK | 生成物与 Rust `tl-protocol` schema 一致 |
| `cargo test --workspace` | ✅ 242 passed | 含 `tl-engine/tests/vertical.rs`、`engine_rpc.rs` 端到端 |
| `pnpm --filter @translunar/desktop test` | ✅ 27 文件 / 411 passed | 含本轮新增的快捷键对话框断言 |
| `pnpm --filter @translunar/desktop typecheck` | ✅ 4 个 tsconfig 全过 | electron / renderer / main-tests / e2e |
| e2e（xvfb + Playwright） | ✅ 21 passed（约 1.2 分钟） | engine-down / mt-agent-modes / themes / vertical 全套 |

注：初次跑 typecheck/vitest 红是本 VM 的 `node_modules` 过期（`@tabler/icons-react` 解析失败），
`pnpm install --frozen-lockfile` 后全绿——环境问题，与 tip 代码无关。

## 3. 引擎 RPC 面

`crates/tl-protocol/src/lib.rs` 共 **61 个方法 + 2 个通知**（`notify.engine.ready`、`notify.ai.agent.step`），
分组：`engine.*` 2、`project.*` 5、`document.*` 4、`segment.*` 5（含 `segment.lock`、`segment.replace`）、
`tm.*` 7、`memory.*` 7、`termbase.*` 7、`term.*` 5、`qa.*` 7（含 `qa.fix.list/apply`、`qa.profile.get/update`）、
`ai.*` 12（含 `ai.profile.*` 3、`ai.assist.*` 3、`ai.agent.*` 4）。
桌面端逐一有真实调用方（`apps/desktop/src/renderer/lib/engine.ts` 的 `callEngine` 全类型化）；
未发现死方法或 UI 调不存在方法的断线。

## 4. 分子系统完整度表

结论档位：HAVE（落地且有测试）/ PARTIAL（能用但有洞）/ MISSING（承诺过但缺席）/ LATER（明确推迟）/ 故意不做。

### 4.1 项目生命周期 — HAVE

| 项 | 档位 | 证据 |
| --- | --- | --- |
| 创建/继续/归档 | HAVE | `project.create/list/get/archive`；`ProjectsView.tsx` 列表 + 归档入口 |
| 项目设置（名称、说明、QA 旋钮） | HAVE | `project.update`；`ProjectSettingsDialog.tsx`（busy 态禁用、错误如实回显） |
| 语言对锁定 | HAVE | `project.update` 拒改语言对（`crates/tl-engine/src/lib.rs` `project_update` 校验，测试 `engine_rpc.rs`） |
| SRX / 分段选项 | HAVE | `ImportDocumentDialog.tsx` 分段选项（段落/句子 + 规则集），e2e `vertical.spec.ts:609`「segmentation options shape the grid」 |

### 4.2 导入导出 — HAVE（PDF 为 LATER）

| 项 | 档位 | 证据 |
| --- | --- | --- |
| 9 种过滤器 | HAVE | `crates/tl-engine/src/lib.rs:271-284` 注册 docx / txt / md / html / xliff / xlsx / pptx / 双语 docx / 双语 xlsx |
| 导出覆盖门 | HAVE | `ExportOverwriteConfirm.tsx`；主进程先探测目标存在再问 |
| QA 导出门 | HAVE | `EngineError::ExportBlocked`（`lib.rs:743`、`lib.rs:1003-1012`），`override_qa_gate` 显式放行；`ExportQaGateConfirm.tsx`；e2e `vertical.spec.ts:947` |
| 文档移除 | HAVE | `document.remove` + 确认流（doc-remove 弧） |
| docx 布局预览 | HAVE | `document.export` + `segmentAnchors: true`（`apps/desktop/src/main/index.ts:264-294`），`PreviewPane.tsx` 段落锚点双向跳转 |
| PDF 导入 | LATER | 注册表无 PDF（`lib.rs:271-284`）；`docs/mineru-ocr.md` 已标 Historical；本弧禁做 |

### 4.3 编辑器 — HAVE（undo 为 LATER）

| 项 | 档位 | 证据 |
| --- | --- | --- |
| 输入即草稿 | HAVE | `segment.update` 自动保存（`SegmentGrid.tsx` blur/防抖提交，IME 组合期不打断） |
| 确认四连 | HAVE | Ctrl+Enter / Ctrl+Alt+Enter / Ctrl+Alt+Shift+Enter / Ctrl+Shift+Enter（skipTmWrite），`menu-template.ts:276-299` 显示、编辑器 keydown 执行 |
| `skipTmWrite` 语义 | HAVE | 同时跳过 TM 写入**与**同源传播（`lib.rs:1254-1289`，设计如此） |
| 锁定 | HAVE | `segment.lock`、Ctrl+L；锁定行只读（e2e `vertical.spec.ts:744`） |
| 确认传播 | HAVE | `untranslated_siblings` 按 source_hash 索引传播草稿（`lib.rs:1281-1289`） |
| origin 芯片 | HAVE | `SegmentGrid.tsx:156` `originChipFor`：tmExact/tmFuzzy 带真实分数，aiDraft 只标模型**无分数**；e2e `vertical.spec.ts:664`「origin chips stay honest」 |
| 查找/替换 | HAVE | `FindWidget.tsx`、F4/Shift+F4 跳转、`segment.replace`（带 base_revision 冲突诚实上抛） |
| 筛选五通道 | HAVE | 状态/文本/锁定/有术语/有标签（`lib/segment-filter.ts:69-101`；`WorkbenchView.tsx:211-216`） |
| 转到家族 | HAVE | Ctrl+G 段号对话框、下一未译/草稿/QA(F8)/锁定（`WorkbenchView.tsx:2194-2214`、`menu-template.ts:166-182`） |
| 应用级 undo | LATER | 撤销/重做仍是 `document.execCommand`（`WorkbenchView.tsx:1473-1477`，注释明说应用级 undo store 缺席）；本弧禁做 |

### 4.4 文件树 / IA — HAVE

| 项 | 档位 | 证据 |
| --- | --- | --- |
| 文档树 + 搜索 + QA 徽章 | HAVE | `WorkbenchView.tsx` explorer 栏（QA open 计数徽章来自 `qa.list`，无客户端造数） |
| 七菜单 | HAVE | `menu-template.ts` 文件/编辑/转到/视图/项目/工具/帮助；enablement 跟 `projectOpen/documentOpen` 状态 |
| Ribbon | HAVE | `Ribbon.tsx` 按钮全部派发 `MenuCommand`，与菜单同源 |
| 命令面板 | HAVE | `CommandPalette.tsx`（Ctrl+K / Ctrl+Shift+P），行集与菜单命令一致，禁用行渲染但不执行 |
| 状态栏 | HAVE | 引擎字数/进度直读引擎（e2e `vertical.spec.ts:664` 断言 word count 诚实） |
| 快捷键对话框 | HAVE（本轮修复） | 曾漏列已绑定的 Ctrl+G / F8，违反自身「未列出即无」承诺——已补（commit `d0c76e0`） |
| 死入口 | 无 | 菜单/Ribbon/面板/快捷键四面与 `RENDERER_OWNED_ACCELERATORS`（`menu-template.ts:32-51`）逐条对过，无死和弦；e2e `vertical.spec.ts:843` 菜单镜像测试 |

### 4.5 TM — HAVE

| 项 | 档位 | 证据 |
| --- | --- | --- |
| lookup / 应用 / Ctrl+1–9 | HAVE | `tm.lookup` 合并多库带 `memoryName`；编辑器内 Ctrl+1..9 应用第 n 条（`SegmentGrid.tsx`）；e2e `vertical.spec.ts:1147` |
| 预翻译 + 阈值对话框 | HAVE | `tm.pretranslate`；`PretranslateDialog.tsx:6` 默认 75，可调 1–100 |
| 检索（concordance） | HAVE | F3 取选中文本；文档内双分区 + 项目 TM 双侧子串（`ConcordancePanel.tsx`，`tm.list` 兜底），e2e `vertical.spec.ts:286` |
| 确认 + 传播 | HAVE | 见 §4.3；写入唯一 writable 挂载，无 writable 时诚实失败（`lib.rs:1260-1266`） |
| 多库管理 | HAVE | `memory.*` 7 方法；`TmManageDialog.tsx` 挂载/优先级/writable/重命名/删除/导入/导出；e2e S3d `vertical.spec.ts:1215` |
| TmPanel fuzzy diff | HAVE | 模糊命中源文差异高亮（`TmPanel.tsx`） |
| 101% 上下文匹配 | 故意不做 | 引擎无 inContext 概念，UI 不画（NEVER-FAKE）；`TmMatchItem` 无该字段（`crates/tl-protocol/src/tm.rs`） |
| TM 条目元数据（AI 来源等） | LATER | `TmEntry` 仅句对 + 溯源指针 + 时间（`crates/tl-domain/src/lib.rs`）；本弧禁做 |

### 4.6 术语 — HAVE

| 项 | 档位 | 证据 |
| --- | --- | --- |
| lookup / 面板 / 插入 | HAVE | `term.lookup`；`TermPanel.tsx` 命中列表 + 光标处插入 |
| 多库挂载 / 管理 | HAVE | `termbase.create/attach/detach/update/import/export` + `term.add/update/delete/list`；`TermManagePanel.tsx` |
| prompt 注入 | HAVE | 术语分节进 grounded prompt（`aiops.rs` Terminology 分节，只注入真实命中） |
| 有术语筛选收敛 | HAVE | 未收敛时按空集处理**不闪全表**（`segment-filter.ts:87-92` `termSegmentIds === null` 即全滤掉；`WorkbenchView.tsx:401-405,524-569` 收敛集缓存 + 失败自动关芯片）——ux-remain 声称的修复属实 |

### 4.7 QA — HAVE

| 项 | 档位 | 证据 |
| --- | --- | --- |
| 内建规则 | HAVE | `crates/tl-qa/src/lib.rs` 23 个 `qa.*` 规则 id（空译文、标签、数字、标点、CJK 系列、长度、重复词、一致性双向、术语必用/禁用、单位等）+ 用户正则 `qa.regex:{id}` |
| 行为型规则 | HAVE | `qa.unedited-fuzzy` 与 `qa.unedited-ai-draft` 都在（只认引擎 origin 事实，从不由文本猜测）；e2e `vertical.spec.ts:1022` |
| 严重度表 / 旋钮 | HAVE | `qa.profile.get/update` 按规则覆盖严重度与开关；`ProjectSettingsDialog.tsx` QA 页 |
| waive | HAVE | `qa.waive` + 批量豁免（e2e `vertical.spec.ts:1022` batch waivers） |
| fix | HAVE | `qa.fix.list/apply` 面板内应用修正（e2e `vertical.spec.ts:1215`） |
| 导出门 | HAVE | 见 §4.2；error 级未处理即拦，用户显式放行才过 |

### 4.8 AI Assist — HAVE

| 项 | 档位 | 证据 |
| --- | --- | --- |
| 多 profile | HAVE | `ai.profile.add/list/remove`，上限 6（`AiPanel.tsx:38`） |
| 密钥仅内存 | HAVE | `SecretString`（`crates/tl-ai/src/lib.rs:617`，Debug 脱敏）；`store.rs` 无凭据落库路径；UI 只回显 `credential_hint/present`，从不回显明文 |
| 并行候选卡 | HAVE | 多 profile 并行起草，卡片**无分数无排名**（NEVER-FAKE）；失败卡如实显示错误（`AiPanel.tsx`） |
| grounding | HAVE | Assist 与 Agent 共用 `prompt_grounding_for` → `aiops::grounded_messages` → `tl_ai::build_grounded_prompt`：TM 上限 5（`lib.rs:71`）、邻句 ±2（`lib.rs:69`）、已确认抽样 ≤8（`lib.rs:74`）、`max_chars` 默认 24000（`tl-ai/src/lib.rs:1502`）。测试 `vertical.rs::drafting_prompts_ground_in_real_tm_neighbours_and_document_pairs` |

### 4.9 Agent — HAVE

| 项 | 档位 | 证据 |
| --- | --- | --- |
| 三档审批 | HAVE | manual / auto / turbo（`lib.rs:1873-1876` 三档计划文案；`lib.rs:1980` Turbo 分支） |
| 进度只读引擎 | HAVE | `AgentPanel.tsx` 全部读 `ai.agent.status` 的 `AgentRunView` + `notify.ai.agent.step`，无客户端自造百分比 |
| TM 精确预翻分流 | HAVE | 起跑先按挂载 priority 点查 exact，命中落 Draft(origin tmExact 100)，未命中才进 AI 队列（`lib.rs:1780-1842`） |
| Turbo 经同一 confirm | HAVE | `turbo_confirm_segment` 直调 `segment_confirm`（`lib.rs:2047-2051`），前置句段级 QA 零 error 硬门 |
| 不写 TM / 不导出 | HAVE | `tm_entries` 写入方全集只有 confirm / `tm.import` / `tm.update`；Agent 无导出路径 |
| maxSegments / 失败重跑 | HAVE | `lib.rs:1818-1842` 上限截断；面板失败句段重跑入口（`AgentPanel.tsx`） |
| QA 修复入口 | HAVE | 完成后引导 QA 面板（人工门，Agent 自身不消 QA） |

### 4.10 诚实性 / NEVER-FAKE — 通过

- UI 字符串（`apps/desktop/src`、`packages/ui/src`）与引擎错误文案（`crates/`）**零处「不是」**（本轮全库 grep）。
- 无假 TM% / 假 QE 分 / 假 101% / 假云 / 假评论 / 假成员 / 假完成：origin 芯片只画引擎 origin
  （aiDraft 无分数）；面板计数全部来自 RPC 结果；无任何 mock 数据渲染路径。
- 引擎断开：`EngineGate.tsx` 全屏门 + 重启按钮，工作区 `inert`；e2e `engine-down.spec.ts` 覆盖。
- `packages/contracts` 与 Rust schema 一致（`contracts:check` 绿），无手改痕迹。
- 旧 `crates/engine`、Deep Console、warm-paper chrome 均未复活（目录与主题 token 均无残留）。

## 5. 真实 bug 清单

| # | bug | 状态 | 说明 |
| --- | --- | --- | --- |
| 1 | 快捷键对话框（帮助 ▸ 键盘快捷键）漏列已绑定的 `Ctrl+G`（转到句段）与 `F8`（下一 QA 句段），违反其「未列出即产品无此和弦」的自我承诺 | **已修**，commit `d0c76e0` | `ShortcutsDialog.tsx` 补两行；`App.test.tsx` 加断言。全套 411 vitest 复跑绿 |
| 2 | `docs/research/tm-ai.md` §1–4 的「prompt 不注入 TM 例句」结论已被本 tip 推翻，但正文头部无警示，后续 agent 容易只读前半被误导 | **已修**，见 §7 | 头部加一行「§1–4 基线已过时、以 §6 为准」；不重写正文（历史快照保留） |
| 3 | `docs/research/translunar-capability.md:11` 写「57 个方法 + 2 个通知帧」，当前 tip 为 61 + 2（新增 `qa.profile.get/update`、`ai.profile.add/list/remove` 等），且缺 `segment.lock`、`memory.*`、origin、Agent 三档 | **已修**，见 §7 | 头部加过时警示；同样保留历史正文 |

审计中排查过但**判定非 bug**的项：`segment.replace` 在活动行有陈旧 revision 时上抛冲突（诚实行为，非静默覆盖）；
`skipTmWrite` 跳过传播（设计如此）；初跑 typecheck/vitest 红（VM 环境过期，重装依赖后绿）。

## 6. 产品缺口清单（均为决策性缺口，本轮不实现）

| 缺口 | 档位 | 为什么现在不做 |
| --- | --- | --- |
| 应用级 undo/redo 栈 | LATER | 需要跨句段编辑历史与 confirm/传播的逆操作语义，是独立产品切片；现状 `execCommand` 在单 textarea 内可用 |
| PDF 导入（MinerU OCR） | LATER | 旧管线随绿地重置移除（`docs/mineru-ocr.md` Historical）；需要外部服务 + 密钥面 + 版式回写，专门弧处理 |
| TM 条目元数据（AI 来源、领域、用户字段） | LATER | 动 `TmEntry` schema 牵连 tm.import/export 与匹配语义，PRD 未定稿 |
| inContext / 101% 上下文匹配 | LATER | 需要 TM 存上下文哈希 + 匹配语义扩展；在此之前 UI 一律不画（NEVER-FAKE） |
| corpus 分节 grounding | LATER | `build_grounded_prompt` 的 corpus 分节在 `tl-ai` 有实现，引擎未接（PRD `mt-agent-modes.md` 明确推迟） |
| Agent `replaceDrafts`（重跑覆盖已有草稿） | LATER | 覆盖语义需要产品决策（保护人工编辑过的草稿），现 Agent 只填空行 |
| 项目级默认 AI instruction | LATER | 现 instruction 每次跑时输入；持久化归 AI 配置弧 |
| 云同步 / 评论 / 成员 / 协作 | 故意不做 | 本产品定位本地优先单机 CAT；Full PRD 的协作剧场超出本弧范围 |

## 7. 文档漂移清单

| 文档 | 漂移 | 处置 |
| --- | --- | --- |
| `docs/research/translunar-capability.md` | 基线 `gf-copy-audit-2398`，方法数 57（现 61）、无 `segment.lock`/`memory.*`/`qa.profile.*`/`ai.profile.*`/origin/Agent 三档、仍写单 TM 架构 | 本轮在头部加过时警示（只当目录，不当事实）；正文保留为历史快照 |
| `docs/research/tm-ai.md` §1–4 | 写于 mt-agent-modes 基线：「prompt 不注入 TM 例句」「aiDraft 无行为型 QA 消费者」均已被本 tip 推翻（`prompt_grounding_for` + `qa.unedited-ai-draft` 已落地，§6 自己也记了「已补」） | 本轮在头部加一行「§1–4 过时、以 §6 为准」 |
| `docs/mineru-ocr.md` | 顶部已标 Historical，与现状一致 | 无需处理 |
| `docs/research/pdf-mt-agent.md` | 只在兄弟分支 `origin/cursor/gf-research-pdf-mt-agent-2398`，本 tip 无此文件 | 引用时须注明分支 |
| `docs/design-studies/LANDING-AUDIT.md` | 「HAVE 59 / PARTIAL 0 / MISSING 0」抽查属实（命令面板、主题、origin 芯片、导出门等条目与代码一致）；但它只覆盖原型清单 59 项，晚于它落地的多 TM 管理、QA 修正、Agent 三档不在表内 | 可信但范围有限，勿当全量清单 |
| `docs/Full PRD gap matrix.md` / `docs/PRD.md` | 云/协作/插件条目属愿景，与本弧「故意不做」一致 | 阅读时按 §6 档位理解 |

## 8. Top 8 剩余缺口（按「译者每天会撞」排序，不估工期）

1. **应用级 undo/redo**：误确认、误替换、传播覆盖后无法回退，是日常编辑最高频的痛点。
2. **PDF 导入**：真实交付件常见格式，当前只能先在外部转 docx。
3. **批量查找替换的预览/撤销**：`segment.replace` 逐段生效，全文替换错了只能手工改回（与 #1 同根）。
4. **TM 条目元数据**：库内看不出「这条来自 AI/谁确认的」，TM 维护时只能反查句段。
5. **inContext/101%**：重复率高的文档里，译者无法区分「纯 exact」与「上下文也一致」。
6. **Agent 重跑已有草稿（replaceDrafts）**：Agent 只填空行，想让它改劣质草稿必须先手工清空。
7. **项目级默认 AI instruction**：每次跑 Assist/Agent 重新输入风格指令。
8. **corpus 分节 grounding**：长文档风格一致性只靠 ≤8 句抽样，成段参考语料进不了 prompt。
