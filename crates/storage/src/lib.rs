//! Engine-owned SQLite persistence.

mod error;
mod migrations;
mod store;

pub use error::{Result, StorageError};
pub use store::{
    ConcordanceRequest, Confirmation, DataPaths, ManagedDocument, NewDocument,
    NewPipelineDefinition, NewTermEntry, NewTermTranslation, NewTermbase, NewTmLibrary,
    PipelineRunSnapshot, ProjectAggregate, ProjectUpdate, Store, TermSearchRequest,
    TmSearchRequest,
};
