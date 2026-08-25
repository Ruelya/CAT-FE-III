import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  Document,
  DocumentImportResult,
  Project,
  QaIssue,
  Segment,
} from "@translunar/contracts";
import { Button, EmptyState, Meter, Panel } from "@translunar/ui";

import type { EngineLifecycleState } from "../../shared/desktop-api.js";
import { AiStatusProvider } from "../lib/ai-status.js";
import {
  callEngine,
  describeError,
  isEngineUnavailable,
} from "../lib/engine.js";
import {
  EMPTY_FILTER,
  filterSegments,
  isFilterActive,
} from "../lib/segment-filter.js";
import type {
  SegmentFilterSpec,
  SegmentStateFilter,
} from "../lib/segment-filter.js";
import { ImportDocumentDialog } from "../components/ImportDocumentDialog.js";
import { SegmentGrid } from "../components/SegmentGrid.js";
import type { SegmentGridHandle } from "../components/SegmentGrid.js";
import { TmPanel } from "../components/TmPanel.js";
import { TermPanel } from "../components/TermPanel.js";
import { ConcordancePanel } from "../components/ConcordancePanel.js";
import { QaPanel } from "../components/QaPanel.js";
import { AiPanel } from "../components/AiPanel.js";
import { AgentPanel } from "../components/AgentPanel.js";
import { PreviewDialog } from "../components/PreviewDialog.js";

export interface WorkbenchViewProps {
  project: Project;
  engineState: EngineLifecycleState;
  onStatusMessage: (message: string) => void;
}

type DockTab = "tm" | "term" | "concordance" | "qa" | "ai" | "agent";

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
}: WorkbenchViewProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [issues, setIssues] = useState<QaIssue[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [tab, setTab] = useState<DockTab>("tm");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<SegmentFilterSpec>(EMPTY_FILTER);
  const [concordanceSeed, setConcordanceSeed] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const gridRef = useRef<SegmentGridHandle | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [unackedWrite, setUnackedWrite] = useState<UnackedWrite | null>(null);

  const activeDocument = useMemo(
    () =>
      documents.find((document) => document.id === activeDocumentId) ?? null,
    [documents, activeDocumentId],
  );
  const activeSegment = useMemo(
    () => segments.find((segment) => segment.id === activeSegmentId) ?? null,
    [segments, activeSegmentId],
  );

  const refreshDocuments = useCallback(async () => {
    const result = await callEngine("document.list", { projectId: project.id });
    setDocuments(result.documents);
    return result.documents;
  }, [project.id]);

  const loadDocument = useCallback(async (documentId: string) => {
    setActiveDocumentId(documentId);
    setFilter(EMPTY_FILTER);
    const [segmentResult, issueResult] = await Promise.all([
      callEngine("segment.list", { documentId }),
      callEngine("qa.list", { documentId }),
    ]);
    setSegments(segmentResult.segments);
    setIssues(issueResult.issues);
    setActiveSegmentId(segmentResult.segments[0]?.id ?? null);
  }, []);

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
          setSegments(segmentResult.segments);
          setIssues(issueResult.issues);
        }
        onStatusMessage("引擎已恢复，文档与句段已从引擎重新同步");
      } catch (error) {
        onStatusMessage(`引擎恢复后同步失败：${describeError(error)}`);
      }
    })();
  }, [engineState, activeDocumentId, refreshDocuments, onStatusMessage]);

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
      onStatusMessage(`导出失败：${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeDocument, onStatusMessage]);

  const applySegments = useCallback((updated: Segment[]) => {
    setSegments((current) =>
      current.map((segment) => {
        const replacement = updated.find((item) => item.id === segment.id);
        return replacement ?? segment;
      }),
    );
  }, []);

  const reloadSegments = useCallback(async () => {
    if (!activeDocumentId) {
      return;
    }
    try {
      const result = await callEngine("segment.list", {
        documentId: activeDocumentId,
      });
      setSegments(result.segments);
    } catch (error) {
      // Refreshing with a dead engine cannot work; keep the local state
      // (it still holds the user's text) instead of exploding.
      onStatusMessage(`刷新句段失败：${describeError(error)}`);
    }
  }, [activeDocumentId, onStatusMessage]);

  const saveDraft = useCallback(
    async (segment: Segment, targetText: string) => {
      try {
        const result = await callEngine("segment.update", {
          segmentId: segment.id,
          targetText,
          baseRevision: segment.revision,
        });
        applySegments([result.segment]);
        setUnackedWrite((current) =>
          current?.segmentId === segment.id ? null : current,
        );
        onStatusMessage(`句段 #${segment.ordinal + 1} 草稿已保存`);
      } catch (error) {
        if (isEngineUnavailable(error)) {
          // The engine never acked this write: keep an inline alert up (the
          // editor still holds the text) and skip the doomed reload.
          setUnackedWrite({
            segmentId: segment.id,
            ordinal: segment.ordinal,
            kind: "draft",
            message: describeError(error),
          });
          onStatusMessage(
            `句段 #${segment.ordinal + 1} 草稿未保存：引擎未确认写入`,
          );
          return;
        }
        onStatusMessage(`保存失败：${describeError(error)}`);
        await reloadSegments();
      }
    },
    [applySegments, onStatusMessage, reloadSegments],
  );

  const confirmSegment = useCallback(
    async (segment: Segment, targetText: string) => {
      try {
        let current = segment;
        if (targetText !== segment.targetText) {
          const updated = await callEngine("segment.update", {
            segmentId: segment.id,
            targetText,
            baseRevision: segment.revision,
          });
          current = updated.segment;
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
    },
    [applySegments, onStatusMessage, reloadSegments],
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

  const counts = useMemo(() => {
    let confirmed = 0;
    let draft = 0;
    for (const segment of segments) {
      if (segment.state === "confirmed") {
        confirmed += 1;
      } else if (segment.state === "draft") {
        draft += 1;
      }
    }
    return { total: segments.length, confirmed, draft };
  }, [segments]);

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

  // F3 opens concordance seeded with the current text selection, in line
  // with the classic CAT shortcut.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F3") {
        return;
      }
      event.preventDefault();
      const selection = readTextSelection();
      if (selection.length > 0) {
        setConcordanceSeed(selection);
      }
      setTab("concordance");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <AiStatusProvider>
      <main className="workbench">
        <aside className="workbench__rail">
          <Panel
            title="文档"
            actions={
              <Button
                size="sm"
                variant="primary"
                onClick={() => setImportOpen(true)}
                disabled={busy}
              >
                导入
              </Button>
            }
          >
            {documents.length === 0 ? (
              <EmptyState
                title="暂无文档"
                hint="导入 DOCX、TXT、Markdown、HTML、XLIFF、XLSX 或 PPTX 开始翻译。"
              />
            ) : (
              <div className="document-list">
                {documents.map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    className="document-list__item"
                    data-active={document.id === activeDocumentId}
                    onClick={() => void loadDocument(document.id)}
                  >
                    <span className="document-list__name">{document.name}</span>
                    <span className="document-list__meta">
                      {document.format} · {document.segmentCount} 句段
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </aside>

        <section className="workbench__center">
          <Panel
            title={
              activeDocument
                ? `编辑网格 — ${activeDocument.name}（确认 ${counts.confirmed}/${counts.total}）`
                : "编辑网格"
            }
            actions={
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void pretranslate()}
                  disabled={!activeDocument || busy}
                >
                  预翻译
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPreviewOpen(true)}
                  disabled={!activeDocument}
                >
                  预览
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void exportDocument()}
                  disabled={!activeDocument || busy}
                >
                  导出译文
                </Button>
              </>
            }
            className="dock-panel grid-panel"
          >
            {activeDocument ? (
              <>
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
                      编辑器中的文本仍保留；引擎恢复后请重新
                      {unackedWrite.kind === "draft" ? "保存" : "确认"}
                      该句段。
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
                  <input
                    className="grid-toolbar__search"
                    aria-label="按文本筛选"
                    placeholder="筛选源文 / 译文…"
                    value={filter.query}
                    onChange={(event) =>
                      setFilter((current) => ({
                        ...current,
                        query: event.target.value,
                      }))
                    }
                  />
                  {isFilterActive(filter) ? (
                    <>
                      <span className="grid-toolbar__count">
                        {filteredSegments.length}/{counts.total}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setFilter(EMPTY_FILTER)}
                      >
                        清除
                      </Button>
                    </>
                  ) : null}
                  <span className="grid-toolbar__spacer" />
                  <span className="grid-toolbar__progress">
                    <Meter
                      ratio={
                        counts.total > 0 ? counts.confirmed / counts.total : 0
                      }
                      label={`已确认 ${counts.confirmed}/${counts.total}`}
                    />
                    <span className="grid-toolbar__progress-text">
                      {counts.total > 0
                        ? `${Math.round((counts.confirmed / counts.total) * 100)}%`
                        : "—"}
                    </span>
                  </span>
                </div>
                {segments.length === 0 ? (
                  <EmptyState title="该文档没有句段" />
                ) : filteredSegments.length === 0 ? (
                  <EmptyState
                    title="没有符合筛选条件的句段"
                    hint="调整状态或文本筛选，或点击「清除」。"
                  />
                ) : (
                  <SegmentGrid
                    ref={gridRef}
                    segments={filteredSegments}
                    activeSegmentId={activeSegmentId}
                    qaSegmentIds={openIssueSegmentIds}
                    onSelect={setActiveSegmentId}
                    onSaveDraft={(segment, text) =>
                      void saveDraft(segment, text)
                    }
                    onConfirm={(segment, text) =>
                      void confirmSegment(segment, text)
                    }
                  />
                )}
              </>
            ) : (
              <EmptyState
                title="选择或导入一个文档"
                hint="左侧导入文档后，句段会在这里以网格显示。"
              />
            )}
          </Panel>
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
              </button>
            ))}
          </nav>
          <div className="dock-panel">
            {tab === "tm" ? (
              <TmPanel
                projectId={project.id}
                activeSegment={activeSegment}
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
