use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use zip::CompressionMethod;
use zip::write::{SimpleFileOptions, ZipWriter};

use crate::DocxError;

pub const UNRELATED_PART: &str = "customXml/item1.xml";

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"#;

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

const DOCUMENT_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="BodyText"/></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">The retention </w:t></w:r>
      <w:r><w:t>period is 30 days.</w:t></w:r>
    </w:p>
    <w:p><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>
    <w:tbl><w:tr><w:tc>
      <w:p><w:r><w:t>Table amount: 1,200.</w:t></w:r></w:p>
    </w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>This paragraph remains untranslated.</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>"#;

const STYLES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
</w:styles>"#;

const UNRELATED_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<fixture preserve="byte-for-byte">unowned package content</fixture>"#;

pub fn write_fixture(path: &Path) -> Result<(), DocxError> {
    write_package(path, true)
}

pub fn write_invalid_fixture(path: &Path) -> Result<(), DocxError> {
    write_package(path, false)
}

fn write_package(path: &Path, include_document: bool) -> Result<(), DocxError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = File::create(path)?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    write_part(&mut writer, "[Content_Types].xml", CONTENT_TYPES, options)?;
    write_part(&mut writer, "_rels/.rels", ROOT_RELS, options)?;
    if include_document {
        write_part(&mut writer, "word/document.xml", DOCUMENT_XML, options)?;
    }
    write_part(&mut writer, "word/styles.xml", STYLES_XML, options)?;
    write_part(&mut writer, UNRELATED_PART, UNRELATED_XML, options)?;
    writer.finish()?;
    Ok(())
}

fn write_part(
    writer: &mut ZipWriter<File>,
    name: &str,
    content: &str,
    options: SimpleFileOptions,
) -> Result<(), DocxError> {
    writer.start_file(name, options)?;
    writer.write_all(content.as_bytes())?;
    Ok(())
}
