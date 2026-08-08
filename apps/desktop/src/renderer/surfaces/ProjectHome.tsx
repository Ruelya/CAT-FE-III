import type { Project } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";

export interface ProjectHomeProps {
  projects: Project[];
  error?: UiError | null;
  loading?: boolean;
  disabled?: boolean;
  onOpen: (projectId: string) => void;
  onCreate: () => void;
}

export function ProjectHome({
  projects,
  error,
  loading,
  disabled,
  onOpen,
  onCreate,
}: ProjectHomeProps) {
  return (
    <section className="surface" data-testid="project-home">
      <div className="surface__masthead">
        <h1 className="surface__title">Projects</h1>
        <button
          type="button"
          className="btn btn--primary"
          disabled={disabled || loading}
          onClick={onCreate}
        >
          Create project
        </button>
      </div>
      {error ? <p className="error-text">{formatUiError(error)}</p> : null}
      {loading ? <p className="muted">Loading</p> : null}
      <ul className="project-list">
        {projects.map((project) => (
          <li key={project.id} className="project-row">
            <div className="project-row__meta">
              <p className="project-row__name">{project.name}</p>
              <p className="project-row__locales">
                {project.sourceLocale} → {project.targetLocale}
              </p>
            </div>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={disabled || loading}
              onClick={() => onOpen(project.id)}
            >
              Open
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
