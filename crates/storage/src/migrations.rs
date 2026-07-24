use rusqlite::{Connection, TransactionBehavior};

use crate::{Result, StorageError};

pub(crate) const LATEST_SCHEMA_VERSION: u32 = 17;

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

const MIGRATION_4: &str = r#"
CREATE TABLE tm_libraries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_locale TEXT NOT NULL,
    target_locale TEXT NOT NULL,
    domain TEXT,
    owner_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    writable INTEGER NOT NULL CHECK (writable IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX tm_libraries_pair_idx
    ON tm_libraries(source_locale, target_locale, domain, updated_at_ms DESC, id);

CREATE TABLE tm_library_mounts (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    library_id TEXT NOT NULL REFERENCES tm_libraries(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('write', 'reference')),
    priority INTEGER NOT NULL CHECK (priority >= 0),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(project_id, library_id)
) STRICT;

CREATE INDEX tm_library_mounts_project_idx
    ON tm_library_mounts(project_id, enabled, priority, library_id);

CREATE TABLE tm_units (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES tm_libraries(id) ON DELETE CASCADE,
    source_locale TEXT NOT NULL,
    target_locale TEXT NOT NULL,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    source_key TEXT NOT NULL,
    target_hash TEXT NOT NULL,
    domain TEXT,
    origin_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    origin_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    origin_segment_id TEXT REFERENCES segments(id) ON DELETE SET NULL,
    context_before_hash TEXT,
    context_after_hash TEXT,
    author TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(library_id, origin_project_id, origin_document_id, origin_segment_id)
) STRICT;

CREATE INDEX tm_units_source_idx
    ON tm_units(library_id, source_locale, target_locale, source_key);
CREATE INDEX tm_units_metadata_idx
    ON tm_units(library_id, domain, created_at_ms DESC, id);
CREATE INDEX tm_units_origin_idx
    ON tm_units(origin_project_id, origin_document_id, origin_segment_id);

CREATE TABLE termbases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_locale TEXT NOT NULL,
    domain TEXT,
    writable INTEGER NOT NULL CHECK (writable IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX termbases_locale_idx
    ON termbases(source_locale, domain, updated_at_ms DESC, id);

CREATE TABLE termbase_mounts (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    termbase_id TEXT NOT NULL REFERENCES termbases(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL CHECK (priority >= 0),
    writable INTEGER NOT NULL CHECK (writable IN (0, 1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(project_id, termbase_id)
) STRICT;

CREATE INDEX termbase_mounts_project_idx
    ON termbase_mounts(project_id, enabled, priority, termbase_id);

CREATE TABLE term_entries (
    id TEXT PRIMARY KEY,
    termbase_id TEXT NOT NULL REFERENCES termbases(id) ON DELETE CASCADE,
    source_locale TEXT NOT NULL,
    source_term TEXT NOT NULL,
    source_key TEXT NOT NULL,
    part_of_speech TEXT,
    definition TEXT,
    example TEXT,
    domain TEXT,
    status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'deprecated')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(termbase_id, source_key)
) STRICT;

CREATE INDEX term_entries_lookup_idx
    ON term_entries(termbase_id, source_locale, source_key, status);

CREATE TABLE term_translations (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES term_entries(id) ON DELETE CASCADE,
    locale TEXT NOT NULL,
    term TEXT NOT NULL,
    term_key TEXT NOT NULL,
    preferred INTEGER NOT NULL CHECK (preferred IN (0, 1)),
    forbidden INTEGER NOT NULL CHECK (forbidden IN (0, 1)),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(entry_id, locale, term_key)
) STRICT;

CREATE INDEX term_translations_lookup_idx
    ON term_translations(entry_id, locale, preferred DESC, forbidden DESC, term_key);

INSERT INTO tm_libraries (
    id, name, source_locale, target_locale, domain, owner_project_id,
    writable, revision, created_at_ms, updated_at_ms
)
SELECT id, name, source_locale, target_locale, NULL, project_id,
       writable, 0, 0, 0
FROM translation_memories;

INSERT INTO tm_library_mounts (
    project_id, library_id, mode, priority, enabled, revision,
    created_at_ms, updated_at_ms
)
SELECT project_id, id, 'write', 0, 1, 0, 0, 0
FROM translation_memories;

INSERT INTO tm_units (
    id, library_id, source_locale, target_locale, source_text, target_text,
    source_hash, source_key, target_hash, domain, origin_project_id,
    origin_document_id, origin_segment_id, context_before_hash,
    context_after_hash, author, metadata_json, created_at_ms, updated_at_ms
)
SELECT e.id, e.memory_id, tm.source_locale, tm.target_locale, e.source_text,
       e.target_text, e.source_hash, e.source_text, '', NULL,
       e.origin_project_id, e.origin_document_id, e.origin_segment_id,
       NULL, NULL, NULL, '{}', e.confirmed_at_ms, e.confirmed_at_ms
FROM tm_entries e
JOIN translation_memories tm ON tm.id = e.memory_id;
"#;

const MIGRATION_5: &str = r#"
CREATE TABLE segment_notes (
    segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    text TEXT NOT NULL,
    author TEXT,
    PRIMARY KEY(segment_id, id)
) STRICT;

CREATE INDEX segment_notes_segment_idx
    ON segment_notes(segment_id, id);
"#;

const MIGRATION_6: &str = r#"
CREATE TABLE segment_editor_meta (
    segment_id TEXT PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
    workflow_state TEXT NOT NULL DEFAULT 'translation'
        CHECK (workflow_state IN ('translation', 'review', 'signed')),
    lineage_id TEXT,
    source_edit_revision INTEGER NOT NULL DEFAULT 0 CHECK (source_edit_revision >= 0),
    updated_at_ms INTEGER NOT NULL
) STRICT;

INSERT INTO segment_editor_meta (segment_id, workflow_state, source_edit_revision, updated_at_ms)
SELECT id, 'translation', 0, updated_at_ms FROM segments;

CREATE TRIGGER segment_editor_meta_after_insert
AFTER INSERT ON segments
BEGIN
    INSERT INTO segment_editor_meta (
        segment_id, workflow_state, source_edit_revision, updated_at_ms
    ) VALUES (NEW.id, 'translation', 0, NEW.updated_at_ms);
END;

CREATE TABLE segment_comments (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
    immutable INTEGER NOT NULL DEFAULT 0 CHECK (immutable IN (0, 1))
) STRICT;

CREATE INDEX segment_comments_segment_idx
    ON segment_comments(segment_id, resolved, updated_at_ms DESC, id);

CREATE TABLE editor_operations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    base_revision INTEGER,
    result_revision INTEGER,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    actor TEXT NOT NULL,
    reason TEXT,
    undone INTEGER NOT NULL DEFAULT 0 CHECK (undone IN (0, 1)),
    generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
    created_at_ms INTEGER NOT NULL,
    UNIQUE(project_id, sequence)
) STRICT;

CREATE INDEX editor_operations_cursor_idx
    ON editor_operations(project_id, undone, generation, sequence DESC);

CREATE TABLE editor_cursors (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    cursor_sequence INTEGER NOT NULL DEFAULT 0 CHECK (cursor_sequence >= 0),
    generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
    updated_at_ms INTEGER NOT NULL
) STRICT;

INSERT INTO editor_cursors (project_id, cursor_sequence, generation, updated_at_ms)
SELECT id, 0, 0, updated_at_ms FROM projects;

CREATE TRIGGER editor_cursor_after_project_insert
AFTER INSERT ON projects
BEGIN
    INSERT INTO editor_cursors (
        project_id, cursor_sequence, generation, updated_at_ms
    ) VALUES (NEW.id, 0, 0, NEW.updated_at_ms);
END;

CREATE TABLE user_dictionary (
    locale TEXT NOT NULL,
    word TEXT NOT NULL,
    normalized_word TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY(locale, normalized_word)
) STRICT;

CREATE TABLE editor_preferences (
    id TEXT PRIMARY KEY CHECK (id = 'default'),
    preferences_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE review_revisions (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
    before_target TEXT NOT NULL,
    proposed_target TEXT NOT NULL,
    author TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX review_revisions_segment_idx
    ON review_revisions(segment_id, status, created_at_ms DESC, id);
"#;

const MIGRATION_7: &str = r#"
ALTER TABLE review_revisions ADD COLUMN before_source TEXT NOT NULL DEFAULT '';
ALTER TABLE review_revisions ADD COLUMN proposed_source TEXT;
ALTER TABLE review_revisions ADD COLUMN before_target_tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE review_revisions ADD COLUMN proposed_target_tags_json TEXT;
"#;

const MIGRATION_8: &str = r#"
CREATE TABLE ai_provider_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (
        'openai', 'anthropic', 'gemini', 'deepl', 'deepseek', 'qwen', 'glm',
        'kimi', 'volcengine', 'openai_compatible'
    )),
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 1000 AND 300000),
    max_response_bytes INTEGER NOT NULL
        CHECK (max_response_bytes BETWEEN 1024 AND 33554432),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    credential_present INTEGER NOT NULL DEFAULT 0
        CHECK (credential_present IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX ai_provider_profiles_enabled_idx
    ON ai_provider_profiles(enabled, updated_at_ms DESC, id);

CREATE TABLE ai_settings (
    id TEXT PRIMARY KEY CHECK (id = 'default'),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    default_profile_id TEXT REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
    monthly_token_budget INTEGER CHECK (monthly_token_budget >= 0),
    allow_interactive INTEGER NOT NULL DEFAULT 1 CHECK (allow_interactive IN (0, 1)),
    allow_batch INTEGER NOT NULL DEFAULT 1 CHECK (allow_batch IN (0, 1)),
    allowed_origins_json TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at_ms INTEGER NOT NULL DEFAULT 0
) STRICT;

INSERT INTO ai_settings (
    id, enabled, default_profile_id, monthly_token_budget, allow_interactive,
    allow_batch, allowed_origins_json, revision, updated_at_ms
) VALUES ('default', 0, NULL, NULL, 1, 1, '[]', 0, 0);

CREATE TABLE ai_runs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN (
        'interactive', 'action', 'provider_test', 'batch_item'
    )),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    segment_id TEXT REFERENCES segments(id) ON DELETE CASCADE,
    profile_id TEXT REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    action TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    request_json TEXT NOT NULL DEFAULT '{}',
    base_segment_revision INTEGER CHECK (base_segment_revision >= 0),
    status TEXT NOT NULL CHECK (status IN (
        'queued', 'running', 'retrying', 'interrupted', 'canceling',
        'canceled', 'succeeded', 'failed'
    )),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10),
    cancellation_requested INTEGER NOT NULL DEFAULT 0
        CHECK (cancellation_requested IN (0, 1)),
    proposal_text TEXT,
    error_code TEXT,
    error_message TEXT,
    error_retryable INTEGER NOT NULL DEFAULT 0 CHECK (error_retryable IN (0, 1)),
    created_at_ms INTEGER NOT NULL,
    started_at_ms INTEGER,
    completed_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX ai_runs_project_idx
    ON ai_runs(project_id, created_at_ms DESC, id);
CREATE INDEX ai_runs_status_idx
    ON ai_runs(status, updated_at_ms, id);

CREATE TABLE ai_run_events (
    run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    kind TEXT NOT NULL CHECK (kind IN (
        'started', 'attempt', 'delta', 'usage', 'retry', 'completed', 'failed',
        'canceling', 'canceled', 'interrupted'
    )),
    delta_text TEXT,
    usage_json TEXT,
    attempt INTEGER CHECK (attempt >= 0),
    retry_after_ms INTEGER CHECK (retry_after_ms >= 0),
    message TEXT,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY(run_id, sequence)
) STRICT;

CREATE TABLE ai_batch_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES ai_provider_profiles(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN (
        'queued', 'running', 'interrupted', 'canceling', 'canceled',
        'succeeded', 'completed_with_errors', 'failed'
    )),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    tm_threshold INTEGER NOT NULL CHECK (tm_threshold BETWEEN 0 AND 101),
    concurrency INTEGER NOT NULL CHECK (concurrency BETWEEN 1 AND 16),
    requests_per_minute INTEGER NOT NULL
        CHECK (requests_per_minute BETWEEN 1 AND 600),
    max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
    replace_drafts INTEGER NOT NULL DEFAULT 0 CHECK (replace_drafts IN (0, 1)),
    grounding_options_json TEXT NOT NULL DEFAULT '{}',
    cancellation_requested INTEGER NOT NULL DEFAULT 0
        CHECK (cancellation_requested IN (0, 1)),
    total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed >= 0),
    succeeded INTEGER NOT NULL DEFAULT 0 CHECK (succeeded >= 0),
    failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
    skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped >= 0),
    tm_applied INTEGER NOT NULL DEFAULT 0 CHECK (tm_applied >= 0),
    usage_json TEXT NOT NULL DEFAULT '{}',
    created_at_ms INTEGER NOT NULL,
    started_at_ms INTEGER,
    completed_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX ai_batch_runs_project_idx
    ON ai_batch_runs(project_id, created_at_ms DESC, id);
CREATE INDEX ai_batch_runs_status_idx
    ON ai_batch_runs(status, updated_at_ms, id);

CREATE TABLE ai_batch_items (
    batch_id TEXT NOT NULL REFERENCES ai_batch_runs(id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
    status TEXT NOT NULL CHECK (status IN (
        'pending', 'tm_applied', 'running', 'succeeded', 'retrying', 'failed',
        'skipped', 'canceled'
    )),
    source TEXT CHECK (source IN ('tm', 'engine')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
    error_code TEXT,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(batch_id, segment_id)
) STRICT;

CREATE INDEX ai_batch_items_claim_idx
    ON ai_batch_items(batch_id, status, ordinal, segment_id);

CREATE TABLE ai_usage_records (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL CHECK (attempt >= 1),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    profile_id TEXT REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
    provider TEXT NOT NULL CHECK (provider IN (
        'openai', 'anthropic', 'gemini', 'deepl', 'deepseek', 'qwen', 'glm',
        'kimi', 'volcengine', 'openai_compatible'
    )),
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    input_tokens INTEGER CHECK (input_tokens >= 0),
    cache_read_tokens INTEGER CHECK (cache_read_tokens >= 0),
    reasoning_tokens INTEGER CHECK (reasoning_tokens >= 0),
    output_tokens INTEGER CHECK (output_tokens >= 0),
    cache_write_tokens INTEGER CHECK (cache_write_tokens >= 0),
    elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0),
    created_at_ms INTEGER NOT NULL,
    UNIQUE(run_id, attempt)
) STRICT;

CREATE INDEX ai_usage_records_month_idx
    ON ai_usage_records(created_at_ms, project_id, profile_id, provider, model);

CREATE TABLE ai_conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX ai_conversations_project_idx
    ON ai_conversations(project_id, archived, updated_at_ms DESC, id);

CREATE TABLE ai_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text TEXT NOT NULL,
    target_proposal TEXT,
    segment_id TEXT REFERENCES segments(id) ON DELETE SET NULL,
    run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
    created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX ai_messages_conversation_idx
    ON ai_messages(conversation_id, created_at_ms, id);
"#;

const MIGRATION_9: &str = r#"
CREATE TABLE qa_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    built_in INTEGER NOT NULL CHECK (built_in IN (0, 1)),
    definition_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX qa_profiles_owner_idx
    ON qa_profiles(owner_project_id, built_in DESC, updated_at_ms DESC, id);

CREATE TABLE qa_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('document', 'project')),
    profile_id TEXT NOT NULL REFERENCES qa_profiles(id) ON DELETE RESTRICT,
    profile_name TEXT NOT NULL,
    profile_revision INTEGER NOT NULL CHECK (profile_revision >= 0),
    profile_snapshot_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    checked_segments INTEGER NOT NULL DEFAULT 0 CHECK (checked_segments >= 0),
    errors INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
    warnings INTEGER NOT NULL DEFAULT 0 CHECK (warnings >= 0),
    info INTEGER NOT NULL DEFAULT 0 CHECK (info >= 0),
    waived INTEGER NOT NULL DEFAULT 0 CHECK (waived >= 0),
    created_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER
) STRICT;

CREATE INDEX qa_runs_project_idx
    ON qa_runs(project_id, created_at_ms DESC, id);
CREATE INDEX qa_runs_document_idx
    ON qa_runs(document_id, created_at_ms DESC, id);

ALTER TABLE qa_issues ADD COLUMN category TEXT NOT NULL DEFAULT 'numbers'
    CHECK (category IN (
        'completeness', 'numbers', 'tags', 'punctuation', 'whitespace',
        'repetition', 'length', 'terminology', 'consistency', 'custom'
    ));
ALTER TABLE qa_issues ADD COLUMN profile_id TEXT REFERENCES qa_profiles(id) ON DELETE SET NULL;
ALTER TABLE qa_issues ADD COLUMN run_id TEXT REFERENCES qa_runs(id) ON DELETE SET NULL;
UPDATE qa_issues SET category = 'terminology' WHERE rule_id LIKE 'term-forbidden:%';

CREATE INDEX qa_issues_gate_idx
    ON qa_issues(status, severity, segment_id, category, rule_id);
CREATE INDEX qa_issues_run_idx ON qa_issues(run_id, segment_id, rule_id);

CREATE TABLE qa_waivers (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES qa_issues(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    revoked_at_ms INTEGER,
    UNIQUE(issue_id, fingerprint)
) STRICT;

CREATE INDEX qa_waivers_active_idx
    ON qa_waivers(issue_id, fingerprint, revoked_at_ms);

CREATE TABLE qa_run_items (
    run_id TEXT NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    document_name TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    segment_ordinal INTEGER NOT NULL CHECK (segment_ordinal >= 0),
    rule_id TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK (disposition IN ('open', 'waived', 'resolved')),
    message TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    waiver_actor TEXT,
    waiver_reason TEXT,
    PRIMARY KEY(run_id, issue_id)
) STRICT;

CREATE INDEX qa_run_items_report_idx
    ON qa_run_items(run_id, segment_ordinal, rule_id, issue_id);

CREATE TABLE qa_report_records (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('html', 'xlsx')),
    output_path TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    UNIQUE(run_id, format, output_path)
) STRICT;

CREATE TABLE qa_export_overrides (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES qa_runs(id) ON DELETE RESTRICT,
    actor TEXT NOT NULL,
    reason TEXT NOT NULL,
    error_count INTEGER NOT NULL CHECK (error_count > 0),
    destination_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX qa_export_overrides_project_idx
    ON qa_export_overrides(project_id, created_at_ms DESC, id);

INSERT INTO qa_profiles (
    id, name, owner_project_id, built_in, definition_json, revision,
    created_at_ms, updated_at_ms
) VALUES
    ('builtin.qa.standard', 'Standard', NULL, 1, '{}', 0, 0, 0),
    ('builtin.qa.cjk-professional', 'CJK professional', NULL, 1, '{}', 0, 0, 0);
"#;

const MIGRATION_10: &str = r#"
ALTER TABLE documents ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active', 'trash'));
ALTER TABLE termbases ADD COLUMN owner_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
UPDATE termbases
SET owner_project_id = (
    SELECT MIN(m.project_id) FROM termbase_mounts m
    WHERE m.termbase_id = termbases.id AND m.writable = 1
)
WHERE writable = 1 AND (
    SELECT COUNT(DISTINCT m.project_id) FROM termbase_mounts m
    WHERE m.termbase_id = termbases.id AND m.writable = 1
) = 1;

CREATE TABLE project_templates (
    id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    definition_json TEXT NOT NULL,
    built_in INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0, 1)),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(id, revision)
) STRICT;

CREATE INDEX project_templates_latest_idx
    ON project_templates(id, revision DESC);
CREATE INDEX project_templates_name_idx
    ON project_templates(updated_at_ms DESC, name, id);

CREATE TABLE document_reimport_previews (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    expected_document_revision INTEGER NOT NULL CHECK (expected_document_revision >= 0),
    candidate_source_sha256 TEXT NOT NULL,
    original_source_path TEXT NOT NULL,
    staged_source_path TEXT NOT NULL,
    filter_id TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'applied', 'discarded')),
    actor TEXT NOT NULL,
    unchanged_count INTEGER NOT NULL CHECK (unchanged_count >= 0),
    changed_count INTEGER NOT NULL CHECK (changed_count >= 0),
    new_count INTEGER NOT NULL CHECK (new_count >= 0),
    removed_count INTEGER NOT NULL CHECK (removed_count >= 0),
    ambiguous_count INTEGER NOT NULL CHECK (ambiguous_count >= 0),
    created_at_ms INTEGER NOT NULL,
    applied_at_ms INTEGER
) STRICT;

CREATE INDEX document_reimport_previews_document_idx
    ON document_reimport_previews(document_id, created_at_ms DESC, id);

CREATE TABLE document_reimport_items (
    preview_id TEXT NOT NULL REFERENCES document_reimport_previews(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    disposition TEXT NOT NULL
        CHECK (disposition IN ('unchanged', 'changed', 'new', 'removed', 'ambiguous')),
    old_segment_id TEXT,
    new_segment_key TEXT,
    old_ordinal INTEGER CHECK (old_ordinal >= 0),
    new_ordinal INTEGER CHECK (new_ordinal >= 0),
    structural_path TEXT,
    source_text TEXT,
    imported_unit_json TEXT,
    reason TEXT NOT NULL,
    PRIMARY KEY(preview_id, ordinal)
) STRICT;

CREATE INDEX document_reimport_items_old_segment_idx
    ON document_reimport_items(old_segment_id, preview_id);

CREATE TABLE document_version_segments (
    version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
    old_segment_id TEXT NOT NULL,
    old_ordinal INTEGER NOT NULL CHECK (old_ordinal >= 0),
    disposition TEXT NOT NULL
        CHECK (disposition IN ('unchanged', 'changed', 'removed', 'ambiguous')),
    snapshot_json TEXT NOT NULL,
    PRIMARY KEY(version_id, old_segment_id)
) STRICT;

CREATE INDEX document_version_segments_ordinal_idx
    ON document_version_segments(version_id, old_ordinal, old_segment_id);

CREATE TABLE recycle_entries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'document')),
    entity_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    previous_state TEXT NOT NULL,
    actor TEXT NOT NULL,
    reason TEXT NOT NULL,
    deleted_at_ms INTEGER NOT NULL,
    retention_until_ms INTEGER NOT NULL,
    restored_at_ms INTEGER,
    purged_at_ms INTEGER,
    UNIQUE(entity_type, entity_id, deleted_at_ms)
) STRICT;

CREATE INDEX recycle_entries_active_idx
    ON recycle_entries(purged_at_ms, restored_at_ms, deleted_at_ms DESC, id);
CREATE INDEX recycle_entries_project_idx
    ON recycle_entries(project_id, deleted_at_ms DESC, id);

CREATE TABLE project_archive_records (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    direction TEXT NOT NULL CHECK (direction IN ('export', 'restore')),
    format_version INTEGER NOT NULL CHECK (format_version >= 1),
    archive_path TEXT NOT NULL,
    archive_sha256 TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('staged', 'succeeded', 'failed')),
    actor TEXT NOT NULL,
    error_code TEXT,
    created_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER
) STRICT;

CREATE INDEX project_archive_records_project_idx
    ON project_archive_records(project_id, created_at_ms DESC, id);

CREATE TABLE analysis_profiles (
    id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    name TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    built_in INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0, 1)),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(id, revision)
) STRICT;

CREATE INDEX analysis_profiles_latest_idx
    ON analysis_profiles(id, revision DESC);

CREATE TABLE analysis_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('project', 'document')),
    profile_id TEXT NOT NULL,
    profile_revision INTEGER NOT NULL CHECK (profile_revision >= 1),
    project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
    document_revision INTEGER CHECK (document_revision >= 0),
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
    summary_json TEXT,
    error_code TEXT,
    created_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER,
    FOREIGN KEY(profile_id, profile_revision)
        REFERENCES analysis_profiles(id, revision) ON DELETE RESTRICT
) STRICT;

CREATE INDEX analysis_runs_project_idx
    ON analysis_runs(project_id, created_at_ms DESC, id);
CREATE INDEX analysis_runs_document_idx
    ON analysis_runs(document_id, created_at_ms DESC, id);

CREATE TABLE analysis_run_items (
    run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    document_name TEXT NOT NULL,
    document_revision INTEGER NOT NULL CHECK (document_revision >= 0),
    summary_json TEXT NOT NULL,
    PRIMARY KEY(run_id, document_id)
) STRICT;

CREATE TABLE global_search_entries (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    project_name TEXT NOT NULL,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    document_name TEXT,
    segment_id TEXT REFERENCES segments(id) ON DELETE CASCADE,
    segment_ordinal INTEGER CHECK (segment_ordinal >= 0),
    field TEXT NOT NULL CHECK (field IN ('project', 'document', 'source', 'target', 'comment', 'note')),
    locale TEXT,
    workflow_state TEXT,
    content TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX global_search_entries_scope_idx
    ON global_search_entries(project_id, field, updated_at_ms DESC, id);
CREATE INDEX global_search_entries_segment_idx
    ON global_search_entries(segment_id, field, id);

CREATE VIRTUAL TABLE global_search_fts USING fts5(
    content,
    content='global_search_entries',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER global_search_entries_ai AFTER INSERT ON global_search_entries BEGIN
    INSERT INTO global_search_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER global_search_entries_ad AFTER DELETE ON global_search_entries BEGIN
    INSERT INTO global_search_fts(global_search_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER global_search_entries_au AFTER UPDATE ON global_search_entries BEGIN
    INSERT INTO global_search_fts(global_search_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
    INSERT INTO global_search_fts(rowid, content) VALUES (new.id, new.content);
END;

INSERT INTO analysis_profiles (
    id, revision, name, definition_json, built_in, created_at_ms, updated_at_ms
) VALUES (
    'builtin.analysis.standard', 1, 'Standard weighted effort',
    '{"noMatchBasisPoints":10000,"match5074BasisPoints":8000,"match7584BasisPoints":6000,"match8594BasisPoints":4000,"match9599BasisPoints":2000,"exactBasisPoints":0,"repetitionBasisPoints":1000}',
    1, 0, 0
);
"#;

const MIGRATION_11: &str = r#"
CREATE TABLE interop_previews (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('review', 'table')),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    library_id TEXT REFERENCES tm_libraries(id) ON DELETE CASCADE,
    expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
    input_sha256 TEXT NOT NULL,
    input_format TEXT NOT NULL,
    staged_input_path TEXT NOT NULL,
    source_locale TEXT,
    target_locale TEXT,
    manifest_hash TEXT,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'applied', 'discarded')),
    applied_result_json TEXT,
    created_at_ms INTEGER NOT NULL,
    applied_at_ms INTEGER,
    CHECK (
        (kind = 'review' AND document_id IS NOT NULL AND library_id IS NULL)
        OR (kind = 'table' AND document_id IS NULL AND library_id IS NOT NULL)
    )
) STRICT;

CREATE INDEX interop_previews_project_idx
    ON interop_previews(project_id, created_at_ms DESC, id);
CREATE INDEX interop_previews_document_idx
    ON interop_previews(document_id, created_at_ms DESC, id);
CREATE INDEX interop_previews_library_idx
    ON interop_previews(library_id, created_at_ms DESC, id);

CREATE TABLE interop_preview_rows (
    preview_id TEXT NOT NULL REFERENCES interop_previews(id) ON DELETE CASCADE,
    row_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    source_row INTEGER NOT NULL CHECK (source_row >= 0),
    segment_id TEXT REFERENCES segments(id) ON DELETE SET NULL,
    expected_segment_revision INTEGER CHECK (expected_segment_revision >= 0),
    source_hash TEXT NOT NULL,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    current_target TEXT NOT NULL DEFAULT '',
    comments TEXT NOT NULL DEFAULT '',
    current_comments TEXT NOT NULL DEFAULT '',
    status_context TEXT NOT NULL DEFAULT '',
    current_status TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    source_path_hash TEXT NOT NULL DEFAULT '',
    disposition TEXT NOT NULL CHECK (disposition IN (
        'changed', 'unchanged', 'missing', 'added', 'invalid',
        'valid', 'duplicate'
    )),
    diagnostics_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY(preview_id, row_id)
) STRICT;

CREATE INDEX interop_preview_rows_order_idx
    ON interop_preview_rows(preview_id, ordinal, row_id);
CREATE INDEX interop_preview_rows_segment_idx
    ON interop_preview_rows(segment_id, preview_id);
"#;

const MIGRATION_12: &str = r#"
CREATE TABLE alignment_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_document_id TEXT NOT NULL REFERENCES documents(id),
    target_document_id TEXT NOT NULL REFERENCES documents(id),
    source_document_revision INTEGER NOT NULL CHECK (source_document_revision >= 0),
    target_document_revision INTEGER NOT NULL CHECK (target_document_revision >= 0),
    source_locale TEXT NOT NULL CHECK (length(trim(source_locale)) > 0),
    target_locale TEXT NOT NULL CHECK (length(trim(target_locale)) > 0),
    algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'applied', 'discarded')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    terminal_result_json TEXT CHECK (
        terminal_result_json IS NULL OR json_valid(terminal_result_json)
    ),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    closed_at_ms INTEGER,
    CHECK (source_document_id <> target_document_id),
    CHECK (
        (status = 'open' AND closed_at_ms IS NULL AND terminal_result_json IS NULL)
        OR (status = 'applied' AND closed_at_ms IS NOT NULL
            AND terminal_result_json IS NOT NULL)
        OR (status = 'discarded' AND closed_at_ms IS NOT NULL)
    )
) STRICT;

CREATE INDEX alignment_sessions_project_idx
    ON alignment_sessions(project_id, status, updated_at_ms DESC, id);
CREATE INDEX alignment_sessions_source_document_idx
    ON alignment_sessions(source_document_id, updated_at_ms DESC, id);
CREATE INDEX alignment_sessions_target_document_idx
    ON alignment_sessions(target_document_id, updated_at_ms DESC, id);

CREATE TABLE alignment_session_segments (
    session_id TEXT NOT NULL REFERENCES alignment_sessions(id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK (side IN ('source', 'target')),
    segment_id TEXT NOT NULL CHECK (length(trim(segment_id)) > 0),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    segment_revision INTEGER NOT NULL CHECK (segment_revision >= 0),
    source_hash TEXT NOT NULL CHECK (length(trim(source_hash)) > 0),
    text_snapshot TEXT NOT NULL,
    number_signature_json TEXT NOT NULL DEFAULT '[]' CHECK (
        json_valid(number_signature_json)
        AND json_type(number_signature_json) = 'array'
    ),
    tag_signature_json TEXT NOT NULL DEFAULT '[]' CHECK (
        json_valid(tag_signature_json)
        AND json_type(tag_signature_json) = 'array'
    ),
    PRIMARY KEY(session_id, side, segment_id),
    UNIQUE(session_id, side, ordinal)
) STRICT;

CREATE INDEX alignment_session_segments_order_idx
    ON alignment_session_segments(session_id, side, ordinal, segment_id);

CREATE TABLE alignment_links (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES alignment_sessions(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    source_segment_ids_json TEXT NOT NULL CHECK (
        json_valid(source_segment_ids_json)
        AND json_type(source_segment_ids_json) = 'array'
    ),
    target_segment_ids_json TEXT NOT NULL CHECK (
        json_valid(target_segment_ids_json)
        AND json_type(target_segment_ids_json) = 'array'
    ),
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    confidence_basis_points INTEGER NOT NULL
        CHECK (confidence_basis_points BETWEEN 0 AND 10000),
    evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (
        json_valid(evidence_json) AND json_type(evidence_json) = 'array'
    ),
    origin TEXT NOT NULL CHECK (origin IN ('deterministic', 'manual', 'ai')),
    status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'confirmed', 'rejected')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(session_id, ordinal),
    CHECK (
        json_array_length(source_segment_ids_json)
        + json_array_length(target_segment_ids_json) > 0
    )
) STRICT;

CREATE INDEX alignment_links_session_status_idx
    ON alignment_links(session_id, status, ordinal, id);

CREATE TABLE reference_corpora (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    kind TEXT NOT NULL CHECK (
        kind IN ('monolingual_source', 'monolingual_target', 'bilingual')
    ),
    source_locale TEXT NOT NULL CHECK (length(trim(source_locale)) > 0),
    target_locale TEXT NOT NULL CHECK (length(trim(target_locale)) > 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('file', 'alignment')),
    managed_source_path TEXT,
    input_filter_id TEXT,
    input_format TEXT,
    input_sha256 TEXT,
    source_document_id TEXT REFERENCES documents(id),
    target_document_id TEXT REFERENCES documents(id),
    alignment_session_id TEXT REFERENCES alignment_sessions(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    entry_count INTEGER NOT NULL DEFAULT 0 CHECK (entry_count >= 0),
    diagnostic_count INTEGER NOT NULL DEFAULT 0 CHECK (diagnostic_count >= 0),
    diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (
        json_valid(diagnostics_json) AND json_type(diagnostics_json) = 'array'
    ),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    removed_at_ms INTEGER,
    CHECK (
        (status = 'active' AND removed_at_ms IS NULL)
        OR (status = 'removed' AND removed_at_ms IS NOT NULL)
    ),
    CHECK (
        (source_kind = 'file'
            AND managed_source_path IS NOT NULL
            AND length(trim(managed_source_path)) > 0
            AND input_filter_id IS NOT NULL
            AND length(trim(input_filter_id)) > 0
            AND input_format IS NOT NULL
            AND length(trim(input_format)) > 0
            AND input_sha256 IS NOT NULL
            AND length(trim(input_sha256)) > 0
            AND alignment_session_id IS NULL)
        OR (source_kind = 'alignment'
            AND managed_source_path IS NULL
            AND input_filter_id IS NULL
            AND input_format IS NULL
            AND input_sha256 IS NULL
            AND source_document_id IS NOT NULL
            AND target_document_id IS NOT NULL
            AND alignment_session_id IS NOT NULL)
    )
) STRICT;

CREATE UNIQUE INDEX reference_corpora_active_name_idx
    ON reference_corpora(project_id, name) WHERE status = 'active';
CREATE INDEX reference_corpora_project_idx
    ON reference_corpora(project_id, status, updated_at_ms DESC, id);
CREATE INDEX reference_corpora_session_idx
    ON reference_corpora(alignment_session_id, created_at_ms DESC, id);

CREATE TABLE reference_corpus_entries (
    id TEXT PRIMARY KEY,
    corpus_id TEXT NOT NULL REFERENCES reference_corpora(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    source_text TEXT NOT NULL DEFAULT '',
    target_text TEXT NOT NULL DEFAULT '',
    normalized_source TEXT NOT NULL DEFAULT '',
    normalized_target TEXT NOT NULL DEFAULT '',
    structural_path TEXT NOT NULL DEFAULT '',
    provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (
        json_valid(provenance_json) AND json_type(provenance_json) = 'object'
    ),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(corpus_id, ordinal),
    CHECK (length(trim(source_text)) > 0 OR length(trim(target_text)) > 0)
) STRICT;

CREATE INDEX reference_corpus_entries_source_idx
    ON reference_corpus_entries(corpus_id, normalized_source, ordinal, id);
CREATE INDEX reference_corpus_entries_target_idx
    ON reference_corpus_entries(corpus_id, normalized_target, ordinal, id);
"#;

const MIGRATION_13: &str = r#"
CREATE TABLE task_packages (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('assignment', 'return')),
    origin_project_id TEXT NOT NULL CHECK (length(trim(origin_project_id)) > 0),
    working_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    parent_package_id TEXT REFERENCES task_packages(id) ON DELETE RESTRICT,
    base_project_revision INTEGER NOT NULL CHECK (base_project_revision >= 0),
    manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
    manifest_hash TEXT NOT NULL CHECK (
        length(manifest_hash) = 64
        AND manifest_hash NOT GLOB '*[^0-9A-Fa-f]*'
    ),
    staged_path TEXT NOT NULL CHECK (length(trim(staged_path)) > 0),
    status TEXT NOT NULL DEFAULT 'staged'
        CHECK (status IN ('staged', 'imported', 'open', 'applied', 'discarded')),
    actor TEXT NOT NULL,
    reason TEXT NOT NULL,
    request_digest TEXT,
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    applied_at_ms INTEGER,
    CHECK (
        (kind = 'assignment' AND parent_package_id IS NULL)
        OR (kind = 'return' AND parent_package_id IS NOT NULL)
    )
) STRICT;

CREATE INDEX task_packages_origin_idx
    ON task_packages(origin_project_id, created_at_ms DESC, id);
CREATE INDEX task_packages_working_idx
    ON task_packages(working_project_id, created_at_ms DESC, id);
CREATE INDEX task_packages_parent_idx
    ON task_packages(parent_package_id, created_at_ms DESC, id);

CREATE TABLE task_package_bindings (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES task_packages(id) ON DELETE CASCADE,
    local_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    local_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    local_segment_id TEXT REFERENCES segments(id) ON DELETE SET NULL,
    origin_project_id TEXT NOT NULL CHECK (length(trim(origin_project_id)) > 0),
    origin_document_id TEXT NOT NULL CHECK (length(trim(origin_document_id)) > 0),
    origin_segment_id TEXT NOT NULL CHECK (length(trim(origin_segment_id)) > 0),
    base_document_revision INTEGER NOT NULL CHECK (base_document_revision >= 0),
    base_segment_revision INTEGER NOT NULL CHECK (base_segment_revision >= 0),
    base_source_hash TEXT NOT NULL CHECK (length(trim(base_source_hash)) > 0),
    base_projection_json TEXT NOT NULL CHECK (json_valid(base_projection_json)),
    source_entry TEXT NOT NULL CHECK (length(trim(source_entry)) > 0),
    tag_id_map_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(tag_id_map_json)),
    comment_id_map_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(comment_id_map_json)),
    created_at_ms INTEGER NOT NULL,
    UNIQUE(package_id, origin_segment_id),
    UNIQUE(local_segment_id)
) STRICT;

CREATE INDEX task_package_bindings_origin_idx
    ON task_package_bindings(origin_project_id, origin_document_id, origin_segment_id);
CREATE INDEX task_package_bindings_local_project_idx
    ON task_package_bindings(local_project_id, local_document_id, local_segment_id);

CREATE TABLE task_package_previews (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES task_packages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('assignment', 'return')),
    origin_project_id TEXT NOT NULL CHECK (length(trim(origin_project_id)) > 0),
    expected_project_revision INTEGER NOT NULL CHECK (expected_project_revision >= 0),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'applied', 'discarded')),
    counts_json TEXT NOT NULL CHECK (json_valid(counts_json)),
    diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (
        json_valid(diagnostics_json) AND json_type(diagnostics_json) = 'array'
    ),
    staged_path TEXT NOT NULL CHECK (length(trim(staged_path)) > 0),
    request_digest TEXT,
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    applied_at_ms INTEGER
) STRICT;

CREATE INDEX task_package_previews_package_idx
    ON task_package_previews(package_id, created_at_ms DESC, id);
CREATE INDEX task_package_previews_origin_idx
    ON task_package_previews(origin_project_id, status, updated_at_ms DESC, id);

CREATE TABLE task_package_preview_rows (
    preview_id TEXT NOT NULL REFERENCES task_package_previews(id) ON DELETE CASCADE,
    row_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    origin_document_id TEXT NOT NULL CHECK (length(trim(origin_document_id)) > 0),
    origin_segment_id TEXT NOT NULL CHECK (length(trim(origin_segment_id)) > 0),
    disposition TEXT NOT NULL CHECK (disposition IN (
        'unchanged', 'remoteChanged', 'localChanged', 'bothChanged',
        'deleted', 'added', 'tagInvalid', 'missingDependency'
    )),
    reason TEXT NOT NULL,
    safe_to_apply INTEGER NOT NULL CHECK (safe_to_apply IN (0, 1)),
    identical_change INTEGER NOT NULL CHECK (identical_change IN (0, 1)),
    selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
    base_hash TEXT,
    current_hash TEXT,
    remote_hash TEXT,
    current_revision INTEGER CHECK (current_revision IS NULL OR current_revision >= 0),
    remote_revision INTEGER CHECK (remote_revision IS NULL OR remote_revision >= 0),
    base_projection_json TEXT CHECK (
        base_projection_json IS NULL OR json_valid(base_projection_json)
    ),
    current_projection_json TEXT CHECK (
        current_projection_json IS NULL OR json_valid(current_projection_json)
    ),
    remote_projection_json TEXT CHECK (
        remote_projection_json IS NULL OR json_valid(remote_projection_json)
    ),
    diagnostic_code TEXT,
    PRIMARY KEY(preview_id, row_id),
    UNIQUE(preview_id, origin_segment_id)
) STRICT;

CREATE INDEX task_package_preview_rows_order_idx
    ON task_package_preview_rows(preview_id, ordinal, row_id);
CREATE INDEX task_package_preview_rows_disposition_idx
    ON task_package_preview_rows(preview_id, disposition, selected, ordinal, row_id);
"#;

const MIGRATION_14: &str = r#"
CREATE TABLE discussion_threads (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('project', 'document', 'segment')),
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    segment_id TEXT REFERENCES segments(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    resolved_at_ms INTEGER,
    resolved_by TEXT,
    CHECK (
        (scope = 'project' AND document_id IS NULL AND segment_id IS NULL)
        OR (scope = 'document' AND document_id IS NOT NULL AND segment_id IS NULL)
        OR (scope = 'segment' AND segment_id IS NOT NULL)
    ),
    CHECK (
        (status = 'open' AND resolved_at_ms IS NULL AND resolved_by IS NULL)
        OR (status = 'resolved' AND resolved_at_ms IS NOT NULL
            AND resolved_by IS NOT NULL AND length(trim(resolved_by)) > 0)
    )
) STRICT;

CREATE INDEX discussion_threads_project_idx
    ON discussion_threads(project_id, status, updated_at_ms DESC, id);
CREATE INDEX discussion_threads_document_idx
    ON discussion_threads(document_id, status, updated_at_ms DESC, id);
CREATE INDEX discussion_threads_segment_idx
    ON discussion_threads(segment_id, status, updated_at_ms DESC, id);

CREATE TABLE discussion_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
    mentions_json TEXT NOT NULL DEFAULT '[]' CHECK (
        json_valid(mentions_json) AND json_type(mentions_json) = 'array'
    ),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(thread_id, ordinal)
) STRICT;

CREATE INDEX discussion_messages_thread_idx
    ON discussion_messages(thread_id, ordinal, id);

CREATE TABLE project_snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    base_project_revision INTEGER NOT NULL CHECK (base_project_revision >= 0),
    state_hash TEXT NOT NULL CHECK (
        length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9A-Fa-f]*'
    ),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    document_count INTEGER NOT NULL CHECK (document_count >= 0),
    segment_count INTEGER NOT NULL CHECK (segment_count >= 0),
    thread_count INTEGER NOT NULL CHECK (thread_count >= 0),
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    created_at_ms INTEGER NOT NULL,
    UNIQUE(project_id, name)
) STRICT;

CREATE INDEX project_snapshots_project_idx
    ON project_snapshots(project_id, created_at_ms DESC, id);

CREATE TABLE project_snapshot_previews (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES project_snapshots(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    expected_project_revision INTEGER NOT NULL CHECK (expected_project_revision >= 0),
    current_state_hash TEXT NOT NULL CHECK (
        length(current_state_hash) = 64
        AND current_state_hash NOT GLOB '*[^0-9A-Fa-f]*'
    ),
    summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
    missing_dependencies_json TEXT NOT NULL DEFAULT '[]' CHECK (
        json_valid(missing_dependencies_json)
        AND json_type(missing_dependencies_json) = 'array'
    ),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'applied')),
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    applied_at_ms INTEGER
) STRICT;

CREATE INDEX project_snapshot_previews_snapshot_idx
    ON project_snapshot_previews(snapshot_id, created_at_ms DESC, id);
CREATE INDEX project_snapshot_previews_project_idx
    ON project_snapshot_previews(project_id, status, updated_at_ms DESC, id);
"#;

const MIGRATION_15: &str = r#"
ALTER TABLE tm_units ADD COLUMN quality_score_basis_points INTEGER
    CHECK (quality_score_basis_points IS NULL
        OR (quality_score_basis_points >= 0 AND quality_score_basis_points <= 10000));
ALTER TABLE tm_units ADD COLUMN curation_state TEXT NOT NULL DEFAULT 'active'
    CHECK (curation_state IN ('active', 'quarantined'));
ALTER TABLE tm_units ADD COLUMN curation_revision INTEGER NOT NULL DEFAULT 0
    CHECK (curation_revision >= 0);
ALTER TABLE tm_units ADD COLUMN last_curated_run_id TEXT;

CREATE INDEX tm_units_curation_idx
    ON tm_units(library_id, curation_state, quality_score_basis_points,
                created_at_ms, id);

CREATE TABLE curation_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    library_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'applied', 'rolled_back', 'discarded')),
    mode TEXT NOT NULL CHECK (mode IN ('offline', 'provider')),
    policy_json TEXT NOT NULL CHECK (
        json_valid(policy_json) AND json_type(policy_json) = 'object'
    ),
    base_library_revision INTEGER NOT NULL CHECK (base_library_revision >= 0),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    summary_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(summary_json) AND json_type(summary_json) = 'object'),
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    provider_profile_id TEXT,
    created_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX curation_runs_project_idx
    ON curation_runs(project_id, created_at_ms DESC, id);
CREATE INDEX curation_runs_library_idx
    ON curation_runs(library_id, status, updated_at_ms DESC, id);

CREATE TABLE curation_run_units (
    run_id TEXT NOT NULL REFERENCES curation_runs(id) ON DELETE CASCADE,
    library_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    quality_score_basis_points INTEGER NOT NULL
        CHECK (quality_score_basis_points >= 0 AND quality_score_basis_points <= 10000),
    recommended_action TEXT NOT NULL
        CHECK (recommended_action IN ('keep', 'review', 'quarantine')),
    explanation_json TEXT NOT NULL
        CHECK (json_valid(explanation_json) AND json_type(explanation_json) = 'array'),
    unit_snapshot_hash TEXT NOT NULL CHECK (
        length(unit_snapshot_hash) = 64
        AND unit_snapshot_hash NOT GLOB '*[^0-9A-Fa-f]*'
    ),
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY(run_id, unit_id)
) STRICT;

CREATE INDEX curation_run_units_page_idx
    ON curation_run_units(run_id, created_at_ms, unit_id);
CREATE INDEX curation_run_units_library_idx
    ON curation_run_units(library_id, unit_id, run_id);

CREATE TABLE curation_findings (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES curation_runs(id) ON DELETE CASCADE,
    library_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (
        'exact-duplicate', 'near-duplicate', 'competing-translation',
        'source-equals-target', 'minimum-length', 'length-ratio',
        'number-mismatch', 'date-mismatch', 'placeholder-mismatch',
        'created-outside-range', 'likely-wrong-language', 'semantic-mismatch',
        'term-drift', 'source-drift'
    )),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
    disposition TEXT NOT NULL CHECK (disposition IN ('keep', 'review', 'quarantine')),
    score_basis_points INTEGER NOT NULL
        CHECK (score_basis_points >= 0 AND score_basis_points <= 10000),
    canonical_unit_id TEXT,
    evidence_json TEXT NOT NULL
        CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'object'),
    explanation TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    fingerprint TEXT NOT NULL DEFAULT '',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(run_id, unit_id, kind, fingerprint)
) STRICT;

CREATE INDEX curation_findings_page_idx
    ON curation_findings(run_id, severity DESC, unit_id, id);
CREATE INDEX curation_findings_unit_idx
    ON curation_findings(unit_id, created_at_ms DESC, id);
CREATE INDEX curation_findings_library_idx
    ON curation_findings(library_id, run_id, unit_id, id);

CREATE TABLE curation_changes (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES curation_runs(id) ON DELETE CASCADE,
    finding_id TEXT REFERENCES curation_findings(id) ON DELETE SET NULL,
    library_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('score', 'quarantine')),
    before_json TEXT NOT NULL
        CHECK (json_valid(before_json) AND json_type(before_json) = 'object'),
    after_json TEXT NOT NULL
        CHECK (json_valid(after_json) AND json_type(after_json) = 'object'),
    restored INTEGER NOT NULL DEFAULT 0 CHECK (restored IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    restored_at_ms INTEGER,
    UNIQUE(run_id, unit_id)
) STRICT;

CREATE INDEX curation_changes_run_idx
    ON curation_changes(run_id, restored, created_at_ms, id);
CREATE INDEX curation_changes_unit_idx
    ON curation_changes(unit_id, created_at_ms DESC, id);
"#;

const MIGRATION_16: &str = r#"
CREATE TABLE plugin_installations (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    version TEXT NOT NULL CHECK (length(trim(version)) > 0),
    tier TEXT NOT NULL CHECK (tier IN ('process')),
    status TEXT NOT NULL CHECK (status IN ('installed', 'enabled', 'disabled', 'degraded')),
    package_path TEXT NOT NULL CHECK (length(trim(package_path)) > 0),
    entry_json TEXT NOT NULL CHECK (json_valid(entry_json) AND json_type(entry_json) = 'object'),
    manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json) AND json_type(manifest_json) = 'object'),
    contributions_json TEXT NOT NULL CHECK (
        json_valid(contributions_json) AND json_type(contributions_json) = 'object'
    ),
    requested_permissions_json TEXT NOT NULL CHECK (
        json_valid(requested_permissions_json) AND json_type(requested_permissions_json) = 'array'
    ),
    granted_permissions_json TEXT NOT NULL CHECK (
        json_valid(granted_permissions_json) AND json_type(granted_permissions_json) = 'array'
    ),
    last_error TEXT,
    crash_count INTEGER NOT NULL DEFAULT 0 CHECK (crash_count >= 0),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    installed_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX plugin_installations_status_idx
    ON plugin_installations(status, updated_at_ms DESC, id);
"#;

const MIGRATION_17: &str = r#"
CREATE TABLE collab_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(project_id, actor_id)
) STRICT;
CREATE INDEX collab_members_actor_idx ON collab_members(actor_id, project_id);

CREATE TABLE collab_segment_locks (
    segment_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
    expires_at_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX collab_segment_locks_project_idx
    ON collab_segment_locks(project_id, expires_at_ms, segment_id);

CREATE TABLE collab_presence (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
    document_id TEXT,
    segment_id TEXT,
    expires_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(project_id, actor_id)
) STRICT;
CREATE INDEX collab_presence_expiry_idx
    ON collab_presence(project_id, expires_at_ms);

CREATE TABLE collab_assignments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    assignee_actor_id TEXT NOT NULL CHECK (length(trim(assignee_actor_id)) > 0),
    ordinal_start INTEGER NOT NULL CHECK (ordinal_start >= 0),
    ordinal_end INTEGER NOT NULL CHECK (ordinal_end >= ordinal_start),
    due_at_ms INTEGER,
    status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'canceled')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_by TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX collab_assignments_project_idx
    ON collab_assignments(project_id, status, updated_at_ms DESC, id);

CREATE TABLE collab_op_log (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
    actor_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    UNIQUE(project_id, sequence)
) STRICT;
CREATE INDEX collab_op_log_project_idx
    ON collab_op_log(project_id, sequence);
"#;

const MIGRATIONS: [(u32, &str); 17] = [
    (1_u32, MIGRATION_1),
    (2_u32, MIGRATION_2),
    (3_u32, MIGRATION_3),
    (4_u32, MIGRATION_4),
    (5_u32, MIGRATION_5),
    (6_u32, MIGRATION_6),
    (7_u32, MIGRATION_7),
    (8_u32, MIGRATION_8),
    (9_u32, MIGRATION_9),
    (10_u32, MIGRATION_10),
    (11_u32, MIGRATION_11),
    (12_u32, MIGRATION_12),
    (13_u32, MIGRATION_13),
    (14_u32, MIGRATION_14),
    (15_u32, MIGRATION_15),
    (16_u32, MIGRATION_16),
    (17_u32, MIGRATION_17),
];

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

    migrate_from_to(connection, current, LATEST_SCHEMA_VERSION)
}

fn migrate_from_to(connection: &mut Connection, current: u32, target: u32) -> Result<()> {
    for (version, sql) in MIGRATIONS {
        if version <= current {
            continue;
        }
        if version > target {
            break;
        }

        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(sql)?;
        transaction.pragma_update(None, "user_version", version)?;
        transaction.commit()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;

    fn create_v8(connection: &mut Connection) {
        migrate_from_to(connection, 0, 8).expect("create schema v8");
    }

    fn create_v9(connection: &mut Connection) {
        migrate_from_to(connection, 0, 9).expect("create schema v9");
    }

    fn create_v10(connection: &mut Connection) {
        migrate_from_to(connection, 0, 10).expect("create schema v10");
    }

    fn create_v11(connection: &mut Connection) {
        migrate_from_to(connection, 0, 11).expect("create schema v11");
    }

    fn create_v12(connection: &mut Connection) {
        migrate_from_to(connection, 0, 12).expect("create schema v12");
    }

    fn create_v14(connection: &mut Connection) {
        migrate_from_to(connection, 0, 14).expect("create schema v14");
    }

    #[test]
    fn migration_9_upgrades_legacy_qa_rows_and_survives_reopen() {
        let temp = tempfile::tempdir().expect("temporary migration directory");
        let database = temp.path().join("translunar.sqlite3");
        let mut connection = Connection::open(&database).expect("open v8 database");
        create_v8(&mut connection);
        connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain, created_at_ms, updated_at_ms
                 ) VALUES ('p9', 'Migration 9', 'en-US', 'zh-CN', 'legal', 1, 1)",
                [],
            )
            .expect("insert v8 project");
        connection
            .execute(
                "INSERT INTO documents (
                    id, project_id, name, format, source_sha256, original_source_path,
                    managed_source_path, segment_count, imported_at_ms
                 ) VALUES ('d9', 'p9', 'legacy.txt', 'txt', 'hash', 'legacy.txt',
                           'sources/d9.txt', 1, 2)",
                [],
            )
            .expect("insert v8 document");
        connection
            .execute(
                "INSERT INTO segments (
                    id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
                 ) VALUES ('s9', 'd9', 0, 'txt:0', 'paragraph', '禁用词',
                           'draft', 1, 'source-hash', 'context-hash', 3)",
                [],
            )
            .expect("insert v8 segment");
        connection
            .execute(
                "INSERT INTO qa_issues (
                    id, segment_id, rule_id, severity, status, message,
                    fingerprint, evidence_json, created_at_ms, updated_at_ms
                 ) VALUES ('q9', 's9', 'term-forbidden:legacy', 'warning', 'open',
                           'legacy terminology', 'legacy-fingerprint', '{}', 4, 4)",
                [],
            )
            .expect("insert v8 QA issue");

        migrate_from_to(&mut connection, 8, 9).expect("upgrade to schema v9");
        drop(connection);

        let connection = Connection::open(database).expect("reopen upgraded database");
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read upgraded version");
        assert_eq!(version, 9);
        let category = connection
            .query_row(
                "SELECT category FROM qa_issues WHERE id = 'q9'",
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("read migrated QA category");
        assert_eq!(category, "terminology");
        let built_ins = connection
            .query_row(
                "SELECT COUNT(*) FROM qa_profiles WHERE built_in = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count built-in profiles");
        assert_eq!(built_ins, 2);
    }

    #[test]
    fn migration_9_rolls_back_every_prior_statement_on_failure() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        create_v8(&mut connection);
        connection
            .execute("CREATE TABLE qa_waivers (id TEXT PRIMARY KEY) STRICT", [])
            .expect("create conflicting late migration table");

        assert!(migrate(&mut connection).is_err());
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read rolled-back version");
        assert_eq!(version, 8);
        let profile_table_count = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name = 'qa_profiles'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("check rolled-back table");
        assert_eq!(profile_table_count, 0);
        let category_column_count = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('qa_issues') WHERE name = 'category'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("check rolled-back column");
        assert_eq!(category_column_count, 0);
    }

    #[test]
    fn migration_10_creates_lifecycle_search_and_analysis_schema_and_reopens() {
        let temp = tempfile::tempdir().expect("temporary migration directory");
        let database = temp.path().join("translunar.sqlite3");
        let mut connection = Connection::open(&database).expect("open v9 database");
        create_v9(&mut connection);

        migrate_from_to(&mut connection, 9, 10).expect("upgrade to schema v10");
        connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain,
                    created_at_ms, updated_at_ms
                 ) VALUES ('p10', 'Searchable project', 'en-US', 'zh-CN',
                           'general', 1, 1)",
                [],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO global_search_entries (
                    project_id, project_name, field, content, updated_at_ms
                 ) VALUES ('p10', 'Searchable project', 'project',
                           'multilingual 世界', 1)",
                [],
            )
            .expect("insert search projection");
        let hits = connection
            .query_row(
                "SELECT COUNT(*) FROM global_search_fts
                 WHERE global_search_fts MATCH 'multilingual'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("query FTS projection");
        assert_eq!(hits, 1);
        drop(connection);

        let connection = Connection::open(database).expect("reopen upgraded database");
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read upgraded version");
        assert_eq!(version, 10);
        let profiles = connection
            .query_row(
                "SELECT COUNT(*) FROM analysis_profiles WHERE built_in = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count built-in analysis profiles");
        assert_eq!(profiles, 1);
    }

    #[test]
    fn migration_10_rolls_back_every_prior_statement_on_failure() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        create_v9(&mut connection);
        connection
            .execute(
                "CREATE TABLE analysis_runs (id TEXT PRIMARY KEY) STRICT",
                [],
            )
            .expect("create conflicting late migration table");

        assert!(migrate(&mut connection).is_err());
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read rolled-back version");
        assert_eq!(version, 9);
        let template_table_count = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name = 'project_templates'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("check rolled-back table");
        assert_eq!(template_table_count, 0);
    }

    #[test]
    fn migration_11_creates_interop_preview_schema_on_fresh_database() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        migrate_from_to(&mut connection, 0, 11).expect("create schema v11");

        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read fresh schema version");
        assert_eq!(version, 11);
        let tables = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN ('interop_previews', 'interop_preview_rows')",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count fresh interop tables");
        assert_eq!(tables, 2);
    }

    #[test]
    fn migration_11_upgrades_preview_bindings_and_survives_reopen() {
        let temp = tempfile::tempdir().expect("temporary migration directory");
        let database = temp.path().join("translunar.sqlite3");
        let mut connection = Connection::open(&database).expect("open v10 database");
        create_v10(&mut connection);
        connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain, created_at_ms, updated_at_ms
                 ) VALUES ('p11', 'Interop', 'en', 'zh', 'general', 1, 1)",
                [],
            )
            .expect("insert migration project");
        connection
            .execute(
                "INSERT INTO documents (
                    id, project_id, name, format, source_sha256, original_source_path,
                    managed_source_path, segment_count, imported_at_ms
                 ) VALUES ('d11', 'p11', 'review.docx', 'docx', 'digest',
                           'review.docx', 'sources/d11.docx', 1, 2)",
                [],
            )
            .expect("insert migration document");
        connection
            .execute(
                "INSERT INTO segments (
                    id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
                 ) VALUES ('s11', 'd11', 0, 'p:0', 'Source', 'Target', 'draft',
                           0, 'source-hash', 'context-hash', 2)",
                [],
            )
            .expect("insert migration segment");

        migrate_from_to(&mut connection, 10, 11).expect("upgrade to schema v11");
        connection
            .execute(
                "INSERT INTO interop_previews (
                    id, kind, project_id, document_id, expected_revision, input_sha256,
                    input_format, staged_input_path, manifest_hash, created_at_ms
                 ) VALUES ('preview-11', 'review', 'p11', 'd11', 0,
                           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                           'review-docx', 'tmp/review.docx',
                           'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 3)",
                [],
            )
            .expect("insert migrated preview");
        connection
            .execute(
                "INSERT INTO interop_preview_rows (
                    preview_id, row_id, ordinal, source_row, segment_id,
                    expected_segment_revision, source_hash, source_text, target_text,
                    disposition
                 ) VALUES ('preview-11', 'row-11', 0, 1, 's11', 0,
                           'source-hash', 'Source', 'Edited target', 'changed')",
                [],
            )
            .expect("insert migrated preview row");
        drop(connection);

        let connection = Connection::open(database).expect("reopen upgraded database");
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read upgraded version");
        assert_eq!(version, 11);
        let binding = connection
            .query_row(
                "SELECT p.kind, r.segment_id
                 FROM interop_previews p
                 JOIN interop_preview_rows r ON r.preview_id = p.id
                 WHERE p.id = 'preview-11'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .expect("read reopened preview binding");
        assert_eq!(binding, ("review".to_string(), "s11".to_string()));
    }

    #[test]
    fn migration_11_rolls_back_every_prior_statement_on_failure() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        create_v10(&mut connection);
        connection
            .execute(
                "CREATE TABLE interop_preview_rows (id TEXT PRIMARY KEY) STRICT",
                [],
            )
            .expect("create conflicting late migration table");

        assert!(migrate_from_to(&mut connection, 10, 11).is_err());
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read rolled-back version");
        assert_eq!(version, 10);
        let preview_table_count = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name = 'interop_previews'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("check rolled-back preview table");
        assert_eq!(preview_table_count, 0);
    }

    #[test]
    fn migration_12_creates_alignment_and_corpus_schema_on_fresh_database() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        migrate_from_to(&mut connection, 0, 12).expect("create schema v12");

        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read fresh schema version");
        assert_eq!(version, 12);
        let tables = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                    'alignment_sessions', 'alignment_session_segments', 'alignment_links',
                    'reference_corpora', 'reference_corpus_entries'
                 )",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count fresh alignment and corpus tables");
        assert_eq!(tables, 5);
    }

    #[test]
    fn migration_12_upgrades_v11_data_and_survives_reopen() {
        let temp = tempfile::tempdir().expect("temporary migration directory");
        let database = temp.path().join("translunar.sqlite3");
        let mut connection = Connection::open(&database).expect("open v11 database");
        create_v11(&mut connection);
        connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain, created_at_ms, updated_at_ms
                 ) VALUES ('p12', 'Alignment', 'en', 'zh', 'general', 1, 1)",
                [],
            )
            .expect("insert migration project");
        for (document_id, name) in [("d12-source", "source.txt"), ("d12-target", "target.txt")] {
            connection
                .execute(
                    "INSERT INTO documents (
                        id, project_id, name, format, source_sha256, original_source_path,
                        managed_source_path, segment_count, imported_at_ms
                     ) VALUES (?1, 'p12', ?2, 'txt', 'digest', ?2, ?2, 1, 2)",
                    (document_id, name),
                )
                .expect("insert migration document");
        }
        for (segment_id, document_id, text) in [
            ("s12-source", "d12-source", "Source 12."),
            ("s12-target", "d12-target", "Target 12."),
        ] {
            connection
                .execute(
                    "INSERT INTO segments (
                        id, document_id, ordinal, structural_path, source_text, target_text,
                        state, revision, source_hash, context_hash, updated_at_ms
                     ) VALUES (?1, ?2, 0, 'txt:0', ?3, '', 'untranslated', 0,
                               'source-hash', 'context-hash', 2)",
                    (segment_id, document_id, text),
                )
                .expect("insert migration segment");
        }

        migrate_from_to(&mut connection, 11, 12).expect("upgrade to schema v12");
        connection
            .execute(
                "INSERT INTO alignment_sessions (
                    id, project_id, source_document_id, target_document_id,
                    source_document_revision, target_document_revision, source_locale,
                    target_locale, algorithm_version, created_at_ms, updated_at_ms
                 ) VALUES ('alignment-12', 'p12', 'd12-source', 'd12-target', 0, 0,
                           'en', 'zh', 'test-v1', 3, 3)",
                [],
            )
            .expect("insert migrated alignment session");
        for (side, segment_id, text) in [
            ("source", "s12-source", "Source 12."),
            ("target", "s12-target", "Target 12."),
        ] {
            connection
                .execute(
                    "INSERT INTO alignment_session_segments (
                        session_id, side, segment_id, ordinal, segment_revision, source_hash,
                        text_snapshot, number_signature_json, tag_signature_json
                     ) VALUES ('alignment-12', ?1, ?2, 0, 0, 'source-hash', ?3,
                               '[\"12\"]', '[]')",
                    (side, segment_id, text),
                )
                .expect("insert alignment segment snapshot");
        }
        connection
            .execute(
                "INSERT INTO alignment_links (
                    id, session_id, ordinal, source_segment_ids_json, target_segment_ids_json,
                    source_text, target_text, confidence_basis_points, evidence_json, origin,
                    status, created_at_ms, updated_at_ms
                 ) VALUES ('link-12', 'alignment-12', 0, '[\"s12-source\"]',
                           '[\"s12-target\"]', 'Source 12.', 'Target 12.', 9000, '[]',
                           'deterministic', 'confirmed', 4, 4)",
                [],
            )
            .expect("insert alignment link");
        connection
            .execute(
                "INSERT INTO reference_corpora (
                    id, project_id, name, kind, source_locale, target_locale, source_kind,
                    source_document_id, target_document_id, alignment_session_id,
                    entry_count, created_at_ms, updated_at_ms
                 ) VALUES ('corpus-12', 'p12', 'Approved alignment', 'bilingual', 'en', 'zh',
                           'alignment', 'd12-source', 'd12-target', 'alignment-12', 1, 5, 5)",
                [],
            )
            .expect("insert alignment corpus");
        connection
            .execute(
                "INSERT INTO reference_corpus_entries (
                    id, corpus_id, ordinal, source_text, target_text, normalized_source,
                    normalized_target, structural_path, provenance_json,
                    created_at_ms, updated_at_ms
                 ) VALUES ('entry-12', 'corpus-12', 0, 'Source 12.', 'Target 12.',
                           'source 12.', 'target 12.', 'alignment:0',
                           '{\"linkId\":\"link-12\"}', 5, 5)",
                [],
            )
            .expect("insert corpus entry");
        drop(connection);

        let connection = Connection::open(database).expect("reopen upgraded database");
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read upgraded version");
        assert_eq!(version, 12);
        let reopened = connection
            .query_row(
                "SELECT p.name, l.status, c.status, e.source_text
                 FROM projects p
                 JOIN alignment_sessions s ON s.project_id = p.id
                 JOIN alignment_links l ON l.session_id = s.id
                 JOIN reference_corpora c ON c.alignment_session_id = s.id
                 JOIN reference_corpus_entries e ON e.corpus_id = c.id
                 WHERE s.id = 'alignment-12'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .expect("read reopened alignment corpus");
        assert_eq!(
            reopened,
            (
                "Alignment".to_string(),
                "confirmed".to_string(),
                "active".to_string(),
                "Source 12.".to_string(),
            )
        );
    }

    #[test]
    fn migration_12_strict_constraints_reject_invalid_rows() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        migrate_from_to(&mut connection, 0, 12).expect("create schema v12");
        connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain, created_at_ms, updated_at_ms
                 ) VALUES ('strict-p12', 'Strict', 'en', 'zh', 'general', 1, 1)",
                [],
            )
            .expect("insert strict project");
        for document_id in ["strict-source", "strict-target"] {
            connection
                .execute(
                    "INSERT INTO documents (
                        id, project_id, name, format, source_sha256, original_source_path,
                        managed_source_path, segment_count, imported_at_ms
                     ) VALUES (?1, 'strict-p12', ?1, 'txt', 'digest', ?1, ?1, 0, 1)",
                    [document_id],
                )
                .expect("insert strict document");
        }
        connection
            .execute(
                "INSERT INTO alignment_sessions (
                    id, project_id, source_document_id, target_document_id,
                    source_document_revision, target_document_revision, source_locale,
                    target_locale, algorithm_version, created_at_ms, updated_at_ms
                 ) VALUES ('strict-session', 'strict-p12', 'strict-source', 'strict-target',
                           0, 0, 'en', 'zh', 'test-v1', 1, 1)",
                [],
            )
            .expect("insert strict session");

        assert!(
            connection
                .execute(
                    "INSERT INTO alignment_links (
                        id, session_id, ordinal, source_segment_ids_json,
                        target_segment_ids_json, source_text, target_text,
                        confidence_basis_points, evidence_json, origin, status,
                        created_at_ms, updated_at_ms
                     ) VALUES ('invalid-empty', 'strict-session', 0, '[]', '[]', '', '',
                               0, '[]', 'deterministic', 'proposed', 1, 1)",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "INSERT INTO alignment_links (
                        id, session_id, ordinal, source_segment_ids_json,
                        target_segment_ids_json, source_text, target_text,
                        confidence_basis_points, evidence_json, origin, status,
                        created_at_ms, updated_at_ms
                     ) VALUES ('invalid-confidence', 'strict-session', 0, '[\"s\"]', '[]',
                               'Source', '', 10001, '[]', 'manual', 'proposed', 1, 1)",
                    [],
                )
                .is_err()
        );
        connection
            .execute(
                "INSERT INTO reference_corpora (
                    id, project_id, name, kind, source_locale, target_locale, source_kind,
                    managed_source_path, input_filter_id, input_format, input_sha256,
                    created_at_ms, updated_at_ms
                 ) VALUES ('strict-corpus', 'strict-p12', 'Strict corpus',
                           'monolingual_source', 'en', 'zh', 'file', 'corpora/strict.txt',
                           'text', 'txt', 'digest', 1, 1)",
                [],
            )
            .expect("insert strict corpus");
        assert!(
            connection
                .execute(
                    "INSERT INTO reference_corpus_entries (
                        id, corpus_id, ordinal, source_text, target_text,
                        normalized_source, normalized_target, provenance_json,
                        created_at_ms, updated_at_ms
                     ) VALUES ('invalid-entry', 'strict-corpus', 0, '  ', '', '', '',
                               '{}', 1, 1)",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "UPDATE reference_corpora SET status = 'removed' WHERE id = 'strict-corpus'",
                    [],
                )
                .is_err()
        );
    }

    #[test]
    fn migration_12_rolls_back_every_prior_statement_on_failure() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        create_v11(&mut connection);
        connection
            .execute(
                "CREATE TABLE reference_corpus_entries (id TEXT PRIMARY KEY) STRICT",
                [],
            )
            .expect("create conflicting late migration table");

        assert!(migrate_from_to(&mut connection, 11, 12).is_err());
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read rolled-back version");
        assert_eq!(version, 11);
        let new_table_count = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                    'alignment_sessions', 'alignment_session_segments', 'alignment_links',
                    'reference_corpora'
                 )",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("check rolled-back migration tables");
        assert_eq!(new_table_count, 0);
    }

    #[test]
    fn migration_13_creates_task_package_schema_on_fresh_database() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        migrate(&mut connection).expect("create latest schema");

        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read fresh schema version");
        assert_eq!(version, LATEST_SCHEMA_VERSION);
        let tables = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                    'task_packages', 'task_package_bindings',
                    'task_package_previews', 'task_package_preview_rows'
                 )",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count fresh task-package tables");
        assert_eq!(tables, 4);
    }

    #[test]
    fn migration_13_upgrades_v12_bindings_and_survives_reopen() {
        let temp = tempfile::tempdir().expect("temporary migration directory");
        let database = temp.path().join("translunar.sqlite3");
        let mut connection = Connection::open(&database).expect("open v12 database");
        create_v12(&mut connection);
        connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain, created_at_ms, updated_at_ms
                 ) VALUES ('task-p13', 'Task project', 'en', 'zh', 'general', 1, 1)",
                [],
            )
            .expect("insert task project");
        connection
            .execute(
                "INSERT INTO documents (
                    id, project_id, name, format, source_sha256, original_source_path,
                    managed_source_path, segment_count, imported_at_ms
                 ) VALUES ('task-d13', 'task-p13', 'task.txt', 'txt', 'source-digest',
                           'task.txt', 'sources/task-d13.txt', 1, 2)",
                [],
            )
            .expect("insert task document");
        connection
            .execute(
                "INSERT INTO segments (
                    id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
                 ) VALUES ('task-s13', 'task-d13', 0, 'txt:0', 'Source', 'Target',
                           'draft', 0, 'source-hash', 'context-hash', 2)",
                [],
            )
            .expect("insert task segment");

        migrate(&mut connection).expect("upgrade to latest schema");
        connection
            .execute(
                "INSERT INTO task_packages (
                    id, kind, origin_project_id, working_project_id,
                    base_project_revision, manifest_json, manifest_hash, staged_path,
                    status, actor, reason, created_at_ms, updated_at_ms
                 ) VALUES ('pkg-13', 'assignment', 'origin-p13', 'task-p13', 4, '{}',
                           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                           'tmp/pkg-13.tltask', 'imported', 'tester', 'handoff', 3, 3)",
                [],
            )
            .expect("insert migrated task package");
        connection
            .execute(
                "INSERT INTO task_package_bindings (
                    id, package_id, local_project_id, local_document_id, local_segment_id,
                    origin_project_id, origin_document_id, origin_segment_id,
                    base_document_revision, base_segment_revision, base_source_hash,
                    base_projection_json, source_entry, created_at_ms
                 ) VALUES ('binding-13', 'pkg-13', 'task-p13', 'task-d13', 'task-s13',
                           'origin-p13', 'origin-d13', 'origin-s13', 2, 7, 'source-hash',
                           '{}', 'documents/origin-d13/source.txt', 3)",
                [],
            )
            .expect("insert migrated task binding");
        connection
            .execute(
                "INSERT INTO task_package_previews (
                    id, package_id, kind, origin_project_id, expected_project_revision,
                    counts_json, staged_path, created_at_ms, updated_at_ms
                 ) VALUES ('preview-13', 'pkg-13', 'assignment', 'origin-p13', 4,
                           '{\"unchanged\":1}', 'tmp/pkg-13.tltask', 3, 3)",
                [],
            )
            .expect("insert migrated task preview");
        connection
            .execute(
                "INSERT INTO task_package_preview_rows (
                    preview_id, row_id, ordinal, origin_document_id, origin_segment_id,
                    disposition, reason, safe_to_apply, identical_change, selected,
                    base_hash, current_hash, remote_hash, current_revision, remote_revision,
                    base_projection_json, current_projection_json, remote_projection_json
                 ) VALUES ('preview-13', 'row-13', 0, 'origin-d13', 'origin-s13',
                           'unchanged', 'same', 0, 0, 0, 'base', 'base', 'base', 7, 7,
                           '{}', '{}', '{}')",
                [],
            )
            .expect("insert migrated task preview row");
        drop(connection);

        let connection = Connection::open(database).expect("reopen upgraded database");
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read upgraded version");
        assert_eq!(version, LATEST_SCHEMA_VERSION);
        let binding = connection
            .query_row(
                "SELECT p.status, b.origin_segment_id, r.disposition
                 FROM task_packages p
                 JOIN task_package_bindings b ON b.package_id = p.id
                 JOIN task_package_preview_rows r ON r.origin_segment_id = b.origin_segment_id
                 WHERE p.id = 'pkg-13'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .expect("read reopened task binding");
        assert_eq!(
            binding,
            (
                "imported".to_string(),
                "origin-s13".to_string(),
                "unchanged".to_string(),
            )
        );
    }

    #[test]
    fn migration_13_strict_constraints_reject_invalid_rows() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        migrate(&mut connection).expect("create latest schema");
        assert!(
            connection
                .execute(
                    "INSERT INTO task_packages (
                        id, kind, origin_project_id, base_project_revision, manifest_json,
                        manifest_hash, staged_path, actor, reason, created_at_ms, updated_at_ms
                     ) VALUES ('invalid-kind', 'other', 'origin', 0, '{}',
                               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                               'tmp/x.tltask', '', '', 1, 1)",
                    [],
                )
                .is_err()
        );
        connection
            .execute(
                "INSERT INTO task_packages (
                    id, kind, origin_project_id, base_project_revision, manifest_json,
                    manifest_hash, staged_path, actor, reason, created_at_ms, updated_at_ms
                 ) VALUES ('valid-13', 'assignment', 'origin', 0, '{}',
                           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                           'tmp/x.tltask', '', '', 1, 1)",
                [],
            )
            .expect("insert valid task package");
        assert!(
            connection
                .execute(
                    "INSERT INTO task_package_previews (
                        id, package_id, kind, origin_project_id, expected_project_revision,
                        counts_json, staged_path, created_at_ms, updated_at_ms
                     ) VALUES ('invalid-json', 'valid-13', 'assignment', 'origin', 0,
                               'not-json', 'tmp/x.tltask', 1, 1)",
                    [],
                )
                .is_err()
        );
        connection
            .execute(
                "INSERT INTO task_package_previews (
                    id, package_id, kind, origin_project_id, expected_project_revision,
                    counts_json, staged_path, created_at_ms, updated_at_ms
                 ) VALUES ('valid-preview', 'valid-13', 'assignment', 'origin', 0,
                           '{}', 'tmp/x.tltask', 1, 1)",
                [],
            )
            .expect("insert valid task preview");
        assert!(
            connection
                .execute(
                    "INSERT INTO task_package_preview_rows (
                        preview_id, row_id, ordinal, origin_document_id, origin_segment_id,
                        disposition, reason, safe_to_apply, identical_change, selected
                     ) VALUES ('valid-preview', 'invalid-row', 0, 'doc', 'segment',
                               'conflicted', '', 0, 0, 0)",
                    [],
                )
                .is_err()
        );
    }

    #[test]
    fn migration_13_rolls_back_every_prior_statement_on_failure() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        create_v12(&mut connection);
        connection
            .execute(
                "CREATE TABLE task_package_preview_rows (id TEXT PRIMARY KEY) STRICT",
                [],
            )
            .expect("create conflicting late migration table");

        assert!(migrate(&mut connection).is_err());
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read rolled-back version");
        assert_eq!(version, 12);
        let new_table_count = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                    'task_packages', 'task_package_bindings', 'task_package_previews'
                 )",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("check rolled-back task-package tables");
        assert_eq!(new_table_count, 0);
    }

    #[test]
    fn migration_15_creates_curation_schema_on_fresh_database() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        migrate(&mut connection).expect("create latest schema");

        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read fresh schema version");
        assert_eq!(version, LATEST_SCHEMA_VERSION);
        let tables = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                    'curation_runs', 'curation_run_units',
                    'curation_findings', 'curation_changes'
                 )",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count fresh curation tables");
        assert_eq!(tables, 4);
        let columns = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tm_units')
                 WHERE name IN (
                    'quality_score_basis_points', 'curation_state',
                    'curation_revision', 'last_curated_run_id'
                 )",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count fresh TM curation columns");
        assert_eq!(columns, 4);
    }

    #[test]
    fn migration_15_upgrades_v14_assets_and_survives_reopen() {
        let temp = tempfile::tempdir().expect("temporary migration directory");
        let database = temp.path().join("translunar.sqlite3");
        let mut connection = Connection::open(&database).expect("open v14 database");
        create_v14(&mut connection);
        connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain,
                    created_at_ms, updated_at_ms
                 ) VALUES ('curation-p15', 'Curation', 'en', 'zh', 'general', 1, 1)",
                [],
            )
            .expect("insert curation project");
        connection
            .execute(
                "INSERT INTO tm_libraries (
                    id, name, source_locale, target_locale, writable,
                    revision, created_at_ms, updated_at_ms
                 ) VALUES ('curation-l15', 'Shared TM', 'en', 'zh', 1, 3, 1, 1)",
                [],
            )
            .expect("insert curation library");
        connection
            .execute(
                "INSERT INTO tm_units (
                    id, library_id, source_locale, target_locale, source_text,
                    target_text, source_hash, source_key, target_hash,
                    metadata_json, created_at_ms, updated_at_ms
                 ) VALUES ('curation-u15', 'curation-l15', 'en', 'zh',
                           'Source', 'Target', 'source-hash', 'source',
                           'target-hash', '{}', 2, 2)",
                [],
            )
            .expect("insert legacy TM unit");

        migrate_from_to(&mut connection, 14, 15).expect("upgrade to schema v15");
        let projection = connection
            .query_row(
                "SELECT quality_score_basis_points, curation_state,
                        curation_revision, last_curated_run_id
                 FROM tm_units WHERE id = 'curation-u15'",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<i64>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .expect("read migrated TM curation projection");
        assert_eq!(projection, (None, "active".to_string(), 0, None));
        connection
            .execute(
                "INSERT INTO curation_runs (
                    id, project_id, library_id, status, mode, policy_json,
                    base_library_revision, revision, summary_json, actor, reason,
                    created_at_ms, completed_at_ms, updated_at_ms
                 ) VALUES ('curation-r15', 'curation-p15', 'curation-l15', 'open',
                           'offline', '{}', 3, 0, '{\"analyzedUnits\":1}',
                           'tester', 'fixture', 3, 3, 3)",
                [],
            )
            .expect("insert migrated curation run");
        connection
            .execute(
                "INSERT INTO curation_run_units (
                    run_id, library_id, unit_id, quality_score_basis_points,
                    recommended_action, explanation_json, unit_snapshot_hash,
                    created_at_ms
                 ) VALUES ('curation-r15', 'curation-l15', 'curation-u15', 8000,
                           'review', '[\"fixture\"]',
                           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 3)",
                [],
            )
            .expect("insert migrated curation run unit");
        connection
            .execute(
                "INSERT INTO curation_findings (
                    id, run_id, library_id, unit_id, kind, severity, disposition,
                    score_basis_points, evidence_json, explanation, fingerprint,
                    created_at_ms, updated_at_ms
                 ) VALUES ('curation-f15', 'curation-r15', 'curation-l15',
                           'curation-u15', 'length-ratio', 'warning', 'review', 8000,
                           '{}', 'fixture', 'fixture-fingerprint', 3, 3)",
                [],
            )
            .expect("insert migrated curation finding");
        connection
            .execute(
                "INSERT INTO curation_changes (
                    id, run_id, finding_id, library_id, unit_id, action,
                    before_json, after_json, created_at_ms
                 ) VALUES ('curation-c15', 'curation-r15', 'curation-f15',
                           'curation-l15', 'curation-u15', 'score', '{}', '{}', 3)",
                [],
            )
            .expect("insert migrated curation change");
        drop(connection);

        let connection = Connection::open(database).expect("reopen upgraded database");
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read upgraded version");
        assert_eq!(version, 15);
        let reopened = connection
            .query_row(
                "SELECT r.status, u.recommended_action, f.kind, c.action
                 FROM curation_runs r
                 JOIN curation_run_units u ON u.run_id = r.id
                 JOIN curation_findings f ON f.run_id = r.id
                 JOIN curation_changes c ON c.run_id = r.id
                 WHERE r.id = 'curation-r15'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .expect("read reopened curation state");
        assert_eq!(
            reopened,
            (
                "open".to_string(),
                "review".to_string(),
                "length-ratio".to_string(),
                "score".to_string(),
            )
        );
    }

    #[test]
    fn migration_15_strict_constraints_reject_invalid_rows() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        migrate(&mut connection).expect("create latest schema");
        connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain,
                    created_at_ms, updated_at_ms
                 ) VALUES ('strict-p15', 'Strict', 'en', 'zh', 'general', 1, 1)",
                [],
            )
            .expect("insert strict curation project");
        connection
            .execute(
                "INSERT INTO tm_libraries (
                    id, name, source_locale, target_locale, writable,
                    revision, created_at_ms, updated_at_ms
                 ) VALUES ('strict-l15', 'Strict TM', 'en', 'zh', 1, 0, 1, 1)",
                [],
            )
            .expect("insert strict curation library");
        connection
            .execute(
                "INSERT INTO tm_units (
                    id, library_id, source_locale, target_locale, source_text,
                    target_text, source_hash, source_key, target_hash,
                    metadata_json, created_at_ms, updated_at_ms
                 ) VALUES ('strict-u15', 'strict-l15', 'en', 'zh', 'Source',
                           'Target', 'source-hash', 'source', 'target-hash', '{}', 1, 1)",
                [],
            )
            .expect("insert strict curation unit");

        assert!(
            connection
                .execute(
                    "UPDATE tm_units SET quality_score_basis_points = 10001
                     WHERE id = 'strict-u15'",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "UPDATE tm_units SET curation_state = 'deleted'
                     WHERE id = 'strict-u15'",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "INSERT INTO curation_runs (
                        id, project_id, library_id, mode, policy_json,
                        base_library_revision, summary_json, actor, reason,
                        created_at_ms, updated_at_ms
                     ) VALUES ('invalid-json-r15', 'strict-p15', 'strict-l15',
                               'offline', 'not-json', 0, '{}', 'tester', 'fixture', 1, 1)",
                    [],
                )
                .is_err()
        );
        connection
            .execute(
                "INSERT INTO curation_runs (
                    id, project_id, library_id, mode, policy_json,
                    base_library_revision, summary_json, actor, reason,
                    created_at_ms, completed_at_ms, updated_at_ms
                 ) VALUES ('strict-r15', 'strict-p15', 'strict-l15', 'offline',
                           '{}', 0, '{}', 'tester', 'fixture', 1, 1, 1)",
                [],
            )
            .expect("insert valid strict curation run");
        assert!(
            connection
                .execute(
                    "INSERT INTO curation_run_units (
                        run_id, library_id, unit_id, quality_score_basis_points,
                        recommended_action, explanation_json, unit_snapshot_hash,
                        created_at_ms
                     ) VALUES ('strict-r15', 'strict-l15', 'strict-u15', -1,
                               'delete', '{}', 'short', 1)",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "INSERT INTO curation_findings (
                        id, run_id, library_id, unit_id, kind, severity, disposition,
                        score_basis_points, evidence_json, explanation,
                        created_at_ms, updated_at_ms
                     ) VALUES ('invalid-f15', 'strict-r15', 'strict-l15',
                               'strict-u15', 'delete', 'critical', 'delete', 10001,
                               '[]', 'invalid', 1, 1)",
                    [],
                )
                .is_err()
        );
    }

    #[test]
    fn migration_15_rolls_back_every_prior_statement_on_failure() {
        let mut connection = Connection::open_in_memory().expect("open migration database");
        create_v14(&mut connection);
        connection
            .execute(
                "CREATE TABLE curation_changes (id TEXT PRIMARY KEY) STRICT",
                [],
            )
            .expect("create conflicting late migration table");

        assert!(migrate_from_to(&mut connection, 14, 15).is_err());
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read rolled-back version");
        assert_eq!(version, 14);
        let curation_column_count = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tm_units')
                 WHERE name IN (
                    'quality_score_basis_points', 'curation_state',
                    'curation_revision', 'last_curated_run_id'
                 )",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("check rolled-back TM columns");
        assert_eq!(curation_column_count, 0);
        let new_table_count = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                    'curation_runs', 'curation_run_units', 'curation_findings'
                 )",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("check rolled-back curation tables");
        assert_eq!(new_table_count, 0);
    }
}
