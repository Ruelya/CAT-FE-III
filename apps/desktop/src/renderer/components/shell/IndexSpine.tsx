import {
  LayoutGrid,
  ShieldCheck,
  Download,
  Database,
  Sparkles,
  BarChart3,
  Settings,
  SunMoon,
} from "lucide-react";
import type { AppSurface } from "../../surface-types";

/**
 * Index Spine 导航脊柱
 *
 * 48px 宽 Ink 面竖列。取代上一代的 `…` 溢出菜单导航。
 * Active Axis 以 2px 信号橙竖线驻留于当前 Surface 图标左缘。
 *
 * Source: docs/design-ii/06-shell-navigation.md §1
 */

interface SurfaceNavItem {
  surface: AppSurface;
  icon: typeof LayoutGrid;
  label: string;
  badge?: number;
}

const NAV_ITEMS: readonly SurfaceNavItem[] = [
  { surface: "workbench", icon: LayoutGrid, label: "工作台" },
  { surface: "qa-review", icon: ShieldCheck, label: "QA 复核" },
  { surface: "export-review", icon: Download, label: "导出复核" },
  { surface: "translation-memory", icon: Database, label: "资产" },
  { surface: "ai-control", icon: Sparkles, label: "AI 控制台" },
  { surface: "project-insights", icon: BarChart3, label: "项目洞察" },
];

interface IndexSpineProps {
  surface: AppSurface;
  onSurfaceChange: (surface: AppSurface) => void;
  onSettingsOpen: () => void;
  onThemeToggle: () => void;
  qaIssueCount?: number | undefined;
}

export function IndexSpine({
  surface,
  onSurfaceChange,
  onSettingsOpen,
  onThemeToggle,
  qaIssueCount = 0,
}: IndexSpineProps) {
  return (
    <nav className="index-spine shell__spine" aria-label="主导航">
      <div className="index-spine__brand">
        <BrandGlyph />
      </div>

      <div className="index-spine__nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = surface === item.surface;
          const badge =
            item.surface === "qa-review" && qaIssueCount > 0
              ? qaIssueCount
              : undefined;

          return (
            <button
              key={item.surface}
              type="button"
              className="index-spine__item"
              data-active={isActive || undefined}
              aria-current={isActive ? "page" : undefined}
              title={item.label}
              onClick={() => onSurfaceChange(item.surface)}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              <span className="sr-only">{item.label}</span>
              {badge !== undefined && (
                <span className="index-spine__badge num" aria-label={`${badge} 个问题`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="index-spine__footer">
        <button
          type="button"
          className="index-spine__item"
          title="切换主题"
          onClick={onThemeToggle}
        >
          <SunMoon size={18} strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">切换主题</span>
        </button>
        <button
          type="button"
          className="index-spine__item"
          title="设置"
          onClick={onSettingsOpen}
        >
          <Settings size={18} strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">设置</span>
        </button>
      </div>
    </nav>
  );
}

/**
 * 应用标记：极简几何字标 + Band Echo
 */
function BrandGlyph() {
  return (
    <div className="brand-glyph" aria-label="Translunar">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="12" cy="12" r="3" fill="var(--signal)" />
      </svg>
    </div>
  );
}
