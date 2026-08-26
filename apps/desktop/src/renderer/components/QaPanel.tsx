import type { QaIssue } from "@translunar/contracts";
import { Badge, Button, EmptyState, Panel } from "@translunar/ui";

export interface QaPanelProps {
  issues: QaIssue[];
  disabled: boolean;
  /** Issue whose waive/restore call is still in flight; its button locks. */
  pendingIssueId: string | null;
  onRun: () => void;
  onJump: (segmentId: string) => void;
  /** 忽略: record a human waiver. The issue is not fixed and no TM is written. */
  onWaive: (issue: QaIssue) => void;
  /** 恢复: bring a waived issue back to 未解决. */
  onRestore: (issue: QaIssue) => void;
}

const STATUS_LABEL: Record<QaIssue["status"], string> = {
  open: "未解决",
  waived: "已忽略",
  resolved: "已解决",
};

const STATUS_TONE = {
  open: "danger",
  waived: "warn",
  resolved: "ok",
} as const;

/** Severity glyphs (never color-only): error before warning before info. */
const SEVERITY_GLYPH: Record<QaIssue["severity"], string> = {
  error: "⛔",
  warning: "⚠",
  info: "ⓘ",
};

const SEVERITY_LABEL: Record<QaIssue["severity"], string> = {
  error: "错误",
  warning: "警告",
  info: "提示",
};

const SEVERITY_RANK: Record<QaIssue["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** Errors surface before warnings within each status group. */
function bySeverity(list: QaIssue[]): QaIssue[] {
  return [...list].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

export function QaPanel({
  issues,
  disabled,
  pendingIssueId,
  onRun,
  onJump,
  onWaive,
  onRestore,
}: QaPanelProps) {
  const open = bySeverity(issues.filter((issue) => issue.status === "open"));
  const waived = bySeverity(
    issues.filter((issue) => issue.status === "waived"),
  );
  const resolved = bySeverity(
    issues.filter((issue) => issue.status === "resolved"),
  );
  return (
    <Panel
      title={`质量检查（未解决 ${open.length}）`}
      className="dock-panel"
      actions={
        <Button size="sm" variant="primary" onClick={onRun} disabled={disabled}>
          运行 QA
        </Button>
      }
    >
      {issues.length === 0 ? (
        <EmptyState title="尚未运行检查" />
      ) : (
        <div className="dock-stack">
          {[...open, ...waived, ...resolved].map((issue) => {
            // Number rules fill sourceNumbers/targetNumbers; tag, term, and
            // other rules fill sourceValues/targetValues. Render whichever
            // side carries evidence, and no bracket line when neither does.
            const sourceEvidence = [
              ...issue.evidence.sourceNumbers,
              ...(issue.evidence.sourceValues ?? []),
            ];
            const targetEvidence = [
              ...issue.evidence.targetNumbers,
              ...(issue.evidence.targetValues ?? []),
            ];
            return (
              <div
                key={issue.id}
                className="issue-card"
                data-status={issue.status}
                data-resolved={issue.status === "resolved"}
              >
                <div className="match-card__row">
                  <span className="issue-card__head">
                    <span
                      className="issue-card__severity"
                      data-severity={issue.severity}
                      role="img"
                      aria-label={SEVERITY_LABEL[issue.severity]}
                      title={SEVERITY_LABEL[issue.severity]}
                    >
                      {SEVERITY_GLYPH[issue.severity]}
                    </span>
                    <Badge tone={STATUS_TONE[issue.status]}>
                      {STATUS_LABEL[issue.status]}
                    </Badge>
                    <span className="issue-card__rule">{issue.ruleId}</span>
                  </span>
                  <span className="issue-card__actions">
                    {issue.status === "open" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pendingIssueId === issue.id}
                        onClick={() => onWaive(issue)}
                      >
                        忽略
                      </Button>
                    ) : null}
                    {issue.status === "waived" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pendingIssueId === issue.id}
                        onClick={() => onRestore(issue)}
                      >
                        恢复
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onJump(issue.segmentId)}
                    >
                      定位句段
                    </Button>
                  </span>
                </div>
                <p className="issue-card__message">{issue.message}</p>
                {sourceEvidence.length > 0 || targetEvidence.length > 0 ? (
                  <span className="issue-card__evidence">
                    源 [{sourceEvidence.join(", ")}] ≠ 译 [
                    {targetEvidence.join(", ")}]
                  </span>
                ) : null}
                {issue.status === "waived" && issue.waiveNote ? (
                  <span className="issue-card__note">
                    备注：{issue.waiveNote}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
