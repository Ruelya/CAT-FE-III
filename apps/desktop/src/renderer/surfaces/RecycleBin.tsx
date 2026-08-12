import { useState } from "react";
import type { RecycleEntry } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import { ConfirmDialog } from "../shell/ConfirmDialog";

export interface RecycleBinProps {
  items: RecycleEntry[];
  total: number;
  offset: number;
  limit: number;
  loading: boolean;
  error: UiError | null;
  pending: boolean;
  disabled?: boolean;
  onBack: () => void;
  onPage: (offset: number) => void;
  onRestore: (entryId: string) => Promise<boolean>;
  onPurge: (entryId: string) => Promise<boolean>;
}

export function RecycleBin({
  items,
  total,
  offset,
  limit,
  loading,
  error,
  pending,
  disabled,
  onBack,
  onPage,
  onRestore,
  onPurge,
}: RecycleBinProps) {
  const busy = Boolean(disabled || pending || loading);
  const [confirm, setConfirm] = useState<
    | { kind: "restore"; entry: RecycleEntry }
    | { kind: "purge"; entry: RecycleEntry }
    | null
  >(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runConfirm() {
    if (!confirm || actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const ok =
        confirm.kind === "restore"
          ? await onRestore(confirm.entry.id)
          : await onPurge(confirm.entry.id);
      if (ok) {
        setConfirm(null);
      } else {
        setActionError("Action failed.");
      }
    } finally {
      setActionPending(false);
    }
  }

  return (
    <section className="surface" data-testid="recycle-bin">
      <div className="surface__masthead">
        <h1 className="surface__title">Recycle</h1>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={onBack}
        >
          Projects
        </button>
      </div>

      {error ? <p className="error-text">{formatUiError(error)}</p> : null}
      {loading ? <p className="muted">Loading</p> : null}
      {!loading && items.length === 0 ? <p className="muted">Empty</p> : null}

      <ul className="project-list">
        {items.map((entry) => (
          <li key={entry.id} className="project-row">
            <div className="project-row__meta">
              <p className="project-row__name">{entry.displayName}</p>
              <p className="project-row__locales">
                {entry.entityType} ·{" "}
                {new Date(entry.deletedAtMs).toLocaleString()} · until{" "}
                {new Date(entry.retentionUntilMs).toLocaleString()}
              </p>
              <p className="muted">{entry.reason}</p>
            </div>
            <div className="project-row__actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={busy}
                onClick={() => {
                  setActionError(null);
                  setConfirm({ kind: "restore", entry });
                }}
              >
                Restore
              </button>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                disabled={busy}
                onClick={() => {
                  setActionError(null);
                  setConfirm({ kind: "purge", entry });
                }}
              >
                Purge
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="dialog__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy || offset <= 0}
          onClick={() => onPage(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <span className="muted">
          {total === 0
            ? "0"
            : `${offset + 1}-${Math.min(offset + limit, total)}`}{" "}
          of {total}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy || offset + limit >= total}
          onClick={() => onPage(offset + limit)}
        >
          Next
        </button>
      </div>

      {confirm?.kind === "restore" ? (
        <ConfirmDialog
          title="Restore entry"
          body={`${confirm.entry.displayName} will be restored.`}
          confirmLabel="Restore"
          danger={false}
          pending={actionPending}
          error={actionError}
          onConfirm={() => void runConfirm()}
          onCancel={() => setConfirm(null)}
          testId="restore-confirm"
        />
      ) : null}

      {confirm?.kind === "purge" ? (
        <ConfirmDialog
          title="Purge permanently"
          body={`${confirm.entry.displayName} will be permanently deleted. This cannot be undone.`}
          confirmLabel="Purge"
          pending={actionPending}
          error={actionError}
          onConfirm={() => void runConfirm()}
          onCancel={() => setConfirm(null)}
          testId="purge-confirm"
        />
      ) : null}
    </section>
  );
}
