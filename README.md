# Islamic Times Web App

Flask web app for prayer times and crescent visibility using the `islamic_times` Python package.

## Current Architecture

- `app.py`: thin entrypoint (`app = create_app()`).
- `webapp/`: application package.
- `webapp/routes/`: HTTP route modules (pages, prayer, maps, visibility).
- `webapp/services/`: domain and integration logic.
- `templates/`: server-rendered pages (`base.html`, `index.html`, `visibilities.html`).
- `static/js/`: page scripts and shared UI utilities.

## Features

- Prayer-time calculation with method customization.
- Hijri date display on prayer response.
- Precomputed crescent visibility map browsing.
- Visibility calculation for user-selected coordinates.
- Unified JSON API error responses.

## Requirements

- Python `>=3.10`
- `pip`

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run Locally

```bash
python app.py
```

Then open `http://localhost:5000`.

## API Endpoints

- `GET /healthz`
- `POST /prayer_times`
- `GET /upcoming_hijri?date=YYYY-MM-DD`
- `POST /vis_calc`
- `GET /maps_index`

Notes:
- `POST /generate_map` is intentionally disabled (`410 Gone`), because this project now consumes precomputed maps from the external maps service.
- `GET /__debug/gunicorn_args` is disabled unless `ENABLE_DEBUG_ROUTES=1`.

## Tests

```bash
python -m unittest discover -s tests -p 'test_*.py'
```

## Deployment

The current Render deploy path is Docker-based (`render.yaml` + `Dockerfile`).

## Configuration

Optional environment variables:

- `MAPS_BASE` (default: `https://islamictimes-maps.onrender.com`)
- `MAPS_INDEX_CACHE_TTL` (default: `3600` seconds)
- `ENABLE_DEBUG_ROUTES` (`0` or `1`)
- `ENABLE_LOCAL_MAP_GENERATION` (`0` or `1`, currently unused)
