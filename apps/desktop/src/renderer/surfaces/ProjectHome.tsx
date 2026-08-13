import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "@phosphor-icons/react";
import type { Project } from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import { rowEnterProps, withListClass } from "../lib/dom";
import { formatRelativeTime } from "../lib/format";
import type { ProjectListLifecycle } from "../state/app-state";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { ModalDialog } from "../shell/ModalDialog";
import { RowMenu } from "../shell/RowMenu";

export interface ProjectHomeProps {
  projects: Project[];
  lifecycle: ProjectListLifecycle;
  total: number;
  offset: number;
  limit: number;
  error?: UiError | null;
  actionError?: UiError | null;
  loading?: boolean;
  disabled?: boolean;
  pendingExample?: boolean;
  onOpen: (projectId: string) => void;
  onCreate: () => void;
  onOpenExample: () => void;
  onLifecycleFilter: (lifecycle: ProjectListLifecycle) => void;
  onPage: (offset: number) => void;
  onGoTemplates: () => void;
  onGoRecycle: () => void;
  onBeginEdit: (projectId: string) => Promise<Project | null>;
  onUpdateProject: (input: {
    projectId: string;
    expectedRevision: number;
    name: string;
    domain: string;
    sourceLocale: string;
    targetLocale: string;
    configuration: Project["configuration"];
  }) => Promise<boolean>;
  onSetLifecycle: (
    projectId: string,
    expectedRevision: number,
    lifecycle: "active" | "archived",
  ) => Promise<boolean>;
  onRecycleProject: (
    projectId: string,
    expectedRevision: number,
    reason: string,
  ) => Promise<boolean>;
  onInsights?: (projectId: string) => void;
  onAssets?: (projectId: string) => void;
}

type DialogState =
  | { kind: "none" }
  | { kind: "edit"; project: Project }
  | { kind: "archive"; project: Project }
  | { kind: "unarchive"; project: Project }
  | { kind: "recycle"; project: Project };

export function ProjectHome({
  projects,
  lifecycle,
  total,
  offset,
  limit,
  error,
  actionError,
  loading,
  disabled,
  pendingExample,
  onOpen,
  onCreate,
  onOpenExample,
  onLifecycleFilter,
  onPage,
  onGoTemplates,
  onGoRecycle,
  onBeginEdit,
  onUpdateProject,
  onSetLifecycle,
  onRecycleProject,
  onInsights,
  onAssets,
}: ProjectHomeProps) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [editForm, setEditForm] = useState({
    name: "",
    domain: "",
    sourceLocale: "",
    targetLocale: "",
  });
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const editPendingRef = useRef(false);
  const busy = Boolean(disabled || loading);

  useEffect(() => {
    if (dialog.kind === "none" && restoreFocusRef.current) {
      restoreFocusRef.current.focus();
      restoreFocusRef.current = null;
    }
  }, [dialog.kind]);

  function openDialog(next: DialogState, trigger?: HTMLElement | null) {
    restoreFocusRef.current =
      trigger ?? (document.activeElement as HTMLElement);
    setDialogError(null);
    setReason("");
    setPending(false);
    if (next.kind === "edit") {
      setEditForm({
        name: next.project.name,
        domain: next.project.domain,
        sourceLocale: next.project.sourceLocale,
        targetLocale: next.project.targetLocale,
      });
    }
    setDialog(next);
  }

  async function startEdit(projectId: string, trigger: HTMLElement) {
    if (editPendingRef.current || busy) return;
    editPendingRef.current = true;
    restoreFocusRef.current = trigger;
    setDialogError(null);
    try {
      const project = await onBeginEdit(projectId);
      if (!project) {
        setDialogError("Unable to load project.");
        return;
      }
      openDialog({ kind: "edit", project }, trigger);
    } finally {
      editPendingRef.current = false;
    }
  }

  async function handleConfirm() {
    if (dialog.kind === "none" || pending) return;
    setPending(true);
    setDialogError(null);
    try {
      let ok = false;
      if (dialog.kind === "edit") {
        if (
          !editForm.name.trim() ||
          !editForm.domain.trim() ||
          !editForm.sourceLocale.trim() ||
          !editForm.targetLocale.trim()
        ) {
          setDialogError("All fields are required.");
          setPending(false);
          return;
        }
        ok = await onUpdateProject({
          projectId: dialog.project.id,
          expectedRevision: dialog.project.revision,
          name: editForm.name.trim(),
          domain: editForm.domain.trim(),
          sourceLocale: editForm.sourceLocale.trim(),
          targetLocale: editForm.targetLocale.trim(),
          configuration: dialog.project.configuration,
        });
      } else if (dialog.kind === "archive") {
        ok = await onSetLifecycle(
          dialog.project.id,
          dialog.project.revision,
          "archived",
        );
      } else if (dialog.kind === "unarchive") {
        ok = await onSetLifecycle(
          dialog.project.id,
          dialog.project.revision,
          "active",
        );
      } else if (dialog.kind === "recycle") {
        if (!reason.trim()) {
          setDialogError("Reason is required.");
          setPending(false);
          return;
        }
        ok = await onRecycleProject(
          dialog.project.id,
          dialog.project.revision,
          reason.trim(),
        );
      }
      if (ok) {
        setDialog({ kind: "none" });
      } else {
        setDialogError("Action failed.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="surface" data-testid="project-home">
      <div className="surface__inner">
        <div className="surface__masthead">
          <div className="surface__masthead-meta">
            <h1 className="surface__title">Projects</h1>
          </div>
          <div className="surface__actions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={onGoTemplates}
              data-testid="nav-templates"
            >
              Templates
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={onGoRecycle}
              data-testid="nav-recycle"
            >
              Recycle
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy || pendingExample}
              onClick={onOpenExample}
              data-testid="open-example"
            >
              {pendingExample ? "Opening" : "Open example"}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={onCreate}
            >
              Create project
            </button>
          </div>
        </div>

        {/* Two independent toggles rather than a partial tab widget: each is
            reachable with Tab and activated with Space or Enter, which is the
            complete contract for a toggle button. */}
        <div
          className="segmented"
          role="group"
          aria-label="Project lifecycle"
          data-testid="project-lifecycle-tabs"
        >
          <button
            type="button"
            className="segmented__item"
            aria-pressed={lifecycle === "active"}
            data-selected={lifecycle === "active"}
            disabled={busy}
            onClick={() => onLifecycleFilter("active")}
          >
            Active
          </button>
          <button
            type="button"
            className="segmented__item"
            aria-pressed={lifecycle === "archived"}
            data-selected={lifecycle === "archived"}
            disabled={busy}
            onClick={() => onLifecycleFilter("archived")}
          >
            Archived
          </button>
        </div>

        {error ? (
          <p className="error-text" role="alert">
            {formatUiError(error)}
          </p>
        ) : null}
        {actionError ? (
          <p className="error-text" role="alert">
            {formatUiError(actionError)}
          </p>
        ) : null}
        {dialogError && dialog.kind === "none" ? (
          <p className="error-text" role="alert">
            {dialogError}
          </p>
        ) : null}

        {loading ? (
          <div
            className="skeleton-stack"
            role="status"
            aria-label="Loading projects"
            data-testid="projects-loading"
          >
            {[0, 1, 2].map((row) => (
              <div key={row} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state" data-testid="projects-empty">
            <FolderOpen
              size={24}
              weight="regular"
              className="empty-state__icon"
              aria-hidden="true"
            />
            <h2 className="empty-state__title">
              {lifecycle === "active"
                ? "No active projects"
                : "No archived projects"}
            </h2>
            {/* Create project is already the masthead primary, so only the
                archived case offers an action the surface does not have. */}
            {lifecycle === "archived" ? (
              <button
                type="button"
                className="btn btn--secondary"
                disabled={busy}
                onClick={() => onLifecycleFilter("active")}
              >
                Show active
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="project-list">
            {projects.map((project, index) => (
              <li
                key={project.id}
                {...withListClass("project-list__item", rowEnterProps(index))}
              >
                <div className="project-row">
                  <div className="project-row__meta">
                    <p className="project-row__name" title={project.name}>
                      {project.name}
                    </p>
                    <p className="project-row__facts">
                      <span className="project-row__locales">
                        {project.sourceLocale} to {project.targetLocale}
                      </span>
                      <span>{project.domain}</span>
                      <span
                        className="mono"
                        title={new Date(project.updatedAtMs).toLocaleString()}
                      >
                        {formatRelativeTime(project.updatedAtMs)}
                      </span>
                    </p>
                  </div>
                  <div className="project-row__actions">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busy}
                      onClick={() => onOpen(project.id)}
                    >
                      Open
                    </button>
                    <RowMenu
                      label={`More actions for ${project.name}`}
                      disabled={busy}
                      testId={`project-menu-${project.id}`}
                      items={[
                        {
                          id: "edit",
                          label: "Edit",
                          onSelect: () => {
                            void startEdit(
                              project.id,
                              document.activeElement as HTMLElement,
                            );
                          },
                        },
                        lifecycle === "active"
                          ? {
                              id: "archive",
                              label: "Archive",
                              onSelect: () =>
                                openDialog({ kind: "archive", project }),
                            }
                          : {
                              id: "unarchive",
                              label: "Unarchive",
                              onSelect: () =>
                                openDialog({ kind: "unarchive", project }),
                            },
                        ...(onInsights
                          ? [
                              {
                                id: "insights",
                                label: "Insights",
                                onSelect: () => onInsights(project.id),
                              },
                            ]
                          : []),
                        ...(onAssets
                          ? [
                              {
                                id: "assets",
                                label: "Assets",
                                testId: `project-assets-${project.id}`,
                                onSelect: () => onAssets(project.id),
                              },
                            ]
                          : []),
                        {
                          id: "recycle",
                          label: "Recycle",
                          danger: true,
                          onSelect: () =>
                            openDialog({ kind: "recycle", project }),
                        },
                      ]}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {projects.length > 0 || offset > 0 ? (
          <div className="pagination" data-testid="projects-paging">
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
                : `${offset + 1}-${Math.min(offset + projects.length, total)}`}{" "}
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

      {dialog.kind === "edit" ? (
        <ModalDialog
          title="Edit project"
          pending={pending}
          onCancel={() => setDialog({ kind: "none" })}
          testId="edit-project-dialog"
          actions={
            <button
              type="button"
              className="btn btn--primary"
              disabled={pending}
              onClick={() => void handleConfirm()}
            >
              {pending ? "Saving" : "Save"}
            </button>
          }
        >
          <div className="surface__stack">
            <div className="field">
              <label className="field__label" htmlFor="edit-name">
                Name
              </label>
              <input
                id="edit-name"
                className="field__control"
                value={editForm.name}
                disabled={pending}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="edit-domain">
                Domain
              </label>
              <input
                id="edit-domain"
                className="field__control"
                value={editForm.domain}
                disabled={pending}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, domain: e.target.value }))
                }
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="edit-source">
                Source locale
              </label>
              <input
                id="edit-source"
                className="field__control"
                value={editForm.sourceLocale}
                disabled={pending}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    sourceLocale: e.target.value,
                  }))
                }
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="edit-target">
                Target locale
              </label>
              <input
                id="edit-target"
                className="field__control"
                value={editForm.targetLocale}
                disabled={pending}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    targetLocale: e.target.value,
                  }))
                }
              />
            </div>
            {dialogError ? <p className="field__error">{dialogError}</p> : null}
          </div>
        </ModalDialog>
      ) : null}

      {dialog.kind === "archive" || dialog.kind === "unarchive" ? (
        <ConfirmDialog
          title={
            dialog.kind === "archive" ? "Archive project" : "Unarchive project"
          }
          body={`${dialog.project.name}`}
          confirmLabel={dialog.kind === "archive" ? "Archive" : "Unarchive"}
          danger={false}
          pending={pending}
          error={dialogError}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setDialog({ kind: "none" })}
          testId="lifecycle-confirm"
        />
      ) : null}

      {dialog.kind === "recycle" ? (
        <ConfirmDialog
          title="Recycle project"
          body={`${dialog.project.name} will move to recycle.`}
          confirmLabel="Recycle"
          pending={pending}
          error={dialogError}
          reasonLabel="Reason"
          reason={reason}
          onReasonChange={setReason}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setDialog({ kind: "none" })}
          testId="recycle-project-confirm"
        />
      ) : null}
    </section>
  );
}
