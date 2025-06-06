from flask import Flask, render_template, request, jsonify, abort
from islamic_times.islamic_times import ITLocation
from islamic_times.it_dataclasses import Visibilities
from islamic_times.time_equations import gregorian_to_hijri
from timezonefinder import TimezoneFinder
from datetime import datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo
from misc import hijri_to_gregorian
import requests, math, sys, time, os, logging
import subprocess, shutil, pathlib, tempfile, re

OSM_NOMINATIM = "https://nominatim.openstreetmap.org/search"
IPINFO        = "https://ipapi.co/json/"

app = Flask(__name__)
app.logger.setLevel(logging.INFO)
app.logger.info("GUNICORN_CMD_ARGS=" + os.getenv("GUNICORN_CMD_ARGS", ""))
app.logger.info("sys.argv: " + " ".join(sys.argv))

tf = TimezoneFinder()

# Mapper
MAPS_BASE      = "https://islamictimes-maps.onrender.com"
MAPS_INDEX_URL = f"{MAPS_BASE}/maps_index.json"

MAP_OUT_DIR = pathlib.Path("static/maps")      # served by Flask’s static route
MAP_OUT_DIR.mkdir(parents=True, exist_ok=True)
CACHE_TTL = 24 * 3600          # seconds (≈ 1 day)
_MAP_CACHE: dict[str, tuple[str, float]] = {}     # key → (filename, timestamp)

# Visibilities Regex
VIS_LINE_RE = re.compile(
    r"^\s*"                                          # leading whitespace
    r"(\d{2}:\d{2}:\d{2}\s+\d{2}-\d{2}-\d{4}):"      # (1) date/time
    r"\s*([+-]?\d+\.\d+)"                            # (2) Q value (any decimals)
    r"(?:\s+([A-Z]):)?"                              # (3) optional category letter + colon
    r"\s*(.+)$"                                      # (4) description
)

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
    """Fast but coarse - fallback only."""
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

@app.get("/upcoming_hijri")
def upcoming_hijri():
    # client passes its local YYYY‑MM‑DD as ?date=…
    gdate = request.args.get("date")
    if not gdate:
        abort(400, "Missing date.")
    y, m, d = map(int, gdate.split("-"))
    h_year, h_month, h_day = gregorian_to_hijri(y, m, d)
    # bump to next month, handle year rollover
    h_month += 1
    if h_month > 12:
        h_month = 1
        h_year += 1
    return jsonify({"month": h_month, "year": h_year})

# ---------------------------------------------------------------------------#
# Core Map Generator                                                         #
# ---------------------------------------------------------------------------#

# NOT USED
@app.post("/generate_map")
def generate_map():
    """
    Kick off mapper.py with the POSTed JSON payload and return
    the image URL when it finishes.  Long-running -- front-end shows spinner.
    """
    p = request.get_json(silent=True) or {}
    try:
        hijri_month      = int(p["month"])        # 1‑12
        hijri_year       = int(p["year"])         # 1‑2000 (per your UI text)
        days             = int(p["days"])         # 1‑3    (dropdown)
        criterion        = int(p["criterion"])    # 0 = Odeh, 1 = Yallop
        resolution       = int(p["resolution"])   # 1‑500
    except (KeyError, ValueError):
        abort(400, "Bad parameters.")

    if resolution < 50 or resolution > 500 or resolution % 50 != 0:
        abort(400, "Resolution must be a multiple of 50 between 50 and 500.")

    # --------  caching key ----------------------------------------
    cache_key = f"{hijri_year}:{hijri_month}:{days}:{criterion}:{resolution}"
    now = time.time()
    # purge expired
    _MAP_CACHE.update({
        k: v for k, v in _MAP_CACHE.items() if now - v[1] < CACHE_TTL
    })
    if cache_key in _MAP_CACHE:
        fname, _ = _MAP_CACHE[cache_key]
        return jsonify({"url": f"/static/maps/{fname}"})

    # --------  convert Hijri → Gregorian (first day of that month) ----
    starting_iso = datetime.replace(hijri_to_gregorian(hijri_year, hijri_month, 1), tzinfo=ZoneInfo("UTC")).isoformat()

    out_name = f"{hijri_year}-{hijri_month:02d}-{days}-{criterion}-{resolution}.jpg"
    out_path = MAP_OUT_DIR / out_name

    project_root = pathlib.Path(__file__).resolve().parent
    mapper_script = project_root / "scripts" / "mapper.py"

    # mapper.py CLI call – execute in temp dir so concurrent runs don’t clash
    with tempfile.TemporaryDirectory() as tmp:
        cmd = [
            sys.executable, str(mapper_script),
            "--today", starting_iso,
            "--master_path", f"{tmp}/",  # mapper writes here
            "--total_months", "1",
            "--map_region", "WORLD",
            "--map_mode",   "category",
            "--resolution", str(resolution),
            "--days_to_generate", str(days),
            "--criterion", str(criterion),
            "--save_logs"
        ]
        proc = subprocess.run(cmd, cwd=str(project_root),
                                        capture_output=True, text=True)

        if proc.returncode != 0:
            app.logger.error(proc.stderr)
            abort(500, "Map generation error.")

        jpgs = list(pathlib.Path(tmp).rglob("*.jpg"))
        if not jpgs:
            abort(500, "No map produced.")
            
        MAP_OUT_DIR.mkdir(parents=True, exist_ok=True)
        src = pathlib.Path(jpgs[0])

        try:
            # If an old file with that exact name exists, atomically replace it
            os.replace(src, out_path)        # works even if out_path already exists
        except Exception as e:
            app.logger.exception(f"Failed to move generated map into static: {e}")
            abort(500, "Server error saving map.")


    _MAP_CACHE[cache_key] = (out_name, now)
    return jsonify({"url": f"/static/maps/{out_name}"})

@app.get("/maps_index")
def maps_index():
    if not hasattr(app, "_index_cache") or time.time() - app._index_cache[1] > 3600:
        import requests
        data = requests.get(MAPS_INDEX_URL, timeout=5).json()
        app._index_cache = (data, time.time())
    return jsonify(app._index_cache[0])

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

@app.post("/vis_calc")
def vis_calc():
    payload = request.get_json(silent=True) or {}
    try:
        lat = float(payload["lat"])
        lon = float(payload["lon"])
        hijri_month = int(payload["hijri_month"])
        hijri_year  = int(payload["hijri_year"])
    except (KeyError, ValueError):
        abort(400, "Need lat & lon in JSON.")

    g_date = hijri_to_gregorian(hijri_year, hijri_month, 1)

    # Build ITLocation (using Yallop, 3-day default)
    loc = ITLocation(
        latitude  = lat,
        longitude = lon,
        elevation = 0.0,
        temperature = 15.0,
        pressure = 101.325,
        date = g_date,
        find_local_tz=True
    )
    vis: Visibilities = loc.visibilities()

    # Build JSON directly from the dataclass attributes
    entries = []
    for dt, q, cls in zip(vis.dates, vis.q_values, vis.classifications):
        parts = cls.split(": ", 1)
        if len(parts) == 2:
            cat, desc = parts
        else:
            # No colon (e.g. "-998.0 Moonset before sunset.")
            cat = "X"
            desc = parts[0]
        entries.append({
            "datetime":    dt.strftime("%X %d-%m-%Y"),
            "q":           f"{q:+.3f}",
            "category":    cat,
            "description": desc
        })

    return jsonify({
        "criterion": vis.criterion,
        "entries":   entries
    })

# ---------------------------------------------------------------------------#
# Routes                                                                     #
# ---------------------------------------------------------------------------#

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/visibilities")
def visibilities_page():
    """Serve the new schematic page."""
    return render_template("visibilities.html")

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


@app.get("/__debug/gunicorn_args")
def _debug_gunicorn_args():
    return jsonify({
        "GUNICORN_CMD_ARGS": os.environ.get("GUNICORN_CMD_ARGS"),
        "sys_argv": sys.argv
    })


# ---------------------------------------------------------------------------#

if __name__ == "__main__":
    app.run(debug=False)
