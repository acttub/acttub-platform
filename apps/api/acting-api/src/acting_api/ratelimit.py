import time


class RateLimiter:
    """주체별 고정 윈도우(1분) 인메모리 카운터."""

    def __init__(self, *, clock=time.monotonic):
        self._clock = clock
        self._counts: dict[str, tuple[int, int]] = {}

    def allow(self, key: str, limit_per_min: int) -> bool:
        window = int(self._clock() // 60)
        prev_window, count = self._counts.get(key, (window, 0))
        if prev_window != window:
            count = 0
        count += 1
        self._counts[key] = (window, count)
        return count <= limit_per_min
