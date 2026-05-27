import hashlib
import os
import random
import shutil
import time
from pathlib import Path
from typing import Any

import yaml

from app.core.config import FIELD_NAMES, FIELD_TO_CLASS_ID, Settings
from app.core.storage import path_to_url, read_json, safe_filename, write_json
from app.services.dataset_service import find_dir_ending, image_files
from app.services.pdf_service import convert_pdf_to_pngs, get_image_size

PDF_SUFFIXES = {".pdf"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}
ANNOTATION_VERSION = 2
PROTECTED_LABEL_SOURCES = {"human", "human_confirmed", "cvat", "cvat_confirmed"}


def now_ts() -> float:
    return time.time()


def file_sha1(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def bytes_sha1(content: bytes) -> str:
    return hashlib.sha1(content).hexdigest()


def stable_doc_id(kind: str, filename: str, content_hash: str) -> str:
    stem = safe_filename(Path(filename).stem).lower()[:72] or "document"
    return f"{kind}_{stem}_{content_hash[:12]}"


def doc_dir(settings: Settings, pdf_id: str) -> Path:
    return settings.pdfs_dir / pdf_id


def meta_path(settings: Settings, pdf_id: str) -> Path:
    return doc_dir(settings, pdf_id) / "meta.json"


def rendered_doc_dir(settings: Settings, pdf_id: str) -> Path:
    return settings.rendered_dir / pdf_id


def render_meta_path(settings: Settings, pdf_id: str) -> Path:
    return rendered_doc_dir(settings, pdf_id) / "meta.json"


def annotation_doc_dir(settings: Settings, pdf_id: str) -> Path:
    return settings.annotations_dir / pdf_id


def annotation_path(settings: Settings, pdf_id: str, page_number: int) -> Path:
    return annotation_doc_dir(settings, pdf_id) / f"page_{page_number:03d}.json"


def page_image_path(settings: Settings, pdf_id: str, page_number: int) -> Path:
    return rendered_doc_dir(settings, pdf_id) / f"page_{page_number:03d}.png"


def annotation_history_dir(settings: Settings, pdf_id: str, page_number: int) -> Path:
    return settings.review_dir / "annotation_history" / pdf_id / f"page_{page_number:03d}"


def link_or_copy(src: Path, dst: Path, overwrite: bool = True) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and overwrite:
        dst.unlink()
    elif dst.exists():
        return
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def load_meta(settings: Settings, pdf_id: str) -> dict[str, Any]:
    meta = read_json(meta_path(settings, pdf_id), None)
    if not meta:
        raise FileNotFoundError(f"Document not found: {pdf_id}")
    return meta


def save_meta(settings: Settings, pdf_id: str, meta: dict[str, Any]) -> None:
    write_json(meta_path(settings, pdf_id), meta)


def list_document_ids(settings: Settings) -> list[str]:
    if not settings.pdfs_dir.exists():
        return []
    ids = [p.name for p in settings.pdfs_dir.iterdir() if p.is_dir() and (p / "meta.json").exists()]
    return sorted(ids)


def find_document_by_hash(settings: Settings, content_hash: str) -> str | None:
    if not content_hash:
        return None
    for pdf_id in list_document_ids(settings):
        meta = read_json(meta_path(settings, pdf_id), {}) or {}
        if meta.get("content_hash") == content_hash:
            return pdf_id
    return None


def document_exists(settings: Settings, pdf_id: str) -> bool:
    return meta_path(settings, pdf_id).exists()


def list_documents(settings: Settings, status: str | None = None, q: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    query = (q or "").strip().lower()
    for pdf_id in list_document_ids(settings):
        meta = read_json(meta_path(settings, pdf_id), {})
        if not meta:
            continue
        summary = summarize_document(settings, pdf_id, meta)
        if status and summary.get("status") != status:
            continue
        if query and query not in str(meta.get("filename", "")).lower() and query not in pdf_id.lower():
            continue
        docs.append(summary)
    docs.sort(key=lambda item: item.get("updated_at") or item.get("created_at") or 0, reverse=True)
    return docs[: max(1, min(limit, 10000))]


def summarize_document(settings: Settings, pdf_id: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = meta or load_meta(settings, pdf_id)
    render_meta = read_json(render_meta_path(settings, pdf_id), {}) or {}
    pages = render_meta.get("pages", [])
    page_count = int(meta.get("page_count") or len(pages) or 0)
    annotation_files = sorted(annotation_doc_dir(settings, pdf_id).glob("page_*.json"))
    annotations = [read_json(p, {}) for p in annotation_files]
    confirmed_pages = sum(1 for ann in annotations if ann.get("status") == "confirmed")
    draft_pages = sum(1 for ann in annotations if ann.get("status") == "draft")
    missing_fields = 0
    labeled_pages = 0
    last_updated = meta.get("updated_at") or meta.get("created_at")
    for ann in annotations:
        labels = ann.get("labels", {}) or {}
        present = [name for name in FIELD_NAMES if labels.get(name, {}).get("bbox")]
        if present:
            labeled_pages += 1
        missing_fields += len([name for name in FIELD_NAMES if not labels.get(name, {}).get("bbox")])
        if ann.get("updated_at"):
            last_updated = max(float(last_updated or 0), float(ann["updated_at"]))

    if not pages:
        status = "new"
    elif confirmed_pages >= page_count and page_count > 0:
        status = "confirmed"
    elif labeled_pages == 0:
        status = "unlabeled"
    else:
        status = "need_review"

    first_page = pages[0] if pages else None
    first_image_path = Path(first_page["image_path"]) if first_page and first_page.get("image_path") else None
    return {
        "pdf_id": pdf_id,
        "filename": meta.get("filename"),
        "source_type": meta.get("source_type", "pdf"),
        "original_path": meta.get("original_path"),
        "source_path": meta.get("source_path"),
        "content_hash": meta.get("content_hash"),
        "created_at": meta.get("created_at"),
        "updated_at": last_updated,
        "page_count": page_count,
        "rendered_pages": len(pages),
        "annotation_pages": len(annotations),
        "labeled_pages": labeled_pages,
        "confirmed_pages": confirmed_pages,
        "draft_pages": draft_pages,
        "missing_fields": missing_fields,
        "status": status,
        "first_page_url": path_to_url(first_image_path, settings) if first_image_path and first_image_path.exists() else None,
    }


def upload_pdf_to_library(settings: Settings, filename: str, content: bytes, render: bool = True, dpi: int = 300, skip_existing: bool = True) -> dict[str, Any]:
    content_hash = bytes_sha1(content)
    pdf_id = stable_doc_id("pdf", filename, content_hash)
    existing = find_document_by_hash(settings, content_hash)
    if skip_existing and existing:
        summary = summarize_document(settings, existing)
        summary["skipped_existing"] = True
        return summary

    safe_name = safe_filename(filename)
    target = doc_dir(settings, pdf_id) / safe_name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    meta = {
        "pdf_id": pdf_id,
        "filename": safe_name,
        "source_type": "pdf",
        "original_path": str(target),
        "created_at": now_ts(),
        "updated_at": now_ts(),
        "page_count": None,
        "dpi": dpi,
        "content_hash": content_hash,
    }
    save_meta(settings, pdf_id, meta)
    if render:
        render_document(settings, pdf_id, dpi=dpi, force=True)
    return summarize_document(settings, pdf_id)


def import_pdf_folder(
    settings: Settings,
    folder: Path,
    render: bool = True,
    dpi: int = 300,
    recursive: bool = True,
    skip_existing: bool = True,
    prelabel: bool = False,
    yolo_service: Any | None = None,
    conf: float = 0.25,
    imgsz: int = 1280,
    prelabel_replace: bool = False,
) -> dict[str, Any]:
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f"PDF folder not found: {folder}")
    pattern = "**/*" if recursive else "*"
    pdfs = sorted([p for p in folder.glob(pattern) if p.is_file() and p.suffix.lower() in PDF_SUFFIXES])
    imported: list[dict[str, Any]] = []
    skipped_existing: list[str] = []
    errors: list[str] = []
    prelabel_pages = 0
    for src in pdfs:
        try:
            content_hash = file_sha1(src)
            pdf_id = stable_doc_id("pdf", src.name, content_hash)
            existing = find_document_by_hash(settings, content_hash) or (pdf_id if document_exists(settings, pdf_id) else None)
            if existing and skip_existing:
                skipped_existing.append(str(src))
                if prelabel and yolo_service:
                    prelabel_pages += prelabel_document(settings, existing, yolo_service, conf=conf, imgsz=imgsz, replace=prelabel_replace)["prelabeled_pages"]
                continue
            target = doc_dir(settings, pdf_id) / safe_filename(src.name)
            link_or_copy(src, target)
            meta = {
                "pdf_id": pdf_id,
                "filename": target.name,
                "source_type": "pdf",
                "original_path": str(target),
                "source_path": str(src),
                "created_at": now_ts(),
                "updated_at": now_ts(),
                "page_count": None,
                "dpi": dpi,
                "content_hash": content_hash,
            }
            save_meta(settings, pdf_id, meta)
            if render:
                render_document(settings, pdf_id, dpi=dpi, force=True)
            if prelabel and yolo_service:
                prelabel_pages += prelabel_document(settings, pdf_id, yolo_service, conf=conf, imgsz=imgsz, replace=prelabel_replace)["prelabeled_pages"]
            imported.append(summarize_document(settings, pdf_id))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{src}: {exc}")
    return {
        "scanned_count": len(pdfs),
        "imported_count": len(imported),
        "skipped_existing_count": len(skipped_existing),
        "prelabeled_pages": prelabel_pages,
        "error_count": len(errors),
        "skipped_existing": skipped_existing[:100],
        "errors": errors[:100],
        "documents": imported[:100],
    }


def render_document(settings: Settings, pdf_id: str, dpi: int = 300, force: bool = False) -> dict[str, Any]:
    meta = load_meta(settings, pdf_id)
    if meta.get("source_type") != "pdf":
        render_meta = read_json(render_meta_path(settings, pdf_id), {})
        if render_meta:
            return render_meta
        raise ValueError("Only PDF documents can be rendered. CVAT image imports are already rendered.")

    original = Path(meta.get("original_path") or "")
    if not original.exists():
        raise FileNotFoundError(f"Original PDF not found: {original}")

    out_dir = rendered_doc_dir(settings, pdf_id)
    if force and out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    existing_pages = sorted(out_dir.glob("page_*.png"))
    if existing_pages and not force:
        return read_json(render_meta_path(settings, pdf_id), {})

    page_paths = convert_pdf_to_pngs(original, out_dir, dpi=dpi)
    pages = []
    for index, image_path in enumerate(page_paths, start=1):
        width, height = get_image_size(image_path)
        pages.append({"page_number": index, "image_path": str(image_path), "image_url": path_to_url(image_path, settings), "width": width, "height": height, "dpi": dpi})

    meta["page_count"] = len(pages)
    meta["dpi"] = dpi
    meta["rendered_at"] = now_ts()
    meta["updated_at"] = now_ts()
    save_meta(settings, pdf_id, meta)

    payload = {"pdf_id": pdf_id, "dpi": dpi, "renderer": "pymupdf", "pages": pages, "rendered_at": now_ts()}
    write_json(render_meta_path(settings, pdf_id), payload)
    return payload


def get_document_pages(settings: Settings, pdf_id: str) -> list[dict[str, Any]]:
    render_meta = read_json(render_meta_path(settings, pdf_id), {}) or {}
    return render_meta.get("pages", [])


def get_page_payload(settings: Settings, pdf_id: str, page_number: int) -> dict[str, Any]:
    meta = load_meta(settings, pdf_id)
    pages = get_document_pages(settings, pdf_id)
    page = next((p for p in pages if int(p.get("page_number", 0)) == int(page_number)), None)
    if not page:
        raise FileNotFoundError(f"Rendered page not found: {pdf_id} page {page_number}")
    ann = get_annotation(settings, pdf_id, page_number)
    return {"document": summarize_document(settings, pdf_id, meta), "page": page, "annotation": ann, "classes": FIELD_NAMES}


def empty_annotation(pdf_id: str, page_number: int, width: int, height: int, dpi: int | None = None) -> dict[str, Any]:
    return {"version": ANNOTATION_VERSION, "pdf_id": pdf_id, "page_number": int(page_number), "image_width": int(width), "image_height": int(height), "dpi": dpi, "status": "unlabeled", "updated_at": None, "labels": {}}


def get_annotation(settings: Settings, pdf_id: str, page_number: int) -> dict[str, Any]:
    path = annotation_path(settings, pdf_id, page_number)
    if path.exists():
        return read_json(path, {})
    page = next((p for p in get_document_pages(settings, pdf_id) if int(p.get("page_number", 0)) == int(page_number)), None)
    if not page:
        raise FileNotFoundError(f"Rendered page not found: {pdf_id} page {page_number}")
    return empty_annotation(pdf_id, page_number, page["width"], page["height"], page.get("dpi"))


def save_annotation_version(settings: Settings, pdf_id: str, page_number: int, reason: str = "save") -> Path | None:
    current_path = annotation_path(settings, pdf_id, page_number)
    if not current_path.exists():
        return None
    version_dir = annotation_history_dir(settings, pdf_id, page_number)
    version_dir.mkdir(parents=True, exist_ok=True)
    version_id = f"{int(now_ts() * 1000)}_{safe_filename(reason)}.json"
    target = version_dir / version_id
    shutil.copy2(current_path, target)
    return target


def list_annotation_history(settings: Settings, pdf_id: str, page_number: int) -> list[dict[str, Any]]:
    hdir = annotation_history_dir(settings, pdf_id, page_number)
    if not hdir.exists():
        return []
    items = []
    for p in sorted(hdir.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        ann = read_json(p, {}) or {}
        items.append({"version_id": p.name, "created_at": p.stat().st_mtime, "status": ann.get("status"), "label_count": len(ann.get("labels") or {})})
    return items


def restore_annotation_version(settings: Settings, pdf_id: str, page_number: int, version_id: str) -> dict[str, Any]:
    safe_version = safe_filename(version_id)
    if not safe_version.endswith(".json"):
        safe_version += ".json"
    src = annotation_history_dir(settings, pdf_id, page_number) / safe_version
    if not src.exists():
        raise FileNotFoundError(f"Annotation version not found: {version_id}")
    save_annotation_version(settings, pdf_id, page_number, reason="before_restore")
    ann = read_json(src, {}) or {}
    ann["updated_at"] = now_ts()
    ann["restored_from"] = safe_version
    write_json(annotation_path(settings, pdf_id, page_number), ann)
    write_yolo_label(settings, pdf_id, page_number, ann)
    return ann


def save_annotation(settings: Settings, pdf_id: str, page_number: int, payload: dict[str, Any], status: str | None = None, history_reason: str = "save") -> dict[str, Any]:
    page = next((p for p in get_document_pages(settings, pdf_id) if int(p.get("page_number", 0)) == int(page_number)), None)
    if not page:
        raise FileNotFoundError(f"Rendered page not found: {pdf_id} page {page_number}")

    labels_in = payload.get("labels", {}) if isinstance(payload, dict) else {}
    labels: dict[str, Any] = {}
    for field_name in FIELD_NAMES:
        item = labels_in.get(field_name) or {}
        bbox = item.get("bbox")
        if not bbox:
            continue
        clean_bbox = normalize_bbox(bbox, page["width"], page["height"])
        if not clean_bbox:
            continue
        labels[field_name] = {
            "bbox": clean_bbox,
            "source": item.get("source") or "human",
            "confidence": item.get("confidence"),
            "confirmed": bool(item.get("confirmed", False)),
            "updated_at": now_ts(),
        }

    final_status = status or payload.get("status") or "draft"
    if final_status not in {"unlabeled", "draft", "confirmed"}:
        final_status = "draft"
    if labels and final_status == "unlabeled":
        final_status = "draft"

    annotation = {"version": ANNOTATION_VERSION, "pdf_id": pdf_id, "page_number": int(page_number), "image_width": int(page["width"]), "image_height": int(page["height"]), "dpi": page.get("dpi"), "status": final_status, "updated_at": now_ts(), "labels": labels}
    if final_status == "confirmed":
        for label in annotation["labels"].values():
            label["confirmed"] = True
            if label.get("source") == "yolo":
                label["source"] = "human_confirmed"
            elif label.get("source") == "cvat":
                label["source"] = "cvat_confirmed"

    save_annotation_version(settings, pdf_id, page_number, reason=history_reason)
    write_json(annotation_path(settings, pdf_id, page_number), annotation)
    write_yolo_label(settings, pdf_id, page_number, annotation)

    meta = load_meta(settings, pdf_id)
    meta["updated_at"] = now_ts()
    save_meta(settings, pdf_id, meta)
    return annotation


def confirm_annotation(settings: Settings, pdf_id: str, page_number: int) -> dict[str, Any]:
    current = get_annotation(settings, pdf_id, page_number)
    if not current.get("labels"):
        raise ValueError("Cannot confirm an empty annotation")
    return save_annotation(settings, pdf_id, page_number, current, status="confirmed", history_reason="confirm")


def confirm_annotation_and_next(settings: Settings, pdf_id: str, page_number: int, payload: dict[str, Any], queue_mode: str = "need_review", allow_partial: bool = True) -> dict[str, Any]:
    labels = (payload or {}).get("labels", {})
    if not allow_partial:
        missing = [name for name in FIELD_NAMES if not labels.get(name, {}).get("bbox")]
        if missing:
            raise ValueError(f"Cannot confirm partial annotation. Missing fields: {missing}")
    saved = save_annotation(settings, pdf_id, page_number, {"labels": labels, "status": "confirmed"}, status="confirmed", history_reason="confirm_next")
    nxt = next_label_target(settings, mode=queue_mode, exclude=(pdf_id, int(page_number)))
    return {"saved": saved, "next": nxt}


def normalize_bbox(bbox: Any, width: int, height: int) -> list[int] | None:
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        return None
    x1, y1, x2, y2 = [float(v) for v in bbox]
    x1, x2 = sorted([max(0, min(width, x1)), max(0, min(width, x2))])
    y1, y2 = sorted([max(0, min(height, y1)), max(0, min(height, y2))])
    if (x2 - x1) < 2 or (y2 - y1) < 2:
        return None
    return [int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))]


def write_yolo_label(settings: Settings, pdf_id: str, page_number: int, annotation: dict[str, Any]) -> Path:
    label_dir = settings.yolo_labels_dir / pdf_id
    label_path = label_dir / f"page_{page_number:03d}.txt"
    label_dir.mkdir(parents=True, exist_ok=True)
    width = int(annotation["image_width"])
    height = int(annotation["image_height"])
    lines: list[str] = []
    for field_name in FIELD_NAMES:
        item = annotation.get("labels", {}).get(field_name)
        if not item or not item.get("bbox"):
            continue
        cls_id = FIELD_TO_CLASS_ID[field_name]
        x1, y1, x2, y2 = item["bbox"]
        cx = ((x1 + x2) / 2) / width
        cy = ((y1 + y2) / 2) / height
        bw = (x2 - x1) / width
        bh = (y2 - y1) / height
        lines.append(f"{cls_id} {cx:.8f} {cy:.8f} {bw:.8f} {bh:.8f}")
    label_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return label_path


def yolo_to_bbox(cx: float, cy: float, bw: float, bh: float, width: int, height: int) -> list[int] | None:
    x1 = (cx - bw / 2) * width
    y1 = (cy - bh / 2) * height
    x2 = (cx + bw / 2) * width
    y2 = (cy + bh / 2) * height
    return normalize_bbox([x1, y1, x2, y2], width, height)


def parse_class_order(class_order: str | None) -> list[str]:
    if not class_order:
        return FIELD_NAMES.copy()
    raw = class_order.replace(",", "\n").splitlines()
    names = [item.strip() for item in raw if item.strip()]
    if not names:
        return FIELD_NAMES.copy()
    unknown = [name for name in names if name not in FIELD_NAMES]
    if unknown:
        raise ValueError(f"Unknown class names in class_order: {unknown}. Expected only: {FIELD_NAMES}")
    return names


def import_cvat_yolo_folder(
    settings: Settings,
    source_dir: Path,
    class_order: str | None = None,
    mark_confirmed: bool = True,
    limit: int | None = None,
    skip_existing: bool = True,
    overwrite_annotations: bool = False,
) -> dict[str, Any]:
    if not source_dir.exists() or not source_dir.is_dir():
        raise FileNotFoundError(f"CVAT folder not found: {source_dir}")
    names = parse_class_order(class_order)
    train_images = find_dir_ending(source_dir, ("train", "images")) or find_dir_ending(source_dir, ("images", "train")) or (source_dir / "train" / "images")
    train_labels = find_dir_ending(source_dir, ("train", "labels")) or find_dir_ending(source_dir, ("labels", "train")) or (source_dir / "train" / "labels")
    if not train_images.exists() or not train_labels.exists():
        raise FileNotFoundError("Could not find train/images and train/labels in CVAT folder")

    images = image_files(train_images)
    if limit:
        images = images[:limit]

    imported = 0
    updated = 0
    skipped_existing = 0
    missing_labels: list[str] = []
    bad_labels: list[str] = []
    for img in images:
        label_path = train_labels / f"{img.stem}.txt"
        if not label_path.exists():
            missing_labels.append(img.name)
            continue
        content_hash = file_sha1(img)
        pdf_id = stable_doc_id("cvat", img.name, content_hash)
        exists = document_exists(settings, pdf_id) or bool(find_document_by_hash(settings, content_hash))
        if exists and skip_existing and not overwrite_annotations:
            skipped_existing += 1
            continue
        if exists and find_document_by_hash(settings, content_hash):
            pdf_id = find_document_by_hash(settings, content_hash) or pdf_id

        rd = rendered_doc_dir(settings, pdf_id)
        image_target = rd / "page_001.png"
        link_or_copy(img, image_target)
        width, height = get_image_size(image_target)
        page = {"page_number": 1, "image_path": str(image_target), "image_url": path_to_url(image_target, settings), "width": width, "height": height, "dpi": None}
        write_json(render_meta_path(settings, pdf_id), {"pdf_id": pdf_id, "dpi": None, "renderer": "cvat_import", "pages": [page], "rendered_at": now_ts()})
        meta = {"pdf_id": pdf_id, "filename": img.name, "source_type": "cvat_image", "original_path": None, "source_path": str(img), "cvat_label_path": str(label_path), "created_at": now_ts(), "updated_at": now_ts(), "page_count": 1, "dpi": None, "class_order": names, "content_hash": content_hash}
        save_meta(settings, pdf_id, meta)

        labels: dict[str, Any] = {}
        try:
            for line in label_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                parts = line.strip().split()
                if len(parts) < 5:
                    continue
                cls_id = int(float(parts[0]))
                if cls_id < 0 or cls_id >= len(names):
                    bad_labels.append(f"{label_path.name}: class {cls_id} out of class_order range")
                    continue
                field = names[cls_id]
                cx, cy, bw, bh = [float(v) for v in parts[1:5]]
                bbox = yolo_to_bbox(cx, cy, bw, bh, width, height)
                if bbox:
                    labels[field] = {"bbox": bbox, "source": "cvat", "confidence": 1.0, "confirmed": mark_confirmed}
        except Exception as exc:  # noqa: BLE001
            bad_labels.append(f"{label_path}: {exc}")

        status = "confirmed" if mark_confirmed and labels else "draft" if labels else "unlabeled"
        ann = {"version": ANNOTATION_VERSION, "pdf_id": pdf_id, "page_number": 1, "image_width": width, "image_height": height, "dpi": None, "status": status, "updated_at": now_ts(), "labels": labels}
        if overwrite_annotations:
            save_annotation_version(settings, pdf_id, 1, reason="before_cvat_overwrite")
        write_json(annotation_path(settings, pdf_id, 1), ann)
        write_yolo_label(settings, pdf_id, 1, ann)
        if exists:
            updated += 1
        else:
            imported += 1

    return {"scanned_count": len(images), "imported_count": imported, "updated_count": updated, "skipped_existing_count": skipped_existing, "missing_labels_count": len(missing_labels), "bad_labels_count": len(bad_labels), "missing_labels": missing_labels[:100], "bad_labels": bad_labels[:100], "class_order": names, "mark_confirmed": mark_confirmed, "skip_existing": skip_existing, "overwrite_annotations": overwrite_annotations}


def label_is_protected(label: dict[str, Any] | None) -> bool:
    if not label:
        return False
    return bool(label.get("confirmed")) or label.get("source") in PROTECTED_LABEL_SOURCES


def prelabel_page(settings: Settings, pdf_id: str, page_number: int, yolo_service: Any, conf: float = 0.25, imgsz: int = 1280, replace: bool = False, protect_human_labels: bool = True) -> dict[str, Any]:
    page = next((p for p in get_document_pages(settings, pdf_id) if int(p.get("page_number", 0)) == int(page_number)), None)
    if not page:
        raise FileNotFoundError(f"Rendered page not found: {pdf_id} page {page_number}")
    image_path = Path(page["image_path"])
    detections = yolo_service.predict(image_path, conf=conf, imgsz=imgsz) if yolo_service and yolo_service.is_available else []
    current = get_annotation(settings, pdf_id, page_number)
    labels = dict(current.get("labels") or {})
    changed = False
    for det in detections:
        field = det.get("field")
        if field not in FIELD_NAMES:
            continue
        existing = labels.get(field)
        if existing and protect_human_labels and label_is_protected(existing):
            continue
        if existing and existing.get("bbox") and not replace:
            continue
        labels[field] = {"bbox": det["bbox"], "source": "yolo", "confidence": det.get("confidence"), "confirmed": False}
        changed = True
    if not changed:
        return current
    return save_annotation(settings, pdf_id, page_number, {"labels": labels, "status": "draft"}, status="draft", history_reason="prelabel")


def prelabel_document(settings: Settings, pdf_id: str, yolo_service: Any, conf: float = 0.25, imgsz: int = 1280, replace: bool = False, protect_human_labels: bool = True) -> dict[str, Any]:
    count = 0
    errors: list[str] = []
    for page in get_document_pages(settings, pdf_id):
        try:
            prelabel_page(settings, pdf_id, int(page["page_number"]), yolo_service, conf=conf, imgsz=imgsz, replace=replace, protect_human_labels=protect_human_labels)
            count += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{pdf_id} page {page.get('page_number')}: {exc}")
    return {"pdf_id": pdf_id, "prelabeled_pages": count, "errors": errors[:50]}


def prelabel_batch(settings: Settings, yolo_service: Any, mode: str = "unlabeled", conf: float = 0.25, imgsz: int = 1280, replace: bool = False, limit: int = 200, protect_human_labels: bool = True) -> dict[str, Any]:
    targets = collect_label_targets(settings, mode=mode, limit=max(1, min(limit, 5000)))
    done = 0
    errors: list[str] = []
    for target in targets:
        try:
            prelabel_page(settings, target["pdf_id"], int(target["page_number"]), yolo_service, conf=conf, imgsz=imgsz, replace=replace, protect_human_labels=protect_human_labels)
            done += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{target['pdf_id']} page {target['page_number']}: {exc}")
    return {"mode": mode, "scanned_targets": len(targets), "prelabeled_pages": done, "error_count": len(errors), "errors": errors[:100]}


def library_stats(settings: Settings) -> dict[str, Any]:
    docs = [summarize_document(settings, pdf_id) for pdf_id in list_document_ids(settings)]
    total_pages = sum(item["page_count"] for item in docs)
    stats = {"total_documents": len(docs), "total_pages": total_pages, "rendered_pages": sum(item["rendered_pages"] for item in docs), "annotation_pages": sum(item["annotation_pages"] for item in docs), "labeled_pages": sum(item["labeled_pages"] for item in docs), "confirmed_pages": sum(item["confirmed_pages"] for item in docs), "draft_pages": sum(item["draft_pages"] for item in docs), "need_review_documents": sum(1 for item in docs if item["status"] == "need_review"), "unlabeled_documents": sum(1 for item in docs if item["status"] == "unlabeled"), "confirmed_documents": sum(1 for item in docs if item["status"] == "confirmed"), "new_documents": sum(1 for item in docs if item["status"] == "new"), "fields": {name: {"labeled": 0, "missing": 0, "avg_confidence": None} for name in FIELD_NAMES}}
    confs: dict[str, list[float]] = {name: [] for name in FIELD_NAMES}
    for pdf_id in list_document_ids(settings):
        for ann_path in annotation_doc_dir(settings, pdf_id).glob("page_*.json"):
            ann = read_json(ann_path, {})
            labels = ann.get("labels", {}) or {}
            for field in FIELD_NAMES:
                item = labels.get(field)
                if item and item.get("bbox"):
                    stats["fields"][field]["labeled"] += 1
                    if isinstance(item.get("confidence"), (int, float)):
                        confs[field].append(float(item["confidence"]))
                else:
                    stats["fields"][field]["missing"] += 1
    for field in FIELD_NAMES:
        values = confs[field]
        if values:
            stats["fields"][field]["avg_confidence"] = round(sum(values) / len(values), 4)
    return stats


def collect_label_targets(settings: Settings, mode: str = "unlabeled", limit: int = 500, q: str | None = None) -> list[dict[str, Any]]:
    query = (q or "").lower().strip()
    candidates: list[tuple[float, str, int]] = []
    for pdf_id in list_document_ids(settings):
        meta = read_json(meta_path(settings, pdf_id), {}) or {}
        if query and query not in str(meta.get("filename", "")).lower() and query not in pdf_id.lower():
            continue
        for page in get_document_pages(settings, pdf_id):
            page_no = int(page["page_number"])
            ann = get_annotation(settings, pdf_id, page_no)
            labels = ann.get("labels", {}) or {}
            status = ann.get("status")
            labeled_count = len([f for f in FIELD_NAMES if labels.get(f, {}).get("bbox")])
            conf_values = [float(v.get("confidence")) for v in labels.values() if isinstance(v.get("confidence"), (int, float))]
            avg_conf = sum(conf_values) / len(conf_values) if conf_values else None
            score = 0.0
            if mode == "unlabeled" and labeled_count == 0:
                score = 100.0
            elif mode == "missing_fields" and labeled_count < len(FIELD_NAMES):
                score = 100.0 - labeled_count
            elif mode == "low_confidence" and avg_conf is not None and avg_conf < 0.75:
                score = (0.75 - avg_conf) * 100
            elif mode == "need_review" and status != "confirmed":
                score = 50.0 + (len(FIELD_NAMES) - labeled_count)
            elif mode == "confirmed" and status == "confirmed":
                score = float(ann.get("updated_at") or 1)
            elif mode == "draft" and status == "draft":
                score = float(ann.get("updated_at") or 1)
            elif mode == "recently_edited" and ann.get("updated_at"):
                score = float(ann.get("updated_at"))
            elif mode == "random":
                score = 1.0
            if score > 0:
                candidates.append((score, pdf_id, page_no))
    if mode == "random":
        random.shuffle(candidates)
    else:
        candidates.sort(reverse=True)
    out = []
    for _, pdf_id, page_no in candidates[: max(1, min(limit, 10000))]:
        try:
            payload = get_page_payload(settings, pdf_id, page_no)
            out.append({"pdf_id": pdf_id, "page_number": page_no, "document": payload["document"], "page": payload["page"], "annotation": payload["annotation"]})
        except Exception:
            continue
    return out


def next_label_target(settings: Settings, mode: str = "unlabeled", exclude: tuple[str, int] | None = None) -> dict[str, Any] | None:
    targets = collect_label_targets(settings, mode=mode, limit=100)
    if mode == "random":
        random.shuffle(targets)
    for target in targets:
        if exclude and target["pdf_id"] == exclude[0] and int(target["page_number"]) == int(exclude[1]):
            continue
        return get_page_payload(settings, target["pdf_id"], int(target["page_number"]))
    return None


def review_labeled(settings: Settings, status: str | None = "confirmed", source: str | None = None, q: str | None = None, limit: int = 500) -> dict[str, Any]:
    rows = []
    query = (q or "").lower().strip()
    for pdf_id in list_document_ids(settings):
        doc = summarize_document(settings, pdf_id)
        if query and query not in str(doc.get("filename", "")).lower() and query not in pdf_id.lower():
            continue
        for page in get_document_pages(settings, pdf_id):
            page_no = int(page["page_number"])
            ann = get_annotation(settings, pdf_id, page_no)
            if status and ann.get("status") != status:
                continue
            labels = ann.get("labels", {}) or {}
            if source:
                sources = {str(v.get("source")) for v in labels.values() if v.get("source")}
                if source not in sources:
                    continue
            rows.append({"pdf_id": pdf_id, "page_number": page_no, "filename": doc.get("filename"), "source_type": doc.get("source_type"), "status": ann.get("status"), "label_count": len([f for f in FIELD_NAMES if labels.get(f, {}).get("bbox")]), "updated_at": ann.get("updated_at"), "first_page_url": page.get("image_url"), "sources": sorted({str(v.get("source")) for v in labels.values() if v.get("source")})})
    rows.sort(key=lambda x: x.get("updated_at") or 0, reverse=True)
    return {"items": rows[: max(1, min(limit, 5000))], "count": len(rows)}


def build_dataset_from_confirmed(settings: Settings, dataset_id: str, val_ratio: float = 0.2, seed: int = 42, require_all_fields: bool = True) -> dict[str, Any]:
    dataset_id = safe_filename(dataset_id) or f"confirmed-{int(time.time())}"
    dataset_dir = settings.datasets_dir / dataset_id
    if dataset_dir.exists():
        shutil.rmtree(dataset_dir)
    for p in [dataset_dir / "images" / "train", dataset_dir / "images" / "val", dataset_dir / "labels" / "train", dataset_dir / "labels" / "val"]:
        p.mkdir(parents=True, exist_ok=True)

    samples: list[tuple[Path, dict[str, Any], str]] = []
    skipped_incomplete = 0
    for pdf_id in list_document_ids(settings):
        for ann_path in sorted(annotation_doc_dir(settings, pdf_id).glob("page_*.json")):
            ann = read_json(ann_path, {})
            if ann.get("status") != "confirmed":
                continue
            page_no = int(ann.get("page_number", 1))
            image_path = page_image_path(settings, pdf_id, page_no)
            labels = ann.get("labels") or {}
            if not image_path.exists() or not labels:
                continue
            if require_all_fields and any(not labels.get(field, {}).get("bbox") for field in FIELD_NAMES):
                skipped_incomplete += 1
                continue
            sample_name = f"{pdf_id}_page_{page_no:03d}"
            samples.append((image_path, ann, sample_name))

    if not samples:
        raise ValueError("No confirmed annotations found. Confirm labels before building a dataset.")

    random.Random(seed).shuffle(samples)
    val_count = max(1, int(len(samples) * val_ratio)) if len(samples) > 1 else 0
    val_names = {sample[2] for sample in samples[:val_count]}
    counts = {name: 0 for name in FIELD_NAMES}
    split_counts = {"train": 0, "val": 0}

    for image_path, ann, sample_name in samples:
        split = "val" if sample_name in val_names else "train"
        image_target = dataset_dir / "images" / split / f"{sample_name}.png"
        label_target = dataset_dir / "labels" / split / f"{sample_name}.txt"
        link_or_copy(image_path, image_target)
        width = int(ann["image_width"])
        height = int(ann["image_height"])
        lines = []
        for field_name in FIELD_NAMES:
            item = ann.get("labels", {}).get(field_name)
            if not item or not item.get("bbox"):
                continue
            counts[field_name] += 1
            cls_id = FIELD_TO_CLASS_ID[field_name]
            x1, y1, x2, y2 = item["bbox"]
            cx = ((x1 + x2) / 2) / width
            cy = ((y1 + y2) / 2) / height
            bw = (x2 - x1) / width
            bh = (y2 - y1) / height
            lines.append(f"{cls_id} {cx:.8f} {cy:.8f} {bw:.8f} {bh:.8f}")
        label_target.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        split_counts[split] += 1

    data_yaml = {"path": str(dataset_dir), "train": "images/train", "val": "images/val" if split_counts["val"] else "images/train", "names": {idx: name for idx, name in enumerate(FIELD_NAMES)}}
    data_yaml_path = dataset_dir / "data.yaml"
    data_yaml_path.write_text(yaml.safe_dump(data_yaml, sort_keys=False), encoding="utf-8")
    return {"dataset_id": dataset_id, "dataset_dir": str(dataset_dir), "data_yaml": str(data_yaml_path), "train_count": split_counts["train"], "val_count": split_counts["val"], "class_counts": counts, "class_names": FIELD_NAMES, "require_all_fields": require_all_fields, "skipped_incomplete": skipped_incomplete}
