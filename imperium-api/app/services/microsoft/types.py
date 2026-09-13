"""Typed shapes for the Graph objects this integration actually touches.

Deliberately thin - just the fields the app reads back out of Graph
responses - rather than a full mirror of Microsoft's schema.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class GraphSite:
    site_id: str
    name: str
    web_url: str


@dataclass
class GraphDrive:
    drive_id: str
    name: str
    web_url: str


@dataclass
class GraphDriveItem:
    item_id: str
    name: str
    web_url: str
    etag: Optional[str] = None
    parent_item_id: Optional[str] = None
    is_folder: bool = False
    size_bytes: Optional[int] = None
    last_modified_at: Optional[str] = None


@dataclass
class GraphCalendar:
    calendar_id: str
    name: str
    owner_address: Optional[str] = None


@dataclass
class GraphEvent:
    event_id: str
    subject: str
    web_link: Optional[str] = None
    change_key: Optional[str] = None
    start_at: Optional[str] = None
    end_at: Optional[str] = None
