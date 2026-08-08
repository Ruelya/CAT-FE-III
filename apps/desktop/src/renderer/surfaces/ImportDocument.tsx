import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";

export interface ImportDocumentProps {
  projectName: string;
  pending?: boolean;
  error?: UiError | null;
  disabled?: boolean;
  onImport: () => void;
}

export function ImportDocument({
  projectName,
  pending,
  error,
  disabled,
  onImport,
}: ImportDocumentProps) {
  const busy = Boolean(pending || disabled);
  return (
    <section className="surface surface--center" data-testid="import-document">
      <h1 className="surface__title">{projectName}</h1>
      {error ? <p className="error-text">{formatUiError(error)}</p> : null}
      <button
        type="button"
        className="btn btn--primary"
        disabled={busy}
        onClick={onImport}
      >
        {pending ? "Importing" : "Choose file"}
      </button>
    </section>
  );
}
