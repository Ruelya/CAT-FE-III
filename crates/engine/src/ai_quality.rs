use translunar_ai_quality_core::{
    QualitySegment, extract_terms as extract_terms_core, score_document as score_document_core,
    semantic_qa_document as semantic_qa_core,
};
use translunar_protocol::{
    AiQualityDocumentParams, AiQualityScoreResult, AiSemanticQaResult, AiTermExtractParams,
    AiTermExtractResult,
};

use crate::{EngineError, EngineService, Result};

impl EngineService {
    pub fn score_document_quality(
        &self,
        params: AiQualityDocumentParams,
    ) -> Result<AiQualityScoreResult> {
        let segments = self.quality_segments(&params.document_id)?;
        score_document_core(params.document_id, &segments).map_err(map_error)
    }

    pub fn run_semantic_qa(&self, params: AiQualityDocumentParams) -> Result<AiSemanticQaResult> {
        let segments = self.quality_segments(&params.document_id)?;
        semantic_qa_core(params.document_id, &segments).map_err(map_error)
    }

    pub fn extract_document_terms(
        &self,
        params: AiTermExtractParams,
    ) -> Result<AiTermExtractResult> {
        let segments = self.quality_segments(&params.document_id)?;
        let options = params.options();
        extract_terms_core(params.document_id, &segments, options).map_err(map_error)
    }

    fn quality_segments(&self, document_id: &str) -> Result<Vec<QualitySegment>> {
        let _document = self.store.get_document(document_id)?;
        let segments = self.store.all_segments(document_id)?;
        Ok(segments
            .into_iter()
            .map(|segment| QualitySegment {
                segment_id: segment.id,
                ordinal: segment.ordinal,
                source_text: segment.source_text,
                target_text: segment.target_text,
            })
            .collect())
    }
}

fn map_error(error: translunar_ai_quality_core::AiQualityError) -> EngineError {
    EngineError::InvalidRequest(error.to_string())
}
