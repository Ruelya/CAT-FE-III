use std::collections::BTreeSet;

use rusqlite::{Connection, OptionalExtension, Row, Transaction, TransactionBehavior, params};
use translunar_ai_core::{
    ALIGNMENT_REFINEMENT_ACTION, AiBatchItem, AiBatchItemStatus, AiBatchRun, AiBatchStatus,
    AiConversation, AiConversationMessage, AiConversationRole, AiProviderKind, AiProviderProfile,
    AiRun, AiRunEvent, AiRunEventKind, AiRunKind, AiRunRequest, AiRunStatus, AiSettings, AiUsage,
    AiUsageAggregate, AiUsageDimension, AiUsageRecord, GroundingOptions, validate_profile_fields,
};
use translunar_domain::new_id;

use super::{
    Result, StorageError, Store, conversion_error, ensure_entity_revision, not_found, now_ms,
    read_optional_u64, read_u32, read_u64, to_i64, to_u32,
};

#[derive(Debug, Clone)]
pub struct NewAiProviderProfile {
    pub name: String,
    pub kind: AiProviderKind,
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u32,
    pub max_response_bytes: u32,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct AiProviderProfileUpdate {
    pub name: String,
    pub kind: AiProviderKind,
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u32,
    pub max_response_bytes: u32,
    pub enabled: bool,
    pub expected_revision: u64,
}

#[derive(Debug, Clone)]
pub struct AiSettingsUpdate {
    pub enabled: bool,
    pub default_profile_id: Option<String>,
    pub monthly_token_budget: Option<u64>,
    pub allow_interactive: bool,
    pub allow_batch: bool,
    pub allowed_origins: Vec<String>,
    pub expected_revision: u64,
}

#[derive(Debug, Clone)]
pub struct NewAiRun {
    pub kind: AiRunKind,
    pub project_id: Option<String>,
    pub document_id: Option<String>,
    pub segment_id: Option<String>,
    pub profile_id: Option<String>,
    pub model: String,
    pub action: String,
    pub prompt_hash: String,
    pub request: AiRunRequest,
    pub base_segment_revision: Option<u64>,
    pub max_attempts: u32,
}

#[derive(Debug, Clone)]
pub struct NewAiBatchRun {
    pub project_id: String,
    pub document_id: Option<String>,
    pub profile_id: String,
    pub tm_threshold: u8,
    pub concurrency: u8,
    pub requests_per_minute: u16,
    pub max_attempts: u8,
    pub replace_drafts: bool,
    pub grounding_options: GroundingOptions,
}

#[derive(Debug, Clone)]
pub struct NewAiBatchItem {
    pub segment_id: String,
    pub ordinal: u32,
    pub expected_revision: u64,
}

impl Store {
    pub fn create_ai_provider_profile(
        &mut self,
        input: NewAiProviderProfile,
    ) -> Result<AiProviderProfile> {
        validate_profile_fields(
            &input.name,
            input.kind,
            &input.base_url,
            &input.model,
            input.timeout_ms,
            input.max_response_bytes,
        )
        .map_err(|error| StorageError::InvalidState(error.to_string()))?;
        let id = new_id();
        let now = now_ms();
        self.connection.execute(
            "INSERT INTO ai_provider_profiles (
                id, name, kind, base_url, model, timeout_ms, max_response_bytes,
                enabled, credential_present, revision, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, ?9, ?9)",
            params![
                id,
                input.name.trim(),
                provider_kind_text(input.kind),
                input.base_url.trim(),
                input.model.trim(),
                input.timeout_ms,
                input.max_response_bytes,
                input.enabled,
                now,
            ],
        )?;
        self.get_ai_provider_profile(&id)
    }

    pub fn get_ai_provider_profile(&self, profile_id: &str) -> Result<AiProviderProfile> {
        find_ai_provider_profile(&self.connection, profile_id)
    }

    pub fn list_ai_provider_profiles(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AiProviderProfile>, u32)> {
        validate_page(limit, 100)?;
        let total =
            self.connection
                .query_row("SELECT COUNT(*) FROM ai_provider_profiles", [], |row| {
                    row.get::<_, i64>(0)
                })?;
        let mut statement = self.connection.prepare(
            "SELECT id, name, kind, base_url, model, timeout_ms, max_response_bytes,
                    enabled, credential_present, revision, created_at_ms, updated_at_ms
             FROM ai_provider_profiles
             ORDER BY updated_at_ms DESC, id
             LIMIT ?1 OFFSET ?2",
        )?;
        let items = statement
            .query_map(params![limit, offset], row_to_ai_provider_profile)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn update_ai_provider_profile(
        &mut self,
        profile_id: &str,
        input: AiProviderProfileUpdate,
    ) -> Result<AiProviderProfile> {
        validate_profile_fields(
            &input.name,
            input.kind,
            &input.base_url,
            &input.model,
            input.timeout_ms,
            input.max_response_bytes,
        )
        .map_err(|error| StorageError::InvalidState(error.to_string()))?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_ai_provider_profile(&transaction, profile_id)?;
        ensure_entity_revision(
            "ai_provider_profile",
            profile_id,
            current.revision,
            input.expected_revision,
        )?;
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_provider_profiles
             SET name = ?1, kind = ?2, base_url = ?3, model = ?4,
                 timeout_ms = ?5, max_response_bytes = ?6, enabled = ?7,
                 revision = revision + 1, updated_at_ms = ?8
             WHERE id = ?9 AND revision = ?10",
            params![
                input.name.trim(),
                provider_kind_text(input.kind),
                input.base_url.trim(),
                input.model.trim(),
                input.timeout_ms,
                input.max_response_bytes,
                input.enabled,
                now,
                profile_id,
                to_i64(input.expected_revision)?,
            ],
        )?;
        transaction.commit()?;
        self.get_ai_provider_profile(profile_id)
    }

    pub fn set_ai_provider_credential_present(
        &mut self,
        profile_id: &str,
        present: bool,
    ) -> Result<AiProviderProfile> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_ai_provider_profile(&transaction, profile_id)?;
        if current.credential_present == present {
            transaction.commit()?;
            return Ok(current);
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_provider_profiles
             SET credential_present = ?1, revision = revision + 1, updated_at_ms = ?2
             WHERE id = ?3 AND revision = ?4",
            params![present, now, profile_id, to_i64(current.revision)?],
        )?;
        transaction.commit()?;
        self.get_ai_provider_profile(profile_id)
    }

    pub fn delete_ai_provider_profile(
        &mut self,
        profile_id: &str,
        expected_revision: u64,
    ) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_ai_provider_profile(&transaction, profile_id)?;
        ensure_entity_revision(
            "ai_provider_profile",
            profile_id,
            current.revision,
            expected_revision,
        )?;
        let active_batches = transaction.query_row(
            "SELECT COUNT(*) FROM ai_batch_runs
             WHERE profile_id = ?1 AND status IN ('queued', 'running', 'interrupted', 'canceling')",
            [profile_id],
            |row| row.get::<_, i64>(0),
        )?;
        if active_batches > 0 {
            return Err(StorageError::InvalidState(
                "provider profile is used by an active AI batch".to_string(),
            ));
        }
        transaction.execute(
            "DELETE FROM ai_provider_profiles WHERE id = ?1 AND revision = ?2",
            params![profile_id, to_i64(expected_revision)?],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn get_ai_settings(&self) -> Result<AiSettings> {
        self.connection
            .query_row(
                "SELECT enabled, default_profile_id, monthly_token_budget,
                    allow_interactive, allow_batch, allowed_origins_json,
                    revision, updated_at_ms
             FROM ai_settings WHERE id = 'default'",
                [],
                row_to_ai_settings,
            )
            .map_err(Into::into)
    }

    pub fn update_ai_settings(&mut self, input: AiSettingsUpdate) -> Result<AiSettings> {
        let allowed_origins = normalize_origins(&input.allowed_origins)?;
        let origins_json = serde_json::to_string(&allowed_origins)?;
        let budget = input.monthly_token_budget.map(to_i64).transpose()?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = transaction.query_row(
            "SELECT enabled, default_profile_id, monthly_token_budget,
                    allow_interactive, allow_batch, allowed_origins_json,
                    revision, updated_at_ms
             FROM ai_settings WHERE id = 'default'",
            [],
            row_to_ai_settings,
        )?;
        ensure_entity_revision(
            "ai_settings",
            "default",
            current.revision,
            input.expected_revision,
        )?;
        if let Some(profile_id) = input.default_profile_id.as_deref() {
            find_ai_provider_profile(&transaction, profile_id)?;
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_settings
             SET enabled = ?1, default_profile_id = ?2, monthly_token_budget = ?3,
                 allow_interactive = ?4, allow_batch = ?5,
                 allowed_origins_json = ?6, revision = revision + 1,
                 updated_at_ms = ?7
             WHERE id = 'default' AND revision = ?8",
            params![
                input.enabled,
                input.default_profile_id,
                budget,
                input.allow_interactive,
                input.allow_batch,
                origins_json,
                now,
                to_i64(input.expected_revision)?,
            ],
        )?;
        transaction.commit()?;
        self.get_ai_settings()
    }

    pub fn create_ai_run(&mut self, input: NewAiRun) -> Result<AiRun> {
        validate_new_run(&input)?;
        let id = new_id();
        let now = now_ms();
        self.connection.execute(
            "INSERT INTO ai_runs (
                id, kind, project_id, document_id, segment_id, profile_id, model,
                action, prompt_hash, request_json, base_segment_revision, status, revision,
                attempt, max_attempts, cancellation_requested, proposal_text,
                error_code, error_message, error_retryable, created_at_ms,
                started_at_ms, completed_at_ms, updated_at_ms
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'queued', 0,
                0, ?12, 0, NULL, NULL, NULL, 0, ?13, NULL, NULL, ?13
             )",
            params![
                id,
                run_kind_text(input.kind),
                input.project_id,
                input.document_id,
                input.segment_id,
                input.profile_id,
                input.model,
                input.action,
                input.prompt_hash,
                serde_json::to_string(&input.request)?,
                input.base_segment_revision.map(to_i64).transpose()?,
                input.max_attempts,
                now,
            ],
        )?;
        self.get_ai_run(&id)
    }

    pub fn get_ai_run(&self, run_id: &str) -> Result<AiRun> {
        find_ai_run(&self.connection, run_id)
    }

    pub fn list_ai_runs(
        &self,
        project_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AiRun>, u32)> {
        validate_page(limit, 200)?;
        let (total, sql) = if project_id.is_some() {
            (
                self.connection.query_row(
                    "SELECT COUNT(*) FROM ai_runs WHERE project_id = ?1",
                    [project_id],
                    |row| row.get::<_, i64>(0),
                )?,
                format!(
                    "{} WHERE project_id = ?1 ORDER BY created_at_ms DESC, id LIMIT ?2 OFFSET ?3",
                    AI_RUN_SELECT
                ),
            )
        } else {
            (
                self.connection
                    .query_row("SELECT COUNT(*) FROM ai_runs", [], |row| {
                        row.get::<_, i64>(0)
                    })?,
                format!(
                    "{} ORDER BY created_at_ms DESC, id LIMIT ?1 OFFSET ?2",
                    AI_RUN_SELECT
                ),
            )
        };
        let mut statement = self.connection.prepare(&sql)?;
        let items = if let Some(project_id) = project_id {
            statement
                .query_map(params![project_id, limit, offset], row_to_ai_run)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            statement
                .query_map(params![limit, offset], row_to_ai_run)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        Ok((items, to_u32(total)?))
    }

    pub fn start_ai_run_attempt(&mut self, run_id: &str) -> Result<AiRun> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_ai_run(&transaction, run_id)?;
        if !matches!(
            run.status,
            AiRunStatus::Queued | AiRunStatus::Retrying | AiRunStatus::Interrupted
        ) || run.cancellation_requested
        {
            return Err(StorageError::InvalidState(
                "AI run is not ready to start".to_string(),
            ));
        }
        if run.attempt >= run.max_attempts {
            return Err(StorageError::InvalidState(
                "AI run exhausted its retry attempts".to_string(),
            ));
        }
        let attempt = run.attempt.saturating_add(1);
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_runs
             SET status = 'running', attempt = ?1, revision = revision + 1,
                 started_at_ms = COALESCE(started_at_ms, ?2),
                 error_code = NULL, error_message = NULL, error_retryable = 0,
                 completed_at_ms = NULL, updated_at_ms = ?2
             WHERE id = ?3 AND revision = ?4",
            params![attempt, now, run_id, to_i64(run.revision)?],
        )?;
        append_ai_event_tx(
            &transaction,
            run_id,
            AiEventInput {
                kind: AiRunEventKind::Attempt,
                attempt: Some(attempt),
                created_at_ms: now,
                ..AiEventInput::default()
            },
        )?;
        transaction.commit()?;
        self.get_ai_run(run_id)
    }

    pub fn append_ai_run_delta(&mut self, run_id: &str, delta: &str) -> Result<AiRunEvent> {
        if delta.is_empty() || delta.len() > 256 * 1024 {
            return Err(StorageError::InvalidState(
                "AI delta must contain 1..262144 bytes".to_string(),
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_ai_run(&transaction, run_id)?;
        if run.status != AiRunStatus::Running || run.cancellation_requested {
            return Err(StorageError::InvalidState(
                "AI run is not accepting output".to_string(),
            ));
        }
        let now = now_ms();
        let event = append_ai_event_tx(
            &transaction,
            run_id,
            AiEventInput {
                kind: AiRunEventKind::Delta,
                delta_text: Some(delta),
                attempt: Some(run.attempt),
                created_at_ms: now,
                ..AiEventInput::default()
            },
        )?;
        transaction.execute(
            "UPDATE ai_runs SET updated_at_ms = ?1 WHERE id = ?2",
            params![now, run_id],
        )?;
        transaction.commit()?;
        Ok(event)
    }

    pub fn retry_ai_run(
        &mut self,
        run_id: &str,
        error_code: &str,
        retry_after_ms: u64,
    ) -> Result<AiRun> {
        validate_error_code(error_code)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_ai_run(&transaction, run_id)?;
        if run.status != AiRunStatus::Running || run.attempt >= run.max_attempts {
            return Err(StorageError::InvalidState(
                "AI run cannot be retried".to_string(),
            ));
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_runs
             SET status = 'retrying', revision = revision + 1,
                 error_code = ?1, error_message = ?2, error_retryable = 1,
                 updated_at_ms = ?3
             WHERE id = ?4 AND revision = ?5",
            params![
                error_code,
                "AI provider request will be retried.",
                now,
                run_id,
                to_i64(run.revision)?,
            ],
        )?;
        append_ai_event_tx(
            &transaction,
            run_id,
            AiEventInput {
                kind: AiRunEventKind::Retry,
                attempt: Some(run.attempt),
                retry_after_ms: Some(retry_after_ms),
                message: Some("AI provider request will be retried."),
                created_at_ms: now,
                ..AiEventInput::default()
            },
        )?;
        transaction.commit()?;
        self.get_ai_run(run_id)
    }

    pub fn complete_ai_run(
        &mut self,
        run_id: &str,
        proposal_text: &str,
        provider: AiProviderKind,
        usage: AiUsage,
        elapsed_ms: u64,
    ) -> Result<AiRun> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        complete_ai_run_tx(
            &transaction,
            run_id,
            proposal_text,
            provider,
            &usage,
            elapsed_ms,
        )?;
        transaction.commit()?;
        self.get_ai_run(run_id)
    }

    pub fn fail_ai_run(
        &mut self,
        run_id: &str,
        error_code: &str,
        retryable: bool,
        provider: AiProviderKind,
        elapsed_ms: u64,
    ) -> Result<AiRun> {
        self.fail_ai_run_with_usage(
            run_id,
            error_code,
            retryable,
            provider,
            AiUsage::default(),
            elapsed_ms,
        )
    }

    pub fn fail_ai_run_with_usage(
        &mut self,
        run_id: &str,
        error_code: &str,
        retryable: bool,
        provider: AiProviderKind,
        usage: AiUsage,
        elapsed_ms: u64,
    ) -> Result<AiRun> {
        validate_error_code(error_code)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_ai_run(&transaction, run_id)?;
        if run.status.is_terminal() {
            transaction.commit()?;
            return Ok(run);
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_runs
             SET status = 'failed', revision = revision + 1, error_code = ?1,
                 error_message = ?2, error_retryable = ?3,
                 completed_at_ms = ?4, updated_at_ms = ?4
             WHERE id = ?5 AND revision = ?6",
            params![
                error_code,
                "AI provider request failed.",
                retryable,
                now,
                run_id,
                to_i64(run.revision)?,
            ],
        )?;
        append_ai_event_tx(
            &transaction,
            run_id,
            AiEventInput {
                kind: AiRunEventKind::Failed,
                attempt: Some(run.attempt),
                message: Some("AI provider request failed."),
                created_at_ms: now,
                ..AiEventInput::default()
            },
        )?;
        insert_ai_usage_tx(
            &transaction,
            &run,
            provider,
            "failed",
            &usage,
            elapsed_ms,
            now,
        )?;
        transaction.commit()?;
        self.get_ai_run(run_id)
    }

    pub fn request_ai_run_cancel(&mut self, run_id: &str, expected_revision: u64) -> Result<AiRun> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_ai_run(&transaction, run_id)?;
        ensure_entity_revision("ai_run", run_id, run.revision, expected_revision)?;
        if run.status.is_terminal() {
            transaction.commit()?;
            return Ok(run);
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_runs
             SET status = 'canceling', cancellation_requested = 1,
                 revision = revision + 1, updated_at_ms = ?1
             WHERE id = ?2 AND revision = ?3",
            params![now, run_id, to_i64(run.revision)?],
        )?;
        append_ai_event_tx(
            &transaction,
            run_id,
            AiEventInput {
                kind: AiRunEventKind::Canceling,
                attempt: Some(run.attempt),
                created_at_ms: now,
                ..AiEventInput::default()
            },
        )?;
        transaction.commit()?;
        self.get_ai_run(run_id)
    }

    pub fn finalize_ai_run_canceled(&mut self, run_id: &str) -> Result<AiRun> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_ai_run(&transaction, run_id)?;
        if run.status == AiRunStatus::Canceled {
            transaction.commit()?;
            return Ok(run);
        }
        if run.status != AiRunStatus::Canceling {
            return Err(StorageError::InvalidState(
                "AI run is not canceling".to_string(),
            ));
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_runs
             SET status = 'canceled', revision = revision + 1,
                 completed_at_ms = ?1, updated_at_ms = ?1
             WHERE id = ?2 AND revision = ?3",
            params![now, run_id, to_i64(run.revision)?],
        )?;
        append_ai_event_tx(
            &transaction,
            run_id,
            AiEventInput {
                kind: AiRunEventKind::Canceled,
                attempt: Some(run.attempt),
                created_at_ms: now,
                ..AiEventInput::default()
            },
        )?;
        transaction.commit()?;
        self.get_ai_run(run_id)
    }

    pub fn resume_ai_run(&mut self, run_id: &str, expected_revision: u64) -> Result<AiRun> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = find_ai_run(&transaction, run_id)?;
        ensure_entity_revision("ai_run", run_id, run.revision, expected_revision)?;
        if !matches!(run.status, AiRunStatus::Interrupted | AiRunStatus::Failed)
            || (run.status == AiRunStatus::Failed && !run.error_retryable)
        {
            return Err(StorageError::InvalidState(
                "AI run cannot be resumed".to_string(),
            ));
        }
        let next_max_attempts = if run.attempt >= run.max_attempts {
            run.max_attempts
                .checked_add(1)
                .filter(|value| *value <= 10)
                .ok_or_else(|| {
                    StorageError::InvalidState("AI run retry limit is exhausted".to_string())
                })?
        } else {
            run.max_attempts
        };
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_runs
             SET status = 'queued', cancellation_requested = 0,
                 max_attempts = ?1,
                 revision = revision + 1, completed_at_ms = NULL,
                 updated_at_ms = ?2
             WHERE id = ?3 AND revision = ?4",
            params![
                to_i64(u64::from(next_max_attempts))?,
                now,
                run_id,
                to_i64(run.revision)?
            ],
        )?;
        transaction.commit()?;
        self.get_ai_run(run_id)
    }

    pub fn ai_run_cancel_requested(&self, run_id: &str) -> Result<bool> {
        self.connection
            .query_row(
                "SELECT cancellation_requested FROM ai_runs WHERE id = ?1",
                [run_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| not_found("ai_run", run_id))
    }

    pub fn list_ai_run_events(
        &self,
        run_id: &str,
        after_sequence: u64,
        limit: u32,
    ) -> Result<Vec<AiRunEvent>> {
        validate_page(limit, 500)?;
        find_ai_run(&self.connection, run_id)?;
        let mut statement = self.connection.prepare(
            "SELECT run_id, sequence, kind, delta_text, usage_json, attempt,
                    retry_after_ms, message, created_at_ms
             FROM ai_run_events
             WHERE run_id = ?1 AND sequence > ?2
             ORDER BY sequence
             LIMIT ?3",
        )?;
        statement
            .query_map(
                params![run_id, to_i64(after_sequence)?, limit],
                row_to_ai_run_event,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn create_ai_batch(
        &mut self,
        input: NewAiBatchRun,
        items: &[NewAiBatchItem],
    ) -> Result<AiBatchRun> {
        validate_new_batch(&input, items)?;
        let id = new_id();
        let now = now_ms();
        let total = i64::try_from(items.len()).map_err(|_| {
            StorageError::InvalidData("AI batch size does not fit SQLite INTEGER".to_string())
        })?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let profile = find_ai_provider_profile(&transaction, &input.profile_id)?;
        if !profile.enabled || !profile.credential_present {
            return Err(StorageError::InvalidState(
                "AI provider profile is not ready for batch work".to_string(),
            ));
        }
        transaction.execute(
            "INSERT INTO ai_batch_runs (
                id, project_id, document_id, profile_id, status, revision,
                tm_threshold, concurrency, requests_per_minute, max_attempts,
                replace_drafts, grounding_options_json, cancellation_requested, total, completed,
                succeeded, failed, skipped, tm_applied, usage_json,
                created_at_ms, started_at_ms, completed_at_ms, updated_at_ms
             ) VALUES (
                ?1, ?2, ?3, ?4, 'queued', 0, ?5, ?6, ?7, ?8, ?9, ?10, 0,
                ?11, 0, 0, 0, 0, 0, '{}', ?12, NULL, NULL, ?12
             )",
            params![
                id,
                input.project_id,
                input.document_id,
                input.profile_id,
                input.tm_threshold,
                input.concurrency,
                input.requests_per_minute,
                input.max_attempts,
                input.replace_drafts,
                serde_json::to_string(&input.grounding_options)?,
                total,
                now,
            ],
        )?;
        for item in items {
            transaction.execute(
                "INSERT INTO ai_batch_items (
                    batch_id, segment_id, ordinal, expected_revision, status,
                    source, attempts, run_id, error_code, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, 'pending', NULL, 0, NULL, NULL, ?5)",
                params![
                    id,
                    item.segment_id,
                    item.ordinal,
                    to_i64(item.expected_revision)?,
                    now,
                ],
            )?;
        }
        transaction.commit()?;
        self.get_ai_batch(&id)
    }

    pub fn get_ai_batch(&self, batch_id: &str) -> Result<AiBatchRun> {
        find_ai_batch(&self.connection, batch_id)
    }

    pub fn list_ai_batches(
        &self,
        project_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AiBatchRun>, u32)> {
        validate_page(limit, 200)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM ai_batch_runs WHERE project_id = ?1",
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(&format!(
            "{} WHERE project_id = ?1 ORDER BY created_at_ms DESC, id LIMIT ?2 OFFSET ?3",
            AI_BATCH_SELECT
        ))?;
        let items = statement
            .query_map(params![project_id, limit, offset], row_to_ai_batch)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn start_ai_batch(&mut self, batch_id: &str) -> Result<AiBatchRun> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let batch = find_ai_batch(&transaction, batch_id)?;
        if !matches!(
            batch.status,
            AiBatchStatus::Queued | AiBatchStatus::Interrupted
        ) || batch.cancellation_requested
        {
            return Err(StorageError::InvalidState(
                "AI batch is not ready to start".to_string(),
            ));
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_batch_runs
             SET status = 'running', revision = revision + 1,
                 started_at_ms = COALESCE(started_at_ms, ?1),
                 completed_at_ms = NULL, updated_at_ms = ?1
             WHERE id = ?2 AND revision = ?3",
            params![now, batch_id, to_i64(batch.revision)?],
        )?;
        transaction.commit()?;
        self.get_ai_batch(batch_id)
    }

    /// Recomputes a batch projection after a worker pass. This is needed for
    /// empty scopes, where no item transition exists to trigger the normal
    /// terminal-state recomputation.
    pub fn refresh_ai_batch(&mut self, batch_id: &str) -> Result<AiBatchRun> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let batch = find_ai_batch(&transaction, batch_id)?;
        recompute_ai_batch_tx(&transaction, batch_id, now_ms())?;
        transaction.commit()?;
        self.get_ai_batch(batch.id.as_str())
    }

    pub fn claim_ai_batch_item(&mut self, batch_id: &str) -> Result<Option<AiBatchItem>> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let batch = find_ai_batch(&transaction, batch_id)?;
        if batch.status != AiBatchStatus::Running || batch.cancellation_requested {
            transaction.commit()?;
            return Ok(None);
        }
        let item = transaction
            .query_row(
                "SELECT batch_id, segment_id, ordinal, expected_revision, status,
                        source, attempts, run_id, error_code, updated_at_ms
                 FROM ai_batch_items
                 WHERE batch_id = ?1 AND status IN ('pending', 'retrying')
                 ORDER BY ordinal, segment_id LIMIT 1",
                [batch_id],
                row_to_ai_batch_item,
            )
            .optional()?;
        let Some(item) = item else {
            transaction.commit()?;
            return Ok(None);
        };
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_batch_items
             SET status = 'running', attempts = attempts + 1,
                 error_code = NULL, updated_at_ms = ?1
             WHERE batch_id = ?2 AND segment_id = ?3
               AND status IN ('pending', 'retrying')",
            params![now, batch_id, item.segment_id],
        )?;
        transaction.commit()?;
        self.get_ai_batch_item(batch_id, &item.segment_id).map(Some)
    }

    pub fn get_ai_batch_item(&self, batch_id: &str, segment_id: &str) -> Result<AiBatchItem> {
        self.connection
            .query_row(
                "SELECT batch_id, segment_id, ordinal, expected_revision, status,
                        source, attempts, run_id, error_code, updated_at_ms
                 FROM ai_batch_items WHERE batch_id = ?1 AND segment_id = ?2",
                params![batch_id, segment_id],
                row_to_ai_batch_item,
            )
            .optional()?
            .ok_or_else(|| not_found("ai_batch_item", segment_id))
    }

    pub fn list_ai_batch_items(
        &self,
        batch_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AiBatchItem>, u32)> {
        validate_page(limit, 500)?;
        find_ai_batch(&self.connection, batch_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM ai_batch_items WHERE batch_id = ?1",
            [batch_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT batch_id, segment_id, ordinal, expected_revision, status,
                    source, attempts, run_id, error_code, updated_at_ms
             FROM ai_batch_items WHERE batch_id = ?1
             ORDER BY ordinal, segment_id LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(params![batch_id, limit, offset], row_to_ai_batch_item)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn attach_ai_batch_item_run(
        &mut self,
        batch_id: &str,
        segment_id: &str,
        run_id: &str,
    ) -> Result<AiBatchItem> {
        find_ai_run(&self.connection, run_id)?;
        let item = self.get_ai_batch_item(batch_id, segment_id)?;
        if item.status != AiBatchItemStatus::Running {
            return Err(StorageError::InvalidState(
                "AI batch item is not running".to_string(),
            ));
        }
        self.connection.execute(
            "UPDATE ai_batch_items SET run_id = ?1, updated_at_ms = ?2
             WHERE batch_id = ?3 AND segment_id = ?4",
            params![run_id, now_ms(), batch_id, segment_id],
        )?;
        self.get_ai_batch_item(batch_id, segment_id)
    }

    pub fn finish_ai_batch_item(
        &mut self,
        batch_id: &str,
        segment_id: &str,
        status: AiBatchItemStatus,
        source: Option<&str>,
        error_code: Option<&str>,
    ) -> Result<AiBatchRun> {
        if !status.is_terminal() {
            return Err(StorageError::InvalidState(
                "AI batch item terminal status is required".to_string(),
            ));
        }
        if !matches!(source, None | Some("tm") | Some("engine")) {
            return Err(StorageError::InvalidState(
                "AI batch item source is invalid".to_string(),
            ));
        }
        if let Some(code) = error_code {
            validate_error_code(code)?;
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let item = find_ai_batch_item(&transaction, batch_id, segment_id)?;
        if item.status.is_terminal() {
            transaction.commit()?;
            return self.get_ai_batch(batch_id);
        }
        if !matches!(
            item.status,
            AiBatchItemStatus::Running | AiBatchItemStatus::Retrying
        ) {
            return Err(StorageError::InvalidState(
                "AI batch item is not active".to_string(),
            ));
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_batch_items
             SET status = ?1, source = ?2, error_code = ?3, updated_at_ms = ?4
             WHERE batch_id = ?5 AND segment_id = ?6",
            params![
                batch_item_status_text(status),
                source,
                error_code,
                now,
                batch_id,
                segment_id,
            ],
        )?;
        recompute_ai_batch_tx(&transaction, batch_id, now)?;
        transaction.commit()?;
        self.get_ai_batch(batch_id)
    }

    pub fn retry_ai_batch_item(
        &mut self,
        batch_id: &str,
        segment_id: &str,
        error_code: &str,
    ) -> Result<AiBatchItem> {
        validate_error_code(error_code)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let item = find_ai_batch_item(&transaction, batch_id, segment_id)?;
        let batch = find_ai_batch(&transaction, batch_id)?;
        if item.status != AiBatchItemStatus::Running
            || item.attempts >= u32::from(batch.max_attempts)
        {
            return Err(StorageError::InvalidState(
                "AI batch item cannot be retried".to_string(),
            ));
        }
        transaction.execute(
            "UPDATE ai_batch_items
             SET status = 'retrying', error_code = ?1, updated_at_ms = ?2
             WHERE batch_id = ?3 AND segment_id = ?4",
            params![error_code, now_ms(), batch_id, segment_id],
        )?;
        transaction.commit()?;
        self.get_ai_batch_item(batch_id, segment_id)
    }

    pub fn request_ai_batch_cancel(
        &mut self,
        batch_id: &str,
        expected_revision: u64,
    ) -> Result<AiBatchRun> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let batch = find_ai_batch(&transaction, batch_id)?;
        ensure_entity_revision("ai_batch", batch_id, batch.revision, expected_revision)?;
        if batch.status.is_terminal() {
            transaction.commit()?;
            return Ok(batch);
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_batch_runs
             SET status = 'canceling', cancellation_requested = 1,
                 revision = revision + 1, updated_at_ms = ?1
             WHERE id = ?2 AND revision = ?3",
            params![now, batch_id, to_i64(batch.revision)?],
        )?;
        transaction.execute(
            "UPDATE ai_batch_items
             SET status = 'canceled', updated_at_ms = ?1
             WHERE batch_id = ?2 AND status IN ('pending', 'retrying')",
            params![now, batch_id],
        )?;
        recompute_ai_batch_tx(&transaction, batch_id, now)?;
        transaction.commit()?;
        self.get_ai_batch(batch_id)
    }

    pub fn resume_ai_batch(
        &mut self,
        batch_id: &str,
        expected_revision: u64,
    ) -> Result<AiBatchRun> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let batch = find_ai_batch(&transaction, batch_id)?;
        ensure_entity_revision("ai_batch", batch_id, batch.revision, expected_revision)?;
        if batch.status != AiBatchStatus::Interrupted {
            return Err(StorageError::InvalidState(
                "only an interrupted AI batch can resume".to_string(),
            ));
        }
        let now = now_ms();
        transaction.execute(
            "UPDATE ai_batch_items
             SET status = 'pending', run_id = NULL, error_code = NULL,
                 updated_at_ms = ?1
             WHERE batch_id = ?2 AND status IN ('running', 'retrying')",
            params![now, batch_id],
        )?;
        transaction.execute(
            "UPDATE ai_batch_runs
             SET status = 'queued', cancellation_requested = 0,
                 revision = revision + 1, completed_at_ms = NULL,
                 updated_at_ms = ?1
             WHERE id = ?2 AND revision = ?3",
            params![now, batch_id, to_i64(batch.revision)?],
        )?;
        recompute_ai_batch_tx(&transaction, batch_id, now)?;
        transaction.commit()?;
        self.get_ai_batch(batch_id)
    }

    pub fn ai_batch_cancel_requested(&self, batch_id: &str) -> Result<bool> {
        self.connection
            .query_row(
                "SELECT cancellation_requested FROM ai_batch_runs WHERE id = ?1",
                [batch_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| not_found("ai_batch", batch_id))
    }

    pub fn list_ai_usage_records(
        &self,
        project_id: Option<&str>,
        since_ms: i64,
        until_ms: i64,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AiUsageRecord>, u32)> {
        validate_time_range(since_ms, until_ms)?;
        validate_page(limit, 500)?;
        let (count_sql, list_sql) = if project_id.is_some() {
            (
                "SELECT COUNT(*) FROM ai_usage_records
                 WHERE project_id = ?1 AND created_at_ms >= ?2 AND created_at_ms < ?3",
                format!(
                    "{} WHERE project_id = ?1 AND created_at_ms >= ?2 AND created_at_ms < ?3
                     ORDER BY created_at_ms DESC, id LIMIT ?4 OFFSET ?5",
                    AI_USAGE_SELECT
                ),
            )
        } else {
            (
                "SELECT COUNT(*) FROM ai_usage_records
                 WHERE created_at_ms >= ?1 AND created_at_ms < ?2",
                format!(
                    "{} WHERE created_at_ms >= ?1 AND created_at_ms < ?2
                     ORDER BY created_at_ms DESC, id LIMIT ?3 OFFSET ?4",
                    AI_USAGE_SELECT
                ),
            )
        };
        let total = if let Some(project_id) = project_id {
            self.connection.query_row(
                count_sql,
                params![project_id, since_ms, until_ms],
                |row| row.get::<_, i64>(0),
            )?
        } else {
            self.connection
                .query_row(count_sql, params![since_ms, until_ms], |row| {
                    row.get::<_, i64>(0)
                })?
        };
        let mut statement = self.connection.prepare(&list_sql)?;
        let items = if let Some(project_id) = project_id {
            statement
                .query_map(
                    params![project_id, since_ms, until_ms, limit, offset],
                    row_to_ai_usage_record,
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            statement
                .query_map(
                    params![since_ms, until_ms, limit, offset],
                    row_to_ai_usage_record,
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        Ok((items, to_u32(total)?))
    }

    pub fn aggregate_ai_usage(
        &self,
        project_id: Option<&str>,
        since_ms: i64,
        until_ms: i64,
        dimension: AiUsageDimension,
    ) -> Result<Vec<AiUsageAggregate>> {
        validate_time_range(since_ms, until_ms)?;
        let key = match dimension {
            AiUsageDimension::Day => "strftime('%Y-%m-%d', created_at_ms / 1000, 'unixepoch')",
            AiUsageDimension::Month => "strftime('%Y-%m', created_at_ms / 1000, 'unixepoch')",
            AiUsageDimension::Project => "COALESCE(project_id, 'none')",
            AiUsageDimension::Provider => "provider",
            AiUsageDimension::Model => "model",
        };
        let project_clause = if project_id.is_some() {
            "project_id = ?1 AND created_at_ms >= ?2 AND created_at_ms < ?3"
        } else {
            "created_at_ms >= ?1 AND created_at_ms < ?2"
        };
        let sql = format!(
            "SELECT {key}, COUNT(*),
                    COALESCE(SUM(input_tokens), 0),
                    COALESCE(SUM(cache_read_tokens), 0),
                    COALESCE(SUM(reasoning_tokens), 0),
                    COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(cache_write_tokens), 0),
                    COALESCE(SUM(elapsed_ms), 0)
             FROM ai_usage_records WHERE {project_clause}
             GROUP BY {key} ORDER BY {key}"
        );
        let mut statement = self.connection.prepare(&sql)?;
        let map = |row: &Row<'_>| {
            Ok(AiUsageAggregate {
                key: row.get(0)?,
                request_count: read_u32(row, 1)?,
                input_tokens: read_u64(row, 2)?,
                cache_read_tokens: read_u64(row, 3)?,
                reasoning_tokens: read_u64(row, 4)?,
                output_tokens: read_u64(row, 5)?,
                cache_write_tokens: read_u64(row, 6)?,
                elapsed_ms: read_u64(row, 7)?,
            })
        };
        let items = if let Some(project_id) = project_id {
            statement
                .query_map(params![project_id, since_ms, until_ms], map)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            statement
                .query_map(params![since_ms, until_ms], map)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        Ok(items)
    }

    pub fn ai_token_usage_since(&self, since_ms: i64) -> Result<u64> {
        let value = self.connection.query_row(
            "SELECT COALESCE(SUM(
                COALESCE(input_tokens, 0) + COALESCE(cache_read_tokens, 0) +
                COALESCE(reasoning_tokens, 0) + COALESCE(output_tokens, 0) +
                COALESCE(cache_write_tokens, 0)
             ), 0) FROM ai_usage_records WHERE created_at_ms >= ?1",
            [since_ms],
            |row| row.get::<_, i64>(0),
        )?;
        u64::try_from(value)
            .map_err(|_| StorageError::InvalidData("AI token total is invalid".to_string()))
    }

    pub fn create_ai_conversation(
        &mut self,
        project_id: &str,
        title: &str,
    ) -> Result<AiConversation> {
        validate_conversation_title(title)?;
        let id = new_id();
        let now = now_ms();
        self.connection.execute(
            "INSERT INTO ai_conversations (
                id, project_id, title, archived, revision, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, 0, 0, ?4, ?4)",
            params![id, project_id, title.trim(), now],
        )?;
        self.get_ai_conversation(&id)
    }

    pub fn get_ai_conversation(&self, conversation_id: &str) -> Result<AiConversation> {
        self.connection
            .query_row(
                "SELECT id, project_id, title, archived, revision,
                        created_at_ms, updated_at_ms
                 FROM ai_conversations WHERE id = ?1",
                [conversation_id],
                row_to_ai_conversation,
            )
            .optional()?
            .ok_or_else(|| not_found("ai_conversation", conversation_id))
    }

    pub fn list_ai_conversations(
        &self,
        project_id: &str,
        include_archived: bool,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AiConversation>, u32)> {
        validate_page(limit, 200)?;
        let predicate = if include_archived {
            "project_id = ?1"
        } else {
            "project_id = ?1 AND archived = 0"
        };
        let total = self.connection.query_row(
            &format!("SELECT COUNT(*) FROM ai_conversations WHERE {predicate}"),
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(&format!(
            "SELECT id, project_id, title, archived, revision, created_at_ms, updated_at_ms
             FROM ai_conversations WHERE {predicate}
             ORDER BY updated_at_ms DESC, id LIMIT ?2 OFFSET ?3"
        ))?;
        let items = statement
            .query_map(params![project_id, limit, offset], row_to_ai_conversation)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn update_ai_conversation(
        &mut self,
        conversation_id: &str,
        title: &str,
        archived: bool,
        expected_revision: u64,
    ) -> Result<AiConversation> {
        validate_conversation_title(title)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_ai_conversation(&transaction, conversation_id)?;
        ensure_entity_revision(
            "ai_conversation",
            conversation_id,
            current.revision,
            expected_revision,
        )?;
        transaction.execute(
            "UPDATE ai_conversations
             SET title = ?1, archived = ?2, revision = revision + 1,
                 updated_at_ms = ?3
             WHERE id = ?4 AND revision = ?5",
            params![
                title.trim(),
                archived,
                now_ms(),
                conversation_id,
                to_i64(expected_revision)?
            ],
        )?;
        transaction.commit()?;
        self.get_ai_conversation(conversation_id)
    }

    pub fn append_ai_conversation_message(
        &mut self,
        conversation_id: &str,
        role: AiConversationRole,
        text: &str,
        target_proposal: Option<&str>,
        segment_id: Option<&str>,
        run_id: Option<&str>,
    ) -> Result<AiConversationMessage> {
        if text.trim().is_empty() || text.len() > 2 * 1024 * 1024 {
            return Err(StorageError::InvalidState(
                "AI conversation message must contain 1..2097152 bytes".to_string(),
            ));
        }
        let id = new_id();
        let now = now_ms();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        find_ai_conversation(&transaction, conversation_id)?;
        transaction.execute(
            "INSERT INTO ai_messages (
                id, conversation_id, role, text, target_proposal,
                segment_id, run_id, created_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                conversation_id,
                conversation_role_text(role),
                text,
                target_proposal,
                segment_id,
                run_id,
                now,
            ],
        )?;
        transaction.execute(
            "UPDATE ai_conversations SET updated_at_ms = ?1 WHERE id = ?2",
            params![now, conversation_id],
        )?;
        transaction.commit()?;
        self.connection
            .query_row(
                "SELECT id, conversation_id, role, text, target_proposal,
                        segment_id, run_id, created_at_ms
                 FROM ai_messages WHERE id = ?1",
                [id],
                row_to_ai_conversation_message,
            )
            .map_err(Into::into)
    }

    pub fn list_ai_conversation_messages(
        &self,
        conversation_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AiConversationMessage>, u32)> {
        validate_page(limit, 500)?;
        find_ai_conversation(&self.connection, conversation_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM ai_messages WHERE conversation_id = ?1",
            [conversation_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, conversation_id, role, text, target_proposal,
                    segment_id, run_id, created_at_ms
             FROM ai_messages WHERE conversation_id = ?1
             ORDER BY created_at_ms, id LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![conversation_id, limit, offset],
                row_to_ai_conversation_message,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }
}

pub(super) fn interrupt_orphaned_ai_work(connection: &mut Connection) -> Result<()> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let now = now_ms();
    let mut statement = transaction.prepare(
        "SELECT id, attempt FROM ai_runs
         WHERE status IN ('running', 'retrying', 'canceling') ORDER BY id",
    )?;
    let runs = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, read_u32(row, 1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(statement);
    for (run_id, attempt) in runs {
        transaction.execute(
            "UPDATE ai_runs
             SET status = 'interrupted', revision = revision + 1,
                 cancellation_requested = 0, updated_at_ms = ?1
             WHERE id = ?2",
            params![now, run_id],
        )?;
        append_ai_event_tx(
            &transaction,
            &run_id,
            AiEventInput {
                kind: AiRunEventKind::Interrupted,
                attempt: Some(attempt),
                message: Some("AI run was interrupted by process restart."),
                created_at_ms: now,
                ..AiEventInput::default()
            },
        )?;
    }
    transaction.execute(
        "UPDATE ai_batch_items
         SET status = 'pending', run_id = NULL, updated_at_ms = ?1
         WHERE status IN ('running', 'retrying')",
        [now],
    )?;
    transaction.execute(
        "UPDATE ai_batch_runs
         SET status = 'interrupted', revision = revision + 1,
             cancellation_requested = 0, updated_at_ms = ?1
         WHERE status IN ('running', 'canceling')",
        [now],
    )?;
    transaction.commit()?;
    Ok(())
}

const AI_PROFILE_SELECT: &str =
    "SELECT id, name, kind, base_url, model, timeout_ms, max_response_bytes,
            enabled, credential_present, revision, created_at_ms, updated_at_ms
     FROM ai_provider_profiles";

const AI_RUN_SELECT: &str =
    "SELECT id, kind, project_id, document_id, segment_id, profile_id, model,
            action, prompt_hash, request_json, base_segment_revision, status, revision, attempt,
            max_attempts, cancellation_requested, proposal_text, error_code,
            error_message, error_retryable, created_at_ms, started_at_ms,
            completed_at_ms, updated_at_ms
     FROM ai_runs";

const AI_BATCH_SELECT: &str = "SELECT id, project_id, document_id, profile_id, status, revision,
            tm_threshold, concurrency, requests_per_minute, max_attempts,
            replace_drafts, grounding_options_json, cancellation_requested, total, completed, succeeded,
            failed, skipped, tm_applied, usage_json, created_at_ms, started_at_ms,
            completed_at_ms, updated_at_ms
     FROM ai_batch_runs";

const AI_USAGE_SELECT: &str =
    "SELECT id, run_id, attempt, project_id, document_id, profile_id, provider,
            model, status, input_tokens, cache_read_tokens, reasoning_tokens,
            output_tokens, cache_write_tokens, elapsed_ms, created_at_ms
     FROM ai_usage_records";

fn find_ai_provider_profile(
    connection: &Connection,
    profile_id: &str,
) -> Result<AiProviderProfile> {
    connection
        .query_row(
            &format!("{AI_PROFILE_SELECT} WHERE id = ?1"),
            [profile_id],
            row_to_ai_provider_profile,
        )
        .optional()?
        .ok_or_else(|| not_found("ai_provider_profile", profile_id))
}

fn row_to_ai_provider_profile(row: &Row<'_>) -> rusqlite::Result<AiProviderProfile> {
    Ok(AiProviderProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: parse_provider_kind(row.get::<_, String>(2)?, 2)?,
        base_url: row.get(3)?,
        model: row.get(4)?,
        timeout_ms: read_u32(row, 5)?,
        max_response_bytes: read_u32(row, 6)?,
        enabled: row.get(7)?,
        credential_present: row.get(8)?,
        revision: read_u64(row, 9)?,
        created_at_ms: row.get(10)?,
        updated_at_ms: row.get(11)?,
    })
}

fn row_to_ai_settings(row: &Row<'_>) -> rusqlite::Result<AiSettings> {
    let allowed_origins = serde_json::from_str(&row.get::<_, String>(5)?)
        .map_err(|error| conversion_error(5, error))?;
    Ok(AiSettings {
        enabled: row.get(0)?,
        default_profile_id: row.get(1)?,
        monthly_token_budget: read_optional_u64(row, 2)?,
        allow_interactive: row.get(3)?,
        allow_batch: row.get(4)?,
        allowed_origins,
        revision: read_u64(row, 6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn find_ai_run(connection: &Connection, run_id: &str) -> Result<AiRun> {
    connection
        .query_row(
            &format!("{AI_RUN_SELECT} WHERE id = ?1"),
            [run_id],
            row_to_ai_run,
        )
        .optional()?
        .ok_or_else(|| not_found("ai_run", run_id))
}

fn row_to_ai_run(row: &Row<'_>) -> rusqlite::Result<AiRun> {
    Ok(AiRun {
        id: row.get(0)?,
        kind: parse_run_kind(row.get::<_, String>(1)?, 1)?,
        project_id: row.get(2)?,
        document_id: row.get(3)?,
        segment_id: row.get(4)?,
        profile_id: row.get(5)?,
        model: row.get(6)?,
        action: row.get(7)?,
        prompt_hash: row.get(8)?,
        request: serde_json::from_str(&row.get::<_, String>(9)?)
            .map_err(|error| conversion_error(9, error))?,
        base_segment_revision: read_optional_u64(row, 10)?,
        status: parse_run_status(row.get::<_, String>(11)?, 11)?,
        revision: read_u64(row, 12)?,
        attempt: read_u32(row, 13)?,
        max_attempts: read_u32(row, 14)?,
        cancellation_requested: row.get(15)?,
        proposal_text: row.get(16)?,
        error_code: row.get(17)?,
        error_message: row.get(18)?,
        error_retryable: row.get(19)?,
        created_at_ms: row.get(20)?,
        started_at_ms: row.get(21)?,
        completed_at_ms: row.get(22)?,
        updated_at_ms: row.get(23)?,
    })
}

fn row_to_ai_run_event(row: &Row<'_>) -> rusqlite::Result<AiRunEvent> {
    let usage = row
        .get::<_, Option<String>>(4)?
        .map(|value| serde_json::from_str(&value).map_err(|error| conversion_error(4, error)))
        .transpose()?;
    Ok(AiRunEvent {
        run_id: row.get(0)?,
        sequence: read_u64(row, 1)?,
        kind: parse_event_kind(row.get::<_, String>(2)?, 2)?,
        delta_text: row.get(3)?,
        usage,
        attempt: row
            .get::<_, Option<i64>>(5)?
            .map(|value| u32::try_from(value).map_err(|error| conversion_error(5, error)))
            .transpose()?,
        retry_after_ms: read_optional_u64(row, 6)?,
        message: row.get(7)?,
        created_at_ms: row.get(8)?,
    })
}

struct AiEventInput<'a> {
    kind: AiRunEventKind,
    delta_text: Option<&'a str>,
    usage: Option<&'a AiUsage>,
    attempt: Option<u32>,
    retry_after_ms: Option<u64>,
    message: Option<&'a str>,
    created_at_ms: i64,
}

impl Default for AiEventInput<'_> {
    fn default() -> Self {
        Self {
            kind: AiRunEventKind::Started,
            delta_text: None,
            usage: None,
            attempt: None,
            retry_after_ms: None,
            message: None,
            created_at_ms: 0,
        }
    }
}

fn append_ai_event_tx(
    transaction: &Transaction<'_>,
    run_id: &str,
    input: AiEventInput<'_>,
) -> Result<AiRunEvent> {
    let sequence = transaction.query_row(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM ai_run_events WHERE run_id = ?1",
        [run_id],
        |row| row.get::<_, i64>(0),
    )?;
    let usage_json = input.usage.map(serde_json::to_string).transpose()?;
    transaction.execute(
        "INSERT INTO ai_run_events (
            run_id, sequence, kind, delta_text, usage_json, attempt,
            retry_after_ms, message, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            run_id,
            sequence,
            event_kind_text(input.kind),
            input.delta_text,
            usage_json,
            input.attempt,
            input.retry_after_ms.map(to_i64).transpose()?,
            input.message,
            input.created_at_ms,
        ],
    )?;
    Ok(AiRunEvent {
        run_id: run_id.to_string(),
        sequence: u64::try_from(sequence)
            .map_err(|_| StorageError::InvalidData("AI event sequence is invalid".to_string()))?,
        kind: input.kind,
        delta_text: input.delta_text.map(ToOwned::to_owned),
        usage: input.usage.cloned(),
        attempt: input.attempt,
        retry_after_ms: input.retry_after_ms,
        message: input.message.map(ToOwned::to_owned),
        created_at_ms: input.created_at_ms,
    })
}

pub(super) fn complete_ai_run_tx(
    transaction: &Transaction<'_>,
    run_id: &str,
    proposal_text: &str,
    provider: AiProviderKind,
    usage: &AiUsage,
    elapsed_ms: u64,
) -> Result<()> {
    if proposal_text.trim().is_empty() {
        return Err(StorageError::InvalidState(
            "AI proposal must not be empty".to_string(),
        ));
    }
    let run = find_ai_run(transaction, run_id)?;
    if run.status != AiRunStatus::Running || run.cancellation_requested {
        return Err(StorageError::InvalidState(
            "AI run cannot complete in its current state".to_string(),
        ));
    }
    let now = now_ms();
    let changed = transaction.execute(
        "UPDATE ai_runs
         SET status = 'succeeded', proposal_text = ?1,
             revision = revision + 1, error_code = NULL, error_message = NULL,
             error_retryable = 0, completed_at_ms = ?2, updated_at_ms = ?2
         WHERE id = ?3 AND revision = ?4",
        params![proposal_text, now, run_id, to_i64(run.revision)?],
    )?;
    if changed != 1 {
        return Err(StorageError::InvalidState(
            "AI run completion lost its revision".to_string(),
        ));
    }
    append_ai_event_tx(
        transaction,
        run_id,
        AiEventInput {
            kind: AiRunEventKind::Usage,
            usage: Some(usage),
            attempt: Some(run.attempt),
            created_at_ms: now,
            ..AiEventInput::default()
        },
    )?;
    append_ai_event_tx(
        transaction,
        run_id,
        AiEventInput {
            kind: AiRunEventKind::Completed,
            attempt: Some(run.attempt),
            created_at_ms: now,
            ..AiEventInput::default()
        },
    )?;
    insert_ai_usage_tx(
        transaction,
        &run,
        provider,
        "succeeded",
        usage,
        elapsed_ms,
        now,
    )
}

fn insert_ai_usage_tx(
    transaction: &Transaction<'_>,
    run: &AiRun,
    provider: AiProviderKind,
    status: &str,
    usage: &AiUsage,
    elapsed_ms: u64,
    created_at_ms: i64,
) -> Result<()> {
    transaction.execute(
        "INSERT INTO ai_usage_records (
            id, run_id, attempt, project_id, document_id, profile_id, provider,
            model, status, input_tokens, cache_read_tokens, reasoning_tokens,
            output_tokens, cache_write_tokens, elapsed_ms, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(run_id, attempt) DO NOTHING",
        params![
            new_id(),
            run.id,
            run.attempt,
            run.project_id,
            run.document_id,
            run.profile_id,
            provider_kind_text(provider),
            run.model,
            status,
            usage.input_tokens.map(to_i64).transpose()?,
            usage.cache_read_tokens.map(to_i64).transpose()?,
            usage.reasoning_tokens.map(to_i64).transpose()?,
            usage.output_tokens.map(to_i64).transpose()?,
            usage.cache_write_tokens.map(to_i64).transpose()?,
            to_i64(elapsed_ms)?,
            created_at_ms,
        ],
    )?;
    Ok(())
}

fn find_ai_batch(connection: &Connection, batch_id: &str) -> Result<AiBatchRun> {
    connection
        .query_row(
            &format!("{AI_BATCH_SELECT} WHERE id = ?1"),
            [batch_id],
            row_to_ai_batch,
        )
        .optional()?
        .ok_or_else(|| not_found("ai_batch", batch_id))
}

fn row_to_ai_batch(row: &Row<'_>) -> rusqlite::Result<AiBatchRun> {
    Ok(AiBatchRun {
        id: row.get(0)?,
        project_id: row.get(1)?,
        document_id: row.get(2)?,
        profile_id: row.get(3)?,
        status: parse_batch_status(row.get::<_, String>(4)?, 4)?,
        revision: read_u64(row, 5)?,
        tm_threshold: read_u8(row, 6)?,
        concurrency: read_u8(row, 7)?,
        requests_per_minute: read_u16(row, 8)?,
        max_attempts: read_u8(row, 9)?,
        replace_drafts: row.get(10)?,
        grounding_options: serde_json::from_str(&row.get::<_, String>(11)?)
            .map_err(|error| conversion_error(11, error))?,
        cancellation_requested: row.get(12)?,
        total: read_u32(row, 13)?,
        completed: read_u32(row, 14)?,
        succeeded: read_u32(row, 15)?,
        failed: read_u32(row, 16)?,
        skipped: read_u32(row, 17)?,
        tm_applied: read_u32(row, 18)?,
        usage: serde_json::from_str(&row.get::<_, String>(19)?)
            .map_err(|error| conversion_error(19, error))?,
        created_at_ms: row.get(20)?,
        started_at_ms: row.get(21)?,
        completed_at_ms: row.get(22)?,
        updated_at_ms: row.get(23)?,
    })
}

fn find_ai_batch_item(
    connection: &Connection,
    batch_id: &str,
    segment_id: &str,
) -> Result<AiBatchItem> {
    connection
        .query_row(
            "SELECT batch_id, segment_id, ordinal, expected_revision, status,
                    source, attempts, run_id, error_code, updated_at_ms
             FROM ai_batch_items WHERE batch_id = ?1 AND segment_id = ?2",
            params![batch_id, segment_id],
            row_to_ai_batch_item,
        )
        .optional()?
        .ok_or_else(|| not_found("ai_batch_item", segment_id))
}

fn row_to_ai_batch_item(row: &Row<'_>) -> rusqlite::Result<AiBatchItem> {
    Ok(AiBatchItem {
        batch_id: row.get(0)?,
        segment_id: row.get(1)?,
        ordinal: read_u32(row, 2)?,
        expected_revision: read_u64(row, 3)?,
        status: parse_batch_item_status(row.get::<_, String>(4)?, 4)?,
        source: row.get(5)?,
        attempts: read_u32(row, 6)?,
        run_id: row.get(7)?,
        error_code: row.get(8)?,
        updated_at_ms: row.get(9)?,
    })
}

fn recompute_ai_batch_tx(transaction: &Transaction<'_>, batch_id: &str, now: i64) -> Result<()> {
    let (total, completed, succeeded, failed, skipped, tm_applied, running) = transaction
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN status IN ('tm_applied','succeeded','failed','skipped','canceled') THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status IN ('skipped','canceled') THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status = 'tm_applied' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status IN ('pending','running','retrying') THEN 1 ELSE 0 END), 0)
             FROM ai_batch_items WHERE batch_id = ?1",
            [batch_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )?;
    let batch = find_ai_batch(transaction, batch_id)?;
    let terminal_status = if running == 0 {
        Some(if batch.cancellation_requested {
            "canceled"
        } else if failed > 0 {
            "completed_with_errors"
        } else {
            "succeeded"
        })
    } else {
        None
    };
    transaction.execute(
        "UPDATE ai_batch_runs
         SET total = ?1, completed = ?2, succeeded = ?3, failed = ?4,
             skipped = ?5, tm_applied = ?6,
             status = COALESCE(?7, status),
             completed_at_ms = CASE WHEN ?7 IS NULL THEN completed_at_ms ELSE ?8 END,
             revision = revision + 1, updated_at_ms = ?8
         WHERE id = ?9",
        params![
            total,
            completed,
            succeeded,
            failed,
            skipped,
            tm_applied,
            terminal_status,
            now,
            batch_id,
        ],
    )?;
    Ok(())
}

fn row_to_ai_usage_record(row: &Row<'_>) -> rusqlite::Result<AiUsageRecord> {
    Ok(AiUsageRecord {
        id: row.get(0)?,
        run_id: row.get(1)?,
        attempt: read_u32(row, 2)?,
        project_id: row.get(3)?,
        document_id: row.get(4)?,
        profile_id: row.get(5)?,
        provider: parse_provider_kind(row.get::<_, String>(6)?, 6)?,
        model: row.get(7)?,
        status: row.get(8)?,
        usage: AiUsage {
            input_tokens: read_optional_u64(row, 9)?,
            cache_read_tokens: read_optional_u64(row, 10)?,
            reasoning_tokens: read_optional_u64(row, 11)?,
            output_tokens: read_optional_u64(row, 12)?,
            cache_write_tokens: read_optional_u64(row, 13)?,
        },
        elapsed_ms: read_u64(row, 14)?,
        created_at_ms: row.get(15)?,
    })
}

fn find_ai_conversation(connection: &Connection, conversation_id: &str) -> Result<AiConversation> {
    connection
        .query_row(
            "SELECT id, project_id, title, archived, revision,
                    created_at_ms, updated_at_ms
             FROM ai_conversations WHERE id = ?1",
            [conversation_id],
            row_to_ai_conversation,
        )
        .optional()?
        .ok_or_else(|| not_found("ai_conversation", conversation_id))
}

fn row_to_ai_conversation(row: &Row<'_>) -> rusqlite::Result<AiConversation> {
    Ok(AiConversation {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        archived: row.get(3)?,
        revision: read_u64(row, 4)?,
        created_at_ms: row.get(5)?,
        updated_at_ms: row.get(6)?,
    })
}

fn row_to_ai_conversation_message(row: &Row<'_>) -> rusqlite::Result<AiConversationMessage> {
    Ok(AiConversationMessage {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        role: parse_conversation_role(row.get::<_, String>(2)?, 2)?,
        text: row.get(3)?,
        target_proposal: row.get(4)?,
        segment_id: row.get(5)?,
        run_id: row.get(6)?,
        created_at_ms: row.get(7)?,
    })
}

fn normalize_origins(values: &[String]) -> Result<Vec<String>> {
    if values.len() > 64 {
        return Err(StorageError::InvalidState(
            "AI allowed origins cannot contain more than 64 entries".to_string(),
        ));
    }
    let mut normalized = BTreeSet::new();
    for value in values {
        let url = translunar_ai_core::validate_endpoint(value)
            .map_err(|error| StorageError::InvalidState(error.to_string()))?;
        let origin = url.origin().ascii_serialization();
        if origin == "null" {
            return Err(StorageError::InvalidState(
                "AI allowed origin is invalid".to_string(),
            ));
        }
        normalized.insert(origin);
    }
    Ok(normalized.into_iter().collect())
}

fn validate_new_run(input: &NewAiRun) -> Result<()> {
    if input.model.trim().is_empty() || input.model.chars().count() > 200 {
        return Err(StorageError::InvalidState(
            "AI run model must contain 1..200 characters".to_string(),
        ));
    }
    if input.action.trim().is_empty() || input.action.chars().count() > 80 {
        return Err(StorageError::InvalidState(
            "AI run action must contain 1..80 characters".to_string(),
        ));
    }
    if input.prompt_hash.len() != 64
        || !input
            .prompt_hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(StorageError::InvalidState(
            "AI run prompt hash must be SHA-256 hex".to_string(),
        ));
    }
    if !(1..=10).contains(&input.max_attempts) {
        return Err(StorageError::InvalidState(
            "AI run max attempts must be 1..10".to_string(),
        ));
    }
    let is_alignment_refinement = input.action == ALIGNMENT_REFINEMENT_ACTION;
    if is_alignment_refinement != input.request.alignment_refinement.is_some() {
        return Err(StorageError::InvalidState(
            "AI alignment refinement action and context must be provided together".to_string(),
        ));
    }
    if is_alignment_refinement
        && (input.kind != AiRunKind::Action
            || input.project_id.is_none()
            || input.profile_id.is_none()
            || input.document_id.is_some()
            || input.segment_id.is_some())
    {
        return Err(StorageError::InvalidState(
            "AI alignment refinement run bindings are invalid".to_string(),
        ));
    }
    Ok(())
}

fn validate_new_batch(input: &NewAiBatchRun, items: &[NewAiBatchItem]) -> Result<()> {
    if input.tm_threshold > 101
        || !(1..=16).contains(&input.concurrency)
        || !(1..=600).contains(&input.requests_per_minute)
        || !(1..=10).contains(&input.max_attempts)
    {
        return Err(StorageError::InvalidState(
            "AI batch limits are invalid".to_string(),
        ));
    }
    if items.len() > 100_000 {
        return Err(StorageError::InvalidState(
            "AI batch must contain at most 100000 segments".to_string(),
        ));
    }
    let mut ids = BTreeSet::new();
    if items
        .iter()
        .any(|item| !ids.insert(item.segment_id.as_str()))
    {
        return Err(StorageError::InvalidState(
            "AI batch contains duplicate segments".to_string(),
        ));
    }
    Ok(())
}

fn validate_page(limit: u32, maximum: u32) -> Result<()> {
    if limit == 0 || limit > maximum {
        Err(StorageError::InvalidState(format!(
            "page limit must be 1..{maximum}"
        )))
    } else {
        Ok(())
    }
}

fn validate_time_range(since_ms: i64, until_ms: i64) -> Result<()> {
    if since_ms < 0 || until_ms <= since_ms {
        Err(StorageError::InvalidState(
            "AI usage time range is invalid".to_string(),
        ))
    } else {
        Ok(())
    }
}

fn validate_error_code(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 80
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        Err(StorageError::InvalidState(
            "AI error code must be bounded snake_case".to_string(),
        ))
    } else {
        Ok(())
    }
}

fn validate_conversation_title(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > 120 {
        Err(StorageError::InvalidState(
            "AI conversation title must contain 1..120 characters".to_string(),
        ))
    } else {
        Ok(())
    }
}

fn provider_kind_text(kind: AiProviderKind) -> &'static str {
    match kind {
        AiProviderKind::Openai => "openai",
        AiProviderKind::Anthropic => "anthropic",
        AiProviderKind::Gemini => "gemini",
        AiProviderKind::Deepl => "deepl",
        AiProviderKind::Deepseek => "deepseek",
        AiProviderKind::Qwen => "qwen",
        AiProviderKind::Glm => "glm",
        AiProviderKind::Kimi => "kimi",
        AiProviderKind::Volcengine => "volcengine",
        AiProviderKind::OpenaiCompatible => "openai_compatible",
    }
}

fn parse_provider_kind(value: String, column: usize) -> rusqlite::Result<AiProviderKind> {
    match value.as_str() {
        "openai" => Ok(AiProviderKind::Openai),
        "anthropic" => Ok(AiProviderKind::Anthropic),
        "gemini" => Ok(AiProviderKind::Gemini),
        "deepl" => Ok(AiProviderKind::Deepl),
        "deepseek" => Ok(AiProviderKind::Deepseek),
        "qwen" => Ok(AiProviderKind::Qwen),
        "glm" => Ok(AiProviderKind::Glm),
        "kimi" => Ok(AiProviderKind::Kimi),
        "volcengine" => Ok(AiProviderKind::Volcengine),
        "openai_compatible" => Ok(AiProviderKind::OpenaiCompatible),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown AI provider kind {value}")),
        )),
    }
}

fn run_kind_text(kind: AiRunKind) -> &'static str {
    match kind {
        AiRunKind::Interactive => "interactive",
        AiRunKind::Action => "action",
        AiRunKind::ProviderTest => "provider_test",
        AiRunKind::BatchItem => "batch_item",
    }
}

fn parse_run_kind(value: String, column: usize) -> rusqlite::Result<AiRunKind> {
    match value.as_str() {
        "interactive" => Ok(AiRunKind::Interactive),
        "action" => Ok(AiRunKind::Action),
        "provider_test" => Ok(AiRunKind::ProviderTest),
        "batch_item" => Ok(AiRunKind::BatchItem),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown AI run kind {value}")),
        )),
    }
}

fn parse_run_status(value: String, column: usize) -> rusqlite::Result<AiRunStatus> {
    match value.as_str() {
        "queued" => Ok(AiRunStatus::Queued),
        "running" => Ok(AiRunStatus::Running),
        "retrying" => Ok(AiRunStatus::Retrying),
        "interrupted" => Ok(AiRunStatus::Interrupted),
        "canceling" => Ok(AiRunStatus::Canceling),
        "canceled" => Ok(AiRunStatus::Canceled),
        "succeeded" => Ok(AiRunStatus::Succeeded),
        "failed" => Ok(AiRunStatus::Failed),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown AI run status {value}")),
        )),
    }
}

fn event_kind_text(kind: AiRunEventKind) -> &'static str {
    match kind {
        AiRunEventKind::Started => "started",
        AiRunEventKind::Attempt => "attempt",
        AiRunEventKind::Delta => "delta",
        AiRunEventKind::Usage => "usage",
        AiRunEventKind::Retry => "retry",
        AiRunEventKind::Completed => "completed",
        AiRunEventKind::Failed => "failed",
        AiRunEventKind::Canceling => "canceling",
        AiRunEventKind::Canceled => "canceled",
        AiRunEventKind::Interrupted => "interrupted",
    }
}

fn parse_event_kind(value: String, column: usize) -> rusqlite::Result<AiRunEventKind> {
    match value.as_str() {
        "started" => Ok(AiRunEventKind::Started),
        "attempt" => Ok(AiRunEventKind::Attempt),
        "delta" => Ok(AiRunEventKind::Delta),
        "usage" => Ok(AiRunEventKind::Usage),
        "retry" => Ok(AiRunEventKind::Retry),
        "completed" => Ok(AiRunEventKind::Completed),
        "failed" => Ok(AiRunEventKind::Failed),
        "canceling" => Ok(AiRunEventKind::Canceling),
        "canceled" => Ok(AiRunEventKind::Canceled),
        "interrupted" => Ok(AiRunEventKind::Interrupted),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown AI run event kind {value}")),
        )),
    }
}

fn parse_batch_status(value: String, column: usize) -> rusqlite::Result<AiBatchStatus> {
    match value.as_str() {
        "queued" => Ok(AiBatchStatus::Queued),
        "running" => Ok(AiBatchStatus::Running),
        "interrupted" => Ok(AiBatchStatus::Interrupted),
        "canceling" => Ok(AiBatchStatus::Canceling),
        "canceled" => Ok(AiBatchStatus::Canceled),
        "succeeded" => Ok(AiBatchStatus::Succeeded),
        "completed_with_errors" => Ok(AiBatchStatus::CompletedWithErrors),
        "failed" => Ok(AiBatchStatus::Failed),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown AI batch status {value}")),
        )),
    }
}

fn batch_item_status_text(status: AiBatchItemStatus) -> &'static str {
    match status {
        AiBatchItemStatus::Pending => "pending",
        AiBatchItemStatus::TmApplied => "tm_applied",
        AiBatchItemStatus::Running => "running",
        AiBatchItemStatus::Succeeded => "succeeded",
        AiBatchItemStatus::Retrying => "retrying",
        AiBatchItemStatus::Failed => "failed",
        AiBatchItemStatus::Skipped => "skipped",
        AiBatchItemStatus::Canceled => "canceled",
    }
}

fn parse_batch_item_status(value: String, column: usize) -> rusqlite::Result<AiBatchItemStatus> {
    match value.as_str() {
        "pending" => Ok(AiBatchItemStatus::Pending),
        "tm_applied" => Ok(AiBatchItemStatus::TmApplied),
        "running" => Ok(AiBatchItemStatus::Running),
        "succeeded" => Ok(AiBatchItemStatus::Succeeded),
        "retrying" => Ok(AiBatchItemStatus::Retrying),
        "failed" => Ok(AiBatchItemStatus::Failed),
        "skipped" => Ok(AiBatchItemStatus::Skipped),
        "canceled" => Ok(AiBatchItemStatus::Canceled),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown AI batch item status {value}")),
        )),
    }
}

fn conversation_role_text(role: AiConversationRole) -> &'static str {
    match role {
        AiConversationRole::User => "user",
        AiConversationRole::Assistant => "assistant",
    }
}

fn parse_conversation_role(value: String, column: usize) -> rusqlite::Result<AiConversationRole> {
    match value.as_str() {
        "user" => Ok(AiConversationRole::User),
        "assistant" => Ok(AiConversationRole::Assistant),
        _ => Err(conversion_error(
            column,
            StorageError::InvalidData(format!("unknown AI conversation role {value}")),
        )),
    }
}

fn read_u8(row: &Row<'_>, column: usize) -> rusqlite::Result<u8> {
    let value = read_u32(row, column)?;
    u8::try_from(value).map_err(|error| conversion_error(column, error))
}

fn read_u16(row: &Row<'_>, column: usize) -> rusqlite::Result<u16> {
    let value = read_u32(row, column)?;
    u16::try_from(value).map_err(|error| conversion_error(column, error))
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;
    use translunar_ai_core::{AiProviderKind, AiRunKind, AiRunStatus, AiUsageDimension};
    use translunar_filter_core::ImportedUnit;

    use super::*;
    use crate::store::NewDocument;

    fn profile_input(base_url: String) -> NewAiProviderProfile {
        NewAiProviderProfile {
            name: "Local fixture".to_string(),
            kind: AiProviderKind::OpenaiCompatible,
            base_url,
            model: "fixture-model".to_string(),
            timeout_ms: 5_000,
            max_response_bytes: 1_048_576,
            enabled: true,
        }
    }

    #[test]
    fn profiles_settings_runs_usage_and_conversations_survive_restart() {
        let root = tempdir().expect("temporary AI store");
        let (profile_id, run_id, project_id, conversation_id) = {
            let mut store = Store::open(root.path()).expect("open AI store");
            let project = store
                .create_project("AI project", "en-US", "zh-CN", "legal")
                .expect("create project");
            let profile = store
                .create_ai_provider_profile(profile_input("http://127.0.0.1:11434/v1".to_string()))
                .expect("create profile");
            let profile = store
                .set_ai_provider_credential_present(&profile.id, true)
                .expect("mark credential present");
            let settings = store.get_ai_settings().expect("default AI settings");
            let settings = store
                .update_ai_settings(AiSettingsUpdate {
                    enabled: true,
                    default_profile_id: Some(profile.id.clone()),
                    monthly_token_budget: Some(50_000),
                    allow_interactive: true,
                    allow_batch: true,
                    allowed_origins: vec!["http://127.0.0.1:11434/v1".to_string()],
                    expected_revision: settings.revision,
                })
                .expect("update settings");
            assert!(settings.enabled);
            assert_eq!(settings.allowed_origins, ["http://127.0.0.1:11434"]);

            let run = store
                .create_ai_run(NewAiRun {
                    kind: AiRunKind::Interactive,
                    project_id: Some(project.id.clone()),
                    document_id: None,
                    segment_id: None,
                    profile_id: Some(profile.id.clone()),
                    model: profile.model.clone(),
                    action: "translate".to_string(),
                    prompt_hash: "a".repeat(64),
                    request: AiRunRequest {
                        grounding_options: GroundingOptions::default(),
                        freeform_prompt: String::new(),
                        conversation_id: None,
                        alignment_refinement: None,
                    },
                    base_segment_revision: None,
                    max_attempts: 3,
                })
                .expect("create run");
            let run = store.start_ai_run_attempt(&run.id).expect("start run");
            assert_eq!(run.status, AiRunStatus::Running);
            store
                .append_ai_run_delta(&run.id, "译")
                .expect("append delta");
            let run = store
                .complete_ai_run(
                    &run.id,
                    "译文",
                    AiProviderKind::OpenaiCompatible,
                    AiUsage {
                        input_tokens: Some(10),
                        output_tokens: Some(2),
                        ..AiUsage::default()
                    },
                    120,
                )
                .expect("complete run");
            assert_eq!(run.status, AiRunStatus::Succeeded);
            assert_eq!(
                store
                    .list_ai_run_events(&run.id, 0, 50)
                    .expect("list events")
                    .len(),
                4
            );
            assert_eq!(store.ai_token_usage_since(0).expect("token usage"), 12);
            let aggregate = store
                .aggregate_ai_usage(None, 0, i64::MAX, AiUsageDimension::Provider)
                .expect("aggregate usage");
            assert_eq!(aggregate[0].request_count, 1);

            let conversation = store
                .create_ai_conversation(&project.id, "Clause translation")
                .expect("create conversation");
            store
                .append_ai_conversation_message(
                    &conversation.id,
                    AiConversationRole::Assistant,
                    "译文",
                    Some("译文"),
                    None,
                    Some(&run.id),
                )
                .expect("append message");
            (profile.id, run.id, project.id, conversation.id)
        };

        let store = Store::open(root.path()).expect("reopen AI store");
        assert!(
            store
                .get_ai_provider_profile(&profile_id)
                .expect("persisted profile")
                .credential_present
        );
        assert_eq!(
            store.get_ai_run(&run_id).expect("persisted run").status,
            AiRunStatus::Succeeded
        );
        assert_eq!(
            store
                .list_ai_conversation_messages(&conversation_id, 0, 50)
                .expect("persisted messages")
                .0
                .len(),
            1
        );
        assert_eq!(
            store
                .list_ai_conversations(&project_id, false, 0, 50)
                .expect("persisted conversations")
                .1,
            1
        );
    }

    #[test]
    fn batch_state_is_durable_and_interrupted_work_resumes() {
        let root = tempdir().expect("temporary batch store");
        let (batch_id, project_id) = {
            let mut store = Store::open(root.path()).expect("open batch store");
            let project = store
                .create_project("Batch project", "en-US", "zh-CN", "general")
                .expect("create project");
            let profile = store
                .create_ai_provider_profile(profile_input("http://127.0.0.1:11434/v1".to_string()))
                .expect("create profile");
            let profile = store
                .set_ai_provider_credential_present(&profile.id, true)
                .expect("mark credential present");
            let source = root.path().join("batch.txt");
            std::fs::write(&source, "One.\n\nTwo.").expect("write batch fixture");
            let new_document = NewDocument {
                id: new_id(),
                project_id: project.id.clone(),
                name: "batch.txt".to_string(),
                relative_path: "batch.txt".to_string(),
                format: "txt".to_string(),
                filter_id: "builtin.txt".to_string(),
                source_sha256: "fixture".to_string(),
                degradation: Vec::new(),
                original_source_path: source.clone(),
                managed_source_path: source,
            };
            let units = vec![
                ImportedUnit::plain(0, "0:4", "One."),
                ImportedUnit::plain(1, "6:10", "Two."),
            ];
            let document = store
                .insert_document(&new_document, &units)
                .expect("insert batch document");
            let segments = store
                .list_segments(&document.id, 0, 10)
                .expect("segments")
                .0;
            let items = segments
                .iter()
                .map(|segment| NewAiBatchItem {
                    segment_id: segment.id.clone(),
                    ordinal: segment.ordinal,
                    expected_revision: segment.revision,
                })
                .collect::<Vec<_>>();
            let batch = store
                .create_ai_batch(
                    NewAiBatchRun {
                        project_id: project.id.clone(),
                        document_id: Some(document.id),
                        profile_id: profile.id,
                        tm_threshold: 90,
                        concurrency: 2,
                        requests_per_minute: 60,
                        max_attempts: 3,
                        replace_drafts: false,
                        grounding_options: GroundingOptions::default(),
                    },
                    &items,
                )
                .expect("create batch");
            store.start_ai_batch(&batch.id).expect("start batch");
            let claimed = store
                .claim_ai_batch_item(&batch.id)
                .expect("claim batch item")
                .expect("claimed item");
            assert_eq!(claimed.status, AiBatchItemStatus::Running);
            (batch.id, project.id)
        };

        let mut store = Store::open(root.path()).expect("recover batch store");
        let interrupted = store.get_ai_batch(&batch_id).expect("interrupted batch");
        assert_eq!(interrupted.status, AiBatchStatus::Interrupted);
        let resumed = store
            .resume_ai_batch(&batch_id, interrupted.revision)
            .expect("resume batch");
        assert_eq!(resumed.status, AiBatchStatus::Queued);
        store.start_ai_batch(&batch_id).expect("restart batch");
        while let Some(item) = store.claim_ai_batch_item(&batch_id).expect("claim item") {
            store
                .finish_ai_batch_item(
                    &batch_id,
                    &item.segment_id,
                    AiBatchItemStatus::Succeeded,
                    Some("engine"),
                    None,
                )
                .expect("finish item");
        }
        let completed = store.get_ai_batch(&batch_id).expect("completed batch");
        assert_eq!(completed.status, AiBatchStatus::Succeeded);
        assert_eq!(completed.completed, 2);
        assert_eq!(
            store
                .list_ai_batches(&project_id, 0, 50)
                .expect("list batches")
                .1,
            1
        );
    }
}
