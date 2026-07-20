import { useCallback, useEffect, useState } from "react";
import type { QaGateResult, QaIssueView } from "@translunar/contracts";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import type { WorkspacePageProps } from "./WorkbenchPages";
import { fileName, formatError } from "./workbench-utils";

export function ExportReviewPage({
  snapshot,
  document,
  onOpenSegment,
}: WorkspacePageProps) {
  const projectId = snapshot.project.id;
  const [gate, setGate] = useState<QaGateResult | null>(null);
  const [blockers, setBlockers] = useState<QaIssueView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [actor, setActor] = useState("");
  const [reason, setReason] = useState("");

  const checkGate = useCallback(async () => {
    setError(null);
    try {
      const nextGate = await window.translunar.invoke("qa.gate.check", {
        projectId,
        documentId: document.id,
      });
      setGate(nextGate);
      if (nextGate.blockerIssueIds.length) {
        const page = await window.translunar.invoke("qa.issue.list", {
          projectId,
          documentId: document.id,
          severity: "error",
          disposition: "open",
          offset: 0,
          limit: 100,
        });
        const ids = new Set(nextGate.blockerIssueIds);
        setBlockers(page.items.filter((item) => ids.has(item.id)));
      } else setBlockers([]);
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setLoading(false);
    }
  }, [document.id, projectId]);

  useEffect(() => {
    void checkGate();
  }, [checkGate]);

  async function exportDocument() {
    if (
      !gate ||
      (gate.clear === false &&
        (!overrideEnabled || !actor.trim() || !reason.trim()))
    )
      return;
    const extension =
      document.name.match(/\.[^.]+$/u)?.[0] ?? `.${document.format}`;
    const base = document.name.slice(
      0,
      Math.max(0, document.name.length - extension.length),
    );
    const outputPath = await window.translunar.selectExportPath(
      `${base}-translated${extension}`,
    );
    if (!outputPath) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await window.translunar.invoke("document.export", {
        documentId: document.id,
        outputPath,
        ...(!gate.clear
          ? { qaOverride: { actor: actor.trim(), reason: reason.trim() } }
          : {}),
      });
      setSuccess(
        `Exported ${result.translatedSegments.toLocaleString("en-US")} translated segments to ${fileName(result.outputPath)}.`,
      );
      await checkGate();
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(false);
    }
  }

  const canExport = Boolean(
    gate && (gate.clear || (overrideEnabled && actor.trim() && reason.trim())),
  );

  return (
    <main
      className="surface-main export-review-workspace"
      aria-busy={loading || busy}
    >
      <section className="export-review-hero">
        <div>
          <span className="surface-kicker">Delivery gate</span>
          <h1>Export review</h1>
          <strong className="export-review-state-copy">
            {loading
              ? "Checking current translation"
              : gate?.clear
                ? "Ready for delivery"
                : "Publication blocked"}
          </strong>
          <p>
            Every export runs fresh QA against {document.name} before
            publication.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => void checkGate()}
        >
          <RefreshCw size={14} className={loading ? "spin" : undefined} />
          Check again
        </button>
      </section>
      {error ? (
        <p className="surface-error qa-banner" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="surface-success qa-banner" role="status">
          {success}
        </p>
      ) : null}
      <section
        className={`export-gate-panel ${gate?.clear ? "is-clear" : "is-blocked"}`}
      >
        <div className="export-gate-state">
          {gate?.clear ? <CheckCircle2 size={28} /> : <ShieldAlert size={28} />}
          <div>
            <span>
              {gate?.clear
                ? "QA gate clear"
                : `${gate?.errorCount ?? 0} blocking errors`}
            </span>
            <strong>
              {gate
                ? `${gate.warningCount} warnings · ${gate.infoCount} info · ${gate.waivedCount} waived`
                : "Awaiting authoritative result"}
            </strong>
          </div>
        </div>
        <dl>
          <div>
            <dt>Segments checked</dt>
            <dd>{gate?.run.checkedSegments ?? "—"}</dd>
          </div>
          <div>
            <dt>Profile</dt>
            <dd>{gate?.run.profileName ?? "—"}</dd>
          </div>
          <div>
            <dt>Run</dt>
            <dd>{gate?.run.id.slice(0, 8) ?? "—"}</dd>
          </div>
          <div>
            <dt>Original format</dt>
            <dd>{document.format.toUpperCase()}</dd>
          </div>
        </dl>
      </section>
      <section className="export-review-grid">
        <div className="export-blockers">
          <header>
            <div>
              <span className="surface-kicker">Blocking findings</span>
              <h2>
                {gate?.clear ? "No open errors" : "Resolve before delivery"}
              </h2>
            </div>
            <span>{blockers.length}</span>
          </header>
          {loading ? (
            <div className="qa-skeleton">
              <span />
              <span />
              <span />
            </div>
          ) : blockers.length ? (
            blockers.map((issue) => (
              <button
                type="button"
                key={issue.id}
                onClick={() => onOpenSegment(issue.segmentId)}
              >
                <AlertTriangle size={16} />
                <span>
                  <strong>{issue.message}</strong>
                  <small>
                    {issue.documentName} · Segment {issue.segmentOrdinal + 1} ·{" "}
                    {issue.ruleId}
                  </small>
                </span>
                <ExternalLink size={14} />
              </button>
            ))
          ) : (
            <div className="surface-empty">
              <FileCheck2 size={24} />
              <strong>Nothing blocks publication</strong>
              <span>
                Warnings and waived findings remain visible in the QA report.
              </span>
            </div>
          )}
        </div>
        <aside className="export-delivery-card">
          <span className="surface-kicker">Publication</span>
          <h2>{document.name}</h2>
          <p>
            The output is validated and never replaces an existing destination.
          </p>
          {!gate?.clear && gate ? (
            <div className="override-control">
              <label className="override-toggle">
                <input
                  aria-label="Override the QA delivery gate"
                  type="checkbox"
                  checked={overrideEnabled}
                  onChange={(event) =>
                    setOverrideEnabled(event.currentTarget.checked)
                  }
                />
                <span>
                  <strong>Override blocking QA</strong>
                  <small>
                    This decision is recorded with the export result.
                  </small>
                </span>
              </label>
              {overrideEnabled ? (
                <div className="override-fields">
                  <label>
                    Actor
                    <input
                      value={actor}
                      onChange={(event) => setActor(event.currentTarget.value)}
                      placeholder="Responsible person"
                    />
                  </label>
                  <label>
                    Reason
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.currentTarget.value)}
                      placeholder="Why delivery must proceed"
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="button primary export-submit"
            disabled={!canExport || busy}
            onClick={() => void exportDocument()}
          >
            <Download size={15} />
            {busy ? "Publishing…" : "Export document"}
          </button>
          {!gate?.clear && gate && !overrideEnabled ? (
            <p className="export-help">
              Open each blocker in the editor, or explicitly enable a reasoned
              override.
            </p>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
