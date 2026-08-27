# Translunar CAT Workbench — Pixel-Faithful Clone Study

This study delivers a **pixel-faithful, standalone HTML/CSS implementation** of the reference CAT Workbench interface (`User_Manual.docx`, Modern Light SaaS).

---

## 1. Ground Truth & Artifacts

- **Ground Truth**: Attached high-fidelity workbench screenshot (`65c54d39-47e1-45ab-b5d6-3718a50cd144.png`).
- **HTML Implementation**: `docs/design-studies/clone-gemini/index.html`
- **Rendered Clone Screenshot**: `docs/design-studies/clone-gemini/shots/clone.png` (`/opt/cursor/artifacts/design-clone-gemini/clone.png`)
- **Side-by-Side Comparison**: `docs/design-studies/clone-gemini/shots/side_by_side_comparison.png` (`/opt/cursor/artifacts/design-clone-gemini/side_by_side_comparison.png`)

---

## 2. Faithfulness & Element Breakdown

1. **Top Window Frame & Title Bar**:
   - Native menu items (`File`, `Edit`, `View`, `Project`, `Translate`, `Review`, `Tools`, `Window`, `Help`).
   - Window management controls (`Minimize`, `Maximize`, `Close`).
2. **Action Ribbon**:
   - Button groups with top SVG icons and bottom labels:
     - `New`, `Open`, `Save`, `Import`, `Export`
     - `Cut`, `Copy`, `Paste`
     - `Undo`, `Redo`
     - `Find`, `Replace`, `Filters`, `Concordance`
     - `Comments`, `TQA`, `Segment Actions`
     - `More (...)`
   - Search box (`Search (Ctrl+F)`) with right-aligned magnifying glass.
3. **Left Project Explorer Rail**:
   - Project header with gear icon and `User Manual Localization`.
   - Language pair indicator (`EN (US) → DE (DE)`), due date (`May 30, 2025`), progress readout (`Progress: 68%`), and rounded green progress bar.
   - Search files input with filter icon.
   - Folder tree with expand/collapse chevrons (`01_Source`, `02_Reference`, `03_Translation_Memory`, `04_Deliverables` with cloud icon).
   - Document rows with custom colored format icons (`W`, `PDF`, `TXT`, `XLS`) and translation percentage readouts.
   - Project Details card with 8 metadata rows (`Name`, `Source Language`, `Target Language`, `Created`, `Created by`, `File Count`, `Total Segments`, `Translated Segments`).
   - Bottom navigation icon strip.
4. **Center Working Grid & Drawer**:
   - Active document tab `[W] User_Manual.docx [x]`.
   - Sub-toolbar with search input, layout toggle buttons, refresh, popout, and maximize.
   - Bilingual segment grid (Segments 1–7):
     - Segment 1: Exact TM match (`100% TM` green pill), comment count badge `💬 17`, options menu `⋮`.
     - Segment 2: Exact TM match (`100% TM` green pill), comment count badge `💬 3`, options menu `⋮`.
     - Segment 3: Exact TM match (`100% TM` green pill), options menu `⋮`.
     - Segment 4: Fuzzy match (`95% TM` blue pill), options menu `⋮`.
     - Segment 5: Fuzzy match (`85% TM` blue pill), options menu `⋮`.
     - Segment 6: **Active segment with blue outline border**, live caret, MT origin (`MT 62%` orange pill), options menu `⋮`.
     - Segment 7: Untranslated source segment with empty target and em dash `—`.
   - Bottom Drawer:
     - Top tabs (`Text` active with blue bottom line, `Preview`, `Source`).
     - Sub-tabs (`Comments (1)` active with blue line, `Messages (2)`).
     - Reviewer comment card with `R` avatar, author name, text, and timestamp.
5. **Right Resource Rail**:
   - Tabs (`Translation Memory` active with blue line, `Terminology`).
   - TM selector dropdown (`TM_En-De.sdltm`) with settings gear icon.
   - `100% Match (3)` section with active top match highlighted in green left border (`#22c55e`).
   - `Fuzzy Matches` section with `95%` and `85%` percentage badges.
   - `Term Suggestions` section with sub-header, 5 bilingual term rows (`installation`, `setup file`, `administrator`, `compatibility`, `troubleshooting`), and bookmark action icons.
6. **Bottom Status Bar**:
   - Left instrumentation: `Segments: 1,248    Translated: 849 (68%)    Remaining: 399 (32%)    Words: 18,732`.
   - Right instrumentation: Green `No issues` check pill, document `100%` status, `INS` mode, view mode toggle icons, and `120%` zoom slider with track and thumb.

---

## 3. Remaining Minor Variances (Subpixel / OS Level)

- Operating System Font Rendering: The prototype uses `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto` which defaults to standard Linux/Windows font smoothing in headless Chromium.
- Vector icon sub-pixel strokes: SVG icons are custom-drawn inline vectors closely replicating the exact line weights of the screenshot.
