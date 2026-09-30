"""Builds the AEGIS Microsoft Teams app package (aegis-teams-app.zip).

    python deploy/teams-app/build_package.py

The package is manifest.json + two icons, which Teams requires at exact
sizes: color.png 192x192 (full colour) and outline.png 32x32 (white on
transparent). Both are cut from the SNC hexagon in aegis-web/public/logo.png.

Upload the zip once: Teams admin centre -> Teams apps -> Manage apps ->
Upload new app (or, for one person, Teams -> Apps -> Manage your apps ->
Upload an app). Bump "version" in manifest.json before re-uploading a change.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
LOGO = HERE.parents[1] / "aegis-web" / "public" / "logo.png"
# The hexagon mark within logo.png (438x292), without the wordmark below it.
HEX_BOX = (108, 0, 330, 236)


def _hexagon() -> Image.Image:
    return Image.open(LOGO).convert("RGBA").crop(HEX_BOX)


def build_color(path: Path) -> None:
    mark = _hexagon()
    mark.thumbnail((168, 168), Image.LANCZOS)
    canvas = Image.new("RGBA", (192, 192), (255, 255, 255, 255))
    canvas.alpha_composite(mark, ((192 - mark.width) // 2, (192 - mark.height) // 2))
    canvas.convert("RGB").save(path)


def build_outline(path: Path) -> None:
    mark = _hexagon()
    # Keep the coloured strokes (the hexagon and swoosh), drop the white fill
    # and background: Teams renders the outline icon white-on-transparent.
    pixels = []
    for r, g, b, a in mark.get_flattened_data():
        is_ink = a > 64 and min(r, g, b) < 200
        pixels.append((255, 255, 255, 255) if is_ink else (255, 255, 255, 0))
    silhouette = Image.new("RGBA", mark.size)
    silhouette.putdata(pixels)
    silhouette.thumbnail((30, 30), Image.LANCZOS)
    canvas = Image.new("RGBA", (32, 32), (255, 255, 255, 0))
    canvas.alpha_composite(silhouette, ((32 - silhouette.width) // 2, (32 - silhouette.height) // 2))
    canvas.save(path)


def main() -> Path:
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    build_color(HERE / "color.png")
    build_outline(HERE / "outline.png")
    out = HERE / "aegis-teams-app.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        zf.write(HERE / "color.png", "color.png")
        zf.write(HERE / "outline.png", "outline.png")
    return out


if __name__ == "__main__":
    print(f"Built {main()}")
