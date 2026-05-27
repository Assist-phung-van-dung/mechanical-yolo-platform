# Mechanical YOLO Platform v3

A production-ready PDF field extraction and human-in-the-loop labeling platform for mechanical drawings.

## Core flow

```text
External client PDF
→ FastAPI /api/v1/extract-fields
→ PDF render to PNG
→ YOLO detects 5 fields
→ crop 5 field images
→ OCR/Qwen API /api/ocr-five-fields
→ JSON with bbox + crop URL/base64 + text/value
```

## Labeling flow

```text
Bulk PDF import
→ render pages
→ optional YOLO pre-label
→ Label Workspace review
→ Confirm & Next
→ annotation JSON + version history
→ build YOLO dataset from confirmed labels
→ train/fine-tune YOLO
```

## Five fields

```text
id_drawing
material
quantity
spare_part_name
spare_part_number
```

## New in v3

- Bulk PDF import with duplicate protection by content hash.
- Optional YOLO pre-label during PDF import.
- Batch pre-label queue for unlabeled/missing/low-confidence pages.
- CVAT import is idempotent: skip existing by hash or overwrite intentionally.
- Label Workspace supports Confirm & Next.
- Canvas shows colored boxes only, no text labels covering the drawing.
- Hotkeys: `1-5`, `D`, `V`, `R`, `N`, `Enter`, `Ctrl+S`, `Delete`, `+`, `-`.
- Review Labeled page for confirmed/draft/CVAT/human pages.
- Annotation history and restore.
- Pre-label protects human/CVAT confirmed labels by default.
- Production OCR/Qwen API integration.

## Runtime folders

```text
runtime/
  imports/pdfs/              # Put new PDF folders here for bulk import
  imports/cvat-export/       # Put CVAT train/images + train/labels here
  pdfs/                      # Internal PDF library
  rendered/                  # Rendered PNG pages
  annotations/               # JSON annotations
  review/annotation_history/ # Versioned annotation backups
  yolo_labels/               # YOLO txt mirrors
  datasets/                  # Built YOLO datasets
  models/active/best.pt      # Active model used by API/demo
  models/                    # Training outputs
```

## Deploy/update

```bash
cd ~
cp -a mechanical-yolo-platform mechanical-yolo-platform-bak-$(date +%Y%m%d-%H%M%S)
unzip -o mechanical-yolo-platform-v3-full.zip -d ~
cd mechanical-yolo-platform
docker compose down
docker compose up --build -d
```

If `runtime` is a symlink to HDD, the zip does not include runtime data and will not overwrite it.

## OCR/Qwen API config

If OCR service runs on the Ubuntu host:

```env
OCR_FIVE_FIELDS_URL=http://host.docker.internal:5000/api/ocr-five-fields
OCR_FIVE_FIELDS_ENGINE=auto+qwen
OCR_FIVE_FIELDS_TIMEOUT=180
```

Docker compose includes:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

The OCR service should listen on `0.0.0.0:5000` so the backend container can reach it.

## Production API

```bash
curl -X POST "http://SERVER_IP:8888/api/v1/extract-fields" \
  -F "file=@/path/to/drawing.pdf" \
  -F "dpi=300" \
  -F "conf=0.25" \
  -F "imgsz=1536" \
  -F "run_ocr=true" \
  -F "ocr_engine=auto+qwen" \
  -F "include_base64=false"
```

Response per field includes:

```json
{
  "detected": true,
  "field": "material",
  "bbox": [100, 200, 300, 250],
  "confidence": 0.94,
  "crop_url": "/files/crops/.../material.png",
  "value": "SUS304",
  "predicted_text": "SUS304",
  "ocr_confidence_score": 0.91,
  "final_source": "ocr/qwen/same",
  "value_detector": {}
}
```

## Bulk import PDFs

Copy PDFs to:

```bash
runtime/imports/pdfs/
```

Then use the UI: `PDF Library → Bulk PDF folder`.

Or call API:

```bash
curl -X POST "http://localhost:8888/api/pdfs/import-folder" \
  -F "folder=/data/imports/pdfs" \
  -F "render=true" \
  -F "dpi=300" \
  -F "recursive=true" \
  -F "skip_existing=true" \
  -F "prelabel=true" \
  -F "conf=0.15" \
  -F "imgsz=1536"
```

## Import CVAT foundation

Folder layout:

```text
runtime/imports/cvat-export/train/images
runtime/imports/cvat-export/train/labels
```

UI: `PDF Library → Import CVAT labels`.

API:

```bash
curl -X POST "http://localhost:8888/api/cvat/import-folder" \
  -F "folder=/data/imports/cvat-export" \
  -F "class_order=id_drawing
material
quantity
spare_part_name
spare_part_number" \
  -F "mark_confirmed=true" \
  -F "skip_existing=true" \
  -F "overwrite_annotations=false"
```

## Build dataset from confirmed labels

```bash
curl -X POST "http://localhost:8888/api/dataset/build-from-confirmed" \
  -F "dataset_id=mechanical-confirmed-v4" \
  -F "val_ratio=0.2" \
  -F "seed=42" \
  -F "require_all_fields=true"
```

Train:

```bash
docker compose exec backend yolo detect train \
  data=/data/datasets/mechanical-confirmed-v4/data.yaml \
  model=/data/models/active/best.pt \
  imgsz=1536 \
  epochs=80 \
  patience=20 \
  batch=2 \
  device=0 \
  workers=4 \
  cache=False \
  rect=True \
  close_mosaic=10 \
  lr0=0.0005 \
  project=/data/models \
  name=field-detector-v4-finetune
```
