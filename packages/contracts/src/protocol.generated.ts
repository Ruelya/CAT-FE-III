/* eslint-disable -- Generated from the Rust protocol schema. Do not edit. */

export type AlignmentSessionStatus = "open" | "applied" | "discarded";
export type AlignmentEvidence =
  | {
      kind: "length";
      scoreBasisPoints: number;
      sourceChars: number;
      summary: string;
      targetChars: number;
    }
  | {
      kind: "numbers";
      scoreBasisPoints: number;
      sourceValueCount: number;
      sourceValues: string[];
      summary: string;
      targetValueCount: number;
      targetValues: string[];
    }
  | {
      kind: "punctuation";
      scoreBasisPoints: number;
      sourceSignature: string[];
      summary: string;
      targetSignature: string[];
    }
  | {
      kind: "tags";
      scoreBasisPoints: number;
      sourceSignature: string[];
      sourceTagCount: number;
      summary: string;
      targetSignature: string[];
      targetTagCount: number;
    }
  | {
      kind: "lexicalAnchors";
      scoreBasisPoints: number;
      sharedAnchorCount: number;
      sharedAnchors: string[];
      summary: string;
    }
  | {
      kind: "displacement";
      penaltyBasisPoints: number;
      sourcePositionBasisPoints: number;
      summary: string;
      targetPositionBasisPoints: number;
    }
  | {
      kind: "unaligned";
      penaltyBasisPoints: number;
      side: AlignmentSide;
      summary: string;
    }
  | {
      kind: "aiRefinement";
      summary: string;
    };
export type AlignmentSide = "source" | "target";
export type AlignmentOrigin = "deterministic" | "manual" | "ai";
export type AlignmentLinkStatus = "proposed" | "confirmed" | "rejected";
export type AlignmentSessionMutation =
  | {
      kind: "replaceLinks";
      links: AlignmentExpectedLinkRevision[];
      replacement: AlignmentManualLink[];
    }
  | {
      expectedLinkRevision: number;
      kind: "setStatus";
      linkId: string;
      status: AlignmentLinkStatus;
    };
export type AssetExchangeFormat = "tmx" | "csv" | "tsv" | "tbx";
export type ReferenceCorpusKind = "monolingualSource" | "monolingualTarget" | "bilingual";
export type ReferenceCorpusSourceKind = "file" | "alignment";
export type ReferenceCorpusStatus = "active" | "removed";
export type CorpusMatchKind = "exact" | "prefix" | "contains";
export type CorpusMatchedSide = "source" | "target" | "both";
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
export type ReimportDisposition = "unchanged" | "changed" | "new" | "removed" | "ambiguous";
export type InteropPreviewStatus = "open" | "applied" | "discarded";
export type ReviewInteropDisposition = "changed" | "unchanged" | "missing" | "added" | "invalid";
export type BilingualTableFormat = "docx" | "xlsx";
export type TableInteropDisposition = "valid" | "duplicate" | "invalid";
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
export type TaskPackageKind = "assignment" | "return";
export type TaskPackageDisposition =
  | "unchanged"
  | "remoteChanged"
  | "localChanged"
  | "bothChanged"
  | "deleted"
  | "added"
  | "tagInvalid"
  | "missingDependency";
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
  | "alignment_invalid_partition"
  | "alignment_response_invalid"
  | "unsupported_corpus_input"
  | "resource_limit_exceeded"
  | "resource_limit"
  | "internal_error";

export interface ProtocolCatalog {
  alignment_apply_result: AlignmentApplyResult;
  alignment_mutation_result: AlignmentMutationResult;
  alignment_session_apply_params: AlignmentSessionApplyParams;
  alignment_session_create_params: AlignmentSessionCreateParams;
  alignment_session_get_params: AlignmentSessionGetParams;
  alignment_session_get_result: AlignmentSessionGetResult;
  alignment_session_list_params: AlignmentSessionListParams;
  alignment_session_page: AlignmentSessionPage;
  alignment_session_refine_params: AlignmentSessionRefineParams;
  alignment_session_update_params: AlignmentSessionUpdateParams;
  asset_diagnostic: AssetDiagnostic;
  asset_exchange_format: AssetExchangeFormat;
  backup_result: BackupResult;
  concordance_params: ConcordanceParams;
  concordance_result: ConcordanceResult;
  confirm_segment_params: ConfirmSegmentParams;
  confirm_segment_result: ConfirmSegmentResult;
  corpus_from_alignment_params: CorpusFromAlignmentParams;
  corpus_import_params: CorpusImportParams;
  corpus_list_params: CorpusListParams;
  corpus_mutation_params: CorpusMutationParams;
  corpus_search_params: CorpusSearchParams;
  corpus_search_result: CorpusSearchResult;
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
  project_analytics_params: ProjectAnalyticsParams;
  project_create_from_template_params: ProjectCreateFromTemplateParams;
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
  reference_corpus_mutation_result: ReferenceCorpusMutationResult;
  reference_corpus_page: ReferenceCorpusPage;
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
export interface AlignmentApplyResult {
  duplicateCount: number;
  duplicates: AlignmentApplyDuplicate[];
  insertedCount: number;
  libraryId: string;
  libraryRevision: number;
  operationId: string;
  selectedCount: number;
  sessionId: string;
  sessionRevision: number;
  status: AlignmentSessionStatus;
  tmUnitIds: string[];
  [k: string]: unknown;
}
export interface AlignmentApplyDuplicate {
  linkId: string;
  tmUnitId: string;
  [k: string]: unknown;
}
export interface AlignmentMutationResult {
  links: AlignmentLink[];
  operationId?: string | null;
  session: AlignmentSession;
  [k: string]: unknown;
}
export interface AlignmentLink {
  confidenceBasisPoints: number;
  createdAtMs: number;
  evidence: AlignmentEvidence[];
  id: string;
  ordinal: number;
  origin: AlignmentOrigin;
  revision: number;
  sessionId: string;
  sourceSegmentIds: string[];
  sourceText: string;
  status: AlignmentLinkStatus;
  targetSegmentIds: string[];
  targetText: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface AlignmentSession {
  algorithmVersion: string;
  closedAtMs?: number | null;
  createdAtMs: number;
  id: string;
  projectId: string;
  revision: number;
  sourceDocumentId: string;
  sourceDocumentRevision: number;
  sourceLocale: string;
  status: AlignmentSessionStatus;
  targetDocumentId: string;
  targetDocumentRevision: number;
  targetLocale: string;
  terminalResult?: AlignmentApplyResult | null;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface AlignmentSessionApplyParams {
  actor?: string;
  correlationId?: string | null;
  expectedLibraryRevision: number;
  expectedSessionRevision: number;
  libraryId: string;
  links: AlignmentExpectedLinkRevision[];
  reason: string;
  sessionId: string;
}
export interface AlignmentExpectedLinkRevision {
  expectedRevision: number;
  linkId: string;
  [k: string]: unknown;
}
export interface AlignmentSessionCreateParams {
  actor?: string;
  correlationId?: string | null;
  expectedProjectRevision: number;
  expectedSourceDocumentRevision: number;
  expectedTargetDocumentRevision: number;
  options?: AlignmentOptions;
  projectId: string;
  reason: string;
  sourceDocumentId: string;
  targetDocumentId: string;
}
export interface AlignmentOptions {
  bandWidth: number;
  maxEvidenceValues: number;
  maxGroupSize: number;
  maxSegmentsPerSide: number;
  maxTagsPerSegment: number;
  maxTotalInputChars: number;
  maxWorkUnits: number;
  [k: string]: unknown;
}
export interface AlignmentSessionGetParams {
  limit?: number;
  linkStatus?: AlignmentLinkStatus | null;
  offset?: number;
  sessionId: string;
}
export interface AlignmentSessionGetResult {
  limit: number;
  links: AlignmentLink[];
  offset: number;
  session: AlignmentSession;
  total: number;
  [k: string]: unknown;
}
export interface AlignmentSessionListParams {
  limit?: number;
  offset?: number;
  projectId: string;
  status?: AlignmentSessionStatus | null;
}
export interface AlignmentSessionPage {
  items: AlignmentSession[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface AlignmentSessionRefineParams {
  actor?: string;
  correlationId?: string | null;
  expectedSessionRevision: number;
  links: AlignmentExpectedLinkRevision[];
  maxAttempts?: number;
  profileId: string;
  reason: string;
  sessionId: string;
}
export interface AlignmentSessionUpdateParams {
  actor?: string;
  correlationId?: string | null;
  expectedSessionRevision: number;
  mutation: AlignmentSessionMutation;
  reason: string;
  sessionId: string;
}
export interface AlignmentManualLink {
  sourceSegmentIds: string[];
  targetSegmentIds: string[];
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
  corpusHits?: CorpusSearchHit[];
  corpusTotal?: number;
  hits: ConcordanceHit[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface CorpusSearchHit {
  corpus: ReferenceCorpus;
  entry: ReferenceCorpusEntry;
  matchKind: CorpusMatchKind;
  matchedSide: CorpusMatchedSide;
  [k: string]: unknown;
}
export interface ReferenceCorpus {
  alignmentSessionId?: string | null;
  createdAtMs: number;
  diagnosticCount: number;
  diagnostics: string[];
  entryCount: number;
  id: string;
  inputFilterId?: string | null;
  inputFormat?: string | null;
  inputSha256?: string | null;
  kind: ReferenceCorpusKind;
  managedSourcePath?: string | null;
  name: string;
  projectId: string;
  removedAtMs?: number | null;
  revision: number;
  sourceDocumentId?: string | null;
  sourceKind: ReferenceCorpusSourceKind;
  sourceLocale: string;
  status: ReferenceCorpusStatus;
  targetDocumentId?: string | null;
  targetLocale: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface ReferenceCorpusEntry {
  corpusId: string;
  createdAtMs: number;
  id: string;
  ordinal: number;
  provenance: unknown;
  sourceText: string;
  structuralPath: string;
  targetText: string;
  updatedAtMs: number;
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
export interface CorpusFromAlignmentParams {
  actor?: string;
  correlationId?: string | null;
  expectedProjectRevision: number;
  expectedSessionRevision: number;
  links: AlignmentExpectedLinkRevision[];
  name: string;
  projectId: string;
  reason: string;
  sessionId: string;
}
export interface CorpusImportParams {
  actor?: string;
  correlationId?: string | null;
  expectedProjectRevision: number;
  filterId?: string | null;
  kind: ReferenceCorpusKind;
  name: string;
  options?: {
    [k: string]: string;
  };
  projectId: string;
  reason: string;
  sourceLocale: string;
  sourcePath: string;
  targetLocale: string;
}
export interface CorpusListParams {
  limit?: number;
  offset?: number;
  projectId: string;
  status?: ReferenceCorpusStatus | null;
}
export interface CorpusMutationParams {
  actor?: string;
  corpusId: string;
  correlationId?: string | null;
  expectedRevision: number;
  reason: string;
}
export interface CorpusSearchParams {
  corpusIds?: string[];
  limit?: number;
  offset?: number;
  projectId: string;
  query: string;
  side?: "source" | "target" | "both";
}
export interface CorpusSearchResult {
  items: CorpusSearchHit[];
  limit: number;
  offset: number;
  total: number;
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
  "ai.batch.cancel": MethodContract154;
  "ai.batch.get": MethodContract151;
  "ai.batch.items": MethodContract153;
  "ai.batch.list": MethodContract152;
  "ai.batch.resume": MethodContract154;
  "ai.batch.start": MethodContract150;
  "ai.conversation.create": MethodContract157;
  "ai.conversation.list": MethodContract156;
  "ai.conversation.messages": MethodContract159;
  "ai.conversation.update": MethodContract158;
  "ai.credential.delete": MethodContract140;
  "ai.credential.status": MethodContract140;
  "ai.grounding.preview": MethodContract143;
  "ai.provider.catalog": MethodContract134;
  "ai.provider.create": MethodContract136;
  "ai.provider.delete": MethodContract138;
  "ai.provider.list": MethodContract135;
  "ai.provider.test": MethodContract139;
  "ai.provider.update": MethodContract137;
  "ai.result.apply": MethodContract149;
  "ai.run.cancel": MethodContract148;
  "ai.run.events": MethodContract147;
  "ai.run.get": MethodContract145;
  "ai.run.list": MethodContract146;
  "ai.run.resume": MethodContract148;
  "ai.run.start": MethodContract144;
  "ai.settings.get": MethodContract141;
  "ai.settings.update": MethodContract142;
  "ai.usage.query": MethodContract155;
  "alignment.session.apply": MethodContract80;
  "alignment.session.create": MethodContract75;
  "alignment.session.get": MethodContract76;
  "alignment.session.list": MethodContract77;
  "alignment.session.refine": MethodContract79;
  "alignment.session.update": MethodContract78;
  "analysis.profile.list": MethodContract31;
  "analysis.run": MethodContract32;
  "analysis.run.get": MethodContract33;
  "corpus.fromAlignment": MethodContract83;
  "corpus.import": MethodContract82;
  "corpus.list": MethodContract81;
  "corpus.reindex": MethodContract85;
  "corpus.remove": MethodContract85;
  "corpus.search": MethodContract84;
  "data.checkHealth": MethodContract123;
  "data.createBackup": MethodContract124;
  "dictionary.add": MethodContract56;
  "dictionary.list": MethodContract55;
  "dictionary.remove": MethodContract56;
  "document.export": MethodContract120;
  "document.exportDocx": MethodContract119;
  "document.get": MethodContract22;
  "document.import": MethodContract23;
  "document.importDocx": MethodContract24;
  "document.list": MethodContract21;
  "document.reimport.apply": MethodContract26;
  "document.reimport.preview": MethodContract25;
  "editor.history": MethodContract58;
  "editor.preferences.get": MethodContract70;
  "editor.preferences.update": MethodContract71;
  "editor.redo": MethodContract57;
  "editor.undo": MethodContract57;
  "engine.initialize": MethodContract;
  "filter.list": MethodContract121;
  "history.list": MethodContract122;
  "interop.review.apply": MethodContract67;
  "interop.review.export": MethodContract65;
  "interop.review.preview": MethodContract66;
  "interop.table.apply": MethodContract69;
  "interop.table.preview": MethodContract68;
  "pdf.correctOcr": MethodContract74;
  "pdf.page.get": MethodContract73;
  "pdf.page.list": MethodContract72;
  "pipeline.create": MethodContract126;
  "pipeline.get": MethodContract128;
  "pipeline.list": MethodContract127;
  "pipeline.run": MethodContract130;
  "pipeline.run.cancel": MethodContract133;
  "pipeline.run.get": MethodContract132;
  "pipeline.run.list": MethodContract131;
  "pipeline.run.resume": MethodContract133;
  "pipeline.step.list": MethodContract125;
  "pipeline.validate": MethodContract129;
  "project.analytics.get": MethodContract34;
  "project.archive.export": MethodContract14;
  "project.archive.restore": MethodContract15;
  "project.batchImport": MethodContract13;
  "project.create": MethodContract2;
  "project.createFromTemplate": MethodContract12;
  "project.get": MethodContract3;
  "project.list": MethodContract4;
  "project.setLifecycle": MethodContract6;
  "project.template.create": MethodContract9;
  "project.template.delete": MethodContract11;
  "project.template.get": MethodContract8;
  "project.template.list": MethodContract7;
  "project.template.update": MethodContract10;
  "project.update": MethodContract5;
  "qa.gate.check": MethodContract117;
  "qa.issue.list": MethodContract113;
  "qa.issue.revoke": MethodContract115;
  "qa.issue.waive": MethodContract114;
  "qa.list": MethodContract104;
  "qa.override.list": MethodContract118;
  "qa.profile.clone": MethodContract107;
  "qa.profile.create": MethodContract106;
  "qa.profile.delete": MethodContract109;
  "qa.profile.list": MethodContract105;
  "qa.profile.update": MethodContract108;
  "qa.report.export": MethodContract116;
  "qa.run": MethodContract110;
  "qa.run.get": MethodContract112;
  "qa.run.list": MethodContract111;
  "qa.runDocument": MethodContract103;
  "recycle.delete": MethodContract28;
  "recycle.list": MethodContract27;
  "recycle.purge": MethodContract29;
  "recycle.restore": MethodContract29;
  "review.accept": MethodContract61;
  "review.create": MethodContract59;
  "review.list": MethodContract60;
  "review.queue": MethodContract63;
  "review.reject": MethodContract62;
  "review.stats": MethodContract64;
  "search.global": MethodContract30;
  "segment.chinese.convert": MethodContract40;
  "segment.comment.create": MethodContract50;
  "segment.comment.delete": MethodContract53;
  "segment.comment.list": MethodContract49;
  "segment.comment.resolve": MethodContract52;
  "segment.comment.update": MethodContract51;
  "segment.confirm": MethodContract37;
  "segment.correctSource": MethodContract47;
  "segment.editor.list": MethodContract38;
  "segment.find": MethodContract42;
  "segment.list": MethodContract35;
  "segment.merge": MethodContract46;
  "segment.propagate": MethodContract41;
  "segment.replace.apply": MethodContract44;
  "segment.replace.preview": MethodContract43;
  "segment.spell.check": MethodContract54;
  "segment.split": MethodContract45;
  "segment.tag.set": MethodContract39;
  "segment.updateTarget": MethodContract36;
  "segment.workflow.set": MethodContract48;
  "taskPackage.apply": MethodContract18;
  "taskPackage.discard": MethodContract20;
  "taskPackage.export": MethodContract16;
  "taskPackage.import": MethodContract19;
  "taskPackage.preview": MethodContract17;
  "term.search": MethodContract99;
  "term.upsert": MethodContract100;
  "termbase.create": MethodContract96;
  "termbase.export": MethodContract102;
  "termbase.import": MethodContract101;
  "termbase.list": MethodContract95;
  "termbase.mount": MethodContract97;
  "termbase.unmount": MethodContract98;
  "tm.concordance": MethodContract92;
  "tm.export": MethodContract94;
  "tm.import": MethodContract93;
  "tm.library.create": MethodContract88;
  "tm.library.list": MethodContract87;
  "tm.library.mount": MethodContract89;
  "tm.library.unmount": MethodContract90;
  "tm.lookupExact": MethodContract86;
  "tm.search": MethodContract91;
}
export interface MethodContract154 {
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
  corpusTopN?: number;
  includeContext: boolean;
  includeCorpus?: boolean;
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
export interface MethodContract151 {
  params: AiBatchIdParams;
  result: AiBatchRun;
  [k: string]: unknown;
}
export interface AiBatchIdParams {
  batchId: string;
}
export interface MethodContract153 {
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
export interface MethodContract152 {
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
export interface MethodContract150 {
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
  corpusTopN?: number;
  includeContext: boolean;
  includeCorpus?: boolean;
  includeStyle: boolean;
  includeTerms: boolean;
  includeTm: boolean;
  maxChars: number;
  styleInstruction: string;
  systemInstruction: string;
  tmTopN: number;
  [k: string]: unknown;
}
export interface MethodContract157 {
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
export interface MethodContract156 {
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
export interface MethodContract159 {
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
export interface MethodContract158 {
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
export interface MethodContract140 {
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
export interface MethodContract143 {
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
  corpusTopN?: number;
  includeContext: boolean;
  includeCorpus?: boolean;
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
export interface MethodContract134 {
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
export interface MethodContract136 {
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
export interface MethodContract138 {
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
export interface MethodContract135 {
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
export interface MethodContract139 {
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
  alignmentRefinement?: AlignmentRefinementRunContext | null;
  conversationId?: string | null;
  freeformPrompt: string;
  groundingOptions: GroundingOptions;
  [k: string]: unknown;
}
export interface AlignmentRefinementRunContext {
  actor: string;
  correlationId?: string | null;
  expectedSessionRevision: number;
  links: AlignmentRefinementLinkRevision[];
  reason: string;
  sessionId: string;
  [k: string]: unknown;
}
export interface AlignmentRefinementLinkRevision {
  expectedRevision: number;
  linkId: string;
  [k: string]: unknown;
}
export interface MethodContract137 {
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
export interface MethodContract149 {
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
export interface MethodContract148 {
  params: AiRunRevisionParams;
  result: AiRun;
  [k: string]: unknown;
}
export interface AiRunRevisionParams {
  expectedRevision: number;
  runId: string;
}
export interface MethodContract147 {
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
export interface MethodContract145 {
  params: AiRunIdParams;
  result: AiRun;
  [k: string]: unknown;
}
export interface AiRunIdParams {
  runId: string;
}
export interface MethodContract146 {
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
export interface MethodContract144 {
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
  corpusTopN?: number;
  includeContext: boolean;
  includeCorpus?: boolean;
  includeStyle: boolean;
  includeTerms: boolean;
  includeTm: boolean;
  maxChars: number;
  styleInstruction: string;
  systemInstruction: string;
  tmTopN: number;
  [k: string]: unknown;
}
export interface MethodContract141 {
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
export interface MethodContract142 {
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
export interface MethodContract155 {
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
export interface MethodContract80 {
  params: AlignmentSessionApplyParams;
  result: AlignmentApplyResult;
  [k: string]: unknown;
}
export interface MethodContract75 {
  params: AlignmentSessionCreateParams;
  result: AlignmentSessionCreateResult;
  [k: string]: unknown;
}
export interface AlignmentSessionCreateResult {
  linkCount: number;
  operationId: string;
  session: AlignmentSession;
  sourceSegmentCount: number;
  targetSegmentCount: number;
  workUnits: number;
  [k: string]: unknown;
}
export interface MethodContract76 {
  params: AlignmentSessionGetParams;
  result: AlignmentSessionGetResult;
  [k: string]: unknown;
}
export interface MethodContract77 {
  params: AlignmentSessionListParams;
  result: AlignmentSessionPage;
  [k: string]: unknown;
}
export interface MethodContract79 {
  params: AlignmentSessionRefineParams;
  result: AiRun;
  [k: string]: unknown;
}
export interface MethodContract78 {
  params: AlignmentSessionUpdateParams;
  result: AlignmentMutationResult;
  [k: string]: unknown;
}
export interface MethodContract31 {
  params: EmptyParams;
  result: AnalysisProfileListResult;
  [k: string]: unknown;
}
export interface AnalysisProfileListResult {
  items: AnalysisProfile[];
  [k: string]: unknown;
}
export interface AnalysisProfile {
  builtIn: boolean;
  createdAtMs: number;
  id: string;
  name: string;
  revision: number;
  updatedAtMs: number;
  weights: AnalysisWeights;
  [k: string]: unknown;
}
export interface AnalysisWeights {
  exactBasisPoints: number;
  match5074BasisPoints: number;
  match7584BasisPoints: number;
  match8594BasisPoints: number;
  match9599BasisPoints: number;
  noMatchBasisPoints: number;
  repetitionBasisPoints: number;
  [k: string]: unknown;
}
export interface MethodContract32 {
  params: AnalysisRunParams;
  result: AnalysisRunResult;
  [k: string]: unknown;
}
export interface AnalysisRunParams {
  documentId?: string | null;
  profileId?: string;
  profileRevision?: number | null;
  projectId: string;
  [k: string]: unknown;
}
export interface AnalysisRunResult {
  completedAtMs: number;
  createdAtMs: number;
  documentId?: string | null;
  documentRevision?: number | null;
  documentSummaries: {
    [k: string]: AnalysisSummary;
  };
  id: string;
  profileId: string;
  profileRevision: number;
  projectId: string;
  projectRevision: number;
  stale: boolean;
  summary: AnalysisSummary;
  [k: string]: unknown;
}
export interface AnalysisSummary {
  aiContribution: AiContribution;
  matchBands: MatchBandCounts;
  repeatedSegments: number;
  segments: number;
  sourceCharacters: number;
  sourceCjkCharacters: number;
  sourceWords: number;
  targetCharacters: number;
  targetCjkCharacters: number;
  targetWords: number;
  weightedEffortMilliUnits: number;
  workflowReview: number;
  workflowSigned: number;
  workflowTranslation: number;
  [k: string]: unknown;
}
export interface AiContribution {
  appliedSegments: number;
  editDistance: number;
  proposalCharacters: number;
  replacedSegments: number;
  retainedCharacters: number;
  retainedSegments: number;
  [k: string]: unknown;
}
export interface MatchBandCounts {
  exact: number;
  match5074: number;
  match7584: number;
  match8594: number;
  match9599: number;
  noMatch: number;
  repetitions: number;
  [k: string]: unknown;
}
export interface MethodContract33 {
  params: AnalysisRunIdParams;
  result: AnalysisRunResult;
  [k: string]: unknown;
}
export interface AnalysisRunIdParams {
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract83 {
  params: CorpusFromAlignmentParams;
  result: ReferenceCorpusMutationResult;
  [k: string]: unknown;
}
export interface ReferenceCorpusMutationResult {
  affectedEntryCount: number;
  corpus: ReferenceCorpus;
  operationId: string;
  [k: string]: unknown;
}
export interface MethodContract82 {
  params: CorpusImportParams;
  result: ReferenceCorpusMutationResult;
  [k: string]: unknown;
}
export interface MethodContract81 {
  params: CorpusListParams;
  result: ReferenceCorpusPage;
  [k: string]: unknown;
}
export interface ReferenceCorpusPage {
  items: ReferenceCorpus[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract85 {
  params: CorpusMutationParams;
  result: ReferenceCorpusMutationResult;
  [k: string]: unknown;
}
export interface MethodContract84 {
  params: CorpusSearchParams;
  result: CorpusSearchResult;
  [k: string]: unknown;
}
export interface MethodContract123 {
  params: EmptyParams;
  result: DataHealthReport;
  [k: string]: unknown;
}
export interface MethodContract124 {
  params: CreateBackupParams;
  result: BackupResult;
  [k: string]: unknown;
}
export interface MethodContract56 {
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
export interface MethodContract55 {
  params: DictionaryListParams;
  result: DictionaryListResult;
  [k: string]: unknown;
}
export interface DictionaryListParams {
  locale: string;
  [k: string]: unknown;
}
export interface MethodContract120 {
  params: ExportDocumentParams;
  result: ExportDocumentResult;
  [k: string]: unknown;
}
export interface MethodContract119 {
  params: ExportDocxParams;
  result: ExportDocxResult;
  [k: string]: unknown;
}
export interface MethodContract22 {
  params: DocumentIdParams;
  result: Document;
  [k: string]: unknown;
}
export interface MethodContract23 {
  params: ImportDocumentParams;
  result: ImportDocumentResult;
  [k: string]: unknown;
}
export interface MethodContract24 {
  params: ImportDocxParams;
  result: Document;
  [k: string]: unknown;
}
export interface MethodContract21 {
  params: DocumentListParams;
  result: DocumentPage;
  [k: string]: unknown;
}
export interface MethodContract26 {
  params: DocumentReimportApplyParams;
  result: Document;
  [k: string]: unknown;
}
export interface DocumentReimportApplyParams {
  actor?: string;
  expectedDocumentRevision: number;
  previewId: string;
  [k: string]: unknown;
}
export interface MethodContract25 {
  params: DocumentReimportPreviewParams;
  result: DocumentReimportPreviewResult;
  [k: string]: unknown;
}
export interface DocumentReimportPreviewParams {
  actor?: string;
  documentId: string;
  expectedRevision: number;
  options?: {
    [k: string]: string;
  };
  sourcePath: string;
  [k: string]: unknown;
}
export interface DocumentReimportPreviewResult {
  candidateSourceSha256: string;
  createdAtMs: number;
  documentId: string;
  expectedDocumentRevision: number;
  plan: ReimportPlan;
  previewId: string;
  [k: string]: unknown;
}
export interface ReimportPlan {
  ambiguous: number;
  changed: number;
  items: ReimportMatch[];
  newSegments: number;
  removed: number;
  unchanged: number;
  [k: string]: unknown;
}
export interface ReimportMatch {
  disposition: ReimportDisposition;
  newOrdinal?: number | null;
  newSegmentId?: string | null;
  oldOrdinal?: number | null;
  oldSegmentId?: string | null;
  reason: string;
  [k: string]: unknown;
}
export interface MethodContract58 {
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
export interface MethodContract70 {
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
export interface MethodContract71 {
  params: UpdateEditorPreferencesParams;
  result: EditorPreferences;
  [k: string]: unknown;
}
export interface UpdateEditorPreferencesParams {
  preferences: EditorPreferences;
  [k: string]: unknown;
}
export interface MethodContract57 {
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
export interface MethodContract121 {
  params: EmptyParams;
  result: FilterListResult;
  [k: string]: unknown;
}
export interface MethodContract122 {
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
export interface MethodContract67 {
  params: ReviewApplyParams;
  result: InteropApplyResult;
  [k: string]: unknown;
}
export interface ReviewApplyParams {
  actor: string;
  expectedDocumentRevision: number;
  previewId: string;
  reason: string;
  selectedRowIds: string[];
  [k: string]: unknown;
}
export interface InteropApplyResult {
  appliedCount: number;
  commentIds: string[];
  currentRevision: number;
  operationId?: string | null;
  previewId: string;
  reviewIds: string[];
  skippedCount: number;
  status: InteropPreviewStatus;
  tmUnitIds: string[];
  [k: string]: unknown;
}
export interface MethodContract65 {
  params: ReviewExportParams;
  result: ReviewExportResult;
  [k: string]: unknown;
}
export interface ReviewExportParams {
  documentId: string;
  expectedDocumentRevision: number;
  outputPath: string;
  projectId: string;
  [k: string]: unknown;
}
export interface ReviewExportResult {
  manifestHash: string;
  outputPath: string;
  rowCount: number;
  [k: string]: unknown;
}
export interface MethodContract66 {
  params: ReviewPreviewParams;
  result: ReviewPreviewResult;
  [k: string]: unknown;
}
export interface ReviewPreviewParams {
  documentId: string;
  expectedDocumentRevision: number;
  inputPath?: string | null;
  limit?: number;
  offset?: number;
  previewId?: string | null;
  projectId: string;
  [k: string]: unknown;
}
export interface ReviewPreviewResult {
  documentId: string;
  expectedDocumentRevision: number;
  inputFormat: string;
  inputSha256: string;
  limit: number;
  manifestHash?: string | null;
  offset: number;
  previewId: string;
  projectId: string;
  rows: ReviewPreviewRow[];
  status: InteropPreviewStatus;
  total: number;
  [k: string]: unknown;
}
export interface ReviewPreviewRow {
  comments: string;
  currentComments: string;
  currentStatus: string;
  currentTarget: string;
  diagnostics: string[];
  disposition: ReviewInteropDisposition;
  expectedSegmentRevision?: number | null;
  ordinal: number;
  rowId: string;
  segmentId?: string | null;
  sourceHash: string;
  sourceRow: number;
  sourceText: string;
  statusContext: string;
  targetText: string;
  [k: string]: unknown;
}
export interface MethodContract69 {
  params: TableApplyParams;
  result: InteropApplyResult;
  [k: string]: unknown;
}
export interface TableApplyParams {
  actor: string;
  expectedLibraryRevision: number;
  previewId: string;
  reason: string;
  selectedRowIds: string[];
  [k: string]: unknown;
}
export interface MethodContract68 {
  params: TablePreviewParams;
  result: TablePreviewResult;
  [k: string]: unknown;
}
export interface TablePreviewParams {
  expectedLibraryRevision: number;
  format?: BilingualTableFormat | null;
  inputPath?: string | null;
  libraryId: string;
  limit?: number;
  offset?: number;
  previewId?: string | null;
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  [k: string]: unknown;
}
export interface TablePreviewResult {
  expectedLibraryRevision: number;
  inputFormat: string;
  inputSha256: string;
  libraryId: string;
  limit: number;
  offset: number;
  previewId: string;
  projectId: string;
  rows: TablePreviewRow[];
  sourceLocale: string;
  status: InteropPreviewStatus;
  targetLocale: string;
  total: number;
  [k: string]: unknown;
}
export interface TablePreviewRow {
  diagnostics: string[];
  disposition: TableInteropDisposition;
  metadata: {
    [k: string]: string;
  };
  ordinal: number;
  rowId: string;
  sourceHash: string;
  sourcePathHash: string;
  sourceRow: number;
  sourceText: string;
  structuralPath: string;
  targetText: string;
  [k: string]: unknown;
}
export interface MethodContract74 {
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
export interface MethodContract73 {
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
export interface MethodContract72 {
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
export interface MethodContract126 {
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
export interface MethodContract128 {
  params: PipelineIdParams;
  result: PipelineDefinition;
  [k: string]: unknown;
}
export interface PipelineIdParams {
  pipelineId: string;
  [k: string]: unknown;
}
export interface MethodContract127 {
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
export interface MethodContract130 {
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
export interface MethodContract133 {
  params: PipelineRunRevisionParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface PipelineRunRevisionParams {
  expectedRevision: number;
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract132 {
  params: PipelineRunIdParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface PipelineRunIdParams {
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract131 {
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
export interface MethodContract125 {
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
export interface MethodContract129 {
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
export interface MethodContract34 {
  params: ProjectAnalyticsParams;
  result: ProjectAnalyticsSummary;
  [k: string]: unknown;
}
export interface ProjectAnalyticsParams {
  idleGapMs?: number;
  projectId: string;
  trendBucketCount?: number;
  trendBucketMs?: number;
  [k: string]: unknown;
}
export interface ProjectAnalyticsSummary {
  ai: AiContributionSummary;
  assets: AssetHealthSummary;
  documentProgress: {
    [k: string]: ProgressSummary;
  };
  generatedAtMs: number;
  productivity: ProductivitySummary;
  progress: ProgressSummary;
  projectId: string;
  trends: AnalyticsTrendBucket[];
  [k: string]: unknown;
}
export interface AiContributionSummary {
  available: boolean;
  contribution: AiContribution;
  reason?: string | null;
  [k: string]: unknown;
}
export interface AssetHealthSummary {
  curationOutcomes: OptionalCountMetric;
  mountedLibraryHitSegments: OptionalCountMetric;
  qaOpenBlockers: number;
  termEntries: number;
  tmConfirmedUnits: number;
  tmReuseSegments: OptionalCountMetric;
  [k: string]: unknown;
}
export interface OptionalCountMetric {
  available: boolean;
  reason?: string | null;
  value?: number | null;
  [k: string]: unknown;
}
export interface ProgressSummary {
  completionBasisPoints: number;
  confirmedSegments: number;
  draftSegments: number;
  qaBlockers: number;
  reviewedSegments: number;
  totalSegments: number;
  untranslatedSegments: number;
  workflowReview: number;
  workflowSigned: number;
  workflowTranslation: number;
  [k: string]: unknown;
}
export interface ProductivitySummary {
  activeEditingMs: OptionalCountMetric;
  activityEvents: number;
  confirmedSegmentsPerHourMilli: OptionalCountMetric;
  idleGapMs: number;
  timeInStateMs: {
    [k: string]: OptionalCountMetric;
  };
  [k: string]: unknown;
}
export interface AnalyticsTrendBucket {
  confirmations: number;
  endMs: number;
  qaRunsCompleted: number;
  startMs: number;
  targetEdits: number;
  termsAdded: number;
  tmUnitsAdded: number;
  workflowTransitions: number;
  [k: string]: unknown;
}
export interface MethodContract14 {
  params: ProjectArchiveExportParams;
  result: ProjectArchiveResult;
  [k: string]: unknown;
}
export interface ProjectArchiveExportParams {
  actor?: string;
  destinationPath: string;
  projectId: string;
  [k: string]: unknown;
}
export interface ProjectArchiveResult {
  archivePath: string;
  archiveSha256: string;
  diagnostics: string[];
  projectId: string;
  [k: string]: unknown;
}
export interface MethodContract15 {
  params: ProjectArchiveRestoreParams;
  result: ProjectArchiveResult;
  [k: string]: unknown;
}
export interface ProjectArchiveRestoreParams {
  actor?: string;
  archivePath: string;
  dependencyRemaps?: {
    [k: string]: string;
  };
  [k: string]: unknown;
}
export interface MethodContract13 {
  params: ProjectBatchImportParams;
  result: ProjectBatchImportResult;
  [k: string]: unknown;
}
export interface ProjectBatchImportParams {
  atomicity?: "bestEffort" | "allOrNothing";
  filterId?: string | null;
  items: BatchImportItem[];
  options?: {
    [k: string]: string;
  };
  projectId: string;
  [k: string]: unknown;
}
export interface BatchImportItem {
  path: string;
  relativePath?: string | null;
  [k: string]: unknown;
}
export interface ProjectBatchImportResult {
  failed: number;
  items: BatchImportDiagnostic[];
  succeeded: number;
  [k: string]: unknown;
}
export interface BatchImportDiagnostic {
  document?: Document | null;
  errorCode?: string | null;
  message?: string | null;
  path: string;
  relativePath: string;
  status: string;
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
  aiProfileIds?: string[];
  analysisProfileId?: string | null;
  editorDefaults?: EditorPreferences | null;
  engineAllowlist?: string[];
  pipelineId?: string | null;
  qaProfileId?: string | null;
  reviewRequired?: boolean;
  taskPackage?: TaskPackageProjectReference | null;
  templateId?: string | null;
  [k: string]: unknown;
}
export interface TaskPackageProjectReference {
  instructions?: string;
  originProjectId: string;
  packageId: string;
  parentPackageId?: string | null;
  [k: string]: unknown;
}
export interface MethodContract12 {
  params: ProjectCreateFromTemplateParams;
  result: ProjectCreateFromTemplateResult;
  [k: string]: unknown;
}
export interface ProjectCreateFromTemplateParams {
  dependencyRemaps?: {
    [k: string]: string;
  };
  domain?: string | null;
  name: string;
  sourceLocale?: string | null;
  targetLocale?: string | null;
  templateId: string;
  templateRevision?: number | null;
  [k: string]: unknown;
}
export interface ProjectCreateFromTemplateResult {
  diagnostics: TemplateDependencyDiagnostic[];
  project: Project;
  [k: string]: unknown;
}
export interface TemplateDependencyDiagnostic {
  kind: string;
  message: string;
  requestedId: string;
  resolvedId?: string | null;
  status: string;
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
export interface MethodContract9 {
  params: ProjectTemplateCreateParams;
  result: ProjectTemplate;
  [k: string]: unknown;
}
export interface ProjectTemplateCreateParams {
  definition?: {
    [k: string]: unknown;
  };
  description?: string;
  name: string;
  [k: string]: unknown;
}
export interface ProjectTemplate {
  builtIn: boolean;
  createdAtMs: number;
  definition: unknown;
  description: string;
  id: string;
  name: string;
  revision: number;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface MethodContract11 {
  params: ProjectTemplateDeleteParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface ProjectTemplateDeleteParams {
  expectedRevision: number;
  templateId: string;
  [k: string]: unknown;
}
export interface MethodContract8 {
  params: ProjectTemplateGetParams;
  result: ProjectTemplate;
  [k: string]: unknown;
}
export interface ProjectTemplateGetParams {
  revision?: number | null;
  templateId: string;
  [k: string]: unknown;
}
export interface MethodContract7 {
  params: ProjectTemplateListParams;
  result: ProjectTemplatePage;
  [k: string]: unknown;
}
export interface ProjectTemplateListParams {
  limit?: number;
  offset?: number;
  [k: string]: unknown;
}
export interface ProjectTemplatePage {
  items: ProjectTemplate[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract10 {
  params: ProjectTemplateUpdateParams;
  result: ProjectTemplate;
  [k: string]: unknown;
}
export interface ProjectTemplateUpdateParams {
  definition?: {
    [k: string]: unknown;
  };
  description?: string;
  expectedRevision: number;
  name: string;
  templateId: string;
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
  aiProfileIds?: string[];
  analysisProfileId?: string | null;
  editorDefaults?: EditorPreferences | null;
  engineAllowlist?: string[];
  pipelineId?: string | null;
  qaProfileId?: string | null;
  reviewRequired?: boolean;
  taskPackage?: TaskPackageProjectReference | null;
  templateId?: string | null;
  [k: string]: unknown;
}
export interface MethodContract117 {
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
export interface MethodContract113 {
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
export interface MethodContract115 {
  params: QaIssueRevokeParams;
  result: QaIssueView;
  [k: string]: unknown;
}
export interface QaIssueRevokeParams {
  expectedRevision: number;
  issueId: string;
  [k: string]: unknown;
}
export interface MethodContract114 {
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
export interface MethodContract104 {
  params: ListQaParams;
  result: QaListResult;
  [k: string]: unknown;
}
export interface QaListResult {
  issues: QaIssue[];
  [k: string]: unknown;
}
export interface MethodContract118 {
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
export interface MethodContract107 {
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
export interface MethodContract106 {
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
export interface MethodContract109 {
  params: QaProfileDeleteParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface QaProfileDeleteParams {
  expectedRevision: number;
  profileId: string;
  [k: string]: unknown;
}
export interface MethodContract105 {
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
export interface MethodContract108 {
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
export interface MethodContract116 {
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
export interface MethodContract110 {
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
export interface MethodContract112 {
  params: QaRunIdParams;
  result: QaRun;
  [k: string]: unknown;
}
export interface QaRunIdParams {
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract111 {
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
export interface MethodContract103 {
  params: DocumentIdParams;
  result: QaListResult;
  [k: string]: unknown;
}
export interface MethodContract28 {
  params: RecycleDeleteParams;
  result: RecycleEntry;
  [k: string]: unknown;
}
export interface RecycleDeleteParams {
  actor?: string;
  entityId: string;
  entityType: string;
  expectedRevision: number;
  reason: string;
  retentionMs?: number | null;
  [k: string]: unknown;
}
export interface RecycleEntry {
  actor: string;
  deletedAtMs: number;
  displayName: string;
  entityId: string;
  entityType: string;
  id: string;
  previousState: string;
  projectId: string;
  purgedAtMs?: number | null;
  reason: string;
  restoredAtMs?: number | null;
  retentionUntilMs: number;
  [k: string]: unknown;
}
export interface MethodContract27 {
  params: RecycleListParams;
  result: RecyclePage;
  [k: string]: unknown;
}
export interface RecycleListParams {
  limit?: number;
  offset?: number;
  [k: string]: unknown;
}
export interface RecyclePage {
  items: RecycleEntry[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract29 {
  params: RecycleEntryActionParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface RecycleEntryActionParams {
  actor?: string;
  entryId: string;
  reason?: string;
  [k: string]: unknown;
}
export interface MethodContract61 {
  params: ReviewDecisionParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface ReviewDecisionParams {
  expectedSegmentRevision: number;
  reviewId: string;
  [k: string]: unknown;
}
export interface MethodContract59 {
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
export interface MethodContract60 {
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
export interface MethodContract63 {
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
export interface MethodContract62 {
  params: ReviewDecisionParams;
  result: ReviewRevision;
  [k: string]: unknown;
}
export interface MethodContract64 {
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
export interface MethodContract30 {
  params: GlobalSearchParams;
  result: GlobalSearchPage;
  [k: string]: unknown;
}
export interface GlobalSearchParams {
  fields?: string[];
  includeRecycled?: boolean;
  limit?: number;
  locale?: string | null;
  offset?: number;
  projectId?: string | null;
  text: string;
  updatedAfterMs?: number | null;
  updatedBeforeMs?: number | null;
  workflowState?: string | null;
  [k: string]: unknown;
}
export interface GlobalSearchPage {
  items: GlobalSearchHit[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface GlobalSearchHit {
  documentId?: string | null;
  documentName?: string | null;
  field: string;
  locale?: string | null;
  projectId: string;
  projectName: string;
  segmentId?: string | null;
  segmentOrdinal?: number | null;
  snippet: string;
  updatedAtMs: number;
  workflowState?: string | null;
  [k: string]: unknown;
}
export interface MethodContract40 {
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
export interface MethodContract50 {
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
export interface MethodContract53 {
  params: DeleteSegmentCommentParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface DeleteSegmentCommentParams {
  commentId: string;
  expectedRevision: number;
  [k: string]: unknown;
}
export interface MethodContract49 {
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
export interface MethodContract52 {
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
export interface MethodContract51 {
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
export interface MethodContract37 {
  params: ConfirmSegmentParams;
  result: ConfirmSegmentResult;
  [k: string]: unknown;
}
export interface MethodContract47 {
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
export interface MethodContract38 {
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
export interface MethodContract42 {
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
export interface MethodContract35 {
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
export interface MethodContract46 {
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
export interface MethodContract41 {
  params: PropagateSegmentParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface PropagateSegmentParams {
  expectedRevision: number;
  segmentId: string;
  [k: string]: unknown;
}
export interface MethodContract44 {
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
export interface MethodContract43 {
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
export interface MethodContract54 {
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
export interface MethodContract45 {
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
export interface MethodContract39 {
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
export interface MethodContract36 {
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
export interface MethodContract48 {
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
export interface MethodContract18 {
  params: TaskPackageApplyParams;
  result: TaskPackageApplyResult;
  [k: string]: unknown;
}
export interface TaskPackageApplyParams {
  actor: string;
  expectedProjectRevision: number;
  previewId: string;
  reason: string;
  selectedRowIds: string[];
  [k: string]: unknown;
}
export interface TaskPackageApplyResult {
  appliedCount: number;
  documentRevisions: {
    [k: string]: number;
  };
  operationId?: string | null;
  previewId: string;
  projectRevision: number;
  segmentIds: string[];
  selectedCount: number;
  skippedCount: number;
  status: string;
  [k: string]: unknown;
}
export interface MethodContract20 {
  params: TaskPackageDiscardParams;
  result: TaskPackageDiscardResult;
  [k: string]: unknown;
}
export interface TaskPackageDiscardParams {
  actor: string;
  packageId: string;
  previewId?: string | null;
  reason: string;
  [k: string]: unknown;
}
export interface TaskPackageDiscardResult {
  packageId: string;
  previewId?: string | null;
  removedStagedFile: boolean;
  status: string;
  [k: string]: unknown;
}
export interface MethodContract16 {
  params: TaskPackageExportParams;
  result: TaskPackageResult;
  [k: string]: unknown;
}
export interface TaskPackageExportParams {
  actor: string;
  assetSlices?: TaskPackageAssetSelection[];
  destinationPath: string;
  documents?: TaskPackageDocumentSelection[];
  expectedProjectRevision?: number | null;
  instructions?: string;
  kind: TaskPackageKind;
  parentPackageId?: string | null;
  projectId?: string | null;
  reason: string;
  workingProjectId?: string | null;
  [k: string]: unknown;
}
export interface TaskPackageAssetSelection {
  /**
   * `tm` or `termbase` (the `tb` alias is accepted by Engine).
   */
  kind: string;
  libraryId: string;
  rowIds?: string[];
  [k: string]: unknown;
}
export interface TaskPackageDocumentSelection {
  documentId: string;
  segmentIds?: string[];
  [k: string]: unknown;
}
export interface TaskPackageResult {
  kind: TaskPackageKind;
  manifestHash: string;
  packageId: string;
  packagePath: string;
  packageSha256: string;
  status: string;
  [k: string]: unknown;
}
export interface MethodContract19 {
  params: TaskPackageImportParams;
  result: TaskPackageImportResult;
  [k: string]: unknown;
}
export interface TaskPackageImportParams {
  actor: string;
  domain?: string | null;
  previewId: string;
  projectName?: string | null;
  reason: string;
  [k: string]: unknown;
}
export interface TaskPackageImportResult {
  bindingCount: number;
  documents: Document[];
  packageId: string;
  previewId: string;
  project: Project;
  [k: string]: unknown;
}
export interface MethodContract17 {
  params: TaskPackagePreviewParams;
  result: TaskPackagePreviewResult;
  [k: string]: unknown;
}
export interface TaskPackagePreviewParams {
  actor: string;
  limit?: number;
  offset?: number;
  packagePath?: string | null;
  previewId?: string | null;
  reason: string;
  [k: string]: unknown;
}
export interface TaskPackagePreviewResult {
  counts: TaskPackagePreviewCounts;
  diagnostics: TaskPackageDiagnostic[];
  expectedProjectRevision: number;
  kind: TaskPackageKind;
  limit: number;
  manifestHash: string;
  offset: number;
  packageId: string;
  previewId: string;
  projectId: string;
  rows: TaskPackagePreviewRow[];
  status: string;
  total: number;
  [k: string]: unknown;
}
export interface TaskPackagePreviewCounts {
  added: number;
  bothChanged: number;
  deleted: number;
  documentRevisions?: {
    [k: string]: number;
  };
  localChanged: number;
  missingDependency: number;
  remoteChanged: number;
  tagInvalid: number;
  total: number;
  unchanged: number;
  [k: string]: unknown;
}
export interface TaskPackageDiagnostic {
  code: string;
  message: string;
  rowId?: string | null;
  [k: string]: unknown;
}
export interface TaskPackagePreviewRow {
  baseHash?: string | null;
  baseProjection?: TaskPackageProjection | null;
  currentHash?: string | null;
  currentProjection?: TaskPackageProjection | null;
  currentRevision?: number | null;
  diagnosticCode?: string | null;
  disposition: TaskPackageDisposition;
  identicalChange: boolean;
  ordinal: number;
  originDocumentId: string;
  originSegmentId: string;
  reason: string;
  remoteHash?: string | null;
  remoteProjection?: TaskPackageProjection | null;
  remoteRevision?: number | null;
  rowId: string;
  safeToApply: boolean;
  selected: boolean;
  [k: string]: unknown;
}
export interface TaskPackageProjection {
  baseRevision: number;
  commentsJson?: string;
  ordinal: number;
  originDocumentId: string;
  originSegmentId: string;
  projectionHash: string;
  segmentState?: string;
  sourceHash: string;
  sourceText: string;
  structuralPath: string;
  tagsJson?: string;
  targetText?: string;
  workflowState?: string;
  [k: string]: unknown;
}
export interface MethodContract99 {
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
export interface MethodContract100 {
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
export interface MethodContract96 {
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
export interface MethodContract102 {
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
export interface MethodContract101 {
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
export interface MethodContract95 {
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
export interface MethodContract97 {
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
export interface MethodContract98 {
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
export interface MethodContract92 {
  params: ConcordanceParams;
  result: ConcordanceResult;
  [k: string]: unknown;
}
export interface MethodContract94 {
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
export interface MethodContract93 {
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
export interface MethodContract88 {
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
export interface MethodContract87 {
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
export interface MethodContract89 {
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
export interface MethodContract90 {
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
export interface MethodContract86 {
  params: ExactLookupParams;
  result: ExactLookupResult;
  [k: string]: unknown;
}
export interface MethodContract91 {
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
