import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";

export interface EditorPanelShellProps {
  title: string;
  onClose: () => void;
  testId: string;
  children: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Chrome and focus contract shared by every editor panel.
 *
 * These panels are non-modal, so they do not trap focus, but they still owe
 * the user continuity: opening moves focus into the panel, and closing returns
 * it to the control that opened it. Previously closing a panel dropped focus
 * to the document body, which strands a keyboard user in the middle of the
 * editor.
 *
 * The opener can disappear while the panel is open, for example when the
 * command becomes unavailable for the newly active row, so the fallback is the
 * editor command bar rather than nothing.
 */
export function EditorPanelShell({
  title,
  onClose,
  testId,
  children,
}: EditorPanelShellProps) {
  const rootRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;

    const root = rootRef.current;
    const first = root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    return () => {
      const opener = openerRef.current;
      if (opener && document.contains(opener)) {
        opener.focus();
        return;
      }
      const fallback = document.querySelector<HTMLElement>(
        '[data-testid="editor-command-bar"] button:not([disabled])',
      );
      fallback?.focus();
    };
  }, []);

  return (
    // A named region rather than <aside>: a complementary landmark nested
    // inside main is a landmark-structure violation.
    <section
      ref={rootRef}
      className="editor-panel"
      aria-label={title}
      data-testid={testId}
    >
      <header className="editor-panel__header">
        <h2 className="editor-panel__title">{title}</h2>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label={`Close ${title}`}
          title={`Close ${title}`}
          onClick={onClose}
        >
          <X size={16} weight="bold" />
        </button>
      </header>
      {children}
    </section>
  );
}
