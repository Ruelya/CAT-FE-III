import type { EditorMutationResult, Segment } from "@translunar/contracts";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";

import { AssistantPanel } from "../../../AssistantPanel";
import { PluginAiActions } from "../../../PluginAiActions";
import { PluginWorkbenchPanels } from "../../../PluginWorkbenchPanels";
import { useLocale } from "../../../i18n/LocaleProvider";

export interface AssistantDrawerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  activeSegment: Segment | undefined;
  onInsert(target: string): void;
  onApplyMutation(mutation: EditorMutationResult): void;
}

export function AssistantDrawer({
  open,
  onOpenChange,
  projectId,
  sourceLocale,
  targetLocale,
  activeSegment,
  onInsert,
  onApplyMutation,
}: AssistantDrawerProps) {
  const { t } = useLocale();

  return (
    <div
      className="ai-drawer-shell"
      data-open={open ? "" : undefined}
    >
      <button
        type="button"
        className="ai-drawer"
        aria-expanded={open}
        aria-controls="stack-assistant-body"
        onClick={() => onOpenChange(!open)}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <Sparkles size={13} aria-hidden="true" />
        <span className="ai-drawer__label">{t("workbench.assistant")}</span>
        <span className="grow" />
        <span className="ai-drawer__status">
          {open
            ? t("workbench.assistant.drawerOpen")
            : t("workbench.assistant.drawerCollapsed")}
        </span>
      </button>
      {open ? (
        <div
          id="stack-assistant-body"
          className="ai-drawer__body"
          role="region"
          aria-label={t("workbench.assistant")}
        >
          <PluginAiActions
            activeSegment={activeSegment}
            sourceLocale={sourceLocale}
            targetLocale={targetLocale}
            onUseTarget={onInsert}
            placement="assistantSidebar"
          />
          <PluginWorkbenchPanels
            placement="assistantSidebar"
            projectId={projectId}
            {...(activeSegment?.id ? { segmentId: activeSegment.id } : {})}
          />
          <AssistantPanel
            activeSegment={activeSegment}
            onUseTarget={onInsert}
            projectId={projectId}
            onApplyMutation={onApplyMutation}
          />
        </div>
      ) : null}
    </div>
  );
}
