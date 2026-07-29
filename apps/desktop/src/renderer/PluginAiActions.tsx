import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiActionProposalV1,
  PluginAiActionInvokeResult,
  PluginAiActionView,
  Segment,
} from "@translunar/contracts";
import { Sparkles } from "lucide-react";

import { useLocale } from "./i18n/LocaleProvider";

interface PluginAiActionsProps {
  activeSegment: Segment | undefined;
  sourceLocale: string;
  targetLocale: string;
  onUseTarget(target: string): void;
  /** Closed placement filter — required so surfaces never mix. */
  placement: "editorSelection" | "assistantSidebar";
  /**
   * `menu` embeds actions as overflow menu items (editorSelection).
   * `panel` is the full assistant-side surface.
   */
  variant?: "panel" | "menu";
  /** Called after an action is chosen from a menu (e.g. close overflow). */
  onMenuAction?: () => void;
}

export function PluginAiActions({
  activeSegment,
  sourceLocale,
  targetLocale,
  onUseTarget,
  placement,
  variant = "panel",
  onMenuAction,
}: PluginAiActionsProps) {
  const { t } = useLocale();
  const [actions, setActions] = useState<PluginAiActionView[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [invocationId, setInvocationId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{
    action: PluginAiActionView;
    result: PluginAiActionInvokeResult;
    segmentKey: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const page = await window.translunar.invoke("plugin.aiAction.list", {});
      const items = page.items.filter(
        (action) =>
          action.descriptor.placement === placement &&
          action.state === "active",
      );
      setActions(items);
    } catch {
      setActions([]);
    }
  }, [placement]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const cancel = async () => {
    if (!invocationId) return;
    cancelledRef.current = true;
    try {
      await window.translunar.invoke("plugin.aiAction.cancel", {
        invocationId,
      });
    } catch {
      // Client-side discard still applies when the Engine serializes late.
    }
    setBusyId(null);
    setInvocationId(null);
    setError(t("plugins.actions.cancelled"));
  };

  const invoke = async (action: PluginAiActionView) => {
    if (!activeSegment || busyId) return;
    const invokedSegmentKey = segmentKey(activeSegment);
    setBusyId(action.owner.contributionId);
    setError(null);
    setProposal(null);
    cancelledRef.current = false;
    const nextInvocationId = createInvocationId();
    setInvocationId(nextInvocationId);
    try {
      const result = await window.translunar.invoke("plugin.aiAction.invoke", {
        invocation: {
          protocolVersion: 1,
          invocationId: nextInvocationId,
          contributionId: action.owner.contributionId,
          operation: "ai.action.invoke",
          context: {
            selectionText: activeSegment.targetText || activeSegment.sourceText,
            segmentText: activeSegment.targetText,
            sourceText: activeSegment.sourceText,
            sourceLocale,
            targetLocale,
            tags: [],
          },
          configSchemaVersion: 1,
          config: {},
          deadlineMs: Math.min(
            action.descriptor.limits?.maxDeadlineMs ?? 2_000,
            2_000,
          ),
        },
      });
      if (cancelledRef.current) {
        setError(t("plugins.actions.cancelled"));
        return;
      }
      setProposal({ action, result, segmentKey: invokedSegmentKey });
    } catch (cause) {
      if (cancelledRef.current) {
        setError(t("plugins.actions.cancelled"));
        return;
      }
      setError(
        cause instanceof Error ? cause.message : t("plugins.actions.failure"),
      );
    } finally {
      setBusyId(null);
      setInvocationId(null);
    }
  };

  if (!actions.length && !proposal && !error) return null;

  const proposalIsCurrent =
    proposal !== null &&
    isCurrentSegmentRevision(activeSegment, proposal.segmentKey);

  if (variant === "menu") {
    return (
      <>
        {actions.map((action) => (
          <button
            type="button"
            role="menuitem"
            key={`${action.owner.pluginId}:${action.owner.contributionId}`}
            className="plugin-ai-actions__menu-item"
            disabled={!activeSegment || busyId !== null}
            aria-busy={busyId === action.owner.contributionId}
            title={`${action.descriptor.label} · ${action.owner.pluginId} · ${action.descriptor.version}`}
            onClick={(event) => {
              event.stopPropagation();
              void invoke(action);
            }}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span className="plugin-ai-actions__menu-label">
              {action.descriptor.label}
            </span>
          </button>
        ))}
        {busyId && invocationId ? (
          <button
            type="button"
            role="menuitem"
            className="plugin-ai-actions__menu-item"
            onClick={(event) => {
              event.stopPropagation();
              void cancel();
            }}
          >
            {t("plugins.actions.cancel")}
          </button>
        ) : null}
        {error ? (
          <p role="alert" className="plugin-ai-actions__menu-error">
            {error}
          </p>
        ) : null}
        {proposal ? (
          <div
            className="plugin-ai-actions__menu-proposal"
            role="group"
            aria-label={proposal.action.descriptor.displayName}
          >
            <strong className="plugin-ai-actions__menu-label">
              {proposal.action.descriptor.displayName}
            </strong>
            <p>{proposalText(proposal.result.result.proposal)}</p>
            <div className="plugin-ai-actions__menu-proposal-actions">
              {isTextProposal(proposal.result.result.proposal) &&
              proposalIsCurrent ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUseTarget(proposalText(proposal.result.result.proposal));
                    setProposal(null);
                    onMenuAction?.();
                  }}
                >
                  {t("plugins.actions.accept")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setProposal(null);
                }}
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section
      className="plugin-ai-actions"
      aria-label={t("plugins.actions.aria")}
      data-placement={placement}
    >
      <header>
        <Sparkles size={13} />
        <strong>{t("plugins.actions.title")}</strong>
      </header>
      <div className="plugin-ai-actions__list" role="group">
        {actions.map((action) => (
          <button
            type="button"
            key={`${action.owner.pluginId}:${action.owner.contributionId}`}
            disabled={!activeSegment || busyId !== null}
            aria-busy={busyId === action.owner.contributionId}
            title={`${action.owner.pluginId} · ${action.descriptor.version} · ${action.state}`}
            onClick={() => void invoke(action)}
          >
            <span className="plugin-ai-actions__menu-label">
              {action.descriptor.label}
            </span>
            <small>
              {action.owner.pluginId} · {action.descriptor.version}
            </small>
          </button>
        ))}
      </div>
      {busyId && invocationId ? (
        <button type="button" onClick={() => void cancel()}>
          {t("plugins.actions.cancel")}
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {proposal ? (
        <article className="plugin-ai-actions__proposal" aria-live="polite">
          <strong>{proposal.action.descriptor.displayName}</strong>
          <p>{proposalText(proposal.result.result.proposal)}</p>
          <small>
            {proposal.result.owner.pluginId} ·{" "}
            {proposal.result.descriptor.version} ·{" "}
            {proposal.result.canonicalSha256.slice(0, 12)} ·{" "}
            {proposal.result.result.usage.durationMs} ms
          </small>
          <div>
            {isTextProposal(proposal.result.result.proposal) &&
            proposalIsCurrent ? (
              <button
                type="button"
                onClick={() => {
                  onUseTarget(proposalText(proposal.result.result.proposal));
                  setProposal(null);
                }}
              >
                {t("plugins.actions.accept")}
              </button>
            ) : null}
            <button type="button" onClick={() => setProposal(null)}>
              {t("common.close")}
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}

function isTextProposal(proposal: AiActionProposalV1): boolean {
  return (
    proposal.kind === "replaceSelection" || proposal.kind === "replaceTarget"
  );
}

function proposalText(proposal: AiActionProposalV1): string {
  return proposal.kind === "assistantContent"
    ? proposal.content
    : proposal.text;
}

function createInvocationId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `plugin-action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function segmentKey(segment: Segment): string {
  return `${segment.id}:${segment.revision}`;
}

export function isCurrentSegmentRevision(
  activeSegment: Segment | undefined,
  expectedSegmentKey: string,
): boolean {
  return (
    activeSegment !== undefined &&
    segmentKey(activeSegment) === expectedSegmentKey
  );
}
