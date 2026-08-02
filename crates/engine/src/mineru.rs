//! MinerU HTTP OCR client for the PDF document import path.
//!
//! Credentials live in the OS keyring service `translunar-cat.mineru` (or an
//! in-memory store when `TRANSLUNAR_MINERU_TEST_MODE=1`). Secrets are never
//! written to SQLite, project files, or log messages.

use std::collections::BTreeMap;
use std::env;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use translunar_domain::{DegradationFinding, DegradationSeverity, DocumentNote};
use translunar_filter_core::{DocumentMetadata, ImportedDocument, ImportedUnit};
use translunar_filter_pdf::{PdfPath, count_page_tree, segment_pdf_text};

/// OS keyring service name for the MinerU API token.
pub const MINERU_CREDENTIAL_SERVICE: &str = "translunar-cat.mineru";
pub const MINERU_CREDENTIAL_ACCOUNT: &str = "default";

/// Opt-in value for the in-memory credential backend (CI/tests).
pub const MINERU_TEST_MODE_OPT_IN: &str = "1";

const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 120_000;
const MAX_REQUEST_TIMEOUT_MS: u64 = 600_000;
/// Cloud MinerU documents are capped at 200 pages / 200 MiB; keep the same bounds.
const DEFAULT_MAX_PAGES: u32 = 200;
const DEFAULT_MAX_BYTES: u64 = 200 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const DEFAULT_PAGE_WIDTH_PTS: f64 = 612.0;
const DEFAULT_PAGE_HEIGHT_PTS: f64 = 792.0;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum MinerUError {
    #[error("MinerU API key is not configured")]
    MissingCredential,

    #[error("MinerU credential storage is unavailable")]
    CredentialUnavailable,

    #[error("MinerU configuration is invalid: {0}")]
    Config(String),

    #[error("document exceeds MinerU limit ({resource}: limit {limit}, actual {actual})")]
    ResourceLimit {
        resource: &'static str,
        limit: u64,
        actual: u64,
    },

    #[error("MinerU request timed out")]
    Timeout,

    #[error("MinerU service is unavailable")]
    Unavailable,

    #[error("MinerU authentication failed")]
    Authentication,

    #[error("MinerU response could not be parsed")]
    Protocol,

    #[error("MinerU returned no translatable text")]
    EmptyResult,

    #[error("MinerU I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

pub trait MinerUCredentialStore: Send + Sync {
    fn backend(&self) -> &'static str;
    fn status(&self) -> Result<bool, MinerUError>;
    fn get(&self) -> Result<String, MinerUError>;
    fn set(&self, secret: &str) -> Result<(), MinerUError>;
    fn delete(&self) -> Result<(), MinerUError>;
}

#[derive(Default)]
pub struct MemoryMinerUCredentialStore {
    value: Mutex<Option<String>>,
}

impl fmt::Debug for MemoryMinerUCredentialStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Never print the raw credential via derived Debug.
        f.debug_struct("MemoryMinerUCredentialStore")
            .field("value", &"[REDACTED]")
            .finish()
    }
}

impl MemoryMinerUCredentialStore {
    pub fn with_secret(secret: Option<String>) -> Self {
        Self {
            value: Mutex::new(secret.filter(|value| !value.trim().is_empty())),
        }
    }
}

impl MinerUCredentialStore for MemoryMinerUCredentialStore {
    fn backend(&self) -> &'static str {
        "test-memory"
    }

    fn status(&self) -> Result<bool, MinerUError> {
        let guard = self
            .value
            .lock()
            .map_err(|_| MinerUError::CredentialUnavailable)?;
        Ok(guard.is_some())
    }

    fn get(&self) -> Result<String, MinerUError> {
        self.value
            .lock()
            .map_err(|_| MinerUError::CredentialUnavailable)?
            .clone()
            .ok_or(MinerUError::MissingCredential)
    }

    fn set(&self, secret: &str) -> Result<(), MinerUError> {
        let trimmed = secret.trim();
        if trimmed.is_empty() {
            return Err(MinerUError::Config(
                "MinerU API key must not be empty".to_string(),
            ));
        }
        if trimmed.chars().any(char::is_whitespace) {
            return Err(MinerUError::Config(
                "MinerU API key must not contain whitespace".to_string(),
            ));
        }
        // Bound length so we never push huge secrets into keyring/memory.
        if trimmed.len() > 8_192 {
            return Err(MinerUError::Config(
                "MinerU API key exceeds the 8192-byte limit".to_string(),
            ));
        }
        *self
            .value
            .lock()
            .map_err(|_| MinerUError::CredentialUnavailable)? = Some(trimmed.to_string());
        Ok(())
    }

    fn delete(&self) -> Result<(), MinerUError> {
        *self
            .value
            .lock()
            .map_err(|_| MinerUError::CredentialUnavailable)? = None;
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct KeyringMinerUCredentialStore;

impl KeyringMinerUCredentialStore {
    fn entry() -> Result<Entry, MinerUError> {
        Entry::new(MINERU_CREDENTIAL_SERVICE, MINERU_CREDENTIAL_ACCOUNT)
            .map_err(|_| MinerUError::CredentialUnavailable)
    }
}

impl MinerUCredentialStore for KeyringMinerUCredentialStore {
    fn backend(&self) -> &'static str {
        "os-keyring"
    }

    fn status(&self) -> Result<bool, MinerUError> {
        match Self::entry()?.get_password() {
            Ok(value) if !value.trim().is_empty() => Ok(true),
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err(MinerUError::CredentialUnavailable),
        }
    }

    fn get(&self) -> Result<String, MinerUError> {
        match Self::entry()?.get_password() {
            Ok(value) if !value.trim().is_empty() => Ok(value),
            Ok(_) | Err(keyring::Error::NoEntry) => Err(MinerUError::MissingCredential),
            Err(_) => Err(MinerUError::CredentialUnavailable),
        }
    }

    fn set(&self, secret: &str) -> Result<(), MinerUError> {
        let trimmed = secret.trim();
        if trimmed.is_empty() {
            return Err(MinerUError::Config(
                "MinerU API key must not be empty".to_string(),
            ));
        }
        if trimmed.chars().any(char::is_whitespace) {
            return Err(MinerUError::Config(
                "MinerU API key must not contain whitespace".to_string(),
            ));
        }
        if trimmed.len() > 8_192 {
            return Err(MinerUError::Config(
                "MinerU API key exceeds the 8192-byte limit".to_string(),
            ));
        }
        Self::entry()?
            .set_password(trimmed)
            .map_err(|_| MinerUError::CredentialUnavailable)
    }

    fn delete(&self) -> Result<(), MinerUError> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(MinerUError::CredentialUnavailable),
        }
    }
}

pub fn mineru_test_mode_enabled() -> bool {
    matches!(
        env::var("TRANSLUNAR_MINERU_TEST_MODE").ok().as_deref(),
        Some(v) if v == MINERU_TEST_MODE_OPT_IN
    )
}

fn default_credential_store() -> Arc<dyn MinerUCredentialStore> {
    if mineru_test_mode_enabled() {
        Arc::new(MemoryMinerUCredentialStore::with_secret(
            env::var("TRANSLUNAR_MINERU_TEST_API_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty()),
        ))
    } else {
        Arc::new(KeyringMinerUCredentialStore)
    }
}

// ---------------------------------------------------------------------------
// Config + transport
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct MinerUConfig {
    pub base_url: Option<String>,
    pub connect_timeout: Duration,
    pub request_timeout: Duration,
    pub max_pages: u32,
    pub max_bytes: u64,
}

impl Default for MinerUConfig {
    fn default() -> Self {
        Self {
            base_url: None,
            connect_timeout: Duration::from_millis(DEFAULT_CONNECT_TIMEOUT_MS),
            request_timeout: Duration::from_millis(DEFAULT_REQUEST_TIMEOUT_MS),
            max_pages: DEFAULT_MAX_PAGES,
            max_bytes: DEFAULT_MAX_BYTES,
        }
    }
}

impl MinerUConfig {
    pub fn from_env() -> Result<Self, MinerUError> {
        let mut config = Self::default();
        if let Ok(base) = env::var("TRANSLUNAR_MINERU_BASE_URL") {
            let base = base.trim().trim_end_matches('/').to_string();
            if !base.is_empty() {
                validate_base_url(&base)?;
                config.base_url = Some(base);
            }
        }
        if let Ok(value) = env::var("TRANSLUNAR_MINERU_TIMEOUT_MS") {
            let ms = value.parse::<u64>().map_err(|_| {
                MinerUError::Config("TRANSLUNAR_MINERU_TIMEOUT_MS must be an integer".into())
            })?;
            if !(1_000..=MAX_REQUEST_TIMEOUT_MS).contains(&ms) {
                return Err(MinerUError::Config(format!(
                    "TRANSLUNAR_MINERU_TIMEOUT_MS must be in 1000..{MAX_REQUEST_TIMEOUT_MS}"
                )));
            }
            config.request_timeout = Duration::from_millis(ms);
            config.connect_timeout = Duration::from_millis(ms.min(DEFAULT_CONNECT_TIMEOUT_MS));
        }
        if let Ok(value) = env::var("TRANSLUNAR_MINERU_MAX_PAGES") {
            let pages = value.parse::<u32>().map_err(|_| {
                MinerUError::Config("TRANSLUNAR_MINERU_MAX_PAGES must be an integer".into())
            })?;
            if !(1..=2_000).contains(&pages) {
                return Err(MinerUError::Config(
                    "TRANSLUNAR_MINERU_MAX_PAGES must be in 1..2000".into(),
                ));
            }
            config.max_pages = pages;
        }
        if let Ok(value) = env::var("TRANSLUNAR_MINERU_MAX_BYTES") {
            let bytes = value.parse::<u64>().map_err(|_| {
                MinerUError::Config("TRANSLUNAR_MINERU_MAX_BYTES must be an integer".into())
            })?;
            if !(1_024..=DEFAULT_MAX_BYTES).contains(&bytes) {
                return Err(MinerUError::Config(format!(
                    "TRANSLUNAR_MINERU_MAX_BYTES must be in 1024..{DEFAULT_MAX_BYTES}"
                )));
            }
            config.max_bytes = bytes;
        }
        Ok(config)
    }

    pub fn is_configured(&self) -> bool {
        self.base_url
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty())
    }
}

fn validate_base_url(base: &str) -> Result<(), MinerUError> {
    if base.len() > 2_048 || base.contains('\0') || base.contains(char::is_whitespace) {
        return Err(MinerUError::Config(
            "TRANSLUNAR_MINERU_BASE_URL is invalid".into(),
        ));
    }
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err(MinerUError::Config(
            "TRANSLUNAR_MINERU_BASE_URL must start with http:// or https://".into(),
        ));
    }
    Ok(())
}

/// Inputs for a single MinerU parse call.
#[derive(Clone)]
pub struct MinerUParseRequest {
    pub source: PathBuf,
    pub file_name: String,
    /// Bearer token; redacted in Debug (never log this field).
    pub api_key: String,
    pub parse_method: String,
    pub language: String,
    pub start_page: u32,
    pub end_page: Option<u32>,
}

impl fmt::Debug for MinerUParseRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MinerUParseRequest")
            .field("source", &self.source)
            .field("file_name", &self.file_name)
            .field("api_key", &"[REDACTED]")
            .field("parse_method", &self.parse_method)
            .field("language", &self.language)
            .field("start_page", &self.start_page)
            .field("end_page", &self.end_page)
            .finish()
    }
}

/// Presence/backend only — never includes the secret material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerUCredentialStatus {
    pub available: bool,
    pub present: bool,
    pub backend: String,
}

/// Structured layout block after mapping from MinerU content_list.
#[derive(Debug, Clone, PartialEq)]
pub struct MinerULayoutBlock {
    pub page: u32,
    pub order: u32,
    pub kind: String,
    pub text: String,
    pub bbox: (f64, f64, f64, f64),
    pub confidence: u16,
}

/// Trait so unit/smoke tests can inject fixture responses without live HTTP.
pub trait MinerUTransport: Send + Sync {
    fn parse(
        &self,
        request: &MinerUParseRequest,
        config: &MinerUConfig,
    ) -> Result<Vec<MinerULayoutBlock>, MinerUError>;
}

/// Production transport: `POST {base}/file_parse` (mineru-api compatible).
#[derive(Debug, Default)]
pub struct HttpMinerUTransport;

impl MinerUTransport for HttpMinerUTransport {
    fn parse(
        &self,
        request: &MinerUParseRequest,
        config: &MinerUConfig,
    ) -> Result<Vec<MinerULayoutBlock>, MinerUError> {
        let base = config
            .base_url
            .as_deref()
            .ok_or_else(|| MinerUError::Config("MinerU base URL is not configured".into()))?;
        let endpoint = format!("{}/file_parse", base.trim_end_matches('/'));

        let client = reqwest::blocking::Client::builder()
            .connect_timeout(config.connect_timeout)
            .timeout(config.request_timeout)
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Translunar-CAT/0.1 MinerU")
            .build()
            .map_err(|_| MinerUError::Unavailable)?;

        let mut form = reqwest::blocking::multipart::Form::new()
            .text("return_content_list", "true")
            .text("return_md", "false")
            .text("return_middle_json", "false")
            .text("return_model_output", "false")
            .text("return_images", "false")
            .text("parse_method", request.parse_method.clone())
            .text("lang_list", request.language.clone())
            .text(
                "start_page_id",
                request.start_page.saturating_sub(1).to_string(),
            );
        if let Some(end) = request.end_page {
            // mineru end_page_id is 0-based inclusive.
            form = form.text("end_page_id", end.saturating_sub(1).to_string());
        }
        let file_bytes = std::fs::read(&request.source)?;
        let file_part = reqwest::blocking::multipart::Part::bytes(file_bytes)
            .file_name(request.file_name.clone())
            .mime_str("application/pdf")
            .map_err(|_| MinerUError::Protocol)?;
        form = form.part("files", file_part);

        let response = client
            .post(&endpoint)
            .bearer_auth(&request.api_key)
            .multipart(form)
            .send()
            .map_err(map_reqwest_error)?;

        let status = response.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(MinerUError::Authentication);
        }
        if status.as_u16() == 408 || status.as_u16() == 504 {
            return Err(MinerUError::Timeout);
        }
        if !status.is_success() {
            // Never log body: may echo paths or provider detail.
            return Err(MinerUError::Unavailable);
        }

        let bytes = response.bytes().map_err(map_reqwest_error)?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err(MinerUError::ResourceLimit {
                resource: "response_bytes",
                limit: MAX_RESPONSE_BYTES as u64,
                actual: bytes.len() as u64,
            });
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| MinerUError::Protocol)?;
        parse_content_list_response(&value)
    }
}

fn map_reqwest_error(error: reqwest::Error) -> MinerUError {
    if error.is_timeout() {
        return MinerUError::Timeout;
    }
    if error.is_connect() || error.is_request() {
        return MinerUError::Unavailable;
    }
    if error.is_decode() {
        return MinerUError::Protocol;
    }
    MinerUError::Unavailable
}

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ContentListItem {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    page_idx: Option<u32>,
    #[serde(default)]
    bbox: Option<[f64; 4]>,
    #[serde(default)]
    text_level: Option<u32>,
    #[serde(default)]
    list_items: Option<Vec<String>>,
    #[serde(default)]
    table_caption: Option<Vec<String>>,
    #[serde(default)]
    table_body: Option<String>,
    #[serde(default)]
    image_caption: Option<Vec<String>>,
    #[serde(default)]
    code_body: Option<String>,
}

/// Parse a MinerU file_parse JSON envelope into layout blocks.
pub fn parse_content_list_response(value: &Value) -> Result<Vec<MinerULayoutBlock>, MinerUError> {
    let results = value
        .get("results")
        .and_then(Value::as_object)
        .ok_or(MinerUError::Protocol)?;
    if results.is_empty() {
        return Err(MinerUError::EmptyResult);
    }
    // Use the first (and typically only) file result.
    let first = results.values().next().ok_or(MinerUError::Protocol)?;
    let content_list_value = first.get("content_list").ok_or(MinerUError::Protocol)?;
    let items = parse_content_list_value(content_list_value)?;
    map_items(items)
}

fn parse_content_list_value(value: &Value) -> Result<Vec<ContentListItem>, MinerUError> {
    match value {
        Value::Array(_) => serde_json::from_value(value.clone()).map_err(|_| MinerUError::Protocol),
        Value::String(raw) => {
            let parsed: Value = serde_json::from_str(raw).map_err(|_| MinerUError::Protocol)?;
            serde_json::from_value(parsed).map_err(|_| MinerUError::Protocol)
        }
        _ => Err(MinerUError::Protocol),
    }
}

/// Map a content_list JSON array (or JSON string) into layout blocks.
#[cfg_attr(not(test), allow(dead_code))]
pub fn map_content_list_from_json(value: &Value) -> Result<Vec<MinerULayoutBlock>, MinerUError> {
    let items = parse_content_list_value(value)?;
    map_items(items)
}

fn map_items(items: Vec<ContentListItem>) -> Result<Vec<MinerULayoutBlock>, MinerUError> {
    let mut blocks = Vec::new();
    let mut per_page_order: BTreeMap<u32, u32> = BTreeMap::new();

    for item in items {
        let texts = extract_texts(&item);
        if texts.is_empty() {
            continue;
        }
        // MinerU page_idx is 0-based; CAT PDF paths are 1-based.
        let page = item.page_idx.unwrap_or(0).saturating_add(1);
        let kind = block_kind(&item);
        let bbox = normalized_bbox_to_points(item.bbox);
        for text in texts {
            let text = text.trim();
            if text.is_empty() || !meaningful_text(text) {
                continue;
            }
            let order = {
                let entry = per_page_order.entry(page).or_insert(0);
                let current = *entry;
                *entry = entry.saturating_add(1);
                current
            };
            blocks.push(MinerULayoutBlock {
                page,
                order,
                kind: kind.clone(),
                text: text.to_string(),
                bbox,
                confidence: 900,
            });
        }
    }

    if blocks.is_empty() {
        return Err(MinerUError::EmptyResult);
    }
    Ok(blocks)
}

fn extract_texts(item: &ContentListItem) -> Vec<String> {
    let mut texts = Vec::new();
    if let Some(text) = item.text.as_ref()
        && !text.trim().is_empty()
    {
        texts.push(text.clone());
    }
    if let Some(items) = item.list_items.as_ref() {
        for item in items {
            if !item.trim().is_empty() {
                texts.push(item.clone());
            }
        }
    }
    if let Some(captions) = item.table_caption.as_ref() {
        texts.extend(captions.iter().filter(|&t| !t.trim().is_empty()).cloned());
    }
    if let Some(body) = item.table_body.as_ref() {
        let stripped = strip_simple_html(body);
        if !stripped.trim().is_empty() {
            texts.push(stripped);
        }
    }
    if let Some(captions) = item.image_caption.as_ref() {
        texts.extend(captions.iter().filter(|&t| !t.trim().is_empty()).cloned());
    }
    if let Some(body) = item.code_body.as_ref()
        && !body.trim().is_empty()
    {
        texts.push(body.clone());
    }
    texts
}

fn block_kind(item: &ContentListItem) -> String {
    if item.text_level.is_some_and(|level| level > 0) {
        return "heading".to_string();
    }
    match item.r#type.as_str() {
        "table" => "table".to_string(),
        "image" | "chart" | "equation" | "code" => "paragraph".to_string(),
        "header" | "footer" | "page_number" | "aside_text" | "page_footnote" => {
            "paragraph".to_string()
        }
        _ => "paragraph".to_string(),
    }
}

/// Convert MinerU normalized 0..1000 bbox into PDF points on a letter page.
fn normalized_bbox_to_points(bbox: Option<[f64; 4]>) -> (f64, f64, f64, f64) {
    let Some([x0, y0, x1, y1]) = bbox else {
        return (0.0, 0.0, DEFAULT_PAGE_WIDTH_PTS, 12.0);
    };
    let left = (x0 / 1000.0) * DEFAULT_PAGE_WIDTH_PTS;
    let top = (y0 / 1000.0) * DEFAULT_PAGE_HEIGHT_PTS;
    let right = (x1 / 1000.0) * DEFAULT_PAGE_WIDTH_PTS;
    let bottom = (y1 / 1000.0) * DEFAULT_PAGE_HEIGHT_PTS;
    (
        left.max(0.0),
        top.max(0.0),
        (right - left).max(0.0),
        (bottom - top).max(0.0),
    )
}

/// Strip HTML while preserving cell/row separators so adjacent cells do not
/// collapse into a single token (e.g. `Item` + `Qty` must not become `ItemQty`).
fn strip_simple_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    let mut tag = String::new();
    for ch in input.chars() {
        match ch {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' => {
                in_tag = false;
                let closing = tag.starts_with('/');
                let name = tag
                    .trim()
                    .trim_start_matches('/')
                    .split(|c: char| c.is_whitespace() || c == '/')
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if closing {
                    match name.as_str() {
                        "td" | "th" => out.push('\t'),
                        "tr" => out.push('\n'),
                        _ => {}
                    }
                } else if name == "br" {
                    out.push('\n');
                }
            }
            _ if in_tag => tag.push(ch),
            _ => out.push(ch),
        }
    }
    // Collapse runs of spaces but keep tab/newline as structural separators.
    let mut normalized = String::with_capacity(out.len());
    let mut last_space = false;
    for ch in out.chars() {
        match ch {
            '\t' | '\n' => {
                // Trim trailing ordinary spaces before a separator.
                while normalized.ends_with(' ') {
                    normalized.pop();
                }
                if !normalized.ends_with(ch) {
                    normalized.push(ch);
                }
                last_space = false;
            }
            c if c.is_whitespace() => {
                if !last_space && !normalized.is_empty() && !normalized.ends_with(['\t', '\n']) {
                    normalized.push(' ');
                    last_space = true;
                }
            }
            c => {
                normalized.push(c);
                last_space = false;
            }
        }
    }
    normalized.trim().to_string()
}

fn meaningful_text(text: &str) -> bool {
    text.chars().any(|ch| ch.is_alphanumeric())
}

fn milli(value: f64) -> i64 {
    (value * 1000.0).round() as i64
}

// ---------------------------------------------------------------------------
// Service facade
// ---------------------------------------------------------------------------

pub struct MinerUService {
    pub(crate) config: MinerUConfig,
    credentials: Arc<dyn MinerUCredentialStore>,
    transport: Arc<dyn MinerUTransport>,
}

impl MinerUService {
    pub fn from_env() -> Result<Self, MinerUError> {
        Ok(Self {
            config: MinerUConfig::from_env()?,
            credentials: default_credential_store(),
            transport: Arc::new(HttpMinerUTransport),
        })
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn with_parts(
        config: MinerUConfig,
        credentials: Arc<dyn MinerUCredentialStore>,
        transport: Arc<dyn MinerUTransport>,
    ) -> Self {
        Self {
            config,
            credentials,
            transport,
        }
    }

    pub fn is_configured(&self) -> bool {
        self.config.is_configured()
    }

    /// Whether a non-empty credential is present. Never returns the secret.
    pub fn credential_status(&self) -> Result<MinerUCredentialStatus, MinerUError> {
        match self.credentials.status() {
            Ok(present) => Ok(MinerUCredentialStatus {
                available: true,
                present,
                backend: self.credentials.backend().to_string(),
            }),
            Err(MinerUError::CredentialUnavailable) => Ok(MinerUCredentialStatus {
                available: false,
                present: false,
                backend: self.credentials.backend().to_string(),
            }),
            Err(error) => Err(error),
        }
    }

    /// Store a MinerU API key in the configured credential backend.
    pub fn set_credential(&self, secret: &str) -> Result<MinerUCredentialStatus, MinerUError> {
        self.credentials.set(secret)?;
        self.credential_status()
    }

    /// Remove the MinerU API key from the configured credential backend.
    pub fn delete_credential(&self) -> Result<MinerUCredentialStatus, MinerUError> {
        self.credentials.delete()?;
        self.credential_status()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn replace_transport(&mut self, transport: Arc<dyn MinerUTransport>) {
        self.transport = transport;
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn replace_credentials(&mut self, credentials: Arc<dyn MinerUCredentialStore>) {
        self.credentials = credentials;
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn set_base_url(&mut self, base_url: Option<String>) -> Result<(), MinerUError> {
        if let Some(ref base) = base_url {
            validate_base_url(base)?;
        }
        self.config.base_url = base_url.map(|b| b.trim().trim_end_matches('/').to_string());
        Ok(())
    }

    /// Whether the MinerU path should handle this PDF import.
    ///
    /// Prefer [`resolve_pdf_ocr_route`] at call sites so invalid enums fail closed
    /// as `invalid_request` instead of silently falling through.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn should_handle(&self, options: &BTreeMap<String, String>) -> bool {
        matches!(resolve_pdf_ocr_route(options), Ok(PdfOcrRoute::MinerU))
    }

    /// Run MinerU OCR and produce an [`ImportedDocument`] with PDF structural paths.
    pub fn import_pdf(
        &self,
        source: &Path,
        document_id: Option<&str>,
        source_locale: Option<&str>,
        options: &BTreeMap<String, String>,
    ) -> Result<ImportedDocument, MinerUError> {
        if !self.is_configured() {
            return Err(MinerUError::Config(
                "MinerU base URL is not configured (set TRANSLUNAR_MINERU_BASE_URL)".into(),
            ));
        }

        let metadata = std::fs::metadata(source)?;
        if metadata.len() == 0 || metadata.len() > self.config.max_bytes {
            return Err(MinerUError::ResourceLimit {
                resource: "file_bytes",
                limit: self.config.max_bytes,
                actual: metadata.len(),
            });
        }

        // Cheap header check — full PDF validation stays with filter-pdf tools when needed.
        validate_pdf_header(source)?;

        // Resolve and enforce page limits **before** reading the credential or
        // invoking transport (R1).
        let (start_page, end_page_opt) = parse_page_range(options.get("pageRange"))?;
        let page_count = count_pdf_pages(source)?;
        if start_page > page_count {
            return Err(MinerUError::Config(format!(
                "pageRange start {start_page} is outside the PDF page count {page_count}"
            )));
        }
        let end_page = end_page_opt.unwrap_or(page_count);
        if end_page > page_count {
            return Err(MinerUError::Config(format!(
                "pageRange end {end_page} is outside the PDF page count {page_count}"
            )));
        }
        if end_page < start_page {
            return Err(MinerUError::Config("pageRange end must be >= start".into()));
        }
        let selected_pages = end_page.saturating_sub(start_page).saturating_add(1);
        if selected_pages > self.config.max_pages {
            return Err(MinerUError::ResourceLimit {
                resource: "pages",
                limit: u64::from(self.config.max_pages),
                actual: u64::from(selected_pages),
            });
        }

        let api_key = self.credentials.get()?;

        let language = options
            .get("ocrLanguages")
            .cloned()
            .or_else(|| options.get("lang").cloned())
            .unwrap_or_else(|| "ch".to_string());
        // ocrMode is closed: only auto/always (or absent) may reach this path.
        let parse_method = match parse_ocr_mode(options.get("ocrMode").map(String::as_str))? {
            OcrModeOption::Always => "ocr".to_string(),
            OcrModeOption::Never => {
                return Err(MinerUError::Config(
                    "ocrMode=never is incompatible with MinerU OCR".into(),
                ));
            }
            OcrModeOption::Auto => "auto".to_string(),
        };

        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("document.pdf")
            .to_string();

        let request = MinerUParseRequest {
            source: source.to_path_buf(),
            file_name,
            api_key,
            parse_method,
            language,
            start_page,
            end_page: Some(end_page),
        };

        // Drop the secret from the request after the call returns by moving it.
        let blocks = self.transport.parse(&request, &self.config)?;
        // Ensure we never retain the key in the request beyond this point.
        drop(request);

        if blocks.len() as u64 > u64::from(self.config.max_pages).saturating_mul(500) {
            // Soft guard against pathological payloads (not a hard protocol limit).
            return Err(MinerUError::Protocol);
        }

        let locale = source_locale.unwrap_or("en").to_string();
        let units = blocks_to_units(&blocks, document_id, &locale, options)?;
        Ok(ImportedDocument {
            metadata: DocumentMetadata {
                format: "pdf".to_string(),
                source_locale: Some(locale),
                properties: BTreeMap::from([
                    ("filter".to_string(), "builtin.pdf".to_string()),
                    ("ocrEngine".to_string(), "mineru".to_string()),
                    ("blockCount".to_string(), units.len().to_string()),
                ]),
            },
            units,
            degradation: vec![
                DegradationFinding {
                    code: "pdf_layout_reconstructed".to_string(),
                    severity: DegradationSeverity::Warning,
                    message: "PDF layout is represented as ordered MinerU OCR blocks".to_string(),
                    structural_path: None,
                },
                DegradationFinding {
                    code: "pdf_ocr_engine_mineru".to_string(),
                    severity: DegradationSeverity::Warning,
                    message: "document text was extracted via MinerU HTTP OCR".to_string(),
                    structural_path: None,
                },
            ],
        })
    }
}

fn validate_pdf_header(source: &Path) -> Result<(), MinerUError> {
    use std::io::Read;
    let mut file = std::fs::File::open(source)?;
    let mut header = [0_u8; 5];
    file.read_exact(&mut header)
        .map_err(|_| MinerUError::Config("source is not a readable PDF".into()))?;
    if &header != b"%PDF-" {
        return Err(MinerUError::Config(
            "source does not start with a PDF header".into(),
        ));
    }
    Ok(())
}

/// Count PDF pages via the real page tree (preflight only; no external tools).
fn count_pdf_pages(source: &Path) -> Result<u32, MinerUError> {
    count_page_tree(source).map_err(|error| {
        MinerUError::Config(format!(
            "unable to determine PDF page count for MinerU preflight: {error}"
        ))
    })
}

/// Closed PDF OCR routing: invalid enums fail as configuration errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfOcrRoute {
    /// Explicit `ocrEngine=mineru` (and `ocrMode` is not `never`).
    MinerU,
    /// Local Poppler/Tesseract path (`auto`/empty/tesseract/poppler/local, or `never`).
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OcrEngineOption {
    Auto,
    MinerU,
    Tesseract,
    Poppler,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OcrModeOption {
    Auto,
    Always,
    Never,
}

fn parse_ocr_engine(value: Option<&str>) -> Result<OcrEngineOption, MinerUError> {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        None | Some("") | Some("auto") => Ok(OcrEngineOption::Auto),
        Some("mineru") => Ok(OcrEngineOption::MinerU),
        Some("tesseract") => Ok(OcrEngineOption::Tesseract),
        Some("poppler") => Ok(OcrEngineOption::Poppler),
        Some("local") => Ok(OcrEngineOption::Local),
        Some(other) => Err(MinerUError::Config(format!(
            "ocrEngine must be mineru, tesseract, poppler, local, or auto (got {other})"
        ))),
    }
}

fn parse_ocr_mode(value: Option<&str>) -> Result<OcrModeOption, MinerUError> {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        None | Some("") | Some("auto") => Ok(OcrModeOption::Auto),
        Some("always") => Ok(OcrModeOption::Always),
        Some("never") => Ok(OcrModeOption::Never),
        Some(other) => Err(MinerUError::Config(format!(
            "ocrMode must be auto, always, or never (got {other})"
        ))),
    }
}

/// Validate `ocrEngine` / `ocrMode` and choose MinerU vs local PDF path.
///
/// Unknown values return `MinerUError::Config` (maps to `invalid_request`).
pub fn resolve_pdf_ocr_route(
    options: &BTreeMap<String, String>,
) -> Result<PdfOcrRoute, MinerUError> {
    let mode = parse_ocr_mode(options.get("ocrMode").map(String::as_str))?;
    let engine = parse_ocr_engine(options.get("ocrEngine").map(String::as_str))?;
    if mode == OcrModeOption::Never {
        return Ok(PdfOcrRoute::Local);
    }
    match engine {
        OcrEngineOption::MinerU => Ok(PdfOcrRoute::MinerU),
        OcrEngineOption::Auto
        | OcrEngineOption::Tesseract
        | OcrEngineOption::Poppler
        | OcrEngineOption::Local => Ok(PdfOcrRoute::Local),
    }
}

fn parse_page_range(value: Option<&String>) -> Result<(u32, Option<u32>), MinerUError> {
    let Some(value) = value else {
        return Ok((1, None));
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok((1, None));
    }
    let mut parts = value.split('-');
    let start = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| MinerUError::Config("pageRange must be N or N-M".into()))?;
    let end = parts
        .next()
        .map(|part| part.parse::<u32>())
        .transpose()
        .map_err(|_| MinerUError::Config("pageRange must be N or N-M".into()))?;
    if parts.next().is_some() || end.is_some_and(|value| value == 0) {
        return Err(MinerUError::Config("pageRange must be N or N-M".into()));
    }
    if let Some(end) = end
        && end < start
    {
        return Err(MinerUError::Config("pageRange end must be >= start".into()));
    }
    Ok((start, end))
}

fn blocks_to_units(
    blocks: &[MinerULayoutBlock],
    document_id: Option<&str>,
    locale: &str,
    options: &BTreeMap<String, String>,
) -> Result<Vec<ImportedUnit>, MinerUError> {
    let mode = options.get("segmentationMode").map(String::as_str);
    let srx_path = options.get("srxPath").map(String::as_str);
    let mut units = Vec::with_capacity(blocks.len());
    let mut ordinal = 0_u32;
    for block in blocks {
        let path = PdfPath {
            page: block.page,
            order: block.order,
            kind: block.kind.clone(),
            x: milli(block.bbox.0),
            y: milli(block.bbox.1),
            width: milli(block.bbox.2),
            height: milli(block.bbox.3),
            source_kind: "ocr".to_string(),
            confidence: block.confidence,
        };
        let structural_path = path.encode();
        let segments = segment_pdf_text(&block.text, locale, mode, srx_path).map_err(|error| {
            MinerUError::Config(format!("PDF segmentation options are invalid: {error}"))
        })?;
        // Fall back to the whole block when SRX yields nothing (e.g. whitespace-only).
        let texts = if segments.is_empty() {
            if block.text.trim().is_empty() {
                continue;
            }
            vec![block.text.clone()]
        } else {
            segments
        };
        for text in texts {
            let mut unit = ImportedUnit::plain(ordinal, structural_path.clone(), text);
            unit.notes.push(DocumentNote {
                id: format!("{}:mineru-ocr:{ordinal}", document_id.unwrap_or("pdf")),
                text: format!("MinerU OCR confidence {}", block.confidence),
                author: Some("mineru".to_string()),
            });
            units.push(unit);
            ordinal = ordinal.checked_add(1).ok_or(MinerUError::Protocol)?;
        }
    }
    Ok(units)
}

// ---------------------------------------------------------------------------
// Test doubles (available when the engine crate is under test)
// ---------------------------------------------------------------------------

#[cfg(test)]
pub const FIXTURE_CONTENT_LIST: &str = r#"[
  {
    "type": "text",
    "text": "Contract Title",
    "text_level": 1,
    "page_idx": 0,
    "bbox": [100, 50, 900, 120]
  },
  {
    "type": "text",
    "text": "Article 1. Parties agree to the terms.",
    "page_idx": 0,
    "bbox": [100, 150, 900, 220]
  },
  {
    "type": "table",
    "table_caption": ["Schedule A"],
    "table_body": "<table><tr><td>Item</td><td>Qty</td></tr></table>",
    "page_idx": 1,
    "bbox": [50, 100, 950, 400]
  }
]"#;

/// Deterministic MinerU transport for unit/smoke tests (no live HTTP).
#[cfg(test)]
pub struct MockMinerUTransport {
    calls: std::sync::atomic::AtomicUsize,
    response: Value,
    fail: Option<MockMinerUFailure>,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug)]
pub enum MockMinerUFailure {
    Timeout,
    Unavailable,
    Authentication,
    #[allow(dead_code)]
    Protocol,
}

#[cfg(test)]
impl MockMinerUTransport {
    pub fn success() -> Self {
        let content_list: Value = serde_json::from_str(FIXTURE_CONTENT_LIST).unwrap();
        Self {
            calls: std::sync::atomic::AtomicUsize::new(0),
            response: serde_json::json!({
                "backend": "pipeline",
                "version": "test",
                "results": {
                    "sample": {
                        "content_list": content_list
                    }
                }
            }),
            fail: None,
        }
    }

    pub fn failing(kind: MockMinerUFailure) -> Self {
        Self {
            calls: std::sync::atomic::AtomicUsize::new(0),
            response: serde_json::json!({}),
            fail: Some(kind),
        }
    }

    pub fn call_count(&self) -> usize {
        self.calls.load(std::sync::atomic::Ordering::SeqCst)
    }
}

#[cfg(test)]
impl MinerUTransport for MockMinerUTransport {
    fn parse(
        &self,
        request: &MinerUParseRequest,
        _config: &MinerUConfig,
    ) -> Result<Vec<MinerULayoutBlock>, MinerUError> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        // Secret must be present for the call but never appear in returned data.
        assert!(!request.api_key.is_empty());
        match self.fail {
            Some(MockMinerUFailure::Timeout) => Err(MinerUError::Timeout),
            Some(MockMinerUFailure::Unavailable) => Err(MinerUError::Unavailable),
            Some(MockMinerUFailure::Authentication) => Err(MinerUError::Authentication),
            Some(MockMinerUFailure::Protocol) => Err(MinerUError::Protocol),
            None => parse_content_list_response(&self.response),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_minimal_pdf(dir: &Path) -> PathBuf {
        write_pdf_with_pages(dir, "sample.pdf", 1)
    }

    /// Build a valid PDF whose page tree reports `pages` (parseable by lopdf).
    fn write_pdf_with_pages(dir: &Path, name: &str, pages: u32) -> PathBuf {
        use lopdf::{Document, Object, dictionary};
        let mut doc = Document::with_version("1.4");
        let pages_id = doc.new_object_id();
        let mut kids = Vec::with_capacity(pages as usize);
        for _ in 0..pages {
            let page_id = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            });
            kids.push(page_id.into());
        }
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => kids,
                "Count" => i64::from(pages),
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        let path = dir.join(name);
        doc.save(&path).expect("save test pdf");
        path
    }

    /// PDF with one real page plus decoy `/Type /Page` markers that raw scans would over-count.
    fn write_pdf_with_decoy_page_markers(dir: &Path) -> PathBuf {
        use lopdf::{Document, Object, Stream, dictionary};
        let mut doc = Document::with_version("1.4");
        let pages_id = doc.new_object_id();
        // Content stream embeds textual decoys that a raw-byte `/Type /Page` scan would see.
        let decoy = Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf 100 700 Td (decoy /Type /Page and /Type /Pages markers) Tj ET".to_vec(),
        );
        let content_id = doc.add_object(decoy);
        // Stale unlinked page object (not in Kids) — raw scan would count it.
        let _stale = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        });
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content_id,
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1_i64,
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        // Compress streams so page dictionaries may sit beside compressed content.
        doc.compress();
        let path = dir.join("decoy-pages.pdf");
        doc.save(&path).expect("save decoy pdf");
        path
    }

    fn service_with(transport: Arc<dyn MinerUTransport>) -> MinerUService {
        let config = MinerUConfig {
            base_url: Some("http://127.0.0.1:18000".into()),
            ..MinerUConfig::default()
        };
        let credentials = Arc::new(MemoryMinerUCredentialStore::with_secret(Some(
            "test-mineru-api-key-value".into(),
        )));
        MinerUService::with_parts(config, credentials, transport)
    }

    fn mineru_options() -> BTreeMap<String, String> {
        BTreeMap::from([("ocrEngine".into(), "mineru".into())])
    }

    #[test]
    fn maps_structured_content_list_to_layout_blocks() {
        let value: Value = serde_json::from_str(FIXTURE_CONTENT_LIST).unwrap();
        let blocks = map_content_list_from_json(&value).expect("map fixture");
        assert_eq!(blocks.len(), 4);
        assert_eq!(blocks[0].kind, "heading");
        assert_eq!(blocks[0].page, 1);
        assert_eq!(blocks[0].text, "Contract Title");
        assert_eq!(blocks[1].kind, "paragraph");
        assert!(blocks[1].text.contains("Article 1"));
        assert_eq!(blocks[2].kind, "table");
        assert_eq!(blocks[2].page, 2);
        assert_eq!(blocks[2].text, "Schedule A");
        assert!(blocks[3].text.contains("Item"));
        assert!(blocks[3].text.contains("Qty"));
        // Adjacent table cells must not collapse into a single token.
        assert!(
            !blocks[3].text.contains("ItemQty"),
            "table cells need separators, got {:?}",
            blocks[3].text
        );
        // Geometry lands on letter page points from normalized bbox.
        assert!(blocks[0].bbox.0 > 0.0);
        assert!(blocks[0].bbox.2 > 0.0);
    }

    #[test]
    fn mock_transport_import_produces_ocr_segments() {
        let dir = tempdir().unwrap();
        let pdf = write_minimal_pdf(dir.path());
        let transport = Arc::new(MockMinerUTransport::success());
        let service = service_with(transport.clone());
        let imported = service
            .import_pdf(&pdf, Some("doc-1"), Some("en"), &mineru_options())
            .expect("import via mock MinerU");
        assert_eq!(imported.metadata.format, "pdf");
        assert_eq!(
            imported
                .metadata
                .properties
                .get("ocrEngine")
                .map(String::as_str),
            Some("mineru")
        );
        assert!(!imported.units.is_empty());
        assert!(imported.units.iter().all(|unit| {
            unit.structural_path.contains("s=ocr")
                && unit
                    .notes
                    .iter()
                    .any(|note| note.author.as_deref() == Some("mineru"))
        }));
        assert!(
            imported
                .degradation
                .iter()
                .any(|d| d.code == "pdf_ocr_engine_mineru")
        );
        assert_eq!(transport.call_count(), 1);
        // Structural path decodes cleanly.
        let path = PdfPath::decode(&imported.units[0].structural_path).expect("decode path");
        assert_eq!(path.source_kind, "ocr");
        assert_eq!(path.page, 1);
    }

    #[test]
    fn missing_credential_is_typed() {
        let dir = tempdir().unwrap();
        let pdf = write_minimal_pdf(dir.path());
        let config = MinerUConfig {
            base_url: Some("http://127.0.0.1:18000".into()),
            ..MinerUConfig::default()
        };
        let service = MinerUService::with_parts(
            config,
            Arc::new(MemoryMinerUCredentialStore::default()),
            Arc::new(MockMinerUTransport::success()),
        );
        let err = service
            .import_pdf(&pdf, None, None, &mineru_options())
            .expect_err("missing key");
        assert!(matches!(err, MinerUError::MissingCredential));
    }

    #[test]
    fn explicit_mineru_without_base_url_is_typed_config_error() {
        let dir = tempdir().unwrap();
        let pdf = write_minimal_pdf(dir.path());
        let transport = Arc::new(MockMinerUTransport::success());
        let service = MinerUService::with_parts(
            MinerUConfig::default(), // no base URL
            Arc::new(MemoryMinerUCredentialStore::with_secret(Some("k".into()))),
            transport.clone(),
        );
        assert!(service.should_handle(&mineru_options()));
        let err = service
            .import_pdf(&pdf, None, None, &mineru_options())
            .expect_err("missing base URL");
        assert!(matches!(err, MinerUError::Config(_)));
        assert_eq!(transport.call_count(), 0);
    }

    #[test]
    fn network_timeout_is_typed() {
        let dir = tempdir().unwrap();
        let pdf = write_minimal_pdf(dir.path());
        let service = service_with(Arc::new(MockMinerUTransport::failing(
            MockMinerUFailure::Timeout,
        )));
        let err = service
            .import_pdf(&pdf, None, None, &mineru_options())
            .expect_err("timeout");
        assert!(matches!(err, MinerUError::Timeout));
    }

    #[test]
    fn auth_failure_is_typed() {
        let dir = tempdir().unwrap();
        let pdf = write_minimal_pdf(dir.path());
        let service = service_with(Arc::new(MockMinerUTransport::failing(
            MockMinerUFailure::Authentication,
        )));
        let err = service
            .import_pdf(&pdf, None, None, &mineru_options())
            .expect_err("auth");
        assert!(matches!(err, MinerUError::Authentication));
    }

    #[test]
    fn oversized_file_rejected_before_network() {
        let dir = tempdir().unwrap();
        let pdf = write_minimal_pdf(dir.path());
        let transport = Arc::new(MockMinerUTransport::success());
        let config = MinerUConfig {
            base_url: Some("http://127.0.0.1:18000".into()),
            max_bytes: 8, // smaller than minimal pdf
            ..MinerUConfig::default()
        };
        let service = MinerUService::with_parts(
            config,
            Arc::new(MemoryMinerUCredentialStore::with_secret(Some("k".into()))),
            transport.clone(),
        );
        let err = service
            .import_pdf(&pdf, None, None, &mineru_options())
            .expect_err("oversize");
        match err {
            MinerUError::ResourceLimit { resource, .. } => assert_eq!(resource, "file_bytes"),
            other => panic!("expected resource limit, got {other:?}"),
        }
        assert_eq!(transport.call_count(), 0);
    }

    #[test]
    fn oversized_full_document_rejected_before_network() {
        let dir = tempdir().unwrap();
        let pdf = write_pdf_with_pages(dir.path(), "long.pdf", 5);
        let transport = Arc::new(MockMinerUTransport::success());
        let config = MinerUConfig {
            base_url: Some("http://127.0.0.1:18000".into()),
            max_pages: 2,
            ..MinerUConfig::default()
        };
        let service = MinerUService::with_parts(
            config,
            Arc::new(MemoryMinerUCredentialStore::with_secret(Some("k".into()))),
            transport.clone(),
        );
        let err = service
            .import_pdf(&pdf, None, None, &mineru_options())
            .expect_err("over-limit full document");
        match err {
            MinerUError::ResourceLimit {
                resource,
                limit,
                actual,
            } => {
                assert_eq!(resource, "pages");
                assert_eq!(limit, 2);
                assert_eq!(actual, 5);
            }
            other => panic!("expected page resource limit, got {other:?}"),
        }
        assert_eq!(transport.call_count(), 0);
    }

    #[test]
    fn oversized_page_range_start_only_rejected_before_network() {
        let dir = tempdir().unwrap();
        let pdf = write_pdf_with_pages(dir.path(), "long.pdf", 6);
        let transport = Arc::new(MockMinerUTransport::success());
        let config = MinerUConfig {
            base_url: Some("http://127.0.0.1:18000".into()),
            max_pages: 2,
            ..MinerUConfig::default()
        };
        let service = MinerUService::with_parts(
            config,
            Arc::new(MemoryMinerUCredentialStore::with_secret(Some("k".into()))),
            transport.clone(),
        );
        let options = BTreeMap::from([
            ("ocrEngine".into(), "mineru".into()),
            ("pageRange".into(), "2".into()), // pages 2..=6 → 5 pages
        ]);
        let err = service
            .import_pdf(&pdf, None, None, &options)
            .expect_err("over-limit pageRange=N");
        match err {
            MinerUError::ResourceLimit {
                resource,
                limit,
                actual,
            } => {
                assert_eq!(resource, "pages");
                assert_eq!(limit, 2);
                assert_eq!(actual, 5);
            }
            other => panic!("expected page resource limit, got {other:?}"),
        }
        assert_eq!(transport.call_count(), 0);
    }

    #[test]
    fn secret_never_appears_in_imported_document_or_errors() {
        let dir = tempdir().unwrap();
        let pdf = write_minimal_pdf(dir.path());
        let secret = "super-secret-mineru-token-xyz";
        let config = MinerUConfig {
            base_url: Some("http://127.0.0.1:18000".into()),
            ..MinerUConfig::default()
        };
        let store = MemoryMinerUCredentialStore::with_secret(Some(secret.into()));
        // Debug of secret-bearing types must redact.
        assert!(!format!("{store:?}").contains(secret));
        let service = MinerUService::with_parts(
            config,
            Arc::new(store),
            Arc::new(MockMinerUTransport::success()),
        );
        let imported = service
            .import_pdf(&pdf, Some("doc"), Some("en"), &mineru_options())
            .unwrap();
        for unit in &imported.units {
            assert!(!unit.source_text.contains(secret));
            assert!(!unit.structural_path.contains(secret));
            for note in &unit.notes {
                assert!(!note.text.contains(secret));
                assert!(!note.id.contains(secret));
            }
        }
        for finding in &imported.degradation {
            assert!(!finding.message.contains(secret));
            assert!(!finding.code.contains(secret));
        }
        // Typed errors also omit secrets.
        let fail_service = MinerUService::with_parts(
            MinerUConfig {
                base_url: Some("http://127.0.0.1:18000".into()),
                ..MinerUConfig::default()
            },
            Arc::new(MemoryMinerUCredentialStore::with_secret(Some(
                secret.into(),
            ))),
            Arc::new(MockMinerUTransport::failing(
                MockMinerUFailure::Authentication,
            )),
        );
        let err = fail_service
            .import_pdf(&pdf, None, None, &mineru_options())
            .unwrap_err();
        assert!(!err.to_string().contains(secret));
        let request = MinerUParseRequest {
            source: pdf.clone(),
            file_name: "sample.pdf".into(),
            api_key: secret.into(),
            parse_method: "auto".into(),
            language: "ch".into(),
            start_page: 1,
            end_page: Some(1),
        };
        assert!(!format!("{request:?}").contains(secret));
    }

    #[test]
    fn memory_credential_round_trip() {
        let store = MemoryMinerUCredentialStore::default();
        assert!(!store.status().unwrap());
        store.set("abc-token").unwrap();
        assert!(store.status().unwrap());
        assert_eq!(store.get().unwrap(), "abc-token");
        store.delete().unwrap();
        assert!(!store.status().unwrap());
        assert!(matches!(store.get(), Err(MinerUError::MissingCredential)));
    }

    #[test]
    fn service_credential_status_set_delete_never_exposes_secret() {
        let service = service_with(Arc::new(MockMinerUTransport::success()));
        let secret = "provisioning-secret-token";
        let status = service.set_credential(secret).expect("set");
        assert!(status.present);
        assert!(status.available);
        assert_eq!(status.backend, "test-memory");
        assert!(!format!("{status:?}").contains(secret));
        let status = service.credential_status().expect("status");
        assert!(status.present);
        let status = service.delete_credential().expect("delete");
        assert!(!status.present);
        let status = service.credential_status().expect("status after delete");
        assert!(!status.present);
    }

    #[test]
    fn should_handle_respects_engine_and_mode_options() {
        let service = service_with(Arc::new(MockMinerUTransport::success()));
        // auto/default never hijacks the local text-layer path
        assert!(!service.should_handle(&BTreeMap::new()));
        assert!(!service.should_handle(&BTreeMap::from([("ocrEngine".into(), "auto".into())])));
        assert!(service.should_handle(&mineru_options()));
        // Explicit mineru is selected even without a base URL so config fails typed.
        let unconfigured = MinerUService::with_parts(
            MinerUConfig::default(),
            Arc::new(MemoryMinerUCredentialStore::default()),
            Arc::new(MockMinerUTransport::success()),
        );
        assert!(unconfigured.should_handle(&mineru_options()));
        assert!(
            !service.should_handle(&BTreeMap::from([("ocrEngine".into(), "tesseract".into())]))
        );
        assert!(!service.should_handle(&BTreeMap::from([("ocrMode".into(), "never".into())])));
        assert!(!service.should_handle(&BTreeMap::from([
            ("ocrEngine".into(), "mineru".into()),
            ("ocrMode".into(), "never".into()),
        ])));
    }

    #[test]
    fn invalid_ocr_engine_and_mode_are_rejected() {
        let err = resolve_pdf_ocr_route(&BTreeMap::from([("ocrEngine".into(), "mineruu".into())]))
            .expect_err("typo engine");
        assert!(matches!(err, MinerUError::Config(ref message) if message.contains("ocrEngine")));
        let err = resolve_pdf_ocr_route(&BTreeMap::from([
            ("ocrEngine".into(), "mineru".into()),
            ("ocrMode".into(), "sometimes".into()),
        ]))
        .expect_err("invalid mode");
        assert!(matches!(err, MinerUError::Config(ref message) if message.contains("ocrMode")));
        // Valid closed set still works.
        assert_eq!(
            resolve_pdf_ocr_route(&mineru_options()).unwrap(),
            PdfOcrRoute::MinerU
        );
        assert_eq!(
            resolve_pdf_ocr_route(&BTreeMap::from([("ocrEngine".into(), "local".into())])).unwrap(),
            PdfOcrRoute::Local
        );
    }

    #[test]
    fn count_pdf_pages_uses_page_tree_not_raw_markers() {
        let dir = tempdir().unwrap();
        let pdf = write_pdf_with_pages(dir.path(), "three.pdf", 3);
        assert_eq!(count_pdf_pages(&pdf).unwrap(), 3);
        let decoy = write_pdf_with_decoy_page_markers(dir.path());
        assert_eq!(
            count_pdf_pages(&decoy).unwrap(),
            1,
            "page tree must ignore decoy markers and unlinked page objects"
        );
    }

    #[test]
    fn blocks_to_units_respects_sentence_segmentation() {
        let blocks = [MinerULayoutBlock {
            page: 1,
            order: 0,
            kind: "paragraph".into(),
            text: "Hello world. Second sentence.".into(),
            bbox: (10.0, 20.0, 100.0, 30.0),
            confidence: 900,
        }];
        let paragraph = blocks_to_units(
            &blocks,
            Some("doc"),
            "en-US",
            &BTreeMap::from([("segmentationMode".into(), "paragraph".into())]),
        )
        .expect("paragraph");
        assert_eq!(paragraph.len(), 1);
        assert_eq!(paragraph[0].source_text, "Hello world. Second sentence.");
        let sentence = blocks_to_units(
            &blocks,
            Some("doc"),
            "en-US",
            &BTreeMap::from([("segmentationMode".into(), "sentence".into())]),
        )
        .expect("sentence");
        assert!(
            sentence.len() >= 2,
            "sentence mode should split, got {:?}",
            sentence
                .iter()
                .map(|u| u.source_text.as_str())
                .collect::<Vec<_>>()
        );
        assert_eq!(sentence[0].structural_path, sentence[1].structural_path);
        assert!(sentence[0].source_text.contains("Hello"));
        assert!(sentence[1].source_text.contains("Second"));
    }

    #[test]
    fn empty_content_list_is_typed_empty_result() {
        let response = serde_json::json!({
            "results": {
                "sample": { "content_list": [] }
            }
        });
        let err = parse_content_list_response(&response).unwrap_err();
        assert!(matches!(err, MinerUError::EmptyResult));
    }

    #[test]
    fn content_list_string_payload_is_accepted() {
        let response = serde_json::json!({
            "results": {
                "sample": {
                    "content_list": FIXTURE_CONTENT_LIST
                }
            }
        });
        let blocks = parse_content_list_response(&response).expect("string payload");
        assert!(!blocks.is_empty());
    }
}
