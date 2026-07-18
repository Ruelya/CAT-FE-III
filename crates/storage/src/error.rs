use thiserror::Error;

pub type Result<T> = std::result::Result<T, StorageError>;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database operation failed: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("storage I/O failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("stored JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{entity} not found: {id}")]
    NotFound { entity: &'static str, id: String },

    #[error(
        "segment revision conflict for {segment_id}: expected {expected_revision}, actual {actual_revision}"
    )]
    Conflict {
        segment_id: String,
        expected_revision: u64,
        actual_revision: u64,
    },

    #[error("invalid state: {0}")]
    InvalidState(String),

    #[error("invalid stored data: {0}")]
    InvalidData(String),

    #[error("database schema version {found} is newer than supported version {supported}")]
    SchemaTooNew { found: u32, supported: u32 },
}
