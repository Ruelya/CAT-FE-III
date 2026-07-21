import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type {
  GlobalSearchHit,
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
  cloneTemplateDefinition,
  parseSearchSnippet,
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
            : "Project archive restored under a new identity.",
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
      setError("This project has no active documents to open.");
      return;
    }
    await openWorkspace(overview.snapshot.project.id, selected.id);
  };

  const setProjectLifecycle = (project: Project, next: ProjectLifecycle) => {
    setPendingAction({
      title: next === "archived" ? "Archive project" : "Restore project",
      description:
        next === "archived"
          ? `${project.name} will leave the active project list but remain fully recoverable.`
          : `${project.name} will return to the active project list.`,
      confirmLabel: next === "archived" ? "Archive" : "Restore",
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
      title: "Move project to recycle bin",
      description: `${project.name} and its documents will be hidden from normal projects and search.`,
      confirmLabel: "Move to recycle bin",
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
        setNotice("Template revision created.");
      } else {
        await window.translunar.invoke("project.template.create", {
          name: draft.name.trim(),
          description: draft.description.trim(),
          definition,
        });
        setNotice("Template created.");
      }
      setTemplateDraft(null);
    });
  };

  const deleteTemplate = (template: ProjectTemplate) => {
    setPendingAction({
      title: "Delete project template",
      description: `${template.name} revision ${template.revision} and its revision history will be deleted. Existing projects are unchanged.`,
      confirmLabel: "Delete template",
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
      title: "Restore recycled item",
      description: `${entry.displayName} will return to its previous state.`,
      confirmLabel: "Restore",
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
      title: "Permanently purge item",
      description: `${entry.displayName} will be permanently removed. This cannot be undone.`,
      confirmLabel: "Permanently purge",
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
            <strong>Translunar</strong>
            <span>Project workspace</span>
          </div>
        </div>
        <div className="project-home-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => void restoreArchive()}
            disabled={busy}
          >
            <FolderArchive size={15} /> Restore archive
          </button>
          <button className="button primary" type="button" onClick={onCreate}>
            <Plus size={15} /> New project
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
          aria-label="Project workspace views"
        >
          <HomeTabButton
            active={tab === "projects"}
            onClick={() => setTab("projects")}
            icon={<FolderOpen size={16} />}
            label="Projects"
          />
          <HomeTabButton
            active={tab === "search"}
            onClick={() => setTab("search")}
            icon={<Search size={16} />}
            label="Search"
          />
          <HomeTabButton
            active={tab === "templates"}
            onClick={() => setTab("templates")}
            icon={<FileText size={16} />}
            label="Templates"
          />
          <HomeTabButton
            active={tab === "recycle"}
            onClick={() => setTab("recycle")}
            icon={<Trash2 size={16} />}
            label="Recycle"
            count={recycleTotal}
          />
          <button
            className="project-home-refresh"
            type="button"
            onClick={() => void loadHome()}
            disabled={loading || busy}
            title="Refresh project data"
            aria-label="Refresh project data"
          >
            <RefreshCw size={15} /> Refresh
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
              <LoaderCircle className="spin" size={18} /> Loading workspace data
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
}) {
  return (
    <>
      <header className="project-view-heading">
        <div>
          <span>Local projects</span>
          <h1>
            {lifecycle === "active"
              ? "Continue translating"
              : "Archived projects"}
          </h1>
          <p>
            {total} {total === 1 ? "project" : "projects"} in this view
          </p>
        </div>
        <div className="segmented-control" aria-label="Project lifecycle">
          <button
            type="button"
            aria-pressed={lifecycle === "active"}
            onClick={() => onLifecycle("active")}
          >
            Active
          </button>
          <button
            type="button"
            aria-pressed={lifecycle === "archived"}
            onClick={() => onLifecycle("archived")}
          >
            Archived
          </button>
        </div>
      </header>
      {projects.length === 0 ? (
        <div className="project-home-empty">
          <FolderOpen size={26} />
          <strong>
            {lifecycle === "active"
              ? "No active projects"
              : "No archived projects"}
          </strong>
          <span>
            {lifecycle === "active"
              ? "Create a project and add source files to begin."
              : "Archived projects remain available here until restored or recycled."}
          </span>
          {lifecycle === "active" ? (
            <button className="button primary" type="button" onClick={onCreate}>
              <Plus size={15} /> New project
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
            <div className="project-pagination" aria-label="Project pages">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => onPage(Math.max(0, offset - PROJECT_PAGE_SIZE))}
              >
                Previous
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
                Next
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
  const { snapshot, analytics } = overview;
  const completion = analytics?.progress.completionBasisPoints;
  return (
    <article className="project-card">
      <header>
        <div className="project-card-mark">
          <FolderOpen size={18} />
        </div>
        <div>
          <span>{snapshot.project.domain || "General"}</span>
          <h2>{snapshot.project.name}</h2>
        </div>
        <time>{formatDate(snapshot.project.updatedAtMs)}</time>
      </header>
      <div className="project-card-locales">
        <span>{snapshot.project.sourceLocale}</span>
        <ArrowRight size={13} />
        <span>{snapshot.project.targetLocale}</span>
      </div>
      <div className="project-card-progress">
        <div>
          <span>Project progress</span>
          <strong>
            {completion === undefined
              ? "Unavailable"
              : formatBasisPoints(completion)}
          </strong>
        </div>
        <progress
          value={completion ?? 0}
          max={10_000}
          aria-label={`${snapshot.project.name} completion`}
        />
      </div>
      <div className="project-card-metrics">
        <span>
          <b>{snapshot.documents.length}</b> files
        </span>
        <span>
          <b>{analytics?.progress.totalSegments ?? snapshot.counts.total}</b>{" "}
          segments
        </span>
        <span>
          <b>{analytics?.progress.qaBlockers ?? snapshot.counts.openIssues}</b>{" "}
          blockers
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
          <span>+{snapshot.documents.length - 3} more files</span>
        ) : null}
      </div>
      <footer>
        <button
          className="button primary"
          type="button"
          disabled={!snapshot.documents.length}
          onClick={() => void onOpen(overview)}
        >
          Open project <ArrowRight size={14} />
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
              ? "Archive project"
              : "Restore project"
          }
          aria-label={
            snapshot.project.lifecycle === "active"
              ? `Archive ${snapshot.project.name}`
              : `Restore ${snapshot.project.name}`
          }
        >
          <Archive size={15} />
        </button>
        <button
          className="icon-button danger"
          type="button"
          onClick={() => onRecycle(snapshot.project)}
          title="Move to recycle bin"
          aria-label={`Recycle ${snapshot.project.name}`}
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
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [field, setField] = useState("");
  const [workflowState, setWorkflowState] = useState("");
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (nextOffset = 0) => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const page = await window.translunar.invoke("search.global", {
        text: text.trim(),
        projectId: projectId || null,
        fields: field ? [field] : [],
        workflowState: workflowState || null,
        includeRecycled: false,
        offset: nextOffset,
        limit: 50,
      });
      setHits(page.items);
      setTotal(page.total);
      setOffset(page.offset);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void search(0);
  };
  return (
    <>
      <header className="project-view-heading">
        <div>
          <span>Workspace index</span>
          <h1>Global search</h1>
          <p>
            Source, target, names, comments and import notes across active
            projects.
          </p>
        </div>
      </header>
      <form className="global-search-form" onSubmit={submit}>
        <label className="global-search-query">
          <Search size={16} />
          <input
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder="Search the workspace"
            aria-label="Global search query"
            required
          />
        </label>
        <select
          aria-label="Search project"
          value={projectId}
          onChange={(event) => setProjectId(event.currentTarget.value)}
        >
          <option value="">All active projects</option>
          {projects.map(({ snapshot }) => (
            <option key={snapshot.project.id} value={snapshot.project.id}>
              {snapshot.project.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Search field"
          value={field}
          onChange={(event) => setField(event.currentTarget.value)}
        >
          <option value="">All fields</option>
          <option value="source">Source</option>
          <option value="target">Target</option>
          <option value="project">Project names</option>
          <option value="document">Document names</option>
          <option value="comment">Comments</option>
          <option value="note">Import notes</option>
        </select>
        <select
          aria-label="Search workflow state"
          value={workflowState}
          onChange={(event) => setWorkflowState(event.currentTarget.value)}
        >
          <option value="">Any workflow state</option>
          <option value="translation">Translation</option>
          <option value="review">Review</option>
          <option value="signed">Signed</option>
        </select>
        <button
          className="button primary"
          type="submit"
          disabled={loading || !text.trim()}
        >
          {loading ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Search size={15} />
          )}{" "}
          Search
        </button>
      </form>
      {error ? (
        <p className="surface-error" role="alert">
          {error}
        </p>
      ) : null}
      {!hits.length && total === 0 ? (
        <div className="project-home-empty">
          <Search size={25} />
          <strong>
            {text
              ? "No matching workspace content"
              : "Search every active project"}
          </strong>
          <span>
            {text
              ? "Try another field, project or phrase."
              : "Results link directly to the authoritative document and segment."}
          </span>
        </div>
      ) : (
        <div className="search-results">
          <header>
            <strong>{total} results</strong>
            <span>
              {offset + 1}-{Math.min(offset + hits.length, total)}
            </span>
          </header>
          {hits.map((hit, index) => (
            <button
              key={`${hit.projectId}-${hit.field}-${hit.segmentId ?? index}`}
              type="button"
              onClick={() =>
                void onOpen(
                  hit.projectId,
                  hit.documentId ?? undefined,
                  hit.segmentId ?? undefined,
                  hit.segmentOrdinal ?? undefined,
                )
              }
            >
              <span className="search-result-field">
                {hit.field.replaceAll("_", " ")}
              </span>
              <strong>
                {hit.projectName}
                {hit.documentName ? ` / ${hit.documentName}` : ""}
              </strong>
              <p>
                {parseSearchSnippet(hit.snippet).map((part, partIndex) => (
                  <Fragment key={`${part.highlighted}-${partIndex}`}>
                    {part.highlighted ? <mark>{part.text}</mark> : part.text}
                  </Fragment>
                ))}
              </p>
              <footer>
                {hit.workflowState ?? "project"}
                {hit.segmentOrdinal !== undefined && hit.segmentOrdinal !== null
                  ? ` · segment ${hit.segmentOrdinal + 1}`
                  : ""}
                <ArrowRight size={14} />
              </footer>
            </button>
          ))}
        </div>
      )}
      {total > 50 ? (
        <div className="project-pagination">
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => void search(Math.max(0, offset - 50))}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={offset + hits.length >= total || loading}
            onClick={() => void search(offset + 50)}
          >
            Next
          </button>
        </div>
      ) : null}
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
  return (
    <>
      <header className="project-view-heading">
        <div>
          <span>Reusable configuration</span>
          <h1>Project templates</h1>
          <p>
            Locales, profiles, review policy and safe editor defaults.
            Credentials are never stored.
          </p>
        </div>
        <button className="button primary" type="button" onClick={onCreate}>
          <Plus size={15} /> New template
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
                    {template.builtIn ? "Built in" : "Custom"} · revision{" "}
                    {template.revision}
                  </span>
                  <h2>{template.name}</h2>
                </div>
                <FileText size={18} />
              </header>
              <p>{template.description || "No description"}</p>
              <dl>
                <div>
                  <dt>Locales</dt>
                  <dd>
                    {definition.sourceLocale} → {definition.targetLocale}
                  </dd>
                </div>
                <div>
                  <dt>Domain</dt>
                  <dd>{definition.domain || "General"}</dd>
                </div>
                <div>
                  <dt>Analysis</dt>
                  <dd>{definition.analysisProfileId}</dd>
                </div>
                <div>
                  <dt>Review</dt>
                  <dd>{definition.reviewRequired ? "Required" : "Optional"}</dd>
                </div>
              </dl>
              <footer>
                <time>Updated {formatDate(template.updatedAtMs)}</time>
                {!template.builtIn ? (
                  <div>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => onEdit(template)}
                    >
                      Edit
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label={`Delete ${template.name}`}
                      title="Delete template"
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
  return (
    <>
      <header className="project-view-heading">
        <div>
          <span>Recoverable deletion</span>
          <h1>Recycle bin</h1>
          <p>
            Restore retained projects and documents or explicitly purge them.
          </p>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="project-home-empty">
          <Trash2 size={25} />
          <strong>Recycle bin is empty</strong>
          <span>
            Deleted projects and documents remain recoverable here during
            retention.
          </span>
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
                  {entry.entityType} · deleted {formatDate(entry.deletedAtMs)}
                </span>
                <h2>{entry.displayName}</h2>
                <p>{entry.reason}</p>
                <small>
                  Retained until {formatDate(entry.retentionUntilMs)} ·{" "}
                  {entry.actor}
                </small>
              </div>
              <div>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => onRestore(entry)}
                >
                  <RotateCcw size={14} /> Restore
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  aria-label={`Purge ${entry.displayName}`}
                  title="Permanently purge"
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
            <span className="surface-kicker">Safe reusable configuration</span>
            <h2 id="template-dialog-title">
              {draft.id ? "Edit project template" : "New project template"}
            </h2>
          </div>
          <FileText size={20} />
        </header>
        <label>
          <span>Name</span>
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.currentTarget.value })
            }
          />
        </label>
        <label>
          <span>Description</span>
          <textarea
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.currentTarget.value })
            }
          />
        </label>
        <div className="template-dialog-grid">
          <label>
            <span>Source locale</span>
            <input
              required
              value={draft.sourceLocale}
              onChange={(event) =>
                setDraft({ ...draft, sourceLocale: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>Target locale</span>
            <input
              required
              value={draft.targetLocale}
              onChange={(event) =>
                setDraft({ ...draft, targetLocale: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>Domain</span>
            <input
              value={draft.domain}
              onChange={(event) =>
                setDraft({ ...draft, domain: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>Analysis profile</span>
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
            <strong>Require review before sign-off</strong>
            <small>
              The policy is resolved by the Engine when creating a project.
            </small>
          </span>
        </label>
        {draft.sourceLocale === draft.targetLocale ? (
          <p className="surface-error" role="alert">
            Source and target locales must be different.
          </p>
        ) : null}
        <footer>
          <button
            className="button tertiary"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
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
            Save template
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
            <span className="surface-kicker">Explicit action</span>
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
            Cancel
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

function formatBasisPoints(value: number): string {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 1)}%`;
}
function formatDate(value: number): string {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
