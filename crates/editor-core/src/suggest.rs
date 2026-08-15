//! Candidate assembly for as-you-type suggestions.
//!
//! The host merges everything it already knows about the current segment into
//! one ranked list, so the renderer only has to draw it. Doing the merge here
//! rather than in the UI keeps ordering, de-duplication and the casing policy
//! identical no matter which surface asks, and keeps the work off the thread
//! that has to stay responsive between keystrokes.

use std::collections::BTreeSet;

/// Where a candidate came from. Order matters: it is the tie-breaker.
///
/// This crate stays free of wire concerns; `translunar-protocol` owns the
/// serialised shape and converts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SuggestionSource {
    /// Numbers, dates, URLs, e-mail, product codes lifted from the source.
    /// First because they are never a judgement call: copying them is right.
    NonTranslatable,
    /// A term the project has decided on. Second because consistency is the
    /// whole reason the termbase exists.
    Term,
    /// A fragment of a translation memory unit that starts with what was typed.
    MemoryFragment,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Suggestion {
    pub text: String,
    pub source: SuggestionSource,
    /// What the candidate is for, shown next to it: the source term, or the
    /// sentence a fragment came from.
    pub hint: String,
}

/// A candidate before ranking.
#[derive(Debug, Clone)]
pub struct SuggestionCandidate {
    pub text: String,
    pub source: SuggestionSource,
    pub hint: String,
}

/// Longest prefix of `text` that the caret word could be completing.
///
/// Only the current word is considered. Suggesting a completion for something
/// the translator finished typing three words ago is noise, and in CJK there
/// are no spaces to bound a word, so the prefix is capped by length instead.
pub fn caret_prefix(text: &str, caret: usize, max_chars: usize) -> String {
    let characters: Vec<char> = text.chars().collect();
    let caret = caret.min(characters.len());
    let mut start = caret;
    while start > 0 {
        let candidate = characters[start - 1];
        if candidate.is_whitespace() || caret - start >= max_chars {
            break;
        }
        start -= 1;
    }
    characters[start..caret].iter().collect()
}

fn matches_prefix(candidate: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        return false;
    }
    if candidate.len() <= prefix.len() && candidate.eq_ignore_ascii_case(prefix) {
        // An exact repeat of what is already typed is not a completion.
        return false;
    }
    let candidate_lower = candidate.to_lowercase();
    let prefix_lower = prefix.to_lowercase();
    candidate_lower.starts_with(&prefix_lower)
}

/// Extract the placeables of a source sentence: things that must survive
/// translation unchanged and are tedious and error-prone to retype.
pub fn non_translatables(source: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut current = String::new();
    let push_current = |current: &mut String, found: &mut Vec<String>| {
        let token = current.trim_matches(|c: char| c.is_ascii_punctuation() && c != '@');
        let is_placeable = token.chars().any(|c| c.is_ascii_digit())
            || token.contains('@')
            || token.contains("://");
        if is_placeable && token.len() > 1 && !found.iter().any(|existing| existing == token) {
            found.push(token.to_string());
        }
        current.clear();
    };
    for character in source.chars() {
        if character.is_whitespace() {
            push_current(&mut current, &mut found);
        } else {
            current.push(character);
        }
    }
    push_current(&mut current, &mut found);
    found
}

/// Split a memory unit's target into the fragments that could complete a word.
///
/// Whole-word prefixes only: offering a completion that starts mid-word
/// produces suggestions no reader can parse.
pub fn memory_fragments(target: &str, max_words: usize) -> Vec<String> {
    let words: Vec<&str> = target.split_whitespace().collect();
    let mut fragments = Vec::new();
    if words.is_empty() {
        // CJK targets have no spaces; the whole clause is the only fragment
        // worth offering, bounded so the list stays readable.
        let trimmed = target.trim();
        if !trimmed.is_empty() {
            fragments.push(trimmed.chars().take(40).collect::<String>());
        }
        return fragments;
    }
    for start in 0..words.len() {
        for length in 1..=max_words.min(words.len() - start) {
            fragments.push(words[start..start + length].join(" "));
        }
    }
    fragments
}

/// Rank, de-duplicate and cap the candidate list.
///
/// De-duplication is case-insensitive on the text alone: the same completion
/// reached from two sources is one completion, and it keeps the source that
/// ranks highest, because that is the one whose hint is most worth reading.
pub fn rank_suggestions(
    candidates: Vec<SuggestionCandidate>,
    prefix: &str,
    limit: usize,
) -> Vec<Suggestion> {
    let mut ordered: Vec<SuggestionCandidate> = candidates
        .into_iter()
        .filter(|candidate| matches_prefix(&candidate.text, prefix))
        .collect();
    ordered.sort_by(|left, right| {
        left.source
            .cmp(&right.source)
            .then_with(|| left.text.chars().count().cmp(&right.text.chars().count()))
            .then_with(|| left.text.cmp(&right.text))
    });

    let mut seen = BTreeSet::new();
    let mut result = Vec::new();
    for candidate in ordered {
        if !seen.insert(candidate.text.to_lowercase()) {
            continue;
        }
        result.push(Suggestion {
            text: candidate.text,
            source: candidate.source,
            hint: candidate.hint,
        });
        if result.len() >= limit {
            break;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caret_prefix_reads_only_the_word_being_typed() {
        assert_eq!(caret_prefix("hello wor", 9, 32), "wor");
        assert_eq!(caret_prefix("hello wor", 5, 32), "hello");
        assert_eq!(caret_prefix("hello ", 6, 32), "");
    }

    #[test]
    fn caret_prefix_is_bounded_for_scripts_without_spaces() {
        // Chinese has no word boundaries, so the cap is what keeps the prefix
        // from growing into the whole sentence.
        let text = "电池容量为一千零二十四瓦时";
        assert_eq!(
            caret_prefix(text, text.chars().count(), 4).chars().count(),
            4
        );
    }

    #[test]
    fn non_translatables_pick_up_numbers_urls_and_addresses() {
        let found = non_translatables(
            "Contact support@example.com before 2026-12-31 about the 1,024 Wh unit.",
        );
        assert!(found.contains(&"support@example.com".to_string()));
        assert!(found.contains(&"2026-12-31".to_string()));
        assert!(found.contains(&"1,024".to_string()));
        // Plain words are not placeables.
        assert!(!found.iter().any(|item| item == "about"));
    }

    #[test]
    fn memory_fragments_are_whole_words() {
        let fragments = memory_fragments("press the power button", 2);
        assert!(fragments.contains(&"power button".to_string()));
        assert!(fragments.contains(&"press".to_string()));
        // Never a partial word.
        assert!(!fragments.iter().any(|item| item == "pow"));
    }

    #[test]
    fn ranking_prefers_placeables_then_terms_then_memory() {
        let ranked = rank_suggestions(
            vec![
                SuggestionCandidate {
                    text: "power station".into(),
                    source: SuggestionSource::MemoryFragment,
                    hint: "tm".into(),
                },
                SuggestionCandidate {
                    text: "power supply".into(),
                    source: SuggestionSource::Term,
                    hint: "term".into(),
                },
                SuggestionCandidate {
                    text: "power".into(),
                    source: SuggestionSource::NonTranslatable,
                    hint: "source".into(),
                },
            ],
            "pow",
            10,
        );
        assert_eq!(
            ranked.iter().map(|item| item.source).collect::<Vec<_>>(),
            vec![
                SuggestionSource::NonTranslatable,
                SuggestionSource::Term,
                SuggestionSource::MemoryFragment,
            ]
        );
    }

    #[test]
    fn what_is_already_typed_is_not_a_completion() {
        let ranked = rank_suggestions(
            vec![SuggestionCandidate {
                text: "power".into(),
                source: SuggestionSource::Term,
                hint: "term".into(),
            }],
            "power",
            10,
        );
        assert!(ranked.is_empty());
    }

    #[test]
    fn the_same_completion_from_two_sources_appears_once() {
        let ranked = rank_suggestions(
            vec![
                SuggestionCandidate {
                    text: "Power Station".into(),
                    source: SuggestionSource::MemoryFragment,
                    hint: "tm".into(),
                },
                SuggestionCandidate {
                    text: "power station".into(),
                    source: SuggestionSource::Term,
                    hint: "term".into(),
                },
            ],
            "pow",
            10,
        );
        assert_eq!(ranked.len(), 1);
        // The higher-ranked source wins, because its hint is the useful one.
        assert_eq!(ranked[0].source, SuggestionSource::Term);
    }

    #[test]
    fn matching_ignores_case_so_sentence_starts_still_complete() {
        let ranked = rank_suggestions(
            vec![SuggestionCandidate {
                text: "battery capacity".into(),
                source: SuggestionSource::Term,
                hint: "term".into(),
            }],
            "Batt",
            10,
        );
        assert_eq!(ranked.len(), 1);
    }
}
