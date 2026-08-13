"""워커 실패 경로 · 재분석 멱등 전이 · 동시성.

응답만 비교하면 release 를 안 하거나 attempt 를 되감는 구현도 통과한다.
그래서 단계마다 `db-projection` 을 함께 비교한다(§DB projection).
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

from contract_harness import config as cfg
from contract_harness.scenarios import gate
from contract_harness.scenarios.support import (
    create_upload,
    grant_all_consents,
    login,
    require,
    session_body,
)
from contract_harness.stubs import STUB_BLOCK_MARKER

COMPLETE_MARKER = "[[coach:complete]]"

OPERATION_PROJECTION = ["external_operations", "practice_sessions"]


def _create_session(ctx, prefix: str, headers: dict, marker: str, tag: str) -> dict:
    intent_id = create_upload(ctx, prefix, headers)
    body = session_body(intent_id, situation=f"오디션 직전 {marker}")
    step = ctx.call(
        f"{prefix}.create",
        "post",
        "/v2/practice-sessions",
        json=body,
        headers={**headers, "X-Request-Id": ctx.request_id(tag)},
        expect_request_id=True,
    )
    require(step.status == 202, f"{prefix}: 세션 생성 실패 {step.status} {step.body!r}")
    session_id = step.parsed["session_id"]
    ctx.register(session_id, "practice_session")
    return {"session_id": session_id, "intent_id": intent_id, "body": body, "tag": tag}


def no_background_worker(ctx) -> None:
    """contract 프로파일에서는 자동 워커가 뜨지 않는다.

    기동 후 아무 조작도 하지 않고 기다렸을 때 operation 상태가 그대로여야 한다.
    자동 폴링이 살아 있으면 `run-worker-once` 와 같은 operation 을 두고 경합해
    비결정이 된다.
    """
    import time

    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "idle", headers)
    created = _create_session(ctx, "idle", headers, "", "idle")
    before = ctx.control("idle.projection-before", "db-projection", include=OPERATION_PROJECTION)
    stub_before = ctx.control("idle.stub-before", "stub-state")
    time.sleep(0.6)
    after = ctx.control("idle.projection-after", "db-projection", include=OPERATION_PROJECTION)
    stub_after = ctx.control("idle.stub-after", "stub-state")
    ctx.note(
        "idle.unchanged",
        {
            "projection_unchanged": before == after,
            "analyzer_calls_unchanged": stub_before["analyzer"]["calls"]
            == stub_after["analyzer"]["calls"],
            "status": before["external_operations"][0]["status"],
        },
    )
    ctx.control("idle.worker", "run-worker-once")
    ctx.call(
        "idle.status",
        "get",
        "/v2/practice-sessions/{session_id}/status",
        path_params={"session_id": created["session_id"]},
        headers=headers,
    )


def worker_failure(ctx) -> None:
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "worker", headers)

    # ① known failure 3종 → 즉시 failed
    for name, marker, expected in (
        ("timeout", "[[analyze:timeout]]", "gemini_timeout"),
        ("parse", "[[analyze:parse]]", "gemini_parse_error"),
        ("unsupported", "[[analyze:unsupported]]", "unsupported_media"),
    ):
        created = _create_session(ctx, f"known-{name}", headers, marker, f"known-{name}")
        session_id = created["session_id"]
        ctx.control(f"known-{name}.worker", "run-worker-once")
        ctx.control(
            f"known-{name}.projection", "db-projection", include=OPERATION_PROJECTION
        )
        status = ctx.call(
            f"known-{name}.status",
            "get",
            "/v2/practice-sessions/{session_id}/status",
            path_params={"session_id": session_id},
            headers=headers,
        )
        ctx.note(f"known-{name}.expected", {"expected_error_code": expected})
        require(
            status.parsed["error_code"] == expected,
            f"{name}: error_code 가 {expected} 가 아니다 ({status.parsed})",
        )

    # ② transient 3회 → release. attempt_count 는 되돌아가지 않는다.
    transient = _create_session(
        ctx, "transient", headers, "[[analyze:transient]]", "transient"
    )
    transient_id = transient["session_id"]
    for attempt in range(1, 4):
        ctx.control(f"transient.worker-{attempt}", "run-worker-once")
        ctx.control(
            f"transient.projection-{attempt}",
            "db-projection",
            include=OPERATION_PROJECTION,
        )
        # lease 가 살아 있으면 다음 claim 이 안 되므로 만료시킨다.
        ctx.control(f"transient.clock-{attempt}", "advance-clock", seconds=3600)

    # ③ sweep 이 max-attempts 소진분을 최종 실패로 넘긴다.
    ctx.control("sweep", "run-sweep")
    ctx.control("sweep.projection", "db-projection", include=OPERATION_PROJECTION)
    swept = ctx.call(
        "transient.status",
        "get",
        "/v2/practice-sessions/{session_id}/status",
        path_params={"session_id": transient_id},
        headers=headers,
    )
    ctx.note("sweep.expected", {"expected_error_code": "max_attempts_exceeded"})
    # status 를 먼저 본다 — 200 이 아니면 `parsed` 에 error_code 자체가 없어서
    # KeyError 로 죽고, 그러면 **왜 실패했는지가 응답째로 사라진다.**
    require(
        swept.status == 200,
        f"sweep 후 status 조회가 200 이 아니다: {swept.status} {swept.parsed}",
    )
    require(
        swept.parsed.get("error_code") == "max_attempts_exceeded",
        f"sweep 후 error_code 가 max_attempts_exceeded 가 아니다: {swept.parsed}",
    )

    # ④ lease 만료 후 재선점 — 만료된 lease 는 다음 tick 이 가져간다.
    ctx.control("idle.worker", "run-worker-once")
    ctx.control("idle.projection", "db-projection", include=OPERATION_PROJECTION)

    # ⑤ 소진된 재시도를 같은 X-Request-Id 로 다시 밀면 409 analysis_retry_exhausted
    ctx.call(
        "retry-exhausted",
        "post",
        "/v2/practice-sessions",
        json=transient["body"],
        headers={**headers, "X-Request-Id": ctx.request_id("transient")},
    )


def reanalyze(ctx) -> None:
    """`POST /v2/practice-sessions/{id}/analyze` 의 멱등 전이표.

    ⚠ 이 엔드포인트는 `tests/test_response_contracts.py` 에 **바이트 동등 단언이
    없다**(형상 검증만 남았다). 멱등 계약 자체는 유효하므로 L3 대상으로 유지하되,
    기존 테스트가 근거가 아니라는 점을 여기 기록해 둔다 — 근거는 소스
    (`practice_sessions.py:_idempotent_response` 가 저장된 payload 를 그대로
    돌려준다는 것)이다.
    """
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "retry", headers)
    session_id = _create_session(
        ctx, "retry", headers, "[[analyze:failonce]]", "retry-create"
    )["session_id"]
    ctx.control("retry.worker-fail", "run-worker-once")
    ctx.call(
        "detail-failed",
        "get",
        "/v2/practice-sessions/{session_id}",
        path_params={"session_id": session_id},
        headers=headers,
    )

    retry_request_id = ctx.request_id("retry")
    retry_headers = {**headers, "X-Request-Id": retry_request_id}
    accepted = ctx.call(
        "retry-accepted",
        "post",
        "/v2/practice-sessions/{session_id}/analyze",
        path_params={"session_id": session_id},
        headers=retry_headers,
        expect_request_id=True,
    )
    require(accepted.status == 202, f"재분석 202 가 아니다 {accepted.status} {accepted.body!r}")
    ctx.call(
        "retry-accepted-replay",
        "post",
        "/v2/practice-sessions/{session_id}/analyze",
        path_params={"session_id": session_id},
        headers=retry_headers,
        replay_of="retry-accepted",
        expect_request_id=True,
    )
    ctx.control("retry.worker-ok", "run-worker-once")
    ctx.control("retry.projection", "db-projection", include=OPERATION_PROJECTION)
    succeeded = ctx.call(
        "retry-succeeded",
        "post",
        "/v2/practice-sessions/{session_id}/analyze",
        path_params={"session_id": session_id},
        headers=retry_headers,
        expect_request_id=True,
    )
    require(succeeded.status == 200, f"재분석 succeeded replay 가 200 이 아니다 {succeeded.status}")
    ctx.register(succeeded.parsed["summary_id"], "summary")
    ctx.call(
        "retry-succeeded-replay",
        "post",
        "/v2/practice-sessions/{session_id}/analyze",
        path_params={"session_id": session_id},
        headers=retry_headers,
        replay_of="retry-succeeded",
        expect_request_id=True,
    )
    ctx.call(
        "retry-not-failed",
        "post",
        "/v2/practice-sessions/{session_id}/analyze",
        path_params={"session_id": session_id},
        headers={**headers, "X-Request-Id": ctx.request_id("retry-not-failed")},
    )


def _parallel(backend, calls):
    """barrier 로 정확히 같은 순간에 때린다.

    시작점만 맞출 뿐이라 **경합 구간에 함께 머무는 것은 보장하지 않는다.**
    read→save 구간을 실제로 겹치게 하려면 `_gated_parallel` 을 쓴다.
    """
    barrier = threading.Barrier(len(calls))

    def _run(call):
        barrier.wait(timeout=20)
        return call()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return [future.result(timeout=60) for future in [pool.submit(_run, call) for call in calls]]


def _gated_parallel(ctx, stub_name: str, calls, *, timeout: float = 20.0):
    """요청 전부를 LLM 스텁 안에 **함께 가둔 뒤** 동시에 풀어준다.

    `[[stub:block]]` 마커가 프롬프트에 있어야 한다. 전원이 갇힌 것을 확인하고
    나서 release 하므로 직렬화될 수 없다 — 이게 없으면 "둘 다 200" 이 나와도
    통과해 원자성 회귀를 놓친다.

    게이트 조작은 전부 `stub-state` 제어 경유다(`contract_harness.scenarios.gate`).
    스텁 핸들을 직접 잡으면 Java 백엔드에서 돌지 않는다.
    """
    gate.rearm(ctx, stub_name)
    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        futures = [pool.submit(call) for call in calls]
        gated, state = gate.poll_until_blocked(
            ctx, stub_name, count=len(calls), timeout=timeout
        )
        blocked_now = state["in_block_count"]
        # 못 가뒀어도 일단 풀어 준다 — 안 그러면 20초 타임아웃을 그대로 기다리고
        # 진단에 쓸 응답도 못 본다.
        gate.release(ctx, stub_name)
        responses = [future.result(timeout=timeout + 20) for future in futures]
    gate.rearm(ctx, stub_name)
    require(
        gated,
        f"{stub_name} 에 요청 {len(calls)}건이 동시에 갇히지 않았다 "
        f"(갇힌 수 {blocked_now}건, 응답 "
        f"{[(item.status, item.body[:120]) for item in responses]})",
    )
    return responses


def concurrency(ctx) -> None:
    """원자 연산을 SELECT-then-INSERT / read-modify-write 로 옮기면 여기서 깨진다.

    응답 하나하나는 인터리빙에 따라 달라질 수 있으므로 **인터리빙과 무관한 불변식**만
    기록한다 — 그래야 같은 시드로 반복 실행할 때 같은 결과가 나온다.
    """
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "conc", headers)

    # ① 같은 X-Request-Id 의 중복 세션 생성
    intent_id = create_upload(ctx, "conc", headers)
    body = session_body(intent_id)
    duplicate_id = ctx.request_id("duplicate-create")
    duplicate_headers = {**headers, "X-Request-Id": duplicate_id}
    responses = _parallel(
        ctx.backend,
        [
            lambda: ctx.backend.request(
                "POST", "/v2/practice-sessions", json=body, headers=duplicate_headers
            )
            for _ in range(2)
        ],
    )
    session_ids = {
        (response.json() or {}).get("session_id")
        for response in responses
        if response.status in {200, 202}
    }
    require(session_ids, f"동시 생성이 모두 실패했다: {[r.status for r in responses]}")
    for value in sorted(session_ids):
        ctx.register(value, "practice_session")
    projection = ctx.backend.control("db-projection", include=OPERATION_PROJECTION)
    ctx.note(
        "duplicate-create",
        {
            "distinct_session_ids": len(session_ids),
            "practice_sessions": len(projection["practice_sessions"]),
            "analyze_operations": sum(
                1 for row in projection["external_operations"] if row["kind"] == "analyze"
            ),
            "statuses_are_2xx_or_409": sorted(
                {response.status in {200, 202, 409} for response in responses}
            ),
        },
    )

    # ② 같은 글 동시 좋아요 — 재집계이므로 정확히 2가 되어야 한다.
    post = ctx.call(
        "conc.post",
        "post",
        "/v2/community/posts",
        json={
            "category_slug": "free",
            "title": "동시 좋아요",
            "body": "두 사람이 같은 순간에 누른다",
            "anonymous": False,
        },
        headers=ctx.auth(cfg.SEED_USER_IDS[0]),
    )
    require(post.status == 201, f"글 생성 실패 {post.status}")
    post_id = post.parsed["id"]
    ctx.register(post_id, "post")
    # 같은 사람이 같은 순간에 두 번 누른다. `ON CONFLICT DO NOTHING` 은 둘 다
    # 200 으로 흡수하지만, SELECT-then-INSERT 로 옮기면 유니크 위반이 새어나온다.
    like_header = ctx.auth(cfg.SEED_USER_IDS[1])
    like_responses = _parallel(
        ctx.backend,
        [
            (
                lambda: ctx.backend.request(
                    "POST",
                    f"/v2/community/posts/{post_id}/likes",
                    headers=like_header,
                )
            )
            for _ in range(2)
        ],
    )
    final = ctx.call(
        "conc.post-after",
        "get",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": post_id},
    )
    ctx.note(
        "concurrent-likes",
        {
            "statuses": sorted(response.status for response in like_responses),
            "final_like_count": final.parsed["like_count"],
        },
    )

    # ③ refresh 동시 회전 — row lock 이 있으면 정확히 하나만 성공한다.
    rotate_responses = _parallel(
        ctx.backend,
        [
            lambda: ctx.backend.request(
                "POST",
                "/v2/auth/refresh",
                json={"refresh_token": tokens["refresh_token"]},
            )
            for _ in range(2)
        ],
    )
    ctx.note(
        "concurrent-refresh",
        {
            "success_count": sum(
                1 for response in rotate_responses if response.status == 200
            ),
            "rejected_count": sum(
                1 for response in rotate_responses if response.status == 401
            ),
        },
    )

    # ④ 같은 코치 세션 동시 reply — 턴 전량 비교 낙관적 락.
    # barrier 는 요청 **시작점**에만 있어 그것만으로는 직렬화돼도 통과한다.
    # 두 요청을 LLM 스텁 안(=read→save 구간)에 **함께 가둔 뒤** 풀어야 실제 경합이다.
    session_id = sorted(session_ids)[0]
    ctx.control("conc.worker", "run-worker-once")
    started = ctx.call(
        "conc.coach-start",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id, "restart": True},
        headers={**headers, "X-Request-Id": ctx.request_id("conc-start")},
        canonical=True,
        expect_request_id=True,
    )
    require(started.status == 200, f"coach start 실패 {started.status} {started.body!r}")
    coach_session_id = started.parsed["session_id"]
    ctx.register(coach_session_id, "coach_session")
    reply_headers = [
        {**headers, "X-Request-Id": ctx.request_id(f"conc-reply-{index}")}
        for index in range(2)
    ]
    reply_responses = _gated_parallel(
        ctx,
        "coach_generate",
        [
            (
                lambda header=header, index=index: ctx.backend.request(
                    "POST",
                    "/v2/coach/reply",
                    json={
                        "session_id": coach_session_id,
                        "text": f"동시 응답 {index} {STUB_BLOCK_MARKER}",
                    },
                    headers=header,
                )
            )
            for index, header in enumerate(reply_headers)
        ],
    )
    coach_projection = ctx.backend.control("db-projection", include=["coach_sessions"])
    statuses = sorted(response.status for response in reply_responses)
    turn_count = next(
        (
            row["turn_count"]
            for row in coach_projection["coach_sessions"]
            if row["id"] == coach_session_id
        ),
        None,
    )
    # 두 요청이 같은 스냅샷을 읽고 동시에 저장하려 하므로 정확히 하나만 성공한다.
    # `_save_coach_session` 의 턴 전량 비교 낙관적 락이 나머지를 거부한다.
    ctx.record_response(
        "coach.reply-write-conflict",
        method="post",
        template="/v2/coach/reply",
        response=max(reply_responses, key=lambda item: item.status),
    )
    ctx.note(
        "concurrent-reply",
        {
            "statuses": statuses,
            "turn_count": turn_count,
            "no_lost_update": turn_count == 4,
        },
    )

    # 이긴 쪽의 턴 내용은 실행마다 달라지므로 **이 코치 세션을 이후에 관측하지
    # 않는다.** 관측 대상은 거부된 응답(결정적)과 최종 턴 수뿐이다.
    # 같은 handoff 중복 확정(409 report already exists)은 `inflight.py` 가
    # 스텁 게이트로 결정적으로 만든다.
