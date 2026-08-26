import type { QaFix, QaIssue } from "@translunar/contracts";
import { Badge, Button, EmptyState, Panel } from "@translunar/ui";

export interface QaPanelProps {
  issues: QaIssue[];
  /**
   * Engine-proposed corrections (qa.fix.list), keyed back to issues by
   * issueId. A 应用修复 button renders exactly when a fix exists here —
   * the panel never invents replacement text.
   */
  fixes: QaFix[];
  disabled: boolean;
  /**
   * Key of the waive/restore/fix call still in flight — the clicked
   * issue's id, `rule:<ruleId>`, `segment:<segmentId>`, or
   * `fix:<issueId>`. The matching button locks.
   */
  pendingKey: string | null;
  onRun: () => void;
  onJump: (segmentId: string) => void;
  /** 忽略: record a human waiver. The issue is not fixed and no TM is written. */
  onWaive: (issue: QaIssue) => void;
  /** 忽略同类: waive every issue of this rule in the document. */
  onWaiveRule: (issue: QaIssue) => void;
  /** 忽略本句: waive every issue of this segment. */
  onWaiveSegment: (issue: QaIssue) => void;
  /** 恢复: bring a waived issue back to 未解决. */
  onRestore: (issue: QaIssue) => void;
  /** 应用修复: apply the engine's correction through qa.fix.apply. */
  onApplyFix: (fix: QaFix) => void;
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

/**
 * Resolve-style grouping: open issues bucketed by ruleId in severity order
 * (a rule group ranks by its most severe member), issues inside each group
 * keeping the severity sort.
 */
function groupByRule(list: QaIssue[]): [string, QaIssue[]][] {
  const groups = new Map<string, QaIssue[]>();
  for (const issue of bySeverity(list)) {
    const group = groups.get(issue.ruleId);
    if (group) {
      group.push(issue);
    } else {
      groups.set(issue.ruleId, [issue]);
    }
  }
  return [...groups.entries()];
}

/**
 * Localized message for rules whose engine `params` carry the facts; the
 * engine's English `message` stays the fallback for everything else.
 */
function messageFor(issue: QaIssue): string {
  const params = issue.params ?? {};
  switch (issue.ruleId) {
    case "qa.unedited-fuzzy":
      return params.score
        ? `模糊匹配（${params.score}%）未修改即确认`
        : "模糊匹配未修改即确认";
    case "qa.length-ratio":
      if (params.ratio && params.min && params.max) {
        return `译文长度比 ${params.ratio}%，超出 ${params.min}%–${params.max}%`;
      }
      return issue.message;
    case "qa.target-length-limit":
      if (params.limit && params.found) {
        return `译文 ${params.found} 字符，超出上限 ${params.limit}`;
      }
      return issue.message;
    default:
      return issue.message;
  }
}

/**
 * Localized label for a correction; the engine's English `description`
 * stays the fallback for rules this map does not know.
 */
function fixLabelFor(fix: QaFix): string {
  switch (fix.ruleId) {
    case "qa.edge-whitespace":
      return "去除首尾空白";
    case "qa.cjk-halfwidth-punctuation":
      return "标点改全角";
    case "qa.cjk-ellipsis":
      return "省略号改 ……";
    case "qa.repeated-word":
      return "删除重复词";
    case "qa.number-mismatch":
      return "数字改为源文数值";
    default:
      return fix.description;
  }
}

export function QaPanel({
  issues,
  fixes,
  disabled,
  pendingKey,
  onRun,
  onJump,
  onWaive,
  onWaiveRule,
  onWaiveSegment,
  onRestore,
  onApplyFix,
}: QaPanelProps) {
  const open = issues.filter((issue) => issue.status === "open");
  const waived = bySeverity(
    issues.filter((issue) => issue.status === "waived"),
  );
  const resolved = bySeverity(
    issues.filter((issue) => issue.status === "resolved"),
  );
  const openGroups = groupByRule(open);
  const fixByIssueId = new Map(fixes.map((fix) => [fix.issueId, fix]));
  // 忽略同类/忽略本句 only make sense when they would touch more than the
  // row's own 忽略 button: another open issue shares the rule / segment.
  const openSegmentCounts = new Map<string, number>();
  for (const issue of open) {
    openSegmentCounts.set(
      issue.segmentId,
      (openSegmentCounts.get(issue.segmentId) ?? 0) + 1,
    );
  }

  const renderIssue = (issue: QaIssue, openRuleCount: number) => {
    // Number rules fill sourceNumbers/targetNumbers; tag, term, and
    // other rules fill sourceValues/targetValues. Render whichever
    // side carries evidence, and no bracket line when neither does.
    // Behavioral rules pin the whole confirmed target as evidence
    // (for the waiver fingerprint); a "源 ≠ 译" line would misread
    // that, so it stays off.
    const behavioral = issue.ruleId === "qa.unedited-fuzzy";
    const sourceEvidence = behavioral
      ? []
      : [
          ...issue.evidence.sourceNumbers,
          ...(issue.evidence.sourceValues ?? []),
        ];
    const targetEvidence = behavioral
      ? []
      : [
          ...issue.evidence.targetNumbers,
          ...(issue.evidence.targetValues ?? []),
        ];
    const fix = issue.status === "open" ? fixByIssueId.get(issue.id) : undefined;
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
                disabled={pendingKey === issue.id}
                onClick={() => onWaive(issue)}
              >
                忽略
              </Button>
            ) : null}
            {issue.status === "open" && openRuleCount > 1 ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pendingKey === `rule:${issue.ruleId}`}
                aria-label={`忽略本文档全部 ${issue.ruleId} 问题`}
                onClick={() => onWaiveRule(issue)}
              >
                忽略同类
              </Button>
            ) : null}
            {issue.status === "open" &&
            (openSegmentCounts.get(issue.segmentId) ?? 0) > 1 ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pendingKey === `segment:${issue.segmentId}`}
                aria-label="忽略该句段全部问题"
                onClick={() => onWaiveSegment(issue)}
              >
                忽略本句
              </Button>
            ) : null}
            {issue.status === "waived" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pendingKey === issue.id}
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
        <p className="issue-card__message">{messageFor(issue)}</p>
        {sourceEvidence.length > 0 || targetEvidence.length > 0 ? (
          <span className="issue-card__evidence">
            源 [{sourceEvidence.join(", ")}] ≠ 译 [{targetEvidence.join(", ")}]
          </span>
        ) : null}
        {fix ? (
          // The engine proposed this exact replacement; the preview shows
          // it verbatim and the button applies it verbatim.
          <div className="issue-card__fix">
            <span className="issue-card__fix-preview">
              修复为：{fix.fixedTargetText}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pendingKey === `fix:${issue.id}`}
              aria-label={`应用修复：${fixLabelFor(fix)}`}
              title={fixLabelFor(fix)}
              onClick={() => onApplyFix(fix)}
            >
              应用修复
            </Button>
          </div>
        ) : null}
        {issue.status === "waived" && issue.waiveNote ? (
          <span className="issue-card__note">备注：{issue.waiveNote}</span>
        ) : null}
      </div>
    );
  };

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
          {openGroups.map(([ruleId, group]) => (
            <section
              key={ruleId}
              className="issue-group"
              aria-label={`${ruleId} 未解决 ${group.length} 项`}
            >
              <div className="issue-group__head">
                <span className="issue-card__rule">{ruleId}</span>
                <span className="issue-group__count">{group.length}</span>
              </div>
              {group.map((issue) => renderIssue(issue, group.length))}
            </section>
          ))}
          {waived.map((issue) => renderIssue(issue, 0))}
          {resolved.map((issue) => renderIssue(issue, 0))}
        </div>
      )}
    </Panel>
  );
}
