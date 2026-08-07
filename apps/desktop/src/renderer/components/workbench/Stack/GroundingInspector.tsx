import type { PromptBundle } from "@translunar/contracts";
import { Eye } from "lucide-react";

import { useLocale } from "../../../i18n/LocaleProvider";

export interface GroundingInspectorProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  snapshot: { contextKey: string; bundle: PromptBundle } | null;
  unavailableReason?: string | null;
}

/**
 * Honest grounding disclosure: only when a real preview bundle exists.
 * Never labels UI as "grounded" without inspectable sections.
 */
export function GroundingInspector({
  open,
  onOpenChange,
  snapshot,
  unavailableReason = null,
}: GroundingInspectorProps) {
  const { t } = useLocale();
  const bundle = snapshot?.bundle ?? null;

  if (!bundle) {
    if (!unavailableReason) return null;
    return (
      <div className="grounding-inspector grounding-inspector--unavailable" role="status">
        {unavailableReason}
      </div>
    );
  }

  return (
    <details
      className="grounding-inspector"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary>
        <Eye size={13} aria-hidden="true" /> {t("assistant.groundingContext")}{" "}
        <span>
          {bundle.totalChars.toLocaleString()} {t("assistant.characters")} ·{" "}
          {bundle.sections.length} {t("assistant.sections")}
        </span>
      </summary>
      <div className="grounding-sections">
        {bundle.sections.map((section) => (
          <article key={section.id}>
            <header>
              <strong>{section.label}</strong>
              <small>
                {t("workbench.grounding.items", { count: section.itemCount })}
                {section.truncated
                  ? ` · ${t("workbench.grounding.truncated")}`
                  : ""}
              </small>
            </header>
            <pre>{section.text}</pre>
          </article>
        ))}
      </div>
    </details>
  );
}
