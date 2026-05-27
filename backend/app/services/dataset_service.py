import random
import shutil
import zipfile
from pathlib import Path
from typing import Iterable

import yaml

from app.core.config import FIELD_NAMES, Settings

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}


def safe_extract_zip(zip_path: Path, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as archive:
        for member in archive.infolist():
            member_path = (target_dir / member.filename).resolve()
            if not str(member_path).startswith(str(target_dir.resolve())):
                raise ValueError("Unsafe zip path detected")
        archive.extractall(target_dir)


def find_dir_ending(root: Path, suffix_parts: tuple[str, ...]) -> Path | None:
    candidates = [p for p in root.rglob("*") if p.is_dir() and tuple(p.parts[-len(suffix_parts):]) == suffix_parts]
    return candidates[0] if candidates else None


def image_files(directory: Path) -> list[Path]:
    return sorted([p for p in directory.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES])


def copy_pairs(pairs: Iterable[tuple[Path, Path]], image_target: Path, label_target: Path) -> int:
    image_target.mkdir(parents=True, exist_ok=True)
    label_target.mkdir(parents=True, exist_ok=True)
    count = 0
    for image_path, label_path in pairs:
        shutil.copy2(image_path, image_target / image_path.name)
        shutil.copy2(label_path, label_target / label_path.name)
        count += 1
    return count


def prepare_cvat_yolo_zip(zip_path: Path, dataset_id: str, settings: Settings, val_ratio: float = 0.2) -> dict:
    dataset_dir = settings.datasets_dir / dataset_id
    if dataset_dir.exists():
        shutil.rmtree(dataset_dir)
    source_dir = dataset_dir / "source"
    safe_extract_zip(zip_path, source_dir)

    train_images = find_dir_ending(source_dir, ("train", "images")) or find_dir_ending(source_dir, ("images", "train"))
    train_labels = find_dir_ending(source_dir, ("train", "labels")) or find_dir_ending(source_dir, ("labels", "train"))

    if train_images is None or train_labels is None:
        raise ValueError("Could not find train/images and train/labels in CVAT export zip")

    pairs: list[tuple[Path, Path]] = []
    missing_labels: list[str] = []
    for img in image_files(train_images):
        label = train_labels / f"{img.stem}.txt"
        if label.exists():
            pairs.append((img, label))
        else:
            missing_labels.append(img.name)

    if not pairs:
        raise ValueError("No image and label pairs found")

    random.Random(42).shuffle(pairs)
    val_count = max(1, int(len(pairs) * val_ratio)) if len(pairs) > 1 else 0
    val_pairs = pairs[:val_count]
    train_pairs = pairs[val_count:]
    if not train_pairs:
        train_pairs = pairs
        val_pairs = []

    copy_pairs(train_pairs, dataset_dir / "images" / "train", dataset_dir / "labels" / "train")
    copy_pairs(val_pairs, dataset_dir / "images" / "val", dataset_dir / "labels" / "val")

    data_yaml = {
        "path": str(dataset_dir),
        "train": "images/train",
        "val": "images/val" if val_pairs else "images/train",
        "names": {idx: name for idx, name in enumerate(FIELD_NAMES)},
    }
    data_yaml_path = dataset_dir / "data.yaml"
    data_yaml_path.write_text(yaml.safe_dump(data_yaml, sort_keys=False), encoding="utf-8")

    return {
        "dataset_id": dataset_id,
        "dataset_dir": str(dataset_dir),
        "data_yaml": str(data_yaml_path),
        "train_count": len(train_pairs),
        "val_count": len(val_pairs),
        "missing_labels": missing_labels[:100],
        "class_names": FIELD_NAMES,
    }


def list_datasets(settings: Settings) -> list[dict]:
    datasets = []
    for item in sorted(settings.datasets_dir.glob("*")):
        if not item.is_dir():
            continue
        data_yaml = item / "data.yaml"
        train_images = item / "images" / "train"
        val_images = item / "images" / "val"
        datasets.append(
            {
                "dataset_id": item.name,
                "data_yaml": str(data_yaml) if data_yaml.exists() else None,
                "train_count": len(list(train_images.glob("*"))) if train_images.exists() else 0,
                "val_count": len(list(val_images.glob("*"))) if val_images.exists() else 0,
            }
        )
    return datasets
