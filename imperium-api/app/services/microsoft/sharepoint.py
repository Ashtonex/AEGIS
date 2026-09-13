"""SharePoint operations via Microsoft Graph.

Every function here takes a `GraphClient` (app/services/microsoft/graph_client.py)
already bound to the right tenant, plus the site/drive identifiers - it never
looks anything up from settings or the database itself, so it stays testable
and reusable across organisations with different sites.

Stable-ID discipline (Phase 4): callers should persist site_id/drive_id/
item_id from these responses and address items by ID afterwards
(`/drives/{id}/items/{id}`), never by re-walking a `/root:/path` URL for
anything long-lived - SharePoint files and folders can be renamed or moved,
which breaks a path-based reference but not an ID-based one.
"""

from __future__ import annotations

from typing import Optional
from urllib.parse import quote

from app.services.microsoft.graph_client import GraphClient
from app.services.microsoft.types import GraphDrive, GraphDriveItem, GraphSite

# Direct PUT upload is only valid up to 4MB per Graph's documented limit;
# above that an upload session (resumable, chunked) is required.
SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024
UPLOAD_SESSION_CHUNK_SIZE = 5 * 1024 * 1024  # must be a multiple of 320 KiB; Graph recommends 5-10MB


async def search_sites(client: GraphClient, query: str) -> list[GraphSite]:
    """Search sites AEGIS's app registration can see. Used by the setup
    wizard's 'Discover SharePoint Site' step - the admin picks the right
    result rather than AEGIS guessing a hostname."""
    results = await client.get_all_pages("sites", params={"search": query})
    return [GraphSite(site_id=item["id"], name=item.get("displayName") or item.get("name", ""), web_url=item["webUrl"]) for item in results]


async def get_site_by_path(client: GraphClient, hostname: str, site_path: str) -> GraphSite:
    """Resolve a known hostname + server-relative path directly, e.g.
    hostname='flectere.sharepoint.com', site_path='/sites/SNC_Controlled_Data'.
    Faster and more precise than search_sites when the exact path is known."""
    item = await client.get(f"sites/{hostname}:{site_path}")
    return GraphSite(site_id=item["id"], name=item.get("displayName") or item.get("name", ""), web_url=item["webUrl"])


async def list_document_libraries(client: GraphClient, site_id: str) -> list[GraphDrive]:
    """Lists the document libraries (drives) on a site - e.g.
    '00_DIRECTORS', '01_FINANCE', ... if each is modelled as its own library,
    or a single 'Documents' drive if they are top-level folders within it."""
    results = await client.get_all_pages(f"sites/{site_id}/drives")
    return [GraphDrive(drive_id=item["id"], name=item["name"], web_url=item["webUrl"]) for item in results]


async def list_children(client: GraphClient, drive_id: str, item_id: str = "root") -> list[GraphDriveItem]:
    body = await client.get(f"drives/{drive_id}/items/{item_id}/children")
    return [_to_drive_item(entry) for entry in body.get("value", [])]


async def get_item(client: GraphClient, drive_id: str, item_id: str) -> GraphDriveItem:
    body = await client.get(f"drives/{drive_id}/items/{item_id}")
    return _to_drive_item(body)


def _to_drive_item(body: dict) -> GraphDriveItem:
    return GraphDriveItem(
        item_id=body["id"],
        name=body["name"],
        web_url=body["webUrl"],
        etag=body.get("eTag"),
        parent_item_id=(body.get("parentReference") or {}).get("id"),
        is_folder="folder" in body,
        size_bytes=body.get("size"),
        last_modified_at=body.get("lastModifiedDateTime"),
    )


async def ensure_folder(
    client: GraphClient, drive_id: str, parent_item_id: str, folder_name: str
) -> GraphDriveItem:
    """Idempotent folder creation (Phase 7's per-project subfolder tree, and
    Phase 6's module routing folders) - `conflictBehavior: rename` would
    create duplicates on retry, so this checks existing children by name
    first and only creates if genuinely missing."""
    existing = await list_children(client, drive_id, parent_item_id)
    for child in existing:
        if child.is_folder and child.name.strip().lower() == folder_name.strip().lower():
            return child

    body = await client.post(
        f"drives/{drive_id}/items/{parent_item_id}/children",
        json={"name": folder_name, "folder": {}, "@microsoft.graph.conflictBehavior": "fail"},
    )
    return _to_drive_item(body)


async def ensure_folder_path(
    client: GraphClient, drive_id: str, root_item_id: str, path_segments: list[str]
) -> GraphDriveItem:
    """Walks/creates a nested path one segment at a time, e.g. Phase 7's
    ["SNC-P004 - Troutbeck Access Road", "03 Budget"] under 03_PROJECTS."""
    current_item_id = root_item_id
    current: Optional[GraphDriveItem] = None
    for segment in path_segments:
        current = await ensure_folder(client, drive_id, current_item_id, segment)
        current_item_id = current.item_id
    if current is None:
        return await get_item(client, drive_id, root_item_id)
    return current


async def upload_small_file(
    client: GraphClient, drive_id: str, parent_item_id: str, file_name: str, content: bytes, content_type: str
) -> GraphDriveItem:
    if len(content) > SIMPLE_UPLOAD_MAX_BYTES:
        raise ValueError(f"upload_small_file only supports files <= {SIMPLE_UPLOAD_MAX_BYTES} bytes; use upload_large_file")
    encoded_name = quote(file_name)
    body = await client.put_content(
        f"drives/{drive_id}/items/{parent_item_id}:/{encoded_name}:/content",
        content=content,
        content_type=content_type,
    )
    return _to_drive_item(body)


async def upload_large_file(
    client: GraphClient, drive_id: str, parent_item_id: str, file_name: str, content: bytes, content_type: str
) -> GraphDriveItem:
    """Resumable upload session for files above the simple-PUT limit.
    Uploaded in sequential chunks per Graph's createUploadSession contract -
    each PUT must carry the exact Content-Range/Content-Length for its slice."""
    encoded_name = quote(file_name)
    session = await client.post(
        f"drives/{drive_id}/items/{parent_item_id}:/{encoded_name}:/createUploadSession",
        json={"item": {"@microsoft.graph.conflictBehavior": "rename"}},
    )
    upload_url = session["uploadUrl"]

    total_size = len(content)
    final_item: Optional[dict] = None
    offset = 0
    while offset < total_size:
        chunk = content[offset : offset + UPLOAD_SESSION_CHUNK_SIZE]
        chunk_end = offset + len(chunk) - 1
        response = await client.put_content(
            upload_url,
            content=chunk,
            content_type="application/octet-stream",
            extra_headers={
                "Content-Range": f"bytes {offset}-{chunk_end}/{total_size}",
                "Content-Length": str(len(chunk)),
            },
            # Per Microsoft's createUploadSession contract, the pre-authenticated
            # uploadUrl must NOT receive AEGIS's own bearer token.
            authenticate=False,
        )
        # The final chunk's response is the created driveItem; intermediate
        # chunks return {"expirationDateTime", "nextExpectedRanges"}.
        if "id" in response:
            final_item = response
        offset += len(chunk)

    if final_item is None:
        raise RuntimeError("Upload session completed without returning a final driveItem")
    return _to_drive_item(final_item)


async def get_download_url(client: GraphClient, drive_id: str, item_id: str) -> str:
    """Short-lived, pre-authenticated download URL (Graph's
    @microsoft.graph.downloadUrl) - safe to redirect a user's browser to
    after AEGIS has already verified their AEGIS-side permission, without
    AEGIS ever proxying the file bytes itself."""
    body = await client.get(f"drives/{drive_id}/items/{item_id}", params={"select": "@microsoft.graph.downloadUrl"})
    url = body.get("@microsoft.graph.downloadUrl")
    if not url:
        raise RuntimeError("Graph did not return a download URL for this item")
    return url


async def list_version_history(client: GraphClient, drive_id: str, item_id: str) -> list[dict]:
    """Raw Graph version entries (id, lastModifiedDateTime, lastModifiedBy) -
    Phase 10 deliberately does not reimplement SharePoint's own versioning,
    just surfaces it."""
    body = await client.get(f"drives/{drive_id}/items/{item_id}/versions")
    return body.get("value", [])
