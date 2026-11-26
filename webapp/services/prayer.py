from __future__ import annotations

import math
import warnings
from datetime import datetime, time
from zoneinfo import ZoneInfo

from islamic_times.islamic_times import ITLocation
from islamic_times.it_dataclasses import DistanceUnits, Prayer, PrayerTimes
from timezonefinder import TimezoneFinder

from webapp.config import DEFAULT_PRAYER_METHOD
from webapp.errors import ApiError
from webapp.services.hijri import HIJRI_MONTH_NAMES
from webapp.validators import parse_float, parse_iso_date, parse_prayer_angles

_tf = TimezoneFinder()


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


_UNAVAILABLE_DETAILS = {
    "fajr": "The Sun does not reach the dawn angle.",
    "sunrise": "No usable sunrise on this date.",
    "zuhr": "Local solar noon could not be calculated.",
    "asr": "No usable local shadow timing.",
    "sunset": "No usable sunset on this date.",
    "maghrib": "No usable sunset or evening twilight crossing.",
    "isha": "No usable evening twilight crossing or Maghrib time.",
    "midnight": "Needs sunset and the next dawn or sunrise.",
}


def _estimated_detail(key: str, prayer: Prayer, times: PrayerTimes) -> str:
    method = prayer.method
    if key == "midnight":
        return "Midpoint of sunset and the next dawn or sunrise."
    if key == "isha" and method.isha_offset_minutes is not None:
        # Use the applied interval, which may differ during Ramaḍān.
        minutes = round((prayer.when.timestamp() - times.maghrib.when.timestamp()) / 60)
        return f"{minutes} min after estimated Maghrib."
    offset_maghrib = method.maghrib_offset_minutes is not None or method.isha_offset_minutes is not None
    if key == "maghrib" and offset_maghrib and method.maghrib_angle.decimal == 0 and times.sunset.fallback_rule:
        minutes = round((prayer.when.timestamp() - times.sunset.when.timestamp()) / 60)
        if minutes == 0:
            return "Uses the estimated sunset."
        if minutes > 0:
            return f"{minutes} min after estimated sunset."
    if key in {"asr", "sunrise", "sunset"} or prayer.fallback_rule == "NEARESTLAT":
        return "Calculated at a reference latitude."
    if key != "fajr" and (times.sunrise.fallback_rule or times.sunset.fallback_rule):
        # Polar dates can use either reference twilight itself or a portion of the reference night.
        return "Uses Sun times at a reference latitude."
    side = "before sunrise" if key == "fajr" else "after sunset"
    if prayer.fallback_rule == "ANGLEBASED":
        angle = getattr(method, key + "_angle").decimal
        detail = f"{angle:g}/60 of the night"
    else:
        detail = {"MIDDLENIGHT": "Half the night", "ONESEVENTH": "One-seventh of the night"}[prayer.fallback_rule]
    return f"{detail} {side}."


def _prayer_caution(key: str, prayer: Prayer, times: PrayerTimes) -> dict[str, str] | None:
    if prayer.status == "unavailable":
        detail = _UNAVAILABLE_DETAILS[key]
        if key == "isha" and prayer.method.use_isha_fadilah:
            detail = "No usable local window for preferred ʿIshāʾ."
        return {"kind": "unavailable", "detail": detail}
    if prayer.fallback_rule:
        return {"kind": "estimated", "detail": _estimated_detail(key, prayer, times)}
    return None


def _optional_binary_int(value, field_name: str, default: int | None = 0) -> int | None:
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
        local_date = parse_iso_date(str(date_str), field_name="date").date()
    else:
        local_date = datetime.now(tz).date()
    # Match the observer-local noon used by the library's date-range schedule.
    base_dt = datetime.combine(local_date, time(12), tz)

    loc = ITLocation(latitude=lat, longitude=lon, date=base_dt, method=DEFAULT_PRAYER_METHOD)

    method_payload = payload.get("method", {})
    if method_payload is None:
        method_payload = {}
    if not isinstance(method_payload, dict):
        raise ApiError("Field 'method' must be an object.")
    if not method_payload:
        return loc

    method_name = str(method_payload.get("name", "")).upper().strip()
    asr_type = _optional_binary_int(method_payload.get("asr_type"), "method.asr_type", default=None)
    # Unconfigured requests use the default preset as-is. Explicit methods
    # that omit midnight_type keep the legacy sunset-to-sunrise convention.
    midnight_raw = method_payload.get("midnight_type")
    midnight_type = None
    if midnight_raw != "preset":
        midnight_type = _optional_binary_int(midnight_raw, "method.midnight_type")

    try:
        if method_name and method_name not in ("CUSTOM",):
            asr_override = {} if asr_type is None else {"asr_type": asr_type}
            loc.set_prayer_method(method_name, **asr_override)
        else:
            angles = parse_prayer_angles(method_payload)
            if angles:
                loc.set_custom_prayer_angles(**angles)

            if asr_type is not None:
                loc.set_asr_type(asr_type)
        # User override should apply regardless of preset/custom method path.
        if midnight_type is not None:
            loc.set_midnight_type(midnight_type)
        if "western_redness_model" in method_payload:
            loc.set_western_redness_model(method_payload["western_redness_model"])
        if method_payload.get("fajr_fadilah_end_degrees") is not None:
            loc.set_fajr_fadilah_end_angle(method_payload["fajr_fadilah_end_degrees"])
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
        prayer = getattr(times, key)
        out[key] = _format_prayer(prayer)
        caution = _prayer_caution(key, prayer, times)
        if caution:
            out[key]["caution"] = caution

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
        "use_isha_fadilah": method.use_isha_fadilah,
        "western_redness_model": method.western_redness_model,
        "fajr_fadilah_end_degrees": method.fajr_fadilah_end_degrees,
        "midnight_type": getattr(method, "midnight_type", 0),
        "fajr_angle": {"decimal": _angle_decimal(getattr(method, "fajr_angle", None))},
        "maghrib_angle": {"decimal": _angle_decimal(getattr(method, "maghrib_angle", None))},
        "isha_angle": {"decimal": _angle_decimal(getattr(method, "isha_angle", None))},
    }

    date_info = loc.observer_dateinfo
    out["date"] = date_info.date.date().isoformat()
    out["timezone"] = getattr(date_info.date.tzinfo, "key", "UTC")
    hijri = loc.dates_times().hijri
    h_month = int(hijri.hijri_month)
    out["hijri"] = {
        "year": int(hijri.hijri_year),
        "month": h_month,
        "day": int(hijri.hijri_day),
        "month_name": HIJRI_MONTH_NAMES[h_month - 1],
    }
    out["qibla"] = _build_qibla_data(loc)
    if method.keys[0] in ("JAFARI", "TEHRAN"):
        windows = loc.sistani_daylight_fadilah() | loc.sistani_evening_fadilah()
        if times.fajr.fadilah is not None:
            windows["fajr"] = times.fajr.fadilah
        out["fadilah"] = {
            key: window.to_dict(timespec="seconds") for key, window in windows.items()
        }

    out["warnings"] = []
    for item in caught:
        message = str(item.message)
        if "Extreme latitude warning" in message:
            out["warnings"].append(message)

    return out
