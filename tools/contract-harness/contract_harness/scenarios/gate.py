"""LLM 스텁 게이트를 **제어 표면 경유로만** 다룬다.

전에는 시나리오가 `ctx.backend.runtime` 에서 스텁 핸들을 꺼내 직접 불렀다. 그러면
in-process 백엔드에서만 돌고, Java 백엔드는 `runtime` 속성이 없어 게이트 시나리오가
`AttributeError` 로 죽는다 — 기능을 다 구현해도 "하네스 전량 통과"가 원리적으로
불가능했다(`spec/M4-llm.md` §G).

여기 있는 함수는 `stub-state` 제어 하나만 쓴다. 두 백엔드가 같은 코드를 밟으므로
추상화 자체가 매 실행마다 검증된다.

**폴링은 기록하지 않는다.** `ctx.control` 은 스텝을 시나리오 기록에 남기는데,
백엔드마다 폴링 횟수가 달라지면 그 스텝 수가 그대로 diff 가 된다. 그래서 폴링은
`ctx.backend.control`(비기록)로 하고, 기록이 필요하면 호출부가 확인이 끝난 뒤
`ctx.control` 을 한 번 부른다.
"""

from __future__ import annotations

import time

# 폴링 간격. 게이트가 열리는 것을 사람이 기다리는 구간이 아니라 스텁이 이미
# 멈춰 있는지 확인하는 구간이라, 짧게 잡아도 부하가 되지 않는다.
POLL_INTERVAL_SEC = 0.02


def stub_state(ctx, stub: str | None = None) -> dict:
    """게이트 상태를 읽는다(기록하지 않는다). `stub` 을 주면 그 스텁 것만."""
    state = ctx.backend.control("stub-state")
    return state[stub] if stub else state


def poll_until_blocked(ctx, stub: str, *, count: int = 1, timeout: float):
    """요청 `count` 개가 **동시에** 스텁 안에 멈출 때까지 폴링한다.

    `(성공 여부, 마지막으로 본 상태)` 를 돌려준다. 동시성 시나리오는 두 요청이
    read→save 구간에 함께 갇혀 있어야 실제 경합이 된다 — 시작점 barrier 만으로는
    직렬화돼도 통과한다. 그래서 `in_block_count` 를 보지 `in_block` 을 보지 않는다.
    """
    deadline = time.monotonic() + timeout
    state = stub_state(ctx, stub)
    while state["in_block_count"] < count:
        if time.monotonic() >= deadline:
            return False, state
        time.sleep(POLL_INTERVAL_SEC)
        state = stub_state(ctx, stub)
    return True, state


def release(ctx, stub: str | None = None) -> dict:
    """멈춰 있는 요청을 푼다(기록하지 않는다)."""
    return ctx.backend.control("stub-state", release=True, **_target(stub))


def rearm(ctx, stub: str | None = None) -> dict:
    """게이트를 다시 닫는다(기록하지 않는다)."""
    return ctx.backend.control("stub-state", rearm=True, **_target(stub))


def _target(stub: str | None) -> dict:
    return {"stub": stub} if stub else {}
