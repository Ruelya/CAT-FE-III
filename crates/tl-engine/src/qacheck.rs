//! QA execution: the deterministic `tl-qa` rule library wired to documents.
//!
//! Every run evaluates the full built-in profile (completeness, numbers,
//! inline tag/placeholder integrity, punctuation, whitespace, repetition,
//! length, terminology from attached termbases, and cross-segment
//! consistency), then reconciles findings with
//! the persisted issue set by fingerprint so repeated runs stay stable and
//! fixed issues resolve. Issues live in SQL only: a run reconciles one
//! document's rows transiently and `qa.list` pages them straight from the
//! store.
//!
//! ## The waiver rule
//!
//! `qa.waive` marks an issue as accepted by a human without pretending the
//! finding went away. A waiver is pinned to the issue fingerprint, which
//! hashes rule id + segment id + evidence, so:
//!
//! - Same fingerprint + same evidence on a later run → the issue **stays
//!   waived** (the user already judged exactly this finding).
//! - Changed evidence (e.g. different numbers) → the fingerprint changes,
//!   so a **new open issue** appears and the old waived row resolves like
//!   any finding that stopped reproducing. A waiver never silently covers
//!   evidence the user has not seen.
//! - The user can restore (`waived: false`) at any time, which reopens the
//!   issue until it is fixed, re-waived, or stops reproducing.
//!
//! Waiving is not confirming: it never touches the segment, its state, or
//! the TM. Only `qa.run` may mark an issue resolved.

use std::collections::{BTreeMap, BTreeSet};

use tl_asset::TermEntry;
use tl_domain::{
    NumberEvidence, Project, QaIssue, QaIssueStatus, QaProfileOverrides, QaSeverity, Segment,
    SegmentState, new_id,
};
use tl_protocol::{
    QaFix, QaFixApplyParams, QaFixApplyResult, QaFixListParams, QaFixListResult, QaListParams,
    QaListResult, QaProfileGetParams, QaProfileUpdateParams, QaProfileView, QaRunParams,
    QaRunResult, QaWaiveParams, QaWaiveResult,
};
use tl_qa::{
    CompiledQaProfile, QaCandidateEvidence, QaConsistencySegment, QaFindingCandidate,
    QaProfileDefinition, QaSegmentInput, QaTermExpectation, built_in_profiles, default_profile_id,
    evaluate_consistency, propose_correction,
};

use crate::store::StateDelta;
use crate::{Engine, EngineError, apply_origin_rules, now_ms};

/// Rule ids produced by [`evaluate_consistency`] — the cross-segment pass a
/// segment-scoped refresh cannot honestly re-evaluate.
const CONSISTENCY_RULE_IDS: [&str; 2] = [
    "qa.same-source-different-target",
    "qa.different-source-same-target",
];

impl Engine {
    pub(crate) fn qa_run(&mut self, params: QaRunParams) -> Result<QaRunResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        let project = self.require_project(&record.document.project_id)?.clone();
        let document_id = record.document.id.clone();
        // One document's rows, transiently: QA inherently evaluates every
        // segment of the document it runs on.
        let segments = self.store.document_segments_page(&document_id, 0, None)?;
        // The project's attached termbases, fetched once per run from SQL
        // and shared by every segment's terminology expectations.
        let term_entries = self.attached_term_entries(&project.id)?;

        let (definition, profile) = Self::compiled_profile(&project)?;

        let mut checked = 0_u32;
        let mut candidates: Vec<QaFindingCandidate> = Vec::new();
        let mut consistency_inputs = Vec::new();
        // Locked rows sit outside the run entirely: no candidates, not
        // counted as checked, and their persisted issues are shielded from
        // the resolve pass below — resolving them would claim a check that
        // never happened.
        let mut locked_segment_ids: BTreeSet<&str> = BTreeSet::new();
        for segment in &segments {
            if segment.locked {
                locked_segment_ids.insert(segment.id.as_str());
                continue;
            }
            if segment.source_text.trim().is_empty() {
                continue;
            }
            checked += 1;
            // Terminology only applies once a translation exists; an empty
            // target is already covered by the completeness rule.
            let terms = if segment.target_text.trim().is_empty() {
                Vec::new()
            } else {
                Self::term_expectations(&term_entries, &project.target_locale, &segment.source_text)
            };
            let input = QaSegmentInput {
                segment_id: segment.id.clone(),
                source_text: segment.source_text.clone(),
                target_text: segment.target_text.clone(),
                source_locale: project.source_locale.clone(),
                target_locale: project.target_locale.clone(),
                tag_findings: Vec::new(),
                terms,
                confirmed: segment.state == SegmentState::Confirmed,
                origin: segment.origin.clone(),
            };
            candidates.extend(profile.evaluate_segment(&input));
            consistency_inputs.push(QaConsistencySegment {
                segment_id: segment.id.clone(),
                source_text: segment.source_text.clone(),
                target_text: segment.target_text.clone(),
            });
        }
        candidates.extend(evaluate_consistency(&definition, &consistency_inputs));

        // Reconcile against the document's persisted issues, fetched once
        // from SQL for this run. Fingerprints embed segment ids, so a
        // candidate can only ever match an issue of this document.
        let mut issues: BTreeMap<String, QaIssue> = self
            .store
            .document_qa_issues_page(&document_id, 0, None)?
            .into_iter()
            .map(|issue| (issue.id.clone(), issue))
            .collect();

        let now = now_ms();
        let mut changed_ids: BTreeSet<String> = BTreeSet::new();
        let current_fingerprints = fold_candidates(&mut issues, candidates, now, &mut changed_ids);
        // Resolve issues that no longer reproduce for this document. This
        // covers waived rows too: when the evidence behind a waiver changes
        // or the finding disappears, the waiver has run its course (any
        // still-mismatching evidence opened a fresh issue above). Issues on
        // locked rows are exempt: those rows were not evaluated this run.
        for issue in issues.values_mut() {
            if locked_segment_ids.contains(issue.segment_id.as_str()) {
                continue;
            }
            if issue.status != QaIssueStatus::Resolved
                && !current_fingerprints.contains(&issue.fingerprint)
            {
                issue.status = QaIssueStatus::Resolved;
                issue.waive_note = None;
                issue.updated_at_ms = now;
                changed_ids.insert(issue.id.clone());
            }
        }
        // Only the rows that changed reach the transaction.
        self.store.apply(&StateDelta {
            qa_issues: changed_ids
                .iter()
                .filter_map(|id| issues.get(id).cloned())
                .collect(),
            ..Default::default()
        })?;

        let mut issues: Vec<QaIssue> = issues.into_values().collect();
        sort_issues(&mut issues);
        let open_issues = issues
            .iter()
            .filter(|issue| issue.status == QaIssueStatus::Open)
            .count() as u32;
        Ok(QaRunResult {
            checked_segments: checked,
            open_issues,
            issues,
        })
    }

    /// Confirm-time QA: evaluate the segment-scoped rules against one
    /// segment's current text and reconcile only that segment's issues.
    /// Cross-segment consistency findings are left untouched — a
    /// single-segment pass cannot honestly re-evaluate them, so they wait
    /// for the next full `qa.run`. Returns `(changed rows, the segment's
    /// full issue list after the refresh)`; the caller folds the changed
    /// rows into its own transaction so the confirm and its QA refresh
    /// commit (or fail) together. Never called for locked segments —
    /// confirm refuses those first.
    pub(crate) fn refresh_segment_qa(
        &self,
        project: &Project,
        segment: &Segment,
    ) -> Result<(Vec<QaIssue>, Vec<QaIssue>), EngineError> {
        let (_, profile) = Self::compiled_profile(project)?;
        let candidates = if segment.source_text.trim().is_empty() {
            Vec::new()
        } else {
            let term_entries = self.attached_term_entries(&project.id)?;
            let terms = if segment.target_text.trim().is_empty() {
                Vec::new()
            } else {
                Self::term_expectations(&term_entries, &project.target_locale, &segment.source_text)
            };
            profile.evaluate_segment(&QaSegmentInput {
                segment_id: segment.id.clone(),
                source_text: segment.source_text.clone(),
                target_text: segment.target_text.clone(),
                source_locale: project.source_locale.clone(),
                target_locale: project.target_locale.clone(),
                tag_findings: Vec::new(),
                terms,
                confirmed: segment.state == SegmentState::Confirmed,
                origin: segment.origin.clone(),
            })
        };

        let mut issues: BTreeMap<String, QaIssue> = self
            .store
            .segment_qa_issues(&segment.id)?
            .into_iter()
            .map(|issue| (issue.id.clone(), issue))
            .collect();
        let now = now_ms();
        let mut changed_ids: BTreeSet<String> = BTreeSet::new();
        let current_fingerprints = fold_candidates(&mut issues, candidates, now, &mut changed_ids);
        // Scoped resolve pass: only the segment-scoped rules ran, so only
        // their issues may resolve; consistency rows stay as they are.
        for issue in issues.values_mut() {
            if CONSISTENCY_RULE_IDS.contains(&issue.rule_id.as_str()) {
                continue;
            }
            if issue.status != QaIssueStatus::Resolved
                && !current_fingerprints.contains(&issue.fingerprint)
            {
                issue.status = QaIssueStatus::Resolved;
                issue.waive_note = None;
                issue.updated_at_ms = now;
                changed_ids.insert(issue.id.clone());
            }
        }
        let changed = changed_ids
            .iter()
            .filter_map(|id| issues.get(id).cloned())
            .collect();
        let mut all: Vec<QaIssue> = issues.into_values().collect();
        sort_issues(&mut all);
        Ok((changed, all))
    }

    /// The project's effective QA profile: the configured id when it names
    /// a built-in profile, otherwise the locale default, with the project's
    /// stored overrides (severity remaps, settings replacement) layered on
    /// top. Built-in profiles stay immutable; the project layer is a
    /// clone-then-override.
    fn compiled_profile(
        project: &Project,
    ) -> Result<(QaProfileDefinition, CompiledQaProfile), EngineError> {
        let definition = Self::effective_profile_definition(project)?;
        let profile = CompiledQaProfile::compile(definition.clone())
            .map_err(|error| EngineError::Internal(error.to_string()))?;
        Ok((definition, profile))
    }

    /// Resolve the built-in base profile and apply the project overrides,
    /// without compiling. Shared by [`Engine::compiled_profile`] and the
    /// `qa.profile.*` endpoints so reads, writes, and runs all agree on the
    /// merge.
    fn effective_profile_definition(project: &Project) -> Result<QaProfileDefinition, EngineError> {
        let profiles = built_in_profiles();
        let profile_id = project
            .configuration
            .qa_profile_id
            .as_deref()
            .filter(|id| profiles.iter().any(|profile| profile.id == *id))
            .unwrap_or_else(|| default_profile_id(&project.target_locale));
        let mut definition = profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned()
            .ok_or_else(|| EngineError::Internal(format!("missing QA profile {profile_id}")))?;
        if let Some(overrides) = &project.configuration.qa_profile {
            definition
                .severity_overrides
                .extend(overrides.severity_overrides.clone());
            if let Some(settings) = &overrides.settings {
                definition.settings = settings.clone();
            }
        }
        Ok(definition)
    }

    /// `qa.profile.get`: the profile the engine will actually run for this
    /// project — resolved base id, effective severity remaps and settings,
    /// the export-gate flag, and the project revision for the update call.
    pub(crate) fn qa_profile_get(
        &self,
        params: QaProfileGetParams,
    ) -> Result<QaProfileView, EngineError> {
        let project = self.require_project(&params.project_id)?;
        Self::profile_view(project)
    }

    /// `qa.profile.update`: write the project-level overrides. Provided
    /// fields replace the stored values wholesale; omitted fields keep them.
    /// The merged profile is compiled before anything is stored, so a
    /// configuration that cannot run is refused instead of persisted.
    pub(crate) fn qa_profile_update(
        &mut self,
        params: QaProfileUpdateParams,
    ) -> Result<QaProfileView, EngineError> {
        let project = self.require_project(&params.project_id)?.clone();
        if params.base_revision != project.revision {
            return Err(EngineError::Conflict(format!(
                "project revision is {}, request was based on {}",
                project.revision, params.base_revision
            )));
        }
        if params.clear_settings && params.settings.is_some() {
            return Err(EngineError::InvalidParams(
                "settings and clearSettings are contradictory; provide at most one".to_string(),
            ));
        }
        if let Some(overrides) = &params.severity_overrides {
            for rule_id in overrides.keys() {
                if !rule_id.starts_with("qa.") {
                    return Err(EngineError::InvalidParams(format!(
                        "severity override key {rule_id} is not a rule id (expected a qa. prefix)"
                    )));
                }
            }
        }

        let mut stored = project.configuration.qa_profile.clone().unwrap_or_default();
        if let Some(overrides) = params.severity_overrides {
            stored.severity_overrides = overrides;
        }
        if params.clear_settings {
            stored.settings = None;
        } else if let Some(settings) = params.settings {
            stored.settings = Some(settings);
        }
        if let Some(block) = params.block_export_on_error {
            stored.block_export_on_error = block;
        }
        // Never store a default overrides blob: an all-default layer is the
        // same as no layer, and `None` keeps old configs byte-stable.
        let qa_profile = (stored != QaProfileOverrides::default()).then_some(stored);

        // Compile the merged result before writing: a profile that cannot
        // run (e.g. min ratio above max) is rejected here, not at the next
        // qa.run.
        let mut candidate = project.clone();
        candidate.configuration.qa_profile = qa_profile.clone();
        let definition = Self::effective_profile_definition(&candidate)?;
        CompiledQaProfile::compile(definition)
            .map_err(|error| EngineError::InvalidParams(error.to_string()))?;

        if candidate.configuration == project.configuration {
            return Self::profile_view(&project);
        }
        let now = now_ms();
        let updated = {
            let entry = self
                .state
                .projects
                .get_mut(&params.project_id)
                .expect("project just resolved");
            entry.configuration.qa_profile = qa_profile;
            entry.revision += 1;
            entry.updated_at_ms = now;
            entry.clone()
        };
        self.store.apply(&StateDelta {
            projects: vec![updated.clone()],
            ..Default::default()
        })?;
        Self::profile_view(&updated)
    }

    fn profile_view(project: &Project) -> Result<QaProfileView, EngineError> {
        let definition = Self::effective_profile_definition(project)?;
        let overrides = project.configuration.qa_profile.clone().unwrap_or_default();
        // The severity table's rows: every static rule id the compiled
        // profile runs. Family markers stand for parameterized findings
        // (`qa.term-*:<id>`, `qa.regex:<id>`, and the `qa.tag` marker
        // behind the concrete `qa.tag-*` ids) and get no static row.
        let enabled_rule_ids = definition
            .enabled_rule_ids
            .iter()
            .filter(|rule_id| {
                !matches!(
                    rule_id.as_str(),
                    "qa.tag" | "qa.term-required" | "qa.term-forbidden" | "qa.regex"
                )
            })
            .cloned()
            .collect();
        Ok(QaProfileView {
            // The merged definition keeps the base id; report that as base.
            base_profile_id: definition.id,
            severity_overrides: definition.severity_overrides,
            settings: definition.settings,
            enabled_rule_ids,
            block_export_on_error: overrides.block_export_on_error,
            revision: project.revision,
        })
    }

    /// The QA export gate: re-check the document (a full `qa.run`, persisted
    /// like any run) and refuse with structured `exportBlocked` data while
    /// error-severity open issues exist. Waived rows never block — waiving
    /// is exactly the recorded human decision to accept a finding.
    pub(crate) fn enforce_qa_export_gate(&mut self, document_id: &str) -> Result<(), EngineError> {
        let run = self.qa_run(QaRunParams {
            document_id: document_id.to_string(),
        })?;
        let blocking: Vec<&QaIssue> = run
            .issues
            .iter()
            .filter(|issue| {
                issue.status == QaIssueStatus::Open && issue.severity == QaSeverity::Error
            })
            .collect();
        if blocking.is_empty() {
            return Ok(());
        }
        let mut rule_ids: Vec<&str> = Vec::new();
        for issue in &blocking {
            if !rule_ids.contains(&issue.rule_id.as_str()) {
                rule_ids.push(&issue.rule_id);
            }
            if rule_ids.len() == 3 {
                break;
            }
        }
        Err(EngineError::QaGateBlocked {
            message: format!(
                "{} error-severity QA issue(s) are open; first rules: {}",
                blocking.len(),
                rule_ids.join(", ")
            ),
            data: serde_json::json!({
                "reason": "qaGate",
                "openErrors": blocking.len(),
                "ruleIds": rule_ids,
            }),
        })
    }

    /// `qa.waive`: record a human decision on findings. Waiving flips open
    /// issues to waived (with an optional, never-required note); restoring
    /// flips waived issues back to open. It writes only QA rows — never the
    /// segment, never the TM — because the findings are still true; the
    /// user is only saying they accept them.
    ///
    /// Three selector granularities, exactly one per call (PRD ③): one
    /// issue by id, every issue of a rule within one document, or every
    /// issue of one segment. Granularity is operation semantics, not
    /// storage semantics: each affected row records its own waiver, all in
    /// one transaction. The per-issue path keeps its strict conflicts
    /// (waiving a resolved issue, restoring a non-waived one); the batch
    /// paths skip rows already in the requested state — a second "ignore
    /// all of these" is a no-op, not an error.
    pub(crate) fn qa_waive(&mut self, params: QaWaiveParams) -> Result<QaWaiveResult, EngineError> {
        // An empty or whitespace note is a valid "no note", not an error.
        let note = params
            .note
            .as_deref()
            .map(str::trim)
            .filter(|note| !note.is_empty())
            .map(str::to_string);
        let mut selectors = 0;
        for present in [
            params.issue_id.is_some(),
            params.rule_id.is_some(),
            params.segment_id.is_some(),
        ] {
            if present {
                selectors += 1;
            }
        }
        if selectors != 1 {
            return Err(EngineError::InvalidParams(
                "provide exactly one selector: issueId, ruleId + documentId, or segmentId"
                    .to_string(),
            ));
        }
        if params.document_id.is_some() && params.rule_id.is_none() {
            return Err(EngineError::InvalidParams(
                "documentId only scopes ruleId".to_string(),
            ));
        }

        let mut issues: Vec<QaIssue> = if let Some(issue_id) = &params.issue_id {
            let issue = self
                .store
                .qa_issue_by_id(issue_id)?
                .ok_or_else(|| EngineError::NotFound(format!("QA issue {issue_id}")))?;
            if params.waived && issue.status == QaIssueStatus::Resolved {
                return Err(EngineError::Conflict(
                    "issue is already resolved; there is nothing left to waive".to_string(),
                ));
            }
            if !params.waived && issue.status != QaIssueStatus::Waived {
                return Err(EngineError::Conflict(
                    "issue is not waived; there is nothing to restore".to_string(),
                ));
            }
            vec![issue]
        } else if let Some(rule_id) = &params.rule_id {
            let document_id = params.document_id.as_deref().ok_or_else(|| {
                EngineError::InvalidParams("ruleId requires documentId".to_string())
            })?;
            let record = self.require_document(document_id)?;
            let mut rows = self
                .store
                .document_qa_issues_page(&record.document.id, 0, None)?;
            rows.retain(|issue| &issue.rule_id == rule_id);
            rows
        } else {
            let segment_id = params.segment_id.as_deref().expect("selector checked");
            if self.store.segment(segment_id)?.is_none() {
                return Err(EngineError::NotFound(format!("segment {segment_id}")));
            }
            self.store.segment_qa_issues(segment_id)?
        };

        // Batch semantics: only rows the call actually flips (open → waived
        // or waived → open) are touched; resolved rows and rows already in
        // the requested state stay as they are. The per-issue path already
        // rejected its conflicts above, and waiving an already-waived issue
        // by id still updates the note.
        let per_issue = params.issue_id.is_some();
        let now = now_ms();
        issues.retain_mut(|issue| {
            let flip = if params.waived {
                issue.status == QaIssueStatus::Open
                    || (per_issue && issue.status == QaIssueStatus::Waived)
            } else {
                issue.status == QaIssueStatus::Waived
            };
            if !flip {
                return false;
            }
            if params.waived {
                issue.status = QaIssueStatus::Waived;
                issue.waive_note = note.clone();
            } else {
                issue.status = QaIssueStatus::Open;
                issue.waive_note = None;
            }
            issue.updated_at_ms = now;
            true
        });
        self.store.apply(&StateDelta {
            qa_issues: issues.clone(),
            ..Default::default()
        })?;
        sort_issues(&mut issues);
        Ok(QaWaiveResult { issues })
    }

    /// `qa.fix.list`: the engine-proposed corrections for a document's open
    /// issues, recomputed from each segment's current target text — never
    /// persisted, so a fix can never go stale silently. A finding whose
    /// rule has no mechanical fix, whose text was already edited, or whose
    /// segment is locked is honestly absent from the list.
    pub(crate) fn qa_fix_list(
        &self,
        params: QaFixListParams,
    ) -> Result<QaFixListResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        let issues = self
            .store
            .document_qa_issues_page(&record.document.id, 0, None)?;
        // One store read per segment, however many issues it carries.
        let mut segments: BTreeMap<String, Segment> = BTreeMap::new();
        let mut fixes = Vec::new();
        for issue in issues {
            if issue.status != QaIssueStatus::Open {
                continue;
            }
            if !segments.contains_key(&issue.segment_id) {
                let segment = self.store.segment(&issue.segment_id)?.ok_or_else(|| {
                    EngineError::Internal(format!(
                        "QA issue {} references missing segment {}",
                        issue.id, issue.segment_id
                    ))
                })?;
                segments.insert(issue.segment_id.clone(), segment);
            }
            let segment = segments
                .get(&issue.segment_id)
                .expect("segment just cached");
            if segment.locked {
                continue;
            }
            let Some(correction) =
                propose_correction(&issue.rule_id, &segment.source_text, &segment.target_text)
            else {
                continue;
            };
            fixes.push(QaFix {
                issue_id: issue.id,
                segment_id: issue.segment_id.clone(),
                rule_id: issue.rule_id,
                base_revision: segment.revision,
                current_target_text: segment.target_text.clone(),
                fixed_target_text: correction.fixed_target_text,
                description: correction.description,
            });
        }
        Ok(QaFixListResult { fixes })
    }

    /// `qa.fix.apply`: apply one engine-proposed correction through the
    /// exact `segment.update` guards — stale `baseRevision` conflicts,
    /// locked segments conflict, and a confirmed segment honestly returns
    /// to draft (the state is recomputed from the new text, same as an
    /// edit). The correction is recomputed from the current text here; the
    /// client never supplies replacement text. The rewritten segment and
    /// its refreshed QA rows commit in one transaction (the S3a channel).
    /// Applying never confirms and never writes TM.
    pub(crate) fn qa_fix_apply(
        &mut self,
        params: QaFixApplyParams,
    ) -> Result<QaFixApplyResult, EngineError> {
        let issue = self
            .store
            .qa_issue_by_id(&params.issue_id)?
            .ok_or_else(|| EngineError::NotFound(format!("QA issue {}", params.issue_id)))?;
        if issue.status != QaIssueStatus::Open {
            return Err(EngineError::Conflict(
                "issue is not open; there is nothing to fix".to_string(),
            ));
        }
        let mut segment = self
            .store
            .segment(&issue.segment_id)?
            .ok_or_else(|| EngineError::NotFound(format!("segment {}", issue.segment_id)))?;
        if segment.revision != params.base_revision {
            return Err(EngineError::Conflict(format!(
                "segment revision moved to {}; refresh before editing",
                segment.revision
            )));
        }
        if segment.locked {
            return Err(EngineError::Conflict(
                "segment is locked; unlock it before editing".to_string(),
            ));
        }
        let correction =
            propose_correction(&issue.rule_id, &segment.source_text, &segment.target_text)
                .ok_or_else(|| {
                    EngineError::Conflict(
                        "finding has no engine correction for the current text".to_string(),
                    )
                })?;
        let project = {
            let record = self.require_document(&segment.document_id)?;
            self.require_project(&record.document.project_id)?.clone()
        };
        let now = now_ms();
        segment.target_text = correction.fixed_target_text;
        segment.state = if segment.target_text.trim().is_empty() {
            SegmentState::Untranslated
        } else {
            SegmentState::Draft
        };
        // A correction rewrote the text without applying stored material:
        // plain-edit origin semantics, same as typing.
        apply_origin_rules(&mut segment, None, true);
        segment.revision += 1;
        segment.updated_at_ms = now;
        let (changed_issues, qa_issues) = self.refresh_segment_qa(&project, &segment)?;
        self.store.apply(&StateDelta {
            segments: vec![segment.clone()],
            qa_issues: changed_issues,
            ..Default::default()
        })?;
        Ok(QaFixApplyResult { segment, qa_issues })
    }

    /// One page of a document's issues straight from SQL — open first, then
    /// waived, then resolved, each oldest first — plus the honest pre-page
    /// total. Omitting `limit` returns every issue, as before.
    pub(crate) fn qa_list(&self, params: QaListParams) -> Result<QaListResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        if params.limit == Some(0) {
            return Err(EngineError::InvalidParams(
                "limit must be at least 1".to_string(),
            ));
        }
        let issues = self.store.document_qa_issues_page(
            &record.document.id,
            params.offset.unwrap_or(0),
            params.limit,
        )?;
        let total = self.store.document_qa_issue_count(&record.document.id)?;
        Ok(QaListResult { issues, total })
    }

    /// Term expectations for one source text over a prefetched entry set
    /// (see [`Engine::attached_term_entries`]), restricted to translations
    /// in the project target language.
    fn term_expectations(
        term_entries: &[TermEntry],
        target_locale: &str,
        source_text: &str,
    ) -> Vec<QaTermExpectation> {
        let mut expectations = Vec::new();
        let mut seen = BTreeSet::new();
        for hit in Self::term_hits(term_entries, source_text) {
            if !seen.insert(hit.entry_id.clone()) {
                continue;
            }
            let preferred_targets: Vec<String> = hit
                .translations
                .iter()
                .filter(|translation| {
                    translation.preferred
                        && !translation.forbidden
                        && same_language(&translation.locale, target_locale)
                })
                .map(|translation| translation.term.clone())
                .collect();
            let forbidden_targets: Vec<String> = hit
                .translations
                .iter()
                .filter(|translation| {
                    translation.forbidden && same_language(&translation.locale, target_locale)
                })
                .map(|translation| translation.term.clone())
                .collect();
            if preferred_targets.is_empty() && forbidden_targets.is_empty() {
                continue;
            }
            expectations.push(QaTermExpectation {
                id: hit.entry_id,
                source_term: hit.source_term,
                preferred_targets,
                forbidden_targets,
            });
        }
        expectations
    }
}

/// Fold rule candidates into a persisted issue map by fingerprint: reopen
/// or refresh matching rows (respecting the waiver rule), insert new open
/// rows for unseen fingerprints. Returns the fingerprints seen this pass;
/// `changed_ids` collects every row the fold touched. Shared by the full
/// document run and the confirm-time segment refresh.
fn fold_candidates(
    issues: &mut BTreeMap<String, QaIssue>,
    candidates: Vec<QaFindingCandidate>,
    now: i64,
    changed_ids: &mut BTreeSet<String>,
) -> BTreeSet<String> {
    let mut id_by_fingerprint: BTreeMap<String, String> = BTreeMap::new();
    for (id, issue) in issues.iter() {
        id_by_fingerprint
            .entry(issue.fingerprint.clone())
            .or_insert_with(|| id.clone());
    }
    let mut current_fingerprints = BTreeSet::new();
    for candidate in candidates {
        current_fingerprints.insert(candidate.fingerprint.clone());
        match id_by_fingerprint.get(&candidate.fingerprint) {
            Some(id) => {
                let issue = issues.get_mut(id).expect("issue id just indexed");
                let evidence = map_evidence(candidate.evidence);
                // The waiver rule: the exact finding the user accepted
                // (same fingerprint, same evidence) stays waived across
                // runs. Built-in fingerprints hash the evidence, so a
                // fingerprint match implies an evidence match; the
                // explicit comparison keeps the rule honest even if a
                // future rule ever fingerprints differently.
                if issue.status == QaIssueStatus::Waived && issue.evidence == evidence {
                    continue;
                }
                if issue.status == QaIssueStatus::Waived {
                    // Same fingerprint but different evidence: the
                    // waiver no longer applies; drop its note and reopen.
                    issue.waive_note = None;
                }
                issue.status = QaIssueStatus::Open;
                issue.severity = candidate.severity;
                issue.message = candidate.message;
                issue.evidence = evidence;
                issue.params = candidate.params;
                issue.updated_at_ms = now;
                changed_ids.insert(id.clone());
            }
            None => {
                let issue = QaIssue {
                    id: new_id(),
                    segment_id: candidate.segment_id,
                    rule_id: candidate.rule_id,
                    severity: candidate.severity,
                    status: QaIssueStatus::Open,
                    message: candidate.message,
                    fingerprint: candidate.fingerprint,
                    evidence: map_evidence(candidate.evidence),
                    params: candidate.params,
                    waive_note: None,
                    created_at_ms: now,
                    updated_at_ms: now,
                };
                id_by_fingerprint.insert(issue.fingerprint.clone(), issue.id.clone());
                changed_ids.insert(issue.id.clone());
                issues.insert(issue.id.clone(), issue);
            }
        }
    }
    current_fingerprints
}

/// The list order every QA read shares: open, then waived, then resolved,
/// each oldest first, then id (the same ORDER BY the store's paged read
/// uses).
fn sort_issues(issues: &mut [QaIssue]) {
    fn rank(status: QaIssueStatus) -> u8 {
        match status {
            QaIssueStatus::Open => 0,
            QaIssueStatus::Waived => 1,
            QaIssueStatus::Resolved => 2,
        }
    }
    issues.sort_by(|a, b| {
        rank(a.status)
            .cmp(&rank(b.status))
            .then(a.created_at_ms.cmp(&b.created_at_ms))
            .then(a.id.cmp(&b.id))
    });
}

fn same_language(left: &str, right: &str) -> bool {
    primary_subtag(left).eq_ignore_ascii_case(&primary_subtag(right))
}

fn primary_subtag(locale: &str) -> String {
    locale
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn map_evidence(evidence: QaCandidateEvidence) -> NumberEvidence {
    NumberEvidence {
        source_numbers: evidence.source_numbers,
        target_numbers: evidence.target_numbers,
        source_values: evidence.source_values,
        target_values: evidence.target_values,
        related_segment_ids: evidence.related_segment_ids,
    }
}
