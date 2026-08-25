import { useCallback, useEffect, useState } from "react";

import type { Project, TmEntry } from "@translunar/contracts";
import {
  Button,
  Dialog,
  EmptyState,
  TextAreaField,
  TextField,
} from "@translunar/ui";

import { callEngine, describeError } from "../lib/engine.js";

export interface TmManageDialogProps {
  open: boolean;
  project: Project;
  onClose: () => void;
}

const PAGE_SIZE = 50;

/**
 * Browse, edit, and delete the project TM's individual entries through
 * tm.list / tm.update / tm.delete. This surface never confirms segments and
 * never exports files — confirmation-time TM writes stay in the workbench,
 * import/export stays in project settings. Deletion always asks first, and
 * every list, count, and result message reflects the engine's real state.
 */
export function TmManageDialog({
  open,
  project,
  onClose,
}: TmManageDialogProps) {
  const [entries, setEntries] = useState<TmEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSource, setEditSource] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  const refresh = useCallback(async () => {
    const result = await callEngine("tm.list", {
      projectId: project.id,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(appliedQuery ? { query: appliedQuery } : {}),
    });
    if (result.entries.length === 0 && result.total > 0 && page > 0) {
      // The page emptied out (for example after a delete); step back onto
      // the last page that still exists instead of showing a fake blank.
      setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1));
      return;
    }
    setEntries(result.entries);
    setTotal(result.total);
  }, [project.id, page, appliedQuery]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    refresh().catch((listError: unknown) => {
      setError(describeError(listError));
    });
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      setQueryInput("");
      setAppliedQuery("");
      setPage(0);
      setNotice(null);
      setError(null);
      setEditingId(null);
      setConfirmingDeleteId(null);
      setTotal(null);
    }
  }, [open]);

  const beginEdit = useCallback((entry: TmEntry) => {
    setEditingId(entry.id);
    setEditSource(entry.sourceText);
    setEditTarget(entry.targetText);
    setConfirmingDeleteId(null);
    setNotice(null);
    setError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await callEngine("tm.update", {
        entryId: editingId,
        sourceText: editSource,
        targetText: editTarget,
      });
      setEntries((current) =>
        current.map((entry) =>
          entry.id === result.entry.id ? result.entry : entry,
        ),
      );
      setEditingId(null);
      setNotice("条目已保存。");
    } catch (updateError) {
      setError(describeError(updateError));
    } finally {
      setBusy(false);
    }
  }, [editingId, editSource, editTarget]);

  const deleteEntry = useCallback(
    async (entry: TmEntry) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await callEngine("tm.delete", { entryId: entry.id });
        setConfirmingDeleteId(null);
        setNotice(`已删除条目：${result.entry.sourceText}`);
        await refresh();
      } catch (deleteError) {
        setError(describeError(deleteError));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const pageCount =
    total === null ? 0 : Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Dialog
      title={`TM 管理 — ${project.name}`}
      open={open}
      onClose={onClose}
      wide
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="tm-manage">
        <form
          className="tm-manage__toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(0);
            setAppliedQuery(queryInput.trim());
          }}
        >
          <TextField
            label="搜索源文或译文"
            value={queryInput}
            placeholder="输入关键词后回车"
            onChange={(event) => setQueryInput(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            搜索
          </Button>
        </form>
        <p className="tm-manage__count">
          {total === null
            ? "加载中…"
            : appliedQuery
              ? `匹配「${appliedQuery}」共 ${total} 条`
              : `项目 TM 共 ${total} 条`}
        </p>

        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="honest-note" data-tone="ok" role="status">
            {notice}
          </div>
        ) : null}

        {total === 0 ? (
          appliedQuery ? (
            <EmptyState
              title="无匹配条目"
              hint="换一个关键词，或清空搜索查看全部条目。"
            />
          ) : (
            <EmptyState
              title="TM 暂无条目"
              hint="在工作台确认句段或在项目设置导入外部 TM 后，条目会出现在这里。"
            />
          )
        ) : (
          <div className="dock-stack">
            {entries.map((entry) =>
              editingId === entry.id ? (
                <div className="match-card" key={entry.id}>
                  <TextAreaField
                    label="源文"
                    rows={2}
                    value={editSource}
                    onChange={(event) => setEditSource(event.target.value)}
                  />
                  <TextAreaField
                    label="译文"
                    rows={2}
                    value={editTarget}
                    onChange={(event) => setEditTarget(event.target.value)}
                  />
                  <div className="tm-manage__actions">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={
                        busy || !editSource.trim() || !editTarget.trim()
                      }
                      onClick={() => void saveEdit()}
                    >
                      保存
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setEditingId(null)}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="match-card" key={entry.id}>
                  <span className="match-card__origin">
                    源：{entry.sourceText}
                  </span>
                  <p className="match-card__text">{entry.targetText}</p>
                  <div className="tm-manage__actions">
                    {confirmingDeleteId === entry.id ? (
                      <>
                        <span className="tm-manage__confirm">
                          确认删除该条目？删除后模糊匹配和预翻译都不再使用它。
                        </span>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          aria-label={`确认删除条目 ${entry.sourceText}`}
                          onClick={() => void deleteEntry(entry)}
                        >
                          确认删除
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setConfirmingDeleteId(null)}
                        >
                          取消
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`编辑条目 ${entry.sourceText}`}
                          onClick={() => beginEdit(entry)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`删除条目 ${entry.sourceText}`}
                          onClick={() => {
                            setConfirmingDeleteId(entry.id);
                            setEditingId(null);
                            setNotice(null);
                          }}
                        >
                          删除
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {pageCount > 1 ? (
          <div className="tm-manage__pager">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || page === 0}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span>
              第 {page + 1} / {pageCount} 页
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || page >= pageCount - 1}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        ) : null}

        <p className="settings__note">
          此处仅管理项目 TM
          条目：编辑会同步更新模糊索引，删除后匹配立即消失。确认句段仍在工作台完成，导入/导出走项目设置。
        </p>
      </div>
    </Dialog>
  );
}
