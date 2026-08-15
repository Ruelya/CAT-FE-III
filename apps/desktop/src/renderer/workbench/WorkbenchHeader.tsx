import type { Document, SegmentCounts } from "@translunar/contracts";

import { shareStyle } from "../lib/dom";
import { DocumentSwitcher } from "./DocumentSwitcher";

export interface WorkbenchHeaderProps {
  documentName: string;
  projectName: string;
  documents: readonly Document[];
  activeDocumentId: string;
  counts: SegmentCounts | null | undefined;
  headerBusy: boolean;
  switchPending?: boolean;
  addFilesPending?: boolean;
  pretranslatePending?: boolean;
  pendingConfirm?: boolean;
  previewOpen: boolean;
  autocomplete: boolean | null;
  onPreviewOpenChange: (open: boolean) => void;
  onAutocompleteChange?: (next: boolean) => void;
  onSelectDocument: (documentId: string) => void;
  onAddFiles: () => void;
  onPretranslate: () => void;
  onQa: () => void;
  onExport: () => void;
}

export function formatDocumentProgress(counts: SegmentCounts): string {
  return `${counts.confirmed} of ${counts.total} confirmed`;
}

/**
 * Home-like instrument strip for the open file.
 *
 * File lifecycle lives in the title-bar File menu. This bar answers four
 * questions only: which file, how far, how the editor behaves, what the
 * job does next.
 */
export function WorkbenchHeader({
  documentName,
  projectName,
  documents,
  activeDocumentId,
  counts,
  headerBusy,
  switchPending,
  addFilesPending,
  pretranslatePending,
  pendingConfirm,
  previewOpen,
  autocomplete,
  onPreviewOpenChange,
  onAutocompleteChange,
  onSelectDocument,
  onAddFiles,
  onPretranslate,
  onQa,
  onExport,
}: WorkbenchHeaderProps) {
  const progressTitle = counts
    ? `${counts.confirmed} confirmed, ${counts.draft} draft, ${counts.untranslated} open`
    : undefined;

  return (
    <header className="workbench-header" data-testid="workbench-header">
      <h1 className="sr-only">{documentName}</h1>

      <section className="workbench-header__cluster" aria-label="File">
        <p className="workbench-header__label">File</p>
        <div className="workbench-header__cluster-body">
          <DocumentSwitcher
            documents={documents}
            activeDocumentId={activeDocumentId}
            disabled={headerBusy}
            pending={switchPending === true}
            variant="title"
            onSelect={onSelectDocument}
          />
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            disabled={headerBusy}
            onClick={onAddFiles}
            data-testid="add-files"
          >
            {addFilesPending ? "Importing" : "Add files"}
          </button>
        </div>
      </section>

      <section className="workbench-header__cluster" aria-label="Progress">
        <p className="workbench-header__label">Progress</p>
        <div className="workbench-header__cluster-body">
          {counts && counts.total > 0 ? (
            <>
              <span
                className="progress-bar workbench-header__bar"
                role="img"
                aria-label={formatDocumentProgress(counts)}
                title={progressTitle}
              >
                <span
                  className="progress-bar__segment progress-bar__segment--confirmed"
                  style={shareStyle(counts.confirmed, counts.total)}
                />
                <span
                  className="progress-bar__segment progress-bar__segment--draft"
                  style={shareStyle(counts.draft, counts.total)}
                />
                <span
                  className="progress-bar__segment progress-bar__segment--open"
                  style={shareStyle(counts.untranslated, counts.total)}
                />
              </span>
              <p className="workbench-header__progress-copy" title={progressTitle}>
                <span className="workbench-header__progress-figure">
                  {counts.confirmed}
                </span>
                {` of ${counts.total} confirmed`}
                {counts.draft > 0 ? ` · ${counts.draft} draft` : ""}
              </p>
            </>
          ) : (
            <p className="workbench-header__progress-copy">{projectName}</p>
          )}
          {pendingConfirm ? (
            <span className="inline-status" role="status">
              Confirming
            </span>
          ) : null}
        </div>
      </section>

      <section className="workbench-header__cluster" aria-label="View">
        <p className="workbench-header__label">View</p>
        <div className="workbench-header__cluster-body" role="group" aria-label="Editor view">
          <button
            type="button"
            className="btn btn--ghost btn--sm workbench-header__toggle"
            disabled={headerBusy}
            aria-pressed={previewOpen}
            onClick={() => onPreviewOpenChange(!previewOpen)}
            data-testid="toggle-preview"
            title="Formatted preview under the grid"
          >
            Preview
          </button>
          {autocomplete !== null && onAutocompleteChange ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm workbench-header__toggle"
              disabled={headerBusy}
              aria-pressed={autocomplete}
              onClick={() => onAutocompleteChange(!autocomplete)}
              data-testid="toggle-autosuggest"
              title="Show term, memory, and AI suffixes while typing"
            >
              AutoSuggest
            </button>
          ) : null}
        </div>
      </section>

      <section className="workbench-header__cluster workbench-header__cluster--job" aria-label="Job">
        <p className="workbench-header__label">Job</p>
        <div className="workbench-header__cluster-body" role="group" aria-label="Job actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={headerBusy || pretranslatePending === true}
            onClick={onPretranslate}
            data-testid="pretranslate"
            title="Fill empty targets from translation memory (Ctrl+Shift+P)"
          >
            {pretranslatePending ? "Pretranslating" : "Pretranslate"}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={headerBusy}
            onClick={onQa}
            data-testid="workbench-qa"
          >
            QA
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={headerBusy}
            onClick={onExport}
            data-testid="workbench-export"
          >
            Export
          </button>
        </div>
      </section>
    </header>
  );
}
