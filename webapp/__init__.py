from __future__ import annotations

import logging
import os
import sys

from flask import Flask

from webapp.config import Config
from webapp.errors import register_error_handlers
from webapp.routes import register_routes


def create_app() -> Flask:
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(Config)

    app.logger.setLevel(logging.INFO)
    app.logger.info("GUNICORN_CMD_ARGS=%s", os.getenv("GUNICORN_CMD_ARGS", ""))
    app.logger.info("sys.argv: %s", " ".join(sys.argv))

    register_routes(app)
    register_error_handlers(app)
    return app
