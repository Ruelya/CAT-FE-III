import type {
  EditorMutationResult,
  Segment,
  TermMatch,
  TmEntry,
} from "@translunar/contracts";

import type { PanelMode } from "../../../workbench-utils";

export interface StackPanelProps {
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  mode: PanelMode;
  onModeChange(mode: PanelMode): void;
  assistantOpen: boolean;
  onAssistantOpenChange(open: boolean): void;
  activeSegment: Segment | undefined;
  matches: TmEntry[];
  matchesLoading: boolean;
  matchesError: string | null;
  termMatches: TermMatch[];
  termLoading: boolean;
  termSettled: boolean;
  termError: string | null;
  onInsert(
    target: string,
    context?: { kind: "term"; sourceTerm: string },
  ): void;
  onApplyMutation(mutation: EditorMutationResult): void;
}

export type TermStateKind = "preferred" | "forbidden" | "pending";
