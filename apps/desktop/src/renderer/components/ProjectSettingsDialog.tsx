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
  /** Called with the stored project after project.update / project.archive. */
  onProjectUpdated?: (project: Project) => void;
}

/**
 * Project settings. Name and language pair save through project.update; the
 * engine rejects a language change once the project holds documents, TM
 * entries, or termbase mounts, and that conflict is surfaced verbatim.
 * Lifecycle moves through project.archive (archive / restore). The termbase
 * section manages real mounts through termbase.list/create/attach/detach and
 * moves CSV/TSV/TBX files through termbase.import/export. The TM section
 * moves TMX/CSV/TSV files through tm.import/export. All file picks go
 * through dedicated dialog channels in the main process; a canceled pick
 * does nothing and every result message reports the engine's real counts.
 */
export function ProjectSettingsDialog({
  open,
  project,
  onClose,
  onProjectUpdated,
}: ProjectSettingsDialogProps) {
  const [termbases, setTermbases] = useState<TermbaseListResult | null>(null);
  const [newTermbaseName, setNewTermbaseName] = useState("");
  const [nameDraft, setNameDraft] = useState(project.name);
  const [sourceDraft, setSourceDraft] = useState(project.sourceLocale);
  const [targetDraft, setTargetDraft] = useState(project.targetLocale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    // Resync the drafts whenever the dialog opens or the stored project
    // changes (e.g. right after a successful save).
    setNameDraft(project.name);
    setSourceDraft(project.sourceLocale);
    setTargetDraft(project.targetLocale);
    refreshTermbases().catch((listError: unknown) => {
      setError(describeError(listError));
    });
  }, [open, project, refreshTermbases]);

  const saveProjectInfo = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await callEngine("project.update", {
        projectId: project.id,
        name: nameDraft,
        sourceLocale: sourceDraft,
        targetLocale: targetDraft,
      });
      setNotice(
        `项目设置已保存：${updated.name}（${updated.sourceLocale} → ${updated.targetLocale}）`,
      );
      onProjectUpdated?.(updated);
    } catch (saveError) {
      setError(describeError(saveError));
    } finally {
      setBusy(false);
    }
  }, [project.id, nameDraft, sourceDraft, targetDraft, onProjectUpdated]);

  const setArchived = useCallback(
    async (archived: boolean) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const updated = await callEngine("project.archive", {
          projectId: project.id,
          archived,
        });
        setNotice(
          archived
            ? "项目已归档：数据全部保留，可随时恢复。"
            : "项目已恢复为进行中。",
        );
        onProjectUpdated?.(updated);
      } catch (archiveError) {
        setError(describeError(archiveError));
      } finally {
        setBusy(false);
      }
    },
    [project.id, onProjectUpdated],
  );

  const createAndAttach = useCallback(async () => {
    setBusy(true);
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
      setBusy(false);
    }
  }, [newTermbaseName, project.id, project.sourceLocale, refreshTermbases]);

  const attachExisting = useCallback(
    async (termbaseId: string) => {
      setBusy(true);
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
        setBusy(false);
      }
    },
    [project.id, refreshTermbases],
  );

  const detachTermbase = useCallback(
    async (termbase: Termbase) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await callEngine("termbase.detach", {
          projectId: project.id,
          termbaseId: termbase.id,
        });
        setNotice(`术语库「${termbase.name}」已卸载：数据保留，可重新挂载。`);
        await refreshTermbases();
      } catch (detachError) {
        setError(describeError(detachError));
      } finally {
        setBusy(false);
      }
    },
    [project.id, refreshTermbases],
  );

  const importTm = useCallback(async () => {
    const path = await window.tl.chooseTmImportFile();
    if (!path) {
      return;
    }
    setBusy(true);
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
      setBusy(false);
    }
  }, [project.id]);

  const exportTm = useCallback(async () => {
    const path = await window.tl.chooseTmExportPath(`${project.name}-tm.tmx`);
    if (!path) {
      return;
    }
    setBusy(true);
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
      setBusy(false);
    }
  }, [project.id, project.name]);

  const importTermbase = useCallback(
    async (termbase: Termbase) => {
      const path = await window.tl.chooseTermbaseImportFile();
      if (!path) {
        return;
      }
      setBusy(true);
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
        setBusy(false);
      }
    },
    [project.targetLocale],
  );

  const exportTermbase = useCallback(async (termbase: Termbase) => {
    const path = await window.tl.chooseTermbaseExportPath(
      `${termbase.name}.csv`,
    );
    if (!path) {
      return;
    }
    setBusy(true);
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
      setBusy(false);
    }
  }, []);

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
          <h3 className="settings__heading">项目信息</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveProjectInfo();
            }}
          >
            <TextField
              label="项目名称"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              required
            />
            <div className="form-row">
              <TextField
                label="源语言"
                value={sourceDraft}
                onChange={(event) => setSourceDraft(event.target.value)}
                required
              />
              <TextField
                label="目标语言"
                value={targetDraft}
                onChange={(event) => setTargetDraft(event.target.value)}
                required
              />
            </div>
            <div className="settings__row">
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={
                  busy ||
                  !nameDraft.trim() ||
                  !sourceDraft.trim() ||
                  !targetDraft.trim()
                }
              >
                保存项目信息
              </Button>
            </div>
          </form>
          <p className="settings__note">
            语言对仅在项目还没有文档、TM 条目或术语库挂载时可以修改；
            一旦存在这些资产，引擎会拒绝修改，以免旧语言对的 TM
            与术语被错误复用。项目名称随时可改。
          </p>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">生命周期</h3>
          <div className="settings__row">
            <span>
              {project.lifecycle === "archived" ? "已归档" : "进行中"}
            </span>
            <Badge tone={project.lifecycle === "archived" ? "neutral" : "ok"}>
              {project.lifecycle === "archived" ? "archived" : "active"}
            </Badge>
            {project.lifecycle === "archived" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void setArchived(false)}
              >
                恢复项目
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void setArchived(true)}
              >
                归档项目
              </Button>
            )}
          </div>
          <p className="settings__note">
            归档只标记状态与时间戳，不删除任何文档、TM 或术语数据。
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
              disabled={busy}
              onClick={() => void importTm()}
            >
              导入外部 TM…
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void exportTm()}
            >
              导出 TM…
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
            mounted.map((termbase) => (
              <div className="settings__row" key={termbase.id}>
                <span>{termbase.name}</span>
                <Badge tone="ok">已挂载</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-label={`导入术语到 ${termbase.name}`}
                  onClick={() => void importTermbase(termbase)}
                >
                  导入 CSV/TBX…
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-label={`导出术语库 ${termbase.name}`}
                  onClick={() => void exportTermbase(termbase)}
                >
                  导出…
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-label={`卸载术语库 ${termbase.name}`}
                  onClick={() => void detachTermbase(termbase)}
                >
                  卸载
                </Button>
              </div>
            ))
          )}
          {unmounted.map((termbase) => (
            <div className="settings__row" key={termbase.id}>
              <span>{termbase.name}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void attachExisting(termbase.id)}
              >
                挂载
              </Button>
            </div>
          ))}
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
              disabled={busy || !newTermbaseName.trim()}
            >
              新建并挂载
            </Button>
          </form>
          <p className="settings__note">
            挂载后，术语面板会对当前句段做 term.lookup
            命中，并支持快速添加术语；卸载只解除挂载，不删除术语库本身；
            CSV/TSV/TBX 批量导入与导出走上方按钮，结果以引擎实际计数为准。
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
