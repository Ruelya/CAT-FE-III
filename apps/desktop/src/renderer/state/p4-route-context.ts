import type { AppSurface } from "./app-state";
import type { SessionIdentity } from "./session";

export type P4ReturnTarget =
  | {
      kind: "workbench";
      session: SessionIdentity;
      activeSegmentId: string | null;
    }
  | { kind: "projects" }
  | { kind: "welcome" };

export interface P4ProjectContext {
  projectId: string;
  projectName: string;
  documentId: string | null;
  activeSegmentId: string | null;
  session: SessionIdentity | null;
}

export type AiControlSection =
  | "providers"
  | "interactive"
  | "batch"
  | "usage"
  | "quality";

export type PluginsSection =
  | "installed"
  | "bundled"
  | "permissions"
  | "aiActions"
  | "uiPanels"
  | "connectors";

export type CollaborationSection =
  | "members"
  | "locks"
  | "presence"
  | "assignments"
  | "opLog";

export type SettingsSection =
  | "locale"
  | "appearance"
  | "data"
  | "updates"
  | "tutorial";

export function resolveP4RouteContext(
  surface: AppSurface,
): P4ProjectContext | null {
  switch (surface.kind) {
    case "workbench":
      return {
        projectId: surface.ctx.project.id,
        projectName: surface.ctx.project.name,
        documentId: surface.ctx.document.id,
        activeSegmentId: surface.activeSegmentId,
        session: surface.ctx.session,
      };
    case "qa":
    case "export":
      return {
        projectId: surface.ctx.project.id,
        projectName: surface.ctx.project.name,
        documentId: surface.ctx.document.id,
        activeSegmentId: null,
        session: surface.ctx.session,
      };
    case "insights":
    case "assets":
      return {
        projectId: surface.projectId,
        projectName: surface.projectName,
        documentId: surface.session?.documentId ?? null,
        activeSegmentId: null,
        session: surface.session,
      };
    case "ai-control":
    case "plugins":
    case "settings":
      return surface.context;
    case "collaboration":
      return surface.context;
    default:
      return null;
  }
}

export function resolveP4ReturnTarget(surface: AppSurface): P4ReturnTarget {
  switch (surface.kind) {
    case "workbench":
      return {
        kind: "workbench",
        session: surface.ctx.session,
        activeSegmentId: surface.activeSegmentId,
      };
    case "qa":
    case "export":
      return {
        kind: "workbench",
        session: surface.ctx.session,
        activeSegmentId: null,
      };
    case "insights":
    case "assets":
      if (surface.returnTo === "workbench" && surface.session) {
        return {
          kind: "workbench",
          session: surface.session,
          activeSegmentId: null,
        };
      }
      return { kind: "projects" };
    case "ai-control":
    case "plugins":
    case "settings":
    case "collaboration":
      return surface.returnTarget;
    case "welcome":
      return { kind: "welcome" };
    default:
      return { kind: "projects" };
  }
}

export function collaborationAvailable(
  context: P4ProjectContext | null,
): context is P4ProjectContext {
  return context !== null && context.projectId.length > 0;
}

export function aiSectionAvailable(
  section: AiControlSection,
  context: P4ProjectContext | null,
): boolean {
  switch (section) {
    case "providers":
    case "usage":
      return true;
    case "batch":
      return collaborationAvailable(context);
    case "quality":
      return (
        collaborationAvailable(context) &&
        typeof context.documentId === "string" &&
        context.documentId.length > 0
      );
    case "interactive":
      // Segment-dependent controls are absent without an active segment.
      return (
        collaborationAvailable(context) &&
        typeof context.documentId === "string" &&
        context.documentId.length > 0 &&
        typeof context.activeSegmentId === "string" &&
        context.activeSegmentId.length > 0
      );
    default:
      return false;
  }
}

export function defaultAiSection(
  context: P4ProjectContext | null,
): AiControlSection {
  if (aiSectionAvailable("interactive", context)) return "interactive";
  if (aiSectionAvailable("batch", context)) return "batch";
  return "providers";
}
