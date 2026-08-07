import type {
  Document,
  ProjectSnapshot,
  QaIssue,
  Segment,
} from "@translunar/contracts";
import { ArrowLeft, FileText } from "lucide-react";

import { BrandMark } from "./BrandMark";
import { AiControlPage } from "./AiControlPage";
import { ExportReviewPage as ComprehensiveExportReviewPage } from "./ExportReviewPage";
import { QaReviewPage as ComprehensiveQaReviewPage } from "./QaReviewPage";
import { ProjectInsightsPage } from "./ProjectInsightsPage";
import { AssetsSurface } from "./components/assets/AssetsSurface";
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
      {surface === "translation-memory" ? null : <SurfaceHeader {...props} />}
      {surface === "qa-review" ? (
        <ComprehensiveQaReviewPage {...props} />
      ) : null}
      {surface === "export-review" ? (
        <ComprehensiveExportReviewPage {...props} />
      ) : null}
      {surface === "translation-memory" ? (
        <AssetsSurface
          snapshot={props.snapshot}
          document={props.document}
          onRefresh={props.onRefresh}
        />
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
