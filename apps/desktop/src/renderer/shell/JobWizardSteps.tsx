export const JOB_WIZARD_STEPS = [
  { id: "general", label: "General" },
  { id: "files", label: "Files" },
  { id: "memory", label: "Memory" },
  { id: "terms", label: "Terms" },
  { id: "prepare", label: "Prepare" },
] as const;

export type JobWizardStepId = (typeof JOB_WIZARD_STEPS)[number]["id"];

export interface JobWizardStepsProps {
  current: JobWizardStepId;
}

/**
 * Visual map of a Studio-style new-project sequence.
 *
 * Only General and Files are real screens. Memory, Terms, and Prepare stay
 * visible so the translator sees the rest of the job, but they are not extra
 * gates between Choose files and the workbench.
 */
export function JobWizardSteps({ current }: JobWizardStepsProps) {
  const currentIndex = JOB_WIZARD_STEPS.findIndex((step) => step.id === current);

  return (
    <ol className="job-wizard" data-testid="job-wizard-steps">
      {JOB_WIZARD_STEPS.map((step, index) => {
        const state =
          index < currentIndex
            ? "done"
            : index === currentIndex
              ? "current"
              : "upcoming";
        return (
          <li
            key={step.id}
            className={`job-wizard__step job-wizard__step--${state}`}
            data-testid={`job-wizard-step-${step.id}`}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="job-wizard__index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="job-wizard__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
