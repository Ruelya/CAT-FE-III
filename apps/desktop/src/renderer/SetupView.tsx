import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent} from "react";
import type {
  AiProviderProfile,
  AnalysisProfile,
  BatchImportDiagnostic,
  PipelineDefinition,
  Project,
  ProjectTemplate,
  QaProfile,
  TemplateDependencyDiagnostic} from "@translunar/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FilePlus2,
  Files,
  FolderOpen,
  Trash2,
  UploadCloud} from "lucide-react";

import { CompositionRail } from "./components/project/CompositionRail";
import { Stepper } from "./components/project/Stepper";
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
  const [wizardDir, setWizardDir] = useState<"next" | "back" | null>(null);
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
        limit: 100}),
      window.translunar.invoke("qa.profile.list", {
        offset: 0,
        limit: 100}),
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

  const selectedQa = useMemo(
    () => qaProfiles.find((profile) => profile.id === qaProfileId),
    [qaProfileId, qaProfiles],
  );
  const selectedAi = useMemo(
    () => aiProfiles.find((profile) => profile.id === aiProfileId),
    [aiProfileId, aiProfiles],
  );
  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === pipelineId),
    [pipelineId, pipelines],
  );
  const selectedAnalysis = useMemo(
    () => analysisProfiles.find((profile) => profile.id === analysisProfileId),
    [analysisProfileId, analysisProfiles],
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

  const goToStep = (next: WizardStep, dir: "next" | "back") => {
    setWizardDir(dir);
    setStep(next);
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
    goToStep((step + 1) as WizardStep, "next");
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
          dependencyRemaps: {}},
      );
      project = result.project;
      dependencies = result.diagnostics;
      onProjectCreated(project);
    } else {
      project = await window.translunar.invoke("project.create", {
        name: name.trim(),
        sourceLocale,
        targetLocale,
        domain: domain.trim()});
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
          : reviewPolicy === "required"};
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
        actor: "desktop-wizard"});
      onProjectCreated(project);
    }
    return { project, dependencies };
  };

  const rollbackEmptyProject = async (project: Project): Promise<string> => {
    try {
      const current = await window.translunar.invoke("project.get", {
        projectId: project.id});
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
        reason: "Project setup imported no supported files"});
      await window.translunar.invoke("recycle.purge", {
        entryId: entry.id,
        actor: "desktop-wizard",
        reason: "Rollback empty project setup"});
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
        atomicity});
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

  const steps = useMemo(
    () => [
      { id: "project", label: t("setup.stepProject") },
      { id: "configuration", label: t("setup.stepConfiguration") },
      { id: "files", label: t("setup.stepFiles") },
    ],
    [t],
  );

  const templateMeta = selectedTemplate
    ? t("setup.metaTemplateSelected", {
        name: selectedTemplate.name,
        revision: selectedTemplate.revision})
    : t("setup.metaTemplateNone");

  const qaMeta = selectedQa
    ? t("setup.metaQaRules", {
        count: selectedQa.definition.enabledRuleIds.length})
    : t("setup.metaTemplateDefault");

  const aiMeta = selectedAi
    ? t("setup.metaAiModel", { model: selectedAi.model })
    : t("setup.metaAiOffline");

  const pipelineMeta = selectedPipeline
    ? t("setup.metaPipelineSelected", { name: selectedPipeline.name })
    : t("setup.metaPipelineNone");

  const analysisMeta = selectedAnalysis
    ? t("setup.metaAnalysisSelected", { name: selectedAnalysis.name })
    : t("setup.metaAnalysisStandard");

  const reviewMeta =
    reviewPolicy === "required"
      ? t("setup.requireReview")
      : reviewPolicy === "optional"
        ? t("setup.allowDirectSignOff")
        : t("setup.templateRequired");

  return (
    <div className="setup-wizard-shell">
      <CompositionRail
        title={t("setup.brand")}
        subtitle={t("setup.tagline")}
        footer={
          onCancel ? (
            <button
              className="button tertiary setup-wizard-cancel"
              type="button"
              onClick={onCancel}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              {t("home.projects")}
            </button>
          ) : null
        }
      >
        <Stepper
          steps={steps}
          current={step - 1}
          onSelect={(index) =>
            goToStep((index + 1) as WizardStep, index + 1 < step ? "back" : "next")
          }
          ariaLabel={t("setup.stepsAria")}
        />
        <div className="setup-rail-summary">
          <span>
            <strong>
              {sourceLocale} → {targetLocale}
            </strong>
          </span>
          <span>
            {t("setup.sourceSelections", { count: sourcePaths.length })}
          </span>
        </div>
      </CompositionRail>

      <main className="setup-wizard-main">
        <section
          className="setup-wizard-panel wizard-content"
          data-wizard-dir={wizardDir ?? undefined}
          key={step}
        >
          <form className="setup-form wizard-form" onSubmit={submit}>
            {step === 1 ? (
              <>
                <WizardHeading
                  eyebrow={t("setup.stepCounter", { step })}
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
                  eyebrow={t("setup.stepCounter", { step })}
                  title={t("setup.chooseProfile")}
                  description={t("setup.configurationDescription")}
                />
                {loadingOptions ? (
                  <div className="wizard-loading" role="status">
                    {" "}
                    {t("setup.loadingProfiles")}
                  </div>
                ) : null}

                <section className="wizard-group">
                  <h3 className="wizard-group__title">{t("setup.groupReuse")}</h3>
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
                            revision: template.revision})}
                        </option>
                      ))}
                    </select>
                    <small className="wizard-field-meta">{templateMeta}</small>
                  </label>
                </section>

                <section className="wizard-group">
                  <h3 className="wizard-group__title">
                    {t("setup.groupQuality")}
                  </h3>
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
                    <small className="wizard-field-meta">{qaMeta}</small>
                  </label>
                  <label className="field">
                    <span>{t("setup.reviewPolicy")}</span>
                    <select
                      value={reviewPolicy}
                      onChange={(event) =>
                        setReviewPolicy(
                          event.currentTarget.value as ReviewPolicy,
                        )
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
                    <small className="wizard-field-meta">{reviewMeta}</small>
                  </label>
                </section>

                <section className="wizard-group">
                  <h3 className="wizard-group__title">
                    {t("setup.groupAutomation")}
                  </h3>
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
                    <small className="wizard-field-meta">{aiMeta}</small>
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
                    <small className="wizard-field-meta">{pipelineMeta}</small>
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
                    <small className="wizard-field-meta">{analysisMeta}</small>
                  </label>
                </section>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <WizardHeading
                  eyebrow={t("setup.stepCounter", { step })}
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
                    <Files size={15} aria-hidden="true" /> {t("setup.addFilesBtn")}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void chooseFolder()}
                  >
                    <FolderOpen size={15} aria-hidden="true" />{" "}
                    {t("setup.addFolderBtn")}
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
                  <UploadCloud size={24} aria-hidden="true" />
                  <strong>{t("setup.dropFiles")}</strong>
                  <span>{t("setup.pathsSanitized")}</span>
                </div>
                <div
                  className="wizard-file-list field-wide"
                  aria-label={t("setup.selectedPathsAria")}
                >
                  {sourcePaths.length === 0 ? (
                    <div className="wizard-empty">
                      <FilePlus2 size={18} aria-hidden="true" />{" "}
                      {t("setup.noSourcesSelected")}
                    </div>
                  ) : (
                    sourcePaths.map((path) => (
                      <div className="wizard-file-row" key={path}>
                        <span title={path}>{fileName(path)}</span>
                        <code>{path}</code>
                        <button
                          type="button"
                          aria-label={t("setup.removeSourceNamed", {
                            name: fileName(path)})}
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
                      detail: item.message}))}
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
                        t("setup.diagnosticImported")}))}
                  />
                ) : null}
              </>
            ) : null}

            {error ? (
              <p className="form-error field-wide" role="alert">
                {error}
              </p>
            ) : null}
            <div className="wizard-actions field-wide">
              <div>
                {step > 1 ? (
                  <button
                    className="button tertiary"
                    type="button"
                    disabled={busy}
                    onClick={() => goToStep((step - 1) as WizardStep, "back")}
                  >
                    <ArrowLeft size={15} aria-hidden="true" />
                    {t("action.back")}
                  </button>
                ) : null}
                {step < 3 ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={goNext}
                  >
                    {t("setup.continue")}{" "}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ) : successfulDocument ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => void openSuccessfulDocument()}
                    disabled={busy}
                  >
                    {t("setup.openWorkspace")}{" "}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    className="button primary"
                    type="submit"
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        {" "}
                        {t("setup.importing")}
                      </>
                    ) : (
                      <>
                        {t("action.createProject")}
                        <ArrowRight size={16} aria-hidden="true" />
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

function WizardHeading({
  eyebrow,
  title,
  description}: {
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
  items}: {
  title: string;
  items: Array<{ status: string; label: string; detail: string }>;
}) {
  return (
    <section className="wizard-diagnostics field-wide">
      <header>
        <strong>{title}</strong>
        <span className="num">{items.length}</span>
      </header>
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} data-status={item.status}>
          <span>
            {item.status === "succeeded" ||
            item.status === "resolved" ||
            item.status === "remapped" ? (
              <Check size={13} aria-hidden="true" />
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
