import { useState } from "react";
import { Trash } from "@phosphor-icons/react";

import { formatUiError } from "../lib/errors";
import { basenameFromPath } from "../state/interop-view";
import { isSafeSelectableRow, isTerminalTaskPreviewStatus } from "../state/task-package-view";
import type { TaskPackageApi } from "../state/use-task-package-controller";
import { ConfirmDialog } from "../shell/ConfirmDialog";

export interface TaskPackagePanelProps {
  taskPackage: TaskPackageApi;
  disabled?: boolean;
}

type TaskConfirm =
  | { kind: "none" }
  | { kind: "apply" }
  | { kind: "import" }
  | { kind: "discard" };

export function TaskPackagePanel({
  taskPackage,
  disabled,
}: TaskPackagePanelProps) {
  const { state } = taskPackage;
  const preview = state.preview;
  const terminal = preview
    ? isTerminalTaskPreviewStatus(preview.status)
    : false;
  const busy = Boolean(disabled || state.pending);
  const [confirm, setConfirm] = useState<TaskConfirm>({ kind: "none" });

  return (
    <div className="task-package-panel" data-testid="task-package-panel">
      <div className="interop-panel__toolbar">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || !taskPackage.canExportAssignment}
          onClick={() => {
            void taskPackage.exportPackage("assignment");
          }}
          data-testid="task-export-assignment"
        >
          Export assignment
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || !taskPackage.canExportReturn}
          onClick={() => {
            void taskPackage.exportPackage("return");
          }}
          data-testid="task-export-return"
        >
          Export return
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={() => {
            void taskPackage.pickPackage();
          }}
          data-testid="task-open"
        >
          Open
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={
            busy ||
            !state.packagePath ||
            !state.actor.trim() ||
            !state.reason.trim()
          }
          onClick={() => {
            void taskPackage.preview(0);
          }}
          data-testid="task-preview"
        >
          Preview
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !taskPackage.canApply}
          onClick={() => setConfirm({ kind: "apply" })}
          data-testid="task-apply"
        >
          {taskPackage.applyLabel}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || !taskPackage.canImport}
          onClick={() => setConfirm({ kind: "import" })}
          data-testid="task-import"
        >
          Import
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label="Discard package preview"
          disabled={busy || !taskPackage.canDiscard}
          onClick={() => setConfirm({ kind: "discard" })}
          data-testid="task-discard"
        >
          <Trash size={16} weight="bold" />
        </button>
      </div>

      <div className="interop-panel__fields">
        <div className="field">
          <label className="field__label" htmlFor="task-actor">
            Actor
          </label>
          <input
            id="task-actor"
            className="field__control"
            value={state.actor}
            disabled={busy || terminal}
            onChange={(e) => taskPackage.setActor(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="task-reason">
            Reason
          </label>
          <input
            id="task-reason"
            className="field__control"
            value={state.reason}
            disabled={busy || terminal}
            onChange={(e) => taskPackage.setReason(e.target.value)}
          />
        </div>
      </div>

      {state.packagePath ? (
        <p className="muted" data-testid="task-path">
          {basenameFromPath(state.packagePath)}
        </p>
      ) : null}
      {state.exportNotice ? (
        <p className="muted" data-testid="task-export-notice">
          {basenameFromPath(state.exportNotice)}
        </p>
      ) : null}
      {state.notice ? (
        <p className="muted" data-testid="task-notice">
          {state.notice}
        </p>
      ) : null}
      {state.error ? (
        <p className="error-text">{formatUiError(state.error)}</p>
      ) : null}
      {state.pending ? <p className="muted">Working</p> : null}

      {preview ? (
        <>
          <p className="muted" data-testid="task-status">
            {preview.status}
          </p>
          <table className="data-table" data-testid="task-rows">
            <thead>
              <tr>
                <th scope="col">Select</th>
                <th scope="col">Disposition</th>
                <th scope="col">Reason</th>
                <th scope="col">Segment</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => {
                const safe = isSafeSelectableRow(row);
                return (
                  <tr key={row.rowId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={state.selectedRowIds.has(row.rowId)}
                        disabled={busy || terminal || !safe}
                        onChange={(e) =>
                          taskPackage.toggleRow(row.rowId, e.target.checked)
                        }
                        aria-label={`Select ${row.rowId}`}
                        data-testid={`task-row-${row.rowId}`}
                      />
                    </td>
                    <td>{row.disposition}</td>
                    <td>{row.reason}</td>
                    <td>{row.originSegmentId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {preview.total > preview.limit ? (
            <div className="dialog__actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy || preview.offset <= 0}
                onClick={() => {
                  void taskPackage.preview(
                    Math.max(0, preview.offset - preview.limit),
                  );
                }}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={
                  busy || preview.offset + preview.limit >= preview.total
                }
                onClick={() => {
                  void taskPackage.preview(preview.offset + preview.limit);
                }}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {confirm.kind === "apply" ? (
        <ConfirmDialog
          title="Apply package"
          body={`${state.selectedRowIds.size} selected rows will apply.`}
          confirmLabel="Apply"
          danger={false}
          pending={state.pending}
          onCancel={() => setConfirm({ kind: "none" })}
          onConfirm={() => {
            setConfirm({ kind: "none" });
            void taskPackage.apply();
          }}
          testId="task-apply-confirm"
        />
      ) : null}
      {confirm.kind === "import" ? (
        <ConfirmDialog
          title="Import package"
          body="Package contents will import into the project."
          confirmLabel="Import"
          danger={false}
          pending={state.pending}
          onCancel={() => setConfirm({ kind: "none" })}
          onConfirm={() => {
            setConfirm({ kind: "none" });
            void taskPackage.importPackage();
          }}
          testId="task-import-confirm"
        />
      ) : null}
      {confirm.kind === "discard" ? (
        <ConfirmDialog
          title="Discard package"
          body="Staged preview will be discarded."
          confirmLabel="Discard"
          danger
          pending={state.pending}
          onCancel={() => setConfirm({ kind: "none" })}
          onConfirm={() => {
            setConfirm({ kind: "none" });
            void taskPackage.discard();
          }}
          testId="task-discard-confirm"
        />
      ) : null}
    </div>
  );
}
