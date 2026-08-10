import { useEffect, useMemo, useState } from "react";
import type { Project, Segment } from "@translunar/contracts";

import { AppChrome } from "./shell/AppChrome";
import { BootGate } from "./shell/BootGate";
import { EngineStatusBanner } from "./shell/EngineStatusBanner";
import { RecoveryDialog } from "./shell/RecoveryDialog";
import { AssetHub } from "./surfaces/AssetHub";
import { CreateProject } from "./surfaces/CreateProject";
import { ExportReview } from "./surfaces/ExportReview";
import { GlobalSearch } from "./surfaces/GlobalSearch";
import { ImportDocument } from "./surfaces/ImportDocument";
import { ProjectHome } from "./surfaces/ProjectHome";
import { ProjectInsights } from "./surfaces/ProjectInsights";
import { QaReview } from "./surfaces/QaReview";
import { RecycleBin } from "./surfaces/RecycleBin";
import { Templates } from "./surfaces/Templates";
import { Welcome } from "./surfaces/Welcome";
import { Workbench } from "./surfaces/Workbench";
import { useAppController } from "./state/use-app-controller";
import { useAssetController } from "./state/use-asset-controller";
import { useEditorOperations } from "./state/use-editor-operations";
import { useInteropController } from "./state/use-interop-controller";
import { usePdfReview } from "./state/use-pdf-review";
import { useReimportController } from "./state/use-reimport-controller";
import { useTaskPackageController } from "./state/use-task-package-controller";

export function App() {
  const { state, saveCoordinator, featureGeneration, commands } =
    useAppController();
  const { surface } = state;
  const disabled = !state.mutationsEnabled;

  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);

  /** Editor chrome and keyboard ownership is Workbench-only (not QA/Export/Home). */
  const workbenchCtx = surface.kind === "workbench" ? surface.ctx : null;
  const workbenchActive = surface.kind === "workbench";

  const editorGateway = useMemo(
    () => ({
      generation: featureGeneration,
      mutationsEnabled: state.mutationsEnabled,
      workbenchActive,
      ctx: workbenchCtx,
      activeSegmentId:
        surface.kind === "workbench" ? surface.activeSegmentId : null,
      focusSegmentId:
        surface.kind === "workbench" ? surface.focusSegmentId : null,
      selectedSegmentIds,
      saveCoordinator,
      flushOrStay: commands.flushOrStay,
      commitWorkbenchRows: (input: {
        rows: NonNullable<typeof workbenchCtx>["rows"];
        counts: NonNullable<typeof workbenchCtx>["counts"];
        activeSegmentId: string | null;
        focusSegmentId: string | null;
        needsRefresh: boolean;
      }) => {
        commands.applyWorkbenchRows({
          rows: input.rows,
          counts: input.counts,
          activeSegmentId: input.activeSegmentId,
          focusSegmentId: input.focusSegmentId,
        });
        return Promise.resolve();
      },
      refreshActiveDocumentRows: async (focusSegmentId?: string | null) => {
        await commands.refreshWorkbenchRows(focusSegmentId);
      },
    }),
    [
      commands,
      featureGeneration,
      saveCoordinator,
      selectedSegmentIds,
      state.mutationsEnabled,
      surface,
      workbenchActive,
      workbenchCtx,
    ],
  );

  const editorOps = useEditorOperations(editorGateway);

  useEffect(() => {
    editorOps.invalidate();
  }, [featureGeneration]);

  // Reset multi-select when document changes
  useEffect(() => {
    setSelectedSegmentIds([]);
  }, [workbenchCtx?.document.id]);

  const assetsGateway = useMemo(() => {
    if (surface.kind !== "assets") {
      return {
        generation: featureGeneration,
        mutationsEnabled: false,
        projectId: "",
        projectName: "",
        sourceLocale: "en",
        targetLocale: "zh",
        section: "tm" as const,
      };
    }
    return {
      generation: featureGeneration,
      mutationsEnabled: state.mutationsEnabled,
      projectId: surface.projectId,
      projectName: surface.projectName,
      sourceLocale: surface.sourceLocale,
      targetLocale: surface.targetLocale,
      section: surface.section,
    };
  }, [featureGeneration, state.mutationsEnabled, surface]);

  const assets = useAssetController(assetsGateway);

  useEffect(() => {
    assets.invalidate();
  }, [featureGeneration]);

  const pdfGateway = useMemo(
    () => ({
      generation: featureGeneration,
      mutationsEnabled: state.mutationsEnabled,
      documentId: workbenchCtx?.document.id ?? null,
      activeSegmentId:
        surface.kind === "workbench" ? surface.activeSegmentId : null,
      flushOrStay: commands.flushOrStay,
      onSegmentCorrected: async (segment: Segment) => {
        await commands.refreshWorkbenchRows(segment.id);
      },
    }),
    [
      commands,
      featureGeneration,
      state.mutationsEnabled,
      surface,
      workbenchCtx?.document.id,
    ],
  );
  const pdfReview = usePdfReview(pdfGateway);

  useEffect(() => {
    pdfReview.invalidate();
  }, [featureGeneration]);

  const reimportGateway = useMemo(
    () => ({
      generation: featureGeneration,
      mutationsEnabled: state.mutationsEnabled,
      documentId: workbenchCtx?.document.id ?? null,
      documentRevision: workbenchCtx?.document.revision ?? 0,
      flushOrStay: commands.flushOrStay,
      onApplied: async () => {
        await commands.refreshWorkbenchRows();
      },
    }),
    [
      commands,
      featureGeneration,
      state.mutationsEnabled,
      workbenchCtx?.document.id,
      workbenchCtx?.document.revision,
    ],
  );
  const reimport = useReimportController(reimportGateway);

  useEffect(() => {
    reimport.invalidate();
  }, [featureGeneration]);

  const insightsProjectId =
    surface.kind === "insights" ? surface.projectId : "";
  const workbenchProject =
    surface.kind === "workbench" ? surface.ctx.project : null;

  const interopGateway = useMemo(() => {
    const projectId =
      insightsProjectId || workbenchProject?.id || "";
    const document =
      surface.kind === "workbench"
        ? surface.ctx.document
        : surface.kind === "insights" && surface.documents[0]
          ? surface.documents[0]
          : null;
    return {
      generation: featureGeneration,
      mutationsEnabled:
        state.mutationsEnabled && surface.kind === "insights",
      projectId,
      projectRevision: workbenchProject?.revision ?? 1,
      documentId: document?.id ?? null,
      documentRevision: document?.revision ?? 1,
      ...(workbenchProject?.sourceLocale
        ? { sourceLocale: workbenchProject.sourceLocale }
        : {}),
      ...(workbenchProject?.targetLocale
        ? { targetLocale: workbenchProject.targetLocale }
        : {}),
      flushOrStay: commands.flushOrStay,
      onReviewApplied: async () => {
        await commands.refreshInsights();
      },
      onTableApplied: async () => {
        /* library reload handled in controller */
      },
    };
  }, [
    commands,
    featureGeneration,
    insightsProjectId,
    state.mutationsEnabled,
    surface,
    workbenchProject,
  ]);
  const interop = useInteropController(interopGateway);

  useEffect(() => {
    interop.invalidate();
  }, [featureGeneration]);

  const taskPackageGateway = useMemo(() => {
    const documents =
      surface.kind === "workbench"
        ? surface.ctx.documents
        : surface.kind === "insights"
          ? surface.documents
          : [];
    const projectId =
      workbenchProject?.id ??
      (insightsProjectId !== "" ? insightsProjectId : null);
    return {
      generation: featureGeneration,
      mutationsEnabled:
        state.mutationsEnabled && surface.kind === "insights",
      projectId,
      projectRevision: workbenchProject?.revision ?? 1,
      hasDocuments: documents.length > 0,
      hasTaskPackageRef: Boolean(
        workbenchProject?.configuration?.taskPackage,
      ),
      flushOrStay: commands.flushOrStay,
      onApplied: async () => {
        await commands.refreshInsights();
      },
      onImported: async (imported: Project) => {
        await commands.openProject(imported.id);
      },
    };
  }, [
    commands,
    featureGeneration,
    insightsProjectId,
    state.mutationsEnabled,
    surface,
    workbenchProject,
  ]);
  const taskPackage = useTaskPackageController(taskPackageGateway);

  useEffect(() => {
    taskPackage.invalidate();
  }, [featureGeneration]);

  return (
    <div className="app-root">
      <AppChrome
        state={state}
        onHome={() => void commands.goHome()}
        onSearch={() => void commands.goSearch()}
        onQa={() => void commands.goQa()}
        onExport={() => void commands.goExport()}
        onInsights={() => void commands.goInsights()}
        onAssets={() => void commands.goAssets()}
      />
      <div className="app-banner-slot">
        <EngineStatusBanner
          status={state.engineStatus}
          message={state.engineMessage}
          {...(state.engineStatus === "failed" ||
          state.engineStatus === "disconnected"
            ? {
                onRetry: () => commands.retryBoot(),
                onRestart: () => {
                  void commands.restartEngine();
                },
              }
            : {})}
        />
      </div>
      <main className="app-stage">
        {surface.kind === "boot" ? (
          <BootGate
            {...(surface.message ? { message: surface.message } : {})}
            error={surface.error ?? state.bootError ?? null}
            onRetry={() => commands.retryBoot()}
            onRestart={() => {
              void commands.restartEngine();
            }}
          />
        ) : null}

        {surface.kind === "recovery" ? (
          <RecoveryDialog
            mode={surface.mode}
            {...(surface.reason ? { reason: surface.reason } : {})}
            error={surface.error ?? null}
            {...(surface.mode === "recoverable"
              ? {
                  onRecover: () => {
                    void commands.recoverDraft();
                  },
                }
              : {})}
            onDiscard={() => {
              void commands.discardDraft();
            }}
            {...(surface.mode === "stale"
              ? { onRetry: () => commands.retryBoot() }
              : {})}
          />
        ) : null}

        {surface.kind === "welcome" ? (
          <Welcome
            onCreate={commands.goCreateProject}
            onOpenExample={() => {
              void commands.openExample();
            }}
            pendingExample={surface.pendingExample === true}
            error={surface.error ?? null}
            disabled={disabled}
          />
        ) : null}

        {surface.kind === "projects" ? (
          <ProjectHome
            projects={surface.projects}
            lifecycle={surface.lifecycle}
            total={surface.total}
            offset={surface.offset}
            limit={surface.limit}
            error={surface.error ?? null}
            actionError={surface.actionError ?? null}
            loading={surface.loading ?? false}
            pendingExample={surface.pendingExample === true}
            disabled={disabled}
            onOpen={(id) => {
              void commands.openProject(id);
            }}
            onCreate={commands.goCreateProject}
            onOpenExample={() => {
              void commands.openExample();
            }}
            onLifecycleFilter={(lifecycle) => {
              void commands.setProjectListLifecycle(lifecycle);
            }}
            onPage={(offset) => {
              void commands.projectsPage(offset);
            }}
            onGoTemplates={() => {
              void commands.goTemplates();
            }}
            onGoRecycle={() => {
              void commands.goRecycle();
            }}
            onBeginEdit={commands.beginEditProject}
            onUpdateProject={commands.updateProject}
            onSetLifecycle={commands.setProjectLifecycle}
            onRecycleProject={commands.recycleProject}
            onInsights={(projectId) => {
              void commands.goInsights(projectId);
            }}
            onAssets={(projectId) => {
              void commands.goAssets(projectId);
            }}
          />
        ) : null}

        {surface.kind === "create-project" ? (
          <CreateProject
            pending={surface.pending ?? false}
            error={surface.error ?? null}
            disabled={disabled}
            onSubmit={(input) => {
              void commands.createProject(input);
            }}
            onCancel={() => {
              void commands.goHome();
            }}
          />
        ) : null}

        {surface.kind === "import-document" ? (
          <ImportDocument
            projectName={surface.projectName}
            pending={surface.pending ?? false}
            error={surface.error ?? null}
            batchResult={surface.batchResult ?? null}
            templateDiagnostics={surface.templateDiagnostics ?? null}
            disabled={disabled}
            onImport={() => {
              void commands.importDocument();
            }}
            onDismissBatch={commands.dismissBatchSummary}
          />
        ) : null}

        {surface.kind === "workbench" ? (
          <Workbench
            ctx={surface.ctx}
            activeSegmentId={surface.activeSegmentId}
            focusSegmentId={surface.focusSegmentId}
            editState={saveCoordinator.active}
            tmMatches={surface.tmMatches}
            tmLoading={surface.tmLoading}
            tmError={surface.tmError}
            tmCollapsed={surface.tmCollapsed}
            transitionError={surface.transitionError}
            pendingConfirm={surface.pendingConfirm}
            switchPending={surface.switchPending === true}
            addFilesPending={surface.addFilesPending === true}
            batchResult={surface.batchResult ?? null}
            disabled={disabled}
            editorOps={editorOps}
            pdfReview={pdfReview}
            reimport={reimport}
            selectedSegmentIds={selectedSegmentIds}
            onToggleSelect={(id) => {
              setSelectedSegmentIds((prev) => {
                if (prev.includes(id)) return prev.filter((x) => x !== id);
                const next = [...prev, id];
                return next.slice(-2);
              });
            }}
            onSelectSegment={(id) => {
              setSelectedSegmentIds([id]);
              void commands.selectSegment(id);
            }}
            onDraftChange={commands.updateTargetDraft}
            onCompositionStart={commands.compositionStart}
            onCompositionEnd={commands.compositionEnd}
            onConfirm={(ev) => {
              void commands.confirmSegment(ev);
            }}
            onToggleTm={commands.toggleTmPanel}
            onQa={() => {
              void commands.goQa();
            }}
            onExport={() => {
              void commands.goExport();
            }}
            onInsights={() => {
              void commands.goInsights();
            }}
            onAssets={() => {
              void commands.goAssets();
            }}
            onSwitchDocument={(id) => {
              void commands.switchDocument(id);
            }}
            onAddFiles={() => {
              void commands.addFiles();
            }}
            onRecycleDocument={commands.recycleActiveDocument}
            onDismissBatch={commands.dismissBatchSummary}
          />
        ) : null}

        {surface.kind === "qa" ? (
          <QaReview
            ctx={surface.ctx}
            issues={surface.issues}
            issuesLoaded={surface.issuesLoaded}
            run={surface.run}
            loading={surface.loading}
            error={surface.error}
            disabled={disabled}
            onRun={() => {
              void commands.runQa();
            }}
            onJump={(id) => {
              void commands.jumpToIssue(id);
            }}
            onBack={() => {
              void commands.backToWorkbench();
            }}
            onExport={() => {
              void commands.goExport();
            }}
          />
        ) : null}

        {surface.kind === "export" ? (
          <ExportReview
            ctx={surface.ctx}
            gate={surface.gate}
            loading={surface.loading}
            exporting={surface.exporting}
            error={surface.error}
            resultPath={surface.resultPath}
            disabled={disabled}
            onExport={() => {
              void commands.checkGateAndExport();
            }}
            onBack={() => {
              void commands.backToWorkbench();
            }}
            onQa={() => {
              void commands.goQa();
            }}
          />
        ) : null}

        {surface.kind === "templates" ? (
          <Templates
            items={surface.items}
            total={surface.total}
            offset={surface.offset}
            limit={surface.limit}
            loading={surface.loading}
            error={surface.error}
            pending={surface.pending}
            selected={surface.selected}
            mode={surface.mode}
            disabled={disabled}
            onBack={() => {
              void commands.goHome();
            }}
            onPage={(offset) => {
              void commands.templatesPage(offset);
            }}
            onCreateStart={commands.templateCreateStart}
            onEditStart={(id, rev) => {
              void commands.templateEditStart(id, rev);
            }}
            onUseStart={(id, rev) => {
              void commands.templateUseStart(id, rev);
            }}
            onCancelMode={commands.templateCancelMode}
            onCreate={(input) => {
              void commands.templateCreate(input);
            }}
            onUpdate={(input) => {
              void commands.templateUpdate(input);
            }}
            onDelete={(id, rev) => commands.templateDelete(id, rev)}
            onCreateFromTemplate={(input) => {
              void commands.createFromTemplate(input);
            }}
          />
        ) : null}

        {surface.kind === "recycle" ? (
          <RecycleBin
            items={surface.items}
            total={surface.total}
            offset={surface.offset}
            limit={surface.limit}
            loading={surface.loading}
            error={surface.error}
            pending={surface.pending}
            disabled={disabled}
            onBack={() => {
              void commands.goHome();
            }}
            onPage={(offset) => {
              void commands.recyclePage(offset);
            }}
            onRestore={commands.recycleRestore}
            onPurge={commands.recyclePurge}
          />
        ) : null}

        {surface.kind === "search" ? (
          <GlobalSearch
            submittedQuery={surface.submittedQuery}
            pendingQuery={surface.pendingQuery}
            items={surface.items}
            total={surface.total}
            offset={surface.offset}
            limit={surface.limit}
            loading={surface.loading}
            error={surface.error}
            navigationError={surface.navigationError}
            disabled={disabled}
            onSearch={(query) => {
              void commands.runSearch(query);
            }}
            onPage={(offset) => {
              void commands.searchPage(offset);
            }}
            onActivate={(hit) => {
              void commands.activateSearchHit(hit);
            }}
          />
        ) : null}

        {surface.kind === "insights" ? (
          <ProjectInsights
            projectName={surface.projectName}
            analytics={surface.analytics}
            documents={surface.documents}
            loading={surface.loading}
            error={surface.error}
            disabled={disabled}
            interop={interop}
            taskPackage={taskPackage}
            hasDocument={
              surface.documents.length > 0 ||
              Boolean(surface.session?.documentId)
            }
            onBack={() => {
              void commands.backFromInsights();
            }}
            onRetry={() => {
              void commands.refreshInsights();
            }}
          />
        ) : null}

        {surface.kind === "assets" ? (
          <AssetHub
            assets={assets}
            disabled={disabled}
            onBack={() => {
              void commands.backFromAssets();
            }}
            onSectionChange={(section) => {
              commands.setAssetsSection(section);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
