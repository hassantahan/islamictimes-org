# Islamic Times Web App

Flask web app for prayer times, Qibla direction, and crescent visibility using the `islamic_times` Python package.

## Run locally

Use Python 3.11 or later.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

On Windows, activate the environment with `.venv\Scripts\Activate.ps1`. Open `http://localhost:5000`.

To run against an unpublished library release, install a candidate wheel for
your platform or build from the source archive before installing the website
requirements. A source installation needs a C compiler.

## Prayer Times and privacy

- Choose a city, coordinates, or device location. Device location requires a browser permission prompt and a secure context.
- Jaʿfarī (Leva Institute) is the default prayer calculation method. Choose Custom angles to override the Fajr, Maghrib, or ʿIshāʾ angles. Blank fields use the Jaʿfarī angle.
- The daily timetable updates when its date, location, or calculation settings change. The date picker pairs each Gregorian date with its calculated civil Hijri date. The Hijri date can differ from local crescent-sighting announcements.
- The Jaʿfarī and Tehran presets show the preferred windows for ʿAṣr and ʿIshāʾ as their main entries when available. The timeline shows prayer periods and preferred windows. Open a range for timing details or visit **Methodology** for calculation rules and sources.
- **Remember settings** is off by default. When enabled, browser storage holds appearance, clock format, the selected city, and prayer settings. Custom and device coordinates are used only for the current visit. Users can turn saving off or clear saved data from Settings.
- The daily schedule defaults to Toronto. The map uses coordinates rounded to two decimal places. OpenStreetMap receives tile requests and the site's origin. The location picker offers a city, coordinates, or device location.
- City search runs in the browser using a bundled [GeoNames index](static/data/CITIES-LICENSE.md).

## Application structure

- `app.py` starts Flask. `webapp/routes/` defines the endpoints and `webapp/services/` connects them to the calculations and maps.
- `templates/` holds the server-rendered pages. `static/` holds the shared styles and page scripts.

### API endpoints

- `GET /healthz`
- `POST /prayer_times`
- `GET /hijri_month/<year>/<month>`
- `GET /upcoming_hijri?date=YYYY-MM-DD`
- `POST /vis_calc`
- `GET /maps_index`

`POST /generate_map` is retired because the site uses precomputed maps.
Prayer Calendar routes are disabled in the public app.

### Tests

```bash
python -m unittest discover -s tests -p 'test_*.py'
```

### Deployment

The Render deployment builds from `main` using `render.yaml` and `Dockerfile`
and installs the library from PyPI.
Verify that the required `islamic_times` release is available on PyPI before
merging a library dependency update into the deployment branch.

- `MAPS_BASE` defaults to `https://islamictimes-maps.onrender.com`
- `MAPS_INDEX_CACHE_TTL` defaults to 3600 seconds
- `ENABLE_DEBUG_ROUTES=1` enables `GET /__debug/gunicorn_args`
