import { useEffect, useRef } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

import { useLocale } from "../../../i18n/LocaleProvider";
import { togglePanelCollapsed } from "../../../workbench-utils";
import { AssistantDrawer } from "./AssistantDrawer";
import { MatchList } from "./MatchList";
import type { StackPanelProps } from "./stackTypes";
import { TermList } from "./TermList";

/**
 * Phase 4 Stack: co-visible Matches + Terms, AI as bottom drawer,
 * single collapse control → 40px rail.
 */
export function StackPanel({
  projectId,
  sourceLocale,
  targetLocale,
  mode,
  onModeChange,
  assistantOpen,
  onAssistantOpenChange,
  activeSegment,
  matches,
  matchesLoading,
  matchesError,
  termMatches,
  termLoading,
  termSettled,
  termError,
  onInsert,
  onApplyMutation,
}: StackPanelProps) {
  const { t } = useLocale();
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterModeRef = useRef<"content" | "rail" | null>(null);
  const collapsed = mode === "collapsed";

  useEffect(() => {
    const focusTarget = focusAfterModeRef.current;
    if (!focusTarget) return;
    focusAfterModeRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (focusTarget === "rail") expandButtonRef.current?.focus();
      else collapseButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  return (
    <aside
      className="stack suggestions-panel"
      aria-label={t("common.suggestions")}
      data-stack-mode={collapsed ? "collapsed" : "expanded"}
    >
      <div
        className="stack__body suggestions-content"
        aria-hidden={collapsed}
        inert={collapsed ? true : undefined}
      >
        <header className="stack__head suggestions-header">
          <strong className="stack__title suggestions-title" data-cut-terminal="true">
            {t("common.suggestions")}
          </strong>
          <div className="stack__field suggestions-header-field">
            <div className="suggestions-dots" aria-hidden="true" />
            <div className="suggestions-header-tools">
              <button
                type="button"
                className="stack__collapse icon-button"
                ref={collapseButtonRef}
                onClick={() => {
                  focusAfterModeRef.current = "rail";
                  onModeChange(togglePanelCollapsed(mode));
                }}
                title={t("workbench.collapseSuggestions")}
                aria-label={t("workbench.collapseSuggestions")}
                data-suggestion-collapse="true"
              >
                <PanelRightClose size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        <section
          className="sec sec--matches"
          aria-label={t("workbench.matches")}
          aria-busy={matchesLoading}
        >
          <div className="sec__head">
            <strong>{t("workbench.matches")}</strong>
            <span className="count">{matches.length}</span>
            <span className="grow" />
          </div>
          <div className="sec__body">
            <MatchList
              matches={matches}
              loading={matchesLoading}
              error={matchesError}
              activeSegment={activeSegment}
              onInsert={onInsert}
            />
          </div>
        </section>

        <section
          className="sec sec--terms"
          aria-label={t("common.terms")}
          aria-busy={termLoading}
        >
          <div className="sec__head">
            <strong>{t("common.terms")}</strong>
            <span className="count">
              {termSettled ? termMatches.length : "…"}
            </span>
            <span className="grow" />
          </div>
          <div className="sec__body">
            <TermList
              termMatches={termMatches}
              loading={termLoading}
              settled={termSettled}
              error={termError}
              onInsert={onInsert}
            />
          </div>
        </section>

        <AssistantDrawer
          open={assistantOpen}
          onOpenChange={onAssistantOpenChange}
          projectId={projectId}
          sourceLocale={sourceLocale}
          targetLocale={targetLocale}
          activeSegment={activeSegment}
          onInsert={onInsert}
          onApplyMutation={onApplyMutation}
        />
      </div>

      <div
        className="stack-rail suggestions-rail"
        aria-hidden={!collapsed}
        inert={!collapsed ? true : undefined}
      >
        <button
          type="button"
          className="suggestions-expand"
          ref={expandButtonRef}
          onClick={() => {
            focusAfterModeRef.current = "content";
            onModeChange(togglePanelCollapsed(mode));
          }}
          title={t("workbench.openSuggestions")}
          aria-label={t("workbench.openSuggestions")}
        >
          <PanelRightOpen size={15} aria-hidden="true" />
        </button>
        <span>{t("common.suggestions")}</span>
        <div className="rail-dots" aria-hidden="true" />
      </div>
    </aside>
  );
}
