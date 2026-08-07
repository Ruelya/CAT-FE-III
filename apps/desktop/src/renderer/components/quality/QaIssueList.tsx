import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  QaIssueView,
  QaRunPluginRuleSnapshot,
  QaSeverity,
  ReviewQueueItem,
} from "@translunar/contracts";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown } from "lucide-react";

import { ActiveAxis } from "../workbench/ActiveAxis";
import {
  dispositionIsWaived,
  groupIssuesBySeverity,
  ruleDisplayName,
} from "./qa-presenters";

export interface QaIssueListProps {
  issues: readonly QaIssueView[];
  selectedId: string | null;
  issueTotal: number;
  offset: number;
  pageSize: number;
  loading: boolean;
  queue: readonly ReviewQueueItem[];
  pluginRuleFor(issue: QaIssueView): QaRunPluginRuleSnapshot | null;
  categoryLabel(category: string): string;
  severityLabel(severity: QaSeverity): string;
  labels: {
    findingsAria: string;
    noMatch: string;
    changeFilters: string;
    prevPage: string;
    nextPage: string;
    pageRange: string;
    waived: string;
    pluginFrom: string;
    pendingProposals: string;
    queueClear: string;
    loading: string;
  };
  onSelect(id: string): void;
  onOpenSegment(segmentId: string): void;
  onOffset(offset: number): void;
  formatPageRange(start: number, end: number, total: number): string;
  pendingProposalCountLabel(count: number): string;
}

export function QaIssueList({
  issues,
  selectedId,
  issueTotal,
  offset,
  pageSize,
  loading,
  queue,
  pluginRuleFor,
  categoryLabel,
  severityLabel,
  labels,
  onSelect,
  onOpenSegment,
  onOffset,
  formatPageRange,
  pendingProposalCountLabel,
}: QaIssueListProps) {
  const groups = useMemo(() => groupIssuesBySeverity(issues), [issues]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const flatIds = useMemo(() => issues.map((item) => item.id), [issues]);

  const onListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!flatIds.length) return;
      const index = selectedId ? flatIds.indexOf(selectedId) : -1;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = flatIds[Math.min(flatIds.length - 1, Math.max(0, index) + 1)];
        if (next) onSelect(next);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const next = flatIds[Math.max(0, index - 1)];
        if (next) onSelect(next);
      } else if (event.key === "Enter" && selectedId) {
        const issue = issues.find((item) => item.id === selectedId);
        if (issue) {
          event.preventDefault();
          onOpenSegment(issue.segmentId);
        }
      } else if (event.key === "F8") {
        event.preventDefault();
        if (event.shiftKey) {
          const next = flatIds[Math.max(0, index - 1)];
          if (next) onSelect(next);
        } else {
          const next =
            flatIds[Math.min(flatIds.length - 1, Math.max(0, index) + 1)];
          if (next) onSelect(next);
        }
      }
    },
    [flatIds, issues, onOpenSegment, onSelect, selectedId],
  );

  return (
    <div className="qa-ortho__list" aria-label={labels.findingsAria}>
      {loading ? (
        <div className="qa-skeleton" aria-label={labels.loading}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : issues.length ? (
        <div
          className="qa-ortho__listbox"
          role="listbox"
          tabIndex={0}
          aria-label={labels.findingsAria}
          onKeyDown={onListKeyDown}
        >
          {groups.map((group) => {
            const isCollapsed = collapsed[group.severity] === true;
            return (
              <section
                key={group.severity}
                className="qa-ortho__group"
                data-severity={group.severity}
              >
                <button
                  type="button"
                  className="qa-ortho__group-head"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [group.severity]: !isCollapsed,
                    }))
                  }
                >
                  <ChevronDown
                    size={12}
                    aria-hidden="true"
                    className={
                      isCollapsed ? "qa-ortho__chevron is-collapsed" : "qa-ortho__chevron"
                    }
                  />
                  <span className="micro">
                    {severityLabel(group.severity)} · {group.issues.length}
                  </span>
                </button>
                {isCollapsed
                  ? null
                  : group.issues.map((issue) => {
                      const selected = issue.id === selectedId;
                      const waived = dispositionIsWaived(issue.disposition);
                      const plugin = pluginRuleFor(issue);
                      const display = ruleDisplayName(
                        issue,
                        categoryLabel(issue.category),
                      );
                      return (
                        <button
                          type="button"
                          role="option"
                          key={issue.id}
                          aria-selected={selected}
                          className="qa-issue-row"
                          data-severity={issue.severity}
                          data-waived={waived || undefined}
                          data-selected={selected || undefined}
                          onClick={() => onSelect(issue.id)}
                        >
                          {selected ? <ActiveAxis variant="row" /> : null}
                          <span className="qa-issue-row__title">
                            {severityLabel(issue.severity)} · {display}
                            {waived ? (
                              <em className="qa-issue-row__waived">
                                {labels.waived}
                              </em>
                            ) : null}
                          </span>
                          <span className="qa-issue-row__body">
                            {issue.segmentOrdinal + 1} · {issue.message}
                          </span>
                          {plugin ? (
                            <span className="qa-issue-row__plugin">
                              {labels.pluginFrom
                                .replace(
                                  "{name}",
                                  plugin.provenance.pluginId,
                                )
                                .replace(
                                  "{version}",
                                  plugin.provenance.contributionVersion,
                                )}
                            </span>
                          ) : null}
                          <code className="qa-issue-row__rule" title={issue.ruleId}>
                            {issue.ruleId}
                          </code>
                        </button>
                      );
                    })}
              </section>
            );
          })}

          {queue.length ? (
            <section className="qa-ortho__group qa-ortho__group--queue">
              <header className="qa-ortho__group-head">
                <span className="micro">
                  {pendingProposalCountLabel(queue.length)}
                </span>
              </header>
              {queue.map((item) => (
                <button
                  type="button"
                  key={item.revision.id}
                  className="qa-issue-row qa-issue-row--queue"
                  onClick={() => onOpenSegment(item.revision.segmentId)}
                >
                  <span className="qa-issue-row__title">
                    {item.documentName} · {item.segmentOrdinal + 1}
                  </span>
                  <span className="qa-issue-row__body">
                    {item.revision.author}
                  </span>
                </button>
              ))}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="surface-empty">
          <CheckCircle2 size={24} aria-hidden="true" />
          <strong>{labels.noMatch}</strong>
          <span>{labels.changeFilters}</span>
        </div>
      )}

      <footer className="qa-ortho__pagination">
        <span>
          {issueTotal
            ? formatPageRange(
                offset + 1,
                Math.min(offset + pageSize, issueTotal),
                issueTotal,
              )
            : labels.noMatch}
        </span>
        <button
          type="button"
          aria-label={labels.prevPage}
          disabled={offset === 0}
          onClick={() => onOffset(Math.max(0, offset - pageSize))}
        >
          <ArrowLeft size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={labels.nextPage}
          disabled={offset + pageSize >= issueTotal}
          onClick={() => onOffset(offset + pageSize)}
        >
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
}
