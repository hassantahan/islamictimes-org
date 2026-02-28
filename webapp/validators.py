from __future__ import annotations

from datetime import datetime

from webapp.errors import ApiError


def require_json_object(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ApiError("Request body must be a JSON object.")
    return payload


def parse_float(payload: dict, key: str, *, minimum: float | None = None, maximum: float | None = None) -> float:
    if key not in payload:
        raise ApiError(f"Missing required field '{key}'.")

    value = payload.get(key)
    try:
        num = float(value)
    except (TypeError, ValueError):
        raise ApiError(f"Field '{key}' must be a number.") from None

    if minimum is not None and num < minimum:
        raise ApiError(f"Field '{key}' must be >= {minimum}.")
    if maximum is not None and num > maximum:
        raise ApiError(f"Field '{key}' must be <= {maximum}.")
    return num


def parse_int(payload: dict, key: str, *, minimum: int | None = None, maximum: int | None = None) -> int:
    if key not in payload:
        raise ApiError(f"Missing required field '{key}'.")

    value = payload.get(key)
    try:
        num = int(value)
    except (TypeError, ValueError):
        raise ApiError(f"Field '{key}' must be an integer.") from None

    if minimum is not None and num < minimum:
        raise ApiError(f"Field '{key}' must be >= {minimum}.")
    if maximum is not None and num > maximum:
        raise ApiError(f"Field '{key}' must be <= {maximum}.")
    return num


def parse_iso_date(date_str: str, *, field_name: str = "date") -> datetime:
    # UI sends YYYY-MM-DD; this keeps API behavior strict and predictable.
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError as exc:
        raise ApiError(
            f"Field '{field_name}' must be in YYYY-MM-DD format.",
            details={"field": field_name, "value": date_str},
        ) from exc
