import { AppChrome } from "./shell/AppChrome";
import { BootGate } from "./shell/BootGate";
import { EngineStatusBanner } from "./shell/EngineStatusBanner";
import { RecoveryDialog } from "./shell/RecoveryDialog";
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

export function App() {
  const { state, saveCoordinator, commands } = useAppController();
  const { surface } = state;
  const disabled = !state.mutationsEnabled;

  return (
    <div className="app-root">
      <AppChrome
        state={state}
        onHome={() => void commands.goHome()}
        onSearch={() => void commands.goSearch()}
        onQa={() => void commands.goQa()}
        onExport={() => void commands.goExport()}
        onInsights={() => void commands.goInsights()}
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
            onSelectSegment={(id) => {
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
            onBack={() => {
              void commands.backFromInsights();
            }}
            onRetry={() => {
              void commands.refreshInsights();
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
