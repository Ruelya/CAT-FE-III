export type InsightsSection = "analytics" | "interop" | "taskPackage";

export interface InsightsSectionNavProps {
  section: InsightsSection;
  onChange: (section: InsightsSection) => void;
  disabled?: boolean;
}

const SECTIONS: Array<{ id: InsightsSection; label: string; testId: string }> =
  [
    { id: "analytics", label: "Analytics", testId: "insights-section-analytics" },
    { id: "interop", label: "Interop", testId: "insights-section-interop" },
    {
      id: "taskPackage",
      label: "Task package",
      testId: "insights-section-task",
    },
  ];

export function InsightsSectionNav({
  section,
  onChange,
  disabled,
}: InsightsSectionNavProps) {
  return (
    <nav className="insights-section-nav" aria-label="Insights sections">
      {SECTIONS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={
            section === item.id
              ? "btn btn--secondary insights-section-nav__item insights-section-nav__item--active"
              : "btn btn--ghost insights-section-nav__item"
          }
          aria-current={section === item.id ? "page" : undefined}
          disabled={disabled}
          onClick={() => onChange(item.id)}
          data-testid={item.testId}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
