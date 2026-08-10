import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssetExchangeFormat,
  AssetMountMode,
  CurationPolicy,
} from "@translunar/contracts";

import { toUiError } from "../lib/errors";
import { desktopApi, invokeEngine } from "../lib/rpc";
import {
  createInitialAssetState,
  emptyPage,
  type AssetControllerState,
  type AssetSection,
} from "./asset-state";
import { DEFAULT_ALIGNMENT_OPTIONS } from "./asset-view";

export interface AssetControllerGateway {
  generation: number;
  mutationsEnabled: boolean;
  projectId: string;
  projectName: string;
  sourceLocale: string;
  targetLocale: string;
  section: AssetSection;
}

const PAGE = 25;

/** Independent list/mutation authority per Asset Hub domain (AC14). */
type AssetDomain =
  "tm" | "termbase" | "alignment" | "corpus" | "catalog" | "curation";

const ASSET_DOMAINS: AssetDomain[] = [
  "tm",
  "termbase",
  "alignment",
  "corpus",
  "catalog",
  "curation",
];

function emptyDomainCounters(): Record<AssetDomain, number> {
  return {
    tm: 0,
    termbase: 0,
    alignment: 0,
    corpus: 0,
    catalog: 0,
    curation: 0,
  };
}

function emptyDomainFlags(): Record<AssetDomain, boolean> {
  return {
    tm: false,
    termbase: false,
    alignment: false,
    corpus: false,
    catalog: false,
    curation: false,
  };
}

export interface AssetControllerApi {
  state: AssetControllerState;
  setSection: (section: AssetSection) => void;
  reloadActiveSection: () => Promise<void>;
  invalidate: () => void;
  // TM
  setTmCreateName: (name: string) => void;
  createTmLibrary: () => Promise<void>;
  mountTm: (libraryId: string, mode: AssetMountMode) => Promise<void>;
  unmountTm: (libraryId: string, expectedRevision: number) => Promise<void>;
  setTmSearchQuery: (q: string) => void;
  setTmSearchThreshold: (n: number) => void;
  runTmSearch: (offset?: number) => Promise<void>;
  setConcordanceQuery: (q: string) => void;
  runConcordance: (offset?: number) => Promise<void>;
  exportTm: (libraryId: string, format: AssetExchangeFormat) => Promise<void>;
  // Termbase
  setTbCreateName: (name: string) => void;
  createTermbase: () => Promise<void>;
  mountTermbase: (termbaseId: string, writable: boolean) => Promise<void>;
  unmountTermbase: (
    termbaseId: string,
    expectedRevision: number,
  ) => Promise<void>;
  setTermSearchText: (t: string) => void;
  runTermSearch: (offset?: number) => Promise<void>;
  setUpsertField: (
    patch: Partial<AssetControllerState["termbase"]["upsert"]>,
  ) => void;
  upsertTerm: () => Promise<void>;
  exportTermbase: (
    termbaseId: string,
    format: AssetExchangeFormat,
  ) => Promise<void>;
  // Alignment
  setAlignmentCreate: (
    patch: Partial<AssetControllerState["alignment"]["create"]>,
  ) => void;
  createAlignment: () => Promise<void>;
  selectAlignmentSession: (sessionId: string | null) => Promise<void>;
  toggleLinkSelection: (linkId: string) => void;
  setLinkStatus: (
    linkId: string,
    expectedRevision: number,
    status: "confirmed" | "rejected" | "proposed",
  ) => Promise<void>;
  /** Repartition selected links into a single manual replacement (replaceLinks). */
  replaceSelectedLinks: (reason: string) => Promise<void>;
  setRefineProfileId: (id: string) => void;
  setRefineReason: (reason: string) => void;
  refineSelected: () => Promise<void>;
  setApplyLibraryId: (id: string) => void;
  applyAlignment: (reason: string) => Promise<void>;
  loadAlignmentSessions: (offset?: number) => Promise<void>;
  loadAlignmentLinks: (offset?: number) => Promise<void>;
  // Corpus
  setCorpusImport: (
    patch: Partial<AssetControllerState["corpus"]["import"]>,
  ) => void;
  importCorpus: () => Promise<void>;
  setCorpusSearchQuery: (q: string) => void;
  runCorpusSearch: (offset?: number) => Promise<void>;
  loadCorpora: (offset?: number) => Promise<void>;
  /** Returns true only when Engine removal succeeded. */
  removeCorpus: (
    corpusId: string,
    expectedRevision: number,
    reason: string,
  ) => Promise<boolean>;
  corpusFromAlignment: (name: string, reason: string) => Promise<void>;
  // Catalog
  setCatalogQuery: (q: string) => void;
  setCatalogKind: (k: AssetControllerState["catalog"]["kind"]) => void;
  setCatalogFilter: (
    patch: Partial<
      Pick<
        AssetControllerState["catalog"],
        | "sourceLocale"
        | "targetLocale"
        | "domain"
        | "originProjectId"
        | "originDocumentId"
        | "createdAfterMs"
        | "createdBeforeMs"
      >
    >,
  ) => void;
  loadCatalog: (offset?: number) => Promise<void>;
  // Curation
  setCurationLibraryId: (id: string) => void;
  setCurationReason: (r: string) => void;
  setCurationPolicy: (policy: CurationPolicy) => void;
  patchCurationPolicy: (patch: Partial<CurationPolicy>) => void;
  setKnownRunId: (id: string) => void;
  startCuration: () => Promise<void>;
  loadCurationRun: (runId?: string) => Promise<void>;
  loadFindings: (offset?: number) => Promise<void>;
  toggleFinding: (id: string) => void;
  applyFindings: (reason: string) => Promise<void>;
  /** Returns true only when Engine rollback succeeded. */
  rollbackCuration: (reason: string) => Promise<boolean>;
  exportCuration: (format: "jsonl" | "tsv") => Promise<void>;
  loadTmLibraries: (offset?: number) => Promise<void>;
  loadTermbases: (offset?: number) => Promise<void>;
}

export function useAssetController(
  gateway: AssetControllerGateway,
): AssetControllerApi {
  const [state, setState] = useState<AssetControllerState>(() =>
    createInitialAssetState({
      projectId: gateway.projectId,
      projectName: gateway.projectName,
      sourceLocale: gateway.sourceLocale,
      targetLocale: gateway.targetLocale,
      projectRevision: 1,
      section: gateway.section,
    }),
  );

  const listOpsRef = useRef(emptyDomainCounters());
  const mutOpsRef = useRef(emptyDomainCounters());
  const mutPendingRef = useRef(emptyDomainFlags());
  const generationRef = useRef(gateway.generation);
  const projectIdRef = useRef(gateway.projectId);
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  /** Latest asset state — never read form fields via setState updater side-effects. */
  const stateRef = useRef(state);
  stateRef.current = state;

  const bumpAllDomainOps = useCallback(() => {
    for (const d of ASSET_DOMAINS) {
      listOpsRef.current[d] += 1;
      mutOpsRef.current[d] += 1;
      mutPendingRef.current[d] = false;
    }
  }, []);

  // Reset when project/generation changes
  useEffect(() => {
    if (
      gateway.projectId !== projectIdRef.current ||
      gateway.generation !== generationRef.current
    ) {
      projectIdRef.current = gateway.projectId;
      generationRef.current = gateway.generation;
      bumpAllDomainOps();
      setState(
        createInitialAssetState({
          projectId: gateway.projectId,
          projectName: gateway.projectName,
          sourceLocale: gateway.sourceLocale,
          targetLocale: gateway.targetLocale,
          projectRevision: 1,
          section: gateway.section,
        }),
      );
    }
  }, [
    bumpAllDomainOps,
    gateway.generation,
    gateway.projectId,
    gateway.projectName,
    gateway.section,
    gateway.sourceLocale,
    gateway.targetLocale,
  ]);

  const isListCurrent = useCallback(
    (domain: AssetDomain, opId: number, projectId: string) => {
      return (
        listOpsRef.current[domain] === opId &&
        projectIdRef.current === projectId &&
        gatewayRef.current.generation === generationRef.current
      );
    },
    [],
  );

  const isMutCurrent = useCallback(
    (domain: AssetDomain, opId: number, projectId: string) => {
      return (
        mutOpsRef.current[domain] === opId &&
        projectIdRef.current === projectId &&
        gatewayRef.current.generation === generationRef.current
      );
    },
    [],
  );

  /** Begin a domain mutation; returns null when a prior mutation is still in-flight. */
  const beginMut = useCallback((domain: AssetDomain): number | null => {
    if (mutPendingRef.current[domain]) return null;
    mutPendingRef.current[domain] = true;
    return ++mutOpsRef.current[domain];
  }, []);

  const endMut = useCallback(
    (domain: AssetDomain, opId: number, projectId: string) => {
      if (isMutCurrent(domain, opId, projectId)) {
        mutPendingRef.current[domain] = false;
      }
    },
    [isMutCurrent],
  );

  const beginList = useCallback((domain: AssetDomain) => {
    return ++listOpsRef.current[domain];
  }, []);

  const invalidate = useCallback(() => {
    bumpAllDomainOps();
    generationRef.current = gatewayRef.current.generation;
  }, [bumpAllDomainOps]);

  const loadTmLibraries = useCallback(
    async (offset = 0) => {
      const projectId = projectIdRef.current;
      const opId = beginList("tm");
      setState((s) => ({
        ...s,
        tm: {
          ...s.tm,
          libraries: { ...s.tm.libraries, status: "loading", error: null },
        },
      }));
      try {
        const page = await invokeEngine("tm.library.list", {
          projectId,
          offset,
          limit: 50,
        });
        if (!isListCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            libraries: {
              status: "ready",
              items: page.items,
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              error: null,
            },
            mounts: page.mounts,
          },
        }));
      } catch (error) {
        if (!isListCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            libraries: {
              ...s.tm.libraries,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },
    [beginList, isListCurrent],
  );

  const loadTermbases = useCallback(
    async (offset = 0) => {
      const projectId = projectIdRef.current;
      const opId = beginList("termbase");
      setState((s) => ({
        ...s,
        termbase: {
          ...s.termbase,
          termbases: {
            ...s.termbase.termbases,
            status: "loading",
            error: null,
          },
        },
      }));
      try {
        const page = await invokeEngine("termbase.list", {
          projectId,
          offset,
          limit: 50,
        });
        if (!isListCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            termbases: {
              status: "ready",
              items: page.items,
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              error: null,
            },
            mounts: page.mounts,
          },
        }));
      } catch (error) {
        if (!isListCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            termbases: {
              ...s.termbase.termbases,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },
    [beginList, isListCurrent],
  );

  const loadSessions = useCallback(
    async (offset = 0) => {
      const projectId = projectIdRef.current;
      const opId = beginList("alignment");
      setState((s) => ({
        ...s,
        alignment: {
          ...s.alignment,
          sessions: { ...s.alignment.sessions, status: "loading", error: null },
        },
      }));
      try {
        const page = await invokeEngine("alignment.session.list", {
          projectId,
          offset,
          limit: PAGE,
        });
        if (!isListCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            sessions: {
              status: "ready",
              items: page.items,
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isListCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            sessions: {
              ...s.alignment.sessions,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },
    [beginList, isListCurrent],
  );

  const loadCorpora = useCallback(
    async (offset = 0) => {
      const projectId = projectIdRef.current;
      const opId = beginList("corpus");
      setState((s) => ({
        ...s,
        corpus: {
          ...s.corpus,
          corpora: { ...s.corpus.corpora, status: "loading", error: null },
        },
      }));
      try {
        const page = await invokeEngine("corpus.list", {
          projectId,
          offset,
          limit: PAGE,
        });
        if (!isListCurrent("corpus", opId, projectId)) return;
        setState((s) => ({
          ...s,
          corpus: {
            ...s.corpus,
            corpora: {
              status: "ready",
              items: page.items,
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isListCurrent("corpus", opId, projectId)) return;
        setState((s) => ({
          ...s,
          corpus: {
            ...s.corpus,
            corpora: {
              ...s.corpus.corpora,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },
    [beginList, isListCurrent],
  );

  const loadCatalog = useCallback(
    async (offset = 0) => {
      const projectId = projectIdRef.current;
      const opId = beginList("catalog");
      const f = stateRef.current.catalog;
      setState((s) => ({
        ...s,
        catalog: {
          ...s.catalog,
          page: { ...s.catalog.page, status: "loading", error: null },
        },
      }));
      try {
        const after = f.createdAfterMs.trim() ? Number(f.createdAfterMs) : null;
        const before = f.createdBeforeMs.trim()
          ? Number(f.createdBeforeMs)
          : null;
        const page = await invokeEngine("asset.catalog.list", {
          projectId,
          query: f.query.trim() || null,
          kind: f.kind,
          sourceLocale: f.sourceLocale.trim() || null,
          targetLocale: f.targetLocale.trim() || null,
          domain: f.domain.trim() || null,
          originProjectId: f.originProjectId.trim() || null,
          originDocumentId: f.originDocumentId.trim() || null,
          createdAfterMs:
            after !== null && Number.isFinite(after) ? after : null,
          createdBeforeMs:
            before !== null && Number.isFinite(before) ? before : null,
          offset,
          limit: PAGE,
        });
        if (!isListCurrent("catalog", opId, projectId)) return;
        setState((s) => ({
          ...s,
          catalog: {
            ...s.catalog,
            page: {
              status: "ready",
              items: page.items,
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isListCurrent("catalog", opId, projectId)) return;
        setState((s) => ({
          ...s,
          catalog: {
            ...s.catalog,
            page: {
              ...s.catalog.page,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },
    [beginList, isListCurrent],
  );

  const loadDocuments = useCallback(async () => {
    const projectId = projectIdRef.current;
    try {
      const page = await invokeEngine("document.list", {
        projectId,
        offset: 0,
        limit: 200,
      });
      if (projectIdRef.current !== projectId) return;
      setState((s) => ({
        ...s,
        documents: page.items.map((d) => ({
          id: d.id,
          name: d.name,
          revision: d.revision,
        })),
      }));
      const project = await invokeEngine("project.get", { projectId });
      if (projectIdRef.current !== projectId) return;
      setState((s) => ({
        ...s,
        projectRevision: project.project.revision,
        projectName: project.project.name,
        sourceLocale: project.project.sourceLocale,
        targetLocale: project.project.targetLocale,
      }));
    } catch {
      // non-fatal for list sections
    }
  }, []);

  const reloadActiveSection = useCallback(async () => {
    const section = gatewayRef.current.section;
    await loadDocuments();
    switch (section) {
      case "tm":
        await loadTmLibraries(0);
        break;
      case "termbase":
        await loadTermbases(0);
        break;
      case "alignment":
        await loadSessions(0);
        break;
      case "corpus":
        await loadCorpora(0);
        break;
      case "catalog":
        await loadCatalog(0);
        break;
      case "curation":
        await loadTmLibraries(0);
        break;
      default:
        break;
    }
  }, [
    loadCatalog,
    loadCorpora,
    loadDocuments,
    loadSessions,
    loadTermbases,
    loadTmLibraries,
  ]);

  // Load when section/project ready (intentionally omit reloadActiveSection identity)
  useEffect(() => {
    if (!gateway.mutationsEnabled && gateway.generation === 0) return;
    void reloadActiveSection();
  }, [gateway.projectId, gateway.section, gateway.generation]);

  const setSection = useCallback((section: AssetSection) => {
    setState((s) => ({ ...s, section }));
  }, []);

  return {
    state,
    setSection,
    reloadActiveSection,
    invalidate,

    setTmCreateName: (name) =>
      setState((s) => ({ ...s, tm: { ...s.tm, createName: name } })),

    createTmLibrary: async () => {
      const projectId = projectIdRef.current;
      const g = gatewayRef.current;
      if (!g.mutationsEnabled) return;
      const name = stateRef.current.tm.createName.trim();
      if (!name) {
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            actionError: {
              code: "VALIDATION",
              message: "Name required",
              kind: "domain",
            },
          },
        }));
        return;
      }
      const opId = beginMut("tm");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        tm: { ...s.tm, createPending: true, actionError: null },
      }));
      try {
        const created = await invokeEngine("tm.library.create", {
          name,
          sourceLocale: g.sourceLocale,
          targetLocale: g.targetLocale,
          ownerProjectId: projectId,
          writable: true,
        });
        if (!isMutCurrent("tm", opId, projectId)) return;
        // Project hub list is mount-scoped; mount so the new library is visible.
        await invokeEngine("tm.library.mount", {
          projectId,
          libraryId: created.id,
          mode: "write",
          enabled: true,
        });
        if (!isMutCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: { ...s.tm, createName: "", createPending: false },
        }));
        await loadTmLibraries(0);
      } catch (error) {
        if (!isMutCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            createPending: false,
            actionError: toUiError(error),
          },
        }));
      } finally {
        endMut("tm", opId, projectId);
      }
    },

    mountTm: async (libraryId, mode) => {
      const projectId = projectIdRef.current;
      if (!gatewayRef.current.mutationsEnabled) return;
      const opId = beginMut("tm");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        tm: { ...s.tm, actionError: null },
      }));
      try {
        await invokeEngine("tm.library.mount", {
          projectId,
          libraryId,
          mode,
          enabled: true,
        });
        if (!isMutCurrent("tm", opId, projectId)) return;
        await loadTmLibraries(0);
      } catch (error) {
        if (!isMutCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: { ...s.tm, actionError: toUiError(error) },
        }));
      } finally {
        endMut("tm", opId, projectId);
      }
    },

    unmountTm: async (libraryId, expectedRevision) => {
      const projectId = projectIdRef.current;
      if (!gatewayRef.current.mutationsEnabled) return;
      const opId = beginMut("tm");
      if (opId === null) return;
      try {
        await invokeEngine("tm.library.unmount", {
          projectId,
          libraryId,
          expectedRevision,
        });
        if (!isMutCurrent("tm", opId, projectId)) return;
        await loadTmLibraries(0);
      } catch (error) {
        if (!isMutCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: { ...s.tm, actionError: toUiError(error) },
        }));
      } finally {
        endMut("tm", opId, projectId);
      }
    },

    setTmSearchQuery: (q) =>
      setState((s) => ({ ...s, tm: { ...s.tm, searchQuery: q } })),

    setTmSearchThreshold: (n) =>
      setState((s) => ({ ...s, tm: { ...s.tm, searchThreshold: n } })),

    runTmSearch: async (offset = 0) => {
      const projectId = projectIdRef.current;
      const g = gatewayRef.current;
      const query = stateRef.current.tm.searchQuery.trim();
      const threshold = stateRef.current.tm.searchThreshold;
      if (!query) {
        setState((s) => ({
          ...s,
          tm: { ...s.tm, search: emptyPage(PAGE) },
        }));
        return;
      }
      const opId = beginList("tm");
      setState((s) => ({
        ...s,
        tm: {
          ...s.tm,
          search: { ...s.tm.search, status: "loading", error: null },
        },
      }));
      try {
        const result = await invokeEngine("tm.search", {
          projectId,
          query,
          sourceLocale: g.sourceLocale,
          targetLocale: g.targetLocale,
          threshold,
          offset,
          limit: PAGE,
        });
        if (!isListCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            search: {
              status: "ready",
              items: result.matches,
              total: result.total,
              offset: result.offset,
              limit: result.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isListCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            search: {
              ...s.tm.search,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },

    setConcordanceQuery: (q) =>
      setState((s) => ({ ...s, tm: { ...s.tm, concordanceQuery: q } })),

    runConcordance: async (offset = 0) => {
      const projectId = projectIdRef.current;
      const query = stateRef.current.tm.concordanceQuery.trim();
      if (!query) {
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            concordance: emptyPage(PAGE),
            corpusHits: [],
          },
        }));
        return;
      }
      const opId = beginList("tm");
      setState((s) => ({
        ...s,
        tm: {
          ...s.tm,
          concordance: {
            ...s.tm.concordance,
            status: "loading",
            error: null,
          },
        },
      }));
      try {
        const result = await invokeEngine("tm.concordance", {
          projectId,
          query,
          offset,
          limit: PAGE,
        });
        if (!isListCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            concordance: {
              status: "ready",
              items: result.hits,
              total: result.total,
              offset: result.offset,
              limit: result.limit,
              error: null,
            },
            corpusHits: result.corpusHits ?? [],
          },
        }));
      } catch (error) {
        if (!isListCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            concordance: {
              ...s.tm.concordance,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },

    exportTm: async (libraryId, format) => {
      const projectId = projectIdRef.current;
      if (!gatewayRef.current.mutationsEnabled) return;
      const opId = beginMut("tm");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        tm: {
          ...s.tm,
          exchange: {
            status: "exporting",
            libraryId,
            message: null,
            diagnostics: [],
            error: null,
          },
        },
      }));
      try {
        const path = await desktopApi().selectExportPath(
          `tm-export.${format === "tbx" ? "tmx" : format}`,
        );
        if (!path) {
          if (!isMutCurrent("tm", opId, projectId)) return;
          setState((s) => ({
            ...s,
            tm: {
              ...s.tm,
              exchange: {
                status: "idle",
                libraryId: null,
                message: null,
                diagnostics: [],
                error: null,
              },
            },
          }));
          return;
        }
        const result = await invokeEngine("tm.export", {
          libraryId,
          format,
          outputPath: path,
        });
        if (!isMutCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            exchange: {
              status: "result",
              libraryId,
              message: `${result.unitCount} units → ${result.outputPath}`,
              diagnostics: [],
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isMutCurrent("tm", opId, projectId)) return;
        setState((s) => ({
          ...s,
          tm: {
            ...s.tm,
            exchange: {
              status: "error",
              libraryId,
              message: null,
              diagnostics: [],
              error: toUiError(error),
            },
          },
        }));
      } finally {
        endMut("tm", opId, projectId);
      }
    },

    setTbCreateName: (name) =>
      setState((s) => ({
        ...s,
        termbase: { ...s.termbase, createName: name },
      })),

    createTermbase: async () => {
      const projectId = projectIdRef.current;
      const g = gatewayRef.current;
      if (!g.mutationsEnabled) return;
      const name = stateRef.current.termbase.createName.trim();
      if (!name) {
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            actionError: {
              code: "VALIDATION",
              message: "Name required",
              kind: "domain",
            },
          },
        }));
        return;
      }
      const opId = beginMut("termbase");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        termbase: {
          ...s.termbase,
          createPending: true,
          actionError: null,
        },
      }));
      try {
        const created = await invokeEngine("termbase.create", {
          name,
          sourceLocale: g.sourceLocale,
          writable: true,
        });
        if (!isMutCurrent("termbase", opId, projectId)) return;
        // Project hub list is mount-scoped; mount so the new termbase is visible.
        await invokeEngine("termbase.mount", {
          projectId,
          termbaseId: created.id,
          writable: true,
          enabled: true,
        });
        if (!isMutCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            createName: "",
            createPending: false,
          },
        }));
        await loadTermbases(0);
      } catch (error) {
        if (!isMutCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            createPending: false,
            actionError: toUiError(error),
          },
        }));
      } finally {
        endMut("termbase", opId, projectId);
      }
    },

    mountTermbase: async (termbaseId, writable) => {
      const projectId = projectIdRef.current;
      if (!gatewayRef.current.mutationsEnabled) return;
      const opId = beginMut("termbase");
      if (opId === null) return;
      try {
        await invokeEngine("termbase.mount", {
          projectId,
          termbaseId,
          writable,
          enabled: true,
        });
        if (!isMutCurrent("termbase", opId, projectId)) return;
        await loadTermbases(0);
      } catch (error) {
        if (!isMutCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: { ...s.termbase, actionError: toUiError(error) },
        }));
      } finally {
        endMut("termbase", opId, projectId);
      }
    },

    unmountTermbase: async (termbaseId, expectedRevision) => {
      const projectId = projectIdRef.current;
      if (!gatewayRef.current.mutationsEnabled) return;
      const opId = beginMut("termbase");
      if (opId === null) return;
      try {
        await invokeEngine("termbase.unmount", {
          projectId,
          termbaseId,
          expectedRevision,
        });
        if (!isMutCurrent("termbase", opId, projectId)) return;
        await loadTermbases(0);
      } catch (error) {
        if (!isMutCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: { ...s.termbase, actionError: toUiError(error) },
        }));
      } finally {
        endMut("termbase", opId, projectId);
      }
    },

    setTermSearchText: (t) =>
      setState((s) => ({
        ...s,
        termbase: { ...s.termbase, searchText: t },
      })),

    runTermSearch: async (offset = 0) => {
      const projectId = projectIdRef.current;
      const text = stateRef.current.termbase.searchText.trim();
      if (!text) {
        setState((s) => ({
          ...s,
          termbase: { ...s.termbase, search: emptyPage(PAGE) },
        }));
        return;
      }
      const opId = beginList("termbase");
      setState((s) => ({
        ...s,
        termbase: {
          ...s.termbase,
          search: { ...s.termbase.search, status: "loading", error: null },
        },
      }));
      try {
        const result = await invokeEngine("term.search", {
          projectId,
          text,
          offset,
          limit: PAGE,
        });
        if (!isListCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            search: {
              status: "ready",
              items: result.matches,
              total: result.total,
              offset: result.offset,
              limit: result.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isListCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            search: {
              ...s.termbase.search,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },

    setUpsertField: (patch) =>
      setState((s) => ({
        ...s,
        termbase: {
          ...s.termbase,
          upsert: { ...s.termbase.upsert, ...patch },
        },
      })),

    upsertTerm: async () => {
      const projectId = projectIdRef.current;
      const g = gatewayRef.current;
      if (!g.mutationsEnabled) return;
      const upsert = stateRef.current.termbase.upsert;
      if (!upsert.termbaseId || !upsert.sourceTerm.trim()) {
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            upsert: { ...s.termbase.upsert, pending: false },
          },
        }));
        return;
      }
      const opId = beginMut("termbase");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        termbase: {
          ...s.termbase,
          upsert: { ...s.termbase.upsert, pending: true, error: null },
        },
      }));
      try {
        const entry = await invokeEngine("term.upsert", {
          termbaseId: upsert.termbaseId,
          sourceLocale: g.sourceLocale,
          sourceTerm: upsert.sourceTerm.trim(),
          translations: upsert.translation.trim()
            ? [
                {
                  locale: g.targetLocale,
                  term: upsert.translation.trim(),
                  preferred: true,
                },
              ]
            : [],
          status: "active",
        });
        if (!isMutCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            upsert: {
              ...s.termbase.upsert,
              pending: false,
              lastEntry: entry,
              sourceTerm: "",
              translation: "",
            },
          },
        }));
      } catch (error) {
        if (!isMutCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            upsert: {
              ...s.termbase.upsert,
              pending: false,
              error: toUiError(error),
            },
          },
        }));
      } finally {
        endMut("termbase", opId, projectId);
      }
    },

    exportTermbase: async (termbaseId, format) => {
      const projectId = projectIdRef.current;
      const g = gatewayRef.current;
      if (!g.mutationsEnabled) return;
      const opId = beginMut("termbase");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        termbase: {
          ...s.termbase,
          exchange: {
            status: "exporting",
            termbaseId,
            message: null,
            diagnostics: [],
            error: null,
          },
        },
      }));
      try {
        const path = await desktopApi().selectExportPath(`tb-export.${format}`);
        if (!path) {
          if (!isMutCurrent("termbase", opId, projectId)) return;
          setState((s) => ({
            ...s,
            termbase: {
              ...s.termbase,
              exchange: {
                status: "idle",
                termbaseId: null,
                message: null,
                diagnostics: [],
                error: null,
              },
            },
          }));
          return;
        }
        const result = await invokeEngine("termbase.export", {
          termbaseId,
          format,
          outputPath: path,
          targetLocale: g.targetLocale,
        });
        if (!isMutCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            exchange: {
              status: "result",
              termbaseId,
              message: `${result.entryCount} entries → ${result.outputPath}`,
              diagnostics: [],
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isMutCurrent("termbase", opId, projectId)) return;
        setState((s) => ({
          ...s,
          termbase: {
            ...s.termbase,
            exchange: {
              status: "error",
              termbaseId,
              message: null,
              diagnostics: [],
              error: toUiError(error),
            },
          },
        }));
      } finally {
        endMut("termbase", opId, projectId);
      }
    },

    setAlignmentCreate: (patch) =>
      setState((s) => ({
        ...s,
        alignment: {
          ...s.alignment,
          create: { ...s.alignment.create, ...patch },
        },
      })),

    createAlignment: async () => {
      const projectId = projectIdRef.current;
      const g = gatewayRef.current;
      if (!g.mutationsEnabled) return;
      const create = stateRef.current.alignment.create;
      if (
        !create.sourceDocumentId ||
        !create.targetDocumentId ||
        create.sourceDocumentId === create.targetDocumentId ||
        !create.reason.trim()
      ) {
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            create: {
              ...s.alignment.create,
              pending: false,
              error: {
                code: "VALIDATION",
                message: "Distinct documents and reason required",
                kind: "domain",
              },
            },
          },
        }));
        return;
      }
      const opId = beginMut("alignment");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        alignment: {
          ...s.alignment,
          create: { ...s.alignment.create, pending: true, error: null },
        },
      }));
      try {
        const project = await invokeEngine("project.get", { projectId });
        const sourceDoc = await invokeEngine("document.get", {
          documentId: create.sourceDocumentId,
        });
        const targetDoc = await invokeEngine("document.get", {
          documentId: create.targetDocumentId,
        });
        await invokeEngine("alignment.session.create", {
          projectId,
          sourceDocumentId: create.sourceDocumentId,
          targetDocumentId: create.targetDocumentId,
          expectedProjectRevision: project.project.revision,
          expectedSourceDocumentRevision: sourceDoc.revision,
          expectedTargetDocumentRevision: targetDoc.revision,
          reason: create.reason.trim(),
          options: DEFAULT_ALIGNMENT_OPTIONS,
        });
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            create: {
              sourceDocumentId: "",
              targetDocumentId: "",
              reason: "",
              pending: false,
              error: null,
            },
          },
        }));
        await loadSessions(0);
      } catch (error) {
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            create: {
              ...s.alignment.create,
              pending: false,
              error: toUiError(error),
            },
          },
        }));
      } finally {
        endMut("alignment", opId, projectId);
      }
    },

    selectAlignmentSession: async (sessionId) => {
      const projectId = projectIdRef.current;
      if (!sessionId) {
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            selectedSessionId: null,
            session: null,
            links: emptyPage(50),
            selectedLinkIds: [],
          },
        }));
        return;
      }
      const opId = beginList("alignment");
      setState((s) => ({
        ...s,
        alignment: {
          ...s.alignment,
          selectedSessionId: sessionId,
          links: { ...s.alignment.links, status: "loading", error: null },
          actionError: null,
        },
      }));
      try {
        const result = await invokeEngine("alignment.session.get", {
          sessionId,
          offset: 0,
          limit: 50,
        });
        if (!isListCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            session: result.session,
            links: {
              status: "ready",
              items: result.links,
              total: result.total,
              offset: result.offset,
              limit: result.limit,
              error: null,
            },
            selectedLinkIds: [],
          },
        }));
      } catch (error) {
        if (!isListCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            links: {
              ...s.alignment.links,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },

    toggleLinkSelection: (linkId) =>
      setState((s) => {
        const set = new Set(s.alignment.selectedLinkIds);
        if (set.has(linkId)) set.delete(linkId);
        else set.add(linkId);
        return {
          ...s,
          alignment: {
            ...s.alignment,
            selectedLinkIds: [...set],
          },
        };
      }),

    setLinkStatus: async (linkId, expectedRevision, status) => {
      const projectId = projectIdRef.current;
      const session = state.alignment.session;
      if (!session || !gatewayRef.current.mutationsEnabled) return;
      const opId = beginMut("alignment");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        alignment: {
          ...s.alignment,
          actionPending: true,
          actionError: null,
        },
      }));
      try {
        const result = await invokeEngine("alignment.session.update", {
          sessionId: session.id,
          expectedSessionRevision: session.revision,
          reason: `setStatus ${status}`,
          mutation: {
            kind: "setStatus",
            linkId,
            expectedLinkRevision: expectedRevision,
            status,
          },
        });
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            session: result.session,
            links: {
              ...s.alignment.links,
              items: s.alignment.links.items.map((link) => {
                const updated = result.links.find((l) => l.id === link.id);
                return updated ?? link;
              }),
            },
            actionPending: false,
          },
        }));
      } catch (error) {
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            actionPending: false,
            actionError: toUiError(error),
          },
        }));
      } finally {
        endMut("alignment", opId, projectId);
      }
    },

    setRefineProfileId: (id) =>
      setState((s) => ({
        ...s,
        alignment: { ...s.alignment, refineProfileId: id },
      })),

    setRefineReason: (reason) =>
      setState((s) => ({
        ...s,
        alignment: { ...s.alignment, refineReason: reason },
      })),

    replaceSelectedLinks: async (reason) => {
      const projectId = projectIdRef.current;
      let session = state.alignment.session;
      let selectedLinkIds = state.alignment.selectedLinkIds;
      let links = state.alignment.links;
      setState((s) => {
        session = s.alignment.session;
        selectedLinkIds = s.alignment.selectedLinkIds;
        links = s.alignment.links;
        return s;
      });
      if (
        !session ||
        selectedLinkIds.length < 2 ||
        !reason.trim() ||
        !gatewayRef.current.mutationsEnabled
      ) {
        return;
      }
      const selected = selectedLinkIds
        .map((id) => links.items.find((l) => l.id === id))
        .filter((l): l is NonNullable<typeof l> => Boolean(l));
      if (selected.length < 2) return;
      const opId = beginMut("alignment");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        alignment: {
          ...s.alignment,
          actionPending: true,
          actionError: null,
        },
      }));
      try {
        const sourceSegmentIds = [
          ...new Set(selected.flatMap((l) => l.sourceSegmentIds)),
        ];
        const targetSegmentIds = [
          ...new Set(selected.flatMap((l) => l.targetSegmentIds)),
        ];
        const result = await invokeEngine("alignment.session.update", {
          sessionId: session.id,
          expectedSessionRevision: session.revision,
          reason: reason.trim(),
          mutation: {
            kind: "replaceLinks",
            links: selected.map((l) => ({
              linkId: l.id,
              expectedRevision: l.revision,
            })),
            replacement: [{ sourceSegmentIds, targetSegmentIds }],
          },
        });
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            session: result.session,
            links: {
              status: "ready",
              items: result.links,
              total: result.links.length,
              offset: 0,
              limit: result.links.length,
              error: null,
            },
            selectedLinkIds: [],
            actionPending: false,
          },
        }));
      } catch (error) {
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            actionPending: false,
            actionError: toUiError(error),
          },
        }));
      } finally {
        endMut("alignment", opId, projectId);
      }
    },

    refineSelected: async () => {
      const projectId = projectIdRef.current;
      let session = state.alignment.session;
      let selectedLinkIds = state.alignment.selectedLinkIds;
      let links = state.alignment.links;
      let refineProfileId = state.alignment.refineProfileId;
      let refineReason = state.alignment.refineReason;
      setState((s) => {
        session = s.alignment.session;
        selectedLinkIds = s.alignment.selectedLinkIds;
        links = s.alignment.links;
        refineProfileId = s.alignment.refineProfileId;
        refineReason = s.alignment.refineReason;
        return s;
      });
      if (
        !session ||
        !refineProfileId.trim() ||
        !refineReason.trim() ||
        selectedLinkIds.length === 0 ||
        !gatewayRef.current.mutationsEnabled
      ) {
        return;
      }
      const opId = beginMut("alignment");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        alignment: {
          ...s.alignment,
          actionPending: true,
          actionError: null,
          lastRefineRunId: null,
        },
      }));
      try {
        const linkRevs = selectedLinkIds
          .map((id) => links.items.find((l) => l.id === id))
          .filter((l): l is NonNullable<typeof l> => Boolean(l))
          .map((l) => ({ linkId: l.id, expectedRevision: l.revision }));
        const run = await invokeEngine("alignment.session.refine", {
          sessionId: session.id,
          expectedSessionRevision: session.revision,
          links: linkRevs,
          profileId: refineProfileId.trim(),
          reason: refineReason.trim(),
        });
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            actionPending: false,
            lastRefineRunId: run.id,
          },
        }));
        // Refresh session/links after refine (refine does not return links)
        const refreshed = await invokeEngine("alignment.session.get", {
          sessionId: session.id,
          offset: 0,
          limit: 50,
        });
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            session: refreshed.session,
            links: {
              status: "ready",
              items: refreshed.links,
              total: refreshed.total,
              offset: refreshed.offset,
              limit: refreshed.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            actionPending: false,
            actionError: toUiError(error),
          },
        }));
      } finally {
        endMut("alignment", opId, projectId);
      }
    },

    setApplyLibraryId: (id) =>
      setState((s) => ({
        ...s,
        alignment: { ...s.alignment, applyLibraryId: id },
      })),

    applyAlignment: async (reason) => {
      const projectId = projectIdRef.current;
      const { session, selectedLinkIds, links, applyLibraryId } =
        state.alignment;
      if (
        !session ||
        session.status !== "open" ||
        !applyLibraryId ||
        selectedLinkIds.length === 0 ||
        !reason.trim() ||
        !gatewayRef.current.mutationsEnabled
      ) {
        return;
      }
      const opId = beginMut("alignment");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        alignment: {
          ...s.alignment,
          actionPending: true,
          actionError: null,
          lastApplyMessage: null,
        },
      }));
      try {
        const libPage = await invokeEngine("tm.library.list", {
          projectId,
          offset: 0,
          limit: 50,
        });
        const lib = libPage.items.find((l) => l.id === applyLibraryId);
        if (!lib) {
          throw Object.assign(new Error("Library not found"), {
            code: "NOT_FOUND",
          });
        }
        const linkRevs = selectedLinkIds
          .map((id) => links.items.find((l) => l.id === id))
          .filter((l): l is NonNullable<typeof l> => Boolean(l))
          .map((l) => ({ linkId: l.id, expectedRevision: l.revision }));
        const result = await invokeEngine("alignment.session.apply", {
          sessionId: session.id,
          expectedSessionRevision: session.revision,
          libraryId: applyLibraryId,
          expectedLibraryRevision: lib.revision,
          links: linkRevs,
          reason: reason.trim(),
        });
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            actionPending: false,
            session: {
              ...session,
              status: result.status,
              revision: result.sessionRevision,
              terminalResult: result,
            },
            lastApplyMessage: `Inserted ${result.insertedCount}, duplicates ${result.duplicateCount}`,
          },
        }));
        await loadTmLibraries(0);
      } catch (error) {
        if (!isMutCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            actionPending: false,
            actionError: toUiError(error),
          },
        }));
      } finally {
        endMut("alignment", opId, projectId);
      }
    },

    setCorpusImport: (patch) =>
      setState((s) => ({
        ...s,
        corpus: {
          ...s.corpus,
          import: { ...s.corpus.import, ...patch },
        },
      })),

    importCorpus: async () => {
      const projectId = projectIdRef.current;
      const g = gatewayRef.current;
      if (!g.mutationsEnabled) return;
      let form = state.corpus.import;
      setState((s) => {
        form = s.corpus.import;
        return {
          ...s,
          corpus: {
            ...s.corpus,
            import: { ...s.corpus.import, pending: true, error: null },
          },
        };
      });
      if (!form.name.trim()) {
        setState((s) => ({
          ...s,
          corpus: {
            ...s.corpus,
            import: { ...s.corpus.import, pending: false },
          },
        }));
        return;
      }
      const opId = beginMut("corpus");
      if (opId === null) return;
      try {
        const path = await desktopApi().selectCorpusInput();
        if (!path) {
          if (!isMutCurrent("corpus", opId, projectId)) return;
          setState((s) => ({
            ...s,
            corpus: {
              ...s.corpus,
              import: { ...s.corpus.import, pending: false },
            },
          }));
          return;
        }
        const project = await invokeEngine("project.get", { projectId });
        const corpus = await invokeEngine("corpus.import", {
          projectId,
          expectedProjectRevision: project.project.revision,
          name: form.name.trim(),
          kind: form.kind,
          sourceLocale: g.sourceLocale,
          targetLocale: g.targetLocale,
          sourcePath: path,
          reason: "import",
        });
        if (!isMutCurrent("corpus", opId, projectId)) return;
        setState((s) => ({
          ...s,
          corpus: {
            ...s.corpus,
            import: {
              name: "",
              kind: "bilingual",
              pending: false,
              error: null,
              message: `${String(corpus.name)}: ${String(corpus.entryCount)} entries`,
            },
          },
        }));
        await loadCorpora(0);
      } catch (error) {
        if (!isMutCurrent("corpus", opId, projectId)) return;
        setState((s) => ({
          ...s,
          corpus: {
            ...s.corpus,
            import: {
              ...s.corpus.import,
              pending: false,
              error: toUiError(error),
            },
          },
        }));
      } finally {
        endMut("corpus", opId, projectId);
      }
    },

    setCorpusSearchQuery: (q) =>
      setState((s) => ({
        ...s,
        corpus: { ...s.corpus, searchQuery: q },
      })),

    runCorpusSearch: async (offset = 0) => {
      const projectId = projectIdRef.current;
      const query = stateRef.current.corpus.searchQuery.trim();
      if (!query) {
        setState((s) => ({
          ...s,
          corpus: { ...s.corpus, search: emptyPage(PAGE) },
        }));
        return;
      }
      const opId = beginList("corpus");
      setState((s) => ({
        ...s,
        corpus: {
          ...s.corpus,
          search: { ...s.corpus.search, status: "loading", error: null },
        },
      }));
      try {
        const result = await invokeEngine("corpus.search", {
          projectId,
          query,
          offset,
          limit: PAGE,
        });
        if (!isListCurrent("corpus", opId, projectId)) return;
        setState((s) => ({
          ...s,
          corpus: {
            ...s.corpus,
            search: {
              status: "ready",
              items: result.items,
              total: result.total,
              offset: result.offset,
              limit: result.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isListCurrent("corpus", opId, projectId)) return;
        setState((s) => ({
          ...s,
          corpus: {
            ...s.corpus,
            search: {
              ...s.corpus.search,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },

    removeCorpus: async (corpusId, expectedRevision, reason) => {
      const projectId = projectIdRef.current;
      if (!gatewayRef.current.mutationsEnabled) return false;
      const opId = beginMut("corpus");
      if (opId === null) return false;
      setState((s) => ({
        ...s,
        corpus: { ...s.corpus, actionPending: true, actionError: null },
      }));
      try {
        await invokeEngine("corpus.remove", {
          corpusId,
          expectedRevision,
          reason,
        });
        if (!isMutCurrent("corpus", opId, projectId)) return false;
        setState((s) => ({
          ...s,
          corpus: { ...s.corpus, actionPending: false },
        }));
        await loadCorpora(0);
        return true;
      } catch (error) {
        if (!isMutCurrent("corpus", opId, projectId)) return false;
        setState((s) => ({
          ...s,
          corpus: {
            ...s.corpus,
            actionPending: false,
            actionError: toUiError(error),
          },
        }));
        return false;
      } finally {
        endMut("corpus", opId, projectId);
      }
    },
    corpusFromAlignment: async (name, reason) => {
      const projectId = projectIdRef.current;
      const { session, selectedLinkIds, links } = state.alignment;
      if (
        !session ||
        selectedLinkIds.length === 0 ||
        !name.trim() ||
        !reason.trim() ||
        !gatewayRef.current.mutationsEnabled
      ) {
        return;
      }
      const opId = beginMut("corpus");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        corpus: { ...s.corpus, actionPending: true, actionError: null },
      }));
      try {
        const project = await invokeEngine("project.get", { projectId });
        const linkRevs = selectedLinkIds
          .map((id) => links.items.find((l) => l.id === id))
          .filter((l): l is NonNullable<typeof l> => Boolean(l))
          .map((l) => ({ linkId: l.id, expectedRevision: l.revision }));
        await invokeEngine("corpus.fromAlignment", {
          projectId,
          expectedProjectRevision: project.project.revision,
          sessionId: session.id,
          expectedSessionRevision: session.revision,
          links: linkRevs,
          name: name.trim(),
          reason: reason.trim(),
        });
        if (!isMutCurrent("corpus", opId, projectId)) return;
        setState((s) => ({
          ...s,
          corpus: { ...s.corpus, actionPending: false },
        }));
        await loadCorpora(0);
      } catch (error) {
        if (!isMutCurrent("corpus", opId, projectId)) return;
        setState((s) => ({
          ...s,
          corpus: {
            ...s.corpus,
            actionPending: false,
            actionError: toUiError(error),
          },
        }));
      } finally {
        endMut("corpus", opId, projectId);
      }
    },

    setCatalogQuery: (q) =>
      setState((s) => ({
        ...s,
        catalog: { ...s.catalog, query: q },
      })),

    setCatalogKind: (k) =>
      setState((s) => ({
        ...s,
        catalog: { ...s.catalog, kind: k },
      })),

    setCatalogFilter: (patch) =>
      setState((s) => ({
        ...s,
        catalog: { ...s.catalog, ...patch },
      })),

    loadCatalog,
    loadTmLibraries,
    loadTermbases,
    loadCorpora,
    loadAlignmentSessions: loadSessions,
    loadAlignmentLinks: async (offset = 0) => {
      const projectId = projectIdRef.current;
      const sessionId = stateRef.current.alignment.selectedSessionId;
      if (!sessionId) return;
      const opId = beginList("alignment");
      setState((s) => ({
        ...s,
        alignment: {
          ...s.alignment,
          links: { ...s.alignment.links, status: "loading", error: null },
        },
      }));
      try {
        const refreshed = await invokeEngine("alignment.session.get", {
          sessionId,
          offset,
          limit: 50,
        });
        if (!isListCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            session: refreshed.session,
            links: {
              status: "ready",
              items: refreshed.links,
              total: refreshed.total,
              offset: refreshed.offset,
              limit: refreshed.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isListCurrent("alignment", opId, projectId)) return;
        setState((s) => ({
          ...s,
          alignment: {
            ...s.alignment,
            links: {
              ...s.alignment.links,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },

    setCurationLibraryId: (id) =>
      setState((s) => ({
        ...s,
        curation: { ...s.curation, libraryId: id },
      })),

    setCurationReason: (r) =>
      setState((s) => ({
        ...s,
        curation: { ...s.curation, reason: r },
      })),

    setCurationPolicy: (policy) =>
      setState((s) => ({
        ...s,
        curation: { ...s.curation, policy },
      })),

    patchCurationPolicy: (patch) =>
      setState((s) => ({
        ...s,
        curation: {
          ...s.curation,
          policy: { ...s.curation.policy, ...patch },
        },
      })),

    setKnownRunId: (id) =>
      setState((s) => ({
        ...s,
        curation: { ...s.curation, knownRunId: id },
      })),

    startCuration: async () => {
      const projectId = projectIdRef.current;
      const g = gatewayRef.current;
      if (!g.mutationsEnabled) return;
      const libraryId = stateRef.current.curation.libraryId;
      const reason = stateRef.current.curation.reason.trim();
      const policy = stateRef.current.curation.policy;
      if (!libraryId || !reason) {
        return;
      }
      const opId = beginMut("curation");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        curation: {
          ...s.curation,
          runPending: true,
          runError: null,
          exportMessage: null,
        },
      }));
      try {
        const libs = await invokeEngine("tm.library.list", {
          projectId,
          offset: 0,
          limit: 50,
        });
        const lib = libs.items.find((l) => l.id === libraryId);
        if (!lib) {
          throw Object.assign(new Error("Library not found"), {
            code: "NOT_FOUND",
          });
        }
        const snapshot = await invokeEngine("curation.run", {
          projectId,
          libraryId,
          expectedLibraryRevision: lib.revision,
          reason,
          policy: {
            maximumLengthRatioPercent: policy.maximumLengthRatioPercent,
            minimumChars: policy.minimumChars,
            minimumLengthRatioPercent: policy.minimumLengthRatioPercent,
            minimumTermFrequency: policy.minimumTermFrequency,
            nearDuplicateThreshold: policy.nearDuplicateThreshold,
            quarantineThresholdBasisPoints:
              policy.quarantineThresholdBasisPoints,
            semanticAlignmentThresholdBasisPoints:
              policy.semanticAlignmentThresholdBasisPoints,
            createdAfterMs: policy.createdAfterMs ?? null,
            createdBeforeMs: policy.createdBeforeMs ?? null,
          },
          offset: 0,
          limit: 50,
        });
        if (!isMutCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            runPending: false,
            snapshot,
            knownRunId: snapshot.run.id,
            selectedFindingIds: [],
          },
        }));
        // Load findings
        const findings = await invokeEngine("curation.finding.list", {
          runId: snapshot.run.id,
          offset: 0,
          limit: PAGE,
        });
        if (!isMutCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            findings: {
              status: "ready",
              items: findings.items,
              total: findings.total,
              offset: findings.offset,
              limit: findings.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isMutCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            runPending: false,
            runError: toUiError(error),
          },
        }));
      } finally {
        endMut("curation", opId, projectId);
      }
    },

    loadCurationRun: async (runId) => {
      const projectId = projectIdRef.current;
      const id = runId ?? state.curation.knownRunId;
      if (!id.trim()) return;
      const opId = beginList("curation");
      setState((s) => ({
        ...s,
        curation: { ...s.curation, runPending: true, runError: null },
      }));
      try {
        const snapshot = await invokeEngine("curation.run.get", {
          runId: id.trim(),
          offset: 0,
          limit: 50,
        });
        if (!isListCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            runPending: false,
            snapshot,
            knownRunId: snapshot.run.id,
          },
        }));
        const findings = await invokeEngine("curation.finding.list", {
          runId: snapshot.run.id,
          offset: 0,
          limit: PAGE,
        });
        if (!isListCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            findings: {
              status: "ready",
              items: findings.items,
              total: findings.total,
              offset: findings.offset,
              limit: findings.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isListCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            runPending: false,
            runError: toUiError(error),
          },
        }));
      }
    },

    loadFindings: async (offset = 0) => {
      const projectId = projectIdRef.current;
      const runId = state.curation.snapshot?.run.id;
      if (!runId) return;
      const opId = beginList("curation");
      setState((s) => ({
        ...s,
        curation: {
          ...s.curation,
          findings: {
            ...s.curation.findings,
            status: "loading",
            error: null,
          },
        },
      }));
      try {
        const findings = await invokeEngine("curation.finding.list", {
          runId,
          offset,
          limit: PAGE,
        });
        if (!isListCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            findings: {
              status: "ready",
              items: findings.items,
              total: findings.total,
              offset: findings.offset,
              limit: findings.limit,
              error: null,
            },
          },
        }));
      } catch (error) {
        if (!isListCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            findings: {
              ...s.curation.findings,
              status: "error",
              error: toUiError(error),
            },
          },
        }));
      }
    },

    toggleFinding: (id) =>
      setState((s) => {
        const set = new Set(s.curation.selectedFindingIds);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        return {
          ...s,
          curation: {
            ...s.curation,
            selectedFindingIds: [...set],
          },
        };
      }),

    applyFindings: async (reason) => {
      const projectId = projectIdRef.current;
      const { snapshot, selectedFindingIds } = state.curation;
      if (
        !snapshot ||
        selectedFindingIds.length === 0 ||
        !reason.trim() ||
        !gatewayRef.current.mutationsEnabled
      ) {
        return;
      }
      const opId = beginMut("curation");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        curation: {
          ...s.curation,
          actionPending: true,
          actionError: null,
        },
      }));
      try {
        const result = await invokeEngine("curation.apply", {
          runId: snapshot.run.id,
          expectedRunRevision: snapshot.run.revision,
          expectedLibraryRevision: snapshot.run.baseLibraryRevision,
          selectedFindingIds,
          reason: reason.trim(),
        });
        if (!isMutCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            actionPending: false,
            selectedFindingIds: [],
            snapshot: s.curation.snapshot
              ? {
                  ...s.curation.snapshot,
                  run: {
                    ...s.curation.snapshot.run,
                    revision: result.runRevision,
                    status: result.status,
                  },
                }
              : null,
          },
        }));
        const refreshed = await invokeEngine("curation.run.get", {
          runId: snapshot.run.id,
          offset: 0,
          limit: 50,
        });
        if (!isMutCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: { ...s.curation, snapshot: refreshed },
        }));
      } catch (error) {
        if (!isMutCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            actionPending: false,
            actionError: toUiError(error),
          },
        }));
      } finally {
        endMut("curation", opId, projectId);
      }
    },

    rollbackCuration: async (reason) => {
      const projectId = projectIdRef.current;
      const snapshot = stateRef.current.curation.snapshot;
      if (!snapshot || !reason.trim() || !gatewayRef.current.mutationsEnabled) {
        return false;
      }
      const opId = beginMut("curation");
      if (opId === null) return false;
      setState((s) => ({
        ...s,
        curation: {
          ...s.curation,
          actionPending: true,
          actionError: null,
        },
      }));
      try {
        const result = await invokeEngine("curation.rollback", {
          runId: snapshot.run.id,
          expectedRunRevision: snapshot.run.revision,
          expectedLibraryRevision: snapshot.run.baseLibraryRevision,
          reason: reason.trim(),
        });
        if (!isMutCurrent("curation", opId, projectId)) return false;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            actionPending: false,
            snapshot: s.curation.snapshot
              ? {
                  ...s.curation.snapshot,
                  run: {
                    ...s.curation.snapshot.run,
                    revision: result.runRevision,
                    status: result.status,
                  },
                }
              : null,
          },
        }));
        return true;
      } catch (error) {
        if (!isMutCurrent("curation", opId, projectId)) return false;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            actionPending: false,
            actionError: toUiError(error),
          },
        }));
        return false;
      } finally {
        endMut("curation", opId, projectId);
      }
    },
    exportCuration: async (format) => {
      const projectId = projectIdRef.current;
      const snapshot = state.curation.snapshot;
      if (!snapshot || !gatewayRef.current.mutationsEnabled) return;
      const opId = beginMut("curation");
      if (opId === null) return;
      setState((s) => ({
        ...s,
        curation: {
          ...s.curation,
          actionPending: true,
          actionError: null,
          exportMessage: null,
        },
      }));
      try {
        const path = await desktopApi().selectExportPath(
          `curation-export.${format}`,
        );
        if (!path) {
          if (!isMutCurrent("curation", opId, projectId)) return;
          setState((s) => ({
            ...s,
            curation: { ...s.curation, actionPending: false },
          }));
          return;
        }
        const result = await invokeEngine("curation.export", {
          runId: snapshot.run.id,
          expectedRunRevision: snapshot.run.revision,
          expectedLibraryRevision: snapshot.run.baseLibraryRevision,
          format,
          outputPath: path,
        });
        if (!isMutCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            actionPending: false,
            exportMessage: `${result.rowCount} rows, ${result.bytesWritten} bytes → ${result.outputPath} (${result.sha256})`,
          },
        }));
      } catch (error) {
        if (!isMutCurrent("curation", opId, projectId)) return;
        setState((s) => ({
          ...s,
          curation: {
            ...s.curation,
            actionPending: false,
            actionError: toUiError(error),
          },
        }));
      } finally {
        endMut("curation", opId, projectId);
      }
    },
  };
}
