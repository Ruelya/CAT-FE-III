import { SectionNav } from "../shell/SectionNav";

export type InsightsSection = "analytics" | "interop" | "taskPackage";

export interface InsightsSectionNavProps {
  section: InsightsSection;
  onChange: (section: InsightsSection) => void;
  disabled?: boolean;
}

const SECTIONS = [
  {
    id: "analytics" as const,
    label: "Analytics",
    testId: "insights-section-analytics",
  },
  {
    id: "interop" as const,
    label: "Interop",
    testId: "insights-section-interop",
  },
  {
    id: "taskPackage" as const,
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
    <SectionNav
      label="Insights sections"
      items={SECTIONS}
      current={section}
      onSelect={onChange}
      {...(disabled !== undefined ? { disabled } : {})}
    />
  );
}
