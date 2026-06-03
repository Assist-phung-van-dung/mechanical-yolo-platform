from pathlib import Path
from pydantic_settings import BaseSettings


FIELD_NAMES = [
    "id_drawing",
    "spare_part_name",
    "spare_part_number",
    "quantity",
    "material",
]
FIELD_COLORS = {
    "id_drawing": "#2563eb",
    "spare_part_name": "#9333ea",
    "spare_part_number": "#dc2626",
    "quantity": "#f97316",
    "material": "#16a34a",
}

FIELD_TO_CLASS_ID = {name: idx for idx, name in enumerate(FIELD_NAMES)}
CLASS_ID_TO_FIELD = {idx: name for idx, name in enumerate(FIELD_NAMES)}


class Settings(BaseSettings):
    data_root: Path = Path("/data")
    active_model_path: Path = Path("/data/models/active/best.pt")
    cors_origins: str = "*"
    ocr_five_fields_url: str = "http://host.docker.internal:5000/api/ocr-five-fields"
    ocr_five_fields_engine: str = "auto+qwen"
    ocr_five_fields_timeout: int = 180

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @property
    def uploads_dir(self) -> Path:
        return self.data_root / "uploads"

    @property
    def pages_dir(self) -> Path:
        return self.data_root / "pages"

    @property
    def crops_dir(self) -> Path:
        return self.data_root / "crops"

    @property
    def datasets_dir(self) -> Path:
        return self.data_root / "datasets"

    @property
    def models_dir(self) -> Path:
        return self.data_root / "models"

    @property
    def jobs_dir(self) -> Path:
        return self.data_root / "jobs"

    @property
    def pdfs_dir(self) -> Path:
        return self.data_root / "pdfs"

    @property
    def rendered_dir(self) -> Path:
        return self.data_root / "rendered"

    @property
    def annotations_dir(self) -> Path:
        return self.data_root / "annotations"

    @property
    def yolo_labels_dir(self) -> Path:
        return self.data_root / "yolo_labels"

    @property
    def review_dir(self) -> Path:
        return self.data_root / "review"

    @property
    def batch_eval_dir(self) -> Path:
        return self.data_root / "batch_eval"

    @property
    def imports_dir(self) -> Path:
        return self.data_root / "imports"

    @property
    def pdf_imports_dir(self) -> Path:
        return self.imports_dir / "pdfs"

    @property
    def cvat_imports_dir(self) -> Path:
        return self.imports_dir / "cvat-export"


def get_settings() -> Settings:
    return Settings()
