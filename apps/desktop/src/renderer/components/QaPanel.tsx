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

export function QaPanel({
  issues,
  disabled,
  pendingIssueId,
  onRun,
  onJump,
  onWaive,
  onRestore,
}: QaPanelProps) {
  const open = issues.filter((issue) => issue.status === "open");
  const waived = issues.filter((issue) => issue.status === "waived");
  const resolved = issues.filter((issue) => issue.status === "resolved");
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
        <EmptyState
          title="尚未运行检查"
          hint="QA 会对每个已译句段运行整套确定性规则：数字与单位、内联标签/占位符完整性、术语、标点、长度与一致性等。"
        />
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
                  <Badge tone={STATUS_TONE[issue.status]}>
                    {STATUS_LABEL[issue.status]}
                  </Badge>
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
                {issue.status === "waived" ? (
                  // Honest reminder: waiving parks the issue, it does not fix
                  // it — nothing was confirmed and nothing reached the TM.
                  <span className="issue-card__note">
                    已忽略：问题仍存在，未确认句段、未写入 TM
                    {issue.waiveNote ? `（备注：${issue.waiveNote}）` : ""}
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
