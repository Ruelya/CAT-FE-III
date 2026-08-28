//! AI provider plumbing: profile construction, prompts, and completion calls.

use std::sync::atomic::AtomicBool;

use tl_ai::{
    AiCoreError, AiEventSink, AiMessage, AiProviderProfile, GroundingContextSegment,
    GroundingDocumentPair, GroundingInput, GroundingOptions, GroundingTerm, GroundingTmMatch,
    ProviderCompletion, ProviderRequest, SecretString, build_grounded_prompt,
    provider_descriptor,
};
use tl_protocol::{AiAssistAction, AiConfigureParams};

#[derive(Debug)]
pub struct AiRuntime {
    pub profile: AiProviderProfile,
    pub credential: SecretString,
}

/// The reserved profile id `ai.configure` upserts (its single-slot
/// semantics), leaving `ai.profile.add` entries untouched.
pub const CONFIGURE_PROFILE_ID: &str = "default";

/// One termbase hit injected into a drafting prompt. Only real hits from
/// mounted termbases travel here — the model is never asked to invent
/// terminology.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptTerm {
    pub source: String,
    pub target: String,
    pub forbidden: bool,
}

pub fn build_runtime(params: AiConfigureParams, now_ms: i64) -> Result<AiRuntime, AiCoreError> {
    build_profile_runtime(
        params.provider,
        params.model,
        params.base_url,
        params.api_key,
        CONFIGURE_PROFILE_ID.to_string(),
        "默认配置".to_string(),
        now_ms,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn build_profile_runtime(
    provider: tl_ai::AiProviderKind,
    model: String,
    base_url: Option<String>,
    api_key: String,
    id: String,
    label: String,
    now_ms: i64,
) -> Result<AiRuntime, AiCoreError> {
    let descriptor = provider_descriptor(provider);
    let base_url = base_url
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(descriptor.default_base_url);
    let profile = AiProviderProfile {
        id,
        name: label,
        kind: provider,
        base_url,
        model,
        timeout_ms: 60_000,
        max_response_bytes: 4 * 1024 * 1024,
        enabled: true,
        credential_present: true,
        revision: 1,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
    };
    profile.validate()?;
    let credential = SecretString::new(api_key)?;
    Ok(AiRuntime {
        profile,
        credential,
    })
}

/// Real per-segment grounding resolved on the engine thread. Every item is
/// engine truth: TM matches come from the project's enabled mounts, context
/// and document pairs from the segment's own document. Empty vectors stay
/// empty — the prompt builder omits those sections instead of inventing them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SegmentGrounding {
    pub tm_matches: Vec<GroundingTmMatch>,
    pub context: Vec<GroundingContextSegment>,
    pub document_sample: Vec<GroundingDocumentPair>,
}

/// The shared translator persona for assist and agent drafting — one set of
/// copy, rendered by [`build_grounded_prompt`] into the style section.
const DRAFTING_SYSTEM_INSTRUCTION: &str =
    "You are a precise professional translator working inside a CAT tool. \
     Preserve numbers, placeholders, and inline markers exactly. \
     Output only the target-language text with no commentary.";

/// The one prompt path for assist and agent drafting: everything flows
/// through [`tl_ai::build_grounded_prompt`], so both features share the same
/// sections (task, tags, terms, TM examples, style, neighbours, document
/// pairs, active segment) and the same honest `max_chars` truncation.
pub fn grounded_messages(
    action: AiAssistAction,
    instruction: Option<&str>,
    source_locale: &str,
    target_locale: &str,
    source_text: &str,
    current_target: &str,
    terms: &[PromptTerm],
    grounding: SegmentGrounding,
) -> Result<Vec<AiMessage>, AiCoreError> {
    let input = GroundingInput {
        source_locale: source_locale.to_string(),
        target_locale: target_locale.to_string(),
        source_text: source_text.to_string(),
        current_target: current_target.to_string(),
        action: match action {
            AiAssistAction::Translate => "translate".to_string(),
            AiAssistAction::Refine => "refine".to_string(),
        },
        freeform_prompt: instruction
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string(),
        tag_skeleton: tl_ai::placeholder_tokens(source_text),
        terms: terms
            .iter()
            .map(|term| GroundingTerm {
                source: term.source.clone(),
                target: term.target.clone(),
                preferred: !term.forbidden,
                forbidden: term.forbidden,
            })
            .collect(),
        tm_matches: grounding.tm_matches,
        corpus_matches: Vec::new(),
        context: grounding.context,
        document_sample: grounding.document_sample,
    };
    let options = GroundingOptions {
        system_instruction: DRAFTING_SYSTEM_INSTRUCTION.to_string(),
        ..GroundingOptions::default()
    };
    Ok(build_grounded_prompt(&input, &options)?.messages)
}

struct DiscardSink;

impl AiEventSink for DiscardSink {
    fn delta(&mut self, _text: &str) -> Result<(), AiCoreError> {
        Ok(())
    }
}

pub fn run_completion(
    profile: &AiProviderProfile,
    credential: &SecretString,
    messages: Vec<AiMessage>,
    source_text: &str,
    source_locale: &str,
    target_locale: &str,
    cancellation: &AtomicBool,
) -> Result<ProviderCompletion, AiCoreError> {
    let request = ProviderRequest {
        profile: profile.clone(),
        messages,
        source_text: source_text.to_string(),
        source_locale: source_locale.to_string(),
        target_locale: target_locale.to_string(),
    };
    tl_ai::execute_provider(&request, credential, cancellation, &mut DiscardSink)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translate_prompt_carries_locales_source_and_instruction() {
        let messages = grounded_messages(
            AiAssistAction::Translate,
            Some("Keep brand names in English."),
            "en-US",
            "zh-CN",
            "Hello world.",
            "",
            &[],
            SegmentGrounding::default(),
        )
        .expect("build grounded prompt");
        assert_eq!(messages.len(), 2);
        assert!(messages[0].text.contains("en-US"));
        assert!(messages[0].text.contains("zh-CN"));
        assert!(messages[1].text.contains("Hello world."));
        assert!(messages[1].text.contains("Keep brand names in English."));
    }

    #[test]
    fn prompt_injects_only_real_termbase_hits() {
        let messages = grounded_messages(
            AiAssistAction::Translate,
            None,
            "en-US",
            "zh-CN",
            "The server restarts.",
            "",
            &[
                PromptTerm {
                    source: "server".to_string(),
                    target: "服务器".to_string(),
                    forbidden: false,
                },
                PromptTerm {
                    source: "server".to_string(),
                    target: "伺服器".to_string(),
                    forbidden: true,
                },
            ],
            SegmentGrounding::default(),
        )
        .expect("build grounded prompt");
        let system = &messages[0].text;
        assert!(system.contains("Terminology"));
        assert!(system.contains("服务器"));
        assert!(system.contains("伺服器"));
        assert!(system.contains("\"forbidden\":true"));
    }

    #[test]
    fn prompt_carries_real_tm_context_and_document_pairs() {
        let grounding = SegmentGrounding {
            tm_matches: vec![GroundingTmMatch {
                source: "Close the valve.".to_string(),
                target: "关闭阀门。".to_string(),
                score: 88,
                provenance: "主记忆库 · fuzzy".to_string(),
            }],
            context: vec![
                GroundingContextSegment {
                    relative: -1,
                    source: "Open the panel.".to_string(),
                    target: "打开面板。".to_string(),
                },
                GroundingContextSegment {
                    relative: 1,
                    source: "Restart the pump.".to_string(),
                    target: String::new(),
                },
            ],
            document_sample: vec![GroundingDocumentPair {
                source: "Check the seal.".to_string(),
                target: "检查密封件。".to_string(),
            }],
        };
        let messages = grounded_messages(
            AiAssistAction::Translate,
            None,
            "en-US",
            "zh-CN",
            "Close the main valve.",
            "",
            &[],
            grounding,
        )
        .expect("build grounded prompt");
        let system = &messages[0].text;
        assert!(system.contains("Translation memory examples"));
        assert!(system.contains("关闭阀门。"));
        assert!(system.contains("主记忆库 · fuzzy"));
        assert!(system.contains("Document context"));
        assert!(system.contains("打开面板。"));
        assert!(system.contains("Restart the pump."));
        assert!(system.contains("Confirmed pairs from this document"));
        assert!(system.contains("检查密封件。"));
    }

    #[test]
    fn empty_grounding_never_fabricates_sections() {
        let messages = grounded_messages(
            AiAssistAction::Translate,
            None,
            "en-US",
            "zh-CN",
            "Hello world.",
            "",
            &[],
            SegmentGrounding::default(),
        )
        .expect("build grounded prompt");
        let system = &messages[0].text;
        assert!(!system.contains("Translation memory examples"));
        assert!(!system.contains("Document context"));
        assert!(!system.contains("Confirmed pairs from this document"));
        assert!(!system.contains("Terminology"));
    }

    #[test]
    fn runtime_requires_valid_credential() {
        let error = build_runtime(
            AiConfigureParams {
                provider: tl_ai::AiProviderKind::Openai,
                model: "gpt-test".to_string(),
                base_url: None,
                api_key: "   ".to_string(),
            },
            1,
        )
        .expect_err("blank key is rejected");
        assert!(matches!(error, AiCoreError::InvalidCredential));
    }
}
