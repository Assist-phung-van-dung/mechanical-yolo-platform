from pathlib import Path
from PIL import Image
import fitz


def convert_pdf_to_pngs(pdf_path: Path, output_dir: Path, dpi: int = 300) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    image_paths: list[Path] = []
    doc = fitz.open(str(pdf_path))
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)

    for index, page in enumerate(doc, start=1):
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        out_path = output_dir / f"page_{index:03d}.png"
        pix.save(str(out_path))
        image_paths.append(out_path)

    doc.close()
    return image_paths


def get_image_size(image_path: Path) -> tuple[int, int]:
    with Image.open(image_path) as img:
        return img.size
