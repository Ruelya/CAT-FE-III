import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PdfPageBlock,
  PdfPageDetail,
  PdfPageSummary,
  Segment,
} from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { invokeEngine } from "../lib/rpc";
import {
  buildSegmentPageIndex,
  canSubmitOcrCorrection,
  findBlockForSegment,
  firstPageNumber,
  isNonPdfDocumentListError,
  isOcrCorrectable,
  pageImageDataUrl,
  resolvePageForSegment,
  type PdfDockMode,
} from "./pdf-review";

export interface PdfReviewGateway {
  generation: number;
  mutationsEnabled: boolean;
  documentId: string | null;
  activeSegmentId: string | null;
  flushOrStay: () => Promise<boolean>;
  onSegmentCorrected: (segment: Segment) => Promise<void>;
}

export interface PdfReviewState {
  pages: PdfPageSummary[];
  listStatus: "idle" | "loading" | "ready" | "error";
  listError: UiError | null;
  activePage: number;
  pageDetail: PdfPageDetail | null;
  pageImageUrl: string;
  pageStatus: "idle" | "loading" | "ready" | "error";
  pageError: UiError | null;
  dockMode: PdfDockMode;
  correctOpen: boolean;
  correctBlock: PdfPageBlock | null;
  correctSourceText: string;
  correctReason: string;
  correctPending: boolean;
  correctError: UiError | null;
}

export interface PdfReviewApi {
  state: PdfReviewState;
  setDockMode: (mode: PdfDockMode) => void;
  selectPage: (page: number) => void;
  openCorrect: (block: PdfPageBlock) => void;
  closeCorrect: () => void;
  setCorrectSourceText: (text: string) => void;
  setCorrectReason: (reason: string) => void;
  submitCorrect: () => Promise<void>;
  activeBlock: PdfPageBlock | null;
  canSubmitCorrect: boolean;
  hasPages: boolean;
  invalidate: () => void;
}

function emptyState(): PdfReviewState {
  return {
    pages: [],
    listStatus: "idle",
    listError: null,
    activePage: 1,
    pageDetail: null,
    pageImageUrl: "",
    pageStatus: "idle",
    pageError: null,
    dockMode: "docked",
    correctOpen: false,
    correctBlock: null,
    correctSourceText: "",
    correctReason: "",
    correctPending: false,
    correctError: null,
  };
}

function isCollapsed(mode: PdfDockMode): boolean {
  return mode === "collapsed";
}

export function usePdfReview(gateway: PdfReviewGateway): PdfReviewApi {
  const [state, setState] = useState<PdfReviewState>(emptyState);
  const listOpRef = useRef(0);
  const pageOpRef = useRef(0);
  const correctOpRef = useRef(0);
  const generationRef = useRef(gateway.generation);
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  const stateRef = useRef(state);
  stateRef.current = state;
  const documentIdRef = useRef(gateway.documentId);

  const invalidate = useCallback(() => {
    listOpRef.current += 1;
    pageOpRef.current += 1;
    correctOpRef.current += 1;
  }, []);

  const loadPage = useCallback(async (documentId: string, page: number) => {
    if (isCollapsed(stateRef.current.dockMode)) return;
    const op = ++pageOpRef.current;
    setState((s) => ({
      ...s,
      activePage: page,
      pageStatus: "loading",
      pageError: null,
    }));
    try {
      const detail = await invokeEngine("pdf.page.get", {
        documentId,
        page,
      });
      if (op !== pageOpRef.current) return;
      if (gatewayRef.current.documentId !== documentId) return;
      // Re-read after await — collapse may have stopped fetches via op bump.
      if (isCollapsed(stateRef.current.dockMode)) return;
      setState((s) => ({
        ...s,
        pageDetail: detail,
        pageImageUrl: pageImageDataUrl(detail.imagePngBase64),
        pageStatus: "ready",
        pageError: null,
        activePage: page,
      }));
    } catch (error) {
      if (op !== pageOpRef.current) return;
      setState((s) => ({
        ...s,
        pageStatus: "error",
        pageError: toUiError(error),
      }));
    }
  }, []);

  const listPages = useCallback(
    async (documentId: string, activeSegmentId: string | null) => {
      const op = ++listOpRef.current;
      pageOpRef.current += 1;
      setState((s) => ({
        ...s,
        listStatus: "loading",
        listError: null,
        pages: [],
        pageDetail: null,
        pageImageUrl: "",
        pageStatus: "idle",
        pageError: null,
        correctOpen: false,
        correctBlock: null,
        correctError: null,
      }));
      try {
        const result = await invokeEngine("pdf.page.list", { documentId });
        if (op !== listOpRef.current) return;
        if (gatewayRef.current.documentId !== documentId) return;
        const pages = result.pages;
        if (pages.length === 0) {
          setState((s) => ({
            ...s,
            pages: [],
            listStatus: "ready",
            listError: null,
            pageStatus: "idle",
          }));
          return;
        }
        const index = buildSegmentPageIndex(pages);
        const fallback = firstPageNumber(pages);
        const activePage = resolvePageForSegment(
          index,
          activeSegmentId,
          fallback,
        );
        setState((s) => ({
          ...s,
          pages,
          listStatus: "ready",
          listError: null,
          activePage,
        }));
        if (stateRef.current.dockMode !== "collapsed") {
          await loadPage(documentId, activePage);
        }
      } catch (error) {
        if (op !== listOpRef.current) return;
        const uiError = toUiError(error);
        // Non-PDF documents: Engine InvalidRequest — silent empty-ready, no dock.
        if (isNonPdfDocumentListError(uiError)) {
          setState((s) => ({
            ...s,
            pages: [],
            listStatus: "ready",
            listError: null,
            pageStatus: "idle",
            pageError: null,
            pageDetail: null,
            pageImageUrl: "",
          }));
          return;
        }
        setState((s) => ({
          ...s,
          listStatus: "error",
          listError: uiError,
          pages: [],
        }));
      }
    },
    [loadPage],
  );

  // List when document changes
  useEffect(() => {
    const documentId = gateway.documentId;
    if (documentIdRef.current !== documentId) {
      documentIdRef.current = documentId;
      invalidate();
    }
    if (!documentId) {
      setState(emptyState());
      return;
    }
    void listPages(documentId, gateway.activeSegmentId);
    // Only re-list on document change — segment follow is separate.
  }, [gateway.documentId]);

  // Re-list after feature-generation invalidate (reconnect / stale drop).
  useEffect(() => {
    if (generationRef.current === gateway.generation) return;
    generationRef.current = gateway.generation;
    invalidate();
    const documentId = gateway.documentId;
    if (documentId) {
      void listPages(documentId, gateway.activeSegmentId);
    }
  }, [
    gateway.generation,
    gateway.documentId,
    gateway.activeSegmentId,
    invalidate,
    listPages,
  ]);

  // Follow active segment → page (highlight/page switch without full re-list)
  useEffect(() => {
    const documentId = gateway.documentId;
    if (!documentId) return;
    const { pages, listStatus, dockMode, activePage } = stateRef.current;
    if (listStatus !== "ready" || pages.length === 0) return;
    const index = buildSegmentPageIndex(pages);
    const nextPage = resolvePageForSegment(
      index,
      gateway.activeSegmentId,
      activePage,
    );
    if (nextPage === activePage) return;
    setState((s) => ({ ...s, activePage: nextPage }));
    if (dockMode !== "collapsed") {
      void loadPage(documentId, nextPage);
    }
  }, [gateway.activeSegmentId, gateway.documentId, loadPage]);

  const setDockMode = useCallback(
    (mode: PdfDockMode) => {
      setState((s) => ({ ...s, dockMode: mode }));
      const documentId = gatewayRef.current.documentId;
      if (mode !== "collapsed" && documentId) {
        const page = stateRef.current.activePage;
        if (
          stateRef.current.pageDetail?.page !== page ||
          stateRef.current.pageStatus !== "ready"
        ) {
          void loadPage(documentId, page);
        }
      } else if (mode === "collapsed") {
        // Stop further gets by bumping page op; keep last image mounted/inert.
        pageOpRef.current += 1;
      }
    },
    [loadPage],
  );

  const selectPage = useCallback(
    (page: number) => {
      const documentId = gatewayRef.current.documentId;
      if (!documentId) return;
      setState((s) => ({ ...s, activePage: page }));
      if (stateRef.current.dockMode !== "collapsed") {
        void loadPage(documentId, page);
      }
    },
    [loadPage],
  );

  const openCorrect = useCallback((block: PdfPageBlock) => {
    if (!isOcrCorrectable(block)) return;
    const next = {
      ...stateRef.current,
      correctOpen: true,
      correctBlock: block,
      correctSourceText: block.sourceText,
      correctReason: "",
      correctError: null as UiError | null,
      correctPending: false,
    };
    stateRef.current = next;
    setState(next);
  }, []);

  const closeCorrect = useCallback(() => {
    correctOpRef.current += 1;
    setState((s) => ({
      ...s,
      correctOpen: false,
      correctBlock: null,
      correctSourceText: "",
      correctReason: "",
      correctError: null,
      correctPending: false,
    }));
  }, []);

  const setCorrectSourceText = useCallback((text: string) => {
    stateRef.current = { ...stateRef.current, correctSourceText: text };
    setState((s) => ({ ...s, correctSourceText: text }));
  }, []);

  const setCorrectReason = useCallback((reason: string) => {
    stateRef.current = { ...stateRef.current, correctReason: reason };
    setState((s) => ({ ...s, correctReason: reason }));
  }, []);

  const submitCorrect = useCallback(async () => {
    const gw = gatewayRef.current;
    if (!gw.mutationsEnabled) return;
    const s = stateRef.current;
    if (!s.correctBlock) return;
    if (
      !canSubmitOcrCorrection({
        sourceText: s.correctSourceText,
        reason: s.correctReason,
        pending: s.correctPending,
      })
    ) {
      return;
    }
    const ok = await gw.flushOrStay();
    if (!ok) return;
    const op = ++correctOpRef.current;
    setState((prev) => ({ ...prev, correctPending: true, correctError: null }));
    try {
      const segment = await invokeEngine("pdf.correctOcr", {
        segmentId: s.correctBlock.segmentId,
        sourceText: s.correctSourceText.trim(),
        reason: s.correctReason.trim(),
        expectedRevision: s.correctBlock.revision,
      });
      if (op !== correctOpRef.current) return;
      await gw.onSegmentCorrected(segment);
      if (op !== correctOpRef.current) return;
      setState((prev) => ({
        ...prev,
        correctPending: false,
        correctOpen: false,
        correctBlock: null,
        correctSourceText: "",
        correctReason: "",
        correctError: null,
      }));
      // Refresh current page blocks from Engine
      const documentId = gw.documentId;
      if (documentId && stateRef.current.dockMode !== "collapsed") {
        await loadPage(documentId, stateRef.current.activePage);
      }
    } catch (error) {
      if (op !== correctOpRef.current) return;
      setState((prev) => ({
        ...prev,
        correctPending: false,
        correctError: toUiError(error),
      }));
    }
  }, [loadPage]);

  const activeBlock = findBlockForSegment(
    state.pageDetail?.blocks ?? [],
    gateway.activeSegmentId,
  );

  const canSubmitCorrect = canSubmitOcrCorrection({
    sourceText: state.correctSourceText,
    reason: state.correctReason,
    pending: state.correctPending,
  });

  return {
    state,
    setDockMode,
    selectPage,
    openCorrect,
    closeCorrect,
    setCorrectSourceText,
    setCorrectReason,
    submitCorrect,
    activeBlock,
    canSubmitCorrect,
    hasPages: state.pages.length > 0,
    invalidate,
  };
}


