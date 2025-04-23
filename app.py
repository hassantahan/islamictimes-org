from flask import Flask, render_template, request, jsonify, abort
from islamic_times.islamic_times import ITLocation
from timezonefinder import TimezoneFinder
from datetime import datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo
import requests
import math

OSM_NOMINATIM = "https://nominatim.openstreetmap.org/search"
IPINFO        = "https://ipapi.co/json/"

app = Flask(__name__)
# app.config['SEND_FILE_MAX_AGE_DEFAULT'] = timedelta(days=1)
tf = TimezoneFinder()

# ---------------------------------------------------------------------------#
# Helpers                                                                    #
# ---------------------------------------------------------------------------#

@lru_cache(maxsize=128)
def geocode(q: str) -> tuple[float, float]:
    """Lat/lon from OpenStreetMap Nominatim."""
    r = requests.get(OSM_NOMINATIM,
                     params={"q": q, "format": "json", "limit": 1},
                     timeout=6)
    r.raise_for_status()
    data = r.json()
    if not data:
        abort(400, "Address not found.")
    return float(data[0]["lat"]), float(data[0]["lon"])


def ip_location() -> tuple[float, float]:
    """Fast but coarse – fallback only."""
    try:
        d = requests.get(IPINFO, timeout=3).json()
        return float(d["latitude"]), float(d["longitude"])
    except Exception:
        return 0.0, 0.0


def _iso(dt):
    """Serialize datetime preserving its local timezone offset."""
    return dt.isoformat()

@lru_cache(maxsize=256)
def lookup_tz(lat: float, lon: float) -> ZoneInfo:
    """Cache lat/lon → IANA tz lookup."""
    name = tf.timezone_at(lat=lat, lng=lon)
    return ZoneInfo(name or "UTC")

def _format_prayer(prayer):
    """Turn a Prayer dataclass into our JSON dict, handling inf‑times."""
    t = prayer.time
    if isinstance(t, (int, float)) and math.isinf(t):
        tstr = "Does not exist"
    elif isinstance(t, datetime):
        tstr = _iso(t)
    else:
        tstr = str(t)
    return {"name": prayer.name, "time": tstr}


# ---------------------------------------------------------------------------#
# Core ITLocation builder                                                    #
# ---------------------------------------------------------------------------#

def build_itlocation(payload: dict) -> ITLocation:
    """Create and configure an ITLocation instance from request JSON."""
    lat = float(payload["lat"])
    lon = float(payload["lon"])

    date_str = payload.get("date")
    tz = lookup_tz(lat, lon)

    date_str = payload.get("date")
    if date_str:
        base_dt = datetime.fromisoformat(date_str)
        base_dt = base_dt.replace(tzinfo=tz)
    else:
        base_dt = datetime.now(tz)

    loc = ITLocation(
        latitude       = lat,
        longitude      = lon,
        date           = base_dt,
    )

    # ── advanced / method settings ──
    m = payload.get("method", {})
    name = m.get("name", "").upper()

    # predefined method selected?
    if name and name not in ("", "CUSTOM"):
        loc.set_prayer_method(name,
                              asr_type=int(m.get("asr_type", 0)))
    else:
        # fully custom angles or tweaks
        if {"fajr_angle", "maghrib_angle", "isha_angle"} & m.keys():
            loc.set_custom_prayer_angles(
                fajr_angle    = m.get("fajr_angle"),
                maghrib_angle = m.get("maghrib_angle"),
                isha_angle    = m.get("isha_angle")
            )
        if "asr_type" in m:
            loc.set_asr_type(int(m["asr_type"]))
        if "midnight_type" in m:
            loc.set_midnight_type(int(m["midnight_type"]))

    return loc


# ---------------------------------------------------------------------------#
# Routes                                                                     #
# ---------------------------------------------------------------------------#

@app.get("/")
def index():
    return render_template("index.html")


@app.post("/prayer_times")
def prayer_times():
    payload = request.get_json(silent=True) or {}
    if "lat" not in payload or "lon" not in payload:
        abort(400, "JSON must include lat & lon.")

    loc = build_itlocation(payload)
    times = loc.prayer_times()  # returns PrayerTimes dataclass

    # build out each prayer, catching inf→message
    out = {}
    for key in ("fajr","sunrise","zuhr","asr","sunset","maghrib","isha","midnight"):
        out[key] = _format_prayer(getattr(times, key))

    # method metadata
    m = times.method
    out["method"] = {
        "name":           m.name,
        "asr_type":       getattr(m, "asr_type", 0),
        "midnight_type":  getattr(m, "midnight_type", 0),
        "fajr_angle":     {"decimal": getattr(m, "fajr_angle", None)},
        "maghrib_angle":  {"decimal": getattr(m, "maghrib_angle", None)},
        "isha_angle":     {"decimal": getattr(m, "isha_angle", None)},
    }

    return jsonify(out)


# ---------------------------------------------------------------------------#

if __name__ == "__main__":
    app.run(debug=False)
