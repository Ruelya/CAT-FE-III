//! QA execution: the deterministic `tl-qa` rule library wired to documents.
//!
//! Every run evaluates the full built-in profile (completeness, numbers,
//! punctuation, whitespace, repetition, length, terminology from attached
//! termbases, and cross-segment consistency), then reconciles findings with
//! the persisted issue set by fingerprint so repeated runs stay stable and
//! fixed issues resolve.

use std::collections::BTreeSet;

use tl_domain::{NumberEvidence, QaIssue, QaIssueStatus, new_id};
use tl_protocol::{QaListParams, QaListResult, QaRunParams, QaRunResult};
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
        // One document's rows, transiently: QA inherently evaluates every
        // segment of the document it runs on.
        let segments = self
            .store
            .document_segments_page(&record.document.id, 0, None)?;
        let segment_ids: BTreeSet<String> =
            segments.iter().map(|segment| segment.id.clone()).collect();

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
                self.term_expectations(&project.id, &project.target_locale, &segment.source_text)
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

        let now = now_ms();
        let mut current_fingerprints = BTreeSet::new();
        let mut changed_issues = Vec::new();
        for candidate in candidates {
            current_fingerprints.insert(candidate.fingerprint.clone());
            let existing = self
                .state
                .qa_issues
                .values_mut()
                .find(|issue| issue.fingerprint == candidate.fingerprint);
            match existing {
                Some(issue) => {
                    issue.status = QaIssueStatus::Open;
                    issue.severity = candidate.severity;
                    issue.message = candidate.message;
                    issue.evidence = map_evidence(candidate.evidence);
                    issue.updated_at_ms = now;
                    changed_issues.push(issue.clone());
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
                        created_at_ms: now,
                        updated_at_ms: now,
                    };
                    changed_issues.push(issue.clone());
                    self.state.qa_issues.insert(issue.id.clone(), issue);
                }
            }
        }
        // Resolve issues that no longer reproduce for this document.
        for issue in self.state.qa_issues.values_mut() {
            if segment_ids.contains(issue.segment_id.as_str())
                && issue.status == QaIssueStatus::Open
                && !current_fingerprints.contains(&issue.fingerprint)
            {
                issue.status = QaIssueStatus::Resolved;
                issue.updated_at_ms = now;
                changed_issues.push(issue.clone());
            }
        }
        self.store.apply(&StateDelta {
            qa_issues: changed_issues,
            ..Default::default()
        })?;
        let issues = self.document_issues(&segment_ids);
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

    pub(crate) fn qa_list(&self, params: QaListParams) -> Result<QaListResult, EngineError> {
        let record = self.require_document(&params.document_id)?;
        // Ids only; the issue filter never needs the segment payloads.
        let segment_ids: BTreeSet<String> = self
            .store
            .document_segment_ids(&record.document.id)?
            .into_iter()
            .collect();
        Ok(QaListResult {
            issues: self.document_issues(&segment_ids),
        })
    }

    fn document_issues(&self, segment_ids: &BTreeSet<String>) -> Vec<QaIssue> {
        let mut issues: Vec<QaIssue> = self
            .state
            .qa_issues
            .values()
            .filter(|issue| segment_ids.contains(issue.segment_id.as_str()))
            .cloned()
            .collect();
        issues.sort_by(|a, b| {
            (a.status == QaIssueStatus::Resolved)
                .cmp(&(b.status == QaIssueStatus::Resolved))
                .then(a.created_at_ms.cmp(&b.created_at_ms))
                .then(a.id.cmp(&b.id))
        });
        issues
    }

    /// Term expectations for one source text from the project's termbases,
    /// restricted to translations in the project target language.
    fn term_expectations(
        &self,
        project_id: &str,
        target_locale: &str,
        source_text: &str,
    ) -> Vec<QaTermExpectation> {
        let mut expectations = Vec::new();
        let mut seen = BTreeSet::new();
        for hit in self.term_hits(project_id, source_text) {
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
