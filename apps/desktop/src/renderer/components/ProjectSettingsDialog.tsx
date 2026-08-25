import { useCallback, useEffect, useState } from "react";

import type {
  Project,
  Termbase,
  TermbaseListResult,
} from "@translunar/contracts";
import { Badge, Button, Dialog, TextField } from "@translunar/ui";

import { callEngine, describeError } from "../lib/engine.js";

export interface ProjectSettingsDialogProps {
  open: boolean;
  project: Project;
  onClose: () => void;
}

/**
 * Project settings. The language pair stays read-only (the protocol has no
 * project.update). The termbase section manages real mounts through
 * termbase.list/create/attach and moves CSV/TSV/TBX files through
 * termbase.import/export. The TM section moves TMX/CSV/TSV files through
 * tm.import/export. All file picks go through dedicated dialog channels in
 * the main process; a canceled pick does nothing and every result message
 * reports the engine's real counts.
 *
 * Each action tracks its own in-flight state (a Set of action ids), so a
 * long TM import never locks the termbase buttons and vice versa. Only
 * import/export against the same resource (the project TM, or one termbase)
 * stay mutually exclusive, because they read and write the same store.
 */
export function ProjectSettingsDialog({
  open,
  project,
  onClose,
}: ProjectSettingsDialogProps) {
  const [termbases, setTermbases] = useState<TermbaseListResult | null>(null);
  const [newTermbaseName, setNewTermbaseName] = useState("");
  const [pending, setPending] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const beginAction = useCallback((actionId: string) => {
    setPending((previous) => {
      const next = new Set(previous);
      next.add(actionId);
      return next;
    });
  }, []);

  const endAction = useCallback((actionId: string) => {
    setPending((previous) => {
      const next = new Set(previous);
      next.delete(actionId);
      return next;
    });
  }, []);

  const refreshTermbases = useCallback(async () => {
    const result = await callEngine("termbase.list", {
      projectId: project.id,
    });
    setTermbases(result);
  }, [project.id]);

  useEffect(() => {
    if (!open) {
      return;
    }
    refreshTermbases().catch((listError: unknown) => {
      setError(describeError(listError));
    });
  }, [open, refreshTermbases]);

  const createAndAttach = useCallback(async () => {
    beginAction("termbase.create");
    setError(null);
    try {
      const termbase = await callEngine("termbase.create", {
        name: newTermbaseName.trim(),
        sourceLocale: project.sourceLocale,
      });
      await callEngine("termbase.attach", {
        projectId: project.id,
        termbaseId: termbase.id,
      });
      setNewTermbaseName("");
      await refreshTermbases();
    } catch (createError) {
      setError(describeError(createError));
    } finally {
      endAction("termbase.create");
    }
  }, [
    beginAction,
    endAction,
    newTermbaseName,
    project.id,
    project.sourceLocale,
    refreshTermbases,
  ]);

  const attachExisting = useCallback(
    async (termbaseId: string) => {
      beginAction(`termbase.attach:${termbaseId}`);
      setError(null);
      try {
        await callEngine("termbase.attach", {
          projectId: project.id,
          termbaseId,
        });
        await refreshTermbases();
      } catch (attachError) {
        setError(describeError(attachError));
      } finally {
        endAction(`termbase.attach:${termbaseId}`);
      }
    },
    [beginAction, endAction, project.id, refreshTermbases],
  );

  const importTm = useCallback(async () => {
    const path = await window.tl.chooseTmImportFile();
    if (!path) {
      return;
    }
    beginAction("tm.import");
    setError(null);
    setNotice(null);
    try {
      const result = await callEngine("tm.import", {
        projectId: project.id,
        path,
      });
      setNotice(
        `外部 TM 导入完成：读取 ${result.imported} 条，新增 ${result.added}，更新 ${result.updated}`,
      );
    } catch (importError) {
      setError(describeError(importError));
    } finally {
      endAction("tm.import");
    }
  }, [beginAction, endAction, project.id]);

  const exportTm = useCallback(async () => {
    const path = await window.tl.chooseTmExportPath(`${project.name}-tm.tmx`);
    if (!path) {
      return;
    }
    beginAction("tm.export");
    setError(null);
    setNotice(null);
    try {
      const result = await callEngine("tm.export", {
        projectId: project.id,
        path,
      });
      setNotice(`TM 导出完成：${result.exported} 条 → ${result.outputPath}`);
    } catch (exportError) {
      setError(describeError(exportError));
    } finally {
      endAction("tm.export");
    }
  }, [beginAction, endAction, project.id, project.name]);

  const importTermbase = useCallback(
    async (termbase: Termbase) => {
      const path = await window.tl.chooseTermbaseImportFile();
      if (!path) {
        return;
      }
      beginAction(`termbase.import:${termbase.id}`);
      setError(null);
      setNotice(null);
      try {
        const result = await callEngine("termbase.import", {
          termbaseId: termbase.id,
          path,
          targetLocale: project.targetLocale,
        });
        setNotice(
          `术语库「${termbase.name}」导入完成：读取 ${result.imported} 条，新增 ${result.added}，合并 ${result.merged}`,
        );
      } catch (importError) {
        setError(describeError(importError));
      } finally {
        endAction(`termbase.import:${termbase.id}`);
      }
    },
    [beginAction, endAction, project.targetLocale],
  );

  const exportTermbase = useCallback(
    async (termbase: Termbase) => {
      const path = await window.tl.chooseTermbaseExportPath(
        `${termbase.name}.csv`,
      );
      if (!path) {
        return;
      }
      beginAction(`termbase.export:${termbase.id}`);
      setError(null);
      setNotice(null);
      try {
        const result = await callEngine("termbase.export", {
          termbaseId: termbase.id,
          path,
        });
        setNotice(
          `术语库「${termbase.name}」导出完成：${result.exported} 条 → ${result.outputPath}`,
        );
      } catch (exportError) {
        setError(describeError(exportError));
      } finally {
        endAction(`termbase.export:${termbase.id}`);
      }
    },
    [beginAction, endAction],
  );

  const tmImportPending = pending.has("tm.import");
  const tmExportPending = pending.has("tm.export");
  // Import and export hit the same project TM, so they exclude each other;
  // everything else runs independently.
  const tmFileBusy = tmImportPending || tmExportPending;
  const createPending = pending.has("termbase.create");

  const mountedIds = new Set(
    (termbases?.mounts ?? []).map((mount) => mount.termbaseId),
  );
  const mounted = (termbases?.termbases ?? []).filter((termbase) =>
    mountedIds.has(termbase.id),
  );
  const unmounted = (termbases?.termbases ?? []).filter(
    (termbase) => !mountedIds.has(termbase.id),
  );

  return (
    <Dialog
      title={`项目设置 — ${project.name}`}
      open={open}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="settings">
        <section className="settings__section">
          <h3 className="settings__heading">语言对</h3>
          <div className="settings__row">
            <span className="settings__locales">
              {project.sourceLocale} → {project.targetLocale}
            </span>
            <Badge tone="neutral">创建时固定</Badge>
          </div>
          <p className="settings__note">
            引擎协议（v1）尚无 project.update
            方法，语言对在创建项目时确定，暂不可修改。
          </p>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">翻译记忆</h3>
          <div className="settings__row">
            <span>项目内置 TM</span>
            <Badge tone="ok">已启用</Badge>
          </div>
          <p className="settings__note">
            确认句段时自动写入；TM 面板显示精确与模糊匹配，编辑网格的
            「预翻译」按阈值批量填充草稿。
          </p>
          <div className="settings__row">
            <Button
              size="sm"
              variant="outline"
              disabled={tmFileBusy}
              onClick={() => void importTm()}
            >
              {tmImportPending ? "导入中…" : "导入外部 TM…"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={tmFileBusy}
              onClick={() => void exportTm()}
            >
              {tmExportPending ? "导出中…" : "导出 TM…"}
            </Button>
          </div>
          <p className="settings__note">
            支持 TMX/CSV/TSV。导入会合并进项目
            TM（同源文的旧译文会被覆盖）；导出拒绝覆盖已存在的文件。
          </p>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">术语库</h3>
          {mounted.length === 0 ? (
            <p className="settings__note">尚未挂载术语库。</p>
          ) : (
            mounted.map((termbase) => {
              const importPending = pending.has(
                `termbase.import:${termbase.id}`,
              );
              const exportPending = pending.has(
                `termbase.export:${termbase.id}`,
              );
              // Same-termbase import and export exclude each other; other
              // termbases and the TM buttons stay usable.
              const fileBusy = importPending || exportPending;
              return (
                <div className="settings__row" key={termbase.id}>
                  <span>{termbase.name}</span>
                  <Badge tone="ok">已挂载</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={fileBusy}
                    aria-label={`导入术语到 ${termbase.name}`}
                    onClick={() => void importTermbase(termbase)}
                  >
                    {importPending ? "导入中…" : "导入 CSV/TBX…"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={fileBusy}
                    aria-label={`导出术语库 ${termbase.name}`}
                    onClick={() => void exportTermbase(termbase)}
                  >
                    {exportPending ? "导出中…" : "导出…"}
                  </Button>
                </div>
              );
            })
          )}
          {unmounted.map((termbase) => {
            const attachPending = pending.has(`termbase.attach:${termbase.id}`);
            return (
              <div className="settings__row" key={termbase.id}>
                <span>{termbase.name}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={attachPending}
                  onClick={() => void attachExisting(termbase.id)}
                >
                  {attachPending ? "挂载中…" : "挂载"}
                </Button>
              </div>
            );
          })}
          <form
            className="settings__row"
            onSubmit={(event) => {
              event.preventDefault();
              void createAndAttach();
            }}
          >
            <TextField
              label="新术语库名称"
              value={newTermbaseName}
              placeholder="例如 产品术语"
              onChange={(event) => setNewTermbaseName(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={createPending || !newTermbaseName.trim()}
            >
              {createPending ? "新建中…" : "新建并挂载"}
            </Button>
          </form>
          <p className="settings__note">
            挂载后，术语面板会对当前句段做 term.lookup
            命中，并支持快速添加术语；CSV/TSV/TBX
            批量导入与导出走上方按钮，结果以引擎实际计数为准。
          </p>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">质量检查</h3>
          <div className="settings__row">
            <span>tl-qa 规则库（数字、占位符、一致性等）</span>
            <Badge tone="ok">内置</Badge>
          </div>
          <p className="settings__note">
            在右侧 QA 面板手动运行；Agent 运行结束时也会自动执行。
          </p>
        </section>

        {notice ? (
          <div className="honest-note" data-tone="ok" role="status">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
