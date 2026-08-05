import { useEffect, useState } from "react";
import type {
  Document,
  ProjectSnapshot,
  QaIssue,
  Segment,
  TmEntry,
} from "@translunar/contracts";
import { ArrowLeft, Database, FileText, Search } from "lucide-react";

import { BrandMark } from "./BrandMark";
import { AiControlPage } from "./AiControlPage";
import { ExportReviewPage as ComprehensiveExportReviewPage } from "./ExportReviewPage";
import { QaReviewPage as ComprehensiveQaReviewPage } from "./QaReviewPage";
import { ProjectInsightsPage } from "./ProjectInsightsPage";
import { formatError } from "./workbench-utils";
import type { AppSurface } from "./surface-types";
import { useLocale } from "./i18n/LocaleProvider";

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
  onOpenProject(projectId: string, documentId?: string): Promise<void>;
  onReturnHome(): void;
  onOpenSettings(): void;
}

export function WorkspacePage(props: WorkspacePageProps) {
  const { surface } = props;
  return (
    <div className="surface-shell">
      <SurfaceHeader {...props} />
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
          onOpenProject={props.onOpenProject}
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
}: WorkspacePageProps) {
  const { t } = useLocale();
  const pageTitle =
    surface === "qa-review"
      ? t("nav.qaReview")
      : surface === "export-review"
        ? t("nav.exportReview")
        : surface === "translation-memory"
          ? t("tm.title")
          : surface === "ai-control"
            ? t("nav.aiControl")
            : t("nav.projectInsights");
  return (
    <header className="app-bar surface-header">
      <button
        type="button"
        className="surface-back"
        onClick={() => onNavigate("workbench")}
        aria-label={t("nav.backToWorkbench")}
        title={t("nav.backToWorkbench")}
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
    </header>
  );
}

function TranslationMemoryPage({
  snapshot,
  document,
  segments,
}: WorkspacePageProps) {
  const { t } = useLocale();
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
        <span className="surface-kicker">{t("tm.exactKicker")}</span>
        <h1>{t("tm.title")}</h1>
        <p>
          {snapshot.project.name} · {document.name}
        </p>
      </section>
      <section
        className="tm-browser"
        aria-label={t("tm.exactAria")}
        aria-busy={loading}
      >
        <header className="surface-list-header">
          <div>
            <span className="surface-kicker">{snapshot.project.name}</span>
            <h2>{t("tm.activeLookup")}</h2>
          </div>
          <Database size={20} />
        </header>
        <label className="tm-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={
              activeSegment?.sourceText ?? t("tm.searchExactPlaceholder")
            }
            aria-label={t("tm.searchAria")}
          />
        </label>
        {error ? (
          <div className="surface-empty" role="alert">
            <Database size={24} />
            <strong>{t("tm.lookupFailed")}</strong>
            <span>{error}</span>
          </div>
        ) : loading ? (
          <div className="surface-empty">{t("tm.lookingUpDots")}</div>
        ) : matches.length ? (
          <div className="tm-results">
            {matches.map((match) => (
              <article className="tm-entry" key={match.id}>
                <header>
                  <span>{t("common.confirmed")}</span>
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
            <strong>{t("tm.noExactMatch")}</strong>
            <span>{t("tm.noExactBody")}</span>
          </div>
        )}
      </section>
    </main>
  );
}
