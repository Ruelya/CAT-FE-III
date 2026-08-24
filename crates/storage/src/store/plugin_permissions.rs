use rusqlite::{Connection, OptionalExtension, Row, Transaction, TransactionBehavior, params};
use serde_json::Value;
use sha2::{Digest, Sha256};
use translunar_plugin_runtime::{
    PluginCapabilityAuditEvent, PluginCapabilityCheck, PluginCapabilityDecision,
    PluginCapabilityDenial, PluginCapabilityDenialCode, PluginCapabilityId,
    PluginCapabilityRequest, PluginCapabilityScope, normalize_capability_requests,
};
use uuid::Uuid;

use super::{Store, now_ms, read_u64, require_nonempty, to_i64, to_u32};
use crate::{Result, StorageError};

const MAX_PAGE_SIZE: u32 = 200;
const MAX_ACTOR_BYTES: usize = 128;
const MAX_REASON_BYTES: usize = 512;
const MAX_OPERATION_BYTES: usize = 128;

const REQUEST_COLUMNS: &str = "id, plugin_id, version_id, capability_id, required,
    requested_scope_json, granted_scope_json, contribution_id, legacy_permission,
    carried_from_request_id, decision, actor, reason, revision, created_at_ms,
    updated_at_ms, decided_at_ms";

const AUDIT_COLUMNS: &str = "sequence, id, plugin_id, version_id, request_id,
    capability_id, scope_json, event, outcome, operation, actor, reason,
    request_revision, created_at_ms";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginCapabilityRequestRecord {
    pub id: String,
    pub plugin_id: String,
    pub version_id: String,
    pub request: PluginCapabilityRequest,
    pub granted_scope: Option<PluginCapabilityScope>,
    pub legacy_permission: String,
    pub carried_from_request_id: Option<String>,
    pub decision: PluginCapabilityDecision,
    pub actor: String,
    pub reason: String,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub decided_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginCapabilityRequestPage {
    pub items: Vec<PluginCapabilityRequestRecord>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginCapabilityAuditRecord {
    pub sequence: u64,
    pub id: String,
    pub plugin_id: String,
    pub version_id: String,
    pub request_id: Option<String>,
    pub capability_id: PluginCapabilityId,
    pub scope: PluginCapabilityScope,
    pub event: PluginCapabilityAuditEvent,
    pub outcome: String,
    pub operation: String,
    pub actor: String,
    pub reason: String,
    pub request_revision: Option<u64>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginCapabilityAuditPage {
    pub items: Vec<PluginCapabilityAuditRecord>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginCapabilityDecisionResult {
    pub request: PluginCapabilityRequestRecord,
    pub detached: bool,
    pub plugin_revision: u64,
}

pub struct PluginCapabilityDecisionInput<'a> {
    pub plugin_id: &'a str,
    pub request_id: &'a str,
    pub expected_revision: u64,
    pub decision: PluginCapabilityDecision,
    pub grant_scope: Option<PluginCapabilityScope>,
    pub actor: &'a str,
    pub reason: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginCapabilityAuthorization {
    Allowed(Box<PluginCapabilityRequestRecord>),
    Denied(PluginCapabilityDenial),
}

struct PluginCapabilityAuditInput<'a> {
    plugin_id: &'a str,
    version_id: &'a str,
    request_id: Option<&'a str>,
    capability_id: &'a PluginCapabilityId,
    scope: &'a PluginCapabilityScope,
    event: PluginCapabilityAuditEvent,
    outcome: &'a str,
    operation: &'a str,
    actor: &'a str,
    reason: &'a str,
    request_revision: Option<u64>,
    created_at_ms: i64,
}

/// Fill structured capability requests that cannot be expressed by the SQL
/// migration alone.  Existing rows and decisions are never rewritten.
pub(super) fn normalize_plugin_capability_requests(
    connection: &mut rusqlite::Connection,
) -> Result<()> {
    let versions = {
        let mut statement = connection.prepare(
            "SELECT id, plugin_id, normalized_manifest_json,
                    original_manifest_json, installed_at_ms
             FROM plugin_versions ORDER BY plugin_id, installed_at_ms, id",
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

    for (version_id, plugin_id, normalized_json, original_json, created_at_ms) in versions {
        let normalized: Value = serde_json::from_str(&normalized_json)?;
        let original: Value = serde_json::from_str(&original_json)?;
        let requests = requests_from_manifest_values(&normalized, &original)?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        insert_plugin_capability_requests_tx(
            &tx,
            &plugin_id,
            &version_id,
            &requests,
            None,
            created_at_ms,
        )?;
        tx.commit()?;
    }
    Ok(())
}

pub(super) fn requests_from_manifest_values(
    normalized: &Value,
    original: &Value,
) -> Result<Vec<PluginCapabilityRequest>> {
    let typed = normalized
        .get("requestedCapabilities")
        .cloned()
        .or_else(|| original.get("capabilities").cloned())
        .map(serde_json::from_value::<Vec<PluginCapabilityRequest>>)
        .transpose()?
        .unwrap_or_default();
    let legacy = normalized
        .get("requestedPermissions")
        .cloned()
        .or_else(|| original.get("permissions").cloned())
        .map(serde_json::from_value::<Vec<String>>)
        .transpose()?
        .unwrap_or_default();
    normalize_capability_requests(&legacy, &typed)
        .map_err(|error| StorageError::InvalidData(error.to_string()))
}

pub(super) fn insert_plugin_capability_requests_tx(
    tx: &Transaction<'_>,
    plugin_id: &str,
    version_id: &str,
    requests: &[PluginCapabilityRequest],
    carry_from_version_id: Option<&str>,
    created_at_ms: i64,
) -> Result<()> {
    for request in requests {
        let request = request
            .normalized()
            .map_err(|error| StorageError::InvalidState(error.to_string()))?;
        let requested_scope_json = serde_json::to_string(&request.scope)?;
        let contribution_id = request.contribution_id.clone().unwrap_or_default();
        let carried = if request.capability_id.is_supported()
            && let Some(previous_version_id) = carry_from_version_id
        {
            tx.query_row(
                "SELECT id, granted_scope_json
                 FROM plugin_capability_requests
                 WHERE plugin_id = ?1 AND version_id = ?2
                   AND capability_id = ?3 AND required = ?4
                   AND requested_scope_json = ?5 AND contribution_id = ?6
                   AND decision = 'granted' AND granted_scope_json IS NOT NULL
                 ORDER BY id LIMIT 1",
                params![
                    plugin_id,
                    previous_version_id,
                    request.capability_id.as_str(),
                    i64::from(request.required),
                    requested_scope_json,
                    contribution_id,
                ],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
        } else {
            None
        };
        let semantic_key = request
            .semantic_key()
            .map_err(|error| StorageError::InvalidState(error.to_string()))?;
        let request_id = capability_request_id(version_id, &semantic_key);
        let legacy_permission = request.legacy_name();
        let (decision, granted_scope_json, carried_from, actor, reason, decided_at_ms) =
            if let Some((previous_request_id, previous_scope)) = carried {
                (
                    PluginCapabilityDecision::Granted,
                    Some(previous_scope),
                    Some(previous_request_id),
                    "upgrade".to_string(),
                    "semantically identical grant carried forward".to_string(),
                    Some(created_at_ms),
                )
            } else {
                (
                    PluginCapabilityDecision::Pending,
                    None,
                    None,
                    String::new(),
                    String::new(),
                    None,
                )
            };
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO plugin_capability_requests (
                id, plugin_id, version_id, capability_id, required,
                requested_scope_json, granted_scope_json, contribution_id,
                legacy_permission, carried_from_request_id, decision, actor,
                reason, revision, created_at_ms, updated_at_ms, decided_at_ms
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                0, ?14, ?14, ?15
             )",
            params![
                request_id,
                plugin_id,
                version_id,
                request.capability_id.as_str(),
                i64::from(request.required),
                requested_scope_json,
                granted_scope_json,
                contribution_id,
                legacy_permission,
                carried_from,
                decision.as_str(),
                actor,
                reason,
                created_at_ms,
                decided_at_ms,
            ],
        )?;
        if inserted == 0 {
            continue;
        }
        append_audit_tx(
            tx,
            PluginCapabilityAuditInput {
                plugin_id,
                version_id,
                request_id: Some(&request_id),
                capability_id: &request.capability_id,
                scope: &request.scope,
                event: PluginCapabilityAuditEvent::Requested,
                outcome: decision.as_str(),
                operation: "",
                actor: if decision == PluginCapabilityDecision::Granted {
                    "upgrade"
                } else {
                    "engine"
                },
                reason: if decision == PluginCapabilityDecision::Granted {
                    "semantically identical request discovered"
                } else {
                    "capability requested by plugin manifest"
                },
                request_revision: Some(0),
                created_at_ms,
            },
        )?;
        if decision == PluginCapabilityDecision::Granted {
            append_audit_tx(
                tx,
                PluginCapabilityAuditInput {
                    plugin_id,
                    version_id,
                    request_id: Some(&request_id),
                    capability_id: &request.capability_id,
                    scope: &request.scope,
                    event: PluginCapabilityAuditEvent::Carried,
                    outcome: "granted",
                    operation: "",
                    actor: "upgrade",
                    reason: "semantically identical grant carried forward",
                    request_revision: Some(0),
                    created_at_ms,
                },
            )?;
        }
    }
    Ok(())
}

pub(super) fn sync_plugin_legacy_grants_tx(
    tx: &Transaction<'_>,
    plugin_id: &str,
    version_id: &str,
) -> Result<()> {
    let values = granted_plugin_legacy_permissions_tx(tx, plugin_id, version_id)?;
    tx.execute(
        "UPDATE plugin_installations
         SET granted_permissions_json = ?2
         WHERE id = ?1 AND active_version_id = ?3",
        params![plugin_id, serde_json::to_string(&values)?, version_id],
    )?;
    Ok(())
}

pub(super) fn granted_plugin_legacy_permissions_tx(
    tx: &Transaction<'_>,
    plugin_id: &str,
    version_id: &str,
) -> Result<Vec<String>> {
    let mut statement = tx.prepare(
        "SELECT legacy_permission
         FROM plugin_capability_requests
         WHERE plugin_id = ?1 AND version_id = ?2
           AND decision = 'granted' AND legacy_permission <> ''
         ORDER BY legacy_permission, id",
    )?;
    let mut values = statement
        .query_map(params![plugin_id, version_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    values.sort();
    values.dedup();
    Ok(values)
}

pub(super) fn required_plugin_capabilities_satisfied_tx(
    tx: &Transaction<'_>,
    plugin_id: &str,
    version_id: &str,
) -> Result<bool> {
    required_plugin_capabilities_satisfied_connection(tx, plugin_id, version_id)
}

impl Store {
    pub fn list_plugin_capability_requests(
        &self,
        plugin_id: &str,
        version_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<PluginCapabilityRequestPage> {
        require_nonempty("plugin id", plugin_id)?;
        let limit = limit.clamp(1, MAX_PAGE_SIZE);
        let (where_clause, version_parameter) = if version_id.is_some() {
            ("plugin_id = ?1 AND version_id = ?2", true)
        } else {
            ("plugin_id = ?1", false)
        };
        let total_sql =
            format!("SELECT COUNT(*) FROM plugin_capability_requests WHERE {where_clause}");
        let total = if let Some(version_id) = version_id {
            self.connection
                .query_row(&total_sql, params![plugin_id, version_id], |row| {
                    row.get::<_, i64>(0)
                })?
        } else {
            self.connection
                .query_row(&total_sql, [plugin_id], |row| row.get::<_, i64>(0))?
        };
        let query = if version_parameter {
            format!(
                "SELECT {REQUEST_COLUMNS} FROM plugin_capability_requests
                 WHERE {where_clause}
                 ORDER BY capability_id, contribution_id, id LIMIT ?3 OFFSET ?4"
            )
        } else {
            format!(
                "SELECT {REQUEST_COLUMNS} FROM plugin_capability_requests
                 WHERE {where_clause}
                 ORDER BY version_id, capability_id, contribution_id, id LIMIT ?2 OFFSET ?3"
            )
        };
        let mut statement = self.connection.prepare(&query)?;
        let items = if let Some(version_id) = version_id {
            statement
                .query_map(
                    params![plugin_id, version_id, i64::from(limit), i64::from(offset)],
                    map_request_row,
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            statement
                .query_map(
                    params![plugin_id, i64::from(limit), i64::from(offset)],
                    map_request_row,
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        Ok(PluginCapabilityRequestPage {
            items,
            total: to_u32(total)?,
            offset,
            limit,
        })
    }

    pub fn get_plugin_capability_request(
        &self,
        plugin_id: &str,
        request_id: &str,
    ) -> Result<PluginCapabilityRequestRecord> {
        let query = format!(
            "SELECT {REQUEST_COLUMNS} FROM plugin_capability_requests
             WHERE plugin_id = ?1 AND id = ?2"
        );
        self.connection
            .query_row(&query, params![plugin_id, request_id], map_request_row)
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "plugin capability request",
                id: request_id.to_string(),
            })
    }

    pub fn plugin_required_capabilities_satisfied(
        &self,
        plugin_id: &str,
        version_id: &str,
    ) -> Result<bool> {
        required_plugin_capabilities_satisfied_connection(&self.connection, plugin_id, version_id)
    }

    pub fn decide_plugin_capability(
        &mut self,
        input: PluginCapabilityDecisionInput<'_>,
    ) -> Result<PluginCapabilityDecisionResult> {
        let PluginCapabilityDecisionInput {
            plugin_id,
            request_id,
            expected_revision,
            decision,
            grant_scope,
            actor,
            reason,
        } = input;
        validate_audit_text(actor, "actor", MAX_ACTOR_BYTES)?;
        validate_optional_audit_text(reason, "reason", MAX_REASON_BYTES)?;
        if decision == PluginCapabilityDecision::Pending {
            return Err(StorageError::InvalidState(
                "pending is created by manifests, not a review decision".to_string(),
            ));
        }
        let now = now_ms();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let query = format!(
            "SELECT {REQUEST_COLUMNS} FROM plugin_capability_requests
             WHERE plugin_id = ?1 AND id = ?2"
        );
        let current = tx
            .query_row(&query, params![plugin_id, request_id], map_request_row)
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "plugin capability request",
                id: request_id.to_string(),
            })?;
        if current.revision != expected_revision {
            return Err(StorageError::EntityConflict {
                entity: "plugin capability request",
                id: request_id.to_string(),
                expected_revision,
                actual_revision: current.revision,
            });
        }
        if decision == PluginCapabilityDecision::Revoked
            && current.decision != PluginCapabilityDecision::Granted
        {
            return Err(StorageError::InvalidState(
                "only a granted capability can be revoked".to_string(),
            ));
        }
        if decision == PluginCapabilityDecision::Granted
            && !current.request.capability_id.is_supported()
        {
            return Err(StorageError::InvalidState(
                "unsupported optional capability cannot be granted".to_string(),
            ));
        }
        let granted_scope = if decision == PluginCapabilityDecision::Granted {
            let scope = grant_scope.unwrap_or_else(|| current.request.scope.clone());
            let scope = scope
                .normalized()
                .map_err(|error| StorageError::InvalidState(error.to_string()))?;
            if !current.request.scope.allows(&scope) {
                return Err(StorageError::InvalidState(
                    "granted scope must be contained by the requested scope".to_string(),
                ));
            }
            Some(scope)
        } else {
            None
        };
        let updated = tx.execute(
            "UPDATE plugin_capability_requests
             SET granted_scope_json = ?3, decision = ?4, actor = ?5, reason = ?6,
                 revision = revision + 1, updated_at_ms = ?7, decided_at_ms = ?7
             WHERE plugin_id = ?1 AND id = ?2 AND revision = ?8",
            params![
                plugin_id,
                request_id,
                granted_scope
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                decision.as_str(),
                actor,
                reason,
                now,
                to_i64(expected_revision)?,
            ],
        )?;
        if updated != 1 {
            let actual = tx.query_row(
                "SELECT revision FROM plugin_capability_requests WHERE id = ?1",
                [request_id],
                |row| row.get::<_, i64>(0),
            )?;
            return Err(StorageError::EntityConflict {
                entity: "plugin capability request",
                id: request_id.to_string(),
                expected_revision,
                actual_revision: u64::try_from(actual).unwrap_or(0),
            });
        }
        let request_revision = expected_revision.saturating_add(1);
        append_audit_tx(
            &tx,
            PluginCapabilityAuditInput {
                plugin_id,
                version_id: &current.version_id,
                request_id: Some(request_id),
                capability_id: &current.request.capability_id,
                scope: granted_scope.as_ref().unwrap_or(&current.request.scope),
                event: match decision {
                    PluginCapabilityDecision::Granted => PluginCapabilityAuditEvent::Granted,
                    PluginCapabilityDecision::Denied => PluginCapabilityAuditEvent::Denied,
                    PluginCapabilityDecision::Revoked => PluginCapabilityAuditEvent::Revoked,
                    PluginCapabilityDecision::Pending => unreachable!(),
                },
                outcome: decision.as_str(),
                operation: "",
                actor,
                reason,
                request_revision: Some(request_revision),
                created_at_ms: now,
            },
        )?;

        let (active_version_id, status): (Option<String>, String) = tx.query_row(
            "SELECT active_version_id, status FROM plugin_installations WHERE id = ?1",
            [plugin_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let detached = matches!(
            decision,
            PluginCapabilityDecision::Denied | PluginCapabilityDecision::Revoked
        ) && active_version_id.as_deref() == Some(current.version_id.as_str())
            && status == "enabled";
        if detached {
            tx.execute(
                "UPDATE plugin_installations
                 SET status = 'disabled', revision = revision + 1,
                     updated_at_ms = ?2, last_error = 'capability revoked or denied'
                 WHERE id = ?1 AND status = 'enabled'",
                params![plugin_id, now],
            )?;
            append_audit_tx(
                &tx,
                PluginCapabilityAuditInput {
                    plugin_id,
                    version_id: &current.version_id,
                    request_id: Some(request_id),
                    capability_id: &current.request.capability_id,
                    scope: &current.request.scope,
                    event: PluginCapabilityAuditEvent::Detached,
                    outcome: "disabled",
                    operation: "plugin.detach",
                    actor: "engine",
                    reason: "active contribution detached after capability decision",
                    request_revision: Some(request_revision),
                    created_at_ms: now,
                },
            )?;
        }
        if active_version_id.as_deref() == Some(current.version_id.as_str()) {
            sync_plugin_legacy_grants_tx(&tx, plugin_id, &current.version_id)?;
        }
        let plugin_revision = tx.query_row(
            "SELECT revision FROM plugin_installations WHERE id = ?1",
            [plugin_id],
            |row| row.get::<_, i64>(0),
        )?;
        tx.commit()?;
        Ok(PluginCapabilityDecisionResult {
            request: self.get_plugin_capability_request(plugin_id, request_id)?,
            detached,
            plugin_revision: u64::try_from(plugin_revision).unwrap_or(0),
        })
    }

    pub fn authorize_plugin_capability(
        &mut self,
        check: &PluginCapabilityCheck,
    ) -> Result<PluginCapabilityAuthorization> {
        self.authorize_plugin_capability_inner(check, false)
    }

    pub fn authorize_plugin_registration(
        &mut self,
        check: &PluginCapabilityCheck,
    ) -> Result<PluginCapabilityAuthorization> {
        self.authorize_plugin_capability_inner(check, true)
    }

    fn authorize_plugin_capability_inner(
        &mut self,
        check: &PluginCapabilityCheck,
        registration_preflight: bool,
    ) -> Result<PluginCapabilityAuthorization> {
        let normalized_scope = match check.scope.normalized() {
            Ok(scope) => scope,
            Err(_) => {
                return Ok(PluginCapabilityAuthorization::Denied(capability_denial(
                    check,
                    PluginCapabilityDenialCode::Malformed,
                    None,
                )));
            }
        };
        let operation = bounded_text(&check.operation, MAX_OPERATION_BYTES);
        let contribution_id = check.contribution_id.as_deref().unwrap_or("");
        let now = now_ms();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let active: Option<(Option<String>, String)> = tx
            .query_row(
                "SELECT active_version_id, status FROM plugin_installations WHERE id = ?1",
                [&check.plugin_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let active_and_authorized = active.as_ref().is_some_and(|(version_id, status)| {
            version_id.as_deref() == Some(check.version_id.as_str())
                && (status == "enabled"
                    || (registration_preflight
                        && matches!(status.as_str(), "installed" | "disabled")))
        });
        let validated_candidate = registration_preflight
            && !active_and_authorized
            && tx
                .query_row(
                    "SELECT 1 FROM plugin_versions
                     WHERE plugin_id = ?1 AND id = ?2 AND state = 'validated'",
                    params![check.plugin_id, check.version_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
        let active_and_authorized = active_and_authorized || validated_candidate;
        let query = format!(
            "SELECT {REQUEST_COLUMNS} FROM plugin_capability_requests
             WHERE plugin_id = ?1 AND version_id = ?2 AND capability_id = ?3
               AND (contribution_id = '' OR contribution_id = ?4)
             ORDER BY CASE WHEN contribution_id = ?4 THEN 0 ELSE 1 END, id"
        );
        let mut statement = tx.prepare(&query)?;
        let candidates = statement
            .query_map(
                params![
                    check.plugin_id,
                    check.version_id,
                    check.capability_id.as_str(),
                    contribution_id,
                ],
                map_request_row,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);

        let allowed = if active_and_authorized {
            candidates.iter().find(|record| {
                record.decision == PluginCapabilityDecision::Granted
                    && record
                        .granted_scope
                        .as_ref()
                        .is_some_and(|scope| scope.allows(&normalized_scope))
            })
        } else {
            None
        };
        if let Some(record) = allowed {
            append_audit_tx(
                &tx,
                PluginCapabilityAuditInput {
                    plugin_id: &check.plugin_id,
                    version_id: &check.version_id,
                    request_id: Some(&record.id),
                    capability_id: &check.capability_id,
                    scope: &normalized_scope,
                    event: PluginCapabilityAuditEvent::OperationAllowed,
                    outcome: "allowed",
                    operation: &operation,
                    actor: "engine",
                    reason: "capability checked at operation boundary",
                    request_revision: Some(record.revision),
                    created_at_ms: now,
                },
            )?;
            let record = record.clone();
            tx.commit()?;
            return Ok(PluginCapabilityAuthorization::Allowed(Box::new(record)));
        }

        let (code, request_id, request_revision) = if !active_and_authorized {
            (PluginCapabilityDenialCode::Revoked, None, None)
        } else if candidates.is_empty() {
            (PluginCapabilityDenialCode::NotRequested, None, None)
        } else if candidates
            .iter()
            .any(|record| record.decision == PluginCapabilityDecision::Granted)
        {
            (
                PluginCapabilityDenialCode::ScopeMismatch,
                candidates.first().map(|record| record.id.clone()),
                candidates.first().map(|record| record.revision),
            )
        } else {
            let record = &candidates[0];
            let code = match record.decision {
                PluginCapabilityDecision::Pending => PluginCapabilityDenialCode::Pending,
                PluginCapabilityDecision::Denied => PluginCapabilityDenialCode::Denied,
                PluginCapabilityDecision::Revoked => PluginCapabilityDenialCode::Revoked,
                PluginCapabilityDecision::Granted => PluginCapabilityDenialCode::ScopeMismatch,
            };
            (code, Some(record.id.clone()), Some(record.revision))
        };
        append_audit_tx(
            &tx,
            PluginCapabilityAuditInput {
                plugin_id: &check.plugin_id,
                version_id: &check.version_id,
                request_id: request_id.as_deref(),
                capability_id: &check.capability_id,
                scope: &normalized_scope,
                event: PluginCapabilityAuditEvent::OperationDenied,
                outcome: denial_code_str(code),
                operation: &operation,
                actor: "engine",
                reason: "capability denied at operation boundary",
                request_revision,
                created_at_ms: now,
            },
        )?;
        tx.commit()?;
        Ok(PluginCapabilityAuthorization::Denied(capability_denial(
            check, code, request_id,
        )))
    }

    pub fn list_plugin_capability_audit(
        &self,
        plugin_id: &str,
        request_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<PluginCapabilityAuditPage> {
        require_nonempty("plugin id", plugin_id)?;
        let limit = limit.clamp(1, MAX_PAGE_SIZE);
        let where_clause = if request_id.is_some() {
            "plugin_id = ?1 AND request_id = ?2"
        } else {
            "plugin_id = ?1"
        };
        let total_sql =
            format!("SELECT COUNT(*) FROM plugin_capability_audit WHERE {where_clause}");
        let total = if let Some(request_id) = request_id {
            self.connection
                .query_row(&total_sql, params![plugin_id, request_id], |row| {
                    row.get::<_, i64>(0)
                })?
        } else {
            self.connection
                .query_row(&total_sql, [plugin_id], |row| row.get::<_, i64>(0))?
        };
        let query = if request_id.is_some() {
            format!(
                "SELECT {AUDIT_COLUMNS} FROM plugin_capability_audit
                 WHERE {where_clause} ORDER BY sequence DESC LIMIT ?3 OFFSET ?4"
            )
        } else {
            format!(
                "SELECT {AUDIT_COLUMNS} FROM plugin_capability_audit
                 WHERE {where_clause} ORDER BY sequence DESC LIMIT ?2 OFFSET ?3"
            )
        };
        let mut statement = self.connection.prepare(&query)?;
        let items = if let Some(request_id) = request_id {
            statement
                .query_map(
                    params![plugin_id, request_id, i64::from(limit), i64::from(offset)],
                    map_audit_row,
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            statement
                .query_map(
                    params![plugin_id, i64::from(limit), i64::from(offset)],
                    map_audit_row,
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        Ok(PluginCapabilityAuditPage {
            items,
            total: to_u32(total)?,
            offset,
            limit,
        })
    }
}

fn append_audit_tx(tx: &Transaction<'_>, input: PluginCapabilityAuditInput<'_>) -> Result<()> {
    let PluginCapabilityAuditInput {
        plugin_id,
        version_id,
        request_id,
        capability_id,
        scope,
        event,
        outcome,
        operation,
        actor,
        reason,
        request_revision,
        created_at_ms,
    } = input;
    tx.execute(
        "INSERT INTO plugin_capability_audit (
            id, plugin_id, version_id, request_id, capability_id, scope_json,
            event, outcome, operation, actor, reason, request_revision, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            format!("cap-audit:{}", Uuid::now_v7()),
            plugin_id,
            version_id,
            request_id,
            capability_id.as_str(),
            serde_json::to_string(scope)?,
            event.as_str(),
            bounded_text(outcome, MAX_REASON_BYTES),
            bounded_text(operation, MAX_OPERATION_BYTES),
            bounded_text(actor, MAX_ACTOR_BYTES),
            bounded_text(reason, MAX_REASON_BYTES),
            request_revision.map(to_i64).transpose()?,
            created_at_ms,
        ],
    )?;
    Ok(())
}

fn map_request_row(row: &Row<'_>) -> rusqlite::Result<PluginCapabilityRequestRecord> {
    let capability_id = parse_capability_id(&row.get::<_, String>(3)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let requested_scope = parse_scope(&row.get::<_, String>(5)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let granted_scope = row
        .get::<_, Option<String>>(6)?
        .map(|value| parse_scope(&value))
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    let contribution_id = row.get::<_, String>(7)?;
    let decision =
        PluginCapabilityDecision::parse(&row.get::<_, String>(10)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                10,
                rusqlite::types::Type::Text,
                Box::new(StorageError::InvalidData(error.to_string())),
            )
        })?;
    Ok(PluginCapabilityRequestRecord {
        id: row.get(0)?,
        plugin_id: row.get(1)?,
        version_id: row.get(2)?,
        request: PluginCapabilityRequest {
            capability_id,
            required: row.get::<_, i64>(4)? != 0,
            scope: requested_scope,
            contribution_id: (!contribution_id.is_empty()).then_some(contribution_id),
        },
        granted_scope,
        legacy_permission: row.get(8)?,
        carried_from_request_id: row.get(9)?,
        decision,
        actor: row.get(11)?,
        reason: row.get(12)?,
        revision: read_u64(row, 13)?,
        created_at_ms: row.get(14)?,
        updated_at_ms: row.get(15)?,
        decided_at_ms: row.get(16)?,
    })
}

fn map_audit_row(row: &Row<'_>) -> rusqlite::Result<PluginCapabilityAuditRecord> {
    let capability_id = parse_capability_id(&row.get::<_, String>(5)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let scope = parse_scope(&row.get::<_, String>(6)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let event = PluginCapabilityAuditEvent::parse(&row.get::<_, String>(7)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            7,
            rusqlite::types::Type::Text,
            Box::new(StorageError::InvalidData(error.to_string())),
        )
    })?;
    let request_revision = row
        .get::<_, Option<i64>>(12)?
        .map(|value| {
            u64::try_from(value).map_err(|_| {
                rusqlite::Error::FromSqlConversionFailure(
                    12,
                    rusqlite::types::Type::Integer,
                    Box::new(StorageError::InvalidData(
                        "negative capability request revision".to_string(),
                    )),
                )
            })
        })
        .transpose()?;
    Ok(PluginCapabilityAuditRecord {
        sequence: u64::try_from(row.get::<_, i64>(0)?).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Integer,
                Box::new(StorageError::InvalidData(
                    "negative capability audit sequence".to_string(),
                )),
            )
        })?,
        id: row.get(1)?,
        plugin_id: row.get(2)?,
        version_id: row.get(3)?,
        request_id: row.get(4)?,
        capability_id,
        scope,
        event,
        outcome: row.get(8)?,
        operation: row.get(9)?,
        actor: row.get(10)?,
        reason: row.get(11)?,
        request_revision,
        created_at_ms: row.get(13)?,
    })
}

fn parse_capability_id(value: &str) -> Result<PluginCapabilityId> {
    PluginCapabilityId::parse(value).map_err(|error| StorageError::InvalidData(error.to_string()))
}

fn required_plugin_capabilities_satisfied_connection(
    connection: &Connection,
    plugin_id: &str,
    version_id: &str,
) -> Result<bool> {
    let mut statement = connection.prepare(
        "SELECT capability_id, decision, granted_scope_json
         FROM plugin_capability_requests
         WHERE plugin_id = ?1 AND version_id = ?2 AND required = 1",
    )?;
    let rows = statement.query_map(params![plugin_id, version_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    for row in rows {
        let (capability_id, decision, granted_scope) = row?;
        if !parse_capability_id(&capability_id)?.is_supported()
            || decision != PluginCapabilityDecision::Granted.as_str()
            || granted_scope.is_none()
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn parse_scope(value: &str) -> Result<PluginCapabilityScope> {
    serde_json::from_str::<PluginCapabilityScope>(value)
        .map_err(StorageError::Json)?
        .normalized()
        .map_err(|error| StorageError::InvalidData(error.to_string()))
}

fn capability_request_id(version_id: &str, semantic_key: &str) -> String {
    let digest = Sha256::digest(format!("{version_id}\0{semantic_key}").as_bytes());
    format!("cap-req:{version_id}:{digest:x}")
}

fn validate_audit_text(value: &str, label: &str, max_bytes: usize) -> Result<()> {
    if value.trim().is_empty()
        || value.trim() != value
        || value.len() > max_bytes
        || value.chars().any(char::is_control)
    {
        return Err(StorageError::InvalidState(format!(
            "plugin capability {label} is empty, padded, or oversized"
        )));
    }
    Ok(())
}

/// The grant or deny decision itself is the audit event; a reason is optional
/// context that is only shape-checked when one is volunteered.
fn validate_optional_audit_text(value: &str, label: &str, max_bytes: usize) -> Result<()> {
    if value.is_empty() {
        return Ok(());
    }
    if value.trim() != value || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(StorageError::InvalidState(format!(
            "plugin capability {label} is padded or oversized"
        )));
    }
    Ok(())
}

fn bounded_text(value: &str, max_bytes: usize) -> String {
    let mut output = String::new();
    for character in value.chars().filter(|character| !character.is_control()) {
        if output.len().saturating_add(character.len_utf8()) > max_bytes {
            break;
        }
        output.push(character);
    }
    output
}

fn capability_denial(
    check: &PluginCapabilityCheck,
    code: PluginCapabilityDenialCode,
    request_id: Option<String>,
) -> PluginCapabilityDenial {
    PluginCapabilityDenial {
        code,
        plugin_id: bounded_text(&check.plugin_id, MAX_ACTOR_BYTES),
        version_id: bounded_text(&check.version_id, MAX_REASON_BYTES),
        capability_id: check.capability_id.clone(),
        operation: bounded_text(&check.operation, MAX_OPERATION_BYTES),
        request_id,
        message: match code {
            PluginCapabilityDenialCode::NotRequested => "capability was not requested",
            PluginCapabilityDenialCode::Pending => "capability is awaiting review",
            PluginCapabilityDenialCode::Denied => "capability was denied",
            PluginCapabilityDenialCode::Revoked => "capability is revoked or inactive",
            PluginCapabilityDenialCode::ScopeMismatch => "operation is outside the granted scope",
            PluginCapabilityDenialCode::Malformed => "capability scope is malformed",
            PluginCapabilityDenialCode::Unsupported => "capability is unsupported",
        }
        .to_string(),
    }
}

fn denial_code_str(code: PluginCapabilityDenialCode) -> &'static str {
    match code {
        PluginCapabilityDenialCode::NotRequested => "not_requested",
        PluginCapabilityDenialCode::Pending => "pending",
        PluginCapabilityDenialCode::Denied => "denied",
        PluginCapabilityDenialCode::Revoked => "revoked",
        PluginCapabilityDenialCode::ScopeMismatch => "scope_mismatch",
        PluginCapabilityDenialCode::Malformed => "malformed",
        PluginCapabilityDenialCode::Unsupported => "unsupported",
    }
}
