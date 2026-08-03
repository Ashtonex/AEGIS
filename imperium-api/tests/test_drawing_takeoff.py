"""
Tests for the drawing takeoff system: DXF geometry extraction against known
synthetic geometry (exact-value assertions, not just "doesn't crash"), the
AI-vision not-configured graceful path, and the commit checklist contract.
"""

import asyncio
import os
import tempfile
import types
import unittest
import unittest.mock

import ezdxf
import httpx
import openai

from app.services.drawings import extraction as extraction_module
from app.services.drawings.extraction import extract_from_dxf, extract_from_image_ai_vision
from core.resilience import CircuitBreaker
from routers.drawings import DEFAULT_CHECKLIST_ITEMS


def _build_test_dxf_bytes() -> bytes:
    """A 10m x 5m rectangular room outline (closed polyline, perimeter 30m,
    area 50 m2), a 10m external wall line, and two DOOR block inserts -
    every extractable quantity has a hand-computable expected value."""
    doc = ezdxf.new("R2018")
    msp = doc.modelspace()

    doc.layers.add("ROOM-A")
    msp.add_lwpolyline([(0, 0), (10, 0), (10, 5), (0, 5)], close=True, dxfattribs={"layer": "ROOM-A"})

    doc.layers.add("WALL-EXTERNAL")
    msp.add_line((0, 0), (10, 0), dxfattribs={"layer": "WALL-EXTERNAL"})

    door_block = doc.blocks.new(name="DOOR")
    door_block.add_line((0, 0), (1, 0))
    msp.add_blockref("DOOR", (2, 2))
    msp.add_blockref("DOOR", (5, 5))

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        tmp_path = tmp.name
    doc.saveas(tmp_path)
    try:
        with open(tmp_path, "rb") as f:
            return f.read()
    finally:
        os.unlink(tmp_path)


class DxfExtractionTests(unittest.TestCase):
    def setUp(self):
        self.dxf_bytes = _build_test_dxf_bytes()

    def test_perimeter_length_matches_known_rectangle(self):
        result = extract_from_dxf(self.dxf_bytes)
        room_linework = next(m for m in result["measurements"] if "ROOM-A" in m["description"] and m["unit"] == "m")
        self.assertAlmostEqual(room_linework["quantity"], 30.0, places=2)

    def test_enclosed_area_matches_known_rectangle(self):
        result = extract_from_dxf(self.dxf_bytes)
        room_area = next(m for m in result["measurements"] if m["unit"] == "m2")
        self.assertAlmostEqual(room_area["quantity"], 50.0, places=2)

    def test_external_wall_line_length(self):
        result = extract_from_dxf(self.dxf_bytes)
        wall = next(m for m in result["measurements"] if "WALL-EXTERNAL" in m["description"])
        self.assertAlmostEqual(wall["quantity"], 10.0, places=2)

    def test_block_count(self):
        result = extract_from_dxf(self.dxf_bytes)
        doors = next(m for m in result["measurements"] if "DOOR" in m["description"])
        self.assertEqual(doors["quantity"], 2.0)
        self.assertEqual(doors["unit"], "each")

    def test_garbage_input_fails_gracefully_not_crash(self):
        result = extract_from_dxf(b"this is not a valid dxf file")
        self.assertEqual(result["measurements"], [])
        self.assertEqual(result["confidence_pct"], 0)
        self.assertIn("Could not parse", result["notes"])


class AiVisionNotConfiguredTests(unittest.TestCase):
    def test_missing_api_key_returns_not_configured_not_a_crash(self):
        os.environ.pop("OPENAI_API_KEY", None)
        result = asyncio.run(extract_from_image_ai_vision(b"fake", "image/png"))
        self.assertTrue(result["not_configured"])
        self.assertEqual(result["measurements"], [])


def _fake_openai_client(parse_side_effect):
    """A minimal stand-in for openai.AsyncOpenAI exposing only the
    .beta.chat.completions.parse(...) path extract_from_image_ai_vision
    actually calls."""

    async def parse(**kwargs):
        result = parse_side_effect.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    fake_completions = types.SimpleNamespace(parse=parse)
    fake_chat = types.SimpleNamespace(completions=fake_completions)
    fake_beta = types.SimpleNamespace(chat=fake_chat)
    return types.SimpleNamespace(beta=fake_beta)


def _fake_success_response():
    return types.SimpleNamespace(
        choices=[
            types.SimpleNamespace(
                message=types.SimpleNamespace(
                    parsed=types.SimpleNamespace(measurements=[], overall_confidence_pct=77, notes="ok")
                )
            )
        ]
    )


def _connection_error():
    return openai.APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/x"))


class AiVisionResilienceTests(unittest.TestCase):
    def setUp(self):
        os.environ["OPENAI_API_KEY"] = "test-key"
        extraction_module._openai_vision_breaker.record_success()

    def tearDown(self):
        extraction_module._openai_vision_breaker.record_success()

    def test_retries_transient_connection_errors_then_succeeds(self):
        side_effects = [_connection_error(), _connection_error(), _fake_success_response()]

        def fake_async_openai(api_key):
            return _fake_openai_client(side_effects)

        with unittest.mock.patch("openai.AsyncOpenAI", side_effect=fake_async_openai):
            result = asyncio.run(extract_from_image_ai_vision(b"fake", "image/png"))

        self.assertEqual(result["confidence_pct"], 77)
        self.assertEqual(side_effects, [])  # all 3 queued responses were consumed

    def test_circuit_breaker_opens_after_repeated_failures_and_fails_fast(self):
        breaker = extraction_module._openai_vision_breaker
        call_count = {"n": 0}

        def always_fails(api_key):
            call_count["n"] += 1
            return _fake_openai_client([_connection_error()] * 3)  # exhausts tenacity's 3 attempts

        # Drive the shared "openai_vision" breaker state open directly
        # (same name, low threshold) rather than looping real calls through
        # extract_from_image_ai_vision's full 3-attempt tenacity retry each
        # time - is_open only cares about opened_at/elapsed time, not which
        # instance's threshold tripped it, so this reaches the same state
        # without ~15s of real backoff sleep per test run.
        opener = CircuitBreaker(breaker.name, failure_threshold=1, reset_timeout_seconds=breaker.reset_timeout_seconds)
        with self.assertRaises(ValueError):
            opener.call_sync(lambda: (_ for _ in ()).throw(ValueError("boom")))
        self.assertTrue(breaker.is_open)

        with unittest.mock.patch("openai.AsyncOpenAI", side_effect=always_fails):
            result = asyncio.run(extract_from_image_ai_vision(b"fake", "image/png"))
            self.assertEqual(result["measurements"], [])
            self.assertIn("Circuit", result["notes"])
            # The breaker short-circuited - no attempt was made against the
            # (mocked) dependency at all.
            self.assertEqual(call_count["n"], 0)


class CommitChecklistContractTests(unittest.TestCase):
    def test_default_checklist_is_never_empty(self):
        """A revision with zero checklist items would trivially satisfy the
        commit gate's 'no unchecked items' condition - the seed list must
        never be empty, or the checklist requirement becomes meaningless."""
        self.assertGreater(len(DEFAULT_CHECKLIST_ITEMS), 0)


if __name__ == "__main__":
    unittest.main()
