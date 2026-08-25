import type { QaIssue } from "@translunar/contracts";
import { Badge, Button, EmptyState, Panel } from "@translunar/ui";

export interface QaPanelProps {
  issues: QaIssue[];
  disabled: boolean;
  onRun: () => void;
  onJump: (segmentId: string) => void;
}

export function QaPanel({ issues, disabled, onRun, onJump }: QaPanelProps) {
  const open = issues.filter((issue) => issue.status === "open");
  const resolved = issues.filter((issue) => issue.status === "resolved");
  return (
    <Panel
      title={`质量检查（未解决 ${open.length}）`}
      className="dock-panel"
      actions={
        <Button size="sm" variant="primary" onClick={onRun} disabled={disabled}>
          运行数字 QA
        </Button>
      }
    >
      {issues.length === 0 ? (
        <EmptyState
          title="尚未运行检查"
          hint="数字 QA 会比对每个已译句段中源文与译文的数字是否一致。"
        />
      ) : (
        <div className="dock-stack">
          {[...open, ...resolved].map((issue) => (
            <div
              key={issue.id}
              className="issue-card"
              data-resolved={issue.status === "resolved"}
            >
              <div className="match-card__row">
                <Badge tone={issue.status === "open" ? "danger" : "ok"}>
                  {issue.status === "open" ? "未解决" : "已解决"}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onJump(issue.segmentId)}
                >
                  定位句段
                </Button>
              </div>
              <p className="issue-card__message">{issue.message}</p>
              <span className="issue-card__evidence">
                源 [{issue.evidence.sourceNumbers.join(", ")}] ≠ 译 [
                {issue.evidence.targetNumbers.join(", ")}]
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
