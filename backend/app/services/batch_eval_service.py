import csv
import json
import random
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from app.core.config import FIELD_NAMES, Settings
from app.core.storage import path_to_url, safe_filename, write_json, read_json
from app.services.crop_service import crop_bbox
from app.services.ocr_api_service import call_ocr_five_fields
from app.services.pdf_service import convert_pdf_to_pngs, get_image_size

LOW_CONF_THRESHOLD = 0.50
SUSPICIOUS_MIN_AREA_RATIO = 0.00001
SUSPICIOUS_MAX_AREA_RATIO = 0.40

REVIEW_DECISIONS = {
    "correct",
    "wrong_box",
    "missing_should_exist",
    "not_present",
    "unreviewed",
}


def batch_root(settings: Settings) -> Path:
    return settings.data_root / "batch_eval"


def jobs_root(settings: Settings) -> Path:
    return batch_root(settings) / "jobs"


def job_dir(settings: Settings, job_id: str) -> Path:
    return jobs_root(settings) / safe_filename(job_id)


def job_json_path(settings: Settings, job_id: str) -> Path:
    return job_dir(settings, job_id) / "job.json"


def items_dir(settings: Settings, job_id: str) -> Path:
    return job_dir(settings, job_id) / "items"


def item_json_path(settings: Settings, job_id: str, item_id: str) -> Path:
    return items_dir(settings, job_id) / f"{safe_filename(item_id)}.json"


def now_ts() -> float:
    return time.time()


def _pdf_files_from_imports(settings: Settings, limit: int, seed: int | None = None, recursive: bool = True) -> list[Path]:
    root = settings.pdf_imports_dir
    if not root.exists():
        return []
    pattern = "**/*.pdf" if recursive else "*.pdf"
    files = sorted([p for p in root.glob(pattern) if p.is_file()])
    rng = random.Random(seed if seed is not None else int(time.time()))
    rng.shuffle(files)
    return files[: max(0, limit)]


def create_batch_job(
    settings: Settings,
    *,
    source_mode: str,
    uploaded_files: list[tuple[str, bytes]] | None,
    limit: int,
    dpi: int,
    conf: float,
    imgsz: int,
    run_ocr: bool,
    ocr_engine: str,
    random_seed: int | None = None,
    campaign_name: str | None = None,
) -> dict[str, Any]:
    job_id = "batch_" + uuid.uuid4().hex[:12]
    campaign_name = (campaign_name or "").strip() or f"Batch {job_id}"
    root = job_dir(settings, job_id)
    upload_dir = root / "uploads"
    items_path = items_dir(settings, job_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    items_path.mkdir(parents=True, exist_ok=True)

    source_paths: list[Path] = []
    source_mode = source_mode or "upload"
    limit = max(1, int(limit or 1))

    if uploaded_files:
        for idx, (filename, content) in enumerate(uploaded_files[:limit], start=1):
            if not filename.lower().endswith(".pdf"):
                continue
            out_name = f"{idx:05d}_" + safe_filename(filename)
            out_path = upload_dir / out_name
            out_path.write_bytes(content)
            source_paths.append(out_path)
    elif source_mode == "random_imports":
        source_paths = _pdf_files_from_imports(settings, limit=limit, seed=random_seed, recursive=True)
    else:
        source_paths = []

    items = []
    for index, pdf_path in enumerate(source_paths, start=1):
        item_id = f"item_{index:06d}"
        item = {
            "item_id": item_id,
            "index": index,
            "pdf_name": pdf_path.name,
            "source_pdf_path": str(pdf_path),
            "status": "queued",
            "error": None,
            "started_at": None,
            "finished_at": None,
            "result": None,
            "ai_evaluation": None,
            "human_review": {
                "reviewed": False,
                "status": "unreviewed",
                "fields": {name: {"decision": "unreviewed", "note": ""} for name in FIELD_NAMES},
                "note": "",
                "updated_at": None,
            },
            "final_evaluation": {
                "source": "ai",
                "status": "pending",
                "score": None,
            },
        }
        write_json(item_json_path(settings, job_id, item_id), item)
        items.append({"item_id": item_id, "pdf_name": pdf_path.name, "status": "queued"})

    job = {
        "job_id": job_id,
        "campaign_name": campaign_name,
        "status": "queued",
        "source_mode": source_mode,
        "created_at": now_ts(),
        "started_at": None,
        "finished_at": None,
        "options": {
            "limit": limit,
            "dpi": dpi,
            "conf": conf,
            "imgsz": imgsz,
            "run_ocr": bool(run_ocr),
            "ocr_engine": ocr_engine,
            "random_seed": random_seed,
        },
        "total": len(items),
        "processed": 0,
        "completed": 0,
        "failed": 0,
        "summary": build_summary_from_items(settings, job_id),
        "items_preview": items[:50],
    }
    write_json(job_json_path(settings, job_id), job)
    return job


def _load_job(settings: Settings, job_id: str) -> dict[str, Any]:
    path = job_json_path(settings, job_id)
    if not path.exists():
        raise FileNotFoundError(job_id)
    return read_json(path, {})


def _save_job(settings: Settings, job: dict[str, Any]) -> None:
    write_json(job_json_path(settings, job["job_id"]), job)




def list_batch_jobs(settings: Settings, limit: int = 200) -> list[dict[str, Any]]:
    root = jobs_root(settings)
    if not root.exists():
        return []
    jobs: list[dict[str, Any]] = []
    for path in sorted(root.glob("*/job.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        job = read_json(path, {}) or {}
        job_id = job.get("job_id")
        if not job_id:
            continue
        try:
            job["summary"] = build_summary_from_items(settings, job_id)
        except Exception:
            pass
        jobs.append({
            "job_id": job_id,
            "campaign_name": job.get("campaign_name") or job_id,
            "status": job.get("status"),
            "source_mode": job.get("source_mode"),
            "created_at": job.get("created_at"),
            "started_at": job.get("started_at"),
            "finished_at": job.get("finished_at"),
            "options": job.get("options") or {},
            "total": job.get("total", 0),
            "processed": job.get("processed", 0),
            "completed": job.get("completed", 0),
            "failed": job.get("failed", 0),
            "summary": job.get("summary") or {},
        })
        if len(jobs) >= limit:
            break
    return jobs



def delete_batch_job(settings: Settings, job_id: str) -> dict[str, Any]:
    root = job_dir(settings, job_id)
    if not root.exists():
        raise FileNotFoundError(job_id)
    shutil.rmtree(root)
    return {"deleted": True, "job_id": job_id}


def list_job_items(settings: Settings, job_id: str, after: int = 0, limit: int = 500) -> list[dict[str, Any]]:
    root = items_dir(settings, job_id)
    if not root.exists():
        return []
    output = []
    for path in sorted(root.glob("item_*.json")):
        item = read_json(path, {})
        if int(item.get("index") or 0) <= after:
            continue
        output.append(item)
        if len(output) >= limit:
            break
    return output


def get_batch_job(settings: Settings, job_id: str, include_items: bool = True, after: int = 0) -> dict[str, Any]:
    job = _load_job(settings, job_id)
    job["summary"] = build_summary_from_items(settings, job_id)
    if include_items:
        job["items"] = list_job_items(settings, job_id, after=after)
    return job


def _bbox_area_ratio(bbox: list[int] | None, width: int, height: int) -> float:
    if not bbox or width <= 0 or height <= 0:
        return 0.0
    x1, y1, x2, y2 = bbox
    area = max(0, x2 - x1) * max(0, y2 - y1)
    return area / float(width * height)


def evaluate_ai(result: dict[str, Any]) -> dict[str, Any]:
    fields = result.get("fields") or {}
    pages = result.get("pages") or []
    first_page = pages[0] if pages else {}
    width = int(first_page.get("width") or 0)
    height = int(first_page.get("height") or 0)

    detected_fields = []
    missing_fields = []
    low_conf_fields = []
    suspicious_fields = []
    confidences = []

    field_status = {}
    for field in FIELD_NAMES:
        item = fields.get(field) or {}
        if item.get("detected"):
            detected_fields.append(field)
            conf = float(item.get("confidence") or 0.0)
            confidences.append(conf)
            area_ratio = _bbox_area_ratio(item.get("bbox"), width, height)
            status = "detected_good"
            if conf < LOW_CONF_THRESHOLD:
                low_conf_fields.append(field)
                status = "detected_low_conf"
            if area_ratio < SUSPICIOUS_MIN_AREA_RATIO or area_ratio > SUSPICIOUS_MAX_AREA_RATIO:
                suspicious_fields.append(field)
                status = "suspicious_box"
            field_status[field] = {
                "status": status,
                "confidence": conf,
                "area_ratio": area_ratio,
            }
        else:
            missing_fields.append(field)
            field_status[field] = {"status": "missing", "confidence": None, "area_ratio": None}

    detected_ratio = len(detected_fields) / max(1, len(FIELD_NAMES))
    avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
    low_conf_penalty = len(low_conf_fields) / max(1, len(FIELD_NAMES))
    suspicious_penalty = len(suspicious_fields) / max(1, len(FIELD_NAMES))
    quality_score = max(0.0, min(1.0, 0.55 * detected_ratio + 0.35 * avg_conf - 0.10 * low_conf_penalty - 0.10 * suspicious_penalty))

    if missing_fields or low_conf_fields or suspicious_fields:
        status = "need_review"
    else:
        status = "good"

    return {
        "status": status,
        "quality_score": round(quality_score, 6),
        "detected_fields": detected_fields,
        "missing_fields": missing_fields,
        "low_confidence_fields": low_conf_fields,
        "suspicious_fields": suspicious_fields,
        "detected_ratio": round(detected_ratio, 6),
        "avg_confidence": round(avg_conf, 6),
        "field_status": field_status,
        "note": "AI score is an automatic estimate. Human review is the final source when available.",
    }


def compute_final_evaluation(ai_eval: dict[str, Any] | None, human_review: dict[str, Any] | None) -> dict[str, Any]:
    ai_eval = ai_eval or {}
    human_review = human_review or {}
    fields = human_review.get("fields") or {}
    reviewed_decisions = []
    negative = []

    for field in FIELD_NAMES:
        decision = (fields.get(field) or {}).get("decision", "unreviewed")
        if decision != "unreviewed":
            reviewed_decisions.append(decision)
        if decision in {"wrong_box", "missing_should_exist"}:
            negative.append(field)

    if reviewed_decisions:
        if negative:
            status = "fail"
        elif len(reviewed_decisions) == len(FIELD_NAMES):
            status = "pass"
        else:
            status = "partial_pass"
        return {
            "source": "human",
            "status": status,
            "score": 1.0 if status == "pass" else 0.0 if status == "fail" else 0.5,
            "negative_fields": negative,
            "reviewed_fields": len(reviewed_decisions),
        }

    ai_status = ai_eval.get("status") or "pending"
    return {
        "source": "ai",
        "status": "pass_estimate" if ai_status == "good" else "need_review",
        "score": ai_eval.get("quality_score"),
        "negative_fields": [],
        "reviewed_fields": 0,
    }


def extract_pdf_path_for_batch(
    settings: Settings,
    yolo_service,
    pdf_path: Path,
    output_root: Path,
    *,
    dpi: int,
    conf: float,
    imgsz: int,
    run_ocr: bool,
    ocr_engine: str,
    ocr_endpoint: str,
    ocr_timeout: int,
) -> dict[str, Any]:
    request_id = uuid.uuid4().hex[:12]
    page_dir = output_root / "pages" / request_id
    crop_dir = output_root / "crops" / request_id
    page_paths = convert_pdf_to_pngs(pdf_path, page_dir, dpi=dpi)

    pages = []
    best_fields: dict[str, dict[str, Any]] = {}
    best_crop_paths: dict[str, Path] = {}
    model_loaded = yolo_service.is_available
    warning = None if model_loaded else "No active model found."

    for page_index, image_path in enumerate(page_paths, start=1):
        width, height = get_image_size(image_path)
        detections = []
        raw_detections = []
        if model_loaded:
            try:
                raw_detections = yolo_service.predict(image_path, conf=conf, imgsz=imgsz)
            except Exception as exc:
                warning = f"YOLO prediction failed: {exc}"
                raw_detections = []

        for det in raw_detections:
            field = det.get("field")
            if field not in FIELD_NAMES:
                continue
            crop_path = crop_dir / f"page_{page_index:03d}_{field}.png"
            crop_bbox(image_path, det["bbox"], crop_path)
            enriched = {
                "detected": True,
                "field": field,
                "class_id": det.get("class_id"),
                "confidence": round(float(det.get("confidence", 0.0)), 6),
                "bbox": det.get("bbox"),
                "crop_url": path_to_url(crop_path, settings),
                "text": None,
                "value": None,
                "predicted_text": None,
                "ocr_confidence_score": None,
                "final_source": None,
                "ocr_input_kind": None,
                "value_detector": None,
                "ocr_result": None,
                "page_number": page_index,
            }
            detections.append(enriched)
            old = best_fields.get(field)
            if old is None or enriched["confidence"] > old.get("confidence", 0.0):
                best_fields[field] = enriched
                best_crop_paths[field] = crop_path

        pages.append({
            "page_number": page_index,
            "width": width,
            "height": height,
            "image_url": path_to_url(image_path, settings),
            "detections": detections,
        })

    fields = {}
    missing_fields = []
    for name in FIELD_NAMES:
        if name in best_fields:
            fields[name] = {"detected": True, **best_fields[name]}
        else:
            fields[name] = {
                "detected": False,
                "field": name,
                "class_id": None,
                "confidence": None,
                "bbox": None,
                "crop_url": None,
                "text": None,
                "value": None,
                "predicted_text": None,
                "ocr_confidence_score": None,
                "final_source": None,
                "ocr_input_kind": None,
                "value_detector": None,
                "ocr_result": None,
                "page_number": None,
            }
            missing_fields.append(name)

    ocr_payload = None
    ocr_warning = None
    if run_ocr:
        ocr_payload = call_ocr_five_fields(
            endpoint=ocr_endpoint,
            crop_paths=best_crop_paths,
            engine=ocr_engine,
            timeout=ocr_timeout,
        )
        if isinstance(ocr_payload, dict):
            ocr_warning = ocr_payload.get("warning")
            results = ocr_payload.get("results") or {}
            for field_name, ocr_item in results.items():
                if field_name in fields and isinstance(ocr_item, dict):
                    fields[field_name]["ocr_result"] = ocr_item
                    fields[field_name]["value"] = ocr_item.get("value")
                    fields[field_name]["predicted_text"] = ocr_item.get("predicted_text")
                    fields[field_name]["ocr_confidence_score"] = ocr_item.get("confidence_score")
                    fields[field_name]["final_source"] = ocr_item.get("final_source")
                    fields[field_name]["ocr_input_kind"] = ocr_item.get("ocr_input_kind")
                    fields[field_name]["value_detector"] = ocr_item.get("value_detector")

    combined_warning = warning
    if ocr_warning:
        combined_warning = f"{combined_warning}; {ocr_warning}" if combined_warning else ocr_warning

    return {
        "request_id": request_id,
        "pdf_name": pdf_path.name,
        "model_loaded": model_loaded,
        "model_path": str(settings.active_model_path),
        "warning": combined_warning,
        "ocr": ocr_payload,
        "ocr_warning": ocr_warning,
        "fields": fields,
        "missing_fields": missing_fields,
        "pages": pages,
    }


def process_batch_job(
    settings: Settings,
    yolo_service,
    job_id: str,
    *,
    ocr_endpoint: str,
    ocr_timeout: int,
) -> None:
    job = _load_job(settings, job_id)
    job["status"] = "running"
    job["started_at"] = now_ts()
    _save_job(settings, job)

    options = job.get("options") or {}
    root = job_dir(settings, job_id)

    for item in list_job_items(settings, job_id, after=0, limit=1000000):
        item_path = item_json_path(settings, job_id, item["item_id"])
        item["status"] = "running"
        item["started_at"] = now_ts()
        write_json(item_path, item)

        try:
            pdf_path = Path(item["source_pdf_path"])
            result = extract_pdf_path_for_batch(
                settings,
                yolo_service,
                pdf_path,
                root,
                dpi=int(options.get("dpi") or 300),
                conf=float(options.get("conf") or 0.15),
                imgsz=int(options.get("imgsz") or 1536),
                run_ocr=bool(options.get("run_ocr")),
                ocr_engine=str(options.get("ocr_engine") or "auto+qwen"),
                ocr_endpoint=ocr_endpoint,
                ocr_timeout=ocr_timeout,
            )
            ai_eval = evaluate_ai(result)
            item["status"] = "completed"
            item["result"] = result
            item["ai_evaluation"] = ai_eval
            item["final_evaluation"] = compute_final_evaluation(ai_eval, item.get("human_review"))
            item["finished_at"] = now_ts()
            item["error"] = None
        except Exception as exc:
            item["status"] = "failed"
            item["error"] = str(exc)
            item["finished_at"] = now_ts()
            item["final_evaluation"] = {"source": "system", "status": "failed", "score": 0.0}

        write_json(item_path, item)
        job = _load_job(settings, job_id)
        job["processed"] = len([x for x in list_job_items(settings, job_id, after=0, limit=1000000) if x.get("status") in {"completed", "failed"}])
        job["completed"] = len([x for x in list_job_items(settings, job_id, after=0, limit=1000000) if x.get("status") == "completed"])
        job["failed"] = len([x for x in list_job_items(settings, job_id, after=0, limit=1000000) if x.get("status") == "failed"])
        job["summary"] = build_summary_from_items(settings, job_id)
        _save_job(settings, job)

    job = _load_job(settings, job_id)
    job["status"] = "completed"
    job["finished_at"] = now_ts()
    job["summary"] = build_summary_from_items(settings, job_id)
    _save_job(settings, job)


def update_item_review(
    settings: Settings,
    job_id: str,
    item_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    path = item_json_path(settings, job_id, item_id)
    if not path.exists():
        raise FileNotFoundError(item_id)
    item = read_json(path, {})
    fields_payload = payload.get("fields") or {}
    note = payload.get("note", "")

    human = item.get("human_review") or {}
    fields = human.get("fields") or {name: {"decision": "unreviewed", "note": ""} for name in FIELD_NAMES}

    for field, data in fields_payload.items():
        if field not in FIELD_NAMES:
            continue
        if isinstance(data, str):
            decision = data
            field_note = ""
        else:
            decision = data.get("decision", "unreviewed")
            field_note = data.get("note", "")
        if decision not in REVIEW_DECISIONS:
            decision = "unreviewed"
        fields[field] = {"decision": decision, "note": field_note}

    human["fields"] = fields
    human["note"] = note
    human["reviewed"] = any((fields.get(name) or {}).get("decision") != "unreviewed" for name in FIELD_NAMES)
    human["status"] = compute_final_evaluation(item.get("ai_evaluation"), human)["status"] if human["reviewed"] else "unreviewed"
    human["updated_at"] = now_ts()
    item["human_review"] = human
    item["final_evaluation"] = compute_final_evaluation(item.get("ai_evaluation"), human)
    write_json(path, item)

    job = _load_job(settings, job_id)
    job["summary"] = build_summary_from_items(settings, job_id)
    _save_job(settings, job)
    return item


def build_summary_from_items(settings: Settings, job_id: str) -> dict[str, Any]:
    items = list_job_items(settings, job_id, after=0, limit=1000000)
    total = len(items)
    completed = [i for i in items if i.get("status") == "completed"]
    failed = [i for i in items if i.get("status") == "failed"]
    expected_fields = len(completed) * len(FIELD_NAMES)
    detected_fields = 0
    confs = []
    ai_good = 0
    ai_need_review = 0
    final_pass = 0
    final_fail = 0
    final_need_review = 0
    human_reviewed = 0
    human_pass = 0
    human_fail = 0
    missing_counts = {name: 0 for name in FIELD_NAMES}
    issue_counts = {name: {"wrong_box": 0, "missing_should_exist": 0, "not_present": 0} for name in FIELD_NAMES}

    for item in completed:
        result = item.get("result") or {}
        fields = result.get("fields") or {}
        for name in FIELD_NAMES:
            f = fields.get(name) or {}
            if f.get("detected"):
                detected_fields += 1
                if f.get("confidence") is not None:
                    confs.append(float(f.get("confidence") or 0.0))
            else:
                missing_counts[name] += 1
        ai = item.get("ai_evaluation") or {}
        if ai.get("status") == "good":
            ai_good += 1
        else:
            ai_need_review += 1
        human = item.get("human_review") or {}
        if human.get("reviewed"):
            human_reviewed += 1
            final = item.get("final_evaluation") or {}
            if final.get("status") == "pass":
                human_pass += 1
            elif final.get("status") == "fail":
                human_fail += 1
            for name, review in (human.get("fields") or {}).items():
                decision = (review or {}).get("decision")
                if name in issue_counts and decision in issue_counts[name]:
                    issue_counts[name][decision] += 1
        final = item.get("final_evaluation") or {}
        status = final.get("status")
        if status in {"pass", "pass_estimate"}:
            final_pass += 1
        elif status == "fail":
            final_fail += 1
        else:
            final_need_review += 1

    detection_rate = detected_fields / expected_fields if expected_fields else 0.0
    avg_conf = sum(confs) / len(confs) if confs else 0.0
    human_accepted_rate = human_pass / human_reviewed if human_reviewed else None
    final_decided = final_pass + final_fail + final_need_review
    final_pass_rate = final_pass / final_decided if final_decided else 0.0

    return {
        "total": total,
        "completed": len(completed),
        "failed": len(failed),
        "expected_fields": expected_fields,
        "detected_fields": detected_fields,
        "detection_rate": round(detection_rate, 6),
        "avg_confidence": round(avg_conf, 6),
        "ai_good": ai_good,
        "ai_need_review": ai_need_review,
        "human_reviewed": human_reviewed,
        "human_pass": human_pass,
        "human_fail": human_fail,
        "human_accepted_rate": None if human_accepted_rate is None else round(human_accepted_rate, 6),
        "final_pass": final_pass,
        "final_fail": final_fail,
        "final_need_review": final_need_review,
        "final_pass_rate": round(final_pass_rate, 6),
        "missing_counts": missing_counts,
        "human_issue_counts": issue_counts,
    }


def export_batch_csv(settings: Settings, job_id: str, out_path: Path) -> Path:
    items = list_job_items(settings, job_id, after=0, limit=1000000)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "pdf_name", "item_id", "field", "detected", "confidence", "bbox", "crop_url",
            "value", "ai_status", "human_decision", "final_status",
        ])
        writer.writeheader()
        for item in items:
            result = item.get("result") or {}
            fields = result.get("fields") or {}
            ai_field_status = ((item.get("ai_evaluation") or {}).get("field_status") or {})
            human_fields = ((item.get("human_review") or {}).get("fields") or {})
            final_status = (item.get("final_evaluation") or {}).get("status")
            for name in FIELD_NAMES:
                field = fields.get(name) or {}
                writer.writerow({
                    "pdf_name": item.get("pdf_name"),
                    "item_id": item.get("item_id"),
                    "field": name,
                    "detected": bool(field.get("detected")),
                    "confidence": field.get("confidence"),
                    "bbox": json.dumps(field.get("bbox"), ensure_ascii=False),
                    "crop_url": field.get("crop_url"),
                    "value": field.get("value") or field.get("predicted_text"),
                    "ai_status": (ai_field_status.get(name) or {}).get("status"),
                    "human_decision": (human_fields.get(name) or {}).get("decision"),
                    "final_status": final_status,
                })
    return out_path
