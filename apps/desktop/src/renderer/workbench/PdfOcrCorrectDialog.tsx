import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import { ModalDialog } from "../shell/ModalDialog";

export interface PdfOcrCorrectDialogProps {
  sourceText: string;
  reason: string;
  pending: boolean;
  error: UiError | null;
  canSubmit: boolean;
  disabled?: boolean;
  onSourceTextChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function PdfOcrCorrectDialog({
  sourceText,
  reason,
  pending,
  error,
  canSubmit,
  disabled,
  onSourceTextChange,
  onReasonChange,
  onSubmit,
  onCancel,
}: PdfOcrCorrectDialogProps) {
  const busy = pending || disabled === true;

  return (
    <ModalDialog
      title="OCR correct"
      testId="pdf-ocr-correct-dialog"
      pending={pending}
      onCancel={onCancel}
      initialFocus="first"
      actions={
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canSubmit || busy}
          onClick={onSubmit}
          data-testid="pdf-ocr-save"
        >
          {pending ? "Saving" : "Save"}
        </button>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="ocr-source-text">
          Source
        </label>
        <textarea
          id="ocr-source-text"
          className="field__control"
          rows={4}
          value={sourceText}
          disabled={busy}
          onChange={(e) => onSourceTextChange(e.target.value)}
          data-testid="pdf-ocr-source"
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="ocr-reason">
          Reason
        </label>
        <input
          id="ocr-reason"
          className="field__control"
          value={reason}
          disabled={busy}
          onChange={(e) => onReasonChange(e.target.value)}
          autoComplete="off"
          data-testid="pdf-ocr-reason"
        />
      </div>
      {error ? (
        <p className="field__error" data-testid="pdf-ocr-error">
          {formatUiError(error)}
        </p>
      ) : null}
    </ModalDialog>
  );
}
