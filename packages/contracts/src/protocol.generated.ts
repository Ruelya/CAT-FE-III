/* eslint-disable -- Generated from the Rust protocol schema. Do not edit. */

export type QualityRoute = "auto" | "review" | "human";
export type SemanticSeverity = "info" | "warning" | "error";
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
export type CurationState = "active" | "quarantined";
export type AssetCatalogKind = "all" | "tm" | "termbase" | "corpus";
export type AssetExchangeFormat = "tmx" | "csv" | "tsv" | "tbx";
export type CollabAssignmentStatus = "open" | "completed" | "canceled";
export type CollabRole = "owner" | "member";
export type ReferenceCorpusKind = "monolingualSource" | "monolingualTarget" | "bilingual";
export type ReferenceCorpusSourceKind = "file" | "alignment";
export type ReferenceCorpusStatus = "active" | "removed";
export type CorpusMatchKind = "exact" | "prefix" | "contains";
export type CorpusMatchedSide = "source" | "target" | "both";
export type ConcordanceSide = "source" | "target" | "both";
export type SegmentState = "untranslated" | "draft" | "confirmed";
export type QaSeverity = "error" | "warning" | "info";
export type QaIssueStatus = "open" | "resolved";
export type CurationExportFormat = "jsonl" | "tsv";
export type CurationRecommendation = "keep" | "review" | "quarantine";
export type CurationFindingKind =
  | "exactDuplicate"
  | "nearDuplicate"
  | "competingTranslation"
  | "sourceEqualsTarget"
  | "minimumLength"
  | "lengthRatio"
  | "numberMismatch"
  | "dateMismatch"
  | "placeholderMismatch"
  | "createdOutsideRange"
  | "likelyWrongLanguage"
  | "semanticMismatch";
export type CurationSeverity = "info" | "warning" | "error";
export type CurationRunStatus = "open" | "applied" | "rolledBack" | "discarded";
export type CurationRunMode = "offline" | "provider";
export type HealthSeverity = "info" | "warning" | "error" | "fatal";
export type DiscussionScope = "project" | "document" | "segment";
export type DiscussionStatus = "open" | "resolved";
export type DegradationSeverity = "warning" | "error";
export type DocumentStatus = "active" | "failed" | "superseded";
export type EditorSuggestionSource = "nonTranslatable" | "term" | "memoryFragment";
export type AiBatchStatus =
  "queued" | "running" | "interrupted" | "canceling" | "canceled" | "succeeded" | "completedWithErrors" | "failed";
export type AiBatchItemStatus =
  "pending" | "tmApplied" | "running" | "succeeded" | "retrying" | "failed" | "skipped" | "canceled";
export type AiConversationRole = "user" | "assistant";
export type AiAction =
  "translate" | "improve" | "formal" | "conversational" | "shorten" | "expand" | "literal" | "freeform";
export type AiMessageRole = "system" | "user" | "assistant";
export type AiConnectorAvailability = "available" | "unavailable" | "degraded";
export type EngineConnectorConfigValueV1 = string | boolean | number;
export type EngineConnectorConfigFieldTypeV1 = "text" | "boolean" | "integer" | "select";
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
export type EngineConnectorOperation = "validateConfig" | "test" | "models.list" | "generate";
export type AiProviderProtocol =
  "openaiChatCompletions" | "anthropicMessages" | "geminiGenerateContent" | "deeplTranslate";
export type EngineConnectorSource =
  | {
      kind: "builtin";
      provider: AiProviderKind;
    }
  | {
      contractVersion: number;
      contributionId: string;
      kind: "plugin";
      owner: PluginConnectorOwner;
    };
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
export type PluginContributionState = "active" | "detached" | "degraded";
export type InteropPreviewStatus = "open" | "applied" | "discarded";
export type ReviewInteropDisposition = "changed" | "unchanged" | "missing" | "added" | "invalid";
export type BilingualTableFormat = "docx" | "xlsx";
export type TableInteropDisposition = "valid" | "duplicate" | "invalid";
export type PipelineRunStatus =
  "queued" | "running" | "canceling" | "canceled" | "interrupted" | "succeeded" | "failed";
export type PipelineStepPluginOperation = "execute" | "resume" | "checkpointMigrate";
export type PipelineStepOwner =
  | {
      kind: "builtin";
      [k: string]: unknown;
    }
  | {
      activationRevision: number;
      checkpointSchemaVersion?: number | null;
      configSchemaVersion: number;
      contributionId: string;
      contributionVersion: string;
      descriptorHash: string;
      descriptorVersion: number;
      kind: "plugin";
      operationProtocolVersion: number;
      pluginId: string;
      tier: PluginPipelineTier;
      versionId: string;
      [k: string]: unknown;
    };
export type PluginPipelineTier = "declarative" | "sandbox" | "process";
export type PipelineStepStatus =
  "pending" | "running" | "canceled" | "interrupted" | "succeeded" | "failed" | "skipped";
export type ArtifactKind = "none" | "project" | "document" | "segments" | "qaFindings" | "json";
export type PluginAiActionHistoryStatus = "succeeded" | "failed" | "cancelled" | "timeout" | "stale_activation";
export type PublicConfigFieldTypeV1 = "text" | "boolean" | "integer" | "number" | "select" | "json";
export type AiActionInputFieldV1 =
  "selectionText" | "segmentText" | "sourceText" | "sourceLocale" | "targetLocale" | "tags";
export type AiActionResultModeV1 = "replaceSelection" | "replaceTarget" | "assistantContent";
export type AiActionProposalV1 =
  | {
      kind: "replaceSelection";
      text: string;
    }
  | {
      kind: "replaceTarget";
      text: string;
    }
  | {
      content: string;
      kind: "assistantContent";
    };
export type PluginBundledApplyAction = "installed" | "upgraded" | "unchanged";
export type PluginContributionDescriptor =
  | {
      capabilities: FilterCapabilities;
      declarative?: DeclarativeFilterDefinitionV1 | null;
      descriptorVersion: number;
      displayName: string;
      extensions: string[];
      id: string;
      kind: "filter";
      version: string;
    }
  | {
      configSchema?: EngineConnectorConfigSchemaV1 | null;
      configSchemaVersion: number;
      /**
       * Absent only on the released inventory-only descriptor. Such a
       * descriptor remains readable but is never executable.
       */
      contractVersion?: number | null;
      declarative?: DeclarativeEngineConnectorDefinitionV1 | null;
      descriptorVersion: number;
      displayName: string;
      id: string;
      kind: "engineConnector";
      limits?: EngineConnectorLimitsV1 | null;
      operations: string[];
      protocol: string;
      version: string;
    }
  | {
      categories?: QaCategory[];
      config?: unknown;
      configSchema?: PublicConfigSchemaV1 | null;
      configSchemaVersion?: number | null;
      declarative?: DeclarativeQaPackDefinitionV1 | null;
      definition: QaRuleDefinitionV1;
      descriptorVersion: number;
      displayName: string;
      id: string;
      kind: "qaRule";
      limits?: QaRuleLimitsV1 | null;
      operationProtocolVersion?: number | null;
      ruleKind?: QaRuleKindV1 | null;
      ruleType: string;
      severity: string;
      version: string;
    }
  | {
      cancellable: boolean;
      checkpointSchemaVersion?: number | null;
      configSchema?: PublicConfigSchemaV1 | null;
      configSchemaVersion: number;
      declarative?: DeclarativePipelineDefinitionV1 | null;
      descriptorVersion: number;
      displayName: string;
      id: string;
      input: ArtifactKind;
      kind: "pipelineStep";
      limits?: PipelineStepLimitsV1 | null;
      operationProtocolVersion?: number | null;
      output: ArtifactKind;
      resumable: boolean;
      version: string;
    }
  | {
      configSchema?: PublicConfigSchemaV1 | null;
      configSchemaVersion?: number | null;
      descriptorVersion: number;
      displayName: string;
      id: string;
      /**
       * Legacy inventory metadata. Executable V1 descriptors still carry an object here.
       */
      input: {
        [k: string]: unknown;
      };
      inputFields?: AiActionInputFieldV1[];
      kind: "aiAction";
      label: string;
      limits?: AiActionLimitsV1 | null;
      operationProtocolVersion?: number | null;
      /**
       * Kept as text so released inventory-only descriptors remain readable.
       */
      placement: string;
      promptTemplate?: string;
      resultModes?: AiActionResultModeV1[];
      version: string;
    }
  | {
      bridgeVersion: number;
      contractVersion?: number | null;
      descriptorVersion: number;
      displayName: string;
      id: string;
      kind: "uiPanel";
      label: string;
      methods?: UiPanelBridgeMethodV1[];
      order?: number;
      /**
       * Kept as text so released inventory-only descriptors remain readable.
       */
      placement: string;
      surface: string;
      version: string;
    }
  | {
      capabilities: {
        [k: string]: boolean;
      };
      checkpointSchemaVersion?: number | null;
      checkpointVersion: number;
      configSchema?: EngineConnectorConfigSchemaV1 | null;
      configSchemaVersion?: number | null;
      contractVersion?: number | null;
      credentialSlots?: ExternalConnectorCredentialSlotV1[] | null;
      declarative?: DeclarativeExternalConnectorDefinitionV1 | null;
      descriptorVersion: number;
      displayName: string;
      id: string;
      kind: "externalConnector";
      limits?: ExternalConnectorLimitsV1 | null;
      operations?: ExternalConnectorOperationV1[] | null;
      origins?: string[] | null;
      /**
       * Absent only on the released inventory-only descriptor. Such a
       * descriptor remains readable but is never executable.
       */
      protocol?: string | null;
      /**
       * Inventory-era transport list. Executable V1 still serializes a stable
       * inventory projection derived from declared origins/operations.
       */
      transports: string[];
      version: string;
    };
export type DeclarativeTextEncoding = "utf8";
export type DeclarativeConnectorAuthenticationV1 =
  | {
      kind: "none";
    }
  | {
      kind: "bearer";
    }
  | {
      kind: "header";
      name: string;
    };
export type DeclarativeConnectorHttpMethodV1 = "POST";
export type EngineConnectorFailureCodeV1 =
  | "invalidConfig"
  | "authentication"
  | "rateLimit"
  | "timeout"
  | "unavailable"
  | "protocol"
  | "responseSize"
  | "cancelled"
  | "hostCrash";
export type DeclarativeConnectorResponseMappingV1 =
  | {
      finishReasonPath?: string[] | null;
      kind: "json";
      textPath: string[];
      usage?: DeclarativeConnectorUsageMappingV1 | null;
    }
  | {
      deltaPath: string[];
      doneMarker: string;
      finishReasonPath?: string[] | null;
      kind: "serverSentEvents";
      maxLineBytes: number;
      usage?: DeclarativeConnectorUsageMappingV1 | null;
    };
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
export type QaField = "source" | "target" | "both";
export type QaRuleKindV1 = "mechanical";
export type DeclarativePipelineOperation =
  | {
      operation: "select";
      path: string[];
    }
  | {
      operation: "set";
      path: string[];
      value: unknown;
    }
  | {
      equals: unknown;
      operation: "assert";
      path: string[];
    }
  | {
      maxReplacements: number;
      operation: "regexReplace";
      path: string[];
      pattern: string;
      replacement: string;
    };
export type UiPanelBridgeMethodV1 = "panelContext" | "activeSelection" | "projectContext" | "proposeReplacement";
export type ExternalConnectorOperationV1 = "validateConfig" | "test" | "pull" | "push" | "poll" | "webhook";
export type ExternalConnectorFailureCodeV1 =
  | "invalidConfig"
  | "authentication"
  | "conflict"
  | "rateLimit"
  | "timeout"
  | "unavailable"
  | "protocol"
  | "payloadSize"
  | "cancelled"
  | "hostCrash"
  | "permissionDenied"
  | "staleGeneration"
  | "idempotencyConflict";
export type ExternalConnectorAuthenticationV1 =
  | {
      kind: "none";
    }
  | {
      kind: "bearer";
      slot: string;
    }
  | {
      kind: "header";
      name: string;
      slot: string;
    }
  | {
      kind: "query";
      name: string;
      slot: string;
    };
export type ExternalConnectorHttpMethodV1 = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ExternalConnectorWebhookSignatureV1 =
  | {
      kind: "none";
    }
  | {
      header: string;
      kind: "hmacSha256";
      prefix?: string | null;
      slot: string;
    };
export type PluginDiagnosticSeverity = "info" | "warning" | "error";
export type PluginRuntimeDescriptor =
  | {
      entry: PluginDeclarativeEntry;
      runtimeVersion: number;
      tier: "declarative";
    }
  | {
      entry: PluginSandboxEntry;
      runtimeVersion: number;
      tier: "sandbox";
    }
  | {
      entry: PluginProcessEntry;
      protocolVersion: number;
      runtimeVersion: number;
      tier: "process";
    };
export type PluginDeclarativeEntry = {
  kind: "manifest";
};
export type PluginSandboxEntry = {
  exportName?: string | null;
  kind: "javascript";
  path: string;
};
export type PluginProcessEntry =
  | {
      kind: "node";
      path: string;
    }
  | {
      kind: "executable";
      path: string;
    };
export type PluginStatus = "installed" | "enabled" | "disabled" | "degraded";
export type PluginTier = "declarative" | "sandbox" | "process";
export type PluginBundledInstallState = "available" | "installed" | "updateAvailable" | "current";
export type PluginCapabilityId = string;
export type PluginFileArea = "source" | "output";
export type PluginCapabilityAuditEvent =
  "requested" | "granted" | "denied" | "revoked" | "carried" | "operation_allowed" | "operation_denied" | "detached";
export type PluginCapabilityScope =
  | {
      kind: "unscoped";
    }
  | {
      areas: PluginFileArea[];
      kind: "file";
    }
  | {
      kind: "network";
      origins: string[];
    }
  | {
      kind: "projects";
      projectIds: string[];
    }
  | {
      assetIds: string[];
      kind: "assets";
      projectIds: string[];
    }
  | {
      kind: "operations";
      operations: string[];
    }
  | {
      contributionIds: string[];
      kind: "contributions";
    }
  | {
      categories: string[];
      kind: "diagnostics";
    };
export type PluginCapabilityDecision = "pending" | "granted" | "denied" | "revoked";
export type PluginCapabilityRisk = "low" | "medium" | "high" | "critical";
export type PluginCapabilityChangeKind = "added" | "expanded" | "narrowed" | "unchanged" | "removed";
export type PluginLifecycleAction = "upgraded" | "rolledBack";
export type PluginVersionState = "validated" | "failed";
export type ProjectLifecycle = "active" | "archived" | "trash";
export type ProjectSnapshotPreviewStatus = "open" | "applied";
export type QaRuleExecutionStatus = "succeeded" | "failed" | "canceled";
export type QaRunScope = "document" | "project";
export type QaRunStatus = "running" | "succeeded" | "failed";
export type QaIssueDisposition = "open" | "waived" | "resolved";
export type QaOverrideStatus = "pending" | "succeeded" | "failed";
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
/**
 * Host-derived package provenance. Never trusted from a manifest or renderer.
 */
export type PluginPackageSourceKind = "localDirectory" | "localArchive" | "bundled";
export type ErrorCode =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "invalid_state"
  | "policy_denied"
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
  | "plugin_invalid_manifest"
  | "plugin_unsupported_version"
  | "plugin_incompatible_host"
  | "plugin_capability_unsupported"
  | "plugin_conflict"
  | "plugin_package_invalid"
  | "plugin_package_hash_mismatch"
  | "plugin_upgrade_failed"
  | "plugin_permission_denied"
  | "plugin_process_failed"
  | "plugin_sandbox_failed"
  | "internal_error";

export interface ProtocolCatalog {
  ai_quality_document_params: AiQualityDocumentParams;
  ai_quality_score_result: QualityScoreReport;
  ai_semantic_qa_result: SemanticQaReport;
  ai_term_extract_params: AiTermExtractParams;
  ai_term_extract_result: TermExtractReport;
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
  asset_catalog_item: AssetCatalogItem;
  asset_catalog_list_params: AssetCatalogListParams;
  asset_catalog_page: AssetCatalogPage;
  asset_diagnostic: AssetDiagnostic;
  asset_exchange_format: AssetExchangeFormat;
  backup_result: BackupResult;
  collab_assignment: CollabAssignment;
  collab_lock: CollabLock;
  collab_member: CollabMember;
  collab_op_log_page: CollabOpLogPage;
  collab_presence: CollabPresence;
  collab_project_params: CollabProjectParams;
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
  curation_apply_params: CurationApplyParams;
  curation_export_params: CurationExportParams;
  curation_export_result: CurationExportResult;
  curation_finding_list_params: CurationFindingListParams;
  curation_finding_page: CurationFindingPage;
  curation_mutation_result: CurationMutationResult;
  curation_rollback_params: CurationRollbackParams;
  curation_run_id_params: CurationRunIdParams;
  curation_run_params: CurationRunParams;
  curation_run_snapshot: CurationRunSnapshot;
  data_health_report: DataHealthReport;
  discussion_message: DiscussionMessage;
  discussion_message_create_params: DiscussionMessageCreateParams;
  discussion_message_delete_params: DiscussionMessageDeleteParams;
  discussion_message_list_params: DiscussionMessageListParams;
  discussion_message_page: DiscussionMessagePage;
  discussion_message_update_params: DiscussionMessageUpdateParams;
  discussion_thread: DiscussionThread;
  discussion_thread_create_params: DiscussionThreadCreateParams;
  discussion_thread_list_params: DiscussionThreadListParams;
  discussion_thread_page: DiscussionThreadPage;
  discussion_thread_resolve_params: DiscussionThreadResolveParams;
  document_id_params: DocumentIdParams;
  document_list_params: DocumentListParams;
  document_page: DocumentPage;
  editor_suggest_params: EditorSuggestParams;
  editor_suggest_result: EditorSuggestResult;
  editor_suggestion: EditorSuggestion;
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
  named_project_snapshot: NamedProjectSnapshot;
  normalized_plugin_manifest: NormalizedPluginManifest;
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
  plugin_api_range: PluginApiRange;
  plugin_bundled_apply_action: PluginBundledApplyAction;
  plugin_bundled_apply_params: PluginBundledApplyParams;
  plugin_bundled_apply_result: PluginBundledApplyResult;
  plugin_bundled_install_state: PluginBundledInstallState;
  plugin_bundled_list_params: PluginBundledListParams;
  plugin_bundled_page: PluginBundledPage;
  plugin_bundled_summary: PluginBundledSummary;
  plugin_compatibility: PluginCompatibility;
  plugin_contribution_descriptor: PluginContributionDescriptor;
  plugin_diagnostic: PluginDiagnostic;
  plugin_distribution_metadata: PluginDistributionMetadata;
  plugin_id_params: PluginIdParams;
  plugin_inspect_params: PluginInspectParams;
  plugin_inspection: PluginInspection;
  plugin_install_params: PluginInstallParams;
  plugin_lifecycle_result: PluginLifecycleResult;
  plugin_list_params: PluginListParams;
  plugin_mutation_params: PluginMutationParams;
  plugin_mutation_result: PluginMutationResult;
  plugin_package_source_kind: PluginPackageSourceKind;
  plugin_page: PluginPage;
  plugin_rollback_params: PluginRollbackParams;
  plugin_runtime_descriptor: PluginRuntimeDescriptor;
  plugin_summary: PluginSummary;
  plugin_upgrade_params: PluginUpgradeParams;
  plugin_version_list_params: PluginVersionListParams;
  plugin_version_page: PluginVersionPage;
  plugin_version_summary: PluginVersionSummary;
  project_analytics_params: ProjectAnalyticsParams;
  project_create_from_template_params: ProjectCreateFromTemplateParams;
  project_id_params: ProjectIdParams;
  project_list_params: ProjectListParams;
  project_page: ProjectPage;
  project_snapshot: ProjectSnapshot;
  project_snapshot_change_summary: ProjectSnapshotChangeSummary;
  project_snapshot_create_params: ProjectSnapshotCreateParams;
  project_snapshot_get_params: ProjectSnapshotGetParams;
  project_snapshot_list_params: ProjectSnapshotListParams;
  project_snapshot_page: ProjectSnapshotPage;
  project_snapshot_preview: ProjectSnapshotPreview;
  project_snapshot_preview_restore_params: ProjectSnapshotPreviewRestoreParams;
  project_snapshot_restore_params: ProjectSnapshotRestoreParams;
  project_snapshot_restore_result: ProjectSnapshotRestoreResult;
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
export interface AiQualityDocumentParams {
  documentId: string;
}
export interface QualityScoreReport {
  autoCount: number;
  documentId: string;
  humanCount: number;
  reviewCount: number;
  scores: SegmentQualityScore[];
  [k: string]: unknown;
}
export interface SegmentQualityScore {
  factors: ScoreFactor[];
  ordinal: number;
  route: QualityRoute;
  score: number;
  segmentId: string;
  [k: string]: unknown;
}
export interface ScoreFactor {
  code: string;
  delta: number;
  message: string;
  [k: string]: unknown;
}
export interface SemanticQaReport {
  documentId: string;
  findings: SemanticFinding[];
  [k: string]: unknown;
}
export interface SemanticFinding {
  code: string;
  confidenceBasisPoints: number;
  evidence: string;
  message: string;
  ordinal: number;
  segmentId: string;
  severity: SemanticSeverity;
  [k: string]: unknown;
}
export interface AiTermExtractParams {
  documentId: string;
  maximumCandidates?: number | null;
  minimumFrequency?: number | null;
}
export interface TermExtractReport {
  candidates: TermCandidate[];
  documentId: string;
  [k: string]: unknown;
}
export interface TermCandidate {
  exampleSegmentIds: string[];
  frequency: number;
  sourceTerm: string;
  suggestedTarget?: string | null;
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
  reason?: string;
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
  reason?: string;
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
  reason?: string;
  sessionId: string;
}
export interface AlignmentSessionUpdateParams {
  actor?: string;
  correlationId?: string | null;
  expectedSessionRevision: number;
  mutation: AlignmentSessionMutation;
  reason?: string;
  sessionId: string;
}
export interface AlignmentManualLink {
  sourceSegmentIds: string[];
  targetSegmentIds: string[];
}
export interface AssetCatalogItem {
  collectionId: string;
  collectionName: string;
  createdAtMs: number;
  curationState?: CurationState | null;
  domain?: string | null;
  id: string;
  kind: AssetCatalogKind;
  originDocumentId?: string | null;
  originProjectId?: string | null;
  originSegmentId?: string | null;
  qualityScoreBasisPoints?: number | null;
  sourceLocale: string;
  sourceText: string;
  structuralPath?: string | null;
  targetLocale?: string | null;
  targetText: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface AssetCatalogListParams {
  createdAfterMs?: number | null;
  createdBeforeMs?: number | null;
  domain?: string | null;
  kind?: "all" | "tm" | "termbase" | "corpus";
  limit?: number;
  offset?: number;
  originDocumentId?: string | null;
  originProjectId?: string | null;
  projectId?: string | null;
  query?: string | null;
  sourceLocale?: string | null;
  targetLocale?: string | null;
}
export interface AssetCatalogPage {
  items: AssetCatalogItem[];
  limit: number;
  offset: number;
  total: number;
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
export interface CollabAssignment {
  assigneeActorId: string;
  createdAtMs: number;
  createdBy: string;
  documentId: string;
  dueAtMs?: number | null;
  id: string;
  ordinalEnd: number;
  ordinalStart: number;
  projectId: string;
  revision: number;
  status: CollabAssignmentStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface CollabLock {
  actorId: string;
  createdAtMs: number;
  documentId: string;
  expiresAtMs: number;
  projectId: string;
  revision: number;
  segmentId: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface CollabMember {
  actorId: string;
  createdAtMs: number;
  projectId: string;
  role: CollabRole;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface CollabOpLogPage {
  afterSequence: number;
  items: CollabOpLogEntry[];
  limit: number;
  total: number;
  [k: string]: unknown;
}
export interface CollabOpLogEntry {
  actorId: string;
  createdAtMs: number;
  id: string;
  kind: string;
  payload: unknown;
  projectId: string;
  sequence: number;
  [k: string]: unknown;
}
export interface CollabPresence {
  actorId: string;
  documentId?: string | null;
  expiresAtMs: number;
  projectId: string;
  segmentId?: string | null;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface CollabProjectParams {
  projectId: string;
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
  reason?: string;
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
  reason?: string;
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
  reason?: string;
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
export interface CurationApplyParams {
  actor?: string;
  correlationId?: string | null;
  expectedLibraryRevision: number;
  expectedRunRevision: number;
  reason?: string;
  runId: string;
  selectedFindingIds: string[];
}
export interface CurationExportParams {
  expectedLibraryRevision: number;
  expectedRunRevision: number;
  format: CurationExportFormat;
  minimumScoreBasisPoints?: number | null;
  outputPath: string;
  runId: string;
}
export interface CurationExportResult {
  bytesWritten: number;
  format: CurationExportFormat;
  libraryId: string;
  libraryRevision: number;
  outputPath: string;
  rowCount: number;
  runId: string;
  runRevision: number;
  sha256: string;
  [k: string]: unknown;
}
export interface CurationFindingListParams {
  limit?: number;
  offset?: number;
  runId: string;
}
export interface CurationFindingPage {
  items: CurationFinding[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface CurationFinding {
  canonicalUnitId?: string | null;
  createdAtMs: number;
  disposition: CurationRecommendation;
  evidence: CurationEvidence;
  explanation: string;
  fingerprint: string;
  id: string;
  kind: CurationFindingKind;
  libraryId: string;
  penaltyBasisPoints: number;
  qualityScoreBasisPoints: number;
  revision: number;
  runId: string;
  severity: CurationSeverity;
  unitId: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface CurationEvidence {
  metrics?: {
    [k: string]: number;
  };
  relatedUnitIds?: string[];
  sourceValues?: string[];
  targetValues?: string[];
  [k: string]: unknown;
}
export interface CurationMutationResult {
  changedUnitCount: number;
  libraryId: string;
  libraryRevision: number;
  operationId: string;
  quarantinedUnitCount: number;
  restoredUnitCount: number;
  runId: string;
  runRevision: number;
  status: CurationRunStatus;
  [k: string]: unknown;
}
export interface CurationRollbackParams {
  actor?: string;
  correlationId?: string | null;
  expectedLibraryRevision: number;
  expectedRunRevision: number;
  reason?: string;
  runId: string;
}
export interface CurationRunIdParams {
  limit?: number;
  offset?: number;
  runId: string;
}
export interface CurationRunParams {
  actor?: string;
  correlationId?: string | null;
  expectedLibraryRevision: number;
  libraryId: string;
  limit?: number;
  offset?: number;
  policy?: CurationPolicy;
  projectId: string;
  providerProfileId?: string | null;
  reason?: string;
}
export interface CurationPolicy {
  createdAfterMs?: number | null;
  createdBeforeMs?: number | null;
  maximumLengthRatioPercent: number;
  minimumChars: number;
  minimumLengthRatioPercent: number;
  minimumTermFrequency: number;
  nearDuplicateThreshold: number;
  quarantineThresholdBasisPoints: number;
  semanticAlignmentThresholdBasisPoints: number;
}
export interface CurationRunSnapshot {
  limit: number;
  offset: number;
  run: CurationRun;
  total: number;
  units: CurationRunUnit[];
  [k: string]: unknown;
}
export interface CurationRun {
  actor: string;
  baseLibraryRevision: number;
  completedAtMs?: number | null;
  createdAtMs: number;
  id: string;
  libraryId: string;
  mode: CurationRunMode;
  policy: CurationPolicy1;
  projectId: string;
  providerProfileId?: string | null;
  reason: string;
  revision: number;
  status: CurationRunStatus;
  summary: CurationRunSummary;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface CurationPolicy1 {
  createdAfterMs?: number | null;
  createdBeforeMs?: number | null;
  maximumLengthRatioPercent: number;
  minimumChars: number;
  minimumLengthRatioPercent: number;
  minimumTermFrequency: number;
  nearDuplicateThreshold: number;
  quarantineThresholdBasisPoints: number;
  semanticAlignmentThresholdBasisPoints: number;
}
export interface CurationRunSummary {
  analysis: CurationSummary;
  driftGroups: CurationDriftGroup[];
  termCandidates: CurationTermCandidate[];
  [k: string]: unknown;
}
export interface CurationSummary {
  analyzedUnits: number;
  driftGroupCount: number;
  findingCount: number;
  quarantineCandidates: number;
  termCandidateCount: number;
  unitsWithFindings: number;
  [k: string]: unknown;
}
export interface CurationDriftGroup {
  sourceKey: string;
  sourceText: string;
  targetVariants: string[];
  unitIds: string[];
  [k: string]: unknown;
}
export interface CurationTermCandidate {
  agreementBasisPoints: number;
  domain?: string | null;
  frequency: number;
  sourceLocale: string;
  sourceTerm: string;
  targetLocale: string;
  targetTerm: string;
  unitIds: string[];
  [k: string]: unknown;
}
export interface CurationRunUnit {
  createdAtMs: number;
  explanation: string[];
  libraryId: string;
  qualityScoreBasisPoints: number;
  recommendedAction: CurationRecommendation;
  runId: string;
  unitId: string;
  unitSnapshotHash: string;
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
export interface DiscussionMessage {
  actor: string;
  body: string;
  createdAtMs: number;
  deleted: boolean;
  id: string;
  mentions: string[];
  ordinal: number;
  revision: number;
  threadId: string;
  threadRevision: number;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface DiscussionMessageCreateParams {
  actor: string;
  body: string;
  expectedThreadRevision: number;
  reason: string;
  threadId: string;
  [k: string]: unknown;
}
export interface DiscussionMessageDeleteParams {
  actor: string;
  expectedRevision: number;
  messageId: string;
  reason: string;
  [k: string]: unknown;
}
export interface DiscussionMessageListParams {
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  threadId: string;
  [k: string]: unknown;
}
export interface DiscussionMessagePage {
  items: DiscussionMessage[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface DiscussionMessageUpdateParams {
  actor: string;
  body: string;
  expectedRevision: number;
  messageId: string;
  reason: string;
  [k: string]: unknown;
}
export interface DiscussionThread {
  createdAtMs: number;
  documentId?: string | null;
  id: string;
  messageCount: number;
  projectId: string;
  resolvedAtMs?: number | null;
  resolvedBy?: string | null;
  revision: number;
  scope: DiscussionScope;
  segmentId?: string | null;
  status: DiscussionStatus;
  title: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface DiscussionThreadCreateParams {
  actor: string;
  body: string;
  documentId?: string | null;
  expectedProjectRevision: number;
  projectId: string;
  reason: string;
  scope: DiscussionScope;
  segmentId?: string | null;
  title?: string;
  [k: string]: unknown;
}
export interface DiscussionThreadListParams {
  documentId?: string | null;
  includeResolved?: boolean;
  limit?: number;
  offset?: number;
  projectId: string;
  scope?: DiscussionScope | null;
  segmentId?: string | null;
  [k: string]: unknown;
}
export interface DiscussionThreadPage {
  items: DiscussionThread[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface DiscussionThreadResolveParams {
  actor: string;
  expectedRevision: number;
  reason: string;
  resolved: boolean;
  threadId: string;
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
/**
 * As-you-type completion request for the segment being edited.
 */
export interface EditorSuggestParams {
  /**
   * Caret position in characters, not bytes.
   */
  caret: number;
  limit?: number;
  projectId: string;
  segmentId: string;
  /**
   * Full target text as the editor currently holds it.
   */
  targetText: string;
  [k: string]: unknown;
}
export interface EditorSuggestResult {
  /**
   * Word being completed. Echoed so a late response can be discarded when
   * the translator has typed on past it.
   */
  prefix: string;
  suggestions: EditorSuggestion[];
  [k: string]: unknown;
}
export interface EditorSuggestion {
  hint: string;
  source: EditorSuggestionSource;
  text: string;
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
  "ai.batch.cancel": MethodContract218;
  "ai.batch.get": MethodContract215;
  "ai.batch.items": MethodContract217;
  "ai.batch.list": MethodContract216;
  "ai.batch.resume": MethodContract218;
  "ai.batch.start": MethodContract214;
  "ai.conversation.create": MethodContract224;
  "ai.conversation.list": MethodContract223;
  "ai.conversation.messages": MethodContract226;
  "ai.conversation.update": MethodContract225;
  "ai.credential.delete": MethodContract204;
  "ai.credential.status": MethodContract204;
  "ai.grounding.preview": MethodContract207;
  "ai.provider.catalog": MethodContract198;
  "ai.provider.create": MethodContract200;
  "ai.provider.delete": MethodContract202;
  "ai.provider.list": MethodContract199;
  "ai.provider.test": MethodContract203;
  "ai.provider.update": MethodContract201;
  "ai.quality.extractTerms": MethodContract222;
  "ai.quality.scoreDocument": MethodContract220;
  "ai.quality.semanticQa": MethodContract221;
  "ai.result.apply": MethodContract213;
  "ai.run.cancel": MethodContract212;
  "ai.run.events": MethodContract211;
  "ai.run.get": MethodContract209;
  "ai.run.list": MethodContract210;
  "ai.run.resume": MethodContract212;
  "ai.run.start": MethodContract208;
  "ai.settings.get": MethodContract205;
  "ai.settings.update": MethodContract206;
  "ai.usage.query": MethodContract219;
  "alignment.session.apply": MethodContract92;
  "alignment.session.create": MethodContract87;
  "alignment.session.get": MethodContract88;
  "alignment.session.list": MethodContract89;
  "alignment.session.refine": MethodContract91;
  "alignment.session.update": MethodContract90;
  "analysis.profile.list": MethodContract43;
  "analysis.run": MethodContract44;
  "analysis.run.get": MethodContract45;
  "asset.catalog.list": MethodContract98;
  "collab.assignment.complete": MethodContract184;
  "collab.assignment.create": MethodContract183;
  "collab.assignment.list": MethodContract182;
  "collab.lock.acquire": MethodContract176;
  "collab.lock.heartbeat": MethodContract178;
  "collab.lock.list": MethodContract179;
  "collab.lock.release": MethodContract177;
  "collab.member.add": MethodContract174;
  "collab.member.list": MethodContract173;
  "collab.member.remove": MethodContract175;
  "collab.opLog.list": MethodContract185;
  "collab.presence.heartbeat": MethodContract180;
  "collab.presence.list": MethodContract181;
  "corpus.fromAlignment": MethodContract95;
  "corpus.import": MethodContract94;
  "corpus.list": MethodContract93;
  "corpus.reindex": MethodContract97;
  "corpus.remove": MethodContract97;
  "corpus.search": MethodContract96;
  "curation.apply": MethodContract102;
  "curation.export": MethodContract104;
  "curation.finding.list": MethodContract101;
  "curation.rollback": MethodContract103;
  "curation.run": MethodContract99;
  "curation.run.get": MethodContract100;
  "data.checkHealth": MethodContract187;
  "data.createBackup": MethodContract188;
  "dictionary.add": MethodContract68;
  "dictionary.list": MethodContract67;
  "dictionary.remove": MethodContract68;
  "discussion.message.create": MethodContract20;
  "discussion.message.delete": MethodContract22;
  "discussion.message.list": MethodContract19;
  "discussion.message.update": MethodContract21;
  "discussion.thread.create": MethodContract17;
  "discussion.thread.list": MethodContract16;
  "discussion.thread.resolve": MethodContract18;
  "document.export": MethodContract140;
  "document.exportDocx": MethodContract139;
  "document.get": MethodContract34;
  "document.import": MethodContract35;
  "document.importDocx": MethodContract36;
  "document.list": MethodContract33;
  "document.reimport.apply": MethodContract38;
  "document.reimport.preview": MethodContract37;
  "editor.history": MethodContract70;
  "editor.preferences.get": MethodContract82;
  "editor.preferences.update": MethodContract83;
  "editor.redo": MethodContract69;
  "editor.suggest": MethodContract118;
  "editor.undo": MethodContract69;
  "engine.initialize": MethodContract;
  "externalConnector.catalog": MethodContract163;
  "externalConnector.checkpoint.get": MethodContract172;
  "externalConnector.credential.delete": MethodContract169;
  "externalConnector.credential.set": MethodContract168;
  "externalConnector.credential.status": MethodContract170;
  "externalConnector.invoke": MethodContract171;
  "externalConnector.profile.create": MethodContract165;
  "externalConnector.profile.delete": MethodContract167;
  "externalConnector.profile.list": MethodContract164;
  "externalConnector.profile.update": MethodContract166;
  "filter.list": MethodContract141;
  "history.list": MethodContract186;
  "interop.review.apply": MethodContract79;
  "interop.review.export": MethodContract77;
  "interop.review.preview": MethodContract78;
  "interop.table.apply": MethodContract81;
  "interop.table.preview": MethodContract80;
  "pdf.correctOcr": MethodContract86;
  "pdf.page.get": MethodContract85;
  "pdf.page.list": MethodContract84;
  "pipeline.create": MethodContract190;
  "pipeline.get": MethodContract192;
  "pipeline.list": MethodContract191;
  "pipeline.run": MethodContract194;
  "pipeline.run.cancel": MethodContract197;
  "pipeline.run.get": MethodContract196;
  "pipeline.run.list": MethodContract195;
  "pipeline.run.resume": MethodContract197;
  "pipeline.step.list": MethodContract189;
  "pipeline.validate": MethodContract193;
  "plugin.aiAction.cancel": MethodContract159;
  "plugin.aiAction.history.list": MethodContract160;
  "plugin.aiAction.invoke": MethodContract158;
  "plugin.aiAction.list": MethodContract157;
  "plugin.bundled.apply": MethodContract151;
  "plugin.bundled.list": MethodContract150;
  "plugin.disable": MethodContract145;
  "plugin.enable": MethodContract145;
  "plugin.get": MethodContract143;
  "plugin.inspect": MethodContract146;
  "plugin.install": MethodContract144;
  "plugin.list": MethodContract142;
  "plugin.permission.audit.list": MethodContract156;
  "plugin.permission.deny": MethodContract155;
  "plugin.permission.grant": MethodContract154;
  "plugin.permission.request.list": MethodContract152;
  "plugin.permission.review": MethodContract153;
  "plugin.permission.revoke": MethodContract155;
  "plugin.rollback": MethodContract149;
  "plugin.uiPanel.bridge.call": MethodContract162;
  "plugin.uiPanel.list": MethodContract161;
  "plugin.uninstall": MethodContract145;
  "plugin.upgrade": MethodContract148;
  "plugin.version.list": MethodContract147;
  "project.analytics.get": MethodContract46;
  "project.archive.export": MethodContract14;
  "project.archive.restore": MethodContract15;
  "project.batchImport": MethodContract13;
  "project.create": MethodContract2;
  "project.createFromTemplate": MethodContract12;
  "project.get": MethodContract3;
  "project.list": MethodContract4;
  "project.setLifecycle": MethodContract6;
  "project.snapshot.create": MethodContract24;
  "project.snapshot.get": MethodContract25;
  "project.snapshot.list": MethodContract23;
  "project.snapshot.previewRestore": MethodContract26;
  "project.snapshot.restore": MethodContract27;
  "project.template.create": MethodContract9;
  "project.template.delete": MethodContract11;
  "project.template.get": MethodContract8;
  "project.template.list": MethodContract7;
  "project.template.update": MethodContract10;
  "project.update": MethodContract5;
  "qa.gate.check": MethodContract137;
  "qa.issue.list": MethodContract133;
  "qa.issue.revoke": MethodContract135;
  "qa.issue.waive": MethodContract134;
  "qa.list": MethodContract124;
  "qa.override.list": MethodContract138;
  "qa.profile.clone": MethodContract127;
  "qa.profile.create": MethodContract126;
  "qa.profile.delete": MethodContract129;
  "qa.profile.list": MethodContract125;
  "qa.profile.update": MethodContract128;
  "qa.report.export": MethodContract136;
  "qa.run": MethodContract130;
  "qa.run.get": MethodContract132;
  "qa.run.list": MethodContract131;
  "qa.runDocument": MethodContract123;
  "recycle.delete": MethodContract40;
  "recycle.list": MethodContract39;
  "recycle.purge": MethodContract41;
  "recycle.restore": MethodContract41;
  "review.accept": MethodContract73;
  "review.create": MethodContract71;
  "review.list": MethodContract72;
  "review.queue": MethodContract75;
  "review.reject": MethodContract74;
  "review.stats": MethodContract76;
  "search.global": MethodContract42;
  "segment.chinese.convert": MethodContract52;
  "segment.comment.create": MethodContract62;
  "segment.comment.delete": MethodContract65;
  "segment.comment.list": MethodContract61;
  "segment.comment.resolve": MethodContract64;
  "segment.comment.update": MethodContract63;
  "segment.confirm": MethodContract49;
  "segment.correctSource": MethodContract59;
  "segment.editor.list": MethodContract50;
  "segment.find": MethodContract54;
  "segment.list": MethodContract47;
  "segment.merge": MethodContract58;
  "segment.propagate": MethodContract53;
  "segment.replace.apply": MethodContract56;
  "segment.replace.preview": MethodContract55;
  "segment.spell.check": MethodContract66;
  "segment.split": MethodContract57;
  "segment.tag.set": MethodContract51;
  "segment.updateTarget": MethodContract48;
  "segment.workflow.set": MethodContract60;
  "taskPackage.apply": MethodContract30;
  "taskPackage.discard": MethodContract32;
  "taskPackage.export": MethodContract28;
  "taskPackage.import": MethodContract31;
  "taskPackage.preview": MethodContract29;
  "term.search": MethodContract119;
  "term.upsert": MethodContract120;
  "termbase.create": MethodContract115;
  "termbase.export": MethodContract122;
  "termbase.import": MethodContract121;
  "termbase.list": MethodContract114;
  "termbase.mount": MethodContract116;
  "termbase.unmount": MethodContract117;
  "tm.concordance": MethodContract111;
  "tm.export": MethodContract113;
  "tm.import": MethodContract112;
  "tm.library.create": MethodContract107;
  "tm.library.list": MethodContract106;
  "tm.library.mount": MethodContract108;
  "tm.library.unmount": MethodContract109;
  "tm.lookupExact": MethodContract105;
  "tm.search": MethodContract110;
}
export interface MethodContract218 {
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
export interface MethodContract215 {
  params: AiBatchIdParams;
  result: AiBatchRun;
  [k: string]: unknown;
}
export interface AiBatchIdParams {
  batchId: string;
}
export interface MethodContract217 {
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
export interface MethodContract216 {
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
export interface MethodContract214 {
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
export interface MethodContract224 {
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
export interface MethodContract223 {
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
export interface MethodContract226 {
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
export interface MethodContract225 {
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
export interface MethodContract204 {
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
export interface MethodContract207 {
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
export interface MethodContract198 {
  params: AiProviderCatalogParams;
  result: AiProviderCatalogResult;
  [k: string]: unknown;
}
export interface AiProviderCatalogParams {}
export interface AiProviderCatalogResult {
  items: AiConnectorCatalogItem[];
  [k: string]: unknown;
}
export interface AiConnectorCatalogItem {
  availability: AiConnectorAvailability;
  configSchema?: EngineConnectorConfigSchemaV1 | null;
  configSchemaVersion: number;
  credentialHint: string;
  defaultBaseUrl: string;
  defaultModel: string;
  displayName: string;
  id: string;
  kind?: AiProviderKind | null;
  operations: EngineConnectorOperation[];
  protocol?: AiProviderProtocol | null;
  reportsUsage: boolean;
  safeFailure?: string | null;
  source: EngineConnectorSource;
  supportsStreaming: boolean;
}
export interface EngineConnectorConfigSchemaV1 {
  fields: EngineConnectorConfigFieldV1[];
  schemaVersion: number;
}
export interface EngineConnectorConfigFieldV1 {
  defaultValue?: EngineConnectorConfigValueV1 | null;
  description?: string | null;
  fieldType: EngineConnectorConfigFieldTypeV1;
  key: string;
  label: string;
  max?: number | null;
  min?: number | null;
  options?: EngineConnectorConfigOptionV1[];
  required: boolean;
}
export interface EngineConnectorConfigOptionV1 {
  label: string;
  value: string;
}
export interface PluginConnectorOwner {
  pluginId: string;
  versionId: string;
}
export interface MethodContract200 {
  params: AiProviderCreateParams;
  result: AiProviderProfile;
  [k: string]: unknown;
}
export interface AiProviderCreateParams {
  baseUrl: string;
  configSchemaVersion?: number | null;
  configuration?: {
    [k: string]: unknown;
  };
  enabled?: boolean;
  kind?: AiProviderKind | null;
  maxResponseBytes?: number;
  model: string;
  name: string;
  source?: EngineConnectorSource | null;
  timeoutMs?: number;
}
export interface AiProviderProfile {
  availability: AiConnectorAvailability;
  baseUrl: string;
  configHash?: string | null;
  configSchemaVersion?: number | null;
  configuration?: {
    [k: string]: unknown;
  };
  createdAtMs: number;
  credentialPresent: boolean;
  descriptorHash?: string | null;
  enabled: boolean;
  id: string;
  kind?: AiProviderKind | null;
  maxResponseBytes: number;
  model: string;
  name: string;
  revision: number;
  source: EngineConnectorSource;
  timeoutMs: number;
  updatedAtMs: number;
}
export interface MethodContract202 {
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
export interface MethodContract199 {
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
export interface MethodContract203 {
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
export interface MethodContract201 {
  params: AiProviderUpdateParams;
  result: AiProviderProfile;
  [k: string]: unknown;
}
export interface AiProviderUpdateParams {
  baseUrl: string;
  configSchemaVersion?: number | null;
  configuration?: {
    [k: string]: unknown;
  };
  enabled: boolean;
  expectedRevision: number;
  kind?: AiProviderKind | null;
  maxResponseBytes: number;
  model: string;
  name: string;
  profileId: string;
  source?: EngineConnectorSource | null;
  timeoutMs: number;
}
export interface MethodContract222 {
  params: AiTermExtractParams;
  result: TermExtractReport;
  [k: string]: unknown;
}
export interface MethodContract220 {
  params: AiQualityDocumentParams;
  result: QualityScoreReport;
  [k: string]: unknown;
}
export interface MethodContract221 {
  params: AiQualityDocumentParams;
  result: SemanticQaReport;
  [k: string]: unknown;
}
export interface MethodContract213 {
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
export interface MethodContract212 {
  params: AiRunRevisionParams;
  result: AiRun;
  [k: string]: unknown;
}
export interface AiRunRevisionParams {
  expectedRevision: number;
  runId: string;
}
export interface MethodContract211 {
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
export interface MethodContract209 {
  params: AiRunIdParams;
  result: AiRun;
  [k: string]: unknown;
}
export interface AiRunIdParams {
  runId: string;
}
export interface MethodContract210 {
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
export interface MethodContract208 {
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
export interface MethodContract205 {
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
export interface MethodContract206 {
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
export interface MethodContract219 {
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
export interface MethodContract92 {
  params: AlignmentSessionApplyParams;
  result: AlignmentApplyResult;
  [k: string]: unknown;
}
export interface MethodContract87 {
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
export interface MethodContract88 {
  params: AlignmentSessionGetParams;
  result: AlignmentSessionGetResult;
  [k: string]: unknown;
}
export interface MethodContract89 {
  params: AlignmentSessionListParams;
  result: AlignmentSessionPage;
  [k: string]: unknown;
}
export interface MethodContract91 {
  params: AlignmentSessionRefineParams;
  result: AiRun;
  [k: string]: unknown;
}
export interface MethodContract90 {
  params: AlignmentSessionUpdateParams;
  result: AlignmentMutationResult;
  [k: string]: unknown;
}
export interface MethodContract43 {
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
export interface MethodContract44 {
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
export interface MethodContract45 {
  params: AnalysisRunIdParams;
  result: AnalysisRunResult;
  [k: string]: unknown;
}
export interface AnalysisRunIdParams {
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract98 {
  params: AssetCatalogListParams;
  result: AssetCatalogPage;
  [k: string]: unknown;
}
export interface MethodContract184 {
  params: CollabAssignmentCompleteParams;
  result: CollabAssignment;
  [k: string]: unknown;
}
export interface CollabAssignmentCompleteParams {
  actorId?: string;
  assignmentId: string;
  expectedRevision: number;
}
export interface MethodContract183 {
  params: CollabAssignmentCreateParams;
  result: CollabAssignment;
  [k: string]: unknown;
}
export interface CollabAssignmentCreateParams {
  assigneeActorId: string;
  createdBy?: string;
  documentId: string;
  dueAtMs?: number | null;
  ordinalEnd: number;
  ordinalStart: number;
  projectId: string;
}
export interface MethodContract182 {
  params: CollabProjectParams;
  result: CollabAssignmentListResult;
  [k: string]: unknown;
}
export interface CollabAssignmentListResult {
  items: CollabAssignment[];
  [k: string]: unknown;
}
export interface MethodContract176 {
  params: CollabLockAcquireParams;
  result: CollabLock;
  [k: string]: unknown;
}
export interface CollabLockAcquireParams {
  actorId?: string;
  documentId: string;
  projectId: string;
  segmentId: string;
  ttlMs?: number | null;
}
export interface MethodContract178 {
  params: CollabLockActorParams;
  result: CollabLock;
  [k: string]: unknown;
}
export interface CollabLockActorParams {
  actorId?: string;
  segmentId: string;
  ttlMs?: number | null;
}
export interface MethodContract179 {
  params: CollabProjectParams;
  result: CollabLockListResult;
  [k: string]: unknown;
}
export interface CollabLockListResult {
  items: CollabLock[];
  [k: string]: unknown;
}
export interface MethodContract177 {
  params: CollabLockActorParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface MethodContract174 {
  params: CollabMemberAddParams;
  result: CollabMember;
  [k: string]: unknown;
}
export interface CollabMemberAddParams {
  actingActor?: string;
  actorId: string;
  projectId: string;
  role: CollabRole;
}
export interface MethodContract173 {
  params: CollabProjectParams;
  result: CollabMemberListResult;
  [k: string]: unknown;
}
export interface CollabMemberListResult {
  items: CollabMember[];
  [k: string]: unknown;
}
export interface MethodContract175 {
  params: CollabMemberRemoveParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface CollabMemberRemoveParams {
  actingActor?: string;
  actorId: string;
  projectId: string;
}
export interface MethodContract185 {
  params: CollabOpLogListParams;
  result: CollabOpLogPage;
  [k: string]: unknown;
}
export interface CollabOpLogListParams {
  afterSequence?: number;
  limit?: number;
  projectId: string;
}
export interface MethodContract180 {
  params: CollabPresenceHeartbeatParams;
  result: CollabPresence;
  [k: string]: unknown;
}
export interface CollabPresenceHeartbeatParams {
  actorId?: string;
  documentId?: string | null;
  projectId: string;
  segmentId?: string | null;
  ttlMs?: number | null;
}
export interface MethodContract181 {
  params: CollabProjectParams;
  result: CollabPresenceListResult;
  [k: string]: unknown;
}
export interface CollabPresenceListResult {
  items: CollabPresence[];
  [k: string]: unknown;
}
export interface MethodContract95 {
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
export interface MethodContract94 {
  params: CorpusImportParams;
  result: ReferenceCorpusMutationResult;
  [k: string]: unknown;
}
export interface MethodContract93 {
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
export interface MethodContract97 {
  params: CorpusMutationParams;
  result: ReferenceCorpusMutationResult;
  [k: string]: unknown;
}
export interface MethodContract96 {
  params: CorpusSearchParams;
  result: CorpusSearchResult;
  [k: string]: unknown;
}
export interface MethodContract102 {
  params: CurationApplyParams;
  result: CurationMutationResult;
  [k: string]: unknown;
}
export interface MethodContract104 {
  params: CurationExportParams;
  result: CurationExportResult;
  [k: string]: unknown;
}
export interface MethodContract101 {
  params: CurationFindingListParams;
  result: CurationFindingPage;
  [k: string]: unknown;
}
export interface MethodContract103 {
  params: CurationRollbackParams;
  result: CurationMutationResult;
  [k: string]: unknown;
}
export interface MethodContract99 {
  params: CurationRunParams;
  result: CurationRunSnapshot;
  [k: string]: unknown;
}
export interface MethodContract100 {
  params: CurationRunIdParams;
  result: CurationRunSnapshot;
  [k: string]: unknown;
}
export interface MethodContract187 {
  params: EmptyParams;
  result: DataHealthReport;
  [k: string]: unknown;
}
export interface MethodContract188 {
  params: CreateBackupParams;
  result: BackupResult;
  [k: string]: unknown;
}
export interface MethodContract68 {
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
export interface MethodContract67 {
  params: DictionaryListParams;
  result: DictionaryListResult;
  [k: string]: unknown;
}
export interface DictionaryListParams {
  locale: string;
  [k: string]: unknown;
}
export interface MethodContract20 {
  params: DiscussionMessageCreateParams;
  result: DiscussionMessage;
  [k: string]: unknown;
}
export interface MethodContract22 {
  params: DiscussionMessageDeleteParams;
  result: DiscussionMessage;
  [k: string]: unknown;
}
export interface MethodContract19 {
  params: DiscussionMessageListParams;
  result: DiscussionMessagePage;
  [k: string]: unknown;
}
export interface MethodContract21 {
  params: DiscussionMessageUpdateParams;
  result: DiscussionMessage;
  [k: string]: unknown;
}
export interface MethodContract17 {
  params: DiscussionThreadCreateParams;
  result: DiscussionThread;
  [k: string]: unknown;
}
export interface MethodContract16 {
  params: DiscussionThreadListParams;
  result: DiscussionThreadPage;
  [k: string]: unknown;
}
export interface MethodContract18 {
  params: DiscussionThreadResolveParams;
  result: DiscussionThread;
  [k: string]: unknown;
}
export interface MethodContract140 {
  params: ExportDocumentParams;
  result: ExportDocumentResult;
  [k: string]: unknown;
}
export interface MethodContract139 {
  params: ExportDocxParams;
  result: ExportDocxResult;
  [k: string]: unknown;
}
export interface MethodContract34 {
  params: DocumentIdParams;
  result: Document;
  [k: string]: unknown;
}
export interface MethodContract35 {
  params: ImportDocumentParams;
  result: ImportDocumentResult;
  [k: string]: unknown;
}
export interface MethodContract36 {
  params: ImportDocxParams;
  result: Document;
  [k: string]: unknown;
}
export interface MethodContract33 {
  params: DocumentListParams;
  result: DocumentPage;
  [k: string]: unknown;
}
export interface MethodContract38 {
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
export interface MethodContract37 {
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
export interface MethodContract70 {
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
export interface MethodContract82 {
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
export interface MethodContract83 {
  params: UpdateEditorPreferencesParams;
  result: EditorPreferences;
  [k: string]: unknown;
}
export interface UpdateEditorPreferencesParams {
  preferences: EditorPreferences;
  [k: string]: unknown;
}
export interface MethodContract69 {
  params: EditorUndoRedoParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface EditorUndoRedoParams {
  projectId: string;
  [k: string]: unknown;
}
export interface MethodContract118 {
  params: EditorSuggestParams;
  result: EditorSuggestResult;
  [k: string]: unknown;
}
export interface MethodContract {
  params: InitializeParams;
  result: InitializeResult;
  [k: string]: unknown;
}
export interface MethodContract163 {
  params: EmptyParams;
  result: ExternalConnectorCatalogPage;
  [k: string]: unknown;
}
export interface ExternalConnectorCatalogPage {
  items: ExternalConnectorCatalogEntry[];
  [k: string]: unknown;
}
export interface ExternalConnectorCatalogEntry {
  checkpointSchemaVersion: number;
  configSchemaVersion: number;
  contractVersion: number;
  credentialSlots: string[];
  displayName: string;
  operations: string[];
  origins: string[];
  owner: PluginContributionOwner;
  state: PluginContributionState;
  [k: string]: unknown;
}
export interface PluginContributionOwner {
  activationRevision: number;
  contributionId: string;
  pluginId: string;
  versionId: string;
}
export interface MethodContract172 {
  params: ExternalConnectorCheckpointGetParams;
  result: ExternalConnectorCheckpointView;
  [k: string]: unknown;
}
export interface ExternalConnectorCheckpointGetParams {
  profileId: string;
  streamId: string;
}
export interface ExternalConnectorCheckpointView {
  activationRevision: number;
  contributionId: string;
  createdAtMs: number;
  cursor?: string | null;
  payload: unknown;
  payloadHash: string;
  pluginId: string;
  profileId: string;
  revision: number;
  schemaVersion: number;
  streamId: string;
  versionId: string;
  [k: string]: unknown;
}
export interface MethodContract169 {
  params: ExternalConnectorCredentialDeleteParams;
  result: ExternalConnectorCredentialStatus;
  [k: string]: unknown;
}
export interface ExternalConnectorCredentialDeleteParams {
  expectedRevision: number;
  profileId: string;
  slotId: string;
}
export interface ExternalConnectorCredentialStatus {
  profileId: string;
  revision: number;
  slots: ExternalConnectorCredentialSlotStatus[];
  [k: string]: unknown;
}
export interface ExternalConnectorCredentialSlotStatus {
  present: boolean;
  slotId: string;
  [k: string]: unknown;
}
export interface MethodContract168 {
  params: ExternalConnectorCredentialSetParams;
  result: ExternalConnectorCredentialStatus;
  [k: string]: unknown;
}
export interface ExternalConnectorCredentialSetParams {
  expectedRevision: number;
  profileId: string;
  secret: string;
  slotId: string;
}
export interface MethodContract170 {
  params: ExternalConnectorCredentialStatusParams;
  result: ExternalConnectorCredentialStatus;
  [k: string]: unknown;
}
export interface ExternalConnectorCredentialStatusParams {
  profileId: string;
}
export interface MethodContract171 {
  params: ExternalConnectorInvokeParams;
  result: ExternalConnectorInvokeResult;
  [k: string]: unknown;
}
export interface ExternalConnectorInvokeParams {
  profileId: string;
  request: unknown;
}
export interface ExternalConnectorInvokeResult {
  checkpointRevision?: number | null;
  operation: string;
  profileId: string;
  replayed: boolean;
  requestId: string;
  result: unknown;
  [k: string]: unknown;
}
export interface MethodContract165 {
  params: ExternalConnectorProfileCreateParams;
  result: ExternalConnectorProfile;
  [k: string]: unknown;
}
export interface ExternalConnectorProfileCreateParams {
  configuration: unknown;
  contributionId: string;
  displayName: string;
  enabled?: boolean;
}
export interface ExternalConnectorProfile {
  activationRevision: number;
  checkpointSchemaVersion: number;
  configSchemaVersion: number;
  configuration: unknown;
  contractVersion: number;
  contributionId: string;
  createdAtMs: number;
  credentialSlots: ExternalConnectorCredentialSlotStatus[];
  displayName: string;
  enabled: boolean;
  id: string;
  operations: string[];
  origins: string[];
  pluginId: string;
  revision: number;
  updatedAtMs: number;
  versionId: string;
  [k: string]: unknown;
}
export interface MethodContract167 {
  params: ExternalConnectorProfileRevisionParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface ExternalConnectorProfileRevisionParams {
  expectedRevision: number;
  profileId: string;
}
export interface MethodContract164 {
  params: ExternalConnectorProfileListParams;
  result: ExternalConnectorProfilePage;
  [k: string]: unknown;
}
export interface ExternalConnectorProfileListParams {
  contributionId?: string | null;
  limit?: number;
  offset?: number;
}
export interface ExternalConnectorProfilePage {
  items: ExternalConnectorProfile[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract166 {
  params: ExternalConnectorProfileUpdateParams;
  result: ExternalConnectorProfile;
  [k: string]: unknown;
}
export interface ExternalConnectorProfileUpdateParams {
  configuration: unknown;
  displayName: string;
  enabled: boolean;
  expectedRevision: number;
  profileId: string;
}
export interface MethodContract141 {
  params: EmptyParams;
  result: FilterListResult;
  [k: string]: unknown;
}
export interface MethodContract186 {
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
export interface MethodContract79 {
  params: ReviewApplyParams;
  result: InteropApplyResult;
  [k: string]: unknown;
}
export interface ReviewApplyParams {
  actor?: string;
  expectedDocumentRevision: number;
  previewId: string;
  reason?: string;
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
export interface MethodContract77 {
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
export interface MethodContract78 {
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
export interface MethodContract81 {
  params: TableApplyParams;
  result: InteropApplyResult;
  [k: string]: unknown;
}
export interface TableApplyParams {
  actor?: string;
  expectedLibraryRevision: number;
  previewId: string;
  reason?: string;
  selectedRowIds: string[];
  [k: string]: unknown;
}
export interface MethodContract80 {
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
export interface MethodContract86 {
  params: CorrectOcrParams;
  result: Segment;
  [k: string]: unknown;
}
export interface CorrectOcrParams {
  expectedRevision: number;
  reason?: string;
  segmentId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface MethodContract85 {
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
export interface MethodContract84 {
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
export interface MethodContract190 {
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
export interface MethodContract192 {
  params: PipelineIdParams;
  result: PipelineDefinition;
  [k: string]: unknown;
}
export interface PipelineIdParams {
  pipelineId: string;
  [k: string]: unknown;
}
export interface MethodContract191 {
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
export interface MethodContract194 {
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
  latestCheckpoint?: PipelineStepCheckpointMetadata | null;
  latestPluginAttempt?: PipelineStepPluginAttempt | null;
  output?: {
    [k: string]: unknown;
  };
  pluginBinding?: PipelineStepPluginBinding | null;
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
export interface PipelineStepCheckpointMetadata {
  checkpointHash: string;
  createdAtMs: number;
  schemaVersion: number;
  sequence: number;
}
export interface PipelineStepPluginAttempt {
  attemptIndex: number;
  checkpointInputHash?: string | null;
  checkpointOutputHash?: string | null;
  checkpointSchemaVersion?: number | null;
  completedAtMs: number;
  failure?: PipelineFailure | null;
  id: string;
  inputHash: string;
  operation: PipelineStepPluginOperation;
  outputHash?: string | null;
  startedAtMs: number;
  usage?: {
    [k: string]: unknown;
  };
}
export interface PipelineStepPluginBinding {
  configHash: string;
  createdAtMs: number;
  owner: PipelineStepOwner;
}
export interface MethodContract197 {
  params: PipelineRunRevisionParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface PipelineRunRevisionParams {
  expectedRevision: number;
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract196 {
  params: PipelineRunIdParams;
  result: PipelineRunSnapshot;
  [k: string]: unknown;
}
export interface PipelineRunIdParams {
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract195 {
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
export interface MethodContract189 {
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
export interface MethodContract193 {
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
export interface MethodContract159 {
  params: PluginAiActionCancelParams;
  result: PluginAiActionCancelResult;
  [k: string]: unknown;
}
export interface PluginAiActionCancelParams {
  invocationId: string;
}
export interface PluginAiActionCancelResult {
  cancelled: boolean;
  invocationId: string;
  [k: string]: unknown;
}
export interface MethodContract160 {
  params: PluginAiActionHistoryListParams;
  result: PluginAiActionHistoryPage;
  [k: string]: unknown;
}
export interface PluginAiActionHistoryListParams {
  contributionId?: string | null;
  limit?: number;
  offset?: number;
  pluginId?: string | null;
}
export interface PluginAiActionHistoryPage {
  items: PluginAiActionHistoryEntry[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface PluginAiActionHistoryEntry {
  canonicalSha256?: string | null;
  contributionVersion: string;
  createdAtMs: number;
  failureCode?: string | null;
  invocationId: string;
  owner: PluginContributionOwner;
  status: PluginAiActionHistoryStatus;
  usage: PluginAiActionHistoryUsage;
  [k: string]: unknown;
}
export interface PluginAiActionHistoryUsage {
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
}
export interface MethodContract158 {
  params: PluginAiActionInvokeParams;
  result: PluginAiActionInvokeResult;
  [k: string]: unknown;
}
export interface PluginAiActionInvokeParams {
  invocation: AiActionInvocationV1;
}
export interface AiActionInvocationV1 {
  config: unknown;
  configSchemaVersion: number;
  context: AiActionContextV1;
  contributionId: string;
  deadlineMs: number;
  invocationId: string;
  operation: string;
  protocolVersion: number;
}
export interface AiActionContextV1 {
  segmentText: string;
  selectionText?: string | null;
  sourceLocale: string;
  sourceText: string;
  tags?: AiActionTagV1[];
  targetLocale: string;
}
export interface AiActionTagV1 {
  end: number;
  id: string;
  kind: string;
  start: number;
}
export interface PluginAiActionInvokeResult {
  canonicalSha256: string;
  descriptor: AiActionContributionDescriptor;
  owner: PluginContributionOwner;
  result: AiActionResultV1;
  [k: string]: unknown;
}
export interface AiActionContributionDescriptor {
  configSchema?: PublicConfigSchemaV1 | null;
  configSchemaVersion?: number | null;
  descriptorVersion: number;
  displayName: string;
  id: string;
  /**
   * Legacy inventory metadata. Executable V1 descriptors still carry an object here.
   */
  input: {
    [k: string]: unknown;
  };
  inputFields?: AiActionInputFieldV1[];
  label: string;
  limits?: AiActionLimitsV1 | null;
  operationProtocolVersion?: number | null;
  /**
   * Kept as text so released inventory-only descriptors remain readable.
   */
  placement: string;
  promptTemplate?: string;
  resultModes?: AiActionResultModeV1[];
  version: string;
}
export interface PublicConfigSchemaV1 {
  fields: PublicConfigFieldV1[];
  schemaVersion: number;
}
export interface PublicConfigFieldV1 {
  defaultValue?: unknown;
  fieldType: PublicConfigFieldTypeV1;
  key: string;
  label: string;
  max?: number | null;
  min?: number | null;
  options?: PublicConfigOptionV1[];
  required: boolean;
}
export interface PublicConfigOptionV1 {
  label: string;
  value: string;
}
export interface AiActionLimitsV1 {
  maxDeadlineMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxTags: number;
}
export interface AiActionResultV1 {
  invocationId: string;
  proposal: AiActionProposalV1;
  protocolVersion: number;
  usage: AiActionUsageV1;
}
export interface AiActionUsageV1 {
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
}
export interface MethodContract157 {
  params: EmptyParams;
  result: PluginAiActionPage;
  [k: string]: unknown;
}
export interface PluginAiActionPage {
  items: PluginAiActionView[];
  [k: string]: unknown;
}
export interface PluginAiActionView {
  descriptor: AiActionContributionDescriptor;
  lastFailureCode?: string | null;
  owner: PluginContributionOwner;
  state: PluginContributionState;
  [k: string]: unknown;
}
export interface MethodContract151 {
  params: PluginBundledApplyParams;
  result: PluginBundledApplyResult;
  [k: string]: unknown;
}
export interface PluginBundledApplyParams {
  actor?: string;
  expectedRevision?: number | null;
  pluginId: string;
  reason?: string;
}
export interface PluginBundledApplyResult {
  action: PluginBundledApplyAction;
  activeVersionId?: string | null;
  plugin: PluginSummary;
  previousVersionId?: string | null;
  [k: string]: unknown;
}
export interface PluginSummary {
  activeVersionId?: string | null;
  compatibility?: PluginCompatibility | null;
  contributions?: PluginContributionDescriptor[];
  crashCount: number;
  diagnostics?: PluginDiagnostic[];
  displayName: string;
  distribution?: PluginDistributionMetadata | null;
  filters: FilterDescriptor[];
  grantedPermissions: string[];
  id: string;
  installedAtMs: number;
  lastError?: string | null;
  packagePath: string;
  packageSha256?: string | null;
  requestedPermissions: string[];
  revision: number;
  runtime?: PluginRuntimeDescriptor | null;
  /**
   * Host-derived provenance of the active package version.
   */
  sourceKind?: "localDirectory" | "localArchive" | "bundled";
  status: PluginStatus;
  tier: PluginTier;
  updatedAtMs: number;
  version: string;
  [k: string]: unknown;
}
export interface PluginCompatibility {
  compatible: boolean;
  contributionsSupported: boolean;
  hostApiSupported: boolean;
  runtimeSupported: boolean;
  unsupportedCapabilities?: string[];
}
export interface DeclarativeFilterDefinitionV1 {
  definitionVersion: number;
  encoding: DeclarativeTextEncoding;
  limits: DeclarativeFilterLimits;
  probeHeaderPattern?: string | null;
  unitPattern: string;
}
export interface DeclarativeFilterLimits {
  maxCaptureBytes: number;
  maxOutputBytes: number;
  maxSourceBytes: number;
  maxUnitBytes: number;
  maxUnits: number;
  probeHeaderBytes: number;
}
export interface DeclarativeEngineConnectorDefinitionV1 {
  authentication: DeclarativeConnectorAuthenticationV1;
  definitionVersion: number;
  endpoint: DeclarativeConnectorEndpointV1;
  failures?: DeclarativeConnectorFailureMappingV1[];
  fixedHeaders?: DeclarativeConnectorHeaderV1[];
  request: DeclarativeConnectorRequestMappingV1;
  response: DeclarativeConnectorResponseMappingV1;
}
export interface DeclarativeConnectorEndpointV1 {
  destinationOrigin: string;
  method: DeclarativeConnectorHttpMethodV1;
  urlTemplate: string;
}
export interface DeclarativeConnectorFailureMappingV1 {
  code: EngineConnectorFailureCodeV1;
  retryable: boolean;
  status: number;
}
export interface DeclarativeConnectorHeaderV1 {
  name: string;
  value: string;
}
export interface DeclarativeConnectorRequestMappingV1 {
  fixedBody?: {
    [k: string]: unknown;
  };
  messagesPath: string[];
  modelPath: string[];
  sourceLocalePath?: string[] | null;
  sourceTextPath?: string[] | null;
  streamPath?: string[] | null;
  targetLocalePath?: string[] | null;
}
export interface DeclarativeConnectorUsageMappingV1 {
  inputTokensPath?: string[] | null;
  outputTokensPath?: string[] | null;
  totalTokensPath?: string[] | null;
}
export interface EngineConnectorLimitsV1 {
  maxConfigBytes: number;
  maxDeadlineMs: number;
  maxEvents: number;
  maxMessageBytes: number;
  maxMessages: number;
  maxModelIdBytes: number;
  maxModels: number;
  maxOutputBytes: number;
  maxSourceTextBytes: number;
}
export interface DeclarativeQaPackDefinitionV1 {
  definitionVersion: number;
  rules: QaRegexRule[];
}
export interface QaRegexRule {
  field: QaField;
  id: string;
  label: string;
  message: string;
  pattern: string;
  replacementHint?: string | null;
  severity: QaSeverity;
}
export interface QaRuleDefinitionV1 {}
export interface QaRuleLimitsV1 {
  maxDeadlineMs: number;
  maxEvidenceItems: number;
  maxFindings: number;
  maxMessageBytes: number;
  maxRelatedSegmentIds: number;
}
export interface DeclarativePipelineDefinitionV1 {
  definitionVersion: number;
  input: ArtifactKind;
  maxInputBytes: number;
  maxOutputBytes: number;
  operations: DeclarativePipelineOperation[];
  output: ArtifactKind;
}
export interface PipelineStepLimitsV1 {
  maxCheckpointBytes: number;
  maxConfigBytes: number;
  maxDeadlineMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
}
export interface ExternalConnectorCredentialSlotV1 {
  description?: string | null;
  id: string;
  label: string;
  operations: ExternalConnectorOperationV1[];
  required: boolean;
}
export interface DeclarativeExternalConnectorDefinitionV1 {
  definitionVersion: number;
  failures?: ExternalConnectorFailureMappingV1[];
  poll?: ExternalConnectorEndpointMappingV1 | null;
  pull?: ExternalConnectorEndpointMappingV1 | null;
  push?: ExternalConnectorEndpointMappingV1 | null;
  test?: ExternalConnectorEndpointMappingV1 | null;
  validateConfig?: ExternalConnectorEndpointMappingV1 | null;
  webhook?: ExternalConnectorEndpointMappingV1 | null;
  webhookSignature?: ExternalConnectorWebhookSignatureV1 | null;
}
export interface ExternalConnectorFailureMappingV1 {
  code: ExternalConnectorFailureCodeV1;
  retryable: boolean;
  status: number;
}
export interface ExternalConnectorEndpointMappingV1 {
  authentication: ExternalConnectorAuthenticationV1;
  checkpointPath?: string[] | null;
  destinationOrigin: string;
  fixedBody?: {
    [k: string]: unknown;
  };
  fixedHeaders?: ExternalConnectorHeaderV1[];
  fixedQuery?: {
    [k: string]: string;
  };
  hasMorePath?: string[] | null;
  itemsPath?: string[] | null;
  method: ExternalConnectorHttpMethodV1;
  receiptsPath?: string[] | null;
  urlTemplate: string;
}
export interface ExternalConnectorHeaderV1 {
  name: string;
  value: string;
}
export interface ExternalConnectorLimitsV1 {
  maxCheckpointBytes: number;
  maxConfigBytes: number;
  maxDeadlineMs: number;
  maxItemTextBytes: number;
  maxItems: number;
  maxMetadataEntries: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
}
export interface PluginDiagnostic {
  code: string;
  message: string;
  phase?: string | null;
  severity?: PluginDiagnosticSeverity | null;
}
/**
 * Bounded public distribution metadata declared in a released package manifest.
 */
export interface PluginDistributionMetadata {
  homepage?: string | null;
  license: string;
  publisher: string;
}
export interface MethodContract150 {
  params: PluginBundledListParams;
  result: PluginBundledPage;
  [k: string]: unknown;
}
export interface PluginBundledListParams {
  limit?: number;
  offset?: number;
}
export interface PluginBundledPage {
  /**
   * True when the Engine has a healthy, verified bundled catalog root.
   */
  catalogAvailable: boolean;
  diagnostics?: PluginDiagnostic[];
  items: PluginBundledSummary[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface PluginBundledSummary {
  archiveSha256: string;
  contributionCount: number;
  displayName: string;
  homepage?: string | null;
  installState: PluginBundledInstallState;
  installedPackageSha256?: string | null;
  installedVersion?: string | null;
  license: string;
  packageSha256: string;
  pluginId: string;
  publisher: string;
  tier: PluginTier;
  version: string;
  [k: string]: unknown;
}
export interface MethodContract145 {
  params: PluginMutationParams;
  result: PluginMutationResult;
  [k: string]: unknown;
}
export interface PluginMutationParams {
  actor?: string;
  expectedRevision?: number | null;
  pluginId: string;
  reason?: string;
}
export interface PluginMutationResult {
  plugin: PluginSummary;
  [k: string]: unknown;
}
export interface MethodContract143 {
  params: PluginIdParams;
  result: PluginSummary;
  [k: string]: unknown;
}
export interface PluginIdParams {
  pluginId: string;
}
export interface MethodContract146 {
  params: PluginInspectParams;
  result: PluginInspection;
  [k: string]: unknown;
}
export interface PluginInspectParams {
  sourcePath: string;
}
export interface PluginInspection {
  canInstall: boolean;
  compatibility: PluginCompatibility;
  diagnostics: PluginDiagnostic[];
  distribution?: PluginDistributionMetadata | null;
  normalizedManifest: NormalizedPluginManifest;
  packageSha256: string;
  /**
   * Host-derived source kind for the inspected path (never from the manifest).
   */
  sourceKind: "localDirectory" | "localArchive" | "bundled";
  [k: string]: unknown;
}
export interface NormalizedPluginManifest {
  contributions: PluginContributionDescriptor[];
  displayName: string;
  distribution?: PluginDistributionMetadata | null;
  hostApi: PluginApiRange;
  id: string;
  normalizedVersion: number;
  originalManifestJson: unknown;
  requestedCapabilities?: PluginCapabilityRequest[];
  requestedPermissions: string[];
  runtime: PluginRuntimeDescriptor;
  sourceManifestVersion: number;
  version: string;
}
export interface PluginApiRange {
  max: number;
  min: number;
}
export interface PluginCapabilityRequest {
  capabilityId: PluginCapabilityId;
  contributionId?: string | null;
  required?: boolean;
  scope?:
    | {
        kind: "unscoped";
      }
    | {
        areas: PluginFileArea[];
        kind: "file";
      }
    | {
        kind: "network";
        origins: string[];
      }
    | {
        kind: "projects";
        projectIds: string[];
      }
    | {
        assetIds: string[];
        kind: "assets";
        projectIds: string[];
      }
    | {
        kind: "operations";
        operations: string[];
      }
    | {
        contributionIds: string[];
        kind: "contributions";
      }
    | {
        categories: string[];
        kind: "diagnostics";
      };
}
export interface MethodContract144 {
  params: PluginInstallParams;
  result: PluginMutationResult;
  [k: string]: unknown;
}
export interface PluginInstallParams {
  actor?: string;
  grantRequested?: boolean;
  reason?: string;
  sourcePath: string;
}
export interface MethodContract142 {
  params: PluginListParams;
  result: PluginPage;
  [k: string]: unknown;
}
export interface PluginListParams {
  limit?: number;
  offset?: number;
}
export interface PluginPage {
  items: PluginSummary[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract156 {
  params: PluginCapabilityAuditListParams;
  result: PluginCapabilityAuditPage;
  [k: string]: unknown;
}
export interface PluginCapabilityAuditListParams {
  limit?: number;
  offset?: number;
  pluginId: string;
  requestId?: string | null;
}
export interface PluginCapabilityAuditPage {
  items: PluginCapabilityAuditEntry[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface PluginCapabilityAuditEntry {
  actor: string;
  capabilityId: PluginCapabilityId;
  createdAtMs: number;
  event: PluginCapabilityAuditEvent;
  id: string;
  operation: string;
  outcome: string;
  pluginId: string;
  reason: string;
  requestId?: string | null;
  requestRevision?: number | null;
  scope: PluginCapabilityScope;
  sequence: number;
  versionId: string;
  [k: string]: unknown;
}
export interface MethodContract155 {
  params: PluginCapabilityDecisionParams;
  result: PluginCapabilityDecisionResult;
  [k: string]: unknown;
}
export interface PluginCapabilityDecisionParams {
  actor: string;
  expectedRevision: number;
  pluginId: string;
  reason?: string;
  requestId: string;
}
export interface PluginCapabilityDecisionResult {
  detached: boolean;
  plugin: PluginSummary;
  request: PluginCapabilityRequestView;
  [k: string]: unknown;
}
export interface PluginCapabilityRequestView {
  actor: string;
  capabilityId: PluginCapabilityId;
  carriedFromRequestId?: string | null;
  contributionId?: string | null;
  createdAtMs: number;
  decidedAtMs?: number | null;
  decision: PluginCapabilityDecision;
  effectKey: string;
  grantedScope?: PluginCapabilityScope | null;
  id: string;
  pluginId: string;
  reason: string;
  requestedScope: PluginCapabilityScope;
  required: boolean;
  revision: number;
  risk: PluginCapabilityRisk;
  supported: boolean;
  updatedAtMs: number;
  versionId: string;
  [k: string]: unknown;
}
export interface MethodContract154 {
  params: PluginCapabilityGrantParams;
  result: PluginCapabilityDecisionResult;
  [k: string]: unknown;
}
export interface PluginCapabilityGrantParams {
  actor: string;
  expectedRevision: number;
  pluginId: string;
  reason?: string;
  requestId: string;
  scope: PluginCapabilityScope;
}
export interface MethodContract152 {
  params: PluginCapabilityRequestListParams;
  result: PluginCapabilityRequestPage;
  [k: string]: unknown;
}
export interface PluginCapabilityRequestListParams {
  limit?: number;
  offset?: number;
  pluginId: string;
  versionId?: string | null;
}
export interface PluginCapabilityRequestPage {
  items: PluginCapabilityRequestView[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract153 {
  params: PluginCapabilityReviewParams;
  result: PluginCapabilityReview;
  [k: string]: unknown;
}
export interface PluginCapabilityReviewParams {
  pluginId: string;
}
export interface PluginCapabilityReview {
  changes: PluginCapabilityChange[];
  plugin: PluginSummary;
  previousVersionId?: string | null;
  requests: PluginCapabilityRequestView[];
  versionId: string;
  [k: string]: unknown;
}
export interface PluginCapabilityChange {
  capabilityId: PluginCapabilityId;
  contributionId?: string | null;
  kind: PluginCapabilityChangeKind;
  previousScope?: PluginCapabilityScope | null;
  requestedScope?: PluginCapabilityScope | null;
  [k: string]: unknown;
}
export interface MethodContract149 {
  params: PluginRollbackParams;
  result: PluginLifecycleResult;
  [k: string]: unknown;
}
export interface PluginRollbackParams {
  actor: string;
  expectedRevision: number;
  pluginId: string;
  reason?: string;
  versionId: string;
}
export interface PluginLifecycleResult {
  action: PluginLifecycleAction;
  activeVersionId: string;
  plugin: PluginSummary;
  previousVersionId?: string | null;
  [k: string]: unknown;
}
export interface MethodContract162 {
  params: PluginUiPanelBridgeCallParams;
  result: PluginUiPanelBridgeCallResult;
  [k: string]: unknown;
}
export interface PluginUiPanelBridgeCallParams {
  method: string;
  owner: PluginContributionOwner;
  params?: {
    [k: string]: unknown;
  };
}
export interface PluginUiPanelBridgeCallResult {
  method: string;
  owner: PluginContributionOwner;
  result: unknown;
  [k: string]: unknown;
}
export interface MethodContract161 {
  params: EmptyParams;
  result: PluginUiPanelPage;
  [k: string]: unknown;
}
export interface PluginUiPanelPage {
  items: PluginUiPanelView[];
  [k: string]: unknown;
}
export interface PluginUiPanelView {
  descriptor: UiPanelContributionDescriptor;
  lastFailureCode?: string | null;
  owner: PluginContributionOwner;
  state: PluginContributionState;
  [k: string]: unknown;
}
export interface UiPanelContributionDescriptor {
  bridgeVersion: number;
  contractVersion?: number | null;
  descriptorVersion: number;
  displayName: string;
  id: string;
  label: string;
  methods?: UiPanelBridgeMethodV1[];
  order?: number;
  /**
   * Kept as text so released inventory-only descriptors remain readable.
   */
  placement: string;
  surface: string;
  version: string;
}
export interface MethodContract148 {
  params: PluginUpgradeParams;
  result: PluginLifecycleResult;
  [k: string]: unknown;
}
export interface PluginUpgradeParams {
  actor: string;
  expectedRevision: number;
  pluginId: string;
  reason?: string;
  sourcePath: string;
}
export interface MethodContract147 {
  params: PluginVersionListParams;
  result: PluginVersionPage;
  [k: string]: unknown;
}
export interface PluginVersionListParams {
  limit?: number;
  offset?: number;
  pluginId: string;
}
export interface PluginVersionPage {
  items: PluginVersionSummary[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface PluginVersionSummary {
  activatedAtMs?: number | null;
  compatibility: PluginCompatibility;
  contributionCount: number;
  deactivatedAtMs?: number | null;
  diagnostics: PluginDiagnostic[];
  distribution?: PluginDistributionMetadata | null;
  failedAtMs?: number | null;
  id: string;
  installedAtMs: number;
  packagePath: string;
  packageSha256?: string | null;
  pluginId: string;
  runtime: PluginRuntimeDescriptor;
  /**
   * Host-derived package provenance. Never trusted from a manifest or renderer.
   */
  sourceKind?: "localDirectory" | "localArchive" | "bundled";
  state: PluginVersionState;
  tier: PluginTier;
  version: string;
  [k: string]: unknown;
}
export interface MethodContract46 {
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
export interface MethodContract24 {
  params: ProjectSnapshotCreateParams;
  result: NamedProjectSnapshot;
  [k: string]: unknown;
}
export interface ProjectSnapshotCreateParams {
  actor: string;
  expectedProjectRevision: number;
  name: string;
  projectId: string;
  reason: string;
  [k: string]: unknown;
}
export interface NamedProjectSnapshot {
  actor: string;
  baseProjectRevision: number;
  createdAtMs: number;
  documentCount: number;
  id: string;
  name: string;
  projectId: string;
  reason: string;
  segmentCount: number;
  stateHash: string;
  threadCount: number;
  [k: string]: unknown;
}
export interface MethodContract25 {
  params: ProjectSnapshotGetParams;
  result: NamedProjectSnapshot;
  [k: string]: unknown;
}
export interface ProjectSnapshotGetParams {
  snapshotId: string;
  [k: string]: unknown;
}
export interface MethodContract23 {
  params: ProjectSnapshotListParams;
  result: ProjectSnapshotPage;
  [k: string]: unknown;
}
export interface ProjectSnapshotListParams {
  limit?: number;
  offset?: number;
  projectId: string;
  [k: string]: unknown;
}
export interface ProjectSnapshotPage {
  items: NamedProjectSnapshot[];
  limit: number;
  offset: number;
  total: number;
  [k: string]: unknown;
}
export interface MethodContract26 {
  params: ProjectSnapshotPreviewRestoreParams;
  result: ProjectSnapshotPreview;
  [k: string]: unknown;
}
export interface ProjectSnapshotPreviewRestoreParams {
  expectedProjectRevision: number;
  snapshotId: string;
  [k: string]: unknown;
}
export interface ProjectSnapshotPreview {
  currentProjectRevision: number;
  currentStateHash: string;
  expectedProjectRevision: number;
  missingDependencyIds: string[];
  previewId: string;
  projectId: string;
  snapshotId: string;
  status: ProjectSnapshotPreviewStatus;
  summary: ProjectSnapshotChangeSummary;
  [k: string]: unknown;
}
export interface ProjectSnapshotChangeSummary {
  commentsChanged: number;
  discussionsChanged: number;
  documentsAdded: number;
  documentsChanged: number;
  documentsRemoved: number;
  mountsAdded: number;
  mountsChanged: number;
  mountsRemoved: number;
  reviewsChanged: number;
  segmentsAdded: number;
  segmentsChanged: number;
  segmentsRemoved: number;
  [k: string]: unknown;
}
export interface MethodContract27 {
  params: ProjectSnapshotRestoreParams;
  result: ProjectSnapshotRestoreResult;
  [k: string]: unknown;
}
export interface ProjectSnapshotRestoreParams {
  actor: string;
  expectedProjectRevision: number;
  previewId: string;
  reason: string;
  [k: string]: unknown;
}
export interface ProjectSnapshotRestoreResult {
  operationId?: string | null;
  previewId: string;
  projectRevision: number;
  snapshotId: string;
  status: ProjectSnapshotPreviewStatus;
  summary: ProjectSnapshotChangeSummary;
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
  taskPackage?: TaskPackageProjectReference | null;
  templateId?: string | null;
  [k: string]: unknown;
}
export interface MethodContract137 {
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
  pluginRules?: QaRunPluginRuleSnapshot[];
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
export interface QaRunPluginRuleSnapshot {
  contributionIndex: number;
  executionCount: number;
  failure?: QaRuleExecutionFailure | null;
  findingCount: number;
  inputHash: string;
  outputHash?: string | null;
  provenance: QaRuleProvenanceSnapshot;
  status: QaRuleExecutionStatus;
  usage: QaRuleExecutionUsage;
}
export interface QaRuleExecutionFailure {
  code: string;
  message: string;
  retryable: boolean;
}
export interface QaRuleProvenanceSnapshot {
  activationRevision: number;
  configHash: string;
  configSchemaVersion: number;
  contributionId: string;
  contributionVersion: string;
  descriptorHash: string;
  descriptorVersion: number;
  operationProtocolVersion: number;
  pluginId: string;
  ruleIds: string[];
  tier: string;
  versionId: string;
}
export interface QaRuleExecutionUsage {
  inputBytes: number;
  outputBytes: number;
  workUnits: number;
}
export interface MethodContract133 {
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
export interface MethodContract135 {
  params: QaIssueRevokeParams;
  result: QaIssueView;
  [k: string]: unknown;
}
export interface QaIssueRevokeParams {
  expectedRevision: number;
  issueId: string;
  [k: string]: unknown;
}
export interface MethodContract134 {
  params: QaIssueWaiveParams;
  result: QaIssueView;
  [k: string]: unknown;
}
export interface QaIssueWaiveParams {
  actor: string;
  issueId: string;
  reason?: string;
  [k: string]: unknown;
}
export interface MethodContract124 {
  params: ListQaParams;
  result: QaListResult;
  [k: string]: unknown;
}
export interface QaListResult {
  issues: QaIssue[];
  [k: string]: unknown;
}
export interface MethodContract138 {
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
export interface MethodContract127 {
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
export interface QaRuleSettings {
  cjkPunctuation: boolean;
  cjkSpacing: boolean;
  maxLengthRatioPercent: number;
  maxTargetChars?: number | null;
  minLengthRatioPercent: number;
  requireSentenceFinalPunctuation: boolean;
  [k: string]: unknown;
}
export interface MethodContract126 {
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
export interface MethodContract129 {
  params: QaProfileDeleteParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface QaProfileDeleteParams {
  expectedRevision: number;
  profileId: string;
  [k: string]: unknown;
}
export interface MethodContract125 {
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
export interface MethodContract128 {
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
export interface MethodContract136 {
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
export interface MethodContract130 {
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
export interface MethodContract132 {
  params: QaRunIdParams;
  result: QaRun;
  [k: string]: unknown;
}
export interface QaRunIdParams {
  runId: string;
  [k: string]: unknown;
}
export interface MethodContract131 {
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
export interface MethodContract123 {
  params: DocumentIdParams;
  result: QaListResult;
  [k: string]: unknown;
}
export interface MethodContract40 {
  params: RecycleDeleteParams;
  result: RecycleEntry;
  [k: string]: unknown;
}
export interface RecycleDeleteParams {
  actor?: string;
  entityId: string;
  entityType: string;
  expectedRevision: number;
  reason?: string;
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
export interface MethodContract39 {
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
export interface MethodContract41 {
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
export interface MethodContract73 {
  params: ReviewDecisionParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface ReviewDecisionParams {
  expectedSegmentRevision: number;
  reviewId: string;
  [k: string]: unknown;
}
export interface MethodContract71 {
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
export interface MethodContract72 {
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
export interface MethodContract75 {
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
export interface MethodContract74 {
  params: ReviewDecisionParams;
  result: ReviewRevision;
  [k: string]: unknown;
}
export interface MethodContract76 {
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
export interface MethodContract42 {
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
export interface MethodContract52 {
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
export interface MethodContract62 {
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
export interface MethodContract65 {
  params: DeleteSegmentCommentParams;
  result: EmptyResult;
  [k: string]: unknown;
}
export interface DeleteSegmentCommentParams {
  commentId: string;
  expectedRevision: number;
  [k: string]: unknown;
}
export interface MethodContract61 {
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
export interface MethodContract64 {
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
export interface MethodContract63 {
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
export interface MethodContract49 {
  params: ConfirmSegmentParams;
  result: ConfirmSegmentResult;
  [k: string]: unknown;
}
export interface MethodContract59 {
  params: CorrectSourceParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface CorrectSourceParams {
  expectedRevision: number;
  reason?: string;
  segmentId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface MethodContract50 {
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
export interface MethodContract54 {
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
export interface MethodContract47 {
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
export interface MethodContract58 {
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
export interface MethodContract53 {
  params: PropagateSegmentParams;
  result: EditorMutationResult;
  [k: string]: unknown;
}
export interface PropagateSegmentParams {
  expectedRevision: number;
  segmentId: string;
  [k: string]: unknown;
}
export interface MethodContract56 {
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
export interface MethodContract55 {
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
export interface MethodContract66 {
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
export interface MethodContract57 {
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
export interface MethodContract51 {
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
export interface MethodContract48 {
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
export interface MethodContract60 {
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
export interface MethodContract30 {
  params: TaskPackageApplyParams;
  result: TaskPackageApplyResult;
  [k: string]: unknown;
}
export interface TaskPackageApplyParams {
  actor: string;
  expectedProjectRevision: number;
  previewId: string;
  reason?: string;
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
export interface MethodContract32 {
  params: TaskPackageDiscardParams;
  result: TaskPackageDiscardResult;
  [k: string]: unknown;
}
export interface TaskPackageDiscardParams {
  actor: string;
  packageId: string;
  previewId?: string | null;
  reason?: string;
  [k: string]: unknown;
}
export interface TaskPackageDiscardResult {
  packageId: string;
  previewId?: string | null;
  removedStagedFile: boolean;
  status: string;
  [k: string]: unknown;
}
export interface MethodContract28 {
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
  reason?: string;
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
export interface MethodContract31 {
  params: TaskPackageImportParams;
  result: TaskPackageImportResult;
  [k: string]: unknown;
}
export interface TaskPackageImportParams {
  actor: string;
  domain?: string | null;
  previewId: string;
  projectName?: string | null;
  reason?: string;
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
export interface MethodContract29 {
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
  reason?: string;
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
export interface MethodContract119 {
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
export interface MethodContract120 {
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
export interface MethodContract115 {
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
export interface MethodContract122 {
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
export interface MethodContract121 {
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
export interface MethodContract114 {
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
export interface MethodContract116 {
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
export interface MethodContract117 {
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
export interface MethodContract111 {
  params: ConcordanceParams;
  result: ConcordanceResult;
  [k: string]: unknown;
}
export interface MethodContract113 {
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
export interface MethodContract112 {
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
export interface MethodContract107 {
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
export interface MethodContract106 {
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
export interface MethodContract108 {
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
export interface MethodContract109 {
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
export interface MethodContract105 {
  params: ExactLookupParams;
  result: ExactLookupResult;
  [k: string]: unknown;
}
export interface MethodContract110 {
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
