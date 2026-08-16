import { useRef, useState, type FormEvent } from "react";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import { JobWizardSteps } from "../shell/JobWizardSteps";

export interface CreateProjectProps {
  pending?: boolean;
  error?: UiError | null;
  disabled?: boolean;
  onSubmit: (input: {
    name: string;
    domain: string;
    sourceLocale: string;
    targetLocale: string;
  }) => void;
  onCancel: () => void;
}

type FieldName = "name" | "domain" | "sourceLocale" | "targetLocale";

const FIELDS: Array<{ name: FieldName; id: string; label: string }> = [
  { name: "name", id: "project-name", label: "Name" },
  { name: "domain", id: "project-domain", label: "Domain" },
  { name: "sourceLocale", id: "project-source", label: "Source locale" },
  { name: "targetLocale", id: "project-target", label: "Target locale" },
];

export function CreateProject({
  pending,
  error,
  disabled,
  onSubmit,
  onCancel,
}: CreateProjectProps) {
  const [values, setValues] = useState<Record<FieldName, string>>({
    name: "",
    domain: "general",
    sourceLocale: "en-US",
    targetLocale: "zh-CN",
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<FieldName, string>>
  >({});
  const formRef = useRef<HTMLFormElement>(null);

  const busy = Boolean(pending || disabled);

  function setValue(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    // Clear the error as soon as the user starts fixing it.
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Record<FieldName, string>> = {};
    for (const field of FIELDS) {
      if (!values[field.name].trim()) {
        next[field.name] = `${field.label} is required.`;
      }
    }
    setFieldErrors(next);

    const firstInvalid = FIELDS.find((field) => next[field.name]);
    if (firstInvalid) {
      // Move focus to the first problem so a keyboard user is not left
      // guessing which control the submit rejected.
      formRef.current
        ?.querySelector<HTMLElement>(`#${firstInvalid.id}`)
        ?.focus();
      return;
    }

    onSubmit({
      name: values.name.trim(),
      domain: values.domain.trim(),
      sourceLocale: values.sourceLocale.trim(),
      targetLocale: values.targetLocale.trim(),
    });
  }

  return (
    <section className="surface surface--narrow" data-testid="create-project">
      <div className="surface__inner">
        <h1 className="surface__title">Create project</h1>
        <JobWizardSteps current="general" />
        <p className="surface__subtitle">
          Name the job and set the language pair. Source files come next.
        </p>
        <form
          ref={formRef}
          className="surface__panel stack"
          onSubmit={handleSubmit}
          noValidate
        >
          {FIELDS.map((field) => {
            const message = fieldErrors[field.name];
            return (
              <div className="field" key={field.name}>
                <label className="field__label" htmlFor={field.id}>
                  {field.label}
                </label>
                <input
                  id={field.id}
                  className="field__control"
                  value={values[field.name]}
                  disabled={busy}
                  onChange={(event) => setValue(field.name, event.target.value)}
                  autoComplete="off"
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? `${field.id}-error` : undefined}
                />
                {message ? (
                  <p className="field__error" id={`${field.id}-error`}>
                    {message}
                  </p>
                ) : null}
              </div>
            );
          })}

          {error ? (
            <p className="error-text" role="alert">
              {formatUiError(error)}
            </p>
          ) : null}

          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              data-pending={pending ? "true" : undefined}
            >
              {pending ? "Creating" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
