from types import SimpleNamespace
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from acting_api.app import create_app
from acting_api.auth.jwt import JwtService
from acting_api.config import GatewaySettings
from acting_api.db.models import PracticeStatus
from acting_summary.config import Settings as SummarySettings
from api_test_support import (
    ANALYSIS_HANDOFF,
    COACH_COMPLETE,
    COACH_FOLLOWUP,
    REPORT,
    SUMMARY,
    FakeClient,
    FakeTextGenerator,
)
from platform_test_support import FakePlatformStore, finalized_upload

JWT_SECRET = "openai-coach-report-test-secret"

EXPRESSION_COMPLETE_WITHOUT_EXPERIMENT = {
    "message": "지금까지 나온 말로 여기서 정리할게.",
    "status": "complete",
    "handoff": {
        "handoff_type": "expression",
        "blocked_point": "대사가 설명처럼 들리는 지점",
        "expression_core": "상대를 멈추게 하려는 행동",
        "line_meaning": "상대를 붙잡는 말",
        "timing_reason": "상대가 돌아서는 순간",
        "playable_action": "상대의 발걸음을 멈춘다",
        "experiment": {
            "instruction": "돌아서는 상대를 말없이 멈춰 본다",
            "tested": False,
        },
        "observed_change": "",
        "acting_trap": "감정을 만들려고 서두르는 것",
        "scene_evidence": [],
        "actor_words": ["아직 해보지는 않았어"],
        "coach_summary": "시도 전까지 찾은 내용을 정리했다",
        "uncertainties": ["실제로 해봤을 때 달라지는 점"],
    },
}


def _application(*, coach_responses=(), report_responses=()):
    store = FakePlatformStore()
    coach_generate = FakeTextGenerator(coach_responses)
    report_generate = FakeTextGenerator(report_responses)
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret=JWT_SECRET,
        ),
        summary_settings=SummarySettings(api_key="summary-key", model="summary-model"),
        store=store,
        community_store=SimpleNamespace(),
        coach_generate=coach_generate,
        report_generate=report_generate,
    )
    user = store.create_user()
    access = JwtService(JWT_SECRET).issue_access_token(user.id).value
    headers = {"Authorization": f"Bearer {access}"}
    return TestClient(app), store, coach_generate, report_generate, user, headers


def _start(client, store, user, headers):
    summary_id = store.seed_summary(user_id=user.id)
    practice_session_id = store.summaries[summary_id].session_id
    response = client.post(
        "/v2/coach/start",
        json={"practice_session_id": str(practice_session_id)},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )
    assert response.status_code == 200
    return response


def test_coach_start_generates_and_persists_the_first_coach_message():
    client, store, coach, _, user, headers = _application(
        coach_responses=[COACH_FOLLOWUP]
    )

    started = _start(client, store, user, headers)

    assert started.json() == {
        "session_id": started.json()["session_id"],
        "message": COACH_FOLLOWUP["message"],
        "status": "continue",
        "handoff": None,
        "report": None,
        "turns": [
            {"role": "actor", "text": "왜 지금 말하는지 모르겠어."},
            {"role": "ai", "text": COACH_FOLLOWUP["message"]},
        ],
    }
    assert len(coach.calls) == 1
    assert "## 배우의 최신 말\n왜 지금 말하는지 모르겠어." in coach.calls[0][1]
    stored = store.coach_sessions[started.json()["session_id"]]
    assert [(turn.role, turn.text) for turn in stored.turns] == [
        ("actor", "왜 지금 말하는지 모르겠어."),
        ("ai", COACH_FOLLOWUP["message"]),
    ]


def test_stored_analysis_transcripts_reach_the_coach_prompt():
    client, store, coach, _, user, headers = _application(
        coach_responses=[COACH_FOLLOWUP]
    )
    summary_id = store.seed_summary(
        user_id=user.id,
        transcripts=["지금 가지 마.", "내 말 좀 들어줘."],
    )
    practice_session_id = store.summaries[summary_id].session_id

    response = client.post(
        "/v2/coach/start",
        json={"practice_session_id": str(practice_session_id)},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert response.status_code == 200
    prompt = coach.calls[0][1]
    assert (
        "## 영상에서 받아쓴 대사\n"
        "- 지금 가지 마.\n"
        "- 내 말 좀 들어줘."
    ) in prompt


def test_coach_start_waits_for_analysis_but_failed_session_can_start_without_pack():
    client, store, coach, _, user, headers = _application(
        coach_responses=[COACH_FOLLOWUP]
    )
    upload = finalized_upload(store, user.id)
    created = store.create_practice_session_with_analysis_operation(
        user_id=user.id,
        upload_intent_id=upload.id,
        situation="상황",
        character_context="인물",
        goal="상대가 멈추게 한다",
        blockage_kind="분석",
        sub_branch="대사 분석",
        blockage_detail="왜 지금 말하는지 모르겠다",
        request_id=uuid4(),
        request_fingerprint="a" * 64,
    )

    started = client.post(
        "/v2/coach/start",
        json={"practice_session_id": str(created.session.id)},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert started.status_code == 409
    assert started.json()["detail"] == "practice session analysis is not settled"
    assert coach.calls == []

    created.session.status = PracticeStatus.FAILED
    failed_start = client.post(
        "/v2/coach/start",
        json={"practice_session_id": str(created.session.id)},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert failed_start.status_code == 200
    assert failed_start.json()["message"] == COACH_FOLLOWUP["message"]
    assert len(coach.calls) == 1
    assert "아직 영상에서 확인된 것이 없다" in coach.calls[0][1]
    assert "## 배우의 최신 말\n왜 지금 말하는지 모르겠다" in coach.calls[0][1]


def test_coach_contract_persists_internal_handoff_without_leaking_labels():
    client, store, coach, _, user, headers = _application(
        coach_responses=[COACH_COMPLETE],
        report_responses=[REPORT.model_dump(mode="json")],
    )

    started = _start(client, store, user, headers)
    assert set(started.json()) == {
        "session_id",
        "message",
        "status",
        "handoff",
        "report",
        "turns",
    }
    assert started.json()["message"] == COACH_COMPLETE["message"]
    assert started.json()["status"] == "complete"
    assert set(started.json()["handoff"]) == {"id", "branch_kind"}
    assert started.json()["report"]["report_type"] == "analysis"
    handoff_id = UUID(started.json()["handoff"]["id"])
    assert store.handoffs[handoff_id].handoff_json["line_meaning"]
    assert len(coach.calls) == 1
    stored = store.coach_sessions[started.json()["session_id"]]
    assert [turn.role for turn in stored.turns] == ["actor", "ai"]
    assert stored.status == "closed"
    assert store.confirmations[handoff_id].confirmed is True


def test_coach_start_resumes_same_open_session_without_generating_again():
    client, store, coach, _, user, headers = _application(
        coach_responses=[COACH_FOLLOWUP]
    )
    started = _start(client, store, user, headers)
    practice_session_id = next(iter(store.sessions))
    operation_count = len(store.operations)

    resumed = client.post(
        "/v2/coach/start",
        json={"practice_session_id": str(practice_session_id)},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert resumed.status_code == 200
    assert resumed.json()["session_id"] == started.json()["session_id"]
    assert resumed.json()["turns"] == started.json()["turns"]
    assert len(coach.calls) == 1
    assert len(store.operations) == operation_count


def test_coach_start_resume_returns_all_stored_turns_in_order():
    client, store, coach, _, user, headers = _application(
        coach_responses=[COACH_FOLLOWUP, COACH_FOLLOWUP]
    )
    started = _start(client, store, user, headers)
    coach_session_id = started.json()["session_id"]
    practice_session_id = next(iter(store.sessions))
    replied = client.post(
        "/v2/coach/reply",
        json={"session_id": coach_session_id, "text": "상대를 붙잡고 싶어요"},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )
    assert replied.status_code == 200

    resumed = client.post(
        "/v2/coach/start",
        json={"practice_session_id": str(practice_session_id)},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert resumed.status_code == 200
    assert resumed.json()["turns"] == [
        {"role": turn.role, "text": turn.text}
        for turn in store.coach_sessions[coach_session_id].turns
    ]
    assert resumed.json()["turns"] == replied.json()["turns"]
    assert len(coach.calls) == 2


def test_coach_start_restart_closes_open_session_and_creates_a_new_one():
    client, store, coach, _, user, headers = _application(
        coach_responses=[COACH_FOLLOWUP, COACH_FOLLOWUP]
    )
    started = _start(client, store, user, headers)
    old_session_id = started.json()["session_id"]
    practice_session_id = next(iter(store.sessions))

    request_id = uuid4()
    request_headers = {**headers, "X-Request-Id": str(request_id)}
    request_body = {
        "practice_session_id": str(practice_session_id),
        "restart": True,
    }
    restarted = client.post(
        "/v2/coach/start",
        json=request_body,
        headers=request_headers,
    )
    replayed = client.post(
        "/v2/coach/start",
        json=request_body,
        headers=request_headers,
    )

    assert restarted.status_code == 200
    assert replayed.content == restarted.content
    assert restarted.json()["session_id"] != old_session_id
    assert store.coach_sessions[old_session_id].status == "closed"
    assert store.coach_sessions[restarted.json()["session_id"]].status == "open"
    assert len(coach.calls) == 2


def test_coach_start_resumes_the_oldest_of_multiple_open_sessions():
    client, store, coach, _, user, headers = _application(
        coach_responses=[COACH_FOLLOWUP]
    )
    started = _start(client, store, user, headers)
    oldest_session_id = started.json()["session_id"]
    practice_session_id = next(iter(store.sessions))
    newer_session_id = str(uuid4())
    store.coach_sessions[newer_session_id] = store.coach_sessions[
        oldest_session_id
    ].model_copy(
        update={"session_id": newer_session_id, "turns": []},
        deep=True,
    )

    resumed = client.post(
        "/v2/coach/start",
        json={"practice_session_id": str(practice_session_id)},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert resumed.status_code == 200
    assert resumed.json()["session_id"] == oldest_session_id
    assert resumed.json()["turns"] == started.json()["turns"]
    assert len(coach.calls) == 1


def test_actor_stop_completes_closes_and_returns_report_without_confirmation_step():
    client, store, coach, _, user, headers = _application(
        coach_responses=[
            COACH_FOLLOWUP,
            COACH_FOLLOWUP,
            COACH_FOLLOWUP,
            COACH_COMPLETE,
        ],
        report_responses=[REPORT.model_dump(mode="json")],
    )
    started = _start(client, store, user, headers)
    for answer in ("상대를 붙잡고 싶었어요", "말이 안 통한다고 느꼈어요"):
        assert (
            client.post(
                "/v2/coach/reply",
                json={"session_id": started.json()["session_id"], "text": answer},
                headers={**headers, "X-Request-Id": str(uuid4())},
            ).status_code
            == 200
        )

    completed = client.post(
        "/v2/coach/reply",
        json={"session_id": started.json()["session_id"], "text": "여기서 그만할게"},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert completed.status_code == 200
    assert completed.json()["status"] == "complete"
    assert completed.json()["report"]["report_type"] == "analysis"
    assert "## 배우의 마무리 요청" in coach.calls[-1][1]
    handoff_id = UUID(completed.json()["handoff"]["id"])
    assert store.confirmations[handoff_id].confirmed is True
    assert store.coach_sessions[started.json()["session_id"]].status == "closed"
    assert handoff_id in store.practice_reports


def test_stop_without_answers_returns_blocked_and_stores_no_report():
    client, store, _, report_generate, user, headers = _application(
        coach_responses=[COACH_FOLLOWUP, COACH_COMPLETE],
        report_responses=[REPORT.model_dump(mode="json")],
    )
    started = _start(client, store, user, headers)

    completed = client.post(
        "/v2/coach/reply",
        json={"session_id": started.json()["session_id"], "text": "그만"},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert completed.status_code == 200
    assert completed.json()["report"]["report_type"] == "blocked"
    assert store.practice_reports == {}
    assert report_generate.calls == []
    assert store.coach_sessions[started.json()["session_id"]].status == "closed"


def test_closing_word_is_not_copied_into_the_note():
    handoff = {
        **ANALYSIS_HANDOFF,
        "actor_words": ["그만", "상대를 붙잡고 싶었어요"],
    }
    client, store, _, report_generate, user, headers = _application(
        coach_responses=[
            COACH_FOLLOWUP,
            COACH_FOLLOWUP,
            COACH_FOLLOWUP,
            {**COACH_COMPLETE, "handoff": handoff},
        ],
        report_responses=[REPORT.model_dump(mode="json")],
    )
    started = _start(client, store, user, headers)
    for answer in ("상대를 붙잡고 싶었어요", "말이 안 통한다고 느꼈어요"):
        client.post(
            "/v2/coach/reply",
            json={"session_id": started.json()["session_id"], "text": answer},
            headers={**headers, "X-Request-Id": str(uuid4())},
        )

    client.post(
        "/v2/coach/reply",
        json={"session_id": started.json()["session_id"], "text": "그만"},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    sent_to_report = report_generate.calls[-1][1]
    assert "상대를 붙잡고 싶었어요" in sent_to_report
    assert '"그만"' not in sent_to_report


def test_expression_stop_before_experiment_returns_blocked_but_auto_confirms():
    client, store, _, report_generate, user, headers = _application(
        coach_responses=[COACH_FOLLOWUP, EXPRESSION_COMPLETE_WITHOUT_EXPERIMENT]
    )
    summary_id = store.seed_summary(
        user_id=user.id,
        blockage_kind="표현",
        sub_branch="화술",
        blockage_detail="대사처럼 들린다",
    )
    practice_session_id = store.summaries[summary_id].session_id
    started = client.post(
        "/v2/coach/start",
        json={"practice_session_id": str(practice_session_id)},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    completed = client.post(
        "/v2/coach/reply",
        json={"session_id": started.json()["session_id"], "text": "그만"},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert completed.status_code == 200
    assert completed.json()["status"] == "complete"
    assert completed.json()["report"] == {
        "report_type": "blocked",
        "reason": "confirmed_expression_handoff_required",
    }
    handoff_id = UUID(completed.json()["handoff"]["id"])
    assert store.confirmations[handoff_id].confirmed is True
    assert store.coach_sessions[started.json()["session_id"]].status == "closed"
    assert handoff_id not in store.practice_reports
    assert report_generate.calls == []


def test_unconfirmed_confirm_returns_blocked_without_any_model_call():
    client, _, coach, report, user, headers = _application(
        coach_responses=[COACH_COMPLETE],
        report_responses=[REPORT.model_dump(mode="json")],
    )
    started = _start(client, _, user, headers)
    coach_calls = len(coach.calls)
    report_calls = len(report.calls)

    response = client.post(
        "/v2/coach/confirm",
        json={
            "coach_session_id": started.json()["session_id"],
            "confirmed": False,
            "rebuttal_text": "아직 이 뜻은 아닌 것 같아.",
        },
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert response.status_code == 200
    assert response.json()["report"] == {
        "report_type": "blocked",
        "reason": "confirmed_analysis_handoff_required",
    }
    assert len(coach.calls) == coach_calls
    assert len(report.calls) == report_calls


def test_unconfirmed_confirm_requires_nonempty_rebuttal():
    client, store, _, _, user, headers = _application(
        coach_responses=[COACH_COMPLETE],
        report_responses=[REPORT.model_dump(mode="json")],
    )
    started = _start(client, store, user, headers)

    response = client.post(
        "/v2/coach/confirm",
        json={
            "coach_session_id": started.json()["session_id"],
            "confirmed": False,
            "rebuttal_text": "  ",
        },
        headers=headers,
    )

    assert response.status_code == 422


def test_confirm_true_generates_and_persists_report_in_same_idempotent_call():
    client, store, _, report_generate, user, headers = _application(
        coach_responses=[COACH_COMPLETE],
        report_responses=[REPORT.model_dump(mode="json")],
    )
    started = _start(client, store, user, headers)
    request_id = uuid4()
    body = {
        "coach_session_id": started.json()["session_id"],
        "confirmed": True,
        "rebuttal_text": None,
    }
    request_headers = {**headers, "X-Request-Id": str(request_id)}

    created = client.post("/v2/coach/confirm", json=body, headers=request_headers)
    replayed = client.post("/v2/coach/confirm", json=body, headers=request_headers)

    assert created.status_code == 200
    assert created.json()["report"]["report_type"] == "analysis"
    assert replayed.content == created.content
    assert len(report_generate.calls) == 1
    assert len(store.practice_reports) == 1


def test_confirmed_analysis_handoff_reaches_expression_prompt_for_same_upload():
    client, store, coach, _, user, headers = _application(
        coach_responses=[COACH_COMPLETE, COACH_FOLLOWUP],
        report_responses=[REPORT.model_dump(mode="json")],
    )
    analysis = _start(client, store, user, headers)
    confirmed = client.post(
        "/v2/coach/confirm",
        json={
            "coach_session_id": analysis.json()["session_id"],
            "confirmed": True,
            "rebuttal_text": None,
        },
        headers={**headers, "X-Request-Id": str(uuid4())},
    )
    assert confirmed.status_code == 200

    analysis_practice = next(iter(store.sessions.values()))
    analysis_summary = next(iter(store.summaries.values()))
    expression_id = uuid4()
    expression_summary_id = uuid4()
    store.sessions[expression_id] = SimpleNamespace(
        **{
            **vars(analysis_practice),
            "id": expression_id,
            "blockage_kind": "표현",
            "sub_branch": "화술",
            "blockage_detail": "대사처럼 들린다",
        }
    )
    store.summaries[expression_summary_id] = SimpleNamespace(
        **{
            **vars(analysis_summary),
            "id": expression_summary_id,
            "session_id": expression_id,
        }
    )

    expression = client.post(
        "/v2/coach/start",
        json={"practice_session_id": str(expression_id)},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert expression.status_code == 200
    prompt = coach.calls[-1][1]
    assert "## 이전 분석 세션에서 전달받은 입력 정보" in prompt
    assert "- line_meaning: 상대가 떠나기 전에 붙잡으려는 말" in prompt
    assert "- video_observations:" in prompt
    assert prompt.index("- video_observations:") < prompt.index("## 배우의 최신 말")


def test_reports_endpoint_blocks_unconfirmed_handoff_without_model_call():
    client, store, _, report_generate, user, headers = _application(
        coach_responses=[COACH_COMPLETE],
        report_responses=[REPORT.model_dump(mode="json")],
    )
    started = _start(client, store, user, headers)
    handoff_id = UUID(started.json()["handoff"]["id"])
    store.confirmations[handoff_id].confirmed = False
    store.practice_reports.pop(handoff_id, None)
    report_calls = len(report_generate.calls)

    response = client.post(
        "/v2/reports",
        json={"session_id": started.json()["session_id"]},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )

    assert response.status_code == 200
    assert response.json()["report_type"] == "blocked"
    assert len(report_generate.calls) == report_calls


def test_invalid_blockage_kind_sub_branch_combination_returns_422():
    client, store, _, _, user, headers = _application()
    upload = finalized_upload(store, user.id)

    response = client.post(
        "/v2/practice-sessions",
        json={
            "upload_intent_id": str(upload.id),
            "situation": "상황",
            "character_context": "인물",
            "goal": "상대가 멈추게 한다",
            "blockage_kind": "분석",
            "sub_branch": "표정",
            "blockage_detail": "",
        },
        headers=headers,
    )

    assert response.status_code == 422
