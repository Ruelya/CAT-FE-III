import type { Document } from "@translunar/contracts";

export interface DocumentSwitcherProps {
  documents: readonly Document[];
  activeDocumentId: string;
  disabled?: boolean;
  pending?: boolean;
  onSelect: (documentId: string) => void;
  onRecycle?: () => void;
}

export function DocumentSwitcher({
  documents,
  activeDocumentId,
  disabled,
  pending,
  onSelect,
  onRecycle,
}: DocumentSwitcherProps) {
  const busy = Boolean(disabled || pending);
  return (
    <div className="document-switcher" data-testid="document-switcher">
      <label className="field__label" htmlFor="document-switcher-select">
        Document
      </label>
      <div className="document-switcher__row">
        <select
          id="document-switcher-select"
          data-testid="document-switcher-select"
          className="field__control"
          value={activeDocumentId}
          disabled={busy || documents.length === 0}
          aria-busy={pending ? true : undefined}
          onChange={(e) => {
            const next = e.target.value;
            if (next && next !== activeDocumentId) {
              onSelect(next);
            }
          }}
        >
          {documents.map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.name}
            </option>
          ))}
        </select>
        {onRecycle ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy}
            onClick={onRecycle}
            aria-label="Recycle document"
            title="Recycle document"
          >
            Recycle
          </button>
        ) : null}
      </div>
      {pending ? (
        <span className="inline-status" role="status">
          Switching
        </span>
      ) : null}
    </div>
  );
}
