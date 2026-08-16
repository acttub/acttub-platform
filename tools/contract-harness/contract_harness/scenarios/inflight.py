"""처리 중인 sync operation — 409 `request is still processing` 다섯 지점.

이 응답은 두 갈래에서 난다.

1. **replay 가 running 을 만났을 때** (`sync_operations.py:_existing_operation_response`)
   — 첫 요청이 클레임을 잡은 뒤 아직 안 끝난 상태에서 같은 `X-Request-Id` 가 다시 온다.
2. **lease 를 빼앗겼을 때** (`coaching.py:build_router.coach_start`·`.coach_reply`·
   `.coach_confirm`, `reports.py:build_router.create_report` 의 `LeaseOwnershipError` 처리)
   — 처리 중에 다른 소유자가 operation 을 재선점해 완료가 거부된다.

둘 다 "요청이 처리 도중에 멈춰 있는 구간"이 필요하다. 그 훅은 **이미 있는 LLM
스텁**이다. `coach_start` 는 `begin_sync_operation` 으로 클레임을 잡은 **다음**
`coach_engine.start(generate=coach_generate)` 를 부르므로, 스텁이 멈춰 있는 동안
그 operation 은 running 이다. 인터리빙에 기대지 않는다 — 첫 요청이 스텁 안에
확실히 멈춰 있고, 하네스는 `stub-state` 로 멈춘 것을 확인한 뒤에만 다음 단계로 간다.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from contract_harness.scenarios.gate import (
    poll_until_blocked,
    poll_until_unblocked,
    rearm as gate_rearm,
    release as gate_release,
)
from contract_harness.scenarios.support import (
    create_analyzed_session,
    create_upload,
    grant_all_consents,
    login,
    require,
    session_body,
)
from contract_harness.stubs import STUB_BLOCK_MARKER

BLOCK_WAIT_SEC = 15.0
COMPLETE_MARKER = "[[coach:complete]]"
# 리포트 스텁이 JSON 이 아닌 문자열을 내게 하는 마커 (fixtures/llm.json).
REPORT_PARSE_ERROR_MARKER = "[[report:parse_error]]"


def _wait_until_blocked(ctx, step_id: str, stub: str) -> None:
    """스텁이 실제로 멈춘 것을 확인한다. 못 멈추면 시나리오를 실패로 끝낸다."""
    blocked, state = poll_until_blocked(ctx, stub, timeout=BLOCK_WAIT_SEC)
    require(
        blocked,
        f"{stub} 스텁이 {BLOCK_WAIT_SEC}초 안에 멈추지 않았다 (마지막 상태: {state})",
    )
    # 여기서 한 번만 기록한다 — 폴링까지 기록하면 백엔드마다 폴링 횟수가 달라
    # 스텝 수가 갈린다.
    recorded = ctx.control(step_id, "stub-state")
    require(
        recorded[stub]["in_block"],
        f"stub-state 가 {stub} 를 멈춘 것으로 보고하지 않는다: {recorded[stub]}",
    )


def _release(ctx, step_id: str, stub: str) -> dict:
    """멈춰 있던 요청을 풀고, **빠져나온 뒤의** 상태를 한 번 기록한다.

    `release=True` 를 그대로 기록 스텝으로 쓰면 안 된다 — 그 응답의
    `in_block_count` 는 대기 스레드가 이미 깨어났는지에 달린 값이라 백엔드마다,
    실행마다 갈린다(`gate.poll_until_unblocked` 참조). 실제로 java 타겟에서
    `inflight-replay`·`duplicate-report` 가 이 한 필드로 산발적으로 diff 를 냈다.

    갇혀 있었다는 사실은 `_wait_until_blocked` 가 이미 관측하고 기록했다. 여기서는
    **빠져나온 것**을 확인하고 그 안정된 상태를 남긴다 — 안 풀리면 폴링이
    실패로 끝나므로 관측이 줄지 않는다.

    푸는 것은 종전대로 게이트 있는 스텁 전부지만 **기다리는 것은 `stub` 하나**다.
    이 스텝이 가둔 것은 그것 하나이므로, 실패 메시지가 건드린 적 없는 스텁을
    가리키지 않는다.

    ⚠ **이 스냅샷은 풀려난 핸들러가 아직 실행 중일 때 찍힌다**(응답을 기다리는
    `pending.result()` 는 호출부에서 뒤에 온다). 지금은 게이트를 빠져나온 경로가
    다른 스텁을 부르지 않아 안정적이다. **그 경로에 스텁 호출이 하나라도 생기면**
    응답에 함께 실리는 `analyzer`·`s3.calls`·다른 스텁의 `calls` 가 다시 실행마다
    갈린다 — 그때는 기록을 `pending.result()` 뒤로 옮겨야 한다.
    """
    gate_release(ctx)
    unblocked, state = poll_until_unblocked(ctx, stub, timeout=BLOCK_WAIT_SEC)
    require(
        unblocked,
        f"release 뒤에도 {stub} 에 갇힌 요청이 남아 있다: {state[stub]}",
    )
    return ctx.control(step_id, "stub-state")


def _rearm(ctx, step_id: str) -> dict:
    return ctx.control(step_id, "stub-state", rearm=True)


def in_flight_replay(ctx) -> None:
    """① running 인 operation 에 같은 X-Request-Id 가 다시 오면 409."""
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "inflight", headers)
    session_id = create_analyzed_session(
        ctx,
        "inflight",
        headers,
        tag="inflight",
        body_overrides={"blockage_detail": f"왜 지금인지 모르겠어 {STUB_BLOCK_MARKER}"},
    )

    request_id = ctx.request_id("blocked-start")
    start_headers = {**headers, "X-Request-Id": request_id}
    start_body = {"practice_session_id": session_id, "restart": True}

    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(
            ctx.backend.request,
            "POST",
            "/v2/coach/start",
            json=start_body,
            headers=start_headers,
        )
        _wait_until_blocked(ctx, "inflight.blocked", "coach_generate")

        # 첫 요청이 스텁 안에 멈춰 있는 동안 같은 요청을 다시 보낸다.
        ctx.control(
            "inflight.projection", "db-projection", include=["external_operations"]
        )
        ctx.call(
            "sync.in-flight-replay",
            "post",
            "/v2/coach/start",
            json=start_body,
            headers=start_headers,
            expect_request_id=True,
        )

        _release(ctx, "inflight.release", "coach_generate")
        first = pending.result(timeout=BLOCK_WAIT_SEC + 10)

    ctx.note(
        "inflight.first-response",
        {"status": first.status, "blocked_once": True},
    )
    require(first.status == 200, f"멈췄던 첫 요청이 200 으로 안 끝났다: {first.status}")
    ctx.register((first.json() or {})["session_id"], "coach_session")
    _rearm(ctx, "inflight.rearm")
    ctx.control("inflight.stub-final", "stub-state")


def lease_stolen(ctx) -> None:
    """② 처리 중에 lease 를 빼앗기면 완료가 거부되고 409 가 나간다.

    네 라우트(`coach_start`·`coach_reply`·`coach_confirm`·`reports`)가 같은 구조로
    `LeaseOwnershipError` 를 409 로 바꾼다.
    """
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "lease", headers)

    # --- coach_start ------------------------------------------------------
    blocked_session = create_analyzed_session(
        ctx,
        "lease-start",
        headers,
        tag="lease-start",
        body_overrides={"blockage_detail": f"막혔어요 {STUB_BLOCK_MARKER}"},
    )
    _call_with_lease_steal(
        ctx,
        step_id="coach.start-lease-lost",
        method="post",
        template="/v2/coach/start",
        json={"practice_session_id": blocked_session, "restart": True},
        headers=headers,
        tag="lease-start",
        stub="coach_generate",
    )

    # --- coach_reply -------------------------------------------------------
    reply_session = create_analyzed_session(
        ctx, "lease-reply", headers, tag="lease-reply"
    )
    started = ctx.call(
        "lease-reply.start",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": reply_session, "restart": True},
        headers={**headers, "X-Request-Id": ctx.request_id("lease-reply-start")},
        canonical=True,
        expect_request_id=True,
    )
    require(started.status == 200, f"coach start 실패 {started.status} {started.body!r}")
    coach_session_id = started.parsed["session_id"]
    ctx.register(coach_session_id, "coach_session")
    _call_with_lease_steal(
        ctx,
        step_id="coach.reply-lease-lost",
        method="post",
        template="/v2/coach/reply",
        json={"session_id": coach_session_id, "text": f"멈춰줘 {STUB_BLOCK_MARKER}"},
        headers=headers,
        tag="lease-reply",
        stub="coach_generate",
    )

    # --- coach_confirm / reports -------------------------------------------
    # 리포트 LLM 을 실제로 부르게 하려면 handoff 는 확정됐는데 practice_report 는
    # 없는 상태여야 한다. 코치 완료 턴이 그 자리에서 리포트를 저장하므로,
    # 저장된 행을 지우고 handoff 에 스텁 마커를 심어 그 상태를 만든다.
    report_session = create_analyzed_session(
        ctx, "lease-report", headers, tag="lease-report"
    )
    report_start = ctx.call(
        "lease-report.start",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": report_session, "restart": True},
        headers={**headers, "X-Request-Id": ctx.request_id("lease-report-start")},
        canonical=True,
        expect_request_id=True,
    )
    require(report_start.status == 200, f"coach start 실패 {report_start.status}")
    report_coach_session = report_start.parsed["session_id"]
    ctx.register(report_coach_session, "coach_session")
    completed = ctx.call(
        "lease-report.complete",
        "post",
        "/v2/coach/reply",
        json={"session_id": report_coach_session, "text": f"정리하죠 {COMPLETE_MARKER}"},
        headers={**headers, "X-Request-Id": ctx.request_id("lease-report-complete")},
        canonical=True,
        expect_request_id=True,
    )
    require(
        completed.status == 200 and completed.parsed["status"] == "complete",
        f"complete 실패 {completed.status} {completed.body!r}",
    )
    ctx.register(completed.parsed["handoff"]["id"], "handoff")
    ctx.db_op(
        "lease-report.drop-report",
        "delete_practice_reports",
        practice_session_id=report_session,
    )
    ctx.db_op(
        "lease-report.arm-handoff",
        "inject_marker_into_handoff",
        coach_session_id=report_coach_session,
        marker=STUB_BLOCK_MARKER,
    )
    _call_with_lease_steal(
        ctx,
        step_id="reports.lease-lost",
        method="post",
        template="/v2/reports",
        json={"session_id": report_coach_session},
        headers=headers,
        tag="lease-reports",
        stub="report_generate",
    )
    _call_with_lease_steal(
        ctx,
        step_id="coach.confirm-lease-lost",
        method="post",
        template="/v2/coach/confirm",
        json={
            "coach_session_id": report_coach_session,
            "confirmed": True,
            "rebuttal_text": None,
        },
        headers=headers,
        tag="lease-confirm",
        stub="report_generate",
    )
    ctx.control("lease.projection", "db-projection", include=["external_operations"])


def _call_with_lease_steal(
    ctx, *, step_id, method, template, json, headers, tag, stub
):
    """요청을 스텁 안에 멈춰 세우고 그 사이에 lease 를 빼앗은 뒤 풀어준다."""
    request_id = ctx.request_id(tag)
    call_headers = {**headers, "X-Request-Id": request_id}
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(
            ctx.backend.request,
            method.upper(),
            template,
            json=json,
            headers=call_headers,
        )
        _wait_until_blocked(ctx, f"{step_id}.blocked", stub)
        ctx.db_op(f"{step_id}.steal", "steal_lease", request_id=request_id)
        _release(ctx, f"{step_id}.release", stub)
        response = pending.result(timeout=BLOCK_WAIT_SEC + 10)
    _rearm(ctx, f"{step_id}.rearm")
    ctx.record_response(
        step_id,
        method=method,
        template=template,
        response=response,
        expect_request_id=False,
    )
    return response


def report_parse_error(ctx) -> None:
    """`POST /v2/reports`·`POST /v2/coach/confirm` 의 502 (ReportParseError).

    두 라우트에서 리포트 LLM 을 실제로 부르려면 handoff 는 확정됐는데
    practice_report 는 없는 상태여야 한다. 코치 완료 턴이 그 자리에서 리포트를
    저장하므로 순차 호출로는 만들 수 없지만, 저장된 행을 지우고 handoff 에
    파싱 실패 마커를 심으면 만들어진다.
    """
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "parse", headers)
    session_id = create_analyzed_session(ctx, "parse", headers, tag="parse")

    started = ctx.call(
        "parse.start",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id, "restart": True},
        headers={**headers, "X-Request-Id": ctx.request_id("parse-start")},
        canonical=True,
        expect_request_id=True,
    )
    require(started.status == 200, f"coach start 실패 {started.status} {started.body!r}")
    coach_session_id = started.parsed["session_id"]
    ctx.register(coach_session_id, "coach_session")
    completed = ctx.call(
        "parse.complete",
        "post",
        "/v2/coach/reply",
        json={"session_id": coach_session_id, "text": f"정리하죠 {COMPLETE_MARKER}"},
        headers={**headers, "X-Request-Id": ctx.request_id("parse-complete")},
        canonical=True,
        expect_request_id=True,
    )
    require(
        completed.status == 200 and completed.parsed["status"] == "complete",
        f"complete 실패 {completed.status} {completed.body!r}",
    )
    ctx.register(completed.parsed["handoff"]["id"], "handoff")

    ctx.db_op(
        "parse.drop-report",
        "delete_practice_reports",
        practice_session_id=session_id,
    )
    ctx.db_op(
        "parse.arm-handoff",
        "inject_marker_into_handoff",
        coach_session_id=coach_session_id,
        marker=REPORT_PARSE_ERROR_MARKER,
    )
    ctx.call(
        "reports.parse-error",
        "post",
        "/v2/reports",
        json={"session_id": coach_session_id},
        headers={**headers, "X-Request-Id": ctx.request_id("parse-reports")},
    )
    ctx.call(
        "coach.confirm-parse-error",
        "post",
        "/v2/coach/confirm",
        json={
            "coach_session_id": coach_session_id,
            "confirmed": True,
            "rebuttal_text": None,
        },
        headers={**headers, "X-Request-Id": ctx.request_id("parse-confirm")},
    )
    ctx.control(
        "parse.projection", "db-projection", include=["external_operations"]
    )


def duplicate_report(ctx) -> None:
    """`ON CONFLICT (source_handoff_id) DO NOTHING` 이 실제로 걸리는 구간.

    두 라우트 다 "기존 리포트 없음"을 먼저 확인하므로, 그 확인 **뒤**에 행이 생겨야
    409 `report already exists` 가 난다. 요청을 리포트 스텁 게이트에 세워 두고 그
    사이에 행을 만들면 그 순서가 결정적으로 만들어진다 — 동시 요청 두 개로 흉내
    내면 인터리빙에 좌우되고(원본은 그 경합에서 500 을 내기도 한다) flaky 해진다.
    """
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "dup", headers)

    for label, route, payload_of in (
        ("reports.duplicate-conflict", "/v2/reports", lambda cs: {"session_id": cs}),
        (
            "coach.confirm-duplicate-conflict",
            "/v2/coach/confirm",
            lambda cs: {
                "coach_session_id": cs,
                "confirmed": True,
                "rebuttal_text": None,
            },
        ),
    ):
        tag = label.replace(".", "-")
        session_id = create_analyzed_session(ctx, tag, headers, tag=tag)
        started = ctx.call(
            f"{tag}.start",
            "post",
            "/v2/coach/start",
            json={"practice_session_id": session_id, "restart": True},
            headers={**headers, "X-Request-Id": ctx.request_id(f"{tag}-start")},
            canonical=True,
            expect_request_id=True,
        )
        require(started.status == 200, f"coach start 실패 {started.status}")
        coach_session_id = started.parsed["session_id"]
        ctx.register(coach_session_id, "coach_session")
        completed = ctx.call(
            f"{tag}.complete",
            "post",
            "/v2/coach/reply",
            json={"session_id": coach_session_id, "text": f"정리하죠 {COMPLETE_MARKER}"},
            headers={**headers, "X-Request-Id": ctx.request_id(f"{tag}-complete")},
            canonical=True,
            expect_request_id=True,
        )
        require(
            completed.status == 200 and completed.parsed["status"] == "complete",
            f"complete 실패 {completed.status} {completed.body!r}",
        )
        ctx.register(completed.parsed["handoff"]["id"], "handoff")
        # 완료 턴이 저장한 리포트를 지워 생성 경로를 열고, 게이트를 무장시킨다.
        ctx.db_op(
            f"{tag}.drop", "delete_practice_reports", practice_session_id=session_id
        )
        ctx.db_op(
            f"{tag}.arm",
            "inject_marker_into_handoff",
            coach_session_id=coach_session_id,
            marker=STUB_BLOCK_MARKER,
        )
        gate_rearm(ctx, "report_generate")
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(
                ctx.backend.request,
                "POST",
                route,
                json=payload_of(coach_session_id),
                headers={**headers, "X-Request-Id": ctx.request_id(f"{tag}-call")},
            )
            _wait_until_blocked(ctx, f"{tag}.blocked", "report_generate")
            # 확인은 끝났고 저장은 아직인 그 사이에 행을 만든다.
            ctx.db_op(
                f"{tag}.insert",
                "insert_practice_report",
                practice_session_id=session_id,
                coach_session_id=coach_session_id,
            )
            _release(ctx, f"{tag}.release", "report_generate")
            response = pending.result(timeout=BLOCK_WAIT_SEC + 10)
        _rearm(ctx, f"{tag}.rearm")
        ctx.record_response(
            label, method="post", template=route, response=response
        )
    ctx.control("dup.projection", "db-projection", include=["external_operations"])


def expired_upload_intent(ctx) -> None:
    """③ 만료된 upload intent 는 complete 에서 409.

    만료 판정이 시계가 아니라 **DB 값**을 본다(`uploads.py:build_router.
    complete_intent` 의 `intent.expires_at <= now`). 그래서 시계 주입점 없이도
    결정적으로 만들 수 있다.
    """
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "expired", headers)

    intent = ctx.call(
        "expired.intent",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 4096, "duration_ms": 1500},
        headers=headers,
    )
    require(intent.status == 201, f"intent 생성 실패 {intent.status} {intent.body!r}")
    intent_id = intent.parsed["intent_id"]
    ctx.register(intent_id, "upload_intent")
    ctx.db_op("expired.expire", "expire_upload_intent", intent_id=intent_id)
    ctx.call(
        "uploads.expired",
        "post",
        "/v2/uploads/intents/{intent_id}/complete",
        path_params={"intent_id": intent_id},
        headers=headers,
    )
    # 만료된 intent 로는 세션도 만들 수 없다.
    ctx.call(
        "expired.session",
        "post",
        "/v2/practice-sessions",
        json=session_body(intent_id),
        headers={**headers, "X-Request-Id": ctx.request_id("expired-session")},
    )
    # 정상 intent 는 그대로 통과한다 — 만료 판정이 무차별이 아님을 보인다.
    create_upload(ctx, "expired-healthy", headers)

    # 상한을 낮춘 배포 이전에 발급된 pending intent 재검증(§uploads.complete_intent).
    # 상한 자체는 못 바꾸지만 그 상황이 남긴 **행**은 만들 수 있다.
    oversized = ctx.call(
        "oversized.intent",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 4096, "duration_ms": 1500},
        headers=headers,
    )
    require(oversized.status == 201, f"intent 생성 실패 {oversized.status}")
    oversized_id = oversized.parsed["intent_id"]
    ctx.register(oversized_id, "upload_intent")
    ctx.db_op(
        "oversized.inflate", "inflate_upload_intent_size", intent_id=oversized_id
    )
    ctx.call(
        "uploads.complete-too-large",
        "post",
        "/v2/uploads/intents/{intent_id}/complete",
        path_params={"intent_id": oversized_id},
        headers=headers,
    )
