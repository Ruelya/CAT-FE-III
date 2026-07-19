//! Engine-owned SQLite persistence.

mod error;
mod migrations;
mod store;

pub use error::{Result, StorageError};
pub use store::{
    AiProviderProfileUpdate, AiSettingsUpdate, ConcordanceRequest, Confirmation, DataPaths,
    EditorFilter, EditorFindMatch, EditorListRequest, EditorMutation, EditorReviewDecision,
    EditorSearchField, EditorSort, ManagedDocument, NewAiBatchItem, NewAiBatchRun,
    NewAiProviderProfile, NewAiRun, NewDocument, NewPipelineDefinition, NewTermEntry,
    NewTermTranslation, NewTermbase, NewTmLibrary, PipelineRunSnapshot, ProjectAggregate,
    ProjectUpdate, ReplaceItem, ReplacePreview, ReplaceRequest, ReviewProposal, Store,
    TermSearchRequest, TmSearchRequest,
};
