import { useState } from "react";
import type { RecycleEntry } from "@translunar/contracts";

import { Trash } from "@phosphor-icons/react";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import { formatRelativeTime } from "../lib/format";
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
  const [confirm, setConfirm] = useState<{ entry: RecycleEntry } | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Restore is reversible, so it acts in one click; only the irreversible
  // purge keeps a confirmation.
  async function runRestore(entry: RecycleEntry) {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const ok = await onRestore(entry.id);
      if (!ok) setActionError("Restore failed.");
    } finally {
      setActionPending(false);
    }
  }

  async function runPurge() {
    if (!confirm || actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const ok = await onPurge(confirm.entry.id);
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
      <div className="surface__inner">
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

        {error ? (
          <p className="error-text" role="alert">
            {formatUiError(error)}
          </p>
        ) : null}
        {actionError && !confirm ? (
          <p className="error-text" role="alert">
            {actionError}
          </p>
        ) : null}
        {loading ? (
          <div
            className="skeleton-stack"
            role="status"
            aria-label="Loading recycled entries"
          >
            {[0, 1, 2].map((row) => (
              <div key={row} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}
        {!loading && items.length === 0 ? (
          <div className="empty-state" data-testid="recycle-empty">
            <Trash
              size={24}
              weight="regular"
              className="empty-state__icon"
              aria-hidden="true"
            />
            <h2 className="empty-state__title">Recycle is empty</h2>
          </div>
        ) : null}

        <ul className="project-list">
          {items.map((entry) => (
            <li key={entry.id} className="project-list__item">
              <div className="project-row">
                <div className="project-row__meta">
                  <p className="project-row__name">{entry.displayName}</p>
                  <p className="project-row__facts">
                    <span className="chip">{entry.entityType}</span>
                    <span
                      className="mono"
                      title={new Date(entry.deletedAtMs).toLocaleString()}
                    >
                      deleted {formatRelativeTime(entry.deletedAtMs)}
                    </span>
                    <span
                      className="mono"
                      title={new Date(entry.retentionUntilMs).toLocaleString()}
                    >
                      kept until{" "}
                      {new Date(entry.retentionUntilMs)
                        .toISOString()
                        .slice(0, 10)}
                    </span>
                  </p>
                  {entry.reason ? (
                    <p className="project-row__reason">{entry.reason}</p>
                  ) : null}
                </div>
                <div className="project-row__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busy || actionPending}
                    onClick={() => void runRestore(entry)}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={busy}
                    onClick={() => {
                      setActionError(null);
                      setConfirm({ entry });
                    }}
                  >
                    Purge
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {items.length > 0 || offset > 0 ? (
          <div className="pagination">
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              disabled={busy || offset <= 0}
              onClick={() => onPage(Math.max(0, offset - limit))}
            >
              Previous
            </button>
            <span className="pagination__count">
              {total === 0
                ? "0"
                : `${offset + 1}-${Math.min(offset + limit, total)}`}{" "}
              of {total}
            </span>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              disabled={busy || offset + limit >= total}
              onClick={() => onPage(offset + limit)}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      {confirm ? (
        <ConfirmDialog
          title="Purge permanently"
          body={`${confirm.entry.displayName} will be permanently deleted. This cannot be undone.`}
          confirmLabel="Purge"
          pending={actionPending}
          error={actionError}
          onConfirm={() => void runPurge()}
          onCancel={() => setConfirm(null)}
          testId="purge-confirm"
        />
      ) : null}
    </section>
  );
}
