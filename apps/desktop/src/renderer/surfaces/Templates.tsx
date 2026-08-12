import { useState, type FormEvent } from "react";
import type { ProjectTemplate } from "@translunar/contracts";

import { Stack } from "@phosphor-icons/react";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import {
  decodeTemplateDefinition,
  type P1TemplateDefaults,
} from "../state/template-definition";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { RowMenu } from "../shell/RowMenu";

export interface TemplatesProps {
  items: ProjectTemplate[];
  total: number;
  offset: number;
  limit: number;
  loading: boolean;
  error: UiError | null;
  pending: boolean;
  selected: ProjectTemplate | null;
  mode: "list" | "create" | "edit" | "use";
  disabled?: boolean;
  onBack: () => void;
  onPage: (offset: number) => void;
  onCreateStart: () => void;
  onEditStart: (templateId: string, revision: number) => void;
  onUseStart: (templateId: string, revision: number) => void;
  onCancelMode: () => void;
  onCreate: (input: {
    name: string;
    description: string;
    defaults: P1TemplateDefaults;
  }) => void;
  onUpdate: (input: {
    templateId: string;
    expectedRevision: number;
    name: string;
    description: string;
    defaults: P1TemplateDefaults;
  }) => void;
  onDelete: (templateId: string, expectedRevision: number) => Promise<boolean>;
  onCreateFromTemplate: (input: {
    templateId: string;
    templateRevision: number;
    name: string;
    sourceLocale: string;
    targetLocale: string;
    domain: string;
  }) => void;
}

export function Templates({
  items,
  total,
  offset,
  limit,
  loading,
  error,
  pending,
  selected,
  mode,
  disabled,
  onBack,
  onPage,
  onCreateStart,
  onEditStart,
  onUseStart,
  onCancelMode,
  onCreate,
  onUpdate,
  onDelete,
  onCreateFromTemplate,
}: TemplatesProps) {
  const busy = Boolean(disabled || pending || loading);
  const [confirmDelete, setConfirmDelete] = useState<ProjectTemplate | null>(
    null,
  );
  const [deletePending, setDeletePending] = useState(false);

  const decoded = selected
    ? decodeTemplateDefinition(selected.definition)
    : null;
  const defaults: P1TemplateDefaults =
    decoded?.ok === true
      ? decoded.defaults
      : { sourceLocale: "en-US", targetLocale: "zh-CN", domain: "general" };

  return (
    <section className="surface" data-testid="templates">
      <div className="surface__masthead">
        <h1 className="surface__title">Templates</h1>
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={onBack}
          >
            Projects
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={onCreateStart}
          >
            New template
          </button>
        </div>
      </div>

      {error ? (
        <p className="error-text" role="alert">
          {formatUiError(error)}
        </p>
      ) : null}
      {loading ? (
        <div
          className="skeleton-stack"
          role="status"
          aria-label="Loading templates"
        >
          {[0, 1, 2].map((row) => (
            <div key={row} className="skeleton skeleton-row" />
          ))}
        </div>
      ) : null}

      {mode === "list" ? (
        <>
          {!loading && items.length === 0 ? (
            <div className="empty-state" data-testid="templates-empty">
              <Stack
                size={24}
                weight="regular"
                className="empty-state__icon"
                aria-hidden="true"
              />
              {/* New template already sits in the masthead; repeating it here
                  would be two controls with one intent. */}
              <h2 className="empty-state__title">No templates</h2>
            </div>
          ) : (
            <ul className="project-list">
              {items.map((template) => (
                <li key={template.id} className="project-list__item">
                  <div className="project-row">
                    <div className="project-row__meta">
                      <p className="project-row__name">{template.name}</p>
                      <p className="project-row__facts">
                        <span className="chip">
                          {template.builtIn ? "Built-in" : "Custom"}
                        </span>
                        <span className="mono">r{template.revision}</span>
                      </p>
                    </div>
                    <div className="project-row__actions">
                      <button
                        type="button"
                        className="btn btn--secondary"
                        disabled={busy}
                        onClick={() =>
                          onUseStart(template.id, template.revision)
                        }
                        aria-label={`Use template ${template.name}`}
                      >
                        Use
                      </button>
                      {!template.builtIn ? (
                        <RowMenu
                          label={`More actions for ${template.name}`}
                          disabled={busy}
                          testId={`template-menu-${template.id}`}
                          items={[
                            {
                              id: "edit",
                              label: "Edit",
                              onSelect: () =>
                                onEditStart(template.id, template.revision),
                            },
                            {
                              id: "delete",
                              label: "Delete",
                              danger: true,
                              onSelect: () => setConfirmDelete(template),
                            },
                          ]}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
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
        </>
      ) : null}

      {mode === "create" || mode === "edit" ? (
        <TemplateForm
          mode={mode}
          busy={busy}
          pending={pending}
          initialName={mode === "edit" ? (selected?.name ?? "") : ""}
          initialDescription={
            mode === "edit" ? (selected?.description ?? "") : ""
          }
          initialDefaults={defaults}
          definitionInvalid={mode === "edit" && decoded?.ok === false}
          onCancel={onCancelMode}
          onSubmit={(values) => {
            if (mode === "create") {
              onCreate(values);
              return;
            }
            if (!selected) return;
            onUpdate({
              templateId: selected.id,
              expectedRevision: selected.revision,
              ...values,
            });
          }}
        />
      ) : null}

      {mode === "use" && selected ? (
        <UseTemplateForm
          template={selected}
          defaults={defaults}
          busy={busy}
          pending={pending}
          onCancel={onCancelMode}
          onSubmit={(values) =>
            onCreateFromTemplate({
              templateId: selected.id,
              templateRevision: selected.revision,
              ...values,
            })
          }
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete template"
          body={`${confirmDelete.name} will be permanently removed.`}
          confirmLabel="Delete"
          pending={deletePending}
          error={
            error && deletePending === false && confirmDelete
              ? formatUiError(error)
              : null
          }
          onCancel={() => {
            if (deletePending) return;
            setConfirmDelete(null);
          }}
          onConfirm={() => {
            if (deletePending) return;
            setDeletePending(true);
            void onDelete(confirmDelete.id, confirmDelete.revision).then(
              (ok) => {
                setDeletePending(false);
                if (ok) {
                  setConfirmDelete(null);
                }
              },
            );
          }}
          testId="delete-template-confirm"
        />
      ) : null}
    </section>
  );
}

function TemplateForm({
  mode,
  busy,
  pending,
  initialName,
  initialDescription,
  initialDefaults,
  definitionInvalid,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  busy: boolean;
  pending: boolean;
  initialName: string;
  initialDescription: string;
  initialDefaults: P1TemplateDefaults;
  definitionInvalid?: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    description: string;
    defaults: P1TemplateDefaults;
  }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [sourceLocale, setSourceLocale] = useState(
    initialDefaults.sourceLocale || "en-US",
  );
  const [targetLocale, setTargetLocale] = useState(
    initialDefaults.targetLocale || "zh-CN",
  );
  const [domain, setDomain] = useState(initialDefaults.domain || "general");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (
      !name.trim() ||
      !sourceLocale.trim() ||
      !targetLocale.trim() ||
      !domain.trim()
    ) {
      setLocalError("All fields are required.");
      return;
    }
    if (definitionInvalid) {
      setLocalError("Template definition cannot be edited.");
      return;
    }
    setLocalError(null);
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      defaults: {
        sourceLocale: sourceLocale.trim(),
        targetLocale: targetLocale.trim(),
        domain: domain.trim(),
      },
    });
  }

  return (
    <form
      className="surface__stack"
      data-testid="template-form"
      onSubmit={handleSubmit}
    >
      <h2 className="surface__title">
        {mode === "create" ? "New template" : "Edit template"}
      </h2>
      {definitionInvalid ? (
        <p className="error-text">Template definition is not editable.</p>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor="tpl-name">
          Name
        </label>
        <input
          id="tpl-name"
          className="field__control"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="tpl-desc">
          Description
        </label>
        <input
          id="tpl-desc"
          className="field__control"
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="tpl-source">
          Source locale
        </label>
        <input
          id="tpl-source"
          className="field__control"
          value={sourceLocale}
          disabled={busy || definitionInvalid}
          onChange={(e) => setSourceLocale(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="tpl-target">
          Target locale
        </label>
        <input
          id="tpl-target"
          className="field__control"
          value={targetLocale}
          disabled={busy || definitionInvalid}
          onChange={(e) => setTargetLocale(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="tpl-domain">
          Domain
        </label>
        <input
          id="tpl-domain"
          className="field__control"
          value={domain}
          disabled={busy || definitionInvalid}
          onChange={(e) => setDomain(e.target.value)}
        />
      </div>
      {localError ? <p className="field__error">{localError}</p> : null}
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
          {pending ? "Saving" : "Save"}
        </button>
      </div>
    </form>
  );
}

function UseTemplateForm({
  template,
  defaults,
  busy,
  pending,
  onCancel,
  onSubmit,
}: {
  template: ProjectTemplate;
  defaults: P1TemplateDefaults;
  busy: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    sourceLocale: string;
    targetLocale: string;
    domain: string;
  }) => void;
}) {
  const [name, setName] = useState(`${template.name} project`);
  const [sourceLocale, setSourceLocale] = useState(
    defaults.sourceLocale || "en-US",
  );
  const [targetLocale, setTargetLocale] = useState(
    defaults.targetLocale || "zh-CN",
  );
  const [domain, setDomain] = useState(defaults.domain || "general");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (
      !name.trim() ||
      !sourceLocale.trim() ||
      !targetLocale.trim() ||
      !domain.trim()
    ) {
      setLocalError("All fields are required.");
      return;
    }
    setLocalError(null);
    onSubmit({
      name: name.trim(),
      sourceLocale: sourceLocale.trim(),
      targetLocale: targetLocale.trim(),
      domain: domain.trim(),
    });
  }

  return (
    <form
      className="surface__stack"
      data-testid="use-template-form"
      onSubmit={handleSubmit}
    >
      <h2 className="surface__title">Create from template</h2>
      <p className="muted">{template.name}</p>
      <div className="field">
        <label className="field__label" htmlFor="use-name">
          Project name
        </label>
        <input
          id="use-name"
          className="field__control"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="use-source">
          Source locale
        </label>
        <input
          id="use-source"
          className="field__control"
          value={sourceLocale}
          disabled={busy}
          onChange={(e) => setSourceLocale(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="use-target">
          Target locale
        </label>
        <input
          id="use-target"
          className="field__control"
          value={targetLocale}
          disabled={busy}
          onChange={(e) => setTargetLocale(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="use-domain">
          Domain
        </label>
        <input
          id="use-domain"
          className="field__control"
          value={domain}
          disabled={busy}
          onChange={(e) => setDomain(e.target.value)}
        />
      </div>
      {localError ? <p className="field__error">{localError}</p> : null}
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
  );
}
