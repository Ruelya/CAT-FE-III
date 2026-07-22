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
  FileClock,
  FilePlus2,
  FileText,
  FolderOpen,
  GitCompareArrows,
  History,
  Languages,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { fileName, formatError } from "./workbench-utils";
import { AlignmentCorpusPanel } from "./AlignmentCorpusPanel";
import { InteropPanel } from "./InteropPanel";

type InsightsTab =
  | "overview"
  | "files"
  | "reimport"
  | "alignment"
  | "interop"
  | "archive"
  | "history"
  | "analysis";

interface ProjectInsightsPageProps {
  snapshot: ProjectSnapshot;
  document: Document;
  onRefresh(): Promise<void>;
  onOpenDocument(documentId: string): Promise<void>;
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
  label: string;
  icon: ReactNode;
}> = [
  { id: "overview", label: "Overview", icon: <BarChart3 size={15} /> },
  { id: "files", label: "Files", icon: <FileText size={15} /> },
  { id: "reimport", label: "Re-import", icon: <RotateCcw size={15} /> },
  {
    id: "alignment",
    label: "Alignment / corpora",
    icon: <GitCompareArrows size={15} />,
  },
  { id: "interop", label: "Interop", icon: <Languages size={15} /> },
  { id: "archive", label: "Archive", icon: <Archive size={15} /> },
  { id: "history", label: "History", icon: <History size={15} /> },
  { id: "analysis", label: "Analysis", icon: <FileClock size={15} /> },
];

export function ProjectInsightsPage({
  snapshot,
  document,
  onRefresh,
  onOpenDocument,
  onReturnHome,
}: ProjectInsightsPageProps) {
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
        `Batch finished: ${result.succeeded} succeeded, ${result.failed} failed.`,
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
      title: "Recycle document",
      description: `${item.relativePath} will leave the active project and remain recoverable from the project home.`,
      confirmLabel: "Recycle document",
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
            setNotice(`${item.name} moved to the recycle bin.`);
          } else {
            onReturnHome();
          }
          return;
        }
        await refreshAfterMutation();
        setNotice(`${item.name} moved to the recycle bin.`);
      },
    });
  };

  const requestRecycleProject = () => {
    setPendingAction({
      title: "Recycle project",
      description: `${snapshot.project.name} and its active documents will leave normal project and search results.`,
      confirmLabel: "Recycle project",
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
      setNotice("Re-import preview is ready.");
    });
  };

  const requestApplyReimport = () => {
    if (!reimportPreview) return;
    setPendingAction({
      title: "Apply re-import",
      description: `Apply this revision-bound preview to ${document.name}. Removed and ambiguous segments will follow the Engine reconciliation plan.`,
      confirmLabel: "Apply preview",
      run: async () => {
        await window.translunar.invoke("document.reimport.apply", {
          previewId: reimportPreview.previewId,
          expectedDocumentRevision: reimportPreview.expectedDocumentRevision,
          actor: "desktop-user",
        });
        setReimportPreview(null);
        setReplacementPath("");
        await refreshAfterMutation();
        setNotice(`${document.name} was re-imported.`);
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
            ? `Archive exported. ${result.diagnostics.join(" ")}`
            : `Archive exported to ${fileName(result.archivePath)}.`,
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
        result.stale
          ? "Analysis completed but is stale against current project revisions."
          : "Analysis snapshot completed.",
      );
      await loadData();
    });
  };

  return (
    <main className="project-insights-main" aria-busy={loading || !!busy}>
      <header className="project-insights-heading">
        <div>
          <span className="surface-kicker">Project operations</span>
          <h1>Project insights</h1>
          <p>
            {documents.length} files · {snapshot.project.sourceLocale} to{" "}
            {snapshot.project.targetLocale}
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Refresh project insights"
          aria-label="Refresh project insights"
          onClick={() => void loadData()}
          disabled={loading || !!busy}
        >
          <RefreshCw size={15} />
        </button>
      </header>

      <nav className="project-insights-tabs" aria-label="Project insights">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
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
            <LoaderCircle className="spin" size={18} /> Loading project data
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
        ) : tab === "alignment" ? (
          <AlignmentCorpusPanel
            snapshot={snapshot}
            documents={documents}
            onRefresh={onRefresh}
          />
        ) : tab === "interop" ? (
          <InteropPanel
            snapshot={snapshot}
            document={document}
            onRefresh={onRefresh}
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
  if (!analytics) {
    return <UnavailableState label="Project analytics are unavailable." />;
  }
  return (
    <div className="insights-overview">
      <section className="insights-metric-strip" aria-label="Project progress">
        <Metric
          label="Completion"
          value={formatBasisPoints(analytics.progress.completionBasisPoints)}
        />
        <Metric label="Segments" value={analytics.progress.totalSegments} />
        <Metric
          label="Confirmed"
          value={analytics.progress.confirmedSegments}
        />
        <Metric label="QA blockers" value={analytics.progress.qaBlockers} />
        <Metric label="Files" value={documents.length} />
      </section>

      <div className="insights-overview-grid">
        <section className="insights-section">
          <SectionHeading
            eyebrow="Workflow"
            title="Project progress"
            icon={<BarChart3 size={18} />}
          />
          <progress
            value={analytics.progress.completionBasisPoints}
            max={10_000}
            aria-label="Project completion"
          />
          <dl className="insights-definition-grid">
            <Definition
              label="Untranslated"
              value={analytics.progress.untranslatedSegments}
            />
            <Definition
              label="Draft"
              value={analytics.progress.draftSegments}
            />
            <Definition
              label="Reviewed"
              value={analytics.progress.reviewedSegments}
            />
            <Definition
              label="Translation"
              value={analytics.progress.workflowTranslation}
            />
            <Definition
              label="Review"
              value={analytics.progress.workflowReview}
            />
            <Definition
              label="Signed"
              value={analytics.progress.workflowSigned}
            />
          </dl>
        </section>

        <section className="insights-section">
          <SectionHeading
            eyebrow="Activity"
            title="Productivity"
            icon={<Clock3 size={18} />}
          />
          <dl className="insights-definition-grid">
            <Definition
              label="Active editing"
              value={formatOptionalMetric(
                analytics.productivity.activeEditingMs,
                formatDuration,
              )}
            />
            <Definition
              label="Confirmed / hour"
              value={formatOptionalMetric(
                analytics.productivity.confirmedSegmentsPerHourMilli,
                formatMilli,
              )}
            />
            <Definition
              label="Activity events"
              value={analytics.productivity.activityEvents}
            />
            <Definition
              label="Idle threshold"
              value={formatDuration(analytics.productivity.idleGapMs)}
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
            eyebrow="Automation"
            title="AI contribution"
            icon={<ArrowRight size={18} />}
          />
          {analytics.ai.available ? (
            <dl className="insights-definition-grid">
              <Definition
                label="Applied segments"
                value={analytics.ai.contribution.appliedSegments}
              />
              <Definition
                label="Retained segments"
                value={analytics.ai.contribution.retainedSegments}
              />
              <Definition
                label="Replaced segments"
                value={analytics.ai.contribution.replacedSegments}
              />
              <Definition
                label="Retained characters"
                value={analytics.ai.contribution.retainedCharacters}
              />
            </dl>
          ) : (
            <UnavailableState
              label={analytics.ai.reason ?? "AI history is unavailable."}
              compact
            />
          )}
        </section>

        <section className="insights-section">
          <SectionHeading
            eyebrow="Resources"
            title="Asset health"
            icon={<ShieldAlert size={18} />}
          />
          <dl className="insights-definition-grid">
            <Definition
              label="TM units"
              value={analytics.assets.tmConfirmedUnits}
            />
            <Definition
              label="Term entries"
              value={analytics.assets.termEntries}
            />
            <Definition
              label="Open blockers"
              value={analytics.assets.qaOpenBlockers}
            />
            <Definition
              label="TM reuse"
              value={formatOptionalMetric(analytics.assets.tmReuseSegments)}
            />
            <Definition
              label="Mounted hits"
              value={formatOptionalMetric(
                analytics.assets.mountedLibraryHitSegments,
              )}
            />
            <Definition
              label="Curation outcomes"
              value={formatOptionalMetric(analytics.assets.curationOutcomes)}
            />
          </dl>
        </section>
      </div>

      <section className="insights-section insights-trends">
        <SectionHeading
          eyebrow="Recent buckets"
          title="Operational trends"
          icon={<History size={18} />}
        />
        {analytics.trends.length ? (
          <div className="insights-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Edits</th>
                  <th>Confirmed</th>
                  <th>Workflow</th>
                  <th>QA runs</th>
                  <th>TM units</th>
                  <th>Terms</th>
                </tr>
              </thead>
              <tbody>
                {analytics.trends.map((bucket) => (
                  <tr key={`${bucket.startMs}-${bucket.endMs}`}>
                    <td>{formatShortDate(bucket.startMs)}</td>
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
          <UnavailableState label="No trend buckets are available." compact />
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
  return (
    <div className="insights-files-layout">
      <section className="insights-section insights-files">
        <SectionHeading
          eyebrow="Active source set"
          title={`${documents.length} project files`}
          icon={<FileText size={18} />}
          actions={
            <>
              <button
                className="button secondary"
                type="button"
                onClick={onChooseFiles}
                disabled={busy}
              >
                <FilePlus2 size={14} /> Add files
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={onChooseFolder}
                disabled={busy}
              >
                <FolderOpen size={14} /> Add folder
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
          <span>Drop files or folders to add them</span>
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
                    {item.format} · revision {item.revision} · version{" "}
                    {item.currentVersion}
                  </span>
                  <strong>{item.relativePath}</strong>
                  <small>
                    {item.status} · {item.segmentCount} segments
                    {item.degradation.length
                      ? ` · ${item.degradation.length} diagnostics`
                      : ""}
                  </small>
                </div>
                <div className="insights-file-progress">
                  <strong>
                    {progress
                      ? formatBasisPoints(progress.completionBasisPoints)
                      : "Unavailable"}
                  </strong>
                  <span>
                    {progress ? `${progress.qaBlockers} blockers` : ""}
                  </span>
                </div>
                <div className="insights-file-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => onOpen(item.id)}
                  >
                    Open <ArrowRight size={13} />
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    title="Recycle document"
                    aria-label={`Recycle ${item.name}`}
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
            eyebrow="Last batch"
            title="Import diagnostics"
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
  return (
    <div className="insights-reimport-layout">
      <section className="insights-section">
        <SectionHeading
          eyebrow="Revision reconciliation"
          title={document.name}
          icon={<RotateCcw size={18} />}
        />
        <dl className="insights-file-facts">
          <Definition label="Current revision" value={document.revision} />
          <Definition label="Current version" value={document.currentVersion} />
          <Definition label="Segments" value={document.segmentCount} />
          <Definition
            label="Source hash"
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
            <FolderOpen size={14} /> Select replacement
          </button>
          <span title={replacementPath}>
            {replacementPath
              ? fileName(replacementPath)
              : "No replacement selected"}
          </span>
          <button
            className="button primary"
            type="button"
            onClick={onPreview}
            disabled={busy || !replacementPath}
          >
            Preview reconciliation
          </button>
        </div>
      </section>

      {preview ? (
        <section className="insights-section insights-reimport-preview">
          <SectionHeading
            eyebrow={`Preview ${preview.previewId.slice(0, 8)}`}
            title="Reconciliation plan"
            icon={<FileClock size={18} />}
            actions={
              <button
                className="button primary"
                type="button"
                onClick={onApply}
                disabled={busy}
              >
                Apply preview <ArrowRight size={13} />
              </button>
            }
          />
          <div className="reimport-counts" aria-label="Re-import counts">
            <Metric label="Unchanged" value={preview.plan.unchanged} />
            <Metric label="Changed" value={preview.plan.changed} />
            <Metric label="New" value={preview.plan.newSegments} />
            <Metric label="Removed" value={preview.plan.removed} />
            <Metric label="Ambiguous" value={preview.plan.ambiguous} />
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
                    ? "New"
                    : `Old ${item.oldOrdinal + 1}`}
                  {" → "}
                  {item.newOrdinal === undefined || item.newOrdinal === null
                    ? "Removed"
                    : `New ${item.newOrdinal + 1}`}
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
  return (
    <div className="insights-archive-layout">
      <section className="insights-section insights-archive-action">
        <FolderOpen size={24} />
        <div>
          <span className="surface-kicker">Portable project</span>
          <h2>Export archive</h2>
          <p>{projectName}</p>
        </div>
        <button
          className="button primary"
          type="button"
          onClick={onExport}
          disabled={busy}
        >
          <Archive size={14} /> Export .tlcat
        </button>
      </section>
      <section className="insights-section insights-archive-action danger-zone">
        <Trash2 size={24} />
        <div>
          <span className="surface-kicker">Recoverable deletion</span>
          <h2>Recycle project</h2>
          <p>
            Project restore and purge remain available from the project home.
          </p>
        </div>
        <button
          className="button danger"
          type="button"
          onClick={onRecycle}
          disabled={busy}
        >
          <Trash2 size={14} /> Recycle project
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
  return (
    <section className="insights-section insights-history">
      <SectionHeading
        eyebrow={`${total} recorded operations`}
        title="Project history"
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
                <time>{formatDateTime(operation.createdAtMs)}</time>
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
        <UnavailableState
          label="No project operations are available."
          compact
        />
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
  return (
    <div className="insights-analysis-layout">
      <section className="insights-section analysis-controls">
        <SectionHeading
          eyebrow="Engine snapshot"
          title="Project analysis"
          icon={<FileClock size={18} />}
        />
        <label>
          <span>Analysis profile</span>
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
          Run analysis
        </button>
      </section>

      {result ? (
        <section className="insights-section analysis-results">
          <SectionHeading
            eyebrow={`${result.profileId} · revision ${result.profileRevision}`}
            title={
              result.stale ? "Stale analysis snapshot" : "Analysis snapshot"
            }
            icon={
              result.stale ? <ShieldAlert size={18} /> : <Check size={18} />
            }
          />
          <div className="analysis-summary-grid">
            <Metric label="Segments" value={result.summary.segments} />
            <Metric label="Source words" value={result.summary.sourceWords} />
            <Metric
              label="Source characters"
              value={result.summary.sourceCharacters}
            />
            <Metric
              label="Source CJK"
              value={result.summary.sourceCjkCharacters}
            />
            <Metric label="Target words" value={result.summary.targetWords} />
            <Metric
              label="Target characters"
              value={result.summary.targetCharacters}
            />
            <Metric
              label="Target CJK"
              value={result.summary.targetCjkCharacters}
            />
            <Metric
              label="Repetitions"
              value={result.summary.repeatedSegments}
            />
            <Metric
              label="Weighted effort"
              value={`${result.summary.weightedEffortMilliUnits} mU`}
            />
          </div>
          <div className="analysis-detail-grid">
            <div>
              <h3>Match bands</h3>
              <dl>
                <Definition
                  label="Exact"
                  value={result.summary.matchBands.exact}
                />
                <Definition
                  label="95-99"
                  value={result.summary.matchBands.match9599}
                />
                <Definition
                  label="85-94"
                  value={result.summary.matchBands.match8594}
                />
                <Definition
                  label="75-84"
                  value={result.summary.matchBands.match7584}
                />
                <Definition
                  label="50-74"
                  value={result.summary.matchBands.match5074}
                />
                <Definition
                  label="No match"
                  value={result.summary.matchBands.noMatch}
                />
                <Definition
                  label="Repetitions"
                  value={result.summary.matchBands.repetitions}
                />
              </dl>
            </div>
            <div>
              <h3>Workflow</h3>
              <dl>
                <Definition
                  label="Translation"
                  value={result.summary.workflowTranslation}
                />
                <Definition
                  label="Review"
                  value={result.summary.workflowReview}
                />
                <Definition
                  label="Signed"
                  value={result.summary.workflowSigned}
                />
              </dl>
            </div>
            <div>
              <h3>AI contribution</h3>
              <dl>
                <Definition
                  label="Applied"
                  value={result.summary.aiContribution.appliedSegments}
                />
                <Definition
                  label="Retained"
                  value={result.summary.aiContribution.retainedSegments}
                />
                <Definition
                  label="Replaced"
                  value={result.summary.aiContribution.replacedSegments}
                />
                <Definition
                  label="Edit distance"
                  value={result.summary.aiContribution.editDistance}
                />
              </dl>
            </div>
          </div>
        </section>
      ) : (
        <UnavailableState label="No analysis snapshot has been run in this view." />
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
            <span className="surface-kicker">Explicit action</span>
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
            Cancel
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

function formatBasisPoints(value: number): string {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 1)}%`;
}

function formatOptionalMetric(
  metric: OptionalCountMetric,
  formatter: (value: number) => string = (value) => value.toLocaleString(),
): string {
  return metric.available && metric.value !== null && metric.value !== undefined
    ? formatter(metric.value)
    : "Unavailable";
}

function formatDuration(value: number): string {
  if (value < 60_000) return `${Math.round(value / 1000)} sec`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)} min`;
  return `${(value / 3_600_000).toFixed(1)} hr`;
}

function formatMilli(value: number): string {
  return (value / 1000).toFixed(2);
}

function formatShortDate(value: number): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function safeArchiveName(value: string): string {
  return value.trim().replaceAll(/[\\/:*?"<>|]/gu, "-") || "project";
}
