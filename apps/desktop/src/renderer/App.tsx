import { useCallback, useEffect, useState } from "react";

import type { Project } from "@translunar/contracts";
import { Button, StatusDot } from "@translunar/ui";

import type { EngineStatusPayload } from "../shared/desktop-api.js";
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

      {project ? (
        <WorkbenchView
          project={project}
          onStatusMessage={handleStatusMessage}
        />
      ) : (
        <ProjectsView
          onOpenProject={setProject}
          onStatusMessage={handleStatusMessage}
        />
      )}

      <footer className="app-statusbar">
        <span className="app-statusbar__message">{statusMessage}</span>
      </footer>

      {project ? (
        <ProjectSettingsDialog
          open={settingsOpen}
          project={project}
          onClose={() => setSettingsOpen(false)}
          onProjectUpdated={setProject}
        />
      ) : null}
    </div>
  );
}
