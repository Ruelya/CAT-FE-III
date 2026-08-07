import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode} from "react";
import type {
  BilingualTableFormat,
  Document,
  ProjectSnapshot,
  ReviewPreviewResult,
  ReviewPreviewRow,
  TablePreviewResult,
  TablePreviewRow,
  TmLibrary} from "@translunar/contracts";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCheck2,
  FolderOpen,
  Languages,
  Table2,
  Upload} from "lucide-react";

import { fileName, formatError } from "./workbench-utils";
import { useLocale } from "./i18n/LocaleProvider";

type InteropMode = "review" | "table";

interface InteropPanelProps {
  snapshot: ProjectSnapshot;
  document: Document;
  onRefresh(): Promise<void>;
}

export function InteropPanel({
  snapshot,
  document,
  onRefresh}: InteropPanelProps) {
  const { t } = useLocale();

  const [mode, setMode] = useState<InteropMode>("review");
  const [tableFormat, setTableFormat] = useState<BilingualTableFormat>("xlsx");
  const [inputPath, setInputPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [reviewPreview, setReviewPreview] =
    useState<ReviewPreviewResult | null>(null);
  const [tablePreview, setTablePreview] = useState<TablePreviewResult | null>(
    null,
  );
  const [libraries, setLibraries] = useState<TmLibrary[]>([]);
  const [libraryId, setLibraryId] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(
    () => new Set(),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actor, setActor] = useState("desktop-user");
  const [reason, setReason] = useState("Interop review import");

  const selectedLibrary = useMemo(
    () => libraries.find((library) => library.id === libraryId),
    [libraries, libraryId],
  );

  const loadLibraries = useCallback(async () => {
    try {
      const page = await window.translunar.invoke("tm.library.list", {
        projectId: snapshot.project.id,
        offset: 0,
        limit: 50});
      const writable = page.items.filter(
        (library) =>
          library.writable &&
          library.sourceLocale === snapshot.project.sourceLocale &&
          library.targetLocale === snapshot.project.targetLocale,
      );
      setLibraries(writable);
      setLibraryId((current) =>
        writable.some((library) => library.id === current)
          ? current
          : (writable[0]?.id ?? ""),
      );
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    }
  }, [
    snapshot.project.id,
    snapshot.project.sourceLocale,
    snapshot.project.targetLocale,
  ]);

  useEffect(() => {
    void loadLibraries();
  }, [loadLibraries]);

  useEffect(() => {
    setInputPath("");
    setOutputPath("");
    setReviewPreview(null);
    setTablePreview(null);
    setSelectedRows(new Set());
    setError(null);
    setNotice(null);
    setReason(
      mode === "review"
        ? t("interop.reviewImportReason")
        : t("interop.tableImportReason"),
    );
  }, [mode, t]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(null);
    }
  };

  const chooseInput = async () => {
    await run("choose-input", async () => {
      const path = await window.translunar.selectInteropInput(mode);
      if (!path) return;
      setInputPath(path);
      setReviewPreview(null);
      setTablePreview(null);
      setSelectedRows(new Set());
    });
  };

  const chooseOutput = async () => {
    await run("choose-output", async () => {
      const suggested = `${safeName(document.name)}-review.docx`;
      const path = await window.translunar.selectExportPath(suggested);
      if (path) setOutputPath(path);
    });
  };

  const exportReview = async () => {
    if (!outputPath) return;
    await run("export-review", async () => {
      const result = await window.translunar.invoke("interop.review.export", {
        projectId: snapshot.project.id,
        documentId: document.id,
        expectedDocumentRevision: document.revision,
        outputPath});
      setNotice(t("interop.reviewExported", { count: result.rowCount }));
    });
  };

  const previewReview = async () => {
    if (!inputPath) return;
    await run("preview-review", async () => {
      const result = await window.translunar.invoke("interop.review.preview", {
        projectId: snapshot.project.id,
        documentId: document.id,
        inputPath,
        expectedDocumentRevision: document.revision,
        offset: 0,
        limit: 50});
      setReviewPreview(result);
      setTablePreview(null);
      setSelectedRows(
        new Set(
          result.rows
            .filter((row) => row.disposition === "changed")
            .map((row) => row.rowId),
        ),
      );
      setNotice(t("interop.reviewPreviewReady", { count: result.total }));
    });
  };

  const previewTable = async () => {
    if (!inputPath || !selectedLibrary) return;
    await run("preview-table", async () => {
      const result = await window.translunar.invoke("interop.table.preview", {
        projectId: snapshot.project.id,
        libraryId: selectedLibrary.id,
        sourceLocale: selectedLibrary.sourceLocale,
        targetLocale: selectedLibrary.targetLocale,
        expectedLibraryRevision: selectedLibrary.revision,
        inputPath,
        format: tableFormat,
        offset: 0,
        limit: 50});
      setTablePreview(result);
      setReviewPreview(null);
      setSelectedRows(
        new Set(
          result.rows
            .filter((row) => row.disposition === "valid")
            .map((row) => row.rowId),
        ),
      );
      setNotice(t("interop.tablePreviewReady", { count: result.total }));
    });
  };

  const loadReviewPage = async (offset: number) => {
    if (!reviewPreview) return;
    await run("page-review", async () => {
      const result = await window.translunar.invoke("interop.review.preview", {
        projectId: snapshot.project.id,
        documentId: document.id,
        previewId: reviewPreview.previewId,
        expectedDocumentRevision: reviewPreview.expectedDocumentRevision,
        offset,
        limit: reviewPreview.limit});
      setReviewPreview(result);
    });
  };

  const loadTablePage = async (offset: number) => {
    if (!tablePreview) return;
    await run("page-table", async () => {
      const result = await window.translunar.invoke("interop.table.preview", {
        projectId: snapshot.project.id,
        libraryId: tablePreview.libraryId,
        sourceLocale: tablePreview.sourceLocale,
        targetLocale: tablePreview.targetLocale,
        expectedLibraryRevision: tablePreview.expectedLibraryRevision,
        previewId: tablePreview.previewId,
        format: tableFormat,
        offset,
        limit: tablePreview.limit});
      setTablePreview(result);
    });
  };

  const toggleRow = (rowId: string, enabled: boolean) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (enabled) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  };

  const applyReview = async () => {
    if (!reviewPreview || selectedRows.size === 0) return;
    await run("apply-review", async () => {
      const result = await window.translunar.invoke("interop.review.apply", {
        previewId: reviewPreview.previewId,
        expectedDocumentRevision: reviewPreview.expectedDocumentRevision,
        selectedRowIds: [...selectedRows],
        actor: actor.trim(),
        reason: reason.trim()});
      setReviewPreview((current) =>
        current ? { ...current, status: result.status } : current,
      );
      setSelectedRows(new Set());
      await onRefresh();
      setNotice(t("interop.appliedReview", { count: result.appliedCount }));
    });
  };

  const applyTable = async () => {
    if (!tablePreview || selectedRows.size === 0) return;
    await run("apply-table", async () => {
      const result = await window.translunar.invoke("interop.table.apply", {
        previewId: tablePreview.previewId,
        expectedLibraryRevision: tablePreview.expectedLibraryRevision,
        selectedRowIds: [...selectedRows],
        actor: actor.trim(),
        reason: reason.trim()});
      setTablePreview((current) =>
        current ? { ...current, status: result.status } : current,
      );
      setSelectedRows(new Set());
      await loadLibraries();
      setNotice(t("interop.tableImported", { count: result.appliedCount }));
    });
  };

  const currentPreview = mode === "review" ? reviewPreview : tablePreview;
  const currentOffset = currentPreview?.offset ?? 0;
  const currentLimit = currentPreview?.limit ?? 50;
  const currentTotal = currentPreview?.total ?? 0;
  const canPrevious = currentOffset > 0;
  const canNext = currentOffset + currentLimit < currentTotal;
  const isApplied = currentPreview?.status === "applied";

  return (
    <div className="interop-layout">
      <section className="insights-section interop-controls">
        <div
          className="interop-mode-tabs"
          role="tablist"
          aria-label={t("interop.modeAria")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "review"}
            onClick={() => setMode("review")}
          >
            <FileCheck2 size={15} /> {t("interop.reviewDocxTab")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "table"}
            onClick={() => setMode("table")}
          >
            <Table2 size={15} /> {t("interop.tableToTmTab")}
          </button>
        </div>

        <div className="interop-control-grid">
          {mode === "table" ? (
            <label className="interop-field">
              <span>{t("interop.tableFormat")}</span>
              <select
                value={tableFormat}
                onChange={(event) => {
                  setTableFormat(
                    event.currentTarget.value as BilingualTableFormat,
                  );
                  setInputPath("");
                  setTablePreview(null);
                  setSelectedRows(new Set());
                }}
                disabled={!!busy}
              >
                <option value="xlsx">XLSX</option>
                <option value="docx">DOCX</option>
              </select>
            </label>
          ) : (
            <div className="interop-field interop-field-note">
              <span>{t("interop.package")}</span>
              <strong>{t("interop.signedReview")}</strong>
            </div>
          )}
          {mode === "table" ? (
            <label className="interop-field">
              <span>{t("interop.writableTm")}</span>
              <select
                value={libraryId}
                onChange={(event) => {
                  setLibraryId(event.currentTarget.value);
                  setTablePreview(null);
                  setSelectedRows(new Set());
                }}
                disabled={!!busy || libraries.length === 0}
              >
                {libraries.length === 0 ? (
                  <option value="">{t("interop.noWritableLibrary")}</option>
                ) : (
                  libraries.map((library) => (
                    <option key={library.id} value={library.id}>
                      {library.name} · rev {library.revision}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : (
            <div className="interop-field interop-field-note">
              <span>{t("interop.documentRevision")}</span>
              <strong>{document.revision}</strong>
            </div>
          )}
        </div>

        <div className="interop-path-row">
          <button
            className="button secondary"
            type="button"
            onClick={() => void chooseInput()}
            disabled={!!busy}
          >
            <FolderOpen size={14} />{" "}
            {mode === "review"
              ? t("interop.selectReviewInput")
              : t("interop.selectTableInput")}
          </button>
          <span className="interop-path" title={inputPath}>
            {inputPath ? fileName(inputPath) : t("interop.noInputSelected")}
          </span>
          <button
            className="button primary"
            type="button"
            onClick={() =>
              void (mode === "review" ? previewReview() : previewTable())
            }
            disabled={
              !!busy || !inputPath || (mode === "table" && !selectedLibrary)
            }
          >
            <Languages size={14} /> {t("interop.preview")}
          </button>
        </div>

        {mode === "review" ? (
          <div className="interop-path-row interop-export-row">
            <button
              className="button secondary"
              type="button"
              onClick={() => void chooseOutput()}
              disabled={!!busy}
            >
              <Download size={14} /> {t("interop.exportDestination")}
            </button>
            <span className="interop-path" title={outputPath}>
              {outputPath ? fileName(outputPath) : "No destination selected"}
            </span>
            <button
              className="button primary"
              type="button"
              onClick={() => void exportReview()}
              disabled={!!busy || !outputPath}
            >
              <Upload size={14} />
              {t("export.title")}
            </button>
          </div>
        ) : null}

        <div className="interop-audit-fields">
          <label className="interop-field">
            <span>{t("common.actor")}</span>
            <input
              value={actor}
              onChange={(event) => setActor(event.currentTarget.value)}
              maxLength={128}
              disabled={!!busy}
            />
          </label>
          <label className="interop-field interop-reason-field">
            <span>{t("interop.applyReason")}</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              maxLength={512}
              disabled={!!busy}
            />
          </label>
        </div>
      </section>

      {error ? (
        <p className="surface-error interop-feedback" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
      {notice ? (
        <p className="surface-success interop-feedback" role="status">
          <CheckCircle2 size={14} /> {notice}
        </p>
      ) : null}

      {busy ? (
        <div className="interop-loading" role="status">
          {" "}
          {t("common.workingOn", { task: busy.replaceAll("-", " ") })}
        </div>
      ) : null}

      {mode === "review" && reviewPreview ? (
        <ReviewPreviewPanel
          preview={reviewPreview}
          selectedRows={selectedRows}
          busy={!!busy}
          isApplied={isApplied}
          canPrevious={canPrevious}
          canNext={canNext}
          onToggle={toggleRow}
          onApply={() => void applyReview()}
          onPrevious={() => void loadReviewPage(currentOffset - currentLimit)}
          onNext={() => void loadReviewPage(currentOffset + currentLimit)}
        />
      ) : mode === "table" && tablePreview ? (
        <TablePreviewPanel
          preview={tablePreview}
          selectedRows={selectedRows}
          busy={!!busy}
          isApplied={isApplied}
          canPrevious={canPrevious}
          canNext={canNext}
          onToggle={toggleRow}
          onApply={() => void applyTable()}
          onPrevious={() => void loadTablePage(currentOffset - currentLimit)}
          onNext={() => void loadTablePage(currentOffset + currentLimit)}
        />
      ) : !busy ? (
        <section className="insights-section interop-empty" aria-live="polite">
          <Languages size={24} />
          <strong>
            {mode === "review"
              ? t("interop.reviewPreviewEmpty")
              : t("interop.tablePreviewEmpty")}
          </strong>
          <span>{t("interop.selectAndPreview")}</span>
        </section>
      ) : null}
    </div>
  );
}

function ReviewPreviewPanel({
  preview,
  selectedRows,
  busy,
  isApplied,
  canPrevious,
  canNext,
  onToggle,
  onApply,
  onPrevious,
  onNext}: {
  preview: ReviewPreviewResult;
  selectedRows: Set<string>;
  busy: boolean;
  isApplied: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onToggle(rowId: string, enabled: boolean): void;
  onApply(): void;
  onPrevious(): void;
  onNext(): void;
}) {
  const { t } = useLocale();
  return (
    <section
      className="insights-section interop-preview"
      aria-label={t("interop.reviewPreviewAria")}
    >
      <PreviewHeading
        icon={<FileCheck2 size={18} />}
        eyebrow={`${t("interop.preview")} ${preview.previewId.slice(0, 8)} · ${preview.inputFormat}`}
        title={t("interop.reviewRowCount", { count: preview.total })}
        status={preview.status}
        selectedCount={selectedRows.size}
        busy={busy}
        isApplied={isApplied}
        onApply={onApply}
      />
      <div className="interop-row interop-row-header" aria-hidden="true">
        <span />
        <span>{t("common.status")}</span>
        <span>{t("common.source")}</span>
        <span>{t("interop.returnedTarget")}</span>
        <span>{t("common.diagnostics")}</span>
      </div>
      <div className="interop-rows">
        {preview.rows.map((row) => (
          <ReviewRow
            key={row.rowId}
            row={row}
            selected={selectedRows.has(row.rowId)}
            disabled={row.disposition !== "changed" || busy || isApplied}
            onToggle={onToggle}
          />
        ))}
      </div>
      <Pagination
        offset={preview.offset}
        limit={preview.limit}
        total={preview.total}
        canPrevious={canPrevious}
        canNext={canNext}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    </section>
  );
}

function TablePreviewPanel({
  preview,
  selectedRows,
  busy,
  isApplied,
  canPrevious,
  canNext,
  onToggle,
  onApply,
  onPrevious,
  onNext}: {
  preview: TablePreviewResult;
  selectedRows: Set<string>;
  busy: boolean;
  isApplied: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onToggle(rowId: string, enabled: boolean): void;
  onApply(): void;
  onPrevious(): void;
  onNext(): void;
}) {
  const { t } = useLocale();
  return (
    <section
      className="insights-section interop-preview"
      aria-label={t("interop.tablePreviewAria")}
    >
      <PreviewHeading
        icon={<Table2 size={18} />}
        eyebrow={`${t("interop.preview")} ${preview.previewId.slice(0, 8)} · ${preview.inputFormat}`}
        title={t("interop.tableRowCount", { count: preview.total })}
        status={preview.status}
        selectedCount={selectedRows.size}
        busy={busy}
        isApplied={isApplied}
        onApply={onApply}
      />
      <div className="interop-row interop-row-header" aria-hidden="true">
        <span />
        <span>{t("common.disposition")}</span>
        <span>{t("interop.sourceTarget")}</span>
        <span>{t("interop.structuralPath")}</span>
        <span>{t("interop.diagnosticsMeta")}</span>
      </div>
      <div className="interop-rows">
        {preview.rows.map((row) => (
          <TableRow
            key={row.rowId}
            row={row}
            selected={selectedRows.has(row.rowId)}
            disabled={row.disposition !== "valid" || busy || isApplied}
            onToggle={onToggle}
          />
        ))}
      </div>
      <Pagination
        offset={preview.offset}
        limit={preview.limit}
        total={preview.total}
        canPrevious={canPrevious}
        canNext={canNext}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    </section>
  );
}

function PreviewHeading({
  icon,
  eyebrow,
  title,
  status,
  selectedCount,
  busy,
  isApplied,
  onApply}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  status: string;
  selectedCount: number;
  busy: boolean;
  isApplied: boolean;
  onApply(): void;
}) {
  const { t } = useLocale();
  return (
    <div className="insights-section-heading interop-preview-heading">
      <div className="interop-preview-title">
        <span aria-hidden="true">{icon}</span>
        <div>
          <span className="surface-kicker">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="insights-section-actions">
        <span className="interop-status" data-status={status}>
          {status}
        </span>
        <button
          className="button primary"
          type="button"
          onClick={onApply}
          disabled={busy || isApplied || selectedCount === 0}
        >
          <Check size={14} />{" "}
          {isApplied
            ? t("interop.applied")
            : t("interop.applyCount", { count: selectedCount })}
        </button>
      </div>
    </div>
  );
}

function ReviewRow({
  row,
  selected,
  disabled,
  onToggle}: {
  row: ReviewPreviewRow;
  selected: boolean;
  disabled: boolean;
  onToggle(rowId: string, enabled: boolean): void;
}) {
  const { t } = useLocale();
  return (
    <article className="interop-row" data-disposition={row.disposition}>
      <label className="interop-row-select">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={(event) => onToggle(row.rowId, event.currentTarget.checked)}
          aria-label={t("interop.selectReviewRow", { row: row.ordinal + 1 })}
        />
      </label>
      <div className="interop-cell">
        <span
          className="interop-disposition"
          data-disposition={row.disposition}
        >
          {row.disposition}
        </span>
        <small>{t("interop.row", { row: row.ordinal + 1 })}</small>
        <small>{row.statusContext || t("interop.noStatus")}</small>
      </div>
      <div className="interop-cell interop-source-cell">
        <strong>{row.sourceText || t("interop.emptySource")}</strong>
        <small>
          {t("interop.currentTarget", {
            value: row.currentTarget || t("interop.noTarget")})}
        </small>
      </div>
      <div className="interop-cell">
        <strong>{row.targetText || t("interop.unchangedTarget")}</strong>
        <small>
          {t("interop.comment", {
            value: row.comments || t("interop.noComment")})}
        </small>
      </div>
      <DiagnosticCell diagnostics={row.diagnostics} />
    </article>
  );
}

function TableRow({
  row,
  selected,
  disabled,
  onToggle}: {
  row: TablePreviewRow;
  selected: boolean;
  disabled: boolean;
  onToggle(rowId: string, enabled: boolean): void;
}) {
  const { t } = useLocale();
  const metadata = Object.entries(row.metadata);
  return (
    <article className="interop-row" data-disposition={row.disposition}>
      <label className="interop-row-select">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={(event) => onToggle(row.rowId, event.currentTarget.checked)}
          aria-label={t("interop.selectTableRow", { row: row.sourceRow })}
        />
      </label>
      <div className="interop-cell">
        <span
          className="interop-disposition"
          data-disposition={row.disposition}
        >
          {row.disposition}
        </span>
        <small>{t("interop.inputRow", { row: row.sourceRow })}</small>
      </div>
      <div className="interop-cell interop-source-cell">
        <strong>{row.sourceText || t("interop.missingSource")}</strong>
        <small>{row.targetText || t("interop.missingTarget")}</small>
      </div>
      <div className="interop-cell">
        <code>{row.structuralPath}</code>
        <small>{row.rowId.slice(0, 12)}</small>
      </div>
      <DiagnosticCell
        diagnostics={[
          ...row.diagnostics,
          ...metadata.map(([key, value]) => `${key}: ${value}`),
        ]}
      />
    </article>
  );
}

function DiagnosticCell({ diagnostics }: { diagnostics: string[] }) {
  const { t } = useLocale();
  return (
    <div className="interop-cell interop-diagnostics">
      {diagnostics.length ? (
        diagnostics.map((diagnostic) => (
          <span key={diagnostic}>{diagnostic}</span>
        ))
      ) : (
        <span className="interop-clean">
          <CheckCircle2 size={13} />
          {t("status.ready")}
        </span>
      )}
    </div>
  );
}

function Pagination({
  offset,
  limit,
  total,
  canPrevious,
  canNext,
  onPrevious,
  onNext}: {
  offset: number;
  limit: number;
  total: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious(): void;
  onNext(): void;
}) {
  const { t } = useLocale();
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  return (
    <footer className="interop-pagination">
      <span>{t("common.pageRange", { start, end, total })}</span>
      <div>
        <button
          className="icon-button"
          type="button"
          title={t("interop.prevPage")}
          aria-label={t("interop.prevPage")}
          onClick={onPrevious}
          disabled={!canPrevious}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          title={t("interop.nextPage")}
          aria-label={t("interop.nextPage")}
          onClick={onNext}
          disabled={!canNext}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </footer>
  );
}

function safeName(value: string): string {
  return value.replaceAll(/[\\/:*?"<>|]/gu, "-").replace(/\.[^.]+$/u, "");
}
