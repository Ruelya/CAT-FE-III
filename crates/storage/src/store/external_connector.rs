//! Durable external-connector profiles, credential presence, checkpoints,
//! and idempotency receipts. Secret values never enter SQLite.

use rusqlite::{OptionalExtension, Row, TransactionBehavior, params};
use serde_json::Value;
use sha2::{Digest, Sha256};
use translunar_domain::new_id;

use super::{Store, now_ms, read_u64, require_nonempty, to_i64};
use crate::{Result, StorageError};

const MAX_PAGE_SIZE: u32 = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalConnectorProfileRecord {
    pub id: String,
    pub display_name: String,
    pub contribution_id: String,
    pub plugin_id: String,
    pub version_id: String,
    pub activation_revision: u64,
    pub contract_version: u32,
    pub config_schema_version: u32,
    pub checkpoint_schema_version: u32,
    pub configuration: Value,
    pub origins: Vec<String>,
    pub operations: Vec<String>,
    pub descriptor_hash: String,
    pub config_hash: String,
    pub enabled: bool,
    pub credential_slots: Vec<ExternalConnectorCredentialPresence>,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalConnectorCredentialPresence {
    pub slot_id: String,
    pub present: bool,
}

#[derive(Debug, Clone)]
pub struct NewExternalConnectorProfile {
    pub display_name: String,
    pub contribution_id: String,
    pub plugin_id: String,
    pub version_id: String,
    pub activation_revision: u64,
    pub contract_version: u32,
    pub config_schema_version: u32,
    pub checkpoint_schema_version: u32,
    pub configuration: Value,
    pub origins: Vec<String>,
    pub operations: Vec<String>,
    pub descriptor_hash: String,
    pub credential_slot_ids: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct ExternalConnectorProfileUpdate {
    pub display_name: String,
    pub configuration: Value,
    pub enabled: bool,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalConnectorCheckpointRecord {
    pub profile_id: String,
    pub stream_id: String,
    pub revision: u64,
    pub schema_version: u32,
    pub payload: Value,
    pub payload_hash: String,
    pub cursor: Option<String>,
    pub plugin_id: String,
    pub version_id: String,
    pub contribution_id: String,
    pub activation_revision: u64,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalConnectorInvocationStatus {
    InFlight,
    Succeeded,
    Failed,
    Cancelled,
    Timeout,
    Conflict,
}

impl ExternalConnectorInvocationStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::InFlight => "in_flight",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Timeout => "timeout",
            Self::Conflict => "conflict",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "in_flight" => Ok(Self::InFlight),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            "timeout" => Ok(Self::Timeout),
            "conflict" => Ok(Self::Conflict),
            other => Err(StorageError::InvalidData(format!(
                "unknown external connector invocation status {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExternalConnectorInvocationRecord {
    pub id: String,
    pub profile_id: String,
    pub operation: String,
    pub idempotency_key: Option<String>,
    pub request_hash: String,
    pub request_id: String,
    pub stream_id: Option<String>,
    pub status: ExternalConnectorInvocationStatus,
    pub attempt: u32,
    pub result_hash: Option<String>,
    pub result: Option<Value>,
    pub failure_code: Option<String>,
    pub failure_message: Option<String>,
    pub retryable: Option<bool>,
    pub retry_after_ms: Option<u64>,
    pub checkpoint_revision: Option<u64>,
    pub plugin_id: String,
    pub version_id: String,
    pub contribution_id: String,
    pub activation_revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct ClaimExternalConnectorIdempotency {
    pub profile_id: String,
    pub operation: String,
    pub idempotency_key: String,
    pub request_hash: String,
    pub request_id: String,
    pub stream_id: Option<String>,
    pub attempt: u32,
    pub plugin_id: String,
    pub version_id: String,
    pub contribution_id: String,
    pub activation_revision: u64,
}

#[derive(Debug, Clone)]
pub enum ExternalConnectorIdempotencyClaim {
    Fresh(ExternalConnectorInvocationRecord),
    Replay(ExternalConnectorInvocationRecord),
    Conflict {
        existing_request_hash: String,
        existing: ExternalConnectorInvocationRecord,
    },
}

#[derive(Debug, Clone)]
pub struct FinalizeExternalConnectorSuccess {
    pub invocation_id: String,
    pub profile_id: String,
    pub stream_id: Option<String>,
    pub expected_checkpoint_revision: Option<u64>,
    pub checkpoint_schema_version: Option<u32>,
    pub checkpoint_payload: Option<Value>,
    pub checkpoint_cursor: Option<String>,
    pub result: Value,
    pub plugin_id: String,
    pub version_id: String,
    pub contribution_id: String,
    pub activation_revision: u64,
}

#[derive(Debug, Clone)]
pub struct FinalizeExternalConnectorFailure {
    pub invocation_id: String,
    pub status: ExternalConnectorInvocationStatus,
    pub failure_code: String,
    pub failure_message: String,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
}

impl Store {
    pub fn create_external_connector_profile(
        &mut self,
        input: NewExternalConnectorProfile,
    ) -> Result<ExternalConnectorProfileRecord> {
        require_nonempty("display_name", &input.display_name)?;
        require_nonempty("contribution_id", &input.contribution_id)?;
        require_nonempty("plugin_id", &input.plugin_id)?;
        require_nonempty("version_id", &input.version_id)?;
        require_nonempty("descriptor_hash", &input.descriptor_hash)?;
        if input.activation_revision == 0 {
            return Err(StorageError::InvalidData(
                "activation_revision must be positive".into(),
            ));
        }
        if !input.configuration.is_object() {
            return Err(StorageError::InvalidData(
                "configuration must be a JSON object".into(),
            ));
        }
        let id = new_id();
        let now = now_ms();
        let config_hash = hash_json(&input.configuration)?;
        let origins_json = serde_json::to_string(&input.origins)?;
        let operations_json = serde_json::to_string(&input.operations)?;
        let configuration_json =
            serde_json::to_string(&input.configuration)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO external_connector_profiles (
                id, display_name, contribution_id, plugin_id, version_id,
                activation_revision, contract_version, config_schema_version,
                checkpoint_schema_version, configuration_json, origins_json,
                operations_json, descriptor_hash, config_hash, enabled, revision,
                created_at_ms, updated_at_ms
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 0, ?16, ?16
            )",
            params![
                id,
                input.display_name,
                input.contribution_id,
                input.plugin_id,
                input.version_id,
                to_i64(input.activation_revision)?,
                input.contract_version,
                input.config_schema_version,
                input.checkpoint_schema_version,
                configuration_json,
                origins_json,
                operations_json,
                input.descriptor_hash,
                config_hash,
                if input.enabled { 1 } else { 0 },
                now,
            ],
        )?;
        for slot_id in &input.credential_slot_ids {
            require_nonempty("credential slot id", slot_id)?;
            transaction.execute(
                "INSERT INTO external_connector_credential_slots (
                    profile_id, slot_id, present, updated_at_ms
                ) VALUES (?1, ?2, 0, ?3)",
                params![id, slot_id, now],
            )?;
        }
        transaction.commit()?;
        self.get_external_connector_profile(&id)
    }

    pub fn get_external_connector_profile(
        &self,
        profile_id: &str,
    ) -> Result<ExternalConnectorProfileRecord> {
        let mut statement = self.connection.prepare(
            "SELECT id, display_name, contribution_id, plugin_id, version_id,
                    activation_revision, contract_version, config_schema_version,
                    checkpoint_schema_version, configuration_json, origins_json,
                    operations_json, descriptor_hash, config_hash, enabled, revision,
                    created_at_ms, updated_at_ms
             FROM external_connector_profiles
             WHERE id = ?1",
        )?;
        let profile = statement
            .query_row(params![profile_id], row_to_profile_base)
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "external_connector_profile".into(),
                id: profile_id.to_string(),
            })?;
        Ok(self.with_credential_slots(profile)?)
    }

    pub fn list_external_connector_profiles(
        &self,
        contribution_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<ExternalConnectorProfileRecord>, u32)> {
        let limit = limit.clamp(1, MAX_PAGE_SIZE);
        let total: u32 = if let Some(contribution_id) = contribution_id {
            self.connection.query_row(
                "SELECT COUNT(*) FROM external_connector_profiles WHERE contribution_id = ?1",
                params![contribution_id],
                |row| row.get(0),
            )?
        } else {
            self.connection
                .query_row("SELECT COUNT(*) FROM external_connector_profiles", [], |row| {
                    row.get(0)
                })?
        };
        let mut statement = self.connection.prepare(
            "SELECT id, display_name, contribution_id, plugin_id, version_id,
                    activation_revision, contract_version, config_schema_version,
                    checkpoint_schema_version, configuration_json, origins_json,
                    operations_json, descriptor_hash, config_hash, enabled, revision,
                    created_at_ms, updated_at_ms
             FROM external_connector_profiles
             WHERE (?1 IS NULL OR contribution_id = ?1)
             ORDER BY updated_at_ms DESC, id
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = statement.query_map(
            params![contribution_id, limit, offset],
            row_to_profile_base,
        )?;
        let mut items = Vec::new();
        for row in rows {
            items.push(self.with_credential_slots(row?)?);
        }
        Ok((items, total))
    }

    pub fn update_external_connector_profile(
        &mut self,
        profile_id: &str,
        update: ExternalConnectorProfileUpdate,
    ) -> Result<ExternalConnectorProfileRecord> {
        require_nonempty("display_name", &update.display_name)?;
        if !update.configuration.is_object() {
            return Err(StorageError::InvalidData(
                "configuration must be a JSON object".into(),
            ));
        }
        let now = now_ms();
        let config_hash = hash_json(&update.configuration)?;
        let configuration_json =
            serde_json::to_string(&update.configuration)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = transaction.execute(
            "UPDATE external_connector_profiles
             SET display_name = ?1,
                 configuration_json = ?2,
                 config_hash = ?3,
                 enabled = ?4,
                 revision = revision + 1,
                 updated_at_ms = ?5
             WHERE id = ?6 AND revision = ?7",
            params![
                update.display_name,
                configuration_json,
                config_hash,
                if update.enabled { 1 } else { 0 },
                now,
                profile_id,
                to_i64(update.expected_revision)?,
            ],
        )?;
        if changed == 0 {
            let exists: bool = transaction
                .query_row(
                    "SELECT 1 FROM external_connector_profiles WHERE id = ?1",
                    params![profile_id],
                    |_| Ok(true),
                )
                .optional()?
                .unwrap_or(false);
            return if exists {
                Err(StorageError::EntityConflict {
                    entity: "external_connector_profile".into(),
                    id: profile_id.to_string(),
                    expected_revision: update.expected_revision,
                    actual_revision: 0,
                })
            } else {
                Err(StorageError::NotFound {
                    entity: "external_connector_profile".into(),
                    id: profile_id.to_string(),
                })
            };
        }
        transaction.commit()?;
        self.get_external_connector_profile(profile_id)
    }

    pub fn delete_external_connector_profile(
        &mut self,
        profile_id: &str,
        expected_revision: u64,
    ) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = transaction.execute(
            "DELETE FROM external_connector_profiles WHERE id = ?1 AND revision = ?2",
            params![profile_id, to_i64(expected_revision)?],
        )?;
        if changed == 0 {
            let exists: bool = transaction
                .query_row(
                    "SELECT 1 FROM external_connector_profiles WHERE id = ?1",
                    params![profile_id],
                    |_| Ok(true),
                )
                .optional()?
                .unwrap_or(false);
            return if exists {
                Err(StorageError::EntityConflict {
                    entity: "external_connector_profile".into(),
                    id: profile_id.to_string(),
                    expected_revision: expected_revision,
                    actual_revision: 0,
                })
            } else {
                Err(StorageError::NotFound {
                    entity: "external_connector_profile".into(),
                    id: profile_id.to_string(),
                })
            };
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn set_external_connector_credential_present(
        &mut self,
        profile_id: &str,
        slot_id: &str,
        present: bool,
        expected_revision: u64,
    ) -> Result<ExternalConnectorProfileRecord> {
        let now = now_ms();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let profile_revision: i64 = transaction
            .query_row(
                "SELECT revision FROM external_connector_profiles WHERE id = ?1",
                params![profile_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "external_connector_profile".into(),
                id: profile_id.to_string(),
            })?;
        if profile_revision as u64 != expected_revision {
            return Err(StorageError::EntityConflict {
                entity: "external_connector_profile".into(),
                id: profile_id.to_string(),
                expected_revision: expected_revision,
                actual_revision: profile_revision as u64,
            });
        }
        let updated = transaction.execute(
            "UPDATE external_connector_credential_slots
             SET present = ?1, updated_at_ms = ?2
             WHERE profile_id = ?3 AND slot_id = ?4",
            params![if present { 1 } else { 0 }, now, profile_id, slot_id],
        )?;
        if updated == 0 {
            return Err(StorageError::NotFound {
                entity: "external_connector_credential_slot".into(),
                id: format!("{profile_id}/{slot_id}"),
            });
        }
        transaction.execute(
            "UPDATE external_connector_profiles
             SET revision = revision + 1, updated_at_ms = ?1
             WHERE id = ?2",
            params![now, profile_id],
        )?;
        transaction.commit()?;
        self.get_external_connector_profile(profile_id)
    }

    pub fn get_external_connector_checkpoint(
        &self,
        profile_id: &str,
        stream_id: &str,
    ) -> Result<Option<ExternalConnectorCheckpointRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT profile_id, stream_id, revision, schema_version, payload_json,
                    payload_hash, cursor, plugin_id, version_id, contribution_id,
                    activation_revision, created_at_ms
             FROM external_connector_checkpoints
             WHERE profile_id = ?1 AND stream_id = ?2
             ORDER BY revision DESC
             LIMIT 1",
        )?;
        statement
            .query_row(params![profile_id, stream_id], row_to_checkpoint)
            .optional()
            .map_err(Into::into)
    }

    pub fn claim_external_connector_idempotency(
        &mut self,
        claim: ClaimExternalConnectorIdempotency,
    ) -> Result<ExternalConnectorIdempotencyClaim> {
        require_nonempty("idempotency_key", &claim.idempotency_key)?;
        require_nonempty("request_hash", &claim.request_hash)?;
        let now = now_ms();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = transaction
            .query_row(
                "SELECT id, profile_id, operation, idempotency_key, request_hash, request_id,
                        stream_id, status, attempt, result_hash, result_json, failure_code,
                        failure_message, retryable, retry_after_ms, checkpoint_revision,
                        plugin_id, version_id, contribution_id, activation_revision,
                        created_at_ms, updated_at_ms
                 FROM external_connector_invocations
                 WHERE profile_id = ?1 AND operation = ?2 AND idempotency_key = ?3",
                params![claim.profile_id, claim.operation, claim.idempotency_key],
                row_to_invocation,
            )
            .optional()?;
        if let Some(existing) = existing {
            if existing.request_hash != claim.request_hash {
                return Ok(ExternalConnectorIdempotencyClaim::Conflict {
                    existing_request_hash: existing.request_hash.clone(),
                    existing,
                });
            }
            if existing.status == ExternalConnectorInvocationStatus::Succeeded {
                return Ok(ExternalConnectorIdempotencyClaim::Replay(existing));
            }
            if existing.status == ExternalConnectorInvocationStatus::InFlight {
                return Ok(ExternalConnectorIdempotencyClaim::Fresh(existing));
            }
            // Prior failed/cancelled attempts may retry with the same key.
            transaction.execute(
                "UPDATE external_connector_invocations
                 SET status = 'in_flight',
                     attempt = ?1,
                     request_id = ?2,
                     request_hash = ?3,
                     failure_code = NULL,
                     failure_message = NULL,
                     retryable = NULL,
                     retry_after_ms = NULL,
                     result_hash = NULL,
                     result_json = NULL,
                     checkpoint_revision = NULL,
                     updated_at_ms = ?4
                 WHERE id = ?5",
                params![
                    claim.attempt,
                    claim.request_id,
                    claim.request_hash,
                    now,
                    existing.id
                ],
            )?;
            let refreshed = transaction.query_row(
                "SELECT id, profile_id, operation, idempotency_key, request_hash, request_id,
                        stream_id, status, attempt, result_hash, result_json, failure_code,
                        failure_message, retryable, retry_after_ms, checkpoint_revision,
                        plugin_id, version_id, contribution_id, activation_revision,
                        created_at_ms, updated_at_ms
                 FROM external_connector_invocations WHERE id = ?1",
                params![existing.id],
                row_to_invocation,
            )?;
            transaction.commit()?;
            return Ok(ExternalConnectorIdempotencyClaim::Fresh(refreshed));
        }
        let id = new_id();
        transaction.execute(
            "INSERT INTO external_connector_invocations (
                id, profile_id, operation, idempotency_key, request_hash, request_id,
                stream_id, status, attempt, result_hash, result_json, failure_code,
                failure_message, retryable, retry_after_ms, checkpoint_revision,
                plugin_id, version_id, contribution_id, activation_revision,
                created_at_ms, updated_at_ms
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'in_flight', ?8, NULL, NULL, NULL,
                NULL, NULL, NULL, NULL, ?9, ?10, ?11, ?12, ?13, ?13
            )",
            params![
                id,
                claim.profile_id,
                claim.operation,
                claim.idempotency_key,
                claim.request_hash,
                claim.request_id,
                claim.stream_id,
                claim.attempt,
                claim.plugin_id,
                claim.version_id,
                claim.contribution_id,
                to_i64(claim.activation_revision)?,
                now,
            ],
        )?;
        let record = transaction.query_row(
            "SELECT id, profile_id, operation, idempotency_key, request_hash, request_id,
                    stream_id, status, attempt, result_hash, result_json, failure_code,
                    failure_message, retryable, retry_after_ms, checkpoint_revision,
                    plugin_id, version_id, contribution_id, activation_revision,
                    created_at_ms, updated_at_ms
             FROM external_connector_invocations WHERE id = ?1",
            params![id],
            row_to_invocation,
        )?;
        transaction.commit()?;
        Ok(ExternalConnectorIdempotencyClaim::Fresh(record))
    }

    pub fn finalize_external_connector_success(
        &mut self,
        input: FinalizeExternalConnectorSuccess,
    ) -> Result<(ExternalConnectorInvocationRecord, Option<ExternalConnectorCheckpointRecord>)> {
        let now = now_ms();
        let result_json = serde_json::to_string(&input.result)?;
        let result_hash = hash_json(&input.result)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut checkpoint_record = None;
        if let (Some(stream_id), Some(payload), Some(schema_version)) = (
            input.stream_id.as_ref(),
            input.checkpoint_payload.as_ref(),
            input.checkpoint_schema_version,
        ) {
            let current_revision: Option<i64> = transaction
                .query_row(
                    "SELECT revision FROM external_connector_checkpoints
                     WHERE profile_id = ?1 AND stream_id = ?2
                     ORDER BY revision DESC LIMIT 1",
                    params![input.profile_id, stream_id],
                    |row| row.get(0),
                )
                .optional()?;
            let expected = input.expected_checkpoint_revision.unwrap_or(0);
            let actual = current_revision.unwrap_or(0) as u64;
            if actual != expected {
                return Err(StorageError::EntityConflict {
                    entity: "external_connector_checkpoint".into(),
                    id: format!("{}/{}", input.profile_id, stream_id),
                    expected_revision: expected,
                    actual_revision: actual,
                });
            }
            let next_revision = actual + 1;
            let payload_json = serde_json::to_string(payload)?;
            let payload_hash = hash_json(payload)?;
            transaction.execute(
                "INSERT INTO external_connector_checkpoints (
                    profile_id, stream_id, revision, schema_version, payload_json,
                    payload_hash, cursor, plugin_id, version_id, contribution_id,
                    activation_revision, created_at_ms
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    input.profile_id,
                    stream_id,
                    to_i64(next_revision)?,
                    schema_version,
                    payload_json,
                    payload_hash,
                    input.checkpoint_cursor,
                    input.plugin_id,
                    input.version_id,
                    input.contribution_id,
                    to_i64(input.activation_revision)?,
                    now,
                ],
            )?;
            checkpoint_record = Some(ExternalConnectorCheckpointRecord {
                profile_id: input.profile_id.clone(),
                stream_id: stream_id.clone(),
                revision: next_revision,
                schema_version,
                payload: payload.clone(),
                payload_hash,
                cursor: input.checkpoint_cursor.clone(),
                plugin_id: input.plugin_id.clone(),
                version_id: input.version_id.clone(),
                contribution_id: input.contribution_id.clone(),
                activation_revision: input.activation_revision,
                created_at_ms: now,
            });
            transaction.execute(
                "UPDATE external_connector_invocations
                 SET status = 'succeeded',
                     result_hash = ?1,
                     result_json = ?2,
                     checkpoint_revision = ?3,
                     updated_at_ms = ?4
                 WHERE id = ?5 AND status = 'in_flight'",
                params![
                    result_hash,
                    result_json,
                    to_i64(next_revision)?,
                    now,
                    input.invocation_id
                ],
            )?;
        } else {
            transaction.execute(
                "UPDATE external_connector_invocations
                 SET status = 'succeeded',
                     result_hash = ?1,
                     result_json = ?2,
                     updated_at_ms = ?3
                 WHERE id = ?4 AND status = 'in_flight'",
                params![result_hash, result_json, now, input.invocation_id],
            )?;
        }
        let record = transaction.query_row(
            "SELECT id, profile_id, operation, idempotency_key, request_hash, request_id,
                    stream_id, status, attempt, result_hash, result_json, failure_code,
                    failure_message, retryable, retry_after_ms, checkpoint_revision,
                    plugin_id, version_id, contribution_id, activation_revision,
                    created_at_ms, updated_at_ms
             FROM external_connector_invocations WHERE id = ?1",
            params![input.invocation_id],
            row_to_invocation,
        )?;
        if record.status != ExternalConnectorInvocationStatus::Succeeded {
            return Err(StorageError::InvalidState(
                "external connector invocation was not in_flight for success finalization".into(),
            ));
        }
        transaction.commit()?;
        Ok((record, checkpoint_record))
    }

    pub fn finalize_external_connector_failure(
        &mut self,
        input: FinalizeExternalConnectorFailure,
    ) -> Result<ExternalConnectorInvocationRecord> {
        if matches!(
            input.status,
            ExternalConnectorInvocationStatus::Succeeded
                | ExternalConnectorInvocationStatus::InFlight
        ) {
            return Err(StorageError::InvalidData(
                "failure finalization requires a terminal failure status".into(),
            ));
        }
        let now = now_ms();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = transaction.execute(
            "UPDATE external_connector_invocations
             SET status = ?1,
                 failure_code = ?2,
                 failure_message = ?3,
                 retryable = ?4,
                 retry_after_ms = ?5,
                 updated_at_ms = ?6
             WHERE id = ?7 AND status = 'in_flight'",
            params![
                input.status.as_str(),
                input.failure_code,
                input.failure_message,
                if input.retryable { 1 } else { 0 },
                input.retry_after_ms.map(to_i64).transpose()?,
                now,
                input.invocation_id,
            ],
        )?;
        if changed == 0 {
            return Err(StorageError::InvalidState(
                "external connector invocation was not in_flight for failure finalization".into(),
            ));
        }
        let record = transaction.query_row(
            "SELECT id, profile_id, operation, idempotency_key, request_hash, request_id,
                    stream_id, status, attempt, result_hash, result_json, failure_code,
                    failure_message, retryable, retry_after_ms, checkpoint_revision,
                    plugin_id, version_id, contribution_id, activation_revision,
                    created_at_ms, updated_at_ms
             FROM external_connector_invocations WHERE id = ?1",
            params![input.invocation_id],
            row_to_invocation,
        )?;
        transaction.commit()?;
        Ok(record)
    }

    fn with_credential_slots(
        &self,
        mut profile: ExternalConnectorProfileRecord,
    ) -> Result<ExternalConnectorProfileRecord> {
        let mut statement = self.connection.prepare(
            "SELECT slot_id, present
             FROM external_connector_credential_slots
             WHERE profile_id = ?1
             ORDER BY slot_id",
        )?;
        let slots = statement
            .query_map(params![profile.id], |row| {
                Ok(ExternalConnectorCredentialPresence {
                    slot_id: row.get(0)?,
                    present: row.get::<_, i64>(1)? != 0,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        profile.credential_slots = slots;
        Ok(profile)
    }
}

fn hash_json(value: &Value) -> Result<String> {
    let bytes = serde_json::to_vec(value)?;
    let digest = Sha256::digest(bytes);
    Ok(format!("{digest:x}"))
}

fn row_to_profile_base(row: &Row<'_>) -> rusqlite::Result<ExternalConnectorProfileRecord> {
    let configuration_json: String = row.get(9)?;
    let origins_json: String = row.get(10)?;
    let operations_json: String = row.get(11)?;
    Ok(ExternalConnectorProfileRecord {
        id: row.get(0)?,
        display_name: row.get(1)?,
        contribution_id: row.get(2)?,
        plugin_id: row.get(3)?,
        version_id: row.get(4)?,
        activation_revision: read_u64(row, 5)?,
        contract_version: row.get::<_, i64>(6)? as u32,
        config_schema_version: row.get::<_, i64>(7)? as u32,
        checkpoint_schema_version: row.get::<_, i64>(8)? as u32,
        configuration: serde_json::from_str(&configuration_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                9,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        origins: serde_json::from_str(&origins_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                10,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        operations: serde_json::from_str(&operations_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                11,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        descriptor_hash: row.get(12)?,
        config_hash: row.get(13)?,
        enabled: row.get::<_, i64>(14)? != 0,
        credential_slots: Vec::new(),
        revision: read_u64(row, 15)?,
        created_at_ms: row.get(16)?,
        updated_at_ms: row.get(17)?,
    })
}

fn row_to_checkpoint(row: &Row<'_>) -> rusqlite::Result<ExternalConnectorCheckpointRecord> {
    let payload_json: String = row.get(4)?;
    Ok(ExternalConnectorCheckpointRecord {
        profile_id: row.get(0)?,
        stream_id: row.get(1)?,
        revision: read_u64(row, 2)?,
        schema_version: row.get::<_, i64>(3)? as u32,
        payload: serde_json::from_str(&payload_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        payload_hash: row.get(5)?,
        cursor: row.get(6)?,
        plugin_id: row.get(7)?,
        version_id: row.get(8)?,
        contribution_id: row.get(9)?,
        activation_revision: read_u64(row, 10)?,
        created_at_ms: row.get(11)?,
    })
}

fn row_to_invocation(row: &Row<'_>) -> rusqlite::Result<ExternalConnectorInvocationRecord> {
    let status: String = row.get(7)?;
    let result_json: Option<String> = row.get(10)?;
    Ok(ExternalConnectorInvocationRecord {
        id: row.get(0)?,
        profile_id: row.get(1)?,
        operation: row.get(2)?,
        idempotency_key: row.get(3)?,
        request_hash: row.get(4)?,
        request_id: row.get(5)?,
        stream_id: row.get(6)?,
        status: ExternalConnectorInvocationStatus::parse(&status).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    error.to_string(),
                )),
            )
        })?,
        attempt: row.get::<_, i64>(8)? as u32,
        result_hash: row.get(9)?,
        result: result_json
            .map(|value| {
                serde_json::from_str(&value).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        10,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })
            })
            .transpose()?,
        failure_code: row.get(11)?,
        failure_message: row.get(12)?,
        retryable: row
            .get::<_, Option<i64>>(13)?
            .map(|value| value != 0),
        retry_after_ms: row
            .get::<_, Option<i64>>(14)?
            .map(|value| value as u64),
        checkpoint_revision: row
            .get::<_, Option<i64>>(15)?
            .map(|value| value as u64),
        plugin_id: row.get(16)?,
        version_id: row.get(17)?,
        contribution_id: row.get(18)?,
        activation_revision: read_u64(row, 19)?,
        created_at_ms: row.get(20)?,
        updated_at_ms: row.get(21)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Store;
    use serde_json::json;
    use tempfile::tempdir;

    fn open_store() -> Store {
        let dir = tempdir().expect("tempdir");
        Store::open(dir.path()).expect("open store")
    }

    fn sample_profile(store: &mut Store) -> ExternalConnectorProfileRecord {
        store
            .create_external_connector_profile(NewExternalConnectorProfile {
                display_name: "Fixture".into(),
                contribution_id: "example.external.fixture".into(),
                plugin_id: "example.external".into(),
                version_id: "install-v1:example.external:1.0.0".into(),
                activation_revision: 1,
                contract_version: 1,
                config_schema_version: 1,
                checkpoint_schema_version: 1,
                configuration: json!({ "basePath": "/v1" }),
                origins: vec!["http://127.0.0.1:43124".into()],
                operations: vec![
                    "validateConfig".into(),
                    "test".into(),
                    "pull".into(),
                    "push".into(),
                ],
                descriptor_hash: "a".repeat(64),
                credential_slot_ids: vec!["apiToken".into()],
                enabled: true,
            })
            .expect("create profile")
    }

    #[test]
    fn profile_credential_and_checkpoint_round_trip() {
        let mut store = open_store();
        let profile = sample_profile(&mut store);
        assert!(!profile.credential_slots[0].present);
        let updated = store
            .set_external_connector_credential_present(
                &profile.id,
                "apiToken",
                true,
                profile.revision,
            )
            .expect("set presence");
        assert!(updated.credential_slots[0].present);
        assert_eq!(updated.revision, profile.revision + 1);

        let claim = store
            .claim_external_connector_idempotency(ClaimExternalConnectorIdempotency {
                profile_id: profile.id.clone(),
                operation: "push".into(),
                idempotency_key: "idem-1".into(),
                request_hash: "b".repeat(64),
                request_id: "req-1".into(),
                stream_id: Some("default".into()),
                attempt: 1,
                plugin_id: profile.plugin_id.clone(),
                version_id: profile.version_id.clone(),
                contribution_id: profile.contribution_id.clone(),
                activation_revision: 1,
            })
            .expect("claim");
        let ExternalConnectorIdempotencyClaim::Fresh(invocation) = claim else {
            panic!("expected fresh claim");
        };
        let result = json!({
            "operation": "push",
            "receipts": [{"externalId": "item-1", "accepted": true}]
        });
        let (finalized, checkpoint) = store
            .finalize_external_connector_success(FinalizeExternalConnectorSuccess {
                invocation_id: invocation.id.clone(),
                profile_id: profile.id.clone(),
                stream_id: Some("default".into()),
                expected_checkpoint_revision: Some(0),
                checkpoint_schema_version: Some(1),
                checkpoint_payload: Some(json!({ "cursor": "c1" })),
                checkpoint_cursor: Some("c1".into()),
                result,
                plugin_id: profile.plugin_id.clone(),
                version_id: profile.version_id.clone(),
                contribution_id: profile.contribution_id.clone(),
                activation_revision: 1,
            })
            .expect("finalize success");
        assert_eq!(
            finalized.status,
            ExternalConnectorInvocationStatus::Succeeded
        );
        let checkpoint = checkpoint.expect("checkpoint");
        assert_eq!(checkpoint.revision, 1);

        let replay = store
            .claim_external_connector_idempotency(ClaimExternalConnectorIdempotency {
                profile_id: profile.id.clone(),
                operation: "push".into(),
                idempotency_key: "idem-1".into(),
                request_hash: "b".repeat(64),
                request_id: "req-1".into(),
                stream_id: Some("default".into()),
                attempt: 2,
                plugin_id: profile.plugin_id.clone(),
                version_id: profile.version_id.clone(),
                contribution_id: profile.contribution_id.clone(),
                activation_revision: 1,
            })
            .expect("replay claim");
        assert!(matches!(
            replay,
            ExternalConnectorIdempotencyClaim::Replay(_)
        ));

        let conflict = store
            .claim_external_connector_idempotency(ClaimExternalConnectorIdempotency {
                profile_id: profile.id.clone(),
                operation: "push".into(),
                idempotency_key: "idem-1".into(),
                request_hash: "c".repeat(64),
                request_id: "req-2".into(),
                stream_id: Some("default".into()),
                attempt: 1,
                plugin_id: profile.plugin_id.clone(),
                version_id: profile.version_id.clone(),
                contribution_id: profile.contribution_id.clone(),
                activation_revision: 1,
            })
            .expect("conflict claim");
        assert!(matches!(
            conflict,
            ExternalConnectorIdempotencyClaim::Conflict { .. }
        ));

        let loaded = store
            .get_external_connector_checkpoint(&profile.id, "default")
            .expect("load checkpoint")
            .expect("present");
        assert_eq!(loaded.revision, 1);
        assert!(!serde_json::to_string(&loaded.payload)
            .unwrap()
            .contains("secret"));
    }

    #[test]
    fn failure_does_not_advance_checkpoint() {
        let mut store = open_store();
        let profile = sample_profile(&mut store);
        let claim = store
            .claim_external_connector_idempotency(ClaimExternalConnectorIdempotency {
                profile_id: profile.id.clone(),
                operation: "pull".into(),
                idempotency_key: "idem-fail".into(),
                request_hash: "d".repeat(64),
                request_id: "req-fail".into(),
                stream_id: Some("default".into()),
                attempt: 1,
                plugin_id: profile.plugin_id.clone(),
                version_id: profile.version_id.clone(),
                contribution_id: profile.contribution_id.clone(),
                activation_revision: 1,
            })
            .expect("claim");
        let ExternalConnectorIdempotencyClaim::Fresh(invocation) = claim else {
            panic!("fresh");
        };
        store
            .finalize_external_connector_failure(FinalizeExternalConnectorFailure {
                invocation_id: invocation.id,
                status: ExternalConnectorInvocationStatus::Failed,
                failure_code: "authentication".into(),
                failure_message: "denied".into(),
                retryable: false,
                retry_after_ms: None,
            })
            .expect("fail");
        assert!(store
            .get_external_connector_checkpoint(&profile.id, "default")
            .expect("checkpoint lookup")
            .is_none());
    }
}
