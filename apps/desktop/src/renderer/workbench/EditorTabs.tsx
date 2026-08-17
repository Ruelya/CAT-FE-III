import type { Document } from "@translunar/contracts";
import { Plus } from "@phosphor-icons/react";

import { shareStyle } from "../lib/dom";
import type { DocumentProgressMap } from "../state/use-document-progress";

export interface EditorTabsProps {
  documents: readonly Document[];
  activeDocumentId: string;
  progress: DocumentProgressMap;
  disabled?: boolean;
  onSelect: (documentId: string) => void;
  onAddFiles?: () => void;
}

/**
 * Open-document tabs above the grid, the same spatial habit as an IDE.
 *
 * File Nav remains the explorer. These tabs are the working set.
 */
export function EditorTabs({
  documents,
  activeDocumentId,
  progress,
  disabled,
  onSelect,
  onAddFiles,
}: EditorTabsProps) {
  if (documents.length === 0) return null;
  return (
    <div className="editor-tabs" data-testid="editor-tabs">
      <div
        className="editor-tabs__list"
        role="tablist"
        aria-label="Open documents"
      >
        {documents.map((doc) => {
          const active = doc.id === activeDocumentId;
          const counts = progress[doc.id];
          const total = counts?.total ?? doc.segmentCount;
          const confirmed = counts?.confirmed ?? 0;
          return (
            <button
              key={doc.id}
              type="button"
              role="tab"
              id={`editor-tab-${doc.id}`}
              aria-selected={active}
              aria-controls="editor-tabpanel"
              tabIndex={active ? 0 : -1}
              className={`editor-tabs__tab${active ? " editor-tabs__tab--active" : ""}`}
              data-testid={`editor-tab-${doc.id}`}
              disabled={disabled}
              title={`${doc.name} · ${confirmed} of ${total} confirmed`}
              onClick={() => {
                if (!active) onSelect(doc.id);
              }}
            >
              <span className="editor-tabs__name">{doc.name}</span>
              {total > 0 ? (
                <span
                  className="progress-bar editor-tabs__bar"
                  role="img"
                  aria-label={`${confirmed} of ${total} confirmed`}
                >
                  <span
                    className="progress-bar__segment progress-bar__segment--confirmed"
                    style={shareStyle(confirmed, total)}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {onAddFiles ? (
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Open another file"
          title="Open another file"
          data-testid="editor-tab-add"
          disabled={disabled}
          onClick={onAddFiles}
        >
          <Plus size={16} weight="bold" />
        </button>
      ) : null}
    </div>
  );
}
