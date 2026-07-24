//! Bearer-token authentication for the local HTTP API and CLI.

use std::env;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use keyring::Entry;
use uuid::Uuid;

use crate::{EngineError, Result};

pub const LOCAL_API_CREDENTIAL_SERVICE: &str = "translunar-cat.local-api";
pub const LOCAL_API_CREDENTIAL_ACCOUNT: &str = "default";
const MIN_TOKEN_BYTES: usize = 24;

pub trait LocalApiTokenStore: Send + Sync {
    fn status(&self) -> Result<bool>;
    fn get(&self) -> Result<Option<String>>;
    fn set(&self, token: &str) -> Result<()>;
    fn delete(&self) -> Result<()>;
}

#[derive(Debug, Default)]
pub struct MemoryTokenStore {
    token: Mutex<Option<String>>,
}

impl LocalApiTokenStore for MemoryTokenStore {
    fn status(&self) -> Result<bool> {
        Ok(self
            .token
            .lock()
            .map_err(|_| EngineError::InvalidState("token lock poisoned".into()))?
            .is_some())
    }

    fn get(&self) -> Result<Option<String>> {
        Ok(self
            .token
            .lock()
            .map_err(|_| EngineError::InvalidState("token lock poisoned".into()))?
            .clone())
    }

    fn set(&self, token: &str) -> Result<()> {
        validate_token(token)?;
        *self
            .token
            .lock()
            .map_err(|_| EngineError::InvalidState("token lock poisoned".into()))? =
            Some(token.to_string());
        Ok(())
    }

    fn delete(&self) -> Result<()> {
        *self
            .token
            .lock()
            .map_err(|_| EngineError::InvalidState("token lock poisoned".into()))? = None;
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct KeyringTokenStore;

impl LocalApiTokenStore for KeyringTokenStore {
    fn status(&self) -> Result<bool> {
        Ok(self.get()?.is_some())
    }

    fn get(&self) -> Result<Option<String>> {
        let entry = Entry::new(LOCAL_API_CREDENTIAL_SERVICE, LOCAL_API_CREDENTIAL_ACCOUNT)
            .map_err(|error| {
                EngineError::CredentialUnavailable(format!("local API keyring entry: {error}"))
            })?;
        match entry.get_password() {
            Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
            Ok(_) => Ok(None),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(EngineError::CredentialUnavailable(format!(
                "local API keyring read failed: {error}"
            ))),
        }
    }

    fn set(&self, token: &str) -> Result<()> {
        validate_token(token)?;
        let entry = Entry::new(LOCAL_API_CREDENTIAL_SERVICE, LOCAL_API_CREDENTIAL_ACCOUNT)
            .map_err(|error| {
                EngineError::CredentialUnavailable(format!("local API keyring entry: {error}"))
            })?;
        entry.set_password(token).map_err(|error| {
            EngineError::CredentialUnavailable(format!("local API keyring write failed: {error}"))
        })
    }

    fn delete(&self) -> Result<()> {
        let entry = Entry::new(LOCAL_API_CREDENTIAL_SERVICE, LOCAL_API_CREDENTIAL_ACCOUNT)
            .map_err(|error| {
                EngineError::CredentialUnavailable(format!("local API keyring entry: {error}"))
            })?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(EngineError::CredentialUnavailable(format!(
                "local API keyring delete failed: {error}"
            ))),
        }
    }
}

pub fn default_token_store() -> Arc<dyn LocalApiTokenStore> {
    if env::var_os("TRANSLUNAR_API_TEST_MODE").is_some() {
        let store = MemoryTokenStore::default();
        if let Ok(token) = env::var("TRANSLUNAR_API_TEST_TOKEN") {
            let _ = store.set(&token);
        }
        Arc::new(store)
    } else {
        Arc::new(KeyringTokenStore)
    }
}

pub fn generate_token() -> String {
    let first = Uuid::now_v7();
    // Second v7 shortly after adds entropy without requiring the v4 feature.
    std::thread::sleep(std::time::Duration::from_millis(1));
    let second = Uuid::now_v7();
    let mut material = Vec::with_capacity(32);
    material.extend_from_slice(first.as_bytes());
    material.extend_from_slice(second.as_bytes());
    URL_SAFE_NO_PAD.encode(material)
}

pub fn ensure_token(store: &dyn LocalApiTokenStore) -> Result<String> {
    if let Some(existing) = store.get()? {
        return Ok(existing);
    }
    let token = generate_token();
    store.set(&token)?;
    Ok(token)
}

pub fn rotate_token(store: &dyn LocalApiTokenStore) -> Result<String> {
    let token = generate_token();
    store.set(&token)?;
    Ok(token)
}

pub fn authorize(store: &dyn LocalApiTokenStore, header: Option<&str>) -> Result<()> {
    let expected = store.get()?.ok_or_else(|| {
        EngineError::InvalidRequest(
            "local API token is not configured; run `translunar token ensure`".into(),
        )
    })?;
    let provided = header
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| EngineError::InvalidRequest("missing bearer token".into()))?;
    if provided != expected {
        return Err(EngineError::InvalidRequest(
            "invalid local API bearer token".into(),
        ));
    }
    Ok(())
}

fn validate_token(token: &str) -> Result<()> {
    let trimmed = token.trim();
    if trimmed.len() < MIN_TOKEN_BYTES {
        return Err(EngineError::InvalidRequest(
            "local API token is too short".into(),
        ));
    }
    if trimmed.chars().any(|ch| ch.is_whitespace()) {
        return Err(EngineError::InvalidRequest(
            "local API token must not contain whitespace".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_round_trip_and_auth() {
        let store = MemoryTokenStore::default();
        assert!(!store.status().unwrap());
        let token = ensure_token(&store).unwrap();
        assert!(store.status().unwrap());
        authorize(&store, Some(&format!("Bearer {token}"))).unwrap();
        authorize(&store, Some("Bearer wrong")).unwrap_err();
        authorize(&store, None).unwrap_err();
        let rotated = rotate_token(&store).unwrap();
        assert_ne!(token, rotated);
        authorize(&store, Some(&format!("Bearer {rotated}"))).unwrap();
    }
}
