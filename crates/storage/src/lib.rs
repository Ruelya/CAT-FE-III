//! Engine-owned SQLite persistence.

mod error;
mod migrations;
mod store;

pub use error::{Result, StorageError};
pub use store::{
    AiProviderProfileUpdate, AiSettingsUpdate, ConcordanceRequest, Confirmation, DataPaths,
    EditorFilter, EditorFindMatch, EditorListRequest, EditorMutation, EditorReviewDecision,
    EditorSearchField, EditorSort, ManagedDocument, NewAiBatchItem, NewAiBatchRun,
    NewAiProviderProfile, NewAiRun, NewDocument, NewPipelineDefinition, NewQaProfile, NewTermEntry,
    NewTermTranslation, NewTermbase, NewTmLibrary, PipelineRunSnapshot, ProjectAggregate,
    ProjectUpdate, QaIssueFilter, QaProfileUpdate, ReplaceItem, ReplacePreview, ReplaceRequest,
    ReviewProposal, Store, TermSearchRequest, TmSearchRequest,
};
