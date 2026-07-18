//! Engine-owned SQLite persistence.

mod error;
mod migrations;
mod store;

pub use error::{Result, StorageError};
pub use store::{Confirmation, DataPaths, ManagedDocument, NewDocument, ProjectAggregate, Store};
