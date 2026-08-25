//! Whole-state JSON persistence.
//!
//! Phase 1 keeps the entire engine state in memory and writes one atomic
//! `state.json` per data directory. A real storage layer can replace this
//! without touching the wire protocol.

use std::collections::BTreeMap;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tl_domain::{Document, Project, QaIssue, Segment, TmEntry};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    #[serde(default)]
    pub projects: BTreeMap<String, Project>,
    #[serde(default)]
    pub documents: BTreeMap<String, DocumentRecord>,
    #[serde(default)]
    pub segments: BTreeMap<String, Segment>,
    #[serde(default)]
    pub tm_entries: BTreeMap<String, TmEntry>,
    #[serde(default)]
    pub qa_issues: BTreeMap<String, QaIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub document: Document,
    /// Engine-managed copy of the imported source file; export re-reads it.
    pub managed_source_path: String,
    /// Segment ids in ordinal order.
    pub segment_ids: Vec<String>,
    /// Raw text that precedes each segment inside its unit. Kept so export can
    /// reassemble a paragraph from its sentence segments byte-for-byte.
    #[serde(default)]
    pub segment_leading: BTreeMap<String, String>,
}

#[derive(Debug)]
pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn open(data_dir: &Path) -> io::Result<(Self, EngineState)> {
        std::fs::create_dir_all(data_dir)?;
        let path = data_dir.join("state.json");
        let state = if path.exists() {
            let bytes = std::fs::read(&path)?;
            serde_json::from_slice(&bytes).map_err(io::Error::other)?
        } else {
            EngineState::default()
        };
        Ok((Self { path }, state))
    }

    pub fn save(&self, state: &EngineState) -> io::Result<()> {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        serde_json::to_writer_pretty(&mut temporary, state).map_err(io::Error::other)?;
        temporary.flush()?;
        temporary.as_file().sync_all()?;
        temporary.persist(&self.path).map_err(|error| error.error)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_state() {
        let directory = tempfile::tempdir().expect("tempdir");
        let (store, mut state) = Store::open(directory.path()).expect("open");
        assert!(state.projects.is_empty());
        state.projects.insert(
            "p1".to_string(),
            Project {
                id: "p1".to_string(),
                name: "Demo".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "general".to_string(),
                lifecycle: tl_domain::ProjectLifecycle::Active,
                revision: 1,
                configuration: Default::default(),
                created_at_ms: 1,
                updated_at_ms: 1,
                archived_at_ms: None,
            },
        );
        store.save(&state).expect("save");
        let (_, reloaded) = Store::open(directory.path()).expect("reopen");
        assert_eq!(reloaded.projects.len(), 1);
        assert_eq!(reloaded.projects["p1"].name, "Demo");
    }
}
