import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import type {
  AiProviderProfile,
  AnalysisProfile,
  BatchImportDiagnostic,
  PipelineDefinition,
  Project,
  ProjectTemplate,
  QaProfile,
  TemplateDependencyDiagnostic,
} from "@translunar/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FilePlus2,
  Files,
  FolderOpen,
  Languages,
  Layers3,
  LoaderCircle,
  Settings2,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { BrandMark } from "./BrandMark";
import { fileName, formatError } from "./workbench-utils";

interface SetupViewProps {
  onCreated(projectId: string, documentId: string): Promise<void>;
  onCancel?(): void;
}

type WizardStep = 1 | 2 | 3;
type ReviewPolicy = "template" | "required" | "optional";

export function SetupView({ onCreated, onCancel }: SetupViewProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("Craft Contracts 2026");
  const [sourceLocale, setSourceLocale] = useState("en-US");
  const [targetLocale, setTargetLocale] = useState("zh-CN");
  const [domain, setDomain] = useState("Legal");
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [qaProfiles, setQaProfiles] = useState<QaProfile[]>([]);
  const [pipelines, setPipelines] = useState<PipelineDefinition[]>([]);
  const [aiProfiles, setAiProfiles] = useState<AiProviderProfile[]>([]);
  const [analysisProfiles, setAnalysisProfiles] = useState<AnalysisProfile[]>(
    [],
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [qaProfileId, setQaProfileId] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [aiProfileId, setAiProfileId] = useState("");
  const [analysisProfileId, setAnalysisProfileId] = useState("");
  const [reviewPolicy, setReviewPolicy] = useState<ReviewPolicy>("template");
  const [atomicity, setAtomicity] = useState<"bestEffort" | "allOrNothing">(
    "bestEffort",
  );
  const [sourcePaths, setSourcePaths] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<BatchImportDiagnostic[]>([]);
  const [dependencyDiagnostics, setDependencyDiagnostics] = useState<
    TemplateDependencyDiagnostic[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.translunar.invoke("project.template.list", {
        offset: 0,
        limit: 100,
      }),
      window.translunar.invoke("qa.profile.list", {
        offset: 0,
        limit: 100,
      }),
      window.translunar.invoke("pipeline.list", { offset: 0, limit: 100 }),
      window.translunar.invoke("ai.provider.list", { offset: 0, limit: 100 }),
      window.translunar.invoke("analysis.profile.list", {}),
    ])
      .then(([templatePage, qaPage, pipelinePage, aiPage, analysisPage]) => {
        if (cancelled) return;
        setTemplates(templatePage.items);
        setQaProfiles(qaPage.items);
        setPipelines(pipelinePage.items);
        setAiProfiles(aiPage.items);
        setAnalysisProfiles(analysisPage.items);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(formatError(reason));
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId),
    [selectedTemplateId, templates],
  );

  const selectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setQaProfileId("");
    setPipelineId("");
    setAiProfileId("");
    setAnalysisProfileId("");
    setReviewPolicy("template");
  };

  const addPaths = (paths: readonly string[]) => {
    setSourcePaths((current) =>
      [...new Set([...current, ...paths.filter(Boolean)])].slice(0, 500),
    );
  };

  const chooseFiles = async () => {
    setError(null);
    try {
      addPaths(await window.translunar.selectSourceDocuments());
    } catch (reason) {
      setError(formatError(reason));
    }
  };

  const chooseFolder = async () => {
    setError(null);
    try {
      const selected = await window.translunar.selectSourceFolder();
      if (selected) addPaths([selected]);
    } catch (reason) {
      setError(formatError(reason));
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      addPaths(
        window.translunar.resolveDroppedPaths([...event.dataTransfer.files]),
      );
    } catch (reason) {
      setError(formatError(reason));
    }
  };

  const goNext = () => {
    setError(null);
    if (step === 1 && (!name.trim() || sourceLocale === targetLocale)) {
      setError(
        sourceLocale === targetLocale
          ? "Source and target languages must be different."
          : "Enter a project name.",
      );
      return;
    }
    setStep((step + 1) as WizardStep);
  };

  const createProject = async (
    onProjectCreated: (project: Project) => void,
  ): Promise<{
    project: Project;
    dependencies: TemplateDependencyDiagnostic[];
  }> => {
    let project: Project;
    let dependencies: TemplateDependencyDiagnostic[] = [];
    if (selectedTemplate) {
      const result = await window.translunar.invoke(
        "project.createFromTemplate",
        {
          templateId: selectedTemplate.id,
          templateRevision: selectedTemplate.revision,
          name: name.trim(),
          sourceLocale,
          targetLocale,
          domain: domain.trim(),
          dependencyRemaps: {},
        },
      );
      project = result.project;
      dependencies = result.diagnostics;
      onProjectCreated(project);
    } else {
      project = await window.translunar.invoke("project.create", {
        name: name.trim(),
        sourceLocale,
        targetLocale,
        domain: domain.trim(),
      });
      onProjectCreated(project);
    }
    const configuration = {
      ...project.configuration,
      qaProfileId: qaProfileId || project.configuration.qaProfileId || null,
      pipelineId: pipelineId || project.configuration.pipelineId || null,
      aiProfileIds: aiProfileId
        ? [aiProfileId]
        : (project.configuration.aiProfileIds ?? []),
      analysisProfileId:
        analysisProfileId ||
        project.configuration.analysisProfileId ||
        "builtin.analysis.standard",
      reviewRequired:
        reviewPolicy === "template"
          ? (project.configuration.reviewRequired ?? true)
          : reviewPolicy === "required",
    };
    const configurationChanged =
      JSON.stringify(configuration) !== JSON.stringify(project.configuration);
    if (configurationChanged) {
      project = await window.translunar.invoke("project.update", {
        projectId: project.id,
        name: project.name,
        sourceLocale: project.sourceLocale,
        targetLocale: project.targetLocale,
        domain: project.domain,
        configuration,
        expectedRevision: project.revision,
        actor: "desktop-wizard",
      });
      onProjectCreated(project);
    }
    return { project, dependencies };
  };

  const rollbackEmptyProject = async (project: Project): Promise<string> => {
    try {
      const current = await window.translunar.invoke("project.get", {
        projectId: project.id,
      });
      if (current.project.lifecycle !== "active") {
        return "Cleanup was skipped because the project is no longer active.";
      }
      if (current.documents.length > 0) {
        return "The project was retained because it contains imported documents.";
      }
      const entry = await window.translunar.invoke("recycle.delete", {
        entityType: "project",
        entityId: project.id,
        expectedRevision: current.project.revision,
        actor: "desktop-wizard",
        reason: "Project setup imported no supported files",
      });
      await window.translunar.invoke("recycle.purge", {
        entryId: entry.id,
        actor: "desktop-wizard",
        reason: "Rollback empty project setup",
      });
      return "The empty project was removed.";
    } catch (reason) {
      return `Empty-project cleanup failed: ${formatError(reason)}`;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sourcePaths.length === 0) {
      setError("Add at least one supported file or folder before importing.");
      return;
    }
    setBusy(true);
    setError(null);
    setDiagnostics([]);
    setDependencyDiagnostics([]);
    let createdProject: Project | null = null;
    try {
      const created = await createProject((project) => {
        createdProject = project;
      });
      setDependencyDiagnostics(created.dependencies);
      const imported = await window.translunar.invoke("project.batchImport", {
        projectId: created.project.id,
        items: sourcePaths.map((path) => ({ path })),
        options: {},
        atomicity,
      });
      setDiagnostics(imported.items);
      const firstDocument = imported.items.find(
        (item) => item.status === "succeeded" && item.document,
      )?.document;
      if (!firstDocument) {
        const cleanup = await rollbackEmptyProject(created.project);
        setError(
          `No files were imported. ${cleanup} Review the diagnostics and try again.`,
        );
        return;
      }
      if (imported.failed === 0 && created.dependencies.length === 0) {
        await onCreated(created.project.id, firstDocument.id);
      }
    } catch (reason) {
      const cleanup = createdProject
        ? await rollbackEmptyProject(createdProject)
        : null;
      setError(
        cleanup ? `${formatError(reason)} ${cleanup}` : formatError(reason),
      );
    } finally {
      setBusy(false);
    }
  };

  const successfulDocument = diagnostics.find(
    (item) => item.status === "succeeded" && item.document,
  )?.document;

  const openSuccessfulDocument = async () => {
    if (!successfulDocument) return;
    setBusy(true);
    setError(null);
    try {
      await onCreated(successfulDocument.projectId, successfulDocument.id);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-shell setup-wizard-shell">
      <header className="setup-header">
        <div className="identity-lockup">
          <BrandMark />
          <div>
            <strong>Translunar</strong>
            <span>Computer-assisted translation</span>
          </div>
        </div>
        <div className="setup-header-actions">
          <span className="setup-header-meta">Local workspace</span>
          {onCancel ? (
            <button
              className="button tertiary"
              type="button"
              onClick={onCancel}
            >
              <ArrowLeft size={14} /> Projects
            </button>
          ) : null}
        </div>
      </header>
      <div className="translunar-band" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <main className="setup-main setup-wizard-main">
        <nav className="wizard-steps" aria-label="Project setup steps">
          <WizardStepButton
            number={1}
            label="Project"
            step={step}
            onSelect={setStep}
          />
          <WizardStepButton
            number={2}
            label="Configuration"
            step={step}
            onSelect={setStep}
          />
          <WizardStepButton
            number={3}
            label="Files"
            step={step}
            onSelect={setStep}
          />
        </nav>
        <section className="setup-content wizard-content">
          <form className="setup-form wizard-form" onSubmit={submit}>
            {step === 1 ? (
              <>
                <WizardHeading
                  eyebrow="Step 01 · identity"
                  title="Name the bilingual workspace"
                  description="Set the project identity and the single source/target locale pair used by filters, QA, TM and analytics."
                />
                <label className="field field-wide">
                  <span>Project name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>Source language</span>
                  <select
                    value={sourceLocale}
                    onChange={(event) =>
                      setSourceLocale(event.currentTarget.value)
                    }
                  >
                    <option value="en-US">English (United States)</option>
                    <option value="en-GB">English (United Kingdom)</option>
                    <option value="zh-CN">Chinese (Simplified)</option>
                    <option value="zh-TW">Chinese (Traditional)</option>
                    <option value="ja-JP">Japanese</option>
                  </select>
                </label>
                <label className="field">
                  <span>Target language</span>
                  <select
                    value={targetLocale}
                    onChange={(event) =>
                      setTargetLocale(event.currentTarget.value)
                    }
                  >
                    <option value="zh-CN">Chinese (Simplified)</option>
                    <option value="zh-TW">Chinese (Traditional)</option>
                    <option value="en-US">English (United States)</option>
                    <option value="ja-JP">Japanese</option>
                  </select>
                </label>
                <label className="field field-wide">
                  <span>Domain</span>
                  <input
                    value={domain}
                    onChange={(event) => setDomain(event.currentTarget.value)}
                  />
                </label>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <WizardHeading
                  eyebrow="Step 02 · reusable configuration"
                  title="Choose the operating profile"
                  description="References are resolved by the Engine. Missing template dependencies fall back safely and remain visible in diagnostics."
                />
                {loadingOptions ? (
                  <div className="wizard-loading" role="status">
                    <LoaderCircle className="spin" size={18} /> Loading reusable
                    profiles
                  </div>
                ) : null}
                <label className="field field-wide">
                  <span>Project template</span>
                  <select
                    value={selectedTemplateId}
                    onChange={(event) =>
                      selectTemplate(event.currentTarget.value)
                    }
                  >
                    <option value="">No template · built-in defaults</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} · r{template.revision}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>QA profile</span>
                  <select
                    value={qaProfileId}
                    onChange={(event) =>
                      setQaProfileId(event.currentTarget.value)
                    }
                  >
                    <option value="">Template / default</option>
                    {qaProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Pipeline</span>
                  <select
                    value={pipelineId}
                    onChange={(event) =>
                      setPipelineId(event.currentTarget.value)
                    }
                  >
                    <option value="">Template / none</option>
                    {pipelines.map((pipeline) => (
                      <option key={pipeline.id} value={pipeline.id}>
                        {pipeline.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>AI profile</span>
                  <select
                    value={aiProfileId}
                    onChange={(event) =>
                      setAiProfileId(event.currentTarget.value)
                    }
                  >
                    <option value="">Template / offline assistant</option>
                    {aiProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} · {profile.model}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Analysis profile</span>
                  <select
                    value={analysisProfileId}
                    onChange={(event) =>
                      setAnalysisProfileId(event.currentTarget.value)
                    }
                  >
                    <option value="">Template / standard</option>
                    {analysisProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Review policy</span>
                  <select
                    value={reviewPolicy}
                    onChange={(event) =>
                      setReviewPolicy(event.currentTarget.value as ReviewPolicy)
                    }
                  >
                    <option value="template">
                      Template / required default
                    </option>
                    <option value="required">Require review</option>
                    <option value="optional">Allow direct sign-off</option>
                  </select>
                </label>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <WizardHeading
                  eyebrow="Step 03 · source review"
                  title="Add files and folders"
                  description="Folders are discovered recursively by the Engine. Relative paths, collisions and unsupported files are reported per item."
                />
                <div className="wizard-import-tools field-wide">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void chooseFiles()}
                  >
                    <Files size={15} /> Add files
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void chooseFolder()}
                  >
                    <FolderOpen size={15} /> Add folder
                  </button>
                  <label className="wizard-atomicity">
                    <span>Commit mode</span>
                    <select
                      value={atomicity}
                      onChange={(event) =>
                        setAtomicity(
                          event.currentTarget.value as typeof atomicity,
                        )
                      }
                    >
                      <option value="bestEffort">
                        Best effort · keep valid files
                      </option>
                      <option value="allOrNothing">
                        All or nothing · atomic batch
                      </option>
                    </select>
                  </label>
                </div>
                <div
                  className="wizard-dropzone field-wide"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                >
                  <UploadCloud size={24} />
                  <strong>Drop files or folders here</strong>
                  <span>
                    Paths are sanitized in the trusted preload; the renderer
                    never reads file contents.
                  </span>
                </div>
                <div
                  className="wizard-file-list field-wide"
                  aria-label="Selected source paths"
                >
                  {sourcePaths.length === 0 ? (
                    <div className="wizard-empty">
                      <FilePlus2 size={18} /> No sources selected
                    </div>
                  ) : (
                    sourcePaths.map((path) => (
                      <div className="wizard-file-row" key={path}>
                        <span title={path}>{fileName(path)}</span>
                        <code>{path}</code>
                        <button
                          type="button"
                          aria-label={`Remove ${fileName(path)}`}
                          title="Remove source"
                          onClick={() =>
                            setSourcePaths((items) =>
                              items.filter((item) => item !== path),
                            )
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                {dependencyDiagnostics.length > 0 ? (
                  <DiagnosticList
                    title="Template dependencies"
                    items={dependencyDiagnostics.map((item) => ({
                      status: item.status,
                      label: `${item.kind}: ${item.requestedId}`,
                      detail: item.message,
                    }))}
                  />
                ) : null}
                {diagnostics.length > 0 ? (
                  <DiagnosticList
                    title="Import diagnostics"
                    items={diagnostics.map((item) => ({
                      status: item.status,
                      label: item.relativePath || fileName(item.path),
                      detail: item.message ?? item.errorCode ?? "Imported",
                    }))}
                  />
                ) : null}
              </>
            ) : null}

            {error ? (
              <p className="form-error field-wide" role="alert">
                {error}
              </p>
            ) : null}
            <div className="setup-actions wizard-actions field-wide">
              <span className="setup-note">
                SQLite workspace · local files · private by default
              </span>
              <div>
                {step > 1 ? (
                  <button
                    className="button tertiary"
                    type="button"
                    disabled={busy}
                    onClick={() => setStep((step - 1) as WizardStep)}
                  >
                    <ArrowLeft size={15} /> Back
                  </button>
                ) : null}
                {step < 3 ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={goNext}
                  >
                    Continue <ArrowRight size={16} />
                  </button>
                ) : successfulDocument ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => void openSuccessfulDocument()}
                    disabled={busy}
                  >
                    Open workspace <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    className="button primary"
                    type="submit"
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="spin" size={15} /> Importing
                      </>
                    ) : (
                      <>
                        Create project <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </form>
        </section>
        <aside className="setup-aside wizard-aside">
          {step === 1 ? (
            <Languages size={24} />
          ) : step === 2 ? (
            <Settings2 size={24} />
          ) : (
            <Layers3 size={24} />
          )}
          <span>STEP 0{step}</span>
          <span>
            {sourceLocale} → {targetLocale}
          </span>
          <span>{sourcePaths.length} source selections</span>
        </aside>
      </main>
    </div>
  );
}

interface WizardStepButtonProps {
  number: WizardStep;
  label: string;
  step: WizardStep;
  onSelect(step: WizardStep): void;
}

function WizardStepButton({
  number,
  label,
  step,
  onSelect,
}: WizardStepButtonProps) {
  const complete = number < step;
  return (
    <button
      type="button"
      className={number === step ? "active" : ""}
      aria-current={number === step ? "step" : undefined}
      onClick={() => number <= step && onSelect(number)}
      disabled={number > step}
    >
      <span>{complete ? <Check size={13} /> : `0${number}`}</span>
      {label}
    </button>
  );
}

function WizardHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="setup-heading wizard-heading field-wide">
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <span>{description}</span>
    </div>
  );
}

function DiagnosticList({
  title,
  items,
}: {
  title: string;
  items: Array<{ status: string; label: string; detail: string }>;
}) {
  return (
    <section className="wizard-diagnostics field-wide">
      <header>
        <strong>{title}</strong>
        <span>{items.length}</span>
      </header>
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} data-status={item.status}>
          <span>
            {item.status === "succeeded" ||
            item.status === "resolved" ||
            item.status === "remapped" ? (
              <Check size={13} />
            ) : (
              "·"
            )}
          </span>
          <strong>{item.label}</strong>
          <small>{item.detail}</small>
        </div>
      ))}
    </section>
  );
}
