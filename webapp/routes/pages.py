from __future__ import annotations

import os
import sys

from flask import Blueprint, current_app, jsonify, render_template

pages_bp = Blueprint("pages", __name__)


@pages_bp.get("/")
def index():
    return render_template("index.html")


@pages_bp.get("/visibilities")
def visibilities_page():
    return render_template("visibilities.html")


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
