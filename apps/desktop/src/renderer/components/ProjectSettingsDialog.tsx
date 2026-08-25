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
 * project.update), the termbase section manages real mounts plus CSV/TSV/TBX
 * import and export, and the external-TM row imports TMX/CSV/TSV through the
 * dedicated file channel into the project TM via tm.import.
 */
export function ProjectSettingsDialog({
  open,
  project,
  onClose,
}: ProjectSettingsDialogProps) {
  const [termbases, setTermbases] = useState<TermbaseListResult | null>(null);
  const [newTermbaseName, setNewTermbaseName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
    setInfo(null);
    setError(null);
    refreshTermbases().catch((listError: unknown) => {
      setError(describeError(listError));
    });
  }, [open, refreshTermbases]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (actionError) {
      setError(describeError(actionError));
    } finally {
      setBusy(false);
    }
  }, []);

  const createAndAttach = useCallback(
    () =>
      runAction(async () => {
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
      }),
    [runAction, newTermbaseName, project.id, project.sourceLocale, refreshTermbases],
  );

  const attachExisting = useCallback(
    (termbaseId: string) =>
      runAction(async () => {
        await callEngine("termbase.attach", {
          projectId: project.id,
          termbaseId,
        });
        await refreshTermbases();
      }),
    [runAction, project.id, refreshTermbases],
  );

  const importTm = useCallback(async () => {
    const path = await window.tl.chooseTmFile();
    if (!path) {
      return;
    }
    await runAction(async () => {
      const result = await callEngine("tm.import", {
        projectId: project.id,
        path,
      });
      setInfo(
        `TM 导入完成：读取 ${result.imported} 条，新增 ${result.added}，更新 ${result.updated}。`,
      );
    });
  }, [runAction, project.id]);

  const exportTm = useCallback(async () => {
    const path = await window.tl.chooseExportPath(`${project.name}-tm.tmx`);
    if (!path) {
      return;
    }
    await runAction(async () => {
      const result = await callEngine("tm.export", {
        projectId: project.id,
        path,
      });
      setInfo(`TM 导出完成：${result.exported} 条 → ${result.outputPath}`);
    });
  }, [runAction, project.id, project.name]);

  const importTerms = useCallback(
    async (termbase: Termbase) => {
      const path = await window.tl.chooseTermFile();
      if (!path) {
        return;
      }
      await runAction(async () => {
        const result = await callEngine("termbase.import", {
          termbaseId: termbase.id,
          path,
          targetLocale: project.targetLocale,
        });
        setInfo(
          `「${termbase.name}」导入完成：读取 ${result.imported} 条，新增 ${result.added}，合并 ${result.merged}。`,
        );
      });
    },
    [runAction, project.targetLocale],
  );

  const exportTerms = useCallback(
    async (termbase: Termbase) => {
      const path = await window.tl.chooseExportPath(`${termbase.name}.csv`);
      if (!path) {
        return;
      }
      await runAction(async () => {
        const result = await callEngine("termbase.export", {
          termbaseId: termbase.id,
          path,
        });
        setInfo(
          `「${termbase.name}」导出完成：${result.exported} 条 → ${result.outputPath}`,
        );
      });
    },
    [runAction],
  );

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
            支持 TMX / CSV / TSV。导入合并进项目 TM：相同源文更新译文，
            其余新增；导出包含项目 TM 全部条目。
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
                <span className="settings__row-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void importTerms(termbase)}
                  >
                    导入术语…
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void exportTerms(termbase)}
                  >
                    导出…
                  </Button>
                  <Badge tone="ok">已挂载</Badge>
                </span>
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
            命中，并支持快速添加术语；批量导入支持 CSV / TSV / TBX。
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

        {info ? (
          <div className="honest-note" data-tone="ok" role="status">
            {info}
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
