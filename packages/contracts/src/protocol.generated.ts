/* eslint-disable -- Generated from the Rust protocol schema. Do not edit. */

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
  backup_result: BackupResult;
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
  update_project_params: UpdateProjectParams;
  update_target_params: UpdateTargetParams;
  validate_pipeline_params: ValidatePipelineParams;
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
  "data.checkHealth": MethodContract21;
  "data.createBackup": MethodContract22;
  "document.export": MethodContract18;
  "document.exportDocx": MethodContract17;
  "document.get": MethodContract8;
  "document.import": MethodContract9;
  "document.importDocx": MethodContract10;
  "document.list": MethodContract7;
  "engine.initialize": MethodContract;
  "filter.list": MethodContract19;
  "history.list": MethodContract20;
  "pipeline.create": MethodContract24;
  "pipeline.get": MethodContract26;
  "pipeline.list": MethodContract25;
  "pipeline.run": MethodContract28;
  "pipeline.run.cancel": MethodContract31;
  "pipeline.run.get": MethodContract30;
  "pipeline.run.list": MethodContract29;
  "pipeline.run.resume": MethodContract31;
  "pipeline.step.list": MethodContract23;
  "pipeline.validate": MethodContract27;
  "project.create": MethodContract2;
  "project.get": MethodContract3;
  "project.list": MethodContract4;
  "project.setLifecycle": MethodContract6;
  "project.update": MethodContract5;
  "qa.list": MethodContract16;
  "qa.runDocument": MethodContract15;
  "segment.confirm": MethodContract13;
  "segment.list": MethodContract11;
  "segment.updateTarget": MethodContract12;
  "tm.lookupExact": MethodContract14;
}
export interface MethodContract21 {
  params: EmptyParams;
  result: DataHealthReport;
  [k: string]: unknown;
}
export interface MethodContract22 {
  params: CreateBackupParams;
  result: BackupResult;
  [k: string]: unknown;
}
export interface MethodContract18 {
  params: ExportDocumentParams;
  result: ExportDocumentResult;
  [k: string]: unknown;
}
export interface MethodContract17 {
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
export interface MethodContract19 {
  params: EmptyParams;
  result: FilterListResult;
  [k: string]: unknown;
}
export interface MethodContract20 {
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
export interface MethodContract24 {
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
export interface MethodContract26 {
  params: PipelineIdParams;
  result: PipelineDefinition;
  [k: string]: unknown;
}
export interface PipelineIdParams {
  pipelineId: string;
  [k: string]: unknown;
}
export interface MethodContract25 {
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
export interface MethodContract28 {
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
export interface MethodContract31 {
  params: PipelineRunRevisionParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface PipelineRunRevisionParams {
  expectedRevision: number;
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract30 {
  params: PipelineRunIdParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface PipelineRunIdParams {
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract29 {
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
export interface MethodContract23 {
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
export interface MethodContract27 {
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
export interface MethodContract16 {
  params: ListQaParams;
  result: QaListResult;
  [k: string]: unknown;
}
export interface QaListResult {
  issues: QaIssue[];
  [k: string]: unknown;
}
export interface MethodContract15 {
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
export interface MethodContract14 {
  params: ExactLookupParams;
  result: ExactLookupResult;
  [k: string]: unknown;
}
export interface RpcError {
  code: ErrorCode;
  data?: unknown;
  message: string;
  [k: string]: unknown;
}
