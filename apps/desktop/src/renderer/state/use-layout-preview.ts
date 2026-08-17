import { useCallback, useRef, useState } from "react";
import type { LayoutPreviewSession } from "../../shared/desktop-api";

import { desktopApi, invokeEngine } from "../lib/rpc";
import { toUiError, type UiError } from "../lib/errors";

export interface LayoutPreviewGateway {
  generation: number;
  mutationsEnabled: boolean;
  documentId: string | null;
  documentName: string;
  fileType: string;
  flushOrStay: () => Promise<boolean>;
}

export interface LayoutPreviewApi {
  open: boolean;
  loading: boolean;
  session: LayoutPreviewSession | null;
  error: UiError | null;
  show: () => Promise<void>;
  hide: () => void;
  invalidate: () => void;
}

export function useLayoutPreview(
  gateway: LayoutPreviewGateway,
): LayoutPreviewApi {
  const generationRef = useRef(gateway.generation);
  generationRef.current = gateway.generation;
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<LayoutPreviewSession | null>(null);
  const [error, setError] = useState<UiError | null>(null);

  const hide = useCallback(() => {
    setOpen(false);
    setSession(null);
    setError(null);
    void desktopApi().revokeLayoutPreview();
  }, []);

  const invalidate = useCallback(() => {
    hide();
  }, [hide]);

  const show = useCallback(async () => {
    const g = gatewayRef.current;
    if (!g.mutationsEnabled || !g.documentId) return;
    const generation = g.generation;
    const ok = await g.flushOrStay();
    if (!ok || generationRef.current !== generation) return;
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const sink = await desktopApi().createLayoutPreviewSink({
        fileType: g.fileType,
      });
      try {
        await invokeEngine("document.export", {
          documentId: g.documentId,
          outputPath: sink.outputPath,
        });
      } catch (caught) {
        const code =
          caught && typeof caught === "object" && "code" in caught
            ? String(caught.code)
            : "";
        if (code !== "qa_gate_blocked") throw caught;
        await invokeEngine("document.export", {
          documentId: g.documentId,
          outputPath: sink.outputPath,
          qaOverride: {
            actor: "layout-preview",
            reason: "Layout preview",
          },
        });
      }
      if (generationRef.current !== generation) return;
      const next = await desktopApi().publishLayoutPreview({
        outputPath: sink.outputPath,
        title: g.documentName,
        fileType: g.fileType,
      });
      if (generationRef.current !== generation) return;
      setSession(next);
    } catch (caught) {
      if (generationRef.current !== generation) return;
      setSession(null);
      setError(toUiError(caught));
    } finally {
      if (generationRef.current === generation) {
        setLoading(false);
      }
    }
  }, []);

  return { open, loading, session, error, show, hide, invalidate };
}
