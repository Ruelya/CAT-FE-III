use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension, Row, Transaction, TransactionBehavior, params};
use translunar_asset_core::term_spans;
use translunar_domain::{ProjectConfiguration, QaSeverity, ReviewStatus, new_id, sha256_hex};
use translunar_editor_core::validate_target_tags;
use translunar_qa_core::{
    CompiledQaProfile, QaCandidateEvidence, QaCategory, QaConsistencySegment, QaExecutionSegment,
    QaExportOverride, QaFindingCandidate, QaGateResult, QaIssueDisposition, QaIssueView,
    QaOverrideStatus, QaProfile, QaProfileDefinition, QaReportFormat, QaReportItem, QaReportRecord,
    QaReportSnapshot, QaRuleExecutionFailure, QaRuleExecutionRecord, QaRuleExecutionStatus,
    QaRuleExecutionUsage, QaRuleProvenanceSnapshot, QaRun, QaRunPluginRuleSnapshot, QaRunScope,
    QaRunStatus, QaSegmentInput, QaTagFinding, QaTermExpectation, QaWaiver, ReviewQueueItem,
    ReviewStatistics, ReviewerStatistic, built_in_profiles, canonicalize_qa_candidates,
    default_profile_id, evaluate_consistency,
};

use super::{
    Result, StorageError, Store, conversion_error, ensure_entity_revision, list_inline_tags,
    not_found, now_ms, parse_qa_severity, read_u32, read_u64, to_i64, to_u32,
};
use translunar_domain::TagSide;

const MAX_PROFILE_PAGE: u32 = 200;
const MAX_ISSUE_PAGE: u32 = 500;
const MAX_REASON_CHARS: usize = 1_000;
const MAX_ACTOR_CHARS: usize = 160;

#[derive(Debug, Clone)]
pub struct NewQaProfile {
    pub name: String,
    pub owner_project_id: Option<String>,
    pub definition: QaProfileDefinition,
}

#[derive(Debug, Clone)]
pub struct QaProfileUpdate {
    pub name: String,
    pub definition: QaProfileDefinition,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Default)]
pub struct QaIssueFilter {
    pub project_id: String,
    pub document_id: Option<String>,
    pub segment_id: Option<String>,
    pub severity: Option<QaSeverity>,
    pub category: Option<QaCategory>,
    pub disposition: Option<QaIssueDisposition>,
    pub rule_id: Option<String>,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone)]
pub struct PreparedQaRun {
    pub run_id: String,
    pub project_id: String,
    pub document_id: Option<String>,
    pub requested_profile_id: Option<String>,
    pub scope: QaRunScope,
    pub profile: QaProfile,
    pub segments: Vec<QaExecutionSegment>,
    pub input_snapshot_hash: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Default)]
pub struct EvaluatedQaRun {
    pub candidates: Vec<QaFindingCandidate>,
    pub plugin_rules: Vec<QaRuleExecutionRecord>,
}

impl Store {
    pub fn list_qa_profiles(
        &self,
        project_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<QaProfile>, u32)> {
        validate_page(limit, MAX_PROFILE_PAGE)?;
        if let Some(project_id) = project_id {
            super::ensure_exists(&self.connection, "projects", "project", project_id)?;
        }
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM qa_profiles
             WHERE owner_project_id IS NULL OR owner_project_id = ?1",
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, name, owner_project_id, built_in, definition_json,
                    revision, created_at_ms, updated_at_ms
             FROM qa_profiles
             WHERE owner_project_id IS NULL OR owner_project_id = ?1
             ORDER BY built_in DESC, name COLLATE NOCASE, id
             LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(params![project_id, limit, offset], row_to_qa_profile)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn get_qa_profile(&self, profile_id: &str) -> Result<QaProfile> {
        find_qa_profile(&self.connection, profile_id)
    }

    pub fn resolve_qa_profile(
        &self,
        project_id: &str,
        requested_profile_id: Option<&str>,
    ) -> Result<QaProfile> {
        let project = self.get_project(project_id)?;
        let profile_id = requested_profile_id
            .or(project.project.configuration.qa_profile_id.as_deref())
            .unwrap_or_else(|| default_profile_id(&project.project.target_locale));
        let profile = self.get_qa_profile(profile_id)?;
        if profile
            .owner_project_id
            .as_deref()
            .is_some_and(|owner| owner != project_id)
        {
            return Err(StorageError::InvalidState(
                "QA profile belongs to another project".to_string(),
            ));
        }
        Ok(profile)
    }

    pub fn create_qa_profile(&mut self, input: NewQaProfile) -> Result<QaProfile> {
        validate_profile_name(&input.name)?;
        CompiledQaProfile::compile(input.definition.clone())
            .map_err(|error| StorageError::QaProfileInvalid(error.to_string()))?;
        if let Some(project_id) = input.owner_project_id.as_deref() {
            super::ensure_exists(&self.connection, "projects", "project", project_id)?;
        }
        let id = new_id();
        let now = now_ms();
        let mut definition = input.definition;
        definition.id = id.clone();
        definition.name = input.name.trim().to_string();
        self.connection.execute(
            "INSERT INTO qa_profiles (
                id, name, owner_project_id, built_in, definition_json,
                revision, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, 0, ?4, 0, ?5, ?5)",
            params![
                id,
                definition.name,
                input.owner_project_id,
                serde_json::to_string(&definition)?,
                now,
            ],
        )?;
        self.get_qa_profile(&id)
    }

    pub fn clone_qa_profile(
        &mut self,
        profile_id: &str,
        owner_project_id: Option<String>,
        name: String,
    ) -> Result<QaProfile> {
        let source = self.get_qa_profile(profile_id)?;
        self.create_qa_profile(NewQaProfile {
            name,
            owner_project_id,
            definition: source.definition,
        })
    }

    pub fn update_qa_profile(
        &mut self,
        profile_id: &str,
        input: QaProfileUpdate,
    ) -> Result<QaProfile> {
        validate_profile_name(&input.name)?;
        CompiledQaProfile::compile(input.definition.clone())
            .map_err(|error| StorageError::QaProfileInvalid(error.to_string()))?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_qa_profile(&transaction, profile_id)?;
        if current.built_in {
            return Err(StorageError::InvalidState(
                "built-in QA profiles are immutable".to_string(),
            ));
        }
        ensure_entity_revision(
            "qa_profile",
            profile_id,
            current.revision,
            input.expected_revision,
        )?;
        let mut definition = input.definition;
        definition.id = profile_id.to_string();
        definition.name = input.name.trim().to_string();
        let now = now_ms();
        transaction.execute(
            "UPDATE qa_profiles
             SET name = ?1, definition_json = ?2, revision = revision + 1,
                 updated_at_ms = ?3
             WHERE id = ?4 AND revision = ?5",
            params![
                definition.name,
                serde_json::to_string(&definition)?,
                now,
                profile_id,
                to_i64(input.expected_revision)?,
            ],
        )?;
        let updated = find_qa_profile(&transaction, profile_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn delete_qa_profile(&mut self, profile_id: &str, expected_revision: u64) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_qa_profile(&transaction, profile_id)?;
        if current.built_in {
            return Err(StorageError::InvalidState(
                "built-in QA profiles cannot be deleted".to_string(),
            ));
        }
        ensure_entity_revision(
            "qa_profile",
            profile_id,
            current.revision,
            expected_revision,
        )?;
        transaction.execute(
            "UPDATE projects
             SET configuration_json = json_remove(configuration_json, '$.qaProfileId')
             WHERE json_extract(configuration_json, '$.qaProfileId') = ?1",
            [profile_id],
        )?;
        transaction.execute("DELETE FROM qa_profiles WHERE id = ?1", [profile_id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn run_qa(
        &mut self,
        project_id: &str,
        document_id: Option<&str>,
        requested_profile_id: Option<&str>,
    ) -> Result<QaRun> {
        self.run_qa_with_rules(project_id, document_id, requested_profile_id, &[])
    }

    pub fn run_qa_with_rules(
        &mut self,
        project_id: &str,
        document_id: Option<&str>,
        requested_profile_id: Option<&str>,
        additional_rules: &[translunar_qa_core::QaRegexRule],
    ) -> Result<QaRun> {
        let prepared = self.prepare_qa_run(project_id, document_id, requested_profile_id)?;
        let mut evaluated = Self::evaluate_prepared_qa_run(&prepared)?;
        if !additional_rules.is_empty() {
            evaluated
                .candidates
                .extend(canonicalize_builtin_candidates(evaluate_regex_rules(
                    additional_rules,
                    &prepared.segments,
                )?));
        }
        self.commit_prepared_qa_run(prepared, evaluated)
    }

    pub fn prepare_qa_run(
        &self,
        project_id: &str,
        document_id: Option<&str>,
        requested_profile_id: Option<&str>,
    ) -> Result<PreparedQaRun> {
        let project = query_qa_project_context(&self.connection, project_id)?;
        let profile = resolve_qa_profile_for_connection(
            &self.connection,
            project_id,
            requested_profile_id,
            &project,
        )?;
        validate_qa_document_scope(&self.connection, project_id, document_id)?;
        let segments = query_qa_execution_segments(
            &self.connection,
            project_id,
            document_id,
            &project.source_locale,
            &project.target_locale,
        )?;
        let input_snapshot_hash =
            qa_input_snapshot_hash(project_id, document_id, &profile, &segments)?;
        Ok(PreparedQaRun {
            run_id: new_id(),
            project_id: project_id.to_string(),
            document_id: document_id.map(str::to_string),
            requested_profile_id: requested_profile_id.map(str::to_string),
            scope: if document_id.is_some() {
                QaRunScope::Document
            } else {
                QaRunScope::Project
            },
            profile,
            segments,
            input_snapshot_hash,
            created_at_ms: now_ms(),
        })
    }

    pub fn evaluate_prepared_qa_run(prepared: &PreparedQaRun) -> Result<EvaluatedQaRun> {
        Ok(EvaluatedQaRun {
            candidates: canonicalize_builtin_candidates(evaluate_profile_candidates(
                &prepared.profile.definition,
                &prepared.segments,
                true,
            )?),
            plugin_rules: Vec::new(),
        })
    }

    pub fn commit_prepared_qa_run(
        &mut self,
        prepared: PreparedQaRun,
        mut evaluated: EvaluatedQaRun,
    ) -> Result<QaRun> {
        evaluated.candidates = canonicalize_qa_candidates(&prepared.segments, evaluated.candidates)
            .map_err(|error| StorageError::InvalidState(error.to_string()))?;
        canonicalize_qa_execution_records(&prepared, &mut evaluated.plugin_rules)?;
        if evaluated
            .plugin_rules
            .iter()
            .any(|record| record.status != QaRuleExecutionStatus::Succeeded)
        {
            return Err(StorageError::InvalidState(
                "a successful QA run cannot contain failed plugin executions".to_string(),
            ));
        }
        let profile_snapshot_hash = qa_run_snapshot_hash(
            &prepared.profile,
            &prepared.input_snapshot_hash,
            &evaluated.plugin_rules,
        )?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        recheck_prepared_qa_run(&transaction, &prepared)?;
        transaction.execute(
            "INSERT INTO qa_runs (
                id, project_id, document_id, scope, profile_id, profile_name,
                profile_revision, profile_snapshot_hash, status, checked_segments,
                errors, warnings, info, waived, created_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'running', 0, 0, 0, 0, 0, ?9)",
            params![
                prepared.run_id,
                prepared.project_id,
                prepared.document_id,
                qa_run_scope_text(prepared.scope),
                prepared.profile.id,
                prepared.profile.name,
                to_i64(prepared.profile.revision)?,
                profile_snapshot_hash,
                prepared.created_at_ms,
            ],
        )?;
        resolve_scope_findings(
            &transaction,
            &prepared.project_id,
            prepared.document_id.as_deref(),
            prepared.created_at_ms,
        )?;
        for candidate in &evaluated.candidates {
            upsert_qa_candidate(
                &transaction,
                Some(&prepared.run_id),
                &prepared.profile.id,
                candidate,
                prepared.created_at_ms,
            )?;
        }
        let views = query_current_run_issue_views(&transaction, &prepared.run_id)?;
        let mut errors = 0_u64;
        let mut warnings = 0_u64;
        let mut info = 0_u64;
        let mut waived = 0_u64;
        for view in &views {
            if view.disposition == QaIssueDisposition::Waived {
                waived += 1;
            } else {
                match view.severity {
                    QaSeverity::Error => errors += 1,
                    QaSeverity::Warning => warnings += 1,
                    QaSeverity::Info => info += 1,
                }
            }
            insert_qa_run_item(&transaction, &prepared.run_id, view)?;
        }
        insert_qa_plugin_rule_snapshots(
            &transaction,
            &prepared.run_id,
            &evaluated.plugin_rules,
            prepared.created_at_ms,
        )?;
        transaction.execute(
            "UPDATE qa_runs
             SET status = 'succeeded', checked_segments = ?1, errors = ?2,
                 warnings = ?3, info = ?4, waived = ?5, completed_at_ms = ?6
             WHERE id = ?7",
            params![
                to_i64(u64::try_from(prepared.segments.len()).map_err(|_| {
                    StorageError::InvalidState("QA segment count is oversized".to_string())
                })?)?,
                to_i64(errors)?,
                to_i64(warnings)?,
                to_i64(info)?,
                to_i64(waived)?,
                prepared.created_at_ms,
                prepared.run_id,
            ],
        )?;
        let run = find_qa_run(&transaction, &prepared.run_id)?;
        transaction.commit()?;
        Ok(run)
    }

    pub fn commit_failed_prepared_qa_run(
        &mut self,
        prepared: PreparedQaRun,
        mut plugin_rules: Vec<QaRuleExecutionRecord>,
    ) -> Result<QaRun> {
        canonicalize_qa_execution_records(&prepared, &mut plugin_rules)?;
        if plugin_rules.is_empty()
            || plugin_rules
                .iter()
                .all(|record| record.status == QaRuleExecutionStatus::Succeeded)
        {
            return Err(StorageError::InvalidState(
                "a failed QA run requires a terminal plugin execution record".to_string(),
            ));
        }
        let profile_snapshot_hash = qa_run_snapshot_hash(
            &prepared.profile,
            &prepared.input_snapshot_hash,
            &plugin_rules,
        )?;
        let completed_at_ms = now_ms();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        recheck_prepared_qa_run(&transaction, &prepared)?;
        transaction.execute(
            "INSERT INTO qa_runs (
                id, project_id, document_id, scope, profile_id, profile_name,
                profile_revision, profile_snapshot_hash, status, checked_segments,
                errors, warnings, info, waived, created_at_ms, completed_at_ms
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'failed', 0, 0, 0, 0, 0, ?9, ?10
             )",
            params![
                prepared.run_id,
                prepared.project_id,
                prepared.document_id,
                qa_run_scope_text(prepared.scope),
                prepared.profile.id,
                prepared.profile.name,
                to_i64(prepared.profile.revision)?,
                profile_snapshot_hash,
                prepared.created_at_ms,
                completed_at_ms,
            ],
        )?;
        insert_qa_plugin_rule_snapshots(
            &transaction,
            &prepared.run_id,
            &plugin_rules,
            completed_at_ms,
        )?;
        let run = find_qa_run(&transaction, &prepared.run_id)?;
        transaction.commit()?;
        Ok(run)
    }

    pub fn get_qa_run(&self, run_id: &str) -> Result<QaRun> {
        find_qa_run(&self.connection, run_id)
    }

    pub fn list_qa_runs(
        &self,
        project_id: &str,
        document_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<QaRun>, u32)> {
        validate_page(limit, 200)?;
        super::ensure_exists(&self.connection, "projects", "project", project_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM qa_runs
             WHERE project_id = ?1 AND (?2 IS NULL OR document_id = ?2)",
            params![project_id, document_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, document_id, scope, profile_id, profile_name,
                    profile_revision, profile_snapshot_hash, status, checked_segments,
                    errors, warnings, info, waived, created_at_ms, completed_at_ms
             FROM qa_runs
             WHERE project_id = ?1 AND (?2 IS NULL OR document_id = ?2)
             ORDER BY created_at_ms DESC, id
             LIMIT ?3 OFFSET ?4",
        )?;
        let mut items = statement
            .query_map(
                params![project_id, document_id, limit, offset],
                row_to_qa_run,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for run in &mut items {
            run.plugin_rules = query_qa_plugin_rule_snapshots(&self.connection, &run.id)?;
        }
        Ok((items, to_u32(total)?))
    }
}

#[derive(Debug, Clone)]
struct QaProjectContext {
    source_locale: String,
    target_locale: String,
    configuration: ProjectConfiguration,
}

#[derive(Debug, Clone)]
struct QaScopeSegment {
    id: String,
    document_id: String,
    ordinal: u32,
    structural_path: String,
    source_text: String,
    target_text: String,
    revision: u64,
}

fn recheck_prepared_qa_run(connection: &Connection, prepared: &PreparedQaRun) -> Result<()> {
    let current_project = query_qa_project_context(connection, &prepared.project_id)?;
    let current_profile = resolve_qa_profile_for_connection(
        connection,
        &prepared.project_id,
        prepared.requested_profile_id.as_deref(),
        &current_project,
    )?;
    validate_qa_document_scope(
        connection,
        &prepared.project_id,
        prepared.document_id.as_deref(),
    )?;
    let current_segments = query_qa_execution_segments(
        connection,
        &prepared.project_id,
        prepared.document_id.as_deref(),
        &current_project.source_locale,
        &current_project.target_locale,
    )?;
    let current_input_snapshot_hash = qa_input_snapshot_hash(
        &prepared.project_id,
        prepared.document_id.as_deref(),
        &current_profile,
        &current_segments,
    )?;
    if current_profile != prepared.profile
        || current_input_snapshot_hash != prepared.input_snapshot_hash
    {
        return Err(StorageError::InvalidState(
            "QA inputs changed while rules were executing".to_string(),
        ));
    }
    Ok(())
}

fn query_qa_project_context(connection: &Connection, project_id: &str) -> Result<QaProjectContext> {
    connection
        .query_row(
            "SELECT source_locale, target_locale, configuration_json
             FROM projects WHERE id = ?1",
            [project_id],
            |row| {
                let configuration_json = row.get::<_, String>(2)?;
                Ok(QaProjectContext {
                    source_locale: row.get(0)?,
                    target_locale: row.get(1)?,
                    configuration: serde_json::from_str(&configuration_json)
                        .map_err(|error| conversion_error(2, error))?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("project", project_id))
}

fn resolve_qa_profile_for_connection(
    connection: &Connection,
    project_id: &str,
    requested_profile_id: Option<&str>,
    project: &QaProjectContext,
) -> Result<QaProfile> {
    let profile_id = requested_profile_id
        .or(project.configuration.qa_profile_id.as_deref())
        .unwrap_or_else(|| default_profile_id(&project.target_locale));
    let profile = find_qa_profile(connection, profile_id)?;
    if profile
        .owner_project_id
        .as_deref()
        .is_some_and(|owner| owner != project_id)
    {
        return Err(StorageError::InvalidState(
            "QA profile belongs to another project".to_string(),
        ));
    }
    Ok(profile)
}

fn validate_qa_document_scope(
    connection: &Connection,
    project_id: &str,
    document_id: Option<&str>,
) -> Result<()> {
    let Some(document_id) = document_id else {
        return Ok(());
    };
    let owner = connection
        .query_row(
            "SELECT project_id FROM documents WHERE id = ?1",
            [document_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("document", document_id))?;
    if owner != project_id {
        return Err(StorageError::InvalidState(
            "QA document belongs to another project".to_string(),
        ));
    }
    Ok(())
}

fn query_qa_scope_segments(
    connection: &Connection,
    project_id: &str,
    document_id: Option<&str>,
) -> Result<Vec<QaScopeSegment>> {
    let mut statement = connection.prepare(
        "SELECT s.id, s.document_id, s.ordinal, s.structural_path,
                s.source_text, s.target_text, s.revision
         FROM segments s
         JOIN documents d ON d.id = s.document_id
         WHERE d.project_id = ?1 AND d.status = 'active'
               AND (?2 IS NULL OR d.id = ?2)
         ORDER BY d.relative_path, d.name, d.id, s.ordinal, s.id",
    )?;
    Ok(statement
        .query_map(params![project_id, document_id], |row| {
            Ok(QaScopeSegment {
                id: row.get(0)?,
                document_id: row.get(1)?,
                ordinal: read_u32(row, 2)?,
                structural_path: row.get(3)?,
                source_text: row.get(4)?,
                target_text: row.get(5)?,
                revision: read_u64(row, 6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

fn query_qa_execution_segments(
    connection: &Connection,
    project_id: &str,
    document_id: Option<&str>,
    source_locale: &str,
    target_locale: &str,
) -> Result<Vec<QaExecutionSegment>> {
    let segments = query_qa_scope_segments(connection, project_id, document_id)?;
    let term_expectations = query_term_expectations(connection, project_id, target_locale)?;
    segments
        .into_iter()
        .map(|segment| {
            let source_tags = list_inline_tags(connection, &segment.id, TagSide::Source)?;
            let target_tags = list_inline_tags(connection, &segment.id, TagSide::Target)?;
            let tag_findings =
                validate_target_tags(&source_tags, &target_tags, &segment.target_text)
                    .into_iter()
                    .map(|finding| QaTagFinding {
                        code: finding.code,
                        message: finding.message,
                    })
                    .collect();
            let terms = term_expectations
                .iter()
                .filter(|term| !term_spans(&segment.source_text, &term.source_term).is_empty())
                .cloned()
                .collect();
            Ok(QaExecutionSegment {
                project_id: project_id.to_string(),
                document_id: segment.document_id,
                ordinal: segment.ordinal,
                structural_path: segment.structural_path,
                revision: segment.revision,
                input: QaSegmentInput {
                    segment_id: segment.id,
                    source_text: segment.source_text,
                    target_text: segment.target_text,
                    source_locale: source_locale.to_string(),
                    target_locale: target_locale.to_string(),
                    tag_findings,
                    terms,
                },
            })
        })
        .collect()
}

fn query_term_expectations(
    connection: &Connection,
    project_id: &str,
    target_locale: &str,
) -> Result<Vec<QaTermExpectation>> {
    let mut statement = connection.prepare(
        "SELECT e.id, e.source_term, t.term, t.preferred, t.forbidden
         FROM termbase_mounts m
         JOIN term_entries e ON e.termbase_id = m.termbase_id
         JOIN term_translations t ON t.entry_id = e.id
         WHERE m.project_id = ?1 AND m.enabled = 1 AND e.status = 'active'
               AND t.locale = ?2
         ORDER BY m.priority, e.id, t.id",
    )?;
    let rows = statement
        .query_map(params![project_id, target_locale], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut grouped: BTreeMap<String, QaTermExpectation> = BTreeMap::new();
    for (id, source_term, target, preferred, forbidden) in rows {
        let entry = grouped.entry(id.clone()).or_insert(QaTermExpectation {
            id,
            source_term,
            preferred_targets: Vec::new(),
            forbidden_targets: Vec::new(),
        });
        if preferred {
            entry.preferred_targets.push(target.clone());
        }
        if forbidden {
            entry.forbidden_targets.push(target);
        }
    }
    Ok(grouped.into_values().collect())
}

fn evaluate_profile_candidates(
    definition: &QaProfileDefinition,
    segments: &[QaExecutionSegment],
    include_consistency: bool,
) -> Result<Vec<QaFindingCandidate>> {
    let compiled = CompiledQaProfile::compile(definition.clone())
        .map_err(|error| StorageError::InvalidState(error.to_string()))?;
    let mut candidates = segments
        .iter()
        .flat_map(|segment| compiled.evaluate_segment(&segment.input))
        .collect::<Vec<_>>();
    if include_consistency {
        candidates.extend(evaluate_consistency(
            definition,
            &segments
                .iter()
                .map(|segment| QaConsistencySegment {
                    segment_id: segment.input.segment_id.clone(),
                    source_text: segment.input.source_text.clone(),
                    target_text: segment.input.target_text.clone(),
                })
                .collect::<Vec<_>>(),
        ));
    }
    Ok(candidates)
}

fn canonicalize_builtin_candidates(
    mut candidates: Vec<QaFindingCandidate>,
) -> Vec<QaFindingCandidate> {
    candidates.sort_by(|left, right| {
        (
            left.segment_id.as_str(),
            left.rule_id.as_str(),
            left.fingerprint.as_str(),
        )
            .cmp(&(
                right.segment_id.as_str(),
                right.rule_id.as_str(),
                right.fingerprint.as_str(),
            ))
    });
    candidates.dedup_by(|left, right| {
        left.segment_id == right.segment_id
            && left.rule_id == right.rule_id
            && left.fingerprint == right.fingerprint
    });
    candidates
}

fn evaluate_regex_rules(
    rules: &[translunar_qa_core::QaRegexRule],
    segments: &[QaExecutionSegment],
) -> Result<Vec<QaFindingCandidate>> {
    let definition = QaProfileDefinition {
        id: "runtime.qa.regex".to_string(),
        name: "Runtime QA regex rules".to_string(),
        enabled_rule_ids: rules
            .iter()
            .map(|rule| format!("qa.regex:{}", rule.id))
            .collect(),
        severity_overrides: BTreeMap::new(),
        settings: translunar_qa_core::QaRuleSettings::default(),
        regex_rules: rules.to_vec(),
    };
    evaluate_profile_candidates(&definition, segments, false)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct QaInputSnapshot<'a> {
    project_id: &'a str,
    document_id: Option<&'a str>,
    profile_id: &'a str,
    profile_revision: u64,
    profile_definition: &'a QaProfileDefinition,
    segments: &'a [QaExecutionSegment],
}

fn qa_input_snapshot_hash(
    project_id: &str,
    document_id: Option<&str>,
    profile: &QaProfile,
    segments: &[QaExecutionSegment],
) -> Result<String> {
    Ok(sha256_hex(&serde_json::to_vec(&QaInputSnapshot {
        project_id,
        document_id,
        profile_id: &profile.id,
        profile_revision: profile.revision,
        profile_definition: &profile.definition,
        segments,
    })?))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct QaRunSnapshot<'a> {
    profile_id: &'a str,
    profile_revision: u64,
    profile_definition: &'a QaProfileDefinition,
    input_snapshot_hash: &'a str,
    plugin_rules: &'a [QaRuleExecutionRecord],
}

fn qa_run_snapshot_hash(
    profile: &QaProfile,
    input_snapshot_hash: &str,
    plugin_rules: &[QaRuleExecutionRecord],
) -> Result<String> {
    Ok(sha256_hex(&serde_json::to_vec(&QaRunSnapshot {
        profile_id: &profile.id,
        profile_revision: profile.revision,
        profile_definition: &profile.definition,
        input_snapshot_hash,
        plugin_rules,
    })?))
}

fn canonicalize_qa_execution_records(
    prepared: &PreparedQaRun,
    records: &mut Vec<QaRuleExecutionRecord>,
) -> Result<()> {
    const MAX_QA_USAGE_UNITS: u64 = 1_000_000_000;
    records.sort_by(|left, right| execution_record_key(left).cmp(&execution_record_key(right)));
    if records
        .windows(2)
        .any(|pair| execution_record_key(&pair[0]) == execution_record_key(&pair[1]))
    {
        return Err(StorageError::InvalidState(
            "QA run contains duplicate plugin execution records".to_string(),
        ));
    }
    let expected_execution_count = u32::try_from(prepared.segments.len())
        .map_err(|_| StorageError::InvalidState("QA segment count is oversized".to_string()))?;
    for record in records {
        let provenance = &record.provenance;
        validate_qa_snapshot_id(&provenance.plugin_id, 128, "plugin ID")?;
        validate_qa_snapshot_text(&provenance.version_id, 384, "version ID")?;
        validate_qa_snapshot_id(&provenance.contribution_id, 128, "contribution ID")?;
        if provenance.contribution_version.trim().is_empty()
            || provenance.contribution_version.len() > 128
            || provenance
                .contribution_version
                .chars()
                .any(char::is_control)
            || provenance.descriptor_version != 1
            || provenance.operation_protocol_version != 1
            || provenance.config_schema_version == 0
            || !matches!(
                provenance.tier.as_str(),
                "declarative" | "sandbox" | "process"
            )
            || !is_sha256(&provenance.descriptor_hash)
            || !is_sha256(&provenance.config_hash)
            || record.input_hash != prepared.input_snapshot_hash
            || record
                .output_hash
                .as_deref()
                .is_some_and(|hash| !is_sha256(hash))
            || record.execution_count > expected_execution_count
            || record.usage.work_units > MAX_QA_USAGE_UNITS
            || record.usage.input_bytes > MAX_QA_USAGE_UNITS
            || record.usage.output_bytes > MAX_QA_USAGE_UNITS
        {
            return Err(StorageError::InvalidState(
                "QA plugin execution record is invalid".to_string(),
            ));
        }
        match record.status {
            QaRuleExecutionStatus::Succeeded
                if record.output_hash.is_some()
                    && record.failure.is_none()
                    && record.execution_count == expected_execution_count => {}
            QaRuleExecutionStatus::Failed | QaRuleExecutionStatus::Canceled
                if record.output_hash.is_none()
                    && record.finding_count == 0
                    && record.failure.is_some() =>
            {
                validate_qa_execution_failure(record.failure.as_ref().expect("checked above"))?;
            }
            _ => {
                return Err(StorageError::InvalidState(
                    "QA plugin execution status does not match its result".to_string(),
                ));
            }
        }
        if !provenance.rule_ids.windows(2).all(|pair| pair[0] < pair[1])
            || provenance
                .rule_ids
                .iter()
                .any(|id| validate_qa_snapshot_id(id, 2_048, "rule ID").is_err())
        {
            return Err(StorageError::InvalidState(
                "QA plugin rule IDs are invalid or not deterministically ordered".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_qa_execution_failure(failure: &QaRuleExecutionFailure) -> Result<()> {
    validate_qa_snapshot_id(&failure.code, 128, "failure code")?;
    validate_qa_snapshot_text(&failure.message, 2_048, "failure message")?;
    if serde_json::to_vec(failure)?.len() > 4_096 {
        return Err(StorageError::InvalidState(
            "QA plugin failure is oversized".to_string(),
        ));
    }
    Ok(())
}

fn execution_record_key(record: &QaRuleExecutionRecord) -> (&str, &str, &str) {
    (
        record.provenance.plugin_id.as_str(),
        record.provenance.version_id.as_str(),
        record.provenance.contribution_id.as_str(),
    )
}

fn validate_qa_snapshot_id(value: &str, max_bytes: usize, label: &str) -> Result<()> {
    validate_qa_snapshot_text(value, max_bytes, label)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        return Err(StorageError::InvalidState(format!(
            "QA plugin {label} is invalid"
        )));
    }
    Ok(())
}

fn validate_qa_snapshot_text(value: &str, max_bytes: usize, label: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(StorageError::InvalidState(format!(
            "QA plugin {label} is invalid"
        )));
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn insert_qa_plugin_rule_snapshots(
    connection: &Connection,
    run_id: &str,
    records: &[QaRuleExecutionRecord],
    created_at_ms: i64,
) -> Result<()> {
    for (index, record) in records.iter().enumerate() {
        connection.execute(
            "INSERT INTO qa_run_plugin_rules (
                run_id, contribution_index, plugin_id, version_id,
                contribution_id, contribution_version, descriptor_version,
                operation_protocol_version, config_schema_version,
                activation_revision, tier, descriptor_hash, config_hash,
                rule_ids_json, status, execution_count, finding_count,
                input_hash, output_hash, usage_json, failure_json, created_at_ms
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22
             )",
            params![
                run_id,
                to_i64(u64::try_from(index).map_err(|_| {
                    StorageError::InvalidState("QA contribution count is oversized".to_string())
                })?)?,
                record.provenance.plugin_id,
                record.provenance.version_id,
                record.provenance.contribution_id,
                record.provenance.contribution_version,
                i64::from(record.provenance.descriptor_version),
                i64::from(record.provenance.operation_protocol_version),
                i64::from(record.provenance.config_schema_version),
                to_i64(record.provenance.activation_revision)?,
                record.provenance.tier,
                record.provenance.descriptor_hash,
                record.provenance.config_hash,
                serde_json::to_string(&record.provenance.rule_ids)?,
                qa_rule_execution_status_text(record.status),
                i64::from(record.execution_count),
                i64::from(record.finding_count),
                record.input_hash,
                record.output_hash,
                serde_json::to_string(&record.usage)?,
                record
                    .failure
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                created_at_ms,
            ],
        )?;
    }
    Ok(())
}

fn resolve_scope_findings(
    connection: &Connection,
    project_id: &str,
    document_id: Option<&str>,
    now: i64,
) -> Result<()> {
    connection.execute(
        "UPDATE qa_issues SET status = 'resolved', updated_at_ms = ?1
         WHERE segment_id IN (
             SELECT s.id FROM segments s
             JOIN documents d ON d.id = s.document_id
             WHERE d.project_id = ?2 AND (?3 IS NULL OR d.id = ?3)
         ) AND (
             rule_id LIKE 'qa.%' OR rule_id = 'number-mismatch'
             OR rule_id LIKE 'term-forbidden:%'
         )",
        params![now, project_id, document_id],
    )?;
    Ok(())
}

pub(super) fn reconcile_segment_local_qa(
    transaction: &Transaction<'_>,
    segment_id: &str,
    now: i64,
) -> Result<()> {
    let (project_id, source_locale, target_locale, configuration_json) = transaction.query_row(
        "SELECT p.id, p.source_locale, p.target_locale, p.configuration_json
         FROM segments s
         JOIN documents d ON d.id = s.document_id
         JOIN projects p ON p.id = d.project_id
         WHERE s.id = ?1",
        [segment_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    )?;
    let configuration: ProjectConfiguration = serde_json::from_str(&configuration_json)?;
    let profile_id = configuration
        .qa_profile_id
        .as_deref()
        .unwrap_or_else(|| default_profile_id(&target_locale));
    let profile = find_qa_profile(transaction, profile_id)?;
    if profile
        .owner_project_id
        .as_deref()
        .is_some_and(|owner| owner != project_id)
    {
        return Err(StorageError::InvalidState(
            "QA profile belongs to another project".to_string(),
        ));
    }
    let compiled = CompiledQaProfile::compile(profile.definition)
        .map_err(|error| StorageError::QaProfileInvalid(error.to_string()))?;
    let segment = super::find_segment(transaction, segment_id)?;
    let source_tags = list_inline_tags(transaction, segment_id, TagSide::Source)?;
    let target_tags = list_inline_tags(transaction, segment_id, TagSide::Target)?;
    let tag_findings = validate_target_tags(&source_tags, &target_tags, &segment.target_text)
        .into_iter()
        .map(|finding| QaTagFinding {
            code: finding.code,
            message: finding.message,
        })
        .collect();
    let terms = query_term_expectations(transaction, &project_id, &target_locale)?
        .into_iter()
        .filter(|term| !term_spans(&segment.source_text, &term.source_term).is_empty())
        .collect();
    let candidates = compiled.evaluate_segment(&QaSegmentInput {
        segment_id: segment.id.clone(),
        source_text: segment.source_text,
        target_text: segment.target_text,
        source_locale,
        target_locale,
        tag_findings,
        terms,
    });
    transaction.execute(
        "UPDATE qa_issues SET status = 'resolved', updated_at_ms = ?1
         WHERE segment_id = ?2 AND (
             ((rule_id LIKE 'qa.%')
                 AND rule_id <> 'qa.same-source-different-target'
                 AND rule_id <> 'qa.different-source-same-target')
         )",
        params![now, segment_id],
    )?;
    for candidate in &candidates {
        upsert_qa_candidate(transaction, None, &profile.id, candidate, now)?;
    }
    Ok(())
}

fn upsert_qa_candidate(
    connection: &Connection,
    run_id: Option<&str>,
    profile_id: &str,
    candidate: &QaFindingCandidate,
    now: i64,
) -> Result<()> {
    let existing = connection
        .query_row(
            "SELECT id FROM qa_issues
             WHERE segment_id = ?1 AND rule_id = ?2 AND fingerprint = ?3",
            params![
                candidate.segment_id,
                candidate.rule_id,
                candidate.fingerprint
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let id = existing.unwrap_or_else(new_id);
    connection.execute(
        "INSERT INTO qa_issues (
            id, segment_id, rule_id, severity, status, message, fingerprint,
            evidence_json, created_at_ms, updated_at_ms, category, profile_id, run_id
         ) VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11)
         ON CONFLICT(segment_id, rule_id, fingerprint) DO UPDATE SET
            severity = excluded.severity, status = 'open', message = excluded.message,
            evidence_json = excluded.evidence_json, updated_at_ms = excluded.updated_at_ms,
            category = excluded.category, profile_id = excluded.profile_id,
            run_id = excluded.run_id",
        params![
            id,
            candidate.segment_id,
            candidate.rule_id,
            qa_severity_text(candidate.severity),
            candidate.message,
            candidate.fingerprint,
            serde_json::to_string(&candidate.evidence)?,
            now,
            candidate.category.as_str(),
            profile_id,
            run_id,
        ],
    )?;
    Ok(())
}

fn insert_qa_run_item(connection: &Connection, run_id: &str, issue: &QaIssueView) -> Result<()> {
    connection.execute(
        "INSERT INTO qa_run_items (
            run_id, issue_id, project_id, document_id, document_name, segment_id,
            segment_ordinal, rule_id, category, severity, disposition, message,
            fingerprint, evidence_json, waiver_actor, waiver_reason
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            run_id,
            issue.id,
            issue.project_id,
            issue.document_id,
            issue.document_name,
            issue.segment_id,
            issue.segment_ordinal,
            issue.rule_id,
            issue.category.as_str(),
            qa_severity_text(issue.severity),
            qa_disposition_text(issue.disposition),
            issue.message,
            issue.fingerprint,
            serde_json::to_string(&issue.evidence)?,
            issue.waiver.as_ref().map(|waiver| waiver.actor.as_str()),
            issue.waiver.as_ref().map(|waiver| waiver.reason.as_str()),
        ],
    )?;
    Ok(())
}

impl Store {
    pub fn list_qa_issue_views(&self, filter: QaIssueFilter) -> Result<(Vec<QaIssueView>, u32)> {
        validate_page(filter.limit, MAX_ISSUE_PAGE)?;
        super::ensure_exists(&self.connection, "projects", "project", &filter.project_id)?;
        query_qa_issue_views(&self.connection, &filter)
    }

    pub fn waive_qa_issue(
        &mut self,
        issue_id: &str,
        actor: &str,
        reason: &str,
    ) -> Result<QaIssueView> {
        validate_actor_reason(actor, reason)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let issue = find_qa_issue_view(&transaction, issue_id)?;
        if issue.disposition == QaIssueDisposition::Resolved {
            return Err(StorageError::InvalidState(
                "resolved QA findings cannot be waived".to_string(),
            ));
        }
        let now = now_ms();
        transaction.execute(
            "INSERT INTO qa_waivers (
                id, issue_id, fingerprint, reason, actor, revision,
                created_at_ms, revoked_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, NULL)
             ON CONFLICT(issue_id, fingerprint) DO UPDATE SET
                reason = excluded.reason, actor = excluded.actor,
                revision = qa_waivers.revision + 1,
                created_at_ms = excluded.created_at_ms, revoked_at_ms = NULL",
            params![
                new_id(),
                issue_id,
                issue.fingerprint,
                reason.trim(),
                actor.trim(),
                now,
            ],
        )?;
        let updated = find_qa_issue_view(&transaction, issue_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn revoke_qa_waiver(
        &mut self,
        issue_id: &str,
        expected_revision: u64,
    ) -> Result<QaIssueView> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let issue = find_qa_issue_view(&transaction, issue_id)?;
        let waiver = issue
            .waiver
            .ok_or_else(|| StorageError::InvalidState("QA finding is not waived".to_string()))?;
        ensure_entity_revision("qa_waiver", &waiver.id, waiver.revision, expected_revision)?;
        transaction.execute(
            "UPDATE qa_waivers
             SET revoked_at_ms = ?1, revision = revision + 1
             WHERE id = ?2 AND revision = ?3",
            params![now_ms(), waiver.id, to_i64(expected_revision)?],
        )?;
        let updated = find_qa_issue_view(&transaction, issue_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn check_qa_gate(
        &mut self,
        project_id: &str,
        document_id: &str,
        profile_id: Option<&str>,
    ) -> Result<QaGateResult> {
        self.check_qa_gate_with_rules(project_id, document_id, profile_id, &[])
    }

    pub fn check_qa_gate_with_rules(
        &mut self,
        project_id: &str,
        document_id: &str,
        profile_id: Option<&str>,
        additional_rules: &[translunar_qa_core::QaRegexRule],
    ) -> Result<QaGateResult> {
        let run =
            self.run_qa_with_rules(project_id, Some(document_id), profile_id, additional_rules)?;
        self.qa_gate_result(document_id, run)
    }

    pub fn qa_gate_result(&self, document_id: &str, run: QaRun) -> Result<QaGateResult> {
        if run.document_id.as_deref() != Some(document_id) {
            return Err(StorageError::InvalidState(
                "QA gate run does not belong to the requested document".to_string(),
            ));
        }
        let blocker_issue_ids = self
            .connection
            .prepare(
                "SELECT i.issue_id FROM qa_run_items i
                 WHERE i.run_id = ?1 AND i.severity = 'error'
                       AND i.disposition = 'open'
                 ORDER BY i.segment_ordinal, i.rule_id, i.issue_id",
            )?
            .query_map([run.id.as_str()], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(QaGateResult {
            document_id: document_id.to_string(),
            clear: blocker_issue_ids.is_empty(),
            blocker_issue_ids,
            error_count: run.errors,
            warning_count: run.warnings,
            info_count: run.info,
            waived_count: run.waived,
            run,
        })
    }

    pub fn qa_report_snapshot(&self, run_id: &str) -> Result<QaReportSnapshot> {
        let run = self.get_qa_run(run_id)?;
        if run.status != QaRunStatus::Succeeded {
            return Err(StorageError::InvalidState(
                "QA report requires a completed run".to_string(),
            ));
        }
        let project_name = self.connection.query_row(
            "SELECT name FROM projects WHERE id = ?1",
            [&run.project_id],
            |row| row.get::<_, String>(0),
        )?;
        let scope_name = if let Some(document_id) = run.document_id.as_deref() {
            self.connection.query_row(
                "SELECT name FROM documents WHERE id = ?1",
                [document_id],
                |row| row.get::<_, String>(0),
            )?
        } else {
            "All active documents".to_string()
        };
        let mut statement = self.connection.prepare(
            "SELECT document_name, segment_id, segment_ordinal, category, rule_id,
                    severity, disposition, message, evidence_json,
                    waiver_actor, waiver_reason
             FROM qa_run_items WHERE run_id = ?1
             ORDER BY document_name, segment_ordinal, rule_id, issue_id",
        )?;
        let items = statement
            .query_map([run_id], row_to_qa_report_item)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(QaReportSnapshot {
            project_name,
            scope_name,
            run_id: run.id,
            profile_name: run.profile_name,
            created_at_ms: run.created_at_ms,
            checked_segments: run.checked_segments,
            errors: run.errors,
            warnings: run.warnings,
            info: run.info,
            waived: run.waived,
            plugin_rules: run.plugin_rules,
            items,
        })
    }

    pub fn record_qa_report(
        &mut self,
        run_id: &str,
        format: QaReportFormat,
        output_path: &str,
    ) -> Result<QaReportRecord> {
        self.get_qa_run(run_id)?;
        let id = new_id();
        let now = now_ms();
        self.connection.execute(
            "INSERT INTO qa_report_records (id, run_id, format, output_path, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, run_id, qa_report_format_text(format), output_path, now],
        )?;
        Ok(QaReportRecord {
            id,
            run_id: run_id.to_string(),
            format,
            output_path: output_path.to_string(),
            created_at_ms: now,
        })
    }

    pub fn create_qa_export_override(
        &mut self,
        gate: &QaGateResult,
        project_id: &str,
        actor: &str,
        reason: &str,
        destination_name: &str,
    ) -> Result<QaExportOverride> {
        validate_actor_reason(actor, reason)?;
        if gate.clear || gate.error_count == 0 {
            return Err(StorageError::InvalidState(
                "a clear QA gate does not require an override".to_string(),
            ));
        }
        if destination_name.trim().is_empty() || destination_name.chars().count() > 260 {
            return Err(StorageError::InvalidState(
                "override destination name must contain 1..260 characters".to_string(),
            ));
        }
        let id = new_id();
        let now = now_ms();
        self.connection.execute(
            "INSERT INTO qa_export_overrides (
                id, project_id, document_id, run_id, actor, reason, error_count,
                destination_name, status, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?9)",
            params![
                id,
                project_id,
                gate.document_id,
                gate.run.id,
                actor.trim(),
                reason.trim(),
                to_i64(gate.error_count)?,
                destination_name.trim(),
                now,
            ],
        )?;
        find_qa_override(&self.connection, &id)
    }

    pub fn finish_qa_export_override(
        &mut self,
        override_id: &str,
        succeeded: bool,
    ) -> Result<QaExportOverride> {
        let current = find_qa_override(&self.connection, override_id)?;
        if current.status != QaOverrideStatus::Pending {
            return Ok(current);
        }
        self.connection.execute(
            "UPDATE qa_export_overrides SET status = ?1, updated_at_ms = ?2
             WHERE id = ?3 AND status = 'pending'",
            params![
                qa_override_status_text(if succeeded {
                    QaOverrideStatus::Succeeded
                } else {
                    QaOverrideStatus::Failed
                }),
                now_ms(),
                override_id,
            ],
        )?;
        find_qa_override(&self.connection, override_id)
    }

    pub fn get_qa_export_override(&self, override_id: &str) -> Result<QaExportOverride> {
        find_qa_override(&self.connection, override_id)
    }

    pub fn list_qa_export_overrides(
        &self,
        project_id: &str,
        document_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<QaExportOverride>, u32)> {
        validate_page(limit, 200)?;
        super::ensure_exists(&self.connection, "projects", "project", project_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM qa_export_overrides
             WHERE project_id = ?1 AND (?2 IS NULL OR document_id = ?2)",
            params![project_id, document_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, document_id, run_id, actor, reason,
                    error_count, destination_name, status, created_at_ms, updated_at_ms
             FROM qa_export_overrides
             WHERE project_id = ?1 AND (?2 IS NULL OR document_id = ?2)
             ORDER BY created_at_ms DESC, id
             LIMIT ?3 OFFSET ?4",
        )?;
        let items = statement
            .query_map(
                params![project_id, document_id, limit, offset],
                row_to_qa_override,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn review_statistics(
        &self,
        project_id: &str,
        document_id: Option<&str>,
    ) -> Result<ReviewStatistics> {
        super::ensure_exists(&self.connection, "projects", "project", project_id)?;
        let (translation_segments, review_segments, signed_segments) = self.connection.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN m.workflow_state = 'translation' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN m.workflow_state = 'review' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN m.workflow_state = 'signed' THEN 1 ELSE 0 END), 0)
             FROM segment_editor_meta m
             JOIN segments s ON s.id = m.segment_id
             JOIN documents d ON d.id = s.document_id
             WHERE d.project_id = ?1 AND (?2 IS NULL OR d.id = ?2)",
            params![project_id, document_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )?;
        let mut reviewer_rows = self.connection.prepare(
            "SELECT r.author, r.status, COUNT(*),
                    COALESCE(SUM(LENGTH(r.proposed_target)), 0)
             FROM review_revisions r
             JOIN segments s ON s.id = r.segment_id
             JOIN documents d ON d.id = s.document_id
             WHERE d.project_id = ?1 AND (?2 IS NULL OR d.id = ?2)
             GROUP BY r.author, r.status
             ORDER BY r.author, r.status",
        )?;
        let rows = reviewer_rows
            .query_map(params![project_id, document_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut reviewers: BTreeMap<String, ReviewerStatistic> = BTreeMap::new();
        let mut pending_revisions = 0_u64;
        let mut accepted_revisions = 0_u64;
        let mut rejected_revisions = 0_u64;
        let mut reviewed_characters = 0_u64;
        for (reviewer, status, count, characters) in rows {
            let count = count_to_u64(count)?;
            let characters = count_to_u64(characters)?;
            let item = reviewers
                .entry(reviewer.clone())
                .or_insert(ReviewerStatistic {
                    reviewer,
                    accepted: 0,
                    rejected: 0,
                    pending: 0,
                    reviewed_characters: 0,
                });
            match status.as_str() {
                "pending" => {
                    item.pending += count;
                    pending_revisions += count;
                }
                "accepted" => {
                    item.accepted += count;
                    accepted_revisions += count;
                }
                "rejected" => {
                    item.rejected += count;
                    rejected_revisions += count;
                }
                _ => {}
            }
            item.reviewed_characters += characters;
            reviewed_characters += characters;
        }
        Ok(ReviewStatistics {
            project_id: project_id.to_string(),
            document_id: document_id.map(str::to_string),
            translation_segments: count_to_u64(translation_segments)?,
            review_segments: count_to_u64(review_segments)?,
            signed_segments: count_to_u64(signed_segments)?,
            pending_revisions,
            accepted_revisions,
            rejected_revisions,
            reviewed_characters,
            reviewers: reviewers.into_values().collect(),
        })
    }

    pub fn list_review_queue(
        &self,
        project_id: &str,
        document_id: Option<&str>,
        status: Option<ReviewStatus>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<ReviewQueueItem>, u32)> {
        validate_page(limit, 500)?;
        super::ensure_exists(&self.connection, "projects", "project", project_id)?;
        let status = status.map(super::review_status_text);
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM review_revisions r
             JOIN segments s ON s.id = r.segment_id
             JOIN documents d ON d.id = s.document_id
             WHERE d.project_id = ?1 AND (?2 IS NULL OR d.id = ?2)
                   AND (?3 IS NULL OR r.status = ?3)",
            params![project_id, document_id, status],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT r.id, r.segment_id, r.base_revision, r.before_target,
                    r.proposed_target, r.author, r.reason, r.status,
                    r.created_at_ms, r.updated_at_ms, r.before_source,
                    r.proposed_source, r.before_target_tags_json,
                    r.proposed_target_tags_json, d.project_id, d.id, d.name, s.ordinal
             FROM review_revisions r
             JOIN segments s ON s.id = r.segment_id
             JOIN documents d ON d.id = s.document_id
             WHERE d.project_id = ?1 AND (?2 IS NULL OR d.id = ?2)
                   AND (?3 IS NULL OR r.status = ?3)
             ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,
                      r.updated_at_ms DESC, d.relative_path, d.id, s.ordinal, r.id
             LIMIT ?4 OFFSET ?5",
        )?;
        let items = statement
            .query_map(
                params![project_id, document_id, status, limit, offset],
                |row| {
                    Ok(ReviewQueueItem {
                        revision: super::row_to_review(row)?,
                        project_id: row.get(14)?,
                        document_id: row.get(15)?,
                        document_name: row.get(16)?,
                        segment_ordinal: read_u32(row, 17)?,
                    })
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }
}

fn find_qa_profile(connection: &Connection, profile_id: &str) -> Result<QaProfile> {
    connection
        .query_row(
            "SELECT id, name, owner_project_id, built_in, definition_json,
                    revision, created_at_ms, updated_at_ms
             FROM qa_profiles WHERE id = ?1",
            [profile_id],
            row_to_qa_profile,
        )
        .optional()?
        .ok_or_else(|| not_found("qa_profile", profile_id))
}

fn row_to_qa_profile(row: &Row<'_>) -> rusqlite::Result<QaProfile> {
    let id = row.get::<_, String>(0)?;
    let name = row.get::<_, String>(1)?;
    let built_in = row.get::<_, bool>(3)?;
    let definition_json = row.get::<_, String>(4)?;
    let definition = if built_in && definition_json == "{}" {
        built_in_profiles()
            .into_iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| {
                conversion_error(
                    4,
                    StorageError::InvalidData("unknown built-in QA profile".to_string()),
                )
            })?
    } else {
        serde_json::from_str(&definition_json).map_err(|error| conversion_error(4, error))?
    };
    Ok(QaProfile {
        id,
        name,
        owner_project_id: row.get(2)?,
        built_in,
        definition,
        revision: read_u64(row, 5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn validate_profile_name(name: &str) -> Result<()> {
    if name.trim().is_empty() || name.chars().count() > 120 {
        return Err(StorageError::QaProfileInvalid(
            "QA profile name must contain 1..120 characters".to_string(),
        ));
    }
    Ok(())
}

fn count_to_u64(value: i64) -> Result<u64> {
    u64::try_from(value)
        .map_err(|_| StorageError::InvalidData(format!("negative or overflowing count {value}")))
}

fn validate_page(limit: u32, max: u32) -> Result<()> {
    if !(1..=max).contains(&limit) {
        return Err(StorageError::InvalidState(format!(
            "page limit must be between 1 and {max}"
        )));
    }
    Ok(())
}

fn query_current_run_issue_views(
    connection: &Connection,
    run_id: &str,
) -> Result<Vec<QaIssueView>> {
    let mut statement = connection.prepare(&format!(
        "{} WHERE q.run_id = ?1 AND q.status = 'open'
         ORDER BY d.relative_path, d.name, d.id, s.ordinal, q.rule_id, q.id",
        qa_issue_view_select()
    ))?;
    Ok(statement
        .query_map([run_id], row_to_qa_issue_view)?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

fn query_qa_issue_views(
    connection: &Connection,
    filter: &QaIssueFilter,
) -> Result<(Vec<QaIssueView>, u32)> {
    let severity = filter.severity.map(qa_severity_text);
    let category = filter.category.map(QaCategory::as_str);
    let disposition = filter.disposition.map(qa_disposition_text);
    let where_sql = " WHERE p.id = ?1
        AND (?2 IS NULL OR d.id = ?2)
        AND (?3 IS NULL OR s.id = ?3)
        AND (?4 IS NULL OR q.severity = ?4)
        AND (?5 IS NULL OR q.category = ?5)
        AND (?6 IS NULL OR q.rule_id = ?6)
        AND (
            ?7 IS NULL
            OR (?7 = 'resolved' AND q.status = 'resolved')
            OR (?7 = 'waived' AND q.status = 'open' AND w.id IS NOT NULL)
            OR (?7 = 'open' AND q.status = 'open' AND w.id IS NULL)
        )";
    let total = connection.query_row(
        &format!(
            "SELECT COUNT(*) FROM qa_issues q
             JOIN segments s ON s.id = q.segment_id
             JOIN documents d ON d.id = s.document_id
             JOIN projects p ON p.id = d.project_id
             LEFT JOIN qa_waivers w ON w.issue_id = q.id
                 AND w.fingerprint = q.fingerprint AND w.revoked_at_ms IS NULL{where_sql}"
        ),
        params![
            filter.project_id,
            filter.document_id,
            filter.segment_id,
            severity,
            category,
            filter.rule_id,
            disposition,
        ],
        |row| row.get::<_, i64>(0),
    )?;
    let mut statement = connection.prepare(&format!(
        "{}{where_sql}
         ORDER BY d.relative_path, d.name, d.id, s.ordinal, q.rule_id, q.id
         LIMIT ?8 OFFSET ?9",
        qa_issue_view_select()
    ))?;
    let items = statement
        .query_map(
            params![
                filter.project_id,
                filter.document_id,
                filter.segment_id,
                severity,
                category,
                filter.rule_id,
                disposition,
                filter.limit,
                filter.offset,
            ],
            row_to_qa_issue_view,
        )?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok((items, to_u32(total)?))
}

fn find_qa_issue_view(connection: &Connection, issue_id: &str) -> Result<QaIssueView> {
    connection
        .query_row(
            &format!("{} WHERE q.id = ?1", qa_issue_view_select()),
            [issue_id],
            row_to_qa_issue_view,
        )
        .optional()?
        .ok_or_else(|| not_found("qa_issue", issue_id))
}

fn qa_issue_view_select() -> &'static str {
    "SELECT q.id, p.id, d.id, d.name, s.id, s.ordinal, q.rule_id, q.category,
            q.severity, q.status, q.message, q.fingerprint, q.evidence_json,
            q.profile_id, q.run_id, q.created_at_ms, q.updated_at_ms,
            w.id, w.issue_id, w.fingerprint, w.reason, w.actor, w.revision,
            w.created_at_ms, w.revoked_at_ms
     FROM qa_issues q
     JOIN segments s ON s.id = q.segment_id
     JOIN documents d ON d.id = s.document_id
     JOIN projects p ON p.id = d.project_id
     LEFT JOIN qa_waivers w ON w.issue_id = q.id
         AND w.fingerprint = q.fingerprint AND w.revoked_at_ms IS NULL"
}

fn row_to_qa_issue_view(row: &Row<'_>) -> rusqlite::Result<QaIssueView> {
    let status = row.get::<_, String>(9)?;
    let waiver_id = row.get::<_, Option<String>>(17)?;
    let waiver = if let Some(id) = waiver_id {
        Some(QaWaiver {
            id,
            issue_id: row.get(18)?,
            fingerprint: row.get(19)?,
            reason: row.get(20)?,
            actor: row.get(21)?,
            revision: read_u64(row, 22)?,
            created_at_ms: row.get(23)?,
            revoked_at_ms: row.get(24)?,
        })
    } else {
        None
    };
    let disposition = if status == "resolved" {
        QaIssueDisposition::Resolved
    } else if waiver.is_some() {
        QaIssueDisposition::Waived
    } else {
        QaIssueDisposition::Open
    };
    Ok(QaIssueView {
        id: row.get(0)?,
        project_id: row.get(1)?,
        document_id: row.get(2)?,
        document_name: row.get(3)?,
        segment_id: row.get(4)?,
        segment_ordinal: read_u32(row, 5)?,
        rule_id: row.get(6)?,
        category: parse_qa_category(row.get(7)?, 7)?,
        severity: parse_qa_severity(row.get(8)?, 8)?,
        disposition,
        message: row.get(10)?,
        fingerprint: row.get(11)?,
        evidence: serde_json::from_str(&row.get::<_, String>(12)?)
            .map_err(|error| conversion_error(12, error))?,
        profile_id: row.get(13)?,
        run_id: row.get(14)?,
        waiver,
        created_at_ms: row.get(15)?,
        updated_at_ms: row.get(16)?,
    })
}

fn find_qa_run(connection: &Connection, run_id: &str) -> Result<QaRun> {
    let mut run = connection
        .query_row(
            "SELECT id, project_id, document_id, scope, profile_id, profile_name,
                    profile_revision, profile_snapshot_hash, status, checked_segments,
                    errors, warnings, info, waived, created_at_ms, completed_at_ms
             FROM qa_runs WHERE id = ?1",
            [run_id],
            row_to_qa_run,
        )
        .optional()?
        .ok_or_else(|| not_found("qa_run", run_id))?;
    run.plugin_rules = query_qa_plugin_rule_snapshots(connection, run_id)?;
    Ok(run)
}

fn row_to_qa_run(row: &Row<'_>) -> rusqlite::Result<QaRun> {
    Ok(QaRun {
        id: row.get(0)?,
        project_id: row.get(1)?,
        document_id: row.get(2)?,
        scope: parse_qa_run_scope(row.get(3)?, 3)?,
        profile_id: row.get(4)?,
        profile_name: row.get(5)?,
        profile_revision: read_u64(row, 6)?,
        profile_snapshot_hash: row.get(7)?,
        status: parse_qa_run_status(row.get(8)?, 8)?,
        checked_segments: read_u64(row, 9)?,
        errors: read_u64(row, 10)?,
        warnings: read_u64(row, 11)?,
        info: read_u64(row, 12)?,
        waived: read_u64(row, 13)?,
        created_at_ms: row.get(14)?,
        completed_at_ms: row.get(15)?,
        plugin_rules: Vec::new(),
    })
}

fn query_qa_plugin_rule_snapshots(
    connection: &Connection,
    run_id: &str,
) -> Result<Vec<QaRunPluginRuleSnapshot>> {
    let mut statement = connection.prepare(
        "SELECT contribution_index, plugin_id, version_id, contribution_id,
                contribution_version, descriptor_version,
                operation_protocol_version, config_schema_version,
                activation_revision, tier, descriptor_hash, config_hash,
                rule_ids_json, status, execution_count, finding_count,
                input_hash, output_hash, usage_json, failure_json
         FROM qa_run_plugin_rules
         WHERE run_id = ?1
         ORDER BY contribution_index",
    )?;
    Ok(statement
        .query_map([run_id], |row| {
            Ok(QaRunPluginRuleSnapshot {
                contribution_index: read_u32(row, 0)?,
                provenance: QaRuleProvenanceSnapshot {
                    plugin_id: row.get(1)?,
                    version_id: row.get(2)?,
                    contribution_id: row.get(3)?,
                    contribution_version: row.get(4)?,
                    descriptor_version: read_u32(row, 5)?,
                    operation_protocol_version: read_u32(row, 6)?,
                    config_schema_version: read_u32(row, 7)?,
                    activation_revision: read_u64(row, 8)?,
                    tier: row.get(9)?,
                    descriptor_hash: row.get(10)?,
                    config_hash: row.get(11)?,
                    rule_ids: serde_json::from_str(&row.get::<_, String>(12)?)
                        .map_err(|error| conversion_error(12, error))?,
                },
                status: parse_qa_rule_execution_status(row.get(13)?, 13)?,
                execution_count: read_u32(row, 14)?,
                finding_count: read_u32(row, 15)?,
                input_hash: row.get(16)?,
                output_hash: row.get(17)?,
                usage: serde_json::from_str::<QaRuleExecutionUsage>(&row.get::<_, String>(18)?)
                    .map_err(|error| conversion_error(18, error))?,
                failure: row
                    .get::<_, Option<String>>(19)?
                    .map(|value| serde_json::from_str::<QaRuleExecutionFailure>(&value))
                    .transpose()
                    .map_err(|error| conversion_error(19, error))?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

fn row_to_qa_report_item(row: &Row<'_>) -> rusqlite::Result<QaReportItem> {
    let evidence = serde_json::from_str::<QaCandidateEvidence>(&row.get::<_, String>(8)?)
        .map_err(|error| conversion_error(8, error))?;
    Ok(QaReportItem {
        document_name: row.get(0)?,
        segment_id: row.get(1)?,
        segment_ordinal: read_u32(row, 2)?,
        category: parse_qa_category(row.get(3)?, 3)?,
        rule_id: row.get(4)?,
        severity: parse_qa_severity(row.get(5)?, 5)?,
        disposition: row.get(6)?,
        message: row.get(7)?,
        source_evidence: evidence
            .source_numbers
            .iter()
            .chain(&evidence.source_values)
            .cloned()
            .collect::<Vec<_>>()
            .join(", "),
        target_evidence: evidence
            .target_numbers
            .iter()
            .chain(&evidence.target_values)
            .cloned()
            .collect::<Vec<_>>()
            .join(", "),
        waiver_actor: row.get(9)?,
        waiver_reason: row.get(10)?,
    })
}

fn find_qa_override(connection: &Connection, override_id: &str) -> Result<QaExportOverride> {
    connection
        .query_row(
            "SELECT id, project_id, document_id, run_id, actor, reason,
                    error_count, destination_name, status, created_at_ms, updated_at_ms
             FROM qa_export_overrides WHERE id = ?1",
            [override_id],
            row_to_qa_override,
        )
        .optional()?
        .ok_or_else(|| not_found("qa_export_override", override_id))
}

fn row_to_qa_override(row: &Row<'_>) -> rusqlite::Result<QaExportOverride> {
    Ok(QaExportOverride {
        id: row.get(0)?,
        project_id: row.get(1)?,
        document_id: row.get(2)?,
        run_id: row.get(3)?,
        actor: row.get(4)?,
        reason: row.get(5)?,
        error_count: read_u64(row, 6)?,
        destination_name: row.get(7)?,
        status: parse_qa_override_status(row.get(8)?, 8)?,
        created_at_ms: row.get(9)?,
        updated_at_ms: row.get(10)?,
    })
}

fn validate_actor_reason(actor: &str, reason: &str) -> Result<()> {
    if actor.trim().is_empty() || actor.chars().count() > MAX_ACTOR_CHARS {
        return Err(StorageError::InvalidState(format!(
            "actor must contain 1..{MAX_ACTOR_CHARS} characters"
        )));
    }
    if reason.trim().is_empty() || reason.chars().count() > MAX_REASON_CHARS {
        return Err(StorageError::InvalidState(format!(
            "reason must contain 1..{MAX_REASON_CHARS} characters"
        )));
    }
    Ok(())
}

fn qa_run_scope_text(scope: QaRunScope) -> &'static str {
    match scope {
        QaRunScope::Document => "document",
        QaRunScope::Project => "project",
    }
}

fn qa_rule_execution_status_text(status: QaRuleExecutionStatus) -> &'static str {
    match status {
        QaRuleExecutionStatus::Succeeded => "succeeded",
        QaRuleExecutionStatus::Failed => "failed",
        QaRuleExecutionStatus::Canceled => "canceled",
    }
}

fn qa_severity_text(severity: QaSeverity) -> &'static str {
    match severity {
        QaSeverity::Error => "error",
        QaSeverity::Warning => "warning",
        QaSeverity::Info => "info",
    }
}

fn qa_disposition_text(disposition: QaIssueDisposition) -> &'static str {
    match disposition {
        QaIssueDisposition::Open => "open",
        QaIssueDisposition::Waived => "waived",
        QaIssueDisposition::Resolved => "resolved",
    }
}

fn qa_report_format_text(format: QaReportFormat) -> &'static str {
    match format {
        QaReportFormat::Html => "html",
        QaReportFormat::Xlsx => "xlsx",
    }
}

fn qa_override_status_text(status: QaOverrideStatus) -> &'static str {
    match status {
        QaOverrideStatus::Pending => "pending",
        QaOverrideStatus::Succeeded => "succeeded",
        QaOverrideStatus::Failed => "failed",
    }
}

fn parse_qa_category(value: String, column: usize) -> rusqlite::Result<QaCategory> {
    match value.as_str() {
        "completeness" => Ok(QaCategory::Completeness),
        "numbers" => Ok(QaCategory::Numbers),
        "tags" => Ok(QaCategory::Tags),
        "punctuation" => Ok(QaCategory::Punctuation),
        "whitespace" => Ok(QaCategory::Whitespace),
        "repetition" => Ok(QaCategory::Repetition),
        "length" => Ok(QaCategory::Length),
        "terminology" => Ok(QaCategory::Terminology),
        "consistency" => Ok(QaCategory::Consistency),
        "custom" => Ok(QaCategory::Custom),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown QA category {value}")),
        )),
    }
}

fn parse_qa_run_scope(value: String, column: usize) -> rusqlite::Result<QaRunScope> {
    match value.as_str() {
        "document" => Ok(QaRunScope::Document),
        "project" => Ok(QaRunScope::Project),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown QA run scope {value}")),
        )),
    }
}

fn parse_qa_run_status(value: String, column: usize) -> rusqlite::Result<QaRunStatus> {
    match value.as_str() {
        "running" => Ok(QaRunStatus::Running),
        "succeeded" => Ok(QaRunStatus::Succeeded),
        "failed" => Ok(QaRunStatus::Failed),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown QA run status {value}")),
        )),
    }
}

fn parse_qa_rule_execution_status(
    value: String,
    column: usize,
) -> rusqlite::Result<QaRuleExecutionStatus> {
    match value.as_str() {
        "succeeded" => Ok(QaRuleExecutionStatus::Succeeded),
        "failed" => Ok(QaRuleExecutionStatus::Failed),
        "canceled" => Ok(QaRuleExecutionStatus::Canceled),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown QA rule execution status {value}")),
        )),
    }
}

fn parse_qa_override_status(value: String, column: usize) -> rusqlite::Result<QaOverrideStatus> {
    match value.as_str() {
        "pending" => Ok(QaOverrideStatus::Pending),
        "succeeded" => Ok(QaOverrideStatus::Succeeded),
        "failed" => Ok(QaOverrideStatus::Failed),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown QA override status {value}")),
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use tempfile::TempDir;
    use translunar_asset_core::TermStatus;
    use translunar_domain::{EditorWorkflowState, Project, Segment};
    use translunar_filter_core::ImportedUnit;
    use translunar_qa_core::{
        CJK_PROFILE_ID, QaField, QaRegexRule, STANDARD_PROFILE_ID, standard_profile,
    };

    use super::super::{
        NewDocument, NewTermEntry, NewTermTranslation, ProjectUpdate, ReviewProposal, StorageError,
        Store,
    };
    use super::*;

    struct QaFixture {
        temp: TempDir,
        store: Store,
        project: Project,
        document_id: String,
        segments: Vec<Segment>,
    }

    impl QaFixture {
        fn new() -> Self {
            let temp = tempfile::tempdir().expect("temporary QA directory");
            let mut store = Store::open(temp.path()).expect("open QA store");
            let project = store
                .create_project("QA fixture", "en-US", "zh-CN", "legal")
                .expect("create QA project");
            let document_id = new_id();
            let input = NewDocument {
                id: document_id.clone(),
                project_id: project.id.clone(),
                name: "dirty-fixture.txt".to_string(),
                relative_path: "dirty-fixture.txt".to_string(),
                format: "txt".to_string(),
                filter_id: "builtin.txt".to_string(),
                source_sha256: "dirty-fixture-hash".to_string(),
                degradation: Vec::new(),
                original_source_path: temp.path().join("dirty-fixture.txt"),
                managed_source_path: store.paths().managed_docx(&document_id),
            };
            let units = [
                "The retention period is 30 days.",
                "This paragraph is required.",
                "Click Save.",
                "Click Save.",
                "Store the file.",
                "Pending text.",
            ]
            .into_iter()
            .enumerate()
            .map(|(ordinal, source)| {
                ImportedUnit::plain(ordinal as u32, format!("txt:{ordinal}"), source)
            })
            .collect::<Vec<_>>();
            store
                .insert_document(&input, &units)
                .expect("insert QA document");
            let mut segments = store.all_segments(&document_id).expect("list QA segments");
            for (index, target) in [
                "保留期为 60 天。",
                "这里包含禁用词。",
                "单击保存。",
                "点击保存。",
                "点击保存。",
            ]
            .into_iter()
            .enumerate()
            {
                segments[index] = store
                    .update_target(&segments[index].id, target, segments[index].revision)
                    .expect("seed target");
            }
            Self {
                temp,
                store,
                project,
                document_id,
                segments,
            }
        }

        fn add_terminology(&mut self) {
            let termbase = self
                .store
                .list_termbases(Some(&self.project.id), 0, 20)
                .expect("list project termbases")
                .0
                .remove(0);
            self.store
                .upsert_term_entry(NewTermEntry {
                    termbase_id: termbase.id,
                    source_locale: "en-US".to_string(),
                    source_term: "paragraph".to_string(),
                    part_of_speech: Some("noun".to_string()),
                    definition: None,
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
                .expect("insert QA terminology");
        }

        fn issue_filter(&self) -> QaIssueFilter {
            QaIssueFilter {
                project_id: self.project.id.clone(),
                document_id: Some(self.document_id.clone()),
                segment_id: None,
                severity: None,
                category: None,
                disposition: None,
                rule_id: None,
                offset: 0,
                limit: 500,
            }
        }
    }

    fn execution_record(prepared: &PreparedQaRun) -> QaRuleExecutionRecord {
        QaRuleExecutionRecord {
            provenance: QaRuleProvenanceSnapshot {
                plugin_id: "example.plugin".to_string(),
                version_id: "inventory-v2:example.plugin:1.0.0+build.1".to_string(),
                contribution_id: "example.qa".to_string(),
                contribution_version: "1.0.0".to_string(),
                descriptor_version: 1,
                operation_protocol_version: 1,
                config_schema_version: 1,
                activation_revision: 7,
                tier: "sandbox".to_string(),
                descriptor_hash: "a".repeat(64),
                config_hash: "b".repeat(64),
                rule_ids: vec!["qa.plugin.example.rule".to_string()],
            },
            status: QaRuleExecutionStatus::Succeeded,
            execution_count: u32::try_from(prepared.segments.len()).expect("segment count"),
            input_hash: prepared.input_snapshot_hash.clone(),
            output_hash: Some(sha256_hex(b"[]")),
            finding_count: 0,
            usage: QaRuleExecutionUsage {
                work_units: 1,
                input_bytes: 2,
                output_bytes: 2,
            },
            failure: None,
        }
    }

    fn failed_execution_record(prepared: &PreparedQaRun) -> QaRuleExecutionRecord {
        let mut record = execution_record(prepared);
        record.status = QaRuleExecutionStatus::Failed;
        record.execution_count = 1;
        record.output_hash = None;
        record.finding_count = 0;
        record.failure = Some(QaRuleExecutionFailure {
            code: "plugin_protocol".to_string(),
            message: "Plugin QA rule execution failed.".to_string(),
            retryable: false,
        });
        record
    }

    #[test]
    fn prepared_run_rejects_stale_inputs_without_partial_writes() {
        let mut fixture = QaFixture::new();
        let prepared = fixture
            .store
            .prepare_qa_run(
                &fixture.project.id,
                Some(&fixture.document_id),
                Some(STANDARD_PROFILE_ID),
            )
            .expect("prepare QA run");
        let evaluated = Store::evaluate_prepared_qa_run(&prepared).expect("evaluate QA run");
        let before = fixture
            .store
            .connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM qa_runs),
                        (SELECT COUNT(*) FROM qa_issues WHERE status = 'resolved')",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("read QA state");
        fixture
            .store
            .connection
            .execute(
                "UPDATE segments
                 SET target_text = target_text || ' changed', revision = revision + 1
                 WHERE id = ?1",
                [&fixture.segments[0].id],
            )
            .expect("mutate prepared segment");

        assert!(matches!(
            fixture.store.commit_prepared_qa_run(prepared, evaluated),
            Err(StorageError::InvalidState(_))
        ));
        let after = fixture
            .store
            .connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM qa_runs),
                        (SELECT COUNT(*) FROM qa_issues WHERE status = 'resolved')",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("read unchanged QA state");
        assert_eq!(after, before);
    }

    #[test]
    fn completed_run_persists_immutable_plugin_execution_snapshot() {
        let mut fixture = QaFixture::new();
        let prepared = fixture
            .store
            .prepare_qa_run(
                &fixture.project.id,
                Some(&fixture.document_id),
                Some(STANDARD_PROFILE_ID),
            )
            .expect("prepare QA run");
        let record = execution_record(&prepared);
        let mut evaluated = Store::evaluate_prepared_qa_run(&prepared).expect("evaluate QA run");
        evaluated.plugin_rules.push(record.clone());
        let run = fixture
            .store
            .commit_prepared_qa_run(prepared, evaluated)
            .expect("commit QA run");
        assert_eq!(run.plugin_rules.len(), 1);
        assert_eq!(run.plugin_rules[0].provenance, record.provenance);
        assert_eq!(run.plugin_rules[0].execution_count, record.execution_count);
        let report = fixture
            .store
            .qa_report_snapshot(&run.id)
            .expect("read report snapshot");
        assert_eq!(report.plugin_rules, run.plugin_rules);
        assert!(
            fixture
                .store
                .connection
                .execute(
                    "UPDATE qa_run_plugin_rules SET finding_count = 1 WHERE run_id = ?1",
                    [&run.id],
                )
                .is_err()
        );
    }

    #[test]
    fn failed_run_persists_only_sanitized_plugin_history() {
        let mut fixture = QaFixture::new();
        fixture
            .store
            .run_qa(
                &fixture.project.id,
                Some(&fixture.document_id),
                Some(STANDARD_PROFILE_ID),
            )
            .expect("seed current QA issues");
        let issues_before = fixture
            .store
            .list_qa_issue_views(fixture.issue_filter())
            .expect("list issues before failed run")
            .0;
        let prepared = fixture
            .store
            .prepare_qa_run(
                &fixture.project.id,
                Some(&fixture.document_id),
                Some(STANDARD_PROFILE_ID),
            )
            .expect("prepare failed QA run");
        let failed_record = failed_execution_record(&prepared);
        let run = fixture
            .store
            .commit_failed_prepared_qa_run(prepared, vec![failed_record.clone()])
            .expect("commit failed QA history");

        assert_eq!(run.status, QaRunStatus::Failed);
        assert_eq!(run.checked_segments, 0);
        assert_eq!(run.errors + run.warnings + run.info + run.waived, 0);
        assert_eq!(run.plugin_rules.len(), 1);
        assert_eq!(run.plugin_rules[0].status, QaRuleExecutionStatus::Failed);
        assert_eq!(run.plugin_rules[0].failure, failed_record.failure);
        let run_item_count = fixture
            .store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM qa_run_items WHERE run_id = ?1",
                [&run.id],
                |row| row.get::<_, i64>(0),
            )
            .expect("count failed run items");
        assert_eq!(run_item_count, 0);
        let issues_after = fixture
            .store
            .list_qa_issue_views(fixture.issue_filter())
            .expect("list issues after failed run")
            .0;
        assert_eq!(issues_after, issues_before);
    }

    #[test]
    fn failed_run_rejects_stale_inputs_without_history() {
        let mut fixture = QaFixture::new();
        let prepared = fixture
            .store
            .prepare_qa_run(
                &fixture.project.id,
                Some(&fixture.document_id),
                Some(STANDARD_PROFILE_ID),
            )
            .expect("prepare failed QA run");
        let failed_record = failed_execution_record(&prepared);
        let run_id = prepared.run_id.clone();
        fixture
            .store
            .connection
            .execute(
                "UPDATE segments
                 SET target_text = target_text || ' changed', revision = revision + 1
                 WHERE id = ?1",
                [&fixture.segments[0].id],
            )
            .expect("mutate prepared segment");

        assert!(matches!(
            fixture
                .store
                .commit_failed_prepared_qa_run(prepared, vec![failed_record]),
            Err(StorageError::InvalidState(_))
        ));
        let persisted = fixture
            .store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM qa_runs WHERE id = ?1",
                [&run_id],
                |row| row.get::<_, i64>(0),
            )
            .expect("count stale failed run");
        assert_eq!(persisted, 0);
    }

    #[test]
    fn profile_crud_locale_defaults_and_snapshots_survive_restart() {
        let mut fixture = QaFixture::new();
        let (profiles, total) = fixture
            .store
            .list_qa_profiles(Some(&fixture.project.id), 0, 20)
            .expect("list built-in profiles");
        assert_eq!(total, 2);
        assert!(profiles.iter().all(|profile| profile.built_in));
        assert_eq!(
            fixture
                .store
                .resolve_qa_profile(&fixture.project.id, None)
                .expect("resolve locale profile")
                .id,
            CJK_PROFILE_ID
        );

        let mut invalid = standard_profile();
        invalid.regex_rules.push(QaRegexRule {
            id: "broken".to_string(),
            label: "Broken".to_string(),
            field: QaField::Target,
            pattern: "(".to_string(),
            severity: QaSeverity::Error,
            message: "Broken regex".to_string(),
            replacement_hint: None,
        });
        assert!(matches!(
            fixture.store.create_qa_profile(NewQaProfile {
                name: "Invalid".to_string(),
                owner_project_id: Some(fixture.project.id.clone()),
                definition: invalid,
            }),
            Err(StorageError::QaProfileInvalid(_))
        ));

        let custom = fixture
            .store
            .create_qa_profile(NewQaProfile {
                name: "Legal delivery".to_string(),
                owner_project_id: Some(fixture.project.id.clone()),
                definition: standard_profile(),
            })
            .expect("create custom profile");
        let clone = fixture
            .store
            .clone_qa_profile(
                &custom.id,
                Some(fixture.project.id.clone()),
                "Legal delivery clone".to_string(),
            )
            .expect("clone profile");
        let mut changed_definition = custom.definition.clone();
        changed_definition.settings.max_target_chars = Some(80);
        let updated = fixture
            .store
            .update_qa_profile(
                &custom.id,
                QaProfileUpdate {
                    name: "Legal delivery v2".to_string(),
                    definition: changed_definition.clone(),
                    expected_revision: custom.revision,
                },
            )
            .expect("update profile");
        assert_eq!(updated.revision, 1);
        assert!(matches!(
            fixture.store.update_qa_profile(
                &custom.id,
                QaProfileUpdate {
                    name: "stale".to_string(),
                    definition: changed_definition,
                    expected_revision: 0,
                },
            ),
            Err(StorageError::EntityConflict { .. })
        ));
        assert!(matches!(
            fixture.store.update_qa_profile(
                STANDARD_PROFILE_ID,
                QaProfileUpdate {
                    name: "mutated built-in".to_string(),
                    definition: standard_profile(),
                    expected_revision: 0,
                },
            ),
            Err(StorageError::InvalidState(_))
        ));

        let run = fixture
            .store
            .run_qa(
                &fixture.project.id,
                Some(&fixture.document_id),
                Some(&custom.id),
            )
            .expect("run custom profile");
        fixture
            .store
            .update_qa_profile(
                &custom.id,
                QaProfileUpdate {
                    name: "Renamed after run".to_string(),
                    definition: updated.definition,
                    expected_revision: updated.revision,
                },
            )
            .expect("rename profile after run");
        assert_eq!(
            fixture
                .store
                .qa_report_snapshot(&run.id)
                .expect("read immutable run snapshot")
                .profile_name,
            "Legal delivery v2"
        );
        fixture
            .store
            .delete_qa_profile(&clone.id, clone.revision)
            .expect("delete unused clone");

        let QaFixture { temp, store, .. } = fixture;
        drop(store);
        let reopened = Store::open(temp.path()).expect("reopen QA store");
        let persisted = reopened
            .get_qa_profile(&custom.id)
            .expect("read persisted profile");
        assert_eq!(persisted.name, "Renamed after run");
        assert!(matches!(
            reopened.get_qa_profile(&clone.id),
            Err(StorageError::NotFound { .. })
        ));
    }

    #[test]
    fn runs_filter_terminology_consistency_waivers_and_gate() {
        let mut fixture = QaFixture::new();
        fixture.add_terminology();
        let run = fixture
            .store
            .run_qa(
                &fixture.project.id,
                Some(&fixture.document_id),
                Some(STANDARD_PROFILE_ID),
            )
            .expect("run document QA");
        assert_eq!(run.checked_segments, 6);
        assert_eq!(run.profile_name, "Standard");
        assert!(run.errors > 0);

        let (issues, total) = fixture
            .store
            .list_qa_issue_views(fixture.issue_filter())
            .expect("list QA issues");
        assert_eq!(issues.len(), total as usize);
        let rules = issues
            .iter()
            .map(|issue| issue.rule_id.as_str())
            .collect::<BTreeSet<_>>();
        for expected in [
            "qa.empty-target",
            "qa.number-mismatch",
            "qa.same-source-different-target",
            "qa.different-source-same-target",
        ] {
            assert!(rules.contains(expected), "missing {expected}");
        }
        assert!(
            rules
                .iter()
                .any(|rule| rule.starts_with("qa.term-required:"))
        );
        assert!(
            rules
                .iter()
                .any(|rule| rule.starts_with("qa.term-forbidden:"))
        );

        let segment_id = fixture.segments[0].id.clone();
        let (segment_issues, _) = fixture
            .store
            .list_qa_issue_views(QaIssueFilter {
                segment_id: Some(segment_id.clone()),
                ..fixture.issue_filter()
            })
            .expect("filter one segment");
        assert!(
            segment_issues
                .iter()
                .all(|issue| issue.segment_id == segment_id)
        );

        let number_issue = issues
            .iter()
            .find(|issue| issue.rule_id == "qa.number-mismatch")
            .expect("number mismatch")
            .clone();
        assert!(matches!(
            fixture
                .store
                .waive_qa_issue(&number_issue.id, "reviewer", ""),
            Err(StorageError::InvalidState(_))
        ));
        let waived = fixture
            .store
            .waive_qa_issue(&number_issue.id, "reviewer", "Approved source variance")
            .expect("waive number issue");
        assert_eq!(waived.disposition, QaIssueDisposition::Waived);

        let rerun = fixture
            .store
            .run_qa(
                &fixture.project.id,
                Some(&fixture.document_id),
                Some(STANDARD_PROFILE_ID),
            )
            .expect("rerun QA with waiver");
        assert!(rerun.waived >= 1);
        let snapshot = fixture
            .store
            .qa_report_snapshot(&rerun.id)
            .expect("build report snapshot");
        assert!(snapshot.items.iter().any(|item| {
            item.rule_id == "qa.number-mismatch"
                && item.disposition == "waived"
                && item.waiver_actor.as_deref() == Some("reviewer")
        }));
        let record = fixture
            .store
            .record_qa_report(&rerun.id, QaReportFormat::Html, "qa-report.html")
            .expect("record report");
        assert_eq!(record.run_id, rerun.id);

        let waiver_revision = fixture
            .store
            .list_qa_issue_views(QaIssueFilter {
                disposition: Some(QaIssueDisposition::Waived),
                ..fixture.issue_filter()
            })
            .expect("list waived issues")
            .0
            .into_iter()
            .find(|issue| issue.id == number_issue.id)
            .and_then(|issue| issue.waiver)
            .expect("active waiver")
            .revision;
        assert!(matches!(
            fixture
                .store
                .revoke_qa_waiver(&number_issue.id, waiver_revision + 1),
            Err(StorageError::EntityConflict { .. })
        ));
        fixture
            .store
            .revoke_qa_waiver(&number_issue.id, waiver_revision)
            .expect("revoke waiver");

        let gate = fixture
            .store
            .check_qa_gate(
                &fixture.project.id,
                &fixture.document_id,
                Some(STANDARD_PROFILE_ID),
            )
            .expect("check blocked gate");
        assert!(!gate.clear);
        assert_eq!(gate.blocker_issue_ids.len() as u64, gate.error_count);
        assert!(matches!(
            fixture.store.create_qa_export_override(
                &gate,
                &fixture.project.id,
                "",
                "Approved delivery",
                "delivery.txt",
            ),
            Err(StorageError::InvalidState(_))
        ));
        let override_record = fixture
            .store
            .create_qa_export_override(
                &gate,
                &fixture.project.id,
                "lead-reviewer",
                "Customer approved delivery",
                "delivery.txt",
            )
            .expect("create delivery override");
        let finished = fixture
            .store
            .finish_qa_export_override(&override_record.id, true)
            .expect("finish delivery override");
        assert_eq!(finished.status, QaOverrideStatus::Succeeded);
        let (overrides, override_total) = fixture
            .store
            .list_qa_export_overrides(&fixture.project.id, Some(&fixture.document_id), 0, 20)
            .expect("list delivery overrides");
        assert_eq!(override_total, 1);
        assert_eq!(overrides[0].id, override_record.id);

        let override_id = override_record.id;
        let QaFixture { temp, store, .. } = fixture;
        drop(store);
        let reopened = Store::open(temp.path()).expect("reopen QA state");
        assert_eq!(
            reopened
                .get_qa_export_override(&override_id)
                .expect("persisted override")
                .status,
            QaOverrideStatus::Succeeded
        );
    }

    #[test]
    fn target_updates_reconcile_segment_local_qa_in_the_same_write() {
        let mut fixture = QaFixture::new();
        let segment = fixture.segments[0].clone();
        let (open_before, _) = fixture
            .store
            .list_qa_issue_views(QaIssueFilter {
                segment_id: Some(segment.id.clone()),
                disposition: Some(QaIssueDisposition::Open),
                ..fixture.issue_filter()
            })
            .expect("list live QA after dirty target write");
        let mismatch = open_before
            .iter()
            .find(|issue| issue.rule_id == "qa.number-mismatch")
            .expect("live number mismatch")
            .clone();

        fixture
            .store
            .update_target(&segment.id, "保留期为 30 天。", segment.revision)
            .expect("correct number mismatch");
        let (open_after, _) = fixture
            .store
            .list_qa_issue_views(QaIssueFilter {
                segment_id: Some(segment.id.clone()),
                disposition: Some(QaIssueDisposition::Open),
                ..fixture.issue_filter()
            })
            .expect("list live QA after correction");
        assert!(
            open_after
                .iter()
                .all(|issue| issue.rule_id != "qa.number-mismatch")
        );
        let (resolved, _) = fixture
            .store
            .list_qa_issue_views(QaIssueFilter {
                segment_id: Some(segment.id),
                disposition: Some(QaIssueDisposition::Resolved),
                ..fixture.issue_filter()
            })
            .expect("list resolved live QA");
        assert!(resolved.iter().any(|issue| issue.id == mismatch.id));
    }

    #[test]
    fn review_statistics_derive_from_durable_workflow_and_revisions() {
        let mut fixture = QaFixture::new();
        let initial = fixture
            .store
            .review_statistics(&fixture.project.id, Some(&fixture.document_id))
            .expect("initial review statistics");
        assert_eq!(initial.translation_segments, 6);
        assert_eq!(initial.review_segments, 0);
        assert_eq!(initial.signed_segments, 0);

        let accepted = fixture
            .store
            .create_review_revision(&ReviewProposal {
                segment_id: &fixture.segments[0].id,
                proposed_target: Some("保留期为 30 天。"),
                proposed_source: None,
                proposed_target_tags: None,
                author: "Alice",
                reason: "Restore source number",
                expected_revision: fixture.segments[0].revision,
            })
            .expect("create accepted review");
        fixture
            .store
            .accept_review(&accepted.id, fixture.segments[0].revision)
            .expect("accept review");

        let rejected = fixture
            .store
            .create_review_revision(&ReviewProposal {
                segment_id: &fixture.segments[1].id,
                proposed_target: Some("不采用的译文。"),
                proposed_source: None,
                proposed_target_tags: None,
                author: "Bob",
                reason: "Alternative wording",
                expected_revision: fixture.segments[1].revision,
            })
            .expect("create rejected review");
        fixture
            .store
            .reject_review(&rejected.id, fixture.segments[1].revision)
            .expect("reject review");

        fixture
            .store
            .create_review_revision(&ReviewProposal {
                segment_id: &fixture.segments[4].id,
                proposed_target: Some("存储文件。"),
                proposed_source: None,
                proposed_target_tags: None,
                author: "Alice",
                reason: "Pending terminology review",
                expected_revision: fixture.segments[4].revision,
            })
            .expect("create pending review");

        let confirmed = fixture
            .store
            .confirm_segment(&fixture.segments[2].id, fixture.segments[2].revision)
            .expect("confirm sign-off segment")
            .segment;
        fixture
            .store
            .set_editor_workflow(
                &confirmed.id,
                EditorWorkflowState::Review,
                confirmed.revision,
            )
            .expect("move segment to review");
        let review_revision = fixture
            .store
            .all_segments(&fixture.document_id)
            .expect("reload review segment")
            .into_iter()
            .find(|segment| segment.id == confirmed.id)
            .expect("review segment")
            .revision;
        fixture
            .store
            .set_editor_workflow(&confirmed.id, EditorWorkflowState::Signed, review_revision)
            .expect("sign segment");

        let statistics = fixture
            .store
            .review_statistics(&fixture.project.id, Some(&fixture.document_id))
            .expect("review statistics");
        assert_eq!(statistics.pending_revisions, 1);
        assert_eq!(statistics.accepted_revisions, 1);
        assert_eq!(statistics.rejected_revisions, 1);
        assert_eq!(statistics.review_segments, 1);
        assert_eq!(statistics.signed_segments, 1);
        assert_eq!(statistics.translation_segments, 4);
        assert!(statistics.reviewed_characters > 0);
        assert_eq!(statistics.reviewers.len(), 2);
        let (pending_queue, pending_total) = fixture
            .store
            .list_review_queue(
                &fixture.project.id,
                Some(&fixture.document_id),
                Some(ReviewStatus::Pending),
                0,
                20,
            )
            .expect("list pending review queue");
        assert_eq!(pending_total, 1);
        assert_eq!(pending_queue[0].revision.author, "Alice");
        assert_eq!(pending_queue[0].document_id, fixture.document_id);

        let QaFixture { temp, store, .. } = fixture;
        drop(store);
        let reopened = Store::open(temp.path()).expect("reopen review statistics");
        assert_eq!(
            reopened
                .review_statistics(&statistics.project_id, statistics.document_id.as_deref())
                .expect("persisted review statistics"),
            statistics
        );
    }

    #[test]
    fn direct_sign_off_requires_project_opt_out_actor_and_reason() {
        let mut fixture = QaFixture::new();
        let confirmed = fixture
            .store
            .confirm_segment(&fixture.segments[2].id, fixture.segments[2].revision)
            .expect("confirm direct sign-off segment")
            .segment;
        assert!(matches!(
            fixture.store.set_editor_workflow_with_context(
                &confirmed.id,
                EditorWorkflowState::Signed,
                confirmed.revision,
                "lead-reviewer",
                Some("Customer-approved direct delivery"),
            ),
            Err(StorageError::InvalidState(_))
        ));

        let mut configuration = fixture.project.configuration.clone();
        configuration.review_required = false;
        fixture.project = fixture
            .store
            .update_project(
                &fixture.project.id,
                ProjectUpdate {
                    name: fixture.project.name.clone(),
                    source_locale: fixture.project.source_locale.clone(),
                    target_locale: fixture.project.target_locale.clone(),
                    domain: fixture.project.domain.clone(),
                    configuration,
                    expected_revision: fixture.project.revision,
                    actor: "project-owner".to_string(),
                    correlation_id: Some("disable-mandatory-review".to_string()),
                },
            )
            .expect("disable mandatory review");
        assert!(matches!(
            fixture.store.set_editor_workflow_with_context(
                &confirmed.id,
                EditorWorkflowState::Signed,
                confirmed.revision,
                "lead-reviewer",
                None,
            ),
            Err(StorageError::InvalidState(_))
        ));
        fixture
            .store
            .set_editor_workflow_with_context(
                &confirmed.id,
                EditorWorkflowState::Signed,
                confirmed.revision,
                "lead-reviewer",
                Some("Customer-approved direct delivery"),
            )
            .expect("perform direct sign-off");

        let stats = fixture
            .store
            .review_statistics(&fixture.project.id, Some(&fixture.document_id))
            .expect("direct sign-off statistics");
        assert_eq!(stats.signed_segments, 1);
        let (history, _, _, _) = fixture
            .store
            .editor_history(&fixture.project.id, 0, 100)
            .expect("direct sign-off history");
        let operation = history
            .iter()
            .find(|operation| {
                operation.kind == "segment.workflow.set"
                    && operation.entity_id == confirmed.id
                    && operation.actor == "lead-reviewer"
            })
            .expect("direct sign-off operation");
        assert_eq!(
            operation
                .after
                .as_ref()
                .and_then(|value| value.get("directSignOffReason"))
                .and_then(serde_json::Value::as_str),
            Some("Customer-approved direct delivery")
        );
    }
}
