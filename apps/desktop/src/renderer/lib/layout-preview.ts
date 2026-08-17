import type { LayoutPreviewSession } from "../../shared/desktop-api";

export function layoutPreviewConfigured(session: LayoutPreviewSession): boolean {
  return Boolean(session.docsUrl);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * DocsAPI bootstrap. The JWT is the signed token from main, never the secret.
 * mode is always view.
 */
export function onlyOfficeBootstrapHtml(session: LayoutPreviewSession): string {
  const docsUrl = session.docsUrl?.replace(/\/+$/u, "") ?? "";
  const config = {
    documentType: session.documentType,
    document: {
      fileType: session.fileType,
      key: session.key,
      title: session.title,
      url: session.fileUrl,
    },
    editorConfig: {
      mode: "view",
      lang: "zh",
    },
    ...(session.token ? { token: session.token } : {}),
  };
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(session.title)}</title>
  <style>html,body,#host{height:100%;margin:0;background:#fff}</style>
</head>
<body>
  <div id="host"></div>
  <script src="${escapeHtml(docsUrl)}/web-apps/apps/api/documents/api.js"></script>
  <script>
    const config = ${JSON.stringify(config)};
    if (window.DocsAPI && window.DocsAPI.DocEditor) {
      new window.DocsAPI.DocEditor("host", config);
    }
  </script>
</body>
</html>`;
}
