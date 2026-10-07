from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.truncation import capped, truncation_ctx


def test_capped_trims_and_records_cut_off():
    holder = {}
    token = truncation_ctx.set(holder)
    try:
        assert capped(range(501), 500) == list(range(500))
        assert holder == {"limit": 500}
    finally:
        truncation_ctx.reset(token)


def test_capped_leaves_short_lists_alone():
    holder = {}
    token = truncation_ctx.set(holder)
    try:
        assert capped([1, 2, 3], 500) == [1, 2, 3]
        assert holder == {}
    finally:
        truncation_ctx.reset(token)


def test_capped_without_request_context_still_trims():
    assert len(capped(range(10), 5)) == 5
