use std::cell::RefCell;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;

use anyhow::{Context, Result};
use clap::Parser;
use tl_engine::{Engine, EngineEvent};
use tl_protocol::{EngineFrame, RpcError, RpcErrorCode, RpcRequest, RpcResponse, methods};
use tracing::{error, info};

#[derive(Debug, Parser)]
#[command(name = "tl-engine", version)]
struct Arguments {
    /// Directory holding engine state and managed document copies.
    #[arg(long)]
    data_dir: PathBuf,
}

/// One unit of work for the single-threaded engine loop: either a protocol
/// frame from stdin or an event from a worker thread (agent or assist).
enum LoopInput {
    Line(String),
    Worker(EngineEvent),
    StdinClosed,
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_writer(io::stderr)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let arguments = Arguments::parse();
    let mut engine = Engine::open(&arguments.data_dir).with_context(|| {
        format!(
            "failed to open data directory {}",
            arguments.data_dir.display()
        )
    })?;
    info!(data_dir = %arguments.data_dir.display(), "engine started");

    let stdout = io::stdout();
    let out = RefCell::new(stdout.lock());
    write_frame(
        &mut *out.borrow_mut(),
        &EngineFrame::Notification(engine.ready_notification()),
    )?;

    // Fan stdin lines and worker events into one channel so the engine stays
    // single-threaded while long AI calls (agent drafting, assist requests)
    // stream in between protocol frames instead of blocking them.
    let (input_tx, input_rx) = mpsc::channel::<LoopInput>();
    let engine_events = engine.take_engine_events();
    let stdin_tx = input_tx.clone();
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            if stdin_tx.send(LoopInput::Line(line)).is_err() {
                return;
            }
        }
        let _ = stdin_tx.send(LoopInput::StdinClosed);
    });
    thread::spawn(move || {
        for event in engine_events {
            if input_tx.send(LoopInput::Worker(event)).is_err() {
                return;
            }
        }
    });

    for input in input_rx {
        match input {
            LoopInput::Line(line) => {
                if line.trim().is_empty() {
                    continue;
                }
                let request: RpcRequest = match serde_json::from_str(&line) {
                    Ok(request) => request,
                    Err(parse_error) => {
                        error!(%parse_error, "invalid request frame");
                        write_frame(
                            &mut *out.borrow_mut(),
                            &EngineFrame::Response(RpcResponse::failure(
                                None,
                                RpcError {
                                    code: RpcErrorCode::InvalidRequest,
                                    message: format!("invalid request frame: {parse_error}"),
                                    data: None,
                                },
                            )),
                        )?;
                        continue;
                    }
                };
                let shutting_down = request.method == methods::ENGINE_SHUTDOWN;
                let mut notify = |notification| {
                    let _ = write_frame(
                        &mut *out.borrow_mut(),
                        &EngineFrame::Notification(notification),
                    );
                };
                let response = engine.handle(request, &mut notify);
                write_frame(&mut *out.borrow_mut(), &EngineFrame::Response(response))?;
                if shutting_down {
                    info!("engine shutting down");
                    break;
                }
            }
            LoopInput::Worker(event) => {
                let mut notify = |notification| {
                    let _ = write_frame(
                        &mut *out.borrow_mut(),
                        &EngineFrame::Notification(notification),
                    );
                };
                if let Err(worker_error) = engine.handle_engine_event(event, &mut notify) {
                    error!(%worker_error, "worker event failed");
                }
            }
            LoopInput::StdinClosed => break,
        }
    }
    Ok(())
}

fn write_frame(output: &mut impl Write, frame: &EngineFrame) -> Result<()> {
    let line = serde_json::to_string(frame).context("failed to serialize frame")?;
    output.write_all(line.as_bytes())?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}
