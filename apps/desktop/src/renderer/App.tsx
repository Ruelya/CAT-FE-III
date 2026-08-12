import { useEffect, useMemo, useState } from "react";
import type { Project, Segment } from "@translunar/contracts";

import { AppChrome } from "./shell/AppChrome";
import { BootGate } from "./shell/BootGate";
import { CommandPalette } from "./shell/CommandPalette";
import type { PaletteCommand } from "./shell/command-palette-model";
import { EngineStatusBanner } from "./shell/EngineStatusBanner";
import { RecoveryDialog } from "./shell/RecoveryDialog";
import { useCommandPalette } from "./shell/use-command-palette";
import { useSurfaceAnnouncement } from "./shell/use-surface-announcement";
import { useWindowChrome } from "./shell/use-window-chrome";
import {
  collaborationAvailable,
  resolveP4RouteContext,
} from "./state/p4-route-context";
import { AiControl } from "./surfaces/AiControl";
import { AssetHub } from "./surfaces/AssetHub";
import { Collaboration } from "./surfaces/Collaboration";
import { CreateProject } from "./surfaces/CreateProject";
import { ExportReview } from "./surfaces/ExportReview";
import { GlobalSearch } from "./surfaces/GlobalSearch";
import { ImportDocument } from "./surfaces/ImportDocument";
import { Plugins } from "./surfaces/Plugins";
import { ProductSettings } from "./surfaces/ProductSettings";
import { ProjectHome } from "./surfaces/ProjectHome";
import { ProjectInsights } from "./surfaces/ProjectInsights";
import { QaReview } from "./surfaces/QaReview";
import { RecycleBin } from "./surfaces/RecycleBin";
import { Templates } from "./surfaces/Templates";
import { Welcome } from "./surfaces/Welcome";
import { Workbench } from "./surfaces/Workbench";
import { EDITOR_COMMAND_REGISTRY } from "./state/editor-operations";
import { useAiController } from "./state/use-ai-controller";
import { useAppController } from "./state/use-app-controller";
import { useAssetController } from "./state/use-asset-controller";
import { useCollaborationController } from "./state/use-collaboration-controller";
import { useEditorOperations } from "./state/use-editor-operations";
import { useInteropController } from "./state/use-interop-controller";
import { usePdfReview } from "./state/use-pdf-review";
import { usePluginController } from "./state/use-plugin-controller";
import { useProductSettings } from "./state/use-product-settings";
import { useReimportController } from "./state/use-reimport-controller";
import { useTaskPackageController } from "./state/use-task-package-controller";

export function App() {
  const { state, saveCoordinator, featureGeneration, commands } =
    useAppController();
  const windowChrome = useWindowChrome();
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
    const projectId = insightsProjectId || workbenchProject?.id || "";
    const document =
      surface.kind === "workbench"
        ? surface.ctx.document
        : surface.kind === "insights" && surface.documents[0]
          ? surface.documents[0]
          : null;
    return {
      generation: featureGeneration,
      mutationsEnabled: state.mutationsEnabled && surface.kind === "insights",
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
      mutationsEnabled: state.mutationsEnabled && surface.kind === "insights",
      projectId,
      projectRevision: workbenchProject?.revision ?? 1,
      hasDocuments: documents.length > 0,
      hasTaskPackageRef: Boolean(workbenchProject?.configuration?.taskPackage),
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

  const aiGateway = useMemo(
    () => ({
      generation: featureGeneration,
      mutationsEnabled: state.mutationsEnabled,
      active: surface.kind === "ai-control",
      context: surface.kind === "ai-control" ? surface.context : null,
      section: surface.kind === "ai-control" ? surface.section : "providers",
    }),
    [featureGeneration, state.mutationsEnabled, surface],
  );
  const ai = useAiController(aiGateway);
  useEffect(() => {
    ai.invalidate();
  }, [featureGeneration]);

  const pluginGateway = useMemo(
    () => ({
      generation: featureGeneration,
      mutationsEnabled: state.mutationsEnabled,
      active: surface.kind === "plugins",
      context: surface.kind === "plugins" ? surface.context : null,
      section: surface.kind === "plugins" ? surface.section : "installed",
    }),
    [featureGeneration, state.mutationsEnabled, surface],
  );
  const plugins = usePluginController(pluginGateway);
  useEffect(() => {
    plugins.invalidate();
  }, [featureGeneration]);

  const collabGateway = useMemo(() => {
    if (surface.kind !== "collaboration") {
      return {
        generation: featureGeneration,
        mutationsEnabled: false,
        active: false,
        section: "members" as const,
        context: {
          projectId: "",
          projectName: "",
          documentId: null,
          activeSegmentId: null,
          session: null,
        },
      };
    }
    return {
      generation: featureGeneration,
      mutationsEnabled: state.mutationsEnabled,
      active: true,
      section: surface.section,
      context: surface.context,
    };
  }, [featureGeneration, state.mutationsEnabled, surface]);
  const collab = useCollaborationController(collabGateway);
  useEffect(() => {
    collab.invalidate();
  }, [featureGeneration]);

  const settingsGateway = useMemo(
    () => ({
      generation: featureGeneration,
      mutationsEnabled: state.mutationsEnabled,
      active: surface.kind === "settings",
      section: surface.kind === "settings" ? surface.section : "locale",
      // Migration keeps the retained return identity and rehydrates from Engine.
      onMigrationCommitted: () => {
        void commands.backFromP4();
      },
      // Restore must cold-route: abandon session + feature work, then shell home.
      onRestoreCommitted: () => {
        void commands.coldRouteAfterRestore();
      },
    }),
    [commands, featureGeneration, state.mutationsEnabled, surface],
  );
  const productSettings = useProductSettings(settingsGateway);
  useEffect(() => {
    productSettings.invalidate();
  }, [featureGeneration]);

  const startupResolved =
    surface.kind !== "boot" && surface.kind !== "recovery";
  const palette = useCommandPalette(startupResolved && !disabled);
  const announcement = useSurfaceAnnouncement(state);

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    if (!startupResolved) return [];
    const p4 = resolveP4RouteContext(surface);
    const sessionScoped =
      surface.kind === "workbench" ||
      surface.kind === "qa" ||
      surface.kind === "export";
    const projectScoped =
      sessionScoped || surface.kind === "insights" || surface.kind === "assets";

    // Only destinations that are valid right now: the palette must not become
    // a way to reach a surface the chrome deliberately hides.
    const entries: Array<PaletteCommand | null> = [
      {
        id: "go.home",
        label: "Go to Projects",
        group: "Navigate",
        keywords: "home project list",
        run: () => void commands.goHome(),
      },
      {
        id: "go.search",
        label: "Search segments",
        group: "Navigate",
        keywords: "find global",
        run: () => void commands.goSearch(),
      },
      {
        id: "go.templates",
        label: "Open Templates",
        group: "Navigate",
        run: () => void commands.goTemplates(),
      },
      {
        id: "go.recycle",
        label: "Open Recycle",
        group: "Navigate",
        keywords: "trash deleted",
        run: () => void commands.goRecycle(),
      },
      projectScoped
        ? {
            id: "go.insights",
            label: "Open Insights",
            group: "Navigate",
            keywords: "analytics interop",
            run: () => void commands.goInsights(),
          }
        : null,
      projectScoped
        ? {
            id: "go.assets",
            label: "Open Assets",
            group: "Navigate",
            keywords: "tm termbase corpus alignment",
            run: () => void commands.goAssets(),
          }
        : null,
      surface.kind === "qa" || surface.kind === "export"
        ? {
            id: "go.workbench",
            label: "Go to Workbench",
            group: "Navigate",
            keywords: "editor segments",
            run: () => void commands.backToWorkbench(),
          }
        : null,
      sessionScoped
        ? {
            id: "go.qa",
            label: "Open QA",
            group: "Navigate",
            keywords: "quality issues check",
            run: () => void commands.goQa(),
          }
        : null,
      sessionScoped
        ? {
            id: "go.export",
            label: "Open Export",
            group: "Navigate",
            keywords: "deliver output docx",
            run: () => void commands.goExport(),
          }
        : null,
      {
        id: "go.ai",
        label: "Open AI Control",
        group: "Navigate",
        keywords: "providers profiles usage",
        run: () => void commands.goAiControl(),
      },
      {
        id: "go.plugins",
        label: "Open Plugins",
        group: "Navigate",
        keywords: "extensions connectors permissions",
        run: () => void commands.goPlugins(),
      },
      collaborationAvailable(p4)
        ? {
            id: "go.collaboration",
            label: "Open Collaboration",
            group: "Navigate",
            keywords: "members presence assignments",
            run: () => void commands.goCollaboration(),
          }
        : null,
      {
        id: "go.settings",
        label: "Open Settings",
        group: "Navigate",
        keywords: "preferences locale appearance data updates",
        run: () => void commands.goSettings(),
      },
      {
        id: "project.create",
        label: "Create project",
        group: "Project",
        keywords: "new",
        run: () => commands.goCreateProject(),
      },
      {
        id: "project.example",
        label: "Open example project",
        group: "Project",
        keywords: "sample demo",
        run: () => void commands.openExample(),
      },
      {
        id: "view.appearance",
        label: "Change theme and accent",
        group: "View",
        keywords: "dark light colour color appearance",
        run: () => void commands.goSettings("appearance"),
      },
    ];

    const navigation = entries.filter(
      (entry): entry is PaletteCommand => entry !== null,
    );

    // Editor commands come from the single editor registry, so the palette can
    // never drift from the command bar or invent an unavailable action.
    const editorCommands: PaletteCommand[] =
      surface.kind === "workbench"
        ? EDITOR_COMMAND_REGISTRY.filter((command) =>
            editorOps.isAvailable(command.id),
          ).map((command) => ({
            id: `editor.${command.id}`,
            label: command.label,
            group: "Editor" as const,
            ...(command.shortcut ? { hint: command.shortcut } : {}),
            run: () => editorOps.runCommand(command.id),
          }))
        : [];

    return [...navigation, ...editorCommands];
  }, [commands, editorOps, startupResolved, surface]);

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
        onAiControl={() => void commands.goAiControl()}
        onPlugins={() => void commands.goPlugins()}
        onCollaboration={() => void commands.goCollaboration()}
        onSettings={() => void commands.goSettings()}
        {...(startupResolved ? { onCommandPalette: palette.openPalette } : {})}
        windowChromePlatform={windowChrome.platform}
        windowMaximized={windowChrome.maximized}
        onWindowMinimize={windowChrome.minimize}
        onWindowToggleMaximize={windowChrome.toggleMaximize}
        onWindowClose={windowChrome.close}
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
        {/* M1: keying on the surface kind replays the enter animation on every
            route change without remounting on sub-state changes. */}
        <div className="app-stage__view surface-enter" key={surface.kind}>
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

          {surface.kind === "ai-control" ? (
            <AiControl
              ai={ai}
              section={surface.section}
              context={surface.context}
              disabled={disabled}
              onBack={() => {
                void commands.backFromP4();
              }}
              onSectionChange={(section) => {
                commands.setAiControlSection(section);
              }}
            />
          ) : null}

          {surface.kind === "plugins" ? (
            <Plugins
              plugins={plugins}
              section={surface.section}
              disabled={disabled}
              onBack={() => {
                void commands.backFromP4();
              }}
              onSectionChange={(section) => {
                commands.setPluginsSection(section);
              }}
            />
          ) : null}

          {surface.kind === "collaboration" ? (
            <Collaboration
              collab={collab}
              section={surface.section}
              context={surface.context}
              disabled={disabled}
              onBack={() => {
                void commands.backFromP4();
              }}
              onSectionChange={(section) => {
                commands.setCollaborationSection(section);
              }}
            />
          ) : null}

          {surface.kind === "settings" ? (
            <ProductSettings
              settings={productSettings}
              section={surface.section}
              disabled={disabled}
              onBack={() => {
                void commands.backFromP4();
              }}
              onSectionChange={(section) => {
                commands.setSettingsSection(section);
              }}
            />
          ) : null}
        </div>
      </main>

      {/* Route announcement stays mounted so a change is spoken without
          stealing focus from the heading the transition just focused. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement.message}
      </p>

      {palette.open ? (
        <CommandPalette
          commands={paletteCommands}
          onClose={palette.closePalette}
        />
      ) : null}
    </div>
  );
}
