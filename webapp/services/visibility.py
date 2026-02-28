from __future__ import annotations

from islamic_times.islamic_times import ITLocation
from islamic_times.it_dataclasses import Visibilities

from misc import hijri_to_gregorian
from webapp.errors import ApiError
from webapp.validators import parse_float, parse_int


def build_visibility_response(payload: dict) -> dict:
    lat = parse_float(payload, "lat", minimum=-90, maximum=90)
    lon = parse_float(payload, "lon", minimum=-180, maximum=180)
    hijri_month = parse_int(payload, "hijri_month", minimum=1, maximum=12)
    hijri_year = parse_int(payload, "hijri_year", minimum=1, maximum=3000)

    g_date = hijri_to_gregorian(hijri_year, hijri_month, 1)

    try:
        loc = ITLocation(
            latitude=lat,
            longitude=lon,
            elevation=0.0,
            temperature=15.0,
            pressure=101.325,
            date=g_date,
            find_local_tz=True,
        )
        vis: Visibilities = loc.visibilities()
    except (TypeError, ValueError) as exc:
        raise ApiError(str(exc), details={"field": "visibility"}) from exc

    entries = []
    for dt, q, classification in zip(vis.dates, vis.q_values, vis.classifications):
        parts = classification.split(": ", 1)
        if len(parts) == 2:
            category, description = parts
        else:
            category = "X"
            description = parts[0]

        entries.append(
            {
                "datetime": dt.strftime("%X %d-%m-%Y"),
                "q": f"{q:+.3f}",
                "category": category,
                "description": description,
            }
        )

    return {
        "criterion": vis.criterion,
        "entries": entries,
    }
