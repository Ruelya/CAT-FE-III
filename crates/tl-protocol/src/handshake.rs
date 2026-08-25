//! Handshake domain: the first request a client must send.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const ENGINE_NAME: &str = "tl-engine";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub protocol_version: u32,
    pub client_name: String,
    pub client_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineCapabilities {
    /// Registered document filter ids, e.g. `builtin.docx`.
    pub filters: Vec<String>,
    pub ai_assist: bool,
    pub ai_agent: bool,
    /// Whether the engine emits notification frames.
    pub notifications: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub protocol_version: u32,
    pub engine_name: String,
    pub engine_version: String,
    pub capabilities: EngineCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownResult {
    pub ok: bool,
}

/// Payload for the reserved `notify.engine.ready` frame emitted on startup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineReadyNotification {
    pub engine_name: String,
    pub engine_version: String,
    pub protocol_version: u32,
}
