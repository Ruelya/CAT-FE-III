import { EditorPanelShell } from "./EditorPanelShell";
import { formatUiError } from "../lib/errors";
import {
  layoutPreviewConfigured,
  onlyOfficeBootstrapHtml,
} from "../lib/layout-preview";
import type { LayoutPreviewApi } from "../state/use-layout-preview";

export interface LayoutPreviewProps {
  preview: LayoutPreviewApi;
}

export function LayoutPreview({ preview }: LayoutPreviewProps) {
  if (!preview.open) return null;
  const session = preview.session;
  const configured = session ? layoutPreviewConfigured(session) : false;

  return (
    <EditorPanelShell
      title="Layout preview"
      onClose={preview.hide}
      testId="layout-preview"
    >
      {preview.loading ? (
        <p className="inline-status" role="status" data-testid="layout-preview-loading">
          Exporting for layout preview
        </p>
      ) : null}
      {preview.error ? (
        <p className="error-text" role="alert">
          {formatUiError(preview.error)}
        </p>
      ) : null}
      {session && !configured ? (
        <div data-testid="layout-preview-setup">
          <p>
            Layout preview is view-only OnlyOffice. Set
            TRANSLUNAR_ONLYOFFICE_DOCS_URL (and TRANSLUNAR_ONLYOFFICE_JWT_SECRET
            when the server requires JWT). The export already used
            document.export.
          </p>
          <p className="mono">{session.fileUrl}</p>
        </div>
      ) : null}
      {session && configured ? (
        <iframe
          className="layout-preview__frame"
          title="Layout preview"
          data-testid="layout-preview-frame"
          sandbox="allow-scripts allow-same-origin"
          srcDoc={onlyOfficeBootstrapHtml(session)}
        />
      ) : null}
    </EditorPanelShell>
  );
}
