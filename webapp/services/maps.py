from __future__ import annotations

import threading
import time
from typing import Any

import requests

from webapp.errors import ApiError

_cache_lock = threading.Lock()
_maps_index_cache: dict[str, Any] = {
    "data": None,
    "fetched_at": 0.0,
}


def get_maps_index(index_url: str, ttl_seconds: int) -> list[dict]:
    now = time.time()

    with _cache_lock:
        cached_data = _maps_index_cache["data"]
        fetched_at = _maps_index_cache["fetched_at"]

    if cached_data is not None and (now - fetched_at) < ttl_seconds:
        return cached_data

    try:
        response = requests.get(index_url, timeout=5)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, list):
            raise ApiError("Invalid map index format.", status_code=502, code="upstream_error")
    except requests.RequestException as exc:
        if cached_data is not None:
            return cached_data
        raise ApiError(
            "Map index is temporarily unavailable.",
            status_code=503,
            code="maps_unavailable",
        ) from exc
    except ValueError as exc:
        raise ApiError(
            "Map index returned invalid JSON.",
            status_code=502,
            code="upstream_error",
        ) from exc

    with _cache_lock:
        _maps_index_cache["data"] = data
        _maps_index_cache["fetched_at"] = now

    return data
