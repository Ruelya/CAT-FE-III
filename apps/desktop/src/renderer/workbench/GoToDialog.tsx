import { useEffect, useId, useRef, useState } from "react";

export interface GoToDialogProps {
  maxOrdinal: number;
  onGo: (ordinal: number) => void;
  onClose: () => void;
}

/**
 * Jump to a segment by its displayed number.
 *
 * Bound to Ctrl+G because that chord already lives under every translator's
 * fingers from every CAT tool they have used. The dialog is deliberately
 * small: the only question it asks is "which number", and anything else
 * (status filters, comment filters) already belongs on the display filter bar.
 */
export function GoToDialog({ maxOrdinal, onGo, onClose }: GoToDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > maxOrdinal) {
      setError(`Enter a number between 1 and ${maxOrdinal}`);
      return;
    }
    onGo(parsed);
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="goto-dialog"
      >
        <h2 id={titleId} className="dialog__title">
          Go to segment
        </h2>
        <div className="field">
          <label className="field__label" htmlFor="goto-ordinal">
            Segment number
          </label>
          <input
            ref={inputRef}
            id="goto-ordinal"
            inputMode="numeric"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
        </div>
        {error ? <p className="field__error">{error}</p> : null}
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="goto-submit"
            onClick={submit}
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
}
