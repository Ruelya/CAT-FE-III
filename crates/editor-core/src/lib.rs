use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use ferrous_opencc::{OpenCC, config::BuiltinConfig};
use regex::{Regex, RegexBuilder};
use thiserror::Error;
use translunar_domain::{
    ChineseConversionProfile, EditorTagIssue, InlineTag, SpellFinding, TagKind, TagSide,
};
use unicode_normalization::UnicodeNormalization;

const MAX_PATTERN_BYTES: usize = 512;
const MAX_MATCHES_PER_SEGMENT: usize = 10_000;

static WORD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?u)[\p{Alphabetic}][\p{Alphabetic}\p{Mark}'’-]{1,63}")
        .expect("valid editor word regex")
});
static CJK_LATIN_GAP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}][A-Za-z0-9]|[A-Za-z0-9][\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}])")
        .expect("valid CJK spacing regex")
});
static FULL_WIDTH_PUNCTUATION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[，。！？：；（）【】]").expect("valid punctuation regex"));

#[derive(Debug, Error)]
pub enum EditorCoreError {
    #[error("search query must not be empty")]
    EmptyQuery,
    #[error("search pattern exceeds {MAX_PATTERN_BYTES} bytes")]
    PatternTooLarge,
    #[error("invalid search expression: {0}")]
    InvalidRegex(String),
    #[error("replacement produced too many matches")]
    TooManyMatches,
    #[error("OpenCC conversion is unavailable: {0}")]
    ChineseConversion(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SearchOptions {
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextMatch {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

pub fn convert_chinese(
    text: &str,
    profile: ChineseConversionProfile,
) -> Result<String, EditorCoreError> {
    let config = match profile {
        ChineseConversionProfile::SimplifiedToTraditional => BuiltinConfig::S2t,
        ChineseConversionProfile::SimplifiedToTaiwan => BuiltinConfig::S2twp,
        ChineseConversionProfile::SimplifiedToHongKong => BuiltinConfig::S2hk,
        ChineseConversionProfile::TraditionalToSimplified => BuiltinConfig::T2s,
        ChineseConversionProfile::TaiwanToSimplified => BuiltinConfig::Tw2sp,
        ChineseConversionProfile::HongKongToSimplified => BuiltinConfig::Hk2s,
    };
    let converter = OpenCC::from_config(config)
        .map_err(|error| EditorCoreError::ChineseConversion(error.to_string()))?;
    Ok(converter.convert(text))
}

pub fn find_text_matches(
    text: &str,
    query: &str,
    options: SearchOptions,
) -> Result<Vec<TextMatch>, EditorCoreError> {
    let expression = build_expression(query, options)?;
    let matches = expression
        .find_iter(text)
        .take(MAX_MATCHES_PER_SEGMENT + 1)
        .map(|found| TextMatch {
            start: found.start(),
            end: found.end(),
            text: found.as_str().to_string(),
        })
        .collect::<Vec<_>>();
    if matches.len() > MAX_MATCHES_PER_SEGMENT {
        return Err(EditorCoreError::TooManyMatches);
    }
    Ok(matches)
}

pub fn replace_text(
    text: &str,
    query: &str,
    replacement: &str,
    options: SearchOptions,
) -> Result<(String, u32), EditorCoreError> {
    let expression = build_expression(query, options)?;
    let count = expression
        .find_iter(text)
        .take(MAX_MATCHES_PER_SEGMENT + 1)
        .count();
    if count > MAX_MATCHES_PER_SEGMENT {
        return Err(EditorCoreError::TooManyMatches);
    }
    let output = if options.regex {
        expression.replace_all(text, replacement).into_owned()
    } else {
        expression
            .replace_all(text, regex::NoExpand(replacement))
            .into_owned()
    };
    Ok((output, u32::try_from(count).unwrap_or(u32::MAX)))
}

fn build_expression(query: &str, options: SearchOptions) -> Result<Regex, EditorCoreError> {
    if query.is_empty() {
        return Err(EditorCoreError::EmptyQuery);
    }
    if query.len() > MAX_PATTERN_BYTES {
        return Err(EditorCoreError::PatternTooLarge);
    }
    let mut pattern = if options.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    if options.whole_word {
        pattern = format!(r"(?u:\b(?:{pattern})\b)");
    }
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .unicode(true)
        .size_limit(1 << 20)
        .dfa_size_limit(1 << 20)
        .build()
        .map_err(|error| EditorCoreError::InvalidRegex(error.to_string()))
}

pub fn validate_target_tags(
    source_tags: &[InlineTag],
    target_tags: &[InlineTag],
    target: &str,
) -> Vec<EditorTagIssue> {
    let mut issues = Vec::new();
    let target_chars = target.chars().count();
    let mut expected = BTreeMap::<TagSignature, usize>::new();
    let mut actual = BTreeMap::<TagSignature, usize>::new();
    for tag in source_tags {
        *expected.entry(TagSignature::from(tag)).or_default() += 1;
    }
    for tag in target_tags {
        if tag.side != TagSide::Target {
            issues.push(tag_issue(
                "tag_wrong_side",
                "Target tag must use the target side.",
                Some(tag),
            ));
        }
        if usize::try_from(tag.position).map_or(true, |position| position > target_chars) {
            issues.push(tag_issue(
                "tag_position_out_of_range",
                "Target tag position is outside the target text.",
                Some(tag),
            ));
        }
        *actual.entry(TagSignature::from(tag)).or_default() += 1;
    }

    for (signature, expected_count) in &expected {
        let actual_count = actual.get(signature).copied().unwrap_or_default();
        for _ in actual_count..*expected_count {
            issues.push(EditorTagIssue {
                code: "tag_missing".to_string(),
                message: format!("Missing protected tag {}.", signature.display_text),
                tag_id: None,
                position: None,
            });
        }
    }
    for (signature, actual_count) in &actual {
        let expected_count = expected.get(signature).copied().unwrap_or_default();
        for _ in expected_count..*actual_count {
            issues.push(EditorTagIssue {
                code: "tag_extra".to_string(),
                message: format!("Unexpected protected tag {}.", signature.display_text),
                tag_id: None,
                position: None,
            });
        }
    }

    let mut ordered = target_tags.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|tag| tag.position);
    let mut open_pairs = Vec::<String>::new();
    for tag in ordered {
        let Some(pair_id) = tag.pair_id.as_ref() else {
            continue;
        };
        match tag.kind {
            TagKind::Start => open_pairs.push(pair_id.clone()),
            TagKind::End => {
                if open_pairs.last() == Some(pair_id) {
                    open_pairs.pop();
                } else {
                    issues.push(tag_issue(
                        "tag_pair_order",
                        "Paired target tags are crossed or out of order.",
                        Some(tag),
                    ));
                }
            }
            TagKind::Standalone => {}
        }
    }
    if !open_pairs.is_empty() {
        issues.push(EditorTagIssue {
            code: "tag_pair_incomplete".to_string(),
            message: "One or more paired target tags are not closed.".to_string(),
            tag_id: None,
            position: None,
        });
    }
    issues
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct TagSignature {
    kind: u8,
    pair_id: String,
    payload: String,
    display_text: String,
}

impl From<&InlineTag> for TagSignature {
    fn from(tag: &InlineTag) -> Self {
        Self {
            kind: match tag.kind {
                TagKind::Start => 0,
                TagKind::End => 1,
                TagKind::Standalone => 2,
            },
            pair_id: tag.pair_id.clone().unwrap_or_default(),
            payload: tag.payload.clone(),
            display_text: tag.display_text.clone(),
        }
    }
}

fn tag_issue(code: &str, message: &str, tag: Option<&InlineTag>) -> EditorTagIssue {
    EditorTagIssue {
        code: code.to_string(),
        message: message.to_string(),
        tag_id: tag.map(|value| value.id.clone()),
        position: tag.map(|value| value.position),
    }
}

pub fn normalize_dictionary_word(value: &str) -> String {
    value.nfkc().collect::<String>().trim().to_lowercase()
}

pub fn spell_word_spans(text: &str) -> Vec<TextMatch> {
    WORD_RE
        .find_iter(text)
        .filter(|word| {
            normalize_dictionary_word(word.as_str())
                .chars()
                .all(|character| character.is_ascii_alphabetic())
        })
        .map(|word| TextMatch {
            start: word.start(),
            end: word.end(),
            text: word.as_str().to_string(),
        })
        .collect()
}

pub fn check_user_dictionary(
    text: &str,
    user_words: &BTreeSet<String>,
    limit: usize,
) -> Vec<SpellFinding> {
    spell_word_spans(text)
        .into_iter()
        .filter(|word| {
            let normalized = normalize_dictionary_word(&word.text);
            !user_words.contains(&normalized)
                && !COMMON_ENGLISH_WORDS.contains(&normalized.as_str())
        })
        .take(limit)
        .map(|word| SpellFinding {
            word: word.text,
            start: u32::try_from(text[..word.start].chars().count()).unwrap_or(u32::MAX),
            end: u32::try_from(text[..word.end].chars().count()).unwrap_or(u32::MAX),
            suggestions: Vec::new(),
            provider: "builtin-fallback".to_string(),
        })
        .collect()
}

pub fn cjk_assistance(text: &str, limit: usize) -> Vec<SpellFinding> {
    let mut findings = Vec::new();
    for item in CJK_LATIN_GAP_RE.find_iter(text) {
        findings.push(SpellFinding {
            word: item.as_str().to_string(),
            start: u32::try_from(text[..item.start()].chars().count()).unwrap_or(u32::MAX),
            end: u32::try_from(text[..item.end()].chars().count()).unwrap_or(u32::MAX),
            suggestions: vec![
                item.as_str()
                    .chars()
                    .map(|character| character.to_string())
                    .collect::<Vec<_>>()
                    .join(" "),
            ],
            provider: "cjk-spacing".to_string(),
        });
        if findings.len() >= limit {
            return findings;
        }
    }
    for item in FULL_WIDTH_PUNCTUATION_RE.find_iter(text) {
        findings.push(SpellFinding {
            word: item.as_str().to_string(),
            start: u32::try_from(text[..item.start()].chars().count()).unwrap_or(u32::MAX),
            end: u32::try_from(text[..item.end()].chars().count()).unwrap_or(u32::MAX),
            suggestions: Vec::new(),
            provider: "cjk-punctuation".to_string(),
        });
        if findings.len() >= limit {
            break;
        }
    }
    findings
}

const COMMON_ENGLISH_WORDS: &[&str] = &[
    "about",
    "after",
    "again",
    "also",
    "and",
    "are",
    "before",
    "can",
    "contact",
    "delivery",
    "document",
    "for",
    "from",
    "has",
    "have",
    "invoice",
    "keep",
    "number",
    "project",
    "service",
    "starts",
    "the",
    "this",
    "translation",
    "unchanged",
    "window",
    "with",
    "you",
    "your",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(id: &str, kind: TagKind, pair_id: Option<&str>, position: u32) -> InlineTag {
        InlineTag {
            id: id.to_string(),
            side: TagSide::Source,
            position,
            kind,
            pair_id: pair_id.map(str::to_string),
            payload: format!("<{id}>"),
            display_text: id.to_string(),
            protected: true,
        }
    }

    #[test]
    fn literal_replace_does_not_expand_dollar_sequences() {
        let (output, count) = replace_text(
            "cost $5 and $5",
            "$5",
            "$10",
            SearchOptions {
                regex: false,
                case_sensitive: true,
                whole_word: false,
            },
        )
        .expect("literal replace");
        assert_eq!(output, "cost $10 and $10");
        assert_eq!(count, 2);
    }

    #[test]
    fn validates_tag_membership_and_pair_order() {
        let source = vec![
            tag("start", TagKind::Start, Some("p"), 0),
            tag("end", TagKind::End, Some("p"), 4),
        ];
        let mut target = source.clone();
        for tag in &mut target {
            tag.side = TagSide::Target;
        }
        assert!(validate_target_tags(&source, &target, "text").is_empty());
        target.swap(0, 1);
        target[0].position = 0;
        target[1].position = 4;
        assert!(
            validate_target_tags(&source, &target, "text")
                .iter()
                .any(|issue| issue.code == "tag_pair_order")
        );

        let mut collapsed_pair = source.clone();
        for tag in &mut collapsed_pair {
            tag.side = TagSide::Target;
            tag.position = 0;
        }
        assert!(validate_target_tags(&source, &collapsed_pair, "text").is_empty());
    }

    #[test]
    fn finds_cjk_spacing_boundaries() {
        let findings = cjk_assistance("版本v2已发布", 10);
        assert!(findings.iter().any(|item| item.provider == "cjk-spacing"));
    }

    #[test]
    fn converts_chinese_with_opencc_phrase_profiles() {
        assert_eq!(
            convert_chinese(
                "鼠标和打印机里的软件",
                ChineseConversionProfile::SimplifiedToTaiwan,
            )
            .expect("convert simplified Chinese to Taiwan usage"),
            "滑鼠和印表機裡的軟體"
        );
        assert_eq!(
            convert_chinese(
                "滑鼠和印表機裡的軟體",
                ChineseConversionProfile::TaiwanToSimplified,
            )
            .expect("convert Taiwan usage to simplified Chinese"),
            "鼠标和打印机里的软件"
        );
    }
}
