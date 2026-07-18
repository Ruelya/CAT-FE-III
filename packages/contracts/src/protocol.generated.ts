/* eslint-disable -- Generated from the Rust protocol schema. Do not edit. */

export type AssetExchangeFormat = "tmx" | "csv" | "tsv" | "tbx";
export type ConcordanceSide = "source" | "target" | "both";
export type QaSeverity = "error" | "warning" | "info";
export type QaIssueStatus = "open" | "resolved";
export type SegmentState = "untranslated" | "draft" | "confirmed";
export type HealthSeverity = "info" | "warning" | "error" | "fatal";
export type DegradationSeverity = "warning" | "error";
export type DocumentStatus = "active" | "failed" | "superseded";
export type PipelineRunStatus =
  "queued" | "running" | "canceling" | "canceled" | "interrupted" | "succeeded" | "failed";
export type PipelineStepStatus =
  "pending" | "running" | "canceled" | "interrupted" | "succeeded" | "failed" | "skipped";
export type ArtifactKind = "none" | "project" | "document" | "segments" | "qaFindings" | "json";
export type ProjectLifecycle = "active" | "archived" | "trash";
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
  qa_list_result: QaListResult;
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
  "data.checkHealth": MethodContract37;
  "data.createBackup": MethodContract38;
  "document.export": MethodContract34;
  "document.exportDocx": MethodContract33;
  "document.get": MethodContract8;
  "document.import": MethodContract9;
  "document.importDocx": MethodContract10;
  "document.list": MethodContract7;
  "engine.initialize": MethodContract;
  "filter.list": MethodContract35;
  "history.list": MethodContract36;
  "pipeline.create": MethodContract40;
  "pipeline.get": MethodContract42;
  "pipeline.list": MethodContract41;
  "pipeline.run": MethodContract44;
  "pipeline.run.cancel": MethodContract47;
  "pipeline.run.get": MethodContract46;
  "pipeline.run.list": MethodContract45;
  "pipeline.run.resume": MethodContract47;
  "pipeline.step.list": MethodContract39;
  "pipeline.validate": MethodContract43;
  "project.create": MethodContract2;
  "project.get": MethodContract3;
  "project.list": MethodContract4;
  "project.setLifecycle": MethodContract6;
  "project.update": MethodContract5;
  "qa.list": MethodContract32;
  "qa.runDocument": MethodContract31;
  "segment.confirm": MethodContract13;
  "segment.list": MethodContract11;
  "segment.updateTarget": MethodContract12;
  "term.search": MethodContract27;
  "term.upsert": MethodContract28;
  "termbase.create": MethodContract24;
  "termbase.export": MethodContract30;
  "termbase.import": MethodContract29;
  "termbase.list": MethodContract23;
  "termbase.mount": MethodContract25;
  "termbase.unmount": MethodContract26;
  "tm.concordance": MethodContract20;
  "tm.export": MethodContract22;
  "tm.import": MethodContract21;
  "tm.library.create": MethodContract16;
  "tm.library.list": MethodContract15;
  "tm.library.mount": MethodContract17;
  "tm.library.unmount": MethodContract18;
  "tm.lookupExact": MethodContract14;
  "tm.search": MethodContract19;
}
export interface MethodContract37 {
  params: EmptyParams;
  result: DataHealthReport;
  [k: string]: unknown;
}
export interface MethodContract38 {
  params: CreateBackupParams;
  result: BackupResult;
  [k: string]: unknown;
}
export interface MethodContract34 {
  params: ExportDocumentParams;
  result: ExportDocumentResult;
  [k: string]: unknown;
}
export interface MethodContract33 {
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
export interface MethodContract {
  params: InitializeParams;
  result: InitializeResult;
  [k: string]: unknown;
}
export interface MethodContract35 {
  params: EmptyParams;
  result: FilterListResult;
  [k: string]: unknown;
}
export interface MethodContract36 {
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
export interface MethodContract40 {
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
export interface MethodContract42 {
  params: PipelineIdParams;
  result: PipelineDefinition;
  [k: string]: unknown;
}
export interface PipelineIdParams {
  pipelineId: string;
  [k: string]: unknown;
}
export interface MethodContract41 {
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
export interface MethodContract44 {
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
export interface MethodContract47 {
  params: PipelineRunRevisionParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface PipelineRunRevisionParams {
  expectedRevision: number;
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract46 {
  params: PipelineRunIdParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface PipelineRunIdParams {
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract45 {
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
export interface MethodContract39 {
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
export interface MethodContract43 {
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
  templateId?: string | null;
  [k: string]: unknown;
}
export interface MethodContract32 {
  params: ListQaParams;
  result: QaListResult;
  [k: string]: unknown;
}
export interface QaListResult {
  issues: QaIssue[];
  [k: string]: unknown;
}
export interface MethodContract31 {
  params: DocumentIdParams;
  result: QaListResult;
  [k: string]: unknown;
}
export interface MethodContract13 {
  params: ConfirmSegmentParams;
  result: ConfirmSegmentResult;
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
export interface MethodContract27 {
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
export interface MethodContract28 {
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
export interface MethodContract24 {
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
export interface MethodContract30 {
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
export interface MethodContract29 {
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
export interface MethodContract23 {
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
export interface MethodContract25 {
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
export interface MethodContract26 {
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
export interface EmptyResult {
  [k: string]: unknown;
}
export interface MethodContract20 {
  params: ConcordanceParams;
  result: ConcordanceResult;
  [k: string]: unknown;
}
export interface MethodContract22 {
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
export interface MethodContract21 {
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
export interface MethodContract16 {
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
export interface MethodContract15 {
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
export interface MethodContract17 {
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
export interface MethodContract18 {
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
export interface MethodContract14 {
  params: ExactLookupParams;
  result: ExactLookupResult;
  [k: string]: unknown;
}
export interface MethodContract19 {
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
