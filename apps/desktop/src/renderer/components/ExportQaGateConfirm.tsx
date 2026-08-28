import { Button } from "@translunar/ui";

export interface ExportQaGateConfirmProps {
  /** Error-severity open issues the gate reported. */
  openErrors: number;
  /** Leading rule ids from the refusal (the engine sends at most three). */
  ruleIds: string[];
  /** True while the override retry is in flight. */
  busy?: boolean;
  onOverride: () => void;
  onCancel: () => void;
}

/**
 * Inline confirm for an export the QA gate refused (`exportBlocked` with
 * `data.reason: "qaGate"`): the project profile blocks exporting while
 * error-severity open issues exist.「仍要导出」retries the same export with
 * `overrideQaGate: true`;「取消」leaves everything untouched so the user can
 * fix or waive the findings first.
 */
export function ExportQaGateConfirm({
  openErrors,
  ruleIds,
  busy = false,
  onOverride,
  onCancel,
}: ExportQaGateConfirmProps) {
  return (
    <div
      className="honest-note export-overwrite"
      role="alertdialog"
      aria-label="存在 QA 错误，仍要导出吗？"
    >
      <span className="export-overwrite__message">
        存在 QA 错误，仍要导出吗？
        <span className="export-overwrite__path">
          {openErrors} 个错误未解决
          {ruleIds.length > 0 ? `：${ruleIds.join("、")}` : ""}
        </span>
      </span>
      <span className="export-overwrite__actions">
        <Button size="sm" variant="danger" disabled={busy} onClick={onOverride}>
          {busy ? "导出中…" : "仍要导出"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </span>
    </div>
  );
}
