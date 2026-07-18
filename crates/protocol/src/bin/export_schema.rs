use std::env;
use std::fs;
use std::path::PathBuf;

use schemars::schema_for;
use translunar_protocol::ProtocolCatalog;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("packages/contracts/src/protocol.schema.json"));
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let schema = schema_for!(ProtocolCatalog);
    fs::write(output, serde_json::to_string_pretty(&schema)?)?;
    Ok(())
}
