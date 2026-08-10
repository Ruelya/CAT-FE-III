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

import type { DesktopApi } from "../../shared/desktop-api";
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
    journal: [],
    calls: [],
    gateClear: true,
    exampleResult: { ok: false, message: "no example", code: "NO_EXAMPLE" },
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
            (params as { runId?: string }).runId ??
            `run-${Date.now()}`;
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
  };

  return api;
}
