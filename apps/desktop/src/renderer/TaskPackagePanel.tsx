import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Document,
  ProjectSnapshot,
  TaskPackageAssetSelection,
  TaskPackageDisposition,
  TaskPackageImportResult,
  TaskPackagePreviewResult,
  TaskPackagePreviewRow,
  Termbase,
  TmLibrary} from "@translunar/contracts";
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
  X} from "lucide-react";

import { fileName, formatError } from "./workbench-utils";
import "./TaskPackagePanel.css";
import { useLocale } from "./i18n/LocaleProvider";

type TaskPackageMode = "assignment" | "review" | "return";
type AssetKind = "tm" | "termbase";

interface AssetOption {
  id: string;
  kind: AssetKind;
  name: string;
  sourceLocale: string;
  targetLocale: string;
}

interface AssetDraft {
  kind: AssetKind;
  libraryId: string;
  rowIds: string;
}

interface TaskPackagePanelProps {
  snapshot: ProjectSnapshot;
  document: Document;
  documents: Document[];
  onRefresh(): Promise<void>;
  onOpenProject(projectId: string, documentId?: string): Promise<void>;
}

const PAGE_SIZE = 25;

export function TaskPackagePanel({
  snapshot,
  document,
  documents,
  onRefresh,
  onOpenProject}: TaskPackagePanelProps) {
  const { t } = useLocale();

  const projectId = snapshot.project.id;
  const activeDocuments = useMemo(
    () => documents.filter((item) => item.status === "active"),
    [documents],
  );
  const packageReference = snapshot.project.configuration.taskPackage;
  const [mode, setMode] = useState<TaskPackageMode>("assignment");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(
    () => new Set(document.id ? [document.id] : []),
  );
  const [segmentIds, setSegmentIds] = useState<Record<string, string>>({});
  const [instructions, setInstructions] = useState("");
  const [returnInstructions, setReturnInstructions] = useState("");
  const [destinationPath, setDestinationPath] = useState("");
  const [packagePath, setPackagePath] = useState("");
  const [preview, setPreview] = useState<TaskPackagePreviewResult | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(
    () => new Set(),
  );
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [assetDrafts, setAssetDrafts] = useState<AssetDraft[]>([]);
  const [actor, setActor] = useState("desktop-user");
  const [reason, setReason] = useState("Offline task package workflow");
  const [importProjectName, setImportProjectName] = useState("");
  const [importDomain, setImportDomain] = useState("offline-task");
  const [importResult, setImportResult] =
    useState<TaskPackageImportResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);

  useEffect(() => {
    const available = new Set(activeDocuments.map((item) => item.id));
    setSelectedDocumentIds((current) => {
      const retained = [...current].filter((id) => available.has(id));
      if (retained.length) return new Set(retained);
      return new Set(
        document.id && available.has(document.id)
          ? [document.id]
          : activeDocuments.slice(0, 1).map((item) => item.id),
      );
    });
  }, [activeDocuments, document.id]);

  const loadAssetOptions = useCallback(async () => {
    try {
      const [tmPage, termbasePage] = await Promise.all([
        window.translunar.invoke("tm.library.list", {
          projectId,
          offset: 0,
          limit: 500}),
        window.translunar.invoke("termbase.list", {
          projectId,
          offset: 0,
          limit: 500}),
      ]);
      const tmById = new Map(tmPage.items.map((item) => [item.id, item]));
      const termbaseById = new Map(
        termbasePage.items.map((item) => [item.id, item]),
      );
      const options: AssetOption[] = [];
      for (const mount of tmPage.mounts) {
        const library = tmById.get(mount.libraryId);
        if (!library || !mount.enabled) continue;
        options.push(assetOptionFromTm(library));
      }
      for (const mount of termbasePage.mounts) {
        const termbase = termbaseById.get(mount.termbaseId);
        if (!termbase || !mount.enabled) continue;
        options.push(
          assetOptionFromTermbase(termbase, snapshot.project.targetLocale),
        );
      }
      const unique = new Map(
        options.map((option) => [`${option.kind}:${option.id}`, option]),
      );
      setAssetOptions([...unique.values()]);
    } catch (reasonValue: unknown) {
      // Asset slices are optional; an unavailable asset projection should not
      // prevent document assignment export from remaining usable.
      setAssetOptions([]);
      setError(formatError(reasonValue));
    }
  }, [projectId, snapshot.project.targetLocale]);

  useEffect(() => {
    void loadAssetOptions();
  }, [loadAssetOptions]);

  useEffect(() => {
    setPreview(null);
    setSelectedRows(new Set());
    setImportResult(null);
    setPackagePath("");
    setDestinationPath("");
    setError(null);
    setNotice(null);
  }, [projectId]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reasonValue: unknown) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(null);
    }
  };

  const choosePackage = async () => {
    await run("choose-package", async () => {
      const path = await window.translunar.selectTaskPackageInput();
      if (!path) return;
      setPackagePath(path);
      setPreview(null);
      setSelectedRows(new Set());
      setImportResult(null);
    });
  };

  const chooseDestination = async (kind: "assignment" | "return") => {
    await run("choose-destination", async () => {
      const base = safeFileName(snapshot.project.name);
      const suggested =
        kind === "assignment"
          ? `${base}-assignment.tltask`
          : `${base}-return.tltask`;
      const path = await window.translunar.selectExportPath(suggested);
      if (path) setDestinationPath(path);
    });
  };

  const exportAssignment = async () => {
    if (!destinationPath || selectedDocumentIds.size === 0) return;
    await run("assignment-export", async () => {
      const documentsSelection = [...selectedDocumentIds].map((id) => ({
        documentId: id,
        segmentIds: parseDelimitedIds(segmentIds[id] ?? "")}));
      const assetSlices = buildAssetSelections(assetDrafts);
      const result = await window.translunar.invoke("taskPackage.export", {
        kind: "assignment",
        projectId,
        expectedProjectRevision: snapshot.project.revision,
        documents: documentsSelection,
        assetSlices,
        instructions: instructions.trim(),
        destinationPath,
        actor: actor.trim(),
        reason: reason.trim()});
      setNotice(
        t("task.assignmentExported", {
          id: result.packageId.slice(0, 12),
          name: fileName(result.packagePath)}),
      );
    });
  };

  const exportReturn = async () => {
    if (!destinationPath || !packageReference) return;
    await run("return-export", async () => {
      const result = await window.translunar.invoke("taskPackage.export", {
        kind: "return",
        workingProjectId: projectId,
        parentPackageId: packageReference.packageId,
        instructions: returnInstructions.trim(),
        destinationPath,
        actor: actor.trim(),
        reason: reason.trim()});
      setNotice(
        t("task.returnExported", {
          id: result.packageId.slice(0, 12),
          name: fileName(result.packagePath)}),
      );
    });
  };

  const previewPackage = async () => {
    if (!packagePath) return;
    await run("preview-package", async () => {
      const result = await window.translunar.invoke("taskPackage.preview", {
        packagePath,
        offset: 0,
        limit: PAGE_SIZE,
        actor: actor.trim(),
        reason: reason.trim()});
      setPreview(result);
      setSelectedRows(
        new Set(
          result.rows.filter((row) => row.selected).map((row) => row.rowId),
        ),
      );
      setImportResult(null);
      setNotice(
        t("task.previewReady", {
          kind:
            result.kind === "assignment"
              ? t("task.kindAssignment")
              : t("task.kindReturn"),
          count: result.total}),
      );
    });
  };

  const loadPreviewPage = async (offset: number) => {
    if (!preview) return;
    await run("page-preview", async () => {
      const result = await window.translunar.invoke("taskPackage.preview", {
        previewId: preview.previewId,
        offset,
        limit: preview.limit,
        actor: actor.trim(),
        reason: reason.trim()});
      setPreview(result);
      setSelectedRows((current) => {
        const next = new Set(current);
        for (const row of result.rows) {
          if (row.selected) next.add(row.rowId);
        }
        return next;
      });
    });
  };

  const importAssignment = async () => {
    if (!preview || preview.kind !== "assignment") return;
    await run("import-assignment", async () => {
      const result = await window.translunar.invoke("taskPackage.import", {
        previewId: preview.previewId,
        projectName: importProjectName.trim() || null,
        domain: importDomain.trim() || null,
        actor: actor.trim(),
        reason: reason.trim()});
      setImportResult(result);
      setPreview((current) =>
        current ? { ...current, status: "applied" } : current,
      );
      setNotice(t("task.detachedCreated", { count: result.bindingCount }));
    });
  };

  const applyReturn = async () => {
    if (!preview || preview.kind !== "return" || selectedRows.size === 0)
      return;
    await run("apply-return", async () => {
      const result = await window.translunar.invoke("taskPackage.apply", {
        previewId: preview.previewId,
        expectedProjectRevision: preview.expectedProjectRevision,
        selectedRowIds: [...selectedRows],
        actor: actor.trim(),
        reason: reason.trim()});
      setPreview((current) =>
        current ? { ...current, status: result.status } : current,
      );
      await onRefresh();
      setNotice(
        t("task.applied", {
          count: result.appliedCount,
          revision: result.projectRevision}),
      );
    });
  };

  const discardPreview = async () => {
    if (!preview) return;
    await run("discard-package", async () => {
      await window.translunar.invoke("taskPackage.discard", {
        packageId: preview.packageId,
        previewId: preview.previewId,
        actor: actor.trim(),
        reason: reason.trim()});
      setPreview(null);
      setPackagePath("");
      setSelectedRows(new Set());
      setNotice(t("task.discarded"));
    });
  };

  const toggleDocument = (id: string, checked: boolean) => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleRow = (row: TaskPackagePreviewRow, checked: boolean) => {
    if (!row.safeToApply) return;
    setSelectedRows((current) => {
      const next = new Set(current);
      if (checked) next.add(row.rowId);
      else next.delete(row.rowId);
      return next;
    });
  };

  const selectSafeVisibleRows = () => {
    if (!preview) return;
    setSelectedRows((current) => {
      const next = new Set(current);
      for (const row of preview.rows) {
        if (row.safeToApply) next.add(row.rowId);
      }
      return next;
    });
  };

  const currentOffset = preview?.offset ?? 0;
  const currentLimit = preview?.limit ?? PAGE_SIZE;
  const canPrevious = currentOffset > 0;
  const canNext =
    preview !== null && currentOffset + currentLimit < preview.total;
  const terminalPreview = preview !== null && preview.status !== "open";
  const auditReady = actor.trim().length > 0 && reason.trim().length > 0;

  return (
    <div className="task-package-layout">
      <div
        className="task-package-mode-tabs"
        role="tablist"
        aria-label={t("task.modeAria")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "assignment"}
          onClick={() => setMode("assignment")}
        >
          <Upload size={15} /> {t("task.createAssignment")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "review"}
          onClick={() => setMode("review")}
        >
          <Archive size={15} /> {t("task.openPackage")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "return"}
          onClick={() => setMode("return")}
        >
          <Download size={15} /> {t("task.exportReturn")}
        </button>
      </div>

      <section className="task-package-audit" aria-label={t("task.auditAria")}>
        <label className="task-package-field">
          <span>{t("common.actor")}</span>
          <input
            value={actor}
            onChange={(event) => setActor(event.currentTarget.value)}
            maxLength={256}
            disabled={!!busy}
          />
        </label>
        <label className="task-package-field">
          <span>{t("common.reason")}</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            maxLength={4_096}
            disabled={!!busy}
          />
        </label>
      </section>

      {mode === "assignment" ? (
        <AssignmentExportPanel
          documents={activeDocuments}
          selectedDocumentIds={selectedDocumentIds}
          segmentIds={segmentIds}
          instructions={instructions}
          assetOptions={assetOptions}
          assetDrafts={assetDrafts}
          destinationPath={destinationPath}
          busy={!!busy}
          auditReady={auditReady}
          onToggleDocument={toggleDocument}
          onSegmentIds={(id, value) =>
            setSegmentIds((current) => ({ ...current, [id]: value }))
          }
          onInstructions={setInstructions}
          onAssetDrafts={setAssetDrafts}
          onChooseDestination={() => void chooseDestination("assignment")}
          onExport={() => void exportAssignment()}
        />
      ) : mode === "return" ? (
        <ReturnExportPanel
          projectName={snapshot.project.name}
          packageReference={packageReference}
          instructions={returnInstructions}
          destinationPath={destinationPath}
          busy={!!busy}
          auditReady={auditReady}
          onInstructions={setReturnInstructions}
          onChooseDestination={() => void chooseDestination("return")}
          onExport={() => void exportReturn()}
        />
      ) : (
        <PackageReviewPanel
          packagePath={packagePath}
          preview={preview}
          selectedRows={selectedRows}
          importProjectName={importProjectName}
          importDomain={importDomain}
          busy={!!busy}
          auditReady={auditReady}
          canPrevious={canPrevious}
          canNext={canNext}
          onChoosePackage={() => void choosePackage()}
          onPreview={() => void previewPackage()}
          onImportName={setImportProjectName}
          onImportDomain={setImportDomain}
          onImport={() => void importAssignment()}
          onToggleRow={toggleRow}
          onSelectSafe={selectSafeVisibleRows}
          onApply={() => setConfirmApply(true)}
          onDiscard={() => void discardPreview()}
          onPrevious={() => void loadPreviewPage(currentOffset - currentLimit)}
          onNext={() => void loadPreviewPage(currentOffset + currentLimit)}
          terminalPreview={terminalPreview}
          importResult={importResult}
          onOpenImportedProject={() => {
            const first = importResult?.documents[0];
            if (first && importResult) {
              void onOpenProject(importResult.project.id, first.id);
            }
          }}
        />
      )}

      {error ? (
        <p className="surface-error task-package-feedback" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
      {notice ? (
        <p className="surface-success task-package-feedback" role="status">
          <CheckCircle2 size={14} /> {notice}
        </p>
      ) : null}

      {busy ? (
        <div className="task-package-loading" role="status">
          {" "}
          {t("common.workingOn", { task: busy.replaceAll("-", " ") })}
        </div>
      ) : null}

      {confirmApply && preview ? (
        <ApplyDialog
          count={selectedRows.size}
          busy={busy === "apply-return"}
          onCancel={() => setConfirmApply(false)}
          onConfirm={() => {
            setConfirmApply(false);
            void applyReturn();
          }}
        />
      ) : null}
    </div>
  );
}

function AssignmentExportPanel({
  documents,
  selectedDocumentIds,
  segmentIds,
  instructions,
  assetOptions,
  assetDrafts,
  destinationPath,
  busy,
  auditReady,
  onToggleDocument,
  onSegmentIds,
  onInstructions,
  onAssetDrafts,
  onChooseDestination,
  onExport}: {
  documents: Document[];
  selectedDocumentIds: Set<string>;
  segmentIds: Record<string, string>;
  instructions: string;
  assetOptions: AssetOption[];
  assetDrafts: AssetDraft[];
  destinationPath: string;
  busy: boolean;
  auditReady: boolean;
  onToggleDocument(id: string, checked: boolean): void;
  onSegmentIds(id: string, value: string): void;
  onInstructions(value: string): void;
  onAssetDrafts(value: AssetDraft[]): void;
  onChooseDestination(): void;
  onExport(): void;
}) {
  const { t } = useLocale();
  const assetDraftsValid = assetDrafts.every(
    (draft) => draft.libraryId && parseDelimitedIds(draft.rowIds).length > 0,
  );
  return (
    <section className="insights-section task-package-controls">
      <TaskPackageHeading
        eyebrow="Bounded handoff"
        title={t("task.createAssignment")}
        icon={<Upload size={18} />}
      />
      <p className="task-package-copy">{t("task.exportImmutable")}</p>
      <div
        className="task-package-documents"
        aria-label={t("task.assignmentDocs")}
      >
        {documents.length ? (
          documents.map((item) => {
            const selected = selectedDocumentIds.has(item.id);
            return (
              <div className="task-package-document-row" key={item.id}>
                <label className="task-package-document-check">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) =>
                      onToggleDocument(item.id, event.currentTarget.checked)
                    }
                    disabled={busy}
                  />
                  <span>
                    <strong>{item.relativePath}</strong>
                    <small>
                      {item.segmentCount} segments · revision {item.revision}
                    </small>
                  </span>
                </label>
                {selected ? (
                  <label className="task-package-inline-field">
                    <span>{t("task.optionalSegmentIds")}</span>
                    <input
                      value={segmentIds[item.id] ?? ""}
                      onChange={(event) =>
                        onSegmentIds(item.id, event.currentTarget.value)
                      }
                      placeholder={t("task.segmentIdsPlaceholder")}
                      disabled={busy}
                    />
                  </label>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="task-package-empty">
            <FileText size={20} />
            <span>{t("task.noActiveDocuments")}</span>
          </div>
        )}
      </div>

      <label className="task-package-field">
        <span>{t("task.instructions")}</span>
        <textarea
          value={instructions}
          onChange={(event) => onInstructions(event.currentTarget.value)}
          maxLength={16_384}
          rows={3}
          placeholder={t("task.instructionsPlaceholder")}
          disabled={busy}
        />
      </label>

      <AssetSliceEditor
        options={assetOptions}
        drafts={assetDrafts}
        busy={busy}
        onChange={onAssetDrafts}
      />
      {!assetDraftsValid ? (
        <p className="task-package-slice-error" role="alert">
          {t("task.everySliceRequires")}
        </p>
      ) : null}

      <div className="task-package-path-row">
        <button
          className="button secondary"
          type="button"
          onClick={onChooseDestination}
          disabled={busy || selectedDocumentIds.size === 0}
        >
          <FolderOpen size={14} /> {t("task.chooseDestination")}
        </button>
        <span className="task-package-path" title={destinationPath}>
          {destinationPath
            ? fileName(destinationPath)
            : "No destination selected"}
        </span>
        <button
          className="button primary"
          type="button"
          onClick={onExport}
          disabled={
            busy ||
            !auditReady ||
            !assetDraftsValid ||
            selectedDocumentIds.size === 0 ||
            !destinationPath
          }
        >
          <Archive size={14} /> {t("task.exportAssignment")}
        </button>
      </div>
    </section>
  );
}

function ReturnExportPanel({
  projectName,
  packageReference,
  instructions,
  destinationPath,
  busy,
  auditReady,
  onInstructions,
  onChooseDestination,
  onExport}: {
  projectName: string;
  packageReference: ProjectSnapshot["project"]["configuration"]["taskPackage"];
  instructions: string;
  destinationPath: string;
  busy: boolean;
  auditReady: boolean;
  onInstructions(value: string): void;
  onChooseDestination(): void;
  onExport(): void;
}) {
  const { t } = useLocale();
  if (!packageReference) {
    return (
      <section className="insights-section task-package-unavailable">
        <ShieldAlert size={22} />
        <strong>{t("task.notImported")}</strong>
        <span>{t("task.importFirst")}</span>
      </section>
    );
  }
  return (
    <section className="insights-section task-package-controls">
      <TaskPackageHeading
        eyebrow="Detached work"
        title={t("task.exportReturn")}
        icon={<Download size={18} />}
      />
      <dl className="task-package-facts">
        <div>
          <dt>{t("task.taskProject")}</dt>
          <dd>{projectName}</dd>
        </div>
        <div>
          <dt>{t("task.originPackage")}</dt>
          <dd>{packageReference.packageId.slice(0, 16)}</dd>
        </div>
        <div>
          <dt>{t("task.originProject")}</dt>
          <dd>{packageReference.originProjectId.slice(0, 16)}</dd>
        </div>
      </dl>
      <p className="task-package-copy">{t("task.engineChangedOnly")}</p>
      <label className="task-package-field">
        <span>{t("task.returnInstructions")}</span>
        <textarea
          value={instructions}
          onChange={(event) => onInstructions(event.currentTarget.value)}
          maxLength={16_384}
          rows={3}
          placeholder={t("task.returnNotePlaceholder")}
          disabled={busy}
        />
      </label>
      <div className="task-package-path-row">
        <button
          className="button secondary"
          type="button"
          onClick={onChooseDestination}
          disabled={busy}
        >
          <FolderOpen size={14} /> {t("task.chooseDestination")}
        </button>
        <span className="task-package-path" title={destinationPath}>
          {destinationPath
            ? fileName(destinationPath)
            : "No destination selected"}
        </span>
        <button
          className="button primary"
          type="button"
          onClick={onExport}
          disabled={busy || !auditReady || !destinationPath}
        >
          <Archive size={14} /> {t("task.exportReturn")}
        </button>
      </div>
    </section>
  );
}

function PackageReviewPanel({
  packagePath,
  preview,
  selectedRows,
  importProjectName,
  importDomain,
  busy,
  auditReady,
  canPrevious,
  canNext,
  onChoosePackage,
  onPreview,
  onImportName,
  onImportDomain,
  onImport,
  onToggleRow,
  onSelectSafe,
  onApply,
  onDiscard,
  onPrevious,
  onNext,
  terminalPreview,
  importResult,
  onOpenImportedProject}: {
  packagePath: string;
  preview: TaskPackagePreviewResult | null;
  selectedRows: Set<string>;
  importProjectName: string;
  importDomain: string;
  busy: boolean;
  auditReady: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onChoosePackage(): void;
  onPreview(): void;
  onImportName(value: string): void;
  onImportDomain(value: string): void;
  onImport(): void;
  onToggleRow(row: TaskPackagePreviewRow, checked: boolean): void;
  onSelectSafe(): void;
  onApply(): void;
  onDiscard(): void;
  onPrevious(): void;
  onNext(): void;
  terminalPreview: boolean;
  importResult: TaskPackageImportResult | null;
  onOpenImportedProject(): void;
}) {
  const { t } = useLocale();
  return (
    <>
      <section className="insights-section task-package-controls">
        <TaskPackageHeading
          eyebrow="Trusted package review"
          title={t("task.previewTitle")}
          icon={<Archive size={18} />}
        />
        <div className="task-package-path-row">
          <button
            className="button secondary"
            type="button"
            onClick={onChoosePackage}
            disabled={busy}
          >
            <FolderOpen size={14} /> {t("task.openTltask")}
          </button>
          <span className="task-package-path" title={packagePath}>
            {packagePath ? fileName(packagePath) : "No package selected"}
          </span>
          <button
            className="button primary"
            type="button"
            onClick={onPreview}
            disabled={busy || !auditReady || !packagePath}
          >
            <RefreshCw size={14} /> {t("task.previewPackage")}
          </button>
        </div>

        {preview?.kind === "assignment" ? (
          <div className="task-package-import-fields">
            <label className="task-package-field">
              <span>{t("task.detachedName")}</span>
              <input
                value={importProjectName}
                onChange={(event) => onImportName(event.currentTarget.value)}
                maxLength={256}
                placeholder={t("task.detachedPlaceholder")}
                disabled={busy || terminalPreview}
              />
            </label>
            <label className="task-package-field">
              <span>{t("common.domain")}</span>
              <input
                value={importDomain}
                onChange={(event) => onImportDomain(event.currentTarget.value)}
                maxLength={128}
                disabled={busy || terminalPreview}
              />
            </label>
            <button
              className="button primary"
              type="button"
              onClick={onImport}
              disabled={busy || !auditReady || terminalPreview}
            >
              <Upload size={14} /> {t("task.importDetached")}
            </button>
          </div>
        ) : null}
      </section>

      {preview ? (
        <section
          className="insights-section task-package-preview"
          aria-busy={busy}
        >
          <header className="insights-section-heading">
            <div>
              <span className="surface-kicker">
                {preview.kind} · {preview.status} ·{" "}
                {preview.previewId.slice(0, 10)}
              </span>
              <h2>{t("task.engineClassifications")}</h2>
            </div>
            <div className="task-package-preview-actions">
              {preview.kind === "return" ? (
                <button
                  className="button secondary"
                  type="button"
                  onClick={onSelectSafe}
                  disabled={busy || terminalPreview}
                >
                  <Check size={13} /> {t("task.selectSafeOnPage")}
                </button>
              ) : null}
              {preview.kind === "return" ? (
                <button
                  className="button primary"
                  type="button"
                  onClick={onApply}
                  disabled={
                    busy ||
                    !auditReady ||
                    terminalPreview ||
                    selectedRows.size === 0
                  }
                >
                  <CheckCircle2 size={13} />{" "}
                  {t("task.applyCount", {
                    count: selectedRows.size})}
                </button>
              ) : null}
              <button
                className="icon-button danger"
                type="button"
                title={t("task.discardStaged")}
                aria-label={t("task.discardStaged")}
                onClick={onDiscard}
                disabled={busy || !auditReady || terminalPreview}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </header>

          <div
            className="task-package-counts"
            aria-label={t("task.countsAria")}
          >
            <TaskCount label="Total" value={preview.counts.total} />
            <TaskCount label="Unchanged" value={preview.counts.unchanged} />
            <TaskCount label="Remote" value={preview.counts.remoteChanged} />
            <TaskCount label="Local" value={preview.counts.localChanged} />
            <TaskCount label="Both" value={preview.counts.bothChanged} />
            <TaskCount
              label="Invalid"
              value={
                preview.counts.tagInvalid + preview.counts.missingDependency
              }
            />
          </div>

          {preview.diagnostics.length ? (
            <div className="task-package-diagnostics" role="status">
              {preview.diagnostics.map((diagnostic, index) => (
                <div key={`${diagnostic.code}-${diagnostic.rowId ?? index}`}>
                  <AlertTriangle size={13} />
                  <span>
                    <strong>{diagnostic.code}</strong> {diagnostic.message}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div
            className="task-package-rows"
            role="list"
            aria-label={t("task.rowsAria")}
          >
            {preview.rows.length ? (
              preview.rows.map((row) => (
                <TaskPackageRowView
                  key={row.rowId}
                  row={row}
                  selected={selectedRows.has(row.rowId)}
                  disabled={busy || terminalPreview}
                  onToggle={onToggleRow}
                />
              ))
            ) : (
              <div className="task-package-empty">
                <ShieldAlert size={20} />
                <span>{t("task.noRows")}</span>
              </div>
            )}
          </div>

          <div className="task-package-pagination">
            <button
              className="button tertiary"
              type="button"
              onClick={onPrevious}
              disabled={busy || !canPrevious}
            >
              <ChevronLeft size={14} /> {t("task.previous")}
            </button>
            <span>
              {preview.total === 0
                ? "0 rows"
                : `${preview.offset + 1}-${Math.min(preview.offset + preview.rows.length, preview.total)} of ${preview.total}`}
            </span>
            <button
              className="button tertiary"
              type="button"
              onClick={onNext}
              disabled={busy || !canNext}
            >
              {t("action.next")}
              <ChevronRight size={14} />
            </button>
          </div>
        </section>
      ) : null}

      {importResult ? (
        <section
          className="insights-section task-package-import-result"
          role="status"
        >
          <CheckCircle2 size={20} />
          <div>
            <strong>{t("task.detachedReady")}</strong>
            <span>
              {importResult.project.name} ·{" "}
              {t("task.importDocumentCount", {
                count: importResult.documents.length})}{" "}
              ·{" "}
              {t("task.importBoundRowCount", {
                count: importResult.bindingCount})}
            </span>
          </div>
          <button
            className="button primary"
            type="button"
            onClick={onOpenImportedProject}
          >
            <FileText size={14} /> {t("task.openTaskProject")}
          </button>
        </section>
      ) : null}
    </>
  );
}

function TaskPackageRowView({
  row,
  selected,
  disabled,
  onToggle}: {
  row: TaskPackagePreviewRow;
  selected: boolean;
  disabled: boolean;
  onToggle(row: TaskPackagePreviewRow, checked: boolean): void;
}) {
  const { t } = useLocale();
  const source =
    row.remoteProjection?.sourceText ??
    row.currentProjection?.sourceText ??
    row.baseProjection?.sourceText ??
    t("task.sourceUnavailable");
  const currentTarget = row.currentProjection?.targetText ?? "";
  const remoteTarget = row.remoteProjection?.targetText ?? "";
  const selectable = row.safeToApply;
  return (
    <article
      className="task-package-row"
      role="listitem"
      data-disposition={row.disposition}
    >
      <div className="task-package-row-select">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggle(row, event.currentTarget.checked)}
          disabled={disabled || !selectable}
          aria-label={t("task.selectRow", {
            disposition: row.disposition,
            ordinal: row.ordinal + 1})}
        />
      </div>
      <div className="task-package-row-main">
        <header>
          <span className="task-package-disposition">
            {dispositionLabel(row.disposition)}
          </span>
          <code>{row.originSegmentId.slice(0, 12)}</code>
          <span>{t("task.rowNumber", { ordinal: row.ordinal + 1 })}</span>
          {row.identicalChange ? <em>{t("task.identicalEdit")}</em> : null}
        </header>
        <p className="task-package-source" title={source}>
          {source}
        </p>
        <div className="task-package-targets">
          <div>
            <span>{t("common.current")}</span>
            <p title={currentTarget}>{currentTarget || "Empty"}</p>
          </div>
          <div>
            <span>{t("common.returned")}</span>
            <p title={remoteTarget}>{remoteTarget || "Empty"}</p>
          </div>
        </div>
        <small>{row.reason}</small>
      </div>
    </article>
  );
}

function AssetSliceEditor({
  options,
  drafts,
  busy,
  onChange}: {
  options: AssetOption[];
  drafts: AssetDraft[];
  busy: boolean;
  onChange(value: AssetDraft[]): void;
}) {
  const { t } = useLocale();
  const add = () => {
    const first = options[0];
    if (!first) return;
    onChange([
      ...drafts,
      { kind: first.kind, libraryId: first.id, rowIds: "" },
    ]);
  };
  return (
    <div className="task-package-assets">
      <div className="task-package-subheading">
        <div>
          <span className="surface-kicker">{t("task.optionalSlices")}</span>
          <strong>{t("task.tmTermRows")}</strong>
        </div>
        <button
          className="button tertiary"
          type="button"
          onClick={add}
          disabled={busy || options.length === 0}
        >
          <Archive size={13} /> {t("task.addSlice")}
        </button>
      </div>
      {drafts.length === 0 ? (
        <p className="task-package-muted">{t("task.noAssetRows")}</p>
      ) : (
        drafts.map((draft, index) => {
          const matching = options.filter(
            (option) => option.kind === draft.kind,
          );
          return (
            <div
              className="task-package-asset-row"
              key={`${index}-${draft.libraryId}`}
            >
              <select
                value={draft.kind}
                onChange={(event) => {
                  const kind = event.currentTarget.value as AssetKind;
                  const nextOption = options.find(
                    (option) => option.kind === kind,
                  );
                  const next = [...drafts];
                  next[index] = {
                    ...draft,
                    kind,
                    libraryId: nextOption?.id ?? ""};
                  onChange(next);
                }}
                disabled={busy}
                aria-label={t("task.sliceKind", { index: index + 1 })}
              >
                <option value="tm">TM</option>
                <option value="termbase">{t("common.termbase")}</option>
              </select>
              <select
                value={draft.libraryId}
                onChange={(event) => {
                  const next = [...drafts];
                  next[index] = {
                    ...draft,
                    libraryId: event.currentTarget.value};
                  onChange(next);
                }}
                disabled={busy || matching.length === 0}
                aria-label={t("task.sliceLibrary", { index: index + 1 })}
              >
                {matching.length === 0 ? (
                  <option value="">{t("task.noMountedLibrary")}</option>
                ) : (
                  matching.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} · {option.sourceLocale}/
                      {option.targetLocale}
                    </option>
                  ))
                )}
              </select>
              <input
                value={draft.rowIds}
                onChange={(event) => {
                  const next = [...drafts];
                  next[index] = { ...draft, rowIds: event.currentTarget.value };
                  onChange(next);
                }}
                placeholder={t("task.explicitRowIds")}
                disabled={busy}
                aria-label={t("task.sliceRowIds", { index: index + 1 })}
              />
              <button
                className="icon-button danger"
                type="button"
                title={t("task.removeSlice")}
                aria-label={t("task.removeSliceN", { index: index + 1 })}
                onClick={() =>
                  onChange(drafts.filter((_, item) => item !== index))
                }
                disabled={busy}
              >
                <X size={14} />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

function ApplyDialog({
  count,
  busy,
  onCancel,
  onConfirm}: {
  count: number;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useLocale();
  return (
    <div className="surface-dialog-backdrop" role="presentation">
      <section
        className="surface-dialog confirm-dialog task-package-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-package-apply-title"
      >
        <header>
          <div>
            <span className="surface-kicker">
              {t("task.transactionalMerge")}
            </span>
            <h2 id="task-package-apply-title">{t("task.applySelected")}</h2>
          </div>
          <CheckCircle2 size={20} />
        </header>
        <p>{t("task.applyDialogBody", { count })}</p>
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
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? null : (
              <Check size={14} />
            )}
            {t("task.applyMerge")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function TaskPackageHeading({
  eyebrow,
  title,
  icon}: {
  eyebrow: string;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <header className="insights-section-heading">
      <div>
        <span className="surface-kicker">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {icon}
    </header>
  );
}

function TaskCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="task-package-count">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function dispositionLabel(disposition: TaskPackageDisposition): string {
  switch (disposition) {
    case "remoteChanged":
      return "Remote changed";
    case "localChanged":
      return "Local changed";
    case "bothChanged":
      return "Both changed";
    case "tagInvalid":
      return "Tag invalid";
    case "missingDependency":
      return "Missing dependency";
    default:
      return disposition[0]?.toLocaleUpperCase() + disposition.slice(1);
  }
}

function parseDelimitedIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 100_000);
}

function buildAssetSelections(
  drafts: AssetDraft[],
): TaskPackageAssetSelection[] {
  return drafts
    .map((draft) => ({
      kind: draft.kind,
      libraryId: draft.libraryId,
      rowIds: parseDelimitedIds(draft.rowIds)}))
    .filter((draft) => draft.libraryId && draft.rowIds.length > 0);
}

function assetOptionFromTm(library: TmLibrary): AssetOption {
  return {
    id: library.id,
    kind: "tm",
    name: library.name,
    sourceLocale: library.sourceLocale,
    targetLocale: library.targetLocale};
}

function assetOptionFromTermbase(
  termbase: Termbase,
  targetLocale: string,
): AssetOption {
  return {
    id: termbase.id,
    kind: "termbase",
    name: termbase.name,
    sourceLocale: termbase.sourceLocale,
    targetLocale};
}

function safeFileName(value: string): string {
  return value.trim().replaceAll(/[\\/:*?"<>|]/gu, "-") || "project";
}
