use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use tracing::{error, info};
use translunar_engine::{RpcDispatcher, invalid_rpc_response};
use translunar_protocol::{RpcRequest, RpcResponse};

#[derive(Debug, Parser)]
#[command(name = "translunar-engine", version)]
struct Arguments {
    #[arg(long)]
    data_dir: PathBuf,

    #[arg(long, value_enum, default_value_t = Protocol::Stdio)]
    protocol: Protocol,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum Protocol {
    Stdio,
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_writer(io::stderr)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let arguments = Arguments::parse();
    match arguments.protocol {
        Protocol::Stdio => run_stdio(arguments.data_dir),
    }
}

fn run_stdio(data_dir: PathBuf) -> Result<()> {
    let mut dispatcher = RpcDispatcher::open(&data_dir)
        .with_context(|| format!("failed to open data directory {}", data_dir.display()))?;
    info!(data_dir = %data_dir.display(), "engine started");

    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                error!(%error, "failed to read protocol frame");
                write_response(
                    &mut stdout,
                    &invalid_rpc_response(format!("failed to read request: {error}")),
                )?;
                continue;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(request) => dispatcher.handle(request),
            Err(error) => invalid_rpc_response(format!("invalid JSON-RPC request: {error}")),
        };
        write_response(&mut stdout, &response)?;
    }
    info!("engine stopped after stdin closed");
    Ok(())
}

fn write_response(writer: &mut impl Write, response: &RpcResponse) -> Result<()> {
    serde_json::to_writer(&mut *writer, response).context("failed to serialize response")?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}
