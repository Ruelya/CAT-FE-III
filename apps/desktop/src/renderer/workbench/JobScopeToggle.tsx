import type { JobScope } from "../lib/job-scope";

export interface JobScopeToggleProps {
  scope: JobScope;
  fileCount: number;
  disabled?: boolean;
  onChange: (scope: JobScope) => void;
}

export function JobScopeToggle({
  scope,
  fileCount,
  disabled,
  onChange,
}: JobScopeToggleProps) {
  if (fileCount <= 1) return null;
  return (
    <div
      className="job-scope"
      role="group"
      aria-label="Scope"
      data-testid="job-scope"
    >
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-pressed={scope === "file"}
        disabled={disabled}
        data-testid="job-scope-file"
        onClick={() => onChange("file")}
      >
        This file
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-pressed={scope === "job"}
        disabled={disabled}
        data-testid="job-scope-job"
        onClick={() => onChange("job")}
      >
        All files ({fileCount})
      </button>
    </div>
  );
}
