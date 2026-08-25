import { useCallback, useEffect, useState } from "react";

import type { Project, TermbaseListResult } from "@translunar/contracts";
import { Badge, Button, Dialog, TextField } from "@translunar/ui";

import { callEngine, describeError } from "../lib/engine.js";

export interface ProjectSettingsDialogProps {
  open: boolean;
  project: Project;
  onClose: () => void;
}

/**
 * Project settings. The language pair stays read-only (the protocol has no
 * project.update), the termbase section manages real mounts through
 * termbase.list/create/attach, and the external-TM row stays honestly
 * disabled: the engine has tm.import, but the desktop shell has no TM file
 * picker channel yet.
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
            <Button size="sm" variant="outline" disabled>
              挂载外部 TM…
            </Button>
          </div>
          <div className="honest-note">
            引擎已支持 tm.import（TMX/CSV/TSV），但桌面端尚未提供 TM
            文件选择通道。此按钮在通道接入前保持禁用——不做假成功。
          </div>
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
            命中，并支持快速添加术语；CSV/TBX 批量导入待文件通道接入。
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

        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
