import type { QaGateResult } from "@translunar/contracts";
import { CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";

export interface ExportGateBannerProps {
  gate: QaGateResult | null;
  loading: boolean;
  busy: boolean;
  labels: {
    blocked: string;
    clear: string;
    blockedBody: string;
    clearBody: string;
    viewIssues: string;
    recheck: string;
    checking: string;
  };
  onViewIssues(): void;
  onRecheck(): void;
}

export function ExportGateBanner({
  gate,
  loading,
  busy,
  labels,
  onViewIssues,
  onRecheck,
}: ExportGateBannerProps) {
  const blocked = gate ? !gate.clear : false;
  const state = loading ? "loading" : gate?.clear ? "clear" : "blocked";

  return (
    <section
      className="export-banner"
      data-state={state}
      role="status"
      aria-live="polite"
    >
      <div className="export-banner__icon" aria-hidden="true">
        {gate?.clear ? <CheckCircle2 size={22} /> : <ShieldAlert size={22} />}
      </div>
      <div className="export-banner__body">
        <strong>
          {loading
            ? labels.checking
            : gate?.clear
              ? labels.clear
              : labels.blocked}
        </strong>
        <p>
          {loading
            ? labels.checking
            : gate?.clear
              ? labels.clearBody
              : labels.blockedBody.replace(
                  "{count}",
                  String(gate?.errorCount ?? 0),
                )}
        </p>
      </div>
      <div className="export-banner__actions">
        {blocked ? (
          <button
            type="button"
            className="button secondary"
            onClick={onViewIssues}
          >
            {labels.viewIssues}
          </button>
        ) : null}
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onRecheck}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {labels.recheck}
        </button>
      </div>
    </section>
  );
}
