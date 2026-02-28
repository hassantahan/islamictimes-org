from __future__ import annotations

from flask import Flask

from webapp.routes.maps import maps_bp
from webapp.routes.pages import pages_bp
from webapp.routes.prayer import prayer_bp
from webapp.routes.visibilities import vis_bp


def register_routes(app: Flask) -> None:
    app.register_blueprint(pages_bp)
    app.register_blueprint(prayer_bp)
    app.register_blueprint(vis_bp)
    app.register_blueprint(maps_bp)
