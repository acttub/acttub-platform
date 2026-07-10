from fastapi.testclient import TestClient

from acting_report.app import create_app
from acting_report.config import Settings
from acting_report.store import FileReportStore
from support import REPORT, SESSION, FakeClient, _Resp


def _app(responses, tmp_path):
    return create_app(
        client=FakeClient(responses),
        settings=Settings(api_key="k", model="m"),
        store=FileReportStore(tmp_path / "reports.json"),
    )


def test_report_flow_and_history(tmp_path):
    app = _app([_Resp(parsed=REPORT)], tmp_path)
    c = TestClient(app)
    r = c.post("/report", json={"user_id": "u1", "session": SESSION.model_dump()})
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


def test_second_report_sees_previous(tmp_path):
    fake = FakeClient([_Resp(parsed=REPORT), _Resp(parsed=REPORT)])
    app = create_app(
        client=fake,
        settings=Settings(api_key="k", model="m"),
        store=FileReportStore(tmp_path / "reports.json"),
    )
    c = TestClient(app)
    c.post("/report", json={"user_id": "u1", "session": SESSION.model_dump()})
    r2 = c.post("/report", json={"user_id": "u1", "session": SESSION.model_dump()})
    assert r2.json()["report_count"] == 2
    assert c.get("/report/history/u1").json()["count"] == 2

    # 두 번째 호출의 프롬프트에는 이전 리포트 내용이 들어가야 한다
    first_prompt = fake.models.calls[0][1][0]
    second_prompt = fake.models.calls[1][1][0]
    assert "이전 리포트 없음" in first_prompt
    assert REPORT.biggest_problem.description in second_prompt


def test_parse_failure_returns_502(tmp_path):
    app = _app([_Resp(text="nope"), _Resp(text="still nope")], tmp_path)
    c = TestClient(app)
    r = c.post("/report", json={"user_id": "u1", "session": SESSION.model_dump()})
    assert r.status_code == 502
    # 실패한 리포트는 저장되지 않는다
    assert c.get("/report/history/u1").json()["count"] == 0
