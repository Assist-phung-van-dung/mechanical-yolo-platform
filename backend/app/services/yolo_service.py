from pathlib import Path
from typing import Optional

from app.core.config import FIELD_NAMES


class YoloService:
    def __init__(self, model_path: Path):
        self.model_path = model_path
        self._model = None
        self._loaded_path: Optional[Path] = None
        self._loaded_mtime: Optional[float] = None

    @property
    def is_available(self) -> bool:
        return self.model_path.exists()

    def _load_model(self):
        if not self.model_path.exists():
            return None
        mtime = self.model_path.stat().st_mtime
        if self._model is None or self._loaded_path != self.model_path or self._loaded_mtime != mtime:
            from ultralytics import YOLO
            self._model = YOLO(str(self.model_path))
            self._loaded_path = self.model_path
            self._loaded_mtime = mtime
        return self._model

    def predict(self, image_path: Path, conf: float = 0.25, imgsz: int = 1280) -> list[dict]:
        model = self._load_model()
        if model is None:
            return []

        result = model.predict(
            source=str(image_path),
            conf=conf,
            imgsz=imgsz,
            verbose=False,
        )[0]

        detections: list[dict] = []
        if result.boxes is None:
            return detections

        for box in result.boxes:
            cls_id = int(box.cls.item())
            if cls_id < 0 or cls_id >= len(FIELD_NAMES):
                continue
            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = [int(round(v)) for v in xyxy]
            detections.append(
                {
                    "field": FIELD_NAMES[cls_id],
                    "class_id": cls_id,
                    "confidence": float(box.conf.item()),
                    "bbox": [x1, y1, x2, y2],
                }
            )

        detections.sort(key=lambda item: item["confidence"], reverse=True)
        return keep_best_per_field(detections)


def keep_best_per_field(detections: list[dict]) -> list[dict]:
    best: dict[str, dict] = {}
    for det in detections:
        key = det["field"]
        if key not in best or det["confidence"] > best[key]["confidence"]:
            best[key] = det
    ordered = []
    for field_name in FIELD_NAMES:
        if field_name in best:
            ordered.append(best[field_name])
    return ordered
