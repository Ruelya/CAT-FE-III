"""Generate deterministic PDF fixtures for text/layout and OCR tests."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
import reportlab
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "fixtures" / "pdf"
PAGE_WIDTH, PAGE_HEIGHT = A4
REPORTLAB_FONTS = Path(reportlab.__file__).resolve().parent / "fonts"


def draw_text_layout(target: Path) -> None:
    pdf = canvas.Canvas(str(target), pagesize=A4, pageCompression=0)
    pdf.setTitle("Translunar PDF text layout fixture")
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(20 * mm, PAGE_HEIGHT - 22 * mm, "Retention and Payment Terms")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(20 * mm, PAGE_HEIGHT - 31 * mm, "A deterministic two-column contract fixture.")

    left_x = 20 * mm
    right_x = 112 * mm
    y = PAGE_HEIGHT - 45 * mm
    left_lines = [
        "1. The retention period is 30 days.",
        "2. Notices must be delivered in writing.",
        "3. Governing law is the law of Hong Kong.",
    ]
    right_lines = [
        "4. Payment is due within 15 days.",
        "5. Late fees are capped at 2 percent.",
        "6. The parties may sign electronically.",
    ]
    for line in left_lines:
        pdf.drawString(left_x, y, line)
        y -= 8 * mm
    y = PAGE_HEIGHT - 45 * mm
    for line in right_lines:
        pdf.drawString(right_x, y, line)
        y -= 8 * mm

    table_y = PAGE_HEIGHT - 100 * mm
    col_x = [20 * mm, 75 * mm, 130 * mm, 185 * mm]
    rows = [
        ("Item", "Quantity", "Unit price"),
        ("Translation", "1200 words", "0.12"),
        ("Review", "2 hours", "45.00"),
    ]
    pdf.setLineWidth(0.5)
    for row_index, row in enumerate(rows):
        top = table_y - row_index * 9 * mm
        for column_index, value in enumerate(row):
            pdf.drawString(col_x[column_index] + 2 * mm, top - 6 * mm, value)
        pdf.line(col_x[0], top, col_x[-1], top)
    pdf.line(col_x[0], table_y - len(rows) * 9 * mm, col_x[-1], table_y - len(rows) * 9 * mm)
    for x in col_x:
        pdf.line(x, table_y, x, table_y - len(rows) * 9 * mm)

    pdf.showPage()
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(20 * mm, PAGE_HEIGHT - 25 * mm, "Second Page")
    pdf.setFont("Helvetica", 11)
    pdf.drawString(20 * mm, PAGE_HEIGHT - 38 * mm, "This page verifies explicit page ordering and page breaks.")
    pdf.save()


def scanned_page_image(path: Path, heading: str, lines: list[str]) -> None:
    width, height = 1654, 2339
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    heading_font = ImageFont.truetype(str(REPORTLAB_FONTS / "VeraBd.ttf"), 58)
    body_font = ImageFont.truetype(str(REPORTLAB_FONTS / "Vera.ttf"), 38)
    draw.text((140, 160), heading, fill="black", font=heading_font)
    y = 310
    for line in lines:
        draw.text((140, y), line, fill="black", font=body_font)
        y += 92
    draw.rectangle((120, 130, width - 120, y + 40), outline="black", width=3)
    image.save(path, format="PNG")


def draw_scanned(target: Path, image_path: Path) -> None:
    pdf = canvas.Canvas(str(target), pagesize=A4, pageCompression=0)
    pdf.drawImage(str(image_path), 0, 0, width=PAGE_WIDTH, height=PAGE_HEIGHT)
    pdf.save()


def draw_mixed(target: Path, image_path: Path) -> None:
    pdf = canvas.Canvas(str(target), pagesize=A4, pageCompression=0)
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(20 * mm, PAGE_HEIGHT - 25 * mm, "Mixed PDF - Text Page")
    pdf.setFont("Helvetica", 11)
    pdf.drawString(20 * mm, PAGE_HEIGHT - 40 * mm, "This first page contains a selectable text layer.")
    pdf.showPage()
    pdf.drawImage(str(image_path), 0, 0, width=PAGE_WIDTH, height=PAGE_HEIGHT)
    pdf.save()


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    scanned_png = OUTPUT / "scanned-page.png"
    scanned_page_image(
        scanned_png,
        "Scanned Service Notice",
        [
            "The service window starts at 09:30.",
            "Keep invoice number INV-2048 unchanged.",
            "Contact the project owner before delivery.",
        ],
    )
    draw_text_layout(OUTPUT / "text-layout.pdf")
    draw_scanned(OUTPUT / "scanned.pdf", scanned_png)
    draw_mixed(OUTPUT / "mixed.pdf", scanned_png)
    print(OUTPUT)


if __name__ == "__main__":
    main()
