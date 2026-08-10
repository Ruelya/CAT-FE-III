import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Document,
  DocumentReimportPreviewResult,
} from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { desktopApi, invokeEngine } from "../lib/rpc";
import { canConfirmReimportApply, reimportSummaryLine } from "./reimport-view";

export interface ReimportGateway {
  generation: number;
  mutationsEnabled: boolean;
  documentId: string | null;
  documentRevision: number;
  flushOrStay: () => Promise<boolean>;
  onApplied: (document: Document) => Promise<void>;
}

export type ReimportStatus =
  | "closed"
  | "picking"
  | "previewing"
  | "planReady"
  | "applying"
  | "applied"
  | "error";

export interface ReimportState {
  open: boolean;
  status: ReimportStatus;
  path: string | null;
  preview: DocumentReimportPreviewResult | null;
  pending: boolean;
  error: UiError | null;
  notice: string | null;
}

export interface ReimportApi {
  state: ReimportState;
  summary: string;
  canApply: boolean;
  open: () => void;
  close: () => void;
  pickAndPreview: () => Promise<void>;
  apply: () => Promise<void>;
  invalidate: () => void;
}

function empty(): ReimportState {
  return {
    open: false,
    status: "closed",
    path: null,
    preview: null,
    pending: false,
    error: null,
    notice: null,
  };
}

export function useReimportController(gateway: ReimportGateway): ReimportApi {
  const [state, setState] = useState<ReimportState>(empty);
  const opRef = useRef(0);
  const generationRef = useRef(gateway.generation);
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  const stateRef = useRef(state);
  stateRef.current = state;

  const invalidate = useCallback(() => {
    opRef.current += 1;
  }, []);

  useEffect(() => {
    if (generationRef.current !== gateway.generation) {
      generationRef.current = gateway.generation;
      invalidate();
    }
  }, [gateway.generation, invalidate]);

  const open = useCallback(() => {
    setState({
      ...empty(),
      open: true,
      status: "closed",
    });
  }, []);

  const close = useCallback(() => {
    opRef.current += 1;
    setState(empty());
  }, []);

  const pickAndPreview = useCallback(async () => {
    const gw = gatewayRef.current;
    if (!gw.mutationsEnabled || !gw.documentId) return;
    const api = desktopApi();
    const path = await api.selectSourceDocument();
    if (!path) return;
    const op = ++opRef.current;
    setState((s) => ({
      ...s,
      open: true,
      path,
      pending: true,
      status: "previewing",
      error: null,
      notice: null,
    }));
    try {
      const preview = await invokeEngine("document.reimport.preview", {
        documentId: gw.documentId,
        expectedRevision: gw.documentRevision,
        sourcePath: path,
      });
      if (op !== opRef.current) return;
      setState((s) => ({
        ...s,
        pending: false,
        preview,
        status: "planReady",
      }));
    } catch (error) {
      if (op !== opRef.current) return;
      setState((s) => ({
        ...s,
        pending: false,
        status: "error",
        error: toUiError(error),
      }));
    }
  }, []);

  const apply = useCallback(async () => {
    const gw = gatewayRef.current;
    const s = stateRef.current;
    if (!gw.mutationsEnabled || !s.preview) return;
    if (
      !canConfirmReimportApply({
        hasPreview: true,
        pending: s.pending,
        status: s.status,
      })
    ) {
      return;
    }
    const ok = await gw.flushOrStay();
    if (!ok) return;
    const op = ++opRef.current;
    setState((prev) => ({
      ...prev,
      pending: true,
      status: "applying",
      error: null,
    }));
    try {
      const document = await invokeEngine("document.reimport.apply", {
        previewId: s.preview.previewId,
        expectedDocumentRevision: s.preview.expectedDocumentRevision,
      });
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        status: "applied",
        notice: "Reimported",
      }));
      await gw.onApplied(document);
      if (op !== opRef.current) return;
      setState(empty());
    } catch (error) {
      if (op !== opRef.current) return;
      // Keep path/preview open as planReady so Apply can retry (AC6 / error matrix).
      setState((prev) => ({
        ...prev,
        pending: false,
        status: "planReady",
        error: toUiError(error),
      }));
    }
  }, []);

  const summary = state.preview
    ? reimportSummaryLine(state.preview.plan)
    : "";

  const canApply = canConfirmReimportApply({
    hasPreview: Boolean(state.preview),
    pending: state.pending,
    status: state.status,
  });

  return {
    state,
    summary,
    canApply,
    open,
    close,
    pickAndPreview,
    apply,
    invalidate,
  };
}
