from __future__ import annotations

import os


class Config:
    MAPS_BASE = os.getenv("MAPS_BASE", "https://islamictimes-maps.onrender.com")
    MAPS_INDEX_CACHE_TTL = int(os.getenv("MAPS_INDEX_CACHE_TTL", "3600"))
    MAPS_INDEX_URL = f"{MAPS_BASE}/maps_index.json"

    ENABLE_DEBUG_ROUTES = os.getenv("ENABLE_DEBUG_ROUTES", "0") == "1"
    ENABLE_LOCAL_MAP_GENERATION = os.getenv("ENABLE_LOCAL_MAP_GENERATION", "0") == "1"
