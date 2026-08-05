import {
  BarChart3,
  Command,
  Database,
  Download,
  LayoutGrid,
  Settings,
  ShieldCheck,
  Sparkles,
  SunMoon,
  type LucideIcon,
} from "lucide-react";
import {
  SURFACE_LABEL,
  SURFACE_ORDER,
  type AppSurface,
} from "../../surface-types";
import { BandEcho } from "./BandSpine";

/**
 * Index Spine 导航脊柱（48px 常驻左栏）
 *
 * 取代上一代藏在 `…` 溢出菜单里的 6 项顶层导航。
 * Active Axis 以 2px × 32px 信号橙竖线驻留于当前 Surface 灯左缘。
 *
 * 无项目时六灯禁用，只留标识、命令面板、设置、主题。
 *
 * Source: docs/design-ii/06-shell-navigation.md §2
 */

/** 灯序与标签来自 surface-types，这里只补图标 */
const SURFACE_ICON: Record<AppSurface, LucideIcon> = {
  workbench: LayoutGrid,
  "qa-review": ShieldCheck,
  "export-review": Download,
  "translation-memory": Database,
  "ai-control": Sparkles,
  "project-insights": BarChart3,
};

interface IndexSpineProps {
  surface: AppSurface;
  /** 无活动项目时六灯禁用 */
  hasProject: boolean;
  /** 项目名，用于标识区 tooltip */
  projectName?: string | undefined;
  /** QA 未处理错误数，显示在 QA 灯徽标 */
  openIssues?: number | undefined;
  /** 导出有阻断项时徽标变红 */
  exportBlocked?: boolean | undefined;
  onSurfaceChange: (surface: AppSurface) => void;
  onGoHome: () => void;
  onCommandPalette: () => void;
  onSettingsOpen: () => void;
  onThemeToggle: () => void;
}

export function IndexSpine({
  surface,
  hasProject,
  projectName,
  openIssues = 0,
  exportBlocked = false,
  onSurfaceChange,
  onGoHome,
  onCommandPalette,
  onSettingsOpen,
  onThemeToggle,
}: IndexSpineProps) {
  return (
    <nav className="index-spine shell__spine" aria-label="应用视图">
      <button
        type="button"
        className="spine__mark"
        onClick={onGoHome}
        aria-label={
          projectName
            ? `项目：${projectName}，返回项目列表`
            : "返回项目列表"
        }
        title={projectName ?? "项目列表"}
      >
        <AppMark />
        <BandEcho />
      </button>

      <ul className="spine__nav">
        {SURFACE_ORDER.map((id, index) => {
          const Icon = SURFACE_ICON[id];
          const label = SURFACE_LABEL[id];
          const isCurrent = hasProject && surface === id;
          const badge = lampBadge(id, openIssues, exportBlocked);

          return (
            <li key={id}>
              <button
                type="button"
                className="spine__item"
                data-current={isCurrent || undefined}
                aria-current={isCurrent ? "page" : undefined}
                aria-disabled={!hasProject || undefined}
                aria-label={
                  badge ? `${label}，${badge.count} ${badge.noun}` : label
                }
                aria-keyshortcuts={`Control+${index + 1}`}
                title={`${label}  Ctrl+${index + 1}`}
                onClick={() => {
                  if (!hasProject) return;
                  onSurfaceChange(id);
                }}
              >
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                {badge ? (
                  <b className="spine__badge" data-tone={badge.tone}>
                    {badge.count > 99 ? "99+" : badge.count}
                  </b>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="spine__filler" aria-hidden="true" />

      <div className="spine__tools">
        <button
          type="button"
          className="spine__item"
          onClick={onCommandPalette}
          aria-label="命令面板"
          aria-keyshortcuts="Control+K"
          title="命令面板  Ctrl+K"
        >
          <Command size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="spine__item"
          onClick={onSettingsOpen}
          aria-label="设置"
          title="设置"
        >
          <Settings size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="spine__item"
          onClick={onThemeToggle}
          aria-label="切换主题"
          title="切换主题"
        >
          <SunMoon size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

interface LampBadge {
  count: number;
  tone: "warn" | "error";
  noun: string;
}

function lampBadge(
  surface: AppSurface,
  openIssues: number,
  exportBlocked: boolean,
): LampBadge | null {
  if (surface === "qa-review" && openIssues > 0) {
    return { count: openIssues, tone: "error", noun: "个未处理问题" };
  }
  if (surface === "export-review" && exportBlocked) {
    return { count: 1, tone: "error", noun: "个阻断项" };
  }
  return null;
}

/** 应用标记：几何字标，Band Echo 由父级渲染 */
function AppMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3.2" fill="var(--signal)" />
    </svg>
  );
}
