use thiserror::Error;
use translunar_alignment_core::AlignmentError;
use translunar_task_package_core::TaskPackageError;

pub type Result<T> = std::result::Result<T, StorageError>;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database operation failed: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("storage I/O failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("stored JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),

    #[error("alignment validation failed: {0}")]
    Alignment(#[from] AlignmentError),

    #[error("task package validation failed: {0}")]
    TaskPackage(#[from] TaskPackageError),

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

    #[error(
        "{entity} revision conflict for {id}: expected {expected_revision}, actual {actual_revision}"
    )]
    EntityConflict {
        entity: &'static str,
        id: String,
        expected_revision: u64,
        actual_revision: u64,
    },

    /// Advisory segment lock held by another actor (collaborative write gate).
    #[error(
        "segment lock held by {holder_actor_id} for {segment_id} (expires_at_ms={expires_at_ms})"
    )]
    LockHeld {
        segment_id: String,
        holder_actor_id: String,
        revision: u64,
        expires_at_ms: i64,
    },

    #[error("invalid state: {0}")]
    InvalidState(String),

    #[error("invalid QA profile: {0}")]
    QaProfileInvalid(String),

    #[error("invalid stored data: {0}")]
    InvalidData(String),

    #[error("database schema version {found} is newer than supported version {supported}")]
    SchemaTooNew { found: u32, supported: u32 },
}
