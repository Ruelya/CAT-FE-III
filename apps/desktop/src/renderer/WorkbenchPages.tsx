import { useEffect, useMemo, useState } from "react";
import type {
  Document,
  ProjectSnapshot,
  QaIssue,
  Segment,
  TmEntry,
} from "@translunar/contracts";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FileText,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";

import { BrandMark } from "./BrandMark";
import { fileName, formatError } from "./workbench-utils";
import type { AppSurface } from "./surface-types";

interface WorkspacePageProps {
  surface: Exclude<AppSurface, "workbench">;
  snapshot: ProjectSnapshot;
  document: Document;
  segments: Segment[];
  issues: QaIssue[];
  onNavigate(surface: AppSurface): void;
  onRefresh(): Promise<void>;
  onOpenSegment(segmentId: string): void;
}

export function WorkspacePage(props: WorkspacePageProps) {
  const { surface } = props;
  return (
    <div className="surface-shell">
      <SurfaceHeader {...props} />
      <div className="translunar-band" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      {surface === "qa-review" ? <QaReviewPage {...props} /> : null}
      {surface === "export-review" ? <ExportReviewPage {...props} /> : null}
      {surface === "translation-memory" ? (
        <TranslationMemoryPage {...props} />
      ) : null}
    </div>
  );
}

function SurfaceHeader({
  surface,
  snapshot,
  document,
  onNavigate,
}: WorkspacePageProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pageTitle =
    surface === "qa-review"
      ? "QA review"
      : surface === "export-review"
        ? "Export review"
        : "Translation memory";
  return (
    <header className="app-bar surface-header">
      <button
        type="button"
        className="surface-back"
        onClick={() => onNavigate("workbench")}
        aria-label="Back to workbench"
        title="Back to workbench"
      >
        <ArrowLeft size={15} />
      </button>
      <div className="project-identity">
        <BrandMark />
        <div>
          <strong>{snapshot.project.name}</strong>
          <span>{pageTitle}</span>
        </div>
      </div>
      <div className="surface-page-title">{pageTitle}</div>
      <div className="surface-document">
        <FileText size={14} />
        <span>{document.name}</span>
      </div>
      <div className="surface-actions">
        <div className="surface-menu-wrap">
          <button
            type="button"
            className="icon-button dark"
            aria-label="More actions"
            aria-expanded={menuOpen}
            title="More actions"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={17} />
          </button>
          {menuOpen ? (
            <nav className="surface-menu" aria-label="Application views">
              <span>Views</span>
              <button type="button" onClick={() => onNavigate("workbench")}>
                Workbench
              </button>
              <button
                type="button"
                disabled={surface === "qa-review"}
                aria-current={surface === "qa-review" ? "page" : undefined}
                onClick={() => onNavigate("qa-review")}
              >
                QA review
              </button>
              <button
                type="button"
                disabled={surface === "export-review"}
                aria-current={surface === "export-review" ? "page" : undefined}
                onClick={() => onNavigate("export-review")}
              >
                Export review
              </button>
              <button
                type="button"
                disabled={surface === "translation-memory"}
                aria-current={
                  surface === "translation-memory" ? "page" : undefined
                }
                onClick={() => onNavigate("translation-memory")}
              >
                Translation memory
              </button>
            </nav>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function QaReviewPage({
  snapshot,
  document,
  segments,
  issues,
  onRefresh,
  onOpenSegment,
}: WorkspacePageProps) {
  const openIssues = issues.filter((issue) => issue.status === "open");
  const segmentById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment])),
    [segments],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runQa = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.translunar.invoke("qa.runDocument", {
        documentId: document.id,
      });
      await onRefresh();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="surface-main qa-surface">
      <section className="surface-intro">
        <span className="surface-kicker">Quality review</span>
        <h1>Check the current document</h1>
        <p>
          {openIssues.length} open issues · {document.name}
        </p>
        <div className="surface-intro-actions">
          <button
            type="button"
            className="button primary"
            onClick={runQa}
            disabled={busy}
          >
            <RefreshCw size={15} className={busy ? "spin" : undefined} />
            {busy ? "Running QA" : "Run QA"}
          </button>
        </div>
        {error ? <p className="surface-error">{error}</p> : null}
      </section>
      <section className="surface-list" aria-label="Open QA issues">
        <header className="surface-list-header">
          <div>
            <span className="surface-kicker">{document.name}</span>
            <h2>{openIssues.length} open issues</h2>
          </div>
          <span className="surface-count">
            {snapshot.counts.openIssues} total
          </span>
        </header>
        {openIssues.length ? (
          openIssues.map((issue) => {
            const segment = segmentById.get(issue.segmentId);
            return (
              <article className="surface-issue" key={issue.id}>
                <div className="surface-issue-mark">
                  <ShieldAlert size={16} />
                </div>
                <div className="surface-issue-copy">
                  <div className="surface-issue-heading">
                    <strong>{issue.ruleId}</strong>
                    <span>{issue.severity}</span>
                    <code>Segment {segment ? segment.ordinal + 1 : "—"}</code>
                  </div>
                  <p>{issue.message}</p>
                  <div className="surface-evidence">
                    <span>
                      Source{" "}
                      <b>{issue.evidence.sourceNumbers.join(", ") || "—"}</b>
                    </span>
                    <span>
                      Target{" "}
                      <b>{issue.evidence.targetNumbers.join(", ") || "—"}</b>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onOpenSegment(issue.segmentId)}
                >
                  Go to segment
                  <ArrowRight size={14} />
                </button>
              </article>
            );
          })
        ) : (
          <div className="surface-empty">
            <CheckCircle2 size={24} />
            <strong>No open QA issues</strong>
            <span>The current QA result has no open findings.</span>
          </div>
        )}
      </section>
    </main>
  );
}

function ExportReviewPage({ snapshot, document, issues }: WorkspacePageProps) {
  const openIssues = issues.filter((issue) => issue.status === "open");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportDocument = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const suggestedName = document.name.replace(
        /\.docx$/iu,
        "-translated.docx",
      );
      const outputPath =
        await window.translunar.selectExportPath(suggestedName);
      if (!outputPath) return;
      const result = await window.translunar.invoke("document.exportDocx", {
        documentId: document.id,
        outputPath,
      });
      setMessage(
        `Exported ${result.translatedSegments} translated segments to ${fileName(result.outputPath)}.`,
      );
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="surface-main export-surface">
      <section className="surface-intro">
        <span className="surface-kicker">Delivery check</span>
        <h1>Review before export</h1>
        <p>
          {snapshot.counts.confirmed} confirmed · {openIssues.length} open QA
          issues
        </p>
        <div className="surface-intro-actions">
          <button
            type="button"
            className="button primary"
            onClick={exportDocument}
            disabled={busy}
          >
            <Download size={15} />
            {busy ? "Preparing export" : "Export DOCX"}
          </button>
        </div>
        {message ? <p className="surface-success">{message}</p> : null}
        {error ? <p className="surface-error">{error}</p> : null}
      </section>
      <section className="export-summary" aria-label="Export summary">
        <div className="export-summary-heading">
          <FileText size={18} />
          <div>
            <span className="surface-kicker">Source package</span>
            <h2>{document.name}</h2>
          </div>
        </div>
        <dl>
          <div>
            <dt>Segments</dt>
            <dd>{document.segmentCount.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Confirmed</dt>
            <dd>{snapshot.counts.confirmed.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Untranslated</dt>
            <dd>{snapshot.counts.untranslated.toLocaleString("en-US")}</dd>
          </div>
          <div className={openIssues.length ? "has-issues" : undefined}>
            <dt>Open QA issues</dt>
            <dd>{openIssues.length.toLocaleString("en-US")}</dd>
          </div>
        </dl>
        <p className="export-note">
          {openIssues.length
            ? `Export available with ${openIssues.length} open QA issues.`
            : "No open QA issues."}
        </p>
      </section>
    </main>
  );
}

function TranslationMemoryPage({
  snapshot,
  document,
  segments,
}: WorkspacePageProps) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<TmEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeSegment =
    segments.find((segment) => segment.targetText.trim()) ?? segments[0];

  useEffect(() => {
    if (!activeSegment) {
      setMatches([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void window.translunar
        .invoke("tm.lookupExact", {
          projectId: snapshot.project.id,
          sourceText: query.trim() || activeSegment.sourceText,
        })
        .then((result) => {
          if (!cancelled) setMatches(result.matches);
        })
        .catch((reason: unknown) => {
          if (!cancelled) {
            setMatches([]);
            setError(formatError(reason));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeSegment, query, snapshot.project.id]);

  return (
    <main className="surface-main tm-surface">
      <section className="surface-intro">
        <span className="surface-kicker">Exact memory</span>
        <h1>Translation memory</h1>
        <p>
          {snapshot.project.name} · {document.name}
        </p>
      </section>
      <section
        className="tm-browser"
        aria-label="Exact translation memory"
        aria-busy={loading}
      >
        <header className="surface-list-header">
          <div>
            <span className="surface-kicker">{snapshot.project.name}</span>
            <h2>Active-source lookup</h2>
          </div>
          <Database size={20} />
        </header>
        <label className="tm-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={activeSegment?.sourceText ?? "Search exact source"}
            aria-label="Search exact source"
          />
        </label>
        {error ? (
          <div className="surface-empty" role="alert">
            <Database size={24} />
            <strong>Exact lookup failed</strong>
            <span>{error}</span>
          </div>
        ) : loading ? (
          <div className="surface-empty">Looking up exact matches...</div>
        ) : matches.length ? (
          <div className="tm-results">
            {matches.map((match) => (
              <article className="tm-entry" key={match.id}>
                <header>
                  <span>Confirmed</span>
                  <time>
                    {new Date(match.confirmedAtMs).toLocaleDateString("en-US")}
                  </time>
                </header>
                <p>{match.sourceText}</p>
                <p className="tm-target">{match.targetText}</p>
                <footer>
                  Segment {match.originSegmentId.slice(0, 8)} · {document.name}
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="surface-empty">
            <Database size={24} />
            <strong>No exact match</strong>
            <span>No confirmed entry has this exact source.</span>
          </div>
        )}
      </section>
    </main>
  );
}
