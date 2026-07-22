//! Engine-owned SQLite persistence.

mod error;
mod migrations;
mod store;

pub use error::{Result, StorageError};
pub use store::{
    AiProviderProfileUpdate, AiSettingsUpdate, AlignmentLinkRecord, AlignmentSessionRecord,
    AlignmentSessionSegmentRecord, AlignmentSessionStatus, AnalysisProfileRecord,
    AnalysisRunRecord, ArchiveDocumentData, ArchiveSegmentData, ArchiveTermbaseData,
    ArchiveTmLibraryData, ConcordanceRequest, Confirmation, DataPaths, EditorFilter,
    EditorFindMatch, EditorListRequest, EditorMutation, EditorReviewDecision, EditorSearchField,
    EditorSort, GlobalSearchQuery, GlobalSearchResult, INTEROP_STRUCTURAL_PATH_METADATA,
    InteropApplyResult, InteropPreviewKind, InteropPreviewRecord, InteropPreviewRowRecord,
    InteropPreviewStatus, ManagedDocument, NewAiBatchItem, NewAiBatchRun, NewAiProviderProfile,
    NewAiRun, NewDocument, NewInteropPreview, NewInteropPreviewRow, NewPipelineDefinition,
    NewProjectArchiveRecord, NewQaProfile, NewReimportPreview, NewTermEntry, NewTermTranslation,
    NewTermbase, NewTmLibrary, PipelineRunSnapshot, ProjectAggregate, ProjectArchiveData,
    ProjectFromTemplateResult, ProjectTemplateRecord, ProjectUpdate, QaIssueFilter,
    QaProfileUpdate, RecycleEntryRecord, ReferenceCorpusEntryRecord, ReferenceCorpusKind,
    ReferenceCorpusRecord, ReferenceCorpusSourceKind, ReferenceCorpusStatus, ReimportPreviewRecord,
    ReplaceItem, ReplacePreview, ReplaceRequest, ReviewInteropApply, ReviewProposal, Store,
    TableInteropApply, TermSearchRequest, TmSearchRequest, interop_comment_context,
};
