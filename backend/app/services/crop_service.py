from pathlib import Path
from PIL import Image


def crop_bbox(image_path: Path, bbox: list[int], output_path: Path, margin: int = 6) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(image_path) as img:
        w, h = img.size
        x1, y1, x2, y2 = bbox
        x1 = max(0, int(x1) - margin)
        y1 = max(0, int(y1) - margin)
        x2 = min(w, int(x2) + margin)
        y2 = min(h, int(y2) + margin)
        cropped = img.crop((x1, y1, x2, y2))
        cropped.save(output_path)
    return output_path
