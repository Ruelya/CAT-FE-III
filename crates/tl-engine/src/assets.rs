//! Translation-memory and terminology operations.
//!
//! Fuzzy TM lookup is recall + rerank: the per-memory [`TmIndex`] returns
//! every entry whose provable score ceiling reaches the requested floor (no
//! hidden candidate cap), and `tl_asset::match_score` reranks the survivors.

use std::io::Write as _;
use std::path::Path;

use tl_asset::{
    TermEntry, TermExchangeEntry, TermExchangeTranslation, TermMatch, TermStatus, TermTranslation,
    Termbase, TermbaseMount, TmExchangeUnit, match_score, normalize_match_key, term_spans,
};
use tl_domain::{SegmentState, TmEntry, new_id, normalize_text, sha256_hex};
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

use crate::{Engine, EngineError, now_ms};

impl Engine {
    pub(crate) fn project_memory_id(project_id: &str) -> String {
        format!("tm-{project_id}")
    }

    /// Insert or refresh the TM entry for one normalized source in a memory.
    /// Returns the entry and whether it was newly added.
    #[expect(clippy::too_many_arguments, reason = "internal upsert plumbing")]
    pub(crate) fn upsert_tm_entry(
        &mut self,
        memory_id: &str,
        project_id: &str,
        source_text: &str,
        target_text: &str,
        source_hash: &str,
        origin_document_id: &str,
        origin_segment_id: &str,
        now: i64,
    ) -> (TmEntry, bool) {
        let existing = self
            .state
            .tm_entries
            .values_mut()
            .find(|entry| entry.memory_id == memory_id && entry.source_hash == source_hash);
        match existing {
            Some(entry) => {
                entry.target_text = target_text.to_string();
                entry.origin_document_id = origin_document_id.to_string();
                entry.origin_segment_id = origin_segment_id.to_string();
                entry.confirmed_at_ms = now;
                (entry.clone(), false)
            }
            None => {
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
                self.state
                    .tm_entries
                    .insert(entry.id.clone(), entry.clone());
                (entry, true)
            }
        }
    }

    /// Exact + fuzzy matches for one source text against one memory, sorted
    /// by score, then recency, then id. `total` is the pre-limit count.
    pub(crate) fn tm_matches(
        &self,
        memory_id: &str,
        source_text: &str,
        min_score: u8,
        limit: usize,
    ) -> (Vec<TmMatchItem>, u32) {
        let hash = sha256_hex(normalize_text(source_text).as_bytes());
        let mut matches: Vec<TmMatchItem> = Vec::new();
        for entry in self.state.tm_entries.values() {
            if entry.memory_id == memory_id && entry.source_hash == hash {
                matches.push(TmMatchItem {
                    entry: entry.clone(),
                    score: 100,
                    grade: TmMatchGrade::Exact,
                });
            }
        }
        if let Some(index) = self.tm_indexes.get(memory_id) {
            for entry_id in index.recall(source_text, min_score) {
                let Some(entry) = self.state.tm_entries.get(&entry_id) else {
                    continue;
                };
                if entry.source_hash == hash {
                    continue; // Already reported as exact.
                }
                let score = match_score(source_text, &entry.source_text).score;
                if score >= min_score {
                    matches.push(TmMatchItem {
                        entry: entry.clone(),
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
        (matches, total)
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
            self.tm_matches(&memory_id, &params.source_text, min_score, limit as usize);
        Ok(TmLookupResult {
            matches,
            total_matches,
        })
    }

    /// One page of a project's TM entries, newest confirmation first, with an
    /// optional case-insensitive substring filter over source and target.
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
        let offset = params.offset.unwrap_or(0) as usize;
        let query = params
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase);
        let memory_id = Self::project_memory_id(&params.project_id);
        let mut entries: Vec<&TmEntry> = self
            .state
            .tm_entries
            .values()
            .filter(|entry| entry.memory_id == memory_id)
            .filter(|entry| match query.as_deref() {
                Some(needle) => {
                    entry.source_text.to_lowercase().contains(needle)
                        || entry.target_text.to_lowercase().contains(needle)
                }
                None => true,
            })
            .collect();
        entries.sort_by(|left, right| {
            right
                .confirmed_at_ms
                .cmp(&left.confirmed_at_ms)
                .then(left.id.cmp(&right.id))
        });
        let total = u32::try_from(entries.len()).unwrap_or(u32::MAX);
        let page: Vec<TmEntry> = entries
            .into_iter()
            .skip(offset)
            .take(limit as usize)
            .cloned()
            .collect();
        Ok(TmListResult {
            entries: page,
            total,
        })
    }

    /// Edit one TM entry's source and target text. A changed source re-keys
    /// the entry (hash + fuzzy index) so lookup, pretranslation, and the
    /// confirm-time upsert all see the edited text.
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
        let (memory_id, old_source_text) = {
            let entry =
                self.state.tm_entries.get(&params.entry_id).ok_or_else(|| {
                    EngineError::NotFound(format!("TM entry {}", params.entry_id))
                })?;
            (entry.memory_id.clone(), entry.source_text.clone())
        };
        let source_hash = sha256_hex(normalize_text(&source_text).as_bytes());
        // One entry per normalized source per memory: the confirm-time upsert
        // relies on it, so an edit must not create a silent duplicate.
        if self.state.tm_entries.values().any(|entry| {
            entry.id != params.entry_id
                && entry.memory_id == memory_id
                && entry.source_hash == source_hash
        }) {
            return Err(EngineError::Conflict(
                "another TM entry in this memory already covers that source text".to_string(),
            ));
        }
        let now = now_ms();
        let entry = self
            .state
            .tm_entries
            .get_mut(&params.entry_id)
            .expect("TM entry just resolved");
        entry.source_text = source_text;
        entry.target_text = target_text;
        entry.source_hash = source_hash;
        entry.confirmed_at_ms = now;
        let updated = entry.clone();
        if updated.source_text != old_source_text {
            // Re-key the fuzzy index so recall follows the edited source.
            self.tm_indexes
                .entry(memory_id)
                .or_default()
                .insert(&updated.id, &updated.source_text);
        }
        self.store.save(&self.state)?;
        Ok(TmUpdateResult { entry: updated })
    }

    /// Remove one TM entry from its memory and from the fuzzy index.
    pub(crate) fn tm_delete(
        &mut self,
        params: TmDeleteParams,
    ) -> Result<TmDeleteResult, EngineError> {
        let entry = self
            .state
            .tm_entries
            .remove(&params.entry_id)
            .ok_or_else(|| EngineError::NotFound(format!("TM entry {}", params.entry_id)))?;
        if let Some(index) = self.tm_indexes.get_mut(&entry.memory_id) {
            index.remove(&entry.id);
        }
        self.store.save(&self.state)?;
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
        for unit in &units {
            let hash = sha256_hex(normalize_text(&unit.source_text).as_bytes());
            let (_, is_new) = self.upsert_tm_entry(
                &memory_id,
                &project.id,
                &unit.source_text,
                &unit.target_text,
                &hash,
                "",
                "",
                unit.created_at_ms.unwrap_or(now),
            );
            if is_new {
                added += 1;
            } else {
                updated += 1;
            }
        }
        self.store.save(&self.state)?;
        Ok(TmImportResult {
            imported: u32::try_from(units.len()).unwrap_or(u32::MAX),
            added,
            updated,
        })
    }

    pub(crate) fn tm_export(&self, params: TmExportParams) -> Result<TmExportResult, EngineError> {
        let project = self.require_project(&params.project_id)?.clone();
        let path = Path::new(&params.path);
        if path.exists() {
            return Err(EngineError::ExportBlocked(format!(
                "output path already exists: {}",
                path.display()
            )));
        }
        let format = resolve_tm_format(params.format, path)?;
        let memory_id = Self::project_memory_id(&project.id);
        let mut entries: Vec<&TmEntry> = self
            .state
            .tm_entries
            .values()
            .filter(|entry| entry.memory_id == memory_id)
            .collect();
        entries.sort_by(|left, right| {
            left.confirmed_at_ms
                .cmp(&right.confirmed_at_ms)
                .then(left.id.cmp(&right.id))
        });
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
        write_new_file(path, &buffer)?;
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
        let segment_ids = record.segment_ids.clone();
        let min_score = validate_min_score(params.min_score, TM_PRETRANSLATE_DEFAULT_MIN_SCORE)?;
        let memory_id = Self::project_memory_id(&project_id);
        let now = now_ms();
        let mut checked = 0_u32;
        let mut exact = 0_u32;
        let mut fuzzy = 0_u32;
        let mut changed = Vec::new();
        for segment_id in &segment_ids {
            let Some(segment) = self.state.segments.get(segment_id) else {
                continue;
            };
            if segment.state != SegmentState::Untranslated || !segment.target_text.trim().is_empty()
            {
                continue;
            }
            checked += 1;
            let (matches, _) = self.tm_matches(&memory_id, &segment.source_text, min_score, 1);
            let Some(best) = matches.first() else {
                continue;
            };
            if best.score < min_score {
                continue;
            }
            let target = best.entry.target_text.clone();
            let is_exact = best.grade == TmMatchGrade::Exact;
            if let Some(stored) = self.state.segments.get_mut(segment_id) {
                stored.target_text = target;
                stored.state = SegmentState::Draft;
                stored.revision += 1;
                stored.updated_at_ms = now;
                changed.push(stored.clone());
                if is_exact {
                    exact += 1;
                } else {
                    fuzzy += 1;
                }
            }
        }
        if !changed.is_empty() {
            self.store.save(&self.state)?;
        }
        Ok(TmPretranslateResult {
            checked,
            pretranslated: exact + fuzzy,
            exact,
            fuzzy,
            segments: changed,
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
        self.state
            .termbases
            .insert(termbase.id.clone(), termbase.clone());
        self.store.save(&self.state)?;
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
        self.state.termbase_mounts.push(mount.clone());
        self.store.save(&self.state)?;
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
            }
        }
        self.store.save(&self.state)?;
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
        let normalized_source = normalize_match_key(source_term);
        let existing_id = self
            .state
            .term_entries
            .values()
            .find(|entry| {
                entry.termbase_id == termbase.id
                    && normalize_match_key(&entry.source_term) == normalized_source
            })
            .map(|entry| entry.id.clone());
        let entry_id = match existing_id {
            Some(id) => id,
            None => {
                let entry = TermEntry {
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
                };
                let id = entry.id.clone();
                self.state.term_entries.insert(id.clone(), entry);
                id
            }
        };
        let entry = self
            .state
            .term_entries
            .get_mut(&entry_id)
            .expect("term entry just resolved");
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
            None => entry.translations.push(TermTranslation {
                id: new_id(),
                entry_id: entry.id.clone(),
                locale: target_locale.to_string(),
                term: target_term.to_string(),
                preferred: !params.forbidden,
                forbidden: params.forbidden,
                created_at_ms: now,
                updated_at_ms: now,
            }),
        }
        entry.revision += 1;
        entry.updated_at_ms = now;
        let result = entry.clone();
        self.store.save(&self.state)?;
        Ok(TermAddResult { entry: result })
    }

    /// Edit an existing entry: rename the source term and/or edit one
    /// translation's text or forbidden flag. One call, one atomic save.
    pub(crate) fn term_update(
        &mut self,
        params: TermUpdateParams,
    ) -> Result<TermUpdateResult, EngineError> {
        let entry = self
            .state
            .term_entries
            .get(&params.entry_id)
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
        if let Some(source) = new_source.as_deref() {
            let normalized = normalize_match_key(source);
            let collision = self.state.term_entries.values().any(|other| {
                other.id != params.entry_id
                    && other.termbase_id == termbase_id
                    && normalize_match_key(&other.source_term) == normalized
            });
            if collision {
                return Err(EngineError::Conflict(format!(
                    "term \"{source}\" already exists in this termbase"
                )));
            }
        }

        let now = now_ms();
        let entry = self
            .state
            .term_entries
            .get_mut(&params.entry_id)
            .expect("term entry just resolved");
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
        let result = entry.clone();
        self.store.save(&self.state)?;
        Ok(TermUpdateResult { entry: result })
    }

    /// Delete a whole entry, or just one of its translations when
    /// `translation_id` is set.
    pub(crate) fn term_delete(
        &mut self,
        params: TermDeleteParams,
    ) -> Result<TermDeleteResult, EngineError> {
        if !self.state.term_entries.contains_key(&params.entry_id) {
            return Err(EngineError::NotFound(format!(
                "term entry {}",
                params.entry_id
            )));
        }
        let result = match params.translation_id.as_deref() {
            Some(translation_id) => {
                let entry = self
                    .state
                    .term_entries
                    .get_mut(&params.entry_id)
                    .expect("term entry just checked");
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
                TermDeleteResult {
                    entry: Some(entry.clone()),
                }
            }
            None => {
                self.state.term_entries.remove(&params.entry_id);
                TermDeleteResult { entry: None }
            }
        };
        self.store.save(&self.state)?;
        Ok(result)
    }

    pub(crate) fn term_list(&self, params: TermListParams) -> Result<TermListResult, EngineError> {
        self.require_termbase(&params.termbase_id)?;
        let mut entries: Vec<TermEntry> = self
            .state
            .term_entries
            .values()
            .filter(|entry| entry.termbase_id == params.termbase_id)
            .cloned()
            .collect();
        entries.sort_by(|left, right| {
            left.source_term
                .cmp(&right.source_term)
                .then(left.id.cmp(&right.id))
        });
        Ok(TermListResult { entries })
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

    /// All term hits for one source text across a project's termbases.
    pub(crate) fn term_hits(&self, project_id: &str, source_text: &str) -> Vec<TermMatch> {
        let mut matches = Vec::new();
        for termbase_id in self.attached_termbase_ids(project_id) {
            for entry in self.state.term_entries.values() {
                if entry.termbase_id != termbase_id {
                    continue;
                }
                for (start, end) in term_spans(source_text, &entry.source_term) {
                    matches.push(TermMatch {
                        termbase_id: termbase_id.clone(),
                        entry_id: entry.id.clone(),
                        source_term: entry.source_term.clone(),
                        translations: entry.translations.clone(),
                        start,
                        end,
                    });
                }
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
        Ok(TermLookupResult {
            matches: self.term_hits(&params.project_id, &params.source_text),
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
        for exchange in &parsed {
            let normalized_source = normalize_match_key(&exchange.source_term);
            if normalized_source.is_empty() {
                continue;
            }
            let existing_id = self
                .state
                .term_entries
                .values()
                .find(|entry| {
                    entry.termbase_id == termbase.id
                        && normalize_match_key(&entry.source_term) == normalized_source
                })
                .map(|entry| entry.id.clone());
            let (entry_id, is_new) = match existing_id {
                Some(id) => (id, false),
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
                    self.state.term_entries.insert(id.clone(), entry);
                    (id, true)
                }
            };
            let entry = self
                .state
                .term_entries
                .get_mut(&entry_id)
                .expect("term entry just resolved");
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
            if is_new {
                added += 1;
            } else {
                merged += 1;
            }
        }
        self.store.save(&self.state)?;
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
        if path.exists() {
            return Err(EngineError::ExportBlocked(format!(
                "output path already exists: {}",
                path.display()
            )));
        }
        let format = resolve_term_format(params.format, path)?;
        let mut entries: Vec<&TermEntry> = self
            .state
            .term_entries
            .values()
            .filter(|entry| entry.termbase_id == params.termbase_id)
            .collect();
        entries.sort_by(|left, right| {
            left.source_term
                .cmp(&right.source_term)
                .then(left.id.cmp(&right.id))
        });
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
        write_new_file(path, &buffer)?;
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

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), EngineError> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.flush()?;
    Ok(())
}
