# Legacy app package bridge to the central top-level settings module.
from core.config import Settings, get_settings, settings

__all__ = ["Settings", "get_settings", "settings"]
