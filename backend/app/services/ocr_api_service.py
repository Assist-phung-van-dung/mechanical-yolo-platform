from pathlib import Path
from typing import Any

import requests


OCR_FIELD_NAMES = [
    "id_drawing",
    "material",
    "quantity",
    "spare_part_name",
    "spare_part_number",
]


def normalize_ocr_response(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    if isinstance(payload.get("results"), dict):
        return payload["results"]

    if isinstance(payload.get("fields"), dict):
        return payload["fields"]

    return {
        key: value
        for key, value in payload.items()
        if key in OCR_FIELD_NAMES and isinstance(value, dict)
    }


def call_ocr_five_fields(
    endpoint: str,
    crop_paths: dict[str, Path],
    engine: str = "auto+qwen",
    timeout: int = 300,
) -> dict[str, Any]:
    files = {}
    opened = []
    sent_fields = []
    missing_fields = []

    try:
        for field in OCR_FIELD_NAMES:
            path = crop_paths.get(field)

            if path is None:
                missing_fields.append(field)
                continue

            path = Path(path)
            if not path.exists() or not path.is_file():
                missing_fields.append(field)
                continue

            f = open(path, "rb")
            opened.append(f)
            files[field] = (path.name, f, "image/png")
            sent_fields.append(field)

        if not files:
            return {
                "ok": False,
                "skipped": True,
                "warning": "OCR skipped because no crop files are available.",
                "errors": [f"missing_file:{name}" for name in missing_fields],
                "sent_fields": sent_fields,
                "missing_fields": missing_fields,
                "results": {},
                "raw": None,
            }

        response = requests.post(
            endpoint,
            data={"engine": engine},
            files=files,
            timeout=timeout,
        )

        text = response.text

        if response.status_code >= 400:
            return {
                "ok": False,
                "skipped": False,
                "warning": f"OCR API failed with HTTP {response.status_code}: {text[:1000]}",
                "status_code": response.status_code,
                "sent_fields": sent_fields,
                "missing_fields": missing_fields,
                "results": {},
                "raw": {"text": text},
            }

        try:
            payload = response.json()
        except Exception:
            return {
                "ok": False,
                "skipped": False,
                "warning": f"OCR API returned non-JSON response: {text[:1000]}",
                "status_code": response.status_code,
                "sent_fields": sent_fields,
                "missing_fields": missing_fields,
                "results": {},
                "raw": {"text": text},
            }

        return {
            "ok": bool(payload.get("ok", True)),
            "skipped": False,
            "warning": None,
            "status_code": response.status_code,
            "sent_fields": sent_fields,
            "missing_fields": missing_fields,
            "results": normalize_ocr_response(payload),
            "raw": payload,
        }

    except Exception as exc:
        return {
            "ok": False,
            "skipped": False,
            "warning": f"OCR API request failed: {exc}",
            "sent_fields": sent_fields,
            "missing_fields": missing_fields,
            "results": {},
            "raw": None,
        }

    finally:
        for f in opened:
            f.close()