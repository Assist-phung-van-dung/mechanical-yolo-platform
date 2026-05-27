import base64
import uuid
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import FIELD_COLORS, FIELD_NAMES, get_settings
from app.core.storage import ensure_storage, safe_filename, path_to_url
from app.services.crop_service import crop_bbox
from app.services.dataset_service import list_datasets, prepare_cvat_yolo_zip
from app.services.library_service import (
    build_dataset_from_confirmed,
    confirm_annotation,
    get_document_pages,
    get_page_payload,
    import_cvat_yolo_folder,
    import_pdf_folder,
    library_stats,
    list_documents,
    next_label_target,
    prelabel_page,
    render_document,
    save_annotation,
    upload_pdf_to_library,
)
from app.services.ocr_api_service import call_ocr_five_fields
from app.services.pdf_service import convert_pdf_to_pngs, get_image_size
from app.services.train_service import (
    activate_model,
    create_train_job,
    get_train_job,
    list_models,
    list_train_jobs,
)
from app.services.yolo_service import YoloService


settings = get_settings()
ensure_storage(settings)

yolo_service = YoloService(settings.active_model_path)


# Important:
# Keep this identity mapping unless you intentionally need runtime aliasing.
# Your current production class order is:
#   0 id_drawing
#   1 spare_part_name
#   2 spare_part_number
#   3 quantity
#   4 material
#
# FIELD_NAMES should be configured in backend/app/core/config.py.
FIELD_RESPONSE_ALIAS = {name: name for name in FIELD_NAMES}


app = FastAPI(
    title="Mechanical Drawing YOLO Platform",
    version="3.0.0",
    description=(
        "PDF library, label review workspace, YOLO pre-labeling, dataset building, "
        "PDF extraction API, external OCR/Qwen integration, and model training."
    ),
)


origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/files", StaticFiles(directory=str(settings.data_root)), name="files")


def _get_ocr_url() -> str:
    return str(
        getattr(
            settings,
            "ocr_five_fields_url",
            "http://host.docker.internal:5000/api/ocr-five-fields",
        )
    )


def _get_ocr_engine(default_engine: str = "auto+qwen") -> str:
    return str(getattr(settings, "ocr_five_fields_engine", default_engine) or default_engine)


def _get_ocr_timeout() -> int:
    return int(getattr(settings, "ocr_five_fields_timeout", 300) or 300)


def _merge_ocr_results_into_fields(fields: dict, ocr_payload: dict) -> None:
    """Merge OCR/Qwen API result into YOLO field response.

    Supported OCR service normalized payload from call_ocr_five_fields():

    {
      "ok": true,
      "results": {
        "material": {
          "value": "...",
          "predicted_text": "...",
          "confidence_score": 0.91,
          "final_source": "ocr/qwen/same",
          "ocr_input_kind": "yolo_crop",
          "value_detector": {...}
        }
      }
    }
    """
    if not isinstance(ocr_payload, dict):
        return

    ocr_results = ocr_payload.get("results") or {}
    if not isinstance(ocr_results, dict):
        return

    for field_name, ocr_item in ocr_results.items():
        if field_name not in fields:
            continue
        if not isinstance(ocr_item, dict):
            continue

        fields[field_name]["ocr_result"] = ocr_item
        fields[field_name]["value"] = ocr_item.get("value")
        fields[field_name]["predicted_text"] = ocr_item.get("predicted_text")
        fields[field_name]["ocr_confidence_score"] = ocr_item.get("confidence_score")
        fields[field_name]["final_source"] = ocr_item.get("final_source")
        fields[field_name]["ocr_input_kind"] = ocr_item.get("ocr_input_kind")
        fields[field_name]["value_detector"] = ocr_item.get("value_detector")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "data_root": str(settings.data_root),
        "active_model_path": str(settings.active_model_path),
        "model_loaded": settings.active_model_path.exists(),
        "classes": FIELD_NAMES,
        "field_colors": FIELD_COLORS,
        "ocr_five_fields_url": _get_ocr_url(),
        "ocr_five_fields_engine": _get_ocr_engine(),
    }


@app.get("/api/config")
def config():
    return {
        "classes": FIELD_NAMES,
        "field_colors": FIELD_COLORS,
        "expected_dataset_layout": "train/images and train/labels",
        "default_dpi": 300,
        "default_imgsz": 1536,
        "data_root": str(settings.data_root),
        "ocr": {
            "url": _get_ocr_url(),
            "engine": _get_ocr_engine(),
            "timeout": _get_ocr_timeout(),
        },
        "folders": {
            "pdf_imports": str(settings.pdf_imports_dir),
            "cvat_imports": str(settings.cvat_imports_dir),
            "pdfs": str(settings.pdfs_dir),
            "rendered": str(settings.rendered_dir),
            "annotations": str(settings.annotations_dir),
            "datasets": str(settings.datasets_dir),
            "models": str(settings.models_dir),
        },
    }


@app.get("/api/classes")
def classes():
    return {
        "classes": [
            {
                "id": idx,
                "name": name,
                "color": FIELD_COLORS.get(name, "#64748b"),
            }
            for idx, name in enumerate(FIELD_NAMES)
        ]
    }


@app.get("/api/ocr/health")
def ocr_health():
    return {
        "configured": bool(_get_ocr_url()),
        "url": _get_ocr_url(),
        "engine": _get_ocr_engine(),
        "timeout": _get_ocr_timeout(),
        "note": (
            "This endpoint only reports OCR client configuration. "
            "The OCR five-fields endpoint itself expects multipart POST files."
        ),
    }


async def run_pdf_extraction(
    file: UploadFile,
    dpi: int,
    conf: float,
    imgsz: int,
    run_ocr: bool,
    ocr_engine: str,
    include_base64: bool = False,
) -> dict:
    """Extract 5 mechanical drawing fields from one PDF.

    Flow:
      PDF upload
      -> PDF pages rendered as PNG
      -> YOLO detects field bounding boxes
      -> backend crops detected field images
      -> if all 5 crops exist and run_ocr=True, call external OCR/Qwen API
      -> merge OCR values into response
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    request_id = uuid.uuid4().hex[:12]
    upload_name = safe_filename(file.filename)
    pdf_path = settings.uploads_dir / request_id / upload_name
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    pdf_path.write_bytes(await file.read())

    page_dir = settings.pages_dir / request_id
    crop_dir = settings.crops_dir / request_id

    try:
        page_paths = convert_pdf_to_pngs(pdf_path, page_dir, dpi=dpi)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF conversion failed: {exc}") from exc

    pages = []
    best_fields: dict[str, dict] = {}
    best_crop_paths: dict[str, Path] = {}

    model_loaded = settings.active_model_path.exists()
    warning = None if model_loaded else (
        "No active model found. Put best.pt at /data/models/active/best.pt "
        "or activate a trained model."
    )

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
            raw_field = det.get("field")
            field = FIELD_RESPONSE_ALIAS.get(raw_field, raw_field)

            if field not in FIELD_NAMES:
                continue

            crop_path = crop_dir / f"page_{page_index:03d}_{field}.png"
            crop_bbox(image_path, det["bbox"], crop_path)

            crop_url = path_to_url(crop_path, settings)
            enriched = {
                "detected": True,
                "field": field,
                "raw_field": raw_field,
                "class_id": det.get("class_id"),
                "confidence": round(float(det.get("confidence", 0)), 6),
                "bbox": det.get("bbox"),
                "crop_url": crop_url,
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

            if include_base64:
                enriched["image_base64"] = base64.b64encode(crop_path.read_bytes()).decode("ascii")
                enriched["image_mime"] = "image/png"

            detections.append(enriched)

            old = best_fields.get(field)
            if old is None or enriched["confidence"] > old.get("confidence", 0):
                best_fields[field] = enriched
                best_crop_paths[field] = crop_path

        pages.append(
            {
                "page_number": page_index,
                "width": width,
                "height": height,
                "image_url": path_to_url(image_path, settings),
                "detections": detections,
            }
        )

    fields = {}
    missing_fields = []

    for name in FIELD_NAMES:
        if name in best_fields:
            fields[name] = {
                "detected": True,
                **best_fields[name],
            }
        else:
            fields[name] = {
                "detected": False,
                "field": name,
                "raw_field": None,
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
            if include_base64:
                fields[name]["image_base64"] = None
                fields[name]["image_mime"] = None
            missing_fields.append(name)

    ocr_payload = None
    ocr_warning = None

    if run_ocr:
        ocr_payload = call_ocr_five_fields(
            endpoint=_get_ocr_url(),
            crop_paths=best_crop_paths,
            engine=ocr_engine or _get_ocr_engine(),
            timeout=_get_ocr_timeout(),
        )

        if isinstance(ocr_payload, dict):
            ocr_warning = ocr_payload.get("warning")
            _merge_ocr_results_into_fields(fields, ocr_payload)

    combined_warning = warning
    if ocr_warning:
        combined_warning = f"{combined_warning}; {ocr_warning}" if combined_warning else ocr_warning

    return {
        "request_id": request_id,
        "model_loaded": model_loaded,
        "model_path": str(settings.active_model_path),
        "warning": combined_warning,
        "ocr": ocr_payload,
        "ocr_warning": ocr_warning,
        "fields": fields,
        "missing_fields": missing_fields,
        "pages": pages,
    }


@app.post("/api/extract")
async def extract_pdf(
    file: UploadFile = File(...),
    dpi: int = Form(300),
    conf: float = Form(0.25),
    imgsz: int = Form(1536),
    run_ocr: Optional[bool] = Form(None),
    ocr: Optional[bool] = Form(None),
    ocr_engine: str = Form("auto+qwen"),
    include_base64: bool = Form(False),
):
    # Backward compatible:
    # - new frontend/API should send run_ocr
    # - older frontend may send ocr
    should_run_ocr = bool(run_ocr) if run_ocr is not None else bool(ocr)

    return await run_pdf_extraction(
        file=file,
        dpi=dpi,
        conf=conf,
        imgsz=imgsz,
        run_ocr=should_run_ocr,
        ocr_engine=ocr_engine,
        include_base64=include_base64,
    )


@app.post("/api/v1/extract-fields")
async def extract_fields_api(
    file: UploadFile = File(...),
    dpi: int = Form(300),
    conf: float = Form(0.25),
    imgsz: int = Form(1536),
    run_ocr: bool = Form(True),
    ocr_engine: str = Form("auto+qwen"),
    include_base64: bool = Form(False),
):
    """Production extraction endpoint for external systems.

    Input:
      one PDF

    Output:
      five field entries with:
        - detected
        - bbox
        - confidence
        - crop_url
        - optional base64 crop image
        - OCR/Qwen value and metadata if run_ocr=true
    """
    result = await run_pdf_extraction(
        file=file,
        dpi=dpi,
        conf=conf,
        imgsz=imgsz,
        run_ocr=run_ocr,
        ocr_engine=ocr_engine,
        include_base64=include_base64,
    )
    return {
        "status": "success",
        "request_id": result["request_id"],
        "model_loaded": result["model_loaded"],
        "model_path": result["model_path"],
        "warning": result["warning"],
        "ocr": result["ocr"],
        "ocr_warning": result["ocr_warning"],
        "fields": result["fields"],
        "missing_fields": result["missing_fields"],
    }


# -----------------------------------------------------------------------------
# PDF library and label-review workflow
# -----------------------------------------------------------------------------


@app.get("/api/library/stats")
def library_stats_endpoint():
    return library_stats(settings)


@app.get("/api/pdfs")
def pdfs(
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(500),
):
    return {"documents": list_documents(settings, status=status, q=q, limit=limit)}


@app.post("/api/pdfs/upload")
async def upload_pdf_library_endpoint(
    file: UploadFile = File(...),
    render: bool = Form(True),
    dpi: int = Form(300),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")
    return upload_pdf_to_library(settings, file.filename, await file.read(), render=render, dpi=dpi)


@app.post("/api/pdfs/import-folder")
def import_pdf_folder_endpoint(
    folder: str = Form("/data/imports/pdfs"),
    render: bool = Form(True),
    dpi: int = Form(300),
    recursive: bool = Form(True),
    prelabel: bool = Form(False),
    conf: float = Form(0.25),
    imgsz: int = Form(1536),
):
    try:
        result = import_pdf_folder(settings, Path(folder), render=render, dpi=dpi, recursive=recursive)

        # If the v3 library service supports batch prelabel after import,
        # the frontend can also call /api/label/prelabel-batch.
        # This endpoint keeps import itself safe and simple.
        result["prelabel_requested"] = prelabel
        result["prelabel_note"] = (
            "Use /api/label/prelabel-batch after import if batch pre-label is required."
        )
        result["prelabel_conf"] = conf
        result["prelabel_imgsz"] = imgsz

        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/cvat/import-folder")
def import_cvat_folder_endpoint(
    folder: str = Form("/data/imports/cvat-export"),
    class_order: str = Form("\n".join(FIELD_NAMES)),
    mark_confirmed: bool = Form(True),
    limit: Optional[int] = Form(None),
    overwrite: bool = Form(False),
):
    try:
        return import_cvat_yolo_folder(
            settings,
            source_dir=Path(folder),
            class_order=class_order,
            mark_confirmed=mark_confirmed,
            limit=limit,
            overwrite=overwrite,
        )
    except TypeError:
        # Backward compatibility with older library_service.py that does not
        # accept overwrite.
        try:
            return import_cvat_yolo_folder(
                settings,
                source_dir=Path(folder),
                class_order=class_order,
                mark_confirmed=mark_confirmed,
                limit=limit,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/pdfs/{pdf_id}/render")
def render_pdf_endpoint(
    pdf_id: str,
    dpi: int = Form(300),
    force: bool = Form(False),
):
    try:
        return render_document(settings, pdf_id, dpi=dpi, force=force)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/pdfs/{pdf_id}/pages")
def pdf_pages(pdf_id: str):
    return {"pages": get_document_pages(settings, pdf_id)}


@app.get("/api/label/next")
def label_next(mode: str = Query("need_review")):
    target = next_label_target(settings, mode=mode)
    if not target:
        raise HTTPException(status_code=404, detail=f"No label target found for mode={mode}")
    return target


@app.get("/api/label/{pdf_id}/{page_number}")
def label_page(pdf_id: str, page_number: int):
    try:
        return get_page_payload(settings, pdf_id, page_number)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/label/{pdf_id}/{page_number}/save")
def save_label_page(pdf_id: str, page_number: int, payload: dict = Body(...)):
    try:
        return save_annotation(
            settings,
            pdf_id,
            page_number,
            payload,
            status=payload.get("status", "draft"),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/label/{pdf_id}/{page_number}/confirm")
def confirm_label_page(pdf_id: str, page_number: int):
    try:
        return confirm_annotation(settings, pdf_id, page_number)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/label/{pdf_id}/{page_number}/confirm-next")
def confirm_label_page_and_next(
    pdf_id: str,
    page_number: int,
    payload: Optional[dict] = Body(None),
    mode: str = Query("need_review"),
):
    try:
        if payload:
            save_annotation(
                settings,
                pdf_id,
                page_number,
                payload,
                status=payload.get("status", "confirmed"),
            )

        current = confirm_annotation(settings, pdf_id, page_number)
        next_target = next_label_target(settings, mode=mode)

        return {
            "saved": True,
            "confirmed": True,
            "current": current,
            "next": next_target,
            "mode": mode,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/label/{pdf_id}/{page_number}/prelabel")
def prelabel_label_page(
    pdf_id: str,
    page_number: int,
    conf: float = Form(0.25),
    imgsz: int = Form(1536),
    replace: bool = Form(False),
):
    try:
        return prelabel_page(
            settings,
            pdf_id,
            page_number,
            yolo_service,
            conf=conf,
            imgsz=imgsz,
            replace=replace,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/label/prelabel-batch")
def prelabel_batch_endpoint(
    mode: str = Form("unlabeled"),
    limit: int = Form(100),
    conf: float = Form(0.25),
    imgsz: int = Form(1536),
    replace: bool = Form(False),
):
    """Batch pre-label pages.

    This endpoint is intentionally defensive:
    it uses next_label_target repeatedly so it can work with the existing
    file-based library service without requiring a DB.
    """
    processed = []
    errors = []

    for _ in range(max(0, limit)):
        target = next_label_target(settings, mode=mode)
        if not target:
            break

        pdf_id = target.get("pdf_id") or target.get("document_id")
        page_number = target.get("page_number") or target.get("page") or 1

        if not pdf_id:
            break

        try:
            item = prelabel_page(
                settings,
                pdf_id,
                int(page_number),
                yolo_service,
                conf=conf,
                imgsz=imgsz,
                replace=replace,
            )
            processed.append(
                {
                    "pdf_id": pdf_id,
                    "page_number": page_number,
                    "result": item,
                }
            )
        except Exception as exc:
            errors.append(
                {
                    "pdf_id": pdf_id,
                    "page_number": page_number,
                    "error": str(exc),
                }
            )
            break

    return {
        "processed_count": len(processed),
        "errors_count": len(errors),
        "processed": processed,
        "errors": errors,
    }


@app.get("/api/label/review")
def review_labeled(
    status: str = Query("confirmed"),
    q: Optional[str] = Query(None),
    limit: int = Query(500),
):
    documents = list_documents(settings, status=status, q=q, limit=limit)
    return {"documents": documents, "status": status}


@app.get("/api/label/{pdf_id}/{page_number}/history")
def label_history(pdf_id: str, page_number: int):
    history_dir = settings.annotations_dir / pdf_id / "history" / f"page_{page_number:03d}"
    items = []

    if history_dir.exists():
        for path in sorted(history_dir.glob("*.json"), reverse=True):
            items.append(
                {
                    "filename": path.name,
                    "path": str(path),
                    "url": path_to_url(path, settings),
                    "modified_at": path.stat().st_mtime,
                }
            )

    return {"pdf_id": pdf_id, "page_number": page_number, "history": items}


@app.post("/api/label/{pdf_id}/{page_number}/restore")
def restore_label_history(
    pdf_id: str,
    page_number: int,
    history_file: str = Form(...),
):
    history_dir = settings.annotations_dir / pdf_id / "history" / f"page_{page_number:03d}"
    source = history_dir / safe_filename(history_file)
    target = settings.annotations_dir / pdf_id / f"page_{page_number:03d}.json"

    if not source.exists():
        raise HTTPException(status_code=404, detail="History file not found")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())

    return {
        "restored": True,
        "pdf_id": pdf_id,
        "page_number": page_number,
        "source": str(source),
        "target": str(target),
    }


@app.post("/api/dataset/build-from-confirmed")
def build_from_confirmed(
    dataset_id: str = Form(...),
    val_ratio: float = Form(0.2),
    seed: int = Form(42),
    require_all_fields: bool = Form(True),
):
    try:
        return build_dataset_from_confirmed(
            settings,
            dataset_id=dataset_id,
            val_ratio=val_ratio,
            seed=seed,
            require_all_fields=require_all_fields,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# -----------------------------------------------------------------------------
# Existing CVAT zip, dataset, training, model-management APIs
# -----------------------------------------------------------------------------


@app.post("/api/dataset/upload-cvat")
async def upload_cvat_dataset(
    file: UploadFile = File(...),
    dataset_name: Optional[str] = Form(None),
    val_ratio: float = Form(0.2),
):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload a CVAT YOLO zip file")

    dataset_id = safe_filename(dataset_name or Path(file.filename).stem) + "-" + uuid.uuid4().hex[:6]
    zip_path = settings.uploads_dir / "datasets" / f"{dataset_id}.zip"
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    zip_path.write_bytes(await file.read())

    try:
        return prepare_cvat_yolo_zip(zip_path, dataset_id, settings, val_ratio=val_ratio)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/datasets")
def datasets():
    return {"datasets": list_datasets(settings)}


@app.post("/api/train/start")
def start_training(
    dataset_id: str = Form(...),
    base_model: str = Form("yolo11n.pt"),
    epochs: int = Form(100),
    imgsz: int = Form(1536),
    batch: int = Form(8),
    device: Optional[str] = Form(None),
    patience: Optional[int] = Form(None),
    workers: Optional[int] = Form(None),
    cache: Optional[bool] = Form(None),
):
    try:
        job = create_train_job(
            settings=settings,
            dataset_id=dataset_id,
            base_model=base_model,
            epochs=epochs,
            imgsz=imgsz,
            batch=batch,
            device=device or None,
            patience=patience,
            workers=workers,
            cache=cache,
        )
        return job
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/train/jobs")
def train_jobs():
    return {"jobs": list_train_jobs(settings)}


@app.get("/api/train/jobs/{job_id}")
def train_job(job_id: str):
    try:
        return get_train_job(settings, job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@app.get("/api/models")
def models():
    return {"models": list_models(settings)}


@app.post("/api/models/activate")
def activate(model_path: str = Form(...)):
    try:
        return activate_model(settings, model_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Model not found") from exc