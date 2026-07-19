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

const EXTENDED_CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
  <Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
</Types>"#;

const EXTENDED_DOCUMENT: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">Visible body </w:t></w:r><w:ins><w:r><w:t>Inserted text</w:t></w:r></w:ins><w:del><w:r><w:t>Deleted text</w:t></w:r></w:del></w:p>
    <w:p><w:r><w:drawing><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Textbox text</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></w:drawing></w:r></w:p>
  </w:body>
</w:document>"#;

const DOCUMENT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>"#;

const HEADER: &str = r#"<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>"#;
const FOOTER: &str = r#"<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Footer text</w:t></w:r></w:p></w:ftr>"#;
const FOOTNOTES: &str = r#"<?xml version="1.0" encoding="UTF-8"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="-1"><w:p/></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Footnote text</w:t></w:r></w:p></w:footnote></w:footnotes>"#;
const ENDNOTES: &str = r#"<?xml version="1.0" encoding="UTF-8"?><w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:endnote w:id="1"><w:p><w:r><w:t>Endnote text</w:t></w:r></w:p></w:endnote></w:endnotes>"#;
const COMMENTS: &str = r#"<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="Reviewer"><w:p><w:r><w:t>Comment text</w:t></w:r></w:p></w:comment></w:comments>"#;

pub fn write_fixture(path: &Path) -> Result<(), DocxError> {
    write_package(path, true)
}

pub fn write_invalid_fixture(path: &Path) -> Result<(), DocxError> {
    write_package(path, false)
}

pub fn write_extended_fixture(path: &Path) -> Result<(), DocxError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = File::create(path)?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, content) in [
        ("[Content_Types].xml", EXTENDED_CONTENT_TYPES),
        ("_rels/.rels", ROOT_RELS),
        ("word/document.xml", EXTENDED_DOCUMENT),
        ("word/_rels/document.xml.rels", DOCUMENT_RELS),
        ("word/header1.xml", HEADER),
        ("word/footer1.xml", FOOTER),
        ("word/footnotes.xml", FOOTNOTES),
        ("word/endnotes.xml", ENDNOTES),
        ("word/comments.xml", COMMENTS),
        (UNRELATED_PART, UNRELATED_XML),
    ] {
        write_part(&mut writer, name, content, options)?;
    }
    writer.finish()?;
    Ok(())
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
