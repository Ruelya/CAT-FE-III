//! Engine-owned `.tltask` ZIP codec and service orchestration.
//!
//! The codec is deliberately kept outside the renderer and outside Storage:
//! it validates a bounded transport artifact, then hands canonical payloads to
//! the Store transaction APIs.  A package is never treated as a database.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use translunar_asset_core::{TermEntry, TmUnit};
use translunar_domain::new_id;
use translunar_protocol as protocol;
use translunar_storage::{
    TaskPackageApply, TaskPackageAssignmentImport, TaskPackageAssignmentPreview,
    TaskPackageAssignmentSelection, TaskPackageDiagnostic as StorageDiagnostic,
    TaskPackageDiscardResult as StorageDiscardResult, TaskPackageDocumentImport,
    TaskPackageExportRecord, TaskPackagePreviewRecord as StoragePreviewRecord,
    TaskPackagePreviewRowRecord as StoragePreviewRow, TaskPackageRecord, TaskPackageReturnPreview,
    TaskPackageReturnSnapshot,
};
use translunar_task_package_core::{
    MAX_ASSET_ROWS, MAX_ENTRY_BYTES, MAX_INSTRUCTION_BYTES, MAX_MANIFEST_BYTES, MAX_TOTAL_BYTES,
    TaskPackageAssetRow, TaskPackageAssetSlicePayload, TaskPackageDocumentPayload,
    TaskPackageDocumentRef, TaskPackageEntry, TaskPackageError, TaskPackageKind,
    TaskPackageManifest, TaskPackageProjection, TaskPackageReturnPayload, canonical_json,
    sha256_hex, validate_safe_path,
};
use zip::write::{SimpleFileOptions, ZipWriter};
use zip::{CompressionMethod, ZipArchive};

use crate::{EngineError, EngineService, Result, bounded_page_size};

const MANIFEST_ENTRY: &str = "manifest.json";
const INSTRUCTIONS_ENTRY: &str = "instructions.txt";
const MAX_ZIP_ENTRIES: usize = 2_048;
const MAX_PATH_DEPTH: usize = 8;
const MAX_COMPRESSION_RATIO: u64 = 1_000;
const MAX_ACTOR_BYTES: usize = 256;
const MAX_REASON_BYTES: usize = 4_096;
const MAX_PHYSICAL_PACKAGE_BYTES: u64 = MAX_TOTAL_BYTES + (MAX_ZIP_ENTRIES as u64 * 512) + 65_557;

type PackagePayloads = BTreeMap<String, Vec<u8>>;
type AssignmentPayloadBundle = (
    Vec<TaskPackageDocumentRef>,
    PackagePayloads,
    Vec<TaskPackageProjection>,
);
type ReturnPayloadBundle = (
    TaskPackageManifest,
    PackagePayloads,
    Vec<TaskPackageProjection>,
);

#[derive(Debug, Clone)]
struct ValidatedTaskPackage {
    manifest: TaskPackageManifest,
    payloads: PackagePayloads,
    instructions: String,
    assignment_documents: Vec<TaskPackageDocumentPayload>,
    return_documents: Vec<TaskPackageReturnPayload>,
    asset_slices: Vec<TaskPackageAssetSlicePayload>,
}

#[derive(Debug, Clone)]
struct StagedSources {
    paths: Vec<PathBuf>,
    retain: bool,
}

/// A validated transport copy kept under the workspace `tmp/` directory.
/// The copy is retained only after the corresponding preview transaction has
/// committed; failed validation/persistence removes it on drop.
#[derive(Debug)]
struct StagedPackage {
    path: PathBuf,
    relative_path: String,
    retain: bool,
}

impl StagedPackage {
    fn retain(&mut self) {
        self.retain = true;
    }
}

impl Drop for StagedPackage {
    fn drop(&mut self) {
        if !self.retain {
            let _ = fs::remove_file(&self.path);
        }
    }
}

impl StagedSources {
    fn retain(&mut self) {
        self.retain = true;
    }
}

impl Drop for StagedSources {
    fn drop(&mut self) {
        if !self.retain {
            for path in &self.paths {
                let _ = fs::remove_file(path);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct StoredTaskPackageEnvelope {
    #[serde(default)]
    terminal_result: Option<Value>,
}

impl EngineService {
    pub fn export_task_package(
        &mut self,
        params: protocol::TaskPackageExportParams,
    ) -> Result<protocol::TaskPackageResult> {
        validate_actor_reason(&params.actor, &params.reason)?;
        validate_export_params(&params)?;
        let destination = package_destination(&params.destination_path)?;
        if destination.exists() {
            return Err(EngineError::InvalidState(
                "task package destination already exists".to_string(),
            ));
        }

        let (manifest, payloads, working_project_id, base_projections) = match params.kind {
            TaskPackageKind::Assignment => {
                let project_id = required_string(params.project_id.as_deref(), "projectId")?;
                let expected_revision = params.expected_project_revision.ok_or_else(|| {
                    EngineError::InvalidRequest(
                        "expectedProjectRevision is required for assignment export".to_string(),
                    )
                })?;
                let selections = params
                    .documents
                    .iter()
                    .map(|selection| TaskPackageAssignmentSelection {
                        document_id: selection.document_id.clone(),
                        segment_ids: selection.segment_ids.clone(),
                    })
                    .collect::<Vec<_>>();
                let snapshot = self.store.snapshot_task_package_assignment(
                    &project_id,
                    expected_revision,
                    &selections,
                )?;
                let package_id = new_id();
                let asset_slices = self.collect_asset_slices(&project_id, &params.asset_slices)?;
                let (documents, mut payloads, bases) =
                    self.assignment_payloads(&snapshot, asset_slices.clone())?;
                let manifest = build_manifest(
                    &package_id,
                    TaskPackageKind::Assignment,
                    &snapshot.project.id,
                    &snapshot.project.name,
                    &snapshot.project.source_locale,
                    &snapshot.project.target_locale,
                    snapshot.project.revision,
                    None,
                    &params.instructions,
                    documents,
                    asset_slices,
                    &mut payloads,
                )?;
                (manifest, payloads, None, bases)
            }
            TaskPackageKind::Return => {
                let working_project_id =
                    required_string(params.working_project_id.as_deref(), "workingProjectId")?;
                let parent_package_id =
                    required_string(params.parent_package_id.as_deref(), "parentPackageId")?;
                let snapshot = self
                    .store
                    .snapshot_task_package_return(&working_project_id, &parent_package_id)?;
                let parent = self.store.get_task_package(&parent_package_id)?;
                let package_id = new_id();
                let (manifest, payloads, bases) =
                    self.return_payloads(&snapshot, &parent, &package_id, &params.instructions)?;
                (manifest, payloads, Some(working_project_id), bases)
            }
        };

        let package_sha256 = publish_task_package(&destination, &manifest, &payloads)?;
        let record = TaskPackageExportRecord {
            manifest: manifest.clone(),
            working_project_id,
            staged_path: destination.to_string_lossy().into_owned(),
            actor: params.actor,
            reason: params.reason,
            base_projections,
        };
        if let Err(error) = self.store.record_task_package_export(record) {
            let _ = fs::remove_file(&destination);
            return Err(error.into());
        }
        Ok(protocol::TaskPackageResult {
            package_id: manifest.package_id,
            kind: manifest.kind,
            package_path: destination.to_string_lossy().into_owned(),
            package_sha256,
            manifest_hash: manifest.manifest_hash,
            status: "published".to_string(),
        })
    }

    pub fn preview_task_package(
        &mut self,
        params: protocol::TaskPackagePreviewParams,
    ) -> Result<protocol::TaskPackagePreviewResult> {
        validate_actor_reason(&params.actor, &params.reason)?;
        let limit = bounded_page_size(params.limit)?;
        if params.package_path.is_some() == params.preview_id.is_some() {
            return Err(EngineError::InvalidRequest(
                "provide exactly one of packagePath or previewId".to_string(),
            ));
        }
        let record = if let Some(path) = params.package_path.as_deref() {
            let package = read_validated_task_package(Path::new(path))?;
            let mut staged = stage_task_package(
                &self.store.paths().root,
                &self.store.paths().temporary,
                Path::new(path),
                &package.manifest.manifest_hash,
            )?;
            let base_projections = package_base_projections(&package);
            let parent_working_project = package
                .manifest
                .parent_package_id
                .as_deref()
                .and_then(|parent| self.store.get_task_package(parent).ok())
                .and_then(|record| record.working_project_id);
            let package_record = TaskPackageExportRecord {
                manifest: package.manifest.clone(),
                working_project_id: parent_working_project,
                staged_path: staged.relative_path.clone(),
                actor: params.actor.clone(),
                reason: params.reason.clone(),
                base_projections,
            };
            let record = match package.manifest.kind {
                TaskPackageKind::Assignment => self.store.create_task_package_assignment_preview(
                    TaskPackageAssignmentPreview {
                        id: new_id(),
                        package: package_record,
                        staged_path: staged.relative_path.clone(),
                        documents: package.assignment_documents,
                        diagnostics: Vec::new(),
                        actor: params.actor.clone(),
                        reason: params.reason.clone(),
                    },
                ),
                TaskPackageKind::Return => {
                    self.store
                        .create_task_package_return_preview(TaskPackageReturnPreview {
                            id: new_id(),
                            package: package_record,
                            staged_path: staged.relative_path.clone(),
                            documents: package.return_documents,
                            diagnostics: Vec::new(),
                            actor: params.actor.clone(),
                            reason: params.reason.clone(),
                        })
                }
            }?;
            staged.retain();
            record
        } else {
            let preview_id = params
                .preview_id
                .as_deref()
                .ok_or_else(|| EngineError::InvalidRequest("previewId is required".to_string()))?;
            self.store.get_task_package_preview(preview_id)?
        };
        self.preview_result(record, params.offset, limit)
    }

    pub fn import_task_package(
        &mut self,
        params: protocol::TaskPackageImportParams,
    ) -> Result<protocol::TaskPackageImportResult> {
        validate_actor_reason(&params.actor, &params.reason)?;
        let preview = self.store.get_task_package_preview(&params.preview_id)?;
        if preview.kind != TaskPackageKind::Assignment {
            return Err(EngineError::InvalidState(
                "only assignment packages can be imported".to_string(),
            ));
        }
        let package = self.store.get_task_package(&preview.package_id)?;
        if preview.status == translunar_storage::TaskPackagePreviewStatus::Applied
            && let Some(result) = decode_terminal_import_result(&package)?
        {
            return Ok(result);
        }
        let staged_path =
            resolve_task_package_path(&self.store.paths().root, &package.staged_path)?;
        let bundle = read_validated_task_package(&staged_path)?;
        ensure_same_package(&package, &bundle.manifest)?;
        let local_project_id = new_id();
        let project_name = params
            .project_name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("{} (Task)", bundle.manifest.project_name));
        let domain = params
            .domain
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "offline-task".to_string());
        let mut staged = StagedSources {
            paths: Vec::new(),
            retain: false,
        };
        let mut documents = Vec::with_capacity(bundle.assignment_documents.len());
        for document in &bundle.assignment_documents {
            let reference = bundle
                .manifest
                .documents
                .iter()
                .find(|reference| reference.origin_document_id == document.origin_document_id)
                .ok_or_else(|| invalid_package("assignment document is absent from manifest"))?;
            let bytes = bundle
                .payloads
                .get(&document.source_entry)
                .ok_or_else(|| invalid_package("assignment source entry is missing"))?;
            if sha256_hex(bytes) != reference.source_sha256 {
                return Err(invalid_package(
                    "assignment source hash does not match manifest",
                ));
            }
            let local_document_id = new_id();
            let extension = safe_extension(&reference.format);
            let managed_absolute = self
                .store
                .paths()
                .managed_source(&local_document_id, &extension);
            let managed_relative =
                relative_workspace_path(&self.store.paths().root, &managed_absolute)?;
            stage_source(
                &self.store.paths().temporary,
                &managed_absolute,
                bytes,
                &mut staged,
            )?;
            documents.push(TaskPackageDocumentImport {
                local_document_id,
                origin_document_id: document.origin_document_id.clone(),
                name: reference.name.clone(),
                relative_path: reference.name.clone(),
                format: reference.format.clone(),
                filter_id: filter_id_for_format(&reference.format),
                source_sha256: reference.source_sha256.clone(),
                original_source_path: package.staged_path.clone(),
                managed_source_path: managed_relative,
                source_entry: document.source_entry.clone(),
                projections: document.segments.clone(),
            });
        }
        let result = self
            .store
            .import_task_package_assignment(TaskPackageAssignmentImport {
                preview_id: preview.id,
                local_project_id,
                project_name,
                domain,
                instructions: bundle.instructions,
                documents,
                asset_slices: bundle.asset_slices,
                actor: params.actor,
                reason: params.reason,
            })?;
        staged.retain();
        Ok(protocol_import_result(result))
    }

    pub fn apply_task_package(
        &mut self,
        params: protocol::TaskPackageApplyParams,
    ) -> Result<protocol::TaskPackageApplyResult> {
        let result = self.store.apply_task_package(TaskPackageApply {
            preview_id: params.preview_id,
            expected_project_revision: params.expected_project_revision,
            selected_row_ids: params.selected_row_ids,
            actor: params.actor,
            reason: params.reason,
        })?;
        Ok(protocol_apply_result(result))
    }

    pub fn discard_task_package(
        &mut self,
        params: protocol::TaskPackageDiscardParams,
    ) -> Result<protocol::TaskPackageDiscardResult> {
        let result = self.store.discard_task_package(
            &params.package_id,
            params.preview_id.as_deref(),
            &params.actor,
            &params.reason,
        )?;
        Ok(protocol_discard_result(result))
    }

    fn preview_result(
        &self,
        record: StoragePreviewRecord,
        offset: u32,
        limit: u32,
    ) -> Result<protocol::TaskPackagePreviewResult> {
        let (rows, total) = self
            .store
            .list_task_package_preview_rows(&record.id, offset, limit)?;
        let package = self.store.get_task_package(&record.package_id)?;
        Ok(protocol::TaskPackagePreviewResult {
            preview_id: record.id,
            package_id: record.package_id,
            kind: record.kind,
            project_id: record.origin_project_id,
            expected_project_revision: record.expected_project_revision,
            status: preview_status_text(record.status).to_string(),
            manifest_hash: package.manifest.manifest_hash,
            counts: protocol_counts(record.counts),
            diagnostics: record
                .diagnostics
                .into_iter()
                .map(protocol_diagnostic)
                .collect(),
            rows: rows.into_iter().map(protocol_preview_row).collect(),
            total,
            offset,
            limit,
        })
    }

    fn assignment_payloads(
        &self,
        snapshot: &translunar_storage::TaskPackageAssignmentSnapshot,
        asset_slices: Vec<TaskPackageAssetSlicePayload>,
    ) -> Result<AssignmentPayloadBundle> {
        let mut refs = Vec::with_capacity(snapshot.documents.len());
        let mut payloads = BTreeMap::new();
        let mut bases = Vec::new();
        for document in &snapshot.documents {
            let bytes = read_managed_source(
                &self.store.paths().root,
                Path::new(&document.managed_source_path),
            )?;
            if sha256_hex(&bytes) != document.document.source_sha256 {
                return Err(EngineError::InvalidState(format!(
                    "managed source hash differs for document {}",
                    document.document.id
                )));
            }
            let extension = source_extension(Path::new(&document.managed_source_path));
            let source_entry = format!(
                "documents/{}/source.{}",
                document.document.id,
                safe_extension(&extension)
            );
            let segments_entry = format!("documents/{}/segments.json", document.document.id);
            validate_safe_path(&source_entry).map_err(package_error)?;
            validate_safe_path(&segments_entry).map_err(package_error)?;
            let payload = TaskPackageDocumentPayload {
                origin_document_id: document.document.id.clone(),
                source_sha256: document.document.source_sha256.clone(),
                base_revision: document.document.revision,
                source_entry: source_entry.clone(),
                segments: document.projections.clone(),
            };
            let json = canonical_json(&payload).map_err(package_error)?;
            payloads.insert(source_entry, bytes);
            payloads.insert(segments_entry, json);
            bases.extend(document.projections.iter().cloned());
            refs.push(TaskPackageDocumentRef {
                origin_document_id: document.document.id.clone(),
                name: document.document.name.clone(),
                format: document.document.format.clone(),
                source_sha256: document.document.source_sha256.clone(),
                base_revision: document.document.revision,
                segment_count: u32::try_from(document.projections.len()).map_err(|_| {
                    EngineError::InvalidRequest("segment count exceeds u32".to_string())
                })?,
            });
        }
        for (index, slice) in asset_slices.iter().enumerate() {
            let path = asset_entry_path(index, slice);
            payloads.insert(path, canonical_json(slice).map_err(package_error)?);
        }
        Ok((refs, payloads, bases))
    }

    fn return_payloads(
        &self,
        snapshot: &TaskPackageReturnSnapshot,
        parent: &TaskPackageRecord,
        package_id: &str,
        instructions: &str,
    ) -> Result<ReturnPayloadBundle> {
        let mut payloads = BTreeMap::new();
        let mut bases = Vec::new();
        for document in &snapshot.documents {
            let path = format!("documents/{}/return.json", document.origin_document_id);
            validate_safe_path(&path).map_err(package_error)?;
            let payload = TaskPackageReturnPayload {
                origin_document_id: document.origin_document_id.clone(),
                source_sha256: document.source_sha256.clone(),
                base_revision: document.base_revision,
                rows: document.rows.clone(),
            };
            bases.extend(payload.rows.iter().map(|row| row.base.clone()));
            payloads.insert(path, canonical_json(&payload).map_err(package_error)?);
        }
        let mut manifest = parent.manifest.clone();
        manifest.package_id = package_id.to_string();
        manifest.kind = TaskPackageKind::Return;
        manifest.parent_package_id = Some(parent.id.clone());
        manifest.asset_slices.clear();
        manifest.instruction_sha256 = Some(sha256_hex(instructions.as_bytes()));
        manifest.entries.clear();
        payloads.insert(
            INSTRUCTIONS_ENTRY.to_string(),
            instructions.as_bytes().to_vec(),
        );
        manifest.entries = payload_entries(&payloads)?;
        manifest.manifest_hash = manifest.digest().map_err(package_error)?;
        manifest.validate().map_err(package_error)?;
        Ok((manifest, payloads, bases))
    }

    fn collect_asset_slices(
        &self,
        project_id: &str,
        selections: &[protocol::TaskPackageAssetSelection],
    ) -> Result<Vec<TaskPackageAssetSlicePayload>> {
        if selections.len() > MAX_ASSET_ROWS {
            return Err(resource_limit(
                "asset slices",
                MAX_ASSET_ROWS as u64,
                selections.len() as u64,
            ));
        }
        let mut result = Vec::with_capacity(selections.len());
        let mut total = 0_usize;
        for selection in selections {
            if selection.row_ids.is_empty() {
                return Err(EngineError::InvalidRequest(
                    "asset slice selection must name at least one row".to_string(),
                ));
            }
            let kind = selection.kind.to_ascii_lowercase();
            let (name, source_locale, target_locale, rows) = match kind.as_str() {
                "tm" => {
                    let library = self.store.get_tm_library(&selection.library_id)?;
                    if !self
                        .store
                        .list_tm_library_mounts(project_id)?
                        .iter()
                        .any(|mount| mount.library_id == library.id && mount.enabled)
                    {
                        return Err(EngineError::InvalidState(
                            "selected TM library is not mounted in the project".to_string(),
                        ));
                    }
                    let units = self.store.export_tm_units(&library.id)?;
                    let selected = select_asset_ids(
                        &selection.row_ids,
                        units.iter().map(|unit| unit.id.as_str()),
                    )?;
                    let rows = units
                        .into_iter()
                        .filter(|unit| selected.contains(&unit.id))
                        .map(tm_asset_row)
                        .collect::<Result<Vec<_>>>()?;
                    (
                        library.name,
                        library.source_locale,
                        library.target_locale,
                        rows,
                    )
                }
                "termbase" | "tb" => {
                    let termbase = self.store.get_termbase(&selection.library_id)?;
                    if !self
                        .store
                        .list_termbase_mounts(project_id)?
                        .iter()
                        .any(|mount| mount.termbase_id == termbase.id && mount.enabled)
                    {
                        return Err(EngineError::InvalidState(
                            "selected termbase is not mounted in the project".to_string(),
                        ));
                    }
                    let entries = self.store.export_term_entries(&termbase.id)?;
                    let ids = entries
                        .iter()
                        .flat_map(|entry| {
                            entry
                                .translations
                                .iter()
                                .map(|translation| translation.id.as_str())
                        })
                        .collect::<Vec<_>>();
                    let selected = select_asset_ids(&selection.row_ids, ids)?;
                    let mut rows = Vec::with_capacity(selected.len());
                    let mut target_locales = BTreeSet::new();
                    for entry in entries {
                        for translation in &entry.translations {
                            if selected.contains(&translation.id) {
                                target_locales.insert(translation.locale.clone());
                                rows.push(term_asset_row(&entry, translation.clone())?);
                            }
                        }
                    }
                    if target_locales.len() != 1 {
                        return Err(EngineError::InvalidRequest(
                            "a termbase slice must select one target locale".to_string(),
                        ));
                    }
                    let target_locale = target_locales.into_iter().next().ok_or_else(|| {
                        EngineError::InvalidRequest(
                            "a termbase slice must select one target locale".to_string(),
                        )
                    })?;
                    (termbase.name, termbase.source_locale, target_locale, rows)
                }
                _ => {
                    return Err(EngineError::InvalidRequest(
                        "asset slice kind must be tm or termbase".to_string(),
                    ));
                }
            };
            total = total.checked_add(rows.len()).ok_or_else(|| {
                EngineError::InvalidRequest("asset row count overflow".to_string())
            })?;
            if total > MAX_ASSET_ROWS {
                return Err(resource_limit(
                    "asset rows",
                    MAX_ASSET_ROWS as u64,
                    total as u64,
                ));
            }
            result.push(TaskPackageAssetSlicePayload {
                kind: if kind == "tb" {
                    "termbase".to_string()
                } else {
                    kind
                },
                library_id: selection.library_id.clone(),
                name,
                source_locale,
                target_locale,
                rows,
            });
        }
        Ok(result)
    }
}

#[allow(clippy::too_many_arguments)]
fn build_manifest(
    package_id: &str,
    kind: TaskPackageKind,
    project_id: &str,
    project_name: &str,
    source_locale: &str,
    target_locale: &str,
    base_project_revision: u64,
    parent_package_id: Option<String>,
    instructions: &str,
    documents: Vec<TaskPackageDocumentRef>,
    asset_slices: Vec<TaskPackageAssetSlicePayload>,
    payloads: &mut BTreeMap<String, Vec<u8>>,
) -> Result<TaskPackageManifest> {
    if instructions.len() > MAX_INSTRUCTION_BYTES {
        return Err(resource_limit(
            "instructions",
            MAX_INSTRUCTION_BYTES as u64,
            instructions.len() as u64,
        ));
    }
    payloads.insert(
        INSTRUCTIONS_ENTRY.to_string(),
        instructions.as_bytes().to_vec(),
    );
    let asset_refs = asset_slices
        .iter()
        .map(
            |slice| translunar_task_package_core::TaskPackageAssetSliceRef {
                kind: slice.kind.clone(),
                library_id: slice.library_id.clone(),
                name: slice.name.clone(),
                source_locale: slice.source_locale.clone(),
                target_locale: slice.target_locale.clone(),
                row_count: u32::try_from(slice.rows.len()).unwrap_or(u32::MAX),
            },
        )
        .collect();
    let mut manifest = TaskPackageManifest {
        format_version: translunar_task_package_core::TASK_PACKAGE_FORMAT_VERSION,
        package_id: package_id.to_string(),
        kind,
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        source_locale: source_locale.to_string(),
        target_locale: target_locale.to_string(),
        base_project_revision,
        parent_package_id,
        instruction_sha256: Some(sha256_hex(instructions.as_bytes())),
        documents,
        asset_slices: asset_refs,
        entries: payload_entries(payloads)?,
        manifest_hash: String::new(),
    };
    manifest.manifest_hash = manifest.digest().map_err(package_error)?;
    manifest.validate().map_err(package_error)?;
    Ok(manifest)
}

fn publish_task_package(
    destination: &Path,
    manifest: &TaskPackageManifest,
    payloads: &BTreeMap<String, Vec<u8>>,
) -> Result<String> {
    if destination.exists() {
        return Err(EngineError::InvalidState(
            "task package destination already exists".to_string(),
        ));
    }
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    {
        let mut writer = ZipWriter::new(temporary.as_file_mut());
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o600);
        for (path, bytes) in payloads {
            writer
                .start_file(path, options)
                .map_err(|error| EngineError::TaskPackageExport(error.to_string()))?;
            writer.write_all(bytes)?;
        }
        let manifest_bytes = canonical_json(manifest).map_err(package_error)?;
        writer
            .start_file(MANIFEST_ENTRY, options)
            .map_err(|error| EngineError::TaskPackageExport(error.to_string()))?;
        writer.write_all(&manifest_bytes)?;
        writer
            .finish()
            .map_err(|error| EngineError::TaskPackageExport(error.to_string()))?;
    }
    temporary.as_file().sync_all()?;
    let validated = read_validated_task_package(temporary.path())?;
    if validated.manifest.manifest_hash != manifest.manifest_hash {
        return Err(EngineError::TaskPackageExport(
            "staged task package manifest changed during validation".to_string(),
        ));
    }
    let package_sha256 = sha256_path(temporary.path())?;
    temporary
        .persist_noclobber(destination)
        .map_err(|error| EngineError::Io(error.error))?;
    Ok(package_sha256)
}

fn read_validated_task_package(path: &Path) -> Result<ValidatedTaskPackage> {
    if !path.is_file() {
        return Err(EngineError::InvalidRequest(
            "task package does not exist".to_string(),
        ));
    }
    let physical_size = path.metadata()?.len();
    if physical_size > MAX_PHYSICAL_PACKAGE_BYTES {
        return Err(resource_limit(
            "package bytes",
            MAX_PHYSICAL_PACKAGE_BYTES,
            physical_size,
        ));
    }
    let mut file = File::open(path)?;
    reject_zip64_footer(&mut file)?;
    validate_raw_zip_directory(&mut file)?;
    file.seek(SeekFrom::Start(0))?;
    let mut archive = ZipArchive::new(file).map_err(|error| invalid_package(error.to_string()))?;
    let mut raw_file = File::open(path)?;
    if archive.is_empty() || archive.len() > MAX_ZIP_ENTRIES {
        return Err(resource_limit(
            "ZIP entries",
            MAX_ZIP_ENTRIES as u64,
            archive.len() as u64,
        ));
    }
    let mut manifest_bytes = None;
    let mut payloads = BTreeMap::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| invalid_package(error.to_string()))?;
        let name = entry.name().to_string();
        validate_zip_path(&name)?;
        if entry.is_dir() || entry.is_symlink() {
            return Err(invalid_package(
                "task package cannot contain directories or symlinks",
            ));
        }
        if entry.encrypted() {
            return Err(invalid_package(
                "encrypted task package entries are not supported",
            ));
        }
        if contains_zip64_extra(entry.extra_data())
            || raw_entry_contains_zip64_extra(
                &mut raw_file,
                entry.header_start(),
                entry.central_header_start(),
            )?
        {
            return Err(invalid_package(
                "ZIP64 task package entries are not supported",
            ));
        }
        if !matches!(
            entry.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            return Err(invalid_package(
                "task package compression method is unsupported",
            ));
        }
        let compressed = entry.compressed_size();
        let uncompressed = entry.size();
        if uncompressed > MAX_ENTRY_BYTES {
            return Err(resource_limit("entry bytes", MAX_ENTRY_BYTES, uncompressed));
        }
        if compressed == 0 && uncompressed > 0
            || compressed > 0 && uncompressed > compressed.saturating_mul(MAX_COMPRESSION_RATIO)
        {
            return Err(invalid_package(
                "task package compression ratio is excessive",
            ));
        }
        total = total
            .checked_add(uncompressed)
            .ok_or_else(|| invalid_package("task package size overflow"))?;
        if total > MAX_TOTAL_BYTES {
            return Err(resource_limit("total bytes", MAX_TOTAL_BYTES, total));
        }
        let limit = if name == MANIFEST_ENTRY {
            MAX_MANIFEST_BYTES
        } else {
            MAX_ENTRY_BYTES
        };
        if uncompressed > limit {
            return Err(resource_limit(
                if name == MANIFEST_ENTRY {
                    "manifest bytes"
                } else {
                    "entry bytes"
                },
                limit,
                uncompressed,
            ));
        }
        let mut bytes = Vec::with_capacity(usize::try_from(uncompressed).unwrap_or(0));
        (&mut entry)
            .take(uncompressed.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|error| invalid_package(error.to_string()))?;
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) != uncompressed {
            return Err(invalid_package("task package entry size is inconsistent"));
        }
        if name == MANIFEST_ENTRY {
            if manifest_bytes.replace(bytes).is_some() {
                return Err(invalid_package(
                    "task package contains duplicate manifest entries",
                ));
            }
        } else if payloads.insert(name, bytes).is_some() {
            return Err(invalid_package(
                "task package contains duplicate entry paths",
            ));
        }
    }
    let manifest_bytes =
        manifest_bytes.ok_or_else(|| invalid_package("task package manifest is missing"))?;
    let manifest: TaskPackageManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| invalid_package(error.to_string()))?;
    let canonical = canonical_json(&manifest).map_err(package_error)?;
    if canonical != manifest_bytes {
        return Err(invalid_package(
            "task package manifest is not canonical JSON",
        ));
    }
    manifest.validate().map_err(package_error)?;
    if payloads.len() != manifest.entries.len() {
        return Err(invalid_package(
            "task package entries do not match its manifest",
        ));
    }
    for expected in &manifest.entries {
        let bytes = payloads.get(&expected.path).ok_or_else(|| {
            invalid_package(format!("task package entry is missing: {}", expected.path))
        })?;
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) != expected.size_bytes
            || sha256_hex(bytes) != expected.sha256
        {
            return Err(invalid_package(format!(
                "task package entry failed hash validation: {}",
                expected.path
            )));
        }
    }
    for (entry_path, bytes) in &payloads {
        if entry_path.ends_with(".json") {
            let value: Value = serde_json::from_slice(bytes)
                .map_err(|error| invalid_package(error.to_string()))?;
            if canonical_json(&value).map_err(package_error)? != *bytes {
                return Err(invalid_package(format!(
                    "task package JSON entry is not canonical: {entry_path}"
                )));
            }
        }
    }
    let instructions = match payloads.get(INSTRUCTIONS_ENTRY) {
        Some(bytes) => {
            let value = String::from_utf8(bytes.clone())
                .map_err(|_| invalid_package("task package instructions are not UTF-8"))?;
            if value.len() > MAX_INSTRUCTION_BYTES {
                return Err(resource_limit(
                    "instructions",
                    MAX_INSTRUCTION_BYTES as u64,
                    value.len() as u64,
                ));
            }
            if manifest.instruction_sha256.as_deref() != Some(sha256_hex(bytes).as_str()) {
                return Err(invalid_package(
                    "task package instruction hash does not match",
                ));
            }
            value
        }
        None if manifest.instruction_sha256.is_some() => {
            return Err(invalid_package(
                "task package instructions entry is missing",
            ));
        }
        None => String::new(),
    };
    let (assignment_documents, return_documents) = parse_document_payloads(&manifest, &payloads)?;
    let asset_slices = parse_asset_slices(&manifest, &payloads)?;
    let projections = assignment_documents
        .iter()
        .flat_map(|document| document.segments.iter())
        .chain(return_documents.iter().flat_map(|document| {
            document
                .rows
                .iter()
                .flat_map(|row| std::iter::once(&row.base).chain(row.remote.iter()))
        }))
        .collect::<Vec<_>>();
    validate_comment_limit(&projections)?;
    validate_payload_accounting(
        &manifest,
        &payloads,
        &assignment_documents,
        &return_documents,
        &asset_slices,
    )?;
    Ok(ValidatedTaskPackage {
        manifest,
        payloads,
        instructions,
        assignment_documents,
        return_documents,
        asset_slices,
    })
}

fn validate_comment_limit(projections: &[&TaskPackageProjection]) -> Result<()> {
    let mut total = 0_usize;
    for projection in projections {
        if projection.comments_json.trim().is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(&projection.comments_json)
            .map_err(|error| invalid_package(error.to_string()))?;
        let count = value
            .as_array()
            .ok_or_else(|| invalid_package("task package comments must be an array"))?
            .len();
        total = total
            .checked_add(count)
            .ok_or_else(|| invalid_package("task package comment count overflow"))?;
        if total > translunar_task_package_core::MAX_COMMENTS {
            return Err(resource_limit(
                "comments",
                translunar_task_package_core::MAX_COMMENTS as u64,
                total as u64,
            ));
        }
    }
    Ok(())
}

fn reject_zip64_footer(file: &mut File) -> Result<()> {
    const EOCD_SIGNATURE: [u8; 4] = [0x50, 0x4b, 0x05, 0x06];
    const ZIP64_LOCATOR_SIGNATURE: [u8; 4] = [0x50, 0x4b, 0x06, 0x07];
    const ZIP64_EOCD_SIGNATURE: [u8; 4] = [0x50, 0x4b, 0x06, 0x06];
    let length = file.metadata()?.len();
    let window_len = length.min(65_557);
    file.seek(SeekFrom::End(-(window_len as i64)))?;
    let mut tail = vec![0_u8; usize::try_from(window_len).unwrap_or(0)];
    file.read_exact(&mut tail)?;
    let eocd = tail
        .windows(EOCD_SIGNATURE.len())
        .rposition(|window| window == EOCD_SIGNATURE)
        .ok_or_else(|| invalid_package("ZIP end-of-central-directory record is missing"))?;
    if eocd + 22 > tail.len() {
        return Err(invalid_package(
            "ZIP end-of-central-directory record is truncated",
        ));
    }
    let comment_len = usize::from(u16::from_le_bytes([tail[eocd + 20], tail[eocd + 21]]));
    if eocd + 22 + comment_len > tail.len() {
        return Err(invalid_package(
            "ZIP end-of-central-directory comment is truncated",
        ));
    }
    let disk = u16::from_le_bytes([tail[eocd + 4], tail[eocd + 5]]);
    let central_disk = u16::from_le_bytes([tail[eocd + 6], tail[eocd + 7]]);
    let entries_disk = u16::from_le_bytes([tail[eocd + 8], tail[eocd + 9]]);
    let entries_total = u16::from_le_bytes([tail[eocd + 10], tail[eocd + 11]]);
    let central_size = u32::from_le_bytes([
        tail[eocd + 12],
        tail[eocd + 13],
        tail[eocd + 14],
        tail[eocd + 15],
    ]);
    let central_offset = u32::from_le_bytes([
        tail[eocd + 16],
        tail[eocd + 17],
        tail[eocd + 18],
        tail[eocd + 19],
    ]);
    if disk != 0
        || central_disk != 0
        || entries_disk == u16::MAX
        || entries_total == u16::MAX
        || central_size == u32::MAX
        || central_offset == u32::MAX
    {
        return Err(invalid_package(
            "ZIP64 or multi-disk task packages are not supported",
        ));
    }
    let eocd_absolute = length
        .saturating_sub(window_len)
        .saturating_add(eocd as u64);
    if eocd_absolute >= 20 {
        file.seek(SeekFrom::Start(eocd_absolute - 20))?;
        let mut locator = [0_u8; 4];
        file.read_exact(&mut locator)?;
        if locator == ZIP64_LOCATOR_SIGNATURE {
            return Err(invalid_package("ZIP64 task packages are not supported"));
        }
    }
    // A well-formed ZIP64 archive always has the locator immediately before
    // the EOCD64/EOCD pair.  Reject an EOCD64 record in the footer as well so
    // malformed archives cannot bypass the marker checks above.
    if tail[..eocd]
        .windows(ZIP64_EOCD_SIGNATURE.len())
        .any(|window| window == ZIP64_EOCD_SIGNATURE)
    {
        return Err(invalid_package("ZIP64 task packages are not supported"));
    }
    file.seek(SeekFrom::Start(0))?;
    Ok(())
}

/// Validate the raw central directory before handing the file to `zip`.
///
/// `ZipArchive` is intentionally a convenience reader; some versions index
/// entries by name and can therefore hide duplicate names or overlapping
/// local payload ranges. The transport boundary needs to reject those cases
/// before any archive entry is constructed.
fn validate_raw_zip_directory(file: &mut File) -> Result<()> {
    const EOCD_SIGNATURE: [u8; 4] = [0x50, 0x4b, 0x05, 0x06];
    const CENTRAL_SIGNATURE: [u8; 4] = [0x50, 0x4b, 0x01, 0x02];
    const LOCAL_SIGNATURE: [u8; 4] = [0x50, 0x4b, 0x03, 0x04];
    const CENTRAL_HEADER_BYTES: u64 = 46;
    const LOCAL_HEADER_BYTES: u64 = 30;

    let length = file.metadata()?.len();
    let window_len = length.min(65_557);
    if window_len < 22 {
        return Err(invalid_package(
            "ZIP end-of-central-directory record is missing",
        ));
    }
    file.seek(SeekFrom::End(-(window_len as i64)))?;
    let mut tail = vec![0_u8; usize::try_from(window_len).unwrap_or(0)];
    file.read_exact(&mut tail)?;
    let eocd = tail
        .windows(EOCD_SIGNATURE.len())
        .rposition(|window| window == EOCD_SIGNATURE)
        .ok_or_else(|| invalid_package("ZIP end-of-central-directory record is missing"))?;
    if eocd + 22 > tail.len() {
        return Err(invalid_package(
            "ZIP end-of-central-directory record is truncated",
        ));
    }
    let comment_len = usize::from(u16::from_le_bytes([tail[eocd + 20], tail[eocd + 21]]));
    if eocd + 22 + comment_len > tail.len() {
        return Err(invalid_package(
            "ZIP end-of-central-directory comment is truncated",
        ));
    }
    let entries = usize::from(u16::from_le_bytes([tail[eocd + 10], tail[eocd + 11]]));
    if entries == 0 {
        return Err(invalid_package("task package contains no ZIP entries"));
    }
    if entries > MAX_ZIP_ENTRIES {
        return Err(resource_limit(
            "ZIP entries",
            MAX_ZIP_ENTRIES as u64,
            entries as u64,
        ));
    }
    let central_size = u64::from(u32::from_le_bytes([
        tail[eocd + 12],
        tail[eocd + 13],
        tail[eocd + 14],
        tail[eocd + 15],
    ]));
    let central_offset = u64::from(u32::from_le_bytes([
        tail[eocd + 16],
        tail[eocd + 17],
        tail[eocd + 18],
        tail[eocd + 19],
    ]));
    let eocd_absolute = length
        .saturating_sub(window_len)
        .saturating_add(eocd as u64);
    let central_end = central_offset
        .checked_add(central_size)
        .ok_or_else(|| invalid_package("ZIP central directory size overflows"))?;
    if central_end != eocd_absolute || central_end > length {
        return Err(invalid_package(
            "ZIP central directory range is inconsistent",
        ));
    }

    let mut cursor = central_offset;
    let mut names = BTreeSet::new();
    let mut payload_ranges = Vec::<(u64, u64)>::with_capacity(entries);
    for _ in 0..entries {
        if cursor
            .checked_add(CENTRAL_HEADER_BYTES)
            .is_none_or(|end| end > central_end)
        {
            return Err(invalid_package("ZIP central directory entry is truncated"));
        }
        file.seek(SeekFrom::Start(cursor))?;
        let mut header = [0_u8; 46];
        file.read_exact(&mut header)?;
        if header[..4] != CENTRAL_SIGNATURE {
            return Err(invalid_package(
                "task package ZIP central header signature is invalid",
            ));
        }
        let flags = u16::from_le_bytes([header[8], header[9]]);
        let compression = u16::from_le_bytes([header[10], header[11]]);
        if flags & 0x0001 != 0 {
            return Err(invalid_package(
                "encrypted task package entries are not supported",
            ));
        }
        if compression != 0 && compression != 8 {
            return Err(invalid_package(
                "task package compression method is unsupported",
            ));
        }
        let compressed_size = u32::from_le_bytes([header[20], header[21], header[22], header[23]]);
        let uncompressed_size =
            u32::from_le_bytes([header[24], header[25], header[26], header[27]]);
        let name_len = usize::from(u16::from_le_bytes([header[28], header[29]]));
        let extra_len = usize::from(u16::from_le_bytes([header[30], header[31]]));
        let comment_len = usize::from(u16::from_le_bytes([header[32], header[33]]));
        let record_len = CENTRAL_HEADER_BYTES
            .checked_add(name_len as u64)
            .and_then(|value| value.checked_add(extra_len as u64))
            .and_then(|value| value.checked_add(comment_len as u64))
            .ok_or_else(|| invalid_package("ZIP central directory entry size overflows"))?;
        let record_end = cursor
            .checked_add(record_len)
            .ok_or_else(|| invalid_package("ZIP central directory entry range overflows"))?;
        if record_end > central_end {
            return Err(invalid_package("ZIP central directory entry is truncated"));
        }
        if compressed_size == u32::MAX || uncompressed_size == u32::MAX {
            return Err(invalid_package("ZIP64 task packages are not supported"));
        }
        file.seek(SeekFrom::Start(cursor + CENTRAL_HEADER_BYTES))?;
        let mut name_bytes = vec![0_u8; name_len];
        file.read_exact(&mut name_bytes)?;
        let name = String::from_utf8(name_bytes.clone())
            .map_err(|_| invalid_package("task package ZIP path is not UTF-8"))?;
        validate_zip_path(&name)?;
        let normalized = name.split('/').collect::<Vec<_>>().join("/");
        if !names.insert(normalized) {
            return Err(invalid_package(
                "task package contains duplicate ZIP entry paths",
            ));
        }
        let mut extra = vec![0_u8; extra_len];
        file.read_exact(&mut extra)?;
        if contains_zip64_extra(Some(&extra)) {
            return Err(invalid_package("ZIP64 task packages are not supported"));
        }

        let local_offset = u64::from(u32::from_le_bytes([
            header[42], header[43], header[44], header[45],
        ]));
        if local_offset >= central_offset
            || local_offset
                .checked_add(LOCAL_HEADER_BYTES)
                .is_none_or(|end| end > central_offset)
        {
            return Err(invalid_package(
                "ZIP local entry lies outside the payload area",
            ));
        }
        file.seek(SeekFrom::Start(local_offset))?;
        let mut local = [0_u8; 30];
        file.read_exact(&mut local)?;
        if local[..4] != LOCAL_SIGNATURE {
            return Err(invalid_package(
                "task package ZIP local header signature is invalid",
            ));
        }
        let local_flags = u16::from_le_bytes([local[6], local[7]]);
        let local_compression = u16::from_le_bytes([local[8], local[9]]);
        if local_flags & 0x0001 != 0 || local_flags != flags || local_compression != compression {
            return Err(invalid_package(
                "task package ZIP local and central metadata differ",
            ));
        }
        let local_name_len = usize::from(u16::from_le_bytes([local[26], local[27]]));
        let local_extra_len = usize::from(u16::from_le_bytes([local[28], local[29]]));
        let local_header_end = local_offset
            .checked_add(LOCAL_HEADER_BYTES)
            .and_then(|value| value.checked_add(local_name_len as u64))
            .and_then(|value| value.checked_add(local_extra_len as u64))
            .ok_or_else(|| invalid_package("ZIP local header range overflows"))?;
        if local_header_end > central_offset {
            return Err(invalid_package("ZIP local header is truncated"));
        }
        file.seek(SeekFrom::Start(local_offset + LOCAL_HEADER_BYTES))?;
        let mut local_name = vec![0_u8; local_name_len];
        file.read_exact(&mut local_name)?;
        if local_name != name_bytes {
            return Err(invalid_package(
                "task package ZIP local and central names differ",
            ));
        }
        let mut local_extra = vec![0_u8; local_extra_len];
        file.read_exact(&mut local_extra)?;
        if contains_zip64_extra(Some(&local_extra)) {
            return Err(invalid_package("ZIP64 task packages are not supported"));
        }
        let payload_start = local_header_end;
        let payload_end = payload_start
            .checked_add(u64::from(compressed_size))
            .ok_or_else(|| invalid_package("ZIP payload range overflows"))?;
        if payload_end > central_offset || payload_end > length {
            return Err(invalid_package("ZIP payload lies outside the archive"));
        }
        payload_ranges.push((payload_start, payload_end));
        cursor = record_end;
    }
    if cursor != central_end {
        return Err(invalid_package(
            "ZIP central directory contains trailing bytes",
        ));
    }
    payload_ranges.sort_unstable_by_key(|range| range.0);
    for pair in payload_ranges.windows(2) {
        if let [left, right] = pair
            && right.0 < left.1
        {
            return Err(invalid_package("task package ZIP payload ranges overlap"));
        }
    }
    file.seek(SeekFrom::Start(0))?;
    Ok(())
}

fn validate_payload_accounting(
    manifest: &TaskPackageManifest,
    payloads: &BTreeMap<String, Vec<u8>>,
    assignments: &[TaskPackageDocumentPayload],
    returns: &[TaskPackageReturnPayload],
    assets: &[TaskPackageAssetSlicePayload],
) -> Result<()> {
    if manifest
        .entries
        .iter()
        .any(|entry| entry.path == MANIFEST_ENTRY)
    {
        return Err(invalid_package(
            "manifest.json must not be listed as a payload entry",
        ));
    }
    let mut expected = BTreeSet::new();
    if manifest.instruction_sha256.is_some() {
        expected.insert(INSTRUCTIONS_ENTRY.to_string());
    }
    match manifest.kind {
        TaskPackageKind::Assignment => {
            if assignments.len() != manifest.documents.len() {
                return Err(invalid_package(
                    "assignment payload document count is invalid",
                ));
            }
            for document in assignments {
                expected.insert(document.source_entry.clone());
                expected.insert(format!(
                    "documents/{}/segments.json",
                    document.origin_document_id
                ));
            }
        }
        TaskPackageKind::Return => {
            for document in returns {
                expected.insert(format!(
                    "documents/{}/return.json",
                    document.origin_document_id
                ));
            }
        }
    }
    if assets.len() != manifest.asset_slices.len() {
        return Err(invalid_package(
            "asset slice payload count does not match the manifest",
        ));
    }
    for (index, reference) in manifest.asset_slices.iter().enumerate() {
        expected.insert(format!(
            "assets/{}/slice-{index:04}.json",
            if reference.kind == "termbase" {
                "tb"
            } else {
                "tm"
            }
        ));
    }
    let actual = payloads.keys().cloned().collect::<BTreeSet<_>>();
    if actual != expected {
        let unknown = actual
            .difference(&expected)
            .next()
            .cloned()
            .unwrap_or_else(|| "missing entry".to_string());
        return Err(invalid_package(format!(
            "task package contains an unknown or unaccounted entry: {unknown}"
        )));
    }
    Ok(())
}

fn parse_document_payloads(
    manifest: &TaskPackageManifest,
    payloads: &BTreeMap<String, Vec<u8>>,
) -> Result<(
    Vec<TaskPackageDocumentPayload>,
    Vec<TaskPackageReturnPayload>,
)> {
    let mut assignments = Vec::new();
    let mut returns = Vec::new();
    for reference in &manifest.documents {
        let prefix = format!("documents/{}/", reference.origin_document_id);
        let candidates = payloads
            .iter()
            .filter(|(path, _)| path.starts_with(&prefix))
            .collect::<Vec<_>>();
        match manifest.kind {
            TaskPackageKind::Assignment => {
                let segments = candidates
                    .iter()
                    .find(|(path, _)| path.ends_with("/segments.json"))
                    .ok_or_else(|| invalid_package("assignment segments entry is missing"))?;
                let payload: TaskPackageDocumentPayload = serde_json::from_slice(segments.1)
                    .map_err(|error| invalid_package(error.to_string()))?;
                if payload.origin_document_id != reference.origin_document_id
                    || payload.source_sha256 != reference.source_sha256
                    || payload.base_revision != reference.base_revision
                    || payload.segments.len() != reference.segment_count as usize
                {
                    return Err(invalid_package(
                        "assignment document payload metadata is invalid",
                    ));
                }
                for projection in &payload.segments {
                    projection.validate().map_err(package_error)?;
                    if projection.origin_document_id != reference.origin_document_id {
                        return Err(invalid_package(
                            "assignment projection document identity is invalid",
                        ));
                    }
                }
                if !payloads.contains_key(&payload.source_entry)
                    || !candidates
                        .iter()
                        .any(|(path, _)| *path == &payload.source_entry)
                {
                    return Err(invalid_package("assignment source entry is missing"));
                }
                let expected_source_entry = format!(
                    "documents/{}/source.{}",
                    reference.origin_document_id,
                    safe_extension(&reference.format)
                );
                if payload.source_entry != expected_source_entry {
                    return Err(invalid_package(
                        "assignment source entry does not match the document identity",
                    ));
                }
                let source_bytes = payloads
                    .get(&payload.source_entry)
                    .ok_or_else(|| invalid_package("assignment source entry is missing"))?;
                if sha256_hex(source_bytes) != reference.source_sha256 {
                    return Err(invalid_package(
                        "assignment source bytes do not match the manifest hash",
                    ));
                }
                assignments.push(payload);
            }
            TaskPackageKind::Return => {
                if let Some((_, bytes)) = candidates
                    .iter()
                    .find(|(path, _)| path.ends_with("/return.json"))
                {
                    let payload: TaskPackageReturnPayload = serde_json::from_slice(bytes)
                        .map_err(|error| invalid_package(error.to_string()))?;
                    if payload.origin_document_id != reference.origin_document_id
                        || payload.source_sha256 != reference.source_sha256
                        || payload.base_revision != reference.base_revision
                    {
                        return Err(invalid_package(
                            "return document payload metadata is invalid",
                        ));
                    }
                    for row in &payload.rows {
                        row.base.validate().map_err(package_error)?;
                        if let Some(remote) = &row.remote {
                            remote.validate().map_err(package_error)?;
                        }
                        if row.base.origin_document_id != reference.origin_document_id {
                            return Err(invalid_package("return row document identity is invalid"));
                        }
                    }
                    returns.push(payload);
                }
            }
        }
    }
    if manifest.kind == TaskPackageKind::Assignment && assignments.len() != manifest.documents.len()
    {
        return Err(invalid_package(
            "assignment payload document count is invalid",
        ));
    }
    Ok((assignments, returns))
}

fn parse_asset_slices(
    manifest: &TaskPackageManifest,
    payloads: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<TaskPackageAssetSlicePayload>> {
    let mut slices = Vec::new();
    let mut total = 0_usize;
    for (path, bytes) in payloads {
        if !path.starts_with("assets/") {
            continue;
        }
        let slice: TaskPackageAssetSlicePayload =
            serde_json::from_slice(bytes).map_err(|error| invalid_package(error.to_string()))?;
        let mut ids = BTreeSet::new();
        for row in &slice.rows {
            if !ids.insert(row.row_id.as_str()) {
                return Err(invalid_package("asset slice contains duplicate row IDs"));
            }
        }
        total = total
            .checked_add(slice.rows.len())
            .ok_or_else(|| invalid_package("asset row count overflow"))?;
        if total > MAX_ASSET_ROWS {
            return Err(resource_limit(
                "asset rows",
                MAX_ASSET_ROWS as u64,
                total as u64,
            ));
        }
        slices.push(slice);
    }
    if slices.len() != manifest.asset_slices.len() {
        return Err(invalid_package(
            "asset slice payload count does not match manifest",
        ));
    }
    for (index, reference) in manifest.asset_slices.iter().enumerate() {
        let expected_path = format!(
            "assets/{}/slice-{index:04}.json",
            if reference.kind == "termbase" {
                "tb"
            } else {
                "tm"
            }
        );
        let Some(bytes) = payloads.get(&expected_path) else {
            return Err(invalid_package(
                "asset slice payload path does not match manifest",
            ));
        };
        let slice: TaskPackageAssetSlicePayload =
            serde_json::from_slice(bytes).map_err(|error| invalid_package(error.to_string()))?;
        if slice.kind != reference.kind
            || slice.library_id != reference.library_id
            || slice.name != reference.name
            || slice.source_locale != reference.source_locale
            || slice.target_locale != reference.target_locale
            || slice.rows.len() != reference.row_count as usize
        {
            return Err(invalid_package(
                "asset slice metadata does not match manifest",
            ));
        }
    }
    Ok(slices)
}

fn package_base_projections(package: &ValidatedTaskPackage) -> Vec<TaskPackageProjection> {
    match package.manifest.kind {
        TaskPackageKind::Assignment => package
            .assignment_documents
            .iter()
            .flat_map(|document| document.segments.iter().cloned())
            .collect(),
        TaskPackageKind::Return => package
            .return_documents
            .iter()
            .flat_map(|document| document.rows.iter().map(|row| row.base.clone()))
            .collect(),
    }
}

fn payload_entries(payloads: &BTreeMap<String, Vec<u8>>) -> Result<Vec<TaskPackageEntry>> {
    payloads
        .iter()
        .map(|(path, bytes)| {
            validate_safe_path(path).map_err(package_error)?;
            let size_bytes = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
            if size_bytes > MAX_ENTRY_BYTES {
                return Err(resource_limit("entry bytes", MAX_ENTRY_BYTES, size_bytes));
            }
            Ok(TaskPackageEntry {
                path: path.clone(),
                size_bytes,
                sha256: sha256_hex(bytes),
            })
        })
        .collect()
}

fn protocol_counts(
    value: translunar_storage::TaskPackagePreviewCounts,
) -> protocol::TaskPackagePreviewCounts {
    protocol::TaskPackagePreviewCounts {
        total: value.total,
        unchanged: value.unchanged,
        remote_changed: value.remote_changed,
        local_changed: value.local_changed,
        both_changed: value.both_changed,
        deleted: value.deleted,
        added: value.added,
        tag_invalid: value.tag_invalid,
        missing_dependency: value.missing_dependency,
        document_revisions: value.document_revisions,
    }
}

fn protocol_diagnostic(value: StorageDiagnostic) -> protocol::TaskPackageDiagnostic {
    protocol::TaskPackageDiagnostic {
        code: value.code,
        message: value.message,
        row_id: value.row_id,
    }
}

fn protocol_preview_row(value: StoragePreviewRow) -> protocol::TaskPackagePreviewRow {
    protocol::TaskPackagePreviewRow {
        row_id: value.row_id,
        ordinal: value.ordinal,
        origin_document_id: value.origin_document_id,
        origin_segment_id: value.origin_segment_id,
        disposition: value.disposition,
        reason: value.reason,
        safe_to_apply: value.safe_to_apply,
        identical_change: value.identical_change,
        selected: value.selected,
        base_hash: value.base_hash,
        current_hash: value.current_hash,
        remote_hash: value.remote_hash,
        current_revision: value.current_revision,
        remote_revision: value.remote_revision,
        base_projection: value.base_projection,
        current_projection: value.current_projection,
        remote_projection: value.remote_projection,
        diagnostic_code: value.diagnostic_code,
    }
}

fn protocol_import_result(
    value: translunar_storage::TaskPackageImportResult,
) -> protocol::TaskPackageImportResult {
    protocol::TaskPackageImportResult {
        package_id: value.package_id,
        preview_id: value.preview_id,
        project: value.project,
        documents: value.documents,
        binding_count: value.binding_count,
    }
}

fn protocol_apply_result(
    value: translunar_storage::TaskPackageApplyResult,
) -> protocol::TaskPackageApplyResult {
    protocol::TaskPackageApplyResult {
        preview_id: value.preview_id,
        status: value.status,
        selected_count: value.selected_count,
        applied_count: value.applied_count,
        skipped_count: value.skipped_count,
        project_revision: value.project_revision,
        document_revisions: value.document_revisions,
        segment_ids: value.segment_ids,
        operation_id: value.operation_id,
    }
}

fn protocol_discard_result(value: StorageDiscardResult) -> protocol::TaskPackageDiscardResult {
    protocol::TaskPackageDiscardResult {
        package_id: value.package_id,
        preview_id: value.preview_id,
        status: value.status,
        removed_staged_file: value.removed_staged_file,
    }
}

fn preview_status_text(value: translunar_storage::TaskPackagePreviewStatus) -> &'static str {
    match value {
        translunar_storage::TaskPackagePreviewStatus::Open => "open",
        translunar_storage::TaskPackagePreviewStatus::Applied => "applied",
        translunar_storage::TaskPackagePreviewStatus::Discarded => "discarded",
    }
}

fn decode_terminal_import_result(
    package: &TaskPackageRecord,
) -> Result<Option<protocol::TaskPackageImportResult>> {
    let Some(json) = package.result_json.as_deref() else {
        return Ok(None);
    };
    let envelope: StoredTaskPackageEnvelope = serde_json::from_str(json).map_err(|error| {
        EngineError::InvalidState(format!("task package result is invalid: {error}"))
    })?;
    let Some(result) = envelope.terminal_result else {
        return Ok(None);
    };
    let result = serde_json::from_value::<translunar_storage::TaskPackageImportResult>(result)
        .map_err(|error| {
            EngineError::InvalidState(format!("task package import result is invalid: {error}"))
        })?;
    Ok(Some(protocol_import_result(result)))
}

fn ensure_same_package(record: &TaskPackageRecord, manifest: &TaskPackageManifest) -> Result<()> {
    if record.id != manifest.package_id
        || record.manifest.manifest_hash != manifest.manifest_hash
        || record.kind != manifest.kind
    {
        return Err(EngineError::InvalidState(
            "task package identity or manifest hash changed".to_string(),
        ));
    }
    Ok(())
}

fn stage_source(
    temporary_root: &Path,
    destination: &Path,
    bytes: &[u8],
    staged: &mut StagedSources,
) -> Result<()> {
    if destination.exists() {
        return Err(EngineError::InvalidState(
            "managed task source destination already exists".to_string(),
        ));
    }
    let mut temporary = NamedTempFile::new_in(temporary_root)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist_noclobber(destination)
        .map_err(|error| EngineError::Io(error.error))?;
    staged.paths.push(destination.to_path_buf());
    Ok(())
}

fn stage_task_package(
    workspace_root: &Path,
    temporary_root: &Path,
    source: &Path,
    expected_manifest_hash: &str,
) -> Result<StagedPackage> {
    let mut input = File::open(source)?;
    let input_size = input.metadata()?.len();
    // The ZIP reader applies the uncompressed limits.  This additional bound
    // prevents an attacker from making the staging copy itself unbounded with
    // a huge central directory or compressed stream.
    if input_size > MAX_PHYSICAL_PACKAGE_BYTES {
        return Err(resource_limit(
            "package bytes",
            MAX_PHYSICAL_PACKAGE_BYTES,
            input_size,
        ));
    }
    let mut temporary = NamedTempFile::with_suffix_in(".tltask", temporary_root)?;
    std::io::copy(&mut input, &mut temporary)?;
    temporary.as_file().sync_all()?;
    let staged_path = temporary.into_temp_path();
    let staged_path_buf = staged_path.to_path_buf();
    let staged = read_validated_task_package(&staged_path_buf)?;
    if staged.manifest.manifest_hash != expected_manifest_hash {
        return Err(invalid_package(
            "staged task package manifest changed during copy",
        ));
    }
    let kept_path = staged_path
        .keep()
        .map_err(|error| EngineError::Io(error.error))?;
    let relative_path = relative_workspace_tmp_path(workspace_root, &kept_path)?;
    Ok(StagedPackage {
        path: kept_path,
        relative_path,
        retain: false,
    })
}

fn relative_workspace_tmp_path(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).map_err(|_| {
        EngineError::InvalidState("task package staging escaped the workspace".to_string())
    })?;
    let value = relative.to_string_lossy().replace('\\', "/");
    validate_safe_path(&value).map_err(package_error)?;
    if !value.starts_with("tmp/") {
        return Err(EngineError::InvalidState(
            "task package preview must be staged under tmp/".to_string(),
        ));
    }
    Ok(value)
}

fn resolve_task_package_path(root: &Path, stored: &str) -> Result<PathBuf> {
    let candidate = Path::new(stored);
    let resolved = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        validate_safe_path(stored).map_err(package_error)?;
        root.join(candidate)
    };
    let canonical_root = fs::canonicalize(root)?;
    let canonical = fs::canonicalize(&resolved)?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err(EngineError::InvalidState(
            "task package path escaped the workspace".to_string(),
        ));
    }
    Ok(canonical)
}

fn read_managed_source(root: &Path, stored: &Path) -> Result<Vec<u8>> {
    let resolved = if stored.is_absolute() {
        stored.to_path_buf()
    } else {
        validate_safe_path(&stored.to_string_lossy()).map_err(package_error)?;
        root.join(stored)
    };
    let canonical_root = fs::canonicalize(root)?;
    let canonical = fs::canonicalize(&resolved)?;
    if !canonical.starts_with(&canonical_root) {
        return Err(EngineError::InvalidState(
            "managed task source escaped the workspace".to_string(),
        ));
    }
    if !canonical.starts_with(canonical_root.join("sources")) {
        return Err(EngineError::InvalidState(
            "managed task source must be under sources/".to_string(),
        ));
    }
    Ok(fs::read(canonical)?)
}

fn relative_workspace_path(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).map_err(|_| {
        EngineError::InvalidState("managed task source escaped the workspace".to_string())
    })?;
    let value = relative.to_string_lossy().replace('\\', "/");
    validate_safe_path(&value).map_err(package_error)?;
    if !value.starts_with("sources/") {
        return Err(EngineError::InvalidState(
            "managed task source must be under sources/".to_string(),
        ));
    }
    Ok(value)
}

fn package_destination(value: &str) -> Result<PathBuf> {
    if value.trim().is_empty() {
        return Err(EngineError::InvalidRequest(
            "destinationPath must not be empty".to_string(),
        ));
    }
    let destination = PathBuf::from(value);
    if destination.is_dir() {
        return Err(EngineError::InvalidRequest(
            "destinationPath must name a .tltask file".to_string(),
        ));
    }
    let valid_extension = destination
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("tltask"));
    if !valid_extension {
        return Err(EngineError::InvalidRequest(
            "destinationPath must use the .tltask extension".to_string(),
        ));
    }
    Ok(destination)
}

fn validate_export_params(params: &protocol::TaskPackageExportParams) -> Result<()> {
    match params.kind {
        TaskPackageKind::Assignment => {
            if params.working_project_id.is_some() || params.parent_package_id.is_some() {
                return Err(EngineError::InvalidRequest(
                    "assignment export cannot include workingProjectId or parentPackageId"
                        .to_string(),
                ));
            }
            if params.documents.is_empty() {
                return Err(EngineError::InvalidRequest(
                    "assignment export must select at least one document".to_string(),
                ));
            }
        }
        TaskPackageKind::Return => {
            if params.project_id.is_some()
                || params.expected_project_revision.is_some()
                || !params.documents.is_empty()
                || !params.asset_slices.is_empty()
            {
                return Err(EngineError::InvalidRequest(
                    "return export accepts only workingProjectId and parentPackageId as its source"
                        .to_string(),
                ));
            }
            if params.working_project_id.is_none() || params.parent_package_id.is_none() {
                return Err(EngineError::InvalidRequest(
                    "return export requires workingProjectId and parentPackageId".to_string(),
                ));
            }
        }
    }
    Ok(())
}

fn required_string(value: Option<&str>, field: &str) -> Result<String> {
    let value = value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| EngineError::InvalidRequest(format!("{field} is required")))?;
    Ok(value.to_string())
}

fn validate_actor_reason(actor: &str, reason: &str) -> Result<()> {
    // The actor is carried in the package manifest across machines and stays
    // required; a reason is optional context.
    if actor.trim().is_empty() {
        return Err(EngineError::InvalidRequest("actor is required".to_string()));
    }
    if actor.len() > MAX_ACTOR_BYTES || reason.len() > MAX_REASON_BYTES {
        return Err(resource_limit(
            "actor or reason bytes",
            MAX_REASON_BYTES as u64,
            actor.len().max(reason.len()) as u64,
        ));
    }
    Ok(())
}

fn validate_zip_path(path: &str) -> Result<()> {
    validate_safe_path(path).map_err(package_error)?;
    if path.split('/').count() > MAX_PATH_DEPTH {
        return Err(invalid_package("task package path depth exceeds the limit"));
    }
    Ok(())
}

fn contains_zip64_extra(extra: Option<&[u8]>) -> bool {
    let Some(extra) = extra else {
        return false;
    };
    let mut offset = 0_usize;
    while offset + 4 <= extra.len() {
        let id = u16::from_le_bytes([extra[offset], extra[offset + 1]]);
        let size = usize::from(u16::from_le_bytes([extra[offset + 2], extra[offset + 3]]));
        if id == 0x0001 {
            return true;
        }
        offset = match offset.checked_add(4 + size) {
            Some(value) if value <= extra.len() => value,
            _ => break,
        };
    }
    false
}

fn raw_entry_contains_zip64_extra(
    file: &mut File,
    local_header_start: u64,
    central_header_start: u64,
) -> Result<bool> {
    let local = read_raw_zip_extra(file, local_header_start, false)?;
    if contains_zip64_extra(Some(&local)) {
        return Ok(true);
    }
    let central = read_raw_zip_extra(file, central_header_start, true)?;
    Ok(contains_zip64_extra(Some(&central)))
}

fn read_raw_zip_extra(file: &mut File, header_start: u64, central: bool) -> Result<Vec<u8>> {
    const LOCAL_SIGNATURE: [u8; 4] = [0x50, 0x4b, 0x03, 0x04];
    const CENTRAL_SIGNATURE: [u8; 4] = [0x50, 0x4b, 0x01, 0x02];
    let header_len = if central { 46 } else { 30 };
    let mut header = vec![0_u8; header_len];
    file.seek(SeekFrom::Start(header_start))?;
    file.read_exact(&mut header)
        .map_err(|error| invalid_package(error.to_string()))?;
    let expected = if central {
        CENTRAL_SIGNATURE
    } else {
        LOCAL_SIGNATURE
    };
    if header[..4] != expected {
        return Err(invalid_package(
            "task package ZIP header signature is invalid",
        ));
    }
    let (name_offset, extra_offset) = if central { (28, 30) } else { (26, 28) };
    let name_len = u64::from(u16::from_le_bytes([
        header[name_offset],
        header[name_offset + 1],
    ]));
    let extra_len = usize::from(u16::from_le_bytes([
        header[extra_offset],
        header[extra_offset + 1],
    ]));
    file.seek(SeekFrom::Current(name_len as i64))?;
    let mut extra = vec![0_u8; extra_len];
    file.read_exact(&mut extra)
        .map_err(|error| invalid_package(error.to_string()))?;
    Ok(extra)
}

fn source_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("source")
        .to_string()
}

fn safe_extension(value: &str) -> String {
    let value = value.trim().trim_start_matches('.');
    let filtered = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>();
    if filtered.is_empty() {
        "source".to_string()
    } else {
        filtered
    }
}

fn filter_id_for_format(format: &str) -> String {
    if format.starts_with("builtin.") {
        format.to_string()
    } else {
        format!("builtin.{}", safe_extension(format))
    }
}

fn asset_entry_path(index: usize, slice: &TaskPackageAssetSlicePayload) -> String {
    format!(
        "assets/{}/slice-{:04}.json",
        if slice.kind == "termbase" { "tb" } else { "tm" },
        index
    )
}

fn select_asset_ids<'a>(
    requested: &[String],
    available: impl IntoIterator<Item = &'a str>,
) -> Result<BTreeSet<String>> {
    let available = available.into_iter().collect::<BTreeSet<_>>();
    let requested_set = requested.iter().cloned().collect::<BTreeSet<_>>();
    if requested_set.len() != requested.len() {
        return Err(EngineError::InvalidRequest(
            "asset slice selection contains duplicate row IDs".to_string(),
        ));
    }
    if requested_set
        .iter()
        .any(|id| !available.contains(id.as_str()))
    {
        return Err(EngineError::InvalidRequest(
            "asset slice selection names an unknown row".to_string(),
        ));
    }
    Ok(requested_set)
}

fn tm_asset_row(unit: TmUnit) -> Result<TaskPackageAssetRow> {
    Ok(TaskPackageAssetRow {
        row_id: unit.id,
        source_text: unit.source_text,
        target_text: unit.target_text,
        metadata_json: serde_json::to_string(&unit.metadata)
            .map_err(|error| EngineError::InvalidState(error.to_string()))?,
        provenance_json: serde_json::to_string(&serde_json::json!({
            "originProjectId": unit.origin_project_id,
            "originDocumentId": unit.origin_document_id,
            "originSegmentId": unit.origin_segment_id,
            "author": unit.author,
            "createdAtMs": unit.created_at_ms,
        }))
        .map_err(|error| EngineError::InvalidState(error.to_string()))?,
    })
}

fn term_asset_row(
    entry: &TermEntry,
    translation: translunar_asset_core::TermTranslation,
) -> Result<TaskPackageAssetRow> {
    let translation_id = translation.id.clone();
    let target_text = translation.term.clone();
    let preferred = translation.preferred;
    let forbidden = translation.forbidden;
    Ok(TaskPackageAssetRow {
        row_id: translation_id.clone(),
        source_text: entry.source_term.clone(),
        target_text,
        metadata_json: serde_json::to_string(&serde_json::json!({
            "entryId": entry.id,
            "status": entry.status,
            "partOfSpeech": entry.part_of_speech,
            "definition": entry.definition,
            "example": entry.example,
            "preferred": preferred,
            "forbidden": forbidden,
        }))
        .map_err(|error| EngineError::InvalidState(error.to_string()))?,
        provenance_json: serde_json::to_string(&serde_json::json!({
            "entryId": entry.id,
            "translationId": translation_id,
        }))
        .map_err(|error| EngineError::InvalidState(error.to_string()))?,
    })
}

fn sha256_path(path: &Path) -> Result<String> {
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

fn invalid_package(message: impl Into<String>) -> EngineError {
    EngineError::TaskPackage(TaskPackageError::InvalidPackage(message.into()))
}

fn package_error(error: TaskPackageError) -> EngineError {
    EngineError::TaskPackage(error)
}

fn resource_limit(resource: &'static str, limit: u64, actual: u64) -> EngineError {
    EngineError::TaskPackage(TaskPackageError::ResourceLimit {
        resource,
        limit,
        actual,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn projection() -> TaskPackageProjection {
        TaskPackageProjection {
            origin_document_id: "doc-1".to_string(),
            origin_segment_id: "segment-1".to_string(),
            ordinal: 0,
            structural_path: "txt:0".to_string(),
            source_hash: sha256_hex(b"Source"),
            base_revision: 0,
            source_text: "Source".to_string(),
            target_text: String::new(),
            segment_state: "untranslated".to_string(),
            tags_json: r#"{"source":[],"target":[]}"#.to_string(),
            workflow_state: "translation".to_string(),
            comments_json: "[]".to_string(),
            projection_hash: String::new(),
        }
        .with_computed_hash()
        .expect("valid projection")
    }

    fn assignment_bundle() -> (TaskPackageManifest, PackagePayloads) {
        let source_entry = "documents/doc-1/source.txt".to_string();
        let document = TaskPackageDocumentPayload {
            origin_document_id: "doc-1".to_string(),
            source_sha256: sha256_hex(b"Source"),
            base_revision: 0,
            source_entry: source_entry.clone(),
            segments: vec![projection()],
        };
        let mut payloads = PackagePayloads::new();
        payloads.insert(source_entry, b"Source".to_vec());
        payloads.insert(
            "documents/doc-1/segments.json".to_string(),
            canonical_json(&document).expect("canonical document"),
        );
        let manifest = build_manifest(
            "package-1",
            TaskPackageKind::Assignment,
            "project-1",
            "Project",
            "en",
            "zh",
            0,
            None,
            "Translate these rows",
            vec![TaskPackageDocumentRef {
                origin_document_id: "doc-1".to_string(),
                name: "source.txt".to_string(),
                format: "txt".to_string(),
                source_sha256: sha256_hex(b"Source"),
                base_revision: 0,
                segment_count: 1,
            }],
            Vec::new(),
            &mut payloads,
        )
        .expect("valid manifest");
        (manifest, payloads)
    }

    fn refresh_manifest(manifest: &mut TaskPackageManifest, payloads: &PackagePayloads) {
        manifest.entries = payload_entries(payloads).expect("payload metadata");
        manifest.manifest_hash = manifest.digest().expect("manifest digest");
        manifest.validate().expect("valid refreshed manifest");
    }

    fn write_package(
        path: &Path,
        manifest: &TaskPackageManifest,
        payloads: &PackagePayloads,
        options: SimpleFileOptions,
    ) {
        let file = File::create(path).expect("create package");
        let mut writer = ZipWriter::new(file);
        for (name, bytes) in payloads {
            writer.start_file(name, options).expect("start payload");
            writer.write_all(bytes).expect("write payload");
        }
        writer
            .start_file(MANIFEST_ENTRY, options)
            .expect("start manifest");
        writer
            .write_all(&canonical_json(manifest).expect("canonical manifest"))
            .expect("write manifest");
        writer.finish().expect("finish package");
    }

    fn default_options() -> SimpleFileOptions {
        SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
    }

    #[test]
    fn valid_assignment_package_round_trips_and_stages_under_tmp() {
        let root = tempdir().expect("workspace");
        let temporary = root.path().join("tmp");
        fs::create_dir(&temporary).expect("tmp directory");
        let source = root.path().join("assignment.tltask");
        let (manifest, payloads) = assignment_bundle();
        write_package(&source, &manifest, &payloads, default_options());

        let parsed = read_validated_task_package(&source).expect("valid package");
        assert_eq!(parsed.manifest.manifest_hash, manifest.manifest_hash);
        let staged = stage_task_package(root.path(), &temporary, &source, &manifest.manifest_hash)
            .expect("stage package");
        assert!(staged.relative_path.starts_with("tmp/"));
        assert!(staged.path.is_file());
        let staged_path = staged.path.clone();
        drop(staged);
        assert!(!staged_path.exists());
    }

    #[test]
    fn noncanonical_json_and_unknown_entries_are_rejected() {
        let root = tempdir().expect("workspace");
        let path = root.path().join("noncanonical.tltask");
        let (mut manifest, mut payloads) = assignment_bundle();
        let document: Value = serde_json::from_slice(
            payloads
                .get("documents/doc-1/segments.json")
                .expect("segments"),
        )
        .expect("document JSON");
        payloads.insert(
            "documents/doc-1/segments.json".to_string(),
            serde_json::to_string_pretty(&document)
                .expect("pretty JSON")
                .into_bytes(),
        );
        refresh_manifest(&mut manifest, &payloads);
        write_package(&path, &manifest, &payloads, default_options());
        assert!(read_validated_task_package(&path).is_err());

        let unknown_path = root.path().join("unknown.tltask");
        let (mut manifest, mut payloads) = assignment_bundle();
        payloads.insert("unexpected.txt".to_string(), b"unexpected".to_vec());
        refresh_manifest(&mut manifest, &payloads);
        write_package(&unknown_path, &manifest, &payloads, default_options());
        assert!(read_validated_task_package(&unknown_path).is_err());
    }

    #[test]
    fn hash_tamper_duplicate_and_traversal_entries_are_rejected() {
        let root = tempdir().expect("workspace");
        let (manifest, mut payloads) = assignment_bundle();
        payloads.insert(
            "documents/doc-1/source.txt".to_string(),
            b"Tampered".to_vec(),
        );
        let tampered = root.path().join("tampered.tltask");
        write_package(&tampered, &manifest, &payloads, default_options());
        assert!(read_validated_task_package(&tampered).is_err());

        let (_manifest, payloads) = assignment_bundle();
        let duplicate = root.path().join("duplicate.tltask");
        let file = File::create(&duplicate).expect("duplicate package");
        let mut writer = ZipWriter::new(file);
        for (name, bytes) in &payloads {
            writer
                .start_file(name, default_options())
                .expect("start payload");
            writer.write_all(bytes).expect("write payload");
        }
        assert!(
            writer
                .start_file(INSTRUCTIONS_ENTRY, default_options())
                .is_err()
        );
        writer.finish().expect("finish duplicate package");
        assert!(read_validated_task_package(&duplicate).is_err());

        let central_duplicate = root.path().join("central-duplicate.tltask");
        write_package(
            &central_duplicate,
            &manifest,
            &payloads,
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
        );
        let bytes = fs::read(&central_duplicate).expect("read central duplicate source");
        let eocd = bytes
            .windows(4)
            .rposition(|window| window == [0x50, 0x4b, 0x05, 0x06])
            .expect("EOCD");
        let central_offset = usize::try_from(u32::from_le_bytes([
            bytes[eocd + 16],
            bytes[eocd + 17],
            bytes[eocd + 18],
            bytes[eocd + 19],
        ]))
        .expect("central offset");
        let name_len = usize::from(u16::from_le_bytes([
            bytes[central_offset + 28],
            bytes[central_offset + 29],
        ]));
        let extra_len = usize::from(u16::from_le_bytes([
            bytes[central_offset + 30],
            bytes[central_offset + 31],
        ]));
        let comment_len = usize::from(u16::from_le_bytes([
            bytes[central_offset + 32],
            bytes[central_offset + 33],
        ]));
        let record_len = 46 + name_len + extra_len + comment_len;
        let central_record = bytes[central_offset..central_offset + record_len].to_vec();
        let mut duplicate_bytes = Vec::with_capacity(bytes.len() + record_len);
        duplicate_bytes.extend_from_slice(&bytes[..eocd]);
        duplicate_bytes.extend_from_slice(&central_record);
        duplicate_bytes.extend_from_slice(&bytes[eocd..]);
        let duplicate_eocd = eocd + record_len;
        let count = u16::from_le_bytes([
            duplicate_bytes[duplicate_eocd + 10],
            duplicate_bytes[duplicate_eocd + 11],
        ])
        .checked_add(1)
        .expect("duplicate count");
        duplicate_bytes[duplicate_eocd + 8..duplicate_eocd + 10]
            .copy_from_slice(&count.to_le_bytes());
        duplicate_bytes[duplicate_eocd + 10..duplicate_eocd + 12]
            .copy_from_slice(&count.to_le_bytes());
        let central_size = u32::from_le_bytes([
            duplicate_bytes[duplicate_eocd + 12],
            duplicate_bytes[duplicate_eocd + 13],
            duplicate_bytes[duplicate_eocd + 14],
            duplicate_bytes[duplicate_eocd + 15],
        ])
        .checked_add(u32::try_from(record_len).expect("record length"))
        .expect("central size");
        duplicate_bytes[duplicate_eocd + 12..duplicate_eocd + 16]
            .copy_from_slice(&central_size.to_le_bytes());
        fs::write(&central_duplicate, duplicate_bytes).expect("write central duplicate");
        assert!(read_validated_task_package(&central_duplicate).is_err());

        let traversal = root.path().join("traversal.tltask");
        let file = File::create(&traversal).expect("traversal package");
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("../manifest.json", default_options())
            .expect("traversal entry");
        writer.write_all(b"{}").expect("traversal bytes");
        writer.finish().expect("finish traversal package");
        assert!(read_validated_task_package(&traversal).is_err());
    }

    #[test]
    fn zip64_entry_and_footer_records_are_rejected() {
        let root = tempdir().expect("workspace");
        let (manifest, payloads) = assignment_bundle();
        let zip64_entry = root.path().join("zip64-entry.tltask");
        write_package(
            &zip64_entry,
            &manifest,
            &payloads,
            default_options().large_file(true),
        );
        assert!(read_validated_task_package(&zip64_entry).is_err());

        let zip64_footer = root.path().join("zip64-footer.tltask");
        write_package(&zip64_footer, &manifest, &payloads, default_options());
        let bytes = fs::read(&zip64_footer).expect("read package");
        let eocd = bytes
            .windows(4)
            .rposition(|window| window == [0x50, 0x4b, 0x05, 0x06])
            .expect("EOCD");
        let mut modified = Vec::with_capacity(bytes.len() + 20);
        modified.extend_from_slice(&bytes[..eocd]);
        modified.extend_from_slice(&[0x50, 0x4b, 0x06, 0x07]);
        modified.extend_from_slice(&[0_u8; 16]);
        modified.extend_from_slice(&bytes[eocd..]);
        fs::write(&zip64_footer, modified).expect("write ZIP64 locator");
        assert!(read_validated_task_package(&zip64_footer).is_err());
    }

    #[test]
    fn excessive_compression_and_existing_destination_are_rejected() {
        let root = tempdir().expect("workspace");
        let bomb = root.path().join("bomb.tltask");
        let file = File::create(&bomb).expect("bomb package");
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("payload.bin", default_options())
            .expect("bomb entry");
        writer
            .write_all(&vec![0_u8; 8 * 1024 * 1024])
            .expect("bomb bytes");
        writer.finish().expect("finish bomb");
        assert!(read_validated_task_package(&bomb).is_err());

        let destination = root.path().join("existing.tltask");
        fs::write(&destination, b"existing").expect("existing destination");
        let (manifest, payloads) = assignment_bundle();
        assert!(publish_task_package(&destination, &manifest, &payloads).is_err());
        assert_eq!(fs::read(&destination).expect("existing bytes"), b"existing");
    }

    #[test]
    fn export_fields_and_extension_are_strictly_partitioned() {
        let assignment = protocol::TaskPackageExportParams {
            kind: TaskPackageKind::Assignment,
            destination_path: "assignment.tltask".to_string(),
            project_id: Some("project-1".to_string()),
            expected_project_revision: Some(0),
            documents: vec![protocol::TaskPackageDocumentSelection {
                document_id: "doc-1".to_string(),
                segment_ids: Vec::new(),
            }],
            asset_slices: Vec::new(),
            instructions: String::new(),
            working_project_id: None,
            parent_package_id: None,
            actor: "owner".to_string(),
            reason: "handoff".to_string(),
        };
        validate_export_params(&assignment).expect("assignment fields");
        assert!(package_destination(&assignment.destination_path).is_ok());
        let mut mixed = assignment;
        mixed.parent_package_id = Some("parent".to_string());
        assert!(validate_export_params(&mixed).is_err());
        assert!(package_destination("assignment.zip").is_err());
    }

    #[test]
    fn stored_import_envelope_uses_storage_snake_case() {
        let envelope: StoredTaskPackageEnvelope = serde_json::from_str(
            r#"{"base_projections":[],"terminal_result":{"packageId":"package-1"}}"#,
        )
        .expect("storage envelope");
        assert!(envelope.terminal_result.is_some());
    }

    #[test]
    fn assignment_return_flow_survives_restart_and_replays_idempotently() {
        let owner_root = tempdir().expect("owner workspace");
        let recipient_root = tempdir().expect("recipient workspace");
        let source = owner_root.path().join("handoff.txt");
        fs::write(&source, "Offline source").expect("write source");

        let mut owner = EngineService::open(owner_root.path()).expect("open owner engine");
        let project = owner
            .create_project(protocol::CreateProjectParams {
                name: "Offline owner".to_string(),
                source_locale: "en".to_string(),
                target_locale: "zh".to_string(),
                domain: "general".to_string(),
            })
            .expect("create owner project");
        let imported = owner
            .import_document(protocol::ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: source.to_string_lossy().into_owned(),
                relative_path: Some("handoff.txt".to_string()),
                filter_id: Some("builtin.txt".to_string()),
                options: BTreeMap::new(),
            })
            .expect("import owner source");
        let owner_snapshot = owner
            .get_project(&project.id)
            .expect("owner snapshot after import");
        let assignment_path = owner_root.path().join("assignment.tltask");
        let assignment = owner
            .export_task_package(protocol::TaskPackageExportParams {
                kind: TaskPackageKind::Assignment,
                destination_path: assignment_path.to_string_lossy().into_owned(),
                project_id: Some(project.id.clone()),
                expected_project_revision: Some(owner_snapshot.project.revision),
                documents: vec![protocol::TaskPackageDocumentSelection {
                    document_id: imported.document.id.clone(),
                    segment_ids: Vec::new(),
                }],
                asset_slices: Vec::new(),
                instructions: "Translate this bounded handoff".to_string(),
                working_project_id: None,
                parent_package_id: None,
                actor: "owner".to_string(),
                reason: "offline assignment".to_string(),
            })
            .expect("export assignment");
        assert_eq!(assignment.kind, TaskPackageKind::Assignment);
        assert!(assignment_path.is_file());

        let mut recipient = EngineService::open(recipient_root.path()).expect("open recipient");
        let assignment_preview = recipient
            .preview_task_package(protocol::TaskPackagePreviewParams {
                package_path: Some(assignment_path.to_string_lossy().into_owned()),
                preview_id: None,
                offset: 0,
                limit: 50,
                actor: "recipient".to_string(),
                reason: "inspect assignment".to_string(),
            })
            .expect("preview assignment");
        assert_eq!(assignment_preview.kind, TaskPackageKind::Assignment);
        assert_eq!(assignment_preview.counts.total, 1);
        let imported_task = recipient
            .import_task_package(protocol::TaskPackageImportParams {
                preview_id: assignment_preview.preview_id.clone(),
                project_name: Some("Detached handoff".to_string()),
                domain: Some("general".to_string()),
                actor: "recipient".to_string(),
                reason: "start detached task".to_string(),
            })
            .expect("import assignment");
        let imported_replay = recipient
            .import_task_package(protocol::TaskPackageImportParams {
                preview_id: assignment_preview.preview_id.clone(),
                project_name: Some("Detached handoff".to_string()),
                domain: Some("general".to_string()),
                actor: "recipient".to_string(),
                reason: "start detached task".to_string(),
            })
            .expect("replay assignment import");
        assert_eq!(imported_replay.project.id, imported_task.project.id);

        drop(recipient);
        let mut recipient = EngineService::open(recipient_root.path()).expect("restart recipient");
        let detached_snapshot = recipient
            .get_project(&imported_task.project.id)
            .expect("detached snapshot");
        let detached_segment = recipient
            .list_segments(protocol::SegmentListParams {
                document_id: detached_snapshot.documents[0].id.clone(),
                offset: 0,
                limit: 50,
            })
            .expect("detached segments")
            .items
            .into_iter()
            .next()
            .expect("detached row");
        let updated = recipient
            .update_target(protocol::UpdateTargetParams {
                segment_id: detached_segment.id,
                target_text: "离线译文".to_string(),
                expected_revision: detached_segment.revision,
            })
            .expect("edit detached row");
        assert_eq!(updated.target_text, "离线译文");

        let return_path = recipient_root.path().join("return.tltask");
        let returned = recipient
            .export_task_package(protocol::TaskPackageExportParams {
                kind: TaskPackageKind::Return,
                destination_path: return_path.to_string_lossy().into_owned(),
                project_id: None,
                expected_project_revision: None,
                documents: Vec::new(),
                asset_slices: Vec::new(),
                instructions: "Completed detached edit".to_string(),
                working_project_id: Some(imported_task.project.id.clone()),
                parent_package_id: Some(assignment.package_id.clone()),
                actor: "recipient".to_string(),
                reason: "return completed task".to_string(),
            })
            .expect("export return");
        assert_eq!(returned.kind, TaskPackageKind::Return);

        let return_preview = owner
            .preview_task_package(protocol::TaskPackagePreviewParams {
                package_path: Some(return_path.to_string_lossy().into_owned()),
                preview_id: None,
                offset: 0,
                limit: 50,
                actor: "owner".to_string(),
                reason: "inspect returned task".to_string(),
            })
            .expect("preview return");
        assert_eq!(return_preview.counts.remote_changed, 1);
        let row = return_preview
            .rows
            .iter()
            .find(|row| {
                row.disposition
                    == translunar_task_package_core::TaskPackageDisposition::RemoteChanged
            })
            .expect("remote changed row");
        let selected = vec![row.row_id.clone()];
        let apply_params = protocol::TaskPackageApplyParams {
            preview_id: return_preview.preview_id.clone(),
            expected_project_revision: return_preview.expected_project_revision,
            selected_row_ids: selected.clone(),
            actor: "owner".to_string(),
            reason: "merge detached edit".to_string(),
        };
        let applied = owner
            .apply_task_package(apply_params.clone())
            .expect("apply returned edit");
        assert_eq!(applied.applied_count, 1);
        let owner_after_apply = owner.get_project(&project.id).expect("owner after apply");
        let owner_segment = owner
            .list_segments(protocol::SegmentListParams {
                document_id: owner_after_apply.documents[0].id.clone(),
                offset: 0,
                limit: 50,
            })
            .expect("owner segments")
            .items
            .into_iter()
            .next()
            .expect("owner row");
        assert_eq!(owner_segment.target_text, "离线译文");

        drop(owner);
        let mut owner = EngineService::open(owner_root.path()).expect("restart owner");
        let replay = owner
            .apply_task_package(apply_params)
            .expect("replay applied return");
        assert_eq!(replay.operation_id, applied.operation_id);
        let no_clobber = owner.export_task_package(protocol::TaskPackageExportParams {
            kind: TaskPackageKind::Assignment,
            destination_path: assignment_path.to_string_lossy().into_owned(),
            project_id: Some(project.id),
            expected_project_revision: Some(
                owner
                    .get_project(&imported.document.project_id)
                    .expect("owner project")
                    .project
                    .revision,
            ),
            documents: vec![protocol::TaskPackageDocumentSelection {
                document_id: imported.document.id,
                segment_ids: Vec::new(),
            }],
            asset_slices: Vec::new(),
            instructions: String::new(),
            working_project_id: None,
            parent_package_id: None,
            actor: "owner".to_string(),
            reason: "no-clobber retry".to_string(),
        });
        assert!(no_clobber.is_err());
    }
}
