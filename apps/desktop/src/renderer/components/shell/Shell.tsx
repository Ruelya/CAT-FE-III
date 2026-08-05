import type { ReactNode } from "react";
import type { SegmentCounts } from "@translunar/contracts";
import type { AppSurface } from "../../surface-types";
import { BandSpine } from "./BandSpine";
import { IndexSpine } from "./IndexSpine";
import { InstrumentStrip, type SaveState } from "./InstrumentStrip";

/**
 * Shell 应用外壳
 *
 * ┌─┬──┬───────────────────────┐
 * │B│IN│      SURFACE          │
 * │A│DE│      （唯一被替换区）  │
 * │N│X │                       │
 * │D│  ├───────────────────────┤
 * │ │  │ INSTRUMENT STRIP 30px │
 * └─┴──┴───────────────────────┘
 *
 * Band Spine 与 Index Spine 跨 Surface 恒定；只有 Surface Slot 参与 View Transition。
 * 无项目时 Surface Slot 显示项目首页，六灯禁用，仪表条隐藏。
 *
 * Source: docs/design-ii/06-shell-navigation.md §1
 */

interface ShellProps {
  surface: AppSurface;
  /** 无活动项目时：六灯禁用、仪表条不渲染 */
  hasProject: boolean;
  projectName?: string | undefined;
  /** 有活动文档时提供，用于仪表条 */
  counts?: SegmentCounts | undefined;
  saveState?: SaveState | undefined;
  activeOrdinal?: number | undefined;
  wordCount?: number | undefined;
  exportBlocked?: boolean | undefined;
  /** Index Spine 可用 Ctrl+\ 隐藏 */
  spineHidden?: boolean | undefined;
  onSurfaceChange: (surface: AppSurface) => void;
  onGoHome: () => void;
  onCommandPalette: () => void;
  onSettingsOpen: () => void;
  onThemeToggle: () => void;
  children: ReactNode;
}

export function Shell({
  surface,
  hasProject,
  projectName,
  counts,
  saveState = "saved",
  activeOrdinal,
  wordCount,
  exportBlocked,
  spineHidden,
  onSurfaceChange,
  onGoHome,
  onCommandPalette,
  onSettingsOpen,
  onThemeToggle,
  children,
}: ShellProps) {
  return (
    <div className="shell" data-spine={spineHidden ? "hidden" : undefined}>
      <BandSpine />

      <IndexSpine
        surface={surface}
        hasProject={hasProject}
        projectName={projectName}
        openIssues={counts?.openIssues}
        exportBlocked={exportBlocked}
        onSurfaceChange={onSurfaceChange}
        onGoHome={onGoHome}
        onCommandPalette={onCommandPalette}
        onSettingsOpen={onSettingsOpen}
        onThemeToggle={onThemeToggle}
      />

      <div className="shell__surface" data-surface={surface}>
        {children}
      </div>

      {counts ? (
        <InstrumentStrip
          counts={counts}
          saveState={saveState}
          activeOrdinal={activeOrdinal}
          wordCount={wordCount}
        />
      ) : null}
    </div>
  );
}
