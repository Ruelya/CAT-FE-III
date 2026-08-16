/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/no-unnecessary-type-assertion -- test double */
import type {
  EngineMethod,
  EngineParams,
  EngineResult,
  Project,
  Document,
  ProjectAnalyticsSummary,
  ProjectTemplate,
  RecycleEntry,
  Segment,
  SegmentEditorRow,
  SegmentCounts,
  GlobalSearchHit,
} from "@translunar/contracts";

import type {
  DesktopApi,
  WindowChromePlatform,
} from "../../shared/desktop-api";
import type {
  TutorialState,
  UpdateStatusSnapshot,
} from "../../shared/product-shell";
import type {
  DraftJournalRecord,
  DraftJournalSnapshot,
  ExampleProjectResult,
} from "../../shared/product-shell";

function emptyCounts(): SegmentCounts {
  return {
    confirmed: 0,
    draft: 0,
    untranslated: 0,
    total: 0,
    openIssues: 0,
  };
}

function rowFromSegment(segment: Segment): SegmentEditorRow {
  return {
    segment,
    comments: [],
    sourceTags: [],
    targetTags: [],
    spellFindings: [],
    tagIssues: [],
    workflowState: "translation",
  };
}

export interface FakePdfPage {
  page: number;
  width: number;
  height: number;
  imagePngBase64: string;
  blocks: Array<{
    segmentId: string;
    sourceKind: string;
    state: Segment["state"];
    sourceText: string;
    targetText: string;
    revision: number;
    kind: string;
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
  segmentIds: string[];
  ocrBlockCount: number;
}

export interface FakeEngineState {
  projects: Project[];
  documents: Document[];
  segments: Segment[];
  templates: ProjectTemplate[];
  recycle: RecycleEntry[];
  searchHits: GlobalSearchHit[];
  analytics: ProjectAnalyticsSummary | null;
  failMethods: Set<string>;
  sourcePath: string | null;
  sourcePaths: string[] | null;
  exportPath: string | null;
  interopReviewPath: string | null;
  interopTablePath: string | null;
  taskPackagePath: string | null;
  pluginPackagePath: string | null;
  pluginPanelRevokeListeners: Array<(pluginId: string | null) => void>;
  systemLocale?: string;
  shellSettings?: Partial<{
    locale: "en-US" | "zh-CN" | null;
    updateMode: "automatic" | "manual" | "disabled";
    deferredUntilMs: number | null;
    tutorial: {
      version: number;
      step:
        "welcome" | "create" | "import" | "edit" | "qa" | "export" | "complete";
      skipped: boolean;
      completed: boolean;
      updatedAtMs: number;
    };
    dataDirectoryPath: string | null;
  }>;
  dataDirectoryStatus?: {
    path: string;
    absolutePath: string;
    exists: boolean;
    writable: boolean;
    freeBytes: number | null;
    freeBytesLabel: string;
    isTestOverride: boolean;
    healthy: boolean | null;
    schemaVersion: number | null;
  };
  dataDirectoryPath?: string | null;
  backupDestination?: string | null;
  restoreSource?: string | null;
  updateStatus?: UpdateStatusSnapshot;
  tutorial?: TutorialState;
  /** Optional PDF pages keyed by documentId. */
  pdfPagesByDocument: Record<string, FakePdfPage[]>;
  journal: DraftJournalRecord[];
  calls: Array<{ method: string; params: unknown }>;
  gateClear: boolean;
  exampleResult: ExampleProjectResult;
  statusListeners: Array<
    (payload: {
      type: "reconnecting" | "reconnected" | "failed";
      attempt?: number;
      message?: string;
    }) => void
  >;
  reconnectListeners: Array<() => void>;
  /** Fake maximized state for window-chrome bridge methods. */
  windowMaximized: boolean;
  /** Platform branch for title-strip controls (default custom). */
  windowChromePlatform: WindowChromePlatform;
}

export function createFakeEngineState(
  overrides: Partial<FakeEngineState> = {},
): FakeEngineState {
  return {
    projects: [],
    documents: [],
    segments: [],
    templates: [],
    recycle: [],
    searchHits: [],
    analytics: null,
    failMethods: new Set(),
    sourcePath: null,
    sourcePaths: null,
    exportPath: null,
    interopReviewPath: null,
    interopTablePath: null,
    taskPackagePath: null,
    pluginPackagePath: null,
    pluginPanelRevokeListeners: [],
    pdfPagesByDocument: {},
    journal: [],
    calls: [],
    gateClear: true,
    exampleResult: { ok: false, message: "no example", code: "NO_EXAMPLE" },
    statusListeners: [],
    reconnectListeners: [],
    windowMaximized: false,
    windowChromePlatform: "custom",
    ...overrides,
  };
}

export function createFakeDesktopApi(state: FakeEngineState): DesktopApi {
  const rejectIfFailed = (method: string) => {
    if (state.failMethods.has(method)) {
      return Promise.reject({
        code: "FAKE_FAIL",
        message: `${method} failed`,
      });
    }
    return null;
  };

  const shellSettingsBase = {
    locale: null as null,
    updateMode: "manual" as const,
    deferredUntilMs: null as null,
    tutorial: {
      version: 1,
      step: "welcome" as const,
      skipped: false,
      completed: false,
      updatedAtMs: 0,
    },
    dataDirectoryPath: null as null,
    backupHistory: [] as [],
    updateHistory: [] as [],
    installLedger: null as null,
  };

  const api: DesktopApi = {
    async invoke<Method extends EngineMethod>(
      method: Method,
      params: EngineParams<Method>,
    ): Promise<EngineResult<Method>> {
      state.calls.push({ method, params });
      const failed = rejectIfFailed(method);
      if (failed) return failed as never;

      switch (method) {
        case "engine.initialize":
          return {
            protocolVersion: 1,
            engineVersion: "test",
            capabilities: [],
          } as EngineResult<Method>;
        case "project.list": {
          const p = params as EngineParams<"project.list">;
          const lifecycle = p.lifecycle ?? "active";
          const filtered = state.projects.filter(
            (project) => project.lifecycle === lifecycle,
          );
          const offset = p.offset ?? 0;
          const limit = p.limit ?? 200;
          const items = filtered.slice(offset, offset + limit);
          return {
            items,
            limit,
            offset,
            total: filtered.length,
          } as EngineResult<Method>;
        }
        case "project.create": {
          const p = params as EngineParams<"project.create">;
          const project: Project = {
            id: `proj-${state.projects.length + 1}`,
            name: p.name,
            domain: p.domain,
            sourceLocale: p.sourceLocale,
            targetLocale: p.targetLocale,
            lifecycle: "active",
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
            configuration: {},
          };
          state.projects.push(project);
          return project as EngineResult<Method>;
        }
        case "project.update": {
          const p = params as EngineParams<"project.update">;
          const project = state.projects.find((x) => x.id === p.projectId);
          if (!project) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Project not found",
            }) as never;
          }
          if (project.revision !== p.expectedRevision) {
            return Promise.reject({
              code: "REVISION_CONFLICT",
              message: "Revision conflict",
            }) as never;
          }
          project.name = p.name;
          project.domain = p.domain;
          project.sourceLocale = p.sourceLocale;
          project.targetLocale = p.targetLocale;
          if (p.configuration) {
            project.configuration = p.configuration as Project["configuration"];
          }
          project.revision += 1;
          project.updatedAtMs = Date.now();
          return { ...project } as EngineResult<Method>;
        }
        case "project.setLifecycle": {
          const p = params as EngineParams<"project.setLifecycle">;
          const project = state.projects.find((x) => x.id === p.projectId);
          if (!project) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Project not found",
            }) as never;
          }
          if (project.revision !== p.expectedRevision) {
            return Promise.reject({
              code: "REVISION_CONFLICT",
              message: "Revision conflict",
            }) as never;
          }
          project.lifecycle = p.lifecycle;
          project.revision += 1;
          project.updatedAtMs = Date.now();
          return { ...project } as EngineResult<Method>;
        }
        case "project.batchImport": {
          const p = params as EngineParams<"project.batchImport">;
          const items = p.items.map((item, index) => {
            const doc: Document = {
              id: `doc-${state.documents.length + 1}`,
              projectId: p.projectId,
              name: item.path.split(/[/\\]/).pop() || `file-${index}.txt`,
              format: "txt",
              filterId: "builtin.txt",
              relativePath:
                item.path.split(/[/\\]/).pop() || `file-${index}.txt`,
              status: "active",
              revision: 1,
              currentVersion: 1,
              segmentCount: 1,
              sourceSha256: `sha-${index}`,
              importedAtMs: Date.now(),
              updatedAtMs: Date.now(),
              degradation: [],
            };
            state.documents.push(doc);
            // Prefer rebinding pre-seeded segments (P0 test pattern) for first file.
            const orphanSegments = state.segments.filter(
              (s) => !state.documents.some((d) => d.id === s.documentId),
            );
            if (index === 0 && orphanSegments.length > 0) {
              for (const seg of orphanSegments) {
                seg.documentId = doc.id;
              }
              doc.segmentCount = orphanSegments.length;
            } else if (!state.segments.some((s) => s.documentId === doc.id)) {
              const segmentId =
                state.segments.length === 0
                  ? "seg-1"
                  : `seg-${state.segments.length + 1}`;
              state.segments.push({
                id: segmentId,
                documentId: doc.id,
                ordinal: 1,
                revision: 1,
                sourceText:
                  segmentId === "seg-1"
                    ? "Hello world"
                    : `Hello from ${doc.name}`,
                targetText: "",
                state: "untranslated",
                contextHash: "c",
                sourceHash: "s",
                structuralPath: "1",
                updatedAtMs: Date.now(),
              });
            }
            return {
              path: item.path,
              relativePath: doc.relativePath,
              status: "succeeded",
              document: doc,
              message: null,
              errorCode: null,
            };
          });
          return {
            succeeded: items.length,
            failed: 0,
            items,
          } as EngineResult<Method>;
        }
        case "project.template.list": {
          const p = params as EngineParams<"project.template.list">;
          const offset = p.offset ?? 0;
          const limit = p.limit ?? 50;
          const items = state.templates.slice(offset, offset + limit);
          return {
            items,
            limit,
            offset,
            total: state.templates.length,
          } as EngineResult<Method>;
        }
        case "project.template.get": {
          const p = params as EngineParams<"project.template.get">;
          const template = state.templates.find((t) => t.id === p.templateId);
          if (!template) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Template not found",
            }) as never;
          }
          return { ...template } as EngineResult<Method>;
        }
        case "project.template.create": {
          const p = params as EngineParams<"project.template.create">;
          const template: ProjectTemplate = {
            id: `tpl-${state.templates.length + 1}`,
            name: p.name,
            description: p.description ?? "",
            definition: p.definition ?? {},
            builtIn: false,
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          };
          state.templates.push(template);
          return template as EngineResult<Method>;
        }
        case "project.template.update": {
          const p = params as EngineParams<"project.template.update">;
          const template = state.templates.find((t) => t.id === p.templateId);
          if (!template) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Template not found",
            }) as never;
          }
          if (template.builtIn) {
            return Promise.reject({
              code: "BUILTIN",
              message: "Built-in template",
            }) as never;
          }
          if (template.revision !== p.expectedRevision) {
            return Promise.reject({
              code: "REVISION_CONFLICT",
              message: "Revision conflict",
            }) as never;
          }
          template.name = p.name;
          if (p.description !== undefined) template.description = p.description;
          if (p.definition !== undefined) template.definition = p.definition;
          template.revision += 1;
          template.updatedAtMs = Date.now();
          return { ...template } as EngineResult<Method>;
        }
        case "project.template.delete": {
          const p = params as EngineParams<"project.template.delete">;
          const index = state.templates.findIndex((t) => t.id === p.templateId);
          if (index < 0) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Template not found",
            }) as never;
          }
          const template = state.templates[index]!;
          if (template.builtIn) {
            return Promise.reject({
              code: "BUILTIN",
              message: "Built-in template",
            }) as never;
          }
          if (template.revision !== p.expectedRevision) {
            return Promise.reject({
              code: "REVISION_CONFLICT",
              message: "Revision conflict",
            }) as never;
          }
          state.templates.splice(index, 1);
          return {} as EngineResult<Method>;
        }
        case "project.createFromTemplate": {
          const p = params as EngineParams<"project.createFromTemplate">;
          const template = state.templates.find((t) => t.id === p.templateId);
          if (!template) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Template not found",
            }) as never;
          }
          const project: Project = {
            id: `proj-${state.projects.length + 1}`,
            name: p.name,
            domain: p.domain ?? "general",
            sourceLocale: p.sourceLocale ?? "en-US",
            targetLocale: p.targetLocale ?? "zh-CN",
            lifecycle: "active",
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
            configuration: { templateId: template.id },
          };
          state.projects.push(project);
          return {
            project,
            diagnostics: [],
          } as EngineResult<Method>;
        }
        case "project.analytics.get": {
          const p = params as EngineParams<"project.analytics.get">;
          if (state.analytics) {
            return {
              ...state.analytics,
              projectId: p.projectId,
            } as EngineResult<Method>;
          }
          const emptyProgress = {
            completionBasisPoints: 0,
            confirmedSegments: 0,
            draftSegments: 0,
            qaBlockers: 0,
            reviewedSegments: 0,
            totalSegments: 0,
            untranslatedSegments: 0,
            workflowReview: 0,
            workflowSigned: 0,
            workflowTranslation: 0,
          };
          return {
            projectId: p.projectId,
            generatedAtMs: Date.now(),
            progress: emptyProgress,
            documentProgress: {},
            productivity: {
              activeEditingMs: { available: false, reason: "no data" },
              activityEvents: 0,
              confirmedSegmentsPerHourMilli: {
                available: false,
                reason: "no data",
              },
              idleGapMs: 0,
              timeInStateMs: {},
            },
            trends: [],
            ai: {
              available: false,
              contribution: {
                appliedSegments: 0,
                editDistance: 0,
                proposalCharacters: 0,
                replacedSegments: 0,
                retainedCharacters: 0,
                retainedSegments: 0,
              },
              reason: "not surfaced",
            },
            assets: {
              curationOutcomes: { available: false },
              mountedLibraryHitSegments: { available: false },
              qaOpenBlockers: 0,
              termEntries: 0,
              tmConfirmedUnits: 0,
              tmReuseSegments: { available: false },
            },
          } as EngineResult<Method>;
        }
        case "recycle.list": {
          const p = params as EngineParams<"recycle.list">;
          const offset = p.offset ?? 0;
          const limit = p.limit ?? 50;
          const items = state.recycle.slice(offset, offset + limit);
          return {
            items,
            limit,
            offset,
            total: state.recycle.length,
          } as EngineResult<Method>;
        }
        case "recycle.delete": {
          const p = params as EngineParams<"recycle.delete">;
          const entry: RecycleEntry = {
            id: `rec-${state.recycle.length + 1}`,
            entityId: p.entityId,
            entityType: p.entityType,
            displayName:
              p.entityType === "project"
                ? (state.projects.find((x) => x.id === p.entityId)?.name ??
                  p.entityId)
                : (state.documents.find((x) => x.id === p.entityId)?.name ??
                  p.entityId),
            projectId:
              p.entityType === "project"
                ? p.entityId
                : (state.documents.find((x) => x.id === p.entityId)
                    ?.projectId ?? ""),
            reason: p.reason,
            actor: "test",
            deletedAtMs: Date.now(),
            retentionUntilMs: Date.now() + 86_400_000,
            previousState: "active",
          };
          if (p.entityType === "project") {
            state.projects = state.projects.filter((x) => x.id !== p.entityId);
          } else if (p.entityType === "document") {
            state.documents = state.documents.filter(
              (x) => x.id !== p.entityId,
            );
            state.segments = state.segments.filter(
              (s) => s.documentId !== p.entityId,
            );
          }
          state.recycle.push(entry);
          return entry as EngineResult<Method>;
        }
        case "recycle.restore": {
          const p = params as EngineParams<"recycle.restore">;
          const index = state.recycle.findIndex((e) => e.id === p.entryId);
          if (index < 0) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Entry not found",
            }) as never;
          }
          state.recycle.splice(index, 1);
          return {} as EngineResult<Method>;
        }
        case "recycle.purge": {
          const p = params as EngineParams<"recycle.purge">;
          const index = state.recycle.findIndex((e) => e.id === p.entryId);
          if (index < 0) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Entry not found",
            }) as never;
          }
          state.recycle.splice(index, 1);
          return {} as EngineResult<Method>;
        }
        case "search.global": {
          const p = params as EngineParams<"search.global">;
          const text = p.text.toLowerCase();
          const filtered = state.searchHits.filter(
            (hit) =>
              hit.snippet.toLowerCase().includes(text) ||
              hit.projectName.toLowerCase().includes(text) ||
              (hit.documentName ?? "").toLowerCase().includes(text),
          );
          const offset = p.offset ?? 0;
          const limit = p.limit ?? 25;
          return {
            items: filtered.slice(offset, offset + limit),
            limit,
            offset,
            total: filtered.length,
          } as EngineResult<Method>;
        }
        case "project.get": {
          const p = params as EngineParams<"project.get">;
          const project = state.projects.find((x) => x.id === p.projectId);
          if (!project) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Project not found",
            }) as never;
          }
          const docs = state.documents.filter(
            (d) => d.projectId === project.id,
          );
          return {
            project,
            documents: docs,
            counts: emptyCounts(),
          } as EngineResult<Method>;
        }
        case "document.list": {
          const p = params as EngineParams<"document.list">;
          const items = state.documents.filter(
            (d) => d.projectId === p.projectId,
          );
          return {
            items,
            limit: 200,
            offset: 0,
            total: items.length,
          } as EngineResult<Method>;
        }
        case "document.get": {
          const p = params as EngineParams<"document.get">;
          const doc = state.documents.find((d) => d.id === p.documentId);
          if (!doc) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Document not found",
            }) as never;
          }
          return doc as EngineResult<Method>;
        }
        case "document.import": {
          const p = params as EngineParams<"document.import">;
          const doc: Document = {
            id: `doc-${state.documents.length + 1}`,
            projectId: p.projectId,
            name: "source.txt",
            format: "txt",
            filterId: "builtin.txt",
            relativePath: "source.txt",
            status: "active",
            revision: 1,
            currentVersion: 1,
            segmentCount: state.segments.length || 1,
            sourceSha256: "abc",
            importedAtMs: Date.now(),
            updatedAtMs: Date.now(),
            degradation: [],
          };
          state.documents.push(doc);
          if (state.segments.length === 0) {
            state.segments.push({
              id: "seg-1",
              documentId: doc.id,
              ordinal: 1,
              revision: 1,
              sourceText: "Hello world",
              targetText: "",
              state: "untranslated",
              contextHash: "c",
              sourceHash: "s",
              structuralPath: "1",
              updatedAtMs: Date.now(),
            });
          } else {
            for (const seg of state.segments) {
              seg.documentId = doc.id;
            }
          }
          return {
            document: doc,
            filterId: "builtin.txt",
            degradation: [],
          } as EngineResult<Method>;
        }
        case "segment.editor.list": {
          const p = params as EngineParams<"segment.editor.list">;
          const offset = p.offset ?? 0;
          const limit = p.limit ?? 200;
          const query = (p.query ?? "").trim().toLowerCase();
          const filtered = state.segments
            .filter((s) => s.documentId === p.documentId)
            .filter((s) => {
              if (p.filter === "untranslated") return s.state === "untranslated";
              if (p.filter === "draft") return s.state === "draft";
              if (p.filter === "confirmed") return s.state === "confirmed";
              return true;
            })
            .filter((s) => {
              if (!query) return true;
              const field = p.field ?? "both";
              const source = s.sourceText.toLowerCase();
              const target = s.targetText.toLowerCase();
              if (field === "source") return source.includes(query);
              if (field === "target") return target.includes(query);
              return source.includes(query) || target.includes(query);
            })
            .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
            .map(rowFromSegment);
          return {
            items: filtered.slice(offset, offset + limit),
            limit,
            offset,
            total: filtered.length,
          } as EngineResult<Method>;
        }
        case "segment.updateTarget": {
          const p = params as EngineParams<"segment.updateTarget">;
          const seg = state.segments.find((s) => s.id === p.segmentId);
          if (!seg) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Segment not found",
            }) as never;
          }
          seg.targetText = p.targetText;
          seg.revision += 1;
          seg.state = "draft";
          seg.updatedAtMs = Date.now();
          return { ...seg } as EngineResult<Method>;
        }
        case "segment.confirm": {
          const p = params as EngineParams<"segment.confirm">;
          const seg = state.segments.find((s) => s.id === p.segmentId);
          if (!seg) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Segment not found",
            }) as never;
          }
          seg.state = "confirmed";
          seg.revision += 1;
          return {
            segment: { ...seg },
            counts: {
              confirmed: state.segments.filter((s) => s.state === "confirmed")
                .length,
              draft: state.segments.filter((s) => s.state === "draft").length,
              untranslated: state.segments.filter(
                (s) => s.state === "untranslated",
              ).length,
              total: state.segments.length,
              openIssues: 0,
            },
            qaIssues: [],
            tmEntry: {
              id: "tm-1",
              memoryId: "m",
              originDocumentId: seg.documentId,
              originProjectId: "p",
              originSegmentId: seg.id,
              sourceHash: seg.sourceHash,
              sourceText: seg.sourceText,
              targetText: seg.targetText,
              confirmedAtMs: Date.now(),
            },
          } as EngineResult<Method>;
        }
        case "tm.lookupExact":
          return { matches: [] } as EngineResult<Method>;
        case "qa.run":
          return {
            id: "run-1",
            projectId: (params as EngineParams<"qa.run">).projectId,
            documentId: (params as EngineParams<"qa.run">).documentId ?? null,
            profileId: "default",
            profileName: "default",
            profileRevision: 1,
            profileSnapshotHash: "h",
            scope: "document",
            status: "succeeded",
            checkedSegments: state.segments.length,
            errors: 0,
            warnings: 0,
            info: 0,
            waived: 0,
            createdAtMs: Date.now(),
          } as EngineResult<Method>;
        case "qa.issue.list":
          return {
            items: [],
            limit: 200,
            offset: 0,
            total: 0,
          } as EngineResult<Method>;
        case "qa.gate.check": {
          const p = params as EngineParams<"qa.gate.check">;
          return {
            clear: state.gateClear,
            documentId: p.documentId,
            errorCount: state.gateClear ? 0 : 1,
            warningCount: 0,
            infoCount: 0,
            waivedCount: 0,
            blockerIssueIds: state.gateClear ? [] : ["issue-1"],
            run: {
              id: "run-1",
              projectId: p.projectId,
              documentId: p.documentId,
              profileId: "default",
              profileName: "default",
              profileRevision: 1,
              profileSnapshotHash: "h",
              scope: "document",
              status: "succeeded",
              checkedSegments: 1,
              errors: state.gateClear ? 0 : 1,
              warnings: 0,
              info: 0,
              waived: 0,
              createdAtMs: Date.now(),
            },
          } as EngineResult<Method>;
        }
        case "document.export": {
          const p = params as EngineParams<"document.export">;
          return {
            outputPath: p.outputPath,
            filterId: "builtin.txt",
            translatedSegments: state.segments.filter(
              (s) => s.state === "confirmed",
            ).length,
            degradation: [],
          } as EngineResult<Method>;
        }
        // P2 editor
        case "segment.find": {
          const p = params as EngineParams<"segment.find">;
          if (!p.query) {
            return {
              matches: [],
              total: 0,
              offset: 0,
              limit: p.limit ?? 25,
            } as EngineResult<Method>;
          }
          const matches = state.segments
            .filter((s) => s.documentId === p.documentId)
            .filter((s) =>
              `${s.sourceText} ${s.targetText}`
                .toLowerCase()
                .includes(p.query.toLowerCase()),
            )
            .map((s) => ({
              segmentId: s.id,
              field: "target" as const,
              matchedText: s.targetText || s.sourceText,
              start: 0,
              end: 1,
              revision: s.revision,
            }));
          return {
            matches,
            total: matches.length,
            offset: p.offset ?? 0,
            limit: p.limit ?? 25,
          } as EngineResult<Method>;
        }
        case "segment.replace.preview": {
          const p = params as EngineParams<"segment.replace.preview">;
          const items = state.segments
            .filter((s) => s.documentId === p.documentId)
            .filter((s) => s.targetText.includes(p.query))
            .map((s) => ({
              segmentId: s.id,
              field: "target" as const,
              before: s.targetText,
              after: s.targetText.replaceAll(p.query, p.replacement),
              replacements: 1,
              revision: s.revision,
            }));
          return {
            documentId: p.documentId,
            token: "preview-token",
            changedSegments: items.length,
            replacementCount: items.length,
            items,
          } as EngineResult<Method>;
        }
        case "segment.replace.apply": {
          const p = params as EngineParams<"segment.replace.apply">;
          if (p.preview.token !== "preview-token") {
            return Promise.reject({
              code: "STALE_PREVIEW",
              message: "Stale preview token",
            }) as never;
          }
          const rows = [];
          for (const item of p.preview.items) {
            const seg = state.segments.find((s) => s.id === item.segmentId);
            if (!seg) continue;
            seg.targetText = item.after;
            seg.revision += 1;
            seg.state = "draft";
            rows.push(rowFromSegment(seg));
          }
          return {
            rows,
            counts: emptyCounts(),
            focusSegmentId: rows[0]?.segment.id ?? null,
          } as EngineResult<Method>;
        }
        case "segment.tag.set": {
          const p = params as EngineParams<"segment.tag.set">;
          const seg = state.segments.find((s) => s.id === p.segmentId);
          if (!seg) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Segment not found",
            }) as never;
          }
          if (seg.revision !== p.expectedRevision) {
            return Promise.reject({
              code: "REVISION_CONFLICT",
              message: "Revision conflict",
            }) as never;
          }
          seg.revision += 1;
          const editorRow = rowFromSegment(seg);
          editorRow.targetTags = p.targetTags;
          return {
            rows: [editorRow],
            counts: emptyCounts(),
            focusSegmentId: seg.id,
          } as EngineResult<Method>;
        }
        case "segment.propagate": {
          const p = params as EngineParams<"segment.propagate">;
          const seg = state.segments.find((s) => s.id === p.segmentId);
          if (!seg) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Segment not found",
            }) as never;
          }
          seg.revision += 1;
          return {
            rows: [rowFromSegment(seg)],
            counts: emptyCounts(),
            focusSegmentId: seg.id,
          } as EngineResult<Method>;
        }
        case "segment.split":
        case "segment.merge":
        case "segment.correctSource":
        case "segment.chinese.convert":
        case "editor.undo":
        case "editor.redo": {
          const rows = state.segments.map(rowFromSegment);
          return {
            rows,
            counts: emptyCounts(),
            focusSegmentId: rows[0]?.segment.id ?? null,
          } as EngineResult<Method>;
        }
        case "segment.comment.list":
          return { comments: [] } as EngineResult<Method>;
        case "segment.comment.create": {
          const p = params as EngineParams<"segment.comment.create">;
          return {
            id: "c-1",
            segmentId: p.segmentId,
            author: p.author,
            text: p.text,
            resolved: false,
            immutable: false,
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          } as EngineResult<Method>;
        }
        case "segment.comment.resolve":
        case "segment.comment.update":
        case "segment.comment.delete":
          return {
            id: "c-1",
            segmentId: "seg-1",
            author: "local",
            text: "x",
            resolved: true,
            immutable: false,
            revision: 2,
            createdAtMs: 1,
            updatedAtMs: Date.now(),
          } as EngineResult<Method>;
        case "segment.spell.check":
          return {
            available: true,
            provider: "fake",
            findings: [],
          } as EngineResult<Method>;
        case "dictionary.list":
        case "dictionary.add":
        case "dictionary.remove":
          return {
            locale: (params as { locale: string }).locale,
            words: [],
          } as EngineResult<Method>;
        case "editor.history":
          return {
            canUndo: false,
            canRedo: false,
            operations: [],
            total: 0,
          } as EngineResult<Method>;
        case "editor.preferences.get":
        case "editor.preferences.update":
          return {
            zoom: 1,
            theme: "default",
            showNonprinting: false,
            autocomplete: true,
            cjkSpacing: false,
            punctuationAssistance: false,
            shortcuts: {},
            ...((params as { preferences?: Record<string, unknown> })
              .preferences ?? {}),
          } as EngineResult<Method>;
        case "review.queue":
          return {
            items: [],
            total: 0,
            offset: 0,
            limit: 25,
          } as EngineResult<Method>;
        case "review.accept":
          return {
            rows: state.segments.map(rowFromSegment),
            counts: emptyCounts(),
            focusSegmentId: null,
          } as EngineResult<Method>;
        case "review.reject":
          return {
            id: "r-1",
            segmentId: "seg-1",
            author: "a",
            reason: "r",
            baseRevision: 1,
            beforeTarget: "",
            proposedTarget: "",
            status: "rejected",
            createdAtMs: 1,
            updatedAtMs: 1,
          } as EngineResult<Method>;
        // P2 assets
        case "tm.library.list":
          return {
            items: [
              {
                id: "tm-1",
                name: "Default TM",
                sourceLocale: "en",
                targetLocale: "zh",
                writable: true,
                revision: 1,
                createdAtMs: 1,
                updatedAtMs: 1,
              },
            ],
            mounts: [],
            total: 1,
            offset: 0,
            limit: 50,
          } as EngineResult<Method>;
        case "tm.library.create": {
          const p = params as EngineParams<"tm.library.create">;
          return {
            id: "tm-1",
            name: p.name,
            sourceLocale: p.sourceLocale,
            targetLocale: p.targetLocale,
            writable: true,
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          } as EngineResult<Method>;
        }
        case "tm.library.mount": {
          const p = params as EngineParams<"tm.library.mount">;
          return {
            libraryId: p.libraryId,
            projectId: p.projectId,
            mode: p.mode,
            enabled: true,
            priority: 0,
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          } as EngineResult<Method>;
        }
        case "tm.library.unmount":
          return {} as EngineResult<Method>;
        case "tm.search": {
          const p = params as EngineParams<"tm.search">;
          return {
            matches: [],
            total: 50,
            offset: p.offset ?? 0,
            limit: p.limit ?? 25,
          } as EngineResult<Method>;
        }
        case "tm.concordance": {
          const p = params as EngineParams<"tm.concordance">;
          return {
            hits: [],
            total: 50,
            offset: p.offset ?? 0,
            limit: p.limit ?? 25,
            corpusHits: [],
            corpusTotal: 0,
          } as EngineResult<Method>;
        }
        case "tm.export": {
          const p = params as EngineParams<"tm.export">;
          return {
            libraryId: p.libraryId,
            outputPath: p.outputPath,
            unitCount: 0,
          } as EngineResult<Method>;
        }
        case "tm.import":
          return {
            libraryId: "tm-1",
            inserted: 0,
            skipped: 0,
            diagnostics: [],
          } as EngineResult<Method>;
        case "termbase.list":
          return {
            items: [],
            mounts: [],
            total: 0,
            offset: 0,
            limit: 50,
          } as EngineResult<Method>;
        case "termbase.create": {
          const p = params as EngineParams<"termbase.create">;
          return {
            id: "tb-1",
            name: p.name,
            sourceLocale: p.sourceLocale,
            writable: true,
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          } as EngineResult<Method>;
        }
        case "termbase.mount": {
          const p = params as EngineParams<"termbase.mount">;
          return {
            termbaseId: p.termbaseId,
            projectId: p.projectId,
            writable: p.writable ?? true,
            enabled: true,
            priority: 0,
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          } as EngineResult<Method>;
        }
        case "termbase.unmount":
          return {} as EngineResult<Method>;
        case "term.search": {
          const p = params as EngineParams<"term.search">;
          return {
            matches: [],
            total: 50,
            offset: p.offset ?? 0,
            limit: p.limit ?? 25,
          } as EngineResult<Method>;
        }
        case "term.upsert": {
          const p = params as EngineParams<"term.upsert">;
          return {
            id: "term-1",
            termbaseId: p.termbaseId,
            sourceLocale: p.sourceLocale,
            sourceTerm: p.sourceTerm,
            status: "active",
            revision: 1,
            translations: [],
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          } as EngineResult<Method>;
        }
        case "termbase.export": {
          const p = params as EngineParams<"termbase.export">;
          return {
            termbaseId: p.termbaseId,
            outputPath: p.outputPath,
            entryCount: 0,
          } as EngineResult<Method>;
        }
        case "termbase.import":
          return {
            termbaseId: "tb-1",
            inserted: 0,
            skipped: 0,
            diagnostics: [],
          } as EngineResult<Method>;
        case "alignment.session.list":
          return {
            items: [],
            total: 0,
            offset: 0,
            limit: 25,
          } as EngineResult<Method>;
        case "alignment.session.create": {
          const p = params as EngineParams<"alignment.session.create">;
          return {
            session: {
              id: "align-1",
              projectId: p.projectId,
              sourceDocumentId: p.sourceDocumentId,
              targetDocumentId: p.targetDocumentId,
              sourceDocumentRevision: p.expectedSourceDocumentRevision,
              targetDocumentRevision: p.expectedTargetDocumentRevision,
              sourceLocale: "en",
              targetLocale: "zh",
              status: "open",
              revision: 1,
              algorithmVersion: "1",
              createdAtMs: Date.now(),
              updatedAtMs: Date.now(),
            },
            linkCount: 0,
            operationId: "op-1",
            sourceSegmentCount: 0,
            targetSegmentCount: 0,
            workUnits: 0,
          } as EngineResult<Method>;
        }
        case "alignment.session.get": {
          const p = params as EngineParams<"alignment.session.get">;
          return {
            session: {
              id: p.sessionId,
              projectId: "proj-1",
              sourceDocumentId: "doc-1",
              targetDocumentId: "doc-2",
              sourceDocumentRevision: 1,
              targetDocumentRevision: 1,
              sourceLocale: "en",
              targetLocale: "zh",
              status: "open",
              revision: 1,
              algorithmVersion: "1",
              createdAtMs: 1,
              updatedAtMs: 1,
            },
            links: [],
            total: 100,
            offset: p.offset ?? 0,
            limit: p.limit ?? 50,
          } as EngineResult<Method>;
        }
        case "alignment.session.update": {
          const p = params as EngineParams<"alignment.session.update">;
          return {
            session: {
              id: p.sessionId,
              projectId: "proj-1",
              sourceDocumentId: "doc-1",
              targetDocumentId: "doc-2",
              sourceDocumentRevision: 1,
              targetDocumentRevision: 1,
              sourceLocale: "en",
              targetLocale: "zh",
              status: "open",
              revision: p.expectedSessionRevision + 1,
              algorithmVersion: "1",
              createdAtMs: 1,
              updatedAtMs: Date.now(),
            },
            links: [],
            operationId: "op-u",
          } as EngineResult<Method>;
        }
        case "alignment.session.refine":
          return {
            id: "ai-run-1",
            kind: "alignmentRefine",
            action: "refine",
            status: "succeeded",
            attempt: 1,
            maxAttempts: 1,
            model: "fake",
            promptHash: "h",
            request: {},
            revision: 1,
            cancellationRequested: false,
            errorRetryable: false,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          } as EngineResult<Method>;
        case "alignment.session.apply": {
          const p = params as EngineParams<"alignment.session.apply">;
          return {
            sessionId: p.sessionId,
            sessionRevision: p.expectedSessionRevision + 1,
            libraryId: p.libraryId,
            libraryRevision: p.expectedLibraryRevision + 1,
            status: "applied",
            insertedCount: p.links.length,
            duplicateCount: 0,
            selectedCount: p.links.length,
            duplicates: [],
            tmUnitIds: [],
            operationId: "op-a",
          } as EngineResult<Method>;
        }
        case "corpus.list":
          return {
            items: [],
            total: 0,
            offset: 0,
            limit: 25,
          } as EngineResult<Method>;
        case "corpus.import": {
          const p = params as EngineParams<"corpus.import">;
          return {
            id: "corpus-1",
            projectId: p.projectId,
            name: p.name,
            kind: p.kind,
            sourceLocale: p.sourceLocale,
            targetLocale: p.targetLocale,
            status: "active",
            sourceKind: "file",
            entryCount: 0,
            diagnosticCount: 0,
            diagnostics: [],
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          } as EngineResult<Method>;
        }
        case "corpus.search": {
          const p = params as EngineParams<"corpus.search">;
          return {
            items: [],
            total: 50,
            offset: p.offset ?? 0,
            limit: p.limit ?? 25,
          } as EngineResult<Method>;
        }
        case "corpus.remove": {
          const p = params as EngineParams<"corpus.remove">;
          return {
            corpus: {
              id: p.corpusId,
              projectId: "proj-1",
              name: "removed",
              kind: "bilingual",
              sourceLocale: "en",
              targetLocale: "zh",
              status: "removed",
              sourceKind: "file",
              entryCount: 0,
              diagnosticCount: 0,
              diagnostics: [],
              revision: p.expectedRevision + 1,
              createdAtMs: 1,
              updatedAtMs: Date.now(),
            },
            affectedEntryCount: 0,
            operationId: "op-c",
          } as EngineResult<Method>;
        }
        case "corpus.fromAlignment": {
          const p = params as EngineParams<"corpus.fromAlignment">;
          return {
            id: "corpus-align",
            projectId: p.projectId,
            name: p.name,
            kind: "bilingual",
            sourceLocale: "en",
            targetLocale: "zh",
            status: "active",
            sourceKind: "alignment",
            entryCount: p.links.length,
            diagnosticCount: 0,
            diagnostics: [],
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
            alignmentSessionId: p.sessionId,
          } as EngineResult<Method>;
        }
        case "asset.catalog.list": {
          const p = params as EngineParams<"asset.catalog.list">;
          return {
            items: [],
            total: 50,
            offset: p.offset ?? 0,
            limit: p.limit ?? 25,
          } as EngineResult<Method>;
        }
        case "curation.run":
        case "curation.run.get": {
          const runId =
            (params as { runId?: string }).runId ?? `run-${Date.now()}`;
          return {
            run: {
              id: runId,
              projectId: (params as { projectId?: string }).projectId ?? "p",
              libraryId: (params as { libraryId?: string }).libraryId ?? "tm-1",
              mode: "offline",
              status: "open",
              revision: 1,
              baseLibraryRevision: 1,
              actor: "local",
              reason: (params as { reason?: string }).reason ?? "",
              policy: {
                maximumLengthRatioPercent: 300,
                minimumChars: 1,
                minimumLengthRatioPercent: 20,
                minimumTermFrequency: 2,
                nearDuplicateThreshold: 0.9,
                quarantineThresholdBasisPoints: 4000,
                semanticAlignmentThresholdBasisPoints: 5000,
              },
              summary: {
                analysis: {
                  analyzedUnits: 0,
                  findingCount: 0,
                  unitsWithFindings: 0,
                  quarantineCandidates: 0,
                  driftGroupCount: 0,
                  termCandidateCount: 0,
                },
                driftGroups: [],
                termCandidates: [],
              },
              createdAtMs: Date.now(),
              updatedAtMs: Date.now(),
            },
            units: [],
            total: 0,
            offset: 0,
            limit: 50,
          } as EngineResult<Method>;
        }
        case "curation.finding.list":
          return {
            items: [],
            total: 0,
            offset: 0,
            limit: 25,
          } as EngineResult<Method>;
        case "curation.apply":
        case "curation.rollback": {
          const p = params as {
            runId: string;
            expectedRunRevision: number;
            expectedLibraryRevision: number;
          };
          return {
            runId: p.runId,
            runRevision: p.expectedRunRevision + 1,
            libraryId: "tm-1",
            libraryRevision: p.expectedLibraryRevision + 1,
            status: "applied",
            changedUnitCount: 0,
            quarantinedUnitCount: 0,
            restoredUnitCount: 0,
            operationId: "op-cur",
          } as EngineResult<Method>;
        }
        case "curation.export": {
          const p = params as EngineParams<"curation.export">;
          return {
            runId: p.runId,
            runRevision: p.expectedRunRevision,
            libraryId: "tm-1",
            libraryRevision: p.expectedLibraryRevision,
            format: p.format,
            outputPath: p.outputPath,
            rowCount: 0,
            bytesWritten: 0,
            sha256: "abc",
          } as EngineResult<Method>;
        }
        // P3 PDF
        case "pdf.page.list": {
          const p = params as EngineParams<"pdf.page.list">;
          const pages = state.pdfPagesByDocument[p.documentId] ?? [];
          return {
            pages: pages.map((pg) => ({
              page: pg.page,
              width: pg.width,
              height: pg.height,
              blockCount: pg.blocks.length,
              ocrBlockCount: pg.ocrBlockCount,
              segmentIds: [...pg.segmentIds],
            })),
          } as EngineResult<Method>;
        }
        case "pdf.page.get": {
          const p = params as EngineParams<"pdf.page.get">;
          const pages = state.pdfPagesByDocument[p.documentId] ?? [];
          const page = pages.find((pg) => pg.page === p.page);
          if (!page) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Page not found",
            }) as never;
          }
          return {
            page: page.page,
            dpi: p.dpi ?? 144,
            width: page.width,
            height: page.height,
            imagePngBase64: page.imagePngBase64,
            blocks: page.blocks.map((b) => ({
              segmentId: b.segmentId,
              sourceKind: b.sourceKind,
              state: b.state,
              sourceText: b.sourceText,
              targetText: b.targetText,
              revision: b.revision,
              kind: b.kind,
              confidence: b.confidence,
              bbox: { ...b.bbox },
            })),
          } as EngineResult<Method>;
        }
        case "pdf.correctOcr": {
          const p = params as EngineParams<"pdf.correctOcr">;
          const seg = state.segments.find((s) => s.id === p.segmentId);
          if (!seg) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Segment not found",
            }) as never;
          }
          if (seg.revision !== p.expectedRevision) {
            return Promise.reject({
              code: "REVISION_CONFLICT",
              message: "Revision conflict",
            }) as never;
          }
          seg.sourceText = p.sourceText;
          seg.revision += 1;
          seg.updatedAtMs = Date.now();
          // Keep PDF block cache in sync when present.
          for (const pages of Object.values(state.pdfPagesByDocument)) {
            for (const page of pages) {
              for (const block of page.blocks) {
                if (block.segmentId === p.segmentId) {
                  block.sourceText = p.sourceText;
                  block.revision = seg.revision;
                }
              }
            }
          }
          return { ...seg } as EngineResult<Method>;
        }
        // P3 interop
        case "interop.review.export": {
          const p = params as EngineParams<"interop.review.export">;
          return {
            outputPath: p.outputPath,
            rowCount: 1,
            manifestHash: "manifest-review",
          } as EngineResult<Method>;
        }
        case "interop.review.preview": {
          const p = params as EngineParams<"interop.review.preview">;
          const offset = p.offset ?? 0;
          const limit = p.limit ?? 50;
          const rows = [
            {
              rowId: "rr-1",
              ordinal: 1,
              sourceRow: 2,
              disposition: "changed" as const,
              segmentId: state.segments[0]?.id ?? "seg-1",
              expectedSegmentRevision: state.segments[0]?.revision ?? 1,
              sourceHash: "sh",
              sourceText: state.segments[0]?.sourceText ?? "Hello",
              targetText: "Bonjour",
              currentTarget: state.segments[0]?.targetText ?? "",
              currentStatus: "draft",
              statusContext: "",
              comments: "",
              currentComments: "",
              diagnostics: [] as string[],
            },
            {
              rowId: "rr-2",
              ordinal: 2,
              sourceRow: 3,
              disposition: "unchanged" as const,
              segmentId: null,
              expectedSegmentRevision: null,
              sourceHash: "sh2",
              sourceText: "Other",
              targetText: "Autre",
              currentTarget: "Autre",
              currentStatus: "confirmed",
              statusContext: "",
              comments: "",
              currentComments: "",
              diagnostics: [] as string[],
            },
          ];
          return {
            previewId: p.previewId ?? "preview-review-1",
            projectId: p.projectId,
            documentId: p.documentId,
            expectedDocumentRevision: p.expectedDocumentRevision,
            inputFormat: "docx",
            inputSha256: "sha-review",
            manifestHash: "manifest-review",
            status: "open" as const,
            offset,
            limit,
            total: rows.length,
            rows: rows.slice(offset, offset + limit),
          } as EngineResult<Method>;
        }
        case "interop.review.apply": {
          const p = params as EngineParams<"interop.review.apply">;
          return {
            previewId: p.previewId,
            appliedCount: p.selectedRowIds.length,
            skippedCount: 0,
            status: "applied" as const,
            currentRevision: p.expectedDocumentRevision + 1,
            operationId: "op-review",
            reviewIds: p.selectedRowIds,
            commentIds: [],
            tmUnitIds: [],
          } as EngineResult<Method>;
        }
        case "interop.table.preview": {
          const p = params as EngineParams<"interop.table.preview">;
          const offset = p.offset ?? 0;
          const limit = p.limit ?? 50;
          const rows = [
            {
              rowId: "tr-1",
              ordinal: 1,
              sourceRow: 2,
              disposition: "valid" as const,
              sourceHash: "th1",
              sourcePathHash: "ph1",
              sourceText: "Source A",
              targetText: "Target A",
              structuralPath: "1",
              metadata: {},
              diagnostics: [] as string[],
            },
            {
              rowId: "tr-2",
              ordinal: 2,
              sourceRow: 3,
              disposition: "invalid" as const,
              sourceHash: "th2",
              sourcePathHash: "ph2",
              sourceText: "Source B",
              targetText: "",
              structuralPath: "2",
              metadata: {},
              diagnostics: ["empty target"],
            },
          ];
          return {
            previewId: p.previewId ?? "preview-table-1",
            projectId: p.projectId,
            libraryId: p.libraryId,
            expectedLibraryRevision: p.expectedLibraryRevision,
            sourceLocale: p.sourceLocale,
            targetLocale: p.targetLocale,
            inputFormat: "xlsx",
            inputSha256: "sha-table",
            status: "open" as const,
            offset,
            limit,
            total: rows.length,
            rows: rows.slice(offset, offset + limit),
          } as EngineResult<Method>;
        }
        case "interop.table.apply": {
          const p = params as EngineParams<"interop.table.apply">;
          return {
            previewId: p.previewId,
            appliedCount: p.selectedRowIds.length,
            skippedCount: 0,
            status: "applied" as const,
            currentRevision: p.expectedLibraryRevision + 1,
            operationId: "op-table",
            reviewIds: [],
            commentIds: [],
            tmUnitIds: p.selectedRowIds.map((id) => `tm-${id}`),
          } as EngineResult<Method>;
        }
        // P3 task packages
        case "taskPackage.export": {
          const p = params as EngineParams<"taskPackage.export">;
          return {
            packageId: "pkg-1",
            packagePath: p.destinationPath,
            packageSha256: "pkg-sha",
            manifestHash: "pkg-manifest",
            kind: p.kind,
            status: "exported",
          } as EngineResult<Method>;
        }
        case "taskPackage.preview": {
          const p = params as EngineParams<"taskPackage.preview">;
          const offset = p.offset ?? 0;
          const limit = p.limit ?? 50;
          const rows = [
            {
              rowId: "tp-1",
              ordinal: 1,
              disposition: "remoteChanged" as const,
              safeToApply: true,
              selected: false,
              identicalChange: false,
              originDocumentId: state.documents[0]?.id ?? "doc-1",
              originSegmentId: state.segments[0]?.id ?? "seg-1",
              reason: "remote",
              currentRevision: 1,
              remoteRevision: 2,
            },
            {
              rowId: "tp-2",
              ordinal: 2,
              disposition: "bothChanged" as const,
              safeToApply: false,
              selected: false,
              identicalChange: false,
              originDocumentId: state.documents[0]?.id ?? "doc-1",
              originSegmentId: state.segments[1]?.id ?? "seg-2",
              reason: "conflict",
              currentRevision: 2,
              remoteRevision: 3,
            },
          ];
          return {
            previewId: p.previewId ?? "preview-task-1",
            packageId: "pkg-1",
            projectId: state.projects[0]?.id ?? "proj-1",
            kind: "assignment" as const,
            status: "open",
            manifestHash: "pkg-manifest",
            expectedProjectRevision: state.projects[0]?.revision ?? 1,
            offset,
            limit,
            total: rows.length,
            rows: rows.slice(offset, offset + limit),
            counts: {
              total: rows.length,
              unchanged: 0,
              remoteChanged: 1,
              localChanged: 0,
              bothChanged: 1,
              deleted: 0,
              added: 0,
              tagInvalid: 0,
              missingDependency: 0,
            },
            diagnostics: [],
          } as EngineResult<Method>;
        }
        case "taskPackage.apply": {
          const p = params as EngineParams<"taskPackage.apply">;
          const project = state.projects[0];
          if (project) project.revision = p.expectedProjectRevision + 1;
          return {
            previewId: p.previewId,
            appliedCount: p.selectedRowIds.length,
            selectedCount: p.selectedRowIds.length,
            skippedCount: 0,
            status: "applied",
            projectRevision: project?.revision ?? p.expectedProjectRevision + 1,
            documentRevisions: {},
            segmentIds: p.selectedRowIds,
            operationId: "op-task",
          } as EngineResult<Method>;
        }
        case "taskPackage.import": {
          const p = params as EngineParams<"taskPackage.import">;
          const project: Project = {
            id: `proj-import-${state.projects.length + 1}`,
            name: p.projectName ?? "Imported task",
            domain: p.domain ?? "general",
            sourceLocale: "en",
            targetLocale: "zh",
            lifecycle: "active",
            revision: 1,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
            configuration: {
              taskPackage: {
                packageId: "pkg-1",
                originProjectId: "origin-1",
              },
            },
          };
          state.projects.push(project);
          return {
            previewId: p.previewId,
            packageId: "pkg-1",
            project,
            documents: [],
            bindingCount: 1,
          } as EngineResult<Method>;
        }
        case "taskPackage.discard": {
          const p = params as EngineParams<"taskPackage.discard">;
          return {
            packageId: p.packageId,
            previewId: p.previewId ?? null,
            removedStagedFile: true,
            status: "discarded",
          } as EngineResult<Method>;
        }
        // P3 reimport
        case "document.reimport.preview": {
          const p = params as EngineParams<"document.reimport.preview">;
          return {
            previewId: "reimport-preview-1",
            documentId: p.documentId,
            expectedDocumentRevision: p.expectedRevision,
            candidateSourceSha256: "reimport-sha",
            createdAtMs: Date.now(),
            plan: {
              unchanged: 1,
              changed: 1,
              newSegments: 0,
              removed: 0,
              ambiguous: 0,
              items: [
                {
                  disposition: "unchanged" as const,
                  reason: "same",
                  oldSegmentId: state.segments[0]?.id ?? "seg-1",
                  oldOrdinal: 1,
                  newSegmentId: state.segments[0]?.id ?? "seg-1",
                  newOrdinal: 1,
                },
                {
                  disposition: "changed" as const,
                  reason: "source changed",
                  oldSegmentId: state.segments[0]?.id ?? "seg-1",
                  oldOrdinal: 1,
                  newSegmentId: state.segments[0]?.id ?? "seg-1",
                  newOrdinal: 1,
                },
              ],
            },
          } as EngineResult<Method>;
        }
        case "document.reimport.apply": {
          const p = params as EngineParams<"document.reimport.apply">;
          const doc =
            state.documents.find(
              (d) => d.revision === p.expectedDocumentRevision,
            ) ?? state.documents[0];
          if (!doc) {
            return Promise.reject({
              code: "NOT_FOUND",
              message: "Document not found",
            }) as never;
          }
          if (doc.revision !== p.expectedDocumentRevision) {
            return Promise.reject({
              code: "REVISION_CONFLICT",
              message: "Revision conflict",
            }) as never;
          }
          doc.revision += 1;
          doc.updatedAtMs = Date.now();
          return { ...doc } as EngineResult<Method>;
        }
        default:
          return Promise.reject({
            code: "UNSUPPORTED",
            message: `Fake does not implement ${method}`,
          }) as never;
      }
    },

    selectSourceDocument: async () => state.sourcePath,
    selectSourceDocuments: async () => {
      if (state.sourcePaths) return [...state.sourcePaths];
      return state.sourcePath ? [state.sourcePath] : [];
    },
    selectSourceFolder: async () => null,
    selectProjectArchive: async () => null,
    selectProjectArchiveDestination: async () => null,
    selectExportPath: async () => state.exportPath,
    selectInteropInput: async (kind) =>
      kind === "review" ? state.interopReviewPath : state.interopTablePath,
    selectTaskPackageInput: async () => state.taskPackagePath,
    selectCorpusInput: async () => null,
    selectPluginPackage: async () => state.pluginPackagePath ?? null,
    issuePluginPanelSession: async (request) => {
      state.calls.push({ method: "issuePluginPanelSession", params: request });
      return {
        sessionId: `panel-session-${request.pluginId}`,
        url: `translunar-plugin://panel/${request.pluginId}/${request.contributionId}`,
        expiresAtMs: Date.now() + 60_000,
        revision: request.revision,
        bridgeVersion: 1 as const,
      };
    },
    revokePluginPanelSession: async (sessionId) => {
      state.calls.push({
        method: "revokePluginPanelSession",
        params: { sessionId },
      });
      return true;
    },
    onPluginPanelRevoked: (listener) => {
      state.pluginPanelRevokeListeners.push(listener);
      return () => {
        state.pluginPanelRevokeListeners =
          state.pluginPanelRevokeListeners.filter((l) => l !== listener);
      };
    },
    resolveDroppedPaths: () => [],
    restartEngine: async () => undefined,
    setAiCredential: async (profileId, secret) => {
      state.calls.push({
        method: "setAiCredential",
        params: { profileId, secretLength: secret.length },
      });
    },
    onEditorCommand: () => () => undefined,
    getSystemLocale: async () => state.systemLocale ?? "en-US",
    getShellSettings: async () => ({
      ...shellSettingsBase,
      ...(state.shellSettings ?? {}),
    }),
    updateShellSettings: async (patch) => {
      state.calls.push({ method: "updateShellSettings", params: patch });
      state.shellSettings = {
        ...(state.shellSettings ?? shellSettingsBase),
        ...patch,
      };
      return {
        ...shellSettingsBase,
        ...state.shellSettings,
      };
    },
    getDataDirectoryStatus: async () =>
      state.dataDirectoryStatus ?? {
        path: "/data",
        absolutePath: "/data",
        exists: true,
        writable: true,
        freeBytes: 1_000_000_000,
        freeBytesLabel: "1 GB",
        isTestOverride: true,
        healthy: true,
        schemaVersion: 1,
      },
    selectDataDirectory: async () => state.dataDirectoryPath ?? null,
    validateDataDirectory: async (path) => ({
      ok: true,
      path,
    }),
    migrateDataDirectory: async (path) => ({
      ok: true,
      phase: "committed" as const,
      sourcePath: "/data",
      targetPath: path,
      activePath: path,
    }),
    selectBackupDestination: async () => state.backupDestination ?? null,
    createWorkspaceBackup: async () => ({ ok: true, code: "OK" }),
    selectRestoreSource: async () => state.restoreSource ?? null,
    previewRestore: async (path) => ({
      ok: true,
      data: {
        path,
        formatVersion: 1,
        schemaVersion: 1,
        engineVersion: "test",
        createdAtMs: Date.now(),
        fileCount: 1,
        totalBytes: 10,
        hashesOk: true,
        compatible: true,
        freeBytes: 1000,
        freeBytesLabel: "1 KB",
        confirmationToken: "tok-test",
      },
    }),
    restoreWorkspaceBackup: async (params) => {
      state.calls.push({ method: "restoreWorkspaceBackup", params });
      return {
        ok: true,
        phase: "committed" as const,
        sourcePath: params.path,
        targetPath: params.path,
        activePath: "/data",
      };
    },
    getDraftJournal: async (): Promise<DraftJournalSnapshot> => ({
      path: "journal.json",
      records: [...state.journal],
      totalBytes: 0,
    }),
    writeDraftJournal: async (record) => {
      const next: DraftJournalRecord = {
        ...record,
        updatedAtMs: Date.now(),
        checksum: "c",
      };
      state.journal = [
        ...state.journal.filter((r) => r.segmentId !== record.segmentId),
        next,
      ];
      return {
        path: "journal.json",
        records: [...state.journal],
        totalBytes: 1,
      };
    },
    clearDraftJournal: async (segmentIds) => {
      if (!segmentIds || segmentIds.length === 0) {
        state.journal = [];
      } else {
        const set = new Set(segmentIds);
        state.journal = state.journal.filter((r) => !set.has(r.segmentId));
      }
      return {
        path: "journal.json",
        records: [...state.journal],
        totalBytes: 0,
      };
    },
    getUpdateStatus: async () =>
      state.updateStatus ?? {
        status: "idle" as const,
        mode: "manual" as const,
        currentVersion: "0.1.0",
        availableVersion: null,
        feedUrl: null,
        deferredUntilMs: null,
        lastCheckedAtMs: null,
        lastError: null,
        downloadPercent: null,
        requiresBackup: false,
        unsigned: false,
        feedKind: "none" as const,
        installLedger: {
          feedKind: "none" as const,
          backupCreatedAtMs: null,
          backupPath: null,
          installStartedAtMs: null,
          installFinishedAtMs: null,
          healthCheckedAtMs: null,
          rollbackRequired: false,
          packagePath: null,
          packageIdentity: null,
          installInvocationAccepted: false,
          claimedInstalled: false,
          pendingRestart: false,
          targetVersion: null,
          previousVersion: null,
          stagedPath: null,
          lastRecoveryAction: null,
          lastRecoveryAtMs: null,
          lastRecoveryOutcome: null,
          recoveryHistoryRecorded: false,
        },
        canRollback: false,
        canOpenInstaller: false,
        recoveryBusy: false,
      },
    setUpdateMode: async (mode) => {
      const base = await api.getUpdateStatus();
      const next = { ...base, mode };
      state.updateStatus = next;
      return next;
    },
    checkForUpdates: async () => {
      const base = await api.getUpdateStatus();
      const next = {
        ...base,
        status: "idle" as const,
        lastCheckedAtMs: Date.now(),
      };
      state.updateStatus = next;
      return next;
    },
    deferUpdate: async (untilMs) => {
      const base = await api.getUpdateStatus();
      const next = {
        ...base,
        status: "deferred" as const,
        deferredUntilMs: untilMs,
      };
      state.updateStatus = next;
      return next;
    },
    downloadUpdate: async () => {
      const base = await api.getUpdateStatus();
      const next = { ...base, status: "ready" as const };
      state.updateStatus = next;
      return next;
    },
    installUpdate: async () => {
      const base = await api.getUpdateStatus();
      const next = { ...base, status: "pending-restart" as const };
      state.updateStatus = next;
      return next;
    },
    rollbackUpdate: async () => {
      const base = await api.getUpdateStatus();
      const next = { ...base, status: "idle" as const };
      state.updateStatus = next;
      return next;
    },
    openUpdateInstaller: async () => api.getUpdateStatus(),
    getTutorialState: async () =>
      state.tutorial ?? {
        version: 1,
        step: "welcome" as const,
        skipped: false,
        completed: false,
        updatedAtMs: 0,
      },
    updateTutorialState: async (patch) => {
      const current = await api.getTutorialState();
      const next = { ...current, ...patch, updatedAtMs: Date.now() };
      state.tutorial = next;
      return next;
    },
    openExampleProject: async () => state.exampleResult,
    onEngineReconnected: (listener) => {
      state.reconnectListeners.push(listener);
      return () => {
        state.reconnectListeners = state.reconnectListeners.filter(
          (l) => l !== listener,
        );
      };
    },
    onEngineStatus: (listener) => {
      state.statusListeners.push(listener);
      return () => {
        state.statusListeners = state.statusListeners.filter(
          (l) => l !== listener,
        );
      };
    },
    minimizeWindow: async () => {
      state.windowMaximized = false;
    },
    maximizeWindow: async () => {
      state.windowMaximized = !state.windowMaximized;
      return state.windowMaximized;
    },
    closeWindow: async () => {
      /* no-op in fake */
    },
    isWindowMaximized: async () => state.windowMaximized,
    getWindowChromePlatform: () => state.windowChromePlatform,
  };

  return api;
}
