import type {
  AlignmentLink,
  AlignmentSession,
  AssetCatalogItem,
  AssetDiagnostic,
  ConcordanceHit,
  CorpusSearchHit,
  CurationFinding,
  CurationPolicy,
  CurationRunSnapshot,
  ReferenceCorpus,
  Termbase,
  TermbaseMount,
  TermEntry,
  TermMatch,
  TmLibrary,
  TmLibraryMount,
  TmMatch,
} from "@translunar/contracts";

import type { UiError } from "../lib/errors";
import { DEFAULT_CURATION_POLICY } from "./asset-view";

export type AssetSection =
  "tm" | "termbase" | "alignment" | "corpus" | "catalog" | "curation";

export type ListStatus = "idle" | "loading" | "ready" | "error";

export interface PagedList<T> {
  status: ListStatus;
  items: T[];
  total: number;
  offset: number;
  limit: number;
  error: UiError | null;
}

export function emptyPage<T>(limit = 25): PagedList<T> {
  return {
    status: "idle",
    items: [],
    total: 0,
    offset: 0,
    limit,
    error: null,
  };
}

export interface TmSectionState {
  libraries: PagedList<TmLibrary>;
  mounts: TmLibraryMount[];
  createName: string;
  createPending: boolean;
  actionError: UiError | null;
  searchQuery: string;
  searchThreshold: number;
  search: PagedList<TmMatch>;
  concordanceQuery: string;
  concordance: PagedList<ConcordanceHit>;
  corpusHits: CorpusSearchHit[];
  exchange: {
    status: "idle" | "exporting" | "result" | "error";
    libraryId: string | null;
    message: string | null;
    diagnostics: AssetDiagnostic[];
    error: UiError | null;
  };
}

export interface TermbaseSectionState {
  termbases: PagedList<Termbase>;
  mounts: TermbaseMount[];
  createName: string;
  createPending: boolean;
  actionError: UiError | null;
  searchText: string;
  search: PagedList<TermMatch>;
  upsert: {
    termbaseId: string;
    sourceTerm: string;
    translation: string;
    pending: boolean;
    lastEntry: TermEntry | null;
    error: UiError | null;
  };
  exchange: {
    status: "idle" | "exporting" | "result" | "error";
    termbaseId: string | null;
    message: string | null;
    diagnostics: AssetDiagnostic[];
    error: UiError | null;
  };
}

export interface AlignmentSectionState {
  sessions: PagedList<AlignmentSession>;
  selectedSessionId: string | null;
  session: AlignmentSession | null;
  links: PagedList<AlignmentLink>;
  create: {
    sourceDocumentId: string;
    targetDocumentId: string;
    reason: string;
    pending: boolean;
    error: UiError | null;
  };
  selectedLinkIds: string[];
  actionPending: boolean;
  actionError: UiError | null;
  refineProfileId: string;
  refineReason: string;
  applyLibraryId: string;
  lastRefineRunId: string | null;
  lastApplyMessage: string | null;
}

export interface CorpusSectionState {
  corpora: PagedList<ReferenceCorpus>;
  import: {
    name: string;
    kind: "monolingualSource" | "monolingualTarget" | "bilingual";
    pending: boolean;
    error: UiError | null;
    message: string | null;
  };
  searchQuery: string;
  search: PagedList<CorpusSearchHit>;
  actionError: UiError | null;
  actionPending: boolean;
}

export interface CatalogSectionState {
  query: string;
  kind: "all" | "tm" | "termbase" | "corpus";
  sourceLocale: string;
  targetLocale: string;
  domain: string;
  originProjectId: string;
  originDocumentId: string;
  createdAfterMs: string;
  createdBeforeMs: string;
  page: PagedList<AssetCatalogItem>;
}

export interface CurationSectionState {
  libraryId: string;
  reason: string;
  policy: CurationPolicy;
  runPending: boolean;
  runError: UiError | null;
  snapshot: CurationRunSnapshot | null;
  findings: PagedList<CurationFinding>;
  selectedFindingIds: string[];
  actionPending: boolean;
  actionError: UiError | null;
  exportMessage: string | null;
  knownRunId: string;
}

export interface AssetControllerState {
  section: AssetSection;
  projectId: string;
  projectName: string;
  sourceLocale: string;
  targetLocale: string;
  projectRevision: number;
  documents: Array<{ id: string; name: string; revision: number }>;
  tm: TmSectionState;
  termbase: TermbaseSectionState;
  alignment: AlignmentSectionState;
  corpus: CorpusSectionState;
  catalog: CatalogSectionState;
  curation: CurationSectionState;
}

export function createInitialAssetState(input: {
  projectId: string;
  projectName: string;
  sourceLocale: string;
  targetLocale: string;
  projectRevision: number;
  section?: AssetSection;
}): AssetControllerState {
  return {
    section: input.section ?? "tm",
    projectId: input.projectId,
    projectName: input.projectName,
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
    projectRevision: input.projectRevision,
    documents: [],
    tm: {
      libraries: emptyPage(50),
      mounts: [],
      createName: "",
      createPending: false,
      actionError: null,
      searchQuery: "",
      searchThreshold: 0.7,
      search: emptyPage(25),
      concordanceQuery: "",
      concordance: emptyPage(25),
      corpusHits: [],
      exchange: {
        status: "idle",
        libraryId: null,
        message: null,
        diagnostics: [],
        error: null,
      },
    },
    termbase: {
      termbases: emptyPage(50),
      mounts: [],
      createName: "",
      createPending: false,
      actionError: null,
      searchText: "",
      search: emptyPage(25),
      upsert: {
        termbaseId: "",
        sourceTerm: "",
        translation: "",
        pending: false,
        lastEntry: null,
        error: null,
      },
      exchange: {
        status: "idle",
        termbaseId: null,
        message: null,
        diagnostics: [],
        error: null,
      },
    },
    alignment: {
      sessions: emptyPage(25),
      selectedSessionId: null,
      session: null,
      links: emptyPage(50),
      create: {
        sourceDocumentId: "",
        targetDocumentId: "",
        reason: "",
        pending: false,
        error: null,
      },
      selectedLinkIds: [],
      actionPending: false,
      actionError: null,
      refineProfileId: "",
      refineReason: "",
      applyLibraryId: "",
      lastRefineRunId: null,
      lastApplyMessage: null,
    },
    corpus: {
      corpora: emptyPage(25),
      import: {
        name: "",
        kind: "bilingual",
        pending: false,
        error: null,
        message: null,
      },
      searchQuery: "",
      search: emptyPage(25),
      actionError: null,
      actionPending: false,
    },
    catalog: {
      query: "",
      kind: "all",
      sourceLocale: "",
      targetLocale: "",
      domain: "",
      originProjectId: "",
      originDocumentId: "",
      createdAfterMs: "",
      createdBeforeMs: "",
      page: emptyPage(25),
    },
    curation: {
      libraryId: "",
      reason: "",
      policy: { ...DEFAULT_CURATION_POLICY },
      runPending: false,
      runError: null,
      snapshot: null,
      findings: emptyPage(25),
      selectedFindingIds: [],
      actionPending: false,
      actionError: null,
      exportMessage: null,
      knownRunId: "",
    },
  };
}
