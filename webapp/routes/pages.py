from __future__ import annotations

import os
import sys

from flask import Blueprint, current_app, jsonify, render_template
from islamic_times.prayer_times import prayer_method_catalog

from webapp.config import DEFAULT_PRAYER_METHOD

pages_bp = Blueprint("pages", __name__)

PRAYER_PRESET_LABELS = {
    "Shia": {
        "JAFARI": "Jaʿfarī (Leva Institute)",
        "TEHRAN": "University of Tehran",
    },
    "Sunni": {
        "EGYPT": "Egyptian General Authority",
        "FCNA_CANADA": "Fiqh Council of North America (Canada)",
        "SINGAPORE": "Islamic Religious Council of Singapore (MUIS)",
        "ISNA": "Islamic Society of North America (ISNA)",
        "KUWAIT": "Kuwait (Adhan)",
        "MWL": "Muslim World League",
        "FRANCE": "Musulmans de France",
        "QATAR": "Qatar (Adhan)",
        "RUSSIA": "Spiritual Administration of Muslims of Russia",
        "MAKKAH": "Umm al-Qura (Makkah)",
        "KARACHI": "University of Islamic Sciences (Karachi)",
    },
}


@pages_bp.context_processor
def prayer_presets():
    methods = {method.keys[0]: method for method in prayer_method_catalog()}
    return {
        "prayer_presets": [
            (
                tradition,
                [
                    (key, label, methods[key])
                    for key, label in sorted(
                        labels.items(), key=lambda item: (item[0] != DEFAULT_PRAYER_METHOD, item[1].casefold()),
                    )
                    if key in methods
                ],
            )
            for tradition, labels in PRAYER_PRESET_LABELS.items()
        ],
    }


@pages_bp.get("/")
def index():
    return render_template("index.html")


@pages_bp.get("/methodology")
def methodology():
    return render_template("methodology.html", default_method=DEFAULT_PRAYER_METHOD)


@pages_bp.get("/visibilities")
def visibilities_page():
    return render_template("visibilities.html", maps_base=current_app.config["MAPS_BASE"])


@pages_bp.get("/healthz")
def healthz():
    return jsonify({"status": "ok"})


@pages_bp.get("/__debug/gunicorn_args")
def debug_gunicorn_args():
    if not current_app.config.get("ENABLE_DEBUG_ROUTES", False):
        return jsonify({"error": {"code": "not_found", "message": "Not Found", "details": {}}}), 404

    return jsonify(
        {
            "GUNICORN_CMD_ARGS": os.environ.get("GUNICORN_CMD_ARGS"),
            "sys_argv": sys.argv,
        }
    )
