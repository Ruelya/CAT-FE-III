import {
  useCallback,
  useEffect,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import type {
  AnalysisProfile,
  AnalysisRunResult,
  BatchImportDiagnostic,
  Document,
  DocumentReimportPreviewResult,
  Operation,
  OptionalCountMetric,
  ProjectAnalyticsSummary,
  ProjectSnapshot,
} from "@translunar/contracts";
import {
  Archive,
  ArrowRight,
  BarChart3,
  Check,
  Clock3,
  Database,
  Puzzle,
  FileClock,
  FilePlus2,
  FileText,
  FolderOpen,
  GitCompareArrows,
  History,
  Languages,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { fileName, formatError } from "./workbench-utils";
import { AlignmentCorpusPanel } from "./AlignmentCorpusPanel";
import { AssetCurationPanel } from "./AssetCurationPanel";
import { PluginsPanel } from "./PluginsPanel";
import { DiscussionSnapshotPanel } from "./DiscussionSnapshotPanel";
import { InteropPanel } from "./InteropPanel";
import { TaskPackagePanel } from "./TaskPackagePanel";
import { useLocale } from "./i18n/LocaleProvider";
import type { FormatVars, MessageKey } from "./i18n/messages";

type InsightsTab =
  | "overview"
  | "files"
  | "reimport"
  | "discussions"
  | "alignment"
  | "assets"
  | "plugins"
  | "interop"
  | "task-packages"
  | "archive"
  | "history"
  | "analysis";

interface ProjectInsightsPageProps {
  snapshot: ProjectSnapshot;
  document: Document;
  onRefresh(): Promise<void>;
  onOpenDocument(documentId: string): Promise<void>;
  onOpenProject(projectId: string, documentId?: string): Promise<void>;
  onReturnHome(): void;
}

interface PendingAction {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  run(): Promise<void>;
}

const TABS: Array<{
  id: InsightsTab;
  labelKey: MessageKey;
  icon: ReactNode;
}> = [
  {
    id: "overview",
    labelKey: "insights.tabOverview",
    icon: <BarChart3 size={15} />,
  },
  { id: "files", labelKey: "insights.tabFiles", icon: <FileText size={15} /> },
  {
    id: "reimport",
    labelKey: "insights.tabReimport",
    icon: <RotateCcw size={15} />,
  },
  {
    id: "discussions",
    labelKey: "insights.discussionsTab",
    icon: <MessageSquareText size={15} />,
  },
  {
    id: "alignment",
    labelKey: "insights.alignmentTab",
    icon: <GitCompareArrows size={15} />,
  },
  {
    id: "assets",
    labelKey: "insights.tabAssets",
    icon: <Database size={15} />,
  },
  {
    id: "plugins",
    labelKey: "insights.tabPlugins",
    icon: <Puzzle size={15} />,
  },
  {
    id: "interop",
    labelKey: "insights.tabInterop",
    icon: <Languages size={15} />,
  },
  {
    id: "task-packages",
    labelKey: "insights.taskTab",
    icon: <Archive size={15} />,
  },
  {
    id: "archive",
    labelKey: "insights.tabArchive",
    icon: <Archive size={15} />,
  },
  { id: "history", labelKey: "insights.history", icon: <History size={15} /> },
  {
    id: "analysis",
    labelKey: "insights.tabAnalysis",
    icon: <FileClock size={15} />,
  },
];

export function ProjectInsightsPage({
  snapshot,
  document,
  onRefresh,
  onOpenDocument,
  onOpenProject,
  onReturnHome,
}: ProjectInsightsPageProps) {
  const { t } = useLocale();

  const projectId = snapshot.project.id;
  const [tab, setTab] = useState<InsightsTab>("overview");
  const [documents, setDocuments] = useState(snapshot.documents);
  const [analytics, setAnalytics] = useState<ProjectAnalyticsSummary | null>(
    null,
  );
  const [operations, setOperations] = useState<Operation[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [profiles, setProfiles] = useState<AnalysisProfile[]>([]);
  const [profileId, setProfileId] = useState(
    snapshot.project.configuration.analysisProfileId ??
      "builtin.analysis.standard",
  );
  const [analysis, setAnalysis] = useState<AnalysisRunResult | null>(null);
  const [batchDiagnostics, setBatchDiagnostics] = useState<
    BatchImportDiagnostic[]
  >([]);
  const [replacementPath, setReplacementPath] = useState("");
  const [reimportPreview, setReimportPreview] =
    useState<DocumentReimportPreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [documentPage, analyticsResult, historyPage, profilePage] =
        await Promise.all([
          window.translunar.invoke("document.list", {
            projectId,
            offset: 0,
            limit: 500,
          }),
          window.translunar.invoke("project.analytics.get", {
            projectId,
            trendBucketCount: 12,
          }),
          window.translunar.invoke("history.list", {
            projectId,
            descending: true,
            offset: 0,
            limit: 100,
          }),
          window.translunar.invoke("analysis.profile.list", {}),
        ]);
      setDocuments(documentPage.items);
      setAnalytics(analyticsResult);
      setOperations(historyPage.items);
      setHistoryTotal(historyPage.total);
      setProfiles(profilePage.items);
      setProfileId((current) => {
        if (profilePage.items.some((profile) => profile.id === current)) {
          return current;
        }
        return profilePage.items[0]?.id ?? current;
      });
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setDocuments(snapshot.documents);
  }, [snapshot.documents]);

  useEffect(() => {
    setReplacementPath("");
    setReimportPreview(null);
  }, [document.id]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(null);
    }
  };

  const refreshAfterMutation = async () => {
    await Promise.all([onRefresh(), loadData()]);
  };

  const importPaths = async (paths: readonly string[]) => {
    const items = [...new Set(paths.filter(Boolean))]
      .slice(0, 500)
      .map((path) => ({ path }));
    if (!items.length) return;
    await runAction("batch-import", async () => {
      const result = await window.translunar.invoke("project.batchImport", {
        projectId,
        items,
        options: {},
        atomicity: "bestEffort",
      });
      setBatchDiagnostics(result.items);
      setNotice(
        t("insights.batchFinished", {
          succeeded: result.succeeded,
          failed: result.failed,
        }),
      );
      await refreshAfterMutation();
    });
  };

  const chooseFiles = async () => {
    setError(null);
    try {
      await importPaths(await window.translunar.selectSourceDocuments());
    } catch (reason) {
      setError(formatError(reason));
    }
  };

  const chooseFolder = async () => {
    setError(null);
    try {
      const path = await window.translunar.selectSourceFolder();
      if (path) await importPaths([path]);
    } catch (reason) {
      setError(formatError(reason));
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      void importPaths(
        window.translunar.resolveDroppedPaths([...event.dataTransfer.files]),
      );
    } catch (reason) {
      setError(formatError(reason));
    }
  };

  const requestRecycleDocument = (item: Document) => {
    setPendingAction({
      title: t("insights.recycleDocument"),
      description: t("insights.recycleDocumentDescription", {
        name: item.relativePath,
      }),
      confirmLabel: t("insights.recycleDocument"),
      danger: true,
      run: async () => {
        await window.translunar.invoke("recycle.delete", {
          entityType: "document",
          entityId: item.id,
          expectedRevision: item.revision,
          actor: "desktop-user",
          reason: "Removed from project files",
        });
        const remaining = await window.translunar.invoke("document.list", {
          projectId,
          offset: 0,
          limit: 500,
        });
        if (item.id === document.id) {
          const next = remaining.items[0];
          if (next) {
            await refreshAfterMutation();
            setNotice(t("insights.movedToRecycle", { name: item.name }));
          } else {
            onReturnHome();
          }
          return;
        }
        await refreshAfterMutation();
        setNotice(t("insights.movedToRecycle", { name: item.name }));
      },
    });
  };

  const requestRecycleProject = () => {
    setPendingAction({
      title: t("insights.recycleProject"),
      description: t("insights.recycleProjectDescription", {
        name: snapshot.project.name,
      }),
      confirmLabel: t("insights.recycleProject"),
      danger: true,
      run: async () => {
        await window.translunar.invoke("recycle.delete", {
          entityType: "project",
          entityId: projectId,
          expectedRevision: snapshot.project.revision,
          actor: "desktop-user",
          reason: "Removed from project insights",
        });
        onReturnHome();
      },
    });
  };

  const confirmPending = async () => {
    const action = pendingAction;
    if (!action) return;
    await runAction("confirm", async () => {
      await action.run();
      setPendingAction(null);
    });
  };

  const chooseReplacement = async () => {
    setError(null);
    try {
      const path = await window.translunar.selectSourceDocument();
      if (!path) return;
      setReplacementPath(path);
      setReimportPreview(null);
    } catch (reason) {
      setError(formatError(reason));
    }
  };

  const previewReimport = async () => {
    if (!replacementPath) return;
    await runAction("reimport-preview", async () => {
      const preview = await window.translunar.invoke(
        "document.reimport.preview",
        {
          documentId: document.id,
          sourcePath: replacementPath,
          options: {},
          expectedRevision: document.revision,
          actor: "desktop-user",
        },
      );
      setReimportPreview(preview);
      setNotice(t("insights.reimportPreviewReady"));
    });
  };

  const requestApplyReimport = () => {
    if (!reimportPreview) return;
    setPendingAction({
      title: t("insights.applyReimport"),
      description: t("insights.applyReimportDescription", {
        name: document.name,
      }),
      confirmLabel: t("insights.applyPreview"),
      run: async () => {
        await window.translunar.invoke("document.reimport.apply", {
          previewId: reimportPreview.previewId,
          expectedDocumentRevision: reimportPreview.expectedDocumentRevision,
          actor: "desktop-user",
        });
        setReimportPreview(null);
        setReplacementPath("");
        await refreshAfterMutation();
        setNotice(t("insights.reimported", { name: document.name }));
      },
    });
  };

  const exportArchive = async () => {
    const suggestedName = `${safeArchiveName(snapshot.project.name)}.tlcat`;
    setError(null);
    try {
      const destinationPath =
        await window.translunar.selectProjectArchiveDestination(suggestedName);
      if (!destinationPath) return;
      await runAction("archive-export", async () => {
        const result = await window.translunar.invoke(
          "project.archive.export",
          {
            projectId,
            destinationPath,
            actor: "desktop-user",
          },
        );
        setNotice(
          result.diagnostics.length
            ? t("insights.archiveExportedDiag", {
                detail: result.diagnostics.join(" "),
              })
            : t("insights.archiveExported", {
                name: fileName(result.archivePath),
              }),
        );
        await loadData();
      });
    } catch (reason) {
      setError(formatError(reason));
    }
  };

  const openDocument = async (documentId: string) => {
    await runAction("open-document", async () => {
      await onOpenDocument(documentId);
    });
  };

  const runAnalysis = async () => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;
    await runAction("analysis-run", async () => {
      const created = await window.translunar.invoke("analysis.run", {
        projectId,
        documentId: null,
        profileId: profile.id,
        profileRevision: profile.revision,
      });
      const result = await window.translunar.invoke("analysis.run.get", {
        runId: created.id,
      });
      setAnalysis(result);
      setNotice(
        result.stale ? t("insights.analysisStale") : t("insights.analysisDone"),
      );
      await loadData();
    });
  };

  return (
    <main className="project-insights-main" aria-busy={loading || !!busy}>
      <header className="project-insights-heading">
        <div>
          <span className="surface-kicker">{t("insights.kicker")}</span>
          <h1>{t("insights.title")}</h1>
          <p>
            {documents.length} files · {snapshot.project.sourceLocale} to{" "}
            {snapshot.project.targetLocale}
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          title={t("insights.refresh")}
          aria-label={t("insights.refresh")}
          onClick={() => void loadData()}
          disabled={loading || !!busy}
        >
          <RefreshCw size={15} />
        </button>
      </header>

      <nav className="project-insights-tabs" aria-label={t("insights.title")}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            <span>{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>

      <div className="project-insights-feedback">
        {error ? (
          <p className="surface-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="surface-success" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <section className="project-insights-content">
        {loading ? (
          <div className="project-insights-loading" role="status">
            <LoaderCircle className="spin" size={18} /> {t("insights.loading")}
          </div>
        ) : tab === "overview" ? (
          <OverviewPanel analytics={analytics} documents={documents} />
        ) : tab === "files" ? (
          <FilesPanel
            documents={documents}
            activeDocumentId={document.id}
            analytics={analytics}
            busy={!!busy}
            diagnostics={batchDiagnostics}
            onChooseFiles={() => void chooseFiles()}
            onChooseFolder={() => void chooseFolder()}
            onDrop={handleDrop}
            onOpen={(documentId) => void openDocument(documentId)}
            onRecycle={requestRecycleDocument}
          />
        ) : tab === "reimport" ? (
          <ReimportPanel
            document={document}
            replacementPath={replacementPath}
            preview={reimportPreview}
            busy={!!busy}
            onChoose={() => void chooseReplacement()}
            onPreview={() => void previewReimport()}
            onApply={requestApplyReimport}
          />
        ) : tab === "discussions" ? (
          <DiscussionSnapshotPanel
            snapshot={snapshot}
            document={document}
            documents={documents}
            onRefresh={onRefresh}
          />
        ) : tab === "alignment" ? (
          <AlignmentCorpusPanel
            snapshot={snapshot}
            documents={documents}
            onRefresh={onRefresh}
          />
        ) : tab === "assets" ? (
          <AssetCurationPanel snapshot={snapshot} onRefresh={onRefresh} />
        ) : tab === "plugins" ? (
          <PluginsPanel projectId={snapshot.project.id} onRefresh={onRefresh} />
        ) : tab === "interop" ? (
          <InteropPanel
            snapshot={snapshot}
            document={document}
            onRefresh={onRefresh}
          />
        ) : tab === "task-packages" ? (
          <TaskPackagePanel
            snapshot={snapshot}
            document={document}
            documents={documents}
            onRefresh={onRefresh}
            onOpenProject={onOpenProject}
          />
        ) : tab === "archive" ? (
          <ArchivePanel
            projectName={snapshot.project.name}
            busy={!!busy}
            onExport={() => void exportArchive()}
            onRecycle={requestRecycleProject}
          />
        ) : tab === "history" ? (
          <HistoryPanel operations={operations} total={historyTotal} />
        ) : (
          <AnalysisPanel
            profiles={profiles}
            profileId={profileId}
            result={analysis}
            busy={!!busy}
            onProfile={setProfileId}
            onRun={() => void runAnalysis()}
          />
        )}
      </section>

      {pendingAction ? (
        <ActionDialog
          action={pendingAction}
          busy={!!busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmPending()}
        />
      ) : null}
    </main>
  );
}

function OverviewPanel({
  analytics,
  documents,
}: {
  analytics: ProjectAnalyticsSummary | null;
  documents: Document[];
}) {
  const { t, formatNumber, formatDate } = useLocale();
  if (!analytics) {
    return <UnavailableState label={t("insights.analyticsUnavailable")} />;
  }
  return (
    <div className="insights-overview">
      <section
        className="insights-metric-strip"
        aria-label={t("insights.progressAria")}
      >
        <Metric
          label={t("insights.completionAria")}
          value={formatBasisPoints(
            analytics.progress.completionBasisPoints,
            formatNumber,
            t,
          )}
        />
        <Metric
          label={t("common.segments")}
          value={analytics.progress.totalSegments}
        />
        <Metric
          label={t("common.confirmed")}
          value={analytics.progress.confirmedSegments}
        />
        <Metric
          label={t("insights.qaBlockers")}
          value={analytics.progress.qaBlockers}
        />
        <Metric
          label={t("common.documents")}
          value={formatNumber(documents.length)}
        />
      </section>

      <div className="insights-overview-grid">
        <section className="insights-section">
          <SectionHeading
            eyebrow={t("common.workflow")}
            title={t("insights.progressAria")}
            icon={<BarChart3 size={18} />}
          />
          <progress
            value={analytics.progress.completionBasisPoints}
            max={10_000}
            aria-label={t("insights.completionAria")}
          />
          <dl className="insights-definition-grid">
            <Definition
              label={t("insights.untranslated")}
              value={analytics.progress.untranslatedSegments}
            />
            <Definition
              label={t("insights.draft")}
              value={analytics.progress.draftSegments}
            />
            <Definition
              label={t("insights.reviewed")}
              value={analytics.progress.reviewedSegments}
            />
            <Definition
              label={t("insights.translation")}
              value={analytics.progress.workflowTranslation}
            />
            <Definition
              label={t("insights.review")}
              value={analytics.progress.workflowReview}
            />
            <Definition
              label={t("insights.signed")}
              value={analytics.progress.workflowSigned}
            />
          </dl>
        </section>

        <section className="insights-section">
          <SectionHeading
            eyebrow={t("insights.activity")}
            title={t("insights.productivity")}
            icon={<Clock3 size={18} />}
          />
          <dl className="insights-definition-grid">
            <Definition
              label={t("insights.activeEditing")}
              value={formatOptionalMetric(
                analytics.productivity.activeEditingMs,
                t("insights.unavailable"),
                (value) => formatDuration(value, t, formatNumber),
              )}
            />
            <Definition
              label={t("insights.confirmedPerHour")}
              value={formatOptionalMetric(
                analytics.productivity.confirmedSegmentsPerHourMilli,
                t("insights.unavailable"),
                (value) => formatMilli(value, formatNumber),
              )}
            />
            <Definition
              label={t("insights.activityEvents")}
              value={analytics.productivity.activityEvents}
            />
            <Definition
              label={t("insights.idleThreshold")}
              value={formatDuration(
                analytics.productivity.idleGapMs,
                t,
                formatNumber,
              )}
            />
          </dl>
          <OptionalReason
            metrics={[
              analytics.productivity.activeEditingMs,
              analytics.productivity.confirmedSegmentsPerHourMilli,
            ]}
          />
        </section>

        <section className="insights-section">
          <SectionHeading
            eyebrow={t("insights.automation")}
            title={t("insights.aiContribution")}
            icon={<ArrowRight size={18} />}
          />
          {analytics.ai.available ? (
            <dl className="insights-definition-grid">
              <Definition
                label={t("insights.appliedSegments")}
                value={analytics.ai.contribution.appliedSegments}
              />
              <Definition
                label={t("insights.retainedSegments")}
                value={analytics.ai.contribution.retainedSegments}
              />
              <Definition
                label={t("insights.replacedSegments")}
                value={analytics.ai.contribution.replacedSegments}
              />
              <Definition
                label={t("insights.retainedChars")}
                value={analytics.ai.contribution.retainedCharacters}
              />
            </dl>
          ) : (
            <UnavailableState
              label={analytics.ai.reason ?? t("insights.aiHistoryUnavailable")}
              compact
            />
          )}
        </section>

        <section className="insights-section">
          <SectionHeading
            eyebrow={t("insights.assetHealth")}
            title={t("insights.assetHealth")}
            icon={<ShieldAlert size={18} />}
          />
          <dl className="insights-definition-grid">
            <Definition
              label={t("insights.tmUnits")}
              value={analytics.assets.tmConfirmedUnits}
            />
            <Definition
              label={t("insights.termEntries")}
              value={analytics.assets.termEntries}
            />
            <Definition
              label={t("insights.openBlockers")}
              value={analytics.assets.qaOpenBlockers}
            />
            <Definition
              label={t("insights.tmReuse")}
              value={formatOptionalMetric(
                analytics.assets.tmReuseSegments,
                t("insights.unavailable"),
                formatNumber,
              )}
            />
            <Definition
              label={t("insights.mountedHits")}
              value={formatOptionalMetric(
                analytics.assets.mountedLibraryHitSegments,
                t("insights.unavailable"),
                formatNumber,
              )}
            />
            <Definition
              label={t("insights.curationOutcomes")}
              value={formatOptionalMetric(
                analytics.assets.curationOutcomes,
                t("insights.unavailable"),
                formatNumber,
              )}
            />
          </dl>
        </section>
      </div>

      <section className="insights-section insights-trends">
        <SectionHeading
          eyebrow={t("insights.recentBuckets")}
          title={t("insights.trends")}
          icon={<History size={18} />}
        />
        {analytics.trends.length ? (
          <div className="insights-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("common.period")}</th>
                  <th>{t("common.edits")}</th>
                  <th>{t("common.confirmed")}</th>
                  <th>{t("common.workflow")}</th>
                  <th>{t("insights.qaRuns")}</th>
                  <th>{t("insights.tmUnits")}</th>
                  <th>{t("common.terms")}</th>
                </tr>
              </thead>
              <tbody>
                {analytics.trends.map((bucket) => (
                  <tr key={`${bucket.startMs}-${bucket.endMs}`}>
                    <td>{formatShortDate(bucket.startMs, formatDate)}</td>
                    <td>{bucket.targetEdits}</td>
                    <td>{bucket.confirmations}</td>
                    <td>{bucket.workflowTransitions}</td>
                    <td>{bucket.qaRunsCompleted}</td>
                    <td>{bucket.tmUnitsAdded}</td>
                    <td>{bucket.termsAdded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <UnavailableState label={t("insights.noTrendBuckets")} compact />
        )}
      </section>
    </div>
  );
}

function FilesPanel({
  documents,
  activeDocumentId,
  analytics,
  busy,
  diagnostics,
  onChooseFiles,
  onChooseFolder,
  onDrop,
  onOpen,
  onRecycle,
}: {
  documents: Document[];
  activeDocumentId: string;
  analytics: ProjectAnalyticsSummary | null;
  busy: boolean;
  diagnostics: BatchImportDiagnostic[];
  onChooseFiles(): void;
  onChooseFolder(): void;
  onDrop(event: DragEvent<HTMLDivElement>): void;
  onOpen(documentId: string): void;
  onRecycle(document: Document): void;
}) {
  const { t, formatNumber } = useLocale();
  return (
    <div className="insights-files-layout">
      <section className="insights-section insights-files">
        <SectionHeading
          eyebrow={t("insights.activeSourceSet")}
          title={t("insights.projectFiles", { count: documents.length })}
          icon={<FileText size={18} />}
          actions={
            <>
              <button
                className="button secondary"
                type="button"
                onClick={onChooseFiles}
                disabled={busy}
              >
                <FilePlus2 size={14} /> {t("insights.addFiles")}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={onChooseFolder}
                disabled={busy}
              >
                <FolderOpen size={14} /> {t("insights.addFolder")}
              </button>
            </>
          }
        />
        <div
          className="insights-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <UploadCloud size={20} />
          <span>{t("insights.dropFiles")}</span>
        </div>
        <div className="insights-file-list">
          {documents.map((item) => {
            const progress = analytics?.documentProgress[item.id];
            return (
              <article
                key={item.id}
                data-active={item.id === activeDocumentId || undefined}
              >
                <div className="insights-file-icon">
                  <FileText size={16} />
                </div>
                <div className="insights-file-copy">
                  <span>
                    {item.format} ·{" "}
                    {t("insights.fileRevisionVersion", {
                      revision: item.revision,
                      version: item.currentVersion,
                    })}
                  </span>
                  <strong>{item.relativePath}</strong>
                  <small>
                    {item.status} ·{" "}
                    {item.degradation.length
                      ? t("insights.fileSegmentsDiagnostics", {
                          count: item.segmentCount,
                          diagnostics: item.degradation.length,
                        })
                      : t("insights.fileSegments", {
                          count: item.segmentCount,
                        })}
                  </small>
                </div>
                <div className="insights-file-progress">
                  <strong>
                    {progress
                      ? formatBasisPoints(
                          progress.completionBasisPoints,
                          formatNumber,
                          t,
                        )
                      : t("insights.unavailable")}
                  </strong>
                  <span>
                    {progress
                      ? t("insights.blockerCount", {
                          count: progress.qaBlockers,
                        })
                      : ""}
                  </span>
                </div>
                <div className="insights-file-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => onOpen(item.id)}
                  >
                    {t("common.open")}
                    <ArrowRight size={13} />
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    title={t("insights.recycleDocument")}
                    aria-label={t("insights.recycleNamed", { name: item.name })}
                    onClick={() => onRecycle(item)}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      {diagnostics.length ? (
        <section className="insights-section insights-diagnostics">
          <SectionHeading
            eyebrow={t("insights.lastBatch")}
            title={t("setup.importDiagnostics")}
            icon={<FilePlus2 size={18} />}
          />
          {diagnostics.map((item, index) => (
            <div
              key={`${item.path}-${index}`}
              data-status={item.status}
              className="insights-diagnostic-row"
            >
              <span>
                {item.status === "succeeded" ? <Check size={13} /> : "!"}
              </span>
              <div>
                <strong>{item.relativePath || fileName(item.path)}</strong>
                <small>{item.message ?? item.errorCode ?? item.status}</small>
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ReimportPanel({
  document,
  replacementPath,
  preview,
  busy,
  onChoose,
  onPreview,
  onApply,
}: {
  document: Document;
  replacementPath: string;
  preview: DocumentReimportPreviewResult | null;
  busy: boolean;
  onChoose(): void;
  onPreview(): void;
  onApply(): void;
}) {
  const { t } = useLocale();
  return (
    <div className="insights-reimport-layout">
      <section className="insights-section">
        <SectionHeading
          eyebrow={t("insights.revisionReconciliation")}
          title={document.name}
          icon={<RotateCcw size={18} />}
        />
        <dl className="insights-file-facts">
          <Definition
            label={t("insights.currentRevision")}
            value={document.revision}
          />
          <Definition
            label={t("insights.currentVersion")}
            value={document.currentVersion}
          />
          <Definition
            label={t("common.segments")}
            value={document.segmentCount}
          />
          <Definition
            label={t("insights.sourceHash")}
            value={document.sourceSha256.slice(0, 12)}
          />
        </dl>
        <div className="insights-reimport-picker">
          <button
            className="button secondary"
            type="button"
            onClick={onChoose}
            disabled={busy}
          >
            <FolderOpen size={14} /> {t("insights.selectReplacement")}
          </button>
          <span title={replacementPath}>
            {replacementPath
              ? fileName(replacementPath)
              : t("insights.noReplacement")}
          </span>
          <button
            className="button primary"
            type="button"
            onClick={onPreview}
            disabled={busy || !replacementPath}
          >
            {t("insights.previewReconciliation")}
          </button>
        </div>
      </section>

      {preview ? (
        <section className="insights-section insights-reimport-preview">
          <SectionHeading
            eyebrow={t("insights.previewId", {
              id: preview.previewId.slice(0, 8),
            })}
            title={t("insights.reconciliation")}
            icon={<FileClock size={18} />}
            actions={
              <button
                className="button primary"
                type="button"
                onClick={onApply}
                disabled={busy}
              >
                {t("insights.applyPreview")}
                <ArrowRight size={13} />
              </button>
            }
          />
          <div
            className="reimport-counts"
            aria-label={t("insights.reimportCounts")}
          >
            <Metric
              label={t("insights.unchanged")}
              value={preview.plan.unchanged}
            />
            <Metric
              label={t("insights.changed")}
              value={preview.plan.changed}
            />
            <Metric
              label={t("insights.newSegments")}
              value={preview.plan.newSegments}
            />
            <Metric
              label={t("insights.removed")}
              value={preview.plan.removed}
            />
            <Metric
              label={t("insights.ambiguous")}
              value={preview.plan.ambiguous}
            />
          </div>
          <div className="reimport-items">
            {preview.plan.items.slice(0, 100).map((item, index) => (
              <div
                key={`${item.oldSegmentId ?? "new"}-${item.newSegmentId ?? index}`}
              >
                <span data-disposition={item.disposition}>
                  {item.disposition}
                </span>
                <strong>
                  {item.oldOrdinal === undefined || item.oldOrdinal === null
                    ? t("insights.newItem")
                    : t("insights.oldOrdinal", {
                        ordinal: item.oldOrdinal + 1,
                      })}
                  {" → "}
                  {item.newOrdinal === undefined || item.newOrdinal === null
                    ? t("insights.removedLabel")
                    : t("insights.newOrdinal", {
                        ordinal: item.newOrdinal + 1,
                      })}
                </strong>
                <small>{item.reason}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ArchivePanel({
  projectName,
  busy,
  onExport,
  onRecycle,
}: {
  projectName: string;
  busy: boolean;
  onExport(): void;
  onRecycle(): void;
}) {
  const { t } = useLocale();
  return (
    <div className="insights-archive-layout">
      <section className="insights-section insights-archive-action">
        <FolderOpen size={24} />
        <div>
          <span className="surface-kicker">{t("insights.portable")}</span>
          <h2>{t("insights.exportArchive")}</h2>
          <p>{projectName}</p>
        </div>
        <button
          className="button primary"
          type="button"
          onClick={onExport}
          disabled={busy}
        >
          <Archive size={14} /> {t("insights.exportTlcat")}
        </button>
      </section>
      <section className="insights-section insights-archive-action danger-zone">
        <Trash2 size={24} />
        <div>
          <span className="surface-kicker">{t("insights.recoverable")}</span>
          <h2>{t("insights.recycleProject")}</h2>
          <p>{t("insights.restoreFromHome")}</p>
        </div>
        <button
          className="button danger"
          type="button"
          onClick={onRecycle}
          disabled={busy}
        >
          <Trash2 size={14} />
          {t("insights.recycleProject")}
        </button>
      </section>
    </div>
  );
}

function HistoryPanel({
  operations,
  total,
}: {
  operations: Operation[];
  total: number;
}) {
  const { t, formatDate } = useLocale();
  return (
    <section className="insights-section insights-history">
      <SectionHeading
        eyebrow={t("insights.historyCount", { count: total })}
        title={t("insights.history")}
        icon={<History size={18} />}
      />
      {operations.length ? (
        <div className="insights-history-list">
          {operations.map((operation) => (
            <article key={operation.id}>
              <span className="history-sequence">#{operation.sequence}</span>
              <div>
                <strong>{operation.kind.replaceAll("_", " ")}</strong>
                <span>
                  {operation.entityType} · {operation.entityId.slice(0, 12)}
                </span>
              </div>
              <div>
                <strong>{operation.actor}</strong>
                <time>{formatDate(operation.createdAtMs)}</time>
              </div>
              <span>
                {operation.resultRevision === undefined ||
                operation.resultRevision === null
                  ? ""
                  : `r${operation.resultRevision}`}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <UnavailableState label={t("insights.noOperations")} compact />
      )}
    </section>
  );
}

function AnalysisPanel({
  profiles,
  profileId,
  result,
  busy,
  onProfile,
  onRun,
}: {
  profiles: AnalysisProfile[];
  profileId: string;
  result: AnalysisRunResult | null;
  busy: boolean;
  onProfile(value: string): void;
  onRun(): void;
}) {
  const { t, formatNumber } = useLocale();
  return (
    <div className="insights-analysis-layout">
      <section className="insights-section analysis-controls">
        <SectionHeading
          eyebrow={t("insights.engineSnapshot")}
          title={t("insights.analysis")}
          icon={<FileClock size={18} />}
        />
        <label>
          <span>{t("setup.analysisProfile")}</span>
          <select
            value={profileId}
            onChange={(event) => onProfile(event.currentTarget.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · r{profile.revision}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          type="button"
          onClick={onRun}
          disabled={busy || profiles.length === 0}
        >
          {busy ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <BarChart3 size={14} />
          )}
          {t("insights.runAnalysis")}
        </button>
      </section>

      {result ? (
        <section className="insights-section analysis-results">
          <SectionHeading
            eyebrow={t("insights.profileRevision", {
              profile: result.profileId,
              revision: result.profileRevision,
            })}
            title={
              result.stale
                ? t("insights.staleAnalysis")
                : t("insights.analysisSnapshot")
            }
            icon={
              result.stale ? <ShieldAlert size={18} /> : <Check size={18} />
            }
          />
          <div className="analysis-summary-grid">
            <Metric
              label={t("common.segments")}
              value={formatNumber(result.summary.segments)}
            />
            <Metric
              label={t("insights.sourceWords")}
              value={formatNumber(result.summary.sourceWords)}
            />
            <Metric
              label={t("insights.sourceChars")}
              value={formatNumber(result.summary.sourceCharacters)}
            />
            <Metric
              label={t("insights.sourceCjk")}
              value={formatNumber(result.summary.sourceCjkCharacters)}
            />
            <Metric
              label={t("insights.targetWords")}
              value={formatNumber(result.summary.targetWords)}
            />
            <Metric
              label={t("insights.targetChars")}
              value={formatNumber(result.summary.targetCharacters)}
            />
            <Metric
              label={t("insights.targetCjk")}
              value={formatNumber(result.summary.targetCjkCharacters)}
            />
            <Metric
              label={t("insights.repetitions")}
              value={formatNumber(result.summary.repeatedSegments)}
            />
            <Metric
              label={t("insights.weightedEffort")}
              value={t("insights.milliUnits", {
                value: formatNumber(result.summary.weightedEffortMilliUnits),
              })}
            />
          </div>
          <div className="analysis-detail-grid">
            <div>
              <h3>{t("insights.matchBands")}</h3>
              <dl>
                <Definition
                  label={t("insights.exact")}
                  value={formatNumber(result.summary.matchBands.exact)}
                />
                <Definition
                  label={t("insights.match9599")}
                  value={formatNumber(result.summary.matchBands.match9599)}
                />
                <Definition
                  label={t("insights.match8594")}
                  value={formatNumber(result.summary.matchBands.match8594)}
                />
                <Definition
                  label={t("insights.match7584")}
                  value={formatNumber(result.summary.matchBands.match7584)}
                />
                <Definition
                  label={t("insights.match5074")}
                  value={formatNumber(result.summary.matchBands.match5074)}
                />
                <Definition
                  label={t("insights.noMatch")}
                  value={formatNumber(result.summary.matchBands.noMatch)}
                />
                <Definition
                  label={t("insights.repetitions")}
                  value={formatNumber(result.summary.matchBands.repetitions)}
                />
              </dl>
            </div>
            <div>
              <h3>{t("common.workflow")}</h3>
              <dl>
                <Definition
                  label={t("insights.translation")}
                  value={formatNumber(result.summary.workflowTranslation)}
                />
                <Definition
                  label={t("insights.review")}
                  value={formatNumber(result.summary.workflowReview)}
                />
                <Definition
                  label={t("insights.signed")}
                  value={formatNumber(result.summary.workflowSigned)}
                />
              </dl>
            </div>
            <div>
              <h3>{t("insights.aiContribution")}</h3>
              <dl>
                <Definition
                  label={t("insights.appliedSegments")}
                  value={formatNumber(
                    result.summary.aiContribution.appliedSegments,
                  )}
                />
                <Definition
                  label={t("insights.retainedSegments")}
                  value={formatNumber(
                    result.summary.aiContribution.retainedSegments,
                  )}
                />
                <Definition
                  label={t("insights.replacedSegments")}
                  value={formatNumber(
                    result.summary.aiContribution.replacedSegments,
                  )}
                />
                <Definition
                  label={t("insights.editDistance")}
                  value={formatNumber(
                    result.summary.aiContribution.editDistance,
                  )}
                />
              </dl>
            </div>
          </div>
        </section>
      ) : (
        <UnavailableState label={t("insights.noAnalysis")} />
      )}
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  icon,
  actions,
}: {
  eyebrow: string;
  title: string;
  icon: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="insights-section-heading">
      <div>
        <span className="surface-kicker">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {actions ? (
        <div className="insights-section-actions">{actions}</div>
      ) : (
        icon
      )}
    </header>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="insights-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Definition({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function UnavailableState({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact ? "insights-unavailable compact" : "insights-unavailable"
      }
    >
      <ShieldAlert size={compact ? 16 : 22} />
      <span>{label}</span>
    </div>
  );
}

function OptionalReason({ metrics }: { metrics: OptionalCountMetric[] }) {
  const reason = metrics.find((metric) => !metric.available)?.reason;
  return reason ? <p className="insights-unavailable-note">{reason}</p> : null;
}

function ActionDialog({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: PendingAction;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useLocale();
  return (
    <div className="surface-dialog-backdrop" role="presentation">
      <section
        className="surface-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="insights-action-title"
      >
        <header>
          <div>
            <span className="surface-kicker">
              {t("insights.explicitAction")}
            </span>
            <h2 id="insights-action-title">{action.title}</h2>
          </div>
          {action.danger ? <Trash2 size={20} /> : <RotateCcw size={20} />}
        </header>
        <p>{action.description}</p>
        <footer>
          <button
            className="button tertiary"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            {t("common.cancel")}
          </button>
          <button
            className={action.danger ? "button danger" : "button primary"}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : action.danger ? (
              <Trash2 size={14} />
            ) : (
              <Check size={14} />
            )}
            {action.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function formatBasisPoints(
  value: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
  t: (key: MessageKey, vars?: FormatVars) => string,
): string {
  return t("insights.percent", {
    value: formatNumber(value / 100, {
      maximumFractionDigits: value % 100 === 0 ? 0 : 1,
    }),
  });
}

function formatOptionalMetric(
  metric: OptionalCountMetric,
  fallback: string,
  formatter: (value: number) => string,
): string {
  return metric.available && metric.value !== null && metric.value !== undefined
    ? formatter(metric.value)
    : fallback;
}

function formatDuration(
  value: number,
  t: (key: MessageKey, vars?: FormatVars) => string,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  if (value < 60_000) {
    return t("insights.durationSeconds", {
      value: formatNumber(Math.round(value / 1000)),
    });
  }
  if (value < 3_600_000) {
    return t("insights.durationMinutes", {
      value: formatNumber(Math.round(value / 60_000)),
    });
  }
  return t("insights.durationHours", {
    value: formatNumber(value / 3_600_000, {
      maximumFractionDigits: 1,
    }),
  });
}

function formatMilli(
  value: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  return formatNumber(value / 1000, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatShortDate(
  value: number,
  formatDate: (
    value: Date | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string,
): string {
  return formatDate(value, {
    month: "short",
    day: "numeric",
  });
}

function safeArchiveName(value: string): string {
  return value.trim().replaceAll(/[\\/:*?"<>|]/gu, "-") || "project";
}
