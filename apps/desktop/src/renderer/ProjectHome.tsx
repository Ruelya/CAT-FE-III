import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  Project,
  ProjectLifecycle,
  ProjectTemplate,
  RecycleEntry,
} from "@translunar/contracts";
import {
  Check,
  FileText,
  FolderArchive,
  FolderOpen,
  History,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import { CompositionRail } from "./components/project/CompositionRail";
import { HomeTabList, type HomeTabId } from "./components/project/HomeTabList";
import {
  type ProjectOverview,
} from "./components/project/ProjectCard";
import {
  PROJECT_PAGE_SIZE,
  ProjectsPane,
} from "./components/project/ProjectsPane";
import { RecyclePane } from "./components/project/RecyclePane";
import { TemplatesPane } from "./components/project/TemplatesPane";
import {
  GlobalSearchPanel,
  type GlobalSearchProjectOption,
} from "./GlobalSearchPanel";
import { useViewTransition } from "./hooks/useViewTransition";
import { useLocale } from "./i18n/LocaleProvider";
import {
  cloneTemplateDefinition,
  readTemplateDefinition,
} from "./project-home-utils";
import { formatError } from "./workbench-utils";

interface ProjectHomeProps {
  onCreate(): void;
  onOpen(
    projectId: string,
    documentId?: string,
    segmentId?: string,
    segmentOrdinal?: number,
  ): Promise<void>;
}

interface TemplateDraft {
  id?: string;
  revision?: number;
  definition: Record<string, unknown>;
  name: string;
  description: string;
  sourceLocale: string;
  targetLocale: string;
  domain: string;
  analysisProfileId: string;
  reviewRequired: boolean;
}

interface PendingAction {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  /** When set, user must type this name to enable confirm. */
  confirmName?: string;
  run(): Promise<void>;
}

const EMPTY_TEMPLATE: TemplateDraft = {
  definition: {},
  name: "",
  description: "",
  sourceLocale: "en-US",
  targetLocale: "zh-CN",
  domain: "",
  analysisProfileId: "builtin.analysis.standard",
  reviewRequired: true,
};

export function ProjectHome({ onCreate, onOpen }: ProjectHomeProps) {
  const { t, formatDate } = useLocale();
  const runTransition = useViewTransition();
  const [tab, setTab] = useState<HomeTabId>("projects");
  const [lifecycle, setLifecycle] = useState<ProjectLifecycle>("active");
  const [projects, setProjects] = useState<ProjectOverview[]>([]);
  const [projectTotal, setProjectTotal] = useState(0);
  const [projectOffset, setProjectOffset] = useState(0);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [recycle, setRecycle] = useState<RecycleEntry[]>([]);
  const [recycleTotal, setRecycleTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRefreshMs, setLastRefreshMs] = useState<number | null>(null);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(
    null,
  );

  const loadHome = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectPage, templatePage, recyclePage] = await Promise.all([
        window.translunar.invoke("project.list", {
          lifecycle,
          offset: projectOffset,
          limit: PROJECT_PAGE_SIZE,
        }),
        window.translunar.invoke("project.template.list", {
          offset: 0,
          limit: 100,
        }),
        window.translunar.invoke("recycle.list", { offset: 0, limit: 100 }),
      ]);
      const overviews = await Promise.all(
        projectPage.items.map(async (project): Promise<ProjectOverview> => {
          const [snapshot, analytics] = await Promise.all([
            window.translunar.invoke("project.get", { projectId: project.id }),
            window.translunar
              .invoke("project.analytics.get", { projectId: project.id })
              .catch(() => null),
          ]);
          return { snapshot, analytics };
        }),
      );
      setProjects(overviews);
      setProjectTotal(projectPage.total);
      setTemplates(
        templatePage.items.map((template) => ({
          ...template,
          definition: cloneTemplateDefinition(template.definition),
        })),
      );
      setRecycle(recyclePage.items);
      setRecycleTotal(recyclePage.total);
      setLastRefreshMs(Date.now());
      if (
        projectPage.items.length === 0 &&
        projectPage.total > 0 &&
        projectOffset > 0
      ) {
        setProjectOffset(
          Math.floor((projectPage.total - 1) / PROJECT_PAGE_SIZE) *
            PROJECT_PAGE_SIZE,
        );
      }
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setLoading(false);
    }
  }, [lifecycle, projectOffset]);

  useEffect(() => {
    void loadHome();
  }, [loadHome]);

  const runMutation = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await loadHome();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  const restoreArchive = async () => {
    setError(null);
    try {
      const archivePath = await window.translunar.selectProjectArchive();
      if (!archivePath) return;
      await runMutation(async () => {
        const result = await window.translunar.invoke(
          "project.archive.restore",
          {
            archivePath,
            dependencyRemaps: {},
            actor: "desktop-user",
          },
        );
        setLifecycle("active");
        setProjectOffset(0);
        setTab("projects");
        setNotice(
          result.diagnostics.length
            ? result.diagnostics.join(" ")
            : t("home.archiveRestored"),
        );
      });
    } catch (reason) {
      setError(formatError(reason));
    }
  };

  const openWorkspace = async (
    projectId: string,
    documentId?: string,
    segmentId?: string,
    segmentOrdinal?: number,
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setOpeningProjectId(projectId);
    try {
      await new Promise<void>((resolve, reject) => {
        runTransition("surface", async () => {
          try {
            await onOpen(projectId, documentId, segmentId, segmentOrdinal);
            resolve();
          } catch (reason) {
            reject(reason);
          }
        });
      });
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setOpeningProjectId(null);
      setBusy(false);
    }
  };

  const openOverview = async (
    overview: ProjectOverview,
    documentId?: string,
  ) => {
    const selected =
      overview.snapshot.documents.find((item) => item.id === documentId) ??
      overview.snapshot.documents[0];
    if (!selected) {
      setError(t("home.noActiveDocuments"));
      return;
    }
    await openWorkspace(overview.snapshot.project.id, selected.id);
  };

  const setProjectLifecycle = (project: Project, next: ProjectLifecycle) => {
    setPendingAction({
      title:
        next === "archived"
          ? t("home.archiveActionTitle")
          : t("home.restoreActionTitle"),
      description:
        next === "archived"
          ? t("home.archiveActionDescription", { name: project.name })
          : t("home.restoreActionDescription", { name: project.name }),
      confirmLabel:
        next === "archived"
          ? t("home.archiveActionConfirm")
          : t("home.restoreActionConfirm"),
      run: async () => {
        await window.translunar.invoke("project.setLifecycle", {
          projectId: project.id,
          lifecycle: next,
          expectedRevision: project.revision,
          actor: "desktop-user",
        });
      },
    });
  };

  const recycleProject = (project: Project) => {
    setPendingAction({
      title: t("home.recycleActionTitle"),
      description: t("home.recycleActionDescription", { name: project.name }),
      confirmLabel: t("home.recycleActionConfirm"),
      danger: true,
      run: async () => {
        await window.translunar.invoke("recycle.delete", {
          entityType: "project",
          entityId: project.id,
          expectedRevision: project.revision,
          actor: "desktop-user",
          reason: "Removed from project home",
        });
      },
    });
  };

  const saveTemplate = async (draft: TemplateDraft) => {
    const definition = {
      ...cloneTemplateDefinition(draft.definition),
      sourceLocale: draft.sourceLocale,
      targetLocale: draft.targetLocale,
      domain: draft.domain,
      analysisProfileId: draft.analysisProfileId,
      reviewRequired: draft.reviewRequired,
    };
    await runMutation(async () => {
      if (draft.id && draft.revision !== undefined) {
        await window.translunar.invoke("project.template.update", {
          templateId: draft.id,
          expectedRevision: draft.revision,
          name: draft.name.trim(),
          description: draft.description.trim(),
          definition,
        });
        setNotice(t("home.templateRevisionCreated"));
      } else {
        await window.translunar.invoke("project.template.create", {
          name: draft.name.trim(),
          description: draft.description.trim(),
          definition,
        });
        setNotice(t("home.templateCreated"));
      }
      setTemplateDraft(null);
    });
  };

  const deleteTemplate = (template: ProjectTemplate) => {
    setPendingAction({
      title: t("home.deleteTemplateTitle"),
      description: t("home.deleteTemplateDescription", {
        name: template.name,
        revision: template.revision,
      }),
      confirmLabel: t("home.deleteTemplateConfirm"),
      danger: true,
      run: async () => {
        await window.translunar.invoke("project.template.delete", {
          templateId: template.id,
          expectedRevision: template.revision,
        });
      },
    });
  };

  const restoreRecycleEntry = (entry: RecycleEntry) => {
    setPendingAction({
      title: t("home.restoreItemTitle"),
      description: t("home.restoreItemDescription", {
        name: entry.displayName,
      }),
      confirmLabel: t("home.restoreItem"),
      run: async () => {
        await window.translunar.invoke("recycle.restore", {
          entryId: entry.id,
          actor: "desktop-user",
          reason: "Restored from project home",
        });
      },
    });
  };

  const purgeRecycleEntry = (entry: RecycleEntry) => {
    setPendingAction({
      title: t("home.purgeItemTitle"),
      description: t("home.purgeItemDescription", {
        name: entry.displayName,
      }),
      confirmLabel: t("home.purgeItemConfirm"),
      danger: true,
      confirmName: entry.displayName,
      run: async () => {
        await window.translunar.invoke("recycle.purge", {
          entryId: entry.id,
          actor: "desktop-user",
          reason: "Explicit permanent purge from project home",
        });
      },
    });
  };

  const confirmPending = async () => {
    const action = pendingAction;
    if (!action) return;
    await runMutation(async () => {
      await action.run();
      setPendingAction(null);
    });
  };

  const homeTabs = useMemo(
    () => [
      {
        id: "projects" as const,
        label: t("home.projects"),
        count: projectTotal,
        icon: <FolderOpen size={15} aria-hidden="true" />,
      },
      {
        id: "search" as const,
        label: t("home.search"),
        icon: <Search size={15} aria-hidden="true" />,
      },
      {
        id: "templates" as const,
        label: t("home.templates"),
        count: templates.length,
        icon: <FileText size={15} aria-hidden="true" />,
      },
      {
        id: "recycle" as const,
        label: t("home.recycle"),
        count: recycleTotal,
        icon: <Trash2 size={15} aria-hidden="true" />,
      },
    ],
    [projectTotal, recycleTotal, t, templates.length],
  );

  const activeCount = projects.filter(
    (item) => item.snapshot.project.lifecycle === "active",
  ).length;

  return (
    <div className="project-home-shell">
      <CompositionRail
        title={t("app.name")}
        subtitle={t("home.projectWorkspace")}
        footer={
          <>
            <button
              type="button"
              className="composition-rail__refresh"
              onClick={() => void loadHome()}
              disabled={loading || busy}
              title={t("home.refresh")}
              aria-label={t("home.refresh")}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {t("home.refresh")}
            </button>
            {lastRefreshMs ? (
              <span className="composition-rail__last-refresh">
                {t("home.lastRefresh", {
                  value: formatDate(lastRefreshMs, {
                    timeStyle: "short",
                    dateStyle: "short",
                  }),
                })}
              </span>
            ) : null}
          </>
        }
      >
        <dl className="composition-rail__summary">
          <div>
            <dt>{t("home.summaryProjects")}</dt>
            <dd className="num">{projectTotal}</dd>
          </div>
          <div>
            <dt>{t("home.summaryActive")}</dt>
            <dd className="num">
              {lifecycle === "active" ? projectTotal : activeCount}
            </dd>
          </div>
          <div>
            <dt>{t("home.summaryTemplates")}</dt>
            <dd className="num">{templates.length}</dd>
          </div>
          <div>
            <dt>{t("home.summaryRecycle")}</dt>
            <dd className="num">{recycleTotal}</dd>
          </div>
        </dl>
      </CompositionRail>

      <div className="project-home-content">
        <header className="project-home-chrome">
          <h1>{t("home.projects")}</h1>
          <div className="project-home-chrome__actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => void restoreArchive()}
              disabled={busy}
            >
              <FolderArchive size={15} aria-hidden="true" />{" "}
              {t("home.restoreArchive")}
            </button>
            <button
              id="tutorial-target-create"
              className="button primary"
              type="button"
              onClick={onCreate}
            >
              <Plus size={15} aria-hidden="true" /> {t("home.newProject")}
            </button>
          </div>
        </header>

        <HomeTabList
          tabs={homeTabs}
          active={tab}
          onChange={setTab}
          ariaLabel={t("home.workspaceViews")}
        />

        <section className="project-home-body" aria-busy={loading || busy}>
          {error ? (
            <p className="surface-error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="surface-success" role="status">
              {notice}
            </p>
          ) : null}
          {loading ? (
            <div className="project-home-loading" role="status">
              <LoaderCircle className="spin" size={18} aria-hidden="true" />{" "}
              {t("home.loadingWorkspaceData")}
            </div>
          ) : tab === "projects" ? (
            <ProjectsPane
              projects={projects}
              total={projectTotal}
              offset={projectOffset}
              lifecycle={lifecycle}
              openingProjectId={openingProjectId}
              onLifecycle={(next) => {
                setLifecycle(next);
                setProjectOffset(0);
              }}
              onPage={setProjectOffset}
              onOpen={openOverview}
              onSetLifecycle={setProjectLifecycle}
              onRecycle={recycleProject}
              onCreate={onCreate}
            />
          ) : tab === "search" ? (
            <GlobalSearchView projects={projects} onOpen={openWorkspace} />
          ) : tab === "templates" ? (
            <TemplatesPane
              templates={templates}
              onCreate={() => setTemplateDraft({ ...EMPTY_TEMPLATE })}
              onEdit={(template) => setTemplateDraft(templateToDraft(template))}
              onDelete={deleteTemplate}
            />
          ) : (
            <RecyclePane
              items={recycle}
              onRestore={restoreRecycleEntry}
              onPurge={purgeRecycleEntry}
            />
          )}
        </section>
      </div>

      {templateDraft ? (
        <TemplateDialog
          draft={templateDraft}
          busy={busy}
          onCancel={() => setTemplateDraft(null)}
          onSave={saveTemplate}
        />
      ) : null}
      {pendingAction ? (
        <ConfirmDialog
          action={pendingAction}
          busy={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmPending}
        />
      ) : null}
    </div>
  );
}

function GlobalSearchView({
  projects,
  onOpen,
}: {
  projects: ProjectOverview[];
  onOpen(
    projectId: string,
    documentId?: string,
    segmentId?: string,
    segmentOrdinal?: number,
  ): Promise<void>;
}) {
  const { t } = useLocale();
  return (
    <>
      <header className="project-view-heading">
        <div>
          <h1>{t("home.globalSearch")}</h1>
        </div>
      </header>
      <GlobalSearchPanel
        variant="home"
        projects={projects.map<GlobalSearchProjectOption>(({ snapshot }) => ({
          id: snapshot.project.id,
          name: snapshot.project.name,
        }))}
        onOpen={(hit) =>
          onOpen(
            hit.projectId,
            hit.documentId ?? undefined,
            hit.segmentId ?? undefined,
            hit.segmentOrdinal ?? undefined,
          )
        }
      />
    </>
  );
}

function TemplateDialog({
  draft: initial,
  busy,
  onCancel,
  onSave,
}: {
  draft: TemplateDraft;
  busy: boolean;
  onCancel(): void;
  onSave(draft: TemplateDraft): Promise<void>;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.sourceLocale !== draft.targetLocale) void onSave(draft);
  };
  return (
    <div className="surface-dialog-backdrop" role="presentation">
      <form
        className="surface-dialog template-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-dialog-title"
        onSubmit={submit}
      >
        <header>
          <div>
            <span className="surface-kicker">
              {t("home.safeReusableConfiguration")}
            </span>
            <h2 id="template-dialog-title">
              {draft.id
                ? t("home.editProjectTemplate")
                : t("home.newProjectTemplate")}
            </h2>
          </div>
          <FileText size={20} aria-hidden="true" />
        </header>
        <label>
          <span>{t("home.name")}</span>
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.currentTarget.value })
            }
          />
        </label>
        <label>
          <span>{t("home.description")}</span>
          <textarea
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.currentTarget.value })
            }
          />
        </label>
        <div className="template-dialog-grid">
          <label>
            <span>{t("home.sourceLocale")}</span>
            <input
              required
              value={draft.sourceLocale}
              onChange={(event) =>
                setDraft({ ...draft, sourceLocale: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>{t("home.targetLocale")}</span>
            <input
              required
              value={draft.targetLocale}
              onChange={(event) =>
                setDraft({ ...draft, targetLocale: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>{t("common.domain")}</span>
            <input
              value={draft.domain}
              onChange={(event) =>
                setDraft({ ...draft, domain: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>{t("home.analysisProfile")}</span>
            <input
              value={draft.analysisProfileId}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  analysisProfileId: event.currentTarget.value,
                })
              }
            />
          </label>
        </div>
        <label className="wizard-check">
          <input
            type="checkbox"
            checked={draft.reviewRequired}
            onChange={(event) =>
              setDraft({
                ...draft,
                reviewRequired: event.currentTarget.checked,
              })
            }
          />
          <span>
            <strong>{t("home.requireReviewBeforeSignoff")}</strong>
            <small>{t("home.engineResolvesPolicy")}</small>
          </span>
        </label>
        {draft.sourceLocale === draft.targetLocale ? (
          <p className="surface-error" role="alert">
            {t("home.localesMustDiffer")}
          </p>
        ) : null}
        <footer>
          <button
            className="button tertiary"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            {t("common.cancel")}
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={
              busy ||
              !draft.name.trim() ||
              draft.sourceLocale === draft.targetLocale
            }
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} aria-hidden="true" />
            ) : (
              <Check size={14} aria-hidden="true" />
            )}{" "}
            {t("home.saveTemplate")}
          </button>
        </footer>
      </form>
    </div>
  );
}

function ConfirmDialog({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: PendingAction;
  busy: boolean;
  onCancel(): void;
  onConfirm(): Promise<void>;
}) {
  const { t } = useLocale();
  const [nameInput, setNameInput] = useState("");
  const nameOk =
    !action.confirmName || nameInput.trim() === action.confirmName;
  return (
    <div className="surface-dialog-backdrop" role="presentation">
      <section
        className="surface-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <header>
          <div>
            <span className="surface-kicker">{t("common.confirm")}</span>
            <h2 id="confirm-dialog-title">{action.title}</h2>
          </div>
          {action.danger ? (
            <Trash2 size={20} aria-hidden="true" />
          ) : (
            <History size={20} aria-hidden="true" />
          )}
        </header>
        <p>{action.description}</p>
        {action.confirmName ? (
          <label>
            <span>{t("home.purgeNameConfirm", { name: action.confirmName })}</span>
            <input
              value={nameInput}
              autoComplete="off"
              onChange={(event) => setNameInput(event.currentTarget.value)}
            />
          </label>
        ) : null}
        <footer>
          <button
            className="button tertiary"
            type="button"
            onClick={onCancel}
            disabled={busy}
            autoFocus={!action.danger}
          >
            {t("common.cancel")}
          </button>
          <button
            className={action.danger ? "button danger" : "button primary"}
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy || !nameOk}
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} aria-hidden="true" />
            ) : action.danger ? (
              <Trash2 size={14} aria-hidden="true" />
            ) : (
              <Check size={14} aria-hidden="true" />
            )}
            {action.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function templateToDraft(template: ProjectTemplate): TemplateDraft {
  return {
    id: template.id,
    revision: template.revision,
    definition: cloneTemplateDefinition(template.definition),
    name: template.name,
    description: template.description,
    ...readTemplateDefinition(template.definition),
  };
}
