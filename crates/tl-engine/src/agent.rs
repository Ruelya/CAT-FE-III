//! Agent worker: AI drafting runs off the RPC thread.
//!
//! The engine loop stays single-threaded and lock-free. `ai.agent.start`
//! performs the cheap local work (planning, exact TM pretranslation) inline,
//! then hands the slow provider calls to a worker thread. The worker owns no
//! engine state: it receives immutable work items and streams [`AgentEvent`]s
//! back over a channel, and the engine applies them between RPC frames.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;

use tl_ai::{AiCoreError, AiProviderProfile, SecretString};
use tl_protocol::AiAssistAction;

use crate::aiops;

/// One TM-missed segment the worker must draft.
#[derive(Debug, Clone)]
pub struct AgentWorkItem {
    pub segment_id: String,
    pub source_text: String,
}

/// A successful AI draft produced by the worker.
#[derive(Debug, Clone)]
pub struct AgentDraft {
    pub target: String,
    pub model: String,
    pub elapsed_ms: u64,
}

/// Message from a worker thread back to the engine loop.
#[derive(Debug)]
pub enum AgentEvent {
    Drafted {
        run_id: String,
        segment_id: String,
        outcome: Result<AgentDraft, String>,
    },
    /// All work items were attempted; the engine finishes with QA + summary.
    Finished { run_id: String },
    /// The cancellation flag was observed; remaining items were not touched.
    Canceled { run_id: String },
}

pub struct AgentJob {
    pub run_id: String,
    pub items: Vec<AgentWorkItem>,
    pub instruction: Option<String>,
    pub source_locale: String,
    pub target_locale: String,
    pub profile: AiProviderProfile,
    pub credential: SecretString,
    pub cancel: Arc<AtomicBool>,
    pub events: Sender<AgentEvent>,
}

pub fn spawn_worker(job: AgentJob) {
    std::thread::spawn(move || run_worker(job));
}

fn run_worker(job: AgentJob) {
    for item in &job.items {
        if job.cancel.load(Ordering::Relaxed) {
            let _ = job.events.send(AgentEvent::Canceled {
                run_id: job.run_id.clone(),
            });
            return;
        }
        let messages = aiops::assist_messages(
            AiAssistAction::Translate,
            job.instruction.as_deref(),
            &job.source_locale,
            &job.target_locale,
            &item.source_text,
            "",
        );
        let outcome = aiops::run_completion(
            &job.profile,
            &job.credential,
            messages,
            &item.source_text,
            &job.source_locale,
            &job.target_locale,
            &job.cancel,
        );
        match outcome {
            Err(AiCoreError::Canceled) => {
                let _ = job.events.send(AgentEvent::Canceled {
                    run_id: job.run_id.clone(),
                });
                return;
            }
            Ok(completion) => {
                let _ = job.events.send(AgentEvent::Drafted {
                    run_id: job.run_id.clone(),
                    segment_id: item.segment_id.clone(),
                    outcome: Ok(AgentDraft {
                        target: completion.text.trim().to_string(),
                        model: job.profile.model.clone(),
                        elapsed_ms: completion.elapsed_ms,
                    }),
                });
            }
            Err(error) => {
                let _ = job.events.send(AgentEvent::Drafted {
                    run_id: job.run_id.clone(),
                    segment_id: item.segment_id.clone(),
                    outcome: Err(error.to_string()),
                });
            }
        }
    }
    let event = if job.cancel.load(Ordering::Relaxed) {
        AgentEvent::Canceled {
            run_id: job.run_id.clone(),
        }
    } else {
        AgentEvent::Finished {
            run_id: job.run_id.clone(),
        }
    };
    let _ = job.events.send(event);
}
