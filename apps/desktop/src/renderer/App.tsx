import { useEffect, useState } from "react";
import type {
  Document,
  ProjectSnapshot,
  QaIssue,
  Segment,
  SegmentEditorRow,
} from "@translunar/contracts";

import { BrandMark } from "./BrandMark";
import { ProjectHome } from "./ProjectHome";
import { parseStoredSession, type StoredSession } from "./session-utils";
import { SetupView } from "./SetupView";
import type { AppSurface } from "./surface-types";
import { Workbench } from "./Workbench";
import { WorkspacePage } from "./WorkbenchPages";

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
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [mode, setMode] = useState<AppMode>("home");
  const [surface, setSurface] = useState<AppSurface>("workbench");
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const session = readSession();
      if (!session) {
        if (!cancelled) setRestoring(false);
        return;
      }
      try {
        const data = await loadWorkspace(session.projectId, session.documentId);
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
  }, []);

  const openWorkspace = async (
    projectId: string,
    documentId?: string,
    segmentId?: string,
    segmentOrdinal?: number,
  ) => {
    const data = await loadWorkspace(projectId, documentId, segmentOrdinal);
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

  if (restoring) {
    return (
      <div className="boot-screen" role="status">
        <BrandMark />
        <span>Opening workspace</span>
      </div>
    );
  }

  if (mode === "home" || !workspace) {
    if (mode === "setup") {
      return (
        <SetupView onCreated={openWorkspace} onCancel={() => setMode("home")} />
      );
    }
    return (
      <ProjectHome onCreate={() => setMode("setup")} onOpen={openWorkspace} />
    );
  }

  if (surface !== "workbench") {
    return (
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
        onReturnHome={returnHome}
      />
    );
  }

  return (
    <Workbench
      initialWorkspace={workspace}
      onReturnHome={returnHome}
      onNavigate={navigateFromWorkbench}
      focusSegmentId={focusSegmentId}
    />
  );
}

async function loadWorkspace(
  projectId: string,
  documentId?: string,
  focusSegmentOrdinal?: number,
): Promise<WorkspaceData> {
  const snapshot = await window.translunar.invoke("project.get", { projectId });
  if (snapshot.project.lifecycle === "trash") {
    throw new Error("This project is in the recycle bin.");
  }
  const document =
    snapshot.documents.find((item) => item.id === documentId) ??
    snapshot.documents[0];
  if (!document) throw new Error("This project has no active documents.");
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
      documentId: document.id,
      includeResolved: false,
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
  const value = localStorage.getItem(SESSION_KEY);
  const session = parseStoredSession(value);
  if (!session && value !== null) localStorage.removeItem(SESSION_KEY);
  return session;
}
