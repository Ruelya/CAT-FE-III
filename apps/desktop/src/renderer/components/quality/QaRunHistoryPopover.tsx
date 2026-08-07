import { useId, useState } from "react";
import type { QaRun } from "@translunar/contracts";
import { History } from "lucide-react";

export interface QaRunHistoryPopoverProps {
  runs: readonly QaRun[];
  formatDate(ms: number): string;
  labels: {
    trigger: string;
    title: string;
    empty: string;
    errors: string;
    warnings: string;
    info: string;
    checked: string;
  };
}

export function QaRunHistoryPopover({
  runs,
  formatDate,
  labels,
}: QaRunHistoryPopoverProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="qa-run-history">
      <button
        type="button"
        className="qa-run-history__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <History size={14} aria-hidden="true" />
        {labels.trigger}
      </button>
      {open ? (
        <div
          id={panelId}
          className="qa-run-history__panel"
          role="dialog"
          aria-label={labels.title}
        >
          <header>
            <strong>{labels.title}</strong>
            <button type="button" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          {runs.length ? (
            <ul>
              {runs.map((run) => (
                <li key={run.id}>
                  <div>
                    <strong>{run.profileName}</strong>
                    <time dateTime={new Date(run.createdAtMs).toISOString()}>
                      {formatDate(run.createdAtMs)}
                    </time>
                  </div>
                  <span className="num">
                    {labels.checked.replace(
                      "{count}",
                      String(run.checkedSegments),
                    )}{" "}
                    · {labels.errors} {run.errors} · {labels.warnings}{" "}
                    {run.warnings} · {labels.info} {run.info}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{labels.empty}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
