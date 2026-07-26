import { useCallback, useEffect, useState } from "react";
import type {
  Document,
  GlobalSearchHit,
  ProjectSnapshot,
  QaIssue,
  Segment,
  SegmentEditorRow,
} from "@translunar/contracts";
import { Settings } from "lucide-react";

import { BrandMark } from "./BrandMark";
import {
  DraftRecoveryDialog,
  type RecoverableDraft,
} from "./DraftRecoveryDialog";
import { useLocale } from "./i18n/LocaleProvider";
import { ProductSettingsPage } from "./ProductSettingsPage";
import { ProjectHome } from "./ProjectHome";
import { parseStoredSession, type StoredSession } from "./session-utils";
import { SetupView } from "./SetupView";
import type { AppSurface } from "./surface-types";
import { TutorialOverlay } from "./TutorialOverlay";
import { Workbench } from "./Workbench";
import { WorkspacePage } from "./WorkbenchPages";
import type { TutorialState } from "../shared/product-shell";
import { defaultTutorialState } from "../shared/product-shell";

const SESSION_KEY = "translunar.active-workspace.v1";

interface WorkspaceData {
  snapshot: ProjectSnapshot;
  document: Document;
  segments: Segment[];
  editorRows: SegmentEditorRow[];
  issues: QaIssue[];
}

type AppMode = "home" | "setup" | "workspace";

export function App() {
  const { t, ready } = useLocale();
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [mode, setMode] = useState<AppMode>("home");
  const [surface, setSurface] = useState<AppSurface>("workbench");
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tutorial, setTutorial] = useState<TutorialState | null>(null);
  const [engineBanner, setEngineBanner] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<RecoverableDraft[]>([]);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const session = readSession();
      if (!session) {
        if (!cancelled) setRestoring(false);
        return;
      }
      try {
        const data = await loadWorkspace(
          t,
          session.projectId,
          session.documentId,
        );
        if (!cancelled) {
          setWorkspace(data);
          setMode("workspace");
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
        if (!cancelled) setMode("home");
      } finally {
        if (!cancelled) setRestoring(false);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    void window.translunar
      .getTutorialState()
      .then(setTutorial)
      .catch(() => {
        setTutorial(defaultTutorialState());
      });
  }, []);

  useEffect(() => {
    const unsubscribeStatus = window.translunar.onEngineStatus((payload) => {
      if (payload.type === "reconnecting") {
        setEngineBanner(t("status.engineReconnecting"));
      } else if (payload.type === "reconnected") {
        setEngineBanner(t("status.engineReconnected"));
      } else if (payload.type === "failed") {
        setEngineBanner(t("error.engineExited"));
      }
    });
    const unsubscribeReconnect = window.translunar.onEngineReconnected(() => {
      void (async () => {
        setEngineBanner(t("status.engineReconnected"));
        if (!workspace) {
          // No active workspace: journal inspection does not depend on
          // project/document/segment projections.
          try {
            const recoveredDrafts = await inspectDrafts(null);
            setDrafts(recoveredDrafts);
          } catch {
            setDrafts([]);
          }
          setTimeout(() => setEngineBanner(null), 4_000);
          return;
        }
        try {
          // Authoritative project/document/segment/QA reload must succeed
          // before any journal revision comparison.
          const data = await loadWorkspace(
            t,
            workspace.snapshot.project.id,
            workspace.document.id,
          );
          setWorkspace(data);
          const recoveredDrafts = await inspectDrafts(data);
          setDrafts(recoveredDrafts);
          setTimeout(() => setEngineBanner(null), 4_000);
        } catch {
          // Do not classify drafts against pre-crash revisions. Keep a
          // recoverable error banner (Engine is already reconnected; only
          // authoritative workspace reload failed).
          setDrafts([]);
          setEngineBanner(t("error.generic"));
        }
      })();
    });
    return () => {
      unsubscribeStatus();
      unsubscribeReconnect();
    };
  }, [t, workspace]);

  useEffect(() => {
    void inspectDrafts(workspace)
      .then(setDrafts)
      .catch(() => setDrafts([]));
  }, [workspace?.document.id, workspace?.snapshot.project.id]);

  const openWorkspace = async (
    projectId: string,
    documentId?: string,
    segmentId?: string,
    segmentOrdinal?: number,
  ) => {
    const data = await loadWorkspace(t, projectId, documentId, segmentOrdinal);
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ projectId, documentId: data.document.id }),
    );
    setWorkspace(data);
    setMode("workspace");
    setSurface("workbench");
    setFocusSegmentId(segmentId ?? null);
  };

  const returnHome = () => {
    localStorage.removeItem(SESSION_KEY);
    setWorkspace(null);
    setMode("home");
    setSurface("workbench");
    setFocusSegmentId(null);
  };

  const refreshWorkspace = async () => {
    if (!workspace) return;
    const data = await loadWorkspace(
      t,
      workspace.snapshot.project.id,
      workspace.document.id,
    );
    setWorkspace(data);
  };

  const navigateFromWorkbench = async (nextSurface: AppSurface) => {
    if (!workspace) return;
    if (nextSurface === "workbench") {
      setSurface("workbench");
      return;
    }
    const data = await loadWorkspace(
      t,
      workspace.snapshot.project.id,
      workspace.document.id,
    );
    setWorkspace(data);
    setSurface(nextSurface);
  };

  const openSegment = (segmentId: string) => {
    setFocusSegmentId(segmentId);
    setSurface("workbench");
  };

  const openExample = useCallback(async () => {
    const result = await window.translunar.openExampleProject();
    if (!result.ok || !result.projectId) {
      throw new Error(result.message ?? t("error.generic"));
    }
    await openWorkspace(result.projectId, result.documentId);
  }, [t]);

  const persistTutorial = useCallback(
    async (next: {
      step: TutorialState["step"];
      skipped: boolean;
      completed: boolean;
    }) => {
      const saved = await window.translunar.updateTutorialState(next);
      setTutorial(saved);
    },
    [],
  );

  if (!ready || restoring) {
    return (
      <div className="boot-screen" role="status">
        <BrandMark />
        <span>{t("loading.workspace")}</span>
      </div>
    );
  }

  const showTutorial = tutorial && !tutorial.completed && !tutorial.skipped;

  const shellChrome = (
    <>
      {engineBanner ? (
        <div className="engine-status-banner" role="status">
          {engineBanner}
          <button
            type="button"
            className="button ghost"
            onClick={() => void window.translunar.restartEngine()}
          >
            {t("action.retry")}
          </button>
        </div>
      ) : null}
      {mode !== "workspace" ? (
        <button
          type="button"
          className="shell-settings-fab"
          aria-label={t("aria.settings")}
          title={t("action.settings")}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={18} aria-hidden="true" />
        </button>
      ) : null}
      {settingsOpen ? (
        <ProductSettingsPage
          project={workspace?.snapshot.project ?? null}
          onClose={() => setSettingsOpen(false)}
          onOpenExample={() => {
            void openExample().catch(() => undefined);
            setSettingsOpen(false);
          }}
          onRestartTutorial={() => {
            void persistTutorial({
              step: "welcome",
              skipped: false,
              completed: false,
            });
            setSettingsOpen(false);
          }}
          onWorkspaceReloaded={() => {
            void refreshWorkspace().catch(() => undefined);
          }}
        />
      ) : null}
      {showTutorial && tutorial ? (
        <TutorialOverlay
          initial={tutorial}
          onChange={(state) => {
            void persistTutorial(state);
          }}
          onOpenExample={() => {
            void openExample().catch(() => undefined);
          }}
        />
      ) : null}
      {drafts.length > 0 ? (
        <DraftRecoveryDialog
          drafts={drafts}
          onClose={() => setDrafts([])}
          onCopy={async (draft) => {
            await navigator.clipboard.writeText(draft.targetText);
          }}
          onDiscard={async (draft) => {
            await window.translunar.clearDraftJournal([draft.segmentId]);
            setDrafts((current) =>
              current.filter((item) => item.segmentId !== draft.segmentId),
            );
          }}
          onRestore={async (draft) => {
            if (draft.stale) return;
            await window.translunar.invoke("segment.updateTarget", {
              segmentId: draft.segmentId,
              targetText: draft.targetText,
              expectedRevision: draft.expectedRevision,
            });
            await window.translunar.clearDraftJournal([draft.segmentId]);
            setDrafts((current) =>
              current.filter((item) => item.segmentId !== draft.segmentId),
            );
            await refreshWorkspace();
          }}
        />
      ) : null}
    </>
  );

  if (mode === "home" || !workspace) {
    if (mode === "setup") {
      return (
        <>
          {shellChrome}
          <SetupView
            onCreated={openWorkspace}
            onCancel={() => setMode("home")}
          />
        </>
      );
    }
    return (
      <>
        {shellChrome}
        <ProjectHome onCreate={() => setMode("setup")} onOpen={openWorkspace} />
      </>
    );
  }

  if (surface !== "workbench") {
    return (
      <>
        {shellChrome}
        <WorkspacePage
          surface={surface}
          snapshot={workspace.snapshot}
          document={workspace.document}
          segments={workspace.segments}
          issues={workspace.issues}
          onNavigate={setSurface}
          onRefresh={refreshWorkspace}
          onOpenSegment={openSegment}
          onOpenDocument={(documentId) =>
            openWorkspace(workspace.snapshot.project.id, documentId)
          }
          onOpenProject={openWorkspace}
          onReturnHome={returnHome}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </>
    );
  }

  return (
    <>
      {shellChrome}
      <Workbench
        initialWorkspace={workspace}
        onReturnHome={returnHome}
        onNavigate={navigateFromWorkbench}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenGlobalSearchHit={(hit: GlobalSearchHit) =>
          openWorkspace(
            hit.projectId,
            hit.documentId ?? undefined,
            hit.segmentId ?? undefined,
            hit.segmentOrdinal ?? undefined,
          )
        }
        focusSegmentId={focusSegmentId}
      />
    </>
  );
}

async function loadWorkspace(
  translate: ReturnType<typeof useLocale>["t"],
  projectId: string,
  documentId?: string,
  focusSegmentOrdinal?: number,
): Promise<WorkspaceData> {
  const snapshot = await window.translunar.invoke("project.get", { projectId });
  if (snapshot.project.lifecycle === "trash") {
    throw new Error(translate("error.projectInRecycleBin"));
  }
  const document =
    snapshot.documents.find((item) => item.id === documentId) ??
    snapshot.documents[0];
  if (!document) throw new Error(translate("error.projectNoDocuments"));
  const offset =
    focusSegmentOrdinal === undefined
      ? 0
      : Math.max(0, focusSegmentOrdinal - 20);
  const [page, qa] = await Promise.all([
    window.translunar.invoke("segment.editor.list", {
      documentId: document.id,
      query: "",
      field: "both",
      filter: "all",
      sort: "ordinal",
      descending: false,
      offset,
      limit: 80,
      includeContext: true,
    }),
    window.translunar.invoke("qa.list", {
      projectId,
      documentId: document.id,
      offset: 0,
      limit: 200,
    }),
  ]);
  return {
    snapshot,
    document,
    segments: page.items.map((row) => row.segment),
    editorRows: page.items,
    issues: qa.issues,
  };
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const session = parseStoredSession(raw);
    if (raw && !session) {
      localStorage.removeItem(SESSION_KEY);
    }
    return session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

async function inspectDrafts(
  workspace: WorkspaceData | null | undefined,
): Promise<RecoverableDraft[]> {
  const journal = await window.translunar.getDraftJournal();
  if (journal.records.length === 0) return [];
  const relevant = workspace
    ? journal.records.filter(
        (item) =>
          item.projectId === workspace.snapshot.project.id &&
          item.documentId === workspace.document.id,
      )
    : journal.records;
  if (relevant.length === 0) return [];
  const byId = new Map(
    (workspace?.segments ?? []).map((segment) => [segment.id, segment]),
  );
  if (workspace) {
    const missingIds = new Set(
      relevant
        .map((record) => record.segmentId)
        .filter((segmentId) => !byId.has(segmentId)),
    );
    let offset = 0;
    while (missingIds.size > 0) {
      const page = await window.translunar.invoke("segment.list", {
        documentId: workspace.document.id,
        offset,
        limit: 200,
      });
      for (const segment of page.items) {
        if (!missingIds.has(segment.id)) continue;
        byId.set(segment.id, segment);
        missingIds.delete(segment.id);
      }
      offset += page.items.length;
      if (page.items.length === 0 || offset >= page.total) break;
    }
  }
  return relevant.map((record) => {
    const current = byId.get(record.segmentId);
    const stale =
      current === undefined || current.revision !== record.expectedRevision;
    return {
      ...record,
      stale,
      ...(current?.revision === undefined
        ? {}
        : { currentRevision: current.revision }),
    };
  });
}
