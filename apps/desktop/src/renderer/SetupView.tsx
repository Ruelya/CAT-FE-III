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
import { useLocale } from "./i18n/LocaleProvider";

interface SetupViewProps {
  onCreated(projectId: string, documentId: string): Promise<void>;
  onCancel?(): void;
}

type WizardStep = 1 | 2 | 3;
type ReviewPolicy = "template" | "required" | "optional";

export function SetupView({ onCreated, onCancel }: SetupViewProps) {
  const { t } = useLocale();

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
          ? t("setup.languagesMustDiffer")
          : t("setup.enterName"),
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
        return t("setup.cleanupSkipped");
      }
      if (current.documents.length > 0) {
        return t("setup.projectRetained");
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
      return t("setup.emptyRemoved");
    } catch (reason) {
      return t("setup.cleanupFailed", { detail: formatError(reason) });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sourcePaths.length === 0) {
      setError(t("setup.addFilesFirst"));
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
        setError(t("setup.noFilesImported", { cleanup }));
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
            <strong>{t("setup.brand")}</strong>
            <span>{t("setup.tagline")}</span>
          </div>
        </div>
        <div className="setup-header-actions">
          <span className="setup-header-meta">{t("setup.localWorkspace")}</span>
          {onCancel ? (
            <button
              className="button tertiary"
              type="button"
              onClick={onCancel}
            >
              <ArrowLeft size={14} />
              {t("home.projects")}
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
        <nav className="wizard-steps" aria-label={t("setup.stepsAria")}>
          <WizardStepButton
            number={1}
            label={t("setup.stepProject")}
            step={step}
            onSelect={setStep}
          />
          <WizardStepButton
            number={2}
            label={t("setup.stepConfiguration")}
            step={step}
            onSelect={setStep}
          />
          <WizardStepButton
            number={3}
            label={t("setup.stepFiles")}
            step={step}
            onSelect={setStep}
          />
        </nav>
        <section className="setup-content wizard-content">
          <form className="setup-form wizard-form" onSubmit={submit}>
            {step === 1 ? (
              <>
                <WizardHeading
                  eyebrow={t("setup.step1")}
                  title={t("setup.nameWorkspace")}
                  description={t("setup.identityDescription")}
                />
                <label className="field field-wide">
                  <span>{t("setup.projectName")}</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>{t("setup.sourceLanguage")}</span>
                  <select
                    value={sourceLocale}
                    onChange={(event) =>
                      setSourceLocale(event.currentTarget.value)
                    }
                  >
                    <option value="en-US">{t("setup.locale.enUS")}</option>
                    <option value="en-GB">{t("setup.locale.enGB")}</option>
                    <option value="zh-CN">{t("setup.locale.zhCN")}</option>
                    <option value="zh-TW">{t("setup.locale.zhTW")}</option>
                    <option value="ja-JP">{t("setup.locale.ja")}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("setup.targetLanguage")}</span>
                  <select
                    value={targetLocale}
                    onChange={(event) =>
                      setTargetLocale(event.currentTarget.value)
                    }
                  >
                    <option value="zh-CN">{t("setup.locale.zhCN")}</option>
                    <option value="zh-TW">{t("setup.locale.zhTW")}</option>
                    <option value="en-US">{t("setup.locale.enUS")}</option>
                    <option value="ja-JP">{t("setup.locale.ja")}</option>
                  </select>
                </label>
                <label className="field field-wide">
                  <span>{t("common.domain")}</span>
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
                  eyebrow={t("setup.step2")}
                  title={t("setup.chooseProfile")}
                  description={t("setup.configurationDescription")}
                />
                {loadingOptions ? (
                  <div className="wizard-loading" role="status">
                    <LoaderCircle className="spin" size={18} />{" "}
                    {t("setup.loadingProfiles")}
                  </div>
                ) : null}
                <label className="field field-wide">
                  <span>{t("setup.projectTemplate")}</span>
                  <select
                    value={selectedTemplateId}
                    onChange={(event) =>
                      selectTemplate(event.currentTarget.value)
                    }
                  >
                    <option value="">{t("setup.noTemplate")}</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {t("setup.revisionOption", {
                          name: template.name,
                          revision: template.revision,
                        })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("setup.qaProfile")}</span>
                  <select
                    value={qaProfileId}
                    onChange={(event) =>
                      setQaProfileId(event.currentTarget.value)
                    }
                  >
                    <option value="">{t("setup.templateDefault")}</option>
                    {qaProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("setup.pipeline")}</span>
                  <select
                    value={pipelineId}
                    onChange={(event) =>
                      setPipelineId(event.currentTarget.value)
                    }
                  >
                    <option value="">{t("setup.templateNone")}</option>
                    {pipelines.map((pipeline) => (
                      <option key={pipeline.id} value={pipeline.id}>
                        {pipeline.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("setup.aiProfile")}</span>
                  <select
                    value={aiProfileId}
                    onChange={(event) =>
                      setAiProfileId(event.currentTarget.value)
                    }
                  >
                    <option value="">{t("setup.templateOffline")}</option>
                    {aiProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} · {profile.model}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("setup.analysisProfile")}</span>
                  <select
                    value={analysisProfileId}
                    onChange={(event) =>
                      setAnalysisProfileId(event.currentTarget.value)
                    }
                  >
                    <option value="">{t("setup.templateStandard")}</option>
                    {analysisProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("setup.reviewPolicy")}</span>
                  <select
                    value={reviewPolicy}
                    onChange={(event) =>
                      setReviewPolicy(event.currentTarget.value as ReviewPolicy)
                    }
                  >
                    <option value="template">
                      {t("setup.templateRequired")}
                    </option>
                    <option value="required">{t("setup.requireReview")}</option>
                    <option value="optional">
                      {t("setup.allowDirectSignOff")}
                    </option>
                  </select>
                </label>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <WizardHeading
                  eyebrow={t("setup.step3")}
                  title={t("setup.addFiles")}
                  description={t("setup.filesDescription")}
                />
                <div className="wizard-import-tools field-wide">
                  <button
                    id="tutorial-target-import"
                    className="button secondary"
                    type="button"
                    onClick={() => void chooseFiles()}
                  >
                    <Files size={15} /> {t("setup.addFilesBtn")}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void chooseFolder()}
                  >
                    <FolderOpen size={15} /> {t("setup.addFolderBtn")}
                  </button>
                  <label className="wizard-atomicity">
                    <span>{t("setup.commitMode")}</span>
                    <select
                      value={atomicity}
                      onChange={(event) =>
                        setAtomicity(
                          event.currentTarget.value as typeof atomicity,
                        )
                      }
                    >
                      <option value="bestEffort">
                        {t("setup.bestEffort")}
                      </option>
                      <option value="allOrNothing">
                        {t("setup.allOrNothing")}
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
                  <strong>{t("setup.dropFiles")}</strong>
                  <span>{t("setup.pathsSanitized")}</span>
                </div>
                <div
                  className="wizard-file-list field-wide"
                  aria-label={t("setup.selectedPathsAria")}
                >
                  {sourcePaths.length === 0 ? (
                    <div className="wizard-empty">
                      <FilePlus2 size={18} /> {t("setup.noSourcesSelected")}
                    </div>
                  ) : (
                    sourcePaths.map((path) => (
                      <div className="wizard-file-row" key={path}>
                        <span title={path}>{fileName(path)}</span>
                        <code>{path}</code>
                        <button
                          type="button"
                          aria-label={t("setup.removeSourceNamed", {
                            name: fileName(path),
                          })}
                          title={t("setup.removeSource")}
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
                    title={t("setup.templateDeps")}
                    items={dependencyDiagnostics.map((item) => ({
                      status: item.status,
                      label: `${item.kind}: ${item.requestedId}`,
                      detail: item.message,
                    }))}
                  />
                ) : null}
                {diagnostics.length > 0 ? (
                  <DiagnosticList
                    title={t("setup.importDiagnostics")}
                    items={diagnostics.map((item) => ({
                      status: item.status,
                      label: item.relativePath || fileName(item.path),
                      detail:
                        item.message ??
                        item.errorCode ??
                        t("setup.diagnosticImported"),
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
              <span className="setup-note">{t("setup.sqlitePrivate")}</span>
              <div>
                {step > 1 ? (
                  <button
                    className="button tertiary"
                    type="button"
                    disabled={busy}
                    onClick={() => setStep((step - 1) as WizardStep)}
                  >
                    <ArrowLeft size={15} />
                    {t("action.back")}
                  </button>
                ) : null}
                {step < 3 ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={goNext}
                  >
                    {t("setup.continue")} <ArrowRight size={16} />
                  </button>
                ) : successfulDocument ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => void openSuccessfulDocument()}
                    disabled={busy}
                  >
                    {t("setup.openWorkspace")} <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    className="button primary"
                    type="submit"
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="spin" size={15} />{" "}
                        {t("setup.importing")}
                      </>
                    ) : (
                      <>
                        {t("action.createProject")}
                        <ArrowRight size={16} />
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
          <span>{t("setup.stepCounter", { step })}</span>
          <span>
            {sourceLocale} → {targetLocale}
          </span>
          <span>
            {t("setup.sourceSelections", { count: sourcePaths.length })}
          </span>
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
