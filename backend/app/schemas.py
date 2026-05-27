from typing import Optional
from pydantic import BaseModel, Field


class Detection(BaseModel):
    field: str
    class_id: int
    confidence: float
    bbox: list[int] = Field(description="[x1, y1, x2, y2]")
    crop_url: Optional[str] = None
    text: Optional[str] = None


class PageResult(BaseModel):
    page_number: int
    width: int
    height: int
    image_url: str
    detections: list[Detection]


class ExtractResponse(BaseModel):
    request_id: str
    model_loaded: bool
    warning: Optional[str] = None
    fields: dict[str, dict]
    missing_fields: list[str]
    pages: list[PageResult]


class TrainStartResponse(BaseModel):
    job_id: str
    status: str
    log_url: Optional[str] = None


class ModelInfo(BaseModel):
    id: str
    path: str
    is_active: bool = False
    size_mb: float = 0.0
    modified_at: Optional[float] = None
