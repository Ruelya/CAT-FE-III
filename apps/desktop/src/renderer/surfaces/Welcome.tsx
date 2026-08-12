import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";

export interface WelcomeProps {
  onCreate: () => void;
  onOpenExample: () => void;
  disabled?: boolean;
  pendingExample?: boolean;
  error?: UiError | null;
}

export function Welcome({
  onCreate,
  onOpenExample,
  disabled,
  pendingExample,
  error,
}: WelcomeProps) {
  const busy = Boolean(disabled || pendingExample);
  return (
    <section className="surface surface--center" data-testid="welcome">
      <div className="welcome__mark" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <h1 className="surface__title">Translunar</h1>
      {error ? (
        <p className="error-text" role="alert">
          {formatUiError(error)}
        </p>
      ) : null}
      <div className="btn-group">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={onCreate}
        >
          Create project
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={onOpenExample}
          data-testid="open-example"
        >
          {pendingExample ? "Opening" : "Open example"}
        </button>
      </div>
    </section>
  );
}
