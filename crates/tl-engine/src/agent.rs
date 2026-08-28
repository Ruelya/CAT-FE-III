//! Agent worker: AI drafting runs off the RPC thread.
//!
//! The engine loop stays single-threaded and lock-free. `ai.agent.start`
//! performs the cheap local work (planning, exact TM pretranslation) inline,
//! then hands the slow provider calls to a small worker pool. The workers own
//! no engine state: they receive immutable work items and stream
//! [`EngineEvent`]s back over a channel, and the engine applies them between
//! RPC frames.
//!
//! Segment-level parallelism: up to [`AGENT_SEGMENT_WORKERS`] threads drain a
//! shared queue, so one slow provider call no longer serializes the whole
//! run. Draft events may arrive in any order; the engine applies each one
//! independently, and the coordinator emits exactly one terminal event
//! (finished or canceled) after every worker has stopped.
//!
//! Cancellation is honest and fast: the shared flag is checked before each
//! item, and `tl_ai::execute_provider` aborts an in-flight HTTP call within
//! its cancel poll interval by dropping the connection. A cancel therefore
//! bounds the wait by roughly one poll interval per busy worker, not by the
//! provider timeout.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use tl_ai::{AiCoreError, AiMessage, AiProviderProfile, SecretString};

use crate::aiops;
use crate::events::{AgentDraft, EngineEvent};

/// Upper bound on provider calls one agent run keeps in flight at a time.
/// Small on purpose: enough to hide per-request latency without hammering a
/// provider or spawning an unbounded thread herd.
pub const AGENT_SEGMENT_WORKERS: usize = 4;

/// One TM-missed segment the worker must draft. `messages` is the full
/// grounded prompt, built on the engine thread at plan time from real data
/// (termbase hits, TM matches, neighbours, document pairs); workers own no
/// engine state and never fabricate grounding. `source_text` stays alongside
/// for the provider-side tag-integrity check.
#[derive(Debug, Clone)]
pub struct AgentWorkItem {
    pub segment_id: String,
    pub source_text: String,
    pub messages: Vec<AiMessage>,
}

pub struct AgentJob {
    pub run_id: String,
    pub items: Vec<AgentWorkItem>,
    pub source_locale: String,
    pub target_locale: String,
    pub profile: AiProviderProfile,
    pub credential: SecretString,
    pub cancel: Arc<AtomicBool>,
    pub events: Sender<EngineEvent>,
}

pub fn spawn_worker(job: AgentJob) {
    std::thread::spawn(move || run_job(job));
}

/// Coordinator: fan the work items out to a bounded pool, join every worker,
/// then send the single terminal event for the run.
fn run_job(job: AgentJob) {
    let AgentJob {
        run_id,
        items,
        source_locale,
        target_locale,
        profile,
        credential,
        cancel,
        events,
    } = job;
    let worker_count = items.len().min(AGENT_SEGMENT_WORKERS);
    let queue = Arc::new(Mutex::new(VecDeque::from(items)));
    let mut workers = Vec::with_capacity(worker_count);
    for _ in 0..worker_count {
        let context = WorkerContext {
            run_id: run_id.clone(),
            source_locale: source_locale.clone(),
            target_locale: target_locale.clone(),
            profile: profile.clone(),
            credential: credential.duplicate(),
            cancel: Arc::clone(&cancel),
            events: events.clone(),
            queue: Arc::clone(&queue),
        };
        workers.push(std::thread::spawn(move || drain_queue(context)));
    }
    for worker in workers {
        let _ = worker.join();
    }
    let event = if cancel.load(Ordering::Relaxed) {
        EngineEvent::AgentCanceled { run_id }
    } else {
        EngineEvent::AgentFinished { run_id }
    };
    let _ = events.send(event);
}

struct WorkerContext {
    run_id: String,
    source_locale: String,
    target_locale: String,
    profile: AiProviderProfile,
    credential: SecretString,
    cancel: Arc<AtomicBool>,
    events: Sender<EngineEvent>,
    queue: Arc<Mutex<VecDeque<AgentWorkItem>>>,
}

fn drain_queue(context: WorkerContext) {
    loop {
        if context.cancel.load(Ordering::Relaxed) {
            return;
        }
        let item = {
            let mut queue = match context.queue.lock() {
                Ok(queue) => queue,
                Err(_) => return,
            };
            queue.pop_front()
        };
        let Some(mut item) = item else { return };
        let outcome = aiops::run_completion(
            &context.profile,
            &context.credential,
            std::mem::take(&mut item.messages),
            &item.source_text,
            &context.source_locale,
            &context.target_locale,
            &context.cancel,
        );
        match outcome {
            // The run was canceled mid-call; the coordinator reports the
            // terminal state once all workers stop. Nothing to send here.
            Err(AiCoreError::Canceled) => return,
            Ok(completion) => {
                let _ = context.events.send(EngineEvent::AgentDrafted {
                    run_id: context.run_id.clone(),
                    segment_id: item.segment_id.clone(),
                    outcome: Ok(AgentDraft {
                        target: completion.text.trim().to_string(),
                        model: context.profile.model.clone(),
                        elapsed_ms: completion.elapsed_ms,
                    }),
                });
            }
            Err(error) => {
                let _ = context.events.send(EngineEvent::AgentDrafted {
                    run_id: context.run_id.clone(),
                    segment_id: item.segment_id.clone(),
                    outcome: Err(error.to_string()),
                });
            }
        }
    }
}
