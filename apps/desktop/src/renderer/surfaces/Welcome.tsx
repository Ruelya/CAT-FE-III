export interface WelcomeProps {
  onCreate: () => void;
  disabled?: boolean;
}

export function Welcome({ onCreate, disabled }: WelcomeProps) {
  return (
    <section className="surface surface--center" data-testid="welcome">
      <div
        className="app-chrome__ribbon"
        aria-hidden="true"
        style={{ width: 48, height: 48 }}
      >
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <h1 className="surface__title">Translunar</h1>
      <button
        type="button"
        className="btn btn--primary"
        disabled={disabled}
        onClick={onCreate}
      >
        Create project
      </button>
    </section>
  );
}
