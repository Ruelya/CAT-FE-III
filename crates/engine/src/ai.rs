use std::collections::HashMap;
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use chrono::{Datelike, TimeZone, Utc};
use translunar_ai_core::{
    AiAction, AiBatchItemStatus, AiBatchRun, AiBatchStatus, AiConversation, AiConversationRole,
    AiCoreError, AiCredentialStatus, AiEventSink, AiMessage, AiMessageRole, AiProviderKind,
    AiProviderProfile, AiRun, AiRunKind, AiRunRequest, AiRunStatus, GroundingContextSegment,
    GroundingInput, GroundingOptions, GroundingTerm, GroundingTmMatch, PromptBundle,
    ProviderRequest, SecretString, build_grounded_prompt, execute_provider, provider_catalog,
};
use translunar_domain::{EditorWorkflowState, SegmentState, TagKind};
use translunar_editor_core::validate_target_tags;
use translunar_protocol::{
    AiBatchIdParams, AiBatchItemPage, AiBatchItemsParams, AiBatchListParams, AiBatchPage,
    AiBatchRevisionParams, AiBatchStartParams, AiConversationCreateParams,
    AiConversationListParams, AiConversationMessagePage, AiConversationMessagesParams,
    AiConversationPage, AiConversationUpdateParams, AiGroundingPreviewParams,
    AiGroundingPreviewResult, AiProfileIdParams, AiProfileRevisionParams, AiProviderCatalogParams,
    AiProviderCatalogResult, AiProviderCreateParams, AiProviderListParams, AiProviderPage,
    AiProviderTestResult, AiProviderUpdateParams, AiResultApplyParams, AiRunEventPage,
    AiRunEventsParams, AiRunIdParams, AiRunListParams, AiRunPage, AiRunRevisionParams,
    AiRunStartParams, AiSettingsGetParams, AiSettingsUpdateParams, AiUsageQueryParams,
    AiUsageQueryResult, EditorMutationResult, EmptyResult, SetAiCredentialParams,
};
use translunar_storage::{
    AiProviderProfileUpdate, AiSettingsUpdate, NewAiBatchItem, NewAiBatchRun, NewAiProviderProfile,
    NewAiRun, StorageError, Store, TermSearchRequest, TmSearchRequest,
};

use crate::{EngineError, EngineService, Result};

const CREDENTIAL_SERVICE: &str = "translunar-cat.ai";
const MAX_RUN_POLL_SLEEP_MS: u64 = 250;

pub(super) trait CredentialStore: Send + Sync {
    fn backend(&self) -> &'static str;
    fn status(&self, profile_id: &str) -> std::result::Result<bool, CredentialError>;
    fn set(&self, profile_id: &str, secret: &str) -> std::result::Result<(), CredentialError>;
    fn get(&self, profile_id: &str) -> std::result::Result<String, CredentialError>;
    fn delete(&self, profile_id: &str) -> std::result::Result<(), CredentialError>;
}

#[derive(Debug)]
pub(super) enum CredentialError {
    Missing,
    Unavailable,
    Failed,
}

struct KeyringCredentialStore;

impl KeyringCredentialStore {
    fn entry(profile_id: &str) -> std::result::Result<keyring::Entry, CredentialError> {
        keyring::Entry::new(CREDENTIAL_SERVICE, profile_id)
            .map_err(|_| CredentialError::Unavailable)
    }
}

impl CredentialStore for KeyringCredentialStore {
    fn backend(&self) -> &'static str {
        "os-keyring"
    }

    fn status(&self, profile_id: &str) -> std::result::Result<bool, CredentialError> {
        match Self::entry(profile_id)?.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err(CredentialError::Unavailable),
        }
    }

    fn set(&self, profile_id: &str, secret: &str) -> std::result::Result<(), CredentialError> {
        Self::entry(profile_id)?
            .set_password(secret)
            .map_err(|_| CredentialError::Failed)
    }

    fn get(&self, profile_id: &str) -> std::result::Result<String, CredentialError> {
        match Self::entry(profile_id)?.get_password() {
            Ok(secret) => Ok(secret),
            Err(keyring::Error::NoEntry) => Err(CredentialError::Missing),
            Err(_) => Err(CredentialError::Unavailable),
        }
    }

    fn delete(&self, profile_id: &str) -> std::result::Result<(), CredentialError> {
        match Self::entry(profile_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(CredentialError::Failed),
        }
    }
}

#[derive(Default)]
struct MemoryCredentialStore {
    values: Mutex<HashMap<String, String>>,
    fallback: Option<String>,
}

impl MemoryCredentialStore {
    fn with_fallback(value: Option<String>) -> Self {
        Self {
            values: Mutex::new(HashMap::new()),
            fallback: value,
        }
    }
}

impl CredentialStore for MemoryCredentialStore {
    fn backend(&self) -> &'static str {
        "test-memory"
    }

    fn status(&self, profile_id: &str) -> std::result::Result<bool, CredentialError> {
        let values = self.values.lock().map_err(|_| CredentialError::Failed)?;
        Ok(values.contains_key(profile_id) || self.fallback.is_some())
    }

    fn set(&self, profile_id: &str, secret: &str) -> std::result::Result<(), CredentialError> {
        self.values
            .lock()
            .map_err(|_| CredentialError::Failed)?
            .insert(profile_id.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, profile_id: &str) -> std::result::Result<String, CredentialError> {
        let values = self.values.lock().map_err(|_| CredentialError::Failed)?;
        values
            .get(profile_id)
            .cloned()
            .or_else(|| self.fallback.clone())
            .ok_or(CredentialError::Missing)
    }

    fn delete(&self, profile_id: &str) -> std::result::Result<(), CredentialError> {
        self.values
            .lock()
            .map_err(|_| CredentialError::Failed)?
            .remove(profile_id);
        Ok(())
    }
}

#[derive(Clone)]
pub(super) struct AiManager {
    data_dir: std::path::PathBuf,
    credentials: Arc<dyn CredentialStore>,
    active_runs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    active_batches: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl AiManager {
    pub(super) fn new(data_dir: std::path::PathBuf) -> Result<Self> {
        let credentials: Arc<dyn CredentialStore> =
            if env::var("TRANSLUNAR_AI_TEST_MODE").ok().as_deref() == Some("1") {
                Arc::new(MemoryCredentialStore::with_fallback(
                    env::var("TRANSLUNAR_AI_TEST_CREDENTIAL").ok(),
                ))
            } else {
                Arc::new(KeyringCredentialStore)
            };
        Ok(Self::with_credentials(data_dir, credentials))
    }

    fn with_credentials(
        data_dir: std::path::PathBuf,
        credentials: Arc<dyn CredentialStore>,
    ) -> Self {
        Self {
            data_dir,
            credentials,
            active_runs: Arc::new(Mutex::new(HashMap::new())),
            active_batches: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn spawn_run(&self, run_id: String) {
        let token = Arc::new(AtomicBool::new(false));
        if let Ok(mut active) = self.active_runs.lock() {
            if active.contains_key(&run_id) {
                return;
            }
            active.insert(run_id.clone(), Arc::clone(&token));
        } else {
            return;
        }
        let manager = self.clone();
        thread::spawn(move || {
            manager.execute_run(&run_id, &token);
            if let Ok(mut active) = manager.active_runs.lock() {
                active.remove(&run_id);
            }
        });
    }

    fn cancel_run(&self, run_id: &str) {
        if let Ok(active) = self.active_runs.lock()
            && let Some(token) = active.get(run_id)
        {
            token.store(true, Ordering::Relaxed);
        }
    }

    fn execute_run(&self, run_id: &str, token: &AtomicBool) {
        let mut store = match Store::open_worker(&self.data_dir) {
            Ok(store) => store,
            Err(_) => return,
        };
        let initial = match store.get_ai_run(run_id) {
            Ok(run) => run,
            Err(_) => return,
        };
        let profile_id = match initial.profile_id.as_deref() {
            Some(profile_id) => profile_id.to_string(),
            None => {
                let _ = store.fail_ai_run(
                    run_id,
                    "provider_profile_missing",
                    false,
                    AiProviderKind::OpenaiCompatible,
                    0,
                );
                return;
            }
        };
        let profile = match store.get_ai_provider_profile(&profile_id) {
            Ok(profile) => profile,
            Err(_) => {
                let _ = store.fail_ai_run(
                    run_id,
                    "provider_profile_missing",
                    false,
                    AiProviderKind::OpenaiCompatible,
                    0,
                );
                return;
            }
        };
        let secret = match self.credentials.get(&profile_id) {
            Ok(secret) => match SecretString::new(secret) {
                Ok(secret) => secret,
                Err(_) => {
                    let _ = store.fail_ai_run(run_id, "credential_invalid", false, profile.kind, 0);
                    return;
                }
            },
            Err(error) => {
                let code = match error {
                    CredentialError::Missing => "credential_missing",
                    CredentialError::Unavailable | CredentialError::Failed => {
                        "credential_unavailable"
                    }
                };
                let _ = store.fail_ai_run(run_id, code, false, profile.kind, 0);
                return;
            }
        };

        loop {
            if token.load(Ordering::Relaxed)
                || store.ai_run_cancel_requested(run_id).unwrap_or(false)
            {
                finalize_run_cancel(&mut store, run_id);
                return;
            }
            let run = match store.start_ai_run_attempt(run_id) {
                Ok(run) => run,
                Err(_) => return,
            };
            let request = match provider_request_for_run(&store, &run, &profile) {
                Ok(request) => request,
                Err(_) => {
                    let _ = store.fail_ai_run(run_id, "grounding_failed", false, profile.kind, 0);
                    return;
                }
            };
            let started = Instant::now();
            let completion = {
                let mut sink = StoreEventSink {
                    store: &mut store,
                    run_id,
                    cancellation: token,
                };
                execute_provider(&request, &secret, token, &mut sink)
            };
            match completion {
                Ok(completion) => {
                    let completed = store.complete_ai_run(
                        run_id,
                        &completion.text,
                        profile.kind,
                        completion.usage,
                        completion.elapsed_ms,
                    );
                    if completed.is_ok()
                        && let Some(conversation_id) = run.request.conversation_id.as_deref()
                    {
                        let _ = store.append_ai_conversation_message(
                            conversation_id,
                            AiConversationRole::Assistant,
                            &completion.text,
                            Some(&completion.text),
                            run.segment_id.as_deref(),
                            Some(run_id),
                        );
                    }
                    return;
                }
                Err(AiCoreError::Canceled) => {
                    finalize_run_cancel(&mut store, run_id);
                    return;
                }
                Err(error) if error.retryable() && run.attempt < run.max_attempts => {
                    let retry_after_ms = match error {
                        AiCoreError::RateLimited { retry_after_ms } => {
                            retry_after_ms.unwrap_or_else(|| retry_delay_ms(run.attempt))
                        }
                        _ => retry_delay_ms(run.attempt),
                    };
                    if store
                        .retry_ai_run(run_id, provider_error_code(&error), retry_after_ms)
                        .is_err()
                    {
                        return;
                    }
                    if !wait_with_cancellation(retry_after_ms, token, || {
                        store.ai_run_cancel_requested(run_id).unwrap_or(false)
                    }) {
                        finalize_run_cancel(&mut store, run_id);
                        return;
                    }
                }
                Err(error) => {
                    let _ = store.fail_ai_run(
                        run_id,
                        provider_error_code(&error),
                        error.retryable(),
                        profile.kind,
                        u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
                    );
                    return;
                }
            }
        }
    }

    pub(super) fn spawn_batch(&self, batch_id: String) {
        let token = Arc::new(AtomicBool::new(false));
        if let Ok(mut active) = self.active_batches.lock() {
            if active.contains_key(&batch_id) {
                return;
            }
            active.insert(batch_id.clone(), Arc::clone(&token));
        } else {
            return;
        }
        let manager = self.clone();
        thread::spawn(move || {
            manager.execute_batch(&batch_id, &token);
            if let Ok(mut active) = manager.active_batches.lock() {
                active.remove(&batch_id);
            }
        });
    }

    pub(super) fn cancel_batch(&self, batch_id: &str) {
        if let Ok(active) = self.active_batches.lock()
            && let Some(token) = active.get(batch_id)
        {
            token.store(true, Ordering::Relaxed);
        }
    }

    fn execute_batch(&self, batch_id: &str, token: &Arc<AtomicBool>) {
        let mut store = match Store::open_worker(&self.data_dir) {
            Ok(store) => store,
            Err(_) => return,
        };
        let batch = match store.start_ai_batch(batch_id) {
            Ok(batch) => batch,
            Err(_) => return,
        };
        drop(store);

        let gate = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60)));
        let mut workers = Vec::new();
        for _ in 0..batch.concurrency {
            let manager = self.clone();
            let batch_id = batch_id.to_string();
            let token = Arc::clone(token);
            let gate = Arc::clone(&gate);
            workers.push(thread::spawn(move || {
                manager.batch_worker(&batch_id, &token, &gate);
            }));
        }
        for worker in workers {
            let _ = worker.join();
        }
        if let Ok(mut store) = Store::open_worker(&self.data_dir) {
            let _ = store.refresh_ai_batch(batch_id);
        }
    }

    fn batch_worker(&self, batch_id: &str, token: &AtomicBool, gate: &Mutex<Instant>) {
        loop {
            let mut store = match Store::open_worker(&self.data_dir) {
                Ok(store) => store,
                Err(_) => return,
            };
            if token.load(Ordering::Relaxed)
                || store.ai_batch_cancel_requested(batch_id).unwrap_or(false)
            {
                return;
            }
            let batch = match store.get_ai_batch(batch_id) {
                Ok(batch) if batch.status == AiBatchStatus::Running => batch,
                _ => return,
            };
            let item = match store.claim_ai_batch_item(batch_id) {
                Ok(Some(item)) => item,
                _ => return,
            };
            if process_tm_batch_item(&mut store, &batch, &item) {
                continue;
            }
            if !wait_rate_limit(gate, batch.requests_per_minute, token) {
                let _ = store.finish_ai_batch_item(
                    batch_id,
                    &item.segment_id,
                    AiBatchItemStatus::Canceled,
                    None,
                    Some("canceled"),
                );
                return;
            }
            let built = match build_grounding(
                &store,
                &batch.project_id,
                &item.segment_id,
                AiAction::Translate,
                "",
                &batch.grounding_options,
                GroundingPurpose::Batch,
            ) {
                Ok(built) => built,
                Err(_) => {
                    let _ = store.finish_ai_batch_item(
                        batch_id,
                        &item.segment_id,
                        AiBatchItemStatus::Failed,
                        None,
                        Some("grounding_failed"),
                    );
                    continue;
                }
            };
            let profile = match store.get_ai_provider_profile(&batch.profile_id) {
                Ok(profile) => profile,
                Err(_) => return,
            };
            let run = match store.create_ai_run(NewAiRun {
                kind: AiRunKind::BatchItem,
                project_id: Some(batch.project_id.clone()),
                document_id: Some(built.row.segment.document_id.clone()),
                segment_id: Some(item.segment_id.clone()),
                profile_id: Some(profile.id.clone()),
                model: profile.model,
                action: "translate".to_string(),
                prompt_hash: built.bundle.prompt_hash,
                request: AiRunRequest {
                    grounding_options: batch.grounding_options.clone(),
                    freeform_prompt: String::new(),
                    conversation_id: None,
                },
                base_segment_revision: Some(item.expected_revision),
                max_attempts: u32::from(batch.max_attempts),
            }) {
                Ok(run) => run,
                Err(_) => return,
            };
            if store
                .attach_ai_batch_item_run(batch_id, &item.segment_id, &run.id)
                .is_err()
            {
                return;
            }
            drop(store);
            self.execute_run(&run.id, token);
            let mut store = match Store::open_worker(&self.data_dir) {
                Ok(store) => store,
                Err(_) => return,
            };
            let run = match store.get_ai_run(&run.id) {
                Ok(run) => run,
                Err(_) => return,
            };
            match (run.status, run.proposal_text.as_deref()) {
                (AiRunStatus::Succeeded, Some(target)) => {
                    let tag_issues = store
                        .get_editor_row(&item.segment_id)
                        .map(|row| validate_target_tags(&row.source_tags, &row.target_tags, target))
                        .unwrap_or_default();
                    if !tag_issues.is_empty() {
                        let _ = store.finish_ai_batch_item(
                            batch_id,
                            &item.segment_id,
                            AiBatchItemStatus::Failed,
                            None,
                            Some("tag_validation_failed"),
                        );
                        continue;
                    }
                    match store.update_target(&item.segment_id, target, item.expected_revision) {
                        Ok(_) => {
                            let _ = store.finish_ai_batch_item(
                                batch_id,
                                &item.segment_id,
                                AiBatchItemStatus::Succeeded,
                                Some("engine"),
                                None,
                            );
                        }
                        Err(StorageError::Conflict { .. }) => {
                            let _ = store.finish_ai_batch_item(
                                batch_id,
                                &item.segment_id,
                                AiBatchItemStatus::Skipped,
                                None,
                                Some("revision_conflict"),
                            );
                        }
                        Err(_) => {
                            let _ = store.finish_ai_batch_item(
                                batch_id,
                                &item.segment_id,
                                AiBatchItemStatus::Failed,
                                None,
                                Some("target_write_failed"),
                            );
                        }
                    }
                }
                (AiRunStatus::Canceled, _) => {
                    let _ = store.finish_ai_batch_item(
                        batch_id,
                        &item.segment_id,
                        AiBatchItemStatus::Canceled,
                        None,
                        Some("canceled"),
                    );
                }
                _ => {
                    let _ = store.finish_ai_batch_item(
                        batch_id,
                        &item.segment_id,
                        AiBatchItemStatus::Failed,
                        None,
                        Some(run.error_code.as_deref().unwrap_or("provider_failed")),
                    );
                }
            }
        }
    }
}

impl EngineService {
    pub fn ai_provider_catalog(
        &self,
        _params: AiProviderCatalogParams,
    ) -> Result<AiProviderCatalogResult> {
        Ok(AiProviderCatalogResult {
            items: provider_catalog(),
        })
    }

    pub fn list_ai_providers(&self, params: AiProviderListParams) -> Result<AiProviderPage> {
        let limit = params.limit.clamp(1, 100);
        let (items, total) = self.store.list_ai_provider_profiles(params.offset, limit)?;
        Ok(AiProviderPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_ai_provider(
        &mut self,
        params: AiProviderCreateParams,
    ) -> Result<AiProviderProfile> {
        Ok(self
            .store
            .create_ai_provider_profile(NewAiProviderProfile {
                name: params.name,
                kind: params.kind,
                base_url: params.base_url,
                model: params.model,
                timeout_ms: params.timeout_ms,
                max_response_bytes: params.max_response_bytes,
                enabled: params.enabled,
            })?)
    }

    pub fn update_ai_provider(
        &mut self,
        params: AiProviderUpdateParams,
    ) -> Result<AiProviderProfile> {
        Ok(self.store.update_ai_provider_profile(
            &params.profile_id,
            AiProviderProfileUpdate {
                name: params.name,
                kind: params.kind,
                base_url: params.base_url,
                model: params.model,
                timeout_ms: params.timeout_ms,
                max_response_bytes: params.max_response_bytes,
                enabled: params.enabled,
                expected_revision: params.expected_revision,
            },
        )?)
    }

    pub fn delete_ai_provider(&mut self, params: AiProfileRevisionParams) -> Result<EmptyResult> {
        let profile = self.store.get_ai_provider_profile(&params.profile_id)?;
        if profile.revision != params.expected_revision {
            return Err(EngineError::Storage(StorageError::EntityConflict {
                entity: "ai_provider_profile",
                id: profile.id,
                expected_revision: params.expected_revision,
                actual_revision: profile.revision,
            }));
        }
        self.ai
            .credentials
            .delete(&params.profile_id)
            .map_err(credential_engine_error)?;
        self.store
            .delete_ai_provider_profile(&params.profile_id, params.expected_revision)?;
        Ok(EmptyResult::default())
    }

    pub fn set_ai_credential(
        &mut self,
        params: SetAiCredentialParams,
    ) -> Result<AiCredentialStatus> {
        self.store.get_ai_provider_profile(&params.profile_id)?;
        let secret = SecretString::new(params.secret)?;
        self.ai
            .credentials
            .set(&params.profile_id, secret.expose())
            .map_err(credential_engine_error)?;
        self.store
            .set_ai_provider_credential_present(&params.profile_id, true)?;
        Ok(AiCredentialStatus {
            available: true,
            present: true,
            backend: self.ai.credentials.backend().to_string(),
        })
    }

    pub fn delete_ai_credential(
        &mut self,
        params: AiProfileIdParams,
    ) -> Result<AiCredentialStatus> {
        self.store.get_ai_provider_profile(&params.profile_id)?;
        self.ai
            .credentials
            .delete(&params.profile_id)
            .map_err(credential_engine_error)?;
        self.store
            .set_ai_provider_credential_present(&params.profile_id, false)?;
        Ok(AiCredentialStatus {
            available: true,
            present: false,
            backend: self.ai.credentials.backend().to_string(),
        })
    }

    pub fn ai_credential_status(
        &mut self,
        params: AiProfileIdParams,
    ) -> Result<AiCredentialStatus> {
        self.store.get_ai_provider_profile(&params.profile_id)?;
        match self.ai.credentials.status(&params.profile_id) {
            Ok(present) => {
                self.store
                    .set_ai_provider_credential_present(&params.profile_id, present)?;
                Ok(AiCredentialStatus {
                    available: true,
                    present,
                    backend: self.ai.credentials.backend().to_string(),
                })
            }
            Err(CredentialError::Missing) => Ok(AiCredentialStatus {
                available: true,
                present: false,
                backend: self.ai.credentials.backend().to_string(),
            }),
            Err(_) => Ok(AiCredentialStatus {
                available: false,
                present: false,
                backend: self.ai.credentials.backend().to_string(),
            }),
        }
    }

    pub fn test_ai_provider(&mut self, params: AiProfileIdParams) -> Result<AiProviderTestResult> {
        let profile = reconcile_profile_credential(
            &mut self.store,
            self.ai.credentials.as_ref(),
            &params.profile_id,
        )?;
        ensure_profile_ready(&profile)?;
        let messages = vec![
            AiMessage {
                role: AiMessageRole::System,
                text: "You are a translation engine connection test.".to_string(),
            },
            AiMessage {
                role: AiMessageRole::User,
                text: "Reply with OK only.".to_string(),
            },
        ];
        let prompt_hash = prompt_hash(&messages)?;
        let run = self.store.create_ai_run(NewAiRun {
            kind: AiRunKind::ProviderTest,
            project_id: None,
            document_id: None,
            segment_id: None,
            profile_id: Some(profile.id),
            model: profile.model,
            action: "provider_test".to_string(),
            prompt_hash,
            request: AiRunRequest {
                grounding_options: GroundingOptions::default(),
                freeform_prompt: "Reply with OK only.".to_string(),
                conversation_id: None,
            },
            base_segment_revision: None,
            max_attempts: 1,
        })?;
        self.ai.spawn_run(run.id.clone());
        Ok(AiProviderTestResult { run })
    }

    pub fn get_ai_settings(
        &self,
        _params: AiSettingsGetParams,
    ) -> Result<translunar_ai_core::AiSettings> {
        Ok(self.store.get_ai_settings()?)
    }

    pub fn update_ai_settings(
        &mut self,
        params: AiSettingsUpdateParams,
    ) -> Result<translunar_ai_core::AiSettings> {
        Ok(self.store.update_ai_settings(AiSettingsUpdate {
            enabled: params.enabled,
            default_profile_id: params.default_profile_id,
            monthly_token_budget: params.monthly_token_budget,
            allow_interactive: params.allow_interactive,
            allow_batch: params.allow_batch,
            allowed_origins: params.allowed_origins,
            expected_revision: params.expected_revision,
        })?)
    }

    pub fn preview_ai_grounding(
        &self,
        params: AiGroundingPreviewParams,
    ) -> Result<AiGroundingPreviewResult> {
        let built = build_grounding(
            &self.store,
            &params.project_id,
            &params.segment_id,
            params.action,
            &params.prompt,
            &params.options,
            GroundingPurpose::Interactive,
        )?;
        if built.row.segment.revision != params.expected_revision {
            return Err(EngineError::Storage(StorageError::Conflict {
                segment_id: params.segment_id,
                expected_revision: params.expected_revision,
                actual_revision: built.row.segment.revision,
            }));
        }
        Ok(AiGroundingPreviewResult {
            segment_id: built.row.segment.id,
            segment_revision: built.row.segment.revision,
            bundle: built.bundle,
        })
    }

    pub fn start_ai_run(&mut self, params: AiRunStartParams) -> Result<AiRun> {
        enforce_ai_policy(&self.store, true, false)?;
        let profile = reconcile_profile_credential(
            &mut self.store,
            self.ai.credentials.as_ref(),
            &params.profile_id,
        )?;
        enforce_profile_policy(&self.store, &profile)?;
        let built = build_grounding(
            &self.store,
            &params.project_id,
            &params.segment_id,
            params.action,
            &params.prompt,
            &params.options,
            GroundingPurpose::Interactive,
        )?;
        if built.row.segment.revision != params.expected_revision {
            return Err(EngineError::Storage(StorageError::Conflict {
                segment_id: params.segment_id,
                expected_revision: params.expected_revision,
                actual_revision: built.row.segment.revision,
            }));
        }
        if built.row.workflow_state == EditorWorkflowState::Signed {
            return Err(EngineError::InvalidState(
                "a signed segment cannot start an AI edit".to_string(),
            ));
        }
        if let Some(conversation_id) = params.conversation_id.as_deref() {
            let conversation = self.store.get_ai_conversation(conversation_id)?;
            if conversation.project_id != params.project_id {
                return Err(EngineError::InvalidRequest(
                    "AI conversation belongs to another project".to_string(),
                ));
            }
            self.store.append_ai_conversation_message(
                conversation_id,
                AiConversationRole::User,
                if params.prompt.trim().is_empty() {
                    action_label(params.action)
                } else {
                    &params.prompt
                },
                None,
                Some(&params.segment_id),
                None,
            )?;
        }
        let run = self.store.create_ai_run(NewAiRun {
            kind: if params.action == AiAction::Translate {
                AiRunKind::Interactive
            } else {
                AiRunKind::Action
            },
            project_id: Some(params.project_id),
            document_id: Some(built.row.segment.document_id.clone()),
            segment_id: Some(params.segment_id),
            profile_id: Some(profile.id),
            model: profile.model,
            action: action_text(params.action).to_string(),
            prompt_hash: built.bundle.prompt_hash,
            request: AiRunRequest {
                grounding_options: params.options,
                freeform_prompt: params.prompt,
                conversation_id: params.conversation_id,
            },
            base_segment_revision: Some(params.expected_revision),
            max_attempts: params.max_attempts,
        })?;
        self.ai.spawn_run(run.id.clone());
        Ok(run)
    }

    pub fn get_ai_run(&self, params: AiRunIdParams) -> Result<AiRun> {
        Ok(self.store.get_ai_run(&params.run_id)?)
    }

    pub fn list_ai_runs(&self, params: AiRunListParams) -> Result<AiRunPage> {
        let limit = params.limit.clamp(1, 200);
        let (items, total) =
            self.store
                .list_ai_runs(params.project_id.as_deref(), params.offset, limit)?;
        Ok(AiRunPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn list_ai_run_events(&self, params: AiRunEventsParams) -> Result<AiRunEventPage> {
        let items = self.store.list_ai_run_events(
            &params.run_id,
            params.after_sequence,
            params.limit.clamp(1, 500),
        )?;
        let last_sequence = items
            .last()
            .map_or(params.after_sequence, |event| event.sequence);
        Ok(AiRunEventPage {
            items,
            after_sequence: params.after_sequence,
            last_sequence,
        })
    }

    pub fn cancel_ai_run(&mut self, params: AiRunRevisionParams) -> Result<AiRun> {
        let run = self
            .store
            .request_ai_run_cancel(&params.run_id, params.expected_revision)?;
        self.ai.cancel_run(&params.run_id);
        if run.status == AiRunStatus::Canceling {
            Ok(self.store.get_ai_run(&params.run_id)?)
        } else {
            Ok(run)
        }
    }

    pub fn resume_ai_run(&mut self, params: AiRunRevisionParams) -> Result<AiRun> {
        let run = self
            .store
            .resume_ai_run(&params.run_id, params.expected_revision)?;
        self.ai.spawn_run(run.id.clone());
        Ok(run)
    }

    pub fn apply_ai_result(&mut self, params: AiResultApplyParams) -> Result<EditorMutationResult> {
        let run = self.store.get_ai_run(&params.run_id)?;
        if run.revision != params.expected_run_revision {
            return Err(EngineError::Storage(StorageError::EntityConflict {
                entity: "ai_run",
                id: run.id,
                expected_revision: params.expected_run_revision,
                actual_revision: run.revision,
            }));
        }
        if run.status != AiRunStatus::Succeeded {
            return Err(EngineError::InvalidState(
                "only a successful AI run can be applied".to_string(),
            ));
        }
        let segment_id = run.segment_id.ok_or_else(|| {
            EngineError::InvalidState("AI run does not reference a segment".to_string())
        })?;
        let proposal = run.proposal_text.ok_or_else(|| {
            EngineError::InvalidState("AI run has no target proposal".to_string())
        })?;
        let current_row = self.store.get_editor_row(&segment_id)?;
        if !validate_target_tags(
            &current_row.source_tags,
            &current_row.target_tags,
            &proposal,
        )
        .is_empty()
        {
            return Err(EngineError::InvalidState(
                "AI proposal does not preserve the protected tag structure".to_string(),
            ));
        }
        self.store
            .update_target(&segment_id, &proposal, params.expected_segment_revision)?;
        let row = self.store.get_editor_row(&segment_id)?;
        let project_id = run.project_id.ok_or_else(|| {
            EngineError::InvalidState("AI run does not reference a project".to_string())
        })?;
        let counts = self.store.get_project(&project_id)?.counts;
        Ok(EditorMutationResult {
            rows: vec![row],
            counts,
            operation_id: None,
            focus_segment_id: Some(segment_id),
        })
    }

    pub fn start_ai_batch(&mut self, params: AiBatchStartParams) -> Result<AiBatchRun> {
        create_and_spawn_ai_batch(&mut self.store, &self.ai, params)
    }

    pub fn get_ai_batch(&self, params: AiBatchIdParams) -> Result<AiBatchRun> {
        Ok(self.store.get_ai_batch(&params.batch_id)?)
    }

    pub fn list_ai_batches(&self, params: AiBatchListParams) -> Result<AiBatchPage> {
        let limit = params.limit.clamp(1, 200);
        let (items, total) =
            self.store
                .list_ai_batches(&params.project_id, params.offset, limit)?;
        Ok(AiBatchPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn list_ai_batch_items(&self, params: AiBatchItemsParams) -> Result<AiBatchItemPage> {
        let limit = params.limit.clamp(1, 500);
        let (items, total) =
            self.store
                .list_ai_batch_items(&params.batch_id, params.offset, limit)?;
        Ok(AiBatchItemPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn cancel_ai_batch(&mut self, params: AiBatchRevisionParams) -> Result<AiBatchRun> {
        let batch = self
            .store
            .request_ai_batch_cancel(&params.batch_id, params.expected_revision)?;
        self.ai.cancel_batch(&params.batch_id);
        Ok(batch)
    }

    pub fn resume_ai_batch(&mut self, params: AiBatchRevisionParams) -> Result<AiBatchRun> {
        let batch = self
            .store
            .resume_ai_batch(&params.batch_id, params.expected_revision)?;
        self.ai.spawn_batch(batch.id.clone());
        Ok(batch)
    }

    pub fn query_ai_usage(&self, params: AiUsageQueryParams) -> Result<AiUsageQueryResult> {
        let limit = params.limit.clamp(1, 500);
        let (records, total) = self.store.list_ai_usage_records(
            params.project_id.as_deref(),
            params.since_ms,
            params.until_ms,
            params.offset,
            limit,
        )?;
        let aggregates = self.store.aggregate_ai_usage(
            params.project_id.as_deref(),
            params.since_ms,
            params.until_ms,
            params.dimension,
        )?;
        Ok(AiUsageQueryResult {
            records,
            aggregates,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn list_ai_conversations(
        &self,
        params: AiConversationListParams,
    ) -> Result<AiConversationPage> {
        let limit = params.limit.clamp(1, 200);
        let (items, total) = self.store.list_ai_conversations(
            &params.project_id,
            params.include_archived,
            params.offset,
            limit,
        )?;
        Ok(AiConversationPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_ai_conversation(
        &mut self,
        params: AiConversationCreateParams,
    ) -> Result<AiConversation> {
        Ok(self
            .store
            .create_ai_conversation(&params.project_id, &params.title)?)
    }

    pub fn update_ai_conversation(
        &mut self,
        params: AiConversationUpdateParams,
    ) -> Result<AiConversation> {
        Ok(self.store.update_ai_conversation(
            &params.conversation_id,
            &params.title,
            params.archived,
            params.expected_revision,
        )?)
    }

    pub fn list_ai_conversation_messages(
        &self,
        params: AiConversationMessagesParams,
    ) -> Result<AiConversationMessagePage> {
        let limit = params.limit.clamp(1, 500);
        let (items, total) = self.store.list_ai_conversation_messages(
            &params.conversation_id,
            params.offset,
            limit,
        )?;
        Ok(AiConversationMessagePage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }
}

struct BuiltGrounding {
    bundle: PromptBundle,
    row: translunar_domain::SegmentEditorRow,
    source_locale: String,
    target_locale: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GroundingPurpose {
    Interactive,
    Batch,
}

fn build_grounding(
    store: &Store,
    project_id: &str,
    segment_id: &str,
    action: AiAction,
    prompt: &str,
    options: &GroundingOptions,
    purpose: GroundingPurpose,
) -> Result<BuiltGrounding> {
    let project = store.get_project(project_id)?;
    let row = store.get_editor_row(segment_id)?;
    let document = store.get_document(&row.segment.document_id)?.document;
    if document.project_id != project_id {
        return Err(EngineError::InvalidRequest(
            "segment belongs to another project".to_string(),
        ));
    }
    let terms = if options.include_terms {
        store
            .search_terms(&TermSearchRequest {
                project_id: project_id.to_string(),
                text: row.segment.source_text.clone(),
                offset: 0,
                limit: 100,
                termbase_ids: Vec::new(),
            })?
            .0
            .into_iter()
            .flat_map(|term_match| {
                term_match
                    .translations
                    .into_iter()
                    .filter(|translation| translation.locale == project.project.target_locale)
                    .map(move |translation| GroundingTerm {
                        source: term_match.source_term.clone(),
                        target: translation.term,
                        preferred: translation.preferred,
                        forbidden: translation.forbidden,
                    })
            })
            .collect()
    } else {
        Vec::new()
    };
    let tm_matches = if options.include_tm && options.tm_top_n > 0 {
        store
            .search_tm(&TmSearchRequest {
                project_id: project_id.to_string(),
                source_locale: project.project.source_locale.clone(),
                target_locale: project.project.target_locale.clone(),
                query: row.segment.source_text.clone(),
                threshold: 0,
                offset: 0,
                limit: u32::from(options.tm_top_n.max(1)),
                library_ids: Vec::new(),
                domain: Some(project.project.domain.clone()),
                since_ms: None,
                origin_project_id: None,
                origin_document_id: None,
                context_before_hash: row
                    .context_before
                    .as_ref()
                    .map(|segment| segment.source_hash.clone()),
                context_after_hash: row
                    .context_after
                    .as_ref()
                    .map(|segment| segment.source_hash.clone()),
            })?
            .0
            .into_iter()
            .map(|item| GroundingTmMatch {
                source: item.unit.source_text,
                target: item.unit.target_text,
                score: item.score,
                provenance: format!("{}:{}", item.library.name, item.library.id),
            })
            .collect()
    } else {
        Vec::new()
    };
    let context = if options.include_context {
        let before = u32::from(options.context_before);
        let after = u32::from(options.context_after);
        let offset = row.segment.ordinal.saturating_sub(before);
        let limit = before.saturating_add(after).saturating_add(1);
        store
            .list_segments(&row.segment.document_id, offset, limit.max(1))?
            .0
            .into_iter()
            .map(|segment| GroundingContextSegment {
                relative: relative_ordinal(segment.ordinal, row.segment.ordinal),
                source: segment.source_text,
                // Batch workers update neighboring targets concurrently. Keeping their
                // target text out of batch grounding makes prompt hashes reproducible
                // across the create/execute boundary without weakening active-segment
                // revision checks. Interactive runs retain bilingual context.
                target: if purpose == GroundingPurpose::Interactive {
                    segment.target_text
                } else {
                    String::new()
                },
            })
            .collect()
    } else {
        Vec::new()
    };
    let tag_skeleton = row
        .source_tags
        .iter()
        .map(|tag| {
            let kind = match tag.kind {
                TagKind::Start => "start",
                TagKind::End => "end",
                TagKind::Standalone => "standalone",
            };
            format!(
                "{}:{}:{}:{}",
                tag.id,
                kind,
                tag.pair_id.as_deref().unwrap_or("none"),
                tag.display_text
            )
        })
        .collect();
    let bundle = build_grounded_prompt(
        &GroundingInput {
            source_locale: project.project.source_locale.clone(),
            target_locale: project.project.target_locale.clone(),
            source_text: row.segment.source_text.clone(),
            current_target: row.segment.target_text.clone(),
            action: action_text(action).to_string(),
            freeform_prompt: prompt.to_string(),
            tag_skeleton,
            terms,
            tm_matches,
            context,
        },
        options,
    )?;
    Ok(BuiltGrounding {
        bundle,
        row,
        source_locale: project.project.source_locale,
        target_locale: project.project.target_locale,
    })
}

fn provider_request_for_run(
    store: &Store,
    run: &AiRun,
    profile: &AiProviderProfile,
) -> Result<ProviderRequest> {
    if run.kind == AiRunKind::ProviderTest {
        let messages = vec![
            AiMessage {
                role: AiMessageRole::System,
                text: "You are a translation engine connection test.".to_string(),
            },
            AiMessage {
                role: AiMessageRole::User,
                text: run.request.freeform_prompt.clone(),
            },
        ];
        if prompt_hash(&messages)? != run.prompt_hash {
            return Err(EngineError::InvalidState(
                "AI provider-test prompt hash changed".to_string(),
            ));
        }
        return Ok(ProviderRequest {
            profile: profile.clone(),
            messages,
            source_text: "OK".to_string(),
            source_locale: "en".to_string(),
            target_locale: "en".to_string(),
        });
    }
    let project_id = run
        .project_id
        .as_deref()
        .ok_or_else(|| EngineError::InvalidState("AI run is missing a project".to_string()))?;
    let segment_id = run
        .segment_id
        .as_deref()
        .ok_or_else(|| EngineError::InvalidState("AI run is missing a segment".to_string()))?;
    let action = parse_action(&run.action)?;
    let built = build_grounding(
        store,
        project_id,
        segment_id,
        action,
        &run.request.freeform_prompt,
        &run.request.grounding_options,
        if run.kind == AiRunKind::BatchItem {
            GroundingPurpose::Batch
        } else {
            GroundingPurpose::Interactive
        },
    )?;
    if built.bundle.prompt_hash != run.prompt_hash
        || Some(built.row.segment.revision) != run.base_segment_revision
    {
        return Err(EngineError::InvalidState(
            "AI grounding became stale before execution".to_string(),
        ));
    }
    Ok(ProviderRequest {
        profile: profile.clone(),
        messages: built.bundle.messages,
        source_text: built.row.segment.source_text,
        source_locale: built.source_locale,
        target_locale: built.target_locale,
    })
}

struct StoreEventSink<'a> {
    store: &'a mut Store,
    run_id: &'a str,
    cancellation: &'a AtomicBool,
}

impl AiEventSink for StoreEventSink<'_> {
    fn delta(&mut self, text: &str) -> std::result::Result<(), AiCoreError> {
        if self.cancellation.load(Ordering::Relaxed)
            || self
                .store
                .ai_run_cancel_requested(self.run_id)
                .unwrap_or(false)
        {
            return Err(AiCoreError::Canceled);
        }
        self.store
            .append_ai_run_delta(self.run_id, text)
            .map(|_| ())
            .map_err(|_| AiCoreError::EventSink)
    }
}

fn process_tm_batch_item(
    store: &mut Store,
    batch: &AiBatchRun,
    item: &translunar_ai_core::AiBatchItem,
) -> bool {
    let segment = match store.get_segment(&item.segment_id) {
        Ok(segment) => segment,
        Err(_) => return false,
    };
    let row = match store.get_editor_row(&item.segment_id) {
        Ok(row) => row,
        Err(_) => return false,
    };
    if segment.state == SegmentState::Confirmed
        || row.workflow_state == EditorWorkflowState::Signed
        || (!batch.replace_drafts && !segment.target_text.is_empty())
    {
        let _ = store.finish_ai_batch_item(
            &batch.id,
            &item.segment_id,
            AiBatchItemStatus::Skipped,
            None,
            Some("ineligible_segment"),
        );
        return true;
    }
    let project = match store.get_project(&batch.project_id) {
        Ok(project) => project,
        Err(_) => return false,
    };
    let matches = match store.search_tm(&TmSearchRequest {
        project_id: batch.project_id.clone(),
        source_locale: project.project.source_locale,
        target_locale: project.project.target_locale,
        query: segment.source_text,
        threshold: batch.tm_threshold,
        offset: 0,
        limit: 1,
        library_ids: Vec::new(),
        domain: Some(project.project.domain),
        since_ms: None,
        origin_project_id: None,
        origin_document_id: None,
        context_before_hash: row.context_before.map(|value| value.source_hash),
        context_after_hash: row.context_after.map(|value| value.source_hash),
    }) {
        Ok((matches, _)) => matches,
        Err(_) => return false,
    };
    let Some(tm_match) = matches.into_iter().next() else {
        return false;
    };
    if tm_match.score < batch.tm_threshold {
        return false;
    }
    match store.update_target(
        &item.segment_id,
        &tm_match.unit.target_text,
        item.expected_revision,
    ) {
        Ok(_) => {
            let _ = store.finish_ai_batch_item(
                &batch.id,
                &item.segment_id,
                AiBatchItemStatus::TmApplied,
                Some("tm"),
                None,
            );
        }
        Err(StorageError::Conflict { .. }) => {
            let _ = store.finish_ai_batch_item(
                &batch.id,
                &item.segment_id,
                AiBatchItemStatus::Skipped,
                None,
                Some("revision_conflict"),
            );
        }
        Err(_) => {
            let _ = store.finish_ai_batch_item(
                &batch.id,
                &item.segment_id,
                AiBatchItemStatus::Failed,
                None,
                Some("target_write_failed"),
            );
        }
    }
    true
}

fn enforce_ai_policy(store: &Store, interactive: bool, batch: bool) -> Result<()> {
    let settings = store.get_ai_settings()?;
    if !settings.enabled
        || (interactive && !settings.allow_interactive)
        || (batch && !settings.allow_batch)
    {
        return Err(EngineError::AiDisabled);
    }
    if let Some(budget) = settings.monthly_token_budget
        && store.ai_token_usage_since(current_month_start_ms())? >= budget
    {
        return Err(EngineError::BudgetExceeded);
    }
    Ok(())
}

fn enforce_profile_policy(store: &Store, profile: &AiProviderProfile) -> Result<()> {
    ensure_profile_ready(profile)?;
    let settings = store.get_ai_settings()?;
    if settings.allowed_origins.is_empty() {
        return Ok(());
    }
    let url = translunar_ai_core::validate_endpoint(&profile.base_url)?;
    let origin = url.origin().ascii_serialization();
    if settings
        .allowed_origins
        .iter()
        .any(|allowed| allowed == &origin)
    {
        Ok(())
    } else {
        Err(EngineError::InvalidState(
            "AI provider origin is not allowed by workspace settings".to_string(),
        ))
    }
}

fn ensure_profile_ready(profile: &AiProviderProfile) -> Result<()> {
    if !profile.enabled {
        return Err(EngineError::InvalidState(
            "AI provider profile is disabled".to_string(),
        ));
    }
    if !profile.credential_present {
        return Err(EngineError::CredentialUnavailable(
            "provider credential is missing".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn create_and_spawn_ai_batch(
    store: &mut Store,
    manager: &AiManager,
    params: AiBatchStartParams,
) -> Result<AiBatchRun> {
    enforce_ai_policy(store, false, true)?;
    let profile =
        reconcile_profile_credential(store, manager.credentials.as_ref(), &params.profile_id)?;
    enforce_profile_policy(store, &profile)?;
    let project = store.get_project(&params.project_id)?;
    let documents = if let Some(document_id) = params.document_id.as_deref() {
        let document = store.get_document(document_id)?.document;
        if document.project_id != params.project_id {
            return Err(EngineError::InvalidRequest(
                "AI batch document belongs to another project".to_string(),
            ));
        }
        vec![document]
    } else {
        project.documents
    };
    let mut items = Vec::new();
    for document in documents {
        let mut offset = 0;
        loop {
            let (segments, total) = store.list_segments(&document.id, offset, 1_000)?;
            for segment in segments {
                let row = store.get_editor_row(&segment.id)?;
                if segment.state == SegmentState::Confirmed
                    || row.workflow_state == EditorWorkflowState::Signed
                    || (!params.replace_drafts && !segment.target_text.is_empty())
                {
                    continue;
                }
                items.push(NewAiBatchItem {
                    segment_id: segment.id,
                    ordinal: segment.ordinal,
                    expected_revision: segment.revision,
                });
            }
            offset = offset.saturating_add(1_000);
            if offset >= total {
                break;
            }
        }
    }
    let batch = store.create_ai_batch(
        NewAiBatchRun {
            project_id: params.project_id,
            document_id: params.document_id,
            profile_id: params.profile_id,
            tm_threshold: params.tm_threshold,
            concurrency: params.concurrency,
            requests_per_minute: params.requests_per_minute,
            max_attempts: params.max_attempts,
            replace_drafts: params.replace_drafts,
            grounding_options: params.options,
        },
        &items,
    )?;
    manager.spawn_batch(batch.id.clone());
    Ok(batch)
}

fn reconcile_profile_credential(
    store: &mut Store,
    credentials: &dyn CredentialStore,
    profile_id: &str,
) -> Result<AiProviderProfile> {
    let mut profile = store.get_ai_provider_profile(profile_id)?;
    let present = credentials
        .status(profile_id)
        .map_err(credential_engine_error)?;
    if profile.credential_present != present {
        store.set_ai_provider_credential_present(profile_id, present)?;
        profile = store.get_ai_provider_profile(profile_id)?;
    }
    ensure_profile_ready(&profile)?;
    Ok(profile)
}

fn credential_engine_error(error: CredentialError) -> EngineError {
    let message = match error {
        CredentialError::Missing => "provider credential is missing",
        CredentialError::Unavailable => "operating-system credential manager is unavailable",
        CredentialError::Failed => "operating-system credential operation failed",
    };
    EngineError::CredentialUnavailable(message.to_string())
}

fn current_month_start_ms() -> i64 {
    let now = Utc::now();
    Utc.with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
        .single()
        .map_or(0, |value| value.timestamp_millis())
}

fn prompt_hash(messages: &[AiMessage]) -> Result<String> {
    use sha2::{Digest, Sha256};
    let bytes = serde_json::to_vec(messages)
        .map_err(|error| EngineError::InvalidState(error.to_string()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn provider_error_code(error: &AiCoreError) -> &'static str {
    match error {
        AiCoreError::Authentication | AiCoreError::InvalidCredential => "provider_authentication",
        AiCoreError::RateLimited { .. } => "provider_rate_limited",
        AiCoreError::Timeout => "provider_timeout",
        AiCoreError::Canceled => "canceled",
        AiCoreError::Unavailable { .. } => "provider_unavailable",
        AiCoreError::InvalidProfile(_)
        | AiCoreError::InvalidEndpoint(_)
        | AiCoreError::Protocol
        | AiCoreError::ResponseTooLarge
        | AiCoreError::EventSink
        | AiCoreError::InvalidGrounding(_) => "provider_protocol",
    }
}

fn retry_delay_ms(attempt: u32) -> u64 {
    500_u64
        .saturating_mul(2_u64.saturating_pow(attempt.saturating_sub(1)))
        .min(30_000)
}

fn wait_with_cancellation(
    duration_ms: u64,
    token: &AtomicBool,
    mut persistent_cancel: impl FnMut() -> bool,
) -> bool {
    let started = Instant::now();
    let duration = Duration::from_millis(duration_ms);
    while started.elapsed() < duration {
        if token.load(Ordering::Relaxed) || persistent_cancel() {
            return false;
        }
        thread::sleep(Duration::from_millis(
            MAX_RUN_POLL_SLEEP_MS.min(
                u64::try_from(duration.saturating_sub(started.elapsed()).as_millis())
                    .unwrap_or(MAX_RUN_POLL_SLEEP_MS),
            ),
        ));
    }
    true
}

fn wait_rate_limit(gate: &Mutex<Instant>, requests_per_minute: u16, token: &AtomicBool) -> bool {
    let interval_ms = 60_000_u64 / u64::from(requests_per_minute.max(1));
    let mut last = match gate.lock() {
        Ok(last) => last,
        Err(_) => return false,
    };
    let wait = Duration::from_millis(interval_ms).saturating_sub(last.elapsed());
    let started = Instant::now();
    while started.elapsed() < wait {
        if token.load(Ordering::Relaxed) {
            return false;
        }
        thread::sleep(Duration::from_millis(50));
    }
    *last = Instant::now();
    true
}

fn finalize_run_cancel(store: &mut Store, run_id: &str) {
    if let Ok(run) = store.get_ai_run(run_id) {
        if run.status != AiRunStatus::Canceling {
            let _ = store.request_ai_run_cancel(run_id, run.revision);
        }
        let _ = store.finalize_ai_run_canceled(run_id);
    }
}

fn relative_ordinal(value: u32, active: u32) -> i8 {
    let difference = i64::from(value) - i64::from(active);
    i8::try_from(difference).unwrap_or(if difference < 0 { i8::MIN } else { i8::MAX })
}

fn action_text(action: AiAction) -> &'static str {
    match action {
        AiAction::Translate => "translate",
        AiAction::Improve => "improve",
        AiAction::Formal => "formal",
        AiAction::Conversational => "conversational",
        AiAction::Shorten => "shorten",
        AiAction::Expand => "expand",
        AiAction::Literal => "literal",
        AiAction::Freeform => "freeform",
    }
}

fn action_label(action: AiAction) -> &'static str {
    match action {
        AiAction::Translate => "Translate the active segment",
        AiAction::Improve => "Improve the current translation",
        AiAction::Formal => "Make the translation more formal",
        AiAction::Conversational => "Make the translation more conversational",
        AiAction::Shorten => "Shorten the current translation",
        AiAction::Expand => "Expand the current translation",
        AiAction::Literal => "Make the translation more literal",
        AiAction::Freeform => "Process the active segment",
    }
}

fn parse_action(value: &str) -> Result<AiAction> {
    match value {
        "translate" => Ok(AiAction::Translate),
        "improve" => Ok(AiAction::Improve),
        "formal" => Ok(AiAction::Formal),
        "conversational" => Ok(AiAction::Conversational),
        "shorten" => Ok(AiAction::Shorten),
        "expand" => Ok(AiAction::Expand),
        "literal" => Ok(AiAction::Literal),
        "freeform" => Ok(AiAction::Freeform),
        _ => Err(EngineError::InvalidState(
            "AI run action is invalid".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicUsize;

    use serde_json::{Value, json};
    use tempfile::tempdir;
    use translunar_pipeline::{PipelineRunStatus, PipelineStepDefinition};
    use translunar_protocol::{
        AiBatchStartParams, AiProfileIdParams, AiProviderCreateParams, AiProviderUpdateParams,
        AiRunStartParams, AiSettingsUpdateParams, ConfirmSegmentParams, CreatePipelineParams,
        ImportDocumentParams, PipelineRunIdParams, RunPipelineParams, UpdateTargetParams,
    };

    use super::*;

    struct UnavailableCredentialStore;

    impl CredentialStore for UnavailableCredentialStore {
        fn backend(&self) -> &'static str {
            "unavailable-test"
        }

        fn status(&self, _profile_id: &str) -> std::result::Result<bool, CredentialError> {
            Err(CredentialError::Unavailable)
        }

        fn set(
            &self,
            _profile_id: &str,
            _secret: &str,
        ) -> std::result::Result<(), CredentialError> {
            Err(CredentialError::Unavailable)
        }

        fn get(&self, _profile_id: &str) -> std::result::Result<String, CredentialError> {
            Err(CredentialError::Unavailable)
        }

        fn delete(&self, _profile_id: &str) -> std::result::Result<(), CredentialError> {
            Err(CredentialError::Unavailable)
        }
    }

    fn fixture_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind retry AI fixture");
        let address = listener.local_addr().expect("retry AI fixture address");
        thread::spawn(move || {
            for attempt in 0..3 {
                let (mut stream, _) = listener.accept().expect("accept retry AI request");
                let mut reader = BufReader::new(stream.try_clone().expect("clone retry stream"));
                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).expect("read retry header");
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        content_length = value.trim().parse().expect("retry content length");
                    }
                }
                let mut body = vec![0u8; content_length];
                reader.read_exact(&mut body).expect("read retry body");
                assert!(!String::from_utf8_lossy(&body).contains("test-secret"));
                if attempt < 2 {
                    stream
                        .write_all(
                            b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 0\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .expect("write retry response");
                    continue;
                }
                let events = concat!(
                    "data: {\"choices\":[{\"delta\":{\"content\":\"机器\"}}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{\"content\":\"译文\"}}]}\n\n",
                    "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":4}}\n\n",
                    "data: [DONE]\n\n"
                );
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    events.len(),
                    events
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write retry success");
            }
        });
        format!("http://{address}")
    }

    fn fixture_server_with_count(request_count: Arc<AtomicUsize>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind AI fixture");
        let address = listener.local_addr().expect("AI fixture address");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept AI request");
            request_count.fetch_add(1, Ordering::Relaxed);
            let mut reader = BufReader::new(stream.try_clone().expect("clone AI stream"));
            let mut content_length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("read AI header");
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse().expect("AI content length");
                }
            }
            let mut body = vec![0u8; content_length];
            reader.read_exact(&mut body).expect("read AI body");
            let body = String::from_utf8_lossy(&body);
            assert!(!body.contains("test-secret"));
            assert!(!body.contains("batch-secret"));
            let events = concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"机器\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"译文\"}}]}\n\n",
                "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":4}}\n\n",
                "data: [DONE]\n\n"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                events.len(),
                events
            );
            stream
                .write_all(response.as_bytes())
                .expect("write AI response");
        });
        format!("http://{address}")
    }

    fn delayed_fixture_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind delayed AI fixture");
        let address = listener.local_addr().expect("delayed AI fixture address");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept delayed AI request");
            let mut reader = BufReader::new(stream.try_clone().expect("clone delayed stream"));
            let mut content_length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("read delayed header");
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse().expect("delayed content length");
                }
            }
            let mut body = vec![0u8; content_length];
            reader.read_exact(&mut body).expect("read delayed body");
            assert!(!String::from_utf8_lossy(&body).contains("cancel-secret"));
            thread::sleep(Duration::from_millis(250));
            let events = concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n\n",
                "data: [DONE]\n\n"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                events.len(),
                events
            );
            stream
                .write_all(response.as_bytes())
                .expect("write delayed response");
        });
        format!("http://{address}")
    }

    #[test]
    fn grounded_streaming_run_applies_through_editor_without_secret_persistence() {
        let root = tempdir().expect("AI engine directory");
        let credentials = Arc::new(MemoryCredentialStore::default());
        let manager = AiManager::with_credentials(root.path().to_path_buf(), credentials.clone());
        let mut service = EngineService::open_with_ai(root.path().to_path_buf(), manager)
            .expect("open AI engine");
        let project = service
            .create_project(translunar_protocol::CreateProjectParams {
                name: "AI project".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "technical".to_string(),
            })
            .expect("create AI project");
        let source = root.path().join("ai.txt");
        std::fs::write(&source, "Machine translation source.").expect("write AI source");
        let document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: Default::default(),
            })
            .expect("import AI source")
            .document;
        let segment = service
            .store
            .list_segments(&document.id, 0, 10)
            .expect("AI segment")
            .0
            .remove(0);
        let profile = service
            .create_ai_provider(AiProviderCreateParams {
                name: "Fixture".to_string(),
                kind: AiProviderKind::OpenaiCompatible,
                base_url: fixture_server(),
                model: "fixture-model".to_string(),
                timeout_ms: 5_000,
                max_response_bytes: 1_048_576,
                enabled: true,
            })
            .expect("create AI profile");
        assert!(matches!(
            service.test_ai_provider(AiProfileIdParams {
                profile_id: profile.id.clone(),
            }),
            Err(EngineError::CredentialUnavailable(_))
        ));
        let profile = service
            .update_ai_provider(AiProviderUpdateParams {
                profile_id: profile.id.clone(),
                name: "Fixture updated".to_string(),
                kind: profile.kind,
                base_url: profile.base_url.clone(),
                model: profile.model.clone(),
                timeout_ms: profile.timeout_ms,
                max_response_bytes: profile.max_response_bytes,
                enabled: true,
                expected_revision: profile.revision,
            })
            .expect("update AI profile");
        assert!(matches!(
            service.update_ai_provider(AiProviderUpdateParams {
                profile_id: profile.id.clone(),
                name: profile.name.clone(),
                kind: profile.kind,
                base_url: profile.base_url.clone(),
                model: profile.model.clone(),
                timeout_ms: profile.timeout_ms,
                max_response_bytes: profile.max_response_bytes,
                enabled: true,
                expected_revision: profile.revision - 1,
            }),
            Err(EngineError::Storage(StorageError::EntityConflict { .. }))
        ));
        service
            .set_ai_credential(SetAiCredentialParams {
                profile_id: profile.id.clone(),
                secret: "test-secret".to_string(),
            })
            .expect("set AI credential");
        assert!(matches!(
            service.start_ai_run(AiRunStartParams {
                project_id: project.id.clone(),
                segment_id: segment.id.clone(),
                profile_id: profile.id.clone(),
                expected_revision: segment.revision,
                action: AiAction::Translate,
                prompt: String::new(),
                options: GroundingOptions::default(),
                conversation_id: None,
                max_attempts: 2,
            }),
            Err(EngineError::AiDisabled)
        ));
        let settings = service
            .get_ai_settings(AiSettingsGetParams::default())
            .expect("AI settings");
        service
            .update_ai_settings(AiSettingsUpdateParams {
                enabled: true,
                default_profile_id: Some(profile.id.clone()),
                monthly_token_budget: Some(10_000),
                allow_interactive: true,
                allow_batch: true,
                allowed_origins: vec![profile.base_url.clone()],
                expected_revision: settings.revision,
            })
            .expect("enable AI");
        let run = service
            .start_ai_run(AiRunStartParams {
                project_id: project.id.clone(),
                segment_id: segment.id.clone(),
                profile_id: profile.id.clone(),
                expected_revision: segment.revision,
                action: AiAction::Translate,
                prompt: String::new(),
                options: GroundingOptions::default(),
                conversation_id: None,
                max_attempts: 2,
            })
            .expect("start AI run");
        let failed = wait_for_run(&service, &run.id);
        assert_eq!(failed.status, AiRunStatus::Failed);
        assert!(failed.error_retryable);
        assert_eq!(failed.attempt, 2);
        let resumed = service
            .resume_ai_run(AiRunRevisionParams {
                run_id: failed.id.clone(),
                expected_revision: failed.revision,
            })
            .expect("resume retryable AI run");
        assert_eq!(resumed.max_attempts, 3);
        let terminal = wait_for_run(&service, &run.id);
        assert_eq!(terminal.status, AiRunStatus::Succeeded);
        assert_eq!(terminal.attempt, 3);
        assert_eq!(terminal.proposal_text.as_deref(), Some("机器译文"));
        let events = service
            .store
            .list_ai_run_events(&run.id, 0, 50)
            .expect("AI events");
        assert!(
            events
                .iter()
                .filter(|event| event.delta_text.is_some())
                .count()
                >= 2
        );
        assert!(
            events
                .iter()
                .any(|event| event.kind == translunar_ai_core::AiRunEventKind::Retry)
        );
        let applied = service
            .apply_ai_result(AiResultApplyParams {
                run_id: run.id,
                expected_run_revision: terminal.revision,
                expected_segment_revision: segment.revision,
            })
            .expect("apply AI result");
        assert_eq!(applied.rows[0].segment.target_text, "机器译文");
        let budget_settings = service
            .get_ai_settings(AiSettingsGetParams::default())
            .expect("read budget settings");
        service
            .update_ai_settings(AiSettingsUpdateParams {
                enabled: true,
                default_profile_id: Some(profile.id.clone()),
                monthly_token_budget: Some(1),
                allow_interactive: true,
                allow_batch: true,
                allowed_origins: vec![profile.base_url.clone()],
                expected_revision: budget_settings.revision,
            })
            .expect("lower AI budget");
        assert!(matches!(
            service.start_ai_run(AiRunStartParams {
                project_id: project.id,
                segment_id: applied.rows[0].segment.id.clone(),
                profile_id: profile.id,
                expected_revision: applied.rows[0].segment.revision,
                action: AiAction::Translate,
                prompt: String::new(),
                options: GroundingOptions::default(),
                conversation_id: None,
                max_attempts: 2,
            }),
            Err(EngineError::BudgetExceeded)
        ));
        let database =
            std::fs::read(root.path().join("translunar.sqlite3")).expect("read AI database");
        assert!(
            !database
                .windows("test-secret".len())
                .any(|value| value == b"test-secret")
        );
    }

    #[test]
    fn credential_lifecycle_reconciles_after_restart_without_plaintext_fallback() {
        let root = tempdir().expect("credential lifecycle directory");
        let credentials = Arc::new(MemoryCredentialStore::default());
        let manager = AiManager::with_credentials(
            root.path().to_path_buf(),
            Arc::clone(&credentials) as Arc<dyn CredentialStore>,
        );
        let mut service = EngineService::open_with_ai(root.path().to_path_buf(), manager)
            .expect("open credential engine");
        let profile = service
            .create_ai_provider(AiProviderCreateParams {
                name: "Credential lifecycle".to_string(),
                kind: AiProviderKind::OpenaiCompatible,
                base_url: "http://127.0.0.1:9".to_string(),
                model: "fixture-model".to_string(),
                timeout_ms: 1_000,
                max_response_bytes: 1_048_576,
                enabled: true,
            })
            .expect("create credential profile");
        service
            .set_ai_credential(SetAiCredentialParams {
                profile_id: profile.id.clone(),
                secret: "restart-secret".to_string(),
            })
            .expect("set restart credential");
        drop(service);

        let manager = AiManager::with_credentials(
            root.path().to_path_buf(),
            credentials as Arc<dyn CredentialStore>,
        );
        let mut restarted = EngineService::open_with_ai(root.path().to_path_buf(), manager)
            .expect("restart credential engine");
        let status = restarted
            .ai_credential_status(AiProfileIdParams {
                profile_id: profile.id.clone(),
            })
            .expect("credential status after restart");
        assert!(status.available && status.present);
        let deleted = restarted
            .delete_ai_credential(AiProfileIdParams {
                profile_id: profile.id,
            })
            .expect("delete restart credential");
        assert!(deleted.available && !deleted.present);
        let database =
            std::fs::read(root.path().join("translunar.sqlite3")).expect("read credential db");
        assert!(!database.windows(14).any(|value| value == b"restart-secret"));
    }

    #[test]
    fn unavailable_keyring_is_typed_and_never_marks_a_credential_present() {
        let root = tempdir().expect("unavailable credential directory");
        let manager = AiManager::with_credentials(
            root.path().to_path_buf(),
            Arc::new(UnavailableCredentialStore),
        );
        let mut service = EngineService::open_with_ai(root.path().to_path_buf(), manager)
            .expect("open unavailable credential engine");
        let profile = service
            .create_ai_provider(AiProviderCreateParams {
                name: "Unavailable credential".to_string(),
                kind: AiProviderKind::OpenaiCompatible,
                base_url: "http://127.0.0.1:9".to_string(),
                model: "fixture-model".to_string(),
                timeout_ms: 1_000,
                max_response_bytes: 1_048_576,
                enabled: true,
            })
            .expect("create unavailable profile");
        assert!(matches!(
            service.set_ai_credential(SetAiCredentialParams {
                profile_id: profile.id.clone(),
                secret: "must-not-persist".to_string(),
            }),
            Err(EngineError::CredentialUnavailable(_))
        ));
        assert!(
            !service
                .store
                .get_ai_provider_profile(&profile.id)
                .expect("unavailable profile projection")
                .credential_present
        );
        let database =
            std::fs::read(root.path().join("translunar.sqlite3")).expect("read unavailable db");
        assert!(
            !database
                .windows(16)
                .any(|value| value == b"must-not-persist")
        );
    }

    #[test]
    fn batch_pretranslation_prefers_tm_and_counts_network_usage_once() {
        let root = tempdir().expect("AI batch engine directory");
        let credentials = Arc::new(MemoryCredentialStore::default());
        let manager = AiManager::with_credentials(root.path().to_path_buf(), credentials);
        let mut service = EngineService::open_with_ai(root.path().to_path_buf(), manager)
            .expect("open AI batch engine");
        let project = service
            .create_project(translunar_protocol::CreateProjectParams {
                name: "AI batch project".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "technical".to_string(),
            })
            .expect("create AI batch project");

        let seed_source = root.path().join("seed.txt");
        std::fs::write(&seed_source, "Known source.").expect("write seed source");
        let seed_document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: seed_source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: Default::default(),
            })
            .expect("import seed source")
            .document;
        let seed_segment = service
            .store
            .list_segments(&seed_document.id, 0, 10)
            .expect("seed segment")
            .0
            .remove(0);
        let seeded = service
            .update_target(UpdateTargetParams {
                segment_id: seed_segment.id.clone(),
                target_text: "已知译文。".to_string(),
                expected_revision: seed_segment.revision,
            })
            .expect("seed target");
        service
            .confirm_segment(ConfirmSegmentParams {
                segment_id: seeded.id,
                expected_revision: seeded.revision,
            })
            .expect("confirm TM seed");

        let batch_source = root.path().join("batch.txt");
        std::fs::write(&batch_source, "Known source.\n\nNovel source.")
            .expect("write batch source");
        let batch_document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: batch_source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: Default::default(),
            })
            .expect("import batch source")
            .document;
        let request_count = Arc::new(AtomicUsize::new(0));
        let profile = service
            .create_ai_provider(AiProviderCreateParams {
                name: "Batch fixture".to_string(),
                kind: AiProviderKind::OpenaiCompatible,
                base_url: fixture_server_with_count(Arc::clone(&request_count)),
                model: "fixture-model".to_string(),
                timeout_ms: 5_000,
                max_response_bytes: 1_048_576,
                enabled: true,
            })
            .expect("create batch profile");
        service
            .set_ai_credential(SetAiCredentialParams {
                profile_id: profile.id.clone(),
                secret: "batch-secret".to_string(),
            })
            .expect("set batch credential");
        let settings = service
            .get_ai_settings(AiSettingsGetParams::default())
            .expect("batch settings");
        service
            .update_ai_settings(AiSettingsUpdateParams {
                enabled: true,
                default_profile_id: Some(profile.id.clone()),
                monthly_token_budget: Some(10_000),
                allow_interactive: true,
                allow_batch: true,
                allowed_origins: vec![profile.base_url.clone()],
                expected_revision: settings.revision,
            })
            .expect("enable batch AI");
        let batch = service
            .start_ai_batch(AiBatchStartParams {
                project_id: project.id.clone(),
                document_id: Some(batch_document.id.clone()),
                profile_id: profile.id,
                tm_threshold: 85,
                concurrency: 2,
                requests_per_minute: 600,
                max_attempts: 2,
                replace_drafts: false,
                options: GroundingOptions::default(),
            })
            .expect("start AI batch");
        let completed = wait_for_batch(&service, &batch.id);
        let items = service
            .store
            .list_ai_batch_items(&batch.id, 0, 20)
            .expect("batch item diagnostics")
            .0;
        assert_eq!(
            completed.status,
            AiBatchStatus::Succeeded,
            "unexpected batch items: {items:#?}"
        );
        assert_eq!(completed.tm_applied, 1);
        assert_eq!(completed.succeeded, 1);
        assert_eq!(request_count.load(Ordering::Relaxed), 1);
        let segments = service
            .store
            .list_segments(&batch_document.id, 0, 10)
            .expect("batch targets")
            .0;
        assert_eq!(segments[0].target_text, "已知译文。");
        assert_eq!(segments[1].target_text, "机器译文");
        let usage = service
            .store
            .list_ai_usage_records(Some(&project.id), 0, i64::MAX, 0, 20)
            .expect("batch usage");
        assert_eq!(usage.0.len(), 1);
    }

    #[test]
    fn canceling_a_streaming_run_is_durable_and_idempotent() {
        let root = tempdir().expect("AI cancel engine directory");
        let credentials = Arc::new(MemoryCredentialStore::default());
        let manager = AiManager::with_credentials(root.path().to_path_buf(), credentials);
        let mut service = EngineService::open_with_ai(root.path().to_path_buf(), manager)
            .expect("open AI cancel engine");
        let profile = service
            .create_ai_provider(AiProviderCreateParams {
                name: "Cancel fixture".to_string(),
                kind: AiProviderKind::OpenaiCompatible,
                base_url: delayed_fixture_server(),
                model: "fixture-model".to_string(),
                timeout_ms: 5_000,
                max_response_bytes: 1_048_576,
                enabled: true,
            })
            .expect("create cancel profile");
        service
            .set_ai_credential(SetAiCredentialParams {
                profile_id: profile.id.clone(),
                secret: "cancel-secret".to_string(),
            })
            .expect("set cancel credential");
        let started = service
            .test_ai_provider(AiProfileIdParams {
                profile_id: profile.id,
            })
            .expect("start cancel run")
            .run;
        let running = wait_for_run_status(&service, &started.id, AiRunStatus::Running);
        let canceling = service
            .cancel_ai_run(AiRunRevisionParams {
                run_id: running.id.clone(),
                expected_revision: running.revision,
            })
            .expect("request AI cancel");
        assert_eq!(canceling.status, AiRunStatus::Canceling);
        let terminal = wait_for_run(&service, &running.id);
        assert_eq!(terminal.status, AiRunStatus::Canceled);
        let repeated = service
            .cancel_ai_run(AiRunRevisionParams {
                run_id: terminal.id.clone(),
                expected_revision: terminal.revision,
            })
            .expect("repeat AI cancel");
        assert_eq!(repeated.status, AiRunStatus::Canceled);
        let events = service
            .store
            .list_ai_run_events(&terminal.id, 0, 50)
            .expect("cancel events");
        assert!(
            events
                .iter()
                .any(|event| event.kind == translunar_ai_core::AiRunEventKind::Canceled)
        );
    }

    #[test]
    fn ai_pipeline_step_delegates_to_the_durable_batch_service() {
        let root = tempdir().expect("AI pipeline directory");
        let credentials = Arc::new(MemoryCredentialStore::default());
        let manager = AiManager::with_credentials(root.path().to_path_buf(), credentials);
        let mut service = EngineService::open_with_ai(root.path().to_path_buf(), manager)
            .expect("open AI pipeline engine");
        let project = service
            .create_project(translunar_protocol::CreateProjectParams {
                name: "AI pipeline project".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "technical".to_string(),
            })
            .expect("create AI pipeline project");
        let source = root.path().join("pipeline.txt");
        std::fs::write(&source, "Already translated.").expect("write pipeline source");
        let document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: Default::default(),
            })
            .expect("import pipeline source")
            .document;
        let segment = service
            .store
            .list_segments(&document.id, 0, 10)
            .expect("pipeline segment")
            .0
            .remove(0);
        service
            .update_target(UpdateTargetParams {
                segment_id: segment.id,
                target_text: "已翻译。".to_string(),
                expected_revision: segment.revision,
            })
            .expect("pipeline translated target");
        let profile = service
            .create_ai_provider(AiProviderCreateParams {
                name: "Pipeline fixture".to_string(),
                kind: AiProviderKind::OpenaiCompatible,
                base_url: "http://127.0.0.1:9".to_string(),
                model: "fixture-model".to_string(),
                timeout_ms: 1_000,
                max_response_bytes: 1_048_576,
                enabled: true,
            })
            .expect("create pipeline profile");
        service
            .set_ai_credential(SetAiCredentialParams {
                profile_id: profile.id.clone(),
                secret: "pipeline-secret".to_string(),
            })
            .expect("set pipeline credential");
        let settings = service
            .get_ai_settings(AiSettingsGetParams::default())
            .expect("pipeline settings");
        service
            .update_ai_settings(AiSettingsUpdateParams {
                enabled: true,
                default_profile_id: Some(profile.id.clone()),
                monthly_token_budget: None,
                allow_interactive: true,
                allow_batch: true,
                allowed_origins: Vec::new(),
                expected_revision: settings.revision,
            })
            .expect("enable pipeline AI");
        let definition = service
            .create_pipeline(CreatePipelineParams {
                project_id: Some(project.id.clone()),
                name: "AI pretranslation".to_string(),
                steps: vec![PipelineStepDefinition {
                    key: "pretranslate".to_string(),
                    step_id: "core.ai.pretranslate".to_string(),
                    config: json!({
                        "profileId": profile.id,
                        "requestsPerMinute": 600
                    }),
                }],
            })
            .expect("create AI pipeline");
        let run = service
            .run_pipeline(RunPipelineParams {
                definition_id: definition.id,
                project_id: project.id,
                document_id: Some(document.id),
                input: Value::Null,
            })
            .expect("run AI pipeline");
        for _ in 0..300 {
            let snapshot = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: run.run.id.clone(),
                })
                .expect("poll AI pipeline");
            if snapshot.run.status.is_terminal() {
                assert_eq!(snapshot.run.status, PipelineRunStatus::Succeeded);
                assert_eq!(
                    snapshot.steps[0]
                        .output
                        .as_ref()
                        .and_then(|value| value.get("status"))
                        .and_then(Value::as_str),
                    Some("succeeded")
                );
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("AI pipeline did not finish");
    }

    fn wait_for_run(service: &EngineService, run_id: &str) -> AiRun {
        for _ in 0..200 {
            let run = service.store.get_ai_run(run_id).expect("poll AI run");
            if run.status.is_terminal() {
                return run;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("AI run did not finish");
    }

    fn wait_for_batch(service: &EngineService, batch_id: &str) -> AiBatchRun {
        for _ in 0..300 {
            let batch = service.store.get_ai_batch(batch_id).expect("poll AI batch");
            if batch.status.is_terminal() {
                return batch;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("AI batch did not finish");
    }

    fn wait_for_run_status(service: &EngineService, run_id: &str, status: AiRunStatus) -> AiRun {
        for _ in 0..200 {
            let run = service.store.get_ai_run(run_id).expect("poll AI status");
            if run.status == status {
                return run;
            }
            thread::sleep(Duration::from_millis(5));
        }
        panic!("AI run did not reach expected status");
    }
}
