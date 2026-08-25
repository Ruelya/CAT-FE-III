//! SRX-compatible segmentation with deterministic built-in CJK profiles.
//!
//! The implementation intentionally keeps source ranges in UTF-8 byte offsets.
//! Filters can therefore replace an owned range without normalizing the rest
//! of a user's file.

use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

use quick_xml::Reader;
use quick_xml::events::Event;
use regex::Regex;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentationMode {
    Paragraph,
    Sentence,
}

impl SegmentationMode {
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("sentence") | Some("srx") => Self::Sentence,
            _ => Self::Paragraph,
        }
    }
}

#[derive(Debug, Error)]
pub enum SrxError {
    #[error("invalid SRX XML: {0}")]
    Xml(String),
    #[error("invalid SRX regular expression in {field}: {pattern}: {message}")]
    Regex {
        field: &'static str,
        pattern: String,
        message: String,
    },
    #[error("SRX rule references unknown language rule: {0}")]
    UnknownLanguageRule(String),
    #[error("SRX document has no language or map rules")]
    EmptyRules,
}

#[derive(Debug, Clone)]
struct CompiledRule {
    before: Regex,
    after: Regex,
    break_yes: bool,
}

#[derive(Debug, Clone)]
struct LanguageRule {
    name: String,
    language_pattern: String,
    rules: Vec<CompiledRule>,
}

#[derive(Debug, Clone)]
struct MapRule {
    language_pattern: String,
    rule_name: String,
}

/// Parsed SRX rules. The public API intentionally exposes only segmentation;
/// regex compilation and map precedence stay inside this crate.
#[derive(Debug, Clone)]
pub struct SrxRules {
    language_rules: Vec<LanguageRule>,
    map_rules: Vec<MapRule>,
}

impl SrxRules {
    pub fn parse(xml: &str) -> Result<Self, SrxError> {
        let mut reader = Reader::from_str(xml);
        reader.config_mut().trim_text(false);
        let mut buffer = Vec::new();
        let mut language_rules = Vec::<LanguageRule>::new();
        let mut map_rules = Vec::<MapRule>::new();
        let mut current_language: Option<usize> = None;
        let mut in_before = false;
        let mut in_after = false;
        let mut before_text = String::new();
        let mut after_text = String::new();
        let mut map_language = String::new();
        let mut map_rule_name = String::new();

        loop {
            match reader.read_event_into(&mut buffer) {
                Ok(Event::Start(element)) => {
                    let name = local_name(element.name().as_ref());
                    match name.as_str() {
                        "languagerule" => {
                            let attrs = attributes(&element).map_err(SrxError::Xml)?;
                            let rule_name =
                                attrs.get("languagerulename").cloned().ok_or_else(|| {
                                    SrxError::Xml(
                                        "languagerule is missing languagerulename".to_string(),
                                    )
                                })?;
                            let language_pattern = attrs
                                .get("languagepattern")
                                .cloned()
                                .unwrap_or_else(|| ".*".to_string());
                            language_rules.push(LanguageRule {
                                name: rule_name,
                                language_pattern,
                                rules: Vec::new(),
                            });
                            current_language = Some(language_rules.len() - 1);
                        }
                        "rule" => {
                            let attrs = attributes(&element).map_err(SrxError::Xml)?;
                            before_text.clear();
                            after_text.clear();
                            let break_yes = attrs
                                .get("break")
                                .map(|value| value.eq_ignore_ascii_case("yes"))
                                .unwrap_or(true);
                            // Store the rule's break choice in a sentinel until
                            // both child regex values have been compiled.
                            if break_yes {
                                before_text.push('\u{0}');
                            } else {
                                before_text.push('\u{1}');
                            }
                        }
                        "beforebreak" => in_before = true,
                        "afterbreak" => in_after = true,
                        "maprule" => {
                            let attrs = attributes(&element).map_err(SrxError::Xml)?;
                            map_language =
                                attrs.get("languagepattern").cloned().unwrap_or_default();
                            map_rule_name =
                                attrs.get("languagerulename").cloned().unwrap_or_default();
                        }
                        "languagemap" => {
                            let attrs = attributes(&element).map_err(SrxError::Xml)?;
                            let language_pattern =
                                attrs.get("languagepattern").cloned().unwrap_or_default();
                            let rule_name =
                                attrs.get("languagerulename").cloned().unwrap_or_default();
                            if !language_pattern.is_empty() && !rule_name.is_empty() {
                                map_rules.push(MapRule {
                                    language_pattern,
                                    rule_name,
                                });
                            }
                        }
                        _ => {}
                    }
                }
                Ok(Event::Text(text)) => {
                    let value = text
                        .decode()
                        .map_err(|error| SrxError::Xml(error.to_string()))?;
                    if in_before {
                        before_text.push_str(&value);
                    } else if in_after {
                        after_text.push_str(&value);
                    }
                }
                Ok(Event::End(element)) => {
                    let name = local_name(element.name().as_ref());
                    match name.as_str() {
                        "beforebreak" => in_before = false,
                        "afterbreak" => in_after = false,
                        "rule" => {
                            let Some(language_index) = current_language else {
                                return Err(SrxError::Xml("rule outside languagerule".to_string()));
                            };
                            let break_yes = !before_text.starts_with('\u{1}');
                            let before = before_text
                                .trim_start_matches(['\u{0}', '\u{1}'])
                                .to_string();
                            let after = after_text.clone();
                            let rule = CompiledRule {
                                before: compile_boundary_regex(&before, "beforebreak")?,
                                after: compile_start_regex(&after, "afterbreak")?,
                                break_yes,
                            };
                            language_rules[language_index].rules.push(rule);
                        }
                        "languagerule" => current_language = None,
                        "maprule" => {
                            if !map_language.is_empty() && !map_rule_name.is_empty() {
                                map_rules.push(MapRule {
                                    language_pattern: map_language.clone(),
                                    rule_name: map_rule_name.clone(),
                                });
                            }
                            map_language.clear();
                            map_rule_name.clear();
                        }
                        _ => {}
                    }
                }
                Ok(Event::Empty(element)) if local_name(element.name().as_ref()) == "maprule" => {
                    let attrs = attributes(&element).map_err(SrxError::Xml)?;
                    let language_pattern =
                        attrs.get("languagepattern").cloned().unwrap_or_default();
                    let rule_name = attrs.get("languagerulename").cloned().unwrap_or_default();
                    if !language_pattern.is_empty() && !rule_name.is_empty() {
                        map_rules.push(MapRule {
                            language_pattern,
                            rule_name,
                        });
                    }
                }
                Ok(Event::Empty(element))
                    if local_name(element.name().as_ref()) == "languagemap" =>
                {
                    let attrs = attributes(&element).map_err(SrxError::Xml)?;
                    let language_pattern =
                        attrs.get("languagepattern").cloned().unwrap_or_default();
                    let rule_name = attrs.get("languagerulename").cloned().unwrap_or_default();
                    if !language_pattern.is_empty() && !rule_name.is_empty() {
                        map_rules.push(MapRule {
                            language_pattern,
                            rule_name,
                        });
                    }
                }
                Ok(Event::Eof) => break,
                Ok(Event::CData(text)) => {
                    let value = text
                        .decode()
                        .map_err(|error| SrxError::Xml(error.to_string()))?;
                    if in_before {
                        before_text.push_str(&value);
                    } else if in_after {
                        after_text.push_str(&value);
                    }
                }
                Err(error) => return Err(SrxError::Xml(error.to_string())),
                _ => {}
            }
            buffer.clear();
        }

        if language_rules.is_empty() && map_rules.is_empty() {
            return Err(SrxError::EmptyRules);
        }
        // An SRX map can reference a name that has no matching languagerule;
        // reject it early instead of silently producing unsplit text.
        let names: BTreeSet<_> = language_rules
            .iter()
            .map(|rule| rule.name.as_str())
            .collect();
        for map in &map_rules {
            if !names.contains(map.rule_name.as_str()) {
                return Err(SrxError::UnknownLanguageRule(map.rule_name.clone()));
            }
        }
        Ok(Self {
            language_rules,
            map_rules,
        })
    }

    pub fn builtin(locale: &str) -> Self {
        let language = locale.to_ascii_lowercase();
        let pattern = if language.starts_with("zh") {
            "zh.*"
        } else if language.starts_with("ja") {
            "ja.*"
        } else if language.starts_with("ko") {
            "ko.*"
        } else {
            "en.*"
        };
        Self {
            language_rules: vec![LanguageRule {
                name: "builtin".to_string(),
                language_pattern: pattern.to_string(),
                rules: Vec::new(),
            }],
            map_rules: vec![MapRule {
                language_pattern: pattern.to_string(),
                rule_name: "builtin".to_string(),
            }],
        }
    }

    pub fn ranges(&self, text: &str, locale: &str, mode: SegmentationMode) -> Vec<Range<usize>> {
        if text.is_empty() {
            return Vec::new();
        }
        if mode == SegmentationMode::Paragraph {
            return paragraph_ranges(text);
        }
        let rule = self.select_rule(locale);
        if rule.name == "builtin" && rule.rules.is_empty() {
            return builtin_sentence_ranges(text, locale);
        }
        srx_sentence_ranges(text, rule)
    }

    fn select_rule(&self, locale: &str) -> &LanguageRule {
        let mut selected: Option<&LanguageRule> = None;
        for map in &self.map_rules {
            if wildcard_match(&map.language_pattern, locale)
                && let Some(rule) = self
                    .language_rules
                    .iter()
                    .find(|rule| rule.name == map.rule_name)
            {
                selected = Some(rule);
                break;
            }
        }
        selected
            .or_else(|| {
                self.language_rules
                    .iter()
                    .find(|rule| wildcard_match(&rule.language_pattern, locale))
            })
            .unwrap_or_else(|| &self.language_rules[0])
    }
}

pub fn segment_text(text: &str, locale: &str, mode: SegmentationMode) -> Vec<Range<usize>> {
    SrxRules::builtin(locale).ranges(text, locale, mode)
}

fn paragraph_ranges(text: &str) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut paragraph_start = None;
    let mut line_start = 0;
    for line_end in text
        .match_indices('\n')
        .map(|(index, _)| index + 1)
        .chain(std::iter::once(text.len()))
    {
        let line = &text[line_start..line_end];
        if line.trim().is_empty() {
            if let Some(start) = paragraph_start.take() {
                ranges.push(start..line_start);
            }
        } else if paragraph_start.is_none() {
            paragraph_start = Some(line_start);
        }
        line_start = line_end;
    }
    if let Some(start) = paragraph_start {
        ranges.push(start..text.len());
    }
    if ranges.is_empty() && !text.trim().is_empty() {
        ranges.push(0..text.len());
    }
    ranges
}

fn builtin_sentence_ranges(text: &str, locale: &str) -> Vec<Range<usize>> {
    let mut boundaries = Vec::new();
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    for (position, character) in &chars {
        if !is_terminal(*character) {
            continue;
        }
        let end = position + character.len_utf8();
        let left = &text[..end];
        let right = &text[end..];
        if is_no_break(text, *position, end, left, right, locale) {
            continue;
        }
        let mut boundary = end;
        while boundary < text.len() {
            let next = text[boundary..].chars().next().unwrap_or_default();
            if !next.is_whitespace() {
                break;
            }
            boundary += next.len_utf8();
        }
        boundaries.push(boundary);
    }
    ranges_from_boundaries(text, boundaries)
}

fn srx_sentence_ranges(text: &str, rule: &LanguageRule) -> Vec<Range<usize>> {
    let mut boundaries = Vec::new();
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    for (position, character) in &chars {
        let end = position + character.len_utf8();
        let left = &text[..end];
        let right = &text[end..];
        let mut decision = None;
        for candidate in &rule.rules {
            if candidate.before.is_match(left) && candidate.after.is_match(right) {
                decision = Some(candidate.break_yes);
                break;
            }
        }
        if decision == Some(true) {
            let mut boundary = end;
            while boundary < text.len() {
                let next = text[boundary..].chars().next().unwrap_or_default();
                if !next.is_whitespace() {
                    break;
                }
                boundary += next.len_utf8();
            }
            boundaries.push(boundary);
        }
    }
    ranges_from_boundaries(text, boundaries)
}

fn ranges_from_boundaries(text: &str, boundaries: Vec<usize>) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut start = 0;
    for boundary in boundaries {
        if boundary > start && !text[start..boundary].trim().is_empty() {
            ranges.push(start..boundary);
            start = boundary;
        }
    }
    if start < text.len() && !text[start..].trim().is_empty() {
        ranges.push(start..text.len());
    }
    if ranges.is_empty() && !text.trim().is_empty() {
        ranges.push(0..text.len());
    }
    ranges
}

fn is_terminal(character: char) -> bool {
    matches!(character, '.' | '!' | '?' | '。' | '！' | '？' | '．' | '｡')
}

fn is_no_break(
    text: &str,
    position: usize,
    end: usize,
    left: &str,
    right: &str,
    _locale: &str,
) -> bool {
    let before = text[..position].chars().next_back();
    let after = text[end..].chars().next();
    if before.is_some_and(|value| value.is_ascii_digit())
        && after.is_some_and(|value| value.is_ascii_digit())
    {
        return true;
    }
    let token = left.split_whitespace().next_back().unwrap_or_default();
    let normalized = token.trim_matches(|value: char| value == '(' || value == '[');
    const ABBREVIATIONS: &[&str] = &[
        "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "Sr.", "Jr.", "e.g.", "i.e.", "etc.", "vs.", "U.S.",
        "No.",
    ];
    if ABBREVIATIONS
        .iter()
        .any(|item| normalized.eq_ignore_ascii_case(item))
    {
        return true;
    }
    let left_token = left
        .rsplit_once(char::is_whitespace)
        .map_or(left, |(_, value)| value);
    let right_token = right
        .split_once(char::is_whitespace)
        .map_or(right, |(value, _)| value);
    let surrounding_token = format!("{left_token}{right_token}");
    surrounding_token.contains("://") || surrounding_token.starts_with("www.")
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase();
    let value = value.to_ascii_lowercase();
    if pattern == "*" || pattern == ".*" {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix(".*") {
        return value == prefix || value.starts_with(&format!("{prefix}-"));
    }
    pattern == value
}

fn compile_boundary_regex(pattern: &str, field: &'static str) -> Result<Regex, SrxError> {
    Regex::new(&format!("(?:{pattern})$")).map_err(|error| SrxError::Regex {
        field,
        pattern: pattern.to_string(),
        message: error.to_string(),
    })
}

fn compile_start_regex(pattern: &str, field: &'static str) -> Result<Regex, SrxError> {
    Regex::new(&format!("^(?:{pattern})")).map_err(|error| SrxError::Regex {
        field,
        pattern: pattern.to_string(),
        message: error.to_string(),
    })
}

fn local_name(value: &[u8]) -> String {
    let value = std::str::from_utf8(value).unwrap_or_default();
    value
        .rsplit(':')
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase()
}

fn attributes(
    element: &quick_xml::events::BytesStart<'_>,
) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    for attribute in element.attributes().with_checks(false) {
        let attribute = attribute.map_err(|error| error.to_string())?;
        let key = local_name(attribute.key.as_ref());
        let value = attribute
            .normalized_value(quick_xml::XmlVersion::Implicit1_0)
            .map_err(|error| error.to_string())?
            .into_owned();
        result.insert(key, value);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_preserve_offsets_and_abbreviations() {
        let text = "Dr. Smith arrived. 这是第一句。第二句！";
        let ranges = segment_text(text, "en-US", SegmentationMode::Sentence);
        let values: Vec<_> = ranges.iter().map(|range| &text[range.clone()]).collect();
        assert_eq!(values, ["Dr. Smith arrived. ", "这是第一句。", "第二句！"]);
        assert!(ranges.iter().all(|range| text.is_char_boundary(range.start)
            && text.is_char_boundary(range.end)));
    }

    #[test]
    fn paragraph_mode_keeps_blank_lines_with_previous_unit() {
        let ranges = segment_text("one\n\ntwo\n", "en", SegmentationMode::Paragraph);
        assert_eq!(ranges, [0..4, 5..9]);
    }

    #[test]
    fn parses_custom_srx_and_honors_no_break() {
        let xml = r#"<srx version="2.0"><header/><body>
          <languagerules><languagerule languagerulename="en" languagepattern="en.*">
            <rule break="no"><beforebreak>Mr\.</beforebreak><afterbreak>\s+[A-Z]</afterbreak></rule>
            <rule break="yes"><beforebreak>[.!?]</beforebreak><afterbreak>\s+[A-Z]</afterbreak></rule>
          </languagerule></languagerules>
          <maprules><maprule languagerulename="en" languagepattern="en.*"/></maprules>
        </body></srx>"#;
        let rules = SrxRules::parse(xml).expect("parse SRX");
        let text = "Mr. Smith. Next.";
        let ranges = rules.ranges(text, "en-US", SegmentationMode::Sentence);
        assert_eq!(
            ranges
                .iter()
                .map(|range| &text[range.clone()])
                .collect::<Vec<_>>(),
            ["Mr. Smith. ", "Next."]
        );
    }

    #[test]
    fn parses_standard_srx_languagemap_container() {
        let xml = r#"<srx version="2.0"><header/><body>
          <languagerules><languagerule languagerulename="English">
            <rule break="yes"><beforebreak>[.!?]</beforebreak><afterbreak>\s+[A-Z]</afterbreak></rule>
          </languagerule></languagerules>
          <maprules><maprule maprulename="Default">
            <languagemap languagepattern="en.*" languagerulename="English"/>
          </maprule></maprules>
        </body></srx>"#;
        let rules = SrxRules::parse(xml).expect("parse standard SRX");
        let text = "One. Two.";
        let ranges = rules.ranges(text, "en-US", SegmentationMode::Sentence);
        assert_eq!(
            ranges
                .iter()
                .map(|range| &text[range.clone()])
                .collect::<Vec<_>>(),
            ["One. ", "Two."]
        );
    }

    #[test]
    fn malformed_regex_is_typed() {
        let xml = r#"<srx><body><languagerules><languagerule languagerulename="x">
          <rule><beforebreak>[</beforebreak><afterbreak>.</afterbreak></rule>
        </languagerule></languagerules></body></srx>"#;
        assert!(matches!(SrxRules::parse(xml), Err(SrxError::Regex { .. })));
    }
}
