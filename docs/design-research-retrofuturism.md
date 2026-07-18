# 设计调研 · 孤星与三种复古未来主义（Translunar 方向的依据）

> 日期：2026-07-16。本文是第二轮美术方向调研纪要。第一轮（植物志/凸版/水墨）已整体废弃。
> 结论供 `docs/stitch/DESIGN.md`（Translunar 设计系统）与 `docs/prototype-image-prompts.md` 引用。

---

## 1. 《明日方舟》活动《孤星 / Lone Trail》全套设计

### 1.1 证据与来源边界

本轮使用三类输入：

1. HalfACupOfRice《The Visual Design of Arknights Lone Trail》及其中译镜像——活动专项的高质量二手分析；
2. 官方 Event Teaser、Animation PV、Trailer——用于核对活动实际画面与动态图形；
3. 用户提供的视频总结——作为本轮设计讨论的明确输入，强调视觉与叙事哲学的结合。

需要纠正旧稿的一点：`rerurate.com` 当前页面是受《孤星》启发的个人设计案，且页面注明没有明确参考文章，
不能继续作为“官方 PV 精确取色”的证据。下列色值保留为 **Translunar 原型参考值**，而不是《孤星》官方色票：

- 暖纸参考 `#F6EFE2`；
- 暖黑参考 `#201919`；
- 橙色参考 `#F66620`。

### 1.2 活动独有的视觉骨架

《孤星》不是简单给方舟本体 UI 换一套皮肤。它以二十世纪中叶太空竞赛为共同语境，把复古未来主义、
现代主义平面设计与莱茵生命的科学叙事编织成同一套视觉系统：

- **几何抽象**：圆、轨道环、直线、三角与简化天体符号，用少量基础形表达复杂对象；
- **现代主义网格**：Swiss / International Typographic Style 式网格、左对齐、强层级、非对称留白；
- **非彩色大底**：大面积暖白、黑与灰建立理性、工业、档案式空间，颜色只在关键位置爆发；
- **构成主义谱系**：Bauhaus、De Stijl 与 Constructivism 式块面、线条和几何秩序；
- **太空时代字体**：视频总结以 Futura 解释其年代谱系；专项分析者后续更正实际字体更接近
  ITC Avant Garde Gothic。落地时应理解为“粗壮、紧字距、几何现代主义”的显示语言，
  不把任一商业字体名称宣称为官方规范；
- **原色彩条**：活动大厅动画确有上升的原色条，是《孤星》自身可确认的动态图形身份。
  Translunar 的五色复古彩条是对此的品牌化扩展，不是活动原样复刻；
- **线宽制造运动**：轨迹、斜线和不同线宽让静态平面呈现速度、方向与空间尺度；
- **环境一致性**：莱茵生命实验室的装潢、CRT、按钮、照明、服装与敌人造型共同维护年代感，
  说明艺术方向必须贯穿系统，而不能只停留在几个装饰图标上。

### 1.3 视觉与叙事哲学

用户提供的总结补充了现有调研中缺失的一层：这些符号不只是“好看的复古航天元素”。色彩、莫尔斯电码、
深空构图、冷暖反差和人物/设施尺度共同服务于剧情主题——科学探索的乐观、技术系统对人的异化，
以及个体面对未知宇宙时的渺小与孤独。

迁移到 CAT 时，不需要把哲学主题写成界面文案，而应转换为视觉节奏：

- 日常工作台以温暖、可靠、清晰为主，代表“可被掌握的技术”；
- 项目创建、资产中枢、空状态与页面转场可出现更大的留白、孤立小图形、远距离轨道线与深色块面，
  提供“系统规模远大于当前个体”的空间感；
- AI、QA 和自动化结果必须保持可解释、可拒绝、可回滚，避免视觉上把技术描绘成不可质疑的权威；
- 莫尔斯电码、坐标、仪表数字只能在确有真实数据含义时出现，不能为了哲学感制造伪信息。

### 1.4 可迁移的版式与图形招式

- 暖黑实心块 + 暖纸文字用于少量标题或活动 tab；暖纸底 + 暖黑字承载正文；
- 大左边距与不对称构图，避免所有区域均质铺满；
- 轨道弧、斜向技术线、短刻度、角落定位记号与低密度点阵只进入 chrome 和空白边缘；
- 索引编号、页码、字数、句段位置等真实元数据可用等宽字形成技术标注感；
- 原色/复古彩条可用于品牌边界和一次性转场揭示，不兼任状态语义；
- 图标从产品自身对象推导：文档页、段落锚点、标签配对、术语关联、TM 复用，而不是直接复制月相或 NASA 图标；
- 动效强调“同一张画布上展开另一层”，通过遮罩、平移、线条揭示和保留下层页面建立空间连续性。

### 1.5 与方舟本体通用机制的区别

背景模糊、浮窗露出下层页面、警戒条纹、网点颗粒、vignette 和工业噪点在方舟本体中也很常见，
不能全部当成《孤星》专属语言。Translunar 可择其适合桌面软件的部分使用，但核心识别应来自：

**现代主义网格 + 非对称留白 + 几何轨道图形 + 暖中性色/橙 + 原色彩条 + 太空时代几何字体。**

同样，常驻 CRT 扫描线、假遥测、实体开关、greebling 与世界观替代文案都不是必须元素，也不适合高频翻译区。

## 2. 原子朋克 / Atompunk（1950s–60s）

来源：Aesthetics Wiki、Wikipedia "Atomic Age (design)"、Kittl Atomic Age 设计指南、artstyles.com。

- 核心母题：**星爆 starburst、轨道环 orbit rings、原子符号、回旋镖曲线、尾翼、放射线、Sputnik**；
- 材质：镀铬、珐琅、烤漆、拉丝金属——"展厅级"高光；
- 配色：原子粉彩（绿松石/薄荷/珊瑚/樱桃红/芥末/奶油）；另有做旧变体（红木 `#9C5851`、
  法国米 `#D0AC7F`、冬青梦 `#588B7E`、石板蓝 `#5F7080`）；白色为主导底色 + 芥末黄/橙表达乐观；
- 版式：轨道式构图（元素绕焦点公转）、不对称、模块化重复图案、几何展示字体
  （**Microgramma**，Novarese/Butti 1952——Eurostile 前身，航天面板字的正源）；
- 气质：对技术未来的确信与乐观（punk 后缀提醒它有讽刺的暗面，但视觉语言本身是明亮的）。

## 3. 磁带盒未来主义 / Cassette Futurism（1970s–90s）

来源：Aesthetics Wiki "Cassette Futurism"。

- 定义：模拟时代想象的未来——**CRT 曲面屏、磁带/软盘/开盘机、点阵打印机、米色机箱、
  实体按钮与拨杆开关、指示灯阵列、神秘缩写标签**；数字技术刚刚萌芽于模拟世界；
- 屏幕：单色绿/琥珀荧光（phosphor），图形粗糙低保真，2D 或极简 3D 线框；
- 配色：灰/米色近单色场景 + 红/绿/蓝 LED 点光；多色时倾向类似色（analogous）；
- 质感：utilitarian analog materiality（工具性的模拟质料感）、1970s 超级图形
  （Supergraphic：墙面上巨大的色带与编号）、greebling 机件细节（只在墙面/舰体，不进工作区）；
- 代表：《异形》《2001》《银翼杀手》《For All Mankind》《Alien: Isolation》《SIGNALIS》《Severance》。

## 4. NASA 朋克 / NASApunk（Apollo 年代→当代外推）

来源：IGN/PC Gamer 对 Starfield 主美 Istvan Pely 的采访、Domus 专文、Eurogamer（ESA 品牌负责人评价）、AKQA Starfield 品牌案例。

- 定义（Pely）："**更接地、更可信的科幻**——从今天的航天技术画一条线外推到未来"；
- 关键词：实体按钮、触觉操作、极少触摸屏；宇航服如盔甲；"**用旧但被爱护的未来科技**"
  （ESA：可靠的东西就一直用下去）；机械车间感（《星际穿越》舱内），拒绝 Mass Effect 式光滑抽象；
- 图形：**国际橙**（International Orange `#FF4F00` 家族；NASA worm 红 `#FC3D21`）、
  模板喷字（stencil）、任务徽章、格纹校准标、手表盘面式信息叠层、编号与脚注式的"啰嗦的严谨"；
- AKQA 品牌原则：scientifically inspired / grounded in warmth / unapologetically optimistic /
  ambitiously daring；星图与引力波作为图形基石；四色"Constellation 条纹"。

## 5. 综合判断 → Translunar 设计系统

四者的公共脊柱：**黄金时代太空计划**。差异只是回望的年代与温度——
原子朋克给"乐观的图形母题"（轨道环/星爆），NASA 朋克给"工程务实的材料与橙色"，
磁带盒未来主义给"仪表台的质感与模拟时代材料"，而孤星证明了这一切可以被收敛成
一套表达强烈但纪律清楚的当代界面语言：现代主义网格、深暖纸底、软黑块面、少量橙与原色、
几何无衬线、轨道线条、非对称留白和有层级的动态转场。

**概念隐喻：翻译项目 = 一次航天任务。**
项目=任务（Mission）、文档=载荷（Payload）、TM=飞行记录（Flight Log）、
术语库=命名法手册（Nomenclature，NASA 真有此物）、QA=发射前检查单（GO/NO-GO）、
确认句段=GO、AI=制导计算机（Guidance）、资产中枢=深空网络（DSN）、
新建项目向导=发射序列（T-3 → T-2 → T-1 → LAUNCH）、进度=轨道入射图。

> **落地边界（2026-07-17 评审补充）**：以上映射仅用于 moodboard、构图和图形母题推导，
> 不作为界面词汇表。实际产品必须继续使用项目、文档、翻译记忆、术语库、QA、AI 建议、确认、导出等
> 真实 CAT 术语；航天感由版式、轨道线、仪表刻度、方形状态灯和固定顺序的五色复古彩条承担。

**分区纪律沿用**（这是 UX 决策，与美术方向无关，继续有效）：
艺术主要活在 chrome（轨道图、彩条、构成线、非对称标题、空态与页面转场），
句段网格是仪表台（cassette 式仪表纪律：等宽读数、指示灯、极致可读，无装饰）。
布局继续执行"空间按使用频率分配"：无常驻左栏，顶栏文档切换 chip，网格上方高频筛选工具条。

主要出处：
- youtube.com/watch?v=aS8nnjrMlQc（HalfACupOfRice《The Visual Design of Arknights Lone Trail》）
- bilibili.com/video/BV1vc411B7i4（上述视频的中文字幕镜像）
- youtube.com/watch?v=vDDcG6fSMms（官方 Event Teaser）
- youtube.com/watch?v=6JbaLjRy4aw（官方 Animation PV）
- youtube.com/watch?v=U_laI-G21fo（官方 Trailer）
- arknights.wiki.gg/wiki/Lone_Trail（活动素材与 Visual Reports 索引）
- rerurate.com/Inbox-Notes/LoneTrail%E3%81%AE%E6%A7%98%E3%81%AA%E3%83%87%E3%82%B6%E3%82%A4%E3%83%B3%E6%A1%88
  （受《孤星》启发的个人设计案，只作延伸参考，不作官方取色证据）
- reddit.com/r/arknights/comments/14l3q97（社区风格术语线索，低可靠）
- aesthetics.fandom.com/wiki/Cassette_Futurism · /wiki/Atompunk
- en.wikipedia.org/wiki/Atomic_Age_(design) · kittl.com Atomic Age 指南
- ign.com / pcgamer.com（Istvan Pely "NASA-Punk" 访谈）· domusweb.it NASApunk 专文
- akqa.com/work/bethesda/starfield（Starfield 品牌系统）
- janniewang.net · indienova.com（明日方舟本体 UI/UX 分析，只用于区分通用机制）
