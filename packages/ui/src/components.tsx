import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "outline",
  size = "md",
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={join("tl-button", className)}
      data-variant={variant}
      data-size={size}
      {...rest}
    />
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextField({ label, className, ...rest }: TextFieldProps) {
  return (
    <label className={join("tl-field", className)}>
      <span className="tl-field__label">{label}</span>
      <input className="tl-field__control" {...rest} />
    </label>
  );
}

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextAreaField({
  label,
  className,
  ...rest
}: TextAreaFieldProps) {
  return (
    <label className={join("tl-field", className)}>
      <span className="tl-field__label">{label}</span>
      <textarea className="tl-field__control" {...rest} />
    </label>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  children: ReactNode;
}

export function SelectField({
  label,
  className,
  children,
  ...rest
}: SelectFieldProps) {
  return (
    <label className={join("tl-field", className)}>
      <span className="tl-field__label">{label}</span>
      <select className="tl-field__control" {...rest}>
        {children}
      </select>
    </label>
  );
}

export type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string;
}

export function Badge({ tone = "neutral", children, title }: BadgeProps) {
  return (
    <span className="tl-badge" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

export interface PanelProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, actions, children, className }: PanelProps) {
  return (
    <section className={join("tl-panel", className)}>
      <header className="tl-panel__header">
        <h2 className="tl-panel__title">{title}</h2>
        {actions ? <div className="tl-toolbar">{actions}</div> : null}
      </header>
      <div className="tl-panel__body">{children}</div>
    </section>
  );
}

export type StatusDotState = "ok" | "busy" | "down" | "idle";

export function StatusDot({ state }: { state: StatusDotState }) {
  return <span className="tl-status-dot" data-state={state} />;
}

export interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="tl-empty">
      <p className="tl-empty__title">{title}</p>
      {hint ? <p className="tl-empty__hint">{hint}</p> : null}
      {action}
    </div>
  );
}

function join(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
