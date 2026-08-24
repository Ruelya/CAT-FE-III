import { useCallback, useEffect, useRef, useState } from "react";
import type {
  InteropPreviewStatus,
  ReviewPreviewResult,
  TablePreviewResult,
  TmLibrary,
} from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { desktopApi, invokeEngine } from "../lib/rpc";
import {
  canApplySelection,
  eligibleReviewRowIds,
  eligibleTableRowIds,
  filterWritableMatchingLibraries,
  initialSelectionFromEligible,
  isTerminalPreviewStatus,
  toggleIdInSet,
} from "./interop-view";
import { mergePageSelection } from "./task-package-view";

export type InteropMode = "review" | "table";

export interface InteropControllerGateway {
  generation: number;
  mutationsEnabled: boolean;
  projectId: string;
  /** Optional until project snapshot is loaded from Engine. */
  projectRevision?: number;
  documentId: string | null;
  documentRevision: number;
  sourceLocale?: string;
  targetLocale?: string;
  flushOrStay: () => Promise<boolean>;
  onReviewApplied: () => Promise<void>;
  onTableApplied: () => Promise<void>;
}

export interface InteropControllerState {
  mode: InteropMode;
  actor: string;
  path: string | null;
  exportPath: string | null;
  exportNotice: string | null;
  pending: boolean;
  error: UiError | null;
  notice: string | null;
  selectedRowIds: Set<string>;
  reviewPreview: ReviewPreviewResult | null;
  tablePreview: TablePreviewResult | null;
  libraries: TmLibrary[];
  libraryId: string | null;
  librariesLoading: boolean;
  librariesError: UiError | null;
  sourceLocale: string;
  targetLocale: string;
  projectRevision: number;
  resolvedDocumentId: string | null;
  resolvedDocumentRevision: number;
}

export interface InteropControllerApi {
  state: InteropControllerState;
  setMode: (mode: InteropMode) => void;
  setActor: (actor: string) => void;
  setLibraryId: (id: string | null) => void;
  toggleRow: (rowId: string, selected: boolean) => void;
  exportReview: () => Promise<void>;
  pickInput: () => Promise<void>;
  preview: (offset?: number) => Promise<void>;
  apply: () => Promise<void>;
  canApply: boolean;
  invalidate: () => void;
  matchingLibraries: TmLibrary[];
}

const PAGE = 50;

function emptyModeState(): Pick<
  InteropControllerState,
  | "path"
  | "exportPath"
  | "exportNotice"
  | "pending"
  | "error"
  | "notice"
  | "selectedRowIds"
  | "reviewPreview"
  | "tablePreview"
> {
  return {
    path: null,
    exportPath: null,
    exportNotice: null,
    pending: false,
    error: null,
    notice: null,
    selectedRowIds: new Set(),
    reviewPreview: null,
    tablePreview: null,
  };
}

function createInitial(mode: InteropMode = "review"): InteropControllerState {
  return {
    mode,
    actor: "local",
    ...emptyModeState(),
    libraries: [],
    libraryId: null,
    librariesLoading: false,
    librariesError: null,
    sourceLocale: "",
    targetLocale: "",
    projectRevision: 1,
    resolvedDocumentId: null,
    resolvedDocumentRevision: 1,
  };
}

export function useInteropController(
  gateway: InteropControllerGateway,
): InteropControllerApi {
  const [state, setState] = useState<InteropControllerState>(createInitial);
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

  const matchingLibraries = filterWritableMatchingLibraries(
    state.libraries,
    state.sourceLocale || gateway.sourceLocale || "",
    state.targetLocale || gateway.targetLocale || "",
  );

  const ensureProjectContext = useCallback(async () => {
    const gw = gatewayRef.current;
    if (!gw.projectId) return null;
    try {
      const snapshot = await invokeEngine("project.get", {
        projectId: gw.projectId,
      });
      const doc =
        (gw.documentId
          ? snapshot.documents.find((d) => d.id === gw.documentId)
          : null) ??
        snapshot.documents[0] ??
        null;
      setState((s) => ({
        ...s,
        sourceLocale: snapshot.project.sourceLocale,
        targetLocale: snapshot.project.targetLocale,
        projectRevision: snapshot.project.revision,
        resolvedDocumentId: doc?.id ?? gw.documentId,
        resolvedDocumentRevision: doc?.revision ?? gw.documentRevision,
      }));
      return snapshot;
    } catch {
      return null;
    }
  }, []);

  const loadLibraries = useCallback(async () => {
    const gw = gatewayRef.current;
    if (!gw.projectId) return;
    const op = ++opRef.current;
    setState((s) => ({
      ...s,
      librariesLoading: true,
      librariesError: null,
    }));
    try {
      const snapshot = await ensureProjectContext();
      if (op !== opRef.current) return;
      const sourceLocale =
        snapshot?.project.sourceLocale ??
        (stateRef.current.sourceLocale || gw.sourceLocale || "");
      const targetLocale =
        snapshot?.project.targetLocale ??
        (stateRef.current.targetLocale || gw.targetLocale || "");
      const result = await invokeEngine("tm.library.list", {
        projectId: gw.projectId,
        offset: 0,
        limit: 100,
      });
      if (op !== opRef.current) return;
      const items = result.items ?? [];
      const matching = filterWritableMatchingLibraries(
        items,
        sourceLocale,
        targetLocale,
      );
      setState((s) => ({
        ...s,
        libraries: items,
        librariesLoading: false,
        libraryId: matching[0]?.id ?? s.libraryId ?? null,
        sourceLocale,
        targetLocale,
      }));
    } catch (error) {
      if (op !== opRef.current) return;
      setState((s) => ({
        ...s,
        librariesLoading: false,
        librariesError: toUiError(error),
      }));
    }
  }, [ensureProjectContext]);

  useEffect(() => {
    if (gateway.projectId && gateway.mutationsEnabled) {
      void ensureProjectContext();
    }
  }, [gateway.projectId, gateway.mutationsEnabled, ensureProjectContext]);

  useEffect(() => {
    if (state.mode === "table" && gateway.projectId) {
      void loadLibraries();
    }
  }, [state.mode, gateway.projectId, loadLibraries]);

  const setMode = useCallback((mode: InteropMode) => {
    opRef.current += 1;
    setState((s) => ({
      ...createInitial(mode),
      actor: s.actor,
      libraries: s.libraries,
      libraryId: s.libraryId,
      librariesLoading: s.librariesLoading,
      librariesError: s.librariesError,
      sourceLocale: s.sourceLocale,
      targetLocale: s.targetLocale,
      projectRevision: s.projectRevision,
      resolvedDocumentId: s.resolvedDocumentId,
      resolvedDocumentRevision: s.resolvedDocumentRevision,
    }));
  }, []);

  const setActor = useCallback((actor: string) => {
    stateRef.current = { ...stateRef.current, actor };
    setState((s) => ({ ...s, actor }));
  }, []);

  const setLibraryId = useCallback((id: string | null) => {
    stateRef.current = { ...stateRef.current, libraryId: id };
    setState((s) => ({ ...s, libraryId: id }));
  }, []);

  const toggleRow = useCallback((rowId: string, selected: boolean) => {
    setState((s) => {
      const status =
        s.mode === "review" ? s.reviewPreview?.status : s.tablePreview?.status;
      if (status && isTerminalPreviewStatus(status)) return s;
      return {
        ...s,
        selectedRowIds: toggleIdInSet(s.selectedRowIds, rowId, selected),
      };
    });
  }, []);

  const exportReview = useCallback(async () => {
    const gw = gatewayRef.current;
    await ensureProjectContext();
    const documentId = stateRef.current.resolvedDocumentId ?? gw.documentId;
    const documentRevision =
      stateRef.current.resolvedDocumentRevision || gw.documentRevision;
    if (!gw.mutationsEnabled || !documentId) return;
    const api = desktopApi();
    const path = await api.selectExportPath("review.docx");
    if (!path) return;
    const op = ++opRef.current;
    setState((s) => ({ ...s, pending: true, error: null, exportNotice: null }));
    try {
      const result = await invokeEngine("interop.review.export", {
        projectId: gw.projectId,
        documentId,
        expectedDocumentRevision: documentRevision,
        outputPath: path,
      });
      if (op !== opRef.current) return;
      setState((s) => ({
        ...s,
        pending: false,
        exportPath: result.outputPath,
        exportNotice: `Exported ${result.rowCount} rows`,
      }));
    } catch (error) {
      if (op !== opRef.current) return;
      setState((s) => ({
        ...s,
        pending: false,
        error: toUiError(error),
      }));
    }
  }, [ensureProjectContext]);

  const pickInput = useCallback(async () => {
    const mode = stateRef.current.mode;
    const api = desktopApi();
    const path = await api.selectInteropInput(mode);
    if (!path) return;
    const next = {
      ...stateRef.current,
      path,
      error: null as UiError | null,
      notice: null as string | null,
      reviewPreview: null,
      tablePreview: null,
      selectedRowIds: new Set<string>(),
    };
    stateRef.current = next;
    setState(next);
  }, []);

  const preview = useCallback(
    async (offset = 0) => {
      const gw = gatewayRef.current;
      const s = stateRef.current;
      if (!gw.mutationsEnabled) return;
      if (!s.path && !s.reviewPreview && !s.tablePreview) return;
      const op = ++opRef.current;
      setState((prev) => ({ ...prev, pending: true, error: null }));
      try {
        if (s.mode === "review") {
          await ensureProjectContext();
          const documentId =
            stateRef.current.resolvedDocumentId ?? gw.documentId;
          const documentRevision =
            stateRef.current.resolvedDocumentRevision || gw.documentRevision;
          if (!documentId) {
            setState((prev) => ({
              ...prev,
              pending: false,
              error: {
                code: "NO_DOCUMENT",
                message: "No document",
                kind: "domain",
              },
            }));
            return;
          }
          const result = await invokeEngine("interop.review.preview", {
            projectId: gw.projectId,
            documentId,
            expectedDocumentRevision: documentRevision,
            inputPath: s.path,
            previewId: s.reviewPreview?.previewId ?? null,
            offset,
            limit: PAGE,
          });
          if (op !== opRef.current) return;
          const eligible = eligibleReviewRowIds(result.rows);
          const eligibleSet = new Set(eligible);
          const pageIds = result.rows.map((r) => r.rowId);
          const firstLoad = !s.reviewPreview;
          const nextSelection = firstLoad
            ? initialSelectionFromEligible(eligible)
            : mergePageSelection(
                s.selectedRowIds,
                pageIds,
                new Set(
                  pageIds.filter(
                    (id) => s.selectedRowIds.has(id) && eligibleSet.has(id),
                  ),
                ),
              );
          setState((prev) => ({
            ...prev,
            pending: false,
            reviewPreview: result,
            tablePreview: null,
            selectedRowIds: isTerminalPreviewStatus(result.status)
              ? new Set()
              : nextSelection,
            notice: null,
          }));
        } else {
          const libraryId = s.libraryId;
          if (!libraryId) {
            setState((prev) => ({
              ...prev,
              pending: false,
              error: {
                code: "NO_LIBRARY",
                message: "No matching library",
                kind: "domain",
              },
            }));
            return;
          }
          const library = s.libraries.find((l) => l.id === libraryId);
          const expectedLibraryRevision = library?.revision ?? 1;
          const sourceLocale =
            stateRef.current.sourceLocale || gw.sourceLocale || "";
          const targetLocale =
            stateRef.current.targetLocale || gw.targetLocale || "";
          const result = await invokeEngine("interop.table.preview", {
            projectId: gw.projectId,
            libraryId,
            expectedLibraryRevision,
            sourceLocale,
            targetLocale,
            inputPath: s.path,
            previewId: s.tablePreview?.previewId ?? null,
            offset,
            limit: PAGE,
          });
          if (op !== opRef.current) return;
          const eligible = eligibleTableRowIds(result.rows);
          const eligibleSet = new Set(eligible);
          const pageIds = result.rows.map((r) => r.rowId);
          const firstLoad = !s.tablePreview;
          const nextSelection = firstLoad
            ? initialSelectionFromEligible(eligible)
            : mergePageSelection(
                s.selectedRowIds,
                pageIds,
                new Set(
                  pageIds.filter(
                    (id) => s.selectedRowIds.has(id) && eligibleSet.has(id),
                  ),
                ),
              );
          setState((prev) => ({
            ...prev,
            pending: false,
            tablePreview: result,
            reviewPreview: null,
            selectedRowIds: isTerminalPreviewStatus(result.status)
              ? new Set()
              : nextSelection,
            notice: null,
          }));
        }
      } catch (error) {
        if (op !== opRef.current) return;
        setState((prev) => ({
          ...prev,
          pending: false,
          error: toUiError(error),
        }));
      }
    },
    [ensureProjectContext],
  );

  const apply = useCallback(async () => {
    const gw = gatewayRef.current;
    const s = stateRef.current;
    if (!gw.mutationsEnabled) return;
    const status: InteropPreviewStatus | undefined =
      s.mode === "review" ? s.reviewPreview?.status : s.tablePreview?.status;
    if (!status || !canApplySelection(s.selectedRowIds, status)) return;
    if (!s.actor.trim()) return;

    if (s.mode === "review") {
      const ok = await gw.flushOrStay();
      if (!ok) return;
    }

    const op = ++opRef.current;
    setState((prev) => ({ ...prev, pending: true, error: null }));
    try {
      if (s.mode === "review" && s.reviewPreview) {
        const result = await invokeEngine("interop.review.apply", {
          previewId: s.reviewPreview.previewId,
          expectedDocumentRevision: s.reviewPreview.expectedDocumentRevision,
          selectedRowIds: [...s.selectedRowIds],
          actor: s.actor.trim(),
        });
        if (op !== opRef.current) return;
        setState((prev) => ({
          ...prev,
          pending: false,
          reviewPreview: prev.reviewPreview
            ? { ...prev.reviewPreview, status: result.status }
            : null,
          selectedRowIds: new Set(),
          notice: `Applied ${result.appliedCount}`,
        }));
        await gw.onReviewApplied();
      } else if (s.mode === "table" && s.tablePreview) {
        const result = await invokeEngine("interop.table.apply", {
          previewId: s.tablePreview.previewId,
          expectedLibraryRevision: s.tablePreview.expectedLibraryRevision,
          selectedRowIds: [...s.selectedRowIds],
          actor: s.actor.trim(),
        });
        if (op !== opRef.current) return;
        setState((prev) => ({
          ...prev,
          pending: false,
          tablePreview: prev.tablePreview
            ? { ...prev.tablePreview, status: result.status }
            : null,
          selectedRowIds: new Set(),
          notice: `Applied ${result.appliedCount}`,
        }));
        await gw.onTableApplied();
        await loadLibraries();
      }
    } catch (error) {
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        error: toUiError(error),
      }));
    }
  }, [loadLibraries]);

  const status =
    state.mode === "review"
      ? state.reviewPreview?.status
      : state.tablePreview?.status;
  const canApply =
    Boolean(status) &&
    canApplySelection(state.selectedRowIds, status ?? "open") &&
    state.actor.trim().length > 0 &&
    !state.pending &&
    gateway.mutationsEnabled;

  return {
    state,
    setMode,
    setActor,
    setLibraryId,
    toggleRow,
    exportReview,
    pickInput,
    preview,
    apply,
    canApply,
    invalidate,
    matchingLibraries,
  };
}
