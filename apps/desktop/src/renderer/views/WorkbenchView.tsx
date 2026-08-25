import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  Document,
  Project,
  QaIssue,
  Segment,
} from "@translunar/contracts";
import { Button, EmptyState, Panel } from "@translunar/ui";

import { AiStatusProvider } from "../lib/ai-status.js";
import { callEngine, describeError } from "../lib/engine.js";
import { SegmentGrid } from "../components/SegmentGrid.js";
import { TmPanel } from "../components/TmPanel.js";
import { QaPanel } from "../components/QaPanel.js";
import { AiPanel } from "../components/AiPanel.js";
import { AgentPanel } from "../components/AgentPanel.js";

export interface WorkbenchViewProps {
  project: Project;
  onStatusMessage: (message: string) => void;
}

type DockTab = "tm" | "qa" | "ai" | "agent";

export function WorkbenchView({
  project,
  onStatusMessage,
}: WorkbenchViewProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [issues, setIssues] = useState<QaIssue[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [tab, setTab] = useState<DockTab>("tm");
  const [busy, setBusy] = useState(false);

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
    const [segmentResult, issueResult] = await Promise.all([
      callEngine("segment.list", { documentId }),
      callEngine("qa.list", { documentId }),
    ]);
    setSegments(segmentResult.segments);
    setIssues(issueResult.issues);
    setActiveSegmentId(segmentResult.segments[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void refreshDocuments().then((loaded) => {
      const first = loaded[0];
      if (first) {
        void loadDocument(first.id);
      }
    });
  }, [refreshDocuments, loadDocument]);

  const importDocument = useCallback(async () => {
    const sourcePath = await window.tl.chooseSourceFile();
    if (!sourcePath) {
      return;
    }
    setBusy(true);
    try {
      const result = await callEngine("document.import", {
        projectId: project.id,
        sourcePath,
      });
      onStatusMessage(
        `已导入「${result.document.name}」：${result.segmentCount} 个句段`,
      );
      await refreshDocuments();
      await loadDocument(result.document.id);
    } catch (error) {
      onStatusMessage(`导入失败：${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }, [project.id, refreshDocuments, loadDocument, onStatusMessage]);

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
    const result = await callEngine("segment.list", {
      documentId: activeDocumentId,
    });
    setSegments(result.segments);
  }, [activeDocumentId]);

  const saveDraft = useCallback(
    async (segment: Segment, targetText: string) => {
      try {
        const result = await callEngine("segment.update", {
          segmentId: segment.id,
          targetText,
          baseRevision: segment.revision,
        });
        applySegments([result.segment]);
        onStatusMessage(`句段 #${segment.ordinal + 1} 草稿已保存`);
      } catch (error) {
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
        const propagated =
          result.propagated.length > 0
            ? `，TM 传播 ${result.propagated.length} 个重复句段`
            : "";
        onStatusMessage(
          `句段 #${segment.ordinal + 1} 已确认并写入 TM${propagated}`,
        );
      } catch (error) {
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
                onClick={() => void importDocument()}
                disabled={busy}
              >
                导入
              </Button>
            }
          >
            {documents.length === 0 ? (
              <EmptyState
                title="暂无文档"
                hint="导入 DOCX、TXT、HTML、XLIFF、XLSX 或 PPTX 开始翻译。"
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => void exportDocument()}
                disabled={!activeDocument || busy}
              >
                导出译文
              </Button>
            }
            className="dock-panel"
          >
            {activeDocument ? (
              <SegmentGrid
                segments={segments}
                activeSegmentId={activeSegmentId}
                qaSegmentIds={openIssueSegmentIds}
                onSelect={setActiveSegmentId}
                onSaveDraft={(segment, text) => void saveDraft(segment, text)}
                onConfirm={(segment, text) =>
                  void confirmSegment(segment, text)
                }
              />
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
            {tab === "qa" ? (
              <QaPanel
                issues={issues}
                onRun={() => void runQa()}
                onJump={(segmentId) => setActiveSegmentId(segmentId)}
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
      </main>
    </AiStatusProvider>
  );
}
