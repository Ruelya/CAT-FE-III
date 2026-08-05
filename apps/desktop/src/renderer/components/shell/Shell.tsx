import type { ReactNode } from "react";
import type { AppSurface } from "../../surface-types";
import { BandSpine } from "./BandSpine";
import { IndexSpine } from "./IndexSpine";
import {
  InstrumentStrip,
  type SaveState,
  type SegmentCounts,
} from "./InstrumentStrip";

/**
 * Shell 应用外壳
 *
 * 四板块固定骨架：
 * ┌─┬──┬───────────────────────┐
 * │B│IN│                       │
 * │A│DE│      SURFACE          │
 * │N│X │                       │
 * │D│  │                       │
 * ├─┴──┴───────────────────────┤
 * │ INSTRUMENT STRIP      30px │
 * └────────────────────────────┘
 *
 * Band Spine 与 Index Spine 跨 Surface 恒定，不参与 View Transition。
 *
 * Source: docs/design-ii/06-shell-navigation.md
 */

interface ShellProps {
  surface: AppSurface;
  onSurfaceChange: (surface: AppSurface) => void;
  onSettingsOpen: () => void;
  onThemeToggle: () => void;
  counts: SegmentCounts;
  saveState: SaveState;
  wordCount: number;
  activeSegmentIndex?: number | undefined;
  qaIssueCount?: number | undefined;
  children: ReactNode;
}

export function Shell({
  surface,
  onSurfaceChange,
  onSettingsOpen,
  onThemeToggle,
  counts,
  saveState,
  wordCount,
  activeSegmentIndex,
  qaIssueCount,
  children,
}: ShellProps) {
  return (
    <div className="shell">
      <BandSpine />

      <IndexSpine
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        onSettingsOpen={onSettingsOpen}
        onThemeToggle={onThemeToggle}
        qaIssueCount={qaIssueCount}
      />

      <main className="shell__surface" data-surface={surface}>
        {children}
      </main>

      <InstrumentStrip
        counts={counts}
        saveState={saveState}
        wordCount={wordCount}
        activeSegmentIndex={activeSegmentIndex}
      />
    </div>
  );
}
