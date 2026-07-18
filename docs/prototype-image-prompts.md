# Translunar 原型参考图提示词 · GPT Image 2

> 用途：生成可直接指导桌面原型制作的高保真 UI 参考图，而不是概念海报。
>
> 真相源优先级：`docs/PRD.md` → `docs/stitch/DESIGN.md` → 本提示词。
>
> 推荐参考图：
> - `docs/ChatGPT Image 2026年7月17日 20_04_16.png`：当前首要视觉锚点；后续页面优先继承其产品/艺术平衡、顶栏、彩条、圆点矩阵、Suggestions 标题、文件预览和底栏；
> - `docs/prototype-v0.2.png`：产品结构、真实 CAT 信息架构与可读性参考；
> - `docs/prototype-v0.1.png`：暖纸底、非对称构图、工程制图线条、面板层次和文件预览的艺术参考。
>
> **复制说明**：下方每条主提示已预组装完成，整段代码块可直接粘贴到模型。
> 没有参考图时，优先使用 `G-1N` 独立版；其他屏幕也可删除对应提示中的 `Input images` 整段。

## 1. GPT Image 2 执行建议

以下是模型/调用层设置，不要把它们当作提示词正文：

- 用例分类：`ui-mockup`。
- 草图迭代：`1536×960`（16:10），`quality=medium`。
- 评审参考图：`2048×1280`（16:10），`quality=high`。
- 需要演示大屏细节时可用 `3840×2160`，但它是 16:9，不作为布局尺寸真相源。
- GPT Image 2 对输入参考图始终使用高保真，不设置 `input_fidelity`。
- 每次迭代只修改一个问题，并重复所有关键不变量，避免布局漂移。
- 密集文字界面必须使用 medium/high quality。图片中的长段落仍只作为视觉参考，最终文案以本文为准。

如果使用内置图片生成工具而非 CLI/API，只需提交下方提示词；尺寸与 quality 按工具可用选项选择。

## 2. 参考图角色

- 后续页面只使用一张参考图时，Image 1 应为 `ChatGPT Image 2026年7月17日 20_04_16.png`，将其视为完整视觉母版；除非屏幕任务不同，不改变顶栏、彩条、圆点矩阵、面板切角、线条密度与底栏语言。
- Image 1（`prototype-v0.2.png`）：布局与产品 UX 真相源。
- Image 2（`prototype-v0.1.png`）：艺术方向参考，不抄假任务术语。
- 冲突时以 Image 1 的产品行为为准。

## 3. 固定原型数据

所有屏幕共享同一套产品状态：

- Project: `Craft Contracts 2026`
- Language pair: `English (US) → Chinese (Simplified)`
- Current file: `Master Services Agreement.docx`
- Other file: `Appendix A – Services.docx`, `386 segments`
- Current file: `1,248 segments`, `774 confirmed`, `401 draft`, `73 untranslated`, `3 QA issues`, `62% confirmed`
- Translation memory: `Legal EN–ZH`, `128,436 segments`, writable
- Termbase: `Contracts Terms`, `2,315 terms`
- Active segment: `418`
- Active source: `The Supplier shall maintain commercially reasonable administrative, technical, and physical safeguards.`
- Active target: `供应商应采取商业上合理的管理、技术和物理安全措施。`
- QA source: `The retention period is 30 days.`
- QA target: `保留期为 60 天。`
- QA message: `Number mismatch: source 30, target 60.`
- Engine naming: use a credible provider name or `OpenAI-compatible endpoint`; never invent a future model version or unsupported quality claim.

---

## G-1 主工作台 v0.3 · 文件预览展开

这是第一优先级提示词。先生成这张，稳定后再生成其他屏幕。

**输入参考图**：Image 1 = `docs/prototype-v0.2.png`；Image 2 = `docs/prototype-v0.1.png`。

```text
Use case: ui-mockup
Asset type: primary desktop CAT workbench reference
Primary request: create one 2048×1280 landscape screen for the daily translation workbench of “Craft Contracts 2026”. Combine Image 1's serious product structure with Image 2's Lone Trail-inspired art direction. The result should feel like a mature professional product with an authored visual world, not a generic minimalist SaaS screen.

Input images:
- Image 1: layout and product-UX reference. Preserve its real CAT information architecture, readable source/target grid, status labels, Suggestions tabs, Run QA, Export, and professional product clarity.
- Image 2: art-direction reference only. Borrow its deeper warm-paper atmosphere, asymmetric framing, varied structural line weights, restrained registration marks, technical edge details, layered panel composition, and bottom document preview. Do not copy its fake mission terminology, invented telemetry, fake calibration controls, fictional model version, or cramped typography.

Reference priority: Image 1 controls product structure and copy. Image 2 controls atmosphere, composition, materiality, and decorative linework. When they conflict, keep Image 1's product behavior.

Composition/framing: straight-on full application screen, 16:10. No laptop frame, no perspective. Use an asymmetric 64–72px warm-black #221B18 top app bar with warm-paper text. The left 300–340px forms a stronger identity composition with an original geometric app mark and the real project name “Craft Contracts 2026”; do not use a huge billboard title. Continue with the document selector, global search, “Run QA”, one primary “Export” button, and overflow/settings. Place one 8–10px flat five-color Translunar Band along the lower edge of the app bar.

Below the app bar, add a 44–48px editor toolbar containing the exact labels “All”, “Untranslated”, “Draft”, “Confirmed”, “Issues”, “All matches”, “Search in file”, “Previous issue”, “Next issue”, and “View options”. Use stronger warm-black selected states, fine rules, and one controlled dot field or technical edge detail in unused chrome space.

Main workbench: the segment grid occupies about two thirds of the remaining width. Columns are “ID”, “Status”, “Source (English)”, and “Target (Simplified Chinese)”. Show 7–9 realistic legal-contract rows with comfortable 15–16px reading text. Segment 418 is active with #EAE0CE fill and a 2–3px Signal Orange leading guide. Exact active source: “The Supplier shall maintain commercially reasonable administrative, technical, and physical safeguards.” Exact active target: “供应商应采取商业上合理的管理、技术和物理安全措施。” Use real text labels with 7–8px square state markers. The grid cells contain no decorative linework, grain, orbit symbols, or background graphics.

Right side: a 390–430px “Suggestions” panel with tabs “Matches”, “Terms”, and “AI”; “Matches” is active. Give the panel frame an authored Lone Trail composition: the title sits in one short warm-black block with a diagonal cut terminal; a clipped low-contrast orthogonal dot matrix fills the unused right side of the header; tabs begin on the next row. Keep result content quiet. Show a 96% and an 82% match from “Legal EN–ZH”, readable source/target excerpts, restrained word-level differences, metadata, and an explicit “Insert” action with a shortcut. The expanded panel has exactly one 32–36px right-pointing collapse chevron inside the far-right header/dot-matrix area. Do not place a floating button between the grid and panel, do not use a vertical pill, and never show both left and right arrows at the same time.

Bottom document preview: show it expanded below the segment grid only, not below Suggestions. Height about 190–210px. Header text “Document preview · Master Services Agreement.docx · Page 7 of 24” with previous/next page, zoom, “Follow active segment”, pop-out, and collapse controls. Show a realistic document page fragment with the active clause located by one low-saturation orange outline. Add fine ruler ticks and one compressed echo of the five-color band only on the preview handle; keep the document page clean.

Bottom status footer: a warm-black #221B18 strip with warm-paper text and a clipped low-contrast dot-matrix end cap. Exact text “Segment 418 of 1,248”, “774 confirmed · 401 draft · 73 untranslated”, and “Saved”.

Art direction details: deep warm-paper background, lighter work surfaces, static paper grain, one short orbital arc or vertical ruler in a non-reading margin, no more than two small registration marks, one warm-black structural block. Decoration should occupy about 6–8% of the screen and create visual rhythm without competing with the active segment.

Text (verbatim, high priority): “Craft Contracts 2026”, “Master Services Agreement.docx · 62%”, “Run QA”, “Export”, “All”, “Untranslated”, “Draft”, “Confirmed”, “Issues”, “Suggestions”, “Matches”, “Terms”, “AI”, “Document preview”, “Segment 418 of 1,248”, “Saved”. Render no extra decorative sentences.

Style/medium: shippable high-fidelity desktop product UI, not concept art, not a marketing page, not a game HUD.

Visual direction: the complete visual language of Arknights Lone Trail translated into a professional CAT application—mid-century space-race retrofuturism, Swiss and Bauhaus modernist grids, geometric abstraction, asymmetric left-aligned composition, large achromatic fields, warm industrial paper, orbital circles and directional linework, and restrained primary-color accents. The emotional subtext is scientific optimism meeting technological alienation and the solitude of deep space, expressed through scale, whitespace, isolated geometry, and motion-ready layering—not through fictional lore text.

Color palette: deep warm-paper application canvas #F1E7D6; lighter working surfaces #FCF8EE; warm soft-black ink #221B18; selected-row paper shade #EAE0CE; functional signal orange #F25C1A. Static subtle paper grain. Never use pure white as the dominant canvas.

Signature brand device: one flat five-color Translunar Band in fixed order—burnt orange #D9562B, solar ochre #D29A2E, lichen green #87904A, instrument teal #4F8076, dusk blue #526F86. The band is CAT's brand extension of Lone Trail's rising primary-color stripes. It is not a gradient and never represents status.

Typography: geometric modernist display type with the visual lineage of Futura and ITC Avant Garde Gothic; implementation feel close to Space Grotesk. Chivo-like readable UI text, Space Mono for real IDs, counts, page numbers, percentages, and shortcuts, Noto Sans SC for Chinese.

Art layer: every screen needs one deliberate graphic focal gesture beyond standard controls. Allow one short ruler, one orbital arc or dot field, up to two small registration marks, varied structural line weights, one local warm-black title block, and one complete color band. Decorative elements may be nonfunctional but must be unmistakably decorative and must never resemble metrics, controls, coordinates, or system messages.

Product invariants: real CAT terminology only; source/target grid remains the main focus; status is communicated with text plus square markers; suggestions expose source and insertion actions; counts remain internally consistent; no persistent left file rail; no engine selector in the global app bar; document preview is a real linked P0 feature.

Avoid: MODULE, FLIGHT LOG, GUIDANCE, TELEMETRY, CALIBRATION, LAUNCH, GO/NO-GO, payload terminology, fake coordinates, fake confidence gauges, fake timers, invented model versions, ornamental data labels, random percentages, NASA logos, mission patches, astronauts, planets or starfields as backgrounds, cockpit framing, purple-blue neon, holograms, glow, glassmorphism, chrome bevels, CRT scanlines, greeble clutter, cold gray SaaS styling, pure-white canvas, generic minimalism, decorative lines behind editable text, ornament inside source/target cells, oversized rounded cards, rounded-pill-everything, lorem ipsum, stock photography, perspective device mockups, watermark.
```

## G-1N 主工作台 v0.3 · 无参考图独立版

不上传任何参考图片时使用。该版本已经将产品结构、视觉方向、真实数据和负面约束全部写入，整段可直接粘贴。

```text
Use case: ui-mockup
Asset type: primary desktop CAT workbench reference generated without input images
Primary request: create one 2048×1280 landscape screen for the daily translation workbench of “Craft Contracts 2026”. Design a mature, shippable professional CAT application with a distinctive authored visual world. It must immediately read as serious translation software, while using an expressive Lone Trail-inspired mid-century space-race art direction instead of generic minimalist SaaS styling. Generate exactly one straight-on application screen, not a moodboard, marketing page, game HUD, or device mockup.

Overall layout: full desktop application, 16:10, no perspective. Use a two-zone workbench with no persistent left sidebar. The source/target editing grid is the dominant working area, approximately two thirds of the content width. A fixed 340–380px Suggestions panel occupies the right side. A linked document-preview dock sits below the grid only and does not extend beneath Suggestions. A slim status footer spans the bottom.

Top app bar: 64–72px high, warm-black #221B18 with warm-paper text, asymmetric rather than a generic evenly spaced navbar. The left 300–340px is a stronger identity composition containing one original geometric app mark and the real project name “Craft Contracts 2026”. Use geometric modernist typography, controlled negative space, one cropped orbital or directional-line gesture, and strong left alignment; do not create a huge billboard title. Continue with a document selector reading “Master Services Agreement.docx · 62%”, a global search field, a secondary “Run QA” action, one primary “Export” button, and overflow/settings. Do not place an AI-engine selector in the global bar.

Translunar Band: place exactly one complete flat five-color band along the lower edge of the app bar, 8–10px high. Fixed left-to-right order: burnt orange #D9562B, solar ochre #D29A2E, lichen green #87904A, instrument teal #4F8076, dusk blue #526F86. Equal adjacent flat stripes, crisp boundaries, no gradient, no glow, no transparency, and no status meaning.

Editor toolbar: directly below the color band, 44–48px high. Include the exact labels “All”, “Untranslated”, “Draft”, “Confirmed”, “Issues”, “All matches”, “Search in file”, “Previous issue”, “Next issue”, and “View options”. Use a compact professional desktop-control density. The active filter may use one warm-black block with warm-paper text. Use fine rules and one controlled dot field or short technical edge treatment only in unused chrome space.

Segment grid: columns are “ID”, “Status”, “Source (English)”, and “Target (Simplified Chinese)”. Show 7–9 realistic legal-contract rows, not lorem ipsum. Reading text is comfortably sized at 15–16px with relaxed leading, including clear Simplified Chinese typography. IDs use monospaced numerals. Status uses both real text labels and 7–8px square markers: green Confirmed, ochre Draft, gray Untranslated, red Issues. The grid uses hairline dividers rather than cards.

Active segment: segment 418 is visible in the upper-middle area and is the strongest focus. Use selected-row fill #EAE0CE and a 2–3px Signal Orange #F25C1A leading guide. Exact source: “The Supplier shall maintain commercially reasonable administrative, technical, and physical safeguards.” Exact target: “供应商应采取商业上合理的管理、技术和物理安全措施。” The source/target cells contain no decoration, paper grain, orbital symbols, dot fields, calibration marks, or background graphics.

Suggestions panel: width 390–430px; title “Suggestions”; tabs “Matches”, “Terms”, and “AI”; “Matches” is active. The title sits in one warm-black block ending in a diagonal cut; a clipped low-contrast orthogonal dot matrix fills the otherwise empty right side of the header, and tabs begin on the row below. Keep result content itself quiet and readable. Show one 96% and one 82% match from “Legal EN–ZH”, each with readable source and target excerpts, restrained word-level difference highlighting, useful metadata, and an explicit “Insert” action with a keyboard shortcut. In the expanded state, place exactly one compact 32–36px right-pointing chevron button at the far right of the panel header, integrated into the dot-matrix field, accessible name “Collapse Suggestions”. Never place the control as a floating overlay between grid and panel. Never show a second arrow or both directions simultaneously. Do not show fake confidence, decorative gauges, or unexplained scores.

Document preview dock: expanded state, 190–210px high, below the segment grid only. Header text: “Document preview · Master Services Agreement.docx · Page 7 of 24”. Include previous/next page, zoom, “Follow active segment”, pop-out, resize, and collapse controls. Show a realistic document-page fragment with the active clause located by one low-saturation orange outline or wash. Add fine ruler ticks and one small compressed echo of the full five-color sequence only on the preview handle. Keep the rendered document page clean and readable.

Status footer: use a warm-black #221B18 strip with warm-paper text and one clipped low-contrast dot-matrix end cap. Exact text “Segment 418 of 1,248”, “774 confirmed · 401 draft · 73 untranslated”, and “Saved”. Counts must remain internally consistent. Use Space Mono-style typography for IDs, counts, pages, percentages, timestamps, and shortcuts only when they represent real data.

Visual direction: translate the complete visual language of Arknights Lone Trail into a professional desktop tool—mid-century space-race retrofuturism, Swiss International Typographic Style, Bauhaus and De Stijl grid discipline, geometric abstraction, asymmetric left-aligned composition, large achromatic fields, warm industrial paper, circles and orbital arcs, directional linework, and restrained primary-color accents. The emotional subtext is scientific optimism meeting technological alienation and the solitude of deep space. Express this through scale, whitespace, isolated geometry, material depth, and layered composition, never through fictional lore text.

Color and materials: deep warm-paper application canvas #F1E7D6, noticeably darker and richer than near-white SaaS backgrounds; lighter work surfaces #FCF8EE; warm soft-black ink #221B18; selected-row paper shade #EAE0CE; functional Signal Orange #F25C1A. Add static subtle paper grain at very low contrast. Use tonal layering and structural rules rather than modern floating shadows or glass panels.

Typography: geometric modernist display type with the visual lineage of Futura and ITC Avant Garde Gothic, implementation feel close to Space Grotesk. Use a Chivo-like highly readable sans serif for controls and editable content, Space Mono for real metadata, and Noto Sans SC for Chinese. Use strong weight contrast and selective uppercase metadata, but no readable decorative microtext.

Art layer: the screen must contain one deliberate visual focal gesture beyond standard controls. Allow exactly one primary technical motif—either a short vertical ruler, a restrained orbital arc, or a low-density dot field—plus no more than two small registration marks, one local warm-black structural block, varied line weights, and the single complete color band. Decorative coverage is approximately 6–8% of the screen. Decoration may be nonfunctional only when unmistakably decorative; it must never resemble a metric, coordinate, switch, status, system message, or interactive control. Do not distribute decoration evenly across every panel.

Product invariants: real CAT terminology only; the source/target grid remains the visual and functional center; status always uses text plus shape/color; Suggestions exposes result source and insertion actions; the active segment is unmistakable; all numbers agree; no persistent left file rail; no engine selector in the global app bar; document preview is a real linked P0 feature; controls look buildable with standard desktop components; the interface remains suitable for eight-hour work sessions.

Text (verbatim, highest priority): “Craft Contracts 2026”, “Master Services Agreement.docx · 62%”, “Run QA”, “Export”, “All”, “Untranslated”, “Draft”, “Confirmed”, “Issues”, “All matches”, “Search in file”, “Previous issue”, “Next issue”, “View options”, “ID”, “Status”, “Source (English)”, “Target (Simplified Chinese)”, “Suggestions”, “Matches”, “Terms”, “AI”, “Legal EN–ZH”, “Insert”, “Document preview · Master Services Agreement.docx · Page 7 of 24”, “Follow active segment”, “Segment 418 of 1,248”, “774 confirmed · 401 draft · 73 untranslated”, “Saved”. Render no additional decorative sentences, slogans, lore, or system chatter.

Avoid: MODULE, FLIGHT LOG, GUIDANCE, TELEMETRY, CALIBRATION, LAUNCH, GO/NO-GO, mission-ready copy, payload terminology, fake coordinates, random Morse code, fake confidence gauges, fake calibration scales, fake timers, invented AI-model versions, unsupported “grounded” claims, ornamental data labels, random percentages, NASA logos, mission patches, astronauts, rockets, planets or starfields as backgrounds, spacecraft cockpit framing, purple-blue neon, holograms, outer glow, glassmorphism, chrome bevels, CRT scanlines, animated-noise appearance, greeble clutter, cold gray SaaS styling, pure-white dominant canvas, generic minimalism, centered hero composition, decorative lines behind editable text, ornament inside source/target cells, floating sidebar toggle, vertical double-chevron pill, simultaneous left/right sidebar arrows, tiny cramped typography, oversized rounded cards, three equal marketing cards, rounded-pill-everything, lorem ipsum, stock photography, perspective device mockups, watermark.
```

## G-1A 单变量迭代 · 收起文件预览

在 G-1 结果基本正确后使用，不重新设计整张图。

**输入参考图**：Image 1 = 已认可的 G-1 工作台图。

```text
Use case: precise-object-edit
Input images: Image 1 is the approved G-1 workbench image and is the edit target.
Primary request: change only the document preview from expanded to collapsed.
Constraints: preserve the complete application layout, dimensions, colors, typography, grid rows, active segment, Suggestions content, decorative linework, Translunar Band, and all text. Replace the expanded preview with a 32px handle reading “Document preview · Page 7 of 24”, retaining its fine ruler ticks and compressed five-color echo. Allow the segment grid to extend downward into the released space. Change nothing else. No new controls, no restyling, no extra text, no watermark.
```

## G-2 QA 与 AI 状态

**输入参考图**：Image 1 = `docs/prototype-v0.2.png` 或已认可 G-1；Image 2 = `docs/prototype-v0.1.png`。

```text
Use case: ui-mockup
Asset type: CAT workbench state reference
Primary request: generate the same approved G-1 workbench in a real QA-error state. Preserve the full layout, palette, art direction, preview dock, project, file, counts, stripe placement, typography, and decorative budget.

Input images:
- Image 1: layout and product-UX reference. Preserve its real CAT information architecture, readable source/target grid, status labels, Suggestions tabs, Run QA, Export, and professional product clarity.
- Image 2: art-direction reference only. Borrow its deeper warm-paper atmosphere, asymmetric framing, varied structural line weights, restrained registration marks, technical edge details, layered panel composition, and bottom document preview. Do not copy its fake mission terminology, invented telemetry, fake calibration controls, fictional model version, or cramped typography.

Reference priority: Image 1 controls product structure and copy. Image 2 controls atmosphere, composition, materiality, and decorative linework. When they conflict, keep Image 1's product behavior.

Make segment 419 active. Exact source: “The retention period is 30 days.” Exact target: “保留期为 60 天。” Show one restrained inline error: “Number mismatch: source 30, target 60.” Use an Error Red square, a pale red leading tint, and evidence highlighting; no warning stripes across the row and no mission-failure language.

Right Suggestions panel: show the “AI” tab active. Include a credible provider label or “OpenAI-compatible endpoint”, a factual context summary “3 terms · 2 TM examples · document context”, one Chinese suggestion labeled “AI suggestion”, and exact actions “Show diff”, “Insert”, and “Replace target”. Do not claim verified quality or display a fake confidence score.

Toolbar issue navigator reads “1 of 3 issues”. Document preview remains linked to the active segment. Preserve the Lone Trail art layer in chrome but keep error evidence and editable text completely clean.

Style/medium: shippable high-fidelity desktop product UI, not concept art, not a marketing page, not a game HUD.

Visual direction: the complete visual language of Arknights Lone Trail translated into a professional CAT application—mid-century space-race retrofuturism, Swiss and Bauhaus modernist grids, geometric abstraction, asymmetric left-aligned composition, large achromatic fields, warm industrial paper, orbital circles and directional linework, and restrained primary-color accents. The emotional subtext is scientific optimism meeting technological alienation and the solitude of deep space, expressed through scale, whitespace, isolated geometry, and motion-ready layering—not through fictional lore text.

Color palette: deep warm-paper application canvas #F1E7D6; lighter working surfaces #FCF8EE; warm soft-black ink #221B18; selected-row paper shade #EAE0CE; functional signal orange #F25C1A. Static subtle paper grain. Never use pure white as the dominant canvas.

Signature brand device: one flat five-color Translunar Band in fixed order—burnt orange #D9562B, solar ochre #D29A2E, lichen green #87904A, instrument teal #4F8076, dusk blue #526F86. The band is CAT's brand extension of Lone Trail's rising primary-color stripes. It is not a gradient and never represents status.

Typography: geometric modernist display type with the visual lineage of Futura and ITC Avant Garde Gothic; implementation feel close to Space Grotesk. Chivo-like readable UI text, Space Mono for real IDs, counts, page numbers, percentages, and shortcuts, Noto Sans SC for Chinese.

Art layer: every screen needs one deliberate graphic focal gesture beyond standard controls. Allow one short ruler, one orbital arc or dot field, up to two small registration marks, varied structural line weights, one local warm-black title block, and one complete color band. Decorative elements may be nonfunctional but must be unmistakably decorative and must never resemble metrics, controls, coordinates, or system messages.

Product invariants: real CAT terminology only; source/target grid remains the main focus; status is communicated with text plus square markers; suggestions expose source and insertion actions; counts remain internally consistent; no persistent left file rail; no engine selector in the global app bar; document preview is a real linked P0 feature.

Avoid: MODULE, FLIGHT LOG, GUIDANCE, TELEMETRY, CALIBRATION, LAUNCH, GO/NO-GO, payload terminology, fake coordinates, fake confidence gauges, fake timers, invented model versions, ornamental data labels, random percentages, NASA logos, mission patches, astronauts, planets or starfields as backgrounds, cockpit framing, purple-blue neon, holograms, glow, glassmorphism, chrome bevels, CRT scanlines, greeble clutter, cold gray SaaS styling, pure-white canvas, generic minimalism, decorative lines behind editable text, ornament inside source/target cells, oversized rounded cards, rounded-pill-everything, lorem ipsum, stock photography, perspective device mockups, watermark.
```

## G-3 新建项目 · Resources & AI

**输入参考图**：Image 1 = `docs/prototype-v0.2.png`；Image 2 = `docs/prototype-v0.1.png`。

```text
Use case: ui-mockup
Asset type: desktop CAT setup wizard reference
Primary request: create one 2048×1280 desktop project-creation screen, step 2 of 3, titled “Resources & AI”. It should use the complete Lone Trail visual system more expressively than the workbench while remaining a buildable professional form.

Input images:
- Image 1: layout and product-UX reference. Preserve its real CAT information architecture, readable source/target grid, status labels, Suggestions tabs, Run QA, Export, and professional product clarity.
- Image 2: art-direction reference only. Borrow its deeper warm-paper atmosphere, asymmetric framing, varied structural line weights, restrained registration marks, technical edge details, layered panel composition, and bottom document preview. Do not copy its fake mission terminology, invented telemetry, fake calibration controls, fictional model version, or cramped typography.

Reference priority: Image 1 controls product structure and copy. Image 2 controls atmosphere, composition, materiality, and decorative linework. When they conflict, keep Image 1's product behavior.

Composition/framing: straight-on 16:10 application screen. Use an asymmetric 32/68 split. Left side is a deep warm-black or dark warm-paper composition with plain steps “1 Files & languages”, “2 Resources & AI”, “3 Review & create”. Step 1 is complete, step 2 active, step 3 upcoming. Use a vertical Translunar Band, one large orbital line composition, isolated small geometry, and generous empty space to evoke scientific scale and deep-space solitude. No starscape, lore, fake coordinates, or readable decorative sentence.

Right side: lighter #FCF8EE form surface. Summary “English (US) → Chinese (Simplified) · Legal / Contracts”. Real sections “Translation memory”, “Termbase”, and “AI translation”. Attached rows: “Legal EN–ZH · 128,436 segments · Writable” and “Contracts Terms · 2,315 terms”. Include “Add resource”, provider dropdown, optional model field, checkbox “Use TM and terminology as context”, and helper text that keys are configured locally and AI can be disabled.

Bottom actions: “Back” and one primary “Continue”. No T-minus labels, Launch copy, recommendation badge, fantasy engine, or decorative microtext. Use modernist grid, strong left alignment, deep paper material, geometric linework, and restrained primary-color accents.

Style/medium: shippable high-fidelity desktop product UI, not concept art, not a marketing page, not a game HUD.

Visual direction: the complete visual language of Arknights Lone Trail translated into a professional CAT application—mid-century space-race retrofuturism, Swiss and Bauhaus modernist grids, geometric abstraction, asymmetric left-aligned composition, large achromatic fields, warm industrial paper, orbital circles and directional linework, and restrained primary-color accents. The emotional subtext is scientific optimism meeting technological alienation and the solitude of deep space, expressed through scale, whitespace, isolated geometry, and motion-ready layering—not through fictional lore text.

Color palette: deep warm-paper application canvas #F1E7D6; lighter working surfaces #FCF8EE; warm soft-black ink #221B18; selected-row paper shade #EAE0CE; functional signal orange #F25C1A. Static subtle paper grain. Never use pure white as the dominant canvas.

Signature brand device: one flat five-color Translunar Band in fixed order—burnt orange #D9562B, solar ochre #D29A2E, lichen green #87904A, instrument teal #4F8076, dusk blue #526F86. The band is CAT's brand extension of Lone Trail's rising primary-color stripes. It is not a gradient and never represents status.

Typography: geometric modernist display type with the visual lineage of Futura and ITC Avant Garde Gothic; implementation feel close to Space Grotesk. Chivo-like readable UI text, Space Mono for real IDs, counts, page numbers, percentages, and shortcuts, Noto Sans SC for Chinese.

Art layer: every screen needs one deliberate graphic focal gesture beyond standard controls. Allow one short ruler, one orbital arc or dot field, up to two small registration marks, varied structural line weights, one local warm-black title block, and one complete color band. Decorative elements may be nonfunctional but must be unmistakably decorative and must never resemble metrics, controls, coordinates, or system messages.

Product invariants: real CAT terminology only; source/target grid remains the main focus; status is communicated with text plus square markers; suggestions expose source and insertion actions; counts remain internally consistent; no persistent left file rail; no engine selector in the global app bar; document preview is a real linked P0 feature.

Avoid: MODULE, FLIGHT LOG, GUIDANCE, TELEMETRY, CALIBRATION, LAUNCH, GO/NO-GO, payload terminology, fake coordinates, fake confidence gauges, fake timers, invented model versions, ornamental data labels, random percentages, NASA logos, mission patches, astronauts, planets or starfields as backgrounds, cockpit framing, purple-blue neon, holograms, glow, glassmorphism, chrome bevels, CRT scanlines, greeble clutter, cold gray SaaS styling, pure-white canvas, generic minimalism, decorative lines behind editable text, ornament inside source/target cells, oversized rounded cards, rounded-pill-everything, lorem ipsum, stock photography, perspective device mockups, watermark.
```

## G-4 Review & create

**输入参考图**：Image 1 = 已认可 G-3；Image 2 = `docs/prototype-v0.1.png`（可选，保持艺术方向一致）。

```text
Use case: ui-mockup
Asset type: desktop CAT setup wizard reference
Primary request: generate step 3 of the same project-creation flow. Preserve the G-3 split, stripe position, orbital composition, colors, typography, and component geometry.

Input images:
- Image 1: layout and product-UX reference. Preserve its real CAT information architecture, readable source/target grid, status labels, Suggestions tabs, Run QA, Export, and professional product clarity.
- Image 2: art-direction reference only. Borrow its deeper warm-paper atmosphere, asymmetric framing, varied structural line weights, restrained registration marks, technical edge details, layered panel composition, and bottom document preview. Do not copy its fake mission terminology, invented telemetry, fake calibration controls, fictional model version, or cramped typography.

Reference priority: Image 1 controls product structure and copy. Image 2 controls atmosphere, composition, materiality, and decorative linework. When they conflict, keep Image 1's product behavior.

Title: “Review & create”. Right side shows a fast-scanning structured review: “Craft Contracts 2026”; “English (US) → Chinese (Simplified)”; “Legal / Contracts”; “2 documents · 1,634 segments”; “Legal EN–ZH · writable”; “Contracts Terms”; and an AI provider or “Disabled”. Include the factual note “Confirmed translations will be saved to Legal EN–ZH.”

Bottom actions: “Back” and one primary “Create project”. No Launch, mission-ready, ceremony, KPI cards, or decorative copy. The visual drama comes from composition, scale, linework, warm-black fields, and the color band.

Style/medium: shippable high-fidelity desktop product UI, not concept art, not a marketing page, not a game HUD.

Visual direction: the complete visual language of Arknights Lone Trail translated into a professional CAT application—mid-century space-race retrofuturism, Swiss and Bauhaus modernist grids, geometric abstraction, asymmetric left-aligned composition, large achromatic fields, warm industrial paper, orbital circles and directional linework, and restrained primary-color accents. The emotional subtext is scientific optimism meeting technological alienation and the solitude of deep space, expressed through scale, whitespace, isolated geometry, and motion-ready layering—not through fictional lore text.

Color palette: deep warm-paper application canvas #F1E7D6; lighter working surfaces #FCF8EE; warm soft-black ink #221B18; selected-row paper shade #EAE0CE; functional signal orange #F25C1A. Static subtle paper grain. Never use pure white as the dominant canvas.

Signature brand device: one flat five-color Translunar Band in fixed order—burnt orange #D9562B, solar ochre #D29A2E, lichen green #87904A, instrument teal #4F8076, dusk blue #526F86. The band is CAT's brand extension of Lone Trail's rising primary-color stripes. It is not a gradient and never represents status.

Typography: geometric modernist display type with the visual lineage of Futura and ITC Avant Garde Gothic; implementation feel close to Space Grotesk. Chivo-like readable UI text, Space Mono for real IDs, counts, page numbers, percentages, and shortcuts, Noto Sans SC for Chinese.

Art layer: every screen needs one deliberate graphic focal gesture beyond standard controls. Allow one short ruler, one orbital arc or dot field, up to two small registration marks, varied structural line weights, one local warm-black title block, and one complete color band. Decorative elements may be nonfunctional but must be unmistakably decorative and must never resemble metrics, controls, coordinates, or system messages.

Product invariants: real CAT terminology only; source/target grid remains the main focus; status is communicated with text plus square markers; suggestions expose source and insertion actions; counts remain internally consistent; no persistent left file rail; no engine selector in the global app bar; document preview is a real linked P0 feature.

Avoid: MODULE, FLIGHT LOG, GUIDANCE, TELEMETRY, CALIBRATION, LAUNCH, GO/NO-GO, payload terminology, fake coordinates, fake confidence gauges, fake timers, invented model versions, ornamental data labels, random percentages, NASA logos, mission patches, astronauts, planets or starfields as backgrounds, cockpit framing, purple-blue neon, holograms, glow, glassmorphism, chrome bevels, CRT scanlines, greeble clutter, cold gray SaaS styling, pure-white canvas, generic minimalism, decorative lines behind editable text, ornament inside source/target cells, oversized rounded cards, rounded-pill-everything, lorem ipsum, stock photography, perspective device mockups, watermark.
```

## G-5 Translation Memory 资产维护

**输入参考图**：Image 1 = `docs/prototype-v0.2.png`；Image 2 = `docs/prototype-v0.1.png`。

```text
Use case: ui-mockup
Asset type: desktop translation-memory management reference
Primary request: create a professional “Translation Memory” maintenance screen in the same Translunar visual system. This is a working library, not an analytics dashboard.

Input images:
- Image 1: layout and product-UX reference. Preserve its real CAT information architecture, readable source/target grid, status labels, Suggestions tabs, Run QA, Export, and professional product clarity.
- Image 2: art-direction reference only. Borrow its deeper warm-paper atmosphere, asymmetric framing, varied structural line weights, restrained registration marks, technical edge details, layered panel composition, and bottom document preview. Do not copy its fake mission terminology, invented telemetry, fake calibration controls, fictional model version, or cramped typography.

Reference priority: Image 1 controls product structure and copy. Image 2 controls atmosphere, composition, materiality, and decorative linework. When they conflict, keep Image 1's product behavior.

Top app bar keeps the same identity system and single full Translunar Band. Main header uses a strong asymmetric modernist composition with “Translation Memory”, search, filters for language pair, domain, source, and updated date, plus one primary “Import TM” action. A large empty margin may contain one distant orbital geometry and dot field suggesting the scale of accumulated knowledge; no fake chart or philosophical copy.

Main content is a compact table with columns “Name”, “Languages”, “Segments”, “Role”, “Quality status”, “Updated”. Include “Legal EN–ZH · English to Chinese · 128,436 segments · Writable”. Select it and show a detail pane with “Browse entries”, “Edit metadata”, “Export TMX”, “Set read-only”, and “Run maintenance”. Findings: “214 exact duplicates”, “38 near-duplicates”, “12 possible misaligned pairs”, clearly awaiting review. Primary action “Preview findings”.

Use line weight, warm-black section blocks, real metadata, and restrained geometric decoration. Do not use oversized KPI cards, decorative growth charts, fake AI scores, or three equal cards.

Style/medium: shippable high-fidelity desktop product UI, not concept art, not a marketing page, not a game HUD.

Visual direction: the complete visual language of Arknights Lone Trail translated into a professional CAT application—mid-century space-race retrofuturism, Swiss and Bauhaus modernist grids, geometric abstraction, asymmetric left-aligned composition, large achromatic fields, warm industrial paper, orbital circles and directional linework, and restrained primary-color accents. The emotional subtext is scientific optimism meeting technological alienation and the solitude of deep space, expressed through scale, whitespace, isolated geometry, and motion-ready layering—not through fictional lore text.

Color palette: deep warm-paper application canvas #F1E7D6; lighter working surfaces #FCF8EE; warm soft-black ink #221B18; selected-row paper shade #EAE0CE; functional signal orange #F25C1A. Static subtle paper grain. Never use pure white as the dominant canvas.

Signature brand device: one flat five-color Translunar Band in fixed order—burnt orange #D9562B, solar ochre #D29A2E, lichen green #87904A, instrument teal #4F8076, dusk blue #526F86. The band is CAT's brand extension of Lone Trail's rising primary-color stripes. It is not a gradient and never represents status.

Typography: geometric modernist display type with the visual lineage of Futura and ITC Avant Garde Gothic; implementation feel close to Space Grotesk. Chivo-like readable UI text, Space Mono for real IDs, counts, page numbers, percentages, and shortcuts, Noto Sans SC for Chinese.

Art layer: every screen needs one deliberate graphic focal gesture beyond standard controls. Allow one short ruler, one orbital arc or dot field, up to two small registration marks, varied structural line weights, one local warm-black title block, and one complete color band. Decorative elements may be nonfunctional but must be unmistakably decorative and must never resemble metrics, controls, coordinates, or system messages.

Product invariants: real CAT terminology only; source/target grid remains the main focus; status is communicated with text plus square markers; suggestions expose source and insertion actions; counts remain internally consistent; no persistent left file rail; no engine selector in the global app bar; document preview is a real linked P0 feature.

Avoid: MODULE, FLIGHT LOG, GUIDANCE, TELEMETRY, CALIBRATION, LAUNCH, GO/NO-GO, payload terminology, fake coordinates, fake confidence gauges, fake timers, invented model versions, ornamental data labels, random percentages, NASA logos, mission patches, astronauts, planets or starfields as backgrounds, cockpit framing, purple-blue neon, holograms, glow, glassmorphism, chrome bevels, CRT scanlines, greeble clutter, cold gray SaaS styling, pure-white canvas, generic minimalism, decorative lines behind editable text, ornament inside source/target cells, oversized rounded cards, rounded-pill-everything, lorem ipsum, stock photography, perspective device mockups, watermark.
```

## G-6 暗色主题校验

**输入参考图**：Image 1 = 已认可的 G-1 工作台图。

```text
Use case: ui-mockup
Asset type: desktop CAT dark-theme reference
Primary request: render the exact approved G-1 workbench in a warm dark theme. Change only theme colors and contrast behavior; preserve every component, label, row, preview state, count, panel dimension, stripe placement, and decorative motif.

Color palette: canvas #191511, working surfaces #242019 and #2B261F, primary text #F5EFE2, secondary text #B9AEA1, Signal Orange #FF6B2B. Keep the five-color band in the same order with brightness reduced slightly. Paper grain remains static and subtle.

Constraints: no cold blue dark mode, phosphor glow, scanlines, starfield, cockpit lighting, neon stripe, or extra instrumentation. Confirmed, draft, issue, focus, selection, and editable text remain clearly distinguishable.
```

---

## 5. 单变量迭代模板

GPT Image 2 的后续修改应从已认可图片出发，一次只解决一个问题：

```text
Use case: precise-object-edit
Input images: Image 1 is the approved UI mockup and is the edit target.
Primary request: change only [one specific issue].
Constraints: preserve the complete information architecture, viewport, component positions, row data, exact labels, typography, colors, Translunar Band, document-preview behavior, and Lone Trail decorative composition. Do not redesign unrelated areas. Do not add text, controls, cards, or ornaments. No watermark.
```

常见单变量修改（把上一模板中的 `[one specific issue]` 替换为其中一条即可）：

- `deepen only the application canvas from near-white to #F1E7D6`
- `increase only the visibility of the structural linework in chrome`
- `reduce only the decorative density around the grid`
- `make only the document preview 40px taller`
- `restore only the exact five-color stripe order`
- `replace only an incorrect UI label with the provided verbatim text`

不要用“make it more artistic”“make it more futuristic”这类开放式追问，它会同时改变布局、字体、控件和文案。

## 6. 选图标准

按以下顺序评估，而不是先看“漂不漂亮”：

1. 是否一眼看出是成熟的 CAT 工作台；
2. v0.2 的真实信息架构和可读性是否完整保留；
3. v0.1 的暖纸厚度、非对称构图、结构线与文件预览是否被有选择地恢复；
4. 当前段、源文和译文是否仍是最强焦点；
5. 装饰是否有明确层级，而不是平均撒满全屏；
6. 是否出现假数据、假控件、航天替代文案或虚构模型；
7. 五色彩条是否清楚、固定、非渐变且不与状态色混淆；
8. 页面是否表达了《孤星》的现代主义秩序、科学乐观与深空孤独，而不是只贴了几个 NASA 图标；
9. 文件预览是否真实、可折叠、与当前段联动；
10. 去掉艺术层后产品仍成立；保留产品层后画面又不退化成普通极简 SaaS。
