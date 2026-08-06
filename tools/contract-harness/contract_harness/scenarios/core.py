"""핵심 시나리오 — health · 메인 플로우 · 코치 resume/restart."""

from __future__ import annotations

from contract_harness import config as cfg
from contract_harness.scenarios.support import (
    create_analyzed_session,
    grant_all_consents,
    login,
    require,
)

COMPLETE_MARKER = "[[coach:complete]]"


def health(ctx) -> None:
    ctx.call("health", "get", "/health")


def main_flow(ctx) -> None:
    """기존 대본 번역 — 로그인 → 약관 → 업로드 → 세션 → 워커 → 코치 → 리포트 → 삭제."""
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    ctx.call("pending-consents", "get", "/v2/consents/pending", headers=headers)
    ctx.call("consent-documents", "get", "/v2/consents/documents")
    grant_all_consents(ctx, "main", headers)
    ctx.call("pending-after", "get", "/v2/consents/pending", headers=headers)

    ctx.call("me", "get", "/v2/me", headers=headers)
    ctx.call(
        "me-patch",
        "patch",
        "/v2/me",
        json={"nickname": "  새   배우  "},
        headers=headers,
    )

    session_id = create_analyzed_session(ctx, "main", headers, tag="main")

    # 멱등 replay — 202 accepted 경로
    accepted_request_id = ctx.request_id("accepted-replay")
    accepted_headers = {**headers, "X-Request-Id": accepted_request_id}
    intent = ctx.call(
        "second.intent",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 4096, "duration_ms": 1500},
        headers=headers,
    )
    second_intent_id = intent.parsed["intent_id"]
    ctx.register(second_intent_id, "upload_intent")
    ctx.call(
        "second.complete",
        "post",
        "/v2/uploads/intents/{intent_id}/complete",
        path_params={"intent_id": second_intent_id},
        headers=headers,
    )
    second_body = {
        "upload_intent_id": second_intent_id,
        "situation": "무대 뒤",
        "character_context": "긴장한 배우",
        "goal": "상대를 붙잡는다",
        "blockage_kind": "분석",
        "sub_branch": "캐릭터 분석",
        "blockage_detail": None,
    }
    first = ctx.call(
        "accepted",
        "post",
        "/v2/practice-sessions",
        json=second_body,
        headers=accepted_headers,
        expect_request_id=True,
    )
    require(first.status == 202, f"202 accepted 가 아니다: {first.status}")
    ctx.register(first.parsed["session_id"], "practice_session")
    ctx.call(
        "accepted-replay",
        "post",
        "/v2/practice-sessions",
        json=second_body,
        headers=accepted_headers,
        replay_of="accepted",
        expect_request_id=True,
    )
    ctx.control("accepted.worker", "run-worker-once")
    succeeded = ctx.call(
        "succeeded-replay",
        "post",
        "/v2/practice-sessions",
        json=second_body,
        headers=accepted_headers,
        expect_request_id=True,
    )
    require(succeeded.status == 200, f"succeeded replay 가 200 이 아니다: {succeeded.status}")
    ctx.register(succeeded.parsed["summary_id"], "summary")
    ctx.call(
        "succeeded-replay-2",
        "post",
        "/v2/practice-sessions",
        json=second_body,
        headers=accepted_headers,
        replay_of="succeeded-replay",
        expect_request_id=True,
    )

    listed = ctx.call("sessions-list", "get", "/v2/practice-sessions", headers=headers)
    require(listed.status == 200, "세션 목록 실패")
    detail = ctx.call(
        "session-detail",
        "get",
        "/v2/practice-sessions/{session_id}",
        path_params={"session_id": session_id},
        headers=headers,
    )
    require(detail.status == 200, f"세션 상세 실패 {detail.status} {detail.body!r}")
    ctx.register(detail.parsed["summary"]["summary_id"], "summary")
    ctx.call(
        "session-status",
        "get",
        "/v2/practice-sessions/{session_id}/status",
        path_params={"session_id": session_id},
        headers=headers,
    )

    # 코치 — L3 는 restart: true 로만 관측한다 (§3단 비교 🔁)
    start_request_id = ctx.request_id("coach-start")
    start_headers = {**headers, "X-Request-Id": start_request_id}
    start_body = {"practice_session_id": session_id, "restart": True}
    started = ctx.call(
        "coach-start",
        "post",
        "/v2/coach/start",
        json=start_body,
        headers=start_headers,
        canonical=True,
        expect_request_id=True,
    )
    require(started.status == 200, f"coach start 실패 {started.status} {started.body!r}")
    coach_session_id = started.parsed["session_id"]
    ctx.register(coach_session_id, "coach_session")
    ctx.call(
        "coach-start-replay",
        "post",
        "/v2/coach/start",
        json=start_body,
        headers=start_headers,
        replay_of="coach-start",
        canonical=True,
        expect_request_id=True,
    )

    reply_request_id = ctx.request_id("coach-reply")
    reply_headers = {**headers, "X-Request-Id": reply_request_id}
    reply_body = {"session_id": coach_session_id, "text": "대사가 기억 안 났어요"}
    ctx.call(
        "coach-reply",
        "post",
        "/v2/coach/reply",
        json=reply_body,
        headers=reply_headers,
        canonical=True,
        expect_request_id=True,
    )
    ctx.call(
        "coach-reply-replay",
        "post",
        "/v2/coach/reply",
        json=reply_body,
        headers=reply_headers,
        replay_of="coach-reply",
        canonical=True,
        expect_request_id=True,
    )
    completed = ctx.call(
        "coach-complete",
        "post",
        "/v2/coach/reply",
        json={
            "session_id": coach_session_id,
            "text": f"지금 놓치면 끝이에요 {COMPLETE_MARKER}",
        },
        headers={**headers, "X-Request-Id": ctx.request_id("coach-complete")},
        canonical=True,
        expect_request_id=True,
    )
    require(
        completed.status == 200 and completed.parsed["status"] == "complete",
        f"코치가 complete 로 끝나지 않았다: {completed.status} {completed.body!r}",
    )
    handoff_id = completed.parsed["handoff"]["id"]
    ctx.register(handoff_id, "handoff")

    confirm_request_id = ctx.request_id("coach-confirm")
    confirm_headers = {**headers, "X-Request-Id": confirm_request_id}
    confirm_body = {
        "coach_session_id": coach_session_id,
        "confirmed": True,
        "rebuttal_text": None,
    }
    ctx.call(
        "coach-confirm",
        "post",
        "/v2/coach/confirm",
        json=confirm_body,
        headers=confirm_headers,
        canonical=True,
        expect_request_id=True,
    )
    ctx.call(
        "coach-confirm-replay",
        "post",
        "/v2/coach/confirm",
        json=confirm_body,
        headers=confirm_headers,
        replay_of="coach-confirm",
        canonical=True,
        expect_request_id=True,
    )

    report_request_id = ctx.request_id("report")
    report_headers = {**headers, "X-Request-Id": report_request_id}
    report_body = {"session_id": coach_session_id}
    created = ctx.call(
        "report-create",
        "post",
        "/v2/reports",
        json=report_body,
        headers=report_headers,
        canonical=True,
        expect_request_id=True,
    )
    require(created.status == 200, f"리포트 생성 실패 {created.status} {created.body!r}")
    ctx.call(
        "report-replay",
        "post",
        "/v2/reports",
        json=report_body,
        headers=report_headers,
        replay_of="report-create",
        canonical=True,
        expect_request_id=True,
    )
    ctx.call("report-history", "get", "/v2/reports", headers=headers)
    ctx.call(
        "report-detail",
        "get",
        "/v2/reports/{practice_session_id}",
        path_params={"practice_session_id": session_id},
        headers=headers,
    )

    ctx.control("main.projection", "db-projection")

    refreshed = ctx.call(
        "refresh",
        "post",
        "/v2/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    require(refreshed.status == 200, "refresh 실패")
    ctx.call(
        "session-delete",
        "delete",
        "/v2/practice-sessions/{session_id}",
        path_params={"session_id": session_id},
        headers=headers,
    )
    ctx.call(
        "logout",
        "post",
        "/v2/auth/logout",
        json={"refresh_token": refreshed.parsed["refresh_token"]},
        headers=headers,
    )


def coach_resume_restart(ctx) -> None:
    """resume → restart 순서. resume 검증을 restart 검증보다 먼저 둔다 (§3단 비교 🔁)."""
    tokens = login(ctx, "login", "harness-token-second-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "resume", headers)
    session_id = create_analyzed_session(ctx, "resume", headers, tag="resume")

    started = ctx.call(
        "start",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id},
        headers={**headers, "X-Request-Id": ctx.request_id("start")},
        canonical=True,
        expect_request_id=True,
    )
    require(started.status == 200, f"coach start 실패 {started.status} {started.body!r}")
    first_session = started.parsed["session_id"]
    ctx.register(first_session, "coach_session")

    ctx.call(
        "reply",
        "post",
        "/v2/coach/reply",
        json={"session_id": first_session, "text": "무대에서 굳었어요"},
        headers={**headers, "X-Request-Id": ctx.request_id("reply")},
        canonical=True,
        expect_request_id=True,
    )

    # ① restart 생략 → resume. LLM 큐가 소비되지 않아야 한다.
    before = ctx.control("resume.stub-before", "stub-state")
    resumed = ctx.call(
        "resume",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id},
        headers={**headers, "X-Request-Id": ctx.request_id("resume")},
        canonical=True,
        expect_request_id=True,
    )
    after = ctx.control("resume.stub-after", "stub-state")
    ctx.note(
        "resume.assertions",
        {
            "same_session": resumed.parsed["session_id"] == first_session,
            "coach_calls_unchanged": before["coach_generate"]["calls"]
            == after["coach_generate"]["calls"],
            "turn_count": len(resumed.parsed["turns"]),
            "turn_roles": [turn["role"] for turn in resumed.parsed["turns"]],
            "handoff_is_null": resumed.parsed["handoff"] is None,
            "report_is_null": resumed.parsed["report"] is None,
            "status": resumed.parsed["status"],
        },
    )

    # ② restart: true → 새 세션이 생기고 이전 세션이 닫힌다.
    restart_request_id = ctx.request_id("restart")
    restart_headers = {**headers, "X-Request-Id": restart_request_id}
    restart_body = {"practice_session_id": session_id, "restart": True}
    restarted = ctx.call(
        "restart",
        "post",
        "/v2/coach/start",
        json=restart_body,
        headers=restart_headers,
        canonical=True,
        expect_request_id=True,
    )
    require(restarted.status == 200, f"restart 실패 {restarted.status}")
    second_session = restarted.parsed["session_id"]
    ctx.register(second_session, "coach_session")
    ctx.note("restart.new-session", {"is_new": second_session != first_session})
    ctx.control("restart.projection", "db-projection", include=["coach_sessions"])

    # ③ 같은 X-Request-Id 재전송 → L3-a 바이트 동등
    ctx.call(
        "restart-replay",
        "post",
        "/v2/coach/start",
        json=restart_body,
        headers=restart_headers,
        replay_of="restart",
        canonical=True,
        expect_request_id=True,
    )

    # ④ 리포트 확정 후 resume 시도 → 409. 두 경로(resume 분기 / 클레임 뒤)를 모두 밟는다.
    completed = ctx.call(
        "complete",
        "post",
        "/v2/coach/reply",
        json={
            "session_id": second_session,
            "text": f"이제 알겠어요 {COMPLETE_MARKER}",
        },
        headers={**headers, "X-Request-Id": ctx.request_id("complete")},
        canonical=True,
        expect_request_id=True,
    )
    require(completed.status == 200, f"complete 실패 {completed.status}")
    ctx.register(completed.parsed["handoff"]["id"], "handoff")
    ctx.call(
        "confirm",
        "post",
        "/v2/coach/confirm",
        json={
            "coach_session_id": second_session,
            "confirmed": True,
            "rebuttal_text": None,
        },
        headers={**headers, "X-Request-Id": ctx.request_id("confirm")},
        canonical=True,
        expect_request_id=True,
    )

    before_projection = ctx.control(
        "conflict.projection-before", "db-projection", include=["external_operations"]
    )
    ctx.call(
        "conflict-resume-branch",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id},
        headers={**headers, "X-Request-Id": ctx.request_id("conflict-resume")},
        expect_request_id=False,
    )
    mid_projection = ctx.control(
        "conflict.projection-mid", "db-projection", include=["external_operations"]
    )
    ctx.note(
        "conflict.resume-branch-has-no-operation",
        {
            "operation_count_unchanged": len(before_projection["external_operations"])
            == len(mid_projection["external_operations"])
        },
    )
    ctx.call(
        "conflict-claim-branch",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id, "restart": True},
        headers={**headers, "X-Request-Id": ctx.request_id("conflict-claim")},
    )
    ctx.control(
        "conflict.projection-after", "db-projection", include=["external_operations"]
    )


def _unused() -> None:  # pragma: no cover - 참조 유지용
    _ = cfg
