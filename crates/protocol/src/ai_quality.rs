//! Wire contracts for offline QE, semantic QA, and term extraction.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use translunar_ai_quality_core::{
    QualityScoreReport, SemanticQaReport, TermExtractOptions, TermExtractReport,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiQualityDocumentParams {
    pub document_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiTermExtractParams {
    pub document_id: String,
    #[serde(default)]
    pub minimum_frequency: Option<u32>,
    #[serde(default)]
    pub maximum_candidates: Option<u32>,
}

impl AiTermExtractParams {
    pub fn options(&self) -> TermExtractOptions {
        let defaults = TermExtractOptions::default();
        TermExtractOptions {
            minimum_frequency: self.minimum_frequency.unwrap_or(defaults.minimum_frequency),
            maximum_candidates: self
                .maximum_candidates
                .unwrap_or(defaults.maximum_candidates),
        }
    }
}

pub type AiQualityScoreResult = QualityScoreReport;
pub type AiSemanticQaResult = SemanticQaReport;
pub type AiTermExtractResult = TermExtractReport;
