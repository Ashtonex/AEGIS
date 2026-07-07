import json
import logging
import aioredis
from typing import Any

class EventBus:
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.redis = None

    async def connect(self):
        self.redis = await aioredis.from_url(self.redis_url)

    async def disconnect(self):
        if self.redis:
            await self.redis.close()

    async def publish(self, stream_name: str, event_type: str, payload: dict[str, Any]):
        """Publish an event to a Redis Stream"""
        if not self.redis:
            await self.connect()
            
        data = {
            "type": event_type,
            "payload": json.dumps(payload)
        }
        await self.redis.xadd(stream_name, data)
        logging.info(f"Published event {event_type} to stream {stream_name}")

# Global instance to be initialized at app startup
event_bus = EventBus(redis_url="redis://localhost:6379")
