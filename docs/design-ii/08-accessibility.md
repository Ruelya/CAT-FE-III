# 08 · 无障碍与密度

> 本文的所有对比度数字是**实算值**，不是设计意图。验算脚本见 §1.4，可直接进 CI。

---

## 1. 对比度验算

### 1.1 浅色 · 文字层（要求 ≥ 4.5:1，AA 正文）

| Token | deck `#FBF8F2` | paper `#EFEAE1` | frame `#E4DED3` | shade `#E0D9CC` | 判定 |
| --- | --- | --- | --- | --- | --- |
| `text-1` `#171412` | 17.30 | 15.30 | 13.70 | 13.07 | ✅ |
| `text-2` `#655D55` | 6.10 | 5.39 | 4.83 | 4.60 | ✅ |
| `signal-ink` `#A5380C` | 6.25 | 5.53 | 4.95 | 4.72 | ✅ |
| `ok-ink` `#2C603C` | 6.96 | 6.16 | 5.51 | 5.26 | ✅ |
| `warn-ink` `#6F4E0C` | 7.15 | 6.33 | 5.66 | 5.40 | ✅ |
| `err-ink` `#9E3023` | 6.83 | 6.04 | 5.41 | 5.16 | ✅ |
| `machine-ink` `#3C5A70` | 6.86 | 6.07 | 5.43 | 5.18 | ✅ |

`text-3` `#8C8479`（2.43–3.48）**仅用于禁用态**，WCAG 对禁用控件豁免。
任何有效信息使用 `text-3` 视为缺陷。

### 1.2 浅色 · 非文本层（要求 ≥ 3:1，WCAG 1.4.11）

| Token | deck | paper | frame | shade | 判定 |
| --- | --- | --- | --- | --- | --- |
| `ok` `#3D7A4E` | 4.84 | 4.28 | 3.83 | 3.66 | ✅ |
| `err` `#B23A2B` | 5.61 | 4.96 | 4.44 | 4.24 | ✅ |
| `machine` `#4A6E88` | 5.11 | 4.52 | 4.05 | 3.86 | ✅ |
| `warn` `#9C7018` | 4.18 | 3.69 | 3.31 | 3.15 | ✅ |
| **`rule-field` 56% `#78746F`** | 4.38 | 3.87 | 3.47 | 3.31 | ✅ |
| `rule-strong` 34% `#A7A39C` | 2.37 | 2.10 | 1.88 | 1.79 | ⚠ **仅装饰性分隔，不得作为控件唯一边界** |
| `signal` `#E8571F` | 3.41 | 3.01 | 2.70 | 2.38 | ⚠ **必须配 1px `--rule-field` 边框** |

**两条由验算逼出来的硬规则**：
1. 所有表单控件边界用 `--rule-field`，不用 `--rule`。
2. 所有橙色填充带 1px `--rule-field` 边框（WCAG 技术 G207：相邻色不足时用边界界定）。

### 1.3 深色（要求 ≥ 4.5:1）

| Token | deck `#262220` | paper `#131110` | frame `#1D1A17` | shade `#2E2924` | 判定 |
| --- | --- | --- | --- | --- | --- |
| `text-1` `#F3EFE7` | 13.75 | 16.42 | 15.10 | 12.55 | ✅ |
| `text-2` `#A79E93` | 5.97 | 7.13 | 6.56 | 5.45 | ✅ |
| `signal` `#FF6A33` | 5.53 | 6.60 | 6.07 | 5.05 | ✅ |
| `ok` `#5FA377` | 5.25 | 6.27 | 5.77 | 4.79 | ✅ |
| `warn` `#D6A340` | 6.89 | 8.22 | 7.57 | 6.29 | ✅ |
| `err` `#E27263` | 5.12 | 6.12 | 5.63 | 4.68 | ✅ |
| `machine` `#7FA6C2` | 6.11 | 7.29 | 6.71 | 5.58 | ✅ |

### 1.4 橙面组合（**决定"橙底墨字"规则的那组数**）

| 组合 | 对比 | 判定 |
| --- | --- | --- |
| 墨字 `#171412` on `--signal` `#E8571F` | **5.08** | ✅ AA |
| 白字 `#FFFFFF` on `--signal` `#E8571F` | **3.61** | ❌ **因此全应用禁用橙底白字** |
| 深色 `#131110` on `#FF6A33` | 6.60 | ✅ |
| `text-on-ink` `#F3EFE7` on `--ink` `#1B1815` | 15.41 | ✅ |
| `text-on-ink-2` `#A79E93` on `--ink` `#1B1815` | 6.70 | ✅ |

### 1.5 验算脚本（进 CI）

```python
# scripts/check-contrast.py — 无第三方依赖
def _lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def luminance(hex_color):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)

def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

LIGHT_GROUNDS = ["#FBF8F2", "#EFEAE1", "#E4DED3", "#E0D9CC"]
DARK_GROUNDS  = ["#262220", "#131110", "#1D1A17", "#2E2924"]

TEXT_LIGHT = {"text-1":"#171412","text-2":"#655D55","signal-ink":"#A5380C",
              "ok-ink":"#2C603C","warn-ink":"#6F4E0C","err-ink":"#9E3023",
              "machine-ink":"#3C5A70"}
UI_LIGHT   = {"ok":"#3D7A4E","warn":"#9C7018","err":"#B23A2B",
              "machine":"#4A6E88","rule-field":"#78746F"}

def check(pairs, grounds, floor, label):
    bad = []
    for name, value in pairs.items():
        worst = min(contrast(value, g) for g in grounds)
        if worst < floor:
            bad.append(f"{label} {name} {value}: {worst:.2f} < {floor}")
    return bad

failures  = check(TEXT_LIGHT, LIGHT_GROUNDS, 4.5, "light-text")
failures += check(UI_LIGHT,   LIGHT_GROUNDS, 3.0, "light-ui")
# 橙面墨字必须 >= 4.5；橙面白字必须被禁用
assert contrast("#171412", "#E8571F") >= 4.5
if failures:
    raise SystemExit("contrast failures:\n" + "\n".join(failures))
print("contrast OK")
```

---

## 2. 键盘可达性

见 `07-interaction.md`。此处只列**验收条件**：

- [ ] 拔掉鼠标可完成：新建项目 → 导入 → 翻译一段 → 确认 → 运行 QA → 修一个问题 → 导出
- [ ] 每个 Surface 都能靠 `Ctrl+1..6` 到达
- [ ] 网格是单个 Tab 停靠点（roving tabindex），不是 6,240 个
- [ ] 所有叠层关闭后焦点归还触发元素
- [ ] 焦点在任何状态下可见（含 Ink 面上——Ink 面的焦点环用 `--signal`，对 `#1B1815` 为 5.9:1）
- [ ] 拖拽手柄（Stack 宽 / 坞高 / 列宽）全部可用键盘操作
- [ ] Document Matrix 可键盘导航（roving + `Enter` 跳转）
- [ ] 无键盘陷阱（Drawer 可 Tab 出去，只有 Dialog 陷阱）

---

## 3. 屏幕阅读器

| 区域 | 语义 |
| --- | --- |
| 外壳 | `role="application"` **不用**。用原生地标：`banner`（Masthead）、`navigation`（Index Spine）、`main`（Surface Slot）、`contentinfo`（仪表条）、`complementary`（Stack） |
| 段落网格 | `role="grid"` + `aria-rowcount`（总段数，非渲染数）+ 每行 `aria-rowindex`（真实段序）。虚拟化必须正确报告总数 |
| 单元格 | `role="gridcell"`；译文单元格 `aria-label="段 418 译文"` |
| 状态方灯 | 不是图片。用 `<span class="lamp" role="img" aria-label="已确认">` |
| Document Matrix | `role="slider"` + `aria-valuemin/max/now` + `aria-label="文档段落矩阵"`；每个点是 `button` 带完整 `aria-label` |
| 仪表条比例条 | `role="img"` + 一句完整 `aria-label` 描述全部四个数值 |
| 匹配卡 | `role="listitem"`；匹配率用 `aria-label="96% 匹配"`（不让读屏念 `96` 后停顿） |
| 词级 diff | 删除词包 `<del>`，新增词包 `<ins>`；额外提供 `aria-label` 汇总（`3 处删除，2 处新增`） |
| 实时区域 | 保存状态 / QA 运行完成 / AI 生成完成 → `aria-live="polite"`；阻断性错误 → `role="alert"` |
| Surface 切换 | 切换后焦点移到 `main`（`tabindex="-1"`）并 `aria-live` 播报页面名 |
| 装饰 | 全部 Inert Matrix、Band、构图线 → `aria-hidden="true"` |

**不做的事**：不给纯装饰元素加 `aria-label`；不用 `title` 替代 `aria-label`；
不在 `aria-live` 里播报高频变化（如逐段切换——那会淹没用户）。

---

## 4. 缩放与文本大小

| 项 | 要求 |
| --- | --- |
| 界面缩放 | 80%–160% 无级（`--ui-scale`），**布局不裁切、不重叠** |
| 125% 验收 | 1250×744 @125% 下：网格可用、Stack 可用、筛选栏标签不裁切、仪表条不溢出 |
| 160% 验收 | Stack 自动转覆盖式抽屉；预览坞默认收起；筛选栏 chip 换行为两行 |
| 系统 DPI | 跟随 OS 缩放（Electron `zoomFactor` 与 `--ui-scale` 相乘时上限 200%，超出给提示） |
| 密度独立 | 密度档只改行高与内距，**不改字号**——二者正交，用户可"大字 + 紧凑"或"小字 + 宽松" |
| 可编辑文本下限 | 14px（任何缩放/密度组合下）|
| UI 文本下限 | 11px（`--t-micro`）。唯一例外：Index Spine 的徽标数字 10px，但有完整 `aria-label` |

**实现**：所有尺寸用 `rem` 或 `calc(x * var(--density))`，**禁止硬编码 px 布局尺寸**
（例外：1px 缝、2px 轴、4px 彩条——这三个是像素级的物理量，不缩放）。

---

## 5. 密度档

| 档 | `--density` | 行最小高 | 单元格内距 | 控件高 | 适用 |
| --- | --- | --- | --- | --- | --- |
| Compact | 0.85 | 40px | 6px | 28px | 14" 笔记本、审校扫读、高段数文档 |
| **Standard** | 1.00 | 48px | 10px | 32px | 默认 |
| Comfortable | 1.18 | 58px | 14px | 36px | 长时段、CJK 密集、视力辅助 |

切换：`Ctrl+Alt+[` / `Ctrl+Alt+]`，或设置 → 外观。**切换时给实时预览**（设置页有一行示例段落）。

**Compact 档的额外规则**：命中区不得随密度缩小到 28px 以下。
若 `--ctl-h` 计算值 < 28px，用 `::before` 扩展命中区而不缩小视觉尺寸。

---

## 6. 色彩无障碍

- **不靠颜色单独传达信息**：状态方灯有 8 种**形状**；QA 严重度有图标 + 文字；
  匹配率有数字；进度条各段有 `aria-label` 与 hover 读数。
- **色盲验证**：状态四色（绿/赭/红/蓝）在 protanopia / deuteranopia / tritanopia 模拟下，
  仅凭色相不可全分——这是**已知且已由形状编码解决**的。验收时用形状模拟测试，不测色相。
- **五色彩条**：不承载信息，色盲用户损失为零。
- **高对比模式**（Windows 高对比 / `forced-colors: active`）：
  ```css
  @media (forced-colors: active) {
    :root { --signal: Highlight; --text-1: CanvasText; --deck: Canvas; }
    .lamp { forced-color-adjust: none; }        /* 状态方灯保留形状编码 */
    .band-spine, .matrix-inert { display: none; }  /* 装饰在高对比下隐藏 */
    .doc-matrix__dot { forced-color-adjust: none; }
    * { box-shadow: none !important; }
  }
  ```

---

## 7. 动效无障碍

见 `04-motion.md §8`。验收：

- [ ] `prefers-reduced-motion: reduce` 下无位移动画
- [ ] 应用内"减少动效"开关独立生效（不依赖系统设置）
- [ ] 减少动效下功能反馈（焦点、错误、保存态、进度值）**不丢失**
- [ ] 无自动播放且时长 >5s 的动画（除真实进行中操作外）
- [ ] 无闪烁频率在 3Hz–50Hz 区间的内容

---

## 8. 可访问性验收清单（每次发版）

| # | 项 | 方法 |
| --- | --- | --- |
| 1 | 对比度全绿 | `scripts/check-contrast.py` 进 CI |
| 2 | axe 无 serious/critical | 已有 `@axe-core/playwright`，覆盖全部 Surface + 主要叠层 |
| 3 | 键盘全流程 | 手动脚本：新建 → 导入 → 翻译 → 确认 → QA → 修复 → 导出 |
| 4 | 焦点可见 | 逐 Surface 截图对比 |
| 5 | 读屏冒烟 | NVDA（Win）/ VoiceOver（mac）走通主流程 |
| 6 | 125% / 160% 缩放 | 截图 1250×744 / 1680×942 / 1920×1080 各三档 |
| 7 | 高对比模式 | Windows 高对比黑/白两套截图 |
| 8 | Reduced Motion | 开关后走主流程 |
| 9 | 密度三档 | 三档截图 + 命中区测量 |
| 10 | IME | 微软拼音 / 搜狗 / macOS 简体拼音，各测：组合中按 Ctrl+Enter 不确认、不移焦、单元格不跳动 |
