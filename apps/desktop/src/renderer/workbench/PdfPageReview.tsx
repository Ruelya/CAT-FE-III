import { useEffect, useRef } from "react";
import {
  ArrowsOut,
  CaretLeft,
  CaretRight,
  CornersOut,
} from "@phosphor-icons/react";
import type { PdfPageBlock } from "@translunar/contracts";

import { formatUiError } from "../lib/errors";
import { isOcrCorrectable, shouldMountPdfDock } from "../state/pdf-review";
import type { PdfReviewApi } from "../state/use-pdf-review";
import { PdfOcrCorrectDialog } from "./PdfOcrCorrectDialog";

export interface PdfPageReviewProps {
  pdf: PdfReviewApi;
  disabled?: boolean;
}

export function PdfPageReview({ pdf, disabled }: PdfPageReviewProps) {
  const { state } = pdf;
  const bodyRef = useRef<HTMLDivElement>(null);
  const collapsed = state.dockMode === "collapsed";
  const maximized = state.dockMode === "maximized";

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (collapsed) {
      body.setAttribute("inert", "");
      body.setAttribute("aria-hidden", "true");
    } else {
      body.removeAttribute("inert");
      body.removeAttribute("aria-hidden");
    }
  }, [collapsed]);

  // Engine-driven: hide empty-ready / non-PDF type rejections; error chrome only for real PDF list failures.
  if (
    !shouldMountPdfDock({
      pageCount: state.pages.length,
      listStatus: state.listStatus,
      listError: state.listError,
    })
  ) {
    return null;
  }

  return (
    // Named region, not <aside>: see TmExactPanel for the landmark rationale.
    <section
      aria-label="PDF page review"
      className={[
        "pdf-panel",
        collapsed ? "pdf-panel--collapsed" : "",
        maximized ? "pdf-panel--maximized" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="pdf-page-review"
    >
      <div className="pdf-panel__chrome">
        {!collapsed ? <h2 className="pdf-panel__title">PDF</h2> : <span />}
        <div className="pdf-panel__chrome-actions">
          {!collapsed ? (
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              aria-label={maximized ? "Dock PDF panel" : "Maximize PDF panel"}
              title={maximized ? "Dock PDF panel" : "Maximize PDF panel"}
              disabled={disabled}
              onClick={() =>
                pdf.setDockMode(maximized ? "docked" : "maximized")
              }
              data-testid="pdf-maximize"
            >
              {maximized ? (
                <CornersOut size={16} weight="bold" />
              ) : (
                <ArrowsOut size={16} weight="bold" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            aria-label={collapsed ? "Expand PDF panel" : "Collapse PDF panel"}
            title={collapsed ? "Expand PDF panel" : "Collapse PDF panel"}
            aria-expanded={!collapsed}
            disabled={disabled}
            onClick={() => pdf.setDockMode(collapsed ? "docked" : "collapsed")}
            data-testid="pdf-collapse"
          >
            {collapsed ? (
              <CaretRight size={16} weight="bold" />
            ) : (
              <CaretLeft size={16} weight="bold" />
            )}
          </button>
        </div>
      </div>

      <div ref={bodyRef} className="pdf-panel__body">
        {state.listStatus === "loading" ? (
          <p className="muted">Loading</p>
        ) : null}
        {state.listError ? (
          <p className="error-text">{formatUiError(state.listError)}</p>
        ) : null}

        {state.pages.length > 0 ? (
          <div className="pdf-panel__layout">
            <ul className="pdf-page-list" aria-label="Pages">
              {state.pages.map((page) => (
                <li key={page.page}>
                  <button
                    type="button"
                    className={
                      page.page === state.activePage
                        ? "pdf-page-list__item pdf-page-list__item--active"
                        : "pdf-page-list__item"
                    }
                    aria-current={page.page === state.activePage}
                    disabled={disabled || state.pageStatus === "loading"}
                    onClick={() => pdf.selectPage(page.page)}
                    data-testid={`pdf-page-${page.page}`}
                  >
                    <span>{page.page}</span>
                    {page.ocrBlockCount > 0 ? (
                      <span className="pdf-page-list__badge">
                        {page.ocrBlockCount}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>

            <div className="pdf-canvas" data-testid="pdf-canvas">
              {state.pageStatus === "loading" ? (
                <p className="muted">Loading</p>
              ) : null}
              {state.pageError ? (
                <p className="error-text">{formatUiError(state.pageError)}</p>
              ) : null}
              {state.pageImageUrl ? (
                <div className="pdf-canvas__frame">
                  <img
                    src={state.pageImageUrl}
                    alt={`Page ${state.activePage}`}
                    className="pdf-canvas__image"
                    data-testid="pdf-page-image"
                  />
                  {state.pageDetail?.blocks.map((block) => (
                    <BlockOverlay
                      key={`${block.segmentId}-${block.revision}`}
                      block={block}
                      pageWidth={state.pageDetail!.width}
                      pageHeight={state.pageDetail!.height}
                      active={pdf.activeBlock?.segmentId === block.segmentId}
                      disabled={disabled === true}
                      onCorrect={() => pdf.openCorrect(block)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {state.correctOpen && state.correctBlock ? (
        <PdfOcrCorrectDialog
          sourceText={state.correctSourceText}
          reason={state.correctReason}
          pending={state.correctPending}
          error={state.correctError}
          canSubmit={pdf.canSubmitCorrect}
          disabled={disabled === true}
          onSourceTextChange={pdf.setCorrectSourceText}
          onReasonChange={pdf.setCorrectReason}
          onSubmit={() => {
            void pdf.submitCorrect();
          }}
          onCancel={pdf.closeCorrect}
        />
      ) : null}
    </section>
  );
}

function BlockOverlay({
  block,
  pageWidth,
  pageHeight,
  active,
  disabled,
  onCorrect,
}: {
  block: PdfPageBlock;
  pageWidth: number;
  pageHeight: number;
  active: boolean;
  disabled: boolean;
  onCorrect: () => void;
}) {
  const left = pageWidth > 0 ? (block.bbox.x / pageWidth) * 100 : 0;
  const top = pageHeight > 0 ? (block.bbox.y / pageHeight) * 100 : 0;
  const width = pageWidth > 0 ? (block.bbox.width / pageWidth) * 100 : 0;
  const height = pageHeight > 0 ? (block.bbox.height / pageHeight) * 100 : 0;
  const correctable = isOcrCorrectable(block);

  return (
    <div
      className={active ? "pdf-block pdf-block--active" : "pdf-block"}
      // data-geometry: the overlay box comes from the Engine page bbox.
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
      }}
      data-testid={`pdf-block-${block.segmentId}`}
    >
      {correctable ? (
        <button
          type="button"
          className="btn btn--ghost btn--sm pdf-block__correct"
          data-hit-area="extended"
          disabled={disabled}
          onClick={onCorrect}
          data-testid={`pdf-correct-${block.segmentId}`}
        >
          Correct
        </button>
      ) : null}
    </div>
  );
}
