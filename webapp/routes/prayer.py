from __future__ import annotations

from flask import Blueprint, jsonify, request

from webapp.services import build_prayer_times_response
from webapp.validators import require_json_object

prayer_bp = Blueprint("prayer", __name__)


@prayer_bp.post("/prayer_times")
def prayer_times():
    payload = require_json_object(request.get_json(silent=True) or {})
    return jsonify(build_prayer_times_response(payload))
