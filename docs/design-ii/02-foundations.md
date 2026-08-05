# 02 · 基础层：色彩 · 字体 · 栅格 · 几何

> 本文所有对比度数字均为**实算值**（WCAG 2.1 相对亮度公式），不是估计。
> 验算脚本与完整矩阵见 [`08-accessibility.md` §1](08-accessibility.md)。

---

## 1. 色彩：非彩色层理（Strata）

### 1.1 层理定义（命题一的落地）

四级非彩色面，**亮度严格编码可编辑性**。任何界面区域必须归入其中一级，不允许中间值。

#### 浅色主题

| Token | 值 | 层 | 允许承载 |
| --- | --- | --- | --- |
| `--deck` | `#FBF8F2` | Deck（最亮） | **可编辑/可长读内容**：译文单元格、原文单元格、表单输入、预览页面、匹配正文、术语定义 |
| `--paper` | `#EFEAE1` | Paper（大底） | 应用画布、页面背景、网格空白区、板块之间的底 |
| `--frame` | `#E4DED3` | Frame | 结构：面板头、列头、筛选栏、分组条、卡片底、只读元数据块 |
| `--shade` | `#E0D9CC` | Shade | 交互态：hover、选中行、当前分组、拖拽落点 |
| `--ink` | `#1B1815` | Ink | 标识板、Index Spine、仪表条、主菜单面、模态遮罩基色 |
| `--ink-raised` | `#262220` | Ink+1 | Ink 面上的抬起块：命令面板输入行、Ink 面上的选中项 |

> 亮度严格单调递减：`deck .905 > paper .824 > frame .744 > shade .712`（相对亮度实算值）。
> **选中/hover 态（Shade）比结构面（Frame）更暗**——"被选中"在本系统里是一次**压印**，不是抬起。
> 这与"没有浮层、只有板块对接"的命题五一致：交互态靠**压深**表达，不靠投影或提亮。

#### 深色主题（层理反转，不是反色）

| Token | 值 | 说明 |
| --- | --- | --- |
| `--void` | `#131110` | 大底。比 Ink 更深，因为深色下大底必须退到最后 |
| `--frame` | `#1D1A17` | 结构 |
| `--deck` | `#262220` | **可编辑内容仍然是最亮的那层**（规则不变，方向变） |
| `--shade` | `#2E2924` | 交互态（比 deck 亮，因为深色下"压印"表现为提亮） |
| `--ink` | `#0C0B0A` | 深色下的 Ink 面 = 比大底更深的近黑，用于标识板与仪表条 |

**深色不做的事**：不把彩条调成霓虹（整体降亮 10%）；不引入冷蓝灰面板；不加荧光/辉光；
不把 Deck 做成纯黑（`#000` 在 OLED 外的屏幕上与文本形成过强眩光）。

### 1.2 文字层级

| Token | 浅色 | 深色 | 用途 | 最低对比（浅/深） |
| --- | --- | --- | --- | --- |
| `--text-1` | `#171412` | `#F3EFE7` | 正文、原文/译文、标题、主要标签 | 12.08 / 11.72 |
| `--text-2` | `#655D55` | `#A79E93` | 元数据、次要标签、占位提示、说明文字 | 4.60 / 5.09 |
| `--text-3` | `#8C8479` | `#7B746A` | **仅禁用态**（WCAG 对禁用控件豁免）。**不得**用于任何有效信息 | — |
| `--text-on-ink` | `#F3EFE7` | `#F3EFE7` | Ink 面上的文字 | 15.41 / 15.41 |
| `--text-on-ink-2` | `#A79E93` | `#A79E93` | Ink 面上的次要文字 | 6.70 / 6.70 |

> **硬规则**：`--text-3` 只能出现在 `[disabled]` / `[aria-disabled=true]` 上下文里。
> 上一代把 9–10px 的灰色元数据当成"氛围"，直接违反此条（见偏差报告 Typography 行）。

### 1.3 信号橙 = Active Axis 的颜色

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--signal` | `#E8571F` | `#FF6A33` | **面与线**：主按钮填充、Active Axis、焦点环、活动行前缘、活动标签下缘 |
| `--signal-ink` | `#A5380C` | `#FF6A33` | **文字**：橙色文本、链接式动作、活动计数 |
| `--signal-wash` | `rgb(232 87 31 / .10)` | `rgb(255 106 51 / .14)` | 活动定位淡染（预览中定位当前段、QA 跳转高亮） |

**三条硬规则**

1. **橙面上一律墨字**：`--text-1` on `--signal` = **5.08:1** ✓AA；白字仅 **3.61:1** ✗。
   这同时让主按钮呈现构成主义海报的"橙底黑字"，比白字更贴近来源。
2. **每个橙色填充必须带 1px `--rule-strong` 边框**。橙面对 `--frame`/`--shade` 只有 2.70/2.38 的
   非文本对比，靠边框满足 3:1 的界定要求（WCAG 技术 G207 同类做法）。
3. **同一时刻全屏只有一条 Active Axis**。主按钮的橙面不算轴。橙色总覆盖 ≤ 1.5%。

### 1.4 状态色（语义恒定，双档）

每个状态色有两档：**Lamp**（方灯/填充/图表，≥3:1 非文本）与 **Ink**（文字，≥4.5:1 全大底）。

| 状态 | Lamp（浅） | Ink（浅） | Lamp（深） | Ink（深） | 含义 |
| --- | --- | --- | --- | --- | --- |
| 已确认 | `#3D7A4E` | `#2C603C` | `#5FA377` | `#5FA377` | confirmed / valid / 通过 |
| 需复核 | `#9C7018` | `#6F4E0C` | `#D6A340` | `#D6A340` | warning / draft-with-issue / 待复核 |
| 错误 | `#B23A2B` | `#9E3023` | `#E27263` | `#E27263` | blocking error / 破坏性动作 |
| 机器来源 | `#4A6E88` | `#3C5A70` | `#7FA6C2` | `#7FA6C2` | MT/LLM 出处标注（**仅此一用**） |
| 草稿 | `--text-2` | `--text-2` | `--text-2` | `--text-2` | draft（无色，靠方灯半填形状区分） |
| 未翻译 | `--rule-field` | `--text-2` | `--rule-field` | `--text-2` | untranslated（空心方灯） |

**状态永不只靠颜色**：每个状态同时具备**形状**（方灯：空心 / 半填 / 实心 / 叉 / 圆点）与**文本**。
色盲用户仅凭方灯形状即可区分四种段落状态。

**深色 Lamp 对比**：`green 4.79 / red 4.68 / ochre 5.87 / blue 5.21`（vs `--shade` 最差底）✓。

### 1.5 Translunar Band（保留资产，值不变）

固定顺序，五色，值沿用上一代（这是被保留的品牌资产，不重新取色）：

| # | 名称 | 值 | 深色（−10% 明度） |
| --- | --- | --- | --- |
| 1 | Burnt Orange | `#D9562B` | `#C34D27` |
| 2 | Solar Ochre | `#D29A2E` | `#BD8B29` |
| 3 | Lichen Green | `#87904A` | `#7A8243` |
| 4 | Instrument Teal | `#4F8076` | `#47736A` |
| 5 | Dusk Blue | `#526F86` | `#4A6479` |

规则见 [`03-signatures.md` §1](03-signatures.md)。**这五色不承载任何语义**，不可用于状态、按钮、图表、链接。

### 1.6 接缝（Rules）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--rule-field` | `rgb(27 24 21 / .56)` | **表单控件边界**（输入框、选择器、复选框、开关轨道）。见下方说明 |
| `--rule-strong` | `rgb(27 24 21 / .34)` | **结构缝**：板块之间、Ink/Paper 交界、表格外框 |
| `--rule` | `rgb(27 24 21 / .18)` | **面板缝**：面板内分区、行分隔 |
| `--rule-soft` | `rgb(27 24 21 / .10)` | **内部缝**：卡片内分隔、次级列分隔 |
| 深色对应 | `.50 / .30 / .16 / .09` of `#F3EFE7` | 同上 |

三档**装饰性**缝（strong/normal/soft）之间必须肉眼可分（实算 2.10 / 1.45 / 1.22 vs paper）。
禁止出现第四档装饰缝。

> **为什么表单边界单独一档**：WCAG 1.4.11 要求"识别 UI 组件所必需的视觉信息"达 3:1。
> 输入框的 `--deck` 填充对 `--frame` 底只有 **1.20:1**，靠填充无法界定边界；
> `--rule-strong` 34% 也只有 1.79–2.37。
> 实算后 **56%（`#78746F`）在四层大底上为 3.31–4.38，全部达标**。
> 深色侧 50%（`#8C8884`）为 4.09–5.35，达标。
> 这是本次重构相对上一代的一处**实质无障碍修复**，不是风格偏好。

### 1.7 阴影（仅限真正的临时层）

只有一级，暖调，用于 popover / 菜单 / 模态 / toast。常驻板块**永远不用阴影**。

```css
--elev-pop: 0 1px 0 rgb(27 24 21 / .10),
            0 8px 24px -8px rgb(27 24 21 / .22),
            0 2px 6px -2px rgb(27 24 21 / .14);
--scrim:    rgb(20 17 15 / .52);   /* 模态遮罩：不做模糊 */
```

**不做背景模糊**。毛玻璃属于方舟本体的通用机制，且在 8 小时使用中降低文字可读性。

---

## 2. 字体

### 2.1 三个族（全部 SIL OFL，可随包分发）

| 角色 | 字体 | 选择理由 |
| --- | --- | --- |
| **Display** | **Jost\*** (Owen Earl / indestructible type) | Jost 是 **Futura 的开源复刻谱系**。孤星的展示字体谱系被专题分析明确指向 Futura / ITC Avant Garde Gothic —— 几何、圆方三角构形、近等宽笔画、紧字距。Jost 是这条谱系唯一可用、可分发的开源实现。**仅用于 ≥24px**（几何无衬线小字可读性差，这是纪律不是缺陷） |
| **UI / Body** | **IBM Plex Sans** | 工程学出身的工作字体，14–16px 密集界面下字形开放、数字清晰、有性格但不喧宾夺主。关键优势：与 Mono/CJK 同族，三者是**同一个设计声音**，而不是上一代 Grotesk+Chivo+SpaceMono 三个不相干家族的拼凑 |
| **Mono** | **IBM Plex Mono** | 段号、匹配率、字数、时间戳、快捷键、哈希、文件路径。等宽数字（tabular）保证列不跳动 |
| **CJK** | **IBM Plex Sans SC / TC / JP / KR** | 与拉丁同族，中英混排不撕裂。编辑器内最小 14px |

**替换了什么**：Space Grotesk → Jost（更几何、更贴谱系）；Chivo → IBM Plex Sans（更适合密集数据）；
Space Mono → IBM Plex Mono（Space Mono 的装饰性衬线在小号数字上降低扫读效率）；
Noto Sans SC → IBM Plex Sans SC（与拉丁同族）。

**Fallback 链**：`Jost → Futura → 系统几何无衬线`；`IBM Plex Sans → system-ui`；
`IBM Plex Mono → ui-monospace, Consolas`。Inter/Roboto/Arial **只能作为最终兜底**，不得作为主动选择。

### 2.2 字号阶（1250×744 基线，`--ui-scale` 可无级缩放）

| Token | px / line-height | 字体 | 字重 | 字距 | 用途 |
| --- | --- | --- | --- | --- | --- |
| `--t-hero` | 44 / 1.02 | Jost | 600 | −0.03em | 空态与首页的裁切式大标题，允许被板块边缘裁掉 |
| `--t-display` | 30 / 1.08 | Jost | 600 | −0.02em | 页面标题（洞察、QA 复核、设置） |
| `--t-title` | 20 / 1.20 | Jost | 500 | −0.01em | 区块标题、对话框标题、面板主标题 |
| `--t-section` | 15 / 1.30 | Plex Sans | 600 | 0 | 面板小节标题、表格分组标题 |
| `--t-body` | 14 / 1.50 | Plex Sans | 400 | 0 | UI 正文、按钮、菜单、表单、说明 |
| `--t-editor` | 15.5 / 1.62 | Plex Sans + Plex SC | 400 | 0 | **原文/译文可编辑文本**（用户可 12→20px 无级调） |
| `--t-meta` | 12.5 / 1.35 | Plex Sans | 500 | 0 | 元数据、说明、时间 |
| `--t-micro` | 11 / 1.25 | Plex Mono | 500 | 0.06em | 列头、状态标签、小写→大写的短标签。**下限，不得更小** |
| `--t-num` | 13 / 1.2 | Plex Mono | 500 | 0 | 段号、百分比、计数、字数（`font-variant-numeric: tabular-nums`） |

**上一代的核心缺陷**（偏差报告 High 项）：大量 shell 与元数据渲染在 **9–10px**。
本设计设 `--t-micro: 11px` 为**硬下限**，并在 CSS 里用 `:root { --t-floor: 11px }` + lint 规则约束。

### 2.3 排印纪律

- **一律左对齐**（继承国际主义排版风格 / 孤星）。居中只允许出现在：空态的单一动作按钮、
  对话框底部动作区。**禁止居中长文本**。
- 行长：说明性文本 60–75 字符；译文单元格不设上限（由列宽决定），但列宽下限 320px。
- 全大写**只用于** `--t-micro`（列头、状态、短标签），且必须带 `0.06em` 字距。
  **禁止**大写长于 3 个单词的短语。
- 数字一律 `tabular-nums`；百分比、匹配率、段号、字数全部走 Mono。
- 使用 `text-box-trim: trim-both; text-box-edge: cap alphabetic`（Chromium 133+）
  让显示字级的板块与基线精确对齐——这是"印刷感"的真正来源，不是纹理。
- CJK：不加人为字距；中英之间由引擎侧的 CJK spacing 选项处理，**不由 CSS letter-spacing 伪造**。

---

## 3. 栅格与空间

### 3.1 基准

- **基本单位 4px**。所有间距、尺寸、行高落在 4 的倍数上（`--t-editor` 的 1.62 行高例外，取整到 25px）。
- **应用级列栅格**：12 列，槽宽 `minmax(0,1fr)`，沟 16px，外边距 20px。
  低频页面（首页/向导/洞察）用 **35/65 或 30/70 非对称分割**，禁止 50/50。
- **工作台不用列栅格**，用**板块骨架**（`grid-template-areas`），见 §3.3。

### 3.2 空间阶

```
--s-0:0  --s-1:2  --s-2:4  --s-3:6  --s-4:8  --s-5:12
--s-6:16 --s-7:20 --s-8:24 --s-9:32 --s-10:40 --s-11:56 --s-12:80
```

### 3.3 密度档（新增，对 8 小时用户是必需品）

一个 token 驱动全应用行高与内距。用户在设置或 `Ctrl+Alt+[ / ]` 切换。

| 档 | `--density` | 网格行最小高 | 单元格垂直内距 | 控件高 | 适用 |
| --- | --- | --- | --- | --- | --- |
| Compact | `0.85` | 40px | 6px | 28px | 14"笔记本、审校扫读 |
| **Standard**（默认） | `1` | 48px | 10px | 32px | 常规翻译 |
| Comfortable | `1.18` | 58px | 14px | 36px | 高缩放、长时段、CJK 密集文本 |

密度**不改变字号**（字号由 `--ui-scale` 独立控制），只改行高与内距。二者正交。

---

## 4. 几何

### 4.1 圆角与切角

| 元素 | 值 |
| --- | --- |
| 板块（Plate） | **0** —— 板块永不圆角 |
| 输入框、选择器 | 3px |
| 按钮、chip | 4px |
| 临时层（popover / 菜单 / 模态 / toast） | 6px |
| 标签胶囊（受保护标签） | 2px |
| **45° 切角** | `corner-shape: bevel; border-radius: 14px` —— **每屏最多一处**，只用于品牌板 |

> 上一代的 8px 面板圆角 + 药丸控件（偏差报告 Controls and radii 行）被整体推翻。
> 切角用 Chromium 139+ 的原生 `corner-shape`，不再用 `clip-path` 伪造（伪造会丢边框与焦点环）。

```css
.brand-plate {
  border-radius: 0 14px 0 0;      /* 只切右上角 */
  corner-shape: bevel;
  background: var(--ink);
}
```

### 4.2 线宽

装饰线一律 **1px**，透明度 8–14%。结构缝见 §1.6。
**唯一允许的 2px** 是 Active Axis 与焦点环。**唯一允许的 4px** 是 Translunar Band。
不存在 3px、6px、8px 的线。

### 4.3 图标

- 库：**lucide-react**（已在用，保留）。线宽统一 **1.5px**，尺寸 token 化：
  `--icon-sm 14 / --icon 16 / --icon-lg 20`。禁止出现 13/15/17/18 等散值。
- 同一层级不混用 filled 与 outline。
- 纯图标按钮**必须**有 `aria-label` + tooltip，命中区 ≥28×28（Compact）/32×32（Standard）。
- **产品自有对象自绘图标**（不用通用图标凑合）：段落锚点、标签配对、TM 复用、术语关联、
  文档页、活性矩阵。这五个用 16px 网格上的自绘 SVG，构形限定为圆/方/三角/直线——
  与孤星"复杂对象压缩为基础几何"的做法一致。

---

## 5. 完整 Token 表（可直接落地）

```css
/* ============================================================
   Translunar II · ORTHO — design tokens
   Chromium 146 target. No preprocessor, no framework.
   ============================================================ */

@layer tokens {
  :root {
    color-scheme: light dark;

    /* —— 层理 Strata —————————————————————————— */
    --deck:        #FBF8F2;
    --paper:       #EFEAE1;
    --frame:       #E4DED3;
    --shade:       #E0D9CC;
    --ink:         #1B1815;
    --ink-raised:  #262220;

    /* —— 文字 —————————————————————————————— */
    --text-1:      #171412;
    --text-2:      #655D55;
    --text-3:      #8C8479;   /* disabled only */
    --text-on-ink:   #F3EFE7;
    --text-on-ink-2: #A79E93;

    /* —— 信号橙（Active Axis） ————————————— */
    --signal:      #E8571F;
    --signal-ink:  #A5380C;
    --signal-wash: rgb(232 87 31 / .10);
    --on-signal:   var(--text-1);   /* 橙面上永远是墨字 */

    /* —— 状态：Lamp / Ink 双档 ——————————————— */
    --ok:        #3D7A4E;  --ok-ink:    #2C603C;
    --warn:      #9C7018;  --warn-ink:  #6F4E0C;
    --err:       #B23A2B;  --err-ink:   #9E3023;
    --machine:   #4A6E88;  --machine-ink: #3C5A70;

    /* —— Translunar Band（固定顺序，无语义） ——— */
    --band-1: #D9562B;  --band-2: #D29A2E;  --band-3: #87904A;
    --band-4: #4F8076;  --band-5: #526F86;

    /* —— 接缝 —————————————————————————————— */
    --rule-field:  rgb(27 24 21 / .56);   /* 表单控件边界，WCAG 1.4.11 达标 */
    --rule-strong: rgb(27 24 21 / .34);
    --rule:        rgb(27 24 21 / .18);
    --rule-soft:   rgb(27 24 21 / .10);

    /* —— 临时层 ——————————————————————————— */
    --elev-pop: 0 1px 0 rgb(27 24 21 / .10),
                0 8px 24px -8px rgb(27 24 21 / .22),
                0 2px 6px -2px rgb(27 24 21 / .14);
    --scrim: rgb(20 17 15 / .52);

    /* —— 字体 —————————————————————————————— */
    --font-display: "Jost", "Futura", system-ui, sans-serif;
    --font-ui: "IBM Plex Sans", "IBM Plex Sans SC", system-ui, sans-serif;
    --font-mono: "IBM Plex Mono", ui-monospace, Consolas, monospace;

    --t-hero:    44px; --lh-hero: 1.02;
    --t-display: 30px; --lh-display: 1.08;
    --t-title:   20px; --lh-title: 1.20;
    --t-section: 15px; --lh-section: 1.30;
    --t-body:    14px; --lh-body: 1.50;
    --t-editor:  15.5px; --lh-editor: 1.62;
    --t-meta:  12.5px; --lh-meta: 1.35;
    --t-micro:   11px; --lh-micro: 1.25;   /* 硬下限 */
    --t-num:     13px;

    /* —— 空间 —————————————————————————————— */
    --s-1: 2px;  --s-2: 4px;  --s-3: 6px;  --s-4: 8px;  --s-5: 12px;
    --s-6: 16px; --s-7: 20px; --s-8: 24px; --s-9: 32px; --s-10: 40px;
    --s-11: 56px; --s-12: 80px;

    /* —— 密度 & 缩放（正交） ————————————————— */
    --density: 1;
    --ui-scale: 1;
    --row-min:  calc(48px * var(--density));
    --cell-pad: calc(10px * var(--density));
    --ctl-h:    calc(32px * var(--density));

    /* —— 几何 —————————————————————————————— */
    --r-input: 3px; --r-ctl: 4px; --r-pop: 6px; --r-tag: 2px;
    --bevel: 14px;

    --icon-sm: 14px; --icon: 16px; --icon-lg: 20px;

    /* —— 固定尺寸（板块骨架） —————————————— */
    --spine-w:    48px;   /* Index Spine */
    --band-w:      4px;   /* Translunar Band 脊柱 */
    --matrix-w:   28px;   /* Document Matrix */
    --masthead-h: 56px;
    --filterbar-h: 44px;
    --instrument-h: 30px;
    --stack-w:   420px;   /* Suggestions Stack，可拖 360–560 */
    --dock-h:    216px;   /* 预览坞展开默认，可拖 120–360；收起 32 */

    /* —— 动效（详见 04-motion.md） ————————— */
    --ease-in:   linear(0,.22 3.5%,.42 7.2%,.6 11.2%,.75 15.7%,.87 20.9%,.95 26.9%,1 36%,1);
    --ease-move: cubic-bezier(.2,.8,.2,1);
    --ease-out:  cubic-bezier(.4,0,1,1);
    --d-micro: 90ms;  --d-state: 140ms;  --d-local: 200ms;
    --d-page:  280ms; --d-slow:  420ms;
  }

  /* —— 深色主题：层理反转 ————————————————— */
  :root[data-theme="dark"] {
    --deck:  #262220;   /* 可编辑仍是最亮层 */
    --paper: #131110;
    --frame: #1D1A17;
    --shade: #2E2924;
    --ink:   #0C0B0A;
    --ink-raised: #1D1A17;

    --text-1: #F3EFE7;
    --text-2: #A79E93;
    --text-3: #7B746A;

    --signal:      #FF6A33;
    --signal-ink:  #FF6A33;
    --signal-wash: rgb(255 106 51 / .14);
    --on-signal:   #131110;

    --ok:  #5FA377; --ok-ink:  #5FA377;
    --warn:#D6A340; --warn-ink:#D6A340;
    --err: #E27263; --err-ink: #E27263;
    --machine: #7FA6C2; --machine-ink: #7FA6C2;

    --band-1:#C34D27; --band-2:#BD8B29; --band-3:#7A8243;
    --band-4:#47736A; --band-5:#4A6479;

    --rule-field:  rgb(243 239 231 / .50);
    --rule-strong: rgb(243 239 231 / .30);
    --rule:        rgb(243 239 231 / .16);
    --rule-soft:   rgb(243 239 231 / .09);

    --scrim: rgb(0 0 0 / .62);
    --elev-pop: 0 1px 0 rgb(0 0 0 / .5),
                0 10px 28px -8px rgb(0 0 0 / .6),
                0 2px 8px -2px rgb(0 0 0 / .45);
  }

  /* —— 密度档 ——————————————————————————— */
  :root[data-density="compact"]     { --density: .85; }
  :root[data-density="comfortable"] { --density: 1.18; }
}

@layer base {
  html { font-size: calc(16px * var(--ui-scale)); }
  body {
    font-family: var(--font-ui);
    font-size: var(--t-body);
    line-height: var(--lh-body);
    color: var(--text-1);
    background: var(--paper);
    text-box-trim: trim-both;
    text-box-edge: cap alphabetic;
  }
  :is(h1,h2,h3) { font-family: var(--font-display); font-weight: 600; letter-spacing: -.02em; }
  :is(.num, .seg-id, .pct, .count, kbd) {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--t-num);
  }
  .micro {
    font: 500 var(--t-micro)/var(--lh-micro) var(--font-mono);
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  :focus-visible {
    outline: 2px solid var(--signal);
    outline-offset: 2px;
    border-radius: 2px;
  }
}
```

---

## 6. 违规自检（可写成 stylelint / 单测）

| 检查 | 判据 |
| --- | --- |
| 字号下限 | 计算后 `font-size` < 11px → 失败 |
| 层理越界 | 任何 `[contenteditable]` / `input` / `textarea` 的背景不是 `--deck` → 失败 |
| 装饰压文字 | `.matrix`, `.rule-art`, `.orbit` 的祖先链上出现 `.cell-source/.cell-target/.match-body` → 失败 |
| 橙色白字 | `color:#fff` 且 `background` 含 `--signal` → 失败 |
| 多轴 | 运行时 `document.querySelectorAll('[data-axis="active"]').length > 1` → 失败 |
| 彩条重复 | 一屏 `.band--full` > 1 → 失败 |
| 圆角越界 | `border-radius > 6px` 且非 `.brand-plate` → 失败 |
| 阴影越界 | 常驻板块（非 `[popover]`/`dialog`/`.toast`）带 `box-shadow` → 失败 |
| 线宽越界 | 出现 3px/5px/6px/8px 边框 → 失败 |
