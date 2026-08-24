import { useState } from "react";
import { FileArrowDown } from "@phosphor-icons/react";
import type {
  ProjectBatchImportResult,
  TemplateDependencyDiagnostic,
} from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { formatUiError } from "../lib/errors";
import {
  readPdfImportOptions,
  writePdfImportOptions,
  type PdfImportOptions,
  type PdfOcrEngine,
  type PdfOcrMode,
} from "../lib/pdf-import-options";
import { JobWizardSteps } from "../shell/JobWizardSteps";
import { BatchImportSummary } from "../workbench/BatchImportSummary";

export interface ImportDocumentProps {
  projectName: string;
  pending?: boolean;
  error?: UiError | null;
  disabled?: boolean;
  batchResult?: ProjectBatchImportResult | null;
  templateDiagnostics?: TemplateDependencyDiagnostic[] | null;
  onImport: () => void;
  onDismissBatch?: () => void;
}

export function ImportDocument({
  projectName,
  pending,
  error,
  disabled,
  batchResult,
  templateDiagnostics,
  onImport,
  onDismissBatch,
}: ImportDocumentProps) {
  const busy = Boolean(pending || disabled);
  const [ocr, setOcr] = useState<PdfImportOptions>(() => readPdfImportOptions());

  const updateOcr = (patch: Partial<PdfImportOptions>) => {
    setOcr(writePdfImportOptions({ ...ocr, ...patch }));
  };

  return (
    <section className="welcome" data-testid="import-document">
      <div className="welcome__inner welcome__inner--first-run">
        <h1 className="welcome__title">{projectName}</h1>
        <JobWizardSteps current="files" />
        <p className="surface__subtitle">
          Add source files. Memory, terms, and Prepare run from the workbench
          and Asset Hub after import. This screen does not insert extra gates.
        </p>

        {error ? (
          <p className="error-text" role="alert">
            {formatUiError(error)}
          </p>
        ) : null}

        {templateDiagnostics && templateDiagnostics.length > 0 ? (
          <ul className="diagnostic-list" data-testid="template-diagnostics">
            {templateDiagnostics.map((d, i) => (
              <li key={`${d.requestedId}-${i}`}>
                <span className="chip chip--warning">{d.status}</span>{" "}
                {d.message}
              </li>
            ))}
          </ul>
        ) : null}

        {batchResult ? (
          <BatchImportSummary
            result={batchResult}
            {...(onDismissBatch ? { onDismiss: onDismissBatch } : {})}
          />
        ) : null}

        <fieldset className="import-ocr" data-testid="import-ocr-options">
          <legend className="welcome__section-title">PDF OCR</legend>
          <label className="field">
            <span className="field__label">Engine</span>
            <select
              className="field__control"
              value={ocr.ocrEngine}
              disabled={busy}
              onChange={(e) =>
                updateOcr({ ocrEngine: e.target.value as PdfOcrEngine })
              }
              data-testid="import-ocr-engine"
            >
              <option value="auto">Auto (local text layer / Tesseract)</option>
              <option value="tesseract">Tesseract (local)</option>
              <option value="mineru">MinerU</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Mode</span>
            <select
              className="field__control"
              value={ocr.ocrMode}
              disabled={busy}
              onChange={(e) =>
                updateOcr({ ocrMode: e.target.value as PdfOcrMode })
              }
              data-testid="import-ocr-mode"
            >
              <option value="auto">Auto</option>
              <option value="always">Always OCR</option>
              <option value="never">Never OCR</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Languages</span>
            <input
              className="field__control"
              value={ocr.ocrLanguages}
              disabled={busy}
              onChange={(e) => updateOcr({ ocrLanguages: e.target.value })}
              autoComplete="off"
              data-testid="import-ocr-languages"
            />
          </label>
          {ocr.ocrEngine === "mineru" ? (
            <label className="field">
              <span className="field__label">MinerU API</span>
              <input
                className="field__control"
                value={ocr.mineruBaseUrl}
                disabled={busy}
                onChange={(e) => updateOcr({ mineruBaseUrl: e.target.value })}
                autoComplete="off"
                data-testid="import-ocr-mineru-base"
              />
            </label>
          ) : null}
          <p className="field__hint">
            Official Precision Extract uses a Token from the MinerU API
            console (Settings → OCR), not an Access Key pair. Auto keeps the
            local Poppler/Tesseract path.
          </p>
        </fieldset>

        <div className="welcome__actions">
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={busy}
            data-pending={pending ? "true" : undefined}
            onClick={onImport}
          >
            <FileArrowDown size={18} weight="bold" aria-hidden="true" />
            {pending ? "Importing" : "Choose files"}
          </button>
        </div>
      </div>
    </section>
  );
}
