from fastapi.testclient import TestClient

from acting_report.app import create_app
from acting_report.config import Settings
from acting_report.store import InMemoryReportStore
from report_test_support import REPORT, SECOND_SESSION, SESSION, FakeClient, _Resp


def _app(responses, *contexts):
    store = InMemoryReportStore()
    for user_id, session in contexts or (("u1", SESSION),):
        store.seed_context(user_id, session)
    app = create_app(
        client=FakeClient(responses),
        settings=Settings(api_key="k", model="m"),
        store=store,
    )
    return app, store


def test_report_flow_and_history():
    app, _ = _app([_Resp(parsed=REPORT)])
    c = TestClient(app)
    r = c.post("/report", json={"session_id": SESSION.session_id})
    assert r.status_code == 200
    body = r.json()
    assert body["report_count"] == 1
    assert body["report"]["headline"] == REPORT.headline

    h = c.get("/report/history/u1")
    assert h.status_code == 200
    assert h.json()["count"] == 1
    # 대화 원문도 함께 저장된다
    assert h.json()["reports"][0]["turns"] == [t.model_dump() for t in SESSION.turns]
    assert c.get("/report/history/u2").json()["count"] == 0


def test_second_report_sees_previous():
    fake = FakeClient([_Resp(parsed=REPORT), _Resp(parsed=REPORT)])
    store = InMemoryReportStore()
    store.seed_context("u1", SESSION)
    store.seed_context("u1", SECOND_SESSION)
    app = create_app(
        client=fake,
        settings=Settings(api_key="k", model="m"),
        store=store,
    )
    c = TestClient(app)
    c.post("/report", json={"session_id": SESSION.session_id})
    r2 = c.post("/report", json={"session_id": SECOND_SESSION.session_id})
    assert r2.json()["report_count"] == 2
    assert c.get("/report/history/u1").json()["count"] == 2

    # 두 번째 호출의 프롬프트에는 이전 리포트 내용이 들어가야 한다
    first_prompt = fake.models.calls[0][1][0]
    second_prompt = fake.models.calls[1][1][0]
    assert "이전 리포트 없음" in first_prompt
    assert REPORT.biggest_problem.description in second_prompt


def test_parse_failure_returns_502():
    app, _ = _app([_Resp(text="nope"), _Resp(text="still nope")])
    c = TestClient(app)
    r = c.post("/report", json={"session_id": SESSION.session_id})
    assert r.status_code == 502
    # 실패한 리포트는 저장되지 않는다
    assert c.get("/report/history/u1").json()["count"] == 0


def test_unknown_session_404():
    app, _ = _app([])
    c = TestClient(app)
    r = c.post("/report", json={"session_id": "00000000-0000-4000-8000-000000000099"})
    assert r.status_code == 404
    assert r.json()["detail"] == "session not found"


def test_open_session_409_without_generation_or_report_reservation():
    open_session = SESSION.model_copy(update={"status": "open", "close_reason": ""})
    fake = FakeClient([_Resp(parsed=REPORT)])
    store = InMemoryReportStore()
    store.seed_context("u1", open_session)
    app = create_app(
        client=fake,
        settings=Settings(api_key="k", model="m"),
        store=store,
    )
    c = TestClient(app)
    payload = {"session_id": SESSION.session_id}

    rejected = c.post("/report", json=payload)

    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "session is still open"}
    assert fake.models.calls == []
    assert store.has_report(SESSION.session_id) is False

    store.seed_context("u1", SESSION)
    assert c.post("/report", json=payload).status_code == 200
    assert len(fake.models.calls) == 1


def test_duplicate_report_409_without_second_generation():
    fake = FakeClient([_Resp(parsed=REPORT)])
    store = InMemoryReportStore()
    store.seed_context("u1", SESSION)
    app = create_app(
        client=fake,
        settings=Settings(api_key="k", model="m"),
        store=store,
    )
    c = TestClient(app)
    payload = {"session_id": SESSION.session_id}
    assert c.post("/report", json=payload).status_code == 200
    duplicate = c.post("/report", json=payload)
    assert duplicate.status_code == 409
    assert len(fake.models.calls) == 1


def test_invalid_session_id_422():
    app, _ = _app([])
    response = TestClient(app).post("/report", json={"session_id": "not-a-uuid"})
    assert response.status_code == 422


def test_report_rejects_legacy_fields_even_with_session_id():
    app, _ = _app([])
    response = TestClient(app).post(
        "/report",
        json={"session_id": SESSION.session_id, "user_id": "u1", "session": {}},
    )
    assert response.status_code == 422
