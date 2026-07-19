//! Engine-owned SQLite persistence.

mod error;
mod migrations;
mod store;

pub use error::{Result, StorageError};
pub use store::{
    ConcordanceRequest, Confirmation, DataPaths, EditorFilter, EditorFindMatch, EditorListRequest,
    EditorMutation, EditorReviewDecision, EditorSearchField, EditorSort, ManagedDocument,
    NewDocument, NewPipelineDefinition, NewTermEntry, NewTermTranslation, NewTermbase,
    NewTmLibrary, PipelineRunSnapshot, ProjectAggregate, ProjectUpdate, ReplaceItem,
    ReplacePreview, ReplaceRequest, ReviewProposal, Store, TermSearchRequest, TmSearchRequest,
};
