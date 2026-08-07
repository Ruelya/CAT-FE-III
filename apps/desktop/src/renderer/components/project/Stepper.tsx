import { Check } from "lucide-react";

export interface StepperStep {
  id: string;
  label: string;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  /** Zero-based current step index. */
  current: number;
  /** Allow navigating to completed or current steps. */
  onSelect?(index: number): void;
  /** Accessible name for the stepper list. */
  ariaLabel: string;
}

/**
 * §E5 vertical Stepper: mono two-digit index + 12px gap + title.
 * Current step uses left Active Axis via CSS; completed shows check.
 */
export function Stepper({
  steps,
  current,
  onSelect,
  ariaLabel,
}: StepperProps) {
  return (
    <ol className="wizard-stepper" aria-label={ariaLabel}>
      {steps.map((step, index) => {
        const status =
          index < current ? "done" : index === current ? "current" : "future";
        const selectable = onSelect && index <= current;
        return (
          <li
            key={step.id}
            className="wizard-stepper__item"
            data-status={status}
            aria-current={status === "current" ? "step" : undefined}
          >
            <button
              type="button"
              className="wizard-stepper__button"
              disabled={!selectable}
              onClick={() => {
                if (selectable) onSelect(index);
              }}
            >
              <span className="wizard-stepper__index num" aria-hidden="true">
                {status === "done" ? (
                  <Check size={12} strokeWidth={2.5} />
                ) : (
                  String(index + 1).padStart(2, "0")
                )}
              </span>
              <span className="wizard-stepper__label">{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
