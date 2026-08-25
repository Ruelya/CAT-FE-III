import { useCallback, useState } from "react";

import type { DocumentImportResult, Project } from "@translunar/contracts";
import { Button, Dialog, SelectField } from "@translunar/ui";

import { callEngine, describeError } from "../lib/engine.js";

export interface ImportDocumentDialogProps {
  open: boolean;
  project: Project;
  onClose: () => void;
  onImported: (result: DocumentImportResult) => void;
}

type SegmentationChoice = "sentence" | "paragraph";

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Document import with the engine's real options: segmentation mode
 * (sentence via SRX, or paragraph) and an optional custom SRX ruleset.
 * The source and SRX files come from dedicated main-process dialog
 * channels; without a chosen source file the submit stays disabled, and a
 * failed import surfaces the engine error instead of pretending.
 */
export function ImportDocumentDialog({
  open,
  project,
  onClose,
  onImported,
}: ImportDocumentDialogProps) {
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [segmentation, setSegmentation] =
    useState<SegmentationChoice>("sentence");
  const [srxPath, setSrxPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setSegmentation("sentence");
    setSrxPath(null);
    setError(null);
  }, []);

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
    try {
      const result = await callEngine("document.import", {
        projectId: project.id,
        sourcePath,
        segmentation,
        // The engine only applies SRX rules in sentence mode; never send a
        // ruleset that would silently do nothing.
        srxPath: segmentation === "sentence" ? srxPath : null,
      });
      reset();
      onClose();
      onImported(result);
    } catch (importError) {
      setError(describeError(importError));
    } finally {
      setBusy(false);
    }
  }, [
    sourcePath,
    segmentation,
    srxPath,
    project.id,
    reset,
    onClose,
    onImported,
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
        <p className="settings__note">
          自定义 SRX 仅在句子分段时生效；段落分段按空行切分，不使用 SRX。
        </p>

        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
