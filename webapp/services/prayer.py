from __future__ import annotations

import math
import warnings
from datetime import datetime
from functools import lru_cache
from zoneinfo import ZoneInfo

from islamic_times.islamic_times import ITLocation
from islamic_times.it_dataclasses import DistanceUnits
from timezonefinder import TimezoneFinder

from webapp.errors import ApiError
from webapp.services.hijri import HIJRI_MONTH_NAMES
from webapp.validators import parse_float, parse_iso_date

_tf = TimezoneFinder()


@lru_cache(maxsize=256)
def lookup_tz(lat: float, lon: float) -> ZoneInfo:
    tz_name = _tf.timezone_at(lat=lat, lng=lon)
    return ZoneInfo(tz_name or "UTC")


def _format_prayer(prayer) -> dict[str, str]:
    t = prayer.time
    if isinstance(t, (int, float)) and math.isinf(t):
        tstr = "Does not exist"
    elif isinstance(t, datetime):
        tstr = t.isoformat()
    else:
        tstr = str(t)
    return {"name": prayer.name, "time": tstr}


def _optional_angle(value, field_name: str) -> float | None:
    if value is None or value == "":
        return None
    try:
        angle = float(value)
    except (TypeError, ValueError):
        raise ApiError(f"Field '{field_name}' must be a number.") from None

    if angle < 0 or angle > 90:
        raise ApiError(f"Field '{field_name}' must be between 0 and 90.")
    return angle


def _optional_binary_int(value, field_name: str, default: int = 0) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ApiError(f"Field '{field_name}' must be 0 or 1.") from None
    if parsed not in (0, 1):
        raise ApiError(f"Field '{field_name}' must be 0 or 1.")
    return parsed


def _build_qibla_data(loc: ITLocation) -> dict[str, float | str]:
    mecca = loc.mecca()
    angle = float(mecca.angle.decimal) % 360
    distance_km = float(mecca.distance.in_unit(DistanceUnits.KILOMETRE))
    distance_mi = float(mecca.distance.in_unit(DistanceUnits.MILE))
    return {
        "angle_decimal": round(angle, 1),
        "cardinal": str(mecca.cardinal),
        "distance_km": round(distance_km, 1),
        "distance_mi": round(distance_mi, 1),
    }


def _angle_decimal(value) -> float | None:
    # `islamic_times` may return Angle-like objects, numbers, or nested payloads.
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return float(value)

    nested = getattr(value, "decimal", None)
    if nested is not None:
        return _angle_decimal(nested)

    if isinstance(value, dict):
        return _angle_decimal(value.get("decimal"))

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _build_itlocation(payload: dict) -> ITLocation:
    lat = parse_float(payload, "lat", minimum=-90, maximum=90)
    lon = parse_float(payload, "lon", minimum=-180, maximum=180)
    tz = lookup_tz(lat, lon)

    date_str = payload.get("date")
    if date_str:
        local_date = parse_iso_date(str(date_str), field_name="date")
        base_dt = local_date.replace(tzinfo=tz)
    else:
        base_dt = datetime.now(tz)

    loc = ITLocation(latitude=lat, longitude=lon, date=base_dt)

    method_payload = payload.get("method", {})
    if method_payload is None:
        method_payload = {}
    if not isinstance(method_payload, dict):
        raise ApiError("Field 'method' must be an object.")

    method_name = str(method_payload.get("name", "")).upper().strip()
    asr_type = _optional_binary_int(method_payload.get("asr_type"), "method.asr_type", default=0)
    midnight_type = _optional_binary_int(method_payload.get("midnight_type"), "method.midnight_type", default=0)

    try:
        if method_name and method_name not in ("CUSTOM",):
            loc.set_prayer_method(method_name, asr_type=asr_type)
        else:
            fajr_angle = _optional_angle(method_payload.get("fajr_angle"), "method.fajr_angle")
            maghrib_angle = _optional_angle(method_payload.get("maghrib_angle"), "method.maghrib_angle")
            isha_angle = _optional_angle(method_payload.get("isha_angle"), "method.isha_angle")

            if any(v is not None for v in (fajr_angle, maghrib_angle, isha_angle)):
                loc.set_custom_prayer_angles(
                    fajr_angle=fajr_angle,
                    maghrib_angle=maghrib_angle,
                    isha_angle=isha_angle,
                )

            loc.set_asr_type(asr_type)
        # User override should apply regardless of preset/custom method path.
        loc.set_midnight_type(midnight_type)
    except (TypeError, ValueError) as exc:
        raise ApiError(str(exc), details={"field": "method"}) from exc

    return loc


def build_prayer_times_response(payload: dict) -> dict:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", category=UserWarning)
        loc = _build_itlocation(payload)
        times = loc.prayer_times()

    out: dict = {}
    for key in ("fajr", "sunrise", "zuhr", "asr", "sunset", "maghrib", "isha", "midnight"):
        out[key] = _format_prayer(getattr(times, key))

    method = times.method
    requested_method_name = ""
    method_payload = payload.get("method", {})
    if isinstance(method_payload, dict):
        requested_method_name = str(method_payload.get("name", "")).upper().strip()

    response_method_name = str(method.name)
    # Midnight override can cause library metadata to identify as Custom.
    # Preserve user-selected preset label in API response for UI clarity.
    if requested_method_name and requested_method_name not in ("CUSTOM",) and response_method_name.upper() == "CUSTOM":
        response_method_name = requested_method_name

    out["method"] = {
        "name": response_method_name,
        "asr_type": getattr(method, "asr_type", 0),
        "midnight_type": getattr(method, "midnight_type", 0),
        "fajr_angle": {"decimal": _angle_decimal(getattr(method, "fajr_angle", None))},
        "maghrib_angle": {"decimal": _angle_decimal(getattr(method, "maghrib_angle", None))},
        "isha_angle": {"decimal": _angle_decimal(getattr(method, "isha_angle", None))},
    }

    hijri = loc.dates_times().hijri
    h_month = int(hijri.hijri_month)
    out["hijri"] = {
        "year": int(hijri.hijri_year),
        "month": h_month,
        "day": int(hijri.hijri_day),
        "month_name": HIJRI_MONTH_NAMES[h_month - 1],
    }
    out["qibla"] = _build_qibla_data(loc)

    out["warnings"] = []
    for item in caught:
        message = str(item.message)
        if "Extreme latitude warning" in message:
            out["warnings"].append(message)

    return out
