import time
import unittest

import pytest

from core.resilience import CircuitBreaker, CircuitBreakerOpen


class CircuitBreakerTests(unittest.TestCase):
    def setUp(self):
        # Each test gets its own breaker name so shared class-level state
        # from other tests can't leak in.
        self._name = f"test-{self.id()}"

    def test_stays_closed_below_failure_threshold(self):
        breaker = CircuitBreaker(self._name, failure_threshold=3, reset_timeout_seconds=10)
        for _ in range(2):
            with self.assertRaises(ValueError):
                breaker.call_sync(lambda: (_ for _ in ()).throw(ValueError("boom")))
        self.assertFalse(breaker.is_open)

    def test_opens_after_failure_threshold_and_fails_fast(self):
        breaker = CircuitBreaker(self._name, failure_threshold=3, reset_timeout_seconds=10)
        for _ in range(3):
            with self.assertRaises(ValueError):
                breaker.call_sync(lambda: (_ for _ in ()).throw(ValueError("boom")))
        self.assertTrue(breaker.is_open)
        with self.assertRaises(CircuitBreakerOpen):
            breaker.call_sync(lambda: "should never run")

    def test_half_opens_after_cooldown_and_closes_on_success(self):
        breaker = CircuitBreaker(self._name, failure_threshold=2, reset_timeout_seconds=0.05)
        for _ in range(2):
            with self.assertRaises(ValueError):
                breaker.call_sync(lambda: (_ for _ in ()).throw(ValueError("boom")))
        self.assertTrue(breaker.is_open)
        time.sleep(0.06)
        self.assertFalse(breaker.is_open)
        result = breaker.call_sync(lambda: "recovered")
        self.assertEqual(result, "recovered")
        self.assertFalse(breaker.is_open)

    def test_success_resets_failure_count(self):
        breaker = CircuitBreaker(self._name, failure_threshold=3, reset_timeout_seconds=10)
        with self.assertRaises(ValueError):
            breaker.call_sync(lambda: (_ for _ in ()).throw(ValueError("boom")))
        breaker.call_sync(lambda: "ok")
        for _ in range(2):
            with self.assertRaises(ValueError):
                breaker.call_sync(lambda: (_ for _ in ()).throw(ValueError("boom")))
        # Only 2 consecutive failures since the reset - threshold of 3 not
        # yet hit, so the circuit should still be closed.
        self.assertFalse(breaker.is_open)


@pytest.mark.asyncio
async def test_circuit_breaker_call_async_opens_after_threshold():
    breaker = CircuitBreaker("test-async-open", failure_threshold=2, reset_timeout_seconds=10)

    async def failing():
        raise ValueError("boom")

    for _ in range(2):
        with pytest.raises(ValueError):
            await breaker.call_async(failing)
    assert breaker.is_open

    async def should_never_run():
        return "unreachable"

    with pytest.raises(CircuitBreakerOpen):
        await breaker.call_async(should_never_run)


@pytest.mark.asyncio
async def test_circuit_breaker_call_async_success_path():
    breaker = CircuitBreaker("test-async-success", failure_threshold=3, reset_timeout_seconds=10)

    async def ok():
        return "ok"

    result = await breaker.call_async(ok)
    assert result == "ok"
    assert not breaker.is_open


if __name__ == "__main__":
    unittest.main()
