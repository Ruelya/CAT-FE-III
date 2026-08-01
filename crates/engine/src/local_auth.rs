//! Bearer-token authentication for the local HTTP API and CLI.

use std::env;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use keyring::Entry;

use crate::{EngineError, Result};

pub const LOCAL_API_CREDENTIAL_SERVICE: &str = "translunar-cat.local-api";
pub const LOCAL_API_CREDENTIAL_ACCOUNT: &str = "default";
/// Generated tokens are 32 CSPRNG bytes, base64url-encoded (no pad).
/// Accepted tokens must base64url-decode to at least this many bytes.
const MIN_TOKEN_DECODED_BYTES: usize = 32;
/// Documented opt-in for the in-memory token backend (CI/tests).
/// Only the exact value `1` enables test mode; no aliases (`true`/`yes`/presence) are supported.
pub const API_TEST_MODE_OPT_IN: &str = "1";

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

/// Whether `TRANSLUNAR_API_TEST_MODE` is active.
///
/// Contract: only the exact opt-in value [`API_TEST_MODE_OPT_IN`] (`"1"`) enables
/// the memory backend. Unset, empty, `0`, `false`, and any other value leave the
/// OS keyring path selected.
pub fn api_test_mode_enabled() -> bool {
    is_api_test_mode_value(env::var("TRANSLUNAR_API_TEST_MODE").ok().as_deref())
}

fn is_api_test_mode_value(value: Option<&str>) -> bool {
    matches!(value, Some(v) if v == API_TEST_MODE_OPT_IN)
}

/// Build the process-default token store.
///
/// When `TRANSLUNAR_API_TEST_MODE=1`, uses an in-memory backend. If
/// `TRANSLUNAR_API_TEST_TOKEN` is set, it is validated and injected; invalid
/// values fail loudly (no silent fall-through to a random `ensure_token`).
pub fn default_token_store() -> Result<Arc<dyn LocalApiTokenStore>> {
    if api_test_mode_enabled() {
        let store = memory_token_store_from_test_token(
            env::var("TRANSLUNAR_API_TEST_TOKEN").ok().as_deref(),
        )?;
        Ok(Arc::new(store))
    } else {
        Ok(Arc::new(KeyringTokenStore))
    }
}

/// Construct a memory store, optionally seeding a fixed test token.
///
/// Used by [`default_token_store`] and unit tests so invalid
/// `TRANSLUNAR_API_TEST_TOKEN` values never get swallowed.
fn memory_token_store_from_test_token(test_token: Option<&str>) -> Result<MemoryTokenStore> {
    let store = MemoryTokenStore::default();
    if let Some(token) = test_token {
        store.set(token).map_err(|error| {
            EngineError::InvalidRequest(format!(
                "TRANSLUNAR_API_TEST_TOKEN is invalid: {error}"
            ))
        })?;
    }
    Ok(store)
}

/// Fill 32 bytes from the OS CSPRNG and base64url-encode (no padding).
pub fn generate_token() -> String {
    let mut material = [0_u8; MIN_TOKEN_DECODED_BYTES];
    getrandom::getrandom(&mut material).expect("operating-system CSPRNG is required for API tokens");
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
    if trimmed.chars().any(|ch| ch.is_whitespace()) {
        return Err(EngineError::InvalidRequest(
            "local API token must not contain whitespace".into(),
        ));
    }
    let decoded = URL_SAFE_NO_PAD.decode(trimmed.as_bytes()).map_err(|_| {
        EngineError::InvalidRequest(
            "local API token must be base64url-encoded random bytes".into(),
        )
    })?;
    if decoded.len() < MIN_TOKEN_DECODED_BYTES {
        return Err(EngineError::InvalidRequest(format!(
            "local API token must decode to at least {MIN_TOKEN_DECODED_BYTES} bytes"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EngineService;
    use tempfile::tempdir;

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

    #[test]
    fn generated_token_is_base64url_of_32_csprng_bytes() {
        let token = generate_token();
        // Assert format properties without logging the secret.
        assert!(
            !token.chars().any(|ch| ch.is_whitespace() || ch == '='),
            "token must be unpadded base64url without whitespace"
        );
        assert!(
            token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
            "token must use base64url alphabet only"
        );
        let decoded = URL_SAFE_NO_PAD
            .decode(token.as_bytes())
            .expect("generated token must base64url-decode");
        assert_eq!(
            decoded.len(),
            MIN_TOKEN_DECODED_BYTES,
            "generated token must decode to exactly {MIN_TOKEN_DECODED_BYTES} bytes"
        );
        validate_token(&token).expect("generated token must pass validation");
        // Short / non-base64url material must be rejected (min decoded-byte rule).
        assert!(validate_token("too-short").is_err());
        assert!(validate_token(&"a".repeat(24)).is_err());
        // 31 decoded bytes is insufficient even when base64url-shaped.
        let short = URL_SAFE_NO_PAD.encode([0_u8; 31]);
        assert!(validate_token(&short).is_err());
        let exact = URL_SAFE_NO_PAD.encode([7_u8; MIN_TOKEN_DECODED_BYTES]);
        assert!(validate_token(&exact).is_ok());
    }

    #[test]
    fn api_test_mode_only_when_value_is_one() {
        assert!(!is_api_test_mode_value(None));
        assert!(!is_api_test_mode_value(Some("")));
        assert!(!is_api_test_mode_value(Some("0")));
        assert!(!is_api_test_mode_value(Some("false")));
        assert!(!is_api_test_mode_value(Some("true")));
        assert!(!is_api_test_mode_value(Some("yes")));
        assert!(is_api_test_mode_value(Some(API_TEST_MODE_OPT_IN)));
        assert!(is_api_test_mode_value(Some("1")));
    }

    #[test]
    fn invalid_api_test_token_injection_fails_loudly() {
        // Legacy smoke-style plaintext token must not seed the memory store.
        let err = memory_token_store_from_test_token(Some("test-local-api-token-value-32b"))
            .expect_err("invalid TRANSLUNAR_API_TEST_TOKEN must fail");
        match err {
            EngineError::InvalidRequest(message) => {
                assert!(
                    message.contains("TRANSLUNAR_API_TEST_TOKEN"),
                    "error should name the env var: {message}"
                );
            }
            other => panic!("expected InvalidRequest, got {other:?}"),
        }
        // Unset / absent is fine (empty memory store).
        assert!(memory_token_store_from_test_token(None).is_ok());
        // Valid fixed base64url of 32 bytes seeds the store.
        let valid = URL_SAFE_NO_PAD.encode([7_u8; MIN_TOKEN_DECODED_BYTES]);
        let store = memory_token_store_from_test_token(Some(&valid)).unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some(valid.as_str()));
    }

    #[test]
    fn token_never_persists_into_sqlite_workspace() {
        let directory = tempdir().unwrap();
        let data_dir = directory.path().join("data");
        // Open a real workspace so translunar.sqlite3 exists.
        let _service = EngineService::open(&data_dir).unwrap();
        let store = MemoryTokenStore::default();
        let token = ensure_token(&store).unwrap();
        let rotated = rotate_token(&store).unwrap();
        let db_bytes = std::fs::read(data_dir.join("translunar.sqlite3")).expect("read db");
        assert!(
            !db_bytes
                .windows(token.len())
                .any(|window| window == token.as_bytes()),
            "raw API token must not appear in SQLite"
        );
        assert!(
            !db_bytes
                .windows(rotated.len())
                .any(|window| window == rotated.as_bytes()),
            "rotated API token must not appear in SQLite"
        );
        // Service namespace markers should also stay out of the DB blob.
        assert!(!db_bytes.windows(LOCAL_API_CREDENTIAL_SERVICE.len()).any(|window| {
            window == LOCAL_API_CREDENTIAL_SERVICE.as_bytes()
        }));
    }
}
