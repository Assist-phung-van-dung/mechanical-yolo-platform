import json
import shutil
from pathlib import Path
from typing import Any

from .config import Settings


def ensure_storage(settings: Settings) -> None:
    for directory in [
        settings.data_root,
        settings.uploads_dir,
        settings.pages_dir,
        settings.crops_dir,
        settings.datasets_dir,
        settings.models_dir,
        settings.jobs_dir,
        settings.pdfs_dir,
        settings.rendered_dir,
        settings.annotations_dir,
        settings.yolo_labels_dir,
        settings.review_dir,
        settings.imports_dir,
        settings.pdf_imports_dir,
        settings.cvat_imports_dir,
        settings.models_dir / "active",
    ]:
        directory.mkdir(parents=True, exist_ok=True)


def safe_filename(name: str) -> str:
    keep = []
    for ch in name:
        if ch.isalnum() or ch in [".", "_", "-"]:
            keep.append(ch)
        else:
            keep.append("_")
    return "".join(keep).strip("._") or "file"


def path_to_url(path: Path, settings: Settings) -> str:
    rel = path.resolve().relative_to(settings.data_root.resolve())
    return "/files/" + str(rel).replace("\\", "/")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
