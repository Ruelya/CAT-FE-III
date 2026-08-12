import { FileArrowDown } from "@phosphor-icons/react";
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
    <section className="welcome" data-testid="import-document">
      <div className="welcome__inner welcome__inner--first-run">
        <h1 className="welcome__title">{projectName}</h1>

        {error ? (
          <p className="error-text" role="alert">
            {formatUiError(error)}
          </p>
        ) : null}

        {templateDiagnostics && templateDiagnostics.length > 0 ? (
          <ul className="diagnostic-list" data-testid="template-diagnostics">
            {templateDiagnostics.map((d, i) => (
              <li key={`${d.requestedId}-${i}`}>
                <span className="chip chip--warning">{d.status}</span>{" "}
                {d.message}
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

        <div className="welcome__actions">
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={busy}
            data-pending={pending ? "true" : undefined}
            onClick={onImport}
          >
            <FileArrowDown size={18} weight="bold" aria-hidden="true" />
            {pending ? "Importing" : "Choose files"}
          </button>
        </div>
      </div>
    </section>
  );
}
