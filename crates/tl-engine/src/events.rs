//! Events streamed from worker threads back into the single-threaded engine
//! loop.
//!
//! Workers (agent drafting, assist requests) own no engine state: they send
//! these messages over a channel and the engine applies them between RPC
//! frames via [`crate::Engine::handle_engine_event`].

/// A successful AI draft produced by the agent worker.
#[derive(Debug, Clone)]
pub struct AgentDraft {
    pub target: String,
    pub model: String,
    pub elapsed_ms: u64,
}

/// A successful completion produced by the assist worker.
#[derive(Debug, Clone)]
pub struct AssistCompletion {
    pub text: String,
    pub elapsed_ms: u64,
}

/// Message from a worker thread back to the engine loop.
#[derive(Debug)]
pub enum EngineEvent {
    AgentDrafted {
        run_id: String,
        segment_id: String,
        outcome: Result<AgentDraft, String>,
    },
    /// All agent work items were attempted; the engine finishes with QA +
    /// summary.
    AgentFinished { run_id: String },
    /// The agent cancellation flag was observed; remaining items were not
    /// touched.
    AgentCanceled { run_id: String },
    /// The assist provider call ended, successfully or not.
    AssistFinished {
        assist_id: String,
        outcome: Result<AssistCompletion, String>,
    },
}
