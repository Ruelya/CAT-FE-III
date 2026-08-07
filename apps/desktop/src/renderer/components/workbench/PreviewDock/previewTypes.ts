import type { Document, Segment } from "@translunar/contracts";

import type { PanelMode } from "../../../workbench-utils";

export interface PreviewDockProps {
  document: Document;
  activeSegment: Segment | undefined;
  segments: Segment[];
  total: number;
  mode: PanelMode;
  onModeChange(mode: PanelMode): void;
  height: number;
  onHeightChange(height: number): void;
  followActive: boolean;
  onFollowActiveChange(follow: boolean): void;
  onNavigateSegment(segmentId: string, ordinal: number): void;
  onSourceCorrected(segment: Segment): void;
}
