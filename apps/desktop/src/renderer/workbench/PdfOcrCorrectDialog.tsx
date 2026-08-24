import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import { ModalDialog } from "../shell/ModalDialog";

export interface PdfOcrAiView {
  pending: boolean;
  error: UiError | null;
  proposal: string;
  profilesLoaded: boolean;
  runnable: boolean;
}

export interface PdfOcrCorrectDialogProps {
  sourceText: string;
  pending: boolean;
  error: UiError | null;
  canSubmit: boolean;
  disabled?: boolean;
  ai?: PdfOcrAiView;
  onSuggestAi?: () => void;
  onUseAiSuggestion?: () => void;
  onSourceTextChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function PdfOcrCorrectDialog({
  sourceText,
  pending,
  error,
  canSubmit,
  disabled,
  ai,
  onSuggestAi,
  onUseAiSuggestion,
  onSourceTextChange,
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
      {ai ? (
        <div className="pdf-ocr-ai" data-testid="pdf-ocr-ai">
          {!ai.profilesLoaded ? (
            <p className="muted">Loading AI profiles</p>
          ) : !ai.runnable ? (
            <p className="muted" data-testid="pdf-ocr-ai-no-profile">
              No credential-backed AI profile is enabled. Configure one under
              AI settings, then return here.
            </p>
          ) : (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy || ai.pending}
              onClick={onSuggestAi}
              data-testid="pdf-ocr-ai-suggest"
            >
              {ai.pending ? "Suggesting" : "Suggest correction"}
            </button>
          )}
          {ai.error ? (
            <p className="field__error" data-testid="pdf-ocr-ai-error">
              {formatUiError(ai.error)}
            </p>
          ) : null}
          {ai.proposal ? (
            <div className="pdf-ocr-ai__proposal">
              <p
                className="pdf-ocr-ai__proposal-text"
                data-testid="pdf-ocr-ai-proposal"
              >
                {ai.proposal}
              </p>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={onUseAiSuggestion}
                data-testid="pdf-ocr-ai-use"
              >
                Use suggestion
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="field__error" data-testid="pdf-ocr-error">
          {formatUiError(error)}
        </p>
      ) : null}
    </ModalDialog>
  );
}
