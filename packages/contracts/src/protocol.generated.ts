/* eslint-disable -- Generated from the Rust protocol schema. Do not edit. */

export type AssetExchangeFormat = "tmx" | "csv" | "tsv" | "tbx";
export type ConcordanceSide = "source" | "target" | "both";
export type SegmentState = "untranslated" | "draft" | "confirmed";
export type QaSeverity = "error" | "warning" | "info";
export type QaIssueStatus = "open" | "resolved";
export type HealthSeverity = "info" | "warning" | "error" | "fatal";
export type DegradationSeverity = "warning" | "error";
export type DocumentStatus = "active" | "failed" | "superseded";
export type AiBatchStatus =
  "queued" | "running" | "interrupted" | "canceling" | "canceled" | "succeeded" | "completedWithErrors" | "failed";
export type AiBatchItemStatus =
  "pending" | "tmApplied" | "running" | "succeeded" | "retrying" | "failed" | "skipped" | "canceled";
export type AiConversationRole = "user" | "assistant";
export type AiAction =
  "translate" | "improve" | "formal" | "conversational" | "shorten" | "expand" | "literal" | "freeform";
export type AiMessageRole = "system" | "user" | "assistant";
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
export type AiProviderProtocol =
  "openaiChatCompletions" | "anthropicMessages" | "geminiGenerateContent" | "deeplTranslate";
export type AiRunKind = "interactive" | "action" | "providerTest" | "batchItem";
export type AiRunStatus =
  "queued" | "running" | "retrying" | "interrupted" | "canceling" | "canceled" | "succeeded" | "failed";
export type TagKind = "start" | "end" | "standalone";
export type TagSide = "source" | "target";
export type EditorWorkflowState = "translation" | "review" | "signed";
export type AiRunEventKind =
  | "started"
  | "attempt"
  | "delta"
  | "usage"
  | "retry"
  | "completed"
  | "failed"
  | "canceling"
  | "canceled"
  | "interrupted";
export type AiUsageDimension = "day" | "month" | "project" | "provider" | "model";
export type PipelineRunStatus =
  "queued" | "running" | "canceling" | "canceled" | "interrupted" | "succeeded" | "failed";
export type PipelineStepStatus =
  "pending" | "running" | "canceled" | "interrupted" | "succeeded" | "failed" | "skipped";
export type ArtifactKind = "none" | "project" | "document" | "segments" | "qaFindings" | "json";
export type ProjectLifecycle = "active" | "archived" | "trash";
export type QaRunScope = "document" | "project";
export type QaRunStatus = "running" | "succeeded" | "failed";
export type QaCategory =
  | "completeness"
  | "numbers"
  | "tags"
  | "punctuation"
  | "whitespace"
  | "repetition"
  | "length"
  | "terminology"
  | "consistency"
  | "custom";
export type QaIssueDisposition = "open" | "waived" | "resolved";
export type QaOverrideStatus = "pending" | "succeeded" | "failed";
export type QaField = "source" | "target" | "both";
export type QaReportFormat = "html" | "xlsx";
export type ReviewStatus = "pending" | "accepted" | "rejected";
export type ChineseConversionProfile =
  | "simplifiedToTraditional"
  | "simplifiedToTaiwan"
  | "simplifiedToHongKong"
  | "traditionalToSimplified"
  | "taiwanToSimplified"
  | "hongKongToSimplified";
export type EditorSearchField = "source" | "target" | "both";
export type TermStatus = "candidate" | "active" | "deprecated";
export type AssetMountMode = "write" | "reference";
export type TmMatchKind = "context" | "exact" | "fuzzy";
export type ErrorCode =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "invalid_state"
  | "unsupported_document"
  | "storage_error"
  | "export_error"
  | "qa_gate_blocked"
  | "qa_profile_invalid"
  | "report_export_error"
  | "credential_unavailable"
  | "ai_disabled"
  | "budget_exceeded"
  | "provider_authentication"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_protocol"
  | "provider_unavailable"
  | "internal_error";

export interface ProtocolCatalog {
  asset_diagnostic: AssetDiagnostic;
  asset_exchange_format: AssetExchangeFormat;
  backup_result: BackupResult;
  concordance_params: ConcordanceParams;
  concordance_result: ConcordanceResult;
  confirm_segment_params: ConfirmSegmentParams;
  confirm_segment_result: ConfirmSegmentResult;
  create_backup_params: CreateBackupParams;
  create_pipeline_params: CreatePipelineParams;
  create_project_params: CreateProjectParams;
  data_health_report: DataHealthReport;
  document_id_params: DocumentIdParams;
  document_list_params: DocumentListParams;
  document_page: DocumentPage;
  empty_params: EmptyParams;
  exact_lookup_params: ExactLookupParams;
  exact_lookup_result: ExactLookupResult;
  export_document_params: ExportDocumentParams;
  export_document_result: ExportDocumentResult;
  export_docx_params: ExportDocxParams;
  export_docx_result: ExportDocxResult;
  filter_list_result: FilterListResult;
  history_list_params: HistoryListParams;
  import_document_params: ImportDocumentParams;
  import_document_result: ImportDocumentResult;
  import_docx_params: ImportDocxParams;
  initialize_params: InitializeParams;
  initialize_result: InitializeResult;
  list_qa_params: ListQaParams;
  methods: RpcMethodCatalog;
  operation_page: OperationPage;
  pipeline_capability_result: PipelineCapabilityResult;
  pipeline_definition_page: PipelineDefinitionPage;
  pipeline_id_params: PipelineIdParams;
  pipeline_list_params: PipelineListParams;
  pipeline_run_id_params: PipelineRunIdParams;
  pipeline_run_list_params: PipelineRunListParams;
  pipeline_run_page: PipelineRunPage;
  pipeline_run_revision_params: PipelineRunRevisionParams;
  pipeline_run_snapshot: PipelineRunSnapshot;
  pipeline_validation_result: PipelineValidationResult;
  project_id_params: ProjectIdParams;
  project_list_params: ProjectListParams;
  project_page: ProjectPage;
  project_snapshot: ProjectSnapshot;
  qa_gate_check_params: QaGateCheckParams;
  qa_issue_list_params: QaIssueListParams;
  qa_issue_page: QaIssuePage;
  qa_issue_revoke_params: QaIssueRevokeParams;
  qa_issue_waive_params: QaIssueWaiveParams;
  qa_list_result: QaListResult;
  qa_override_input: QaOverrideInput;
  qa_override_list_params: QaOverrideListParams;
  qa_override_page: QaOverridePage;
  qa_profile_clone_params: QaProfileCloneParams;
  qa_profile_create_params: QaProfileCreateParams;
  qa_profile_delete_params: QaProfileDeleteParams;
  qa_profile_list_params: QaProfileListParams;
  qa_profile_page: QaProfilePage;
  qa_profile_update_params: QaProfileUpdateParams;
  qa_report_export_params: QaReportExportParams;
  qa_run_id_params: QaRunIdParams;
  qa_run_list_params: QaRunListParams;
  qa_run_page: QaRunPage;
  qa_run_params: QaRunParams;
  review_queue_page: ReviewQueuePage;
  review_queue_params: ReviewQueueParams;
  review_statistics_params: ReviewStatisticsParams;
  rpc_error: RpcError;
  run_pipeline_params: RunPipelineParams;
  segment_list_params: SegmentListParams;
  segment_page: SegmentPage;
  set_project_lifecycle_params: SetProjectLifecycleParams;
  term_search_params: TermSearchParams;
  term_search_result: TermSearchResult;
  term_translation_input: TermTranslationInput;
  term_upsert_params: TermUpsertParams;
  termbase_create_params: TermbaseCreateParams;
  termbase_export_params: TermbaseExportParams;
  termbase_export_result: TermbaseExportResult;
  termbase_import_params: TermbaseImportParams;
  termbase_import_result: TermbaseImportResult;
  termbase_list_params: TermbaseListParams;
  termbase_mount_params: TermbaseMountParams;
  termbase_page: TermbasePage;
  termbase_unmount_params: TermbaseUnmountParams;
  tm_export_params: TmExportParams;
  tm_export_result: TmExportResult;
  tm_import_params: TmImportParams;
  tm_import_result: TmImportResult;
  tm_library_create_params: TmLibraryCreateParams;
  tm_library_list_params: TmLibraryListParams;
  tm_library_mount_params: TmLibraryMountParams;
  tm_library_page: TmLibraryPage;
  tm_library_unmount_params: TmLibraryUnmountParams;
  tm_search_params: TmSearchParams;
  tm_search_result: TmSearchResult;
  update_project_params: UpdateProjectParams;
  update_target_params: UpdateTargetParams;
  validate_pipeline_params: ValidatePipelineParams;
  [k: string]: unknown;
}
export interface AssetDiagnostic {
  message: string;
  row: number;
  [k: string]: unknown;
}
export interface BackupResult {
  destinationPath: string;
  manifest: BackupManifest;
  [k: string]: unknown;
}
export interface BackupManifest {
  createdAtMs: number;
  engineVersion: string;
  files: BackupFile[];
  formatVersion: number;
  schemaVersion: number;
  [k: string]: unknown;
}
export interface BackupFile {
  relativePath: string;
  sha256: string;
  size: number;
  [k: string]: unknown;
}
export interface ConcordanceParams {
  limit?: number;
  offset?: number;
  projectId: string;
  query: string;
  side?: "source" | "target" | "both";
  [k: string]: unknown;
}
export interface ConcordanceResult {
  hits: ConcordanceHit[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface ConcordanceHit {
  libraryId: string;
  matchedSide: ConcordanceSide;
  unit: TmUnit;
  [k: string]: unknown;
}
export interface TmUnit {
  author?: string | null;
  contextAfterHash?: string | null;
  contextBeforeHash?: string | null;
  createdAtMs: number;
  domain?: string | null;
  id: string;
  libraryId: string;
  metadata: {
    [k: string]: string;
  };
  originDocumentId?: string | null;
  originProjectId?: string | null;
  originSegmentId?: string | null;
  sourceHash: string;
  sourceLocale: string;
  sourceText: string;
  targetHash: string;
  targetLocale: string;
  targetText: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface ConfirmSegmentParams {
  expectedRevision: number;
  segmentId: string;
  [k: string]: unknown;
}
export interface ConfirmSegmentResult {
  counts: SegmentCounts;
  propagated?: Segment[];
  qaIssues: QaIssue[];
  segment: Segment;
  tmEntry: TmEntry;
  [k: string]: unknown;
}
export interface SegmentCounts {
  confirmed: number;
  draft: number;
  openIssues: number;
  total: number;
  untranslated: number;
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
export interface CreateBackupParams {
  destinationPath: string;
  [k: string]: unknown;
}
export interface CreatePipelineParams {
  name: string;
  projectId?: string | null;
  steps: PipelineStepDefinition[];
  [k: string]: unknown;
}
export interface PipelineStepDefinition {
  config?: {
    [k: string]: unknown;
  };
  key: string;
  stepId: string;
  [k: string]: unknown;
}
export interface CreateProjectParams {
  domain: string;
  name: string;
  sourceLocale: string;
  targetLocale: string;
  [k: string]: unknown;
}
export interface DataHealthReport {
  checkedAtMs: number;
  findings: HealthFinding[];
  healthy: boolean;
  schemaVersion: number;
  [k: string]: unknown;
}
export interface HealthFinding {
  code: string;
  entityId?: string | null;
  entityType?: string | null;
  message: string;
  path?: string | null;
  severity: HealthSeverity;
  [k: string]: unknown;
}
export interface DocumentIdParams {
  documentId: string;
  [k: string]: unknown;
}
export interface DocumentListParams {
  limit?: number;
  offset?: number;
  projectId: string;
  [k: string]: unknown;
}
export interface DocumentPage {
  items: Document[];
  limit: number;
  offset: number;
  total: number;
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
export interface DegradationFinding {
  code: string;
  message: string;
  severity: DegradationSeverity;
  structuralPath?: string | null;
  [k: string]: unknown;
}
export interface EmptyParams {}
export interface ExactLookupParams {
  projectId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface ExactLookupResult {
  matches: TmEntry[];
  [k: string]: unknown;
}
export interface ExportDocumentParams {
  documentId: string;
  outputPath: string;
  qaOverride?: QaOverrideInput | null;
  [k: string]: unknown;
}
export interface QaOverrideInput {
  actor: string;
  reason: string;
  [k: string]: unknown;
}
export interface ExportDocumentResult {
  degradation: DegradationFinding[];
  filterId: string;
  outputPath: string;
  translatedSegments: number;
  [k: string]: unknown;
}
export interface ExportDocxParams {
  documentId: string;
  outputPath: string;
  qaOverride?: QaOverrideInput | null;
  [k: string]: unknown;
}
export interface ExportDocxResult {
  outputPath: string;
  translatedSegments: number;
  [k: string]: unknown;
}
export interface FilterListResult {
  filters: FilterDescriptor[];
  [k: string]: unknown;
}
export interface FilterDescriptor {
  capabilities: FilterCapabilities;
  displayName: string;
  extensions: string[];
  id: string;
  version: string;
  [k: string]: unknown;
}
export interface FilterCapabilities {
  degradationReport: boolean;
  export: boolean;
  import: boolean;
  inlineTags: boolean;
  notes: boolean;
  validate: boolean;
  [k: string]: unknown;
}
export interface HistoryListParams {
  descending?: boolean;
  limit?: number;
  offset?: number;
  projectId: string;
  [k: string]: unknown;
}
export interface ImportDocumentParams {
  filterId?: string | null;
  options?: {
    [k: string]: string;
  };
  projectId: string;
  relativePath?: string | null;
  sourcePath: string;
  [k: string]: unknown;
}
export interface ImportDocumentResult {
  degradation: DegradationFinding[];
  document: Document;
  filterId: string;
  [k: string]: unknown;
}
export interface ImportDocxParams {
  projectId: string;
  sourcePath: string;
  [k: string]: unknown;
}
export interface InitializeParams {
  client: ClientInfo;
  protocolVersion: number;
  [k: string]: unknown;
}
export interface ClientInfo {
  name: string;
  version: string;
  [k: string]: unknown;
}
export interface InitializeResult {
  capabilities: string[];
  engineVersion: string;
  protocolVersion: number;
  [k: string]: unknown;
}
export interface ListQaParams {
  documentId: string;
  includeResolved?: boolean;
  [k: string]: unknown;
}
export interface RpcMethodCatalog {
  "ai.batch.cancel": MethodContract114;
  "ai.batch.get": MethodContract111;
  "ai.batch.items": MethodContract113;
  "ai.batch.list": MethodContract112;
  "ai.batch.resume": MethodContract114;
  "ai.batch.start": MethodContract110;
  "ai.conversation.create": MethodContract117;
  "ai.conversation.list": MethodContract116;
  "ai.conversation.messages": MethodContract119;
  "ai.conversation.update": MethodContract118;
  "ai.credential.delete": MethodContract100;
  "ai.credential.status": MethodContract100;
  "ai.grounding.preview": MethodContract103;
  "ai.provider.catalog": MethodContract94;
  "ai.provider.create": MethodContract96;
  "ai.provider.delete": MethodContract98;
  "ai.provider.list": MethodContract95;
  "ai.provider.test": MethodContract99;
  "ai.provider.update": MethodContract97;
  "ai.result.apply": MethodContract109;
  "ai.run.cancel": MethodContract108;
  "ai.run.events": MethodContract107;
  "ai.run.get": MethodContract105;
  "ai.run.list": MethodContract106;
  "ai.run.resume": MethodContract108;
  "ai.run.start": MethodContract104;
  "ai.settings.get": MethodContract101;
  "ai.settings.update": MethodContract102;
  "ai.usage.query": MethodContract115;
  "data.checkHealth": MethodContract83;
  "data.createBackup": MethodContract84;
  "dictionary.add": MethodContract32;
  "dictionary.list": MethodContract31;
  "dictionary.remove": MethodContract32;
  "document.export": MethodContract80;
  "document.exportDocx": MethodContract79;
  "document.get": MethodContract8;
  "document.import": MethodContract9;
  "document.importDocx": MethodContract10;
  "document.list": MethodContract7;
  "editor.history": MethodContract34;
  "editor.preferences.get": MethodContract41;
  "editor.preferences.update": MethodContract42;
  "editor.redo": MethodContract33;
  "editor.undo": MethodContract33;
  "engine.initialize": MethodContract;
  "filter.list": MethodContract81;
  "history.list": MethodContract82;
  "pdf.correctOcr": MethodContract45;
  "pdf.page.get": MethodContract44;
  "pdf.page.list": MethodContract43;
  "pipeline.create": MethodContract86;
  "pipeline.get": MethodContract88;
  "pipeline.list": MethodContract87;
  "pipeline.run": MethodContract90;
  "pipeline.run.cancel": MethodContract93;
  "pipeline.run.get": MethodContract92;
  "pipeline.run.list": MethodContract91;
  "pipeline.run.resume": MethodContract93;
  "pipeline.step.list": MethodContract85;
  "pipeline.validate": MethodContract89;
  "project.create": MethodContract2;
  "project.get": MethodContract3;
  "project.list": MethodContract4;
  "project.setLifecycle": MethodContract6;
  "project.update": MethodContract5;
  "qa.gate.check": MethodContract77;
  "qa.issue.list": MethodContract73;
  "qa.issue.revoke": MethodContract75;
  "qa.issue.waive": MethodContract74;
  "qa.list": MethodContract64;
  "qa.override.list": MethodContract78;
  "qa.profile.clone": MethodContract67;
  "qa.profile.create": MethodContract66;
  "qa.profile.delete": MethodContract69;
  "qa.profile.list": MethodContract65;
  "qa.profile.update": MethodContract68;
  "qa.report.export": MethodContract76;
  "qa.run": MethodContract70;
  "qa.run.get": MethodContract72;
  "qa.run.list": MethodContract71;
  "qa.runDocument": MethodContract63;
  "review.accept": MethodContract37;
  "review.create": MethodContract35;
  "review.list": MethodContract36;
  "review.queue": MethodContract39;
  "review.reject": MethodContract38;
  "review.stats": MethodContract40;
  "segment.chinese.convert": MethodContract16;
  "segment.comment.create": MethodContract26;
  "segment.comment.delete": MethodContract29;
  "segment.comment.list": MethodContract25;
  "segment.comment.resolve": MethodContract28;
  "segment.comment.update": MethodContract27;
  "segment.confirm": MethodContract13;
  "segment.correctSource": MethodContract23;
  "segment.editor.list": MethodContract14;
  "segment.find": MethodContract18;
  "segment.list": MethodContract11;
  "segment.merge": MethodContract22;
  "segment.propagate": MethodContract17;
  "segment.replace.apply": MethodContract20;
  "segment.replace.preview": MethodContract19;
  "segment.spell.check": MethodContract30;
  "segment.split": MethodContract21;
  "segment.tag.set": MethodContract15;
  "segment.updateTarget": MethodContract12;
  "segment.workflow.set": MethodContract24;
  "term.search": MethodContract59;
  "term.upsert": MethodContract60;
  "termbase.create": MethodContract56;
  "termbase.export": MethodContract62;
  "termbase.import": MethodContract61;
  "termbase.list": MethodContract55;
  "termbase.mount": MethodContract57;
  "termbase.unmount": MethodContract58;
  "tm.concordance": MethodContract52;
  "tm.export": MethodContract54;
  "tm.import": MethodContract53;
  "tm.library.create": MethodContract48;
  "tm.library.list": MethodContract47;
  "tm.library.mount": MethodContract49;
  "tm.library.unmount": MethodContract50;
  "tm.lookupExact": MethodContract46;
  "tm.search": MethodContract51;
}
export interface MethodContract114 {
  params: AiBatchRevisionParams;
  result: AiBatchRun;
  [k: string]: unknown;
}
export interface AiBatchRevisionParams {
  batchId: string;
  expectedRevision: number;
}
export interface AiBatchRun {
  cancellationRequested: boolean;
  completed: number;
  completedAtMs?: number | null;
  concurrency: number;
  createdAtMs: number;
  documentId?: string | null;
  failed: number;
  groundingOptions: GroundingOptions;
  id: string;
  maxAttempts: number;
  profileId: string;
  projectId: string;
  replaceDrafts: boolean;
  requestsPerMinute: number;
  revision: number;
  skipped: number;
  startedAtMs?: number | null;
  status: AiBatchStatus;
  succeeded: number;
  tmApplied: number;
  tmThreshold: number;
  total: number;
  updatedAtMs: number;
  usage: AiUsage;
  [k: string]: unknown;
}
export interface GroundingOptions {
  contextAfter: number;
  contextBefore: number;
  includeContext: boolean;
  includeStyle: boolean;
  includeTerms: boolean;
  includeTm: boolean;
  maxChars: number;
  styleInstruction: string;
  systemInstruction: string;
  tmTopN: number;
  [k: string]: unknown;
}
export interface AiUsage {
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  [k: string]: unknown;
}
export interface MethodContract111 {
  params: AiBatchIdParams;
  result: AiBatchRun;
  [k: string]: unknown;
}
export interface AiBatchIdParams {
  batchId: string;
}
export interface MethodContract113 {
  params: AiBatchItemsParams;
  result: AiBatchItemPage;
  [k: string]: unknown;
}
export interface AiBatchItemsParams {
  batchId: string;
  limit?: number;
  offset?: number;
}
export interface AiBatchItemPage {
  items: AiBatchItem[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface AiBatchItem {
  attempts: number;
  batchId: string;
  errorCode?: string | null;
  expectedRevision: number;
  ordinal: number;
  runId?: string | null;
  segmentId: string;
  source?: string | null;
  status: AiBatchItemStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface MethodContract112 {
  params: AiBatchListParams;
  result: AiBatchPage;
  [k: string]: unknown;
}
export interface AiBatchListParams {
  limit?: number;
  offset?: number;
  projectId: string;
}
export interface AiBatchPage {
  items: AiBatchRun[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract110 {
  params: AiBatchStartParams;
  result: AiBatchRun;
  [k: string]: unknown;
}
export interface AiBatchStartParams {
  concurrency?: number;
  documentId?: string | null;
  maxAttempts?: number;
  options?: GroundingOptions1;
  profileId: string;
  projectId: string;
  replaceDrafts?: boolean;
  requestsPerMinute?: number;
  tmThreshold?: number;
}
export interface GroundingOptions1 {
  contextAfter: number;
  contextBefore: number;
  includeContext: boolean;
  includeStyle: boolean;
  includeTerms: boolean;
  includeTm: boolean;
  maxChars: number;
  styleInstruction: string;
  systemInstruction: string;
  tmTopN: number;
  [k: string]: unknown;
}
export interface MethodContract117 {
  params: AiConversationCreateParams;
  result: AiConversation;
  [k: string]: unknown;
}
export interface AiConversationCreateParams {
  projectId: string;
  title: string;
}
export interface AiConversation {
  archived: boolean;
  createdAtMs: number;
  id: string;
  projectId: string;
  revision: number;
  title: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface MethodContract116 {
  params: AiConversationListParams;
  result: AiConversationPage;
  [k: string]: unknown;
}
export interface AiConversationListParams {
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
  projectId: string;
}
export interface AiConversationPage {
  items: AiConversation[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract119 {
  params: AiConversationMessagesParams;
  result: AiConversationMessagePage;
  [k: string]: unknown;
}
export interface AiConversationMessagesParams {
  conversationId: string;
  limit?: number;
  offset?: number;
}
export interface AiConversationMessagePage {
  items: AiConversationMessage[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface AiConversationMessage {
  conversationId: string;
  createdAtMs: number;
  id: string;
  role: AiConversationRole;
  runId?: string | null;
  segmentId?: string | null;
  targetProposal?: string | null;
  text: string;
  [k: string]: unknown;
}
export interface MethodContract118 {
  params: AiConversationUpdateParams;
  result: AiConversation;
  [k: string]: unknown;
}
export interface AiConversationUpdateParams {
  archived: boolean;
  conversationId: string;
  expectedRevision: number;
  title: string;
}
export interface MethodContract100 {
  params: AiProfileIdParams;
  result: AiCredentialStatus;
  [k: string]: unknown;
}
export interface AiProfileIdParams {
  profileId: string;
}
export interface AiCredentialStatus {
  available: boolean;
  backend: string;
  present: boolean;
  [k: string]: unknown;
}
export interface MethodContract103 {
  params: AiGroundingPreviewParams;
  result: AiGroundingPreviewResult;
  [k: string]: unknown;
}
export interface AiGroundingPreviewParams {
  action: AiAction;
  expectedRevision: number;
  options?: GroundingOptions2;
  projectId: string;
  prompt?: string;
  segmentId: string;
}
export interface GroundingOptions2 {
  contextAfter: number;
  contextBefore: number;
  includeContext: boolean;
  includeStyle: boolean;
  includeTerms: boolean;
  includeTm: boolean;
  maxChars: number;
  styleInstruction: string;
  systemInstruction: string;
  tmTopN: number;
  [k: string]: unknown;
}
export interface AiGroundingPreviewResult {
  bundle: PromptBundle;
  segmentId: string;
  segmentRevision: number;
  [k: string]: unknown;
}
export interface PromptBundle {
  messages: AiMessage[];
  promptHash: string;
  sections: GroundingSection[];
  totalChars: number;
  truncated: boolean;
  [k: string]: unknown;
}
export interface AiMessage {
  role: AiMessageRole;
  text: string;
  [k: string]: unknown;
}
export interface GroundingSection {
  id: string;
  itemCount: number;
  label: string;
  text: string;
  truncated: boolean;
  [k: string]: unknown;
}
export interface MethodContract94 {
  params: AiProviderCatalogParams;
  result: AiProviderCatalogResult;
  [k: string]: unknown;
}
export interface AiProviderCatalogParams {}
export interface AiProviderCatalogResult {
  items: AiProviderDescriptor[];
  [k: string]: unknown;
}
export interface AiProviderDescriptor {
  credentialHint: string;
  defaultBaseUrl: string;
  defaultModel: string;
  displayName: string;
  kind: AiProviderKind;
  protocol: AiProviderProtocol;
  reportsUsage: boolean;
  supportsStreaming: boolean;
  [k: string]: unknown;
}
export interface MethodContract96 {
  params: AiProviderCreateParams;
  result: AiProviderProfile;
  [k: string]: unknown;
}
export interface AiProviderCreateParams {
  baseUrl: string;
  enabled?: boolean;
  kind: AiProviderKind;
  maxResponseBytes?: number;
  model: string;
  name: string;
  timeoutMs?: number;
}
export interface AiProviderProfile {
  baseUrl: string;
  createdAtMs: number;
  credentialPresent: boolean;
  enabled: boolean;
  id: string;
  kind: AiProviderKind;
  maxResponseBytes: number;
  model: string;
  name: string;
  revision: number;
  timeoutMs: number;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface MethodContract98 {
  params: AiProfileRevisionParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface AiProfileRevisionParams {
  expectedRevision: number;
  profileId: string;
}
export interface EmptyResult {
  [k: string]: unknown;
}
export interface MethodContract95 {
  params: AiProviderListParams;
  result: AiProviderPage;
  [k: string]: unknown;
}
export interface AiProviderListParams {
  limit?: number;
  offset?: number;
}
export interface AiProviderPage {
  items: AiProviderProfile[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract99 {
  params: AiProfileIdParams;
  result: AiProviderTestResult;
  [k: string]: unknown;
}
export interface AiProviderTestResult {
  run: AiRun;
  [k: string]: unknown;
}
export interface AiRun {
  action: string;
  attempt: number;
  baseSegmentRevision?: number | null;
  cancellationRequested: boolean;
  completedAtMs?: number | null;
  createdAtMs: number;
  documentId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorRetryable: boolean;
  id: string;
  kind: AiRunKind;
  maxAttempts: number;
  model: string;
  profileId?: string | null;
  projectId?: string | null;
  promptHash: string;
  proposalText?: string | null;
  request: AiRunRequest;
  revision: number;
  segmentId?: string | null;
  startedAtMs?: number | null;
  status: AiRunStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface AiRunRequest {
  conversationId?: string | null;
  freeformPrompt: string;
  groundingOptions: GroundingOptions;
  [k: string]: unknown;
}
export interface MethodContract97 {
  params: AiProviderUpdateParams;
  result: AiProviderProfile;
  [k: string]: unknown;
}
export interface AiProviderUpdateParams {
  baseUrl: string;
  enabled: boolean;
  expectedRevision: number;
  kind: AiProviderKind;
  maxResponseBytes: number;
  model: string;
  name: string;
  profileId: string;
  timeoutMs: number;
}
export interface MethodContract109 {
  params: AiResultApplyParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface AiResultApplyParams {
  expectedRunRevision: number;
  expectedSegmentRevision: number;
  runId: string;
}
export interface EditorMutationResult {
  counts: SegmentCounts;
  focusSegmentId?: string | null;
  operationId?: string | null;
  rows: SegmentEditorRow[];
  [k: string]: unknown;
}
export interface SegmentEditorRow {
  comments: EditorComment[];
  contextAfter?: Segment | null;
  contextBefore?: Segment | null;
  segment: Segment;
  sourceTags: InlineTag[];
  spellFindings: SpellFinding[];
  tagIssues: EditorTagIssue[];
  targetTags: InlineTag[];
  workflowState: EditorWorkflowState;
  [k: string]: unknown;
}
export interface EditorComment {
  author: string;
  createdAtMs: number;
  id: string;
  immutable: boolean;
  resolved: boolean;
  revision: number;
  segmentId: string;
  text: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface InlineTag {
  displayText: string;
  id: string;
  kind: TagKind;
  pairId?: string | null;
  payload: string;
  position: number;
  protected: boolean;
  side: TagSide;
  [k: string]: unknown;
}
export interface SpellFinding {
  end: number;
  provider: string;
  start: number;
  suggestions: string[];
  word: string;
  [k: string]: unknown;
}
export interface EditorTagIssue {
  code: string;
  message: string;
  position?: number | null;
  tagId?: string | null;
  [k: string]: unknown;
}
export interface MethodContract108 {
  params: AiRunRevisionParams;
  result: AiRun;
  [k: string]: unknown;
}
export interface AiRunRevisionParams {
  expectedRevision: number;
  runId: string;
}
export interface MethodContract107 {
  params: AiRunEventsParams;
  result: AiRunEventPage;
  [k: string]: unknown;
}
export interface AiRunEventsParams {
  afterSequence?: number;
  limit?: number;
  runId: string;
}
export interface AiRunEventPage {
  afterSequence: number;
  items: AiRunEvent[];
  lastSequence: number;
  [k: string]: unknown;
}
export interface AiRunEvent {
  attempt?: number | null;
  createdAtMs: number;
  deltaText?: string | null;
  kind: AiRunEventKind;
  message?: string | null;
  retryAfterMs?: number | null;
  runId: string;
  sequence: number;
  usage?: AiUsage | null;
  [k: string]: unknown;
}
export interface MethodContract105 {
  params: AiRunIdParams;
  result: AiRun;
  [k: string]: unknown;
}
export interface AiRunIdParams {
  runId: string;
}
export interface MethodContract106 {
  params: AiRunListParams;
  result: AiRunPage;
  [k: string]: unknown;
}
export interface AiRunListParams {
  limit?: number;
  offset?: number;
  projectId?: string | null;
}
export interface AiRunPage {
  items: AiRun[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract104 {
  params: AiRunStartParams;
  result: AiRun;
  [k: string]: unknown;
}
export interface AiRunStartParams {
  action: AiAction;
  conversationId?: string | null;
  expectedRevision: number;
  maxAttempts?: number;
  options?: GroundingOptions3;
  profileId: string;
  projectId: string;
  prompt?: string;
  segmentId: string;
}
export interface GroundingOptions3 {
  contextAfter: number;
  contextBefore: number;
  includeContext: boolean;
  includeStyle: boolean;
  includeTerms: boolean;
  includeTm: boolean;
  maxChars: number;
  styleInstruction: string;
  systemInstruction: string;
  tmTopN: number;
  [k: string]: unknown;
}
export interface MethodContract101 {
  params: AiSettingsGetParams;
  result: AiSettings;
  [k: string]: unknown;
}
export interface AiSettingsGetParams {}
export interface AiSettings {
  allowBatch: boolean;
  allowInteractive: boolean;
  allowedOrigins: string[];
  defaultProfileId?: string | null;
  enabled: boolean;
  monthlyTokenBudget?: number | null;
  revision: number;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface MethodContract102 {
  params: AiSettingsUpdateParams;
  result: AiSettings;
  [k: string]: unknown;
}
export interface AiSettingsUpdateParams {
  allowBatch: boolean;
  allowInteractive: boolean;
  allowedOrigins?: string[];
  defaultProfileId?: string | null;
  enabled: boolean;
  expectedRevision: number;
  monthlyTokenBudget?: number | null;
}
export interface MethodContract115 {
  params: AiUsageQueryParams;
  result: AiUsageQueryResult;
  [k: string]: unknown;
}
export interface AiUsageQueryParams {
  dimension: AiUsageDimension;
  limit?: number;
  offset?: number;
  projectId?: string | null;
  sinceMs: number;
  untilMs: number;
}
export interface AiUsageQueryResult {
  aggregates: AiUsageAggregate[];
  limit: number;
  offset: number;
  records: AiUsageRecord[];
  total: number;
  [k: string]: unknown;
}
export interface AiUsageAggregate {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
  inputTokens: number;
  key: string;
  outputTokens: number;
  reasoningTokens: number;
  requestCount: number;
  [k: string]: unknown;
}
export interface AiUsageRecord {
  attempt: number;
  createdAtMs: number;
  documentId?: string | null;
  elapsedMs: number;
  id: string;
  model: string;
  profileId?: string | null;
  projectId?: string | null;
  provider: AiProviderKind;
  runId: string;
  status: string;
  usage: AiUsage;
  [k: string]: unknown;
}
export interface MethodContract83 {
  params: EmptyParams;
  result: DataHealthReport;
  [k: string]: unknown;
}
export interface MethodContract84 {
  params: CreateBackupParams;
  result: BackupResult;
  [k: string]: unknown;
}
export interface MethodContract32 {
  params: DictionaryWordParams;
  result: DictionaryListResult;
  [k: string]: unknown;
}
export interface DictionaryWordParams {
  locale: string;
  word: string;
  [k: string]: unknown;
}
export interface DictionaryListResult {
  locale: string;
  words: string[];
  [k: string]: unknown;
}
export interface MethodContract31 {
  params: DictionaryListParams;
  result: DictionaryListResult;
  [k: string]: unknown;
}
export interface DictionaryListParams {
  locale: string;
  [k: string]: unknown;
}
export interface MethodContract80 {
  params: ExportDocumentParams;
  result: ExportDocumentResult;
  [k: string]: unknown;
}
export interface MethodContract79 {
  params: ExportDocxParams;
  result: ExportDocxResult;
  [k: string]: unknown;
}
export interface MethodContract8 {
  params: DocumentIdParams;
  result: Document;
  [k: string]: unknown;
}
export interface MethodContract9 {
  params: ImportDocumentParams;
  result: ImportDocumentResult;
  [k: string]: unknown;
}
export interface MethodContract10 {
  params: ImportDocxParams;
  result: Document;
  [k: string]: unknown;
}
export interface MethodContract7 {
  params: DocumentListParams;
  result: DocumentPage;
  [k: string]: unknown;
}
export interface MethodContract34 {
  params: EditorHistoryParams;
  result: EditorHistoryResult;
  [k: string]: unknown;
}
export interface EditorHistoryParams {
  limit?: number;
  offset?: number;
  projectId: string;
  [k: string]: unknown;
}
export interface EditorHistoryResult {
  canRedo: boolean;
  canUndo: boolean;
  operations: Operation[];
  total: number;
  [k: string]: unknown;
}
export interface Operation {
  actor: string;
  after?: {
    [k: string]: unknown;
  };
  baseRevision?: number | null;
  before?: {
    [k: string]: unknown;
  };
  correlationId?: string | null;
  createdAtMs: number;
  entityId: string;
  entityType: string;
  id: string;
  kind: string;
  projectId: string;
  resultRevision?: number | null;
  sequence: number;
  [k: string]: unknown;
}
export interface MethodContract41 {
  params: EmptyParams;
  result: EditorPreferences;
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
export interface MethodContract42 {
  params: UpdateEditorPreferencesParams;
  result: EditorPreferences;
  [k: string]: unknown;
}
export interface UpdateEditorPreferencesParams {
  preferences: EditorPreferences;
  [k: string]: unknown;
}
export interface MethodContract33 {
  params: EditorUndoRedoParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface EditorUndoRedoParams {
  projectId: string;
  [k: string]: unknown;
}
export interface MethodContract {
  params: InitializeParams;
  result: InitializeResult;
  [k: string]: unknown;
}
export interface MethodContract81 {
  params: EmptyParams;
  result: FilterListResult;
  [k: string]: unknown;
}
export interface MethodContract82 {
  params: HistoryListParams;
  result: OperationPage;
  [k: string]: unknown;
}
export interface OperationPage {
  items: Operation[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract45 {
  params: CorrectOcrParams;
  result: Segment;
  [k: string]: unknown;
}
export interface CorrectOcrParams {
  expectedRevision: number;
  reason: string;
  segmentId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface MethodContract44 {
  params: PdfPageGetParams;
  result: PdfPageDetail;
  [k: string]: unknown;
}
export interface PdfPageGetParams {
  documentId: string;
  dpi?: number;
  page: number;
  [k: string]: unknown;
}
export interface PdfPageDetail {
  blocks: PdfPageBlock[];
  dpi: number;
  height: number;
  imagePngBase64: string;
  page: number;
  width: number;
  [k: string]: unknown;
}
export interface PdfPageBlock {
  bbox: PdfBoundingBox;
  confidence: number;
  kind: string;
  revision: number;
  segmentId: string;
  sourceKind: string;
  sourceText: string;
  state: SegmentState;
  targetText: string;
  [k: string]: unknown;
}
export interface PdfBoundingBox {
  height: number;
  width: number;
  x: number;
  y: number;
  [k: string]: unknown;
}
export interface MethodContract43 {
  params: PdfPageListParams;
  result: PdfPageListResult;
  [k: string]: unknown;
}
export interface PdfPageListParams {
  documentId: string;
  [k: string]: unknown;
}
export interface PdfPageListResult {
  pages: PdfPageSummary[];
  [k: string]: unknown;
}
export interface PdfPageSummary {
  blockCount: number;
  height: number;
  ocrBlockCount: number;
  page: number;
  segmentIds: string[];
  width: number;
  [k: string]: unknown;
}
export interface MethodContract86 {
  params: CreatePipelineParams;
  result: PipelineDefinition;
  [k: string]: unknown;
}
export interface PipelineDefinition {
  createdAtMs: number;
  id: string;
  name: string;
  projectId?: string | null;
  revision: number;
  steps: PipelineStepDefinition[];
  updatedAtMs: number;
  version: number;
  [k: string]: unknown;
}
export interface MethodContract88 {
  params: PipelineIdParams;
  result: PipelineDefinition;
  [k: string]: unknown;
}
export interface PipelineIdParams {
  pipelineId: string;
  [k: string]: unknown;
}
export interface MethodContract87 {
  params: PipelineListParams;
  result: PipelineDefinitionPage;
  [k: string]: unknown;
}
export interface PipelineListParams {
  limit?: number;
  offset?: number;
  projectId?: string | null;
  [k: string]: unknown;
}
export interface PipelineDefinitionPage {
  items: PipelineDefinition[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract90 {
  params: RunPipelineParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface RunPipelineParams {
  definitionId: string;
  documentId?: string | null;
  input?: {
    [k: string]: unknown;
  };
  projectId: string;
  [k: string]: unknown;
}
export interface PipelineRunSnapshot {
  run: PipelineRun;
  steps: PipelineStepRun[];
  [k: string]: unknown;
}
export interface PipelineRun {
  cancellationRequested: boolean;
  completedAtMs?: number | null;
  createdAtMs: number;
  currentStepIndex: number;
  definitionId: string;
  documentId?: string | null;
  error?: PipelineFailure | null;
  id: string;
  input?: {
    [k: string]: unknown;
  };
  output?: {
    [k: string]: unknown;
  };
  projectId: string;
  revision: number;
  startedAtMs?: number | null;
  status: PipelineRunStatus;
  stepCount: number;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface PipelineFailure {
  code: string;
  message: string;
  retryable: boolean;
  [k: string]: unknown;
}
export interface PipelineStepRun {
  checkpoint?: {
    [k: string]: unknown;
  };
  completedAtMs?: number | null;
  error?: PipelineFailure | null;
  id: string;
  input?: {
    [k: string]: unknown;
  };
  output?: {
    [k: string]: unknown;
  };
  revision: number;
  runId: string;
  startedAtMs?: number | null;
  status: PipelineStepStatus;
  stepId: string;
  stepIndex: number;
  stepKey: string;
  updatedAtMs: number;
  usage?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface MethodContract93 {
  params: PipelineRunRevisionParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface PipelineRunRevisionParams {
  expectedRevision: number;
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract92 {
  params: PipelineRunIdParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface PipelineRunIdParams {
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract91 {
  params: PipelineRunListParams;
  result: PipelineRunPage;
  [k: string]: unknown;
}
export interface PipelineRunListParams {
  limit?: number;
  offset?: number;
  projectId: string;
  [k: string]: unknown;
}
export interface PipelineRunPage {
  items: PipelineRun[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract85 {
  params: EmptyParams;
  result: PipelineCapabilityResult;
  [k: string]: unknown;
}
export interface PipelineCapabilityResult {
  statusValues: PipelineRunStatus[];
  steps: StepDescriptor[];
  [k: string]: unknown;
}
export interface StepDescriptor {
  cancellable: boolean;
  configSchemaVersion: number;
  displayName: string;
  id: string;
  input: ArtifactKind;
  output: ArtifactKind;
  resumable: boolean;
  version: string;
  [k: string]: unknown;
}
export interface MethodContract89 {
  params: ValidatePipelineParams;
  result: PipelineValidationResult;
  [k: string]: unknown;
}
export interface ValidatePipelineParams {
  name: string;
  steps: PipelineStepDefinition[];
  [k: string]: unknown;
}
export interface PipelineValidationResult {
  errors: string[];
  valid: boolean;
  [k: string]: unknown;
}
export interface MethodContract2 {
  params: CreateProjectParams;
  result: Project;
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
  engineAllowlist?: string[];
  pipelineId?: string | null;
  qaProfileId?: string | null;
  reviewRequired?: boolean;
  templateId?: string | null;
  [k: string]: unknown;
}
export interface MethodContract3 {
  params: ProjectIdParams;
  result: ProjectSnapshot;
  [k: string]: unknown;
}
export interface ProjectIdParams {
  projectId: string;
  [k: string]: unknown;
}
export interface ProjectSnapshot {
  counts: SegmentCounts;
  documents: Document[];
  project: Project;
  [k: string]: unknown;
}
export interface MethodContract4 {
  params: ProjectListParams;
  result: ProjectPage;
  [k: string]: unknown;
}
export interface ProjectListParams {
  lifecycle?: ProjectLifecycle | null;
  limit?: number;
  offset?: number;
  [k: string]: unknown;
}
export interface ProjectPage {
  items: Project[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract6 {
  params: SetProjectLifecycleParams;
  result: Project;
  [k: string]: unknown;
}
export interface SetProjectLifecycleParams {
  actor?: string;
  correlationId?: string | null;
  expectedRevision: number;
  lifecycle: ProjectLifecycle;
  projectId: string;
  [k: string]: unknown;
}
export interface MethodContract5 {
  params: UpdateProjectParams;
  result: Project;
  [k: string]: unknown;
}
export interface UpdateProjectParams {
  actor?: string;
  configuration?: ProjectConfiguration1;
  correlationId?: string | null;
  domain: string;
  expectedRevision: number;
  name: string;
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  [k: string]: unknown;
}
export interface ProjectConfiguration1 {
  engineAllowlist?: string[];
  pipelineId?: string | null;
  qaProfileId?: string | null;
  reviewRequired?: boolean;
  templateId?: string | null;
  [k: string]: unknown;
}
export interface MethodContract77 {
  params: QaGateCheckParams;
  result: QaGateResult;
  [k: string]: unknown;
}
export interface QaGateCheckParams {
  documentId: string;
  profileId?: string | null;
  projectId: string;
  [k: string]: unknown;
}
export interface QaGateResult {
  blockerIssueIds: string[];
  clear: boolean;
  documentId: string;
  errorCount: number;
  infoCount: number;
  run: QaRun;
  waivedCount: number;
  warningCount: number;
  [k: string]: unknown;
}
export interface QaRun {
  checkedSegments: number;
  completedAtMs?: number | null;
  createdAtMs: number;
  documentId?: string | null;
  errors: number;
  id: string;
  info: number;
  profileId: string;
  profileName: string;
  profileRevision: number;
  profileSnapshotHash: string;
  projectId: string;
  scope: QaRunScope;
  status: QaRunStatus;
  waived: number;
  warnings: number;
  [k: string]: unknown;
}
export interface MethodContract73 {
  params: QaIssueListParams;
  result: QaIssuePage;
  [k: string]: unknown;
}
export interface QaIssueListParams {
  category?: QaCategory | null;
  disposition?: QaIssueDisposition | null;
  documentId?: string | null;
  limit?: number;
  offset?: number;
  projectId: string;
  ruleId?: string | null;
  segmentId?: string | null;
  severity?: QaSeverity | null;
  [k: string]: unknown;
}
export interface QaIssuePage {
  items: QaIssueView[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface QaIssueView {
  category: QaCategory;
  createdAtMs: number;
  disposition: QaIssueDisposition;
  documentId: string;
  documentName: string;
  evidence: QaCandidateEvidence;
  fingerprint: string;
  id: string;
  message: string;
  profileId?: string | null;
  projectId: string;
  ruleId: string;
  runId?: string | null;
  segmentId: string;
  segmentOrdinal: number;
  severity: QaSeverity;
  updatedAtMs: number;
  waiver?: QaWaiver | null;
  [k: string]: unknown;
}
export interface QaCandidateEvidence {
  relatedSegmentIds?: string[];
  sourceNumbers?: string[];
  sourceSpans?: QaSpan[];
  sourceValues?: string[];
  targetNumbers?: string[];
  targetSpans?: QaSpan[];
  targetValues?: string[];
  [k: string]: unknown;
}
export interface QaSpan {
  end: number;
  start: number;
  [k: string]: unknown;
}
export interface QaWaiver {
  actor: string;
  createdAtMs: number;
  fingerprint: string;
  id: string;
  issueId: string;
  reason: string;
  revision: number;
  revokedAtMs?: number | null;
  [k: string]: unknown;
}
export interface MethodContract75 {
  params: QaIssueRevokeParams;
  result: QaIssueView;
  [k: string]: unknown;
}
export interface QaIssueRevokeParams {
  expectedRevision: number;
  issueId: string;
  [k: string]: unknown;
}
export interface MethodContract74 {
  params: QaIssueWaiveParams;
  result: QaIssueView;
  [k: string]: unknown;
}
export interface QaIssueWaiveParams {
  actor: string;
  issueId: string;
  reason: string;
  [k: string]: unknown;
}
export interface MethodContract64 {
  params: ListQaParams;
  result: QaListResult;
  [k: string]: unknown;
}
export interface QaListResult {
  issues: QaIssue[];
  [k: string]: unknown;
}
export interface MethodContract78 {
  params: QaOverrideListParams;
  result: QaOverridePage;
  [k: string]: unknown;
}
export interface QaOverrideListParams {
  documentId?: string | null;
  limit?: number;
  offset?: number;
  projectId: string;
  [k: string]: unknown;
}
export interface QaOverridePage {
  items: QaExportOverride[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface QaExportOverride {
  actor: string;
  createdAtMs: number;
  destinationName: string;
  documentId: string;
  errorCount: number;
  id: string;
  projectId: string;
  reason: string;
  runId: string;
  status: QaOverrideStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface MethodContract67 {
  params: QaProfileCloneParams;
  result: QaProfile;
  [k: string]: unknown;
}
export interface QaProfileCloneParams {
  name: string;
  ownerProjectId?: string | null;
  profileId: string;
  [k: string]: unknown;
}
export interface QaProfile {
  builtIn: boolean;
  createdAtMs: number;
  definition: QaProfileDefinition;
  id: string;
  name: string;
  ownerProjectId?: string | null;
  revision: number;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface QaProfileDefinition {
  enabledRuleIds: string[];
  id: string;
  name: string;
  regexRules?: QaRegexRule[];
  settings: QaRuleSettings;
  severityOverrides?: {
    [k: string]: QaSeverity;
  };
  [k: string]: unknown;
}
export interface QaRegexRule {
  field: QaField;
  id: string;
  label: string;
  message: string;
  pattern: string;
  replacementHint?: string | null;
  severity: QaSeverity;
  [k: string]: unknown;
}
export interface QaRuleSettings {
  cjkPunctuation: boolean;
  cjkSpacing: boolean;
  maxLengthRatioPercent: number;
  maxTargetChars?: number | null;
  minLengthRatioPercent: number;
  requireSentenceFinalPunctuation: boolean;
  [k: string]: unknown;
}
export interface MethodContract66 {
  params: QaProfileCreateParams;
  result: QaProfile;
  [k: string]: unknown;
}
export interface QaProfileCreateParams {
  definition: QaProfileDefinition;
  name: string;
  ownerProjectId?: string | null;
  [k: string]: unknown;
}
export interface MethodContract69 {
  params: QaProfileDeleteParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface QaProfileDeleteParams {
  expectedRevision: number;
  profileId: string;
  [k: string]: unknown;
}
export interface MethodContract65 {
  params: QaProfileListParams;
  result: QaProfilePage;
  [k: string]: unknown;
}
export interface QaProfileListParams {
  limit?: number;
  offset?: number;
  projectId?: string | null;
  [k: string]: unknown;
}
export interface QaProfilePage {
  items: QaProfile[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract68 {
  params: QaProfileUpdateParams;
  result: QaProfile;
  [k: string]: unknown;
}
export interface QaProfileUpdateParams {
  definition: QaProfileDefinition;
  expectedRevision: number;
  name: string;
  profileId: string;
  [k: string]: unknown;
}
export interface MethodContract76 {
  params: QaReportExportParams;
  result: QaReportRecord;
  [k: string]: unknown;
}
export interface QaReportExportParams {
  format: QaReportFormat;
  outputPath: string;
  runId: string;
  [k: string]: unknown;
}
export interface QaReportRecord {
  createdAtMs: number;
  format: QaReportFormat;
  id: string;
  outputPath: string;
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract70 {
  params: QaRunParams;
  result: QaRun;
  [k: string]: unknown;
}
export interface QaRunParams {
  documentId?: string | null;
  profileId?: string | null;
  projectId: string;
  [k: string]: unknown;
}
export interface MethodContract72 {
  params: QaRunIdParams;
  result: QaRun;
  [k: string]: unknown;
}
export interface QaRunIdParams {
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract71 {
  params: QaRunListParams;
  result: QaRunPage;
  [k: string]: unknown;
}
export interface QaRunListParams {
  documentId?: string | null;
  limit?: number;
  offset?: number;
  projectId: string;
  [k: string]: unknown;
}
export interface QaRunPage {
  items: QaRun[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract63 {
  params: DocumentIdParams;
  result: QaListResult;
  [k: string]: unknown;
}
export interface MethodContract37 {
  params: ReviewDecisionParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface ReviewDecisionParams {
  expectedSegmentRevision: number;
  reviewId: string;
  [k: string]: unknown;
}
export interface MethodContract35 {
  params: ReviewCreateParams;
  result: ReviewRevision;
  [k: string]: unknown;
}
export interface ReviewCreateParams {
  author: string;
  expectedRevision: number;
  proposedSource?: string | null;
  proposedTarget?: string | null;
  proposedTargetTags?: InlineTag[] | null;
  reason?: string;
  segmentId: string;
  [k: string]: unknown;
}
export interface ReviewRevision {
  author: string;
  baseRevision: number;
  beforeSource?: string;
  beforeTarget: string;
  beforeTargetTags?: InlineTag[];
  createdAtMs: number;
  id: string;
  proposedSource?: string | null;
  proposedTarget: string;
  proposedTargetTags?: InlineTag[] | null;
  reason: string;
  segmentId: string;
  status: ReviewStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface MethodContract36 {
  params: ReviewListParams;
  result: ReviewListResult;
  [k: string]: unknown;
}
export interface ReviewListParams {
  documentId: string;
  includeClosed?: boolean;
  [k: string]: unknown;
}
export interface ReviewListResult {
  revisions: ReviewRevision[];
  [k: string]: unknown;
}
export interface MethodContract39 {
  params: ReviewQueueParams;
  result: ReviewQueuePage;
  [k: string]: unknown;
}
export interface ReviewQueueParams {
  documentId?: string | null;
  limit?: number;
  offset?: number;
  projectId: string;
  status?: ReviewStatus | null;
  [k: string]: unknown;
}
export interface ReviewQueuePage {
  items: ReviewQueueItem[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface ReviewQueueItem {
  documentId: string;
  documentName: string;
  projectId: string;
  revision: ReviewRevision;
  segmentOrdinal: number;
  [k: string]: unknown;
}
export interface MethodContract38 {
  params: ReviewDecisionParams;
  result: ReviewRevision;
  [k: string]: unknown;
}
export interface MethodContract40 {
  params: ReviewStatisticsParams;
  result: ReviewStatistics;
  [k: string]: unknown;
}
export interface ReviewStatisticsParams {
  documentId?: string | null;
  projectId: string;
  [k: string]: unknown;
}
export interface ReviewStatistics {
  acceptedRevisions: number;
  documentId?: string | null;
  pendingRevisions: number;
  projectId: string;
  rejectedRevisions: number;
  reviewSegments: number;
  reviewedCharacters: number;
  reviewers: ReviewerStatistic[];
  signedSegments: number;
  translationSegments: number;
  [k: string]: unknown;
}
export interface ReviewerStatistic {
  accepted: number;
  pending: number;
  rejected: number;
  reviewedCharacters: number;
  reviewer: string;
  [k: string]: unknown;
}
export interface MethodContract16 {
  params: ConvertSegmentChineseParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface ConvertSegmentChineseParams {
  expectedRevision: number;
  profile: ChineseConversionProfile;
  segmentId: string;
  [k: string]: unknown;
}
export interface MethodContract26 {
  params: CreateSegmentCommentParams;
  result: EditorComment;
  [k: string]: unknown;
}
export interface CreateSegmentCommentParams {
  author: string;
  segmentId: string;
  text: string;
  [k: string]: unknown;
}
export interface MethodContract29 {
  params: DeleteSegmentCommentParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface DeleteSegmentCommentParams {
  commentId: string;
  expectedRevision: number;
  [k: string]: unknown;
}
export interface MethodContract25 {
  params: SegmentCommentListParams;
  result: SegmentCommentListResult;
  [k: string]: unknown;
}
export interface SegmentCommentListParams {
  includeResolved?: boolean;
  segmentId: string;
  [k: string]: unknown;
}
export interface SegmentCommentListResult {
  comments: EditorComment[];
  [k: string]: unknown;
}
export interface MethodContract28 {
  params: ResolveSegmentCommentParams;
  result: EditorComment;
  [k: string]: unknown;
}
export interface ResolveSegmentCommentParams {
  commentId: string;
  expectedRevision: number;
  resolved: boolean;
  [k: string]: unknown;
}
export interface MethodContract27 {
  params: UpdateSegmentCommentParams;
  result: EditorComment;
  [k: string]: unknown;
}
export interface UpdateSegmentCommentParams {
  commentId: string;
  expectedRevision: number;
  text: string;
  [k: string]: unknown;
}
export interface MethodContract13 {
  params: ConfirmSegmentParams;
  result: ConfirmSegmentResult;
  [k: string]: unknown;
}
export interface MethodContract23 {
  params: CorrectSourceParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface CorrectSourceParams {
  expectedRevision: number;
  reason: string;
  segmentId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface MethodContract14 {
  params: EditorSegmentListParams;
  result: EditorSegmentPage;
  [k: string]: unknown;
}
export interface EditorSegmentListParams {
  descending?: boolean;
  documentId: string;
  field?: "source" | "target" | "both";
  filter?: "all" | "untranslated" | "draft" | "confirmed" | "issues" | "tagged" | "commented";
  includeContext?: boolean;
  limit?: number;
  offset?: number;
  query?: string;
  sort?: "ordinal" | "updatedAt" | "state";
  [k: string]: unknown;
}
export interface EditorSegmentPage {
  items: SegmentEditorRow[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract18 {
  params: FindSegmentsParams;
  result: SegmentFindResult;
  [k: string]: unknown;
}
export interface FindSegmentsParams {
  caseSensitive?: boolean;
  documentId: string;
  field?: "source" | "target" | "both";
  limit?: number;
  offset?: number;
  query: string;
  regex?: boolean;
  wholeWord?: boolean;
  [k: string]: unknown;
}
export interface SegmentFindResult {
  limit: number;
  matches: SegmentFindMatch[];
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface SegmentFindMatch {
  end: number;
  field: EditorSearchField;
  matchedText: string;
  revision: number;
  segmentId: string;
  start: number;
  [k: string]: unknown;
}
export interface MethodContract11 {
  params: SegmentListParams;
  result: SegmentPage;
  [k: string]: unknown;
}
export interface SegmentListParams {
  documentId: string;
  limit?: number;
  offset?: number;
  [k: string]: unknown;
}
export interface SegmentPage {
  items: Segment[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract22 {
  params: MergeSegmentsParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface MergeSegmentsParams {
  firstExpectedRevision: number;
  firstSegmentId: string;
  secondExpectedRevision: number;
  secondSegmentId: string;
  [k: string]: unknown;
}
export interface MethodContract17 {
  params: PropagateSegmentParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface PropagateSegmentParams {
  expectedRevision: number;
  segmentId: string;
  [k: string]: unknown;
}
export interface MethodContract20 {
  params: ReplaceApplyParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface ReplaceApplyParams {
  preview: ReplacePreviewResult;
  [k: string]: unknown;
}
export interface ReplacePreviewResult {
  changedSegments: number;
  documentId: string;
  items: ReplacePreviewItem[];
  replacementCount: number;
  token: string;
  [k: string]: unknown;
}
export interface ReplacePreviewItem {
  after: string;
  before: string;
  field: EditorSearchField;
  replacements: number;
  revision: number;
  segmentId: string;
  [k: string]: unknown;
}
export interface MethodContract19 {
  params: ReplacePreviewParams;
  result: ReplacePreviewResult;
  [k: string]: unknown;
}
export interface ReplacePreviewParams {
  caseSensitive?: boolean;
  documentId: string;
  field?: "source" | "target" | "both";
  query: string;
  regex?: boolean;
  replacement: string;
  wholeWord?: boolean;
  [k: string]: unknown;
}
export interface MethodContract30 {
  params: SpellCheckParams;
  result: SpellCheckResult;
  [k: string]: unknown;
}
export interface SpellCheckParams {
  limit?: number;
  locale: string;
  text: string;
  [k: string]: unknown;
}
export interface SpellCheckResult {
  available: boolean;
  findings: SpellFinding[];
  provider: string;
  [k: string]: unknown;
}
export interface MethodContract21 {
  params: SplitSegmentParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface SplitSegmentParams {
  expectedRevision: number;
  segmentId: string;
  sourceOffset: number;
  targetOffset?: number | null;
  [k: string]: unknown;
}
export interface MethodContract15 {
  params: SetSegmentTagsParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface SetSegmentTagsParams {
  expectedRevision: number;
  segmentId: string;
  targetTags: InlineTag[];
  [k: string]: unknown;
}
export interface MethodContract12 {
  params: UpdateTargetParams;
  result: Segment;
  [k: string]: unknown;
}
export interface UpdateTargetParams {
  expectedRevision: number;
  segmentId: string;
  targetText: string;
  [k: string]: unknown;
}
export interface MethodContract24 {
  params: SetEditorWorkflowParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface SetEditorWorkflowParams {
  actor?: string | null;
  expectedRevision: number;
  reason?: string | null;
  segmentId: string;
  state: EditorWorkflowState;
  [k: string]: unknown;
}
export interface MethodContract59 {
  params: TermSearchParams;
  result: TermSearchResult;
  [k: string]: unknown;
}
export interface TermSearchParams {
  limit?: number;
  offset?: number;
  projectId: string;
  termbaseIds?: string[];
  text: string;
  [k: string]: unknown;
}
export interface TermSearchResult {
  limit: number;
  matches: TermMatch[];
  offset: number;
  total: number;
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
export interface MethodContract60 {
  params: TermUpsertParams;
  result: TermEntry;
  [k: string]: unknown;
}
export interface TermUpsertParams {
  definition?: string | null;
  domain?: string | null;
  example?: string | null;
  partOfSpeech?: string | null;
  sourceLocale: string;
  sourceTerm: string;
  status?: "candidate" | "active" | "deprecated";
  termbaseId: string;
  translations: TermTranslationInput[];
  [k: string]: unknown;
}
export interface TermTranslationInput {
  forbidden?: boolean;
  locale: string;
  preferred?: boolean;
  term: string;
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
export interface MethodContract56 {
  params: TermbaseCreateParams;
  result: Termbase;
  [k: string]: unknown;
}
export interface TermbaseCreateParams {
  domain?: string | null;
  name: string;
  sourceLocale: string;
  writable?: boolean;
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
export interface MethodContract62 {
  params: TermbaseExportParams;
  result: TermbaseExportResult;
  [k: string]: unknown;
}
export interface TermbaseExportParams {
  format: AssetExchangeFormat;
  outputPath: string;
  targetLocale: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermbaseExportResult {
  entryCount: number;
  outputPath: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface MethodContract61 {
  params: TermbaseImportParams;
  result: TermbaseImportResult;
  [k: string]: unknown;
}
export interface TermbaseImportParams {
  format: AssetExchangeFormat;
  sourceLocale: string;
  sourcePath: string;
  targetLocale: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermbaseImportResult {
  diagnostics: AssetDiagnostic[];
  inserted: number;
  skipped: number;
  termbaseId: string;
  [k: string]: unknown;
}
export interface MethodContract55 {
  params: TermbaseListParams;
  result: TermbasePage;
  [k: string]: unknown;
}
export interface TermbaseListParams {
  limit?: number;
  offset?: number;
  projectId: string;
  [k: string]: unknown;
}
export interface TermbasePage {
  items: Termbase[];
  limit: number;
  mounts: TermbaseMount[];
  offset: number;
  total: number;
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
export interface MethodContract57 {
  params: TermbaseMountParams;
  result: TermbaseMount;
  [k: string]: unknown;
}
export interface TermbaseMountParams {
  enabled?: boolean;
  expectedRevision?: number | null;
  priority?: number;
  projectId: string;
  termbaseId: string;
  writable?: boolean;
  [k: string]: unknown;
}
export interface MethodContract58 {
  params: TermbaseUnmountParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface TermbaseUnmountParams {
  expectedRevision: number;
  projectId: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface MethodContract52 {
  params: ConcordanceParams;
  result: ConcordanceResult;
  [k: string]: unknown;
}
export interface MethodContract54 {
  params: TmExportParams;
  result: TmExportResult;
  [k: string]: unknown;
}
export interface TmExportParams {
  format: AssetExchangeFormat;
  libraryId: string;
  outputPath: string;
  [k: string]: unknown;
}
export interface TmExportResult {
  libraryId: string;
  outputPath: string;
  unitCount: number;
  [k: string]: unknown;
}
export interface MethodContract53 {
  params: TmImportParams;
  result: TmImportResult;
  [k: string]: unknown;
}
export interface TmImportParams {
  format: AssetExchangeFormat;
  libraryId: string;
  sourceLocale: string;
  sourcePath: string;
  targetLocale: string;
  [k: string]: unknown;
}
export interface TmImportResult {
  diagnostics: AssetDiagnostic[];
  inserted: number;
  libraryId: string;
  skipped: number;
  [k: string]: unknown;
}
export interface MethodContract48 {
  params: TmLibraryCreateParams;
  result: TmLibrary;
  [k: string]: unknown;
}
export interface TmLibraryCreateParams {
  domain?: string | null;
  name: string;
  ownerProjectId?: string | null;
  sourceLocale: string;
  targetLocale: string;
  writable?: boolean;
  [k: string]: unknown;
}
export interface TmLibrary {
  createdAtMs: number;
  domain?: string | null;
  id: string;
  name: string;
  revision: number;
  sourceLocale: string;
  targetLocale: string;
  updatedAtMs: number;
  writable: boolean;
  [k: string]: unknown;
}
export interface MethodContract47 {
  params: TmLibraryListParams;
  result: TmLibraryPage;
  [k: string]: unknown;
}
export interface TmLibraryListParams {
  limit?: number;
  offset?: number;
  projectId?: string | null;
  [k: string]: unknown;
}
export interface TmLibraryPage {
  items: TmLibrary[];
  limit: number;
  mounts: TmLibraryMount[];
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface TmLibraryMount {
  createdAtMs: number;
  enabled: boolean;
  libraryId: string;
  mode: AssetMountMode;
  priority: number;
  projectId: string;
  revision: number;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface MethodContract49 {
  params: TmLibraryMountParams;
  result: TmLibraryMount;
  [k: string]: unknown;
}
export interface TmLibraryMountParams {
  enabled?: boolean;
  expectedRevision?: number | null;
  libraryId: string;
  mode: AssetMountMode;
  priority?: number;
  projectId: string;
  [k: string]: unknown;
}
export interface MethodContract50 {
  params: TmLibraryUnmountParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface TmLibraryUnmountParams {
  expectedRevision: number;
  libraryId: string;
  projectId: string;
  [k: string]: unknown;
}
export interface MethodContract46 {
  params: ExactLookupParams;
  result: ExactLookupResult;
  [k: string]: unknown;
}
export interface MethodContract51 {
  params: TmSearchParams;
  result: TmSearchResult;
  [k: string]: unknown;
}
export interface TmSearchParams {
  contextAfterHash?: string | null;
  contextBeforeHash?: string | null;
  domain?: string | null;
  libraryIds?: string[];
  limit?: number;
  offset?: number;
  originDocumentId?: string | null;
  originProjectId?: string | null;
  projectId: string;
  query: string;
  sinceMs?: number | null;
  sourceLocale: string;
  targetLocale: string;
  threshold?: number;
  [k: string]: unknown;
}
export interface TmSearchResult {
  limit: number;
  matches: TmMatch[];
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface TmMatch {
  kind: TmMatchKind;
  library: TmLibrary;
  mountPriority: number;
  score: number;
  substitutions: PlaceholderSubstitution[];
  unit: TmUnit;
  [k: string]: unknown;
}
export interface PlaceholderSubstitution {
  candidateValue: string;
  kind: string;
  queryValue: string;
  [k: string]: unknown;
}
export interface RpcError {
  code: ErrorCode;
  data?: unknown;
  message: string;
  [k: string]: unknown;
}
