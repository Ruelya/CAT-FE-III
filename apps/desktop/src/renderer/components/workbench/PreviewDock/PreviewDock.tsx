import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  Document,
  PdfPageDetail,
  PdfPageSummary,
  Segment,
} from "@translunar/contracts";
import {
  ExternalLink,
  FileText,
  Maximize2,
  Minimize2,
  PanelBottomClose,
  PanelBottomOpen,
  Pencil,
  Save,
} from "lucide-react";

import { WorkbenchVisualState } from "../../../WorkbenchVisualState";
import { useLocale } from "../../../i18n/LocaleProvider";
import {
  clampPreviewHeight,
  formatError,
  PREVIEW_MAX_HEIGHT,
  PREVIEW_MIN_HEIGHT,
  togglePanelCollapsed,
  togglePanelMaximized,
} from "../../../workbench-utils";
import type { PreviewDockProps } from "./previewTypes";

export type { PreviewDockProps } from "./previewTypes";

/** Phase 4 preview dock — extracted DocumentPreview with pop-out + expression polish. */
export function PreviewDock({

  document,
  activeSegment,
  segments,
  total,
  mode,
  onModeChange,
  height,
  onHeightChange,
  followActive,
  onFollowActiveChange,
  onNavigateSegment,
  onSourceCorrected,
}: PreviewDockProps) {
  const { t } = useLocale();
  const resizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const [previewAnchorId, setPreviewAnchorId] = useState(
    activeSegment?.id ?? "",
  );
  const [pdfPages, setPdfPages] = useState<PdfPageSummary[]>([]);
  const [pdfPage, setPdfPage] = useState<PdfPageDetail | null>(null);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfRequestRef = useRef(0);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [poppedOut, setPoppedOut] = useState(false);
  const [popOutBlocked, setPopOutBlocked] = useState(false);

  useEffect(() => {
    if (followActive && activeSegment) setPreviewAnchorId(activeSegment.id);
  }, [activeSegment, followActive]);

  useEffect(() => {
    const requestId = pdfRequestRef.current + 1;
    pdfRequestRef.current = requestId;
    if (document.filterId !== "builtin.pdf") {
      setPdfPages([]);
      setPdfPage(null);
      setPdfLoading(false);
      setPdfError(null);
      return;
    }
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    setPdfPages([]);
    setPdfPage(null);
    void window.translunar
      .invoke("pdf.page.list", { documentId: document.id })
      .then((result) => {
        if (cancelled || pdfRequestRef.current !== requestId) return;
        setPdfPages(result.pages);
        const activePage = result.pages.find((page) =>
          activeSegment ? page.segmentIds.includes(activeSegment.id) : false,
        );
        setPdfPageNumber(activePage?.page ?? result.pages[0]?.page ?? 1);
        if (result.pages.length === 0) setPdfLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled || pdfRequestRef.current !== requestId) return;
        setPdfPages([]);
        setPdfPage(null);
        setPdfError(formatError(reason));
        setPdfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSegment, document.filterId, document.id]);

  useEffect(() => {
    if (
      document.filterId !== "builtin.pdf" ||
      mode === "collapsed" ||
      pdfPages.length === 0
    ) {
      return;
    }
    const requestId = pdfRequestRef.current + 1;
    pdfRequestRef.current = requestId;
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    setPdfPage(null);
    void window.translunar
      .invoke("pdf.page.get", {
        documentId: document.id,
        page: pdfPageNumber,
        dpi: 144,
      })
      .then((result) => {
        if (cancelled || pdfRequestRef.current !== requestId) return;
        setPdfPage(result);
      })
      .catch((reason: unknown) => {
        if (cancelled || pdfRequestRef.current !== requestId) return;
        setPdfPage(null);
        setPdfError(formatError(reason));
      })
      .finally(() => {
        if (!cancelled && pdfRequestRef.current === requestId)
          setPdfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [document.filterId, document.id, mode, pdfPageNumber, pdfPages.length]);

  useEffect(() => {
    if (!followActive || !activeSegment || pdfPages.length === 0) return;
    const page = pdfPages.find((candidate) =>
      candidate.segmentIds.includes(activeSegment.id),
    );
    if (page) setPdfPageNumber(page.page);
  }, [activeSegment, followActive, pdfPages]);

  const activePdfBlock =
    pdfPage?.blocks.find((block) => block.segmentId === activeSegment?.id) ??
    null;

  useEffect(() => {
    setCorrectionOpen(false);
    setCorrectionText(activePdfBlock?.sourceText ?? "");
    setCorrectionReason("");
  }, [activePdfBlock?.segmentId, activePdfBlock?.revision]);

  const submitOcrCorrection = async () => {
    if (!activePdfBlock || !correctionReason.trim() || !correctionText.trim())
      return;
    setCorrectionBusy(true);
    setPdfError(null);
    try {
      const corrected = await window.translunar.invoke("pdf.correctOcr", {
        segmentId: activePdfBlock.segmentId,
        sourceText: correctionText,
        reason: correctionReason,
        expectedRevision: activePdfBlock.revision,
      });
      onSourceCorrected(corrected);
      setPdfPage((current) =>
        current
          ? {
              ...current,
              blocks: current.blocks.map((block) =>
                block.segmentId === corrected.id
                  ? {
                      ...block,
                      sourceText: corrected.sourceText,
                      revision: corrected.revision,
                      state: corrected.state,
                    }
                  : block,
              ),
            }
          : current,
      );
      setCorrectionOpen(false);
      setCorrectionReason("");
    } catch (reason) {
      setPdfError(formatError(reason));
    } finally {
      setCorrectionBusy(false);
    }
  };

  const previewAnchor =
    segments.find((segment) => segment.id === previewAnchorId) ?? activeSegment;
  const activeIndex = previewAnchor
    ? segments.findIndex((segment) => segment.id === previewAnchor.id)
    : 0;
  const start = Math.max(0, activeIndex - 2);
  const previewSegments = segments.slice(start, start + 5);
  const previewPosition = previewAnchor ? previewAnchor.ordinal + 1 : 0;
  const hasStructuralPaths = previewSegments.some(
    (segment) => segment.structuralPath.trim().length > 0,
  );
  const previewContentHidden = mode === "collapsed";

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "docked") return;
    event.preventDefault();
    resizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onHeightChange(
      clampPreviewHeight(drag.startHeight + drag.startY - event.clientY),
    );
  };

  const stopResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== "docked") return;
    const nextHeight =
      event.key === "ArrowUp"
        ? height + 8
        : event.key === "ArrowDown"
          ? height - 8
          : event.key === "Home"
            ? PREVIEW_MIN_HEIGHT
            : event.key === "End"
              ? PREVIEW_MAX_HEIGHT
              : null;
    if (nextHeight === null) return;
    event.preventDefault();
    onHeightChange(clampPreviewHeight(nextHeight));
  };

  const tryPopOut = () => {
    try {
      const url = new URL(window.location.href);
      url.hash = `preview=${encodeURIComponent(document.id)}`;
      const child = window.open(
        url.toString(),
        `translunar-preview-${document.id}`,
        "noopener,noreferrer,width=960,height=720",
      );
      if (!child) {
        setPopOutBlocked(true);
        setPoppedOut(false);
        return;
      }
      setPopOutBlocked(false);
      setPoppedOut(true);
      if (mode !== "collapsed") onModeChange("collapsed");
    } catch {
      setPopOutBlocked(true);
      setPoppedOut(false);
    }
  };

  return (
    <section
      className="document-preview dock"
      aria-label={t("workbench.documentPreview")}
      data-preview-mode={mode}
      data-popped-out={poppedOut ? "" : undefined}
    >
      <div
        className="preview-resizer"
        role="separator"
        aria-label={t("workbench.resizePreview")}
        aria-orientation="horizontal"
        aria-valuemin={PREVIEW_MIN_HEIGHT}
        aria-valuemax={PREVIEW_MAX_HEIGHT}
        aria-valuenow={height}
        tabIndex={mode === "docked" ? 0 : -1}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onKeyDown={resizeWithKeyboard}
      />
      <header className="preview-header">
        <div className="preview-identity">
          <FileText size={14} aria-hidden="true" />
          <div>
            <strong>{t("workbench.documentPreview")}</strong>
            <span title={document.name}>{document.name}</span>
          </div>
        </div>
        <small className="preview-position">
          {previewPosition
            ? t("common.positionOf", {
                position: previewPosition,
                total: total || segments.length,
              })
            : "—"}
        </small>
        <label className="preview-follow">
          <input
            type="checkbox"
            aria-label={t("workbench.followActiveSegment")}
            checked={followActive}
            onChange={(event) =>
              onFollowActiveChange(event.currentTarget.checked)
            }
          />
          <span>{t("workbench.followActive")}</span>
        </label>
        {poppedOut ? (
          <span className="preview-popout-status" role="status">
            {t("workbench.preview.poppedOut")}
          </span>
        ) : null}
        <div className="preview-actions">
          <button
            type="button"
            className="icon-button"
            title={
              popOutBlocked
                ? t("workbench.preview.popOutBlocked")
                : t("workbench.preview.popOut")
            }
            aria-label={
              popOutBlocked
                ? t("workbench.preview.popOutBlocked")
                : t("workbench.preview.popOut")
            }
            disabled={popOutBlocked}
            onClick={tryPopOut}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            title={
              mode === "collapsed"
                ? t("workbench.openPreview")
                : t("workbench.collapsePreview")
            }
            aria-label={
              mode === "collapsed"
                ? t("workbench.openPreview")
                : t("workbench.collapsePreview")
            }
            onClick={() => {
              if (poppedOut) setPoppedOut(false);
              onModeChange(togglePanelCollapsed(mode));
            }}
          >
            {mode === "collapsed" ? (
              <PanelBottomOpen size={14} />
            ) : (
              <PanelBottomClose size={14} />
            )}
          </button>
          <button
            type="button"
            className="icon-button"
            title={
              mode === "maximized"
                ? t("workbench.preview.restore")
                : t("workbench.preview.maximize")
            }
            aria-label={
              mode === "maximized"
                ? t("workbench.preview.restore")
                : t("workbench.preview.maximize")
            }
            onClick={() => onModeChange(togglePanelMaximized(mode))}
          >
            {mode === "maximized" ? (
              <Minimize2 size={14} />
            ) : (
              <Maximize2 size={14} />
            )}
          </button>
        </div>
      </header>
      {document.filterId === "builtin.pdf" ? (
        <div
          className="preview-content pdf-preview-content"
          aria-hidden={previewContentHidden}
          inert={previewContentHidden ? true : undefined}
        >
          <div className="pdf-preview-toolbar">
            <span className="pdf-page-label">
              Page {pdfPageNumber} of {pdfPages.length || "..."}
            </span>
            <div
              className="pdf-page-picker"
              role="listbox"
              aria-label={t("workbench.pdfPage")}
            >
              {pdfPages.map((page) => (
                <button
                  key={page.page}
                  type="button"
                  className={page.page === pdfPageNumber ? "active" : ""}
                  aria-selected={page.page === pdfPageNumber}
                  onClick={() => setPdfPageNumber(page.page)}
                >
                  {page.page}
                </button>
              ))}
            </div>
          </div>
          <div className="pdf-preview-grid" aria-busy={pdfLoading}>
            {pdfError ? (
              <div className="pdf-preview-error-state" role="alert">
                {pdfError}
              </div>
            ) : pdfLoading ? (
              <WorkbenchVisualState
                kind="loading"
                variant="preview"
                label={t("workbench.loadingPdfPage")}
              />
            ) : (
              <>
                <div className="pdf-page-image">
                  {pdfPage ? (
                    <img
                      src={"data:image/png;base64," + pdfPage.imagePngBase64}
                      alt={"Original PDF page " + pdfPage.page}
                    />
                  ) : (
                    <span>{t("workbench.noPdfPage")}</span>
                  )}
                </div>
                <div
                  className="pdf-block-list"
                  aria-label={t("workbench.extractedBlocks")}
                >
                  {pdfPage?.blocks.map((block) => (
                    <article
                      key={block.segmentId}
                      className={
                        block.segmentId === activeSegment?.id
                          ? "pdf-block active"
                          : "pdf-block"
                      }
                      data-preview-active={
                        block.segmentId === activeSegment?.id ? "" : undefined
                      }
                    >
                      <button
                        type="button"
                        className="pdf-block-select"
                        aria-current={
                          block.segmentId === activeSegment?.id
                            ? "location"
                            : undefined
                        }
                        onClick={() => {
                          const segment = segments.find(
                            (candidate) => candidate.id === block.segmentId,
                          );
                          if (segment) {
                            onNavigateSegment(segment.id, segment.ordinal);
                          }
                        }}
                      >
                        <div className="pdf-block-meta">
                          <span>{block.kind}</span>
                          <span
                            className={
                              block.sourceKind === "ocr" ? "ocr-confidence" : ""
                            }
                          >
                            {block.sourceKind === "ocr"
                              ? "OCR " + block.confidence / 10 + "%"
                              : "Text layer"}
                          </span>
                        </div>
                        <p>{block.sourceText}</p>
                      </button>
                      {block.sourceKind === "ocr" &&
                      block.segmentId === activeSegment?.id &&
                      block.state !== "confirmed" ? (
                        correctionOpen ? (
                          <div className="ocr-correction">
                            <textarea
                              aria-label={t("workbench.correctOcr")}
                              value={correctionText}
                              onChange={(event) =>
                                setCorrectionText(event.currentTarget.value)
                              }
                            />
                            <input
                              aria-label={t("workbench.ocrReason")}
                              placeholder={t("workbench.reasonForCorrection")}
                              value={correctionReason}
                              onChange={(event) =>
                                setCorrectionReason(event.currentTarget.value)
                              }
                            />
                            <div className="ocr-correction-actions">
                              <button
                                className="button primary"
                                type="button"
                                disabled={
                                  correctionBusy ||
                                  !correctionReason.trim() ||
                                  !correctionText.trim()
                                }
                                onClick={() => void submitOcrCorrection()}
                              >
                                <Save size={13} />
                                {correctionBusy ? "Saving" : "Save correction"}
                              </button>
                              <button
                                className="button ghost"
                                type="button"
                                onClick={() => setCorrectionOpen(false)}
                              >
                                {t("common.cancel")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="ocr-edit-button"
                            type="button"
                            onClick={() => {
                              setCorrectionText(block.sourceText);
                              setCorrectionOpen(true);
                            }}
                          >
                            <Pencil size={12} />
                            {t("workbench.correctOcrBtn")}
                          </button>
                        )
                      ) : null}
                    </article>
                  ))}
                  {pdfPage && !pdfError && pdfPage.blocks.length === 0 ? (
                    <p className="empty-grid">{t("workbench.noPdfBlocks")}</p>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div
          className="preview-content document-flow-preview"
          aria-hidden={previewContentHidden}
          inert={previewContentHidden ? true : undefined}
        >
          <nav
            className="preview-structure-rail"
            aria-label={t("workbench.previewStructureRail")}
          >
            <strong>{t("workbench.previewStructure")}</strong>
            {previewSegments.map((segment) => (
              <button
                key={segment.id}
                type="button"
                className={
                  segment.id === activeSegment?.id
                    ? "preview-rail-item active"
                    : "preview-rail-item"
                }
                aria-current={
                  segment.id === activeSegment?.id ? "location" : undefined
                }
                onClick={() => onNavigateSegment(segment.id, segment.ordinal)}
                title={segment.structuralPath || t("common.noStructuralPath")}
              >
                <span>{segment.ordinal + 1}</span>
                <small>
                  {segment.structuralPath || t("common.noStructuralPath")}
                </small>
              </button>
            ))}
          </nav>
          <div className="preview-paper" aria-label={t("workbench.preview")}>
            <div className="preview-paper-meta">
              <span>
                {t("common.positionOf", {
                  position: previewPosition,
                  total: total || segments.length,
                })}
              </span>
              <span>
                {hasStructuralPaths
                  ? t("workbench.previewStructureAvailable")
                  : t("workbench.previewStructureLimited")}
              </span>
            </div>
            <div className="preview-lines">
              {previewSegments.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  className={
                    segment.id === activeSegment?.id
                      ? "preview-line active"
                      : "preview-line"
                  }
                  data-preview-active={
                    segment.id === activeSegment?.id ? "" : undefined
                  }
                  aria-current={
                    segment.id === activeSegment?.id ? "location" : undefined
                  }
                  onClick={() => onNavigateSegment(segment.id, segment.ordinal)}
                >
                  <span>{segment.ordinal + 1}</span>
                  <span className="preview-line-copy">
                    <strong>{segment.sourceText}</strong>
                    <em>{segment.targetText || "—"}</em>
                  </span>
                </button>
              ))}
            </div>
            <p className="preview-degradation-note">
              {t("workbench.previewStructureNote")}
            </p>
          </div>
          <div className="preview-dot-field" aria-hidden="true" />
        </div>
      )}
    </section>
  );
}
