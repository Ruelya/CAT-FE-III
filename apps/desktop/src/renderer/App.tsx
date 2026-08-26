import { useCallback, useEffect, useState } from "react";

import type { Project } from "@translunar/contracts";
import { SegmentProgress, StatusDot } from "@translunar/ui";

import type {
  EngineLifecycleState,
  EngineStatusPayload,
} from "../shared/desktop-api.js";
import { EngineGate } from "./components/EngineGate.js";
import { ProjectSettingsDialog } from "./components/ProjectSettingsDialog.js";
import { TmManageDialog } from "./components/TmManageDialog.js";
import { ProjectsView } from "./views/ProjectsView.js";
import { WorkbenchView } from "./views/WorkbenchView.js";
import type { WorkbenchStats } from "./views/WorkbenchView.js";

type EngineDotState = "ok" | "busy" | "down";

function dotState(status: EngineStatusPayload | null): EngineDotState {
  if (!status) {
    return "busy";
  }
  switch (status.state) {
    case "ready":
      return "ok";
    case "down":
      return "down";
    default:
      return "busy";
  }
}

function engineLabel(status: EngineStatusPayload | null): string {
  if (!status) {
    return "engine: 连接中";
  }
  switch (status.state) {
    case "ready":
      return `engine ${status.engineVersion ?? ""} · pid ${status.pid ?? "?"}`;
    case "starting":
      return "engine: 启动中";
    case "restarting":
      return `engine: 重启中 (${status.restarts})`;
    case "down":
      return `engine: 已停止${status.lastError ? `：${status.lastError}` : ""}`;
  }
}

export function App() {
  const [engineStatus, setEngineStatus] = useState<EngineStatusPayload | null>(
    null,
  );
  const [relaunching, setRelaunching] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [tmManageOpen, setTmManageOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    "Translunar CAT 就绪",
  );
  // Live document stats reported by the workbench; the status bar shows
  // them as first-class chrome so progress never hides inside a panel.
  const [workbenchStats, setWorkbenchStats] = useState<WorkbenchStats | null>(
    null,
  );

  useEffect(() => {
    let disposed = false;
    void window.tl.engineStatus().then((status) => {
      if (!disposed) {
        setEngineStatus(status);
      }
    });
    const unsubscribe = window.tl.onEngineStatus((status) => {
      setEngineStatus(status);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  // Single writer of the menu context: the application menu enables items
  // only for state that is actually open (no project -> almost everything
  // disabled; workbench reports document state via onDocumentOpenChange).
  useEffect(() => {
    window.tl.setMenuContext({
      projectOpen: project !== null,
      documentOpen: project !== null && documentOpen,
    });
  }, [project, documentOpen]);

  // Window title reports the working object: project — document — langs.
  // Real data only: the project in memory and the workbench-reported
  // document name; no project means the bare app name.
  useEffect(() => {
    if (!project) {
      document.title = "Translunar";
      return;
    }
    const langs = `(${project.sourceLocale} → ${project.targetLocale})`;
    const documentName = workbenchStats?.documentName;
    document.title = documentName
      ? `${project.name} — ${documentName} ${langs}`
      : `${project.name} ${langs}`;
  }, [project, workbenchStats?.documentName]);

  // Shell-level menu commands; workbench-level ones are handled inside
  // WorkbenchView. Both go through the same actions as the ribbon buttons.
  // The menu disables these without a project, but guard anyway so a stray
  // command can never queue a settings dialog for a future project.
  useEffect(() => {
    return window.tl.onMenuCommand((command) => {
      if (command === "open-project-settings") {
        if (project) {
          setSettingsOpen(true);
        }
      } else if (command === "close-project") {
        setSettingsOpen(false);
        setProject(null);
      }
    });
  }, [project]);

  const handleStatusMessage = useCallback((message: string) => {
    setStatusMessage(message);
  }, []);

  const handleRelaunch = useCallback(async () => {
    setRelaunching(true);
    try {
      const status = await window.tl.relaunchEngine();
      setEngineStatus(status);
    } finally {
      setRelaunching(false);
    }
  }, []);

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleOpenTmManage = useCallback(() => setTmManageOpen(true), []);
  const handleCloseProject = useCallback(() => {
    setSettingsOpen(false);
    setTmManageOpen(false);
    setProject(null);
  }, []);

  // Before the first status fetch resolves, assume the engine is still
  // starting rather than pretending it is ready.
  const engineState: EngineLifecycleState = engineStatus?.state ?? "starting";
  const engineReady = engineState === "ready";

  return (
    <div className="app-shell">
      {/* display:contents wrapper: keeps the grid layout intact while
          `inert` blocks focus and input in the whole surface whenever the
          engine cannot acknowledge writes. */}
      <div className="app-main" inert={!engineReady}>
        {project ? (
          <WorkbenchView
            project={project}
            engineState={engineState}
            onStatusMessage={handleStatusMessage}
            onDocumentOpenChange={setDocumentOpen}
            onProjectUpdated={setProject}
            onStatsChange={setWorkbenchStats}
            onOpenSettings={handleOpenSettings}
            onOpenTmManage={handleOpenTmManage}
            onCloseProject={handleCloseProject}
          />
        ) : (
          <ProjectsView
            engineState={engineState}
            onOpenProject={setProject}
            onStatusMessage={handleStatusMessage}
          />
        )}

        {project ? (
          <ProjectSettingsDialog
            open={settingsOpen}
            project={project}
            onClose={() => setSettingsOpen(false)}
            onProjectUpdated={setProject}
          />
        ) : null}
        {project ? (
          <TmManageDialog
            open={tmManageOpen}
            project={project}
            onClose={() => setTmManageOpen(false)}
          />
        ) : null}
      </div>

      <footer className="app-statusbar">
        {/* Messages replace silently; a readout strip never animates. */}
        <span className="app-statusbar__message">{statusMessage}</span>
        <span className="app-statusbar__stats">
          {workbenchStats ? (
            <>
              <span className="app-statusbar__stat" title="当前句段 / 总句段">
                句段{" "}
                <span className="tl-num">
                  {workbenchStats.activeOrdinal !== null
                    ? `${workbenchStats.activeOrdinal + 1}/${workbenchStats.counts.total}`
                    : workbenchStats.counts.total}
                </span>
              </span>
              <span className="app-statusbar__stat" title="已确认句段">
                已确认{" "}
                <span className="tl-num">
                  {workbenchStats.counts.confirmed}
                </span>
              </span>
              {workbenchStats.counts.draft > 0 ? (
                <span className="app-statusbar__stat" title="草稿句段">
                  草稿{" "}
                  <span className="tl-num">{workbenchStats.counts.draft}</span>
                </span>
              ) : null}
              <span className="app-statusbar__stat" title="未译句段">
                剩余{" "}
                <span className="tl-num">
                  {workbenchStats.counts.untranslated}
                </span>
              </span>
              {workbenchStats.counts.openIssues > 0 ? (
                <span
                  className="app-statusbar__stat"
                  data-tone="danger"
                  title="未解决 QA 问题"
                >
                  QA{" "}
                  <span className="tl-num">
                    {workbenchStats.counts.openIssues}
                  </span>
                </span>
              ) : null}
              <span className="app-statusbar__progress">
                <SegmentProgress
                  total={workbenchStats.counts.total}
                  confirmed={workbenchStats.counts.confirmed}
                  draft={workbenchStats.counts.draft}
                  label={`已确认 ${workbenchStats.counts.confirmed}/${workbenchStats.counts.total}`}
                />
                {/* No placeholder glyphs: an empty total renders nothing. */}
                {workbenchStats.counts.total > 0 ? (
                  <span className="tl-num">
                    {Math.round(
                      (workbenchStats.counts.confirmed /
                        workbenchStats.counts.total) *
                        100,
                    )}
                    %
                  </span>
                ) : null}
              </span>
            </>
          ) : null}
          <span className="app-statusbar__engine">
            <StatusDot state={dotState(engineStatus)} />
            {engineLabel(engineStatus)}
          </span>
        </span>
      </footer>

      {engineReady ? null : (
        <EngineGate
          status={engineStatus}
          onRelaunch={() => void handleRelaunch()}
          relaunching={relaunching}
        />
      )}
    </div>
  );
}
