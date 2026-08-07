import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import type {
  AnalysisProfile,
  AnalysisRunResult,
  BatchImportDiagnostic,
  Document,
  DocumentReimportPreviewResult,
  Operation,
  ProjectAnalyticsSummary,
  ProjectSnapshot,
} from "@translunar/contracts";
import {
  Archive,
  BarChart3,
  Check,
  Database,
  FileClock,
  FileText,
  GitCompareArrows,
  History,
  Languages,
  LoaderCircle,
  MessageSquareText,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import {
  InsightsTabList,
  type InsightsTabGroup,
  type InsightsTabId,
} from "./components/project/InsightsTabList";
import { AnalysisPanel } from "./components/project/insights/AnalysisPanel";
import { ArchivePanel } from "./components/project/insights/ArchivePanel";
import { FilesPanel } from "./components/project/insights/FilesPanel";
import { HistoryPanel } from "./components/project/insights/HistoryPanel";
import { safeArchiveName } from "./components/project/insights/insightsShared";
import { OverviewPanel } from "./components/project/insights/OverviewPanel";
import { ReimportPanel } from "./components/project/insights/ReimportPanel";
import { AlignmentCorpusPanel } from "./AlignmentCorpusPanel";
import { AssetCurationPanel } from "./AssetCurationPanel";
import { DiscussionSnapshotPanel } from "./DiscussionSnapshotPanel";
import { InteropPanel } from "./InteropPanel";
import { PluginsPanel } from "./PluginsPanel";
import { TaskPackagePanel } from "./TaskPackagePanel";
import { useLocale } from "./i18n/LocaleProvider";
import { fileName, formatError } from "./workbench-utils";

interface ProjectInsightsPageProps {
  snapshot: ProjectSnapshot;
  document: Document;
  onRefresh(): Promise<void>;
  onOpenDocument(documentId: string): Promise<void>;
  onOpenProject(projectId: string, documentId?: string): Promise<void>;
  onReturnHome(): void;
  onOpenQa?(): void;
  onOpenAiControl?(): void;
}

interface PendingAction {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  run(): Promise<void>;
}

export function ProjectInsightsPage({
  snapshot,
  document,
  onRefresh,
  onOpenDocument,
  onOpenProject,
  onReturnHome,
  onOpenQa,
  onOpenAiControl,
}: ProjectInsightsPageProps) {
  const { t } = useLocale();

  const projectId = snapshot.project.id;
  const [tab, setTab] = useState<InsightsTabId>("overview");
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

  const tabGroups: InsightsTabGroup[] = useMemo(
    () => [
      {
        items: [
          {
            id: "overview",
            label: t("insights.tabOverview"),
            icon: <BarChart3 size={14} aria-hidden="true" />,
          },
          {
            id: "files",
            label: t("insights.tabFiles"),
            icon: <FileText size={14} aria-hidden="true" />,
          },
          {
            id: "analysis",
            label: t("insights.tabAnalysis"),
            icon: <FileClock size={14} aria-hidden="true" />,
          },
        ],
      },
      {
        label: t("insights.groupAssets"),
        items: [
          {
            id: "assets",
            label: t("insights.tabAssets"),
            icon: <Database size={14} aria-hidden="true" />,
          },
          {
            id: "alignment",
            label: t("insights.alignmentTab"),
            icon: <GitCompareArrows size={14} aria-hidden="true" />,
          },
          {
            id: "interop",
            label: t("insights.tabInterop"),
            icon: <Languages size={14} aria-hidden="true" />,
          },
        ],
      },
      {
        label: t("insights.groupWorkflow"),
        items: [
          {
            id: "reimport",
            label: t("insights.tabReimport"),
            icon: <RotateCcw size={14} aria-hidden="true" />,
          },
          {
            id: "task-packages",
            label: t("insights.taskTab"),
            icon: <Archive size={14} aria-hidden="true" />,
          },
          {
            id: "discussions",
            label: t("insights.discussionsTab"),
            icon: <MessageSquareText size={14} aria-hidden="true" />,
          },
        ],
      },
      {
        label: t("insights.groupSystem"),
        items: [
          {
            id: "plugins",
            label: t("insights.tabPlugins"),
            icon: <Puzzle size={14} aria-hidden="true" />,
          },
          {
            id: "archive",
            label: t("insights.tabArchive"),
            icon: <Archive size={14} aria-hidden="true" />,
          },
          {
            id: "history",
            label: t("insights.history"),
            icon: <History size={14} aria-hidden="true" />,
          },
        ],
      },
    ],
    [t],
  );

  return (
    <main className="project-insights-main" aria-busy={loading || !!busy}>
      <header className="project-insights-heading">
        <div>
          <span className="surface-kicker">{t("insights.kicker")}</span>
          <h1>{t("insights.title")}</h1>
          <p>
            {documents.length} · {snapshot.project.sourceLocale} →{" "}
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

      <InsightsTabList
        groups={tabGroups}
        active={tab}
        onChange={setTab}
        ariaLabel={t("insights.title")}
      />

      <section
        className="project-insights-content"
        role="tabpanel"
        id={`insights-panel-${tab}`}
      >
        {loading ? (
          <div className="project-insights-loading" role="status">
            <LoaderCircle className="spin" size={18} aria-hidden="true" />{" "}
            {t("insights.loading")}
          </div>
        ) : tab === "overview" ? (
          <OverviewPanel
            analytics={analytics}
            documents={documents}
            analysisStale={analysis?.stale === true}
            onRunAnalysis={() => void runAnalysis()}
            onOpenWorkbench={() => {
              const target = documents[0]?.id ?? document.id;
              void openDocument(target);
            }}
            onOpenFiles={() => setTab("files")}
            onOpenHistory={() => setTab("history")}
            onOpenAssets={() => setTab("assets")}
            {...(onOpenQa ? { onOpenQa } : {})}
            {...(onOpenAiControl ? { onOpenAiControl } : {})}
            qaActionLabel={t("insights.residualQa")}
            aiActionLabel={t("insights.residualAi")}
          />
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
          {action.danger ? (
            <Trash2 size={20} aria-hidden="true" />
          ) : (
            <RotateCcw size={20} aria-hidden="true" />
          )}
        </header>
        <p>{action.description}</p>
        <footer>
          <button
            className="button tertiary"
            type="button"
            onClick={onCancel}
            disabled={busy}
            autoFocus={!action.danger}
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
              <LoaderCircle className="spin" size={14} aria-hidden="true" />
            ) : action.danger ? (
              <Trash2 size={14} aria-hidden="true" />
            ) : (
              <Check size={14} aria-hidden="true" />
            )}
            {action.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
