/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/no-unnecessary-type-assertion -- test double */
import type {
  EngineMethod,
  EngineParams,
  EngineResult,
  Project,
  Document,
  Segment,
  SegmentEditorRow,
  SegmentCounts,
} from "@translunar/contracts";

import type { DesktopApi } from "../../shared/desktop-api";
import type {
  DraftJournalRecord,
  DraftJournalSnapshot,
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

export interface FakeEngineState {
  projects: Project[];
  documents: Document[];
  segments: Segment[];
  failMethods: Set<string>;
  sourcePath: string | null;
  exportPath: string | null;
  journal: DraftJournalRecord[];
  calls: Array<{ method: string; params: unknown }>;
  gateClear: boolean;
  statusListeners: Array<
    (payload: {
      type: "reconnecting" | "reconnected" | "failed";
      attempt?: number;
      message?: string;
    }) => void
  >;
  reconnectListeners: Array<() => void>;
}

export function createFakeEngineState(
  overrides: Partial<FakeEngineState> = {},
): FakeEngineState {
  return {
    projects: [],
    documents: [],
    segments: [],
    failMethods: new Set(),
    sourcePath: null,
    exportPath: null,
    journal: [],
    calls: [],
    gateClear: true,
    statusListeners: [],
    reconnectListeners: [],
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
        case "project.list":
          return {
            items: state.projects,
            limit: 200,
            offset: 0,
            total: state.projects.length,
          } as EngineResult<Method>;
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
          const items = state.segments
            .filter((s) => s.documentId === p.documentId)
            .map(rowFromSegment);
          return {
            items,
            limit: 200,
            offset: 0,
            total: items.length,
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
        default:
          return Promise.reject({
            code: "UNSUPPORTED",
            message: `Fake does not implement ${method}`,
          }) as never;
      }
    },

    selectSourceDocument: async () => state.sourcePath,
    selectSourceDocuments: async () =>
      state.sourcePath ? [state.sourcePath] : [],
    selectSourceFolder: async () => null,
    selectProjectArchive: async () => null,
    selectProjectArchiveDestination: async () => null,
    selectExportPath: async () => state.exportPath,
    selectInteropInput: async () => null,
    selectTaskPackageInput: async () => null,
    selectCorpusInput: async () => null,
    selectPluginPackage: async () => null,
    issuePluginPanelSession: async () => {
      throw new Error("not used");
    },
    revokePluginPanelSession: async () => true,
    onPluginPanelRevoked: () => () => undefined,
    resolveDroppedPaths: () => [],
    restartEngine: async () => undefined,
    setAiCredential: async () => undefined,
    onEditorCommand: () => () => undefined,
    getSystemLocale: async () => "en-US",
    getShellSettings: async () => ({ ...shellSettingsBase }),
    updateShellSettings: async (patch) => ({
      ...shellSettingsBase,
      ...patch,
    }),
    getDataDirectoryStatus: async () => {
      throw new Error("not used");
    },
    selectDataDirectory: async () => null,
    validateDataDirectory: async () => ({ ok: true, path: "" }),
    migrateDataDirectory: async () => {
      throw new Error("not used");
    },
    selectBackupDestination: async () => null,
    createWorkspaceBackup: async () => ({ ok: true }),
    selectRestoreSource: async () => null,
    previewRestore: async () => ({ ok: true }),
    restoreWorkspaceBackup: async () => {
      throw new Error("not used");
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
    getUpdateStatus: async () => {
      throw new Error("not used");
    },
    setUpdateMode: async () => {
      throw new Error("not used");
    },
    checkForUpdates: async () => {
      throw new Error("not used");
    },
    deferUpdate: async () => {
      throw new Error("not used");
    },
    downloadUpdate: async () => {
      throw new Error("not used");
    },
    installUpdate: async () => {
      throw new Error("not used");
    },
    rollbackUpdate: async () => {
      throw new Error("not used");
    },
    openUpdateInstaller: async () => {
      throw new Error("not used");
    },
    getTutorialState: async () => ({
      version: 1,
      step: "welcome" as const,
      skipped: false,
      completed: false,
      updatedAtMs: 0,
    }),
    updateTutorialState: async (patch) => ({
      version: 1,
      step: "welcome" as const,
      skipped: false,
      completed: false,
      updatedAtMs: 0,
      ...patch,
    }),
    openExampleProject: async () => {
      throw new Error("not used");
    },
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
  };

  return api;
}
