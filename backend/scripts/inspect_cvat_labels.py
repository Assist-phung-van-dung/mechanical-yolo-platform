#!/usr/bin/env python3
from collections import Counter
from pathlib import Path
import argparse


def main():
    parser = argparse.ArgumentParser(description="Inspect YOLO txt class ids in a CVAT export folder.")
    parser.add_argument("folder", help="Folder containing train/labels or labels/train")
    args = parser.parse_args()
    root = Path(args.folder)
    candidates = [root / "train" / "labels", root / "labels" / "train"]
    labels_dir = next((p for p in candidates if p.exists()), None)
    if labels_dir is None:
        matches = [p for p in root.rglob("labels") if p.is_dir()]
        labels_dir = matches[0] if matches else None
    if labels_dir is None:
        raise SystemExit("Could not find labels folder")

    counts = Counter()
    files = sorted(labels_dir.glob("*.txt"))
    empty = 0
    bad = 0
    for path in files:
        lines = [line.strip() for line in path.read_text(encoding="utf-8", errors="ignore").splitlines() if line.strip()]
        if not lines:
            empty += 1
        for line in lines:
            parts = line.split()
            try:
                counts[int(float(parts[0]))] += 1
            except Exception:
                bad += 1
    print(f"labels_dir: {labels_dir}")
    print(f"files: {len(files)}")
    print(f"empty_files: {empty}")
    print(f"bad_lines: {bad}")
    print("class_id_counts:")
    for cls_id, count in sorted(counts.items()):
        print(f"  {cls_id}: {count}")


if __name__ == "__main__":
    main()
