use std::collections::BTreeMap;
use std::fs;
use std::fs::File;
use std::io::Read;
use std::num::TryFromIntError;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::types::Type;
use rusqlite::{Connection, OptionalExtension, Row, Transaction, TransactionBehavior, params};
use serde::de::DeserializeOwned;
use serde_json::Value;
use sha2::{Digest, Sha256};
use translunar_asset_core::{
    AssetMountMode, ConcordanceHit, ConcordanceSide, MatchScore, TermEntry, TermMatch, TermStatus,
    TermTranslation, Termbase, TermbaseMount, TmLibrary, TmLibraryMount, TmMatch, TmMatchKind,
    TmUnit, exact_key, match_score, normalize_match_key, term_spans,
};
use translunar_domain::{
    BackupFile, BackupManifest, DataHealthReport, DegradationFinding, Document, DocumentNote,
    DocumentStatus, HealthFinding, HealthSeverity, NumberEvidence, Operation, Project,
    ProjectConfiguration, ProjectLifecycle, QaIssue, QaIssueStatus, QaSeverity, Segment,
    SegmentCounts, SegmentState, TagKind, TagSide, TmEntry, TranslationMemory, new_id,
    normalize_text, number_issue_fingerprint, number_mismatch, segment_hashes, state_for_target,
};
use translunar_filter_core::ImportedUnit;
use translunar_pipeline::{
    PipelineDefinition, PipelineFailure, PipelineRun, PipelineRunStatus, PipelineStepDefinition,
    PipelineStepRun, PipelineStepStatus, ensure_run_transition,
};

use crate::migrations::{LATEST_SCHEMA_VERSION, configure_connection, migrate};
use crate::{Result, StorageError};

const NUMBER_RULE_ID: &str = "number-mismatch";
const NUMBER_RULE_MESSAGE: &str = "Source and target numbers do not match.";
const LEGACY_DESKTOP_ACTOR: &str = "desktop";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataPaths {
    pub root: PathBuf,
    pub database: PathBuf,
    pub sources: PathBuf,
    pub exports: PathBuf,
    pub temporary: PathBuf,
    pub backups: PathBuf,
}

impl DataPaths {
    fn prepare(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let sources = root.join("sources");
        let exports = root.join("exports");
        let temporary = root.join("tmp");
        let backups = root.join("backups");
        fs::create_dir_all(&sources)?;
        fs::create_dir_all(&exports)?;
        fs::create_dir_all(&temporary)?;
        fs::create_dir_all(&backups)?;
        Ok(Self {
            database: root.join("translunar.sqlite3"),
            root,
            sources,
            exports,
            temporary,
            backups,
        })
    }

    pub fn managed_docx(&self, document_id: &str) -> PathBuf {
        self.managed_source(document_id, "docx")
    }

    pub fn managed_source(&self, document_id: &str, extension: &str) -> PathBuf {
        let extension = extension
            .trim()
            .trim_start_matches('.')
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .collect::<String>();
        let extension = if extension.is_empty() {
            "source"
        } else {
            &extension
        };
        self.sources.join(format!("{document_id}.{extension}"))
    }
}

#[derive(Debug, Clone)]
pub struct NewDocument {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub relative_path: String,
    pub format: String,
    pub filter_id: String,
    pub source_sha256: String,
    pub degradation: Vec<DegradationFinding>,
    pub original_source_path: PathBuf,
    pub managed_source_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedDocument {
    pub document: Document,
    pub original_source_path: PathBuf,
    pub managed_source_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectAggregate {
    pub project: Project,
    pub documents: Vec<Document>,
    pub counts: SegmentCounts,
}

#[derive(Debug, Clone)]
pub struct ProjectUpdate {
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub domain: String,
    pub configuration: ProjectConfiguration,
    pub expected_revision: u64,
    pub actor: String,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewPipelineDefinition {
    pub project_id: Option<String>,
    pub name: String,
    pub steps: Vec<PipelineStepDefinition>,
}

#[derive(Debug, Clone)]
pub struct NewTmLibrary {
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub domain: Option<String>,
    pub writable: bool,
    pub owner_project_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TmSearchRequest {
    pub project_id: String,
    pub source_locale: String,
    pub target_locale: String,
    pub query: String,
    pub threshold: u8,
    pub offset: u32,
    pub limit: u32,
    pub library_ids: Vec<String>,
    pub domain: Option<String>,
    pub since_ms: Option<i64>,
    pub origin_project_id: Option<String>,
    pub origin_document_id: Option<String>,
    pub context_before_hash: Option<String>,
    pub context_after_hash: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ConcordanceRequest {
    pub project_id: String,
    pub query: String,
    pub side: ConcordanceSide,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone)]
pub struct NewTermbase {
    pub name: String,
    pub source_locale: String,
    pub domain: Option<String>,
    pub writable: bool,
}

#[derive(Debug, Clone)]
pub struct NewTermEntry {
    pub termbase_id: String,
    pub source_locale: String,
    pub source_term: String,
    pub part_of_speech: Option<String>,
    pub definition: Option<String>,
    pub example: Option<String>,
    pub domain: Option<String>,
    pub status: TermStatus,
    pub translations: Vec<NewTermTranslation>,
}

#[derive(Debug, Clone)]
pub struct NewTermTranslation {
    pub locale: String,
    pub term: String,
    pub preferred: bool,
    pub forbidden: bool,
}

#[derive(Debug, Clone)]
pub struct TermSearchRequest {
    pub project_id: String,
    pub text: String,
    pub offset: u32,
    pub limit: u32,
    pub termbase_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PipelineRunSnapshot {
    pub run: PipelineRun,
    pub steps: Vec<PipelineStepRun>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Confirmation {
    pub segment: Segment,
    pub counts: SegmentCounts,
    pub tm_entry: TmEntry,
    pub qa_issues: Vec<QaIssue>,
}

pub struct Store {
    connection: Connection,
    paths: DataPaths,
}

impl Store {
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Self> {
        Self::open_internal(data_dir, true)
    }

    pub fn open_worker(data_dir: impl AsRef<Path>) -> Result<Self> {
        Self::open_internal(data_dir, false)
    }

    fn open_internal(data_dir: impl AsRef<Path>, recover_orphaned_runs: bool) -> Result<Self> {
        let paths = DataPaths::prepare(data_dir)?;
        let database_existed = paths.database.is_file();
        let mut connection = Connection::open(&paths.database)?;
        configure_connection(&connection)?;
        let current_version =
            connection.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))?;
        if database_existed && current_version > 0 && current_version < LATEST_SCHEMA_VERSION {
            create_pre_migration_backup(&connection, &paths, current_version)?;
        }
        migrate(&mut connection)?;
        normalize_managed_source_paths(&mut connection, &paths)?;
        backfill_asset_keys(&mut connection)?;
        if recover_orphaned_runs {
            interrupt_orphaned_pipeline_runs(&mut connection)?;
        }
        ensure_default_termbases(&mut connection)?;
        Ok(Self { connection, paths })
    }

    pub fn paths(&self) -> &DataPaths {
        &self.paths
    }

    pub fn create_project(
        &mut self,
        name: &str,
        source_locale: &str,
        target_locale: &str,
        domain: &str,
    ) -> Result<Project> {
        require_nonempty("project name", name)?;
        require_nonempty("source locale", source_locale)?;
        require_nonempty("target locale", target_locale)?;

        let now = now_ms();
        let project = Project {
            id: new_id(),
            name: name.trim().to_string(),
            source_locale: source_locale.trim().to_string(),
            target_locale: target_locale.trim().to_string(),
            domain: domain.trim().to_string(),
            lifecycle: ProjectLifecycle::Active,
            revision: 0,
            configuration: ProjectConfiguration::default(),
            created_at_ms: now,
            updated_at_ms: now,
            archived_at_ms: None,
        };
        let memory = TranslationMemory {
            id: new_id(),
            project_id: project.id.clone(),
            name: format!("{} TM", project.name),
            source_locale: project.source_locale.clone(),
            target_locale: project.target_locale.clone(),
            writable: true,
        };

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO projects (
                id, name, source_locale, target_locale, domain, lifecycle, revision,
                configuration_json, created_at_ms, updated_at_ms, archived_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', 0, ?6, ?7, ?8, NULL)",
            params![
                project.id,
                project.name,
                project.source_locale,
                project.target_locale,
                project.domain,
                serde_json::to_string(&project.configuration)?,
                project.created_at_ms,
                project.updated_at_ms,
            ],
        )?;
        transaction.execute(
            "INSERT INTO translation_memories (
                id, project_id, name, source_locale, target_locale, writable
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                memory.id,
                memory.project_id,
                memory.name,
                memory.source_locale,
                memory.target_locale,
                memory.writable,
            ],
        )?;
        transaction.execute(
            "INSERT INTO tm_libraries (
                id, name, source_locale, target_locale, domain, owner_project_id,
                writable, revision, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, ?7, ?7)",
            params![
                memory.id,
                memory.name,
                memory.source_locale,
                memory.target_locale,
                project.domain,
                project.id,
                project.created_at_ms,
            ],
        )?;
        transaction.execute(
            "INSERT INTO tm_library_mounts (
                project_id, library_id, mode, priority, enabled, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'write', 0, 1, 0, ?3, ?3)",
            params![project.id, memory.id, project.created_at_ms],
        )?;
        let termbase_id = new_id();
        transaction.execute(
            "INSERT INTO termbases (
                id, name, source_locale, domain, writable, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, 1, 0, ?5, ?5)",
            params![
                termbase_id,
                format!("{} Termbase", project.name),
                project.source_locale,
                project.domain,
                project.created_at_ms,
            ],
        )?;
        transaction.execute(
            "INSERT INTO termbase_mounts (
                project_id, termbase_id, priority, writable, enabled, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 0, 1, 1, 0, ?3, ?3)",
            params![project.id, termbase_id, project.created_at_ms],
        )?;
        transaction.commit()?;
        Ok(project)
    }

    pub fn get_project(&self, project_id: &str) -> Result<ProjectAggregate> {
        let project = self
            .connection
            .query_row(
                "SELECT id, name, source_locale, target_locale, domain, lifecycle, revision,
                        configuration_json, created_at_ms, updated_at_ms, archived_at_ms
                 FROM projects WHERE id = ?1",
                [project_id],
                row_to_project,
            )
            .optional()?
            .ok_or_else(|| not_found("project", project_id))?;

        let mut statement = self.connection.prepare(
            "SELECT id, project_id, name, relative_path, format, filter_id, source_sha256,
                    current_version, status, revision, segment_count, degradation_json,
                    imported_at_ms, updated_at_ms
             FROM documents WHERE project_id = ?1 ORDER BY imported_at_ms, id",
        )?;
        let documents = statement
            .query_map([project_id], row_to_document)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let counts = counts_for_project(&self.connection, project_id)?;
        Ok(ProjectAggregate {
            project,
            documents,
            counts,
        })
    }

    pub fn list_projects(
        &self,
        lifecycle: Option<ProjectLifecycle>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<Project>, u32)> {
        let lifecycle = lifecycle.map(project_lifecycle_text);
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM projects WHERE (?1 IS NULL OR lifecycle = ?1)",
            [lifecycle],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, name, source_locale, target_locale, domain, lifecycle, revision,
                    configuration_json, created_at_ms, updated_at_ms, archived_at_ms
             FROM projects
             WHERE (?1 IS NULL OR lifecycle = ?1)
             ORDER BY updated_at_ms DESC, id
             LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![lifecycle, i64::from(limit), i64::from(offset)],
                row_to_project,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn update_project(&mut self, project_id: &str, input: ProjectUpdate) -> Result<Project> {
        require_nonempty("project name", &input.name)?;
        require_nonempty("source locale", &input.source_locale)?;
        require_nonempty("target locale", &input.target_locale)?;
        require_nonempty("operation actor", &input.actor)?;

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_project(&transaction, project_id)?;
        ensure_entity_revision(
            "project",
            project_id,
            current.revision,
            input.expected_revision,
        )?;
        let mut updated = current.clone();
        updated.name = input.name.trim().to_string();
        updated.source_locale = input.source_locale.trim().to_string();
        updated.target_locale = input.target_locale.trim().to_string();
        updated.domain = input.domain.trim().to_string();
        updated.configuration = input.configuration;
        if updated == current {
            transaction.commit()?;
            return Ok(current);
        }
        updated.revision = next_revision(current.revision)?;
        updated.updated_at_ms = now_ms();
        let changed = transaction.execute(
            "UPDATE projects
             SET name = ?1, source_locale = ?2, target_locale = ?3, domain = ?4,
                 configuration_json = ?5, revision = ?6, updated_at_ms = ?7
             WHERE id = ?8 AND revision = ?9",
            params![
                updated.name,
                updated.source_locale,
                updated.target_locale,
                updated.domain,
                serde_json::to_string(&updated.configuration)?,
                to_i64(updated.revision)?,
                updated.updated_at_ms,
                project_id,
                to_i64(input.expected_revision)?,
            ],
        )?;
        if changed != 1 {
            let actual = find_project(&transaction, project_id)?.revision;
            return Err(StorageError::EntityConflict {
                entity: "project",
                id: project_id.to_string(),
                expected_revision: input.expected_revision,
                actual_revision: actual,
            });
        }
        append_operation(
            &transaction,
            project_id,
            "project",
            project_id,
            "project.update",
            Some(current.revision),
            Some(updated.revision),
            &input.actor,
            input.correlation_id.as_deref(),
            Some(serde_json::to_value(&current)?),
            Some(serde_json::to_value(&updated)?),
        )?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn set_project_lifecycle(
        &mut self,
        project_id: &str,
        lifecycle: ProjectLifecycle,
        expected_revision: u64,
        actor: &str,
        correlation_id: Option<&str>,
    ) -> Result<Project> {
        require_nonempty("operation actor", actor)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_project(&transaction, project_id)?;
        ensure_entity_revision("project", project_id, current.revision, expected_revision)?;
        if current.lifecycle == lifecycle {
            transaction.commit()?;
            return Ok(current);
        }
        let now = now_ms();
        let mut updated = current.clone();
        updated.lifecycle = lifecycle;
        updated.revision = next_revision(current.revision)?;
        updated.updated_at_ms = now;
        updated.archived_at_ms = match lifecycle {
            ProjectLifecycle::Active => None,
            ProjectLifecycle::Archived | ProjectLifecycle::Trash => Some(now),
        };
        let changed = transaction.execute(
            "UPDATE projects
             SET lifecycle = ?1, revision = ?2, updated_at_ms = ?3, archived_at_ms = ?4
             WHERE id = ?5 AND revision = ?6",
            params![
                project_lifecycle_text(lifecycle),
                to_i64(updated.revision)?,
                updated.updated_at_ms,
                updated.archived_at_ms,
                project_id,
                to_i64(expected_revision)?,
            ],
        )?;
        if changed != 1 {
            let actual = find_project(&transaction, project_id)?.revision;
            return Err(StorageError::EntityConflict {
                entity: "project",
                id: project_id.to_string(),
                expected_revision,
                actual_revision: actual,
            });
        }
        append_operation(
            &transaction,
            project_id,
            "project",
            project_id,
            "project.set_lifecycle",
            Some(current.revision),
            Some(updated.revision),
            actor,
            correlation_id,
            Some(serde_json::to_value(&current)?),
            Some(serde_json::to_value(&updated)?),
        )?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn list_documents(
        &self,
        project_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<Document>, u32)> {
        ensure_exists(&self.connection, "projects", "project", project_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM documents WHERE project_id = ?1",
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, name, relative_path, format, filter_id, source_sha256,
                    current_version, status, revision, segment_count, degradation_json,
                    imported_at_ms, updated_at_ms
             FROM documents
             WHERE project_id = ?1
             ORDER BY relative_path, imported_at_ms, id
             LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![project_id, i64::from(limit), i64::from(offset)],
                row_to_document,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn list_operations(
        &self,
        project_id: &str,
        offset: u32,
        limit: u32,
        descending: bool,
    ) -> Result<(Vec<Operation>, u32)> {
        ensure_exists(&self.connection, "projects", "project", project_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM operations WHERE project_id = ?1",
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let order = if descending { "DESC" } else { "ASC" };
        let sql = format!(
            "SELECT id, project_id, sequence, entity_type, entity_id, kind,
                    base_revision, result_revision, actor, correlation_id,
                    before_json, after_json, created_at_ms
             FROM operations WHERE project_id = ?1
             ORDER BY sequence {order}
             LIMIT ?2 OFFSET ?3"
        );
        let mut statement = self.connection.prepare(&sql)?;
        let items = statement
            .query_map(
                params![project_id, i64::from(limit), i64::from(offset)],
                row_to_operation,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn check_health(&self) -> Result<DataHealthReport> {
        let schema_version = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))?;
        let mut findings = Vec::new();

        let mut quick_check = self.connection.prepare("PRAGMA quick_check")?;
        let messages = quick_check
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for message in messages {
            if message != "ok" {
                findings.push(HealthFinding {
                    code: "sqlite.quick_check".to_string(),
                    severity: HealthSeverity::Fatal,
                    message,
                    entity_type: None,
                    entity_id: None,
                    path: None,
                });
            }
        }

        let mut foreign_keys = self.connection.prepare("PRAGMA foreign_key_check")?;
        let violations = foreign_keys
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for (table, row_id, parent) in violations {
            findings.push(HealthFinding {
                code: "sqlite.foreign_key".to_string(),
                severity: HealthSeverity::Error,
                message: format!("foreign key violation from {table} to {parent}"),
                entity_type: Some(table),
                entity_id: row_id.map(|value| value.to_string()),
                path: None,
            });
        }

        let mut documents = self.connection.prepare(
            "SELECT d.id, d.segment_count, COALESCE(v.source_sha256, d.source_sha256),
                    v.id, v.managed_source_path
             FROM documents d
             LEFT JOIN document_versions v
               ON v.document_id = d.id AND v.version = d.current_version
             ORDER BY d.id",
        )?;
        let rows = documents
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for (document_id, expected_segments, expected_hash, version_id, managed_path) in rows {
            let actual_segments = self.connection.query_row(
                "SELECT COUNT(*) FROM segments WHERE document_id = ?1",
                [&document_id],
                |row| row.get::<_, i64>(0),
            )?;
            if actual_segments != expected_segments {
                findings.push(HealthFinding {
                    code: "document.segment_count".to_string(),
                    severity: HealthSeverity::Error,
                    message: format!(
                        "stored segment count {expected_segments} differs from actual {actual_segments}"
                    ),
                    entity_type: Some("document".to_string()),
                    entity_id: Some(document_id.clone()),
                    path: None,
                });
            }
            let Some(version_id) = version_id else {
                findings.push(HealthFinding {
                    code: "document.current_version_missing".to_string(),
                    severity: HealthSeverity::Error,
                    message: "current document version is missing".to_string(),
                    entity_type: Some("document".to_string()),
                    entity_id: Some(document_id.clone()),
                    path: None,
                });
                continue;
            };
            let Some(managed_path) = managed_path else {
                findings.push(HealthFinding {
                    code: "document.managed_path_missing".to_string(),
                    severity: HealthSeverity::Error,
                    message: "current document version has no managed path".to_string(),
                    entity_type: Some("document_version".to_string()),
                    entity_id: Some(version_id),
                    path: None,
                });
                continue;
            };
            let managed_path = resolve_managed_source_path(&self.paths, &managed_path);
            if !managed_path.is_file() {
                findings.push(HealthFinding {
                    code: "document.managed_source_missing".to_string(),
                    severity: HealthSeverity::Error,
                    message: "managed source file is missing".to_string(),
                    entity_type: Some("document_version".to_string()),
                    entity_id: Some(version_id),
                    path: Some(path_text(&managed_path)),
                });
                continue;
            }
            let actual_hash = sha256_file(&managed_path)?;
            if actual_hash != expected_hash {
                findings.push(HealthFinding {
                    code: "document.managed_source_hash".to_string(),
                    severity: HealthSeverity::Error,
                    message: "managed source hash differs from the stored digest".to_string(),
                    entity_type: Some("document_version".to_string()),
                    entity_id: Some(version_id),
                    path: Some(path_text(&managed_path)),
                });
            }
        }

        let healthy = !findings.iter().any(|finding| {
            matches!(
                finding.severity,
                HealthSeverity::Error | HealthSeverity::Fatal
            )
        });
        Ok(DataHealthReport {
            schema_version,
            healthy,
            findings,
            checked_at_ms: now_ms(),
        })
    }

    pub fn create_backup(&self, destination: &Path) -> Result<BackupManifest> {
        create_data_backup(&self.connection, &self.paths, destination)
    }

    pub fn create_tm_library(&mut self, input: NewTmLibrary) -> Result<TmLibrary> {
        require_nonempty("TM library name", &input.name)?;
        require_nonempty("TM source locale", &input.source_locale)?;
        require_nonempty("TM target locale", &input.target_locale)?;
        let now = now_ms();
        let library = TmLibrary {
            id: new_id(),
            name: input.name.trim().to_string(),
            source_locale: input.source_locale.trim().to_string(),
            target_locale: input.target_locale.trim().to_string(),
            domain: trim_optional(input.domain),
            writable: input.writable,
            revision: 0,
            created_at_ms: now,
            updated_at_ms: now,
        };
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(project_id) = input.owner_project_id.as_deref() {
            ensure_exists(&transaction, "projects", "project", project_id)?;
        }
        transaction.execute(
            "INSERT INTO tm_libraries (
                id, name, source_locale, target_locale, domain, owner_project_id,
                writable, revision, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)",
            params![
                library.id,
                library.name,
                library.source_locale,
                library.target_locale,
                library.domain,
                input.owner_project_id,
                library.writable,
                now,
            ],
        )?;
        transaction.commit()?;
        Ok(library)
    }

    pub fn get_tm_library(&self, library_id: &str) -> Result<TmLibrary> {
        find_tm_library(&self.connection, library_id)
    }

    pub fn list_tm_libraries(
        &self,
        project_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<TmLibrary>, u32)> {
        if let Some(project_id) = project_id {
            ensure_exists(&self.connection, "projects", "project", project_id)?;
        }
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM tm_libraries l
             WHERE ?1 IS NULL OR EXISTS (
                SELECT 1 FROM tm_library_mounts m
                WHERE m.library_id = l.id AND m.project_id = ?1
             )",
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT l.id, l.name, l.source_locale, l.target_locale, l.domain,
                    l.writable, l.revision, l.created_at_ms, l.updated_at_ms
             FROM tm_libraries l
             LEFT JOIN tm_library_mounts m
               ON m.library_id = l.id AND m.project_id = ?1
             WHERE ?1 IS NULL OR m.project_id IS NOT NULL
             ORDER BY CASE WHEN ?1 IS NULL THEN 0 ELSE m.priority END,
                      l.updated_at_ms DESC, l.id
             LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![project_id, i64::from(limit), i64::from(offset)],
                row_to_tm_library,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn list_tm_library_mounts(&self, project_id: &str) -> Result<Vec<TmLibraryMount>> {
        ensure_exists(&self.connection, "projects", "project", project_id)?;
        let mut statement = self.connection.prepare(
            "SELECT project_id, library_id, mode, priority, enabled, revision,
                    created_at_ms, updated_at_ms
             FROM tm_library_mounts WHERE project_id = ?1
             ORDER BY priority, library_id",
        )?;
        statement
            .query_map([project_id], row_to_tm_library_mount)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn mount_tm_library(
        &mut self,
        project_id: &str,
        library_id: &str,
        mode: AssetMountMode,
        priority: u32,
        enabled: bool,
        expected_revision: Option<u64>,
    ) -> Result<TmLibraryMount> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_exists(&transaction, "projects", "project", project_id)?;
        let library = find_tm_library(&transaction, library_id)?;
        if mode == AssetMountMode::Write && !library.writable {
            return Err(StorageError::InvalidState(
                "read-only TM library cannot be mounted for writes".to_string(),
            ));
        }
        let existing = find_tm_library_mount_optional(&transaction, project_id, library_id)?;
        let now = now_ms();
        match existing {
            Some(current) => {
                let expected_revision = expected_revision.ok_or_else(|| {
                    StorageError::InvalidState(
                        "expected revision is required to update a TM mount".to_string(),
                    )
                })?;
                ensure_entity_revision(
                    "tm_library_mount",
                    library_id,
                    current.revision,
                    expected_revision,
                )?;
                transaction.execute(
                    "UPDATE tm_library_mounts
                     SET mode = ?1, priority = ?2, enabled = ?3,
                         revision = revision + 1, updated_at_ms = ?4
                     WHERE project_id = ?5 AND library_id = ?6 AND revision = ?7",
                    params![
                        asset_mount_mode_text(mode),
                        i64::from(priority),
                        enabled,
                        now,
                        project_id,
                        library_id,
                        to_i64(expected_revision)?,
                    ],
                )?;
            }
            None => {
                if expected_revision.is_some_and(|revision| revision != 0) {
                    return Err(StorageError::InvalidState(
                        "new TM mount cannot have a nonzero revision".to_string(),
                    ));
                }
                transaction.execute(
                    "INSERT INTO tm_library_mounts (
                        project_id, library_id, mode, priority, enabled, revision,
                        created_at_ms, updated_at_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
                    params![
                        project_id,
                        library_id,
                        asset_mount_mode_text(mode),
                        i64::from(priority),
                        enabled,
                        now,
                    ],
                )?;
            }
        }
        let mount = find_tm_library_mount(&transaction, project_id, library_id)?;
        transaction.commit()?;
        Ok(mount)
    }

    pub fn unmount_tm_library(
        &mut self,
        project_id: &str,
        library_id: &str,
        expected_revision: u64,
    ) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mount = find_tm_library_mount(&transaction, project_id, library_id)?;
        ensure_entity_revision(
            "tm_library_mount",
            library_id,
            mount.revision,
            expected_revision,
        )?;
        transaction.execute(
            "DELETE FROM tm_library_mounts
             WHERE project_id = ?1 AND library_id = ?2 AND revision = ?3",
            params![project_id, library_id, to_i64(expected_revision)?],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn import_tm_units(
        &mut self,
        library_id: &str,
        units: &[translunar_asset_core::TmExchangeUnit],
    ) -> Result<(u32, u32)> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let library = find_tm_library(&transaction, library_id)?;
        if !library.writable {
            return Err(StorageError::InvalidState(
                "TM library is read-only".to_string(),
            ));
        }
        let mut inserted = 0_u32;
        let mut skipped = 0_u32;
        for unit in units {
            require_nonempty("TM source text", &unit.source_text)?;
            require_nonempty("TM target text", &unit.target_text)?;
            if unit.source_locale != library.source_locale
                || unit.target_locale != library.target_locale
            {
                return Err(StorageError::InvalidState(format!(
                    "TM unit language pair {} -> {} does not match library {} -> {}",
                    unit.source_locale,
                    unit.target_locale,
                    library.source_locale,
                    library.target_locale
                )));
            }
            let source_key = exact_key(&unit.source_text);
            let target_hash =
                translunar_domain::sha256_hex(normalize_match_key(&unit.target_text).as_bytes());
            let duplicate = transaction
                .query_row(
                    "SELECT 1 FROM tm_units
                     WHERE library_id = ?1 AND source_key = ?2 AND target_hash = ?3
                     LIMIT 1",
                    params![library_id, source_key, target_hash],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if duplicate {
                skipped = skipped.checked_add(1).ok_or_else(|| {
                    StorageError::InvalidData("TM skipped count overflow".to_string())
                })?;
                continue;
            }
            let now = unit.created_at_ms.unwrap_or_else(now_ms);
            transaction.execute(
                "INSERT INTO tm_units (
                    id, library_id, source_locale, target_locale, source_text,
                    target_text, source_hash, source_key, target_hash, domain,
                    origin_project_id, origin_document_id, origin_segment_id,
                    context_before_hash, context_after_hash, author, metadata_json,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                           NULL, NULL, NULL, NULL, NULL, ?11, ?12, ?13, ?13)",
                params![
                    new_id(),
                    library_id,
                    unit.source_locale,
                    unit.target_locale,
                    unit.source_text,
                    unit.target_text,
                    translunar_domain::sha256_hex(
                        normalize_match_key(&unit.source_text).as_bytes()
                    ),
                    source_key,
                    target_hash,
                    unit.domain,
                    unit.author,
                    serde_json::to_string(&unit.metadata)?,
                    now,
                ],
            )?;
            inserted = inserted.checked_add(1).ok_or_else(|| {
                StorageError::InvalidData("TM inserted count overflow".to_string())
            })?;
        }
        transaction.commit()?;
        Ok((inserted, skipped))
    }

    pub fn list_tm_units(
        &self,
        library_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<TmUnit>, u32)> {
        find_tm_library(&self.connection, library_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM tm_units WHERE library_id = ?1",
            [library_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, library_id, source_locale, target_locale, source_text,
                    target_text, source_hash, target_hash, domain, origin_project_id,
                    origin_document_id, origin_segment_id, context_before_hash,
                    context_after_hash, author, metadata_json, created_at_ms,
                    updated_at_ms
             FROM tm_units WHERE library_id = ?1
             ORDER BY created_at_ms, id LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![library_id, i64::from(limit), i64::from(offset)],
                row_to_tm_unit,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn export_tm_units(&self, library_id: &str) -> Result<Vec<TmUnit>> {
        find_tm_library(&self.connection, library_id)?;
        let mut statement = self.connection.prepare(
            "SELECT id, library_id, source_locale, target_locale, source_text,
                    target_text, source_hash, target_hash, domain, origin_project_id,
                    origin_document_id, origin_segment_id, context_before_hash,
                    context_after_hash, author, metadata_json, created_at_ms,
                    updated_at_ms
             FROM tm_units WHERE library_id = ?1
             ORDER BY created_at_ms, id",
        )?;
        statement
            .query_map([library_id], row_to_tm_unit)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn search_tm(&self, request: &TmSearchRequest) -> Result<(Vec<TmMatch>, u32)> {
        require_nonempty("TM search query", &request.query)?;
        let mounts = self.list_tm_library_mounts(&request.project_id)?;
        let mut matches = Vec::new();
        for mount in mounts.into_iter().filter(|mount| mount.enabled) {
            if !request.library_ids.is_empty()
                && !request.library_ids.iter().any(|id| id == &mount.library_id)
            {
                continue;
            }
            let library = find_tm_library(&self.connection, &mount.library_id)?;
            if library.source_locale != request.source_locale
                || library.target_locale != request.target_locale
            {
                continue;
            }
            let mut statement = self.connection.prepare(
                "SELECT id, library_id, source_locale, target_locale, source_text,
                        target_text, source_hash, target_hash, domain, origin_project_id,
                        origin_document_id, origin_segment_id, context_before_hash,
                        context_after_hash, author, metadata_json, created_at_ms,
                        updated_at_ms
                 FROM tm_units
                 WHERE library_id = ?1 AND source_locale = ?2 AND target_locale = ?3
                   AND (?4 IS NULL OR domain = ?4)
                    AND (?5 IS NULL OR created_at_ms >= ?5)
                    AND (?6 IS NULL OR origin_project_id = ?6)
                    AND (?7 IS NULL OR origin_document_id = ?7)
                 ORDER BY created_at_ms DESC, id LIMIT 5000",
            )?;
            let candidates = statement
                .query_map(
                    params![
                        mount.library_id,
                        request.source_locale,
                        request.target_locale,
                        request.domain,
                        request.since_ms,
                        request.origin_project_id,
                        request.origin_document_id,
                    ],
                    row_to_tm_unit,
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            for unit in candidates {
                let MatchScore {
                    score,
                    substitutions,
                } = match_score(&request.query, &unit.source_text);
                let context_match = score == 100
                    && (request.context_before_hash.is_some()
                        || request.context_after_hash.is_some())
                    && request.context_before_hash == unit.context_before_hash
                    && request.context_after_hash == unit.context_after_hash;
                let (kind, effective_score) = if context_match {
                    (TmMatchKind::Context, 101)
                } else if score == 100 {
                    (TmMatchKind::Exact, 100)
                } else {
                    (TmMatchKind::Fuzzy, score)
                };
                if effective_score < request.threshold {
                    continue;
                }
                matches.push(TmMatch {
                    library: library.clone(),
                    unit,
                    kind,
                    score: effective_score,
                    mount_priority: mount.priority,
                    substitutions,
                });
            }
        }
        matches.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.mount_priority.cmp(&right.mount_priority))
                .then_with(|| right.unit.created_at_ms.cmp(&left.unit.created_at_ms))
                .then_with(|| left.unit.id.cmp(&right.unit.id))
        });
        let total = to_u32(matches.len())?;
        let items = page_slice(matches, request.offset, request.limit)?;
        Ok((items, total))
    }

    pub fn concordance(&self, request: &ConcordanceRequest) -> Result<(Vec<ConcordanceHit>, u32)> {
        require_nonempty("concordance query", &request.query)?;
        let query = normalize_match_key(&request.query);
        let mounts = self.list_tm_library_mounts(&request.project_id)?;
        let mut hits = Vec::new();
        for mount in mounts.into_iter().filter(|mount| mount.enabled) {
            let (units, _) = self.list_tm_units(&mount.library_id, 0, 5000)?;
            for unit in units {
                let source = normalize_match_key(&unit.source_text).contains(&query);
                let target = normalize_match_key(&unit.target_text).contains(&query);
                let matched_side = match request.side {
                    ConcordanceSide::Source if source => Some(ConcordanceSide::Source),
                    ConcordanceSide::Target if target => Some(ConcordanceSide::Target),
                    ConcordanceSide::Both if source && target => Some(ConcordanceSide::Both),
                    ConcordanceSide::Both if source => Some(ConcordanceSide::Source),
                    ConcordanceSide::Both if target => Some(ConcordanceSide::Target),
                    _ => None,
                };
                if let Some(matched_side) = matched_side {
                    hits.push((
                        mount.priority,
                        unit.created_at_ms,
                        ConcordanceHit {
                            library_id: mount.library_id.clone(),
                            unit,
                            matched_side,
                        },
                    ));
                }
            }
        }
        hits.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| right.1.cmp(&left.1))
                .then_with(|| left.2.unit.id.cmp(&right.2.unit.id))
        });
        let total = to_u32(hits.len())?;
        let values = hits.into_iter().map(|(_, _, hit)| hit).collect::<Vec<_>>();
        Ok((page_slice(values, request.offset, request.limit)?, total))
    }

    pub fn create_termbase(&mut self, input: NewTermbase) -> Result<Termbase> {
        require_nonempty("termbase name", &input.name)?;
        require_nonempty("termbase source locale", &input.source_locale)?;
        let now = now_ms();
        let termbase = Termbase {
            id: new_id(),
            name: input.name.trim().to_string(),
            source_locale: input.source_locale.trim().to_string(),
            domain: trim_optional(input.domain),
            writable: input.writable,
            revision: 0,
            created_at_ms: now,
            updated_at_ms: now,
        };
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO termbases (
                id, name, source_locale, domain, writable, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
            params![
                termbase.id,
                termbase.name,
                termbase.source_locale,
                termbase.domain,
                termbase.writable,
                now,
            ],
        )?;
        transaction.commit()?;
        Ok(termbase)
    }

    pub fn get_termbase(&self, termbase_id: &str) -> Result<Termbase> {
        find_termbase(&self.connection, termbase_id)
    }

    pub fn list_termbases(
        &self,
        project_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<Termbase>, u32)> {
        if let Some(project_id) = project_id {
            ensure_exists(&self.connection, "projects", "project", project_id)?;
        }
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM termbases t
             WHERE ?1 IS NULL OR EXISTS (
                SELECT 1 FROM termbase_mounts m
                WHERE m.termbase_id = t.id AND m.project_id = ?1
             )",
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT t.id, t.name, t.source_locale, t.domain, t.writable,
                    t.revision, t.created_at_ms, t.updated_at_ms
             FROM termbases t
             LEFT JOIN termbase_mounts m
               ON m.termbase_id = t.id AND m.project_id = ?1
             WHERE ?1 IS NULL OR m.project_id IS NOT NULL
             ORDER BY CASE WHEN ?1 IS NULL THEN 0 ELSE m.priority END,
                      t.updated_at_ms DESC, t.id
             LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![project_id, i64::from(limit), i64::from(offset)],
                row_to_termbase,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn list_termbase_mounts(&self, project_id: &str) -> Result<Vec<TermbaseMount>> {
        ensure_exists(&self.connection, "projects", "project", project_id)?;
        let mut statement = self.connection.prepare(
            "SELECT project_id, termbase_id, priority, writable, enabled,
                    revision, created_at_ms, updated_at_ms
             FROM termbase_mounts WHERE project_id = ?1
             ORDER BY priority, termbase_id",
        )?;
        statement
            .query_map([project_id], row_to_termbase_mount)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn mount_termbase(
        &mut self,
        project_id: &str,
        termbase_id: &str,
        priority: u32,
        writable: bool,
        enabled: bool,
        expected_revision: Option<u64>,
    ) -> Result<TermbaseMount> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_exists(&transaction, "projects", "project", project_id)?;
        let termbase = find_termbase(&transaction, termbase_id)?;
        if writable && !termbase.writable {
            return Err(StorageError::InvalidState(
                "read-only termbase cannot be mounted for writes".to_string(),
            ));
        }
        let existing = find_termbase_mount_optional(&transaction, project_id, termbase_id)?;
        let now = now_ms();
        match existing {
            Some(current) => {
                let expected_revision = expected_revision.ok_or_else(|| {
                    StorageError::InvalidState(
                        "expected revision is required to update a termbase mount".to_string(),
                    )
                })?;
                ensure_entity_revision(
                    "termbase_mount",
                    termbase_id,
                    current.revision,
                    expected_revision,
                )?;
                transaction.execute(
                    "UPDATE termbase_mounts SET priority = ?1, writable = ?2,
                            enabled = ?3, revision = revision + 1, updated_at_ms = ?4
                     WHERE project_id = ?5 AND termbase_id = ?6 AND revision = ?7",
                    params![
                        i64::from(priority),
                        writable,
                        enabled,
                        now,
                        project_id,
                        termbase_id,
                        to_i64(expected_revision)?,
                    ],
                )?;
            }
            None => {
                transaction.execute(
                    "INSERT INTO termbase_mounts (
                        project_id, termbase_id, priority, writable, enabled,
                        revision, created_at_ms, updated_at_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
                    params![
                        project_id,
                        termbase_id,
                        i64::from(priority),
                        writable,
                        enabled,
                        now,
                    ],
                )?;
            }
        }
        let mount = find_termbase_mount(&transaction, project_id, termbase_id)?;
        transaction.commit()?;
        Ok(mount)
    }

    pub fn unmount_termbase(
        &mut self,
        project_id: &str,
        termbase_id: &str,
        expected_revision: u64,
    ) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mount = find_termbase_mount(&transaction, project_id, termbase_id)?;
        ensure_entity_revision(
            "termbase_mount",
            termbase_id,
            mount.revision,
            expected_revision,
        )?;
        transaction.execute(
            "DELETE FROM termbase_mounts
             WHERE project_id = ?1 AND termbase_id = ?2 AND revision = ?3",
            params![project_id, termbase_id, to_i64(expected_revision)?],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn upsert_term_entry(&mut self, input: NewTermEntry) -> Result<TermEntry> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (result, _) = upsert_term_entry_in_transaction(&transaction, input)?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn import_term_entries(
        &mut self,
        termbase_id: &str,
        entries: &[translunar_asset_core::TermExchangeEntry],
    ) -> Result<(u32, u32)> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut inserted = 0_u32;
        let mut skipped = 0_u32;
        for entry in entries {
            let status = match entry.status.to_ascii_lowercase().as_str() {
                "candidate" => TermStatus::Candidate,
                "active" => TermStatus::Active,
                "deprecated" => TermStatus::Deprecated,
                value => {
                    return Err(StorageError::InvalidData(format!(
                        "unknown term status {value}"
                    )));
                }
            };
            let (source_locale, translations) = (
                entry.source_locale.clone(),
                entry
                    .target_translations
                    .iter()
                    .map(|translation| NewTermTranslation {
                        locale: translation.locale.clone(),
                        term: translation.term.clone(),
                        preferred: translation.preferred,
                        forbidden: translation.forbidden,
                    })
                    .collect(),
            );
            let input = NewTermEntry {
                termbase_id: termbase_id.to_string(),
                source_locale,
                source_term: entry.source_term.clone(),
                part_of_speech: entry.part_of_speech.clone(),
                definition: entry.definition.clone(),
                example: entry.example.clone(),
                domain: entry.domain.clone(),
                status,
                translations,
            };
            let (_, existed) = upsert_term_entry_in_transaction(&transaction, input)?;
            if existed {
                skipped = skipped.checked_add(1).ok_or_else(|| {
                    StorageError::InvalidData("term skipped count overflow".to_string())
                })?;
            } else {
                inserted = inserted.checked_add(1).ok_or_else(|| {
                    StorageError::InvalidData("term inserted count overflow".to_string())
                })?;
            }
        }
        transaction.commit()?;
        Ok((inserted, skipped))
    }

    pub fn list_term_entries(
        &self,
        termbase_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<TermEntry>, u32)> {
        find_termbase(&self.connection, termbase_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM term_entries WHERE termbase_id = ?1",
            [termbase_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id FROM term_entries WHERE termbase_id = ?1
             ORDER BY source_key, id LIMIT ?2 OFFSET ?3",
        )?;
        let ids = statement
            .query_map(
                params![termbase_id, i64::from(limit), i64::from(offset)],
                |row| row.get::<_, String>(0),
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let entries = ids
            .iter()
            .map(|id| find_term_entry(&self.connection, id))
            .collect::<Result<Vec<_>>>()?;
        Ok((entries, to_u32(total)?))
    }

    pub fn export_term_entries(&self, termbase_id: &str) -> Result<Vec<TermEntry>> {
        find_termbase(&self.connection, termbase_id)?;
        let mut statement = self.connection.prepare(
            "SELECT id FROM term_entries WHERE termbase_id = ?1
             ORDER BY source_key, id",
        )?;
        let ids = statement
            .query_map([termbase_id], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ids.iter()
            .map(|id| find_term_entry(&self.connection, id))
            .collect::<Result<Vec<_>>>()
    }

    pub fn search_terms(&self, request: &TermSearchRequest) -> Result<(Vec<TermMatch>, u32)> {
        require_nonempty("term search text", &request.text)?;
        let mounts = self.list_termbase_mounts(&request.project_id)?;
        let mut matches = Vec::new();
        for mount in mounts.into_iter().filter(|mount| mount.enabled) {
            if !request.termbase_ids.is_empty()
                && !request
                    .termbase_ids
                    .iter()
                    .any(|id| id == &mount.termbase_id)
            {
                continue;
            }
            let mut statement = self.connection.prepare(
                "SELECT e.id FROM term_entries e
                 WHERE e.termbase_id = ?1 AND e.status = 'active'
                 ORDER BY e.source_key, e.id LIMIT 5000",
            )?;
            let ids = statement
                .query_map([mount.termbase_id.clone()], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            for id in ids {
                let entry = find_term_entry(&self.connection, &id)?;
                for (start, end) in term_spans(&request.text, &entry.source_term) {
                    matches.push((
                        mount.priority,
                        entry.id.clone(),
                        TermMatch {
                            termbase_id: entry.termbase_id.clone(),
                            entry_id: entry.id.clone(),
                            source_term: entry.source_term.clone(),
                            translations: entry.translations.clone(),
                            start,
                            end,
                        },
                    ));
                }
                for translation in &entry.translations {
                    for (start, end) in term_spans(&request.text, &translation.term) {
                        matches.push((
                            mount.priority,
                            entry.id.clone(),
                            TermMatch {
                                termbase_id: entry.termbase_id.clone(),
                                entry_id: entry.id.clone(),
                                source_term: entry.source_term.clone(),
                                translations: entry.translations.clone(),
                                start,
                                end,
                            },
                        ));
                    }
                }
            }
        }
        matches.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.cmp(&right.1))
                .then_with(|| left.2.start.cmp(&right.2.start))
        });
        let total = to_u32(matches.len())?;
        let values = matches
            .into_iter()
            .map(|(_, _, value)| value)
            .collect::<Vec<_>>();
        Ok((page_slice(values, request.offset, request.limit)?, total))
    }

    pub fn create_pipeline_definition(
        &mut self,
        input: NewPipelineDefinition,
    ) -> Result<PipelineDefinition> {
        require_nonempty("pipeline name", &input.name)?;
        if input.steps.is_empty() {
            return Err(StorageError::InvalidState(
                "pipeline requires at least one step".to_string(),
            ));
        }
        let now = now_ms();
        let definition = PipelineDefinition {
            id: new_id(),
            project_id: input.project_id,
            name: input.name.trim().to_string(),
            version: 1,
            revision: 0,
            steps: input.steps,
            created_at_ms: now,
            updated_at_ms: now,
        };
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(project_id) = definition.project_id.as_deref() {
            ensure_exists(&transaction, "projects", "project", project_id)?;
        }
        transaction.execute(
            "INSERT INTO pipeline_definitions (
                id, project_id, name, version, revision, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
            params![
                definition.id,
                definition.project_id,
                definition.name,
                i64::from(definition.version),
                definition.created_at_ms,
            ],
        )?;
        for (index, step) in definition.steps.iter().enumerate() {
            transaction.execute(
                "INSERT INTO pipeline_steps (
                    definition_id, step_index, step_key, step_id, config_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    definition.id,
                    i64::try_from(index).map_err(|_| StorageError::InvalidData(
                        "pipeline step index overflow".to_string()
                    ))?,
                    step.key,
                    step.step_id,
                    serde_json::to_string(&step.config)?,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(definition)
    }

    pub fn get_pipeline_definition(&self, definition_id: &str) -> Result<PipelineDefinition> {
        find_pipeline_definition(&self.connection, definition_id)
    }

    pub fn list_pipeline_definitions(
        &self,
        project_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<PipelineDefinition>, u32)> {
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM pipeline_definitions
             WHERE (?1 IS NULL OR project_id = ?1)",
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id FROM pipeline_definitions
             WHERE (?1 IS NULL OR project_id = ?1)
             ORDER BY updated_at_ms DESC, id
             LIMIT ?2 OFFSET ?3",
        )?;
        let ids = statement
            .query_map(
                params![project_id, i64::from(limit), i64::from(offset)],
                |row| row.get::<_, String>(0),
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let items = ids
            .iter()
            .map(|id| find_pipeline_definition(&self.connection, id))
            .collect::<Result<Vec<_>>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn create_pipeline_run(
        &mut self,
        definition_id: &str,
        project_id: &str,
        document_id: Option<&str>,
        input: Value,
    ) -> Result<PipelineRunSnapshot> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_exists(&transaction, "projects", "project", project_id)?;
        if let Some(document_id) = document_id {
            let owner = transaction
                .query_row(
                    "SELECT project_id FROM documents WHERE id = ?1",
                    [document_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| not_found("document", document_id))?;
            if owner != project_id {
                return Err(StorageError::InvalidState(
                    "pipeline document does not belong to the project".to_string(),
                ));
            }
        }
        let definition = find_pipeline_definition(&transaction, definition_id)?;
        if let Some(owner) = definition.project_id.as_deref()
            && owner != project_id
        {
            return Err(StorageError::InvalidState(
                "pipeline definition belongs to another project".to_string(),
            ));
        }
        let now = now_ms();
        let run = PipelineRun {
            id: new_id(),
            definition_id: definition_id.to_string(),
            project_id: project_id.to_string(),
            document_id: document_id.map(ToOwned::to_owned),
            status: PipelineRunStatus::Queued,
            revision: 0,
            current_step_index: 0,
            step_count: to_u32(definition.steps.len())?,
            cancellation_requested: false,
            input,
            output: None,
            error: None,
            created_at_ms: now,
            started_at_ms: None,
            completed_at_ms: None,
            updated_at_ms: now,
        };
        transaction.execute(
            "INSERT INTO pipeline_runs (
                id, definition_id, project_id, document_id, status, revision,
                current_step_index, step_count, cancellation_requested, input_json,
                output_json, error_json, created_at_ms, started_at_ms,
                completed_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, 'queued', 0, 0, ?5, 0, ?6,
                       NULL, NULL, ?7, NULL, NULL, ?7)",
            params![
                run.id,
                run.definition_id,
                run.project_id,
                run.document_id,
                i64::from(run.step_count),
                serde_json::to_string(&run.input)?,
                run.created_at_ms,
            ],
        )?;
        let mut steps = Vec::with_capacity(definition.steps.len());
        for (index, definition_step) in definition.steps.iter().enumerate() {
            let step_index = u32::try_from(index).map_err(|_| {
                StorageError::InvalidData("pipeline step index overflow".to_string())
            })?;
            let step = PipelineStepRun {
                id: new_id(),
                run_id: run.id.clone(),
                step_key: definition_step.key.clone(),
                step_id: definition_step.step_id.clone(),
                step_index,
                status: PipelineStepStatus::Pending,
                revision: 0,
                input: None,
                output: None,
                checkpoint: None,
                usage: None,
                error: None,
                started_at_ms: None,
                completed_at_ms: None,
                updated_at_ms: now,
            };
            transaction.execute(
                "INSERT INTO pipeline_step_runs (
                    id, run_id, step_key, step_id, step_index, status, revision,
                    input_json, output_json, checkpoint_json, usage_json, error_json,
                    started_at_ms, completed_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', 0,
                           NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?6)",
                params![
                    step.id,
                    step.run_id,
                    step.step_key,
                    step.step_id,
                    i64::from(step.step_index),
                    step.updated_at_ms,
                ],
            )?;
            steps.push(step);
        }
        transaction.commit()?;
        Ok(PipelineRunSnapshot { run, steps })
    }

    pub fn get_pipeline_run(&self, run_id: &str) -> Result<PipelineRunSnapshot> {
        let run = find_pipeline_run(&self.connection, run_id)?;
        let mut statement = self.connection.prepare(
            "SELECT id, run_id, step_key, step_id, step_index, status, revision,
                    input_json, output_json, checkpoint_json, usage_json, error_json,
                    started_at_ms, completed_at_ms, updated_at_ms
             FROM pipeline_step_runs WHERE run_id = ?1 ORDER BY step_index",
        )?;
        let steps = statement
            .query_map([run_id], row_to_pipeline_step_run)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(PipelineRunSnapshot { run, steps })
    }

    pub fn list_pipeline_runs(
        &self,
        project_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<PipelineRun>, u32)> {
        ensure_exists(&self.connection, "projects", "project", project_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM pipeline_runs WHERE project_id = ?1",
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, definition_id, project_id, document_id, status, revision,
                    current_step_index, step_count, cancellation_requested, input_json,
                    output_json, error_json, created_at_ms, started_at_ms,
                    completed_at_ms, updated_at_ms
             FROM pipeline_runs WHERE project_id = ?1
             ORDER BY created_at_ms DESC, id
             LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![project_id, i64::from(limit), i64::from(offset)],
                row_to_pipeline_run,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn start_pipeline_run(&mut self, run_id: &str) -> Result<PipelineRunSnapshot> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_pipeline_run(&transaction, run_id)?;
        ensure_run_transition(current.status, PipelineRunStatus::Running)
            .map_err(|error| StorageError::InvalidState(error.to_string()))?;
        let now = now_ms();
        transaction.execute(
            "UPDATE pipeline_runs
             SET status = 'running', revision = revision + 1,
                 started_at_ms = COALESCE(started_at_ms, ?1), updated_at_ms = ?1
             WHERE id = ?2 AND revision = ?3",
            params![now, run_id, to_i64(current.revision)?],
        )?;
        transaction.commit()?;
        self.get_pipeline_run(run_id)
    }

    pub fn start_pipeline_step(
        &mut self,
        run_id: &str,
        step_index: u32,
        input: Value,
    ) -> Result<PipelineStepRun> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_pipeline_run(&transaction, run_id)?;
        if run.status != PipelineRunStatus::Running || run.current_step_index != step_index {
            return Err(StorageError::InvalidState(format!(
                "pipeline run is not ready for step {step_index}"
            )));
        }
        let step = find_pipeline_step_run(&transaction, run_id, step_index)?;
        if !matches!(
            step.status,
            PipelineStepStatus::Pending | PipelineStepStatus::Interrupted
        ) {
            return Err(StorageError::InvalidState(format!(
                "pipeline step cannot start from {:?}",
                step.status
            )));
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE pipeline_step_runs
             SET status = 'running', revision = revision + 1, input_json = ?1,
                 started_at_ms = COALESCE(started_at_ms, ?2), updated_at_ms = ?2
             WHERE run_id = ?3 AND step_index = ?4 AND revision = ?5",
            params![
                serde_json::to_string(&input)?,
                now,
                run_id,
                i64::from(step_index),
                to_i64(step.revision)?,
            ],
        )?;
        transaction.commit()?;
        self.get_pipeline_run(run_id)?
            .steps
            .into_iter()
            .find(|item| item.step_index == step_index)
            .ok_or_else(|| not_found("pipeline_step_run", &format!("{run_id}:{step_index}")))
    }

    pub fn complete_pipeline_step(
        &mut self,
        run_id: &str,
        step_index: u32,
        output: Value,
        checkpoint: Option<Value>,
        usage: Option<Value>,
    ) -> Result<PipelineRunSnapshot> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_pipeline_run(&transaction, run_id)?;
        let step = find_pipeline_step_run(&transaction, run_id, step_index)?;
        if run.status != PipelineRunStatus::Running
            || run.current_step_index != step_index
            || step.status != PipelineStepStatus::Running
        {
            return Err(StorageError::InvalidState(
                "pipeline step is not running".to_string(),
            ));
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE pipeline_step_runs
             SET status = 'succeeded', revision = revision + 1, output_json = ?1,
                 checkpoint_json = ?2, usage_json = ?3, completed_at_ms = ?4,
                 updated_at_ms = ?4
             WHERE id = ?5 AND revision = ?6",
            params![
                serde_json::to_string(&output)?,
                checkpoint.as_ref().map(serde_json::to_string).transpose()?,
                usage.as_ref().map(serde_json::to_string).transpose()?,
                now,
                step.id,
                to_i64(step.revision)?,
            ],
        )?;
        let next_index = step_index
            .checked_add(1)
            .ok_or_else(|| StorageError::InvalidData("pipeline step overflow".to_string()))?;
        let finished = next_index >= run.step_count;
        transaction.execute(
            "UPDATE pipeline_runs
             SET status = ?1, revision = revision + 1, current_step_index = ?2,
                 output_json = ?3, completed_at_ms = ?4, updated_at_ms = ?5
             WHERE id = ?6 AND revision = ?7",
            params![
                if finished { "succeeded" } else { "running" },
                i64::from(next_index),
                serde_json::to_string(&output)?,
                if finished { Some(now) } else { None },
                now,
                run_id,
                to_i64(run.revision)?,
            ],
        )?;
        transaction.commit()?;
        self.get_pipeline_run(run_id)
    }

    pub fn fail_pipeline_run(
        &mut self,
        run_id: &str,
        failure: PipelineFailure,
    ) -> Result<PipelineRunSnapshot> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_pipeline_run(&transaction, run_id)?;
        if run.status.is_terminal() {
            transaction.commit()?;
            return self.get_pipeline_run(run_id);
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE pipeline_step_runs
             SET status = 'failed', revision = revision + 1, error_json = ?1,
                 completed_at_ms = ?2, updated_at_ms = ?2
             WHERE run_id = ?3 AND step_index = ?4
               AND status IN ('running', 'interrupted')",
            params![
                serde_json::to_string(&failure)?,
                now,
                run_id,
                i64::from(run.current_step_index),
            ],
        )?;
        transaction.execute(
            "UPDATE pipeline_runs
             SET status = 'failed', revision = revision + 1, error_json = ?1,
                 completed_at_ms = ?2, updated_at_ms = ?2
             WHERE id = ?3 AND revision = ?4",
            params![
                serde_json::to_string(&failure)?,
                now,
                run_id,
                to_i64(run.revision)?,
            ],
        )?;
        transaction.commit()?;
        self.get_pipeline_run(run_id)
    }

    pub fn request_pipeline_cancel(
        &mut self,
        run_id: &str,
        expected_revision: u64,
    ) -> Result<PipelineRunSnapshot> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_pipeline_run(&transaction, run_id)?;
        ensure_entity_revision("pipeline_run", run_id, run.revision, expected_revision)?;
        if run.status.is_terminal() {
            transaction.commit()?;
            return self.get_pipeline_run(run_id);
        }
        if !matches!(
            run.status,
            PipelineRunStatus::Queued
                | PipelineRunStatus::Running
                | PipelineRunStatus::Interrupted
                | PipelineRunStatus::Canceling
        ) {
            return Err(StorageError::InvalidState(format!(
                "pipeline run cannot be canceled from {:?}",
                run.status
            )));
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE pipeline_runs
             SET status = 'canceling', cancellation_requested = 1,
                 revision = revision + 1, updated_at_ms = ?1
             WHERE id = ?2 AND revision = ?3",
            params![now, run_id, to_i64(expected_revision)?],
        )?;
        transaction.commit()?;
        self.get_pipeline_run(run_id)
    }

    pub fn pipeline_cancel_requested(&self, run_id: &str) -> Result<bool> {
        self.connection
            .query_row(
                "SELECT cancellation_requested FROM pipeline_runs WHERE id = ?1",
                [run_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?
            .ok_or_else(|| not_found("pipeline_run", run_id))
    }

    pub fn finalize_pipeline_canceled(&mut self, run_id: &str) -> Result<PipelineRunSnapshot> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_pipeline_run(&transaction, run_id)?;
        if run.status != PipelineRunStatus::Canceling {
            return Err(StorageError::InvalidState(
                "pipeline run is not canceling".to_string(),
            ));
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE pipeline_step_runs
             SET status = 'canceled', revision = revision + 1,
                 completed_at_ms = ?1, updated_at_ms = ?1
             WHERE run_id = ?2 AND status IN ('pending', 'running', 'interrupted')",
            params![now, run_id],
        )?;
        transaction.execute(
            "UPDATE pipeline_runs
             SET status = 'canceled', revision = revision + 1,
                 completed_at_ms = ?1, updated_at_ms = ?1
             WHERE id = ?2 AND revision = ?3",
            params![now, run_id, to_i64(run.revision)?],
        )?;
        transaction.commit()?;
        self.get_pipeline_run(run_id)
    }

    pub fn resume_pipeline_run(
        &mut self,
        run_id: &str,
        expected_revision: u64,
    ) -> Result<PipelineRunSnapshot> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_pipeline_run(&transaction, run_id)?;
        ensure_entity_revision("pipeline_run", run_id, run.revision, expected_revision)?;
        ensure_run_transition(run.status, PipelineRunStatus::Queued)
            .map_err(|error| StorageError::InvalidState(error.to_string()))?;
        let now = now_ms();
        transaction.execute(
            "UPDATE pipeline_step_runs
             SET status = 'pending', revision = revision + 1, updated_at_ms = ?1
             WHERE run_id = ?2 AND status = 'interrupted'",
            params![now, run_id],
        )?;
        transaction.execute(
            "UPDATE pipeline_runs
             SET status = 'queued', cancellation_requested = 0,
                 revision = revision + 1, error_json = NULL,
                 completed_at_ms = NULL, updated_at_ms = ?1
             WHERE id = ?2 AND revision = ?3",
            params![now, run_id, to_i64(expected_revision)?],
        )?;
        transaction.commit()?;
        self.get_pipeline_run(run_id)
    }

    pub fn insert_document(
        &mut self,
        input: &NewDocument,
        units: &[ImportedUnit],
    ) -> Result<Document> {
        require_nonempty("document id", &input.id)?;
        require_nonempty("project id", &input.project_id)?;
        require_nonempty("document name", &input.name)?;
        require_nonempty("document format", &input.format)?;
        require_nonempty("source digest", &input.source_sha256)?;
        ensure_unique_units(units)?;

        let imported_at_ms = now_ms();
        let document = Document {
            id: input.id.clone(),
            project_id: input.project_id.clone(),
            name: input.name.clone(),
            relative_path: input.relative_path.clone(),
            format: input.format.clone(),
            filter_id: input.filter_id.clone(),
            source_sha256: input.source_sha256.clone(),
            current_version: 1,
            status: DocumentStatus::Active,
            revision: 0,
            segment_count: to_u32(units.len())?,
            degradation: input.degradation.clone(),
            imported_at_ms,
            updated_at_ms: imported_at_ms,
        };
        let version_id = new_id();

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_exists(&transaction, "projects", "project", &input.project_id)?;
        let original_source_path = path_text(&input.original_source_path);
        let managed_source_path =
            stored_managed_source_path(&self.paths, &input.managed_source_path);
        transaction.execute(
            "INSERT INTO documents (
                id, project_id, name, relative_path, format, filter_id, source_sha256,
                original_source_path, managed_source_path, current_version, status,
                revision, segment_count, degradation_json, imported_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 'active', 0, ?10, ?11, ?12, ?12)",
            params![
                document.id,
                document.project_id,
                document.name,
                document.relative_path,
                document.format,
                document.filter_id,
                document.source_sha256,
                original_source_path,
                managed_source_path.clone(),
                i64::from(document.segment_count),
                serde_json::to_string(&document.degradation)?,
                document.imported_at_ms,
            ],
        )?;
        transaction.execute(
            "INSERT INTO document_versions (
                id, document_id, version, source_sha256, original_source_path,
                managed_source_path, reason, created_at_ms
             ) VALUES (?1, ?2, 1, ?3, ?4, ?5, 'initial-import', ?6)",
            params![
                version_id,
                document.id,
                document.source_sha256,
                original_source_path,
                managed_source_path,
                document.imported_at_ms,
            ],
        )?;

        for (index, unit) in units.iter().enumerate() {
            let previous = index
                .checked_sub(1)
                .and_then(|position| units.get(position))
                .map(|item| item.source_text.as_str());
            let next = units.get(index + 1).map(|item| item.source_text.as_str());
            let (source_hash, context_hash) = segment_hashes(&unit.source_text, previous, next);
            let segment_id = new_id();
            let target_text = unit.target_text.as_deref().unwrap_or_default();
            transaction.execute(
                "INSERT INTO segments (
                    id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms,
                    document_version_id, source_version
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, ?11, 1)",
                params![
                    segment_id,
                    document.id,
                    i64::from(unit.ordinal),
                    unit.structural_path,
                    unit.source_text,
                    target_text,
                    segment_state_text(state_for_target(target_text)),
                    source_hash,
                    context_hash,
                    imported_at_ms,
                    version_id,
                ],
            )?;
            for tag in &unit.inline_tags {
                transaction.execute(
                    "INSERT INTO inline_tags (
                        id, segment_id, side, position, kind, pair_id, payload,
                        display_text, protected
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        tag.id,
                        segment_id,
                        tag_side_text(tag.side),
                        i64::from(tag.position),
                        tag_kind_text(tag.kind),
                        tag.pair_id,
                        tag.payload,
                        tag.display_text,
                        tag.protected,
                    ],
                )?;
            }
            for note in &unit.notes {
                transaction.execute(
                    "INSERT INTO segment_notes (segment_id, id, text, author)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![segment_id, note.id, note.text, note.author],
                )?;
            }
        }
        transaction.commit()?;
        Ok(document)
    }

    pub fn get_document(&self, document_id: &str) -> Result<ManagedDocument> {
        let mut document = self
            .connection
            .query_row(
                "SELECT d.id, d.project_id, d.name, d.relative_path, d.format, d.filter_id,
                        d.source_sha256, d.current_version, d.status, d.revision,
                        d.segment_count, d.degradation_json, d.imported_at_ms, d.updated_at_ms,
                        v.original_source_path, v.managed_source_path
                 FROM documents d
                 JOIN document_versions v
                   ON v.document_id = d.id AND v.version = d.current_version
                 WHERE d.id = ?1",
                [document_id],
                row_to_managed_document,
            )
            .optional()?
            .ok_or_else(|| not_found("document", document_id))?;
        document.managed_source_path =
            resolve_managed_source_path(&self.paths, &document.managed_source_path);
        Ok(document)
    }

    pub fn list_segments(
        &self,
        document_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<Segment>, u32)> {
        ensure_exists(&self.connection, "documents", "document", document_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM segments WHERE document_id = ?1",
            [document_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
             FROM segments WHERE document_id = ?1
             ORDER BY ordinal LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![document_id, i64::from(limit), i64::from(offset)],
                row_to_segment,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn list_segment_notes(&self, segment_id: &str) -> Result<Vec<DocumentNote>> {
        ensure_exists(&self.connection, "segments", "segment", segment_id)?;
        let mut statement = self.connection.prepare(
            "SELECT id, text, author FROM segment_notes
             WHERE segment_id = ?1 ORDER BY id",
        )?;
        let notes = statement
            .query_map([segment_id], |row| {
                Ok(DocumentNote {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    author: row.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(notes)
    }

    pub fn all_segments(&self, document_id: &str) -> Result<Vec<Segment>> {
        let (segments, total) = self.list_segments(document_id, 0, u32::MAX)?;
        debug_assert_eq!(segments.len(), total as usize);
        Ok(segments)
    }

    pub fn update_target(
        &mut self,
        segment_id: &str,
        target_text: &str,
        expected_revision: u64,
    ) -> Result<Segment> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_segment(&transaction, segment_id)?;
        ensure_revision(&current, expected_revision)?;

        if current.target_text == target_text {
            transaction.commit()?;
            return Ok(current);
        }

        let state = state_for_target(target_text);
        let updated_at_ms = now_ms();
        let next_revision = current
            .revision
            .checked_add(1)
            .ok_or_else(|| StorageError::InvalidData("segment revision overflow".to_string()))?;
        let changed = transaction.execute(
            "UPDATE segments
             SET target_text = ?1, state = ?2, revision = ?3, updated_at_ms = ?4
             WHERE id = ?5 AND revision = ?6",
            params![
                target_text,
                segment_state_text(state),
                to_i64(next_revision)?,
                updated_at_ms,
                segment_id,
                to_i64(expected_revision)?,
            ],
        )?;
        if changed != 1 {
            let actual = find_segment(&transaction, segment_id)?.revision;
            return Err(StorageError::Conflict {
                segment_id: segment_id.to_string(),
                expected_revision,
                actual_revision: actual,
            });
        }
        let updated = find_segment(&transaction, segment_id)?;
        let project_id = project_id_for_segment(&transaction, segment_id)?;
        append_operation(
            &transaction,
            &project_id,
            "segment",
            segment_id,
            "segment.update_target",
            Some(current.revision),
            Some(updated.revision),
            LEGACY_DESKTOP_ACTOR,
            None,
            Some(serde_json::to_value(&current)?),
            Some(serde_json::to_value(&updated)?),
        )?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn correct_ocr_source(
        &mut self,
        segment_id: &str,
        source_text: &str,
        reason: &str,
        expected_revision: u64,
    ) -> Result<Segment> {
        require_nonempty("OCR source text", source_text)?;
        require_nonempty("OCR correction reason", reason)?;
        if source_text.len() > 1_000_000 || reason.len() > 4_096 {
            return Err(StorageError::InvalidState(
                "OCR correction text or reason exceeds the configured limit".to_string(),
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_segment(&transaction, segment_id)?;
        ensure_revision(&current, expected_revision)?;
        if current.state == SegmentState::Confirmed {
            return Err(StorageError::InvalidState(
                "a confirmed segment source cannot be corrected".to_string(),
            ));
        }
        if !current.structural_path.contains(";s=ocr;") {
            return Err(StorageError::InvalidState(
                "only OCR-origin segment sources can be corrected".to_string(),
            ));
        }
        if current.source_text == source_text {
            return Err(StorageError::InvalidState(
                "OCR correction must change the source text".to_string(),
            ));
        }
        let mut statement = transaction.prepare(
            "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
             FROM segments WHERE document_id = ?1 ORDER BY ordinal",
        )?;
        let mut segments = statement
            .query_map([&current.document_id], row_to_segment)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(statement);
        let index = segments
            .iter()
            .position(|segment| segment.id == segment_id)
            .ok_or_else(|| not_found("segment", segment_id))?;
        segments[index].source_text = source_text.to_string();
        let next_revision = current
            .revision
            .checked_add(1)
            .ok_or_else(|| StorageError::InvalidData("segment revision overflow".to_string()))?;
        let updated_at_ms = now_ms();
        for affected in index.saturating_sub(1)..=(index + 1).min(segments.len() - 1) {
            let previous = affected
                .checked_sub(1)
                .and_then(|position| segments.get(position))
                .map(|segment| segment.source_text.as_str());
            let next = segments
                .get(affected + 1)
                .map(|segment| segment.source_text.as_str());
            let (source_hash, context_hash) =
                segment_hashes(&segments[affected].source_text, previous, next);
            if affected == index {
                let changed = transaction.execute(
                    "UPDATE segments
                     SET source_text = ?1, source_hash = ?2, context_hash = ?3,
                         revision = ?4, updated_at_ms = ?5
                     WHERE id = ?6 AND revision = ?7",
                    params![
                        source_text,
                        source_hash,
                        context_hash,
                        to_i64(next_revision)?,
                        updated_at_ms,
                        segment_id,
                        to_i64(expected_revision)?,
                    ],
                )?;
                if changed != 1 {
                    let actual = find_segment(&transaction, segment_id)?.revision;
                    return Err(StorageError::Conflict {
                        segment_id: segment_id.to_string(),
                        expected_revision,
                        actual_revision: actual,
                    });
                }
            } else {
                transaction.execute(
                    "UPDATE segments SET context_hash = ?1 WHERE id = ?2",
                    params![context_hash, segments[affected].id],
                )?;
            }
        }
        let updated = find_segment(&transaction, segment_id)?;
        let project_id = project_id_for_segment(&transaction, segment_id)?;
        append_operation(
            &transaction,
            &project_id,
            "segment",
            segment_id,
            "pdf.correct_ocr",
            Some(current.revision),
            Some(updated.revision),
            LEGACY_DESKTOP_ACTOR,
            None,
            Some(serde_json::to_value(&current)?),
            Some(serde_json::json!({
                "segment": updated,
                "reason": reason,
            })),
        )?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn confirm_segment(
        &mut self,
        segment_id: &str,
        expected_revision: u64,
    ) -> Result<Confirmation> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut segment = find_segment(&transaction, segment_id)?;
        let before = segment.clone();
        ensure_revision(&segment, expected_revision)?;
        if segment.target_text.trim().is_empty() {
            return Err(StorageError::InvalidState(
                "an empty target cannot be confirmed".to_string(),
            ));
        }

        let now = now_ms();
        let next_revision = segment
            .revision
            .checked_add(1)
            .ok_or_else(|| StorageError::InvalidData("segment revision overflow".to_string()))?;
        transaction.execute(
            "UPDATE segments
             SET state = 'confirmed', revision = ?1, updated_at_ms = ?2
             WHERE id = ?3 AND revision = ?4",
            params![
                to_i64(next_revision)?,
                now,
                segment_id,
                to_i64(expected_revision)?,
            ],
        )?;
        segment = find_segment(&transaction, segment_id)?;

        let (project_id, memory_id) = transaction.query_row(
            "SELECT d.project_id, tm.id
             FROM documents d
             JOIN translation_memories tm ON tm.project_id = d.project_id AND tm.writable = 1
             WHERE d.id = ?1",
            [&segment.document_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;
        let tm_entry = upsert_tm_entry(&transaction, &segment, &project_id, &memory_id, now)?;
        sink_segment_to_asset_libraries(&transaction, &segment, &project_id, now)?;
        let mut qa_issues = reconcile_number_qa(&transaction, &segment, now)?;
        qa_issues.extend(reconcile_forbidden_term_qa(
            &transaction,
            &segment,
            &project_id,
            now,
        )?);
        let counts = counts_for_document(&transaction, &segment.document_id)?;
        append_operation(
            &transaction,
            &project_id,
            "segment",
            segment_id,
            "segment.confirm",
            Some(before.revision),
            Some(segment.revision),
            LEGACY_DESKTOP_ACTOR,
            None,
            Some(serde_json::to_value(&before)?),
            Some(serde_json::to_value(&segment)?),
        )?;
        transaction.commit()?;

        Ok(Confirmation {
            segment,
            counts,
            tm_entry,
            qa_issues,
        })
    }

    pub fn lookup_exact(&self, project_id: &str, source_text: &str) -> Result<Vec<TmEntry>> {
        ensure_exists(&self.connection, "projects", "project", project_id)?;
        let source_hash = translunar_domain::sha256_hex(normalize_text(source_text).as_bytes());
        let mut statement = self.connection.prepare(
            "SELECT e.id, e.memory_id, e.source_text, e.target_text, e.source_hash,
                    e.origin_project_id, e.origin_document_id, e.origin_segment_id,
                    e.confirmed_at_ms
             FROM tm_entries e
             JOIN translation_memories tm ON tm.id = e.memory_id
             WHERE tm.project_id = ?1 AND e.source_hash = ?2
             ORDER BY e.confirmed_at_ms DESC, e.id",
        )?;
        let normalized = normalize_text(source_text);
        let matches = statement
            .query_map(params![project_id, source_hash], row_to_tm_entry)?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|entry| normalize_text(&entry.source_text) == normalized)
            .collect();
        Ok(matches)
    }

    pub fn run_document_qa(&mut self, document_id: &str) -> Result<Vec<QaIssue>> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_exists(&transaction, "documents", "document", document_id)?;
        let segments = query_all_segments(&transaction, document_id)?;
        let now = now_ms();
        for segment in &segments {
            reconcile_number_qa(&transaction, segment, now)?;
            let project_id = project_id_for_segment(&transaction, &segment.id)?;
            reconcile_forbidden_term_qa(&transaction, segment, &project_id, now)?;
        }
        let issues = query_qa_issues(&transaction, document_id, true)?;
        transaction.commit()?;
        Ok(issues)
    }

    pub fn list_qa(&self, document_id: &str, include_resolved: bool) -> Result<Vec<QaIssue>> {
        ensure_exists(&self.connection, "documents", "document", document_id)?;
        query_qa_issues(&self.connection, document_id, include_resolved)
    }

    #[cfg(test)]
    fn connection(&self) -> &Connection {
        &self.connection
    }
}

fn require_nonempty(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(StorageError::InvalidState(format!(
            "{label} must not be empty"
        )))
    } else {
        Ok(())
    }
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

fn page_slice<T>(values: Vec<T>, offset: u32, limit: u32) -> Result<Vec<T>> {
    let offset = usize::try_from(offset)
        .map_err(|_| StorageError::InvalidData("page offset does not fit usize".to_string()))?;
    let limit = usize::try_from(limit)
        .map_err(|_| StorageError::InvalidData("page limit does not fit usize".to_string()))?;
    Ok(values.into_iter().skip(offset).take(limit).collect())
}

fn ensure_unique_units(units: &[ImportedUnit]) -> Result<()> {
    let mut ordinals = std::collections::HashSet::new();
    let mut paths = std::collections::HashSet::new();
    for unit in units {
        require_nonempty("structural path", &unit.structural_path)?;
        require_nonempty("source text", &unit.source_text)?;
        if !ordinals.insert(unit.ordinal) {
            return Err(StorageError::InvalidState(format!(
                "duplicate document unit ordinal {}",
                unit.ordinal
            )));
        }
        if !paths.insert(&unit.structural_path) {
            return Err(StorageError::InvalidState(format!(
                "duplicate document structural path {}",
                unit.structural_path
            )));
        }
    }
    Ok(())
}

fn ensure_exists(
    connection: &Connection,
    table: &'static str,
    entity: &'static str,
    id: &str,
) -> Result<()> {
    let sql = match table {
        "projects" => "SELECT 1 FROM projects WHERE id = ?1",
        "documents" => "SELECT 1 FROM documents WHERE id = ?1",
        "segments" => "SELECT 1 FROM segments WHERE id = ?1",
        _ => {
            return Err(StorageError::InvalidData(format!(
                "unsupported existence table {table}"
            )));
        }
    };
    let found = connection
        .query_row(sql, [id], |_| Ok(()))
        .optional()?
        .is_some();
    if found {
        Ok(())
    } else {
        Err(not_found(entity, id))
    }
}

fn not_found(entity: &'static str, id: &str) -> StorageError {
    StorageError::NotFound {
        entity,
        id: id.to_string(),
    }
}

fn ensure_revision(segment: &Segment, expected_revision: u64) -> Result<()> {
    if segment.revision == expected_revision {
        Ok(())
    } else {
        Err(StorageError::Conflict {
            segment_id: segment.id.clone(),
            expected_revision,
            actual_revision: segment.revision,
        })
    }
}

fn ensure_entity_revision(
    entity: &'static str,
    id: &str,
    actual_revision: u64,
    expected_revision: u64,
) -> Result<()> {
    if actual_revision == expected_revision {
        Ok(())
    } else {
        Err(StorageError::EntityConflict {
            entity,
            id: id.to_string(),
            expected_revision,
            actual_revision,
        })
    }
}

fn next_revision(current: u64) -> Result<u64> {
    current
        .checked_add(1)
        .ok_or_else(|| StorageError::InvalidData("revision overflow".to_string()))
}

fn find_project(connection: &Connection, project_id: &str) -> Result<Project> {
    connection
        .query_row(
            "SELECT id, name, source_locale, target_locale, domain, lifecycle, revision,
                    configuration_json, created_at_ms, updated_at_ms, archived_at_ms
             FROM projects WHERE id = ?1",
            [project_id],
            row_to_project,
        )
        .optional()?
        .ok_or_else(|| not_found("project", project_id))
}

fn find_tm_library(connection: &Connection, library_id: &str) -> Result<TmLibrary> {
    connection
        .query_row(
            "SELECT id, name, source_locale, target_locale, domain, writable,
                    revision, created_at_ms, updated_at_ms
             FROM tm_libraries WHERE id = ?1",
            [library_id],
            row_to_tm_library,
        )
        .optional()?
        .ok_or_else(|| not_found("tm_library", library_id))
}

fn find_tm_library_mount_optional(
    connection: &Connection,
    project_id: &str,
    library_id: &str,
) -> Result<Option<TmLibraryMount>> {
    connection
        .query_row(
            "SELECT project_id, library_id, mode, priority, enabled, revision,
                    created_at_ms, updated_at_ms
             FROM tm_library_mounts WHERE project_id = ?1 AND library_id = ?2",
            params![project_id, library_id],
            row_to_tm_library_mount,
        )
        .optional()
        .map_err(Into::into)
}

fn find_tm_library_mount(
    connection: &Connection,
    project_id: &str,
    library_id: &str,
) -> Result<TmLibraryMount> {
    find_tm_library_mount_optional(connection, project_id, library_id)?
        .ok_or_else(|| not_found("tm_library_mount", library_id))
}

fn find_termbase(connection: &Connection, termbase_id: &str) -> Result<Termbase> {
    connection
        .query_row(
            "SELECT id, name, source_locale, domain, writable, revision,
                    created_at_ms, updated_at_ms
             FROM termbases WHERE id = ?1",
            [termbase_id],
            row_to_termbase,
        )
        .optional()?
        .ok_or_else(|| not_found("termbase", termbase_id))
}

fn find_termbase_mount_optional(
    connection: &Connection,
    project_id: &str,
    termbase_id: &str,
) -> Result<Option<TermbaseMount>> {
    connection
        .query_row(
            "SELECT project_id, termbase_id, priority, writable, enabled, revision,
                    created_at_ms, updated_at_ms
             FROM termbase_mounts WHERE project_id = ?1 AND termbase_id = ?2",
            params![project_id, termbase_id],
            row_to_termbase_mount,
        )
        .optional()
        .map_err(Into::into)
}

fn find_termbase_mount(
    connection: &Connection,
    project_id: &str,
    termbase_id: &str,
) -> Result<TermbaseMount> {
    find_termbase_mount_optional(connection, project_id, termbase_id)?
        .ok_or_else(|| not_found("termbase_mount", termbase_id))
}

fn find_term_entry(connection: &Connection, entry_id: &str) -> Result<TermEntry> {
    let mut entry = connection
        .query_row(
            "SELECT id, termbase_id, source_locale, source_term, part_of_speech,
                    definition, example, domain, status, revision, created_at_ms,
                    updated_at_ms
             FROM term_entries WHERE id = ?1",
            [entry_id],
            row_to_term_entry,
        )
        .optional()?
        .ok_or_else(|| not_found("term_entry", entry_id))?;
    let mut statement = connection.prepare(
        "SELECT id, entry_id, locale, term, preferred, forbidden,
                created_at_ms, updated_at_ms
         FROM term_translations WHERE entry_id = ?1
         ORDER BY locale, preferred DESC, forbidden DESC, term_key, id",
    )?;
    entry.translations = statement
        .query_map([entry_id], row_to_term_translation)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(entry)
}

fn upsert_term_entry_in_transaction(
    transaction: &Transaction<'_>,
    input: NewTermEntry,
) -> Result<(TermEntry, bool)> {
    require_nonempty("source term", &input.source_term)?;
    if input.translations.is_empty() {
        return Err(StorageError::InvalidState(
            "term entry requires at least one translation".to_string(),
        ));
    }
    let termbase = find_termbase(transaction, &input.termbase_id)?;
    if !termbase.writable {
        return Err(StorageError::InvalidState(
            "termbase is read-only".to_string(),
        ));
    }
    if input.source_locale != termbase.source_locale {
        return Err(StorageError::InvalidState(
            "term source locale does not match termbase".to_string(),
        ));
    }
    let source_key = normalize_match_key(&input.source_term);
    let now = now_ms();
    let existing_id = transaction
        .query_row(
            "SELECT id FROM term_entries WHERE termbase_id = ?1 AND source_key = ?2",
            params![input.termbase_id, source_key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let is_existing = existing_id.is_some();
    let entry_id = existing_id.unwrap_or_else(new_id);
    if is_existing {
        transaction.execute(
            "UPDATE term_entries SET source_term = ?1, part_of_speech = ?2,
                    definition = ?3, example = ?4, domain = ?5, status = ?6,
                    revision = revision + 1, updated_at_ms = ?7
             WHERE id = ?8",
            params![
                input.source_term,
                input.part_of_speech,
                input.definition,
                input.example,
                input.domain,
                term_status_text(input.status),
                now,
                entry_id,
            ],
        )?;
        transaction.execute(
            "DELETE FROM term_translations WHERE entry_id = ?1",
            [&entry_id],
        )?;
    } else {
        transaction.execute(
            "INSERT INTO term_entries (
                id, termbase_id, source_locale, source_term, source_key,
                part_of_speech, definition, example, domain, status, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?11)",
            params![
                entry_id,
                input.termbase_id,
                input.source_locale,
                input.source_term,
                source_key,
                input.part_of_speech,
                input.definition,
                input.example,
                input.domain,
                term_status_text(input.status),
                now,
            ],
        )?;
    }
    for translation in input.translations {
        require_nonempty("target locale", &translation.locale)?;
        require_nonempty("target term", &translation.term)?;
        let term_key = normalize_match_key(&translation.term);
        transaction.execute(
            "INSERT INTO term_translations (
                id, entry_id, locale, term, term_key, preferred, forbidden,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                new_id(),
                entry_id,
                translation.locale,
                translation.term,
                term_key,
                translation.preferred,
                translation.forbidden,
                now,
            ],
        )?;
    }
    let result = find_term_entry(transaction, &entry_id)?;
    Ok((result, is_existing))
}

fn project_id_for_segment(connection: &Connection, segment_id: &str) -> Result<String> {
    connection
        .query_row(
            "SELECT d.project_id
             FROM segments s JOIN documents d ON d.id = s.document_id
             WHERE s.id = ?1",
            [segment_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| not_found("segment", segment_id))
}

#[allow(clippy::too_many_arguments)]
fn append_operation(
    transaction: &Transaction<'_>,
    project_id: &str,
    entity_type: &str,
    entity_id: &str,
    kind: &str,
    base_revision: Option<u64>,
    result_revision: Option<u64>,
    actor: &str,
    correlation_id: Option<&str>,
    before: Option<Value>,
    after: Option<Value>,
) -> Result<Operation> {
    let sequence = transaction.query_row(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM operations WHERE project_id = ?1",
        [project_id],
        |row| row.get::<_, i64>(0),
    )?;
    let sequence = u64::try_from(sequence)
        .map_err(|_| StorageError::InvalidData("operation sequence overflow".to_string()))?;
    let operation = Operation {
        id: new_id(),
        project_id: project_id.to_string(),
        sequence,
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
        kind: kind.to_string(),
        base_revision,
        result_revision,
        actor: actor.to_string(),
        correlation_id: correlation_id.map(ToOwned::to_owned),
        before,
        after,
        created_at_ms: now_ms(),
    };
    transaction.execute(
        "INSERT INTO operations (
            id, project_id, sequence, entity_type, entity_id, kind,
            base_revision, result_revision, actor, correlation_id,
            before_json, after_json, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            operation.id,
            operation.project_id,
            to_i64(operation.sequence)?,
            operation.entity_type,
            operation.entity_id,
            operation.kind,
            operation.base_revision.map(to_i64).transpose()?,
            operation.result_revision.map(to_i64).transpose()?,
            operation.actor,
            operation.correlation_id,
            operation
                .before
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            operation
                .after
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            operation.created_at_ms,
        ],
    )?;
    Ok(operation)
}

fn find_segment(connection: &Connection, segment_id: &str) -> Result<Segment> {
    connection
        .query_row(
            "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
             FROM segments WHERE id = ?1",
            [segment_id],
            row_to_segment,
        )
        .optional()?
        .ok_or_else(|| not_found("segment", segment_id))
}

fn query_all_segments(connection: &Connection, document_id: &str) -> Result<Vec<Segment>> {
    let mut statement = connection.prepare(
        "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                state, revision, source_hash, context_hash, updated_at_ms
         FROM segments WHERE document_id = ?1 ORDER BY ordinal",
    )?;
    Ok(statement
        .query_map([document_id], row_to_segment)?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

fn upsert_tm_entry(
    transaction: &Transaction<'_>,
    segment: &Segment,
    project_id: &str,
    memory_id: &str,
    confirmed_at_ms: i64,
) -> Result<TmEntry> {
    let existing_id = transaction
        .query_row(
            "SELECT id FROM tm_entries WHERE memory_id = ?1 AND origin_segment_id = ?2",
            params![memory_id, segment.id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let entry_id = existing_id.unwrap_or_else(new_id);
    transaction.execute(
        "INSERT INTO tm_entries (
            id, memory_id, source_text, target_text, source_hash, origin_project_id,
            origin_document_id, origin_segment_id, confirmed_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(memory_id, origin_segment_id) DO UPDATE SET
            source_text = excluded.source_text,
            target_text = excluded.target_text,
            source_hash = excluded.source_hash,
            confirmed_at_ms = excluded.confirmed_at_ms",
        params![
            entry_id,
            memory_id,
            segment.source_text,
            segment.target_text,
            segment.source_hash,
            project_id,
            segment.document_id,
            segment.id,
            confirmed_at_ms,
        ],
    )?;
    transaction
        .query_row(
            "SELECT id, memory_id, source_text, target_text, source_hash, origin_project_id,
                origin_document_id, origin_segment_id, confirmed_at_ms
         FROM tm_entries WHERE memory_id = ?1 AND origin_segment_id = ?2",
            params![memory_id, segment.id],
            row_to_tm_entry,
        )
        .map_err(Into::into)
}

fn sink_segment_to_asset_libraries(
    transaction: &Transaction<'_>,
    segment: &Segment,
    project_id: &str,
    now: i64,
) -> Result<()> {
    let previous = if segment.ordinal == 0 {
        None
    } else {
        transaction
            .query_row(
                "SELECT source_text FROM segments
                 WHERE document_id = ?1 AND ordinal = ?2",
                params![segment.document_id, i64::from(segment.ordinal - 1)],
                |row| row.get::<_, String>(0),
            )
            .optional()?
    };
    let next = transaction
        .query_row(
            "SELECT source_text FROM segments
             WHERE document_id = ?1 AND ordinal = ?2",
            params![segment.document_id, i64::from(segment.ordinal) + 1],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let context_before_hash = previous
        .as_deref()
        .map(|value| translunar_domain::sha256_hex(normalize_match_key(value).as_bytes()));
    let context_after_hash = next
        .as_deref()
        .map(|value| translunar_domain::sha256_hex(normalize_match_key(value).as_bytes()));
    let mounts = {
        let mut statement = transaction.prepare(
            "SELECT m.library_id, l.source_locale, l.target_locale, l.domain
             FROM tm_library_mounts m JOIN tm_libraries l ON l.id = m.library_id
             WHERE m.project_id = ?1 AND m.enabled = 1 AND m.mode = 'write'
                   AND l.writable = 1
             ORDER BY m.priority, m.library_id",
        )?;
        statement
            .query_map([project_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    let source_key = exact_key(&segment.source_text);
    let source_hash =
        translunar_domain::sha256_hex(normalize_match_key(&segment.source_text).as_bytes());
    let target_hash =
        translunar_domain::sha256_hex(normalize_match_key(&segment.target_text).as_bytes());
    let mut metadata = BTreeMap::new();
    metadata.insert("segmentState".to_string(), format!("{:?}", segment.state));
    for (library_id, source_locale, target_locale, domain) in mounts {
        let existing_id = transaction
            .query_row(
                "SELECT id FROM tm_units
                 WHERE library_id = ?1 AND origin_project_id = ?2
                   AND origin_document_id = ?3 AND origin_segment_id = ?4",
                params![library_id, project_id, segment.document_id, segment.id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let metadata_json = serde_json::to_string(&metadata)?;
        if let Some(existing_id) = existing_id {
            transaction.execute(
                "UPDATE tm_units SET source_locale = ?1, target_locale = ?2,
                        source_text = ?3, target_text = ?4, source_hash = ?5,
                        source_key = ?6, target_hash = ?7, domain = ?8,
                        context_before_hash = ?9, context_after_hash = ?10,
                        metadata_json = ?11, updated_at_ms = ?12
                 WHERE id = ?13",
                params![
                    source_locale,
                    target_locale,
                    segment.source_text,
                    segment.target_text,
                    source_hash,
                    source_key,
                    target_hash,
                    domain,
                    context_before_hash,
                    context_after_hash,
                    metadata_json,
                    now,
                    existing_id,
                ],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO tm_units (
                    id, library_id, source_locale, target_locale, source_text,
                    target_text, source_hash, source_key, target_hash, domain,
                    origin_project_id, origin_document_id, origin_segment_id,
                    context_before_hash, context_after_hash, author, metadata_json,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                           ?11, ?12, ?13, ?14, ?15, NULL, ?16, ?17, ?17)",
                params![
                    new_id(),
                    library_id,
                    source_locale,
                    target_locale,
                    segment.source_text,
                    segment.target_text,
                    source_hash,
                    source_key,
                    target_hash,
                    domain,
                    project_id,
                    segment.document_id,
                    segment.id,
                    context_before_hash,
                    context_after_hash,
                    metadata_json,
                    now,
                ],
            )?;
        }
    }
    Ok(())
}

fn reconcile_forbidden_term_qa(
    transaction: &Transaction<'_>,
    segment: &Segment,
    project_id: &str,
    now: i64,
) -> Result<Vec<QaIssue>> {
    transaction.execute(
        "UPDATE qa_issues SET status = 'resolved', updated_at_ms = ?1
         WHERE segment_id = ?2 AND rule_id LIKE 'term-forbidden:%' AND status = 'open'",
        params![now, segment.id],
    )?;
    let forbidden = {
        let mut statement = transaction.prepare(
            "SELECT tt.id, tt.term FROM termbase_mounts m
             JOIN projects p ON p.id = m.project_id
             JOIN term_entries e ON e.termbase_id = m.termbase_id
             JOIN term_translations tt ON tt.entry_id = e.id
             WHERE m.project_id = ?1 AND m.enabled = 1
                   AND e.status = 'active' AND tt.forbidden = 1
                   AND tt.locale = p.target_locale
             ORDER BY m.priority, tt.id",
        )?;
        statement
            .query_map([project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    for (translation_id, term) in forbidden {
        if term_spans(&segment.target_text, &term).is_empty() {
            continue;
        }
        let rule_id = format!("term-forbidden:{translation_id}");
        let evidence = NumberEvidence {
            source_numbers: Vec::new(),
            target_numbers: vec![term.clone()],
        };
        let fingerprint = translunar_domain::sha256_hex(
            format!("{rule_id}\0{}", normalize_match_key(&segment.target_text)).as_bytes(),
        );
        transaction.execute(
            "INSERT INTO qa_issues (
                id, segment_id, rule_id, severity, status, message, fingerprint,
                evidence_json, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, 'error', 'open', ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(segment_id, rule_id, fingerprint) DO UPDATE SET
                status = 'open', message = excluded.message,
                evidence_json = excluded.evidence_json, updated_at_ms = excluded.updated_at_ms",
            params![
                new_id(),
                segment.id,
                rule_id,
                format!("Forbidden term used in target: {term}"),
                fingerprint,
                serde_json::to_string(&evidence)?,
                now,
            ],
        )?;
    }
    let mut statement = transaction.prepare(
        "SELECT id, segment_id, rule_id, severity, status, message,
                fingerprint, evidence_json, created_at_ms, updated_at_ms
         FROM qa_issues WHERE segment_id = ?1 AND rule_id LIKE 'term-forbidden:%'
         ORDER BY rule_id, id",
    )?;
    Ok(statement
        .query_map([segment.id.as_str()], row_to_qa_issue)?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

fn reconcile_number_qa(
    transaction: &Transaction<'_>,
    segment: &Segment,
    now: i64,
) -> Result<Vec<QaIssue>> {
    let mismatch = if segment.target_text.trim().is_empty() {
        None
    } else {
        number_mismatch(&segment.source_text, &segment.target_text)
    };

    match mismatch {
        Some(evidence) => {
            let fingerprint = number_issue_fingerprint(&segment.id, &evidence);
            transaction.execute(
                "UPDATE qa_issues SET status = 'resolved', updated_at_ms = ?1
                 WHERE segment_id = ?2 AND rule_id = ?3 AND status = 'open'
                   AND fingerprint <> ?4",
                params![now, segment.id, NUMBER_RULE_ID, fingerprint],
            )?;
            let evidence_json = serde_json::to_string(&evidence)?;
            let existing_id = transaction
                .query_row(
                    "SELECT id FROM qa_issues
                     WHERE segment_id = ?1 AND rule_id = ?2 AND fingerprint = ?3",
                    params![segment.id, NUMBER_RULE_ID, fingerprint],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let issue_id = existing_id.unwrap_or_else(new_id);
            transaction.execute(
                "INSERT INTO qa_issues (
                    id, segment_id, rule_id, severity, status, message, fingerprint,
                    evidence_json, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, 'warning', 'open', ?4, ?5, ?6, ?7, ?7)
                 ON CONFLICT(segment_id, rule_id, fingerprint) DO UPDATE SET
                    severity = 'warning',
                    status = 'open',
                    message = excluded.message,
                    evidence_json = excluded.evidence_json,
                    updated_at_ms = excluded.updated_at_ms",
                params![
                    issue_id,
                    segment.id,
                    NUMBER_RULE_ID,
                    NUMBER_RULE_MESSAGE,
                    fingerprint,
                    evidence_json,
                    now,
                ],
            )?;
        }
        None => {
            transaction.execute(
                "UPDATE qa_issues SET status = 'resolved', updated_at_ms = ?1
                 WHERE segment_id = ?2 AND rule_id = ?3 AND status = 'open'",
                params![now, segment.id, NUMBER_RULE_ID],
            )?;
        }
    }

    query_segment_open_qa(transaction, &segment.id)
}

fn query_segment_open_qa(connection: &Connection, segment_id: &str) -> Result<Vec<QaIssue>> {
    let mut statement = connection.prepare(
        "SELECT id, segment_id, rule_id, severity, status, message, fingerprint,
                evidence_json, created_at_ms, updated_at_ms
         FROM qa_issues WHERE segment_id = ?1 AND status = 'open'
         ORDER BY created_at_ms, id",
    )?;
    Ok(statement
        .query_map([segment_id], row_to_qa_issue)?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

fn query_qa_issues(
    connection: &Connection,
    document_id: &str,
    include_resolved: bool,
) -> Result<Vec<QaIssue>> {
    let mut statement = connection.prepare(
        "SELECT q.id, q.segment_id, q.rule_id, q.severity, q.status, q.message,
                q.fingerprint, q.evidence_json, q.created_at_ms, q.updated_at_ms
         FROM qa_issues q
         JOIN segments s ON s.id = q.segment_id
         WHERE s.document_id = ?1 AND (?2 = 1 OR q.status = 'open')
         ORDER BY s.ordinal, q.created_at_ms, q.id",
    )?;
    Ok(statement
        .query_map(params![document_id, include_resolved], row_to_qa_issue)?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

fn find_pipeline_definition(
    connection: &Connection,
    definition_id: &str,
) -> Result<PipelineDefinition> {
    let mut definition = connection
        .query_row(
            "SELECT id, project_id, name, version, revision, created_at_ms, updated_at_ms
             FROM pipeline_definitions WHERE id = ?1",
            [definition_id],
            |row| {
                Ok(PipelineDefinition {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                    version: read_u32(row, 3)?,
                    revision: read_u64(row, 4)?,
                    steps: Vec::new(),
                    created_at_ms: row.get(5)?,
                    updated_at_ms: row.get(6)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("pipeline_definition", definition_id))?;
    let mut statement = connection.prepare(
        "SELECT step_key, step_id, config_json FROM pipeline_steps
         WHERE definition_id = ?1 ORDER BY step_index",
    )?;
    definition.steps = statement
        .query_map([definition_id], |row| {
            Ok(PipelineStepDefinition {
                key: row.get(0)?,
                step_id: row.get(1)?,
                config: serde_json::from_str::<Value>(&row.get::<_, String>(2)?)
                    .map_err(|error| conversion_error(2, error))?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(definition)
}

fn find_pipeline_run(connection: &Connection, run_id: &str) -> Result<PipelineRun> {
    connection
        .query_row(
            "SELECT id, definition_id, project_id, document_id, status, revision,
                    current_step_index, step_count, cancellation_requested, input_json,
                    output_json, error_json, created_at_ms, started_at_ms,
                    completed_at_ms, updated_at_ms
             FROM pipeline_runs WHERE id = ?1",
            [run_id],
            row_to_pipeline_run,
        )
        .optional()?
        .ok_or_else(|| not_found("pipeline_run", run_id))
}

fn find_pipeline_step_run(
    connection: &Connection,
    run_id: &str,
    step_index: u32,
) -> Result<PipelineStepRun> {
    connection
        .query_row(
            "SELECT id, run_id, step_key, step_id, step_index, status, revision,
                    input_json, output_json, checkpoint_json, usage_json, error_json,
                    started_at_ms, completed_at_ms, updated_at_ms
             FROM pipeline_step_runs WHERE run_id = ?1 AND step_index = ?2",
            params![run_id, i64::from(step_index)],
            row_to_pipeline_step_run,
        )
        .optional()?
        .ok_or_else(|| not_found("pipeline_step_run", &format!("{run_id}:{step_index}")))
}

fn row_to_pipeline_run(row: &Row<'_>) -> rusqlite::Result<PipelineRun> {
    Ok(PipelineRun {
        id: row.get(0)?,
        definition_id: row.get(1)?,
        project_id: row.get(2)?,
        document_id: row.get(3)?,
        status: parse_pipeline_run_status(row.get::<_, String>(4)?, 4)?,
        revision: read_u64(row, 5)?,
        current_step_index: read_u32(row, 6)?,
        step_count: read_u32(row, 7)?,
        cancellation_requested: row.get(8)?,
        input: read_json(row, 9)?,
        output: read_optional_json(row, 10)?,
        error: read_optional_json(row, 11)?,
        created_at_ms: row.get(12)?,
        started_at_ms: row.get(13)?,
        completed_at_ms: row.get(14)?,
        updated_at_ms: row.get(15)?,
    })
}

fn row_to_pipeline_step_run(row: &Row<'_>) -> rusqlite::Result<PipelineStepRun> {
    Ok(PipelineStepRun {
        id: row.get(0)?,
        run_id: row.get(1)?,
        step_key: row.get(2)?,
        step_id: row.get(3)?,
        step_index: read_u32(row, 4)?,
        status: parse_pipeline_step_status(row.get::<_, String>(5)?, 5)?,
        revision: read_u64(row, 6)?,
        input: read_optional_json(row, 7)?,
        output: read_optional_json(row, 8)?,
        checkpoint: read_optional_json(row, 9)?,
        usage: read_optional_json(row, 10)?,
        error: read_optional_json(row, 11)?,
        started_at_ms: row.get(12)?,
        completed_at_ms: row.get(13)?,
        updated_at_ms: row.get(14)?,
    })
}

fn parse_pipeline_run_status(value: String, column: usize) -> rusqlite::Result<PipelineRunStatus> {
    match value.as_str() {
        "queued" => Ok(PipelineRunStatus::Queued),
        "running" => Ok(PipelineRunStatus::Running),
        "canceling" => Ok(PipelineRunStatus::Canceling),
        "canceled" => Ok(PipelineRunStatus::Canceled),
        "interrupted" => Ok(PipelineRunStatus::Interrupted),
        "succeeded" => Ok(PipelineRunStatus::Succeeded),
        "failed" => Ok(PipelineRunStatus::Failed),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown pipeline run status {value}")),
        )),
    }
}

fn parse_pipeline_step_status(
    value: String,
    column: usize,
) -> rusqlite::Result<PipelineStepStatus> {
    match value.as_str() {
        "pending" => Ok(PipelineStepStatus::Pending),
        "running" => Ok(PipelineStepStatus::Running),
        "canceled" => Ok(PipelineStepStatus::Canceled),
        "interrupted" => Ok(PipelineStepStatus::Interrupted),
        "succeeded" => Ok(PipelineStepStatus::Succeeded),
        "failed" => Ok(PipelineStepStatus::Failed),
        "skipped" => Ok(PipelineStepStatus::Skipped),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown pipeline step status {value}")),
        )),
    }
}

fn interrupt_orphaned_pipeline_runs(connection: &mut Connection) -> Result<()> {
    let now = now_ms();
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute(
        "UPDATE pipeline_step_runs
         SET status = 'interrupted', revision = revision + 1, updated_at_ms = ?1
         WHERE status = 'running'",
        [now],
    )?;
    transaction.execute(
        "UPDATE pipeline_runs
         SET status = 'interrupted', revision = revision + 1, updated_at_ms = ?1
         WHERE status IN ('running', 'canceling')",
        [now],
    )?;
    transaction.commit()?;
    Ok(())
}

fn normalize_managed_source_paths(connection: &mut Connection, paths: &DataPaths) -> Result<()> {
    let rows = {
        let mut statement = connection.prepare(
            "SELECT 'documents', id, managed_source_path FROM documents
             UNION ALL
             SELECT 'document_versions', id, managed_source_path FROM document_versions",
        )?;
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    let updates = rows
        .into_iter()
        .filter_map(|(table, id, stored)| {
            let normalized = stored_managed_source_path(paths, Path::new(&stored));
            (normalized != stored).then_some((table, id, normalized))
        })
        .collect::<Vec<_>>();
    if updates.is_empty() {
        return Ok(());
    }

    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for (table, id, path) in updates {
        let sql = match table.as_str() {
            "documents" => "UPDATE documents SET managed_source_path = ?1 WHERE id = ?2",
            "document_versions" => {
                "UPDATE document_versions SET managed_source_path = ?1 WHERE id = ?2"
            }
            _ => {
                return Err(StorageError::InvalidData(format!(
                    "unsupported managed path table {table}"
                )));
            }
        };
        transaction.execute(sql, params![path, id])?;
    }
    transaction.commit()?;
    Ok(())
}

fn backfill_asset_keys(connection: &mut Connection) -> Result<()> {
    let rows = {
        let mut statement = connection.prepare(
            "SELECT id, source_text, target_text, source_key, target_hash FROM tm_units",
        )?;
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    let updates =
        rows.into_iter()
            .filter_map(|(id, source, target, source_key, target_hash)| {
                let normalized_source = exact_key(&source);
                let normalized_target_hash =
                    translunar_domain::sha256_hex(normalize_match_key(&target).as_bytes());
                (source_key != normalized_source || target_hash != normalized_target_hash)
                    .then_some((id, normalized_source, normalized_target_hash))
            })
            .collect::<Vec<_>>();
    if updates.is_empty() {
        return Ok(());
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for (id, source_key, target_hash) in updates {
        transaction.execute(
            "UPDATE tm_units SET source_key = ?1, target_hash = ?2 WHERE id = ?3",
            params![source_key, target_hash, id],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

fn ensure_default_termbases(connection: &mut Connection) -> Result<()> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let projects = {
        let mut statement = transaction.prepare(
            "SELECT p.id, p.name, p.source_locale, p.domain, p.created_at_ms
             FROM projects p
             WHERE NOT EXISTS (
                SELECT 1 FROM termbase_mounts m WHERE m.project_id = p.id
             )
             ORDER BY p.created_at_ms, p.id",
        )?;
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    for (project_id, project_name, source_locale, domain, created_at_ms) in projects {
        let termbase_id = new_id();
        transaction.execute(
            "INSERT INTO termbases (
                id, name, source_locale, domain, writable, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, 1, 0, ?5, ?5)",
            params![
                termbase_id,
                format!("{project_name} Termbase"),
                source_locale,
                domain,
                created_at_ms,
            ],
        )?;
        transaction.execute(
            "INSERT INTO termbase_mounts (
                project_id, termbase_id, priority, writable, enabled, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 0, 1, 1, 0, ?3, ?3)",
            params![project_id, termbase_id, created_at_ms],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

fn create_data_backup(
    connection: &Connection,
    paths: &DataPaths,
    destination: &Path,
) -> Result<BackupManifest> {
    if destination.exists() {
        return Err(StorageError::InvalidState(format!(
            "backup destination already exists: {}",
            destination.display()
        )));
    }
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| {
            StorageError::InvalidState(
                "backup destination must have a parent directory".to_string(),
            )
        })?;
    fs::create_dir_all(parent)?;
    let staging = parent.join(format!(".translunar-backup-{}.staging", new_id()));
    fs::create_dir(&staging)?;
    let result = (|| -> Result<BackupManifest> {
        let database_path = staging.join("translunar.sqlite3");
        connection.backup("main", &database_path, None)?;
        File::open(&database_path)?.sync_all()?;
        copy_directory_contents(&paths.sources, &staging.join("sources"))?;
        copy_directory_contents(&paths.exports, &staging.join("exports"))?;

        let mut files = collect_backup_files(&staging, &staging)?;
        files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let schema_version =
            connection.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))?;
        let manifest = BackupManifest {
            format_version: 1,
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            schema_version,
            created_at_ms: now_ms(),
            files,
        };
        let manifest_path = staging.join("manifest.json");
        let manifest_file = File::create(&manifest_path)?;
        serde_json::to_writer_pretty(&manifest_file, &manifest)?;
        manifest_file.sync_all()?;
        fs::rename(&staging, destination)?;
        Ok(manifest)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn copy_directory_contents(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if file_type.is_symlink() {
            return Err(StorageError::InvalidState(format!(
                "managed data contains an unsupported symbolic link: {}",
                entry.path().display()
            )));
        }
        if file_type.is_dir() {
            copy_directory_contents(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)?;
            File::open(&target)?.sync_all()?;
        }
    }
    Ok(())
}

fn collect_backup_files(root: &Path, directory: &Path) -> Result<Vec<BackupFile>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            files.extend(collect_backup_files(root, &entry.path())?);
        } else if file_type.is_file() {
            let path = entry.path();
            let relative = path.strip_prefix(root).map_err(|_| {
                StorageError::InvalidState("backup path escaped its staging root".to_string())
            })?;
            let relative_path = relative
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            files.push(BackupFile {
                relative_path,
                size: fs::metadata(&path)?.len(),
                sha256: sha256_file(&path)?,
            });
        }
    }
    Ok(files)
}

fn create_pre_migration_backup(
    connection: &Connection,
    paths: &DataPaths,
    current_version: u32,
) -> Result<PathBuf> {
    let created_at_ms = now_ms();
    let name = format!(
        "pre-migration-v{current_version}-to-v{LATEST_SCHEMA_VERSION}-{created_at_ms}-{}",
        new_id()
    );
    let staging = paths.temporary.join(format!("{name}.staging"));
    let destination = paths.backups.join(name);
    fs::create_dir_all(&staging)?;

    let result = (|| -> Result<()> {
        let database_path = staging.join("translunar.sqlite3");
        connection.backup("main", &database_path, None)?;
        File::open(&database_path)?.sync_all()?;

        let database_metadata = fs::metadata(&database_path)?;
        let manifest = BackupManifest {
            format_version: 1,
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            schema_version: current_version,
            created_at_ms,
            files: vec![BackupFile {
                relative_path: "translunar.sqlite3".to_string(),
                size: database_metadata.len(),
                sha256: sha256_file(&database_path)?,
            }],
        };
        let manifest_path = staging.join("manifest.json");
        let manifest_file = File::create(&manifest_path)?;
        serde_json::to_writer_pretty(&manifest_file, &manifest)?;
        manifest_file.sync_all()?;

        fs::rename(&staging, &destination)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result?;
    Ok(destination)
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn counts_for_project(connection: &Connection, project_id: &str) -> Result<SegmentCounts> {
    counts_for_scope(
        connection,
        "SELECT
            COUNT(*),
            COALESCE(SUM(CASE WHEN s.state = 'untranslated' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN s.state = 'draft' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN s.state = 'confirmed' THEN 1 ELSE 0 END), 0)
         FROM segments s JOIN documents d ON d.id = s.document_id
         WHERE d.project_id = ?1",
        "SELECT COUNT(*) FROM qa_issues q
         JOIN segments s ON s.id = q.segment_id
         JOIN documents d ON d.id = s.document_id
         WHERE d.project_id = ?1 AND q.status = 'open'",
        project_id,
    )
}

fn counts_for_document(connection: &Connection, document_id: &str) -> Result<SegmentCounts> {
    counts_for_scope(
        connection,
        "SELECT
            COUNT(*),
            COALESCE(SUM(CASE WHEN state = 'untranslated' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN state = 'draft' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN state = 'confirmed' THEN 1 ELSE 0 END), 0)
         FROM segments WHERE document_id = ?1",
        "SELECT COUNT(*) FROM qa_issues q
         JOIN segments s ON s.id = q.segment_id
         WHERE s.document_id = ?1 AND q.status = 'open'",
        document_id,
    )
}

fn counts_for_scope(
    connection: &Connection,
    segment_sql: &str,
    issue_sql: &str,
    id: &str,
) -> Result<SegmentCounts> {
    let values = connection.query_row(segment_sql, [id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    let open_issues = connection.query_row(issue_sql, [id], |row| row.get::<_, i64>(0))?;
    Ok(SegmentCounts {
        total: to_u32(values.0)?,
        untranslated: to_u32(values.1)?,
        draft: to_u32(values.2)?,
        confirmed: to_u32(values.3)?,
        open_issues: to_u32(open_issues)?,
    })
}

fn row_to_operation(row: &Row<'_>) -> rusqlite::Result<Operation> {
    Ok(Operation {
        id: row.get(0)?,
        project_id: row.get(1)?,
        sequence: read_u64(row, 2)?,
        entity_type: row.get(3)?,
        entity_id: row.get(4)?,
        kind: row.get(5)?,
        base_revision: read_optional_u64(row, 6)?,
        result_revision: read_optional_u64(row, 7)?,
        actor: row.get(8)?,
        correlation_id: row.get(9)?,
        before: read_optional_json(row, 10)?,
        after: read_optional_json(row, 11)?,
        created_at_ms: row.get(12)?,
    })
}

fn row_to_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        source_locale: row.get(2)?,
        target_locale: row.get(3)?,
        domain: row.get(4)?,
        lifecycle: parse_project_lifecycle(row.get::<_, String>(5)?, 5)?,
        revision: read_u64(row, 6)?,
        configuration: read_json(row, 7)?,
        created_at_ms: row.get(8)?,
        updated_at_ms: row.get(9)?,
        archived_at_ms: row.get(10)?,
    })
}

fn row_to_document(row: &Row<'_>) -> rusqlite::Result<Document> {
    Ok(Document {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        relative_path: row.get(3)?,
        format: row.get(4)?,
        filter_id: row.get(5)?,
        source_sha256: row.get(6)?,
        current_version: read_u32(row, 7)?,
        status: parse_document_status(row.get::<_, String>(8)?, 8)?,
        revision: read_u64(row, 9)?,
        segment_count: read_u32(row, 10)?,
        degradation: read_json(row, 11)?,
        imported_at_ms: row.get(12)?,
        updated_at_ms: row.get(13)?,
    })
}

fn row_to_managed_document(row: &Row<'_>) -> rusqlite::Result<ManagedDocument> {
    Ok(ManagedDocument {
        document: Document {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
            relative_path: row.get(3)?,
            format: row.get(4)?,
            filter_id: row.get(5)?,
            source_sha256: row.get(6)?,
            current_version: read_u32(row, 7)?,
            status: parse_document_status(row.get::<_, String>(8)?, 8)?,
            revision: read_u64(row, 9)?,
            segment_count: read_u32(row, 10)?,
            degradation: read_json(row, 11)?,
            imported_at_ms: row.get(12)?,
            updated_at_ms: row.get(13)?,
        },
        original_source_path: PathBuf::from(row.get::<_, String>(14)?),
        managed_source_path: PathBuf::from(row.get::<_, String>(15)?),
    })
}

fn row_to_segment(row: &Row<'_>) -> rusqlite::Result<Segment> {
    Ok(Segment {
        id: row.get(0)?,
        document_id: row.get(1)?,
        ordinal: read_u32(row, 2)?,
        structural_path: row.get(3)?,
        source_text: row.get(4)?,
        target_text: row.get(5)?,
        state: parse_segment_state(row.get::<_, String>(6)?, 6)?,
        revision: read_u64(row, 7)?,
        source_hash: row.get(8)?,
        context_hash: row.get(9)?,
        updated_at_ms: row.get(10)?,
    })
}

fn row_to_tm_entry(row: &Row<'_>) -> rusqlite::Result<TmEntry> {
    Ok(TmEntry {
        id: row.get(0)?,
        memory_id: row.get(1)?,
        source_text: row.get(2)?,
        target_text: row.get(3)?,
        source_hash: row.get(4)?,
        origin_project_id: row.get(5)?,
        origin_document_id: row.get(6)?,
        origin_segment_id: row.get(7)?,
        confirmed_at_ms: row.get(8)?,
    })
}

fn row_to_tm_library(row: &Row<'_>) -> rusqlite::Result<TmLibrary> {
    Ok(TmLibrary {
        id: row.get(0)?,
        name: row.get(1)?,
        source_locale: row.get(2)?,
        target_locale: row.get(3)?,
        domain: row.get(4)?,
        writable: row.get(5)?,
        revision: read_u64(row, 6)?,
        created_at_ms: row.get(7)?,
        updated_at_ms: row.get(8)?,
    })
}

fn row_to_tm_library_mount(row: &Row<'_>) -> rusqlite::Result<TmLibraryMount> {
    Ok(TmLibraryMount {
        project_id: row.get(0)?,
        library_id: row.get(1)?,
        mode: parse_asset_mount_mode(row.get::<_, String>(2)?, 2)?,
        priority: read_u32(row, 3)?,
        enabled: row.get(4)?,
        revision: read_u64(row, 5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn row_to_tm_unit(row: &Row<'_>) -> rusqlite::Result<TmUnit> {
    Ok(TmUnit {
        id: row.get(0)?,
        library_id: row.get(1)?,
        source_locale: row.get(2)?,
        target_locale: row.get(3)?,
        source_text: row.get(4)?,
        target_text: row.get(5)?,
        source_hash: row.get(6)?,
        target_hash: row.get(7)?,
        domain: row.get(8)?,
        origin_project_id: row.get(9)?,
        origin_document_id: row.get(10)?,
        origin_segment_id: row.get(11)?,
        context_before_hash: row.get(12)?,
        context_after_hash: row.get(13)?,
        author: row.get(14)?,
        metadata: read_json(row, 15)?,
        created_at_ms: row.get(16)?,
        updated_at_ms: row.get(17)?,
    })
}

fn row_to_termbase(row: &Row<'_>) -> rusqlite::Result<Termbase> {
    Ok(Termbase {
        id: row.get(0)?,
        name: row.get(1)?,
        source_locale: row.get(2)?,
        domain: row.get(3)?,
        writable: row.get(4)?,
        revision: read_u64(row, 5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn row_to_termbase_mount(row: &Row<'_>) -> rusqlite::Result<TermbaseMount> {
    Ok(TermbaseMount {
        project_id: row.get(0)?,
        termbase_id: row.get(1)?,
        priority: read_u32(row, 2)?,
        writable: row.get(3)?,
        enabled: row.get(4)?,
        revision: read_u64(row, 5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn row_to_term_entry(row: &Row<'_>) -> rusqlite::Result<TermEntry> {
    Ok(TermEntry {
        id: row.get(0)?,
        termbase_id: row.get(1)?,
        source_locale: row.get(2)?,
        source_term: row.get(3)?,
        part_of_speech: row.get(4)?,
        definition: row.get(5)?,
        example: row.get(6)?,
        domain: row.get(7)?,
        status: parse_term_status(row.get::<_, String>(8)?, 8)?,
        revision: read_u64(row, 9)?,
        translations: Vec::new(),
        created_at_ms: row.get(10)?,
        updated_at_ms: row.get(11)?,
    })
}

fn row_to_term_translation(row: &Row<'_>) -> rusqlite::Result<TermTranslation> {
    Ok(TermTranslation {
        id: row.get(0)?,
        entry_id: row.get(1)?,
        locale: row.get(2)?,
        term: row.get(3)?,
        preferred: row.get(4)?,
        forbidden: row.get(5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn row_to_qa_issue(row: &Row<'_>) -> rusqlite::Result<QaIssue> {
    let evidence_json = row.get::<_, String>(7)?;
    let evidence = serde_json::from_str::<NumberEvidence>(&evidence_json)
        .map_err(|error| conversion_error(7, error))?;
    Ok(QaIssue {
        id: row.get(0)?,
        segment_id: row.get(1)?,
        rule_id: row.get(2)?,
        severity: parse_qa_severity(row.get::<_, String>(3)?, 3)?,
        status: parse_qa_status(row.get::<_, String>(4)?, 4)?,
        message: row.get(5)?,
        fingerprint: row.get(6)?,
        evidence,
        created_at_ms: row.get(8)?,
        updated_at_ms: row.get(9)?,
    })
}

fn parse_project_lifecycle(value: String, column: usize) -> rusqlite::Result<ProjectLifecycle> {
    match value.as_str() {
        "active" => Ok(ProjectLifecycle::Active),
        "archived" => Ok(ProjectLifecycle::Archived),
        "trash" => Ok(ProjectLifecycle::Trash),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown project lifecycle {value}")),
        )),
    }
}

fn project_lifecycle_text(lifecycle: ProjectLifecycle) -> &'static str {
    match lifecycle {
        ProjectLifecycle::Active => "active",
        ProjectLifecycle::Archived => "archived",
        ProjectLifecycle::Trash => "trash",
    }
}

fn asset_mount_mode_text(mode: AssetMountMode) -> &'static str {
    match mode {
        AssetMountMode::Write => "write",
        AssetMountMode::Reference => "reference",
    }
}

fn parse_asset_mount_mode(value: String, column: usize) -> rusqlite::Result<AssetMountMode> {
    match value.as_str() {
        "write" => Ok(AssetMountMode::Write),
        "reference" => Ok(AssetMountMode::Reference),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown asset mount mode {value}")),
        )),
    }
}

fn term_status_text(status: TermStatus) -> &'static str {
    match status {
        TermStatus::Candidate => "candidate",
        TermStatus::Active => "active",
        TermStatus::Deprecated => "deprecated",
    }
}

fn parse_term_status(value: String, column: usize) -> rusqlite::Result<TermStatus> {
    match value.as_str() {
        "candidate" => Ok(TermStatus::Candidate),
        "active" => Ok(TermStatus::Active),
        "deprecated" => Ok(TermStatus::Deprecated),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown term status {value}")),
        )),
    }
}

fn parse_document_status(value: String, column: usize) -> rusqlite::Result<DocumentStatus> {
    match value.as_str() {
        "active" => Ok(DocumentStatus::Active),
        "failed" => Ok(DocumentStatus::Failed),
        "superseded" => Ok(DocumentStatus::Superseded),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown document status {value}")),
        )),
    }
}

fn tag_side_text(side: TagSide) -> &'static str {
    match side {
        TagSide::Source => "source",
        TagSide::Target => "target",
    }
}

fn tag_kind_text(kind: TagKind) -> &'static str {
    match kind {
        TagKind::Start => "start",
        TagKind::End => "end",
        TagKind::Standalone => "standalone",
    }
}

fn read_json<T: DeserializeOwned>(row: &Row<'_>, column: usize) -> rusqlite::Result<T> {
    let json = row.get::<_, String>(column)?;
    serde_json::from_str(&json).map_err(|error| conversion_error(column, error))
}

fn read_optional_json<T: DeserializeOwned>(
    row: &Row<'_>,
    column: usize,
) -> rusqlite::Result<Option<T>> {
    let json = row.get::<_, Option<String>>(column)?;
    json.map(|value| serde_json::from_str(&value).map_err(|error| conversion_error(column, error)))
        .transpose()
}

fn segment_state_text(state: SegmentState) -> &'static str {
    match state {
        SegmentState::Untranslated => "untranslated",
        SegmentState::Draft => "draft",
        SegmentState::Confirmed => "confirmed",
    }
}

fn parse_segment_state(value: String, column: usize) -> rusqlite::Result<SegmentState> {
    match value.as_str() {
        "untranslated" => Ok(SegmentState::Untranslated),
        "draft" => Ok(SegmentState::Draft),
        "confirmed" => Ok(SegmentState::Confirmed),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown segment state {value}")),
        )),
    }
}

fn parse_qa_severity(value: String, column: usize) -> rusqlite::Result<QaSeverity> {
    match value.as_str() {
        "error" => Ok(QaSeverity::Error),
        "warning" => Ok(QaSeverity::Warning),
        "info" => Ok(QaSeverity::Info),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown QA severity {value}")),
        )),
    }
}

fn parse_qa_status(value: String, column: usize) -> rusqlite::Result<QaIssueStatus> {
    match value.as_str() {
        "open" => Ok(QaIssueStatus::Open),
        "resolved" => Ok(QaIssueStatus::Resolved),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown QA status {value}")),
        )),
    }
}

fn conversion_error(
    column: usize,
    error: impl std::error::Error + Send + Sync + 'static,
) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(column, Type::Text, Box::new(error))
}

fn read_u32(row: &Row<'_>, column: usize) -> rusqlite::Result<u32> {
    let value = row.get::<_, i64>(column)?;
    u32::try_from(value).map_err(|error| conversion_error(column, error))
}

fn read_u64(row: &Row<'_>, column: usize) -> rusqlite::Result<u64> {
    let value = row.get::<_, i64>(column)?;
    u64::try_from(value).map_err(|error| conversion_error(column, error))
}

fn read_optional_u64(row: &Row<'_>, column: usize) -> rusqlite::Result<Option<u64>> {
    row.get::<_, Option<i64>>(column)?
        .map(|value| u64::try_from(value).map_err(|error| conversion_error(column, error)))
        .transpose()
}

fn to_u32(value: impl TryInto<u32, Error = TryFromIntError>) -> Result<u32> {
    value
        .try_into()
        .map_err(|_| StorageError::InvalidData("integer does not fit in u32".to_string()))
}

fn to_i64(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| {
        StorageError::InvalidData("integer does not fit in SQLite INTEGER".to_string())
    })
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn stored_managed_source_path(paths: &DataPaths, path: &Path) -> String {
    let relative = if path.is_absolute() {
        path.strip_prefix(&paths.root).ok()
    } else {
        Some(path)
    };
    let Some(relative) = relative else {
        return path_text(path);
    };
    if relative.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return path_text(path);
    }
    relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy()),
            std::path::Component::CurDir => None,
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn resolve_managed_source_path(paths: &DataPaths, stored: impl AsRef<Path>) -> PathBuf {
    let stored = stored.as_ref();
    if stored.is_absolute() {
        stored.to_path_buf()
    } else {
        paths.root.join(stored)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use rusqlite::Connection;
    use tempfile::TempDir;
    use translunar_filter_docx::{DocxFilter, fixture};

    use super::*;

    struct Fixture {
        _temp: TempDir,
        store: Store,
        project: Project,
        document: Document,
        segments: Vec<Segment>,
    }

    impl Fixture {
        fn new() -> Self {
            let temp = tempfile::tempdir().expect("temporary directory");
            let mut store = Store::open(temp.path()).expect("open store");
            let project = store
                .create_project("Retention", "en-US", "zh-CN", "legal")
                .expect("create project");
            let document_id = new_id();
            let input = NewDocument {
                id: document_id.clone(),
                project_id: project.id.clone(),
                name: "retention.docx".to_string(),
                relative_path: String::new(),
                format: "docx".to_string(),
                filter_id: "builtin.docx".to_string(),
                source_sha256: "fixture-digest".to_string(),
                degradation: Vec::new(),
                original_source_path: temp.path().join("retention.docx"),
                managed_source_path: store.paths().managed_docx(&document_id),
            };
            let units = vec![
                ImportedUnit::plain(
                    0,
                    "word/document.xml#p:0",
                    "The retention period is 30 days.",
                ),
                ImportedUnit::plain(
                    1,
                    "word/document.xml#p:2",
                    "This paragraph remains untranslated.",
                ),
            ];
            let document = store
                .insert_document(&input, &units)
                .expect("insert document");
            let segments = store.all_segments(&document.id).expect("list segments");
            Self {
                _temp: temp,
                store,
                project,
                document,
                segments,
            }
        }
    }

    #[test]
    fn configures_sqlite_and_recovers_projects() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let database_path;
        let project_id;
        {
            let mut store = Store::open(temp.path()).expect("open store");
            database_path = store.paths().database.clone();
            let journal_mode = store
                .connection()
                .pragma_query_value(None, "journal_mode", |row| row.get::<_, String>(0))
                .expect("journal mode");
            let foreign_keys = store
                .connection()
                .pragma_query_value(None, "foreign_keys", |row| row.get::<_, i64>(0))
                .expect("foreign keys");
            assert_eq!(journal_mode, "wal");
            assert_eq!(foreign_keys, 1);
            project_id = store
                .create_project("Project", "en", "zh", "general")
                .expect("create project")
                .id;
        }

        assert!(database_path.exists());
        let reopened = Store::open(temp.path()).expect("reopen store");
        let aggregate = reopened.get_project(&project_id).expect("recover project");
        assert_eq!(aggregate.project.name, "Project");
        assert_eq!(aggregate.counts.total, 0);
    }

    #[test]
    fn persists_drafts_and_rejects_stale_writes() {
        let mut fixture = Fixture::new();
        let segment = fixture.segments.remove(0);
        let saved = fixture
            .store
            .update_target(&segment.id, "保留期为 60 天。", segment.revision)
            .expect("save draft");
        assert_eq!(saved.state, SegmentState::Draft);
        assert_eq!(saved.revision, 1);

        let error = fixture
            .store
            .update_target(&segment.id, "stale", segment.revision)
            .expect_err("reject stale write");
        assert!(matches!(
            error,
            StorageError::Conflict {
                expected_revision: 0,
                actual_revision: 1,
                ..
            }
        ));
        let current = fixture
            .store
            .all_segments(&fixture.document.id)
            .expect("reload segments")
            .remove(0);
        assert_eq!(current.target_text, "保留期为 60 天。");
    }

    #[test]
    fn confirmation_sinks_once_and_resolves_number_issue() {
        let mut fixture = Fixture::new();
        let segment = fixture.segments.remove(0);
        let draft = fixture
            .store
            .update_target(&segment.id, "保留期为 60 天。", 0)
            .expect("save mismatch");
        let first = fixture
            .store
            .confirm_segment(&segment.id, draft.revision)
            .expect("confirm mismatch");
        assert_eq!(first.segment.state, SegmentState::Confirmed);
        assert_eq!(first.qa_issues.len(), 1);
        assert_eq!(first.qa_issues[0].evidence.source_numbers, vec!["30"]);
        assert_eq!(first.qa_issues[0].evidence.target_numbers, vec!["60"]);
        let issue_id = first.qa_issues[0].id.clone();

        let second = fixture
            .store
            .confirm_segment(&segment.id, first.segment.revision)
            .expect("reconfirm");
        assert_eq!(first.tm_entry.id, second.tm_entry.id);
        let matches = fixture
            .store
            .lookup_exact(&fixture.project.id, &segment.source_text)
            .expect("lookup TM");
        assert_eq!(matches.len(), 1);

        let corrected = fixture
            .store
            .update_target(&segment.id, "保留期为 30 天。", second.segment.revision)
            .expect("correct target");
        fixture
            .store
            .confirm_segment(&segment.id, corrected.revision)
            .expect("confirm correction");
        let all_issues = fixture
            .store
            .list_qa(&fixture.document.id, true)
            .expect("list all issues");
        assert_eq!(all_issues.len(), 1);
        assert_eq!(all_issues[0].id, issue_id);
        assert_eq!(all_issues[0].status, QaIssueStatus::Resolved);
        assert!(
            fixture
                .store
                .list_qa(&fixture.document.id, false)
                .expect("list open issues")
                .is_empty()
        );
    }

    #[test]
    fn hashes_include_neighbor_context() {
        let fixture = Fixture::new();
        let hashes = fixture
            .segments
            .iter()
            .map(|segment| &segment.context_hash)
            .collect::<HashSet<_>>();
        assert_eq!(hashes.len(), fixture.segments.len());
    }

    #[test]
    fn project_and_segment_writes_append_atomic_history() {
        let mut fixture = Fixture::new();
        let updated = fixture
            .store
            .update_project(
                &fixture.project.id,
                ProjectUpdate {
                    name: "Retention Updated".to_string(),
                    source_locale: "en-US".to_string(),
                    target_locale: "zh-CN".to_string(),
                    domain: "legal".to_string(),
                    configuration: ProjectConfiguration::default(),
                    expected_revision: 0,
                    actor: "test".to_string(),
                    correlation_id: Some("corr-1".to_string()),
                },
            )
            .expect("update project");
        assert_eq!(updated.revision, 1);
        let archived = fixture
            .store
            .set_project_lifecycle(
                &fixture.project.id,
                ProjectLifecycle::Archived,
                updated.revision,
                "test",
                None,
            )
            .expect("archive project");
        assert_eq!(archived.lifecycle, ProjectLifecycle::Archived);
        let trashed = fixture
            .store
            .set_project_lifecycle(
                &fixture.project.id,
                ProjectLifecycle::Trash,
                archived.revision,
                "test",
                None,
            )
            .expect("trash project");
        assert_eq!(trashed.lifecycle, ProjectLifecycle::Trash);
        let restored = fixture
            .store
            .set_project_lifecycle(
                &fixture.project.id,
                ProjectLifecycle::Active,
                trashed.revision,
                "test",
                None,
            )
            .expect("restore project");
        assert_eq!(restored.lifecycle, ProjectLifecycle::Active);

        let segment = fixture.segments.remove(0);
        let saved = fixture
            .store
            .update_target(&segment.id, "保留期为 30 天。", segment.revision)
            .expect("save target");
        let stale = fixture
            .store
            .update_target(&segment.id, "stale", segment.revision)
            .expect_err("stale write");
        assert!(matches!(stale, StorageError::Conflict { .. }));
        fixture
            .store
            .confirm_segment(&segment.id, saved.revision)
            .expect("confirm target");

        let (operations, total) = fixture
            .store
            .list_operations(&fixture.project.id, 0, 20, false)
            .expect("list operations");
        assert_eq!(total, 6);
        assert_eq!(
            operations
                .iter()
                .map(|item| item.sequence)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5, 6]
        );
        assert_eq!(operations[0].kind, "project.update");
        assert_eq!(operations[5].kind, "segment.confirm");
    }

    #[test]
    fn history_pagination_is_deterministic_after_restart() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let project_id;
        let segment_id;
        {
            let mut store = Store::open(temp.path()).expect("open store");
            let project = store
                .create_project("History", "en", "zh", "general")
                .expect("create project");
            project_id = project.id.clone();
            let document_id = new_id();
            let input = NewDocument {
                id: document_id.clone(),
                project_id: project.id,
                name: "history.docx".to_string(),
                relative_path: "history.docx".to_string(),
                format: "docx".to_string(),
                filter_id: "builtin.docx".to_string(),
                source_sha256: "history-digest".to_string(),
                degradation: Vec::new(),
                original_source_path: temp.path().join("history.docx"),
                managed_source_path: temp.path().join("sources").join("history.docx"),
            };
            store
                .insert_document(&input, &[ImportedUnit::plain(0, "p:0", "Source")])
                .expect("insert document");
            segment_id = store
                .all_segments(&document_id)
                .expect("segments")
                .remove(0)
                .id;
            store
                .update_target(&segment_id, "译文", 0)
                .expect("update target");
            store
                .confirm_segment(&segment_id, 1)
                .expect("confirm target");
        }

        let store = Store::open(temp.path()).expect("reopen store");
        let (descending, total) = store
            .list_operations(&project_id, 0, 1, true)
            .expect("descending history");
        assert_eq!(total, 2);
        assert_eq!(descending.len(), 1);
        assert_eq!(descending[0].sequence, 2);
        let (ascending, _) = store
            .list_operations(&project_id, 1, 1, false)
            .expect("ascending history");
        assert_eq!(ascending[0].sequence, 2);
    }

    #[test]
    fn upgrades_schema_v1_after_creating_a_consistent_backup() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let database = temp.path().join("translunar.sqlite3");
        let source = temp.path().join("sources").join("d1.docx");
        fs::create_dir_all(source.parent().expect("source parent")).expect("create sources");
        fixture::write_fixture(&source).expect("write managed source");

        let mut connection = Connection::open(&database).expect("open v1 database");
        crate::migrations::create_schema_v1(&mut connection).expect("create v1 schema");
        connection
            .execute(
                "INSERT INTO projects (
                    id, name, source_locale, target_locale, domain, created_at_ms, updated_at_ms
                 ) VALUES ('p1', 'Legacy', 'en-US', 'zh-CN', 'legal', 1, 2)",
                [],
            )
            .expect("insert legacy project");
        connection
            .execute(
                "INSERT INTO documents (
                    id, project_id, name, format, source_sha256, original_source_path,
                    managed_source_path, segment_count, imported_at_ms
                 ) VALUES ('d1', 'p1', 'legacy.docx', 'docx', 'hash', 'original.docx', ?1, 1, 3)",
                [path_text(&source)],
            )
            .expect("insert legacy document");
        connection
            .execute(
                "INSERT INTO segments (
                    id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
                 ) VALUES ('s1', 'd1', 0, 'word/document.xml#p:0',
                           'The retention period is 30 days.', '保留期为 30 天。',
                           'draft', 7, 'sh', 'ch', 4)",
                [],
            )
            .expect("insert legacy segment");
        connection
            .execute(
                "INSERT INTO translation_memories (
                    id, project_id, name, source_locale, target_locale, writable
                 ) VALUES ('tm1', 'p1', 'Legacy TM', 'en-US', 'zh-CN', 1)",
                [],
            )
            .expect("insert legacy TM");
        connection
            .execute(
                "INSERT INTO tm_entries (
                    id, memory_id, source_text, target_text, source_hash,
                    origin_project_id, origin_document_id, origin_segment_id,
                    confirmed_at_ms
                 ) VALUES ('entry1', 'tm1',
                           'The retention period is 30 days.', '保留期为 30 天。', ?1,
                           'p1', 'd1', 's1', 5)",
                [translunar_domain::sha256_hex(
                    normalize_text("The retention period is 30 days.").as_bytes(),
                )],
            )
            .expect("insert legacy TM entry");
        connection
            .execute(
                "INSERT INTO qa_issues (
                    id, segment_id, rule_id, severity, status, message,
                    fingerprint, evidence_json, created_at_ms, updated_at_ms
                 ) VALUES ('qa1', 's1', 'legacy-rule', 'warning', 'open',
                           'legacy issue', 'legacy-fingerprint',
                           '{\"sourceNumbers\":[\"1\"],\"targetNumbers\":[\"2\"]}', 6, 6)",
                [],
            )
            .expect("insert legacy QA issue");
        drop(connection);

        let store = Store::open(temp.path()).expect("upgrade v1 database");
        let aggregate = store.get_project("p1").expect("read upgraded project");
        assert_eq!(aggregate.project.lifecycle, ProjectLifecycle::Active);
        assert_eq!(aggregate.project.revision, 0);
        assert_eq!(aggregate.documents[0].filter_id, "builtin.docx");
        assert_eq!(aggregate.documents[0].current_version, 1);
        let segment = store
            .all_segments("d1")
            .expect("read legacy segment")
            .remove(0);
        assert_eq!(segment.target_text, "保留期为 30 天。");
        assert_eq!(segment.revision, 7);
        let tm_entries = store
            .lookup_exact("p1", "The retention period is 30 days.")
            .expect("legacy TM entry");
        assert_eq!(tm_entries.len(), 1);
        assert_eq!(tm_entries[0].target_text, "保留期为 30 天。");
        let (asset_libraries, _) = store
            .list_tm_libraries(Some("p1"), 0, 20)
            .expect("migrated asset library");
        assert_eq!(asset_libraries[0].id, "tm1");
        let migrated_units = store.export_tm_units("tm1").expect("migrated asset units");
        assert_eq!(migrated_units.len(), 1);
        assert_eq!(migrated_units[0].origin_segment_id.as_deref(), Some("s1"));
        assert_eq!(migrated_units[0].target_text, "保留期为 30 天。");
        assert!(!migrated_units[0].target_hash.is_empty());
        let (migrated_termbases, _) = store
            .list_termbases(Some("p1"), 0, 20)
            .expect("migrated default termbase");
        assert_eq!(migrated_termbases.len(), 1);
        let qa_issues = store.list_qa("d1", true).expect("legacy QA issue");
        assert_eq!(qa_issues.len(), 1);
        assert_eq!(qa_issues[0].id, "qa1");
        let restored_document = store.get_document("d1").expect("legacy document paths");
        let export_path = temp.path().join("legacy-export.docx");
        let summary = DocxFilter
            .export(
                &restored_document.managed_source_path,
                &export_path,
                &store.all_segments("d1").expect("legacy segments"),
            )
            .expect("export upgraded legacy document");
        assert_eq!(summary.translated_segments, 1);
        DocxFilter
            .validate(&export_path)
            .expect("validate upgraded legacy export");

        let backups = fs::read_dir(store.paths().backups.clone())
            .expect("list backups")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("read backups");
        assert_eq!(backups.len(), 1);
        let manifest: BackupManifest = serde_json::from_slice(
            &fs::read(backups[0].path().join("manifest.json")).expect("read manifest"),
        )
        .expect("parse manifest");
        assert_eq!(manifest.schema_version, 1);
        assert_eq!(manifest.files[0].relative_path, "translunar.sqlite3");
        assert!(backups[0].path().join("translunar.sqlite3").is_file());
    }

    #[test]
    fn failed_migration_leaves_user_version_unchanged() {
        let temp = tempfile::tempdir().expect("temporary directory");
        fs::create_dir_all(temp.path()).expect("create data directory");
        let database = temp.path().join("translunar.sqlite3");
        let connection = Connection::open(&database).expect("open database");
        connection
            .execute("CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT", [])
            .expect("create incompatible table");
        drop(connection);

        assert!(Store::open(temp.path()).is_err());
        let connection = Connection::open(database).expect("reopen database");
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .expect("read version");
        assert_eq!(version, 0);
    }

    #[test]
    fn rejects_database_newer_than_supported() {
        let temp = tempfile::tempdir().expect("temporary directory");
        {
            let _store = Store::open(temp.path()).expect("create database");
        }
        let connection =
            Connection::open(temp.path().join("translunar.sqlite3")).expect("open database");
        connection
            .pragma_update(None, "user_version", LATEST_SCHEMA_VERSION + 1)
            .expect("set newer version");
        drop(connection);

        let error = match Store::open(temp.path()) {
            Ok(_) => panic!("newer schema must be rejected"),
            Err(error) => error,
        };
        assert!(matches!(
            error,
            StorageError::SchemaTooNew {
                found,
                supported
            } if found == LATEST_SCHEMA_VERSION + 1 && supported == LATEST_SCHEMA_VERSION
        ));
    }

    #[test]
    fn corrects_ocr_source_atomically_and_recalculates_neighbor_context() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let mut store = Store::open(temp.path()).expect("open store");
        let project = store
            .create_project("PDF", "en", "zh", "legal")
            .expect("create project");
        let document_id = new_id();
        let input = NewDocument {
            id: document_id.clone(),
            project_id: project.id.clone(),
            name: "scan.pdf".to_string(),
            relative_path: "scan.pdf".to_string(),
            format: "pdf".to_string(),
            filter_id: "builtin.pdf".to_string(),
            source_sha256: "pdf-digest".to_string(),
            degradation: Vec::new(),
            original_source_path: temp.path().join("scan.pdf"),
            managed_source_path: store.paths().managed_source(&document_id, "pdf"),
        };
        let units = vec![
            ImportedUnit::plain(
                0,
                "pdf:p=1;b=0;k=paragraph;x=1;y=1;w=10;h=10;s=ocr;c=900",
                "First",
            ),
            ImportedUnit::plain(
                1,
                "pdf:p=1;b=1;k=paragraph;x=1;y=2;w=10;h=10;s=ocr;c=900",
                "INV-2048 unchanged.",
            ),
            ImportedUnit::plain(
                2,
                "pdf:p=1;b=2;k=paragraph;x=1;y=3;w=10;h=10;s=ocr;c=900",
                "Last",
            ),
        ];
        let document = store.insert_document(&input, &units).expect("insert PDF");
        let before = store.all_segments(&document.id).expect("segments");
        let corrected = store
            .correct_ocr_source(
                &before[1].id,
                "INV-2048 unchanged!",
                "verified scan",
                before[1].revision,
            )
            .expect("correct OCR");
        assert_eq!(corrected.revision, before[1].revision + 1);
        assert_ne!(corrected.source_hash, before[1].source_hash);
        let after = store.all_segments(&document.id).expect("segments after");
        assert_ne!(after[0].context_hash, before[0].context_hash);
        assert_ne!(after[2].context_hash, before[2].context_hash);
        let (history, _) = store
            .list_operations(&project.id, 0, 50, false)
            .expect("history");
        assert!(history.iter().any(|operation| {
            operation.kind == "pdf.correct_ocr"
                && operation
                    .after
                    .as_ref()
                    .and_then(|value| value.get("reason"))
                    .and_then(Value::as_str)
                    == Some("verified scan")
        }));
        assert!(matches!(
            store.correct_ocr_source(&corrected.id, "stale", "stale", before[1].revision,),
            Err(StorageError::Conflict { .. })
        ));
    }

    #[test]
    fn health_reports_missing_version_and_foreign_key_findings_without_content() {
        let fixture = Fixture::new();
        let managed_path = fixture
            .store
            .get_document(&fixture.document.id)
            .expect("document")
            .managed_source_path;
        if managed_path.exists() {
            fs::remove_file(&managed_path).expect("remove managed source");
        }
        let missing = fixture.store.check_health().expect("health report");
        assert!(!missing.healthy);
        assert!(
            missing
                .findings
                .iter()
                .any(|finding| finding.code == "document.managed_source_missing")
        );
        assert!(missing.findings.iter().all(
            |finding| !finding.message.contains("Source") && !finding.message.contains("译文")
        ));

        fixture
            .store
            .connection()
            .execute(
                "UPDATE documents SET current_version = 99 WHERE id = ?1",
                [&fixture.document.id],
            )
            .expect("break current version link");
        fixture
            .store
            .connection()
            .execute_batch(
                "PRAGMA foreign_keys = OFF;
                 INSERT INTO inline_tags (
                    id, segment_id, side, position, kind, pair_id, payload,
                    display_text, protected
                 ) VALUES ('broken-tag', 'missing-segment', 'source', 0,
                           'standalone', NULL, 'opaque', '<x/>', 1);
                 PRAGMA foreign_keys = ON;",
            )
            .expect("create foreign key violation");
        let damaged = fixture.store.check_health().expect("damaged health report");
        assert!(
            damaged
                .findings
                .iter()
                .any(|finding| finding.code == "document.current_version_missing")
        );
        assert!(
            damaged
                .findings
                .iter()
                .any(|finding| finding.code == "sqlite.foreign_key")
        );
    }

    #[test]
    fn backup_rejects_overwrite_and_cleans_failed_staging() {
        let fixture = Fixture::new();
        let existing = fixture._temp.path().join("existing-backup");
        fs::create_dir_all(&existing).expect("create existing destination");
        fs::write(existing.join("marker"), b"keep").expect("write marker");
        assert!(fixture.store.create_backup(&existing).is_err());
        assert_eq!(fs::read(existing.join("marker")).expect("marker"), b"keep");

        let sources = fixture.store.paths().sources.clone();
        fs::remove_dir_all(&sources).expect("remove source directory");
        fs::write(&sources, b"not a directory").expect("replace source directory");
        let failed_destination = fixture._temp.path().join("failed-backup");
        assert!(fixture.store.create_backup(&failed_destination).is_err());
        let staging = fs::read_dir(
            failed_destination
                .parent()
                .expect("backup destination parent"),
        )
        .expect("read staging parent")
        .filter_map(std::result::Result::ok)
        .any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".translunar-backup-")
        });
        assert!(!staging, "failed backup must remove its staging directory");
    }

    #[test]
    fn project_bootstraps_default_asset_mounts() {
        let fixture = Fixture::new();
        let (libraries, library_total) = fixture
            .store
            .list_tm_libraries(Some(&fixture.project.id), 0, 20)
            .expect("list TM libraries");
        let library_mounts = fixture
            .store
            .list_tm_library_mounts(&fixture.project.id)
            .expect("list TM mounts");
        assert_eq!(library_total, 1);
        assert_eq!(libraries.len(), 1);
        assert_eq!(library_mounts.len(), 1);
        assert_eq!(library_mounts[0].library_id, libraries[0].id);
        assert_eq!(library_mounts[0].mode, AssetMountMode::Write);

        let (termbases, termbase_total) = fixture
            .store
            .list_termbases(Some(&fixture.project.id), 0, 20)
            .expect("list termbases");
        let termbase_mounts = fixture
            .store
            .list_termbase_mounts(&fixture.project.id)
            .expect("list termbase mounts");
        assert_eq!(termbase_total, 1);
        assert_eq!(termbases.len(), 1);
        assert_eq!(termbase_mounts.len(), 1);
        assert!(termbase_mounts[0].writable);
        assert_eq!(termbase_mounts[0].termbase_id, termbases[0].id);
    }

    #[test]
    fn multi_library_search_and_confirmation_sinking_are_deterministic() {
        let mut fixture = Fixture::new();
        let writable = fixture
            .store
            .create_tm_library(NewTmLibrary {
                name: "Reference and write".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: Some("legal".to_string()),
                writable: true,
                owner_project_id: None,
            })
            .expect("create writable library");
        fixture
            .store
            .mount_tm_library(
                &fixture.project.id,
                &writable.id,
                AssetMountMode::Write,
                1,
                true,
                None,
            )
            .expect("mount writable library");
        let imported = translunar_asset_core::TmExchangeUnit {
            source_locale: "en-US".to_string(),
            target_locale: "zh-CN".to_string(),
            source_text: "保留期为 30 天".to_string(),
            target_text: "Retention is 30 days".to_string(),
            domain: Some("legal".to_string()),
            author: Some("import".to_string()),
            created_at_ms: Some(1),
            metadata: BTreeMap::new(),
        };
        assert_eq!(
            fixture
                .store
                .import_tm_units(&writable.id, std::slice::from_ref(&imported))
                .expect("import unit"),
            (1, 0)
        );
        assert_eq!(
            fixture
                .store
                .import_tm_units(&writable.id, std::slice::from_ref(&imported))
                .expect("deduplicate unit"),
            (0, 1)
        );
        let (fuzzy, _) = fixture
            .store
            .search_tm(&TmSearchRequest {
                project_id: fixture.project.id.clone(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                query: "保留期为 60 天".to_string(),
                threshold: 60,
                offset: 0,
                limit: 20,
                library_ids: vec![writable.id.clone()],
                domain: Some("legal".to_string()),
                since_ms: None,
                origin_project_id: None,
                origin_document_id: None,
                context_before_hash: None,
                context_after_hash: None,
            })
            .expect("search fuzzy TM");
        assert_eq!(fuzzy.len(), 1);
        assert_eq!(fuzzy[0].kind, TmMatchKind::Exact);
        assert_eq!(fuzzy[0].substitutions[0].kind, "number");

        let read_only = fixture
            .store
            .create_tm_library(NewTmLibrary {
                name: "Read only".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: None,
                writable: false,
                owner_project_id: None,
            })
            .expect("create read-only library");
        assert!(
            fixture
                .store
                .mount_tm_library(
                    &fixture.project.id,
                    &read_only.id,
                    AssetMountMode::Write,
                    2,
                    true,
                    None,
                )
                .is_err()
        );
        assert!(
            fixture
                .store
                .import_tm_units(&read_only.id, std::slice::from_ref(&imported))
                .is_err()
        );
        fixture
            .store
            .mount_tm_library(
                &fixture.project.id,
                &read_only.id,
                AssetMountMode::Reference,
                2,
                true,
                None,
            )
            .expect("mount read-only reference");
        let reference = fixture
            .store
            .create_tm_library(NewTmLibrary {
                name: "Writable reference".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: Some("legal".to_string()),
                writable: true,
                owner_project_id: None,
            })
            .expect("create reference library");
        fixture
            .store
            .import_tm_units(&reference.id, std::slice::from_ref(&imported))
            .expect("seed reference library");
        fixture
            .store
            .mount_tm_library(
                &fixture.project.id,
                &reference.id,
                AssetMountMode::Reference,
                3,
                true,
                None,
            )
            .expect("mount writable library as reference");
        let reference_count_before = fixture
            .store
            .export_tm_units(&reference.id)
            .expect("reference units before confirm")
            .len();

        let segment = fixture.segments.remove(0);
        let draft = fixture
            .store
            .update_target(&segment.id, "保留期为 30 天。", segment.revision)
            .expect("save target");
        let confirmation = fixture
            .store
            .confirm_segment(&segment.id, draft.revision)
            .expect("confirm segment");
        assert_eq!(
            fixture
                .store
                .export_tm_units(&reference.id)
                .expect("reference units after confirm")
                .len(),
            reference_count_before,
            "confirmation must not sink into a reference mount"
        );
        assert!(
            fixture
                .store
                .export_tm_units(&read_only.id)
                .expect("read-only reference units")
                .is_empty()
        );
        let (default_libraries, _) = fixture
            .store
            .list_tm_libraries(Some(&fixture.project.id), 0, 20)
            .expect("list mounted libraries");
        let default_library = default_libraries
            .iter()
            .find(|library| library.id != writable.id)
            .expect("default library");
        let default_units = fixture
            .store
            .export_tm_units(&default_library.id)
            .expect("default units");
        let sunk = default_units
            .iter()
            .find(|unit| unit.origin_segment_id.as_deref() == Some(segment.id.as_str()))
            .expect("sunk unit");
        let (context_matches, _) = fixture
            .store
            .search_tm(&TmSearchRequest {
                project_id: fixture.project.id.clone(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                query: segment.source_text.clone(),
                threshold: 100,
                offset: 0,
                limit: 20,
                library_ids: vec![default_library.id.clone()],
                domain: Some("legal".to_string()),
                since_ms: None,
                origin_project_id: Some(fixture.project.id.clone()),
                origin_document_id: Some(fixture.document.id.clone()),
                context_before_hash: sunk.context_before_hash.clone(),
                context_after_hash: sunk.context_after_hash.clone(),
            })
            .expect("context search");
        assert_eq!(context_matches[0].score, 101);
        assert_eq!(context_matches[0].kind, TmMatchKind::Context);

        let writable_count = fixture
            .store
            .export_tm_units(&writable.id)
            .expect("writable units")
            .len();
        fixture
            .store
            .confirm_segment(&segment.id, confirmation.segment.revision)
            .expect("idempotent reconfirm");
        assert_eq!(
            fixture
                .store
                .export_tm_units(&writable.id)
                .expect("reloaded writable units")
                .len(),
            writable_count
        );
    }

    #[test]
    fn term_recognition_and_forbidden_qa_round_trip() {
        let mut fixture = Fixture::new();
        let termbase = fixture
            .store
            .list_termbases(Some(&fixture.project.id), 0, 20)
            .expect("list termbases")
            .0
            .remove(0);
        let entry = fixture
            .store
            .upsert_term_entry(NewTermEntry {
                termbase_id: termbase.id.clone(),
                source_locale: "en-US".to_string(),
                source_term: "paragraph".to_string(),
                part_of_speech: Some("noun".to_string()),
                definition: Some("A block of text".to_string()),
                example: None,
                domain: Some("legal".to_string()),
                status: TermStatus::Active,
                translations: vec![
                    NewTermTranslation {
                        locale: "zh-CN".to_string(),
                        term: "段落".to_string(),
                        preferred: true,
                        forbidden: false,
                    },
                    NewTermTranslation {
                        locale: "zh-CN".to_string(),
                        term: "禁用词".to_string(),
                        preferred: false,
                        forbidden: true,
                    },
                ],
            })
            .expect("upsert term");
        assert_eq!(entry.translations.len(), 2);
        let (matches, _) = fixture
            .store
            .search_terms(&TermSearchRequest {
                project_id: fixture.project.id.clone(),
                text: "This paragraph remains untranslated.".to_string(),
                offset: 0,
                limit: 20,
                termbase_ids: vec![termbase.id.clone()],
            })
            .expect("recognize term");
        assert_eq!(matches.len(), 1);
        let (target_matches, _) = fixture
            .store
            .search_terms(&TermSearchRequest {
                project_id: fixture.project.id.clone(),
                text: "这是一个段落。".to_string(),
                offset: 0,
                limit: 20,
                termbase_ids: vec![termbase.id.clone()],
            })
            .expect("recognize target term");
        assert_eq!(target_matches.len(), 1);
        let (false_matches, _) = fixture
            .store
            .search_terms(&TermSearchRequest {
                project_id: fixture.project.id.clone(),
                text: "This is a subparagraphish token.".to_string(),
                offset: 0,
                limit: 20,
                termbase_ids: vec![termbase.id.clone()],
            })
            .expect("enforce word boundary");
        assert!(false_matches.is_empty());

        let segment = fixture.segments.remove(1);
        let draft = fixture
            .store
            .update_target(&segment.id, "这里包含禁用词。", segment.revision)
            .expect("save forbidden target");
        fixture
            .store
            .confirm_segment(&segment.id, draft.revision)
            .expect("confirm forbidden target");
        let issues = fixture
            .store
            .list_qa(&fixture.document.id, false)
            .expect("list forbidden QA");
        assert!(
            issues
                .iter()
                .any(|issue| issue.rule_id.starts_with("term-forbidden:"))
        );
        let current = fixture
            .store
            .all_segments(&fixture.document.id)
            .expect("reload segment")
            .into_iter()
            .find(|candidate| candidate.id == segment.id)
            .expect("current segment");
        let clean = fixture
            .store
            .update_target(&segment.id, "这里包含段落。", current.revision)
            .expect("save clean target");
        fixture
            .store
            .confirm_segment(&segment.id, clean.revision)
            .expect("confirm clean target");
        let all_issues = fixture
            .store
            .list_qa(&fixture.document.id, true)
            .expect("list resolved QA");
        assert!(all_issues.iter().any(|issue| {
            issue.rule_id.starts_with("term-forbidden:") && issue.status == QaIssueStatus::Resolved
        }));
        assert_eq!(
            fixture
                .store
                .export_term_entries(&termbase.id)
                .expect("export terms")[0]
                .translations
                .len(),
            2
        );
    }
}
