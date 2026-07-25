import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  Project,
  ProjectAnalyticsSummary,
  ProjectLifecycle,
  ProjectSnapshot,
  ProjectTemplate,
  RecycleEntry,
} from "@translunar/contracts";
import {
  Archive,
  ArrowRight,
  Check,
  FileText,
  FolderArchive,
  FolderOpen,
  History,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";

import { BrandMark } from "./BrandMark";
import {
  GlobalSearchPanel,
  type GlobalSearchProjectOption,
} from "./GlobalSearchPanel";
import { useLocale } from "./i18n/LocaleProvider";
import {
  cloneTemplateDefinition,
  readTemplateDefinition,
} from "./project-home-utils";
import { formatError } from "./workbench-utils";

type HomeTab = "projects" | "search" | "templates" | "recycle";

interface ProjectHomeProps {
  onCreate(): void;
  onOpen(
    projectId: string,
    documentId?: string,
    segmentId?: string,
    segmentOrdinal?: number,
  ): Promise<void>;
}

interface ProjectOverview {
  snapshot: ProjectSnapshot;
  analytics: ProjectAnalyticsSummary | null;
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
const PROJECT_PAGE_SIZE = 50;

export function ProjectHome({ onCreate, onOpen }: ProjectHomeProps) {
  const { t } = useLocale();
  const [tab, setTab] = useState<HomeTab>("projects");
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
    try {
      await onOpen(projectId, documentId, segmentId, segmentOrdinal);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
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

  return (
    <div className="project-home-shell">
      <header className="project-home-header">
        <div className="identity-lockup">
          <BrandMark />
          <div>
            <strong>{t("app.name")}</strong>
            <span>{t("home.projectWorkspace")}</span>
          </div>
        </div>
        <div className="project-home-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => void restoreArchive()}
            disabled={busy}
          >
            <FolderArchive size={15} /> {t("home.restoreArchive")}
          </button>
          <button
            id="tutorial-target-create"
            className="button primary"
            type="button"
            onClick={onCreate}
          >
            <Plus size={15} /> {t("home.newProject")}
          </button>
        </div>
      </header>
      <div className="translunar-band" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <main className="project-home-main" aria-busy={loading || busy}>
        <aside
          className="project-home-nav"
          aria-label={t("home.workspaceViews")}
        >
          <HomeTabButton
            active={tab === "projects"}
            onClick={() => setTab("projects")}
            icon={<FolderOpen size={16} />}
            label={t("home.projects")}
          />
          <HomeTabButton
            active={tab === "search"}
            onClick={() => setTab("search")}
            icon={<Search size={16} />}
            label={t("home.search")}
          />
          <HomeTabButton
            active={tab === "templates"}
            onClick={() => setTab("templates")}
            icon={<FileText size={16} />}
            label={t("home.templates")}
          />
          <HomeTabButton
            active={tab === "recycle"}
            onClick={() => setTab("recycle")}
            icon={<Trash2 size={16} />}
            label={t("home.recycle")}
            count={recycleTotal}
          />
          <button
            className="project-home-refresh"
            type="button"
            onClick={() => void loadHome()}
            disabled={loading || busy}
            title={t("home.refresh")}
            aria-label={t("home.refresh")}
          >
            <RefreshCw size={15} /> {t("home.refresh")}
          </button>
        </aside>
        <section className="project-home-content">
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
              <LoaderCircle className="spin" size={18} />{" "}
              {t("home.loadingWorkspaceData")}
            </div>
          ) : tab === "projects" ? (
            <ProjectsView
              projects={projects}
              total={projectTotal}
              offset={projectOffset}
              lifecycle={lifecycle}
              onLifecycle={(next) => {
                setLifecycle(next);
                setProjectOffset(0);
              }}
              onPage={setProjectOffset}
              onOpen={openOverview}
              onSetLifecycle={setProjectLifecycle}
              onRecycle={recycleProject}
              onCreate={onCreate}
              t={t}
            />
          ) : tab === "search" ? (
            <GlobalSearchView projects={projects} onOpen={openWorkspace} />
          ) : tab === "templates" ? (
            <TemplatesView
              templates={templates}
              onCreate={() => setTemplateDraft({ ...EMPTY_TEMPLATE })}
              onEdit={(template) => setTemplateDraft(templateToDraft(template))}
              onDelete={deleteTemplate}
            />
          ) : (
            <RecycleView
              items={recycle}
              onRestore={restoreRecycleEntry}
              onPurge={purgeRecycleEntry}
            />
          )}
        </section>
      </main>
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

function HomeTabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick(): void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {count ? <b>{count}</b> : null}
    </button>
  );
}

function ProjectsView({
  projects,
  total,
  offset,
  lifecycle,
  onLifecycle,
  onPage,
  onOpen,
  onSetLifecycle,
  onRecycle,
  onCreate,
  t,
}: {
  projects: ProjectOverview[];
  total: number;
  offset: number;
  lifecycle: ProjectLifecycle;
  onLifecycle(value: ProjectLifecycle): void;
  onPage(offset: number): void;
  onOpen(overview: ProjectOverview, documentId?: string): Promise<void>;
  onSetLifecycle(project: Project, lifecycle: ProjectLifecycle): void;
  onRecycle(project: Project): void;
  onCreate(): void;
  t: ReturnType<typeof useLocale>["t"];
}) {
  return (
    <>
      <header className="project-view-heading">
        <div>
          <span>{t("home.localProjects")}</span>
          <h1>
            {lifecycle === "active"
              ? t("home.continueTranslating")
              : t("home.archivedProjects")}
          </h1>
          <p>{t("home.projectCount", { count: total })}</p>
        </div>
        <div
          className="segmented-control"
          aria-label={t("home.projectLifecycle")}
        >
          <button
            type="button"
            aria-pressed={lifecycle === "active"}
            onClick={() => onLifecycle("active")}
          >
            {t("home.active")}
          </button>
          <button
            type="button"
            aria-pressed={lifecycle === "archived"}
            onClick={() => onLifecycle("archived")}
          >
            {t("home.archived")}
          </button>
        </div>
      </header>
      {projects.length === 0 ? (
        <div className="project-home-empty">
          <FolderOpen size={26} />
          <strong>
            {lifecycle === "active"
              ? t("home.noActiveProjects")
              : t("home.noArchivedProjects")}
          </strong>
          <span>
            {lifecycle === "active"
              ? t("home.createToBegin")
              : t("home.archivedHelp")}
          </span>
          {lifecycle === "active" ? (
            <button className="button primary" type="button" onClick={onCreate}>
              <Plus size={15} /> {t("home.newProject")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="project-grid">
            {projects.map((overview) => (
              <ProjectCard
                key={overview.snapshot.project.id}
                overview={overview}
                onOpen={onOpen}
                onSetLifecycle={onSetLifecycle}
                onRecycle={onRecycle}
              />
            ))}
          </div>
          {total > PROJECT_PAGE_SIZE ? (
            <div
              className="project-pagination"
              aria-label={t("home.projectPages")}
            >
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => onPage(Math.max(0, offset - PROJECT_PAGE_SIZE))}
              >
                {t("action.back")}
              </button>
              <span>
                {offset + 1}-{Math.min(offset + projects.length, total)} of{" "}
                {total}
              </span>
              <button
                type="button"
                disabled={offset + projects.length >= total}
                onClick={() => onPage(offset + PROJECT_PAGE_SIZE)}
              >
                {t("action.next")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function ProjectCard({
  overview,
  onOpen,
  onSetLifecycle,
  onRecycle,
}: {
  overview: ProjectOverview;
  onOpen(overview: ProjectOverview, documentId?: string): Promise<void>;
  onSetLifecycle(project: Project, lifecycle: ProjectLifecycle): void;
  onRecycle(project: Project): void;
}) {
  const { t, formatDate, formatNumber } = useLocale();
  const { snapshot, analytics } = overview;
  const completion = analytics?.progress.completionBasisPoints;
  return (
    <article className="project-card">
      <header>
        <div className="project-card-mark">
          <FolderOpen size={18} />
        </div>
        <div>
          <span>{snapshot.project.domain || t("home.general")}</span>
          <h2>{snapshot.project.name}</h2>
        </div>
        <time>
          {formatDate(snapshot.project.updatedAtMs, { dateStyle: "medium" })}
        </time>
      </header>
      <div className="project-card-locales">
        <span>{snapshot.project.sourceLocale}</span>
        <ArrowRight size={13} />
        <span>{snapshot.project.targetLocale}</span>
      </div>
      <div className="project-card-progress">
        <div>
          <span>{t("home.projectProgress")}</span>
          <strong>
            {completion === undefined
              ? t("home.unavailable")
              : formatBasisPoints(completion, formatNumber)}
          </strong>
        </div>
        <progress
          value={completion ?? 0}
          max={10_000}
          aria-label={t("home.completionAria", { name: snapshot.project.name })}
        />
      </div>
      <div className="project-card-metrics">
        <span>
          {t("home.filesCount", { count: snapshot.documents.length })}
        </span>
        <span>
          {t("home.segmentsCount", {
            count: analytics?.progress.totalSegments ?? snapshot.counts.total,
          })}
        </span>
        <span>
          {t("home.blockersCount", {
            count: analytics?.progress.qaBlockers ?? snapshot.counts.openIssues,
          })}
        </span>
      </div>
      <div className="project-card-files">
        {snapshot.documents.slice(0, 3).map((document) => (
          <button
            key={document.id}
            type="button"
            onClick={() => void onOpen(overview, document.id)}
          >
            <FileText size={13} />
            <span>{document.relativePath}</span>
            <b>{document.segmentCount}</b>
          </button>
        ))}
        {snapshot.documents.length > 3 ? (
          <span>
            {t("home.moreFiles", { count: snapshot.documents.length - 3 })}
          </span>
        ) : null}
      </div>
      <footer>
        <button
          className="button primary"
          type="button"
          disabled={!snapshot.documents.length}
          onClick={() => void onOpen(overview)}
        >
          {t("home.openProject")} <ArrowRight size={14} />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() =>
            onSetLifecycle(
              snapshot.project,
              snapshot.project.lifecycle === "active" ? "archived" : "active",
            )
          }
          title={
            snapshot.project.lifecycle === "active"
              ? t("home.archiveProject")
              : t("home.restoreProject")
          }
          aria-label={
            snapshot.project.lifecycle === "active"
              ? t("home.archiveNamed", { name: snapshot.project.name })
              : t("home.restoreNamed", { name: snapshot.project.name })
          }
        >
          <Archive size={15} />
        </button>
        <button
          className="icon-button danger"
          type="button"
          onClick={() => onRecycle(snapshot.project)}
          title={t("home.moveToRecycle")}
          aria-label={t("home.recycleNamed", { name: snapshot.project.name })}
        >
          <Trash2 size={15} />
        </button>
      </footer>
    </article>
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
          <span>{t("home.workspaceIndex")}</span>
          <h1>{t("home.globalSearch")}</h1>
          <p>{t("home.globalSearchHelp")}</p>
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

function TemplatesView({
  templates,
  onCreate,
  onEdit,
  onDelete,
}: {
  templates: ProjectTemplate[];
  onCreate(): void;
  onEdit(template: ProjectTemplate): void;
  onDelete(template: ProjectTemplate): void;
}) {
  const { t, formatDate } = useLocale();
  return (
    <>
      <header className="project-view-heading">
        <div>
          <span>{t("home.reusableConfiguration")}</span>
          <h1>{t("home.projectTemplates")}</h1>
          <p>{t("home.templatesDescription")}</p>
        </div>
        <button className="button primary" type="button" onClick={onCreate}>
          <Plus size={15} /> {t("home.newTemplate")}
        </button>
      </header>
      <div className="template-list">
        {templates.map((template) => {
          const definition = readTemplateDefinition(template.definition);
          return (
            <article key={template.id}>
              <header>
                <div>
                  <span>
                    {template.builtIn ? t("home.builtIn") : t("home.custom")} ·{" "}
                    {t("home.revision", { revision: template.revision })}
                  </span>
                  <h2>{template.name}</h2>
                </div>
                <FileText size={18} />
              </header>
              <p>{template.description || t("home.noDescription")}</p>
              <dl>
                <div>
                  <dt>{t("home.locales")}</dt>
                  <dd>
                    {definition.sourceLocale} → {definition.targetLocale}
                  </dd>
                </div>
                <div>
                  <dt>{t("common.domain")}</dt>
                  <dd>{definition.domain || t("home.general")}</dd>
                </div>
                <div>
                  <dt>{t("home.analysis")}</dt>
                  <dd>{definition.analysisProfileId}</dd>
                </div>
                <div>
                  <dt>{t("home.review")}</dt>
                  <dd>
                    {definition.reviewRequired
                      ? t("home.required")
                      : t("home.optional")}
                  </dd>
                </div>
              </dl>
              <footer>
                <time>
                  {t("home.updated", {
                    value: formatDate(template.updatedAtMs, {
                      dateStyle: "medium",
                    }),
                  })}
                </time>
                {!template.builtIn ? (
                  <div>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => onEdit(template)}
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label={t("home.deleteTemplateNamed", {
                        name: template.name,
                      })}
                      title={t("home.deleteTemplate")}
                      onClick={() => onDelete(template)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : null}
              </footer>
            </article>
          );
        })}
      </div>
    </>
  );
}

function RecycleView({
  items,
  onRestore,
  onPurge,
}: {
  items: RecycleEntry[];
  onRestore(entry: RecycleEntry): void;
  onPurge(entry: RecycleEntry): void;
}) {
  const { t, formatDate } = useLocale();
  return (
    <>
      <header className="project-view-heading">
        <div>
          <span>{t("home.recoverableDeletion")}</span>
          <h1>{t("home.recycleBin")}</h1>
          <p>{t("home.recycleDescription")}</p>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="project-home-empty">
          <Trash2 size={25} />
          <strong>{t("home.recycleEmpty")}</strong>
          <span>{t("home.recycleEmptyHelp")}</span>
        </div>
      ) : (
        <div className="recycle-list">
          {items.map((entry) => (
            <article key={entry.id}>
              <div className="recycle-kind">
                {entry.entityType === "project" ? (
                  <FolderOpen size={16} />
                ) : (
                  <FileText size={16} />
                )}
              </div>
              <div>
                <span>
                  {t("home.deletedAt", {
                    kind: entry.entityType,
                    value: formatDate(entry.deletedAtMs, {
                      dateStyle: "medium",
                    }),
                  })}
                </span>
                <h2>{entry.displayName}</h2>
                <p>{entry.reason}</p>
                <small>
                  {t("home.retainedUntil", {
                    value: formatDate(entry.retentionUntilMs, {
                      dateStyle: "medium",
                    }),
                    actor: entry.actor,
                  })}
                </small>
              </div>
              <div>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => onRestore(entry)}
                >
                  <RotateCcw size={14} /> {t("home.restoreItem")}
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  aria-label={t("home.purgeNamed", { name: entry.displayName })}
                  title={t("home.permanentlyPurge")}
                  onClick={() => onPurge(entry)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
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
          <FileText size={20} />
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
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Check size={14} />
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
          {action.danger ? <Trash2 size={20} /> : <History size={20} />}
        </header>
        <p>{action.description}</p>
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
            className={action.danger ? "button danger" : "button primary"}
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : action.danger ? (
              <Trash2 size={14} />
            ) : (
              <Check size={14} />
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

function formatBasisPoints(
  value: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  return `${formatNumber(value / 100, { maximumFractionDigits: 1 })}%`;
}
