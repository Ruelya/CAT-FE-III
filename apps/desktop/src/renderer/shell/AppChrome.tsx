import { House, SealCheck, Export } from "@phosphor-icons/react";

import type { AppState } from "../state/app-state";

export interface AppChromeProps {
  state: AppState;
  onHome: () => void;
  onQa: () => void;
  onExport: () => void;
}

export function AppChrome({ state, onHome, onQa, onExport }: AppChromeProps) {
  const surface = state.surface;
  const sessionSurface =
    surface.kind === "workbench" ||
    surface.kind === "qa" ||
    surface.kind === "export"
      ? surface
      : null;

  const identity = sessionSurface
    ? `${sessionSurface.ctx.project.name} · ${sessionSurface.ctx.document.name}`
    : surface.kind === "import-document"
      ? surface.projectName
      : surface.kind === "projects"
        ? "Projects"
        : surface.kind === "create-project"
          ? "New project"
          : "";

  const showSessionActions = Boolean(sessionSurface);
  const disabled = !state.mutationsEnabled;

  return (
    <header className="app-chrome" data-testid="app-shell">
      <div className="app-chrome__brand">
        <span className="app-chrome__ribbon" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
        <span>Translunar</span>
      </div>
      <div className="app-chrome__identity" title={identity}>
        {identity}
      </div>
      <div className="app-chrome__actions">
        {showSessionActions ? (
          <>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="Home"
              disabled={disabled}
              onClick={onHome}
            >
              <House size={18} weight="regular" />
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="QA"
              disabled={disabled}
              onClick={onQa}
            >
              <SealCheck size={18} weight="regular" />
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="Export"
              disabled={disabled}
              onClick={onExport}
            >
              <Export size={18} weight="regular" />
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
