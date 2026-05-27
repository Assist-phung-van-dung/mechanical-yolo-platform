import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from app.core.config import Settings
from app.core.storage import read_json, write_json, path_to_url


def job_path(settings: Settings, job_id: str) -> Path:
    return settings.jobs_dir / f"{job_id}.json"


def log_path(settings: Settings, job_id: str) -> Path:
    return settings.jobs_dir / f"{job_id}.log"


def create_train_job(
    settings: Settings,
    dataset_id: str,
    base_model: str,
    epochs: int,
    imgsz: int,
    batch: int,
    device: str | None = None,
    patience: int | None = None,
    workers: int | None = None,
    cache: bool | None = None,
) -> dict:
    dataset_dir = settings.datasets_dir / dataset_id
    data_yaml = dataset_dir / "data.yaml"
    if not data_yaml.exists():
        raise FileNotFoundError(f"Dataset data.yaml not found for {dataset_id}")

    job_id = uuid.uuid4().hex[:12]
    run_name = f"field-detector-{int(time.time())}-{job_id}"
    log_file = log_path(settings, job_id)

    command = [
        "yolo",
        "detect",
        "train",
        f"data={data_yaml}",
        f"model={base_model}",
        f"imgsz={imgsz}",
        f"epochs={epochs}",
        f"batch={batch}",
        f"project={settings.models_dir}",
        f"name={run_name}",
        "exist_ok=True",
    ]
    if device:
        command.append(f"device={device}")
    if patience is not None:
        command.append(f"patience={patience}")
    if workers is not None:
        command.append(f"workers={workers}")
    if cache is not None:
        command.append(f"cache={str(cache)}")

    payload = {
        "job_id": job_id,
        "status": "queued",
        "dataset_id": dataset_id,
        "base_model": base_model,
        "epochs": epochs,
        "imgsz": imgsz,
        "batch": batch,
        "device": device,
        "patience": patience,
        "workers": workers,
        "cache": cache,
        "command": command,
        "run_name": run_name,
        "created_at": time.time(),
        "started_at": None,
        "finished_at": None,
        "return_code": None,
        "model_path": None,
        "log_file": str(log_file),
        "log_url": path_to_url(log_file, settings),
    }
    write_json(job_path(settings, job_id), payload)

    thread = threading.Thread(target=run_train_job, args=(settings, job_id), daemon=True)
    thread.start()
    return payload


def run_train_job(settings: Settings, job_id: str) -> None:
    path = job_path(settings, job_id)
    payload = read_json(path, {})
    if not payload:
        return

    payload["status"] = "running"
    payload["started_at"] = time.time()
    write_json(path, payload)

    log_file = log_path(settings, job_id)
    log_file.parent.mkdir(parents=True, exist_ok=True)

    with log_file.open("w", encoding="utf-8") as log:
        log.write("Command: " + " ".join(payload["command"]) + "\n\n")
        log.flush()
        process = subprocess.Popen(
            payload["command"],
            stdout=log,
            stderr=subprocess.STDOUT,
            cwd=str(settings.data_root),
            text=True,
        )
        return_code = process.wait()

    payload = read_json(path, payload)
    payload["finished_at"] = time.time()
    payload["return_code"] = return_code

    best_pt = settings.models_dir / payload["run_name"] / "weights" / "best.pt"
    if return_code == 0 and best_pt.exists():
        payload["status"] = "completed"
        payload["model_path"] = str(best_pt)
    else:
        payload["status"] = "failed"
    write_json(path, payload)


def list_train_jobs(settings: Settings) -> list[dict]:
    jobs = [read_json(p, {}) for p in settings.jobs_dir.glob("*.json")]
    jobs = [j for j in jobs if j]
    jobs.sort(key=lambda item: item.get("created_at", 0), reverse=True)
    return jobs


def get_train_job(settings: Settings, job_id: str) -> dict:
    payload = read_json(job_path(settings, job_id), {})
    if not payload:
        raise FileNotFoundError(job_id)
    log_file = log_path(settings, job_id)
    tail = ""
    if log_file.exists():
        lines = log_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        tail = "\n".join(lines[-80:])
    payload["log_tail"] = tail
    return payload


def list_models(settings: Settings) -> list[dict]:
    models: list[dict] = []
    active = settings.active_model_path.resolve() if settings.active_model_path.exists() else None

    for best in settings.models_dir.glob("*/weights/best.pt"):
        models.append(_model_info(best, active, settings))
    for best in settings.models_dir.glob("*/best.pt"):
        if "active" in best.parts:
            continue
        models.append(_model_info(best, active, settings))
    if settings.active_model_path.exists():
        models.append(_model_info(settings.active_model_path, active, settings, model_id="active"))

    unique = {}
    for model in models:
        unique[model["path"]] = model
    return sorted(unique.values(), key=lambda item: item.get("modified_at") or 0, reverse=True)


def _model_info(path: Path, active: Path | None, settings: Settings, model_id: str | None = None) -> dict:
    stat = path.stat()
    resolved = path.resolve()
    return {
        "id": model_id or path.parent.parent.name if path.parent.name == "weights" else path.parent.name,
        "path": str(path),
        "is_active": bool(active and resolved == active),
        "size_mb": round(stat.st_size / 1024 / 1024, 2),
        "modified_at": stat.st_mtime,
    }


def activate_model(settings: Settings, model_path: str) -> dict:
    src = Path(model_path)
    if not src.exists() or src.suffix != ".pt":
        raise FileNotFoundError(model_path)
    settings.active_model_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, settings.active_model_path)
    return {
        "active_model_path": str(settings.active_model_path),
        "source_model_path": str(src),
    }
