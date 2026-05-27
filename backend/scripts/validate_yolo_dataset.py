#!/usr/bin/env python3
from pathlib import Path
import sys

FIELD_NAMES = [
    "id_drawing",
    "spare_part_name",
    "spare_part_number",
    "quantity",
    "material",
]

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}


def main(dataset_dir: str) -> int:
    root = Path(dataset_dir)
    image_dir = root / "images" / "train"
    label_dir = root / "labels" / "train"
    if not image_dir.exists() or not label_dir.exists():
        print("Missing images/train or labels/train")
        return 1

    images = [p for p in image_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES]
    missing = []
    bad_lines = []

    for img in images:
        label = label_dir / f"{img.stem}.txt"
        if not label.exists():
            missing.append(img.name)
            continue
        for line_no, line in enumerate(label.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
            parts = line.split()
            if len(parts) != 5:
                bad_lines.append(f"{label.name}:{line_no} wrong column count")
                continue
            try:
                cls_id = int(float(parts[0]))
                nums = [float(x) for x in parts[1:]]
            except ValueError:
                bad_lines.append(f"{label.name}:{line_no} parse error")
                continue
            if cls_id < 0 or cls_id >= len(FIELD_NAMES):
                bad_lines.append(f"{label.name}:{line_no} invalid class {cls_id}")
            if any(v < 0 or v > 1 for v in nums):
                bad_lines.append(f"{label.name}:{line_no} bbox values must be normalized 0..1")

    print(f"images: {len(images)}")
    print(f"missing labels: {len(missing)}")
    print(f"bad label lines: {len(bad_lines)}")
    if missing[:20]:
        print("Missing sample:")
        for item in missing[:20]:
            print(" -", item)
    if bad_lines[:20]:
        print("Bad line sample:")
        for item in bad_lines[:20]:
            print(" -", item)
    return 1 if missing or bad_lines else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: validate_yolo_dataset.py /path/to/dataset")
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
