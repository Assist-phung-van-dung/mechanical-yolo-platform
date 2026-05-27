from pathlib import Path
from typing import Optional
from PIL import Image


def read_text_from_image(image_path: Path) -> Optional[str]:
    try:
        import pytesseract
        with Image.open(image_path) as img:
            text = pytesseract.image_to_string(img, config="--psm 6")
        text = " ".join(text.replace("\n", " ").split()).strip()
        return text or None
    except Exception:
        return None
