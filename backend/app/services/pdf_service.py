from pathlib import Path
from typing import List, Tuple

import fitz
from PIL import Image


def convert_pdf_to_pngs(
    pdf_path: Path,
    output_dir: Path,
    dpi: int = 600,
) -> List[Path]:
    """Render PDF pages to sharp PNG images.

    PDF drawings are often vector-based. PNG is raster, so sharpness depends
    heavily on render DPI. For review/preview, 600 DPI gives much clearer
    linework and text than 300 DPI.
    """
    pdf_path = Path(pdf_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    dpi = max(int(dpi or 600), 72)

    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)

    page_paths: List[Path] = []

    doc = fitz.open(str(pdf_path))
    try:
        for page_index in range(len(doc)):
            page = doc.load_page(page_index)

            pix = page.get_pixmap(
                matrix=matrix,
                colorspace=fitz.csRGB,
                alpha=False,
                annots=True,
            )

            out_path = output_dir / f"page_{page_index + 1:03d}.png"
            pix.save(str(out_path))
            page_paths.append(out_path)
    finally:
        doc.close()

    return page_paths


def get_image_size(image_path: Path) -> Tuple[int, int]:
    image_path = Path(image_path)
    with Image.open(image_path) as img:
        return img.size