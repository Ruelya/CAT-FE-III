import type {
  Document,
  ProjectSnapshot,
  QaIssue,
  Segment,
} from "@translunar/contracts";
import { ArrowLeft, FileText } from "lucide-react";

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
    <header className="surface-masthead" role="banner">
      <button
        type="button"
        className="surface-masthead__back"
        onClick={() => onNavigate("workbench")}
        aria-label={t("nav.backToWorkbench")}
        title={t("nav.backToWorkbench")}
      >
        <ArrowLeft size={15} />
      </button>
      <div className="surface-masthead__identity brand-plate">
        <div className="surface-masthead__name">{snapshot.project.name}</div>
        <div className="surface-masthead__meta micro">{pageTitle}</div>
      </div>
      <div className="surface-masthead__title">{pageTitle}</div>
      <div className="surface-masthead__doc">
        <FileText size={14} aria-hidden="true" />
        <span>{document.name}</span>
      </div>
    </header>
  );
}
