from __future__ import annotations

from flask import Blueprint, jsonify, request

from webapp.errors import ApiError
from webapp.services import build_visibility_response, upcoming_hijri_month
from webapp.validators import require_json_object

vis_bp = Blueprint("visibilities_api", __name__)


@vis_bp.get("/upcoming_hijri")
def upcoming_hijri():
    date_str = request.args.get("date", "")
    if not date_str:
        raise ApiError("Missing date query parameter.", details={"field": "date"})
    return jsonify(upcoming_hijri_month(date_str))


@vis_bp.post("/vis_calc")
def vis_calc():
    payload = require_json_object(request.get_json(silent=True) or {})
    return jsonify(build_visibility_response(payload))
