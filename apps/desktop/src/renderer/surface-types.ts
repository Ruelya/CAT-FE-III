export type AppSurface =
  | "workbench"
  | "qa-review"
  | "export-review"
  | "translation-memory"
  | "ai-control"
  | "project-insights";

/**
 * 六个 Surface 的规范顺序 —— 即 Index Spine 的灯序与 `Ctrl+1..6`。
 *
 * 单一定义处：Index Spine、命令面板、键盘分发都从这里取，
 * 避免三处各写一遍导致灯序与快捷键错位。
 *
 * Source: docs/design-ii/06-shell-navigation.md §2.3
 */
export const SURFACE_ORDER: readonly AppSurface[] = [
  "workbench",
  "qa-review",
  "export-review",
  "translation-memory",
  "ai-control",
  "project-insights",
];

export const SURFACE_LABEL: Record<AppSurface, string> = {
  workbench: "工作台",
  "qa-review": "QA 复核",
  "export-review": "导出复核",
  "translation-memory": "资产",
  "ai-control": "AI 控制台",
  "project-insights": "项目洞察",
};
