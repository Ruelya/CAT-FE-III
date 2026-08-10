import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Project,
  TaskPackageKind,
  TaskPackagePreviewResult,
} from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { desktopApi, invokeEngine } from "../lib/rpc";
import {
  canDiscardOrImport,
  canExportAssignment,
  canExportReturn,
  canMutateTaskPreview,
  isSafeSelectableRow,
  isTerminalTaskPreviewStatus,
  mergePageSelection,
  taskApplyLabel,
} from "./task-package-view";

export interface TaskPackageGateway {
  generation: number;
  mutationsEnabled: boolean;
  projectId: string | null;
  projectRevision: number;
  hasDocuments: boolean;
  hasTaskPackageRef: boolean;
  flushOrStay: () => Promise<boolean>;
  onApplied: () => Promise<void>;
  onImported: (project: Project) => Promise<void>;
}

export interface TaskPackageState {
  actor: string;
  reason: string;
  packagePath: string | null;
  exportNotice: string | null;
  pending: boolean;
  error: UiError | null;
  notice: string | null;
  preview: TaskPackagePreviewResult | null;
  selectedRowIds: Set<string>;
  importProject: Project | null;
  projectRevision: number;
  hasTaskPackageRef: boolean;
  documentIds: string[];
}

export interface TaskPackageApi {
  state: TaskPackageState;
  setActor: (v: string) => void;
  setReason: (v: string) => void;
  exportPackage: (kind: TaskPackageKind) => Promise<void>;
  pickPackage: () => Promise<void>;
  preview: (offset?: number) => Promise<void>;
  toggleRow: (rowId: string, selected: boolean) => void;
  apply: () => Promise<void>;
  importPackage: () => Promise<void>;
  discard: () => Promise<void>;
  canExportAssignment: boolean;
  canExportReturn: boolean;
  canApply: boolean;
  canDiscard: boolean;
  canImport: boolean;
  applyLabel: string;
  invalidate: () => void;
}

const PAGE = 50;

function createInitial(): TaskPackageState {
  return {
    actor: "local",
    reason: "",
    packagePath: null,
    exportNotice: null,
    pending: false,
    error: null,
    notice: null,
    preview: null,
    selectedRowIds: new Set(),
    importProject: null,
    projectRevision: 1,
    hasTaskPackageRef: false,
    documentIds: [],
  };
}

export function useTaskPackageController(
  gateway: TaskPackageGateway,
): TaskPackageApi {
  const [state, setState] = useState<TaskPackageState>(createInitial);
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

  useEffect(() => {
    const projectId = gateway.projectId;
    if (!projectId || !gateway.mutationsEnabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await invokeEngine("project.get", { projectId });
        if (cancelled) return;
        setState((s) => ({
          ...s,
          projectRevision: snapshot.project.revision,
          hasTaskPackageRef: Boolean(
            snapshot.project.configuration?.taskPackage,
          ),
          documentIds: snapshot.documents.map((d) => d.id),
        }));
      } catch {
        /* keep gateway fallbacks */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway.projectId, gateway.mutationsEnabled, gateway.generation]);

  const setActor = useCallback((actor: string) => {
    stateRef.current = { ...stateRef.current, actor };
    setState((s) => ({ ...s, actor }));
  }, []);

  const setReason = useCallback((reason: string) => {
    stateRef.current = { ...stateRef.current, reason };
    setState((s) => ({ ...s, reason }));
  }, []);

  const exportPackage = useCallback(async (kind: TaskPackageKind) => {
    const gw = gatewayRef.current;
    if (!gw.mutationsEnabled) return;
    const s = stateRef.current;
    const hasDocuments =
      s.documentIds.length > 0 || gw.hasDocuments;
    const hasTaskPackageRef =
      s.hasTaskPackageRef || gw.hasTaskPackageRef;
    if (kind === "assignment") {
      if (
        !canExportAssignment({
          hasDocuments,
          actor: s.actor,
          reason: s.reason,
          pending: s.pending,
        })
      ) {
        return;
      }
    } else if (
      !canExportReturn({
        hasTaskPackageRef,
        actor: s.actor,
        reason: s.reason,
        pending: s.pending,
      })
    ) {
      return;
    }

    const api = desktopApi();
    const destinationPath = await api.selectExportPath(
      kind === "assignment" ? "assignment.tltask" : "return.tltask",
    );
    if (!destinationPath) return;

    const op = ++opRef.current;
    setState((prev) => ({
      ...prev,
      pending: true,
      error: null,
      exportNotice: null,
    }));
    try {
      const exportParams = {
        kind,
        destinationPath,
        actor: s.actor.trim(),
        reason: s.reason.trim(),
        projectId: kind === "assignment" ? gw.projectId : null,
        workingProjectId: kind === "return" ? gw.projectId : null,
        expectedProjectRevision: s.projectRevision || gw.projectRevision,
        ...(kind === "assignment" && s.documentIds.length > 0
          ? {
              documents: s.documentIds.map((documentId) => ({ documentId })),
            }
          : {}),
      };
      const result = await invokeEngine("taskPackage.export", exportParams);
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        exportNotice: result.packagePath,
        packagePath: result.packagePath,
      }));
    } catch (error) {
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        error: toUiError(error),
      }));
    }
  }, []);

  const pickPackage = useCallback(async () => {
    const api = desktopApi();
    const path = await api.selectTaskPackageInput();
    if (!path) return;
    const next = {
      ...stateRef.current,
      packagePath: path,
      preview: null,
      selectedRowIds: new Set<string>(),
      error: null as UiError | null,
      notice: null as string | null,
      importProject: null,
    };
    stateRef.current = next;
    setState(next);
  }, []);

  const preview = useCallback(async (offset = 0) => {
    const gw = gatewayRef.current;
    const s = stateRef.current;
    if (!gw.mutationsEnabled) return;
    if (!s.packagePath && !s.preview) return;
    if (!s.actor.trim() || !s.reason.trim()) return;
    const op = ++opRef.current;
    setState((prev) => ({ ...prev, pending: true, error: null }));
    try {
      const result = await invokeEngine("taskPackage.preview", {
        packagePath: s.packagePath,
        previewId: s.preview?.previewId ?? null,
        offset,
        limit: PAGE,
        actor: s.actor.trim(),
        reason: s.reason.trim(),
      });
      if (op !== opRef.current) return;
      const pageIds = result.rows.map((r) => r.rowId);
      const safeOnPage = new Set(
        result.rows.filter(isSafeSelectableRow).map((r) => r.rowId),
      );
      const firstLoad = !s.preview;
      const nextSelection = firstLoad
        ? safeOnPage
        : mergePageSelection(
            s.selectedRowIds,
            pageIds,
            new Set(
              pageIds.filter(
                (id) => s.selectedRowIds.has(id) && safeOnPage.has(id),
              ),
            ),
          );
      setState((prev) => ({
        ...prev,
        pending: false,
        preview: result,
        selectedRowIds: isTerminalTaskPreviewStatus(result.status)
          ? new Set()
          : nextSelection,
        notice: null,
      }));
    } catch (error) {
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        error: toUiError(error),
      }));
    }
  }, []);

  const toggleRow = useCallback((rowId: string, selected: boolean) => {
    setState((s) => {
      if (s.preview && isTerminalTaskPreviewStatus(s.preview.status)) return s;
      const row = s.preview?.rows.find((r) => r.rowId === rowId);
      if (selected && row && !isSafeSelectableRow(row)) return s;
      const next = new Set(s.selectedRowIds);
      if (selected) next.add(rowId);
      else next.delete(rowId);
      return { ...s, selectedRowIds: next };
    });
  }, []);

  const apply = useCallback(async () => {
    const gw = gatewayRef.current;
    const s = stateRef.current;
    if (!gw.mutationsEnabled || !s.preview) return;
    if (
      !canMutateTaskPreview({
        status: s.preview.status,
        actor: s.actor,
        reason: s.reason,
        pending: s.pending,
        selectedCount: s.selectedRowIds.size,
      })
    ) {
      return;
    }
    const ok = await gw.flushOrStay();
    if (!ok) return;
    const op = ++opRef.current;
    setState((prev) => ({ ...prev, pending: true, error: null }));
    try {
      const result = await invokeEngine("taskPackage.apply", {
        previewId: s.preview.previewId,
        expectedProjectRevision: s.preview.expectedProjectRevision,
        selectedRowIds: [...s.selectedRowIds],
        actor: s.actor.trim(),
        reason: s.reason.trim(),
      });
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        preview: prev.preview
          ? { ...prev.preview, status: result.status }
          : null,
        selectedRowIds: new Set(),
        notice: `Applied ${result.appliedCount}`,
      }));
      await gw.onApplied();
    } catch (error) {
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        error: toUiError(error),
      }));
    }
  }, []);

  const importPackage = useCallback(async () => {
    const gw = gatewayRef.current;
    const s = stateRef.current;
    if (!gw.mutationsEnabled || !s.preview) return;
    if (
      !canDiscardOrImport({
        status: s.preview.status,
        actor: s.actor,
        reason: s.reason,
        pending: s.pending,
        hasPreview: true,
      })
    ) {
      return;
    }
    const op = ++opRef.current;
    setState((prev) => ({ ...prev, pending: true, error: null }));
    try {
      const result = await invokeEngine("taskPackage.import", {
        previewId: s.preview.previewId,
        actor: s.actor.trim(),
        reason: s.reason.trim(),
      });
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        importProject: result.project,
        notice: `Imported ${result.bindingCount}`,
      }));
      await gw.onImported(result.project);
    } catch (error) {
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        error: toUiError(error),
      }));
    }
  }, []);

  const discard = useCallback(async () => {
    const gw = gatewayRef.current;
    const s = stateRef.current;
    if (!gw.mutationsEnabled || !s.preview) return;
    if (
      !canDiscardOrImport({
        status: s.preview.status,
        actor: s.actor,
        reason: s.reason,
        pending: s.pending,
        hasPreview: true,
      })
    ) {
      return;
    }
    const op = ++opRef.current;
    setState((prev) => ({ ...prev, pending: true, error: null }));
    try {
      const result = await invokeEngine("taskPackage.discard", {
        packageId: s.preview.packageId,
        previewId: s.preview.previewId,
        actor: s.actor.trim(),
        reason: s.reason.trim(),
      });
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        preview: prev.preview
          ? { ...prev.preview, status: result.status }
          : null,
        selectedRowIds: new Set(),
        notice: "Discarded",
      }));
    } catch (error) {
      if (op !== opRef.current) return;
      setState((prev) => ({
        ...prev,
        pending: false,
        error: toUiError(error),
      }));
    }
  }, []);

  const s = state;
  const status = s.preview?.status ?? "open";
  const hasDocuments = s.documentIds.length > 0 || gateway.hasDocuments;
  const hasTaskPackageRef =
    s.hasTaskPackageRef || gateway.hasTaskPackageRef;
  return {
    state,
    setActor,
    setReason,
    exportPackage,
    pickPackage,
    preview,
    toggleRow,
    apply,
    importPackage,
    discard,
    canExportAssignment: canExportAssignment({
      hasDocuments,
      actor: s.actor,
      reason: s.reason,
      pending: s.pending,
    }),
    canExportReturn: canExportReturn({
      hasTaskPackageRef,
      actor: s.actor,
      reason: s.reason,
      pending: s.pending,
    }),
    canApply: canMutateTaskPreview({
      status,
      actor: s.actor,
      reason: s.reason,
      pending: s.pending,
      selectedCount: s.selectedRowIds.size,
    }),
    canDiscard: canDiscardOrImport({
      status,
      actor: s.actor,
      reason: s.reason,
      pending: s.pending,
      hasPreview: Boolean(s.preview),
    }),
    canImport: canDiscardOrImport({
      status,
      actor: s.actor,
      reason: s.reason,
      pending: s.pending,
      hasPreview: Boolean(s.preview),
    }),
    applyLabel: taskApplyLabel(status, s.selectedRowIds.size),
    invalidate,
  };
}
