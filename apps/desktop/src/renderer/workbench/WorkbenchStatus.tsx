import type { Document, SegmentCounts } from "@translunar/contracts";

import { shareStyle } from "../lib/dom";
import { countWords } from "../lib/word-count";
import { DocumentSwitcher } from "./DocumentSwitcher";

export interface WorkbenchStatusProps {
  documentName: string;
  documents: readonly Document[];
  activeDocumentId: string;
  sourceLocale: string;
  targetLocale: string;
  segmentLabel: string;
  counts: SegmentCounts | null | undefined;
  wordCount: number;
  tmLabel?: string;
  filterLabel?: string;
  saveState?: "scheduled" | "saving" | "error";
  headerBusy: boolean;
  switchPending?: boolean;
  pretranslatePending?: boolean;
  pendingConfirm?: boolean;
  autocomplete: boolean | null;
  previewOpen?: boolean;
  onSelectDocument: (documentId: string) => void;
  onTogglePreview?: () => void;
  onPretranslate: () => void;
  onAutocompleteChange?: (next: boolean) => void;
}

export function formatDocumentProgress(counts: SegmentCounts): string {
  return `${counts.confirmed} of ${counts.total} confirmed`;
}

/**
 * Trados-style status line: progress and low-frequency job actions live here
 * so they do not steal a second instrument strip above the grid.
 */
export function WorkbenchStatus({
  documentName,
  documents,
  activeDocumentId,
  sourceLocale,
  targetLocale,
  segmentLabel,
  counts,
  wordCount,
  tmLabel,
  filterLabel,
  saveState,
  headerBusy,
  switchPending,
  pretranslatePending,
  pendingConfirm,
  autocomplete,
  previewOpen,
  onSelectDocument,
  onTogglePreview,
  onPretranslate,
  onAutocompleteChange,
}: WorkbenchStatusProps) {
  const progressTitle = counts
    ? `${counts.confirmed} confirmed, ${counts.draft} draft, ${counts.untranslated} open`
    : undefined;

  return (
    <footer className="workbench__status" data-testid="workbench-status">
      <h1 className="sr-only">{documentName}</h1>
      <DocumentSwitcher
        documents={documents}
        activeDocumentId={activeDocumentId}
        disabled={headerBusy}
        pending={switchPending === true}
        variant="title"
        onSelect={onSelectDocument}
      />
      <span data-testid="status-locales">
        {sourceLocale} → {targetLocale}
      </span>
      <span data-testid="status-segment">{segmentLabel}</span>
      {counts && counts.total > 0 ? (
        <span
          className="progress-bar workbench__status-bar"
          role="img"
          aria-label={formatDocumentProgress(counts)}
          title={progressTitle}
        >
          <span
            className="progress-bar__segment progress-bar__segment--confirmed"
            data-geometry="segment width is the confirmed share"
            style={shareStyle(counts.confirmed, counts.total)}
          />
          <span
            className="progress-bar__segment progress-bar__segment--draft"
            data-geometry="segment width is the draft share"
            style={shareStyle(counts.draft, counts.total)}
          />
          <span
            className="progress-bar__segment progress-bar__segment--open"
            data-geometry="segment width is the untranslated share"
            style={shareStyle(counts.untranslated, counts.total)}
          />
        </span>
      ) : null}
      {counts ? (
        <span data-testid="status-counts">
          {counts.confirmed} confirmed · {counts.draft} draft · {counts.untranslated} empty
        </span>
      ) : null}
      <span data-testid="status-words">{wordCount} words</span>
      {tmLabel ? <span data-testid="status-tm">TM {tmLabel}</span> : null}
      {filterLabel ? (
        <span data-testid="status-filter">{filterLabel}</span>
      ) : null}
      {saveState === "saving" || saveState === "scheduled" ? (
        <span className="inline-status" role="status" data-testid="status-save">
          Saving
        </span>
      ) : null}
      {pendingConfirm ? (
        <span className="inline-status" role="status">
          Confirming
        </span>
      ) : null}
      {pretranslatePending ? (
        <span className="inline-status" role="status">
          Pretranslating
        </span>
      ) : null}

      <div className="workbench__status-actions">
        {onTogglePreview ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={headerBusy}
            aria-pressed={previewOpen === true}
            onClick={onTogglePreview}
            data-testid="status-preview"
            title={previewOpen ? "Hide preview" : "Show preview"}
          >
            Preview
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={headerBusy || pretranslatePending === true}
          onClick={onPretranslate}
          data-testid="pretranslate"
          title="Fill empty targets from translation memory (Ctrl+Shift+P)"
        >
          {pretranslatePending ? "Pretranslating" : "Pretranslate"}
        </button>
        {autocomplete !== null && onAutocompleteChange ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm workbench__status-toggle"
            disabled={headerBusy}
            aria-pressed={autocomplete}
            onClick={() => onAutocompleteChange(!autocomplete)}
            data-testid="toggle-autosuggest"
            title="Show term, memory, and AI suffixes while typing"
          >
            AutoSuggest
          </button>
        ) : null}
        <span
          className="workbench__status-hint"
          title="Ctrl+Enter confirm · Ctrl+S save · Ctrl+G go to · Ctrl+Alt+T translation · Ctrl+Alt+R review · Ctrl+L sign off · Ctrl+, place tags · Ctrl+Shift+P pretranslate · F3 concordance · Ctrl+1..9 apply match"
        >
          Shortcuts
        </span>
      </div>
    </footer>
  );
}

export { countWords };
