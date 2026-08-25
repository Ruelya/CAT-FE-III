use std::cell::RefCell;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use tl_engine::Engine;
use tl_protocol::{EngineFrame, RpcError, RpcErrorCode, RpcRequest, RpcResponse, methods};
use tracing::{error, info};

#[derive(Debug, Parser)]
#[command(name = "tl-engine", version)]
struct Arguments {
    /// Directory holding engine state and managed document copies.
    #[arg(long)]
    data_dir: PathBuf,
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

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = line.context("failed to read protocol frame")?;
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
    Ok(())
}

fn write_frame(output: &mut impl Write, frame: &EngineFrame) -> Result<()> {
    let line = serde_json::to_string(frame).context("failed to serialize frame")?;
    output.write_all(line.as_bytes())?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}
