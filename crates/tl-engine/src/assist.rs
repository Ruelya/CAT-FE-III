//! Assist worker: one provider call per assist request, off the RPC thread.
//!
//! `ai.assist.start` validates on the engine thread and returns immediately;
//! this worker performs the slow HTTP call and reports back with a single
//! [`EngineEvent::AssistFinished`]. The worker owns no engine state and never
//! touches segments: the completion is only a proposal for a human to apply.
//!
//! Cancellation is honest and fast, like the agent worker: the flag is
//! checked before the request is sent, and `tl_ai::execute_provider` aborts
//! an in-flight HTTP call (hung connect included) within its cancel poll
//! interval by dropping the connection.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::Sender;

use tl_ai::{AiMessage, AiProviderProfile, SecretString};

use crate::aiops;
use crate::events::{AssistCompletion, EngineEvent};

pub struct AssistJob {
    pub assist_id: String,
    pub messages: Vec<AiMessage>,
    pub source_text: String,
    pub source_locale: String,
    pub target_locale: String,
    pub profile: AiProviderProfile,
    pub credential: SecretString,
    pub cancel: Arc<AtomicBool>,
    pub events: Sender<EngineEvent>,
}

pub fn spawn_worker(job: AssistJob) {
    std::thread::spawn(move || run_worker(job));
}

fn run_worker(job: AssistJob) {
    let outcome = aiops::run_completion(
        &job.profile,
        &job.credential,
        job.messages,
        &job.source_text,
        &job.source_locale,
        &job.target_locale,
        &job.cancel,
    );
    let outcome = match outcome {
        Ok(completion) => Ok(AssistCompletion {
            text: completion.text.trim().to_string(),
            elapsed_ms: completion.elapsed_ms,
        }),
        Err(error) => Err(error.to_string()),
    };
    let _ = job.events.send(EngineEvent::AssistFinished {
        assist_id: job.assist_id,
        outcome,
    });
}
