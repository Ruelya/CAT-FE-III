use rusqlite::{Connection, TransactionBehavior};

use crate::{Result, StorageError};

pub(crate) const LATEST_SCHEMA_VERSION: u32 = 1;

const MIGRATION_1: &str = r#"
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_locale TEXT NOT NULL,
    target_locale TEXT NOT NULL,
    domain TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    format TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    original_source_path TEXT NOT NULL,
    managed_source_path TEXT NOT NULL,
    segment_count INTEGER NOT NULL CHECK (segment_count >= 0),
    imported_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX documents_project_idx ON documents(project_id, imported_at_ms, id);

CREATE TABLE segments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    structural_path TEXT NOT NULL,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL CHECK (state IN ('untranslated', 'draft', 'confirmed')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    source_hash TEXT NOT NULL,
    context_hash TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(document_id, ordinal),
    UNIQUE(document_id, structural_path)
) STRICT;

CREATE INDEX segments_document_idx ON segments(document_id, ordinal);
CREATE INDEX segments_source_hash_idx ON segments(source_hash);

CREATE TABLE translation_memories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source_locale TEXT NOT NULL,
    target_locale TEXT NOT NULL,
    writable INTEGER NOT NULL CHECK (writable IN (0, 1))
) STRICT;

CREATE TABLE tm_entries (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL REFERENCES translation_memories(id) ON DELETE CASCADE,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    origin_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    origin_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    origin_segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    confirmed_at_ms INTEGER NOT NULL,
    UNIQUE(memory_id, origin_segment_id)
) STRICT;

CREATE INDEX tm_entries_exact_idx ON tm_entries(memory_id, source_hash, confirmed_at_ms DESC);

CREATE TABLE qa_issues (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    rule_id TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
    message TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(segment_id, rule_id, fingerprint)
) STRICT;

CREATE INDEX qa_issues_segment_idx ON qa_issues(segment_id, status, rule_id);
"#;

pub(crate) fn configure_connection(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;\n\
         PRAGMA journal_mode = WAL;\n\
         PRAGMA synchronous = NORMAL;\n\
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

pub(crate) fn migrate(connection: &mut Connection) -> Result<()> {
    let current =
        connection.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))?;
    if current > LATEST_SCHEMA_VERSION {
        return Err(StorageError::SchemaTooNew {
            found: current,
            supported: LATEST_SCHEMA_VERSION,
        });
    }

    for (version, sql) in [(1_u32, MIGRATION_1)] {
        if version <= current {
            continue;
        }

        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(sql)?;
        transaction.pragma_update(None, "user_version", version)?;
        transaction.commit()?;
    }

    Ok(())
}
