/* eslint-disable -- Generated from the Rust protocol schema. Do not edit. */

export type RpcErrorCode =
  | "invalidRequest"
  | "methodNotFound"
  | "invalidParams"
  | "notFound"
  | "conflict"
  | "filterFailed"
  | "exportBlocked"
  | "aiNotConfigured"
  | "aiFailed"
  | "io"
  | "internal";
/**
 * Lifecycle of an agent run. The run never confirms segments, never signs
 * off, and never exports: it always parks at `awaitingReview` for a human.
 */
export type AgentRunStatus = ("running" | "canceled" | "failed") | "awaitingReview";
export type AgentStepKind = ("plan" | "qa" | "summary" | "cancel") | "tm" | "translate";
export type AgentStepStatus = "done" | "failed" | "skipped";
export type AiAssistAction = "translate" | "refine";
export type AiProviderKind =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepl"
  | "deepseek"
  | "qwen"
  | "glm"
  | "kimi"
  | "volcengine"
  | "openaiCompatible";
/**
 * Lifecycle of one asynchronous assist request. `ai.assist.start` validates
 * and returns immediately; the provider call runs off the RPC thread and the
 * client polls `ai.assist.status` until the run turns terminal. Assist never
 * writes to the segment: a `done` run only carries a proposal for a human.
 */
export type AiAssistRunStatus = "running" | "done" | "failed" | "canceled";
export type DegradationSeverity = "warning" | "error";
export type DocumentStatus = "active" | "failed" | "superseded";
export type ProjectLifecycle = "active" | "archived" | "trash";
export type QaSeverity = "error" | "warning" | "info";
export type QaIssueStatus = "open" | "resolved";
export type SegmentState = "untranslated" | "draft" | "confirmed";
export type TermStatus = "candidate" | "active" | "deprecated";
export type TermExchangeFormat = "csv" | "tsv" | "tbx";
export type TmExchangeFormat = "tmx" | "csv" | "tsv";
export type TmMatchGrade = "exact" | "inContext" | "fuzzy";

/**
 * Root schema exported for the TypeScript contracts package.
 *
 * The runtime stdout frame is `EngineFrame` (an internally tagged enum); its
 * constituent parts are exported here individually so the generated
 * TypeScript keeps their full field lists.
 */
export interface ProtocolCatalog {
  error: RpcError;
  methods: RpcMethodCatalog;
  notification: RpcNotification;
  notifications: NotificationCatalog;
  request: RpcRequest;
  response: RpcResponse;
}
export interface RpcError {
  code: RpcErrorCode;
  data?: unknown;
  message: string;
  [k: string]: unknown;
}
/**
 * Method-name-keyed catalog. Field renames must match [`methods`] constants;
 * the test below keeps them honest.
 */
export interface RpcMethodCatalog {
  "ai.agent.cancel": MethodContract33;
  "ai.agent.start": MethodContract31;
  "ai.agent.status": MethodContract32;
  "ai.assist.cancel": MethodContract30;
  "ai.assist.start": MethodContract28;
  "ai.assist.status": MethodContract29;
  "ai.configure": MethodContract26;
  "ai.status": MethodContract27;
  "document.export": MethodContract8;
  "document.import": MethodContract6;
  "document.list": MethodContract7;
  "engine.initialize": MethodContract;
  "engine.shutdown": MethodContract2;
  "project.create": MethodContract3;
  "project.get": MethodContract5;
  "project.list": MethodContract4;
  "qa.list": MethodContract25;
  "qa.run": MethodContract24;
  "segment.confirm": MethodContract11;
  "segment.list": MethodContract9;
  "segment.update": MethodContract10;
  "term.add": MethodContract21;
  "term.list": MethodContract22;
  "term.lookup": MethodContract23;
  "termbase.attach": MethodContract18;
  "termbase.create": MethodContract16;
  "termbase.export": MethodContract20;
  "termbase.import": MethodContract19;
  "termbase.list": MethodContract17;
  "tm.export": MethodContract14;
  "tm.import": MethodContract13;
  "tm.lookup": MethodContract12;
  "tm.pretranslate": MethodContract15;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract33 {
  params: AgentCancelParams;
  result: AgentRunView;
}
export interface AgentCancelParams {
  runId: string;
  [k: string]: unknown;
}
/**
 * The observable task order for one agent run.
 */
export interface AgentRunView {
  aiDrafted: number;
  cancelRequested: boolean;
  createdAtMs: number;
  documentId: string;
  failedSegments: number;
  openQaIssues: number;
  /**
   * Untranslated segments claimed by this run at start time.
   */
  plannedSegments: number;
  runId: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  tmApplied: number;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface AgentStep {
  detail: string;
  index: number;
  kind: AgentStepKind;
  segmentId?: string | null;
  status: AgentStepStatus;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract31 {
  params: AgentStartParams;
  result: AgentRunView;
}
export interface AgentStartParams {
  documentId: string;
  instruction?: string | null;
  /**
   * Upper bound on segments the agent may touch in one run.
   */
  maxSegments?: number | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract32 {
  params: AgentStatusParams;
  result: AgentRunView;
}
export interface AgentStatusParams {
  runId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract30 {
  params: AiAssistCancelParams;
  result: AiAssistRunView;
}
export interface AiAssistCancelParams {
  assistId: string;
  [k: string]: unknown;
}
/**
 * The observable state of one assist request.
 */
export interface AiAssistRunView {
  action: AiAssistAction;
  assistId: string;
  cancelRequested: boolean;
  createdAtMs: number;
  /**
   * Present exactly when `status` is `failed`.
   */
  errorMessage?: string | null;
  /**
   * Present exactly when `status` is `done`.
   */
  result?: AiAssistResult | null;
  segmentId: string;
  status: AiAssistRunStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface AiAssistResult {
  draftTarget: string;
  elapsedMs: number;
  model: string;
  provider: AiProviderKind;
  tagCheck: TagIntegrityReport;
  [k: string]: unknown;
}
/**
 * Placeholder/tag integrity of the draft against the segment source.
 */
export interface TagIntegrityReport {
  extra?: string[];
  missing?: string[];
  ok: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract28 {
  params: AiAssistParams;
  result: AiAssistRunView;
}
export interface AiAssistParams {
  action: AiAssistAction;
  instruction?: string | null;
  segmentId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract29 {
  params: AiAssistStatusParams;
  result: AiAssistRunView;
}
export interface AiAssistStatusParams {
  assistId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract26 {
  params: AiConfigureParams;
  result: AiStatusResult;
}
export interface AiConfigureParams {
  /**
   * Held in engine memory only; never persisted to disk.
   */
  apiKey: string;
  /**
   * Overrides the provider's default base URL. Required for
   * `openaiCompatible`, optional otherwise.
   */
  baseUrl?: string | null;
  model: string;
  provider: AiProviderKind;
  [k: string]: unknown;
}
export interface AiStatusResult {
  configured: boolean;
  model?: string | null;
  provider?: AiProviderKind | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract27 {
  params: AiStatusParams;
  result: AiStatusResult;
}
export interface AiStatusParams {
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract8 {
  params: DocumentExportParams;
  result: DocumentExportResult;
}
export interface DocumentExportParams {
  documentId: string;
  outputPath: string;
  [k: string]: unknown;
}
export interface DocumentExportResult {
  degradation: DegradationFinding[];
  outputPath: string;
  translatedSegments: number;
  [k: string]: unknown;
}
export interface DegradationFinding {
  code: string;
  message: string;
  severity: DegradationSeverity;
  structuralPath?: string | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract6 {
  params: DocumentImportParams;
  result: DocumentImportResult;
}
export interface DocumentImportParams {
  /**
   * Explicit filter id. When omitted, the engine probes registered filters.
   */
  filterId?: string | null;
  projectId: string;
  /**
   * Segmentation mode: `sentence` (default) or `paragraph`.
   */
  segmentation?: string | null;
  sourcePath: string;
  /**
   * Path to a custom SRX ruleset used for sentence segmentation. When
   * omitted, the built-in rules for the project source locale apply.
   */
  srxPath?: string | null;
  [k: string]: unknown;
}
export interface DocumentImportResult {
  document: Document;
  segmentCount: number;
  [k: string]: unknown;
}
export interface Document {
  currentVersion: number;
  degradation: DegradationFinding[];
  filterId: string;
  format: string;
  id: string;
  importedAtMs: number;
  name: string;
  projectId: string;
  relativePath: string;
  revision: number;
  segmentCount: number;
  sourceSha256: string;
  status: DocumentStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract7 {
  params: DocumentListParams;
  result: DocumentListResult;
}
export interface DocumentListParams {
  projectId: string;
  [k: string]: unknown;
}
export interface DocumentListResult {
  documents: Document[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract {
  params: InitializeParams;
  result: InitializeResult;
}
export interface InitializeParams {
  clientName: string;
  clientVersion: string;
  protocolVersion: number;
  [k: string]: unknown;
}
export interface InitializeResult {
  capabilities: EngineCapabilities;
  engineName: string;
  engineVersion: string;
  protocolVersion: number;
  [k: string]: unknown;
}
export interface EngineCapabilities {
  aiAgent: boolean;
  aiAssist: boolean;
  /**
   * Registered document filter ids, e.g. `builtin.docx`.
   */
  filters: string[];
  /**
   * Whether the engine emits notification frames.
   */
  notifications: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract2 {
  params: ProjectListParams;
  result: ShutdownResult;
}
export interface ProjectListParams {
  [k: string]: unknown;
}
export interface ShutdownResult {
  ok: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract3 {
  params: ProjectCreateParams;
  result: Project;
}
export interface ProjectCreateParams {
  name: string;
  sourceLocale: string;
  targetLocale: string;
  [k: string]: unknown;
}
export interface Project {
  archivedAtMs?: number | null;
  configuration: ProjectConfiguration;
  createdAtMs: number;
  domain: string;
  id: string;
  lifecycle: ProjectLifecycle;
  name: string;
  revision: number;
  sourceLocale: string;
  targetLocale: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface ProjectConfiguration {
  aiProfileIds?: string[];
  analysisProfileId?: string | null;
  editorDefaults?: EditorPreferences | null;
  engineAllowlist?: string[];
  pipelineId?: string | null;
  qaProfileId?: string | null;
  taskPackage?: TaskPackageProjectReference | null;
  templateId?: string | null;
  [k: string]: unknown;
}
export interface EditorPreferences {
  autocomplete: boolean;
  cjkSpacing: boolean;
  punctuationAssistance: boolean;
  shortcuts: {
    [k: string]: string;
  };
  showNonprinting: boolean;
  theme: string;
  zoom: number;
  [k: string]: unknown;
}
export interface TaskPackageProjectReference {
  instructions?: string;
  originProjectId: string;
  packageId: string;
  parentPackageId?: string | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract5 {
  params: ProjectGetParams;
  result: Project;
}
export interface ProjectGetParams {
  projectId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract4 {
  params: ProjectListParams;
  result: ProjectListResult;
}
export interface ProjectListResult {
  projects: Project[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract25 {
  params: QaListParams;
  result: QaListResult;
}
export interface QaListParams {
  documentId: string;
  [k: string]: unknown;
}
export interface QaListResult {
  issues: QaIssue[];
  [k: string]: unknown;
}
export interface QaIssue {
  createdAtMs: number;
  evidence: NumberEvidence;
  fingerprint: string;
  id: string;
  message: string;
  ruleId: string;
  segmentId: string;
  severity: QaSeverity;
  status: QaIssueStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
/**
 * Evidence attached to a QA issue. Historically number-only; general rules
 * reuse the same shape with free-form source/target values.
 */
export interface NumberEvidence {
  relatedSegmentIds?: string[];
  sourceNumbers: string[];
  sourceValues?: string[];
  targetNumbers: string[];
  targetValues?: string[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract24 {
  params: QaRunParams;
  result: QaRunResult;
}
export interface QaRunParams {
  documentId: string;
  [k: string]: unknown;
}
export interface QaRunResult {
  checkedSegments: number;
  issues: QaIssue[];
  openIssues: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract11 {
  params: SegmentConfirmParams;
  result: SegmentConfirmResult;
}
export interface SegmentConfirmParams {
  baseRevision: number;
  segmentId: string;
  [k: string]: unknown;
}
export interface SegmentConfirmResult {
  /**
   * Sibling segments auto-filled from the confirmed translation.
   */
  propagated: Segment[];
  segment: Segment;
  tmEntry: TmEntry;
  [k: string]: unknown;
}
export interface Segment {
  contextHash: string;
  documentId: string;
  id: string;
  ordinal: number;
  revision: number;
  sourceHash: string;
  sourceText: string;
  state: SegmentState;
  structuralPath: string;
  targetText: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
/**
 * The translation-memory entry written by the confirmation.
 */
export interface TmEntry {
  confirmedAtMs: number;
  id: string;
  memoryId: string;
  originDocumentId: string;
  originProjectId: string;
  originSegmentId: string;
  sourceHash: string;
  sourceText: string;
  targetText: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract9 {
  params: SegmentListParams;
  result: SegmentListResult;
}
export interface SegmentListParams {
  documentId: string;
  [k: string]: unknown;
}
export interface SegmentListResult {
  segments: Segment[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract10 {
  params: SegmentUpdateParams;
  result: SegmentUpdateResult;
}
export interface SegmentUpdateParams {
  /**
   * Optimistic concurrency: must match the segment's current revision.
   */
  baseRevision: number;
  segmentId: string;
  targetText: string;
  [k: string]: unknown;
}
export interface SegmentUpdateResult {
  segment: Segment;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract21 {
  params: TermAddParams;
  result: TermAddResult;
}
export interface TermAddParams {
  definition?: string | null;
  domain?: string | null;
  /**
   * Marks the target as forbidden instead of preferred.
   */
  forbidden?: boolean;
  sourceTerm: string;
  targetLocale: string;
  targetTerm: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermAddResult {
  entry: TermEntry;
  [k: string]: unknown;
}
export interface TermEntry {
  createdAtMs: number;
  definition?: string | null;
  domain?: string | null;
  example?: string | null;
  id: string;
  partOfSpeech?: string | null;
  revision: number;
  sourceLocale: string;
  sourceTerm: string;
  status: TermStatus;
  termbaseId: string;
  translations: TermTranslation[];
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface TermTranslation {
  createdAtMs: number;
  entryId: string;
  forbidden: boolean;
  id: string;
  locale: string;
  preferred: boolean;
  term: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract22 {
  params: TermListParams;
  result: TermListResult;
}
export interface TermListParams {
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermListResult {
  entries: TermEntry[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract23 {
  params: TermLookupParams;
  result: TermLookupResult;
}
export interface TermLookupParams {
  projectId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface TermLookupResult {
  /**
   * Hits over the normalized source text, ordered by span position. Spans
   * are Unicode-scalar offsets into the normalized text.
   */
  matches: TermMatch[];
  [k: string]: unknown;
}
export interface TermMatch {
  end: number;
  entryId: string;
  sourceTerm: string;
  start: number;
  termbaseId: string;
  translations: TermTranslation[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract18 {
  params: TermbaseAttachParams;
  result: TermbaseAttachResult;
}
export interface TermbaseAttachParams {
  projectId: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermbaseAttachResult {
  mount: TermbaseMount;
  [k: string]: unknown;
}
export interface TermbaseMount {
  createdAtMs: number;
  enabled: boolean;
  priority: number;
  projectId: string;
  revision: number;
  termbaseId: string;
  updatedAtMs: number;
  writable: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract16 {
  params: TermbaseCreateParams;
  result: Termbase;
}
export interface TermbaseCreateParams {
  name: string;
  sourceLocale: string;
  [k: string]: unknown;
}
export interface Termbase {
  createdAtMs: number;
  domain?: string | null;
  id: string;
  name: string;
  revision: number;
  sourceLocale: string;
  updatedAtMs: number;
  writable: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract20 {
  params: TermbaseExportParams;
  result: TermbaseExportResult;
}
export interface TermbaseExportParams {
  format?: TermExchangeFormat | null;
  path: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermbaseExportResult {
  exported: number;
  outputPath: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract19 {
  params: TermbaseImportParams;
  result: TermbaseImportResult;
}
export interface TermbaseImportParams {
  /**
   * Explicit exchange format. When omitted, inferred from the extension.
   */
  format?: TermExchangeFormat | null;
  path: string;
  /**
   * Fallback target locale for rows/entries that do not carry one.
   */
  targetLocale: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermbaseImportResult {
  /**
   * New term entries created.
   */
  added: number;
  /**
   * Entries read from the file.
   */
  imported: number;
  /**
   * Existing entries that gained or refreshed translations.
   */
  merged: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract17 {
  params: TermbaseListParams;
  result: TermbaseListResult;
}
export interface TermbaseListParams {
  /**
   * When set, `mounts` is restricted to this project.
   */
  projectId?: string | null;
  [k: string]: unknown;
}
export interface TermbaseListResult {
  mounts: TermbaseMount[];
  termbases: Termbase[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract14 {
  params: TmExportParams;
  result: TmExportResult;
}
export interface TmExportParams {
  format?: TmExchangeFormat | null;
  path: string;
  projectId: string;
  [k: string]: unknown;
}
export interface TmExportResult {
  exported: number;
  outputPath: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract13 {
  params: TmImportParams;
  result: TmImportResult;
}
export interface TmImportParams {
  /**
   * Explicit exchange format. When omitted, inferred from the extension.
   */
  format?: TmExchangeFormat | null;
  path: string;
  projectId: string;
  [k: string]: unknown;
}
export interface TmImportResult {
  /**
   * New TM entries created.
   */
  added: number;
  /**
   * Units read from the file.
   */
  imported: number;
  /**
   * Existing entries whose target was replaced.
   */
  updated: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract12 {
  params: TmLookupParams;
  result: TmLookupResult;
}
export interface TmLookupParams {
  /**
   * Maximum matches to return; defaults to [`TM_LOOKUP_DEFAULT_LIMIT`].
   */
  limit?: number | null;
  /**
   * Fuzzy score floor (1..=100); defaults to
   * [`TM_LOOKUP_DEFAULT_MIN_SCORE`]. Exact matches always pass.
   */
  minScore?: number | null;
  projectId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface TmLookupResult {
  matches: TmMatchItem[];
  /**
   * Total candidates that met the floor before the limit was applied, so
   * clients can tell when a `limit` cut the list short.
   */
  totalMatches: number;
  [k: string]: unknown;
}
export interface TmMatchItem {
  entry: TmEntry1;
  grade: TmMatchGrade;
  /**
   * 0..=100.
   */
  score: number;
  [k: string]: unknown;
}
export interface TmEntry1 {
  confirmedAtMs: number;
  id: string;
  memoryId: string;
  originDocumentId: string;
  originProjectId: string;
  originSegmentId: string;
  sourceHash: string;
  sourceText: string;
  targetText: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract15 {
  params: TmPretranslateParams;
  result: TmPretranslateResult;
}
export interface TmPretranslateParams {
  documentId: string;
  /**
   * Score threshold (1..=100) a match must reach to be applied; defaults
   * to [`TM_PRETRANSLATE_DEFAULT_MIN_SCORE`].
   */
  minScore?: number | null;
  [k: string]: unknown;
}
export interface TmPretranslateResult {
  /**
   * Untranslated segments examined.
   */
  checked: number;
  exact: number;
  fuzzy: number;
  /**
   * Segments filled from the TM (exact + fuzzy).
   */
  pretranslated: number;
  /**
   * The segments that changed, at their new revisions.
   */
  segments: Segment[];
  [k: string]: unknown;
}
/**
 * Reserved notification frame: engine-initiated, no request id, never awaited.
 */
export interface RpcNotification {
  method: string;
  params?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
/**
 * Notification-name-keyed catalog for the reserved notification frames.
 */
export interface NotificationCatalog {
  "notify.ai.agent.step": AgentStepNotification;
  "notify.engine.ready": EngineReadyNotification;
}
/**
 * Payload for the reserved `notify.ai.agent.step` frame emitted while a run
 * is in flight. `runStatus` lets clients notice the terminal transition
 * without polling.
 */
export interface AgentStepNotification {
  documentId: string;
  runId: string;
  runStatus: AgentRunStatus;
  step: AgentStep;
  [k: string]: unknown;
}
/**
 * Payload for the reserved `notify.engine.ready` frame emitted on startup.
 */
export interface EngineReadyNotification {
  engineName: string;
  engineVersion: string;
  protocolVersion: number;
  [k: string]: unknown;
}
export interface RpcRequest {
  id: number;
  method: string;
  params?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface RpcResponse {
  error?: RpcError | null;
  id?: number | null;
  result?: unknown;
  [k: string]: unknown;
}
