# Frontend design deviation report

**Audit date:** 25 July 2026

**Scope:** Workbench desktop shell at 1250×744

**Status:** audit and handoff only; no visual-task files were reverted or
rewritten in this session.

## Sources used

- Design source of truth: `docs/stitch/DESIGN.md`
- Primary visual anchor: `docs/ChatGPT Image 2026年7月17日 20_04_16.png`
- Current captured screen:
  `.trellis/workspace/Ruelya/workbench-assistant-1250x744.png`
- Current implementation inspected: `apps/desktop/src/renderer/Workbench.tsx`
  and `apps/desktop/src/renderer/styles.css`

## Executive finding

The current UI keeps the right broad composition—warm paper canvas, five-color
Translunar Band, dominant segment grid, Suggestions column, document preview,
and dark status footer—but it is visibly behind the approved design system in
typography, hierarchy, density, and art-directed chrome. It is therefore a
**structural match with a material visual-detail deviation**, not a completely
different product.

## Deviation matrix

| Area | Intended design | Observed in the current capture | Impact | Priority |
| --- | --- | --- | --- | --- |
| Typography | Space Grotesk display, Chivo body, Space Mono metadata, CJK at readable sizes; body 14–15px and metadata ≥11px | Much of the shell and metadata is rendered at roughly 9–10px; the intended font hierarchy is not consistently visible | Long-session scanning and brand character are weakened; CJK density becomes tiring | High |
| Top app bar | Strong black identity block, project/document control, global search, clear action hierarchy, one deliberate geometric gesture | The top bar is flatter and more utility-like; global search and the identity composition are weak or absent | The product reads as a generic tool before the retrofuturist identity registers | High |
| Translunar Band / geometry | One controlled five-stripe signature plus orbital/registration composition in chrome | The band remains, but the surrounding orbital/technical composition is largely missing | Brand anchor survives only as a color strip | Medium |
| Segment grid | Quiet, spacious working cells; clear state lamps; active row strongly legible; no decorative noise in cells | Tags, tiny labels, status text, and controls cluster tightly in rows; the active state is less emphatic | Higher cognitive load and weaker source/target focus | High |
| Suggestions header | Warm-black cut-corner title block, dot field, tabs on a separate row, compact rectangular controls | Header is a conventional rectangular sidebar header; the cut terminal and hierarchy are faint | AI/TM surface feels like a generic assistant panel | High |
| Suggestions content | Matches/Terms/AI hierarchy with quiet cards and grounded metadata | Assistant controls dominate, while match/term hierarchy is less visually distinct; metadata is very small | Users may read the panel as a chat widget rather than a CAT resource surface | Medium |
| Document preview | Real page structure, page number, active-segment location, document controls in a strong handle/title bar | Preview is closer to a text list with an orange active row; page semantics and thumbnail structure are weak | The preview does not yet communicate a real document page confidently | High |
| Controls and radii | 4–6px controls, 8px panels, limited chips; avoid turning everything into pills | Settings and some controls read as rounded pills; dialog/card softness is heavier than specified | Reduces the engineered/printed quality and adds visual noise | Medium |
| Density and scale | 7/10 editor density but 14–16px editable text and clear whitespace around controls | Very small labels compete with dense icon rows and compressed metadata | Accessibility and readability risk, especially at 1250×744 | High |
| Footer | Warm ink strip with balanced counts, selected segment, save state, and restrained dot field | Footer exists and carries useful values, but the composition is visually quieter and more crowded at the ends | Status remains usable, but less like the intended designed instrument | Low/Medium |

## What is already aligned

- The segment grid remains the dominant surface rather than a decorative left
  rail.
- The Suggestions and Preview surfaces exist as persistent, collapsible
  product concepts.
- The warm paper/ink palette and five-stripe band are present.
- The footer communicates real progress/save state instead of invented
  telemetry.
- The current design does not replace CAT vocabulary with fictional spacecraft
  terms, which is an important product requirement.

## Recommended remediation order

1. Restore the typography scale and font roles first. This will improve both
   readability and the perceived hierarchy without changing behavior.
2. Rebuild the app-bar identity/search composition and Suggestions title block
   around the approved geometry.
3. Simplify segment-row micro-controls and enlarge meaningful metadata; keep
   the grid quiet.
4. Make Preview read as a real document page with page position and active
   segment semantics.
5. Normalize radii, chips, focus rings, and dialog geometry to the 4/6/8px
   system; remove pill treatment from non-filter controls.
6. Re-run screenshots at 1250×744, 1680×942, and 1920×1080, then perform the
   manual contrast and CJK readability review.

## Ownership boundary for this handoff

The visual identity/polish work is separate and currently dirty in the shared
worktree. This session deliberately did **not** stage or alter:

- `apps/desktop/src/renderer/Workbench.tsx`
- `apps/desktop/src/renderer/styles.css`
- `.trellis/tasks/07-21-workbench-visual-identity/`
- `.trellis/tasks/07-21-workbench-visual-polish/`
- `.trellis/workspace/Ruelya/workbench-assistant-1250x744.png`

The deviations above are recorded so the next visual pass can address them
without confusing a visual mismatch with a product-shell regression.
