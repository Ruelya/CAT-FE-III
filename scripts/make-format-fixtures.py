#!/usr/bin/env python3
"""Build a small matrix of realistic source files, one per supported format.

Each file carries the same shape of content on purpose: a heading, a sentence
with one inline-formatted phrase, numbers and a date, a duplicated sentence,
and a placeholder-bearing sentence. That makes the round-trip results
comparable across formats instead of each fixture testing something different.
"""

import pathlib
import zipfile

OUT = pathlib.Path(__file__).resolve().parent.parent / "fixtures" / "formats"
OUT.mkdir(parents=True, exist_ok=True)

SENTENCES = [
    "TL-900 Portable Power Station User Guide",
    "Read all safety instructions before operating the TL-900 power station.",
    "The battery capacity is 1,024 Wh and the rated output is 1,500 W.",
    "Do not expose the device to temperatures above 45 C.",
    "Press and hold the power button for 3 seconds to turn the unit on.",
    "Do not expose the device to temperatures above 45 C.",
    "The warranty period is 24 months from the date of purchase.",
]


def write_zip(path, entries):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)


# ---------------------------------------------------------------- plain text
(OUT / "real.txt").write_text("\n".join(SENTENCES) + "\n", encoding="utf-8")

# --------------------------------------------------------------------- html
(OUT / "real.html").write_text(
    "<!doctype html>\n<html><head><title>TL-900</title></head><body>\n"
    "<h1>TL-900 Portable Power Station User Guide</h1>\n"
    "<p>Read all safety instructions before operating the "
    "<b>TL-900 power station</b>.</p>\n"
    "<p>The battery capacity is 1,024 Wh and the rated output is 1,500 W.</p>\n"
    "<p>Do not expose the device to temperatures above 45 C.</p>\n"
    "<p>Press and hold the power button for 3 seconds to turn the unit on.</p>\n"
    "<p>Do not expose the device to temperatures above 45 C.</p>\n"
    "<p>The warranty period is <i>24 months</i> from the date of purchase.</p>\n"
    "</body></html>\n",
    encoding="utf-8",
)

# ----------------------------------------------------------------- markdown
(OUT / "real.md").write_text(
    "# TL-900 Portable Power Station User Guide\n\n"
    "Read all safety instructions before operating the **TL-900 power station**.\n\n"
    "The battery capacity is 1,024 Wh and the rated output is 1,500 W.\n\n"
    "Do not expose the device to temperatures above 45 C.\n\n"
    "Press and hold the power button for 3 seconds to turn the unit on.\n\n"
    "Do not expose the device to temperatures above 45 C.\n\n"
    "The warranty period is *24 months* from the date of purchase.\n",
    encoding="utf-8",
)

# -------------------------------------------------------------- xliff 1.2
units = "".join(
    f'<trans-unit id="u{index}"><source>{text}</source></trans-unit>'
    for index, text in enumerate(SENTENCES)
)
(OUT / "real.xlf").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">'
    '<file original="guide.docx" source-language="en-US" target-language="zh-CN" '
    'datatype="plaintext"><body>'
    f"{units}"
    "</body></file></xliff>\n",
    encoding="utf-8",
)


def tagged_units():
    parts = []
    for index, text in enumerate(SENTENCES):
        source = text
        if index == 1:
            source = text.replace(
                "TL-900 power station",
                '<g id="1">TL-900 power station</g>',
            )
        if index == 6:
            source = text.replace("24 months", '<g id="2">24 months</g>')
        parts.append(f'<trans-unit id="u{index}"><source>{source}</source></trans-unit>')
    return "".join(parts)


# ----------------------------------------------------------- SDLXLIFF 1.2
(OUT / "real.sdlxliff").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2" '
    'xmlns:sdl="urn:sdl">'
    '<file original="guide.docx" source-language="en-US" target-language="zh-CN" '
    'datatype="x-docx"><body>'
    f"{tagged_units()}"
    "</body></file></xliff>\n",
    encoding="utf-8",
)

# ------------------------------------------------------------ MQXLIFF 1.2
(OUT / "real.mqxliff").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2" '
    'xmlns:mq="urn:memoq">'
    '<file original="guide.docx" source-language="en-US" target-language="zh-CN" '
    'datatype="plaintext"><body>'
    f"{tagged_units()}"
    "</body></file></xliff>\n",
    encoding="utf-8",
)

# ----------------------------------------------------------------- xlsx
sheet_rows = "".join(
    f'<row r="{index + 1}"><c r="A{index + 1}" t="s"><v>{index}</v></c></row>'
    for index in range(len(SENTENCES))
)
shared_items = "".join(f"<si><t>{text}</t></si>" for text in SENTENCES)
# Cell A2 is rich: plain lead-in plus a bold phrase.
shared_items = shared_items.replace(
    "<si><t>Read all safety instructions before operating the TL-900 power station.</t></si>",
    "<si><r><t xml:space=\"preserve\">Read all safety instructions before operating the </t></r>"
    "<r><rPr><b/></rPr><t>TL-900 power station</t></r><r><t>.</t></r></si>",
)
write_zip(
    OUT / "real.xlsx",
    {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        "</Types>",
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>",
        "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Guide" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
        "</Relationships>",
        "xl/worksheets/sheet1.xml": '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{sheet_rows}</sheetData></worksheet>",
        "xl/sharedStrings.xml": '<?xml version="1.0" encoding="UTF-8"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(SENTENCES)}" uniqueCount="{len(SENTENCES)}">{shared_items}</sst>',
    },
)

# ----------------------------------------------------------------- pptx
def slide_paragraph(text, bold_phrase=None):
    if bold_phrase and bold_phrase in text:
        head, tail = text.split(bold_phrase, 1)
        runs = (
            f'<a:r><a:rPr lang="en-US"/><a:t>{head}</a:t></a:r>'
            f'<a:r><a:rPr lang="en-US" b="1"/><a:t>{bold_phrase}</a:t></a:r>'
            f'<a:r><a:rPr lang="en-US"/><a:t>{tail}</a:t></a:r>'
        )
    else:
        runs = f'<a:r><a:rPr lang="en-US"/><a:t>{text}</a:t></a:r>'
    return f"<a:p>{runs}</a:p>"


body = "".join(
    slide_paragraph(text, "TL-900 power station" if index == 1 else None)
    for index, text in enumerate(SENTENCES)
)
write_zip(
    OUT / "real.pptx",
    {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
        '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        "</Types>",
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>'
        "</Relationships>",
        "ppt/presentation.xml": '<?xml version="1.0" encoding="UTF-8"?>'
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
        "ppt/_rels/presentation.xml.rels": '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>'
        "</Relationships>",
        "ppt/slides/slide1.xml": '<?xml version="1.0" encoding="UTF-8"?>'
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        "<p:cSld><p:spTree><p:sp><p:txBody>"
        f"{body}"
        "</p:txBody></p:sp></p:spTree></p:cSld></p:sld>",
    },
)

for created in sorted(OUT.glob("real.*")):
    print(f"{created.name}: {created.stat().st_size} bytes")
