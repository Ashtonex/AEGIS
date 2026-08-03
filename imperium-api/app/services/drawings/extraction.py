"""
Drawing takeoff extraction: turns an uploaded drawing into draft BOQ-shaped
measurement rows, via one of three modes:

- cad_dxf: real vector geometry from a DXF file (ezdxf) - lengths by layer,
  enclosed areas by layer, block/insert counts. No AI, no external API,
  works today. Note: this handles DXF only, not native DWG (a proprietary
  binary format) - a DWG upload should fall back to manual_reference mode
  unless it's first converted to DXF.
- ai_vision: a vision-capable LLM proposes measurements from a scanned/
  photographed/PDF-exported drawing image. Gated behind OPENAI_API_KEY -
  returns extraction_status='not_configured' with an empty result if the
  key isn't set, rather than crashing or fabricating output.
- manual_reference: no extraction at all - the human enters everything
  while viewing the attached file. Always available.

Every measurement produced here is a *draft proposal*: the commit workflow
(routers/drawings.py) requires a human to review the row set and complete
the revision's checklist before it becomes the baseline BOQ.
"""

import base64
import logging
import os
import tempfile
from typing import Any, Dict, List, Optional

from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from core.resilience import CircuitBreaker, CircuitBreakerOpen

logger = logging.getLogger(__name__)

# Tracks the OpenAI vision endpoint specifically. If OpenAI is down, this
# lets subsequent extraction attempts fail fast for a cooldown period
# instead of every request waiting the full retry+45s-timeout duration just
# to land on the same "AI extraction failed" result.
_openai_vision_breaker = CircuitBreaker(
    "openai_vision", failure_threshold=5, reset_timeout_seconds=60.0
)


class ExtractedMeasurement:
    __slots__ = ("description", "unit", "quantity", "confidence_pct")

    def __init__(self, description: str, unit: str, quantity: float, confidence_pct: Optional[int] = None):
        self.description = description
        self.unit = unit
        self.quantity = round(float(quantity), 3)
        self.confidence_pct = confidence_pct

    def to_dict(self) -> Dict[str, Any]:
        return {
            "description": self.description,
            "unit": self.unit,
            "quantity": self.quantity,
            "confidence_pct": self.confidence_pct,
        }


def extract_from_dxf(file_bytes: bytes) -> Dict[str, Any]:
    """
    Computes real quantities from DXF vector geometry:
    - Total length (m) of LINE/LWPOLYLINE/POLYLINE entities, grouped by layer.
    - Enclosed area (m2) of CLOSED LWPOLYLINE/POLYLINE entities, grouped by layer.
    - Count of INSERT (block reference) entities, grouped by block name.

    Deliberately does not guess construction semantics beyond "sum by layer/
    block name" - the DXF's own layer and block naming is the source of
    truth for what a quantity represents, not an invented heuristic.
    """
    import ezdxf

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        doc = ezdxf.readfile(tmp_path)
    except Exception as e:
        logger.warning(f"DXF parse failed: {e}")
        return {
            "measurements": [],
            "confidence_pct": 0,
            "notes": f"Could not parse this file as DXF: {e}. Try manual reference entry instead.",
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    msp = doc.modelspace()
    length_by_layer: Dict[str, float] = {}
    area_by_layer: Dict[str, float] = {}
    count_by_block: Dict[str, int] = {}

    for entity in msp:
        dxftype = entity.dxftype()
        layer = entity.dxf.layer or "0"

        if dxftype == "LINE":
            start, end = entity.dxf.start, entity.dxf.end
            length = ((end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2) ** 0.5
            length_by_layer[layer] = length_by_layer.get(layer, 0.0) + length

        elif dxftype in ("LWPOLYLINE", "POLYLINE"):
            try:
                if dxftype == "LWPOLYLINE":
                    points = [tuple(p[:2]) for p in entity.get_points()]
                    is_closed = bool(entity.closed)
                else:
                    points = [tuple(v.dxf.location[:2]) for v in entity.vertices]
                    is_closed = bool(entity.is_closed)
            except Exception:
                continue
            if len(points) < 2:
                continue

            seg_length = sum(
                ((points[i + 1][0] - points[i][0]) ** 2 + (points[i + 1][1] - points[i][1]) ** 2) ** 0.5
                for i in range(len(points) - 1)
            )
            if is_closed and len(points) >= 3:
                seg_length += (
                    (points[0][0] - points[-1][0]) ** 2 + (points[0][1] - points[-1][1]) ** 2
                ) ** 0.5
                # Shoelace formula for enclosed area.
                area = 0.0
                n = len(points)
                for i in range(n):
                    x1, y1 = points[i]
                    x2, y2 = points[(i + 1) % n]
                    area += x1 * y2 - x2 * y1
                area_by_layer[layer] = area_by_layer.get(layer, 0.0) + abs(area) / 2.0
            length_by_layer[layer] = length_by_layer.get(layer, 0.0) + seg_length

        elif dxftype == "INSERT":
            block_name = entity.dxf.name or "UNKNOWN_BLOCK"
            count_by_block[block_name] = count_by_block.get(block_name, 0) + 1

    measurements: List[ExtractedMeasurement] = []
    for layer, total_length in length_by_layer.items():
        if total_length > 0:
            measurements.append(ExtractedMeasurement(
                description=f"Linework on layer '{layer}'", unit="m", quantity=total_length, confidence_pct=85,
            ))
    for layer, total_area in area_by_layer.items():
        if total_area > 0:
            measurements.append(ExtractedMeasurement(
                description=f"Enclosed area on layer '{layer}'", unit="m2", quantity=total_area, confidence_pct=80,
            ))
    for block_name, count in count_by_block.items():
        measurements.append(ExtractedMeasurement(
            description=f"Count of block '{block_name}'", unit="each", quantity=count, confidence_pct=90,
        ))

    if not measurements:
        return {
            "measurements": [],
            "confidence_pct": 0,
            "notes": "DXF parsed successfully but contained no LINE/POLYLINE/INSERT entities to derive quantities from.",
        }

    return {
        "measurements": [m.to_dict() for m in measurements],
        "confidence_pct": 82,
        "notes": (
            f"Derived from real DXF vector geometry ({len(length_by_layer)} layers with linework, "
            f"{len(area_by_layer)} closed areas, {len(count_by_block)} block types). "
            "Layer/block names are taken as-is from the drawing file - rename layers in your CAD "
            "software for clearer descriptions if needed. Review before committing."
        ),
    }


async def extract_from_image_ai_vision(file_bytes: bytes, mime_type: str) -> Dict[str, Any]:
    """
    Vision-assisted extraction for scanned/photographed/PDF-exported
    drawings. Gated behind OPENAI_API_KEY (same convention as
    app/services/tender_scraper.py) - returns a clear not-configured result
    instead of crashing or fabricating data when no key is set.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {
            "measurements": [],
            "confidence_pct": 0,
            "not_configured": True,
            "notes": "AI-assisted drawing reading is not configured yet (OPENAI_API_KEY is not set). Use CAD parsing or manual reference entry instead.",
        }

    import openai
    from pydantic import BaseModel, Field

    class VisionMeasurement(BaseModel):
        description: str
        unit: str
        quantity: float
        confidence_pct: int = Field(ge=0, le=100)

    class VisionExtractionResult(BaseModel):
        measurements: List[VisionMeasurement]
        overall_confidence_pct: int = Field(ge=0, le=100)
        notes: str = ""

    image_b64 = base64.b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{image_b64}"

    @retry(
        retry=retry_if_exception_type(
            (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)
        ),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        reraise=True,
    )
    async def _call_openai_vision():
        client = openai.AsyncOpenAI(api_key=api_key)
        return await client.beta.chat.completions.parse(
            model=os.getenv("DRAWING_VISION_MODEL", "gpt-4o"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a quantity surveyor's assistant reading a construction drawing. "
                        "Propose a draft bill of quantities from what is visibly measurable in the "
                        "image: room/wall areas, linear runs, door/window counts, and similar "
                        "quantifiable items. Only report what you can actually read or reasonably "
                        "infer from visible dimensions/labels - do not invent quantities you cannot "
                        "support from the image. Give an honest confidence_pct per item and an "
                        "honest overall_confidence_pct. This is always a DRAFT for human review, "
                        "never a final measurement."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Extract a draft bill of quantities from this drawing."},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            response_format=VisionExtractionResult,
            temperature=0.1,
            timeout=45.0,
        )

    try:
        response = await _openai_vision_breaker.call_async(_call_openai_vision)
        parsed = response.choices[0].message.parsed
        if parsed is None:
            return {
                "measurements": [], "confidence_pct": 0,
                "notes": "The vision model did not return a parseable result. Use manual reference entry instead.",
            }
        return {
            "measurements": [m.model_dump() for m in parsed.measurements],
            "confidence_pct": parsed.overall_confidence_pct,
            "notes": parsed.notes or "AI-extracted draft - review every row before committing.",
        }
    except Exception as e:
        logger.warning(f"AI vision drawing extraction failed: {e}")
        return {
            "measurements": [],
            "confidence_pct": 0,
            "notes": f"AI extraction failed ({e}). Use CAD parsing or manual reference entry instead.",
        }
