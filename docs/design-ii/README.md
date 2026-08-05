# Translunar II · ORTHO — 前端设计重构

> 分支：`design/translunar-ii` ｜ 工作树：`D:/Workbench/CAT-design-ii`
> 状态：**设计文档，不含代码改动**。本目录只定义"做成什么样"，不实施。
> 代号 `ORTHO`（正交）仅为内部设计系统代号，**永不出现在界面文案中**。

---

## 0. 这次重构的授权边界

| 项 | 处置 |
| --- | --- |
| 五色 Translunar Band（色彩条） | **保留**，但角色重定义：从"一条装饰横带"升级为**贯穿窗口左缘的结构脊柱**（§03） |
| 圆点矩阵（矩阵圆点） | **保留**，但角色重定义：从"填空纹理"升级为**承载真实数据的基底**（§03） |
| 非彩色大底 | **保留**，但重新分层：从"一张暖纸"升级为**三层非彩色层理（Strata）**，亮度=可编辑性（§02） |
| 其他一切 | **全部推翻**：版式、导航模型、字体、组件几何、动效、信息架构、面板结构、页脚、对话框、空态 |

前一代设计文档（`docs/stitch/DESIGN.md`、`docs/design-notes.md` §6）在本分支内**不再是真相源**。
`docs/design-research-retrofuturism.md` 的**调研事实**仍然有效并被继承；其"翻译项目=航天任务"的隐喻映射表**整体作废**。

## 1. 一句话立意

> 把《孤星》的形式语言（现代主义网格、几何抽象、非彩色大底、原色条、打孔矩阵、几何无衬线）
> 当作**工程制图规范**来用，而不是当作气氛来用。
> 每一个"艺术"元素都必须同时是一个**可用性装置**；做不到的就删掉。

这条立意直接否决了上一代的失败模式："先做一个普通 SaaS，再贴一条彩条和一片点阵"。

## 2. 文档索引

| 文件 | 内容 | 谁读 |
| --- | --- | --- |
| [`01-art-direction.md`](01-art-direction.md) | 方向论证、七条设计命题、来源与考据、禁止清单 | 全体 |
| [`02-foundations.md`](02-foundations.md) | 色彩层理 / 字体 / 栅格 / 空间 / 几何 / 图标 + 完整 token CSS | 全体 |
| [`03-signatures.md`](03-signatures.md) | 三大保留资产的新定义：Band Spine、Live Matrix、Strata；外加 Active Axis 与 Seam | 全体 |
| [`04-motion.md`](04-motion.md) | 动效系统：时间尺度、缓动、七套编排、View Transitions 落地代码 | 前端 |
| [`05-components.md`](05-components.md) | 52 个组件的完整规格（几何/状态/键盘/无障碍/禁止） | 前端 |
| [`06-shell-navigation.md`](06-shell-navigation.md) | 应用外壳、Index Spine、命令面板、Surface 模型、页面转场 | 全体 |
| [`screens/workbench.md`](screens/workbench.md) | 主工作台（最大篇幅）：网格、Stack 面板、预览坞、仪表条 | 全体 |
| [`screens/project.md`](screens/project.md) | 项目首页、新建向导、项目洞察 11 个标签页 | 全体 |
| [`screens/quality.md`](screens/quality.md) | QA 复核、导出复核、审校修订 | 全体 |
| [`screens/assets.md`](screens/assets.md) | TM/术语、资产养护、对齐与语料、互操作、任务包、讨论 | 全体 |
| [`screens/ai.md`](screens/ai.md) | AI 控制台、助手面板、插件 AI 动作、插件宿主 | 全体 |
| [`screens/system.md`](screens/system.md) | 设置、教程、草稿恢复、全局搜索、空/载/错三态 | 全体 |
| [`07-interaction.md`](07-interaction.md) | 键盘全图、IME 契约、拖拽/缩放、选择模型、撤销 | 前端 |
| [`08-accessibility.md`](08-accessibility.md) | 对比度验算表、焦点、屏幕阅读器、缩放、密度 | 全体 |
| [`09-implementation.md`](09-implementation.md) | 文件映射、token 迁移、分期计划、验收清单 | 前端 |

## 3. 技术前提（已核实）

Electron **41.0.0** = Chromium **146**。因此下列 CSS/Web 平台能力**全部可直接使用，无需 polyfill、无需动画库**：

| 能力 | 起始版本 | 本设计用途 |
| --- | --- | --- |
| View Transitions API（含 `view-transition-class` / `types`） | 125 | Surface 转场、文档切换、面板折叠 FLIP |
| `@starting-style` + `transition-behavior: allow-discrete` | 117 | 弹层/抽屉进出场，无需 JS 挂载动画 |
| CSS Anchor Positioning | 125 | 全部 popover / 菜单 / 提示定位 |
| Popover API (`popover`, `::backdrop`) | 114 | 命令面板、菜单、术语卡 |
| `corner-shape: bevel` | 139 | 45° 切角（Band Plate / 面板端头）原生实现 |
| Scroll-driven animations (`animation-timeline`) | 115 | 矩阵点燃、粘性头部状态 |
| `linear()` 缓动 | 113 | 弹簧曲线（不引入物理库） |
| `field-sizing: content` | 123 | 译文单元格随内容增高，IME 友好 |
| `interpolate-size` + `calc-size()` | 129 | 高度 auto 过渡（面板展开） |
| `text-box-trim` / `text-box-edge` | 133 | 显示字级精确基线对齐 |
| `@property` | 85 | 可动画的自定义属性（渐进色标、轴线位移） |
| `content-visibility` / `contain` | 85 | 万段虚拟列表性能 |

**结论：不引入 Framer Motion / GSAP / Tailwind / shadcn。** 现有栈是 React 19.2 + Vite 8 + 手写 CSS + lucide-react，
本设计完全在此栈内落地。理由见 [`09-implementation.md` §1](09-implementation.md)。

## 4. 判定是否达标（速查）

一屏设计通过，当且仅当：

1. 它先像**翻译软件**，再像别的东西。
2. 屏上每一个非标准控件的图形，都能回答"它解决了什么可用性问题"。答不上来就删。
3. 五色彩条整屏出现且仅出现一次，固定顺序，不承担状态语义。
4. 出现的圆点矩阵，要么**编码真实数据且可交互**（Live），要么**低于所有边框的对比度且不可交互**（Inert）；两者不得外观相似。
5. 大底是非彩色层理，且"越亮=越可编辑"这条规则不被打破。
6. 信号橙的总覆盖 ≤ 1.5%，且屏上**同一时刻只有一条 Active Axis**。
7. 所有数字自洽；没有假遥测、假仪表、装饰性坐标串、无解释的百分比。
8. 键盘可完成全部主流程；IME 组合态期间零打扰。
9. `prefers-reduced-motion` 下所有位移被替换为 ≤100ms 交叉淡入，功能反馈不丢失。
10. 深色主题不是反色，是**层理反转**（§02.4），彩条与状态色单独重算。
