export interface EditorPanelContribution {
  id: "suggestions" | "preview" | "comments" | "review";
  label: string;
  placement: "right" | "bottom" | "overlay";
  builtIn: true;
}

/**
 * Stable host projection for built-in editor panels. A future plugin runtime
 * can validate and append declarative contributions without executing plugin
 * code in the renderer.
 */
export const BUILT_IN_EDITOR_PANELS: readonly EditorPanelContribution[] = [
  {
    id: "suggestions",
    label: "Suggestions",
    placement: "right",
    builtIn: true,
  },
  {
    id: "preview",
    label: "Document preview",
    placement: "bottom",
    builtIn: true,
  },
  { id: "comments", label: "Comments", placement: "overlay", builtIn: true },
  {
    id: "review",
    label: "Review revisions",
    placement: "overlay",
    builtIn: true,
  },
] as const;
