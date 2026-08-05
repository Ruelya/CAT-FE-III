# 06 · 应用外壳与导航

---

## 1. 外壳骨架（所有 Surface 共用）

```
┌─┬──┬──────────────────────────────────────────────────────────────────────┐
│B│  │                                                                      │
│A│I │                                                                      │
│N│N │                                                                      │
│D│D │                        SURFACE  SLOT                                 │
│ │E │                （工作台 / QA / 洞察 / 资产 / AI / 设置）                │
│S│X │                                                                      │
│P│  │                                                                      │
│I│S │                                                                      │
│N│P │                                                                      │
│E│I │                                                                      │
│ │N ├──────────────────────────────────────────────────────────────────────┤
│ │E │  INSTRUMENT  STRIP                                             30px  │
└─┴──┴──────────────────────────────────────────────────────────────────────┘
 4px 48px
```

三个**跨 Surface 恒定**的元素（不参与页面转场捕获）：

1. **Band Spine** 4px — `03-signatures.md §1`
2. **Index Spine** 48px — §2 本文
3. **Instrument Strip** 30px — §4 本文

Surface Slot 是唯一被替换的区域。这保证了：切页面时用户的空间锚点从不丢失，
转场只需渲染一个矩形，性能可控。

```css
.shell {
  display: grid;
  grid-template-columns: var(--band-w) var(--spine-w) 1fr;
  grid-template-rows: 1fr var(--instrument-h);
  grid-template-areas:
    "band spine surface"
    "band spine instrument";
  block-size: 100dvh;
  background: var(--paper);
}
.shell[data-spine="hidden"] { grid-template-columns: var(--band-w) 0 1fr; }
.surface-slot { grid-area: surface; view-transition-name: surface; contain: layout paint; }
```

---

## 2. Index Spine（48px 常驻左栏）

### 2.1 为什么打破"无常驻左栏"

上一代规则"无常驻左栏"针对的是**文件树侧栏**（会吃掉 240–280px 工作宽度）。
Index Spine 是**全局 Surface 切换器**，48px = 1250px 的 3.8%，
换掉的是一个藏在 `…` 溢出菜单里的 6 项顶层导航（`WorkbenchPages.tsx:132`）。

**代价 48px，收益：顶层导航从"两次点击 + 记忆位置"降到"一次点击 + 恒定位置"。**
并且它提供了 Active Axis 的最外层驻留位——用户始终能看到自己在哪个 Surface。

**可关闭**：`Ctrl+\` 隐藏，退化为纯命令面板导航（宽度全部还给网格）。偏好持久化。

### 2.2 结构（自上而下）

| 区 | 高 | 内容 |
| --- | --- | --- |
| 标识 | 56 | 32×32 应用标记（含 Band Echo）；点击 = 回项目首页；tooltip 显示项目名 |
| — | 缝 | `--rule-strong` |
| 导航 | 6×44 | 六个 Surface 灯 |
| 弹性 | 1fr | Inert Matrix 竖向裁切块（低对比，`mask` 渐隐） |
| 工具 | 2×44 | 命令面板入口（`⌘`）、设置（齿轮） |
| 主题 | 44 | 明/暗/跟随系统三态循环 |

### 2.3 六个 Surface 灯

| 顺序 | Surface | 图标 | 快捷键 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 工作台 Workbench | 段落网格自绘图标 | `Ctrl+1` | 默认 |
| 2 | QA 复核 | 盾+叉 | `Ctrl+2` | 徽标显示未处理错误数 |
| 3 | 导出复核 | 出箱 | `Ctrl+3` | 有阻断项时徽标变红 |
| 4 | 资产 Assets | 库（TM/术语/养护/对齐/语料统一入口） | `Ctrl+4` | 合并了原 TM 页与养护页 |
| 5 | AI 控制台 | 自绘"接地"图标 | `Ctrl+5` | 有进行中批处理时显示活动轨 |
| 6 | 项目洞察 Insights | 矩阵方块 | `Ctrl+6` | 11 个子标签的容器 |

**灯的几何**：44×44 命中区；内含 20px 图标；当前项左缘是 Active Axis（2px×32px）；
当前项背景 `--ink-raised`；未选中图标 `--text-on-ink-2`，选中 `--text-on-ink`。
**徽标**：右上角 14×14 方块（不是圆），数字用 Mono 10px——这是唯一允许低于 11px 的位置，
因为它是**图形化计数**且旁边有 `aria-label` 全文。

> 说明：原 `translation-memory` 与 `ai-control` 两个独立 Surface 被合并/重排为
> **资产（4）** 与 **AI 控制台（5）**，因为原 TM 页只有一个精确查找框（`WorkbenchPages.tsx:206`），
> 不足以独占一个顶层位置。详见 `screens/assets.md §1`。

### 2.4 代码

```tsx
<nav className="index-spine plate--ink" aria-label="应用视图">
  <button className="spine__mark" onClick={goHome} aria-label={`项目：${project.name}，返回项目列表`}>
    <AppMark withBandEcho />
  </button>
  <ul className="spine__nav">
    {SURFACES.map((s, i) => (
      <li key={s.id}>
        <button
          type="button"
          data-current={surface === s.id || undefined}
          aria-current={surface === s.id ? "page" : undefined}
          onClick={() => go(s.id)}
          aria-label={s.label}
          aria-keyshortcuts={`Control+${i + 1}`}
        >
          <s.Icon size={20} strokeWidth={1.5} aria-hidden />
          {s.badge ? <b className="spine__badge" data-tone={s.tone}>{s.badge}</b> : null}
        </button>
        <Tooltip>{s.label} <kbd>Ctrl+{i + 1}</kbd></Tooltip>
      </li>
    ))}
  </ul>
  <div className="matrix-inert spine__filler" aria-hidden />
  <div className="spine__tools">…</div>
</nav>
```

---

## 3. 命令面板（`Ctrl+K` / `Ctrl+Shift+P`）

### 3.1 定位

它是 **F2/F3 频率档的统一出口**（`01-art-direction.md` 命题六）。
上一代散落在工具条与 `…` 菜单里的功能全部收敛到这里：撤销/重做、批注、查找替换、
拆分合并、简繁转换、原文更正、快捷键预设、插件动作、Surface 跳转、文档切换、全局搜索。

### 3.2 几何

- **不居中**：面板贴在视口**左上 1/3 处**（`inset: 12vh auto auto calc(var(--band-w) + var(--spine-w) + 40px)`），
  宽 **640px**。理由：居中大弹窗会遮住用户正在读的活动行；靠左上则活动区仍可见。
- Ink 面（`--ink`），输入行是 `--ink-raised`，结果项是 Ink 上的行。
- 品牌板切角出现在右上角（本屏唯一一处 bevel）。
- 输入行左缘一条 2px `--signal`（Active Axis 驻留态）。

### 3.3 行为

| 项 | 规格 |
| --- | --- |
| 打开 | `Ctrl+K`。若当前在 IME 组合态 → **不响应**（见 `07-interaction.md §3`） |
| 分组 | `动作` / `跳转` / `文档` / `段落` / `插件` / `最近`，分组标题用 `--t-micro` |
| 匹配 | 子序列模糊匹配 + 拼音首字母（中文命令）；命中字符用 `--signal-ink` 加粗，**不用背景高亮** |
| 前缀 | `>` 仅动作 · `#` 仅段落（输入段号直达） · `@` 仅文档 · `?` 帮助 |
| 键盘 | `↑↓` 移动（Axis 跟随）· `Enter` 执行 · `Tab` 补全 · `Esc` 关闭并**焦点回到触发处** |
| 空态 | `没有匹配 "xxx"` + `搜索全部段落` 次级动作。**不写氛围文案** |
| 危险动作 | 破坏性项（清空译文、删除项目）在面板内**不直接执行**，回车后转为确认对话框 |
| 性能 | 结果列表虚拟化；输入去抖 60ms；≤120ms 内首屏结果 |

### 3.4 代码骨架

```tsx
<div popover="manual" id="cmdk" className="cmdk plate--ink brand-plate" ref={ref}
     role="dialog" aria-modal="true" aria-label="命令面板">
  <div className="cmdk__input">
    <span className="axis" data-axis="active" />
    <input ref={inputRef} value={q} onChange={…}
           placeholder="输入命令、段号或文档名"
           aria-controls="cmdk-list" aria-expanded="true"
           aria-activedescendant={`cmd-${active}`} role="combobox" />
    <kbd>Esc</kbd>
  </div>
  <ul id="cmdk-list" role="listbox" className="cmdk__list">…</ul>
  <footer className="cmdk__hint micro">↑↓ 选择 · ↵ 执行 · &gt; 动作 · # 段落 · @ 文档</footer>
</div>
```

---

## 4. Instrument Strip（30px 底部仪表条）

### 4.1 推翻了什么

上一代：`Segment 1 of 3 · 0 confirmed · 0 draft · 3 untranslated · 0 QA issues` —— 一行平铺文字，
30px × 1250px 的整幅带宽只承载了 5 个数字。

### 4.2 新结构

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 段 418/1,248 │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒░░░░░░▮▮│ 62% │ 已保存 │ 8,412 词 │ ∴∴∴ │
└────────────────────────────────────────────────────────────────────────────┘
  Mono 定位     100% 堆叠进度条（占满剩余宽）    Mono  保存态   计数    Inert
```

**核心变化：中段是一条占满剩余宽度的 100% 堆叠进度条**，用状态色按真实比例分段：
`已确认(--ok) / 草稿(--text-2) / 未翻译(空,--rule)`。

> **只放互斥三态。** `SegmentCounts` 的契约是
> `untranslated + draft + confirmed = total`，而 `openIssues` 是**叠加维度**——
> 一个已确认段同样可以有未决问题。把它作为第四段堆进去会让总和越过 100%，
> 直接推翻下面"每段宽度 = 真实占比"这条自我声明。
> 因此**问题数在条子右侧作为独立计数 + 方灯呈现**，不参与堆叠。

它同时是：
- 全屏最强的一条图形元素（跨越 800+px 的实色带）；
- 一个**真实的图表**（每段宽度 = 真实占比，可 hover 读数）；
- 与 Band Spine **不会混淆**：方向不同（横 vs 竖）、颜色不同（状态色 vs 五色）、
  比例可变（vs 严格等分）、位置不同（底 vs 左缘）。

### 4.3 交互

| 动作 | 结果 |
| --- | --- |
| Hover 某段 | 锚定 tooltip：`草稿 401 段 · 32.1%` |
| 点击某段 | 把网格筛选切到该状态（等同筛选栏对应 chip） |
| 键盘 | `Tab` 可达，`←→` 在三段间移动，`Enter` 应用筛选 |

### 4.4 端部

- 左端：`段 418 / 1,248`（Mono）——点击聚焦 Document Matrix。
- 右端：保存态（`已保存` / `保存中…` / `离线，已缓存`，带 8px 方灯）、词/字符计数、
  最右 40px 是 Inert Matrix 端帽（裁切收边）。
- **保存态永远显示真实值**；不显示"同步中"除非真有同步。

### 4.5 代码

```tsx
<footer className="instrument plate--ink" aria-label="文档状态">
  <span className="num">段 <b>{ordinal.toLocaleString()}</b> / {total.toLocaleString()}</span>

  {/* 只堆互斥三态：confirmed / draft / untranslated */}
  <div className="instrument__bar" role="img"
       aria-label={`已确认 ${c} 段，草稿 ${d} 段，未翻译 ${u} 段，共 ${total} 段`}>
    {STACK_SEGMENTS.map(s => (
      <button key={s.key} type="button" style={{ flexGrow: s.count }}
              data-state={s.key} onClick={() => setFilter(s.key)}
              aria-label={`${s.label} ${s.count} 段，${pct(s.count)}。点击筛选`} />
    ))}
  </div>

  <span className="num">{pct(c)}</span>
  {/* 问题是叠加维度：独立计数，不进堆叠条 */}
  {openIssues > 0 ? (
    <button type="button" className="instrument__issues"
            onClick={() => setFilter("issues")}
            aria-label={`${openIssues} 个未决问题。点击筛选`}>
      <span className="lamp" data-state="error" aria-hidden />
      <span className="num">{openIssues.toLocaleString()}</span> 问题
    </button>
  ) : null}
  <SaveState value={save} />
  <span className="num">{words.toLocaleString()} 词</span>
  <span className="matrix-inert instrument__cap" aria-hidden />
</footer>
```

```css
.instrument__bar { display: flex; block-size: 8px; gap: 1px; flex: 1; min-inline-size: 200px; }
.instrument__bar > button { border: 0; padding: 0; transition: filter var(--d-micro) }
.instrument__bar > button:hover { filter: brightness(1.18) }
.instrument__bar > button { min-inline-size: 3px }   /* 极小计数仍可见 */
[data-state="confirmed"]   { background: var(--ok) }
[data-state="draft"]       { background: var(--text-2) }
[data-state="untranslated"]{ background: rgb(243 239 231 / .18) }

/* --err 只用于问题计数的方灯，不作为堆叠条的第四段 */
.instrument__issues .lamp[data-state="error"] { background: var(--err) }
```

---

## 5. Surface 模型与路由

### 5.1 六个 Surface（顶层，互斥）

| id | 标题 | 进入条件 | 退出保护 |
| --- | --- | --- | --- |
| `workbench` | （无标题，工作台不显示页面标题） | 有活动文档 | 有未保存草稿 → 静默持久化，不拦截 |
| `qa` | QA 复核 | 有活动文档 | — |
| `export` | 导出复核 | 有活动项目 | 导出进行中 → 提示后台继续 |
| `assets` | 资产 | 有活动项目 | 养护未应用的选择 → 确认对话框 |
| `ai` | AI 控制台 | 有活动项目 | 批处理进行中 → 提示后台继续 |
| `insights` | 项目洞察 | 有活动项目 | — |

**无项目时**：Surface Slot 显示**项目首页**（`screens/project.md §1`），Index Spine 的 6 个灯禁用
（`--text-3` + `aria-disabled`），只留标识、命令面板、设置、主题。

### 5.2 Surface 内部导航

- **工作台**：无子导航（面板与坞是同屏区域，不是子页）。
- **洞察**：11 个子标签，用**竖向标签列**（左 180px），不是横向标签——11 个横标签必然溢出，
  上一代已经证明这点。见 `screens/project.md §3`。
- **资产**：5 个子标签（TM / 术语 / 养护 / 对齐与语料 / 互操作），横向标签够用。
- **QA / 导出 / AI**：单页。

### 5.3 转场类型映射

| 从 → 到 | `types` | 方向 |
| --- | --- | --- |
| 工作台 → 任意 Surface | `surface-in` | 从右下进入 |
| 任意 Surface → 工作台 | `surface-out` | 从左上进入 |
| Surface ↔ Surface（平级） | `surface-in` | 从右下进入 |
| 项目首页 → 工作台 | `surface-in` + `project-open` | 项目卡做 FLIP 放大成标识板 |
| 工作台 → 项目首页 | `surface-out` | 反向 |
| 向导步进 | `wizard-next` / `wizard-back` | 只换右侧内容区，左栏构图不动 |

### 5.4 状态保留

返回某 Surface 时必须恢复：滚动位置、筛选、选中项、展开的分组、子标签、输入中的草稿。
实现：每个 Surface 持有一个 `sessionStorage` 快照，键为 `surface:{id}:{projectId}:{documentId}`。

---

## 6. Masthead（工作台内的顶部标识板，56px）

> 注意：Masthead 属于 Surface 内部，**不是**外壳的一部分——它随页面转场一起替换。

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▛▀▀▀▀▀▀▀▀▀▀▀▜                                                                │
│ ▌CRAFT       ▌  ⟨📄 Master Services Agreement.docx  62% ▾⟩    Run QA  Export ⋯│
│ ▌CONTRACTS   ▌   EN-US → ZH-CN · 8 文件                                       │
│ ▙▄▄▄▄▄▄▄▄▄▄▄▟                                                                │
└──────────────────────────────────────────────────────────────────────────────┘
  Ink 板 · 320px · 右上 bevel 切角        Frame 面
```

| 区 | 规格 |
| --- | --- |
| 标识板 | 320px 宽 Ink 板，**右上角 45° bevel**（本屏唯一）。项目名用 Jost 20/500，两行，允许被板右缘裁切（`overflow: clip` + 渐隐 mask）。下方一行 `--t-micro` 显示语向与文件数 |
| 文档切换器 | Frame 面上的按钮，含文件名 + 进度 + `▾`。点击开 popover：文件列表（名称、类型、段数、进度条、问题数、搜索框）。**这就是"无常驻文件栏"的替代物** |
| 动作区 | `Run QA`（次级：墨边框）、`Export`（主：橙面墨字 + 1px 边框）、`⋯`（溢出：项目设置、归档、模板另存、重导入） |
| **移除** | 全局搜索框 —— 移入命令面板（`Ctrl+K` 或 `Ctrl+Shift+K`）。省下 300px 给标识与文档切换器 |

**为什么移除全局搜索框**：实拍 `13-workbench-default.png` 里它占 300px 却只是命令面板的一个子集，
而它挤压了标识板导致"CRAFT CONTRACTS 2026 / LEGAL"缩到 10px。删掉它，标识板才有空间成立。
搜索的可发现性由 Index Spine 的 `⌘` 按钮 + 空态提示 + 首次教程承担。

---

## 7. 响应式与最小视口

| 宽度 | 行为 |
| --- | --- |
| ≥ 1600 | Stack 面板可拖到 560；预览坞可拖到 360；网格显示可选"匹配来源"窄列 |
| 1280–1599 | 基线布局 |
| 1180–1279 | Stack 收窄到 360；Masthead 隐藏语向副行 |
| 1024–1179 | **Stack 变为覆盖式抽屉**（从右侧滑入，盖住网格右部，带遮罩）；Document Matrix 保留 |
| < 1024 | Index Spine 自动隐藏（仍可 `Ctrl+\` 唤出为覆盖层）；预览坞默认收起 |
| < 900 | 显示"窗口过窄"提示条 + 建议尺寸；**不做移动端布局**（超出产品范围） |

**不可让步的下限**：可编辑文本 ≥14px；网格在预览展开时保留 ≥420px 可视高；
Document Matrix 永不隐藏（它是滚动条的替代物）。

---

## 8. 窗口与平台

| 项 | Windows | macOS |
| --- | --- | --- |
| 标题栏 | 自绘：Masthead 高度内嵌入 `-webkit-app-region: drag`，右上角原生最小/最大/关闭 | `titleBarStyle: hiddenInset`，Masthead 左侧预留 78px 红绿灯安全区 |
| 菜单栏 | 无原生菜单栏；全部走命令面板 | 保留原生菜单（文件/编辑/视图/帮助），项与命令面板同源 |
| 圆角 | 直角 | 系统圆角，`.shell` 用 `overflow: clip` 裁切 Band Spine |
| 焦点环 | 系统高对比模式下切换为 `Highlight` 系统色 | 同 |
