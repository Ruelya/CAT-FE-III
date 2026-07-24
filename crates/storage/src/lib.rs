//! Engine-owned SQLite persistence.

mod error;
mod migrations;
mod store;

pub use error::{Result, StorageError};
pub use store::{
    AiProviderProfileUpdate, AiSettingsUpdate, AlignmentApplyDuplicate, AlignmentApplyResult,
    AlignmentLinkRecord, AlignmentMutationResult, AlignmentRefinementSelection,
    AlignmentSessionCreateResult, AlignmentSessionRecord, AlignmentSessionSegmentRecord,
    AlignmentSessionStatus, AnalysisProfileRecord, AnalysisRunRecord, ApplyAlignmentToTm,
    ApplyCuration, ArchiveDocumentData, ArchiveSegmentData, ArchiveTermbaseData,
    ArchiveTmLibraryData, AssetCatalogFilter, AssetCatalogItem, AssetCatalogKind, AssetCatalogPage,
    ConcordanceRequest, Confirmation, CreateCurationRun, CreateReferenceCorpusFromAlignment,
    CurationChangeAction, CurationChangeRecord, CurationDatasetSnapshot, CurationFindingRecord,
    CurationMutationResultRecord, CurationRunMode, CurationRunRecord, CurationRunStatus,
    CurationRunSummaryRecord, CurationRunUnitRecord, CurationSnapshot, CurationState, DataPaths,
    DiscussionMessageRecord, DiscussionScope, DiscussionStatus, DiscussionThreadFilter,
    DiscussionThreadRecord, EditorFilter, EditorFindMatch, EditorListRequest, EditorMutation,
    EditorReviewDecision, EditorSearchField, EditorSort, ExpectedAlignmentLinkRevision,
    GlobalSearchQuery, GlobalSearchResult, INTEROP_STRUCTURAL_PATH_METADATA, InteropApplyResult,
    InteropPreviewKind, InteropPreviewRecord, InteropPreviewRowRecord, InteropPreviewStatus,
    ManagedDocument, ManualAlignmentPartitionLink, NamedProjectSnapshotRecord, NewAiBatchItem,
    NewAiBatchRun, NewAiProviderProfile, NewAiRun, NewAlignmentSession, NewDiscussionMessage,
    NewDiscussionThread, NewDocument, NewInteropPreview, NewInteropPreviewRow,
    NewPipelineDefinition, NewProjectArchiveRecord, NewProjectSnapshot, NewQaProfile,
    NewReferenceCorpus, NewReferenceCorpusEntry, NewReimportPreview, NewTermEntry,
    NewTermTranslation, NewTermbase, NewTmLibrary, PipelineRunSnapshot, PluginInstallationRecord,
    PluginStatus, ProjectAggregate, ProjectArchiveData, ProjectFromTemplateResult,
    ProjectSnapshotChangeSummaryRecord, ProjectSnapshotPreviewRecord,
    ProjectSnapshotPreviewStatusRecord, ProjectSnapshotRestoreResultRecord, ProjectTemplateRecord,
    ProjectUpdate, QaIssueFilter, QaProfileUpdate, RecycleEntryRecord, ReferenceCorpusEntryRecord,
    ReferenceCorpusKind, ReferenceCorpusMatchKind, ReferenceCorpusMatchedSide,
    ReferenceCorpusMutationResult, ReferenceCorpusRecord, ReferenceCorpusSearchHit,
    ReferenceCorpusSearchRequest, ReferenceCorpusSearchResult, ReferenceCorpusSearchSide,
    ReferenceCorpusSourceKind, ReferenceCorpusStatus, ReimportPreviewRecord,
    ReindexReferenceCorpus, RemoveReferenceCorpus, ReplaceAlignmentPartition, ReplaceItem,
    ReplacePreview, ReplaceRequest, RestoreProjectSnapshot, ReviewInteropApply, ReviewProposal,
    RollbackCuration, Store, TableInteropApply, TaskPackageApply, TaskPackageApplyResult,
    TaskPackageAssignmentImport, TaskPackageAssignmentPreview, TaskPackageAssignmentSelection,
    TaskPackageAssignmentSnapshot, TaskPackageBindingRecord, TaskPackageDiagnostic,
    TaskPackageDiscardResult, TaskPackageDocumentImport, TaskPackageDocumentSnapshot,
    TaskPackageExportRecord, TaskPackageImportResult, TaskPackagePreviewCounts,
    TaskPackagePreviewRecord, TaskPackagePreviewRowRecord, TaskPackagePreviewStatus,
    TaskPackageRecord, TaskPackageRecordStatus, TaskPackageReturnPreview,
    TaskPackageReturnSnapshot, TermSearchRequest, TmSearchRequest, UpdateAlignmentLinkStatus,
    UpsertPluginInstallation, interop_comment_context, task_package_apply_request_digest,
};
