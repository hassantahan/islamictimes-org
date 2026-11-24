from __future__ import annotations

import json

from flask import Blueprint, Response, jsonify, request
from islamic_times.prayer_calendar import prayer_schedule_to_csv, prayer_schedule_to_ics

from webapp.errors import ApiError
from webapp.services.calendar import build_schedule, serialize_day
from webapp.validators import require_json_object

calendar_bp = Blueprint("calendar", __name__)


def _schedule_request() -> dict:
    max_bytes = 8192
    if not request.is_json:
        raise ApiError("Send calendar settings as JSON.")
    if request.content_length is not None and request.content_length > max_bytes:
        raise ApiError("Calendar request is too large.", status_code=413)
    body = request.stream.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise ApiError("Calendar request is too large.", status_code=413)
    try:
        return require_json_object(json.loads(body))
    except (ValueError, RecursionError):
        raise ApiError("Send a valid JSON object.") from None


@calendar_bp.post("/calendar/schedule")
def preview():
    days, zone, name, method = build_schedule(_schedule_request())
    response = jsonify(
        timezone=zone,
        profile=name,
        method=method,
        days=[serialize_day(day) for day in days],
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@calendar_bp.post("/calendar/export/<fmt>")
def export(fmt: str):
    if fmt not in {"ics", "csv"}:
        raise ApiError("Choose an iCalendar or CSV download.", status_code=404)
    days, _, name, _ = build_schedule(_schedule_request())
    if fmt == "ics":
        content = prayer_schedule_to_ics(days, calendar_name=name)
        content_type = "text/calendar"
    else:
        content = prayer_schedule_to_csv(days)
        content_type = "text/csv"
    filename = f"prayer-calendar-{days[0].date}-{days[-1].date}.{fmt}"
    return Response(
        content,
        content_type=f"{content_type}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )
