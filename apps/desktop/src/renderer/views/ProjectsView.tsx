import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Project } from "@translunar/contracts";
import { Badge, Button, EmptyState, Panel, TextField } from "@translunar/ui";

import type { EngineLifecycleState } from "../../shared/desktop-api.js";
import { callEngine, describeError } from "../lib/engine.js";

export interface ProjectsViewProps {
  engineState: EngineLifecycleState;
  onOpenProject: (project: Project) => void;
  onStatusMessage: (message: string) => void;
}

export function ProjectsView({
  engineState,
  onOpenProject,
  onStatusMessage,
}: ProjectsViewProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [sourceLocale, setSourceLocale] = useState("en-US");
  const [targetLocale, setTargetLocale] = useState("zh-CN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Archived projects are hidden by default so the list reads as "what am I
  // working on"; the toggle keeps them reachable (archive is reversible in
  // project settings, so hiding them forever would be dishonest).
  const [showArchived, setShowArchived] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await callEngine("project.list", {});
      setProjects(result.projects);
      setError(null);
    } catch (listError) {
      setError(describeError(listError));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // If the initial list load happened against a dead engine, refetch when
  // the engine comes back instead of showing a stale empty list.
  const previousEngineStateRef = useRef(engineState);
  useEffect(() => {
    const previous = previousEngineStateRef.current;
    previousEngineStateRef.current = engineState;
    if (engineState === "ready" && previous !== "ready") {
      void refresh();
    }
  }, [engineState, refresh]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const project = await callEngine("project.create", {
        name,
        sourceLocale,
        targetLocale,
      });
      onStatusMessage(`项目「${project.name}」已创建`);
      setName("");
      await refresh();
      onOpenProject(project);
    } catch (createError) {
      setError(describeError(createError));
    } finally {
      setBusy(false);
    }
  }, [
    name,
    sourceLocale,
    targetLocale,
    onOpenProject,
    onStatusMessage,
    refresh,
  ]);

  const activeProjects = useMemo(
    () => projects.filter((project) => project.lifecycle !== "archived"),
    [projects],
  );
  const archivedCount = projects.length - activeProjects.length;
  const visibleProjects = showArchived ? projects : activeProjects;

  return (
    <main className="projects-view">
      <Panel title="新建项目">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <TextField
            label="项目名称"
            value={name}
            placeholder="例如：产品手册 v3"
            onChange={(event) => setName(event.target.value)}
            required
          />
          <div className="form-row">
            <TextField
              label="源语言"
              value={sourceLocale}
              onChange={(event) => setSourceLocale(event.target.value)}
              required
            />
            <TextField
              label="目标语言"
              value={targetLocale}
              onChange={(event) => setTargetLocale(event.target.value)}
              required
            />
          </div>
          {error ? (
            <div className="honest-note" data-tone="danger" role="alert">
              {error}
            </div>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !name.trim()}
          >
            {busy ? "创建中…" : "创建项目"}
          </Button>
        </form>
      </Panel>

      <Panel title={`项目列表（${activeProjects.length}）`}>
        {archivedCount > 0 ? (
          <label className="project-list__archived-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            显示已归档项目（{archivedCount}）
          </label>
        ) : null}
        {projects.length === 0 ? (
          <EmptyState
            title="还没有项目"
            hint="创建第一个项目后即可导入 DOCX 文档并开始翻译。"
          />
        ) : visibleProjects.length === 0 ? (
          <EmptyState
            title="没有进行中的项目"
            hint="所有项目都已归档。勾选上方开关可查看并重新打开它们。"
          />
        ) : (
          <div className="project-list">
            {visibleProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="project-list__item"
                onClick={() => onOpenProject(project)}
              >
                <span className="project-list__name">
                  {project.name}
                  {project.lifecycle === "archived" ? (
                    <Badge tone="neutral">已归档</Badge>
                  ) : null}
                </span>
                <span className="project-list__locales">
                  {project.sourceLocale} → {project.targetLocale}
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </main>
  );
}
