import { AppChrome } from "./shell/AppChrome";
import { BootGate } from "./shell/BootGate";
import { EngineStatusBanner } from "./shell/EngineStatusBanner";
import { RecoveryDialog } from "./shell/RecoveryDialog";
import { CreateProject } from "./surfaces/CreateProject";
import { ExportReview } from "./surfaces/ExportReview";
import { ImportDocument } from "./surfaces/ImportDocument";
import { ProjectHome } from "./surfaces/ProjectHome";
import { QaReview } from "./surfaces/QaReview";
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
        onQa={() => void commands.goQa()}
        onExport={() => void commands.goExport()}
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
          <Welcome onCreate={commands.goCreateProject} disabled={disabled} />
        ) : null}

        {surface.kind === "projects" ? (
          <ProjectHome
            projects={surface.projects}
            error={surface.error ?? null}
            loading={surface.loading ?? false}
            disabled={disabled}
            onOpen={(id) => {
              void commands.openProject(id);
            }}
            onCreate={commands.goCreateProject}
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
            disabled={disabled}
            onImport={() => {
              void commands.importDocument();
            }}
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
      </main>
    </div>
  );
}
