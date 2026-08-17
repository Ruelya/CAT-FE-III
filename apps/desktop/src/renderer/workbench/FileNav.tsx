import type { Document, SegmentCounts } from "@translunar/contracts";

import { shareStyle } from "../lib/dom";
import type { DocumentProgressMap } from "../state/use-document-progress";

export interface FileNavProps {
  documents: readonly Document[];
  activeDocumentId: string;
  progress: DocumentProgressMap;
  disabled?: boolean;
  pending?: boolean;
  onSelect: (documentId: string) => void;
}

function remaining(counts: SegmentCounts | undefined, fallback: number): number {
  if (!counts) return fallback;
  return Math.max(0, counts.total - counts.confirmed);
}

export function FileNav({
  documents,
  activeDocumentId,
  progress,
  disabled,
  pending,
  onSelect,
}: FileNavProps) {
  const busy = Boolean(disabled || pending);
  const jobTotal = documents.reduce((sum, doc) => {
    const counts = progress[doc.id];
    return sum + (counts?.total ?? doc.segmentCount);
  }, 0);
  const jobOpen = documents.reduce((sum, doc) => {
    return sum + remaining(progress[doc.id], doc.segmentCount);
  }, 0);

  return (
    <nav className="file-nav" data-testid="file-nav" aria-label="Files in this job">
      <div className="file-nav__head">
        <h2 className="file-nav__title">Files</h2>
        <p className="file-nav__job" data-testid="file-nav-job">
          {documents.length} · {jobOpen} open
          {jobTotal > 0 ? ` / ${jobTotal}` : ""}
        </p>
      </div>
      <ul className="file-nav__list">
        {documents.map((doc) => {
          const counts = progress[doc.id];
          const total = counts?.total ?? doc.segmentCount;
          const confirmed = counts?.confirmed ?? 0;
          const open = remaining(counts, doc.segmentCount);
          const active = doc.id === activeDocumentId;
          return (
            <li key={doc.id}>
              <button
                type="button"
                className={`file-nav__item${active ? " file-nav__item--active" : ""}`}
                data-testid={`file-nav-item-${doc.id}`}
                aria-current={active ? "true" : undefined}
                disabled={busy}
                title={`${doc.name} · ${confirmed} of ${total} confirmed`}
                onClick={() => {
                  if (!active) onSelect(doc.id);
                }}
              >
                <span className="file-nav__name">{doc.name}</span>
                <span className="file-nav__meta">
                  <span className="file-nav__remain">{open}</span>
                  {total > 0 ? (
                    <span
                      className="progress-bar file-nav__bar"
                      role="img"
                      aria-label={`${confirmed} of ${total} confirmed`}
                    >
                      <span
                        className="progress-bar__segment progress-bar__segment--confirmed"
                        // data-geometry: Engine count proportion.
                        style={shareStyle(confirmed, total)}
                      />
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {pending ? (
        <p className="inline-status" role="status">
          Switching
        </p>
      ) : null}
    </nav>
  );
}
