import { Button } from "@translunar/ui";

export interface ExportOverwriteConfirmProps {
  /** Destination path the engine refused to clobber. */
  path: string;
  /** True while the overwrite retry is in flight. */
  busy?: boolean;
  onOverwrite: () => void;
  onCancel: () => void;
}

/**
 * Inline confirm for an export that came back `exportBlocked`: the
 * destination already exists and the engine never clobbers it silently.
 * 「覆盖」retries the same export with `overwrite: true`;「取消」leaves the
 * existing file untouched.
 */
export function ExportOverwriteConfirm({
  path,
  busy = false,
  onOverwrite,
  onCancel,
}: ExportOverwriteConfirmProps) {
  return (
    <div
      className="honest-note export-overwrite"
      role="alertdialog"
      aria-label="目标已存在，要覆盖吗？"
    >
      <span className="export-overwrite__message">
        目标已存在，要覆盖吗？
        <span className="export-overwrite__path">{path}</span>
      </span>
      <span className="export-overwrite__actions">
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={onOverwrite}
        >
          {busy ? "覆盖中…" : "覆盖"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </span>
    </div>
  );
}
