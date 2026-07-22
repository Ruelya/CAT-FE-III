//! Engine-owned SQLite persistence.

mod error;
mod migrations;
mod store;

pub use error::{Result, StorageError};
pub use store::{
    AiProviderProfileUpdate, AiSettingsUpdate, AlignmentLinkRecord, AlignmentMutationResult,
    AlignmentSessionCreateResult, AlignmentSessionRecord, AlignmentSessionSegmentRecord,
    AlignmentSessionStatus, AnalysisProfileRecord, AnalysisRunRecord, ArchiveDocumentData,
    ArchiveSegmentData, ArchiveTermbaseData, ArchiveTmLibraryData, ConcordanceRequest,
    Confirmation, DataPaths, EditorFilter, EditorFindMatch, EditorListRequest, EditorMutation,
    EditorReviewDecision, EditorSearchField, EditorSort, ExpectedAlignmentLinkRevision,
    GlobalSearchQuery, GlobalSearchResult, INTEROP_STRUCTURAL_PATH_METADATA, InteropApplyResult,
    InteropPreviewKind, InteropPreviewRecord, InteropPreviewRowRecord, InteropPreviewStatus,
    ManagedDocument, ManualAlignmentPartitionLink, NewAiBatchItem, NewAiBatchRun,
    NewAiProviderProfile, NewAiRun, NewAlignmentSession, NewDocument, NewInteropPreview,
    NewInteropPreviewRow, NewPipelineDefinition, NewProjectArchiveRecord, NewQaProfile,
    NewReimportPreview, NewTermEntry, NewTermTranslation, NewTermbase, NewTmLibrary,
    PipelineRunSnapshot, ProjectAggregate, ProjectArchiveData, ProjectFromTemplateResult,
    ProjectTemplateRecord, ProjectUpdate, QaIssueFilter, QaProfileUpdate, RecycleEntryRecord,
    ReferenceCorpusEntryRecord, ReferenceCorpusKind, ReferenceCorpusRecord,
    ReferenceCorpusSourceKind, ReferenceCorpusStatus, ReimportPreviewRecord,
    ReplaceAlignmentPartition, ReplaceItem, ReplacePreview, ReplaceRequest, ReviewInteropApply,
    ReviewProposal, Store, TableInteropApply, TermSearchRequest, TmSearchRequest,
    UpdateAlignmentLinkStatus, interop_comment_context,
};
