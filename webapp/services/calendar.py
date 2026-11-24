"""Build a website timetable using the same schedule for preview and export."""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, time

from islamic_times.islamic_times import ITLocation
from islamic_times.it_dataclasses import PRAYER_KEYS, PrayerDay
from islamic_times.prayer_profiles import MosqueProfile
from islamic_times.prayer_times import get_prayer_method

from webapp.errors import ApiError
from webapp.services.hijri import HIJRI_MONTH_NAMES
from webapp.services.prayer import lookup_tz
from webapp.validators import parse_float, require_json_object

MAX_SCHEDULE_DAYS = 366
MAX_PRAYER_OFFSET = 180
FIRST_DATE = date(1900, 1, 1)
LAST_DATE = date(2100, 12, 31)


def _calendar_date(payload: dict, field: str) -> date:
    raw = payload.get(field)
    try:
        value = date.fromisoformat(raw)
    except (TypeError, ValueError):
        raise ApiError(f"{field.capitalize()} date must be in YYYY-MM-DD format.") from None
    if raw != value.isoformat() or not FIRST_DATE <= value <= LAST_DATE:
        raise ApiError(f"{field.capitalize()} date must be between 1900 and 2100 in YYYY-MM-DD format.")
    return value


def _profile(payload: dict) -> MosqueProfile:
    method_name = payload.get("method", "ISNA")
    if not isinstance(method_name, str) or len(method_name) > 40:
        raise ApiError("Choose a prayer calculation method.")
    asr_type = payload.get("asr_type", 0)
    if type(asr_type) is not int or asr_type not in (0, 1):
        raise ApiError("Choose standard or Hanafi Asr.")
    try:
        method = replace(get_prayer_method(method_name), asr_type=asr_type)
    except ValueError:
        raise ApiError("Choose a supported prayer calculation method.") from None

    profile = require_json_object(payload.get("profile", {}))
    name = profile.get("name", "Islamic Times")
    if not isinstance(name, str) or not name.strip() or len(name) > 60 or not name.isprintable():
        raise ApiError("Enter a profile name of 1 to 60 printable characters.")
    offsets = require_json_object(profile.get("offset_minutes", {}))
    for key, amount in offsets.items():
        if key not in PRAYER_KEYS:
            raise ApiError("Offsets are available for the five daily prayers.")
        if type(amount) is not int or not -MAX_PRAYER_OFFSET <= amount <= MAX_PRAYER_OFFSET:
            raise ApiError(f"Each offset must be a whole number between -{MAX_PRAYER_OFFSET} and {MAX_PRAYER_OFFSET}.")
    return MosqueProfile(name.strip(), method, offsets)


def build_schedule(payload: dict) -> tuple[tuple[PrayerDay, ...], str, str, str]:
    lat = parse_float(payload, "lat", minimum=-90, maximum=90)
    lon = parse_float(payload, "lon", minimum=-180, maximum=180)
    start, end = (_calendar_date(payload, field) for field in ("start", "end"))
    if end < start or (end - start).days >= MAX_SCHEDULE_DAYS:
        raise ApiError(f"Choose an inclusive date range of up to {MAX_SCHEDULE_DAYS} days.")
    profile = _profile(payload)
    zone = lookup_tz(lat, lon)
    loc = ITLocation(latitude=lat, longitude=lon, date=datetime.combine(start, time(12), zone), auto_calculate=False)
    try:
        days = loc.prayer_schedule(start, end, time_zone=zone, profile=profile)
    except ValueError as exc:
        raise ApiError(str(exc), details={"field": "date_range"}) from exc
    return days, zone.key, profile.name, str(profile.method.name)


def serialize_day(day: PrayerDay) -> dict:
    prayers = {}
    for key in PRAYER_KEYS:
        prayer = getattr(day.prayers, key)
        when = prayer.when
        prayers[key] = {
            "time": when.isoformat(timespec="seconds") if when is not None else None,
            "status": prayer.status,
            "day_offset": (when.date() - day.date).days if when is not None else 0,
        }
    hijri = day.hijri
    return {
        "date": day.date.isoformat(),
        "hijri": f"{hijri.hijri_day} {HIJRI_MONTH_NAMES[hijri.hijri_month - 1]} {hijri.hijri_year}",
        "prayers": prayers,
    }
