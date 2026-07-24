use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use serde_json::json;
use translunar_engine::{
    EngineService, LocalApiConfig, default_token_store, ensure_token, rotate_token, run_pipeline,
    serve_local_api, validate_bind,
};
use translunar_protocol::{CreateProjectParams, ProjectListParams};

#[derive(Debug, Parser)]
#[command(name = "translunar", version, about = "Translunar CAT local API and CLI")]
struct Arguments {
    /// Workspace data directory (SQLite + managed sources).
    #[arg(long)]
    data_dir: PathBuf,

    #[arg(long, default_value_t = false)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Manage the local API bearer token stored in the OS keyring.
    Token {
        #[command(subcommand)]
        action: TokenCommand,
    },
    /// Serve the authenticated loopback HTTP API.
    Serve {
        #[arg(long, default_value = "127.0.0.1")]
        host: IpAddr,
        #[arg(long, default_value_t = 7431)]
        port: u16,
        #[arg(long, default_value_t = false)]
        allow_remote: bool,
    },
    /// Project helpers.
    Project {
        #[command(subcommand)]
        action: ProjectCommand,
    },
    /// Import a source document, run document QA, and export.
    Run {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long, default_value = "CLI project")]
        name: String,
    },
}

#[derive(Debug, Subcommand)]
enum TokenCommand {
    Ensure,
    Status,
    Rotate,
}

#[derive(Debug, Subcommand)]
enum ProjectCommand {
    List {
        #[arg(long, default_value_t = 0)]
        offset: u32,
        #[arg(long, default_value_t = 50)]
        limit: u32,
    },
    Create {
        #[arg(long)]
        name: String,
        #[arg(long, default_value = "en-US")]
        source_locale: String,
        #[arg(long, default_value = "zh-CN")]
        target_locale: String,
        #[arg(long, default_value = "general")]
        domain: String,
    },
}

fn main() -> Result<()> {
    let arguments = Arguments::parse();
    std::fs::create_dir_all(&arguments.data_dir)
        .with_context(|| format!("create data dir {}", arguments.data_dir.display()))?;

    match arguments.command {
        Command::Token { action } => {
            let store = default_token_store();
            match action {
                TokenCommand::Ensure => {
                    let token = ensure_token(store.as_ref())?;
                    emit(
                        arguments.json,
                        json!({ "status": "ready", "token": token }),
                        &format!("Local API token ready.\n{token}"),
                    );
                }
                TokenCommand::Status => {
                    let configured = store.status()?;
                    emit(
                        arguments.json,
                        json!({ "configured": configured }),
                        if configured {
                            "Local API token is configured."
                        } else {
                            "Local API token is not configured."
                        },
                    );
                }
                TokenCommand::Rotate => {
                    let token = rotate_token(store.as_ref())?;
                    emit(
                        arguments.json,
                        json!({ "status": "rotated", "token": token }),
                        &format!("Local API token rotated.\n{token}"),
                    );
                }
            }
        }
        Command::Serve {
            host,
            port,
            allow_remote,
        } => {
            let config = LocalApiConfig {
                host,
                port,
                allow_remote,
            };
            validate_bind(&config)?;
            let tokens = default_token_store();
            let token = ensure_token(tokens.as_ref())?;
            let service = Arc::new(Mutex::new(EngineService::open(&arguments.data_dir)?));
            if arguments.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "listening": format!("{host}:{port}"),
                        "tokenConfigured": true,
                    }))?
                );
            } else {
                eprintln!("Listening on http://{host}:{port}");
                eprintln!("Bearer token is configured (hidden). Use `translunar token ensure` to view/create.");
                let _ = token;
            }
            serve_local_api(service, tokens, config)?;
        }
        Command::Project { action } => {
            let mut service = EngineService::open(&arguments.data_dir)?;
            match action {
                ProjectCommand::List { offset, limit } => {
                    let page = service.list_projects(ProjectListParams {
                        lifecycle: None,
                        offset,
                        limit,
                    })?;
                    emit(
                        arguments.json,
                        serde_json::to_value(&page)?,
                        &format!("{} project(s)", page.total),
                    );
                }
                ProjectCommand::Create {
                    name,
                    source_locale,
                    target_locale,
                    domain,
                } => {
                    let project = service.create_project(CreateProjectParams {
                        name,
                        source_locale,
                        target_locale,
                        domain,
                    })?;
                    emit(
                        arguments.json,
                        serde_json::to_value(&project)?,
                        &format!("Created project {}", project.id),
                    );
                }
            }
        }
        Command::Run {
            source,
            output,
            name,
        } => {
            if !source.is_file() {
                bail!("source does not exist: {}", source.display());
            }
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut service = EngineService::open(&arguments.data_dir)?;
            let summary = run_pipeline(&mut service, source, output.clone(), &name)?;
            emit(
                arguments.json,
                summary.clone(),
                &format!(
                    "Imported {} segment(s); exported {}",
                    summary["segmentCount"], output.display()
                ),
            );
        }
    }
    Ok(())
}

fn emit(as_json: bool, value: serde_json::Value, human: &str) {
    if as_json {
        println!("{}", serde_json::to_string_pretty(&value).expect("json"));
    } else {
        println!("{human}");
    }
}
