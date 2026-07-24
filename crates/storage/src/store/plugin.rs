use std::path::{Path, PathBuf};

use rusqlite::{OptionalExtension, Row, params};
use translunar_filter_core::FilterDescriptor;
use translunar_plugin_runtime::{PluginContributions, PluginEntry, PluginManifest, PluginTier};

use super::{
    Store, conversion_error, now_ms, read_json, read_u64, require_nonempty, to_i64, to_u32,
};
use crate::{Result, StorageError};

const MAX_PAGE_SIZE: u32 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginStatus {
    Installed,
    Enabled,
    Disabled,
    Degraded,
}

impl PluginStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Installed => "installed",
            Self::Enabled => "enabled",
            Self::Disabled => "disabled",
            Self::Degraded => "degraded",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "installed" => Ok(Self::Installed),
            "enabled" => Ok(Self::Enabled),
            "disabled" => Ok(Self::Disabled),
            "degraded" => Ok(Self::Degraded),
            other => Err(StorageError::InvalidData(format!(
                "unknown plugin status {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PluginInstallationRecord {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub tier: PluginTier,
    pub status: PluginStatus,
    pub package_path: PathBuf,
    pub entry: PluginEntry,
    pub manifest: PluginManifest,
    pub contributions: PluginContributions,
    pub requested_permissions: Vec<String>,
    pub granted_permissions: Vec<String>,
    pub last_error: Option<String>,
    pub crash_count: u32,
    pub revision: u64,
    pub installed_at_ms: i64,
    pub updated_at_ms: i64,
}

impl PluginInstallationRecord {
    pub fn filter_descriptors(&self) -> Vec<FilterDescriptor> {
        self.manifest.filter_descriptors()
    }
}

#[derive(Debug, Clone)]
pub struct UpsertPluginInstallation {
    pub manifest: PluginManifest,
    pub package_path: PathBuf,
    pub status: PluginStatus,
    pub granted_permissions: Vec<String>,
    pub last_error: Option<String>,
}

impl Store {
    pub fn list_plugin_installations(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<PluginInstallationRecord>, u32)> {
        let limit = limit.clamp(1, MAX_PAGE_SIZE);
        let total =
            self.connection
                .query_row("SELECT COUNT(*) FROM plugin_installations", [], |row| {
                    row.get::<_, i64>(0)
                })?;
        let mut statement = self.connection.prepare(
            "SELECT id, display_name, version, tier, status, package_path, entry_json,
                    manifest_json, contributions_json, requested_permissions_json,
                    granted_permissions_json, last_error, crash_count, revision,
                    installed_at_ms, updated_at_ms
             FROM plugin_installations
             ORDER BY display_name COLLATE NOCASE, id
             LIMIT ?1 OFFSET ?2",
        )?;
        let items = statement
            .query_map(
                params![to_i64(u64::from(limit))?, to_i64(u64::from(offset))?],
                map_plugin_row,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn get_plugin_installation(&self, plugin_id: &str) -> Result<PluginInstallationRecord> {
        require_nonempty(plugin_id, "plugin id")?;
        self.connection
            .query_row(
                "SELECT id, display_name, version, tier, status, package_path, entry_json,
                        manifest_json, contributions_json, requested_permissions_json,
                        granted_permissions_json, last_error, crash_count, revision,
                        installed_at_ms, updated_at_ms
                 FROM plugin_installations WHERE id = ?1",
                [plugin_id],
                map_plugin_row,
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "plugin",
                id: plugin_id.to_string(),
            })
    }

    pub fn upsert_plugin_installation(
        &mut self,
        input: UpsertPluginInstallation,
    ) -> Result<PluginInstallationRecord> {
        let manifest = input.manifest;
        require_nonempty(&manifest.id, "plugin id")?;
        let now = now_ms();
        let package_path = path_string(&input.package_path);
        let entry_json = serde_json::to_string(&manifest.entry)?;
        let manifest_json = serde_json::to_string(&manifest)?;
        let contributions_json = serde_json::to_string(&manifest.contributions)?;
        let requested_json = serde_json::to_string(&manifest.permissions)?;
        let granted_json = serde_json::to_string(&input.granted_permissions)?;
        let tier = match manifest.tier {
            PluginTier::Process => "process",
        };
        let tx = self.connection.transaction()?;
        let existing = tx
            .query_row(
                "SELECT revision FROM plugin_installations WHERE id = ?1",
                [&manifest.id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        if let Some(revision) = existing {
            tx.execute(
                "UPDATE plugin_installations
                 SET display_name = ?2, version = ?3, tier = ?4, status = ?5,
                     package_path = ?6, entry_json = ?7, manifest_json = ?8,
                     contributions_json = ?9, requested_permissions_json = ?10,
                     granted_permissions_json = ?11, last_error = ?12,
                     revision = ?13, updated_at_ms = ?14
                 WHERE id = ?1",
                params![
                    manifest.id,
                    manifest.display_name,
                    manifest.version,
                    tier,
                    input.status.as_str(),
                    package_path,
                    entry_json,
                    manifest_json,
                    contributions_json,
                    requested_json,
                    granted_json,
                    input.last_error,
                    revision + 1,
                    now,
                ],
            )?;
        } else {
            tx.execute(
                "INSERT INTO plugin_installations (
                    id, display_name, version, tier, status, package_path, entry_json,
                    manifest_json, contributions_json, requested_permissions_json,
                    granted_permissions_json, last_error, crash_count, revision,
                    installed_at_ms, updated_at_ms
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, 0, ?13, ?13
                 )",
                params![
                    manifest.id,
                    manifest.display_name,
                    manifest.version,
                    tier,
                    input.status.as_str(),
                    package_path,
                    entry_json,
                    manifest_json,
                    contributions_json,
                    requested_json,
                    granted_json,
                    input.last_error,
                    now,
                ],
            )?;
        }
        tx.commit()?;
        self.get_plugin_installation(&manifest.id)
    }

    pub fn set_plugin_status(
        &mut self,
        plugin_id: &str,
        status: PluginStatus,
        expected_revision: Option<u64>,
        last_error: Option<String>,
    ) -> Result<PluginInstallationRecord> {
        let current = self.get_plugin_installation(plugin_id)?;
        if let Some(expected) = expected_revision
            && current.revision != expected
        {
            return Err(StorageError::EntityConflict {
                entity: "plugin",
                id: plugin_id.to_string(),
                expected_revision: expected,
                actual_revision: current.revision,
            });
        }
        let now = now_ms();
        self.connection.execute(
            "UPDATE plugin_installations
             SET status = ?2, last_error = ?3, revision = revision + 1, updated_at_ms = ?4
             WHERE id = ?1",
            params![plugin_id, status.as_str(), last_error, now],
        )?;
        self.get_plugin_installation(plugin_id)
    }

    pub fn record_plugin_crash(
        &mut self,
        plugin_id: &str,
        last_error: impl Into<String>,
    ) -> Result<PluginInstallationRecord> {
        let now = now_ms();
        let updated = self.connection.execute(
            "UPDATE plugin_installations
             SET status = 'degraded', last_error = ?2, crash_count = crash_count + 1,
                 revision = revision + 1, updated_at_ms = ?3
             WHERE id = ?1",
            params![plugin_id, last_error.into(), now],
        )?;
        if updated == 0 {
            return Err(StorageError::NotFound {
                entity: "plugin",
                id: plugin_id.to_string(),
            });
        }
        self.get_plugin_installation(plugin_id)
    }

    pub fn delete_plugin_installation(&mut self, plugin_id: &str) -> Result<()> {
        let deleted = self.connection.execute(
            "DELETE FROM plugin_installations WHERE id = ?1",
            [plugin_id],
        )?;
        if deleted == 0 {
            return Err(StorageError::NotFound {
                entity: "plugin",
                id: plugin_id.to_string(),
            });
        }
        Ok(())
    }

    pub fn list_enabled_plugins(&self) -> Result<Vec<PluginInstallationRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, display_name, version, tier, status, package_path, entry_json,
                    manifest_json, contributions_json, requested_permissions_json,
                    granted_permissions_json, last_error, crash_count, revision,
                    installed_at_ms, updated_at_ms
             FROM plugin_installations
             WHERE status = 'enabled'
             ORDER BY id",
        )?;
        let items = statement
            .query_map([], map_plugin_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(items)
    }
}

fn map_plugin_row(row: &Row<'_>) -> rusqlite::Result<PluginInstallationRecord> {
    let tier = match row.get::<_, String>(3)?.as_str() {
        "process" => PluginTier::Process,
        other => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                3,
                rusqlite::types::Type::Text,
                Box::new(StorageError::InvalidData(format!("unknown tier {other}"))),
            ));
        }
    };
    let status = PluginStatus::parse(&row.get::<_, String>(4)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let entry: PluginEntry = read_json(row, 6)?;
    let manifest: PluginManifest = read_json(row, 7)?;
    let contributions: PluginContributions = read_json(row, 8)?;
    let requested: Vec<String> = read_json(row, 9)?;
    let granted: Vec<String> = read_json(row, 10)?;
    Ok(PluginInstallationRecord {
        id: row.get(0)?,
        display_name: row.get(1)?,
        version: row.get(2)?,
        tier,
        status,
        package_path: PathBuf::from(row.get::<_, String>(5)?),
        entry,
        manifest,
        contributions,
        requested_permissions: requested,
        granted_permissions: granted,
        last_error: row.get(11)?,
        crash_count: to_u32(row.get::<_, i64>(12)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                12,
                rusqlite::types::Type::Integer,
                Box::new(error),
            )
        })?,
        revision: read_u64(row, 13)?,
        installed_at_ms: row.get(14)?,
        updated_at_ms: row.get(15)?,
    })
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

// Keep conversion_error referenced for row mapping helpers consistency.
#[allow(dead_code)]
fn _conversion_anchor(column: usize) -> rusqlite::Error {
    conversion_error(column, StorageError::InvalidData("anchor".into()))
}
