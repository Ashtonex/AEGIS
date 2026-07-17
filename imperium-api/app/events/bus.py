import json
import logging
import os
from typing import Any

from redis import asyncio as redis_async


class EventBus:
    def __init__(self, redis_url: str | None = None):
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://redis:6379/0")
        self.redis: redis_async.Redis | None = None

    async def connect(self):
        self.redis = redis_async.from_url(self.redis_url, decode_responses=True)

    async def disconnect(self):
        if self.redis:
            await self.redis.aclose()
            self.redis = None

    async def publish(self, stream_name: str, event_type: str, payload: dict[str, Any]):
        """Publish an event to a Redis Stream."""
        if not self.redis:
            await self.connect()

        data = {
            "type": event_type,
            "payload": json.dumps(payload, default=str),
        }
        await self.redis.xadd(stream_name, data)
        logging.info("Published event %s to stream %s", event_type, stream_name)


# Global instance to be initialized at app startup.
event_bus = EventBus()
