import {
  ChartLine,
  Export,
  FolderSimple,
  House,
  MagnifyingGlass,
  SealCheck,
} from "@phosphor-icons/react";

import type { AppState } from "../state/app-state";

export interface AppChromeProps {
  state: AppState;
  onHome: () => void;
  onSearch: () => void;
  onQa: () => void;
  onExport: () => void;
  onInsights: () => void;
  onAssets?: () => void;
}

export function AppChrome({
  state,
  onHome,
  onSearch,
  onQa,
  onExport,
  onInsights,
  onAssets,
}: AppChromeProps) {
  const surface = state.surface;

  const identity =
    surface.kind === "workbench" ||
    surface.kind === "qa" ||
    surface.kind === "export"
      ? `${surface.ctx.project.name} · ${surface.ctx.document.name}`
      : surface.kind === "insights" || surface.kind === "assets"
        ? surface.projectName
        : surface.kind === "import-document"
          ? surface.projectName
          : surface.kind === "projects"
            ? "Projects"
            : surface.kind === "create-project"
              ? "New project"
              : surface.kind === "templates"
                ? "Templates"
                : surface.kind === "recycle"
                  ? "Recycle"
                  : surface.kind === "search"
                    ? "Search"
                    : "";

  const startupResolved =
    surface.kind !== "boot" && surface.kind !== "recovery";
  const showHomeSearch = startupResolved;
  // Assets does not host QA/Export/Insights — hide them to avoid dead chrome.
  const showSessionActions =
    surface.kind === "workbench" ||
    surface.kind === "qa" ||
    surface.kind === "export" ||
    (surface.kind === "insights" && surface.returnTo === "workbench");
  const showInsights =
    surface.kind === "workbench" ||
    surface.kind === "qa" ||
    surface.kind === "export" ||
    surface.kind === "insights";
  const showAssets =
    Boolean(onAssets) &&
    (surface.kind === "workbench" ||
      surface.kind === "qa" ||
      surface.kind === "export" ||
      surface.kind === "assets" ||
      (surface.kind === "insights" && surface.returnTo === "workbench"));
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
        {showHomeSearch ? (
          <>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="Home"
              aria-current={
                surface.kind === "projects" ||
                surface.kind === "welcome" ||
                surface.kind === "templates" ||
                surface.kind === "recycle"
                  ? "page"
                  : undefined
              }
              disabled={disabled}
              onClick={onHome}
            >
              <House size={18} weight="regular" />
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="Search"
              aria-current={surface.kind === "search" ? "page" : undefined}
              disabled={disabled}
              onClick={onSearch}
              data-testid="nav-search"
            >
              <MagnifyingGlass size={18} weight="regular" />
            </button>
          </>
        ) : null}
        {showSessionActions || showInsights || showAssets ? (
          <>
            {showAssets && onAssets ? (
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label="Assets"
                aria-current={surface.kind === "assets" ? "page" : undefined}
                disabled={disabled}
                onClick={onAssets}
                data-testid="nav-assets"
              >
                <FolderSimple size={18} weight="regular" />
              </button>
            ) : null}
            {showInsights ? (
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label="Insights"
                aria-current={surface.kind === "insights" ? "page" : undefined}
                disabled={disabled}
                onClick={onInsights}
                data-testid="nav-insights"
              >
                <ChartLine size={18} weight="regular" />
              </button>
            ) : null}
            {showSessionActions ? (
              <>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-label="QA"
                  aria-current={surface.kind === "qa" ? "page" : undefined}
                  disabled={disabled}
                  onClick={onQa}
                >
                  <SealCheck size={18} weight="regular" />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-label="Export"
                  aria-current={surface.kind === "export" ? "page" : undefined}
                  disabled={disabled}
                  onClick={onExport}
                >
                  <Export size={18} weight="regular" />
                </button>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </header>
  );
}
