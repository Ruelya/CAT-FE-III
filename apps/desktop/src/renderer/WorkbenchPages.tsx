import { useEffect, useState } from "react";
import type {
  Document,
  ProjectSnapshot,
  QaIssue,
  Segment,
  TmEntry,
} from "@translunar/contracts";
import {
  ArrowLeft,
  Database,
  FileText,
  MoreHorizontal,
  Search,
} from "lucide-react";

import { BrandMark } from "./BrandMark";
import { AiControlPage } from "./AiControlPage";
import { ExportReviewPage as ComprehensiveExportReviewPage } from "./ExportReviewPage";
import { QaReviewPage as ComprehensiveQaReviewPage } from "./QaReviewPage";
import { ProjectInsightsPage } from "./ProjectInsightsPage";
import { formatError } from "./workbench-utils";
import type { AppSurface } from "./surface-types";

export interface WorkspacePageProps {
  surface: Exclude<AppSurface, "workbench">;
  snapshot: ProjectSnapshot;
  document: Document;
  segments: Segment[];
  issues: QaIssue[];
  onNavigate(surface: AppSurface): void;
  onRefresh(): Promise<void>;
  onOpenSegment(segmentId: string): void;
  onOpenDocument(documentId: string): Promise<void>;
  onReturnHome(): void;
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
      {surface === "qa-review" ? (
        <ComprehensiveQaReviewPage {...props} />
      ) : null}
      {surface === "export-review" ? (
        <ComprehensiveExportReviewPage {...props} />
      ) : null}
      {surface === "translation-memory" ? (
        <TranslationMemoryPage {...props} />
      ) : null}
      {surface === "ai-control" ? <AiControlPage {...props} /> : null}
      {surface === "project-insights" ? (
        <ProjectInsightsPage
          snapshot={props.snapshot}
          document={props.document}
          onRefresh={props.onRefresh}
          onOpenDocument={props.onOpenDocument}
          onReturnHome={props.onReturnHome}
        />
      ) : null}
    </div>
  );
}

function SurfaceHeader({
  surface,
  snapshot,
  document,
  onNavigate,
  onReturnHome,
}: WorkspacePageProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pageTitle =
    surface === "qa-review"
      ? "QA review"
      : surface === "export-review"
        ? "Export review"
        : surface === "translation-memory"
          ? "Translation memory"
          : surface === "ai-control"
            ? "AI control"
            : "Project insights";
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
              <button
                type="button"
                disabled={surface === "ai-control"}
                aria-current={surface === "ai-control" ? "page" : undefined}
                onClick={() => onNavigate("ai-control")}
              >
                AI control
              </button>
              <button
                type="button"
                disabled={surface === "project-insights"}
                aria-current={
                  surface === "project-insights" ? "page" : undefined
                }
                onClick={() => onNavigate("project-insights")}
              >
                Project insights
              </button>
              <hr />
              <button type="button" onClick={onReturnHome}>
                Projects
              </button>
            </nav>
          ) : null}
        </div>
      </div>
    </header>
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
