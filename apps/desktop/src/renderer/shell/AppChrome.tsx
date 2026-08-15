import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ChartLine,
  Command,
  Export,
  FolderSimple,
  GearSix,
  House,
  MagnifyingGlass,
  Plugs,
  Robot,
  SealCheck,
  UsersThree,
} from "@phosphor-icons/react";

import type { WindowChromePlatform } from "../../shared/desktop-api";
import type { AppState } from "../state/app-state";
import {
  collaborationAvailable,
  resolveP4RouteContext,
} from "../state/p4-route-context";
import { TitleFileMenu, type TitleFileMenuItem } from "./TitleFileMenu";
import { WindowControls } from "./WindowControls";

export interface AppChromeProps {
  state: AppState;
  onHome: () => void;
  onSearch: () => void;
  onQa: () => void;
  onExport: () => void;
  onInsights: () => void;
  onAssets?: () => void;
  onAiControl?: () => void;
  onPlugins?: () => void;
  onCollaboration?: () => void;
  onSettings?: () => void;
  /** Opens the Ctrl/Cmd+K command palette. */
  onCommandPalette?: () => void;
  /** Workbench file lifecycle for the title-bar File menu. */
  onAddFiles?: () => void;
  addFilesPending?: boolean;
  onReimport?: () => void;
  onRecycleDocument?: () => void;
  /** Window chrome platform branch from DesktopApi (default: custom). */
  windowChromePlatform?: WindowChromePlatform;
  windowMaximized?: boolean;
  onWindowMinimize?: () => void;
  onWindowToggleMaximize?: () => void;
  onWindowClose?: () => void;
}

export function AppChrome({
  state,
  onHome,
  onSearch,
  onQa,
  onExport,
  onInsights,
  onAssets,
  onAiControl,
  onPlugins,
  onCollaboration,
  onSettings,
  onCommandPalette,
  onAddFiles,
  addFilesPending = false,
  onReimport,
  onRecycleDocument,
  windowChromePlatform = "custom",
  windowMaximized = false,
  onWindowMinimize,
  onWindowToggleMaximize,
  onWindowClose,
}: AppChromeProps) {
  const surface = state.surface;

  /**
   * Identity is split so the project reads as the primary context and the
   * document as its qualifier. Only the primary part is allowed to win the
   * remaining width; both truncate rather than pushing the actions.
   */
  const identityParts: { primary: string; secondary?: string } = (() => {
    switch (surface.kind) {
      case "workbench":
      case "qa":
      case "export":
        return {
          primary: surface.ctx.project.name,
          secondary: surface.ctx.document.name,
        };
      case "insights":
      case "assets":
      case "import-document":
        return { primary: surface.projectName };
      case "projects":
        return { primary: "Projects" };
      case "create-project":
        return { primary: "New project" };
      case "templates":
        return { primary: "Templates" };
      case "recycle":
        return { primary: "Recycle" };
      case "search":
        return { primary: "Search" };
      case "ai-control":
        return { primary: "AI Control" };
      case "plugins":
        return { primary: "Plugins" };
      case "collaboration":
        return { primary: "Collaboration" };
      case "settings":
        return { primary: "Settings" };
      default:
        return { primary: "" };
    }
  })();
  const identity = identityParts.secondary
    ? `${identityParts.primary} / ${identityParts.secondary}`
    : identityParts.primary;

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
  const showP4Global = startupResolved;
  const showCollaboration =
    showP4Global &&
    Boolean(onCollaboration) &&
    collaborationAvailable(resolveP4RouteContext(surface));
  const disabled = !state.mutationsEnabled;
  const showCustomWindowControls =
    windowChromePlatform === "custom" &&
    Boolean(onWindowMinimize && onWindowToggleMaximize && onWindowClose);

  const fileItems: TitleFileMenuItem[] = [];
  if (onAddFiles) {
    fileItems.push({
      id: "add-files",
      label: addFilesPending ? "Importing" : "Add files",
      group: "job",
      onSelect: onAddFiles,
      disabled: disabled || addFilesPending,
      testId: "title-file-add-files",
    });
  }
  if (onReimport) {
    fileItems.push({
      id: "reimport",
      label: "Reimport",
      group: "job",
      onSelect: onReimport,
      disabled,
      testId: "reimport-open",
    });
  }
  if (onRecycleDocument) {
    fileItems.push({
      id: "recycle-document",
      label: "Recycle document",
      group: "job",
      onSelect: onRecycleDocument,
      disabled,
      danger: true,
      testId: "title-file-recycle",
    });
  }
  if (showAssets && onAssets) {
    fileItems.push({
      id: "assets",
      label: "Assets",
      group: "project",
      onSelect: onAssets,
      disabled,
    });
  }
  if (showInsights) {
    fileItems.push({
      id: "insights",
      label: "Insights",
      group: "project",
      onSelect: onInsights,
      disabled,
    });
  }

  const handleTitleDoubleClick = (
    event: ReactMouseEvent<HTMLElement>,
  ): void => {
    if (!showCustomWindowControls || !onWindowToggleMaximize) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "button, a, input, select, textarea, [data-no-drag], .window-controls",
      )
    ) {
      return;
    }
    onWindowToggleMaximize();
  };

  return (
    <header
      className="app-chrome"
      data-testid="app-shell"
      data-window-chrome={windowChromePlatform}
      onDoubleClick={handleTitleDoubleClick}
    >
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
      <TitleFileMenu items={fileItems} disabled={disabled} />
      <div className="app-chrome__identity" title={identity}>
        {identityParts.primary ? (
          <span className="app-chrome__identity-primary">
            {identityParts.primary}
          </span>
        ) : null}
        {identityParts.secondary ? (
          <span className="app-chrome__identity-secondary">
            {identityParts.secondary}
          </span>
        ) : null}
      </div>
      <div className="app-chrome__actions" data-no-drag>
        {showHomeSearch ? (
          <div className="app-chrome__group">
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="Home"
              title="Home"
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
              title="Search"
              aria-current={surface.kind === "search" ? "page" : undefined}
              disabled={disabled}
              onClick={onSearch}
              data-testid="nav-search"
            >
              <MagnifyingGlass size={18} weight="regular" />
            </button>
            {onCommandPalette ? (
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label="Commands"
                title="Commands (Ctrl+K)"
                aria-keyshortcuts="Control+K Meta+K"
                disabled={disabled}
                onClick={onCommandPalette}
                data-testid="nav-commands"
              >
                <Command size={18} weight="regular" />
              </button>
            ) : null}
          </div>
        ) : null}
        {showSessionActions || showInsights || showAssets ? (
          <div className="app-chrome__group">
            {showAssets && onAssets ? (
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label="Assets"
                title="Assets"
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
                title="Insights"
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
                  title="QA"
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
                  title="Export"
                  aria-current={surface.kind === "export" ? "page" : undefined}
                  disabled={disabled}
                  onClick={onExport}
                >
                  <Export size={18} weight="regular" />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {showP4Global || showCollaboration ? (
          <div className="app-chrome__group">
            {showP4Global && onAiControl ? (
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label="AI Control"
                title="AI Control"
                aria-current={
                  surface.kind === "ai-control" ? "page" : undefined
                }
                disabled={disabled}
                onClick={onAiControl}
                data-testid="nav-ai-control"
              >
                <Robot size={18} weight="regular" />
              </button>
            ) : null}
            {showP4Global && onPlugins ? (
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label="Plugins"
                title="Plugins"
                aria-current={surface.kind === "plugins" ? "page" : undefined}
                disabled={disabled}
                onClick={onPlugins}
                data-testid="nav-plugins"
              >
                <Plugs size={18} weight="regular" />
              </button>
            ) : null}
            {showCollaboration ? (
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label="Collaboration"
                title="Collaboration"
                aria-current={
                  surface.kind === "collaboration" ? "page" : undefined
                }
                disabled={disabled}
                onClick={onCollaboration}
                data-testid="nav-collaboration"
              >
                <UsersThree size={18} weight="regular" />
              </button>
            ) : null}
            {showP4Global && onSettings ? (
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label="Settings"
                title="Settings"
                aria-current={surface.kind === "settings" ? "page" : undefined}
                disabled={disabled}
                onClick={onSettings}
                data-testid="nav-settings"
              >
                <GearSix size={18} weight="regular" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {showCustomWindowControls &&
      onWindowMinimize &&
      onWindowToggleMaximize &&
      onWindowClose ? (
        <WindowControls
          platform={windowChromePlatform}
          maximized={windowMaximized}
          onMinimize={onWindowMinimize}
          onToggleMaximize={onWindowToggleMaximize}
          onClose={onWindowClose}
        />
      ) : null}
    </header>
  );
}
