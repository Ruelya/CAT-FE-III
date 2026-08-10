import type {
  ProjectBatchImportResult,
  TemplateDependencyDiagnostic,
} from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import { BatchImportSummary } from "../workbench/BatchImportSummary";

export interface ImportDocumentProps {
  projectName: string;
  pending?: boolean;
  error?: UiError | null;
  disabled?: boolean;
  batchResult?: ProjectBatchImportResult | null;
  templateDiagnostics?: TemplateDependencyDiagnostic[] | null;
  onImport: () => void;
  onDismissBatch?: () => void;
}

export function ImportDocument({
  projectName,
  pending,
  error,
  disabled,
  batchResult,
  templateDiagnostics,
  onImport,
  onDismissBatch,
}: ImportDocumentProps) {
  const busy = Boolean(pending || disabled);
  return (
    <section className="surface surface--center" data-testid="import-document">
      <h1 className="surface__title">{projectName}</h1>
      {error ? <p className="error-text">{formatUiError(error)}</p> : null}
      {templateDiagnostics && templateDiagnostics.length > 0 ? (
        <ul className="diagnostic-list" data-testid="template-diagnostics">
          {templateDiagnostics.map((d, i) => (
            <li key={`${d.requestedId}-${i}`}>
              {d.status}: {d.message}
            </li>
          ))}
        </ul>
      ) : null}
      {batchResult ? (
        <BatchImportSummary
          result={batchResult}
          {...(onDismissBatch ? { onDismiss: onDismissBatch } : {})}
        />
      ) : null}
      <button
        type="button"
        className="btn btn--primary"
        disabled={busy}
        onClick={onImport}
      >
        {pending ? "Importing" : "Choose files"}
      </button>
    </section>
  );
}
