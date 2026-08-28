import { useCallback, useEffect, useState } from "react";

import type { DocumentImportResult, Project } from "@translunar/contracts";
import { Button, Dialog, SelectField } from "@translunar/ui";

import { callEngine, describeError } from "../lib/engine.js";

export interface ImportDocumentDialogProps {
  open: boolean;
  project: Project;
  onClose: () => void;
  onImported: (result: DocumentImportResult) => void;
  /**
   * Called with the stored project after the defaults auto-save.
   * `undefined` is allowed explicitly so pass-through props survive
   * `exactOptionalPropertyTypes`.
   */
  onProjectUpdated?: ((project: Project) => void) | undefined;
}

type SegmentationChoice = "sentence" | "paragraph";

/**
 * 格式 choices: 自动 lets the engine probe registered filters; the two
 * bilingual filters never probe-match (a two-column table is
 * indistinguishable from an ordinary one), so they exist only as explicit
 * `filterId` picks.
 */
type FormatChoice =
  "auto" | "builtin.bilingual-xlsx" | "builtin.bilingual-docx";

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The project's stored default segmentation; unset means sentence mode. */
export function defaultSegmentation(project: Project): SegmentationChoice {
  return project.configuration.segmentation === "paragraph"
    ? "paragraph"
    : "sentence";
}

/** The project's stored default SRX ruleset path, if any. */
export function defaultSrxPath(project: Project): string | null {
  return project.configuration.srxPath ?? null;
}

/**
 * Document import with the engine's real options: an explicit format pick
 * (自动 probes; the bilingual two-column filters only run as an explicit
 * `filterId`), segmentation mode (sentence via SRX, or paragraph) and an
 * optional custom SRX ruleset.
 * The form pre-fills from the project's stored defaults
 * (`configuration.segmentation` / `configuration.srxPath`), and after a
 * successful import the chosen options are auto-saved back through
 * project.update so the next import starts from them.
 * The source and SRX files come from dedicated main-process
 * dialog channels; without a chosen source file the submit stays
 * disabled, and a failed import surfaces the engine error instead of
 * pretending.
 */
export function ImportDocumentDialog({
  open,
  project,
  onClose,
  onImported,
  onProjectUpdated,
}: ImportDocumentDialogProps) {
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [format, setFormat] = useState<FormatChoice>("auto");
  const [segmentation, setSegmentation] = useState<SegmentationChoice>(() =>
    defaultSegmentation(project),
  );
  const [srxPath, setSrxPath] = useState<string | null>(() =>
    defaultSrxPath(project),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    // Pre-fill from the stored project defaults whenever the dialog opens
    // or the stored project changes (e.g. right after the auto-save).
    setSegmentation(defaultSegmentation(project));
    setSrxPath(defaultSrxPath(project));
  }, [open, project]);

  const chooseSource = useCallback(async () => {
    const path = await window.tl.chooseSourceFile();
    if (path) {
      setSourcePath(path);
      setError(null);
    }
  }, []);

  const chooseSrx = useCallback(async () => {
    const path = await window.tl.chooseSrxFile();
    if (path) {
      setSrxPath(path);
      setError(null);
    }
  }, []);

  const reset = useCallback(() => {
    setSourcePath(null);
    setFormat("auto");
    setSegmentation(defaultSegmentation(project));
    setSrxPath(defaultSrxPath(project));
    setError(null);
  }, [project]);

  const cancel = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const submit = useCallback(async () => {
    if (!sourcePath) {
      return;
    }
    setBusy(true);
    setError(null);
    let result: DocumentImportResult;
    try {
      result = await callEngine("document.import", {
        projectId: project.id,
        sourcePath,
        // 自动 omits filterId (the engine probes); a bilingual pick rides
        // as the explicit filter id, the only way those filters run.
        ...(format === "auto" ? {} : { filterId: format }),
        segmentation,
        // The engine only applies SRX rules in sentence mode; never send a
        // ruleset that would silently do nothing.
        srxPath: segmentation === "sentence" ? srxPath : null,
      });
    } catch (importError) {
      setError(describeError(importError));
      setBusy(false);
      return;
    }
    try {
      // Remember the successful choice as the project default so the next
      // import starts from it. Paragraph mode leaves the stored SRX default
      // untouched — the engine keeps it for a later switch back to
      // sentence mode.
      const updated = await callEngine(
        "project.update",
        segmentation === "paragraph"
          ? { projectId: project.id, segmentation }
          : srxPath
            ? { projectId: project.id, segmentation, srxPath }
            : { projectId: project.id, segmentation, clearSrxPath: true },
      );
      onProjectUpdated?.(updated);
    } catch (saveError) {
      // The import itself succeeded; stay open and say so honestly instead
      // of silently forgetting the defaults.
      setSourcePath(null);
      setError(
        `文档已导入，但保存项目默认分段设置失败：${describeError(saveError)}`,
      );
      setBusy(false);
      onImported(result);
      return;
    }
    setBusy(false);
    reset();
    onClose();
    onImported(result);
  }, [
    sourcePath,
    format,
    segmentation,
    srxPath,
    project.id,
    reset,
    onClose,
    onImported,
    onProjectUpdated,
  ]);

  return (
    <Dialog
      title="导入文档"
      open={open}
      onClose={cancel}
      footer={
        <>
          <Button variant="outline" onClick={cancel} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || !sourcePath}
          >
            {busy ? "导入中…" : "导入"}
          </Button>
        </>
      }
    >
      <div className="import-form">
        <div className="settings__row">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void chooseSource()}
          >
            选择文件…
          </Button>
          <span className="import-form__path">
            {sourcePath ? baseName(sourcePath) : "未选择文件"}
          </span>
        </div>

        <SelectField
          label="格式"
          value={format}
          disabled={busy}
          onChange={(event) => setFormat(event.target.value as FormatChoice)}
        >
          <option value="auto">自动</option>
          <option value="builtin.bilingual-xlsx">双栏 XLSX</option>
          <option value="builtin.bilingual-docx">双栏 DOCX</option>
        </SelectField>

        <SelectField
          label="分段方式"
          value={segmentation}
          disabled={busy}
          onChange={(event) =>
            setSegmentation(event.target.value as SegmentationChoice)
          }
        >
          <option value="sentence">句子（SRX 规则）</option>
          <option value="paragraph">段落</option>
        </SelectField>

        <div className="settings__row">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || segmentation !== "sentence"}
            onClick={() => void chooseSrx()}
          >
            选择 SRX 规则…
          </Button>
          {srxPath ? (
            <>
              <span className="import-form__path">{baseName(srxPath)}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setSrxPath(null)}
              >
                清除
              </Button>
            </>
          ) : (
            <span className="import-form__path">
              内置规则（{project.sourceLocale}）
            </span>
          )}
        </div>

        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
