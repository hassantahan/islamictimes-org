# Islamic Times Web App

Flask web app for prayer times, downloadable timetables, Qibla direction, and crescent visibility using the `islamic_times` Python package.

## Run locally

Use Python 3.11 or later.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

On Windows, activate the environment with `.venv\Scripts\Activate.ps1`. Open `http://localhost:5000`.

Until v3.2.0 is published, install the v3.2.0 wheel for your platform or the source archive from the library worktree before running `pip install -r requirements.txt`. A source installation needs a C compiler. The Render Docker deployment resolves the library from PyPI.

## Prayer Calendar and privacy

- Choose a city, coordinates, or device location. Device location requires a browser permission prompt and a secure context.
- Jaʿfarī (Leva Institute) is the default prayer calculation method. Choose Custom angles to override the Fajr, Maghrib, or Isha angles. Blank fields use the Jaʿfarī angle. A mosque profile holds its name, calculation method, optional custom angles, Asr convention, and signed minute offsets for the five daily prayers. A timetable can cover up to 366 days.
- iCalendar includes the five daily prayer events. CSV also includes solar markers, a calculated Hijri date, local offsets, and estimated-time indicators.
- The daily timetable updates when its date, location, or calculation settings change. The Jaʿfarī and Tehran presets show available Ẓuhr and ʿAṣr faḍīlah estimates beside the prayer times. Use the asterisks to see sources and earlier recommended limits.
- **Remember settings** is off by default. When enabled, browser storage holds appearance, clock format, the selected city, prayer settings, and profiles. Exact coordinates are used only for the current visit. Users can turn saving off or clear saved data from Settings.
- The daily schedule starts with a clearly labeled Toronto example. The **Map** disclosure contacts OpenStreetMap with an approximate location only when opened. OpenStreetMap links and the public Crescent Visibility images use external services.
- City selection uses a local list. Other locations can be entered as coordinates or set with device location.

## Application structure

- `app.py` starts Flask. `webapp/routes/` defines the endpoints and `webapp/services/` connects them to the calculations and maps.
- `templates/` holds the server-rendered pages. `static/` holds the shared styles and page scripts.

### API endpoints

- `GET /healthz`
- `POST /prayer_times`
- `POST /calendar/schedule`
- `POST /calendar/export/ics`
- `POST /calendar/export/csv`
- `GET /upcoming_hijri?date=YYYY-MM-DD`
- `POST /vis_calc`
- `GET /maps_index`

The calendar endpoints read the same JSON object. Required keys are `lat`, `lon`, `start`, and `end`. Optional keys include `method`, `asr_type` (0 for standard, 1 for Hanafi), and `profile` with `name` and `offset_minutes`. With `method: "CUSTOM"`, an optional `angles` object accepts `fajr_angle`, `maghrib_angle`, and `isha_angle` in degrees below the horizon. The preview returns JSON and the downloads return attachments. `POST /generate_map` is retired because the site uses precomputed maps.

### Tests

```bash
python -m unittest discover -s tests -p 'test_*.py'
```

### Deployment

The existing Render deployment uses `render.yaml` and `Dockerfile`.

- `MAPS_BASE` defaults to `https://islamictimes-maps.onrender.com`
- `MAPS_INDEX_CACHE_TTL` defaults to 3600 seconds
- `ENABLE_DEBUG_ROUTES=1` enables `GET /__debug/gunicorn_args`
