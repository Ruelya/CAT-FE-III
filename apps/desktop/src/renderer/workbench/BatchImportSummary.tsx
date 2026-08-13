import type { ProjectBatchImportResult } from "@translunar/contracts";

export interface BatchImportSummaryProps {
  result: ProjectBatchImportResult;
  onDismiss?: () => void;
}

export function BatchImportSummary({
  result,
  onDismiss,
}: BatchImportSummaryProps) {
  return (
    <div
      className="batch-import-summary"
      data-testid="batch-import-summary"
      role="region"
      aria-label="Import results"
    >
      <div className="batch-import-summary__head">
        <strong>
          Import {result.succeeded} succeeded, {result.failed} failed
        </strong>
        {onDismiss ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        ) : null}
      </div>
      <ul className="batch-import-summary__list">
        {result.items.map((item, index) => (
          <li key={`${item.path}-${index}`}>
            <span className="batch-import-summary__status">{item.status}</span>
            <span>{item.relativePath || item.path}</span>
            {item.message ? (
              <span className="muted">{item.message}</span>
            ) : null}
            {item.document?.name ? (
              <span className="muted"> · {item.document.name}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
