from __future__ import annotations

from flask import Blueprint, current_app, jsonify

from webapp.errors import ApiError
from webapp.services import get_maps_index

maps_bp = Blueprint("maps", __name__)


@maps_bp.get("/maps_index")
def maps_index():
    data = get_maps_index(
        current_app.config["MAPS_INDEX_URL"],
        int(current_app.config["MAPS_INDEX_CACHE_TTL"]),
    )
    return jsonify(data)


@maps_bp.post("/generate_map")
def generate_map_disabled():
    raise ApiError(
        "Local map generation is disabled. Use precomputed maps from maps service.",
        status_code=410,
        code="gone",
    )
