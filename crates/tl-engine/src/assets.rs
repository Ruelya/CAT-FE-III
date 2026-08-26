//! Translation-memory and terminology operations.
//!
//! Fuzzy TM lookup is recall + rerank: the per-memory [`TmIndex`] returns
//! every entry whose provable score ceiling reaches the requested floor (no
//! hidden candidate cap), and `tl_asset::match_score` reranks the survivors.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write as _;
use std::path::Path;

use tl_asset::{
    TermEntry, TermExchangeEntry, TermExchangeTranslation, TermMatch, TermStatus, TermTranslation,
    Termbase, TermbaseMount, TmExchangeUnit, match_score, normalize_match_key, term_spans,
};
use tl_domain::{
    Segment, SegmentOrigin, SegmentOriginKind, SegmentState, TmEntry, new_id, normalize_text,
    sha256_hex,
};
use tl_protocol::{
    TM_LIST_DEFAULT_LIMIT, TM_LIST_MAX_LIMIT, TM_LOOKUP_DEFAULT_LIMIT, TM_LOOKUP_DEFAULT_MIN_SCORE,
    TM_LOOKUP_MAX_LIMIT, TM_PRETRANSLATE_DEFAULT_MIN_SCORE, TermAddParams, TermAddResult,
    TermDeleteParams, TermDeleteResult, TermExchangeFormat, TermListParams, TermListResult,
    TermLookupParams, TermLookupResult, TermUpdateParams, TermUpdateResult, TermbaseAttachParams,
    TermbaseAttachResult, TermbaseCreateParams, TermbaseDetachParams, TermbaseDetachResult,
    TermbaseExportParams, TermbaseExportResult, TermbaseImportParams, TermbaseImportResult,
    TermbaseListParams, TermbaseListResult, TmDeleteParams, TmDeleteResult, TmExchangeFormat,
    TmExportParams, TmExportResult, TmImportParams, TmImportResult, TmListParams, TmListResult,
    TmLookupParams, TmLookupResult, TmMatchGrade, TmMatchItem, TmPretranslateParams,
    TmPretranslateResult, TmUpdateParams, TmUpdateResult,
};

use crate::store::StateDelta;
use crate::{Engine, EngineError, now_ms};

impl Engine {
    pub(crate) fn project_memory_id(project_id: &str) -> String {
        format!("tm-{project_id}")
    }

    /// Insert or refresh the TM entry for one normalized source in a memory.
    /// Returns the entry and whether it was newly added.
    ///
    /// Existing entries are resolved by a point query on the store's unique
    /// `(memory_id, source_hash)` index — there is no RAM copy of the TM
    /// table to consult. `pending` collects the rows of one logical batch
    /// (a whole `tm.import` file, or a single confirm): it keeps repeated
    /// sources inside a batch upserting the same row before anything is
    /// committed, and the caller persists its values in one transaction.
    #[expect(clippy::too_many_arguments, reason = "internal upsert plumbing")]
    pub(crate) fn upsert_tm_entry(
        &mut self,
        pending: &mut BTreeMap<(String, String), TmEntry>,
        memory_id: &str,
        project_id: &str,
        source_text: &str,
        target_text: &str,
        source_hash: &str,
        origin_document_id: &str,
        origin_segment_id: &str,
        now: i64,
    ) -> Result<(TmEntry, bool), EngineError> {
        let key = (memory_id.to_string(), source_hash.to_string());
        if let Some(entry) = pending.get_mut(&key) {
            entry.target_text = target_text.to_string();
            entry.origin_document_id = origin_document_id.to_string();
            entry.origin_segment_id = origin_segment_id.to_string();
            entry.confirmed_at_ms = now;
            return Ok((entry.clone(), false));
        }
        if let Some(mut entry) = self.store.tm_entry_by_source(memory_id, source_hash)? {
            entry.target_text = target_text.to_string();
            entry.origin_document_id = origin_document_id.to_string();
            entry.origin_segment_id = origin_segment_id.to_string();
            entry.confirmed_at_ms = now;
            pending.insert(key, entry.clone());
            return Ok((entry, false));
        }
        let entry = TmEntry {
            id: new_id(),
            memory_id: memory_id.to_string(),
            source_text: source_text.to_string(),
            target_text: target_text.to_string(),
            source_hash: source_hash.to_string(),
            origin_project_id: project_id.to_string(),
            origin_document_id: origin_document_id.to_string(),
            origin_segment_id: origin_segment_id.to_string(),
            confirmed_at_ms: now,
        };
        self.tm_indexes
            .entry(memory_id.to_string())
            .or_default()
            .insert(&entry.id, &entry.source_text);
        pending.insert(key, entry.clone());
        Ok((entry, true))
    }

    /// Exact + fuzzy matches for one source text against one memory, sorted
    /// by score, then recency, then id. `total` is the pre-limit count.
    ///
    /// The exact hit is a SQL point query; fuzzy recall walks the in-memory
    /// token index for candidate ids and fetches only those rows from SQL.
    pub(crate) fn tm_matches(
        &self,
        memory_id: &str,
        source_text: &str,
        min_score: u8,
        limit: usize,
    ) -> Result<(Vec<TmMatchItem>, u32), EngineError> {
        let hash = sha256_hex(normalize_text(source_text).as_bytes());
        let mut matches: Vec<TmMatchItem> = Vec::new();
        if let Some(entry) = self.store.tm_entry_by_source(memory_id, &hash)? {
            matches.push(TmMatchItem {
                entry,
                score: 100,
                grade: TmMatchGrade::Exact,
            });
        }
        if let Some(index) = self.tm_indexes.get(memory_id) {
            for entry_id in index.recall(source_text, min_score) {
                let Some(entry) = self.store.tm_entry(&entry_id)? else {
                    continue; // Index ahead of a failed write; row absent.
                };
                if entry.source_hash == hash {
                    continue; // Already reported as exact.
                }
                let score = match_score(source_text, &entry.source_text).score;
                if score >= min_score {
                    matches.push(TmMatchItem {
                        entry,
                        score,
                        grade: TmMatchGrade::Fuzzy,
                    });
                }
            }
        }
        matches.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then(right.entry.confirmed_at_ms.cmp(&left.entry.confirmed_at_ms))
                .then(left.entry.id.cmp(&right.entry.id))
        });
        let total = u32::try_from(matches.len()).unwrap_or(u32::MAX);
        matches.truncate(limit);
        Ok((matches, total))
    }

    pub(crate) fn tm_lookup(&self, params: TmLookupParams) -> Result<TmLookupResult, EngineError> {
        self.require_project(&params.project_id)?;
        let min_score = validate_min_score(params.min_score, TM_LOOKUP_DEFAULT_MIN_SCORE)?;
        let limit = match params.limit {
            None => TM_LOOKUP_DEFAULT_LIMIT,
            Some(0) => {
                return Err(EngineError::InvalidParams(
                    "limit must be at least 1".to_string(),
                ));
            }
            Some(value) => value.min(TM_LOOKUP_MAX_LIMIT),
        };
        let memory_id = Self::project_memory_id(&params.project_id);
        let (matches, total_matches) =
            self.tm_matches(&memory_id, &params.source_text, min_score, limit as usize)?;
        Ok(TmLookupResult {
            matches,
            total_matches,
        })
    }

    /// One page of a project's TM entries straight from SQL, newest
    /// confirmation first, with an optional case-insensitive substring
    /// filter over source and target. No RAM copy of the TM table backs
    /// this; the page is the only transfer.
    pub(crate) fn tm_list(&self, params: TmListParams) -> Result<TmListResult, EngineError> {
        self.require_project(&params.project_id)?;
        let limit = match params.limit {
            None => TM_LIST_DEFAULT_LIMIT,
            Some(0) => {
                return Err(EngineError::InvalidParams(
                    "limit must be at least 1".to_string(),
                ));
            }
            Some(value) => value.min(TM_LIST_MAX_LIMIT),
        };
        let query = params
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let memory_id = Self::project_memory_id(&params.project_id);
        let entries =
            self.store
                .tm_entries_page(&memory_id, query, params.offset.unwrap_or(0), limit)?;
        let total = self.store.tm_entry_count(&memory_id, query)?;
        Ok(TmListResult { entries, total })
    }

    /// Edit one TM entry's source and target text. A changed source re-keys
    /// the entry (hash + fuzzy index) so lookup, pretranslation, and the
    /// confirm-time upsert all see the edited text. The row is fetched from
    /// SQL, mutated, and persisted — no RAM copy of the TM table exists.
    pub(crate) fn tm_update(
        &mut self,
        params: TmUpdateParams,
    ) -> Result<TmUpdateResult, EngineError> {
        let source_text = params.source_text.trim().to_string();
        let target_text = params.target_text.trim().to_string();
        if source_text.is_empty() || target_text.is_empty() {
            return Err(EngineError::InvalidParams(
                "source and target text must not be empty".to_string(),
            ));
        }
        let mut entry = self
            .store
            .tm_entry(&params.entry_id)?
            .ok_or_else(|| EngineError::NotFound(format!("TM entry {}", params.entry_id)))?;
        let old_source_text = entry.source_text.clone();
        let memory_id = entry.memory_id.clone();
        let source_hash = sha256_hex(normalize_text(&source_text).as_bytes());
        // One entry per normalized source per memory: the confirm-time upsert
        // relies on it, so an edit must not create a silent duplicate. Exact
        // resolution is a point query on the unique (memory_id, source_hash)
        // index — the same one lookup and confirm use.
        if let Some(existing) = self.store.tm_entry_by_source(&memory_id, &source_hash)?
            && existing.id != params.entry_id
        {
            return Err(EngineError::Conflict(
                "another TM entry in this memory already covers that source text".to_string(),
            ));
        }
        entry.source_text = source_text;
        entry.target_text = target_text;
        entry.source_hash = source_hash;
        entry.confirmed_at_ms = now_ms();
        let updated = entry;
        if updated.source_text != old_source_text {
            // Re-key the fuzzy index so recall follows the edited source.
            // Exact matches need no index care: they resolve through the
            // store's (memory_id, source_hash) point query.
            self.tm_indexes
                .entry(memory_id)
                .or_default()
                .insert(&updated.id, &updated.source_text);
        }
        self.store.apply(&StateDelta {
            tm_entries: vec![updated.clone()],
            ..Default::default()
        })?;
        Ok(TmUpdateResult { entry: updated })
    }

    /// Remove one TM entry from its memory and from the fuzzy index.
    pub(crate) fn tm_delete(
        &mut self,
        params: TmDeleteParams,
    ) -> Result<TmDeleteResult, EngineError> {
        let entry = self
            .store
            .tm_entry(&params.entry_id)?
            .ok_or_else(|| EngineError::NotFound(format!("TM entry {}", params.entry_id)))?;
        if let Some(index) = self.tm_indexes.get_mut(&entry.memory_id) {
            index.remove(&entry.id);
        }
        self.store.apply(&StateDelta {
            deleted_tm_entries: vec![entry.id.clone()],
            ..Default::default()
        })?;
        Ok(TmDeleteResult { entry })
    }

    pub(crate) fn tm_import(
        &mut self,
        params: TmImportParams,
    ) -> Result<TmImportResult, EngineError> {
        let project = self.require_project(&params.project_id)?.clone();
        let path = Path::new(&params.path);
        if !path.is_file() {
            return Err(EngineError::NotFound(format!("TM file {}", path.display())));
        }
        let format = resolve_tm_format(params.format, path)?;
        let file = std::fs::File::open(path)?;
        let units = match format {
            TmExchangeFormat::Tmx => {
                tl_asset::parse_tmx(file, &project.source_locale, &project.target_locale)
            }
            TmExchangeFormat::Csv => {
                tl_asset::parse_tm_csv(file, &project.source_locale, &project.target_locale)
            }
            TmExchangeFormat::Tsv => {
                tl_asset::parse_tm_tsv(file, &project.source_locale, &project.target_locale)
            }
        }
        .map_err(|error| EngineError::InvalidParams(error.to_string()))?;

        let memory_id = Self::project_memory_id(&project.id);
        let now = now_ms();
        let mut added = 0_u32;
        let mut updated = 0_u32;
        // The batch map deduplicates repeated sources inside the file, so
        // the delta carries one final row per (memory, hash) and the last
        // occurrence wins — the same behavior the in-memory upsert had.
        let mut pending = BTreeMap::new();
        for unit in &units {
            let hash = sha256_hex(normalize_text(&unit.source_text).as_bytes());
            let (_, is_new) = self.upsert_tm_entry(
                &mut pending,
                &memory_id,
                &project.id,
                &unit.source_text,
                &unit.target_text,
                &hash,
                "",
                "",
                unit.created_at_ms.unwrap_or(now),
            )?;
            if is_new {
                added += 1;
            } else {
                updated += 1;
            }
        }
        // One transaction for the whole file.
        self.store.apply(&StateDelta {
            tm_entries: pending.into_values().collect(),
            ..Default::default()
        })?;
        Ok(TmImportResult {
            imported: u32::try_from(units.len()).unwrap_or(u32::MAX),
            added,
            updated,
        })
    }

    pub(crate) fn tm_export(&self, params: TmExportParams) -> Result<TmExportResult, EngineError> {
        let project = self.require_project(&params.project_id)?.clone();
        let path = Path::new(&params.path);
        let overwrite = params.overwrite.unwrap_or(false);
        if path.exists() {
            if !overwrite {
                return Err(EngineError::ExportBlocked(format!(
                    "output path already exists: {}",
                    path.display()
                )));
            }
            self.refuse_managed_overwrite(path)?;
        }
        let format = resolve_tm_format(params.format, path)?;
        let memory_id = Self::project_memory_id(&project.id);
        // Export inherently materializes the memory for the outgoing file,
        // but only this memory and only for the duration of the call.
        let entries = self.store.tm_entries_for_export(&memory_id)?;
        let units: Vec<TmExchangeUnit> = entries
            .iter()
            .map(|entry| TmExchangeUnit {
                source_locale: project.source_locale.clone(),
                target_locale: project.target_locale.clone(),
                source_text: entry.source_text.clone(),
                target_text: entry.target_text.clone(),
                domain: None,
                author: None,
                created_at_ms: Some(entry.confirmed_at_ms),
                metadata: Default::default(),
            })
            .collect();
        let mut buffer = Vec::new();
        match format {
            TmExchangeFormat::Tmx => tl_asset::write_tmx(&mut buffer, &units),
            TmExchangeFormat::Csv => tl_asset::write_tm_csv(&mut buffer, &units),
            TmExchangeFormat::Tsv => tl_asset::write_tm_tsv(&mut buffer, &units),
        }
        .map_err(|error| EngineError::Internal(error.to_string()))?;
        write_export_file(path, &buffer, overwrite)?;
        Ok(TmExportResult {
            output_path: path.display().to_string(),
            exported: u32::try_from(units.len()).unwrap_or(u32::MAX),
        })
    }

    pub(crate) fn tm_pretranslate(
        &mut self,
        params: TmPretranslateParams,
    ) -> Result<TmPretranslateResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        let project_id = record.document.project_id.clone();
        let document_id = record.document.id.clone();
        let min_score = validate_min_score(params.min_score, TM_PRETRANSLATE_DEFAULT_MIN_SCORE)?;
        let memory_id = Self::project_memory_id(&project_id);
        let now = now_ms();
        // Only the document's untranslated rows leave SQL; pretranslation
        // inherently walks all of them once. Locked rows are set aside and
        // reported, never filled.
        let (locked, pending): (Vec<Segment>, Vec<Segment>) = self
            .store
            .untranslated_document_segments(&document_id)?
            .into_iter()
            .filter(|segment| segment.target_text.trim().is_empty())
            .partition(|segment| segment.locked);
        let skipped_locked = u32::try_from(locked.len()).unwrap_or(u32::MAX);
        let mut checked = 0_u32;
        let mut exact = 0_u32;
        let mut fuzzy = 0_u32;
        let mut changed = Vec::new();
        for mut segment in pending {
            checked += 1;
            let (matches, _) = self.tm_matches(&memory_id, &segment.source_text, min_score, 1)?;
            let Some(best) = matches.first() else {
                continue;
            };
            if best.score < min_score {
                continue;
            }
            segment.target_text = best.entry.target_text.clone();
            segment.state = SegmentState::Draft;
            // Stamp the origin with the real lookup grade and score. No
            // lookup path emits `inContext` (dead contract variant); it
            // would still be an exact-source reuse if one ever did.
            segment.origin = Some(SegmentOrigin {
                kind: match best.grade {
                    TmMatchGrade::Fuzzy => SegmentOriginKind::TmFuzzy,
                    TmMatchGrade::Exact | TmMatchGrade::InContext => SegmentOriginKind::TmExact,
                },
                score: Some(best.score),
                model: None,
                edited: false,
            });
            segment.revision += 1;
            segment.updated_at_ms = now;
            if best.grade == TmMatchGrade::Exact {
                exact += 1;
            } else {
                fuzzy += 1;
            }
            changed.push(segment);
        }
        let delta = StateDelta {
            segments: changed,
            ..Default::default()
        };
        self.store.apply(&delta)?;
        Ok(TmPretranslateResult {
            checked,
            pretranslated: exact + fuzzy,
            exact,
            fuzzy,
            skipped_locked,
            segments: delta.segments,
        })
    }

    pub(crate) fn termbase_create(
        &mut self,
        params: TermbaseCreateParams,
    ) -> Result<Termbase, EngineError> {
        let name = params.name.trim();
        if name.is_empty() {
            return Err(EngineError::InvalidParams(
                "termbase name must not be empty".to_string(),
            ));
        }
        if params.source_locale.trim().is_empty() {
            return Err(EngineError::InvalidParams(
                "termbase source locale is required".to_string(),
            ));
        }
        let now = now_ms();
        let termbase = Termbase {
            id: new_id(),
            name: name.to_string(),
            source_locale: params.source_locale.trim().to_string(),
            domain: None,
            writable: true,
            revision: 1,
            created_at_ms: now,
            updated_at_ms: now,
        };
        self.store.apply(&StateDelta {
            termbases: vec![termbase.clone()],
            ..Default::default()
        })?;
        self.state
            .termbases
            .insert(termbase.id.clone(), termbase.clone());
        Ok(termbase)
    }

    pub(crate) fn termbase_list(
        &self,
        params: TermbaseListParams,
    ) -> Result<TermbaseListResult, EngineError> {
        if let Some(project_id) = params.project_id.as_deref() {
            self.require_project(project_id)?;
        }
        let mut termbases: Vec<Termbase> = self.state.termbases.values().cloned().collect();
        termbases.sort_by(|left, right| {
            left.created_at_ms
                .cmp(&right.created_at_ms)
                .then(left.id.cmp(&right.id))
        });
        let mut mounts: Vec<TermbaseMount> = self
            .state
            .termbase_mounts
            .iter()
            .filter(|mount| {
                params
                    .project_id
                    .as_deref()
                    .is_none_or(|project_id| mount.project_id == project_id)
            })
            .cloned()
            .collect();
        mounts.sort_by(|left, right| {
            left.project_id
                .cmp(&right.project_id)
                .then(left.priority.cmp(&right.priority))
        });
        Ok(TermbaseListResult { termbases, mounts })
    }

    pub(crate) fn termbase_attach(
        &mut self,
        params: TermbaseAttachParams,
    ) -> Result<TermbaseAttachResult, EngineError> {
        self.require_project(&params.project_id)?;
        self.require_termbase(&params.termbase_id)?;
        if let Some(existing) = self
            .state
            .termbase_mounts
            .iter()
            .find(|mount| {
                mount.project_id == params.project_id && mount.termbase_id == params.termbase_id
            })
            .cloned()
        {
            return Ok(TermbaseAttachResult { mount: existing });
        }
        let now = now_ms();
        let priority = self
            .state
            .termbase_mounts
            .iter()
            .filter(|mount| mount.project_id == params.project_id)
            .count() as u32;
        let mount = TermbaseMount {
            project_id: params.project_id,
            termbase_id: params.termbase_id,
            priority,
            writable: true,
            enabled: true,
            revision: 1,
            created_at_ms: now,
            updated_at_ms: now,
        };
        self.store.apply(&StateDelta {
            termbase_mounts: vec![mount.clone()],
            ..Default::default()
        })?;
        self.state.termbase_mounts.push(mount.clone());
        Ok(TermbaseAttachResult { mount })
    }

    pub(crate) fn termbase_detach(
        &mut self,
        params: TermbaseDetachParams,
    ) -> Result<TermbaseDetachResult, EngineError> {
        self.require_project(&params.project_id)?;
        self.require_termbase(&params.termbase_id)?;
        let position = self
            .state
            .termbase_mounts
            .iter()
            .position(|mount| {
                mount.project_id == params.project_id && mount.termbase_id == params.termbase_id
            })
            .ok_or_else(|| {
                EngineError::NotFound(format!(
                    "termbase {} is not attached to project {}",
                    params.termbase_id, params.project_id
                ))
            })?;
        let removed = self.state.termbase_mounts.remove(position);
        // Re-compact the remaining priorities for this project so the next
        // attach (priority = current mount count) can never collide.
        let now = now_ms();
        let mut recompacted: Vec<TermbaseMount> = Vec::new();
        let mut remaining: Vec<&mut TermbaseMount> = self
            .state
            .termbase_mounts
            .iter_mut()
            .filter(|mount| mount.project_id == params.project_id)
            .collect();
        remaining.sort_by_key(|mount| mount.priority);
        for (index, mount) in remaining.into_iter().enumerate() {
            let priority = index as u32;
            if mount.priority != priority {
                mount.priority = priority;
                mount.revision += 1;
                mount.updated_at_ms = now;
                recompacted.push(mount.clone());
            }
        }
        self.store.apply(&StateDelta {
            termbase_mounts: recompacted,
            deleted_termbase_mounts: vec![(
                removed.project_id.clone(),
                removed.termbase_id.clone(),
            )],
            ..Default::default()
        })?;
        Ok(TermbaseDetachResult { mount: removed })
    }

    fn require_termbase(&self, termbase_id: &str) -> Result<&Termbase, EngineError> {
        self.state
            .termbases
            .get(termbase_id)
            .ok_or_else(|| EngineError::NotFound(format!("termbase {termbase_id}")))
    }

    pub(crate) fn term_add(&mut self, params: TermAddParams) -> Result<TermAddResult, EngineError> {
        let termbase = self.require_termbase(&params.termbase_id)?.clone();
        let source_term = params.source_term.trim();
        let target_term = params.target_term.trim();
        let target_locale = params.target_locale.trim();
        if source_term.is_empty() || target_term.is_empty() || target_locale.is_empty() {
            return Err(EngineError::InvalidParams(
                "source term, target term, and target locale are required".to_string(),
            ));
        }
        let now = now_ms();
        // Dedupe on the normalized source: the store streams the termbase's
        // (id, source_term) pairs and the hit — if any — is one point query.
        let normalized_source = normalize_match_key(source_term);
        let existing_id = self.store.find_term_entry_id(&termbase.id, |_, source| {
            normalize_match_key(source) == normalized_source
        })?;
        let mut entry = match existing_id {
            Some(id) => self
                .store
                .term_entry(&id)?
                .ok_or_else(|| EngineError::Internal(format!("term entry {id} vanished")))?,
            None => TermEntry {
                id: new_id(),
                termbase_id: termbase.id.clone(),
                source_locale: termbase.source_locale.clone(),
                source_term: source_term.to_string(),
                part_of_speech: None,
                definition: None,
                example: None,
                domain: None,
                status: TermStatus::Active,
                revision: 0,
                translations: Vec::new(),
                created_at_ms: now,
                updated_at_ms: now,
            },
        };
        if let Some(definition) = params.definition.as_deref() {
            entry.definition = Some(definition.to_string());
        }
        if let Some(domain) = params.domain.as_deref() {
            entry.domain = Some(domain.to_string());
        }
        let existing_translation = entry.translations.iter_mut().find(|translation| {
            translation.locale == target_locale
                && normalize_match_key(&translation.term) == normalize_match_key(target_term)
        });
        match existing_translation {
            Some(translation) => {
                translation.preferred = !params.forbidden;
                translation.forbidden = params.forbidden;
                translation.updated_at_ms = now;
            }
            None => {
                let entry_id = entry.id.clone();
                entry.translations.push(TermTranslation {
                    id: new_id(),
                    entry_id,
                    locale: target_locale.to_string(),
                    term: target_term.to_string(),
                    preferred: !params.forbidden,
                    forbidden: params.forbidden,
                    created_at_ms: now,
                    updated_at_ms: now,
                });
            }
        }
        entry.revision += 1;
        entry.updated_at_ms = now;
        self.store.apply(&StateDelta {
            term_entries: vec![entry.clone()],
            ..Default::default()
        })?;
        Ok(TermAddResult { entry })
    }

    /// Edit an existing entry: rename the source term and/or edit one
    /// translation's text or forbidden flag. One call, one atomic save. The
    /// row is fetched from SQL, mutated, and persisted — no RAM copy of the
    /// term table exists.
    pub(crate) fn term_update(
        &mut self,
        params: TermUpdateParams,
    ) -> Result<TermUpdateResult, EngineError> {
        let mut entry = self
            .store
            .term_entry(&params.entry_id)?
            .ok_or_else(|| EngineError::NotFound(format!("term entry {}", params.entry_id)))?;
        let termbase_id = entry.termbase_id.clone();

        let new_source = match params.source_term.as_deref() {
            Some(raw) => {
                let trimmed = raw.trim();
                if trimmed.is_empty() {
                    return Err(EngineError::InvalidParams(
                        "source term must not be empty".to_string(),
                    ));
                }
                Some(trimmed.to_string())
            }
            None => None,
        };
        let new_target = match params.target_term.as_deref() {
            Some(raw) => {
                let trimmed = raw.trim();
                if trimmed.is_empty() {
                    return Err(EngineError::InvalidParams(
                        "target term must not be empty".to_string(),
                    ));
                }
                Some(trimmed.to_string())
            }
            None => None,
        };
        let edits_translation = new_target.is_some() || params.forbidden.is_some();
        if new_source.is_none() && !edits_translation {
            return Err(EngineError::InvalidParams(
                "nothing to update: pass sourceTerm, targetTerm, or forbidden".to_string(),
            ));
        }
        if edits_translation && params.translation_id.is_none() {
            return Err(EngineError::InvalidParams(
                "translationId is required to edit a translation".to_string(),
            ));
        }

        // Renaming must not collide with another entry in the same termbase;
        // term.add and termbase.import both dedupe on the normalized source.
        // The check streams this termbase's (id, source_term) pairs from SQL.
        if let Some(source) = new_source.as_deref() {
            let normalized = normalize_match_key(source);
            let collision = self.store.find_term_entry_id(&termbase_id, |id, other| {
                id != params.entry_id && normalize_match_key(other) == normalized
            })?;
            if collision.is_some() {
                return Err(EngineError::Conflict(format!(
                    "term \"{source}\" already exists in this termbase"
                )));
            }
        }

        let now = now_ms();
        if let Some(translation_id) = params.translation_id.as_deref() {
            let index = entry
                .translations
                .iter()
                .position(|translation| translation.id == translation_id)
                .ok_or_else(|| EngineError::NotFound(format!("translation {translation_id}")))?;
            // The edited text must not duplicate a sibling translation for
            // the same locale.
            if let Some(target) = new_target.as_deref() {
                let normalized = normalize_match_key(target);
                let locale = entry.translations[index].locale.clone();
                let duplicate = entry.translations.iter().any(|other| {
                    other.id != translation_id
                        && other.locale == locale
                        && normalize_match_key(&other.term) == normalized
                });
                if duplicate {
                    return Err(EngineError::Conflict(format!(
                        "translation \"{target}\" already exists for locale {locale}"
                    )));
                }
            }
            let translation = &mut entry.translations[index];
            if let Some(target) = new_target {
                translation.term = target;
            }
            if let Some(forbidden) = params.forbidden {
                translation.forbidden = forbidden;
                translation.preferred = !forbidden;
            }
            translation.updated_at_ms = now;
        }
        if let Some(source) = new_source {
            entry.source_term = source;
        }
        entry.revision += 1;
        entry.updated_at_ms = now;
        self.store.apply(&StateDelta {
            term_entries: vec![entry.clone()],
            ..Default::default()
        })?;
        Ok(TermUpdateResult { entry })
    }

    /// Delete a whole entry, or just one of its translations when
    /// `translation_id` is set. The entry is resolved by a point query;
    /// there is no RAM copy to keep in step.
    pub(crate) fn term_delete(
        &mut self,
        params: TermDeleteParams,
    ) -> Result<TermDeleteResult, EngineError> {
        let mut entry = self
            .store
            .term_entry(&params.entry_id)?
            .ok_or_else(|| EngineError::NotFound(format!("term entry {}", params.entry_id)))?;
        let (result, delta) = match params.translation_id.as_deref() {
            Some(translation_id) => {
                let index = entry
                    .translations
                    .iter()
                    .position(|translation| translation.id == translation_id)
                    .ok_or_else(|| {
                        EngineError::NotFound(format!("translation {translation_id}"))
                    })?;
                entry.translations.remove(index);
                entry.revision += 1;
                entry.updated_at_ms = now_ms();
                (
                    TermDeleteResult {
                        entry: Some(entry.clone()),
                    },
                    StateDelta {
                        term_entries: vec![entry],
                        ..Default::default()
                    },
                )
            }
            None => (
                TermDeleteResult { entry: None },
                StateDelta {
                    deleted_term_entries: vec![params.entry_id.clone()],
                    ..Default::default()
                },
            ),
        };
        self.store.apply(&delta)?;
        Ok(result)
    }

    /// One page of a termbase's entries straight from SQL, in source-term
    /// order, plus the honest pre-page total. Omitting `limit` returns the
    /// whole termbase, as before.
    pub(crate) fn term_list(&self, params: TermListParams) -> Result<TermListResult, EngineError> {
        self.require_termbase(&params.termbase_id)?;
        if params.limit == Some(0) {
            return Err(EngineError::InvalidParams(
                "limit must be at least 1".to_string(),
            ));
        }
        let entries = self.store.termbase_entries_page(
            &params.termbase_id,
            params.offset.unwrap_or(0),
            params.limit,
        )?;
        let total = self.store.termbase_entry_count(&params.termbase_id)?;
        Ok(TermListResult { entries, total })
    }

    /// Termbase ids attached to a project, in mount priority order.
    pub(crate) fn attached_termbase_ids(&self, project_id: &str) -> Vec<String> {
        let mut mounts: Vec<&TermbaseMount> = self
            .state
            .termbase_mounts
            .iter()
            .filter(|mount| mount.project_id == project_id && mount.enabled)
            .collect();
        mounts.sort_by_key(|mount| mount.priority);
        mounts
            .into_iter()
            .map(|mount| mount.termbase_id.clone())
            .collect()
    }

    /// Entries of every termbase attached to a project, fetched per
    /// termbase from SQL in mount priority order. Materialized transiently
    /// for one lookup or one QA run — there is no RAM map of all entries.
    pub(crate) fn attached_term_entries(
        &self,
        project_id: &str,
    ) -> Result<Vec<TermEntry>, EngineError> {
        let mut entries = Vec::new();
        for termbase_id in self.attached_termbase_ids(project_id) {
            entries.extend(self.store.termbase_entries_page(&termbase_id, 0, None)?);
        }
        Ok(entries)
    }

    /// All term hits for one source text over a prefetched entry set (see
    /// [`Engine::attached_term_entries`]), ordered by span position.
    pub(crate) fn term_hits(entries: &[TermEntry], source_text: &str) -> Vec<TermMatch> {
        let mut matches = Vec::new();
        for entry in entries {
            for (start, end) in term_spans(source_text, &entry.source_term) {
                matches.push(TermMatch {
                    termbase_id: entry.termbase_id.clone(),
                    entry_id: entry.id.clone(),
                    source_term: entry.source_term.clone(),
                    translations: entry.translations.clone(),
                    start,
                    end,
                });
            }
        }
        matches.sort_by(|left, right| {
            left.start
                .cmp(&right.start)
                .then(right.end.cmp(&left.end))
                .then(left.source_term.cmp(&right.source_term))
                .then(left.entry_id.cmp(&right.entry_id))
        });
        matches
    }

    pub(crate) fn term_lookup(
        &self,
        params: TermLookupParams,
    ) -> Result<TermLookupResult, EngineError> {
        self.require_project(&params.project_id)?;
        let entries = self.attached_term_entries(&params.project_id)?;
        Ok(TermLookupResult {
            matches: Self::term_hits(&entries, &params.source_text),
        })
    }

    pub(crate) fn termbase_import(
        &mut self,
        params: TermbaseImportParams,
    ) -> Result<TermbaseImportResult, EngineError> {
        let termbase = self.require_termbase(&params.termbase_id)?.clone();
        let target_locale = params.target_locale.trim();
        if target_locale.is_empty() {
            return Err(EngineError::InvalidParams(
                "target locale is required".to_string(),
            ));
        }
        let path = Path::new(&params.path);
        if !path.is_file() {
            return Err(EngineError::NotFound(format!(
                "termbase file {}",
                path.display()
            )));
        }
        let format = resolve_term_format(params.format, path)?;
        let file = std::fs::File::open(path)?;
        let parsed = match format {
            TermExchangeFormat::Csv => {
                tl_asset::parse_term_csv(file, &termbase.source_locale, target_locale)
            }
            TermExchangeFormat::Tsv => {
                tl_asset::parse_term_tsv(file, &termbase.source_locale, target_locale)
            }
            TermExchangeFormat::Tbx => {
                tl_asset::parse_tbx(file, &termbase.source_locale, target_locale)
            }
        }
        .map_err(|error| EngineError::InvalidParams(error.to_string()))?;

        let now = now_ms();
        let mut added = 0_u32;
        let mut merged = 0_u32;
        // One pass over the termbase's existing rows seeds the
        // normalized-source dedupe map; the whole file then merges against
        // this transient batch and commits as one transaction. Repeated
        // sources inside the file accumulate on the same pending entry —
        // the same behavior the in-memory upsert had.
        let mut pending: BTreeMap<String, TermEntry> = BTreeMap::new();
        let mut id_by_normalized: BTreeMap<String, String> = BTreeMap::new();
        for entry in self.store.termbase_entries_page(&termbase.id, 0, None)? {
            id_by_normalized
                .entry(normalize_match_key(&entry.source_term))
                .or_insert_with(|| entry.id.clone());
            pending.insert(entry.id.clone(), entry);
        }
        let mut changed_ids: BTreeSet<String> = BTreeSet::new();
        for exchange in &parsed {
            let normalized_source = normalize_match_key(&exchange.source_term);
            if normalized_source.is_empty() {
                continue;
            }
            let (entry_id, is_new) = match id_by_normalized.get(&normalized_source) {
                Some(id) => (id.clone(), false),
                None => {
                    let entry = TermEntry {
                        id: new_id(),
                        termbase_id: termbase.id.clone(),
                        source_locale: exchange.source_locale.clone(),
                        source_term: exchange.source_term.clone(),
                        part_of_speech: exchange.part_of_speech.clone(),
                        definition: exchange.definition.clone(),
                        example: exchange.example.clone(),
                        domain: exchange.domain.clone(),
                        status: parse_term_status(&exchange.status),
                        revision: 0,
                        translations: Vec::new(),
                        created_at_ms: now,
                        updated_at_ms: now,
                    };
                    let id = entry.id.clone();
                    id_by_normalized.insert(normalized_source, id.clone());
                    pending.insert(id.clone(), entry);
                    (id, true)
                }
            };
            let entry = pending.get_mut(&entry_id).expect("term entry just seeded");
            for translation in &exchange.target_translations {
                let existing = entry.translations.iter_mut().find(|current| {
                    current.locale == translation.locale
                        && normalize_match_key(&current.term)
                            == normalize_match_key(&translation.term)
                });
                match existing {
                    Some(current) => {
                        current.preferred = translation.preferred;
                        current.forbidden = translation.forbidden;
                        current.updated_at_ms = now;
                    }
                    None => entry.translations.push(TermTranslation {
                        id: new_id(),
                        entry_id: entry.id.clone(),
                        locale: translation.locale.clone(),
                        term: translation.term.clone(),
                        preferred: translation.preferred,
                        forbidden: translation.forbidden,
                        created_at_ms: now,
                        updated_at_ms: now,
                    }),
                }
            }
            entry.revision += 1;
            entry.updated_at_ms = now;
            changed_ids.insert(entry_id);
            if is_new {
                added += 1;
            } else {
                merged += 1;
            }
        }
        // Only the touched entries reach the delta; untouched seeded rows
        // were read for the dedupe map and are dropped unchanged.
        self.store.apply(&StateDelta {
            term_entries: changed_ids
                .iter()
                .filter_map(|id| pending.get(id).cloned())
                .collect(),
            ..Default::default()
        })?;
        Ok(TermbaseImportResult {
            imported: u32::try_from(parsed.len()).unwrap_or(u32::MAX),
            added,
            merged,
        })
    }

    pub(crate) fn termbase_export(
        &self,
        params: TermbaseExportParams,
    ) -> Result<TermbaseExportResult, EngineError> {
        self.require_termbase(&params.termbase_id)?;
        let path = Path::new(&params.path);
        let overwrite = params.overwrite.unwrap_or(false);
        if path.exists() {
            if !overwrite {
                return Err(EngineError::ExportBlocked(format!(
                    "output path already exists: {}",
                    path.display()
                )));
            }
            self.refuse_managed_overwrite(path)?;
        }
        let format = resolve_term_format(params.format, path)?;
        // Export inherently materializes the termbase for the outgoing file,
        // but only this termbase and only for the duration of the call. The
        // store returns it already in source-term order.
        let entries = self
            .store
            .termbase_entries_page(&params.termbase_id, 0, None)?;
        let exchange: Vec<TermExchangeEntry> = entries
            .iter()
            .map(|entry| TermExchangeEntry {
                source_locale: entry.source_locale.clone(),
                source_term: entry.source_term.clone(),
                target_translations: entry
                    .translations
                    .iter()
                    .map(|translation| TermExchangeTranslation {
                        locale: translation.locale.clone(),
                        term: translation.term.clone(),
                        preferred: translation.preferred,
                        forbidden: translation.forbidden,
                    })
                    .collect(),
                part_of_speech: entry.part_of_speech.clone(),
                definition: entry.definition.clone(),
                example: entry.example.clone(),
                domain: entry.domain.clone(),
                status: term_status_text(entry.status).to_string(),
                metadata: Default::default(),
            })
            .collect();
        let mut buffer = Vec::new();
        match format {
            TermExchangeFormat::Csv => tl_asset::write_term_csv(&mut buffer, &exchange),
            TermExchangeFormat::Tsv => tl_asset::write_term_tsv(&mut buffer, &exchange),
            TermExchangeFormat::Tbx => tl_asset::write_tbx(&mut buffer, &exchange),
        }
        .map_err(|error| EngineError::Internal(error.to_string()))?;
        write_export_file(path, &buffer, overwrite)?;
        Ok(TermbaseExportResult {
            output_path: path.display().to_string(),
            exported: u32::try_from(exchange.len()).unwrap_or(u32::MAX),
        })
    }
}

fn validate_min_score(value: Option<u8>, default: u8) -> Result<u8, EngineError> {
    match value {
        None => Ok(default),
        Some(score) if (1..=100).contains(&score) => Ok(score),
        Some(score) => Err(EngineError::InvalidParams(format!(
            "minScore must be within 1..=100, got {score}"
        ))),
    }
}

fn resolve_tm_format(
    format: Option<TmExchangeFormat>,
    path: &Path,
) -> Result<TmExchangeFormat, EngineError> {
    if let Some(format) = format {
        return Ok(format);
    }
    match extension_of(path).as_str() {
        "tmx" => Ok(TmExchangeFormat::Tmx),
        "csv" => Ok(TmExchangeFormat::Csv),
        "tsv" => Ok(TmExchangeFormat::Tsv),
        other => Err(EngineError::InvalidParams(format!(
            "cannot infer TM format from extension .{other}; pass format explicitly"
        ))),
    }
}

fn resolve_term_format(
    format: Option<TermExchangeFormat>,
    path: &Path,
) -> Result<TermExchangeFormat, EngineError> {
    if let Some(format) = format {
        return Ok(format);
    }
    match extension_of(path).as_str() {
        "csv" => Ok(TermExchangeFormat::Csv),
        "tsv" => Ok(TermExchangeFormat::Tsv),
        "tbx" => Ok(TermExchangeFormat::Tbx),
        other => Err(EngineError::InvalidParams(format!(
            "cannot infer termbase format from extension .{other}; pass format explicitly"
        ))),
    }
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn parse_term_status(value: &str) -> TermStatus {
    match value.trim().to_ascii_lowercase().as_str() {
        "candidate" => TermStatus::Candidate,
        "deprecated" => TermStatus::Deprecated,
        _ => TermStatus::Active,
    }
}

fn term_status_text(status: TermStatus) -> &'static str {
    match status {
        TermStatus::Candidate => "candidate",
        TermStatus::Active => "active",
        TermStatus::Deprecated => "deprecated",
    }
}

/// Publish export bytes. Without `overwrite` the destination must not exist
/// (`create_new` keeps the no-clobber guarantee race-free). With `overwrite`,
/// the bytes are staged in a sibling temp file and renamed over the
/// destination atomically, so a failed write never destroys the existing
/// file.
fn write_export_file(path: &Path, bytes: &[u8], overwrite: bool) -> Result<(), EngineError> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)?;
    }
    if overwrite {
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        temporary.write_all(bytes)?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(path)
            .map_err(|error| EngineError::Io(error.error))?;
        return Ok(());
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.flush()?;
    Ok(())
}
