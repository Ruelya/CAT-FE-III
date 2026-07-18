import { useEffect, useState } from "react";
import type {
  Document,
  ProjectSnapshot,
  QaIssue,
  Segment,
} from "@translunar/contracts";

import { SetupView } from "./SetupView";
import { Workbench } from "./Workbench";

const SESSION_KEY = "translunar.active-workspace.v1";

interface WorkspaceData {
  snapshot: ProjectSnapshot;
  document: Document;
  segments: Segment[];
  issues: QaIssue[];
}

interface StoredSession {
  projectId: string;
  documentId: string;
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [restoring, setRestoring] = useState(true);

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
        if (!cancelled) setWorkspace(data);
      } catch {
        localStorage.removeItem(SESSION_KEY);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const openWorkspace = async (projectId: string, documentId: string) => {
    const data = await loadWorkspace(projectId, documentId);
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ projectId, documentId }),
    );
    setWorkspace(data);
  };

  const startAnotherProject = () => {
    localStorage.removeItem(SESSION_KEY);
    setWorkspace(null);
  };

  if (restoring) {
    return (
      <div className="boot-screen" role="status">
        <BrandMark />
        <span>Opening workspace</span>
      </div>
    );
  }

  if (!workspace) return <SetupView onCreated={openWorkspace} />;

  return (
    <Workbench
      initialWorkspace={workspace}
      onStartAnotherProject={startAnotherProject}
    />
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span className="brand-mark-orbit" />
      <span className="brand-mark-core" />
    </span>
  );
}

async function loadWorkspace(
  projectId: string,
  documentId: string,
): Promise<WorkspaceData> {
  const [snapshot, page, qa] = await Promise.all([
    window.translunar.invoke("project.get", { projectId }),
    window.translunar.invoke("segment.list", {
      documentId,
      offset: 0,
      limit: 1000,
    }),
    window.translunar.invoke("qa.list", {
      documentId,
      includeResolved: false,
    }),
  ]);
  const document = snapshot.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("The active document no longer exists.");
  return { snapshot, document, segments: page.items, issues: qa.issues };
}

function readSession(): StoredSession | null {
  const value = localStorage.getItem(SESSION_KEY);
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "projectId" in parsed &&
      typeof parsed.projectId === "string" &&
      "documentId" in parsed &&
      typeof parsed.documentId === "string"
    ) {
      return { projectId: parsed.projectId, documentId: parsed.documentId };
    }
  } catch {
    return null;
  }
  return null;
}
