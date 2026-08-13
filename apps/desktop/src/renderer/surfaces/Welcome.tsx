import { FileArrowDown, FolderOpen, Plus } from "@phosphor-icons/react";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";

export interface WelcomeProps {
  onCreate: () => void;
  onOpenExample: () => void;
  disabled?: boolean;
  pendingExample?: boolean;
  error?: UiError | null;
}

/**
 * First run only. This surface is reachable exactly when the Engine reports
 * zero projects, so there is no recent-project list to show and inventing one
 * would be a lie. It states what the product accepts, offers the two real
 * actions, and stops.
 */

/** Kept in sync with supportedDocumentFilter in the Electron main process. */
const SUPPORTED_FORMATS = [
  "DOCX",
  "XLSX",
  "PPTX",
  "PDF",
  "TXT",
  "Markdown",
  "HTML",
  "XLIFF",
  "SDLXLIFF",
  "MQXLIFF",
] as const;

export function Welcome({
  onCreate,
  onOpenExample,
  disabled,
  pendingExample,
  error,
}: WelcomeProps) {
  const busy = Boolean(disabled || pendingExample);
  return (
    <section className="welcome" data-testid="welcome">
      <div className="welcome__inner welcome__inner--first-run">
        <div className="welcome__identity">
          <span className="welcome__mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
          <h1 className="welcome__title">Translunar</h1>
        </div>

        {error ? (
          <p className="error-text" role="alert">
            {formatUiError(error)}
          </p>
        ) : null}

        <div className="welcome__actions">
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={busy}
            onClick={onCreate}
          >
            <Plus size={18} weight="bold" aria-hidden="true" />
            Create project
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--lg"
            disabled={busy}
            onClick={onOpenExample}
            data-testid="open-example"
          >
            <FolderOpen size={18} weight="regular" aria-hidden="true" />
            {pendingExample ? "Opening example" : "Open example"}
          </button>
        </div>

        <div className="welcome__formats">
          <h2 className="welcome__section-title">
            <FileArrowDown size={14} weight="regular" aria-hidden="true" />
            Import formats
          </h2>
          <ul className="welcome__format-list">
            {SUPPORTED_FORMATS.map((format) => (
              <li key={format} className="chip">
                {format}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
