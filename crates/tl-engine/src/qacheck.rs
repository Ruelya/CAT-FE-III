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
use tl_domain::{NumberEvidence, QaIssue, QaIssueStatus, new_id};
use tl_protocol::{
    QaListParams, QaListResult, QaRunParams, QaRunResult, QaWaiveParams, QaWaiveResult,
};
use tl_qa::{
    CompiledQaProfile, QaCandidateEvidence, QaConsistencySegment, QaFindingCandidate,
    QaSegmentInput, QaTermExpectation, built_in_profiles, default_profile_id, evaluate_consistency,
};

use crate::store::StateDelta;
use crate::{Engine, EngineError, now_ms};

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

        let profiles = built_in_profiles();
        let profile_id = project
            .configuration
            .qa_profile_id
            .as_deref()
            .filter(|id| profiles.iter().any(|profile| profile.id == *id))
            .unwrap_or_else(|| default_profile_id(&project.target_locale));
        let definition = profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned()
            .ok_or_else(|| EngineError::Internal(format!("missing QA profile {profile_id}")))?;
        let profile = CompiledQaProfile::compile(definition.clone())
            .map_err(|error| EngineError::Internal(error.to_string()))?;

        let mut checked = 0_u32;
        let mut candidates: Vec<QaFindingCandidate> = Vec::new();
        let mut consistency_inputs = Vec::new();
        for segment in &segments {
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
        let mut id_by_fingerprint: BTreeMap<String, String> = BTreeMap::new();
        for (id, issue) in &issues {
            id_by_fingerprint
                .entry(issue.fingerprint.clone())
                .or_insert_with(|| id.clone());
        }

        let now = now_ms();
        let mut current_fingerprints = BTreeSet::new();
        let mut changed_ids: BTreeSet<String> = BTreeSet::new();
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
        // Resolve issues that no longer reproduce for this document. This
        // covers waived rows too: when the evidence behind a waiver changes
        // or the finding disappears, the waiver has run its course (any
        // still-mismatching evidence opened a fresh issue above).
        for issue in issues.values_mut() {
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

    /// `qa.waive`: record a human decision on one issue. Waiving flips an
    /// open issue to waived (with an optional, never-required note);
    /// restoring flips a waived issue back to open. It writes exactly one
    /// QA row — never the segment, never the TM — because the finding is
    /// still true; the user is only saying they accept it.
    pub(crate) fn qa_waive(&mut self, params: QaWaiveParams) -> Result<QaWaiveResult, EngineError> {
        let mut issue = self
            .store
            .qa_issue_by_id(&params.issue_id)?
            .ok_or_else(|| EngineError::NotFound(format!("QA issue {}", params.issue_id)))?;
        // An empty or whitespace note is a valid "no note", not an error.
        let note = params
            .note
            .as_deref()
            .map(str::trim)
            .filter(|note| !note.is_empty())
            .map(str::to_string);
        if params.waived {
            if issue.status == QaIssueStatus::Resolved {
                return Err(EngineError::Conflict(
                    "issue is already resolved; there is nothing left to waive".to_string(),
                ));
            }
            // Waiving an already-waived issue just updates the note.
            issue.status = QaIssueStatus::Waived;
            issue.waive_note = note;
        } else {
            if issue.status != QaIssueStatus::Waived {
                return Err(EngineError::Conflict(
                    "issue is not waived; there is nothing to restore".to_string(),
                ));
            }
            issue.status = QaIssueStatus::Open;
            issue.waive_note = None;
        }
        issue.updated_at_ms = now_ms();
        self.store.apply(&StateDelta {
            qa_issues: vec![issue.clone()],
            ..Default::default()
        })?;
        Ok(QaWaiveResult { issue })
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
