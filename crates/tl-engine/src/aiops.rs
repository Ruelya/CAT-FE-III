//! AI provider plumbing: profile construction, prompts, and completion calls.

use std::sync::atomic::AtomicBool;

use tl_ai::{
    AiCoreError, AiEventSink, AiMessage, AiMessageRole, AiProviderProfile, ProviderCompletion,
    ProviderRequest, SecretString, provider_descriptor,
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

pub fn assist_messages(
    action: AiAssistAction,
    instruction: Option<&str>,
    source_locale: &str,
    target_locale: &str,
    source_text: &str,
    current_target: &str,
    terms: &[PromptTerm],
) -> Vec<AiMessage> {
    let mut system = String::from(
        "You are a precise professional translator working inside a CAT tool. \
         Preserve numbers, placeholders, and inline markers exactly. \
         Output only the target-language text with no commentary.",
    );
    if let Some(instruction) = instruction.map(str::trim).filter(|value| !value.is_empty()) {
        system.push_str("\nProject instruction: ");
        system.push_str(instruction);
    }
    if !terms.is_empty() {
        system.push_str(
            "\nTerminology from the project termbase (authoritative; never invent terms):",
        );
        for term in terms {
            if term.forbidden {
                system.push_str(&format!(
                    "\n- \"{}\": never translate as \"{}\" (forbidden)",
                    term.source, term.target
                ));
            } else {
                system.push_str(&format!(
                    "\n- \"{}\" must be translated as \"{}\"",
                    term.source, term.target
                ));
            }
        }
    }
    let user = match action {
        AiAssistAction::Translate => format!(
            "Translate the following {source_locale} text into {target_locale}:\n\n{source_text}"
        ),
        AiAssistAction::Refine => format!(
            "Improve the following {target_locale} translation of a {source_locale} source.\n\
             Source:\n{source_text}\n\nCurrent translation:\n{current_target}\n\n\
             Return only the improved translation."
        ),
    };
    vec![
        AiMessage {
            role: AiMessageRole::System,
            text: system,
        },
        AiMessage {
            role: AiMessageRole::User,
            text: user,
        },
    ]
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
    fn translate_prompt_carries_locales_and_source() {
        let messages = assist_messages(
            AiAssistAction::Translate,
            Some("Keep brand names in English."),
            "en-US",
            "zh-CN",
            "Hello world.",
            "",
            &[],
        );
        assert_eq!(messages.len(), 2);
        assert!(messages[0].text.contains("Keep brand names in English."));
        assert!(!messages[0].text.contains("Terminology"));
        assert!(messages[1].text.contains("en-US"));
        assert!(messages[1].text.contains("zh-CN"));
        assert!(messages[1].text.contains("Hello world."));
    }

    #[test]
    fn prompt_injects_only_real_termbase_hits() {
        let messages = assist_messages(
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
        );
        let system = &messages[0].text;
        assert!(system.contains("\"server\" must be translated as \"服务器\""));
        assert!(system.contains("never translate as \"伺服器\" (forbidden)"));
        assert!(system.contains("never invent terms"));
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
