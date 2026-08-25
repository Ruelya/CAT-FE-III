import { useCallback, useEffect, useState } from "react";

import type { Project } from "@translunar/contracts";
import { Button, StatusDot } from "@translunar/ui";

import type {
  EngineLifecycleState,
  EngineStatusPayload,
} from "../shared/desktop-api.js";
import { EngineGate } from "./components/EngineGate.js";
import { ProjectSettingsDialog } from "./components/ProjectSettingsDialog.js";
import { ProjectsView } from "./views/ProjectsView.js";
import { WorkbenchView } from "./views/WorkbenchView.js";

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
      return `engine: 已停止${status.lastError ? ` — ${status.lastError}` : ""}`;
  }
}

export function App() {
  const [engineStatus, setEngineStatus] = useState<EngineStatusPayload | null>(
    null,
  );
  const [relaunching, setRelaunching] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    "INSTRUMENT · Translunar CAT 绿场骨架",
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

  // Before the first status fetch resolves, assume the engine is still
  // starting rather than pretending it is ready.
  const engineState: EngineLifecycleState = engineStatus?.state ?? "starting";
  const engineReady = engineState === "ready";

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__brand">
          TRANSLUNAR <em>CAT</em>
        </span>
        <span className="app-header__divider" />
        <div className="app-header__context">
          {project ? (
            <>
              <strong>{project.name}</strong>
              <span>
                {project.sourceLocale} → {project.targetLocale}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSettingsOpen(true)}
              >
                项目设置
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setProject(null)}
              >
                返回项目列表
              </Button>
            </>
          ) : (
            <span>项目</span>
          )}
        </div>
        <span className="app-header__spacer" />
        <span className="app-header__engine">
          <StatusDot state={dotState(engineStatus)} />
          {engineLabel(engineStatus)}
        </span>
      </header>

      {/* display:contents wrapper: keeps the grid layout intact while
          `inert` blocks focus and input in the whole surface whenever the
          engine cannot acknowledge writes. */}
      <div className="app-main" inert={!engineReady}>
        {project ? (
          <WorkbenchView
            project={project}
            engineState={engineState}
            onStatusMessage={handleStatusMessage}
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
          />
        ) : null}
      </div>

      <footer className="app-statusbar">
        <span className="app-statusbar__message">{statusMessage}</span>
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
