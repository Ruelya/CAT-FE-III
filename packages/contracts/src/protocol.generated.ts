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
export type DegradationSeverity = "warning" | "error";
export type DocumentStatus = "active" | "failed" | "superseded";
export type ProjectLifecycle = "active" | "archived" | "trash";
export type QaSeverity = "error" | "warning" | "info";
export type QaIssueStatus = "open" | "resolved";
export type SegmentState = "untranslated" | "draft" | "confirmed";
export type TmMatchGrade = "exact" | "inContext";

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
  "ai.agent.cancel": MethodContract20;
  "ai.agent.start": MethodContract18;
  "ai.agent.status": MethodContract19;
  "ai.assist": MethodContract17;
  "ai.configure": MethodContract15;
  "ai.status": MethodContract16;
  "document.export": MethodContract8;
  "document.import": MethodContract6;
  "document.list": MethodContract7;
  "engine.initialize": MethodContract;
  "engine.shutdown": MethodContract2;
  "project.create": MethodContract3;
  "project.get": MethodContract5;
  "project.list": MethodContract4;
  "qa.list": MethodContract14;
  "qa.run": MethodContract13;
  "segment.confirm": MethodContract11;
  "segment.list": MethodContract9;
  "segment.update": MethodContract10;
  "tm.lookup": MethodContract12;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract20 {
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
export interface MethodContract18 {
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
export interface MethodContract19 {
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
export interface MethodContract17 {
  params: AiAssistParams;
  result: AiAssistResult;
}
export interface AiAssistParams {
  action: AiAssistAction;
  instruction?: string | null;
  segmentId: string;
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
export interface MethodContract15 {
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
export interface MethodContract16 {
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
  sourcePath: string;
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
export interface MethodContract14 {
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
export interface NumberEvidence {
  sourceNumbers: string[];
  targetNumbers: string[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract13 {
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
export interface MethodContract12 {
  params: TmLookupParams;
  result: TmLookupResult;
}
export interface TmLookupParams {
  projectId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface TmLookupResult {
  matches: TmMatchItem[];
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
