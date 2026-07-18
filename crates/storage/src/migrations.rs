use rusqlite::{Connection, TransactionBehavior};

use crate::{Result, StorageError};

pub(crate) const LATEST_SCHEMA_VERSION: u32 = 3;

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

#[cfg(test)]
pub(crate) fn create_schema_v1(connection: &mut Connection) -> Result<()> {
    configure_connection(connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute_batch(MIGRATION_1)?;
    transaction.pragma_update(None, "user_version", 1_u32)?;
    transaction.commit()?;
    Ok(())
}

const MIGRATION_2: &str = r#"
ALTER TABLE projects ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active', 'archived', 'trash'));
ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
ALTER TABLE projects ADD COLUMN configuration_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN archived_at_ms INTEGER;

ALTER TABLE documents ADD COLUMN relative_path TEXT NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN filter_id TEXT NOT NULL DEFAULT 'builtin.docx';
ALTER TABLE documents ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1
    CHECK (current_version >= 1);
ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'failed', 'superseded'));
ALTER TABLE documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
ALTER TABLE documents ADD COLUMN degradation_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE documents ADD COLUMN updated_at_ms INTEGER NOT NULL DEFAULT 0;
UPDATE documents SET updated_at_ms = imported_at_ms WHERE updated_at_ms = 0;

CREATE TABLE document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 1),
    source_sha256 TEXT NOT NULL,
    original_source_path TEXT NOT NULL,
    managed_source_path TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    UNIQUE(document_id, version)
) STRICT;

INSERT INTO document_versions (
    id, document_id, version, source_sha256, original_source_path,
    managed_source_path, reason, created_at_ms
)
SELECT id || ':v1', id, 1, source_sha256, original_source_path,
       managed_source_path, 'legacy-import', imported_at_ms
FROM documents;

ALTER TABLE segments ADD COLUMN document_version_id TEXT
    REFERENCES document_versions(id) ON DELETE RESTRICT;
ALTER TABLE segments ADD COLUMN source_version INTEGER NOT NULL DEFAULT 1
    CHECK (source_version >= 1);
UPDATE segments SET document_version_id = document_id || ':v1'
WHERE document_version_id IS NULL;

CREATE TABLE inline_tags (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK (side IN ('source', 'target')),
    position INTEGER NOT NULL CHECK (position >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('start', 'end', 'standalone')),
    pair_id TEXT,
    payload TEXT NOT NULL,
    display_text TEXT NOT NULL,
    protected INTEGER NOT NULL CHECK (protected IN (0, 1)),
    UNIQUE(segment_id, side, id)
) STRICT;

CREATE INDEX inline_tags_segment_idx
    ON inline_tags(segment_id, side, position, id);

CREATE TABLE operations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    base_revision INTEGER CHECK (base_revision >= 0),
    result_revision INTEGER CHECK (result_revision >= 0),
    actor TEXT NOT NULL,
    correlation_id TEXT,
    before_json TEXT,
    after_json TEXT,
    created_at_ms INTEGER NOT NULL,
    UNIQUE(project_id, sequence)
) STRICT;

CREATE INDEX operations_project_sequence_idx
    ON operations(project_id, sequence DESC);
CREATE INDEX operations_entity_idx
    ON operations(entity_type, entity_id, sequence DESC);
"#;

const MIGRATION_3: &str = r#"
CREATE TABLE pipeline_definitions (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX pipeline_definitions_project_idx
    ON pipeline_definitions(project_id, updated_at_ms DESC, id);

CREATE TABLE pipeline_steps (
    definition_id TEXT NOT NULL REFERENCES pipeline_definitions(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL CHECK (step_index >= 0),
    step_key TEXT NOT NULL,
    step_id TEXT NOT NULL,
    config_json TEXT NOT NULL,
    PRIMARY KEY(definition_id, step_index),
    UNIQUE(definition_id, step_key)
) STRICT;

CREATE TABLE pipeline_runs (
    id TEXT PRIMARY KEY,
    definition_id TEXT NOT NULL REFERENCES pipeline_definitions(id) ON DELETE RESTRICT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'canceling', 'canceled', 'interrupted', 'succeeded', 'failed')
    ),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    current_step_index INTEGER NOT NULL DEFAULT 0 CHECK (current_step_index >= 0),
    step_count INTEGER NOT NULL CHECK (step_count >= 0),
    cancellation_requested INTEGER NOT NULL DEFAULT 0
        CHECK (cancellation_requested IN (0, 1)),
    input_json TEXT NOT NULL,
    output_json TEXT,
    error_json TEXT,
    created_at_ms INTEGER NOT NULL,
    started_at_ms INTEGER,
    completed_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX pipeline_runs_project_idx
    ON pipeline_runs(project_id, created_at_ms DESC, id);
CREATE INDEX pipeline_runs_status_idx
    ON pipeline_runs(status, updated_at_ms, id);

CREATE TABLE pipeline_step_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    step_id TEXT NOT NULL,
    step_index INTEGER NOT NULL CHECK (step_index >= 0),
    status TEXT NOT NULL CHECK (
        status IN ('pending', 'running', 'canceled', 'interrupted', 'succeeded', 'failed', 'skipped')
    ),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    input_json TEXT,
    output_json TEXT,
    checkpoint_json TEXT,
    usage_json TEXT,
    error_json TEXT,
    started_at_ms INTEGER,
    completed_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(run_id, step_index),
    UNIQUE(run_id, step_key)
) STRICT;

CREATE INDEX pipeline_step_runs_run_idx
    ON pipeline_step_runs(run_id, step_index);
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

    for (version, sql) in [
        (1_u32, MIGRATION_1),
        (2_u32, MIGRATION_2),
        (3_u32, MIGRATION_3),
    ] {
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
