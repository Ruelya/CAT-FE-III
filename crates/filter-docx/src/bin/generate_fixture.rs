use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: generate-docx-fixture <output.docx>")?;
    translunar_filter_docx::fixture::write_fixture(&output)?;
    println!("{}", output.display());
    Ok(())
}
