export interface InlineEmptyProps {
  /** Concrete statement of fact, for example "No connector profiles". */
  label: string;
  testId?: string;
}

/**
 * Bounded empty state for a section inside a panel.
 *
 * The bare string "Empty" tells the user nothing about which collection is
 * empty, and reads identically whether the section failed to load or genuinely
 * has no rows. Every call site names its own collection.
 */
export function InlineEmpty({ label, testId }: InlineEmptyProps) {
  return (
    <p
      className="state-inline state-inline--empty"
      {...(testId ? { "data-testid": testId } : {})}
    >
      {label}
    </p>
  );
}

export interface InlineLoadingProps {
  /** Announced label, for example "Loading connector profiles". */
  label: string;
  /** Rows to reserve, so the skeleton matches the settled geometry. */
  rows?: number;
  testId?: string;
}

/**
 * Loading placeholder whose geometry matches what will replace it.
 *
 * The bare string "Loading" collapses the layout and then pushes everything
 * down when content arrives. A skeleton of the right height does not.
 */
export function InlineLoading({ label, rows = 3, testId }: InlineLoadingProps) {
  return (
    <div
      className="skeleton-stack"
      role="status"
      aria-label={label}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}
