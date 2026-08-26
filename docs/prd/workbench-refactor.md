# PRD：Translunar 工作台重构（workbench-refactor）

| 项目 | 值 |
| --- | --- |
| 状态 | 待实现（本文档即执行合同，实现者不应需要再提问） |
| 基线代码 | 分支 `cursor/gf-copy-audit-2398`，commit `8f958ee` |
| 研究输入 | `docs/research/translunar-capability.md`（ee22ca7）· `docs/research/design-language.md`（1fa4361）· `docs/research/crowdin-cat.md`（fcdc126）· `docs/research/memoq-and-peers.md`（84d38d3）· `docs/research/trados-studio.md`（4e13718），已随本分支入库 |
| 布局参考 | 用户提供的 Trados 风格 mockup（密度与分区参考；本文多处**否决**其具体元素，见 §2.2 与 §9） |
| 硬性红线 | 本地优先 Electron CAT；引擎是唯一事实源，renderer 不发明领域状态；确认写 TM，输入自动存草稿，Esc/失焦永不确认；Assist/Agent 永不确认、不导出、不伪造成功；capability 研究中标注 NEVER-FAKE 的项在对应引擎能力落地前禁止以任何 chrome 形式出现 |

---

## 0. 文档约定

- **HAVE / NEAR / LATER / NEVER-FAKE** 分档沿用 `translunar-capability.md` §3 的定义。本文所有 UI 元素都必须能落到 HAVE 或 NEAR；LATER 项只允许出现在 §8 的引擎切片（S2/S3）或 §9 路线图，绝不允许先画 chrome。
- 引用 RPC 一律用契约名（`segment.confirm`、`tm.lookup`……），字段与语义以 `packages/contracts/src/protocol.generated.ts` 与 `crates/tl-engine` 实现为准（capability 研究 §1 已逐方法核对）。
- 引用现有代码一律用真实路径与类名（如 `apps/desktop/src/renderer/components/SegmentGrid.tsx`、`.dock-tabs button`）。
- UI 文案遵守 copy 规则：标签只写动词/名词，无副标题、无引导语、无业务规则小作文、无「不是……而是……」句式；空态最多一个名词短语。本文给出的界面字符串即终稿口径。

---

## 1. 产品论点

Translunar 是一台**生产力优先、数据密集、以当前句段为引力中心**的本地翻译仪器：一整块连续表面用发丝线切开，每一像素都在报真实读数，键盘走完全流程，选中句段是唯一状态源、所有面板都是它的投影。与 Crowdin 的区别在形态——它是多人 SaaS，建议流、投票、审批、任务看板都以"他人在场"为前提，我们是单机单人，把它的引力结构（选区即状态源、保存瞬间 QA 拦截、命令面板）搬过来，把它的协作剧场（角色、评论、云同步）整体留下；与 Trados Studio 的区别在重量——它用七态生命周期、上下文 ribbon、二十种可停靠窗口服务 LSP 流水线，我们保持三态状态机与固定三栏，把它的交互真理（状态列即信息中枢、确认和弦家族、行激活即查询管线、"AI 永不进网格行内"的负空间纪律）原样继承。竞争力不来自功能数量，来自**诚实密度**：屏幕上出现的每个数字都有 RPC 返回值背书，出现的每个状态都有引擎状态机背书。

---

## 2. 研究综合：偷什么、跳什么、冲突裁决

### 2.1 逐工具借鉴表

| 来源 | 偷（进入本 PRD 的具体条目） | 跳过（及理由） |
| --- | --- | --- |
| **Trados Studio**（`trados-studio.md`） | 状态列即信息中枢（§2.10：字形+分值徽标、悬停 Status/Origin/Provider/Score 详情、"编辑后底色消失"的污染信号→我们的 S2 origin）；确认和弦三变体（§2.2：Ctrl+Enter / Ctrl+Alt+Enter / Ctrl+Alt+Shift+Enter，键位照抄）；打字即 Draft、清空目标段也归 Draft（§2.3）；确认时段级 QA + 集中消息列表（§5）；过滤=隐藏行而非高亮行（§8.8）；Go To 式按状态循环跳转；负空间纪律全套（§8：行内无按钮、无行级 MT 按钮、无常驻行间辅助区、确认无弹窗、AI 永不进网格行内） | 七态生命周期与 Sign-off 双阶段（LSP 流水线产物，见 §2.2 裁决一）；ribbon + 可停靠窗口系统（功能量级不匹配）；PerfectMatch / upLIFT / AutoSuggest 词典（重基建）；TQA/MTQE/Smart Review（企业审校计量 + 云订阅）；Track Changes 修订模型（成本极高，无存储） |
| **memoQ**（`memoq-and-peers.md`） | 状态盒三编码原则：字形+颜色+数字，永不只靠颜色（§2）；QA warning/error 双级 + 严重度重映射 + 三粒度忽略 + Resolve 式批处理面板（§6，作为我们 S3 QA 升级的验收蓝本）；临时过滤 / 查找 / 命名视图三层分离的**概念边界**（§7，我们只实现前两层）；Ctrl+Shift+Enter 确认不写 TM（§4.1，S2 候选）；"默认资源不可改、克隆再编辑"的资源惯例（未来 QA profile 配置沿用） | 六态色标 + R1/R2 角色链（多人流程）；Muses/LiveDocs/fragment assembly（第二套 TM 基建；拼装留源语坑位的做法官方自己都承认难看，LLM 时代交给 Assist 更干净）；浮动窗口/拆屏（成本收益差）；Insert all tags（官方原话不推荐） |
| **Crowdin**（`crowdin-cat.md`） | 选区即状态源、面板皆投影（§1.4，本 PRD 的骨架原则）；命令面板（§3.7）；QA 保存瞬间拦截 + Error/Warning 语义 + Save Anyway 逃生门的**时机设计**（§3.2，映射到我们的确认时 QA）；QA 消息文案模式"一句事实 + 一句恢复动作"（§4.1）；计数即信息、全大写小节标题、短动词按钮的文案纪律（§4.1）；词数统计口径页（Word Counter，S2 词数功能的口径参考） | 建议流/投票/批准两级角色动词（单机无诚实实现，见 §2.2 裁决二）；任务看板/工作流引擎/成本报表（多人商务件）；截图上下文/In-Context JS 注入（SaaS 形态）；Global TM（云资产） |
| **Phrase**（`memoq-and-peers.md` 附录 A） | "Instant QA 不过 → 不落 TM"的闸门思想（映射：我们确认失败即不写 TM，引擎已如此）；行为型 QA（Unedited fuzzy match 未改就确认——S3 QA 升级候选，我们有 revision 可支撑） | 桌面版维护模式的整套 TMS 工作流 |
| **OmegaT / Wordfast / CafeTran / DV**（同上附录 B–D） | OmegaT 匹配率多分数并列的"可解释匹配"思想（S3 TM 面板增强候选）；Wordfast 结构履历图标思想（段被拆/合/源改过留痕——归档，待拆合功能存在后再议） | 文档流式编辑器形态（我们是网格派）；Lexicon/DeepMiner（重基建） |
| **design-language.md** | 全部令牌、字体、密度、动效预算、do-not-ship 清单（§5 逐条绑定为执行合同） | 无（该文档整体采纳，仅 §4.8 dock 收敛为 3 组一处被本文修订为 4 组，理由见 §2.2 裁决五） |

### 2.2 冲突裁决

**裁决一：Studio 七态 / memoQ 六色 vs 我们的三态 → 维持三态。**
`untranslated → draft → confirmed` 不动（`crates/tl-domain` `SegmentState`）。Studio 的 Translated/Approved/Signed-Off 分层与 memoQ 的 TR/R1/R2 全部以"多个角色接力"为前提；本产品无用户体系（capability §3.6），审校即译者本人换一顶帽子，三态已完整表达"没动 / 动了没定 / 定了"。伪造更多状态只会让确认动词失去唯一性。mockup 中的六态色标（未翻译→…→已审校→已锁定）不采纳；「已审校」「已锁定」若未来落地必须先走引擎状态机改造（§4.5、§8.4）。

**裁决二：Crowdin save/approve 两动词 vs 我们的 draft/confirm → 维持 draft/confirm，且自动保存强于两者。**
Crowdin 的 Save 产生 suggestion、Approve 由审校执行——两动词两角色。我们单机：输入即草稿（700ms 静默自动落库，引擎持久化，非 Studio 式"仅内存 + Ctrl+S"），`segment.confirm` 是唯一升格动词、唯一 TM 写入路径。因此**不需要** Save 按钮、不需要未保存星号、不需要 Save All 出口；引擎未 ack 的写入用现有 `UnackedWrite` 持久告警如实呈现（`WorkbenchView.tsx`），这比 dirty 星号更诚实。

**裁决三：mockup 逐行 TM%/MT% 芯片 vs 引擎无 origin 存储 → 分两步。**
现阶段行内只显示**活动句段**的实时 `tm.lookup` 最佳分（现状已有，三处同源）；逐行持久徽标唯一诚实路径是 S2 的 `Segment.origin` 契约扩展（§8.3）。"MT 62%" 式置信度分数任何 provider 都不返回（capability §3.5），**永远不显示**。

**裁决四：mockup 的云/角色/评论/字数/文件夹树 → 全部裁掉。**
云同步图标、Created by、Due、Reviewer 头像、Comments(1)/Messages(2)、行内 💬17、`.sdltm` 文件节点、`04_Deliverables ☁`、Words: 18,732——逐项对应 capability §3.2/§3.3/§3.6 的 NEVER-FAKE 或 LATER。词数在 S2 引擎给出口径明确的计数后才进状态栏（§8.3）。

**裁决五：design-language.md §4.8 建议 dock 收敛为 3 组（QA 与 AI 合并为"检查"）→ 修订为 4 组。**
AI 辅助面板是**起草**动作（translate/refine 提案），不是检查动作；把它并进"检查"会混淆确认闸门语义（QA 拦截 vs AI 提案是两类交互）。收敛为 4 组：记忆（TM+检索合并）、术语、QA、AI（辅助+Agent 两区段）。仍然消灭了 6 标签均分挤压问题。

**裁决六：Studio"进段自动填入最佳匹配 + 100% 自动确认"→ 不采纳自动填入，绝不自动确认。**
Studio 默认行为会在导航时隐式写目标段。我们的批量填充入口是显式的 `tm.pretranslate`（已有），Agent 起草也停在 `awaitingReview`；导航是只读动作，任何写入都必须来自显式手势。"自动确认"直接违反"确认权永远在人"红线。

**裁决七：预览位置（design-language.md 内部两处不一致：右侧常驻 vs 底部第三栏）→ 底部可折叠横向面板。**
网格需要横向空间（源+译双列 + 状态列），右栏已有 4 组 dock；memoQ View pane 与 Crowdin 底部预览都是底部先例。见 §7.4。

---

## 3. 诚实信息架构（IA）

骨架五区，全部平面、发丝线分隔（design-language.md §3.1）：

```
┌────────────────────────────────────────────────────┐
│ 原生标题栏 + 原生菜单（Electron）                        │
│ 工具条（56px，溢出收纳 More 菜单，禁止滚动/换行）           │
├─────────┬───────────────────────────┬──────────────┤
│ 左栏     │ 文档页签条                   │ 右栏 dock     │
│ 项目资源  │ 双语网格（唯一滚动主体）        │ 记忆/术语/QA/AI│
│          │ 底部预览面板（可折叠）          │              │
├─────────┴───────────────────────────┴──────────────┤
│ 状态栏（24px 读数条）                                  │
└────────────────────────────────────────────────────┘
```

每区按 **用途 / 数据绑定 / 不显示** 三段定义。

### 3.1 标题栏

- **用途**：报当前工作对象。窗口标题动态为 `项目名 — 文档名 (源locale → 目标locale)`；无项目时 `Translunar`；有项目无文档时省略文档段。
- **数据绑定**：`project.name`、`project.sourceLocale/targetLocale`（`project.get`/内存态）、活动文档 `document.name`（`document.list`）。实现：renderer 写 `document.title`，主进程 `BrowserWindow` 跟随（改 `apps/desktop/src/main/index.ts` 的静态标题）。
- **不显示**：云同步指示、头像、协作者在线点、翻译/审校模式开关、dirty 星号（裁决二）、通知铃铛、假版本号装饰。

### 3.2 菜单（原生应用菜单）

- **用途**：全部命令的权威目录 + 快捷键声明。保持现有五组：文件 / 编辑 / 视图 / 导航 / 帮助（`apps/desktop/src/main/menu-template.ts`），启用状态继续由 renderer 上报的 `MenuContext{projectOpen, documentOpen}` 驱动。
- **变更**：
  - 视图组顶部新增 `命令面板`（`open-command-palette`，`CmdOrCtrl+Shift+P`，renderer-owned 加 `CmdOrCtrl+K` 同义键）。
  - 视图组 dock 项从 6 个收敛为 4 个（`CmdOrCtrl+1..4`：记忆/术语/QA/AI），新增 `预览面板`（`CmdOrCtrl+P` 语义从"打开预览对话框"改为"开合底部预览面板"）。
  - 编辑组补确认变体两项（§4.2），display-only accelerator，renderer 持键（沿用 `registerAccelerator: false` 机制与 `RENDERER_OWNED_ACCELERATORS` 清单）。
  - 导航组的 `一致性检索` 更名 `检索`（命名统一，见 §3.7）。
- **不显示**：无真实命令支撑的菜单组（mockup 的 Project/Translate/Review/Tools/Window 九组结构不采纳；空壳灰色菜单=假 chrome）。

### 3.3 命令面板（新建，S0）

- **用途**：全部命令的可搜索目录，取代一切引导文案（"快捷键即文档"）。
- **形态**：`CmdOrCtrl+Shift+P` / `CmdOrCtrl+K` 召出居中单输入框 + 结果列表；行高 28px，无图形装饰，匹配字符高亮，右侧列快捷键（`Kbd` 组件首次上岗，`packages/ui/src/components.tsx`）。对话框表面令牌（允许 `--tl-shadow-overlay` + 一处 `tl-rise-in`）。
- **数据绑定**：`MenuCommand` 联合类型全集（`apps/desktop/src/shared/desktop-api.ts`）+ dock 切换 + 已打开文档间跳转 + 项目内文档打开（`document.list` 内存态）。全部经现有单一 dispatch 路径 `handleMenuCommand`（`WorkbenchView.tsx`）执行，禁止旁路。
- **不显示**：不存在的命令；无 AI 语义搜索；无"最近使用"持久化（本地 MRU 排序为内存态即可）。

### 3.4 三栏与 splitter（S1）

- 中央网格是唯一 `flex:1` 主体，min 480px；左栏 180–400px，右栏 240–480px。现有写死的 `grid-template-columns: 260px minmax(0,1fr) 336px`（`app.css` `.workbench`）改为 CSS 变量 + splitter 驱动。
- splitter：4px 命中区，hover 变 accent（120ms 过渡），双击复位默认宽，chevron 或快捷键折叠（折叠记忆宽度）。
- 布局持久化：每项目记住两栏宽度、折叠态、预览面板开合与高度（`localStorage`，key 含 projectId；这是 UI 偏好不是领域状态，不进引擎）。
- **不显示**：面板拖出重排 / 浮动窗口（Trados 全家桶能力，明确不做）。

### 3.5 左栏：项目资源

- **用途**：项目身份 + 文件清单 + 进入点。
- **内容与绑定**：
  1. 项目卡：名称、语言对、总进度条（仅当 `document.list` 的 `progress` 覆盖全部文件才显示百分比，绝不估算——现状规则保留）。
  2. 文件搜索框（S1）：renderer 本地过滤 `documents` 内存列表，无 RPC。
  3. 文件列表（平面，无目录树）：每行 = 格式图标 + 文件名 + 右对齐 `已确认n/总数` + 逐文件进度条与百分比 + QA 计数角标。绑定 `document.list`（`DocumentProgress.counts{total, untranslated, draft, confirmed, openIssues}` 全部 SQL 真实计数）。行操作：打开（标签页）、移除（两步确认，`document.remove`，明示 TM 与术语库保留）。
  4. 项目详情小节：名称/语言对/创建时间/文件数/总句段/已确认（现状保留）。
- **不显示**：文件夹树（`01_Source/02_Reference/…`——文档是平面列表，参考文件/交付物不是引擎概念）、TM/`.sdltm` 文件节点（TM 是项目级 SQLite 内部资产，入口在工具条与项目设置）、云图标、Due 日期、Created by。

### 3.6 中央：文档页签 + 网格 + 查找/筛选 + 预览

**文档页签条**：多开、关闭回退邻居标签（现状保留）；页签文法统一到全应用两套 tab 文法之一（§5.7 条 3）。绑定：renderer 内存的打开文档集。

**工具条（ribbon 重构）**：56px 保留，图标统一 `@tabler/icons-react`（16–18px、stroke 1.75），组间发丝分隔，tooltip 恒带快捷键（现状保留），空间不足收纳进尾部 More 菜单——删除 `overflow-x: auto`。命令集不变：导入/导出/确认/预翻译/查找/替换/筛选/检索/项目设置/TM 管理。绑定：与菜单同一 dispatch 路径。

**双语网格 `SegmentGrid`**（核心循环，改造点见 §5.4/§5.7）：

- 列：`# | 源文 | 译文 | 状态`，状态列 96px→72px。表头 sticky 保留，虚拟滚动（>120 行）保留。
- 行内编辑几何稳定：选中行进入编辑态不改变行盒，1px accent 全周描边表达编辑，行高只随内容自然增长；删除 textarea 的 `min-height: 48px` 与入场动画。
- 键盘（S1）：roving `tabIndex`；`↑/↓` 移动选区；`Enter` 进入编辑；`Esc` 退出编辑（**不确认、不丢草稿**——已入库的草稿保持）；`Ctrl+Enter` 确认并前进；`Alt+↑/↓` 逐行移动（现状保留）。源文单元格保持只读，不设源/译切换键。
- 行激活 = 查询管线（Crowdin 引力原则 + Studio §2.4）：选中行触发 `tm.lookup` + `term.lookup`，右栏全部面板随之刷新；**不自动写入**（裁决六）。
- 行菜单（S1，右键/悬停三点）：`复制源文`（`segment.update` 填 sourceText）、`清空译文`（`segment.update` 空串，引擎如实回 `untranslated`）。
- 状态列：单枚组合芯片（§5.4 字形表），QA 以角标计数叠加；活动行同位显示实时 TM 最佳分芯片（数据即现有 `tm.lookup` 结果，与右栏、dock 标签三处同源）。
- 占位符 token 高亮（S1，§7.2）。
- IME 安全（组合期不保存/不插入/不确认，compositionend 统一处理）现状保留，是验收项不是新功能。
- **不显示**：行内确认/保存按钮（Studio 负空间纪律）、行级 MT 按钮、逐行持久匹配分（S2 前）、结构化标签芯片（引擎无 inline tag 运行时模型）、行内评论数、锁定图标（S3 前）、六态色标。

**查找/筛选（S1 重构，语义见 §7.3）**：常驻工具条中的查找/替换输入组撤下，改为 `Ctrl+F`/`Ctrl+H` 召唤的浮动 find widget（VS Code 形态）；筛选激活后网格工具条左端出现可删除芯片（`草稿 ×`、`"安装" ×`），右端常驻 `142/1248` 计数。绑定：筛选为 renderer 端 `filterSegments`（`lib/segment-filter.ts`）；替换为 `segment.replace`（跳过/降级计数如实上报，现状保留）。

**底部预览面板**（S1，§7.4）：`文本/预览` 视图切换撤销，预览改为可折叠底部横向面板。

### 3.7 右栏 dock：4 组

标签 = 图标 + 文字，宽度自适应，禁止 `flex:1` 均分；计数角标保留（去动画）。`Ctrl+1..4` 切换。

| # | 标签 | 内容与绑定 | 不显示 |
| --- | --- | --- | --- |
| 1 | **记忆** | 上部：活动句段 `tm.lookup` 命中列表——顶部固定最佳匹配块（整句译文 + 分值芯片 + 精确绿/模糊蓝左 spine），其余为紧凑行（左列分值芯片，右列源/译两行，发丝线分隔，无卡片无阴影无动画）；双击或 `Ctrl+数字` 应用为草稿（`segment.update`）。下部：检索区（原 Concordance 面板内嵌为搜索框形态；文档内子串检索双向高亮 + `tm.lookup` 模糊检索 + 定位句段 + `F3` 取选区播种；全应用统一命名 `检索`） | `inContext`/101% 分级（契约死枚举，引擎零产出路径——`TmPanel.tsx` 的 `GRADE_LABEL.inContext` 删除）；多 TM 选择器下拉（单项目单 TM）；TM 命中的作者/时间元数据（TmEntry 无作者概念） |
| 2 | **术语** | `termbase.list` mounts + 活动句段 `term.lookup` 命中（源文 span 高亮联动）；首选/禁用徽标；插入到编辑器光标处；快速添加进首个可写术语库（`term.add`）。挂载管理入口指向项目设置（现状） | 收藏/书签图标（无存储）；Wikipedia 回落（无此集成）；术语状态 candidate/active/deprecated（契约存在、引擎未用，不渲染） |
| 3 | **QA** | `qa.run` 手动触发 + `qa.list` 列表（open→waived→resolved 排序）；每条 = 严重度字形 + ruleId + 证据行（`源[…]≠译[…]`）+ 定位/忽略/恢复（`qa.waive`，豁免不改句段不写 TM——如实呈现）；未解决计数驱动 dock 角标与状态栏 | 一键 Autofix（引擎无 Correction 通道，S3）；按规则批量忽略（`qa.waive` 是逐 issue 的，S3）；QA 分数/评级（无 LQA） |
| 4 | **AI** | 两区段。**辅助**：`ai.assist.start/status/cancel` 全生命周期；translate/refine + 可选 instruction；结果显示 draftTarget + 字符 diff + provider/model/耗时 + `tagCheck` 结果，`tagCheck.ok=false` 时禁用应用并列出缺失/多余 token（现状保留）；应用=写草稿。**Agent**：`ai.agent.start/status/cancel` + `notify.ai.agent.step` 实时步骤流；终态 `awaitingReview` 的人工闸门（查看草稿/去导出两个跳转，现状保留） | 置信度/质量分数（无 provider 返回）；多引擎对比；自动确认/自动导出（契约级禁止）；"完成/成功"字样（Agent 无 success 态——终态文案固定 `等待人工审核`） |

### 3.8 状态栏

- **用途**：24px 仪器读数条（现 30px 压缩；`--tl-statusbar-h` 令牌）。
- **布局**：左侧消息区（UI 字体、无动画、静默替换——删除 `key={statusMessage}` 重放与 `tl-slide-up`）；右侧读数组，数字全部 `.tl-num`（mono + tabular-nums）：
  `句段 6/1248 · 已确认 849 · 草稿 12 · QA 3 · ▓▓░ 68% · INS · 引擎 ●`
- **数据绑定**：句段/已确认/草稿/剩余/QA = `WorkbenchStats`（网格实时计数，现状）；进度条 = 现有双段 `SegmentProgress`（确认+草稿，保留——这是现状亮点）；INS/OVR 与行列号 = 编辑器本地事实（S1）；引擎点 = `engineStatus`（版本/pid/重启数/最后错误，现状保留，`StatusDot` 必须与文字读数相邻）。
- **交互（S1）**：草稿/QA 读数可点击，跳转对应筛选。
- **不显示**：词数（S2 引擎给出口径明确的计数并标注口径之前）；加权字数；服务器连接状态；`—` 占位字形（空值就空着）。

---

## 4. 句段生命周期

### 4.1 三态状态机（不变）

`untranslated → draft → confirmed`（`crates/tl-domain::SegmentState`）。本 PRD 不改引擎状态机（裁决一）。边界语义全部沿用引擎现状并成为验收项：

- 输入 700ms 静默自动存草稿（`segment.update` + `baseRevision` 乐观并发）；离开句段 flush、组件卸载 flush、失败 re-arm 重试；引擎未 ack → `UnackedWrite` 持久 inline 告警。
- 清空译文 → 引擎如实回 `untranslated`（与 Studio"清空归 Draft"不同——我们的三态里空译文没有"草稿"意义，引擎已裁决，UI 不二次发明）。
- 空译文拒绝确认（`invalidParams`），UI 明示。
- 已确认句段再输入 → 自动降级 draft（Trados unconfirm-on-type 语义，现状已实现）。
- `segment.replace` 改写已确认句段 → `demotedConfirmed` 计数如实上报（现状保留）。
- **Esc/失焦永不确认**；IME 组合期间不保存、不插入、Enter 不确认。

### 4.2 确认和弦（S1 补全变体）

| 和弦 | 动作 | 绑定 |
| --- | --- | --- |
| `Ctrl+Enter` | 确认 + 前进到下一**未确认**句段（现状） | `segment.confirm` + renderer 导航 |
| `Ctrl+Alt+Enter` | 确认 + 前进到下一句段（无论状态）（新，Studio 键位照抄） | 同上，导航策略不同 |
| `Ctrl+Alt+Shift+Enter` | 确认，不移动（新） | `segment.confirm`，无导航 |
| `Ctrl+Shift+Enter` | 确认但不写 TM（**S2 候选**，需契约加 `writeTm?: false` 参数；落地前该键位保持空缺，不做假） | 见 §8.3 |

三个变体全部是 renderer 编排（同一 RPC + 不同导航），菜单显示、renderer 持键。

### 4.3 确认的后置动作链（全部真实，逐条对应引擎返回值）

1. `segment.confirm` 返回 `segment`（新状态/revision）→ 网格行芯片更新。
2. 返回 `tmEntry` → 本次确认写入的 TM 条目；记忆面板下次 lookup 即可命中。**这是全链路唯一 TM 写入路径**（`tm.import` 除外）。
3. 返回 `propagated: Segment[]` → 引擎已把同项目未译重复句段自动填为**草稿**（不是确认）；网格就地更新这些行，状态栏消息报 `已传播 n 句`。
4. renderer 依和弦前进；前进目标计算在筛选后的可见集合内。
5. QA：确认动作**不**自动触发 `qa.run`（引擎无确认时校验钩子）；S0–S2 维持手动/批量 QA，确认时段级 QA 是 S3 引擎工作（§8.4）。UI 不得伪装"确认已通过检查"。

### 4.4 锁定

引擎无句段锁（capability §3.3：LATER）。因此 S0–S2 **不出现任何锁定 UI**。若 S3 立项，引擎合同为：`Segment.locked: bool` + `segment.update/confirm` 对锁定句段回 `conflict` + `segment.replace` 跳过并计数 + 确认前进跳过锁定句段 + QA 默认排除锁定句段（Trados §2.7 三规则同抄）+ 解锁审计走 revision。UI 才随之出现挂锁字形。

---

## 5. 设计规范绑定（design-language.md 的执行合同）

本节将 `design-language.md` 从研究升格为验收标准。冲突处以本 PRD 为准（仅裁决五一处）。

### 5.1 令牌

- 采纳 §2.1–§2.3 全部新增：`--tl-color-surface-active`（选中底色，与 hover 的 `--tl-color-sunken` 分离）、`--tl-border-hairline` 复合令牌、密度令牌组（`--tl-row-h-grid: 32px`、`--tl-row-h-list: 24px`、`--tl-ctl-h-sm: 22px`、`--tl-ctl-h-md: 28px`、`--tl-icon-sm/md: 14/16px`、`--tl-ribbon-h: 56px`、`--tl-statusbar-h: 24px`、`--tl-tab-h: 30px`）。
- 组件禁止直引 `--tl-gray-*` 原始值；结构边界只用发丝线且永远单边（行间只有 `border-bottom`）。
- 阴影只保留三档且只用于真正浮起的层；侧栏/面板/卡片零阴影。
- 暗色主题不做，令牌命名保持主题无关。

### 5.2 字体（S0，实际打包）

- 打包 **IBM Plex Sans**（Latin 子集，400/500/600）与 **IBM Plex Mono**（400/500），woff2 文件入 `packages/ui/fonts/`，`@font-face` 声明入 `tokens.css` 邻接文件，desktop renderer 引入；CJK 回落 `"PingFang SC", "Microsoft YaHei", "Noto Sans SC"`（系统原生渲染，不打包中文字体）。
- **删除虚构的 Inter 声明**（`tokens.css` `--tl-font-ui` 现以 `"Inter"` 打头但全仓库无任何字体文件——要么打包要么删除，本 PRD 选打包 Plex 并删 Inter）。
- mono 只用于数字与代码类读数（`.tl-num` 强制 `font-variant-numeric: tabular-nums`）；撤销 `.app-statusbar` 整体 mono（中文消息回 UI 栈）。
- 字号阶梯保留 11/12/13/15/18；网格正文 13px/1.5；对话框标题改 13px 句式 600（撤销 11px 全大写字距样式在对话框主标题上的使用，全大写微标题仅限侧栏小节头与表头）。

### 5.3 图标（S0）

引入 `@tabler/icons-react`（stroke 统一 1.75）。删除 `Ribbon.tsx` 手绘 `ICONS` 常量与 `WorkbenchView.tsx` 内联齿轮 SVG。全部命令按钮有图标（现状"上一个/下一个/替换"等纯文字幽灵按钮补齐）。

### 5.4 状态字形芯片（S0 起，永不 color-only）

字形是信息主体、颜色是第二通道（memoQ 三编码原则）：

| 状态 | 字形 | 颜色令牌 | 呈现 |
| --- | --- | --- | --- |
| 未译 | 空圈 | `--tl-color-text-faint` | `○` |
| 草稿 | 铅笔 | `--tl-color-accent` | `✎` |
| 已确认 | 对勾 | `--tl-status-ok` | `✓` |
| QA 未解决 | 三角叹号 + 计数 | `--tl-status-danger` | `⚠2`（角标叠加在状态芯片） |
| 活动行 TM 精确 | 分值 + 来源缩写 | `--tl-status-ok` | `100 TM` |
| 活动行 TM 模糊 | 分值 + 来源缩写 | `--tl-color-accent` | `85 TM` |
| （S2 起）持久 origin | 分值/缩写按 origin | 按来源 | `95 TM` / `AI` / 空（human/历史数据） |

`MatchBadge`（`packages/ui/src/components.tsx`）升级为分值+来源双段芯片。删除 `.segment-grid__state-stack` 纵向堆叠文字徽章。

### 5.5 密度

方向：比现状再紧一档，向 memoQ 行密度靠拢。左栏树行 24px；网格行最小 32px（单行文本）；工具条控件 22px；状态栏 24px。所有 magic number 换密度令牌。

### 5.6 动效预算

只做功能性动效，判据"动效必须回答什么变了"。**保留 5 处**：对话框/浮层入场 `tl-rise-in`（170–220ms）、引擎忙碌点 `tl-pulse`、splitter hover 变色（120ms）、进度条宽度过渡（220ms）、焦点/hover 颜色过渡（120ms）。**删除全部其余挂点**（现 14 处）：状态栏消息 slide-up（含 `App.tsx` `key={statusMessage}`）、`.dock-view` 切换动画、`.match-card`/`.issue-card`/`.agent-step`/`.dock-tabs__chip`/`.segment-grid__match` 挂载动画、`.segment-grid__target-editor` 展开动画、`.tl-empty` fade-in、`.preview__pane` fade-in。`prefers-reduced-motion` 总开关保留。新增动画必须在 PR 描述里一句话说明表达了哪个状态迁移。

### 5.7 现有 UI 拆除清单（demolition list，S0 验收逐条打勾）

1. 虚构 Inter 字体栈 → 打包 Plex 并删除（§5.2）。
2. 手绘 SVG 图标（`Ribbon.tsx` `ICONS`、内联齿轮）→ `@tabler/icons-react`（§5.3）。
3. **四套 tab 文法**（`.doc-tabs__tab` 凸起页签 / `.view-tabs__tab` 上边框 / `.dock-tabs button` 下边框 / `.preview__tabs button` 描边药丸）→ 收敛两套：页签条（文档标签）+ 下划线标签（dock 与视图内标签）。
4. 写死三栏 `grid-template-columns: 260px minmax(0,1fr) 336px` → splitter + 令牌（S1）。
5. 会换行的工具条（`.grid-toolbar { flex-wrap: wrap }`）与会滚动的 ribbon（`.ribbon { overflow-x: auto }`）→ 召唤式 find widget + More 收纳。
6. 状态列纵向堆叠文字徽章 → 单枚组合芯片（§5.4）。
7. 编辑态行高跳变（textarea `min-height: 48px` + `tl-slide-up`）→ 几何稳定行内编辑。
8. hover 与 selected 同色（同用 `--tl-color-accent-faint`）、全表格 `cursor: pointer` → hover 中性灰 / selected 中性蓝底+左 spine / editing 描边三态分离。
9. 14 处装饰动画 → 5 处功能动效（§5.6）。
10. 居中 1100px 卡片式项目列表（`.projects-view`）→ 全出血列表 + 工具行。
11. 状态栏整体 mono → mono 仅 `.tl-num`。
12. em-dash `—` 占位字形（`SegmentGrid.tsx`、`App.tsx`）→ 空值留空，错误拼接用冒号。
13. `.tl-panel` 默认浮卡（边框+圆角+阴影）再被应用层拍平 → 组件默认即平面，浮起形态改为显式变体。
14. `Kbd` 组件零使用 → 命令面板与 tooltip 上岗。
15. 对话框标题 11px 全大写 → 13px 句式 600。
16. `.honest-note`/`.ai-draft`/`.agent-gate` 彩色填充盒堆叠 → 统一单行 banner 文法（字形 + 文本 + 左 spine，不填色）。
17. 死代码：`TmPanel.tsx` `GRADE_LABEL.inContext` 删除；`ImportDocumentDialog.tsx` 过期 doc 注释修正。
18. concordance 三名混用（检索/Concordance 检索/一致性检索）→ 统一 `检索`。

### 5.8 do-not-ship（评审否决权清单）

design-language.md §7 全部 16 条采纳为 PR 评审红线，其中与本 PRD 直接相关的强调：假 chrome（云图标/头像/铃铛/在线点/假版本号）、纯颜色状态、无键盘等价物的鼠标交互（新组件 PR 必须列出键盘路径）、说明性 UI 文案回流（e2e 已有断言，视为回归）。

---

## 6. AI 融合（诚实版）

### 6.1 Assist（单句段提案）

现有形态即目标形态，重构只改皮不改骨：`ai.assist.start`（translate/refine + instruction）异步立即返回，150ms 轮询 `ai.assist.status`，全程可取消、网格不锁；终态 `done` 只携带 proposal（`draftTarget` + `tagCheck`），**从不写句段**；应用=`segment.update` 写草稿；已确认句段引擎直接 `conflict`。UI 合同：diff 展示、provider/model/耗时如实标注、`tagCheck.ok=false` 禁用应用并列出缺失/多余 token。无置信度数字，无自动应用。

### 6.2 Agent（文档级批量，awaitingReview 闸门）

`ai.agent.start`（instruction + maxSegments）→ plan + TM 精确预翻内联完成 → worker 并行起草 → QA → 停在 `awaitingReview`。步骤流经 `notify.ai.agent.step` 实时推送 + 800ms 兜底轮询。UI 合同：步骤列表（plan/tm/translate/qa/summary/cancel + done/failed/skipped）如实渲染；失败单句计入 `failedSegments` 不中断也不掩盖；终态文案固定 `等待人工审核`；人工闸门是两个跳转（查看草稿/去导出），导出仍会撞上 `exportBlocked` 覆盖确认——**Agent 无法绕过任何人工闸门**。无"magic 完成"横幅，无成功率百分比，无进度剧场（进度=真实步骤计数）。

### 6.3 Provider 路由

引擎同一时刻只持有一份 AI 配置（`ai.configure`：provider+model+key 内存态，绝不落盘；11 种 provider 见 capability §4.1）。设置 UI 如实呈现"单活动配置"模型：一个 provider 选择器 + model + key +（openaiCompatible 必填 baseUrl），`ai.status` 回显。不做多 profile 管理台、不做用量仪表盘（`AiUsageRecord` 类型零接入）、不做 prompt library。

### 6.4 不设独立 MT 面板（裁决）

capability §6-S1 曾建议"MT 面板 = AI 辅助换名"。本 PRD 裁决**不换名不拆分**：引擎只有单 provider 单配置，独立"机器翻译"面板会暗示与 AI 辅助并列的第二引擎（假多引擎对比是 NEVER-FAKE）；DeepL 等 MT 类 provider 配置后，AI 面板的 translate 动作即机翻，provider 名如实显示已足够。dock 保持 §3.7 的 4 组。

---

## 7. QA / 标签 / 筛选 / 查找 / 预览

### 7.1 QA 升级路径（分相位，不跳级）

现状（HAVE）：`qa.run`（全文档）→ `qa.list` → `qa.waive`；规则集见 capability §1.7（数字/占位符/标点/空白/重复/长度/术语/跨句一致性/CJK 专项）；issue 携带 `ruleId + severity + evidence + fingerprint`，豁免随证据变化自动失效。

| 相位 | 内容 | 引擎改动 |
| --- | --- | --- |
| S0 | 呈现纪律：QA 消息模式改为"一句事实 + 一句恢复动作"（Crowdin §4.1）；行内 QA 角标进状态芯片；`.issue-card` 去卡片化去动画 | 无 |
| S1 | QA 筛选联动（点击 dock 内 issue 定位句段——现状保留；状态栏 QA 读数点击进 QA 筛选）；按 severity 分组视图（error 先于 warning，字形区分） | 无 |
| S2 | 无 QA 引擎改动（S2 预算给 origin 与词数） | 无 |
| S3 | memoQ 式升级包（须独立立项）：① 稳定 code 表（现有 ruleId 已稳定，补参数化文案）；② severity 重映射配置（每规则 warning/error 可调，error 阻断导出——需要 `document.export` 增加 QA 闸门语义）；③ 忽略三粒度（逐条/按规则/按句段——`qa.waive` 扩展）；④ Correction 自动修复建议 + 一键应用（`tl-qa` 增加修复通道）；⑤ 行为型检查（未改动即确认的 fuzzy 应用，基于 revision + S2 origin）；⑥ Resolve 式批处理面板（code 排序、顶部可编辑当前句段） | 有，逐项契约先行 |

### 7.2 占位符高亮（诚实标签，S1）

句段是纯文本，无结构化 inline tag 运行时模型（DOCX 混排导出压平并显式上报 `docx.inline_formatting_flattened` 退化）。因此：

- **做**：文本占位符高亮。渲染层把 `{name}`/`{{var}}`/printf（`%s`）/标记（`<b>`）/实体（`&amp;`）渲染为 mono 字形 token（`--tl-color-sunken` 底、1px 边、2px 圆角、11px mono），token 识别正则与 `qa.tag-placeholder_*` 规则、AI `tagCheck` 保持同一套语义（单一 token 词法源，renderer 实现，与引擎规则语义对齐并以 QA 结果为准绳）。QA 报占位符缺失/多余时对应 token 描边转 `--tl-status-danger`。
- **不做**：结构化标签芯片（成对编号、F9 插入流、四档显示密度——memoQ 全套留待引擎拥有 inline tag 模型之日，即 LATER）；不假装保真往返。

### 7.3 显示筛选 vs 查找（两条通道，语义分离）

memoQ 三层（临时过滤/查找/命名视图）取前两层：

- **显示筛选**（隐藏行，Trados"过滤=隐藏行"语义）：状态（全部/未译/草稿/已确认/QA）+ 文本子串。renderer 端 `filterSegments` 内存过滤（`segment.list` 已全量/分页在手）。UI：S1 筛选芯片 + `n/total` 常驻计数 + `Esc` 或逐芯片清除；状态栏读数点击进筛选。
- **查找/替换**（跳选区，不隐藏行）：`Ctrl+F` 召唤 find widget，`F4/Shift+F4` 循环跳转（现状键位保留）；替换走 `segment.replace`（单事务、跳过已确认可选、降级计数如实上报）。
- **命名视图（Views）**：跳过。单人场景"今天只清草稿+QA"用筛选芯片已覆盖；静态切片的交接价值以多人为前提。若未来需要，作为筛选条件的可命名书签实现（纯 renderer），不做引擎切片。

### 7.4 停靠预览（S1）

- 形态：中央编辑区底部可折叠横向面板（裁决七），高度可拖拽、开合有快捷键（`Ctrl+P` 语义迁移）；替代现有 `PreviewDialog` 对话框与 `文本/预览` 视图切换。
- 两种模式（现状能力平移）：**校对视图**（客户端回填 + 未译标记 + 点击回跳句段）；**版式视图**（仅 DOCX/双语 DOCX：主进程走真实导出管线产 DOCX 字节 `renderDocxPreview` + 段落锚点回跳 + 编辑后 600ms 静默重导出）。
- 活动句段在预览中高亮，预览点击反向定位网格（双向，Crowdin Dual Preview 的单机对应物）。
- 诚实约束：版式视图每次刷新都是真实导出管线成本，节流保持 600ms 且面板折叠时暂停重导出；预览"只是相似不保证相同"不写成 UI 文案（copy 规则），但退化 findings（`DegradationFinding`）继续显式列出。

---

## 8. 分阶段交付

每片交付定义：改动文件、验收检查、"完成即"。S0/S1 零引擎改动；S2 起才允许契约扩展，且契约先行（`cargo run -p tl-protocol --bin export-schema` → `pnpm contracts:generate` → `pnpm contracts:check`）。

### 8.1 S0 — 仪器化外观（纯 renderer/UI 包，零新 RPC）

目标：不加任何新引擎数据的前提下，工作台在密度、chrome、字体、图标、命令面板、动态标题上达到专业工具水准。

**改动文件**：

- `packages/ui/src/tokens.css`：删 Inter；密度令牌组；`--tl-color-surface-active`；`--tl-border-hairline`。
- `packages/ui/fonts/`（新增）+ `packages/ui/src/fonts.css`（新增 `@font-face`）：IBM Plex Sans Latin 400/500/600、IBM Plex Mono 400/500（woff2）。
- `packages/ui/src/components.css` / `components.tsx`：`.tl-panel` 默认平面化；对话框标题 13px/600；`MatchBadge` 双段芯片；`Kbd` 上岗；`.tl-empty` 降级为一行左上角文本。
- `apps/desktop/src/renderer/app.css`：动效清退（§5.6 删除清单）；tab 文法二合一；hover/selected/editing 三态分离；`.grid-toolbar` 去 wrap（S0 先收纳，S1 撤常驻）；`.ribbon` 去滚动加 More；状态栏 24px + mono 收敛；`.projects-view` 全出血。
- `apps/desktop/src/renderer/App.tsx`：状态栏消息去 key 重放；动态 `document.title`。
- `apps/desktop/src/main/index.ts`：`BrowserWindow` 标题跟随页面标题（去静态 `"Translunar CAT"`）。
- `apps/desktop/src/renderer/components/Ribbon.tsx`：`ICONS` → `@tabler/icons-react`；More 收纳。
- `apps/desktop/src/renderer/components/SegmentGrid.tsx`：状态列组合芯片；删堆叠徽章；删 `—` 占位；编辑态几何稳定（textarea 样式重做，无 min-height 跳变、无入场动画）。
- `apps/desktop/src/renderer/components/CommandPalette.tsx`（新增）+ `apps/desktop/src/shared/desktop-api.ts`（`MenuCommand` 加 `open-command-palette`）+ `apps/desktop/src/main/menu-template.ts`（视图组新增命令面板项）。
- `apps/desktop/src/renderer/components/TmPanel.tsx`：删 `GRADE_LABEL.inContext`；命中行去卡片化。
- `apps/desktop/src/renderer/components/ImportDocumentDialog.tsx`：修正过期 doc 注释。
- concordance 命名统一 `检索`：`ConcordancePanel.tsx`、`WorkbenchView.tsx`、`menu-template.ts`、`Ribbon.tsx`。
- 测试同步：`SegmentGrid.test.tsx`、`App.test.tsx`、`menu-template.test.ts`、`apps/desktop/tests/e2e/vertical.spec.ts` 等选择器/断言更新；新增 `CommandPalette.test.tsx`。

**验收检查**：

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e:desktop` 全绿。
2. grep 门禁：仓库无 `"Inter"` 字体声明；`app.css`+`components.css` 中 `animation` 挂点仅剩 §5.6 保留清单；渲染代码无 `—` 占位字形；无 `inContext` 标签字符串。
3. 网格/工具条/dock/状态栏截图（1280×800）与 mockup 并排：行密度、发丝线分区、状态芯片肉眼可对照；无阴影卡片。
4. 命令面板列出全部 `MenuCommand` + dock 切换 + 文档跳转，每项可执行且与菜单结果一致；键盘可完成召出→过滤→执行闭环。
5. 窗口标题随项目/文档切换实时变化。
6. 新增引擎调用数为零（`lib/engine.ts` 调用面 diff 为空）。

**完成即**：一个不懂本项目的译员看截图会把它归类为"Trados/memoQ 同类专业工具"，而界面上没有任何引擎不背书的元素。

### 8.2 S1 — 交互还债（仍零新 RPC）

目标：键盘一等公民、布局可调、偶发任务不占永久 chrome、预览常驻。

**改动文件**：

- `SegmentGrid.tsx`：roving tabIndex、`↑/↓/Enter/Esc/Tab` 导航、行菜单（复制源文/清空译文，`segment.update`）、`Ctrl+数字` 应用 TM 命中、占位符 token 高亮（新增 `apps/desktop/src/renderer/lib/tokens.ts` 词法 + `TokenText` 渲染组件，与 QA/tagCheck 语义对齐）。
- `WorkbenchView.tsx`：确认和弦变体（Ctrl+Alt+Enter / Ctrl+Alt+Shift+Enter）；dock 6→4 重组（`DockTab` 类型、`DOCK_COMMANDS`、`Ctrl+1..4`）；find widget 状态编排；筛选芯片；文件本地搜索；状态栏读数点击进筛选。
- 新增 `components/Splitter.tsx`（含布局持久化 hook）、`components/FindWidget.tsx`、`components/PreviewPane.tsx`（吸收 `PreviewDialog.tsx` 逻辑，对话框退役）。
- `app.css`：三栏变量化 + splitter 样式；`.grid-toolbar` 常驻查找/替换组撤除。
- `menu-template.ts` / `desktop-api.ts`：dock 命令 6→4、预览面板命令、确认变体、`检索` 命名。
- `App.tsx`：INS/行列号读数。
- 测试：键盘全流程 e2e（选行→编辑→确认→前进，全程无鼠标）、splitter 持久化、find widget、token 高亮单测（与 QA 占位符规则用同一 fixture 组）。

**验收检查**：

1. 全套件绿；键盘-only e2e 通过（含 IME 组合期防护回归断言）。
2. dock 4 组标签图标+文字自适应宽度，无挤压；`Ctrl+1..4` 与菜单一致。
3. 布局（栏宽/折叠/预览开合）跨重启按项目恢复。
4. 占位符 token 在源/译两侧同步高亮；QA 报占位符问题时对应 token 转危险描边（用 `qa.tag-placeholder_*` fixture 驱动断言）。
5. 每个新组件 PR 列出键盘路径（do-not-ship 16）。

**完成即**：手不离键盘可完成"打开文档→逐句翻译→应用 TM→确认前进→处理 QA→导出"的完整循环；偶发任务（查找/替换）不再占据永久 chrome。

### 8.3 S2 — 薄契约扩展（引擎小步，逐项独立 PR，契约先行）

目标：把两个"数字剧场"禁区变成真实读数。每项先改 `crates/tl-protocol` schema + `crates/tl-domain`/`tl-engine`，再生成 `packages/contracts`，最后 UI。

**S2a：`Segment.origin` 持久化（逐行来源徽标的唯一诚实路径）**

- 契约：`Segment` 增 `origin?: {kind: "tmExact" | "tmFuzzy" | "aiDraft" | "human"; score?: number; model?: string}`；写入点：`tm.pretranslate`（exact/fuzzy+score）、`segment.confirm` 的 propagated 句段（tmExact，score 100）、AI 应用草稿（aiDraft+model——应用动作从裸 `segment.update` 升格为带 origin 的更新，契约上给 `segment.update` 加可选 `origin` 入参并限定枚举）、人工输入（human 或缺省）。
- 语义规则（照抄 Studio §2.10 的"污染信号"）：应用后再编辑 → UI 徽标去底色保留分值；确认不改 origin。
- 历史数据：迁移不回填，旧句段 origin 为空，UI 留空——不显示编造的来源。
- UI：状态列组合芯片第二段显示 origin（`95 TM` / `AI`），悬停 tooltip：状态/来源/分值/模型四行（有则显示，无则该行不出现）。
- 改动：`crates/tl-domain`、`crates/tl-engine/src/*`（storage migration + 各写入路径）、`crates/tl-protocol`、`packages/contracts`、`SegmentGrid.tsx`、`TmPanel.tsx`、测试全层（Rust 单测 + contracts check + renderer 单测 + e2e fake-engine fixture 更新 `apps/desktop/tests/harness/fake-engine.mjs`）。

**S2b：词数统计（口径先行）**

- 契约：`SegmentCounts` 增 `sourceWords: number`（或独立 `document.stats` 方法，取实现最薄者）；口径写进 schema doc-comment：UAX #29 词边界，CJK 统一表意文字/假名逐字计 1，数字串计 1，URL/email 计 1（对齐 Crowdin Word Counter 口径）。
- UI：状态栏读数追加 `字数 18,732`，tooltip 注明口径（`源文词数 · CJK 按字`）；文件列表可选显示。引擎未提供（旧引擎二进制）时读数整项不渲染。
- 改动：`crates/tl-domain`（分词实现，建议 `unicode-segmentation`）、`tl-engine` SQL 计数路径、契约与 UI 状态栏。

**S2c（候选，可延后）：`segment.confirm` 增 `writeTm?: boolean`（默认 true）**

- 动机：占位译文不污染 TM（memoQ Ctrl+Shift+Enter，S8）。UI：`Ctrl+Shift+Enter` 和弦 + 菜单项。是否值得做见 §10 开放问题 2；不做则键位保持空缺。

**验收检查**：`pnpm contracts:check` 通过；`cargo test --workspace` 增补迁移与写入点测试；origin 徽标在 pretranslate/AI 应用/人工输入三路径 e2e 各断言一次；词数在纯 CJK、纯 Latin、混排三 fixture 上与口径文档一致；旧库打开无 origin 不报错不编造。

**完成即**：mockup 里的"95% TM"式逐行徽标与"Words: n"读数以真实存储上线，且每个数字可回溯到引擎返回值。

### 8.4 S3 — 结构能力（每项须独立立项 + 契约评审，本 PRD 只给边界）

按预期收益排序；任何一项动工前先写单独的契约提案，禁止 UI 先行：

1. **句段锁定**：合同见 §4.4。收益：预翻 100% 句段保护 + 统计排除。
2. **QA 升级包**：§7.1 S3 六项（severity 重映射→导出闸门、忽略粒度、Correction 通道、行为型检查、Resolve 面板）。
3. **确认时段级 QA 钩子**：`segment.confirm` 返回增量 QA findings 或引擎内确认后自动跑单句检查（Trados §2.2 动作链 3 的对应物）；落地前 UI 不伪装。
4. **多 TM 挂载**：先引擎 memory 模型（多库/优先级/穿透），后 TM 选择器 UI。
5. 归档待议（不承诺）：命名视图书签、OmegaT 式多分数可解释匹配、Wordfast 结构履历。

**完成即**：每项各自定义；共同底线是"UI 出现之日即引擎能力落地之日"。

---

## 9. 范围外 / NEVER-FAKE 附录

以下项在对应引擎/后端能力落地前，禁止以任何 chrome、占位符、灰色按钮、"即将推出"形式出现（依据 capability §3 逐项分档）：

| 项 | 档位 | 备注 |
| --- | --- | --- |
| 云同步 / 远端存储 / 账号 | NEVER-FAKE→LATER | 全栈无网络同步代码（AI provider HTTP 除外） |
| 成员 / 角色 / 头像 / Created by / Reviewer | NEVER-FAKE | 无用户体系；假署名即造假 |
| 评论 / 消息 / 行内 💬 / 通知中心 | NEVER-FAKE | 无评论存储；`waiveNote` 是唯一近似物且只挂 QA issue |
| 翻译/审校模式开关 | NEVER-FAKE | 三态状态机无 reviewer 概念；不改变行为的开关=假 chrome |
| 逐行持久 TM%/MT% 徽标（S2 origin 落地前） | NEVER-FAKE | 行内只显示活动句段实时 lookup 分 |
| MT/AI 置信度数字（任何时候） | NEVER-FAKE | 无 provider 返回置信度；`tl-ai-quality` QE 零接入 |
| `inContext`/101% 匹配分级 | NEVER-FAKE | 契约死枚举，引擎零产出路径 |
| 已翻译（未确认）/已审校/已锁定 状态色标 | NEVER-FAKE（锁定见 S3） | 引擎三态 |
| 结构化 inline tag 芯片（成对编号/F9 流） | NEVER-FAKE | 句段纯文本；占位符高亮是诚实替代 |
| 字数/加权字数（S2 口径落地前） | NEVER-FAKE | 全仓库无词数代码；句段口径旁放来路不明的字数=数字剧场 |
| 多 TM 文件树 / `.sdltm` 节点 / TM 选择器 | NEVER-FAKE | 项目级单 TM |
| Agent 自动确认 / 自动导出 / success 终态 | NEVER-FAKE（契约级） | `AgentRunStatus` 无 success；正常终点 `awaitingReview` |
| 截止日期 / 项目经理字段 / 文件夹树 / 参考文件 | LATER | 契约无字段；不画 |
| Track changes 修订流 / LQA 打分 / 报表家族 | LATER | 无存储；QA 豁免≠LQA |
| Deep Console / 旧 crates/engine / 暖纸色 chrome | 禁止复活 | 历史包袱，不回迁 |

另：`crates/tl-editor`、`crates/tl-ai-quality`、`packages/plugin-sdk` 等"有库代码零 RPC"的能力（capability §1.11）一律按 LATER 对待，不因"代码已存在"而提前画 UI。

---

## 10. 开放问题（研究未能裁决的真实问题）

1. **版式预览常驻的性能预算**：DOCX 版式视图每次刷新走真实导出管线；研究无大文档（>2k 句段）耗时数据。S1 动工前需 spike 实测：若 600ms 静默后单次重导出 P95 > 1.5s，则版式视图降级为手动刷新按钮（Trados Preview/Refresh 双模式先例），校对视图保持实时。
2. **确认不写 TM（S2c）是否值得契约扩展**：memoQ/Wordfast 证明多人场景刚需；单机场景"占位译文污染 TM"的真实频率未知，且 TM 条目已可事后管理（`tm.update`/`tm.delete`）。建议：S2a/S2b 上线后按 TM 管理对话框的实际清理行为数据决定，不预先占用契约。
3. **锁定与传播的交互语义（S3 前置）**：`segment.confirm` 的 propagated 自动填充遇到未来的锁定句段应跳过还是报告？Trados 跳过锁定段有先例，但我们的传播写的是草稿而非确认，语义更弱。留待 S3 锁定契约提案一并裁决。
