//! Wire envelope: one JSON object per line over the engine's stdio.
//!
//! Clients write [`RpcRequest`] frames to stdin. The engine writes
//! [`EngineFrame`] values to stdout: either a response to a request or an
//! unsolicited notification. The `kind` tag keeps the stream self-describing
//! so future frame kinds can be added without breaking older clients.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RpcRequest {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RpcErrorCode {
    InvalidRequest,
    MethodNotFound,
    InvalidParams,
    NotFound,
    Conflict,
    FilterFailed,
    ExportBlocked,
    AiNotConfigured,
    AiFailed,
    Io,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RpcError {
    pub code: RpcErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RpcResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl RpcResponse {
    pub fn success(id: u64, result: Value) -> Self {
        Self {
            id: Some(id),
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(id: Option<u64>, error: RpcError) -> Self {
        Self {
            id,
            result: None,
            error: Some(error),
        }
    }
}

/// Reserved notification frame: engine-initiated, no request id, never awaited.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RpcNotification {
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// One engine-to-client stdout frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EngineFrame {
    Response(RpcResponse),
    Notification(RpcNotification),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_tagged_by_kind() {
        let response = EngineFrame::Response(RpcResponse::success(7, Value::Null));
        let encoded = serde_json::to_value(&response).expect("serialize response frame");
        assert_eq!(encoded["kind"], "response");
        assert_eq!(encoded["id"], 7);

        let notification = EngineFrame::Notification(RpcNotification {
            method: "notify.engine.ready".to_string(),
            params: Value::Null,
        });
        let encoded = serde_json::to_value(&notification).expect("serialize notification frame");
        assert_eq!(encoded["kind"], "notification");
        assert_eq!(encoded["method"], "notify.engine.ready");
    }

    #[test]
    fn frames_roundtrip() {
        let frame = EngineFrame::Response(RpcResponse::failure(
            Some(3),
            RpcError {
                code: RpcErrorCode::MethodNotFound,
                message: "unknown method".to_string(),
                data: None,
            },
        ));
        let line = serde_json::to_string(&frame).expect("serialize");
        let decoded: EngineFrame = serde_json::from_str(&line).expect("deserialize");
        assert_eq!(decoded, frame);
    }
}
