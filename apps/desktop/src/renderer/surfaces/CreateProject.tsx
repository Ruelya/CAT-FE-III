import { useState, type FormEvent } from "react";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";

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

export function CreateProject({
  pending,
  error,
  disabled,
  onSubmit,
  onCancel,
}: CreateProjectProps) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("general");
  const [sourceLocale, setSourceLocale] = useState("en-US");
  const [targetLocale, setTargetLocale] = useState("zh-CN");
  const [localError, setLocalError] = useState<string | null>(null);

  const busy = Boolean(pending || disabled);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setLocalError("Name is required.");
      return;
    }
    if (!domain.trim() || !sourceLocale.trim() || !targetLocale.trim()) {
      setLocalError("All fields are required.");
      return;
    }
    setLocalError(null);
    onSubmit({
      name: name.trim(),
      domain: domain.trim(),
      sourceLocale: sourceLocale.trim(),
      targetLocale: targetLocale.trim(),
    });
  }

  return (
    <section className="surface" data-testid="create-project">
      <div className="surface__stack">
        <h1 className="surface__title">Create project</h1>
        <form className="surface__stack" onSubmit={handleSubmit}>
          <div className="field">
            <label className="field__label" htmlFor="project-name">
              Name
            </label>
            <input
              id="project-name"
              className="field__control"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="project-domain">
              Domain
            </label>
            <input
              id="project-domain"
              className="field__control"
              value={domain}
              disabled={busy}
              onChange={(e) => setDomain(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="project-source">
              Source locale
            </label>
            <input
              id="project-source"
              className="field__control"
              value={sourceLocale}
              disabled={busy}
              onChange={(e) => setSourceLocale(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="project-target">
              Target locale
            </label>
            <input
              id="project-target"
              className="field__control"
              value={targetLocale}
              disabled={busy}
              onChange={(e) => setTargetLocale(e.target.value)}
              autoComplete="off"
            />
          </div>
          {localError ? <p className="field__error">{localError}</p> : null}
          {error ? (
            <p className="field__error">{formatUiError(error)}</p>
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
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {pending ? "Creating" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
