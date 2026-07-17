"""Compatibility entrypoint for deployments importing ``app.main``.

The canonical FastAPI application lives in the repository root ``main.py``.
Keeping this wrapper prevents legacy imports from serving a reduced router set.
"""

from main import app, create_app

__all__ = ["app", "create_app"]
