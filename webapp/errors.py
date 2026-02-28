from __future__ import annotations

from typing import Any

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException


class ApiError(Exception):
    """Application-level JSON API error."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str = "bad_request",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details or {}


def _error_response(message: str, code: str, status_code: int, details: dict[str, Any] | None = None):
    return (
        jsonify(
            {
                "error": {
                    "code": code,
                    "message": message,
                    "details": details or {},
                }
            }
        ),
        status_code,
    )


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def handle_api_error(err: ApiError):
        return _error_response(err.message, err.code, err.status_code, err.details)

    @app.errorhandler(HTTPException)
    def handle_http_error(err: HTTPException):
        return _error_response(err.description, "http_error", err.code or 500)

    @app.errorhandler(Exception)
    def handle_unexpected_error(err: Exception):
        app.logger.exception("Unhandled exception: %s", err)
        return _error_response(
            "An unexpected server error occurred.",
            "internal_error",
            500,
        )
