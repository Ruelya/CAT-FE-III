import { useCallback, useState, type ReactNode } from "react";

import { ConfirmDialog } from "./ConfirmDialog";

export interface DestructiveRequest {
  title: string;
  body: string;
  confirmLabel: string;
  testId?: string;
  /** Resolves false to keep the dialog open and show the failure. */
  run: () => Promise<boolean | void> | boolean | void;
}

export interface DestructiveConfirm {
  /** Open the confirmation for one action. */
  request: (input: DestructiveRequest) => void;
  /** Render inside the surface; null when nothing is pending. */
  dialog: ReactNode;
}

/**
 * Cancel-first confirmation for any destructive command.
 *
 * Several P4 commands deleted an AI profile, a stored credential, a connector
 * profile, or a collaboration member on a single click with no confirmation at
 * all. This gives every one of them the same protected path: Cancel takes
 * initial focus, Escape cancels, focus is trapped and restored, and the dialog
 * stays mounted through the async call so a failure is visible instead of
 * silently closing.
 */
export function useDestructiveConfirm(): DestructiveConfirm {
  const [pendingRequest, setPendingRequest] =
    useState<DestructiveRequest | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback((input: DestructiveRequest) => {
    setError(null);
    setPending(false);
    setPendingRequest(input);
  }, []);

  const close = useCallback(() => {
    setPendingRequest(null);
    setPending(false);
    setError(null);
  }, []);

  const confirm = useCallback(() => {
    if (!pendingRequest || pending) return;
    setPending(true);
    setError(null);
    void Promise.resolve(pendingRequest.run())
      .then((result) => {
        if (result === false) {
          setPending(false);
          setError("Action failed.");
          return;
        }
        close();
      })
      .catch(() => {
        setPending(false);
        setError("Action failed.");
      });
  }, [close, pending, pendingRequest]);

  const dialog = pendingRequest ? (
    <ConfirmDialog
      title={pendingRequest.title}
      body={pendingRequest.body}
      confirmLabel={pendingRequest.confirmLabel}
      pending={pending}
      error={error}
      onCancel={close}
      onConfirm={confirm}
      {...(pendingRequest.testId ? { testId: pendingRequest.testId } : {})}
    />
  ) : null;

  return { request, dialog };
}
