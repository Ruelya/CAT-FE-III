import type { Project } from "@translunar/contracts";

import type { SessionIdentity } from "../state/session";

export type HomeSurface = "welcome" | "projects";

export type StartupDestination =
  | { kind: "workbench"; session: SessionIdentity }
  | { kind: "home"; home: HomeSurface; projects: Project[] };

/**
 * Pure startup surface decision after session validation and project.list.
 * Valid session → workbench; else empty projects → welcome; else projects.
 */
export function resolveHomeSurface(projects: readonly Project[]): HomeSurface {
  return projects.length === 0 ? "welcome" : "projects";
}

export function resolveStartupDestination(input: {
  validatedSession: SessionIdentity | null;
  projects: readonly Project[];
}): StartupDestination {
  if (input.validatedSession) {
    return { kind: "workbench", session: input.validatedSession };
  }
  const home = resolveHomeSurface(input.projects);
  return { kind: "home", home, projects: [...input.projects] };
}

/**
 * Open-project document routing for P0 single-document workflow.
 * zero docs → import; otherwise first Engine-returned document.
 */
export function resolveOpenProjectRoute(
  documents: readonly { id: string }[],
): { kind: "import" } | { kind: "document"; documentId: string } {
  if (documents.length === 0) return { kind: "import" };
  return { kind: "document", documentId: documents[0]!.id };
}
