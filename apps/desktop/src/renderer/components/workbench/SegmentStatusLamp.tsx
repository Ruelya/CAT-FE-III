/**
 * Eight-shape status lamp (presentation only).
 * Shape + color + accessible name; forced-colors keeps shape via borders.
 *
 * Source: docs/design-ii/screens/workbench.md §3.3
 */

import type { SegmentLampState } from "./segmentTypes";

export interface SegmentStatusLampProps {
  state: SegmentLampState;
  label: string;
  flash?: boolean;
}

export function SegmentStatusLamp({
  state,
  label,
  flash = false,
}: SegmentStatusLampProps) {
  return (
    <span
      className={
        flash
          ? "status-lamp status-lamp--flash"
          : "status-lamp"
      }
      data-lamp={state}
      data-state={state}
      role="img"
      aria-label={label}
      title={label}
    >
      <i className="status-lamp__shape" aria-hidden="true" />
    </span>
  );
}
