import type { Project, ProjectLifecycle } from "@translunar/contracts";
import { FolderOpen, Plus } from "lucide-react";

import { useLocale } from "../../i18n/LocaleProvider";
import {
  ProjectCard,
  type ProjectOverview,
} from "./ProjectCard";

const PROJECT_PAGE_SIZE = 50;

export { PROJECT_PAGE_SIZE };

export interface ProjectsPaneProps {
  projects: ProjectOverview[];
  total: number;
  offset: number;
  lifecycle: ProjectLifecycle;
  openingProjectId: string | null;
  onLifecycle(value: ProjectLifecycle): void;
  onPage(offset: number): void;
  onOpen(overview: ProjectOverview, documentId?: string): Promise<void>;
  onSetLifecycle(project: Project, lifecycle: ProjectLifecycle): void;
  onRecycle(project: Project): void;
  onCreate(): void;
}

export function ProjectsPane({
  projects,
  total,
  offset,
  lifecycle,
  openingProjectId,
  onLifecycle,
  onPage,
  onOpen,
  onSetLifecycle,
  onRecycle,
  onCreate,
}: ProjectsPaneProps) {
  const { t } = useLocale();

  return (
    <div className="projects-pane">
      <header className="project-view-heading">
        <div>
          <h1>
            {lifecycle === "active"
              ? t("home.continueTranslating")
              : t("home.archivedProjects")}
          </h1>
        </div>
        <div
          className="segmented-control"
          aria-label={t("home.projectLifecycle")}
        >
          <button
            type="button"
            aria-pressed={lifecycle === "active"}
            onClick={() => onLifecycle("active")}
          >
            {t("home.active")}
          </button>
          <button
            type="button"
            aria-pressed={lifecycle === "archived"}
            onClick={() => onLifecycle("archived")}
          >
            {t("home.archived")}
          </button>
        </div>
      </header>

      {projects.length === 0 ? (
        <div className="project-home-empty" data-empty="d6">
          <FolderOpen size={22} aria-hidden="true" />
          <strong>
            {lifecycle === "active"
              ? t("home.noActiveProjects")
              : t("home.noArchivedProjects")}
          </strong>
          <span>
            {lifecycle === "active"
              ? t("home.createToBegin")
              : t("home.archivedHelp")}
          </span>
          {lifecycle === "active" ? (
            <button className="button primary" type="button" onClick={onCreate}>
              <Plus size={15} /> {t("home.newProject")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="project-grid">
            {projects.map((overview) => (
              <ProjectCard
                key={overview.snapshot.project.id}
                overview={overview}
                opening={
                  openingProjectId === overview.snapshot.project.id
                }
                onOpen={onOpen}
                onSetLifecycle={onSetLifecycle}
                onRecycle={onRecycle}
              />
            ))}
          </div>
          {total > PROJECT_PAGE_SIZE ? (
            <div
              className="project-pagination"
              aria-label={t("home.projectPages")}
            >
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => onPage(Math.max(0, offset - PROJECT_PAGE_SIZE))}
              >
                {t("action.back")}
              </button>
              <span className="num">
                {offset + 1}-{Math.min(offset + projects.length, total)} /{" "}
                {total}
              </span>
              <button
                type="button"
                disabled={offset + projects.length >= total}
                onClick={() => onPage(offset + PROJECT_PAGE_SIZE)}
              >
                {t("action.next")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
