import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  IconClipboardCheck,
  IconDatabase,
  IconSettings,
  IconSparkles,
  IconVocabulary,
} from "@tabler/icons-react";

import type {
  Document,
  DocumentImportResult,
  Project,
  QaFix,
  QaIssue,
  Segment,
  SegmentCounts,
  SegmentOrigin,
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
  qaGateBlock,
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
import { CommandPalette } from "../components/CommandPalette.js";
import type { PaletteEntry } from "../components/CommandPalette.js";
import { FindWidget } from "../components/FindWidget.js";
import { ImportDocumentDialog } from "../components/ImportDocumentDialog.js";
import { Ribbon } from "../components/Ribbon.js";
import { SegmentGrid } from "../components/SegmentGrid.js";
import type {
  ConfirmMode,
  EditorCaret,
  SegmentGridHandle,
} from "../components/SegmentGrid.js";
import { TmPanel } from "../components/TmPanel.js";
import { TermPanel } from "../components/TermPanel.js";
import { ConcordancePanel } from "../components/ConcordancePanel.js";
import { QaPanel } from "../components/QaPanel.js";
import { AiPanel } from "../components/AiPanel.js";
import { AgentPanel } from "../components/AgentPanel.js";
import { ExportOverwriteConfirm } from "../components/ExportOverwriteConfirm.js";
import { ExportQaGateConfirm } from "../components/ExportQaGateConfirm.js";
import { PreviewPane } from "../components/PreviewPane.js";
import {
  DEFAULT_LAYOUT,
  LAYOUT_LIMITS,
  Splitter,
  useWorkbenchLayout,
} from "../components/Splitter.js";

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
  /**
   * Registers the status-bar readout jump (clicking 草稿/QA filters the
   * grid to that state); called with null on unmount so the shell never
   * holds a jump into a closed workbench.
   */
  onRegisterStatJump?: (jump: ((target: StatJumpTarget) => void) | null) => void;
  /** Opens the project settings dialog (owned by the shell). */
  onOpenSettings?: () => void;
  /** Opens the TM manage dialog (owned by the shell). */
  onOpenTmManage?: () => void;
  /** Returns to the projects list (same path as the menu command). */
  onCloseProject?: () => void;
}

/** Status-bar readouts that jump to a grid filter (PRD §3.8). */
export type StatJumpTarget = "draft" | "qa";

/** What the shell status bar shows about the open document. */
export interface WorkbenchStats {
  documentName: string;
  counts: SegmentCounts;
  /**
   * Source word count reported by the engine (口径：UAX #29；CJK 按字；
   * 数字串计 1；URL/email 计 1). Null when the engine did not report one
   * (older binary) — the readout then renders nothing, never a local count.
   */
  sourceWords: number | null;
  /** Ordinal of the selected segment, or null when nothing is selected. */
  activeOrdinal: number | null;
  /** Caret line/column in the target editor; null with no editor mounted. */
  caret: EditorCaret | null;
}

/**
 * Four dock groups (PRD §3.7): 记忆 (TM lookup + 检索), 术语, QA, and
 * AI (辅助 + Agent as two sections of one honest AI surface).
 */
type DockTab = "memory" | "term" | "qa" | "ai";

/** Menu dock commands map onto the same tabs the dock buttons switch. */
const DOCK_COMMANDS: Partial<Record<MenuCommand, DockTab>> = {
  "show-dock-memory": "memory",
  "show-dock-term": "term",
  "show-dock-qa": "qa",
  "show-dock-ai": "ai",
};

/** Ctrl+1..4 ↔ dock order, kept identical to the menu accelerators. */
const DOCK_ORDER: DockTab[] = ["memory", "term", "qa", "ai"];

const DOCK_ICON = { size: 14, stroke: 1.75, "aria-hidden": true } as const;

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

/** Chip labels for active state filters (never shows 全部状态). */
const STATE_FILTER_LABEL = new Map<SegmentStateFilter, string>(
  STATE_FILTER_OPTIONS,
);

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
  onRegisterStatJump,
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
  // Engine-proposed corrections for the open findings (PRD S3 ④). Always
  // fetched, never computed locally — a 应用修复 button exists exactly when
  // the engine proposed a fix.
  const [fixes, setFixes] = useState<QaFix[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [tab, setTab] = useState<DockTab>("memory");
  const [busy, setBusy] = useState(false);
  // Caret line/column reported by the grid's target editor (status bar).
  const [caret, setCaret] = useState<EditorCaret | null>(null);
  // Explorer file search (PRD §3.5): local filter over the in-memory
  // document list, no RPC.
  const [fileQuery, setFileQuery] = useState("");
  const [filter, setFilter] = useState<SegmentFilterSpec>(EMPTY_FILTER);
  // Mirror for the global keydown handler (Esc clears the filter) so the
  // listener never resubscribes on every filter keystroke.
  const filterRef = useRef(filter);
  filterRef.current = filter;
  // Find next/prev query (F4 / Shift+F4). Unlike `filter`, it never hides
  // rows: it only moves the selection through matching segments.
  const [findQuery, setFindQuery] = useState("");
  // Replacement text for 替换/全部替换; replaces occurrences of the find
  // query inside target text only.
  const [replaceWith, setReplaceWith] = useState("");
  // Whether replace may rewrite confirmed segments (demoting them back to
  // draft). Off by default: confirmed work is skipped and reported.
  const [includeConfirmed, setIncludeConfirmed] = useState(false);
  // The floating find widget (Ctrl+F find row, Ctrl+H adds the replace
  // row). `findSummon` bumps on every summon chord so an already-open
  // widget still re-focuses its input.
  const [findOpen, setFindOpen] = useState(false);
  const [findMode, setFindMode] = useState<"find" | "replace">("find");
  const [findSummon, setFindSummon] = useState(0);
  const [concordanceSeed, setConcordanceSeed] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Rail widths / collapse / preview pane, persisted per project.
  const [layout, updateLayout] = useWorkbenchLayout(project.id);
  const gridRef = useRef<SegmentGridHandle | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Two-step remove: the first 移除 click only arms this id; the row then
  // shows 确认移除/取消 and nothing is deleted until the explicit confirm.
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [unackedWrite, setUnackedWrite] = useState<UnackedWrite | null>(null);
  // QA issue whose waive/restore call is in flight (locks its button).
  const [waivePendingId, setWaivePendingId] = useState<string | null>(null);
  // An export the engine refused because the destination exists. Kept until
  // the user explicitly picks 覆盖 (retry with overwrite) or 取消 (leave the
  // existing file untouched). `overrideQaGate` remembers that the user
  // already passed the QA gate for this export, so the overwrite retry
  // carries the decision instead of re-refusing.
  const [overwritePrompt, setOverwritePrompt] = useState<{
    documentId: string;
    outputPath: string;
    overrideQaGate?: boolean;
  } | null>(null);
  // An export the QA gate refused (error-severity open issues). Kept until
  // the user explicitly picks 仍要导出 (retry with overrideQaGate) or 取消.
  const [qaGatePrompt, setQaGatePrompt] = useState<{
    documentId: string;
    outputPath: string;
    openErrors: number;
    ruleIds: string[];
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
      setQaGatePrompt(null);
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
    setQaGatePrompt(null);
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
        onStatusMessage("引擎已恢复，已重新同步");
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
          `已移除「${target.name}」：删除 ${result.removedSegments} 个句段、${result.removedQaIssues} 条 QA 记录`,
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

  // Pull the persisted issue rows after an engine-side qa.run (the export
  // gate runs one), so the panel shows exactly the findings that blocked.
  const refreshIssues = useCallback(async (documentId: string) => {
    try {
      const result = await callEngine("qa.list", { documentId });
      setIssues(result.issues);
    } catch {
      // Keep the current list; the gate prompt already carries the counts.
    }
  }, []);

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
    setQaGatePrompt(null);
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
      const gate = qaGateBlock(error);
      if (gate) {
        // The QA gate refused; the user decides to fix, waive, or export
        // anyway. Refreshing the panel here keeps the findings in view.
        setQaGatePrompt({
          documentId: activeDocument.id,
          outputPath,
          openErrors: gate.openErrors,
          ruleIds: gate.ruleIds,
        });
        void refreshIssues(activeDocument.id);
      } else if (isExportBlocked(error)) {
        // The engine never clobbers silently; hand the decision to the user.
        setOverwritePrompt({ documentId: activeDocument.id, outputPath });
      } else {
        onStatusMessage(`导出失败：${describeError(error)}`);
      }
    } finally {
      setBusy(false);
    }
  }, [activeDocument, onStatusMessage, refreshIssues]);

  // 仍要导出: the user's explicit decision to pass the QA gate this once.
  const confirmQaGateExport = useCallback(async () => {
    if (!qaGatePrompt) {
      return;
    }
    setBusy(true);
    try {
      const result = await callEngine("document.export", {
        documentId: qaGatePrompt.documentId,
        outputPath: qaGatePrompt.outputPath,
        overrideQaGate: true,
      });
      setQaGatePrompt(null);
      onStatusMessage(
        `导出完成：${result.outputPath}（${result.translatedSegments} 个已译单元）`,
      );
    } catch (error) {
      setQaGatePrompt(null);
      if (isExportBlocked(error) && !qaGateBlock(error)) {
        // The gate is passed but the destination exists; the overwrite
        // retry keeps the gate decision.
        setOverwritePrompt({
          documentId: qaGatePrompt.documentId,
          outputPath: qaGatePrompt.outputPath,
          overrideQaGate: true,
        });
      } else {
        onStatusMessage(`导出失败：${describeError(error)}`);
      }
    } finally {
      setBusy(false);
    }
  }, [qaGatePrompt, onStatusMessage]);

  // 取消: nothing was exported; the findings stay in the QA panel.
  const cancelQaGateExport = useCallback(() => {
    setQaGatePrompt(null);
    onStatusMessage("已取消导出");
  }, [onStatusMessage]);

  // 覆盖: retry the blocked export with the explicit overwrite flag (and
  // the already-made QA gate decision, when the export came through it).
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
        ...(overwritePrompt.overrideQaGate ? { overrideQaGate: true } : {}),
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
    onStatusMessage("已取消导出");
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

  // Open-issue counts per segment feed the ⚠n overlay on the status chip.
  const openIssueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      if (issue.status === "open") {
        counts.set(issue.segmentId, (counts.get(issue.segmentId) ?? 0) + 1);
      }
    }
    return counts;
  }, [issues]);

  // Open placeholder-QA evidence per segment: the exact tokens the engine
  // flagged (missing → source side, extra → target side) drive the danger
  // outline on the grid's token highlighting. Straight from qa.list — the
  // renderer never re-diffs placeholders on its own.
  const placeholderAlerts = useMemo(() => {
    const alerts = new Map<string, { missing: Set<string>; extra: Set<string> }>();
    for (const issue of issues) {
      if (issue.status !== "open") {
        continue;
      }
      const isMissing = issue.ruleId === "qa.tag-placeholder_missing";
      const isExtra = issue.ruleId === "qa.tag-placeholder_extra";
      if (!isMissing && !isExtra) {
        continue;
      }
      let alert = alerts.get(issue.segmentId);
      if (!alert) {
        alert = { missing: new Set(), extra: new Set() };
        alerts.set(issue.segmentId, alert);
      }
      for (const value of issue.evidence.sourceValues ?? []) {
        alert.missing.add(value);
      }
      for (const value of issue.evidence.targetValues ?? []) {
        alert.extra.add(value);
      }
    }
    return alerts;
  }, [issues]);

  const filteredSegments = useMemo(
    () => filterSegments(segments, filter, openIssueSegmentIds),
    [segments, filter, openIssueSegmentIds],
  );

  // Trados-style flow: after a confirm, the selection steps to the next
  // visible segment per the chord's navigation policy, so the keyboard
  // loop stays type → Ctrl+Enter → type. `written` carries the freshly
  // confirmed and propagated rows (state updates land asynchronously).
  // Nothing wraps: at the bottom of the document the selection stays put.
  const advanceAfterConfirm = useCallback(
    (confirmedId: string, written: Segment[], mode: ConfirmMode) => {
      if (mode === "stay") {
        return;
      }
      const writtenById = new Map(written.map((item) => [item.id, item]));
      const index = filteredSegments.findIndex(
        (item) => item.id === confirmedId,
      );
      if (index < 0) {
        return;
      }
      for (let i = index + 1; i < filteredSegments.length; i += 1) {
        const candidate = filteredSegments[i]!;
        const fresh = writtenById.get(candidate.id);
        // Locked rows are read-only, so both chords step past them
        // (Studio behavior) — landing there would strand the keyboard
        // loop on a row that refuses its editor.
        if (fresh?.locked ?? candidate.locked) {
          continue;
        }
        const state = fresh?.state ?? candidate.state;
        if (mode === "nextAny" || state !== "confirmed") {
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
  // retries the text on its next flush. Writes that apply stored material
  // (TM match, AI draft) pass `origin` so the engine stamps where the text
  // came from; plain typing omits it and the engine handles the edited mark.
  const saveDraft = useCallback(
    (
      segment: Segment,
      targetText: string,
      options?: { quiet?: boolean; origin?: SegmentOrigin },
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
            ...(options?.origin ? { origin: options.origin } : {}),
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
    (
      segment: Segment,
      targetText: string,
      mode: ConfirmMode,
    ): Promise<void> => {
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
          // Confirm-time QA: the engine re-ran the segment-scoped rules in
          // the same transaction and returned every persisted issue of this
          // segment, so its records are replaced wholesale — the dock and
          // the row's ⚠ badge update without a manual qa.run. Absent field
          // (older engine) leaves the list untouched.
          const refreshedQa = result.qaIssues;
          if (refreshedQa) {
            setIssues((currentIssues) => [
              ...currentIssues.filter(
                (issue) => issue.segmentId !== segment.id,
              ),
              ...refreshedQa,
            ]);
          }
          const openQaCount =
            refreshedQa?.filter((issue) => issue.status === "open").length ??
            0;
          const propagated =
            result.propagated.length > 0
              ? `，TM 传播 ${result.propagated.length} 个重复句段`
              : "";
          const qaNote = openQaCount > 0 ? `，QA ${openQaCount} 个问题` : "";
          onStatusMessage(
            `句段 #${segment.ordinal + 1} 已确认并写入 TM${propagated}${qaNote}`,
          );
          advanceAfterConfirm(
            segment.id,
            [result.segment, ...result.propagated],
            mode,
          );
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

  // TM apply stamps the real lookup grade and score as the origin. The
  // contract's `inContext` grade is a dead variant no lookup emits; it
  // would still be an exact-source reuse if one ever appeared.
  const applyTmMatchToActive = useCallback(
    (match: TmMatchItem) => {
      if (!activeSegment) {
        return;
      }
      void saveDraft(activeSegment, match.entry.targetText, {
        origin: {
          kind: match.grade === "fuzzy" ? "tmFuzzy" : "tmExact",
          score: match.score,
        },
      });
    },
    [activeSegment, saveDraft],
  );

  // AI apply stamps aiDraft with the provider model — never a score (no
  // provider returns confidence).
  const applyAiDraftToActive = useCallback(
    (text: string, model: string) => {
      if (!activeSegment) {
        return;
      }
      void saveDraft(activeSegment, text, {
        origin: { kind: "aiDraft", model },
      });
    },
    [activeSegment, saveDraft],
  );

  // Row menu 复制源文: the source text becomes the draft via the same
  // segment.update path as typing (quiet save + a purpose-named message).
  const copySourceToTarget = useCallback(
    (segment: Segment) => {
      void saveDraft(segment, segment.sourceText, { quiet: true }).then(
        (acked) => {
          if (acked) {
            onStatusMessage(`句段 #${segment.ordinal + 1} 已复制源文为草稿`);
          }
        },
      );
    },
    [saveDraft, onStatusMessage],
  );

  // Row menu 清空译文: an empty segment.update — the engine honestly
  // returns the segment to 未译 (an empty target has no draft meaning).
  const clearTargetText = useCallback(
    (segment: Segment) => {
      void saveDraft(segment, "", { quiet: true }).then((acked) => {
        if (acked) {
          onStatusMessage(`句段 #${segment.ordinal + 1} 已清空译文`);
        }
      });
    },
    [saveDraft, onStatusMessage],
  );

  // Ribbon/menu/palette/row-menu 锁定/解锁: flips Segment.locked through
  // segment.lock. The engine owns the flag — the renderer only reads it
  // back from the returned segment. Pending editor typing is flushed as a
  // draft first, so the text lands at the revision it belongs to instead
  // of conflicting against the freshly locked row; the queue then orders
  // the lock write after that save with the fresh revision.
  const toggleLockSegment = useCallback(
    (segment: Segment): Promise<void> => {
      gridRef.current?.flushDraft();
      return enqueueSegmentWrite(async () => {
        const latest = latestSegmentsRef.current.get(segment.id) ?? segment;
        const locked = latest.locked !== true;
        try {
          const result = await callEngine("segment.lock", {
            segmentId: segment.id,
            locked,
            baseRevision: latest.revision,
          });
          applySegments([result.segment]);
          onStatusMessage(
            locked
              ? `句段 #${segment.ordinal + 1} 已锁定`
              : `句段 #${segment.ordinal + 1} 已解锁`,
          );
        } catch (error) {
          onStatusMessage(
            locked
              ? `锁定失败：${describeError(error)}`
              : `解锁失败：${describeError(error)}`,
          );
          await reloadSegments();
        }
      });
    },
    [enqueueSegmentWrite, applySegments, onStatusMessage, reloadSegments],
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
      const lockedNote =
        (result.skippedLocked ?? 0) > 0
          ? `，跳过 ${result.skippedLocked} 个已锁定句段`
          : "";
      onStatusMessage(
        `预翻译完成：检查 ${result.checked} 个未译句段，填充 ${result.pretranslated} 个（精确 ${result.exact} / 模糊 ${result.fuzzy}）${lockedNote}`,
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

  // 忽略/恢复 QA issues at any of the three engine granularities: one
  // issue, one rule across the document, or one segment. Waiving records a
  // human decision on exact findings — it never confirms segments and never
  // writes TM, and rows only stay waived while the same evidence keeps
  // reproducing. The engine returns every row it changed; those replace the
  // local copies wholesale.
  const waiveIssues = useCallback(
    async (
      selector:
        | { issueId: string }
        | { ruleId: string; documentId: string }
        | { segmentId: string },
      waived: boolean,
      pendingId: string,
    ) => {
      setWaivePendingId(pendingId);
      try {
        const result = await callEngine("qa.waive", { ...selector, waived });
        const changed = new Map(
          result.issues.map((issue) => [issue.id, issue]),
        );
        setIssues((current) =>
          current.map((item) => changed.get(item.id) ?? item),
        );
        const label =
          result.issues.length > 1 ? `${result.issues.length} 个 QA 问题` : "QA 问题";
        onStatusMessage(waived ? `已忽略 ${label}` : `已恢复 ${label}为未解决`);
      } catch (error) {
        // The issues keep their current status; nothing is pretended.
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

  // Corrections are recomputed engine-side from the current target text, so
  // the list follows every issue or segment change; segments moving under a
  // stale fix would otherwise leave a button whose apply can only conflict.
  useEffect(() => {
    if (!activeDocumentId || openIssueCount === 0) {
      setFixes([]);
      return;
    }
    let cancelled = false;
    callEngine("qa.fix.list", { documentId: activeDocumentId })
      .then((result) => {
        if (!cancelled) {
          setFixes(result.fixes);
        }
      })
      .catch(() => {
        // No fix list only means no 应用修复 buttons; findings, waiving,
        // and jumping stay fully usable.
        if (!cancelled) {
          setFixes([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeDocumentId, openIssueCount, issues, segments]);

  // 应用修复: apply one engine-proposed correction. The replacement text is
  // the engine's own — recomputed and applied server-side through the same
  // guards as editing (baseRevision conflict, lock shield, confirmed rows
  // return to draft). The segment's QA refreshed in the same transaction,
  // so its issue rows are replaced wholesale, like a confirm.
  const applyFix = useCallback(
    async (fix: QaFix) => {
      setWaivePendingId(`fix:${fix.issueId}`);
      try {
        const result = await callEngine("qa.fix.apply", {
          issueId: fix.issueId,
          baseRevision: fix.baseRevision,
        });
        applySegments([result.segment]);
        setIssues((currentIssues) => [
          ...currentIssues.filter(
            (issue) => issue.segmentId !== result.segment.id,
          ),
          ...result.qaIssues,
        ]);
        onStatusMessage(`句段 #${result.segment.ordinal + 1} 已应用修复`);
      } catch (error) {
        onStatusMessage(`应用修复失败：${describeError(error)}`);
      } finally {
        setWaivePendingId(null);
      }
    },
    [applySegments, onStatusMessage],
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
      // The local recount carries no sourceWords (the renderer never counts
      // words); keep the engine's value — target edits never change the
      // source text it was computed from.
      return {
        ...current,
        [activeDocumentId]:
          existing?.sourceWords !== undefined
            ? { ...counts, sourceWords: existing.sourceWords }
            : counts,
      };
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

  // Explorer file list under the local search box; name substring only.
  const visibleDocuments = useMemo(() => {
    const query = fileQuery.trim().toLowerCase();
    if (query.length === 0) {
      return documents;
    }
    return documents.filter((document) =>
      document.name.toLowerCase().includes(query),
    );
  }, [documents, fileQuery]);

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
      sourceWords: documentProgress[activeDocument.id]?.sourceWords ?? null,
      activeOrdinal: activeSegment?.ordinal ?? null,
      caret,
    });
  }, [
    onStatsChange,
    activeDocument,
    counts,
    documentProgress,
    activeSegment,
    caret,
  ]);
  useEffect(() => {
    return () => {
      onStatsChange?.(null);
    };
  }, [onStatsChange]);

  // Status-bar 草稿/QA readouts jump straight into the matching grid
  // filter (PRD §3.8). Registration mirrors onStatsChange's lifetime.
  useEffect(() => {
    if (!onRegisterStatJump) {
      return;
    }
    onRegisterStatJump((target) => {
      setFilter((current) => ({ ...current, state: target }));
    });
    return () => onRegisterStatJump(null);
  }, [onRegisterStatJump]);

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

  // Opens the 检索 area (in the 记忆 dock) seeded with the current text
  // selection, in line with the classic CAT shortcut. Shared by the F3
  // chord, the menu command, and the ribbon button — same path for all.
  const openConcordance = useCallback(() => {
    const selection = readTextSelection();
    if (selection.length > 0) {
      setConcordanceSeed(selection);
    }
    setTab("memory");
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

  // Summon the floating find widget. Ctrl+F opens the find row, Ctrl+H
  // opens with the replace row revealed; either chord re-focuses the
  // matching input when the widget is already up.
  const openFind = useCallback((mode: "find" | "replace") => {
    setFindOpen(true);
    setFindMode(mode);
    setFindSummon((count) => count + 1);
  }, []);

  // Esc (or the × button) dismisses the widget and hands focus back to
  // the grid so the keyboard loop continues where it left off.
  const closeFind = useCallback(() => {
    setFindOpen(false);
    gridRef.current?.focusActive();
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
        openFind("find");
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
      openFind,
      onStatusMessage,
    ],
  );

  // Visible segments matching the find query — the widget's honest count
  // (whole segments, not occurrences). Same matching semantics as the
  // filter's text channel, applied to the already-filtered rows.
  const findMatchCount = useMemo(() => {
    const query = findQuery.trim();
    if (query.length === 0) {
      return 0;
    }
    return filterSegments(
      filteredSegments,
      { state: "all", query },
      openIssueSegmentIds,
    ).length;
  }, [filteredSegments, findQuery, openIssueSegmentIds]);

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
      openFind("replace");
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
      onStatusMessage(`句段 #${activeSegment.ordinal + 1} 已确认，未替换`);
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
        `句段 #${activeSegment.ordinal + 1} 已替换 ${replaced.count} 处「${query}」`,
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
    openFind,
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
      openFind("replace");
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
      const skippedLockedNote =
        (result.skippedLocked ?? 0) > 0
          ? `；跳过 ${result.skippedLocked} 个已锁定句段`
          : "";
      const skippedNote =
        (result.skippedConfirmed > 0
          ? `；跳过 ${result.skippedConfirmed} 个已确认句段`
          : "") + skippedLockedNote;
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
    openFind,
    applySegments,
    onStatusMessage,
  ]);

  // Confirms the live editor draft — the exact command the grid editor's
  // confirm chords fire. Shared by the ribbon button, the menu items, and
  // the palette; all report honestly when no editor is mounted instead of
  // guessing.
  const confirmActiveSegment = useCallback(
    (mode: ConfirmMode = "nextUnconfirmed") => {
      if (!gridRef.current?.confirmActive(mode)) {
        onStatusMessage("没有正在编辑的句段，无法确认");
      }
    },
    [onStatusMessage],
  );

  // Workbench keymap (renderer-owned; the application menu displays these
  // accelerators but does not register them, so the raw events land here):
  // F3 concordance, F4/Shift+F4 find next/prev, Ctrl/Cmd+F and Ctrl/Cmd+H
  // summon the find widget (find / replace rows), Ctrl/Cmd+Shift+F focuses
  // the segment filter, Ctrl/Cmd+K and Ctrl/Cmd+Shift+P summon the command
  // palette, Alt+↑/↓ step the segment selection (works while typing in
  // the target editor), Ctrl/Cmd+数字 applies a TM match (editor focused)
  // or switches docks, and Esc (when nothing closer consumed it) clears
  // the active display filter.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F3") {
        event.preventDefault();
        openConcordance();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key >= "1" &&
        event.key <= "9"
      ) {
        const index = Number(event.key) - 1;
        const target = event.target;
        // While the grid target editor has focus, Ctrl+数字 applies the
        // numbered 记忆 match as a draft (memoQ semantics) — the same
        // segment.update the dock's 应用为草稿 button runs.
        if (
          target instanceof HTMLTextAreaElement &&
          target.closest(".segment-grid") !== null
        ) {
          event.preventDefault();
          const match = tmMatches[index];
          if (match) {
            applyTmMatchToActive(match);
            onStatusMessage(
              `已应用第 ${index + 1} 条记忆匹配（${match.score}%）为草稿`,
            );
          } else {
            onStatusMessage(`没有第 ${index + 1} 条记忆匹配`);
          }
          return;
        }
        const dock = DOCK_ORDER[index];
        if (dock) {
          event.preventDefault();
          setTab(dock);
        }
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        ((!event.shiftKey && (event.key === "k" || event.key === "K")) ||
          (event.shiftKey && (event.key === "p" || event.key === "P")))
      ) {
        event.preventDefault();
        setPaletteOpen(true);
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
        event.shiftKey &&
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
        (event.key === "f" || event.key === "F")
      ) {
        event.preventDefault();
        openFind("find");
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "h" || event.key === "H")
      ) {
        event.preventDefault();
        openFind("replace");
        return;
      }
      // Esc clears the display filter — but only as the last resort:
      // surfaces closer to the key (find widget, row menu, editing exit,
      // dialogs) preventDefault first, and text inputs keep their own Esc.
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing
      ) {
        const target = event.target;
        const inTextControl =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement;
        if (!inTextControl && isFilterActive(filterRef.current)) {
          event.preventDefault();
          setFilter(EMPTY_FILTER);
          onStatusMessage("已清除筛选");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    openConcordance,
    focusFilter,
    openFind,
    findMatch,
    moveSelection,
    tmMatches,
    applyTmMatchToActive,
    onStatusMessage,
  ]);

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
        case "open-command-palette":
          setPaletteOpen(true);
          break;
        case "toggle-preview":
          if (activeDocument) {
            updateLayout({ previewOpen: !layout.previewOpen });
          }
          break;
        case "open-concordance":
          openConcordance();
          break;
        case "focus-filter":
          focusFilter();
          break;
        case "open-find":
          if (activeDocument) {
            openFind("find");
          }
          break;
        case "open-replace":
          if (activeDocument) {
            openFind("replace");
          }
          break;
        case "find-next":
          findMatch("next");
          break;
        case "find-prev":
          findMatch("prev");
          break;
        case "confirm-segment":
          confirmActiveSegment("nextUnconfirmed");
          break;
        case "confirm-segment-any":
          confirmActiveSegment("nextAny");
          break;
        case "confirm-segment-stay":
          confirmActiveSegment("stay");
          break;
        case "toggle-lock-segment":
          if (activeSegment) {
            void toggleLockSegment(activeSegment);
          } else {
            onStatusMessage("没有选中的句段，无法锁定");
          }
          break;
        default:
          break;
      }
    },
    [
      busy,
      exportDocument,
      activeDocument,
      activeSegment,
      toggleLockSegment,
      openConcordance,
      focusFilter,
      openFind,
      findMatch,
      confirmActiveSegment,
      layout.previewOpen,
      updateLayout,
      onStatusMessage,
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

  // The command palette catalog: every MenuCommand (workbench commands go
  // through handleMenuCommand — the same dispatch the menu uses; shell
  // commands run the props the shell handed down), plus dock switches
  // (already MenuCommands) and one jump per project document. Labels and
  // shortcuts mirror the application menu.
  const paletteEntries = useMemo<PaletteEntry[]>(() => {
    const documentOpen = activeDocument !== null;
    const command = (
      id: MenuCommand,
      label: string,
      enabled: boolean,
      shortcut?: string,
    ): PaletteEntry => ({
      id,
      label,
      shortcut,
      enabled,
      run: () => handleMenuCommand(id),
    });
    return [
      command("import-document", "导入文档…", !busy, "Ctrl+O"),
      command("export-document", "导出译文…", documentOpen && !busy, "Ctrl+E"),
      ...(onOpenSettings
        ? [
            {
              id: "open-project-settings",
              label: "项目设置…",
              shortcut: "Ctrl+,",
              enabled: true,
              run: onOpenSettings,
            },
          ]
        : []),
      ...(onCloseProject
        ? [
            {
              id: "close-project",
              label: "返回项目列表",
              enabled: true,
              run: onCloseProject,
            },
          ]
        : []),
      command("confirm-segment", "确认当前句段", documentOpen, "Ctrl+Enter"),
      command(
        "confirm-segment-any",
        "确认并到下一句段",
        documentOpen,
        "Ctrl+Alt+Enter",
      ),
      command(
        "confirm-segment-stay",
        "确认并停留",
        documentOpen,
        "Ctrl+Alt+Shift+Enter",
      ),
      command(
        "toggle-lock-segment",
        activeSegment?.locked ? "解锁当前句段" : "锁定当前句段",
        documentOpen && activeSegment !== null,
        "Ctrl+L",
      ),
      command("toggle-preview", "预览面板", documentOpen, "Ctrl+P"),
      command("open-find", "查找…", documentOpen, "Ctrl+F"),
      command("open-replace", "替换…", documentOpen, "Ctrl+H"),
      command("find-next", "查找下一个", documentOpen, "F4"),
      command("find-prev", "查找上一个", documentOpen, "Shift+F4"),
      command("focus-filter", "筛选句段", documentOpen, "Ctrl+Shift+F"),
      command("open-concordance", "检索（取选中文本）", true, "F3"),
      command("show-dock-memory", "记忆面板", true, "Ctrl+1"),
      command("show-dock-term", "术语面板", true, "Ctrl+2"),
      command("show-dock-qa", "QA 面板", true, "Ctrl+3"),
      command("show-dock-ai", "AI 面板", true, "Ctrl+4"),
      ...documents.map((document): PaletteEntry => ({
        id: `open-document:${document.id}`,
        label: `打开文档：${document.name}`,
        enabled: true,
        run: () => {
          void loadDocument(document.id).catch((error: unknown) => {
            onStatusMessage(`加载文档失败：${describeError(error)}`);
          });
        },
      })),
    ];
  }, [
    activeDocument,
    activeSegment,
    busy,
    documents,
    handleMenuCommand,
    loadDocument,
    onCloseProject,
    onOpenSettings,
    onStatusMessage,
  ]);

  const railVars = {
    "--tl-rail-left": layout.leftCollapsed ? "0px" : `${layout.left}px`,
    "--tl-rail-right": layout.rightCollapsed ? "0px" : `${layout.right}px`,
  } as CSSProperties;

  return (
    <AiStatusProvider>
      <main className="workbench" style={railVars}>
        <Ribbon
          documentOpen={activeDocument !== null}
          busy={busy}
          filterQuery={filter.query}
          filterInputRef={filterInputRef}
          onFilterQueryChange={(value) =>
            setFilter((current) => ({ ...current, query: value }))
          }
          onCloseProject={onCloseProject}
          onOpenTmManage={onOpenTmManage}
          onImport={() => setImportOpen(true)}
          onExport={() => void exportDocument()}
          onConfirmSegment={() => confirmActiveSegment()}
          activeSegmentLocked={
            activeSegment ? activeSegment.locked === true : null
          }
          onToggleLock={() => {
            if (activeSegment) {
              void toggleLockSegment(activeSegment);
            }
          }}
          onPretranslate={() => void pretranslate()}
          onOpenFind={() => openFind("find")}
          onOpenReplace={() => openFind("replace")}
          onFocusFilter={() => focusFilter()}
          onConcordance={openConcordance}
        />

        <aside
          className="workbench__explorer"
          data-collapsed={layout.leftCollapsed || undefined}
        >
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
                  <IconSettings size={15} stroke={1.75} aria-hidden />
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
            {documents.length > 0 ? (
              <input
                className="explorer__search"
                type="search"
                aria-label="搜索文件"
                placeholder="搜索文件"
                value={fileQuery}
                onChange={(event) => setFileQuery(event.target.value)}
              />
            ) : null}
            {documents.length === 0 ? (
              <EmptyState title="暂无文档" />
            ) : visibleDocuments.length === 0 ? (
              <EmptyState title="无匹配文件" />
            ) : (
              <div className="document-list">
                {visibleDocuments.map((document) => {
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

        <Splitter
          orientation="vertical"
          className="splitter--left"
          label="左栏"
          value={layout.left}
          min={LAYOUT_LIMITS.left.min}
          max={LAYOUT_LIMITS.left.max}
          sign={1}
          collapsed={layout.leftCollapsed}
          onResize={(next) => updateLayout({ left: next })}
          onReset={() =>
            updateLayout({ left: DEFAULT_LAYOUT.left, leftCollapsed: false })
          }
          onToggleCollapse={() =>
            updateLayout({ leftCollapsed: !layout.leftCollapsed })
          }
        />

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
                    title="关闭标签页"
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
              {qaGatePrompt ? (
                <ExportQaGateConfirm
                  openErrors={qaGatePrompt.openErrors}
                  ruleIds={qaGatePrompt.ruleIds}
                  busy={busy}
                  onOverride={() => void confirmQaGateExport()}
                  onCancel={cancelQaGateExport}
                />
              ) : null}
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
                    未被引擎确认写入（{unackedWrite.message}）
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setUnackedWrite(null)}
                  >
                    关闭
                  </Button>
                </div>
              ) : null}
              <div className="grid-toolbar" role="toolbar" aria-label="筛选">
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
                {/* Active filters as removable chips (PRD §3.6): one per
                    channel, × clears just that channel; Esc clears all. */}
                {filter.state !== "all" ? (
                  <button
                    type="button"
                    className="filter-chip"
                    aria-label={`清除状态筛选：${STATE_FILTER_LABEL.get(filter.state) ?? filter.state}`}
                    onClick={() =>
                      setFilter((current) => ({ ...current, state: "all" }))
                    }
                  >
                    {STATE_FILTER_LABEL.get(filter.state) ?? filter.state}
                    <span className="filter-chip__x" aria-hidden="true">
                      ×
                    </span>
                  </button>
                ) : null}
                {filter.query.trim().length > 0 ? (
                  <button
                    type="button"
                    className="filter-chip"
                    aria-label={`清除文本筛选：${filter.query.trim()}`}
                    onClick={() =>
                      setFilter((current) => ({ ...current, query: "" }))
                    }
                  >
                    “{filter.query.trim()}”
                    <span className="filter-chip__x" aria-hidden="true">
                      ×
                    </span>
                  </button>
                ) : null}
                <span className="grid-toolbar__spacer" />
                <span
                  className="grid-toolbar__count tl-num"
                  aria-label="可见句段/总句段"
                >
                  {filteredSegments.length}/{counts.total}
                </span>
              </div>
              <FindWidget
                open={findOpen}
                mode={findMode}
                query={findQuery}
                replaceWith={replaceWith}
                includeConfirmed={includeConfirmed}
                matchCount={findMatchCount}
                busy={busy}
                summon={findSummon}
                onQueryChange={setFindQuery}
                onReplaceWithChange={setReplaceWith}
                onIncludeConfirmedChange={setIncludeConfirmed}
                onModeChange={setFindMode}
                onFindNext={() => findMatch("next")}
                onFindPrev={() => findMatch("prev")}
                onReplace={() => void replaceInActive()}
                onReplaceAll={() => void replaceAllInDocument()}
                onClose={closeFind}
              />
              {segments.length === 0 ? (
                <EmptyState title="该文档没有句段" />
              ) : filteredSegments.length === 0 ? (
                <EmptyState title="没有符合筛选条件的句段" />
              ) : (
                <SegmentGrid
                  ref={gridRef}
                  segments={filteredSegments}
                  activeSegmentId={activeSegmentId}
                  activeMatch={bestTmMatch}
                  sourceLocale={project.sourceLocale}
                  targetLocale={project.targetLocale}
                  qaSegmentIds={openIssueSegmentIds}
                  qaCounts={openIssueCounts}
                  placeholderAlerts={placeholderAlerts}
                  onSelect={setActiveSegmentId}
                  onSaveDraft={(segment, text) =>
                    saveDraft(segment, text, { quiet: true })
                  }
                  onConfirm={(segment, text, mode) =>
                    void confirmSegment(segment, text, mode)
                  }
                  onCopySource={copySourceToTarget}
                  onClearTarget={clearTargetText}
                  onToggleLock={(segment) => void toggleLockSegment(segment)}
                  onCaretChange={setCaret}
                />
              )}
              <PreviewPane
                open={layout.previewOpen}
                height={layout.previewHeight}
                documentId={activeDocument.id}
                documentFormat={activeDocument.format}
                segments={segments}
                activeSegmentId={activeSegmentId}
                onToggle={() =>
                  updateLayout({ previewOpen: !layout.previewOpen })
                }
                onResize={(next) => updateLayout({ previewHeight: next })}
                onResetHeight={() =>
                  updateLayout({ previewHeight: DEFAULT_LAYOUT.previewHeight })
                }
                onJump={jumpToSegment}
              />
            </>
          ) : (
            <div className="workbench__center-empty">
              {documents.length === 0 ? (
                <EmptyState title="选择或导入一个文档" />
              ) : (
                <EmptyState title="没有打开的文档" />
              )}
            </div>
          )}
        </section>

        <Splitter
          orientation="vertical"
          className="splitter--right"
          label="右栏"
          value={layout.right}
          min={LAYOUT_LIMITS.right.min}
          max={LAYOUT_LIMITS.right.max}
          sign={-1}
          collapsed={layout.rightCollapsed}
          onResize={(next) => updateLayout({ right: next })}
          onReset={() =>
            updateLayout({
              right: DEFAULT_LAYOUT.right,
              rightCollapsed: false,
            })
          }
          onToggleCollapse={() =>
            updateLayout({ rightCollapsed: !layout.rightCollapsed })
          }
        />

        <aside
          className="workbench__dock"
          data-collapsed={layout.rightCollapsed || undefined}
        >
          <nav className="dock-tabs">
            {(
              [
                ["memory", "记忆", <IconDatabase key="i" {...DOCK_ICON} />],
                ["term", "术语", <IconVocabulary key="i" {...DOCK_ICON} />],
                ["qa", "QA", <IconClipboardCheck key="i" {...DOCK_ICON} />],
                ["ai", "AI", <IconSparkles key="i" {...DOCK_ICON} />],
              ] as Array<[DockTab, string, React.ReactNode]>
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                data-active={tab === key}
                onClick={() => setTab(key)}
              >
                <span className="dock-tabs__icon" aria-hidden="true">
                  {icon}
                </span>
                {label}
                {/* Live chips react to the active segment/document. They are
                    aria-hidden so accessible names stay stable ("记忆",
                    "QA"); the same numbers live accessibly in the panels. */}
                {key === "memory" && bestTmMatch ? (
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
          <div className="dock-panel dock-view">
            {tab === "memory" ? (
              // 记忆 dock: active-segment TM lookup on top, the 检索 area
              // below — one memory surface, two honest query paths.
              <>
                <TmPanel
                  activeSegment={activeSegment}
                  matches={tmMatches}
                  error={tmError}
                  onApply={applyTmMatchToActive}
                />
                <ConcordancePanel
                  projectId={project.id}
                  segments={segments}
                  initialQuery={concordanceSeed}
                  onJump={jumpToSegment}
                />
              </>
            ) : null}
            {tab === "term" ? (
              <TermPanel
                projectId={project.id}
                targetLocale={project.targetLocale}
                activeSegment={activeSegment}
                onInsert={insertTermToActive}
              />
            ) : null}
            {tab === "qa" ? (
              <QaPanel
                issues={issues}
                fixes={fixes}
                onRun={() => void runQa()}
                onJump={jumpToSegment}
                onApplyFix={(fix) => void applyFix(fix)}
                onWaive={(issue) =>
                  void waiveIssues({ issueId: issue.id }, true, issue.id)
                }
                onWaiveRule={(issue) =>
                  activeDocumentId
                    ? void waiveIssues(
                        { ruleId: issue.ruleId, documentId: activeDocumentId },
                        true,
                        `rule:${issue.ruleId}`,
                      )
                    : undefined
                }
                onWaiveSegment={(issue) =>
                  void waiveIssues(
                    { segmentId: issue.segmentId },
                    true,
                    `segment:${issue.segmentId}`,
                  )
                }
                onRestore={(issue) =>
                  void waiveIssues({ issueId: issue.id }, false, issue.id)
                }
                pendingKey={waivePendingId}
                disabled={!activeDocumentId}
              />
            ) : null}
            {tab === "ai" ? (
              // AI dock: 辅助 (assist lifecycle) above, Agent below —
              // both keep their full honest lifecycles.
              <>
                <AiPanel
                  activeSegment={activeSegment}
                  onApplyDraft={applyAiDraftToActive}
                  onStatusMessage={onStatusMessage}
                />
                <AgentPanel
                  documentId={activeDocumentId}
                  onCompleted={() => {
                    void reloadSegments();
                    void runQa();
                  }}
                  onStatusMessage={onStatusMessage}
                  onGoExport={() => void exportDocument()}
                />
              </>
            ) : null}
          </div>
        </aside>

        <CommandPalette
          open={paletteOpen}
          entries={paletteEntries}
          onClose={() => setPaletteOpen(false)}
        />

        <ImportDocumentDialog
          open={importOpen}
          project={project}
          onClose={() => setImportOpen(false)}
          onImported={(result) => void handleImported(result)}
          onProjectUpdated={onProjectUpdated}
        />
      </main>
    </AiStatusProvider>
  );
}
