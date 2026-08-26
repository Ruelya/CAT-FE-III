import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  Document,
  DocumentImportResult,
  Project,
  QaIssue,
  Segment,
  SegmentCounts,
  TmMatchItem,
} from "@translunar/contracts";
import { Button, EmptyState, SegmentProgress } from "@translunar/ui";

import type {
  EngineLifecycleState,
  MenuCommand,
} from "../../shared/desktop-api.js";

import { AiStatusProvider } from "../lib/ai-status.js";
import {
  callEngine,
  describeError,
  isEngineUnavailable,
  isExportBlocked,
} from "../lib/engine.js";
import {
  EMPTY_FILTER,
  filterSegments,
  findSegmentMatch,
  isFilterActive,
  replaceSegmentText,
} from "../lib/segment-filter.js";
import type {
  SegmentFilterSpec,
  SegmentStateFilter,
} from "../lib/segment-filter.js";
import { ImportDocumentDialog } from "../components/ImportDocumentDialog.js";
import { Ribbon } from "../components/Ribbon.js";
import { SegmentGrid } from "../components/SegmentGrid.js";
import type { SegmentGridHandle } from "../components/SegmentGrid.js";
import { TmPanel } from "../components/TmPanel.js";
import { TermPanel } from "../components/TermPanel.js";
import { ConcordancePanel } from "../components/ConcordancePanel.js";
import { QaPanel } from "../components/QaPanel.js";
import { AiPanel } from "../components/AiPanel.js";
import { AgentPanel } from "../components/AgentPanel.js";
import { ExportOverwriteConfirm } from "../components/ExportOverwriteConfirm.js";
import { PreviewDialog } from "../components/PreviewDialog.js";

export interface WorkbenchViewProps {
  project: Project;
  engineState: EngineLifecycleState;
  onStatusMessage: (message: string) => void;
  /** Reports whether a document is active, so menu enablement stays honest. */
  onDocumentOpenChange?: (open: boolean) => void;
  /** Called with the stored project after the import-defaults auto-save. */
  onProjectUpdated?: (project: Project) => void;
  /** Live grid stats for the shell status bar; null when no document. */
  onStatsChange?: (stats: WorkbenchStats | null) => void;
  /** Opens the project settings dialog (owned by the shell). */
  onOpenSettings?: () => void;
  /** Opens the TM manage dialog (owned by the shell). */
  onOpenTmManage?: () => void;
  /** Returns to the projects list (same path as the menu command). */
  onCloseProject?: () => void;
}

/** What the shell status bar shows about the open document. */
export interface WorkbenchStats {
  documentName: string;
  counts: SegmentCounts;
  /** Ordinal of the selected segment, or null when nothing is selected. */
  activeOrdinal: number | null;
}

type DockTab = "tm" | "term" | "concordance" | "qa" | "ai" | "agent";

/** Menu dock commands map onto the same tabs the dock buttons switch. */
const DOCK_COMMANDS: Partial<Record<MenuCommand, DockTab>> = {
  "show-dock-tm": "tm",
  "show-dock-term": "term",
  "show-dock-concordance": "concordance",
  "show-dock-qa": "qa",
  "show-dock-ai": "ai",
  "show-dock-agent": "agent",
};

/**
 * A write (draft save or confirm) the engine never acknowledged. Kept as a
 * persistent inline alert — not a transient statusbar line — until a later
 * write for the same segment is acked, so a mid-session crash can never
 * look like a successful save.
 */
interface UnackedWrite {
  segmentId: string;
  ordinal: number;
  kind: "draft" | "confirm";
  message: string;
}

const STATE_FILTER_OPTIONS: Array<[SegmentStateFilter, string]> = [
  ["all", "全部状态"],
  ["untranslated", "未译"],
  ["draft", "草稿"],
  ["confirmed", "已确认"],
  ["qa", "QA 问题"],
];

function readTextSelection(): string {
  const active = document.activeElement;
  if (
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLInputElement
  ) {
    const { selectionStart, selectionEnd, value } = active;
    if (
      selectionStart !== null &&
      selectionEnd !== null &&
      selectionEnd > selectionStart
    ) {
      return value.slice(selectionStart, selectionEnd).trim();
    }
  }
  return window.getSelection()?.toString().trim() ?? "";
}

export function WorkbenchView({
  project,
  engineState,
  onStatusMessage,
  onDocumentOpenChange,
  onProjectUpdated,
  onStatsChange,
  onOpenSettings,
  onOpenTmManage,
  onCloseProject,
}: WorkbenchViewProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  // Per-document progress counts from document.list; the active document's
  // entry is kept live from the loaded segments/issues so the explorer never
  // lags behind the grid.
  const [documentProgress, setDocumentProgress] = useState<
    Record<string, SegmentCounts>
  >({});
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  // Documents with an open editor tab, in tab order. Opening a file from
  // the explorer appends a tab; closing a tab only closes the tab — the
  // document itself stays in the project untouched.
  const [openDocumentIds, setOpenDocumentIds] = useState<string[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [issues, setIssues] = useState<QaIssue[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [tab, setTab] = useState<DockTab>("tm");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<SegmentFilterSpec>(EMPTY_FILTER);
  // Find next/prev query (F4 / Shift+F4). Unlike `filter`, it never hides
  // rows: it only moves the selection through matching segments.
  const [findQuery, setFindQuery] = useState("");
  // Replacement text for 替换/全部替换; replaces occurrences of the find
  // query inside target text only.
  const [replaceWith, setReplaceWith] = useState("");
  // Whether replace may rewrite confirmed segments (demoting them back to
  // draft). Off by default: confirmed work is skipped and reported.
  const [includeConfirmed, setIncludeConfirmed] = useState(false);
  const [concordanceSeed, setConcordanceSeed] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const gridRef = useRef<SegmentGridHandle | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Two-step remove: the first 移除 click only arms this id; the row then
  // shows 确认移除/取消 and nothing is deleted until the explicit confirm.
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [unackedWrite, setUnackedWrite] = useState<UnackedWrite | null>(null);
  // QA issue whose waive/restore call is in flight (locks its button).
  const [waivePendingId, setWaivePendingId] = useState<string | null>(null);
  // An export the engine refused because the destination exists. Kept until
  // the user explicitly picks 覆盖 (retry with overwrite) or 取消 (leave the
  // existing file untouched).
  const [overwritePrompt, setOverwritePrompt] = useState<{
    documentId: string;
    outputPath: string;
  } | null>(null);

  // Latest engine-acked copy of every loaded segment, kept fresh
  // synchronously (outside React state) so queued writes always send the
  // current revision — with debounced auto-saves, a confirm or flush can
  // run before the render that carries the previous ack has committed.
  const latestSegmentsRef = useRef(new Map<string, Segment>());
  const recordSegments = useCallback((list: Segment[]) => {
    for (const segment of list) {
      latestSegmentsRef.current.set(segment.id, segment);
    }
  }, []);

  // Draft saves and confirms run strictly one at a time: the engine
  // rejects writes with a stale baseRevision, and the Trados-style typing
  // auto-save can otherwise race the Ctrl+Enter confirm or a leave-flush.
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueSegmentWrite = useCallback(
    <T,>(task: () => Promise<T>): Promise<T> => {
      const run = writeQueueRef.current.then(task);
      writeQueueRef.current = run.catch(() => undefined);
      return run;
    },
    [],
  );

  const activeDocument = useMemo(
    () =>
      documents.find((document) => document.id === activeDocumentId) ?? null,
    [documents, activeDocumentId],
  );
  const activeSegment = useMemo(
    () => segments.find((segment) => segment.id === activeSegmentId) ?? null,
    [segments, activeSegmentId],
  );
  // Tab order follows the open list; ids whose document vanished (removed
  // while a stale id lingered) simply render nothing.
  const openDocuments = useMemo(
    () =>
      openDocumentIds
        .map((id) => documents.find((document) => document.id === id))
        .filter((document): document is Document => document !== undefined),
    [openDocumentIds, documents],
  );

  useEffect(() => {
    onDocumentOpenChange?.(activeDocument !== null);
  }, [activeDocument, onDocumentOpenChange]);

  // TM lookup for the active segment lives here (not inside the TM dock) so
  // the whole workbench reacts to selection: the dock list, the TM tab's
  // best-score chip, and the active grid row all read the same result. The
  // dependency is the segment object itself, so a confirm (which bumps the
  // revision) re-queries and surfaces the entry it just wrote.
  const [tmMatches, setTmMatches] = useState<TmMatchItem[]>([]);
  const [tmError, setTmError] = useState<string | null>(null);
  useEffect(() => {
    setTmMatches([]);
    setTmError(null);
    if (!activeSegment) {
      return;
    }
    let cancelled = false;
    callEngine("tm.lookup", {
      projectId: project.id,
      sourceText: activeSegment.sourceText,
    })
      .then((result) => {
        if (!cancelled) {
          setTmMatches(result.matches);
        }
      })
      .catch((lookupError: unknown) => {
        if (!cancelled) {
          setTmError(describeError(lookupError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, activeSegment]);

  const refreshDocuments = useCallback(async () => {
    const result = await callEngine("document.list", { projectId: project.id });
    setDocuments(result.documents);
    const progress: Record<string, SegmentCounts> = {};
    // Older engines (and test doubles) may answer without the progress
    // field; the explorer then falls back to the plain segment count.
    for (const entry of result.progress ?? []) {
      progress[entry.documentId] = entry.counts;
    }
    setDocumentProgress(progress);
    return result.documents;
  }, [project.id]);

  const loadDocument = useCallback(
    async (documentId: string) => {
      setActiveDocumentId(documentId);
      setOpenDocumentIds((current) =>
        current.includes(documentId) ? current : [...current, documentId],
      );
      setFilter(EMPTY_FILTER);
      setFindQuery("");
      setOverwritePrompt(null);
      const [segmentResult, issueResult] = await Promise.all([
        callEngine("segment.list", { documentId }),
        callEngine("qa.list", { documentId }),
      ]);
      recordSegments(segmentResult.segments);
      setSegments(segmentResult.segments);
      setIssues(issueResult.issues);
      setActiveSegmentId(segmentResult.segments[0]?.id ?? null);
    },
    [recordSegments],
  );

  // Leaves the grid with no document open: everything document-scoped is
  // reset so nothing stale can be presented as current.
  const clearActiveDocument = useCallback(() => {
    setActiveDocumentId(null);
    setSegments([]);
    setIssues([]);
    setActiveSegmentId(null);
    setFilter(EMPTY_FILTER);
    setFindQuery("");
    setUnackedWrite(null);
    setOverwritePrompt(null);
  }, []);

  // Closes one editor tab. The document stays in the project (and in the
  // explorer file list); when the active tab closes, its neighbor takes
  // over, and closing the last tab shows the honest empty grid.
  const closeDocumentTab = useCallback(
    (documentId: string) => {
      const index = openDocumentIds.indexOf(documentId);
      const remaining = openDocumentIds.filter((id) => id !== documentId);
      setOpenDocumentIds(remaining);
      if (documentId !== activeDocumentId) {
        return;
      }
      const next =
        remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
      if (next) {
        void loadDocument(next).catch((error: unknown) => {
          onStatusMessage(`加载文档失败：${describeError(error)}`);
        });
      } else {
        clearActiveDocument();
      }
    },
    [
      openDocumentIds,
      activeDocumentId,
      loadDocument,
      clearActiveDocument,
      onStatusMessage,
    ],
  );

  useEffect(() => {
    void refreshDocuments()
      .then((loaded) => {
        const first = loaded[0];
        if (first) {
          return loadDocument(first.id);
        }
        return undefined;
      })
      .catch((error: unknown) => {
        onStatusMessage(`加载文档失败：${describeError(error)}`);
      });
  }, [refreshDocuments, loadDocument, onStatusMessage]);

  // The engine came back after a crash or manual relaunch. The renderer's
  // in-memory lists may be ahead of what the engine actually acked (a write
  // could have died with the old process), so resync from the engine and
  // say so instead of silently trusting stale state.
  const previousEngineStateRef = useRef(engineState);
  useEffect(() => {
    const previous = previousEngineStateRef.current;
    previousEngineStateRef.current = engineState;
    if (engineState !== "ready" || previous === "ready") {
      return;
    }
    void (async () => {
      try {
        await refreshDocuments();
        if (activeDocumentId) {
          const [segmentResult, issueResult] = await Promise.all([
            callEngine("segment.list", { documentId: activeDocumentId }),
            callEngine("qa.list", { documentId: activeDocumentId }),
          ]);
          recordSegments(segmentResult.segments);
          setSegments(segmentResult.segments);
          setIssues(issueResult.issues);
        }
        onStatusMessage("引擎已恢复，文档与句段已从引擎重新同步");
      } catch (error) {
        onStatusMessage(`引擎恢复后同步失败：${describeError(error)}`);
      }
    })();
  }, [
    engineState,
    activeDocumentId,
    refreshDocuments,
    recordSegments,
    onStatusMessage,
  ]);

  // The import dialog owns file picking and the document.import call
  // (including segmentation and SRX options); this only reacts to success.
  const handleImported = useCallback(
    async (result: DocumentImportResult) => {
      onStatusMessage(
        `已导入「${result.document.name}」：${result.segmentCount} 个句段`,
      );
      await refreshDocuments();
      await loadDocument(result.document.id);
    },
    [refreshDocuments, loadDocument, onStatusMessage],
  );

  // Remove one document (its segments and QA issues go with it; the
  // project TM, termbases, and the original file on disk stay). Runs only
  // from the two-step confirm in the file list.
  const removeDocument = useCallback(
    async (target: Document) => {
      setBusy(true);
      try {
        const result = await callEngine("document.remove", {
          documentId: target.id,
        });
        onStatusMessage(
          `已移除「${target.name}」：删除 ${result.removedSegments} 个句段、${result.removedQaIssues} 条 QA 记录；项目 TM、术语库与原始文件保留`,
        );
        setOpenDocumentIds((current) =>
          current.filter((id) => id !== target.id),
        );
        const removedIndex = documents.findIndex(
          (item) => item.id === target.id,
        );
        const remaining = await refreshDocuments();
        if (target.id !== activeDocumentId) {
          return;
        }
        // The open document is gone: land on its list neighbor, or show
        // the empty state when it was the last one.
        setUnackedWrite(null);
        const next =
          remaining[Math.min(Math.max(removedIndex, 0), remaining.length - 1)];
        if (next) {
          await loadDocument(next.id);
        } else {
          clearActiveDocument();
        }
      } catch (error) {
        onStatusMessage(`移除失败：${describeError(error)}`);
      } finally {
        setPendingRemoveId(null);
        setBusy(false);
      }
    },
    [
      documents,
      activeDocumentId,
      refreshDocuments,
      loadDocument,
      clearActiveDocument,
      onStatusMessage,
    ],
  );

  const exportDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }
    const suggested = activeDocument.name.replace(
      /(\.[^.]+)$/,
      "-translated$1",
    );
    const outputPath = await window.tl.chooseExportPath(suggested);
    if (!outputPath) {
      return;
    }
    setOverwritePrompt(null);
    setBusy(true);
    try {
      const result = await callEngine("document.export", {
        documentId: activeDocument.id,
        outputPath,
      });
      onStatusMessage(
        `导出完成：${result.outputPath}（${result.translatedSegments} 个已译单元）`,
      );
    } catch (error) {
      if (isExportBlocked(error)) {
        // The engine never clobbers silently; hand the decision to the user.
        setOverwritePrompt({ documentId: activeDocument.id, outputPath });
      } else {
        onStatusMessage(`导出失败：${describeError(error)}`);
      }
    } finally {
      setBusy(false);
    }
  }, [activeDocument, onStatusMessage]);

  // 覆盖: retry the blocked export with the explicit overwrite flag.
  const confirmOverwriteExport = useCallback(async () => {
    if (!overwritePrompt) {
      return;
    }
    setBusy(true);
    try {
      const result = await callEngine("document.export", {
        documentId: overwritePrompt.documentId,
        outputPath: overwritePrompt.outputPath,
        overwrite: true,
      });
      setOverwritePrompt(null);
      onStatusMessage(
        `导出完成（已覆盖）：${result.outputPath}（${result.translatedSegments} 个已译单元）`,
      );
    } catch (error) {
      setOverwritePrompt(null);
      onStatusMessage(`导出失败：${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }, [overwritePrompt, onStatusMessage]);

  // 取消: nothing was written and the existing file stays as it is.
  const cancelOverwriteExport = useCallback(() => {
    setOverwritePrompt(null);
    onStatusMessage("已取消导出：保留现有文件，未做任何修改");
  }, [onStatusMessage]);

  const applySegments = useCallback(
    (updated: Segment[]) => {
      recordSegments(updated);
      setSegments((current) =>
        current.map((segment) => {
          const replacement = updated.find((item) => item.id === segment.id);
          return replacement ?? segment;
        }),
      );
    },
    [recordSegments],
  );

  const openIssueSegmentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const issue of issues) {
      if (issue.status === "open") {
        ids.add(issue.segmentId);
      }
    }
    return ids;
  }, [issues]);

  const filteredSegments = useMemo(
    () => filterSegments(segments, filter, openIssueSegmentIds),
    [segments, filter, openIssueSegmentIds],
  );

  // Trados-style flow: after a confirm, the selection steps down to the next
  // visible segment that still needs work, so the keyboard loop stays
  // type → Ctrl+Enter → type. `written` carries the freshly confirmed and
  // propagated rows (state updates land asynchronously). Nothing wraps: at
  // the bottom of the document the selection stays put.
  const advanceAfterConfirm = useCallback(
    (confirmedId: string, written: Segment[]) => {
      const writtenById = new Map(written.map((item) => [item.id, item]));
      const index = filteredSegments.findIndex(
        (item) => item.id === confirmedId,
      );
      if (index < 0) {
        return;
      }
      for (let i = index + 1; i < filteredSegments.length; i += 1) {
        const candidate = filteredSegments[i]!;
        const state = writtenById.get(candidate.id)?.state ?? candidate.state;
        if (state !== "confirmed") {
          setActiveSegmentId(candidate.id);
          return;
        }
      }
    },
    [filteredSegments],
  );

  // Alt+↑/↓ step the selection through the visible rows without leaving the
  // keyboard — the grid editor follows the selection.
  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      if (filteredSegments.length === 0) {
        return;
      }
      const index = filteredSegments.findIndex(
        (segment) => segment.id === activeSegmentId,
      );
      const next =
        index < 0
          ? delta === 1
            ? 0
            : filteredSegments.length - 1
          : Math.min(filteredSegments.length - 1, Math.max(0, index + delta));
      const target = filteredSegments[next];
      if (target && target.id !== activeSegmentId) {
        setActiveSegmentId(target.id);
      }
    },
    [filteredSegments, activeSegmentId],
  );

  const reloadSegments = useCallback(async () => {
    if (!activeDocumentId) {
      return;
    }
    try {
      const result = await callEngine("segment.list", {
        documentId: activeDocumentId,
      });
      recordSegments(result.segments);
      setSegments(result.segments);
    } catch (error) {
      // Refreshing with a dead engine cannot work; keep the local state
      // (it still holds the user's text) instead of exploding.
      onStatusMessage(`刷新句段失败：${describeError(error)}`);
    }
  }, [activeDocumentId, recordSegments, onStatusMessage]);

  // Persists targetText as the segment's draft. Trados-style typing
  // auto-saves pass quiet=true: success shows through the row's 草稿 badge
  // instead of a statusbar line per pause; failures always surface.
  // Resolves false when the engine never acked, so the grid re-arms and
  // retries the text on its next flush.
  const saveDraft = useCallback(
    (
      segment: Segment,
      targetText: string,
      options?: { quiet?: boolean },
    ): Promise<boolean> =>
      enqueueSegmentWrite(async () => {
        const latest = latestSegmentsRef.current.get(segment.id) ?? segment;
        if (options?.quiet && latest.targetText === targetText) {
          // A leave-flush can trail an identical debounced save (or a
          // confirm already persisted the text); nothing new to write.
          return true;
        }
        try {
          const result = await callEngine("segment.update", {
            segmentId: segment.id,
            targetText,
            baseRevision: latest.revision,
          });
          applySegments([result.segment]);
          setUnackedWrite((current) =>
            current?.segmentId === segment.id ? null : current,
          );
          if (!options?.quiet) {
            onStatusMessage(`句段 #${segment.ordinal + 1} 草稿已保存`);
          }
          return true;
        } catch (error) {
          if (isEngineUnavailable(error)) {
            // The engine never acked this write: keep an inline alert up
            // (the editor still holds the text) and skip the doomed reload.
            setUnackedWrite({
              segmentId: segment.id,
              ordinal: segment.ordinal,
              kind: "draft",
              message: describeError(error),
            });
            onStatusMessage(
              `句段 #${segment.ordinal + 1} 草稿未保存：引擎未确认写入`,
            );
            return false;
          }
          onStatusMessage(`保存失败：${describeError(error)}`);
          await reloadSegments();
          return false;
        }
      }),
    [enqueueSegmentWrite, applySegments, onStatusMessage, reloadSegments],
  );

  const confirmSegment = useCallback(
    (segment: Segment, targetText: string): Promise<void> => {
      if (targetText.trim().length === 0) {
        // Same rule the engine enforces; report it without a doomed RPC.
        onStatusMessage(`句段 #${segment.ordinal + 1} 译文为空，无法确认`);
        return Promise.resolve();
      }
      return enqueueSegmentWrite(async () => {
        let current = latestSegmentsRef.current.get(segment.id) ?? segment;
        try {
          if (targetText !== current.targetText) {
            const updated = await callEngine("segment.update", {
              segmentId: current.id,
              targetText,
              baseRevision: current.revision,
            });
            current = updated.segment;
            // Fresh revision survives even if the confirm below fails, so
            // a retry never sends a stale baseRevision.
            recordSegments([current]);
          }
          const result = await callEngine("segment.confirm", {
            segmentId: current.id,
            baseRevision: current.revision,
          });
          applySegments([result.segment, ...result.propagated]);
          setUnackedWrite((currentAlert) =>
            currentAlert?.segmentId === segment.id ? null : currentAlert,
          );
          const propagated =
            result.propagated.length > 0
              ? `，TM 传播 ${result.propagated.length} 个重复句段`
              : "";
          onStatusMessage(
            `句段 #${segment.ordinal + 1} 已确认并写入 TM${propagated}`,
          );
          advanceAfterConfirm(segment.id, [
            result.segment,
            ...result.propagated,
          ]);
        } catch (error) {
          if (isEngineUnavailable(error)) {
            setUnackedWrite({
              segmentId: segment.id,
              ordinal: segment.ordinal,
              kind: "confirm",
              message: describeError(error),
            });
            onStatusMessage(
              `句段 #${segment.ordinal + 1} 未确认：引擎未确认写入`,
            );
            return;
          }
          onStatusMessage(`确认失败：${describeError(error)}`);
          await reloadSegments();
        }
      });
    },
    [
      enqueueSegmentWrite,
      recordSegments,
      applySegments,
      advanceAfterConfirm,
      onStatusMessage,
      reloadSegments,
    ],
  );

  const applyDraftToActive = useCallback(
    (text: string) => {
      if (!activeSegment) {
        return;
      }
      void saveDraft(activeSegment, text);
    },
    [activeSegment, saveDraft],
  );

  // Terms land at the caret of the live grid editor (unsaved draft) without
  // triggering a save. Only when no editor is mounted — e.g. the active row
  // is filtered out — fall back to appending to the saved draft.
  const insertTermToActive = useCallback(
    (term: string) => {
      if (!activeSegment) {
        return;
      }
      if (gridRef.current?.insertAtCaret(term)) {
        return;
      }
      const base = activeSegment.targetText;
      void saveDraft(activeSegment, base.length > 0 ? `${base}${term}` : term);
    },
    [activeSegment, saveDraft],
  );

  const pretranslate = useCallback(async () => {
    if (!activeDocumentId) {
      return;
    }
    setBusy(true);
    try {
      const result = await callEngine("tm.pretranslate", {
        documentId: activeDocumentId,
      });
      applySegments(result.segments);
      onStatusMessage(
        `预翻译完成：检查 ${result.checked} 个未译句段，填充 ${result.pretranslated} 个（精确 ${result.exact} / 模糊 ${result.fuzzy}）`,
      );
    } catch (error) {
      onStatusMessage(`预翻译失败：${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeDocumentId, applySegments, onStatusMessage]);

  const runQa = useCallback(async () => {
    if (!activeDocumentId) {
      return;
    }
    try {
      const result = await callEngine("qa.run", {
        documentId: activeDocumentId,
      });
      setIssues(result.issues);
      onStatusMessage(
        `QA 完成：检查 ${result.checkedSegments} 个句段，${result.openIssues} 个未解决问题`,
      );
    } catch (error) {
      onStatusMessage(`QA 失败：${describeError(error)}`);
    }
  }, [activeDocumentId, onStatusMessage]);

  // 忽略/恢复 one QA issue. Waiving records a human decision on the exact
  // finding — it never confirms the segment and never writes TM, and the
  // issue only stays waived while the same evidence keeps reproducing.
  const setIssueWaived = useCallback(
    async (issue: QaIssue, waived: boolean) => {
      setWaivePendingId(issue.id);
      try {
        const result = await callEngine("qa.waive", {
          issueId: issue.id,
          waived,
        });
        setIssues((current) =>
          current.map((item) =>
            item.id === result.issue.id ? result.issue : item,
          ),
        );
        onStatusMessage(
          waived
            ? "已忽略 QA 问题：问题并未修复，未确认句段、未写入 TM"
            : "已恢复 QA 问题为未解决",
        );
      } catch (error) {
        // The issue keeps its current status; nothing is pretended.
        onStatusMessage(
          waived
            ? `忽略失败：${describeError(error)}`
            : `恢复失败：${describeError(error)}`,
        );
      } finally {
        setWaivePendingId(null);
      }
    },
    [onStatusMessage],
  );

  const openIssueCount = useMemo(
    () => issues.filter((issue) => issue.status === "open").length,
    [issues],
  );

  // Engine results arrive best-first; the top hit drives the TM tab chip
  // and the active row's match badge.
  const bestTmMatch = tmMatches[0] ?? null;

  const counts = useMemo<SegmentCounts>(() => {
    let confirmed = 0;
    let draft = 0;
    let untranslated = 0;
    for (const segment of segments) {
      if (segment.state === "confirmed") {
        confirmed += 1;
      } else if (segment.state === "draft") {
        draft += 1;
      } else {
        untranslated += 1;
      }
    }
    return {
      total: segments.length,
      untranslated,
      draft,
      confirmed,
      openIssues: openIssueCount,
    };
  }, [segments, openIssueCount]);

  // Keep the explorer entry of the active document in sync with the loaded
  // grid, so confirms/drafts show up there without re-querying the engine.
  // The documentId guard skips the switch window where `segments` still
  // holds the previous document's rows.
  useEffect(() => {
    if (!activeDocumentId || segments.length === 0) {
      return;
    }
    if (segments[0]?.documentId !== activeDocumentId) {
      return;
    }
    setDocumentProgress((current) => {
      const existing = current[activeDocumentId];
      if (
        existing &&
        existing.total === counts.total &&
        existing.untranslated === counts.untranslated &&
        existing.draft === counts.draft &&
        existing.confirmed === counts.confirmed &&
        existing.openIssues === counts.openIssues
      ) {
        return current;
      }
      return { ...current, [activeDocumentId]: counts };
    });
  }, [activeDocumentId, segments, counts]);

  // Project-level totals for the explorer (progress bar and details).
  // Documents without a progress entry (older engine, missing field)
  // contribute only their honest segment count; the confirmed ratio is
  // shown only when every file reported real counts, never estimated.
  const projectTotals = useMemo(() => {
    let total = 0;
    let confirmed = 0;
    let draft = 0;
    let covered = 0;
    for (const document of documents) {
      const progress = documentProgress[document.id];
      if (progress) {
        total += progress.total;
        confirmed += progress.confirmed;
        draft += progress.draft;
        covered += 1;
      } else {
        total += document.segmentCount;
      }
    }
    return {
      total,
      confirmed,
      draft,
      hasProgress: documents.length > 0 && covered === documents.length,
    };
  }, [documents, documentProgress]);

  const projectPercent =
    projectTotals.hasProgress && projectTotals.total > 0
      ? Math.round((projectTotals.confirmed / projectTotals.total) * 100)
      : null;

  // Feed the shell status bar. Cleared on unmount (project close) so stale
  // numbers never outlive the workbench that produced them.
  useEffect(() => {
    if (!onStatsChange) {
      return;
    }
    if (!activeDocument) {
      onStatsChange(null);
      return;
    }
    onStatsChange({
      documentName: activeDocument.name,
      counts,
      activeOrdinal: activeSegment?.ordinal ?? null,
    });
  }, [onStatsChange, activeDocument, counts, activeSegment]);
  useEffect(() => {
    return () => {
      onStatsChange?.(null);
    };
  }, [onStatsChange]);

  // Jump target may be hidden by the active filter; clear it so the jump
  // always lands (QA "定位句段", concordance hits, preview clicks).
  const jumpToSegment = useCallback(
    (segmentId: string) => {
      const visible = filteredSegments.some(
        (segment) => segment.id === segmentId,
      );
      if (!visible) {
        setFilter(EMPTY_FILTER);
      }
      setActiveSegmentId(segmentId);
    },
    [filteredSegments],
  );

  // Opens concordance seeded with the current text selection, in line with
  // the classic CAT shortcut. Shared by the F3 chord, the menu command,
  // and the ribbon button so all take the exact same path.
  const openConcordance = useCallback(() => {
    const selection = readTextSelection();
    if (selection.length > 0) {
      setConcordanceSeed(selection);
    }
    setTab("concordance");
  }, []);

  const focusFilter = useCallback(() => {
    const input = filterInputRef.current;
    // The ribbon search box is always mounted but disabled without a
    // document; report false instead of pretending to focus it.
    if (!input || input.disabled) {
      return false;
    }
    input.focus();
    input.select();
    return true;
  }, []);

  const focusFind = useCallback(() => {
    const input = findInputRef.current;
    if (!input) {
      return false;
    }
    input.focus();
    input.select();
    return true;
  }, []);

  // Find next/prev (F4 / Shift+F4, menu 查找下一个/查找上一个): moves the
  // selection to the next visible segment whose source or target contains
  // the find query. It searches the currently visible rows, so it never
  // hides anything and never clears an active filter; wrapping and misses
  // are reported honestly instead of silently doing nothing.
  const findMatch = useCallback(
    (direction: "next" | "prev") => {
      if (!activeDocument) {
        return;
      }
      const query = findQuery.trim();
      if (query.length === 0) {
        // No query yet: land the user in the find box instead of guessing.
        focusFind();
        return;
      }
      const result = findSegmentMatch(
        filteredSegments,
        query,
        activeSegmentId,
        direction,
      );
      if (!result) {
        onStatusMessage(`查找「${query}」：没有匹配`);
        return;
      }
      setActiveSegmentId(result.segment.id);
      if (result.wrapped) {
        onStatusMessage(
          direction === "next"
            ? `查找「${query}」：已从头继续，跳到句段 #${result.segment.ordinal + 1}`
            : `查找「${query}」：已从末尾继续，跳到句段 #${result.segment.ordinal + 1}`,
        );
      }
    },
    [
      activeDocument,
      findQuery,
      filteredSegments,
      activeSegmentId,
      focusFind,
      onStatusMessage,
    ],
  );

  const focusReplace = useCallback(() => {
    const input = replaceInputRef.current;
    if (!input) {
      return false;
    }
    input.focus();
    input.select();
    return true;
  }, []);

  // 替换: replace every occurrence of the find query inside the active
  // segment's saved target (case-insensitive, like find). A confirmed
  // segment is only rewritten with 含已确认 checked — the engine then holds
  // it as a draft again, since the confirmation covered the old text. When
  // the active segment has no match, this acts as find-next instead of
  // silently doing nothing.
  const replaceInActive = useCallback(async () => {
    if (!activeDocument) {
      return;
    }
    const query = findQuery.trim();
    if (query.length === 0) {
      focusFind();
      return;
    }
    if (!activeSegment) {
      findMatch("next");
      return;
    }
    const replaced = replaceSegmentText(
      activeSegment.targetText,
      query,
      replaceWith,
    );
    if (!replaced) {
      findMatch("next");
      return;
    }
    if (activeSegment.state === "confirmed" && !includeConfirmed) {
      onStatusMessage(
        `句段 #${activeSegment.ordinal + 1} 已确认，未替换；勾选「含已确认」后重试（替换会使其退回草稿）`,
      );
      return;
    }
    try {
      const result = await callEngine("segment.update", {
        segmentId: activeSegment.id,
        targetText: replaced.text,
        baseRevision: activeSegment.revision,
      });
      applySegments([result.segment]);
      onStatusMessage(
        `句段 #${activeSegment.ordinal + 1} 已替换 ${replaced.count} 处「${query}」，按 F4 跳到下一个匹配`,
      );
    } catch (error) {
      onStatusMessage(`替换失败：${describeError(error)}`);
      await reloadSegments();
    }
  }, [
    activeDocument,
    activeSegment,
    findQuery,
    replaceWith,
    includeConfirmed,
    focusFind,
    findMatch,
    applySegments,
    onStatusMessage,
    reloadSegments,
  ]);

  // 全部替换: one engine call rewrites every matching target in the whole
  // document (not just the filtered rows), in a single transaction. The
  // result is applied to the loaded grid and reported with honest counts,
  // including confirmed segments that were skipped or demoted to draft.
  const replaceAllInDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }
    const query = findQuery.trim();
    if (query.length === 0) {
      focusFind();
      return;
    }
    setBusy(true);
    try {
      const result = await callEngine("segment.replace", {
        documentId: activeDocument.id,
        find: query,
        replaceWith,
        includeConfirmed,
      });
      applySegments(result.segments);
      const skippedNote =
        result.skippedConfirmed > 0
          ? `；跳过 ${result.skippedConfirmed} 个已确认句段（勾选「含已确认」后可替换）`
          : "";
      if (result.segments.length === 0) {
        onStatusMessage(`全部替换：译文中没有「${query}」${skippedNote}`);
        return;
      }
      const demotedNote =
        result.demotedConfirmed > 0
          ? `；${result.demotedConfirmed} 个已确认句段退回草稿`
          : "";
      onStatusMessage(
        `全部替换完成：${result.segments.length} 个句段、${result.replacedOccurrences} 处「${query}」→「${replaceWith}」${demotedNote}${skippedNote}`,
      );
    } catch (error) {
      onStatusMessage(`全部替换失败：${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }, [
    activeDocument,
    findQuery,
    replaceWith,
    includeConfirmed,
    focusFind,
    applySegments,
    onStatusMessage,
  ]);

  // Confirms the live editor draft — the exact command the grid editor's
  // Ctrl+Enter fires. Shared by the ribbon button and the menu item; both
  // report honestly when no editor is mounted instead of guessing.
  const confirmActiveSegment = useCallback(() => {
    if (!gridRef.current?.confirmActive()) {
      onStatusMessage("没有正在编辑的句段，无法确认");
    }
  }, [onStatusMessage]);

  // Workbench keymap (renderer-owned; the application menu displays these
  // accelerators but does not register them, so the raw events land here):
  // F3 concordance, F4/Shift+F4 find next/prev, Ctrl/Cmd+F focus the
  // segment filter, Ctrl/Cmd+H focus the replace box, Alt+↑/↓ step the
  // segment selection (works while typing in the target editor).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F3") {
        event.preventDefault();
        openConcordance();
        return;
      }
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        moveSelection(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      // Plain F4 / Shift+F4 only — never Alt+F4 (OS window close) or
      // Ctrl/Cmd+F4 combinations.
      if (
        event.key === "F4" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        findMatch(event.shiftKey ? "prev" : "next");
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "f" || event.key === "F")
      ) {
        if (focusFilter()) {
          event.preventDefault();
        }
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "h" || event.key === "H")
      ) {
        if (focusReplace()) {
          event.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openConcordance, focusFilter, focusReplace, findMatch, moveSelection]);

  // Application menu commands. Every branch reuses the exact handler the
  // corresponding ribbon button/shortcut already calls; state guards keep
  // the commands honest even if a click races a state change.
  const handleMenuCommand = useCallback(
    (command: MenuCommand) => {
      const dockTab = DOCK_COMMANDS[command];
      if (dockTab) {
        setTab(dockTab);
        return;
      }
      switch (command) {
        case "import-document":
          if (!busy) {
            setImportOpen(true);
          }
          break;
        case "export-document":
          if (!busy) {
            void exportDocument();
          }
          break;
        case "open-preview":
          if (activeDocument) {
            setPreviewOpen(true);
          }
          break;
        case "open-concordance":
          openConcordance();
          break;
        case "focus-filter":
          focusFilter();
          break;
        case "focus-replace":
          focusReplace();
          break;
        case "find-next":
          findMatch("next");
          break;
        case "find-prev":
          findMatch("prev");
          break;
        case "confirm-segment":
          confirmActiveSegment();
          break;
        default:
          break;
      }
    },
    [
      busy,
      exportDocument,
      activeDocument,
      openConcordance,
      focusFilter,
      focusReplace,
      findMatch,
      confirmActiveSegment,
    ],
  );

  // Subscribe once; dispatch through a ref so command handling always sees
  // the latest workbench state without resubscribing across the bridge.
  const menuCommandRef = useRef(handleMenuCommand);
  useEffect(() => {
    menuCommandRef.current = handleMenuCommand;
  }, [handleMenuCommand]);
  useEffect(() => {
    return window.tl.onMenuCommand((command) => {
      menuCommandRef.current(command);
    });
  }, []);

  return (
    <AiStatusProvider>
      <main className="workbench">
        <Ribbon
          documentOpen={activeDocument !== null}
          busy={busy}
          filterQuery={filter.query}
          filterActive={isFilterActive(filter)}
          filteredCount={filteredSegments.length}
          totalCount={counts.total}
          filterInputRef={filterInputRef}
          onFilterQueryChange={(value) =>
            setFilter((current) => ({ ...current, query: value }))
          }
          onClearFilter={() => setFilter(EMPTY_FILTER)}
          onCloseProject={onCloseProject}
          onOpenTmManage={onOpenTmManage}
          onImport={() => setImportOpen(true)}
          onExport={() => void exportDocument()}
          onConfirmSegment={confirmActiveSegment}
          onPretranslate={() => void pretranslate()}
          onFocusFind={() => focusFind()}
          onFocusReplace={() => focusReplace()}
          onFocusFilter={() => focusFilter()}
          onConcordance={openConcordance}
        />

        <aside className="workbench__explorer">
          <section
            className="explorer__section explorer__section--project"
            aria-label="项目"
          >
            <header className="explorer__heading">
              <h2 className="explorer__caption">项目</h2>
              {onOpenSettings ? (
                <button
                  type="button"
                  className="explorer__gear"
                  aria-label="项目设置"
                  title="项目设置"
                  onClick={onOpenSettings}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10 4.09V4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56h.08a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08A1.7 1.7 0 0 0 21 12h.09a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6-1z" />
                  </svg>
                </button>
              ) : null}
            </header>
            <p className="project-explorer__name">{project.name}</p>
            <p className="explorer__langs">
              语言对：
              <span className="tl-num">
                {project.sourceLocale} → {project.targetLocale}
              </span>
            </p>
            {projectPercent !== null ? (
              <div className="explorer__progress">
                <span className="explorer__progress-label">
                  进度：<span className="tl-num">{projectPercent}%</span>
                </span>
                <SegmentProgress
                  total={projectTotals.total}
                  confirmed={projectTotals.confirmed}
                  draft={projectTotals.draft}
                  label={`已确认 ${projectTotals.confirmed}/${projectTotals.total}`}
                />
              </div>
            ) : null}
          </section>

          <section
            className="explorer__section explorer__section--files"
            aria-label="文件"
          >
            <header className="explorer__heading">
              <h2 className="explorer__caption">文件</h2>
            </header>
            {documents.length === 0 ? (
              <EmptyState
                title="暂无文档"
                hint="导入 DOCX、TXT、Markdown、HTML、XLIFF、XLSX 或 PPTX 开始翻译。"
              />
            ) : (
              <div className="document-list">
                {documents.map((document) => {
                  const progress = documentProgress[document.id];
                  return (
                    <div
                      key={document.id}
                      className="document-list__item"
                      data-active={document.id === activeDocumentId}
                    >
                      <button
                        type="button"
                        className="document-list__select"
                        onClick={() => void loadDocument(document.id)}
                      >
                        <span className="document-list__name">
                          {document.name}
                        </span>
                        <span className="document-list__meta">
                          {progress
                            ? `${document.format} · 确认 ${progress.confirmed}/${progress.total}${
                                progress.draft > 0
                                  ? ` · 草稿 ${progress.draft}`
                                  : ""
                              }${
                                progress.openIssues > 0
                                  ? ` · QA ${progress.openIssues}`
                                  : ""
                              }`
                            : `${document.format} · ${document.segmentCount} 句段`}
                        </span>
                        {progress && progress.total > 0 ? (
                          <span className="document-list__progress">
                            <SegmentProgress
                              total={progress.total}
                              confirmed={progress.confirmed}
                              draft={progress.draft}
                              label={`已确认 ${progress.confirmed}/${progress.total}`}
                            />
                            <span className="tl-num document-list__pct">
                              {Math.round(
                                (progress.confirmed / progress.total) * 100,
                              )}
                              %
                            </span>
                          </span>
                        ) : null}
                      </button>
                      {pendingRemoveId === document.id ? (
                        <span
                          className="document-list__confirm"
                          role="group"
                          aria-label={`确认移除 ${document.name}`}
                        >
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => void removeDocument(document)}
                            disabled={busy}
                          >
                            确认移除
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPendingRemoveId(null)}
                            disabled={busy}
                          >
                            取消
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="document-list__remove"
                          aria-label={`移除 ${document.name}`}
                          onClick={() => setPendingRemoveId(document.id)}
                          disabled={busy}
                        >
                          移除
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section
            className="explorer__section explorer__section--details"
            aria-label="项目详情"
          >
            <header className="explorer__heading">
              <h2 className="explorer__caption">项目详情</h2>
            </header>
            <dl className="explorer__details">
              <div className="explorer__detail">
                <dt>名称</dt>
                <dd>{project.name}</dd>
              </div>
              <div className="explorer__detail">
                <dt>源语言</dt>
                <dd className="tl-num">{project.sourceLocale}</dd>
              </div>
              <div className="explorer__detail">
                <dt>目标语言</dt>
                <dd className="tl-num">{project.targetLocale}</dd>
              </div>
              <div className="explorer__detail">
                <dt>创建时间</dt>
                <dd>
                  {new Date(project.createdAtMs).toLocaleDateString("zh-CN")}
                </dd>
              </div>
              <div className="explorer__detail">
                <dt>文件数</dt>
                <dd className="tl-num">{documents.length}</dd>
              </div>
              <div className="explorer__detail">
                <dt>总句段</dt>
                <dd className="tl-num">{projectTotals.total}</dd>
              </div>
              {projectTotals.hasProgress ? (
                <div className="explorer__detail">
                  <dt>已确认句段</dt>
                  <dd className="tl-num">
                    {projectTotals.confirmed}
                    {projectPercent !== null ? `（${projectPercent}%）` : ""}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>

        <section className="workbench__center">
          {openDocuments.length > 0 ? (
            <div className="doc-tabs" role="tablist" aria-label="打开的文档">
              {openDocuments.map((document) => (
                <div
                  key={document.id}
                  className="doc-tabs__tab"
                  data-active={document.id === activeDocumentId}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={document.id === activeDocumentId}
                    className="doc-tabs__select"
                    onClick={() => void loadDocument(document.id)}
                  >
                    {document.name}
                  </button>
                  <button
                    type="button"
                    className="doc-tabs__close"
                    aria-label={`关闭标签页 ${document.name}`}
                    title="关闭标签页（文档保留在项目中）"
                    onClick={() => closeDocumentTab(document.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {activeDocument ? (
            <>
              {overwritePrompt ? (
                <ExportOverwriteConfirm
                  path={overwritePrompt.outputPath}
                  busy={busy}
                  onOverwrite={() => void confirmOverwriteExport()}
                  onCancel={cancelOverwriteExport}
                />
              ) : null}
              {unackedWrite ? (
                <div
                  className="honest-note workbench-unacked"
                  data-tone="danger"
                  role="alert"
                >
                  <span>
                    句段 #{unackedWrite.ordinal + 1} 的
                    {unackedWrite.kind === "draft" ? "草稿" : "确认"}
                    未被引擎确认写入（{unackedWrite.message}）。
                    编辑器中的文本仍保留；
                    {unackedWrite.kind === "draft"
                      ? "引擎恢复后继续输入即可自动重新保存，或按 Ctrl+Enter 确认。"
                      : "引擎恢复后请重新确认该句段（Ctrl+Enter）。"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setUnackedWrite(null)}
                  >
                    知道了
                  </Button>
                </div>
              ) : null}
              <div className="grid-toolbar">
                <select
                  className="grid-toolbar__select"
                  aria-label="按状态筛选"
                  value={filter.state}
                  onChange={(event) =>
                    setFilter((current) => ({
                      ...current,
                      state: event.target.value as SegmentStateFilter,
                    }))
                  }
                >
                  {STATE_FILTER_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="grid-toolbar__sep" />
                <input
                  ref={findInputRef}
                  className="grid-toolbar__search grid-toolbar__find"
                  aria-label="查找跳转"
                  placeholder="查找（F4 下一个）…"
                  title="跳到下一个匹配句段，不隐藏其他句段"
                  value={findQuery}
                  onChange={(event) => setFindQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) {
                      // Enter mid-IME commits the composed text, not a jump.
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      findMatch(event.shiftKey ? "prev" : "next");
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="查找上一个"
                  title="查找上一个（Shift+F4）"
                  disabled={findQuery.trim().length === 0}
                  onClick={() => findMatch("prev")}
                >
                  上一个
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="查找下一个"
                  title="查找下一个（F4）"
                  disabled={findQuery.trim().length === 0}
                  onClick={() => findMatch("next")}
                >
                  下一个
                </Button>
                <input
                  ref={replaceInputRef}
                  className="grid-toolbar__search grid-toolbar__find"
                  aria-label="替换为"
                  placeholder="替换为…（Ctrl+H）"
                  title="替换查找命中的译文文本；源文永不修改"
                  value={replaceWith}
                  onChange={(event) => setReplaceWith(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) {
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void replaceInActive();
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="替换"
                  title="替换当前句段译文中的所有匹配；无匹配时跳到下一个"
                  disabled={findQuery.trim().length === 0 || busy}
                  onClick={() => void replaceInActive()}
                >
                  替换
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="全部替换"
                  title="替换当前文档所有句段译文中的匹配（不限当前筛选）"
                  disabled={findQuery.trim().length === 0 || busy}
                  onClick={() => void replaceAllInDocument()}
                >
                  全部替换
                </Button>
                <label
                  className="grid-toolbar__checkbox"
                  title="勾选后替换也会改写已确认句段，并使其退回草稿；TM 不受影响"
                >
                  <input
                    type="checkbox"
                    checked={includeConfirmed}
                    onChange={(event) =>
                      setIncludeConfirmed(event.target.checked)
                    }
                  />
                  含已确认
                </label>
              </div>
              {segments.length === 0 ? (
                <EmptyState title="该文档没有句段" />
              ) : filteredSegments.length === 0 ? (
                <EmptyState
                  title="没有符合筛选条件的句段"
                  hint="调整状态筛选或右上角的文本搜索，或点击「清除」。"
                />
              ) : (
                <SegmentGrid
                  ref={gridRef}
                  segments={filteredSegments}
                  activeSegmentId={activeSegmentId}
                  activeMatch={bestTmMatch}
                  sourceLocale={project.sourceLocale}
                  targetLocale={project.targetLocale}
                  qaSegmentIds={openIssueSegmentIds}
                  onSelect={setActiveSegmentId}
                  onSaveDraft={(segment, text) =>
                    saveDraft(segment, text, { quiet: true })
                  }
                  onConfirm={(segment, text) =>
                    void confirmSegment(segment, text)
                  }
                />
              )}
              <div className="view-tabs" role="tablist" aria-label="视图">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!previewOpen}
                  className="view-tabs__tab"
                  data-active={!previewOpen}
                >
                  文本
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewOpen}
                  className="view-tabs__tab"
                  data-active={previewOpen}
                  title="打开译文预览（校对视图与版式视图）"
                  onClick={() => setPreviewOpen(true)}
                >
                  预览
                </button>
              </div>
            </>
          ) : (
            <div className="workbench__center-empty">
              {documents.length === 0 ? (
                <EmptyState
                  title="选择或导入一个文档"
                  hint="通过工具栏「导入」添加文档后，句段会在这里以网格显示。"
                />
              ) : (
                <EmptyState
                  title="没有打开的文档"
                  hint="在左侧文件列表中点击文件即可打开。"
                />
              )}
            </div>
          )}
        </section>

        <aside className="workbench__dock">
          <nav className="dock-tabs">
            {(
              [
                ["tm", "TM"],
                ["term", "术语"],
                ["concordance", "检索"],
                ["qa", "QA"],
                ["ai", "AI 辅助"],
                ["agent", "Agent"],
              ] as Array<[DockTab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                data-active={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
                {/* Live chips react to the active segment/document. They are
                    aria-hidden so accessible names stay stable ("TM", "QA");
                    the same numbers live accessibly in the panel titles. */}
                {key === "tm" && bestTmMatch ? (
                  <span
                    className="dock-tabs__chip"
                    data-tone={bestTmMatch.grade === "fuzzy" ? "accent" : "ok"}
                    aria-hidden="true"
                  >
                    {bestTmMatch.score}%
                  </span>
                ) : null}
                {key === "qa" && openIssueCount > 0 ? (
                  <span
                    className="dock-tabs__chip"
                    data-tone="danger"
                    aria-hidden="true"
                  >
                    {openIssueCount}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
          {/* Keyed by tab: switching docks replays a short entrance slide. */}
          <div className="dock-panel dock-view" key={tab}>
            {tab === "tm" ? (
              <TmPanel
                activeSegment={activeSegment}
                matches={tmMatches}
                error={tmError}
                onApply={applyDraftToActive}
              />
            ) : null}
            {tab === "term" ? (
              <TermPanel
                projectId={project.id}
                targetLocale={project.targetLocale}
                activeSegment={activeSegment}
                onInsert={insertTermToActive}
              />
            ) : null}
            {tab === "concordance" ? (
              <ConcordancePanel
                projectId={project.id}
                segments={segments}
                initialQuery={concordanceSeed}
                onJump={jumpToSegment}
              />
            ) : null}
            {tab === "qa" ? (
              <QaPanel
                issues={issues}
                onRun={() => void runQa()}
                onJump={jumpToSegment}
                onWaive={(issue) => void setIssueWaived(issue, true)}
                onRestore={(issue) => void setIssueWaived(issue, false)}
                pendingIssueId={waivePendingId}
                disabled={!activeDocumentId}
              />
            ) : null}
            {tab === "ai" ? (
              <AiPanel
                activeSegment={activeSegment}
                onApplyDraft={applyDraftToActive}
                onStatusMessage={onStatusMessage}
              />
            ) : null}
            {tab === "agent" ? (
              <AgentPanel
                documentId={activeDocumentId}
                onCompleted={() => {
                  void reloadSegments();
                  void runQa();
                }}
                onStatusMessage={onStatusMessage}
                onGoExport={() => void exportDocument()}
              />
            ) : null}
          </div>
        </aside>

        <ImportDocumentDialog
          open={importOpen}
          project={project}
          onClose={() => setImportOpen(false)}
          onImported={(result) => void handleImported(result)}
          onProjectUpdated={onProjectUpdated}
        />

        {activeDocument ? (
          <PreviewDialog
            open={previewOpen}
            documentId={activeDocument.id}
            documentName={activeDocument.name}
            documentFormat={activeDocument.format}
            segments={segments}
            activeSegmentId={activeSegmentId}
            onClose={() => setPreviewOpen(false)}
            onJump={(segmentId) => {
              setPreviewOpen(false);
              jumpToSegment(segmentId);
            }}
          />
        ) : null}
      </main>
    </AiStatusProvider>
  );
}
