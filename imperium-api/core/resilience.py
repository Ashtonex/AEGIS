"""In-process circuit breaker for outbound calls this app makes to external
services (Supabase Auth, OpenAI, third-party tender sites) - a struggling
dependency should fail fast and get a chance to recover, not have every
request hang until its own timeout fires or cascade into a full outage for
this app too.

Retry-with-backoff is deliberately NOT reimplemented here: `tenacity` is
already a project dependency and already used this way in
app/services/tender_scraper.py (`@retry(stop=stop_after_attempt(3),
wait=wait_exponential(...))`) - new call sites should use that directly for
consistency rather than a second, parallel retry mechanism. This module only
adds the one capability the app didn't have yet: a circuit breaker.

Per-worker-process state, not distributed - acceptable for this
deployment's scale, and fails safe (worst case: a few extra attempts across
processes before they all open).
"""

import time
from dataclasses import dataclass
from typing import Awaitable, Callable, TypeVar

T = TypeVar("T")


class CircuitBreakerOpen(Exception):
    """Raised instead of attempting a call when the circuit is open."""


@dataclass
class _CircuitState:
    failure_count: int = 0
    opened_at: float | None = None


class CircuitBreaker:
    """Per-name circuit breaker shared across all instances constructed with
    the same name, so unrelated call sites can each own a `CircuitBreaker`
    object without needing to pass a shared registry around."""

    _states: dict[str, _CircuitState] = {}

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        reset_timeout_seconds: float = 30.0,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.reset_timeout_seconds = reset_timeout_seconds

    def _state(self) -> _CircuitState:
        return self._states.setdefault(self.name, _CircuitState())

    @property
    def is_open(self) -> bool:
        state = self._state()
        if state.opened_at is None:
            return False
        # Half-open after the cooldown: let one probe through. It only
        # actually closes the circuit on record_success(); a failed probe
        # re-opens it via record_failure() below.
        return (time.monotonic() - state.opened_at) < self.reset_timeout_seconds

    def record_success(self) -> None:
        state = self._state()
        state.failure_count = 0
        state.opened_at = None

    def record_failure(self) -> None:
        state = self._state()
        state.failure_count += 1
        if state.failure_count >= self.failure_threshold:
            state.opened_at = time.monotonic()

    def call_sync(self, func: Callable[[], T]) -> T:
        if self.is_open:
            raise CircuitBreakerOpen(
                f"Circuit '{self.name}' is open - failing fast instead of "
                f"calling a struggling dependency."
            )
        try:
            result = func()
        except Exception:
            self.record_failure()
            raise
        else:
            self.record_success()
            return result

    async def call_async(self, func: Callable[[], Awaitable[T]]) -> T:
        if self.is_open:
            raise CircuitBreakerOpen(
                f"Circuit '{self.name}' is open - failing fast instead of "
                f"calling a struggling dependency."
            )
        try:
            result = await func()
        except Exception:
            self.record_failure()
            raise
        else:
            self.record_success()
            return result
