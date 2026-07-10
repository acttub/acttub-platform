import pytest

from acting_report import engine
from support import REPORT, SESSION, FakeClient, _Resp


def test_generate_report_parsed():
    client = FakeClient([_Resp(parsed=REPORT)])
    out = engine.generate_report(SESSION, [], client=client, model="m")
    assert out == REPORT
    assert len(client.models.calls) == 1


def test_generate_report_text_fallback():
    client = FakeClient([_Resp(text=REPORT.model_dump_json())])
    out = engine.generate_report(SESSION, [], client=client, model="m")
    assert out.headline == REPORT.headline


def test_generate_report_retry_then_success():
    client = FakeClient([_Resp(text="broken"), _Resp(parsed=REPORT)])
    out = engine.generate_report(SESSION, [], client=client, model="m")
    assert out == REPORT
    assert len(client.models.calls) == 2


def test_generate_report_fails_after_retry():
    client = FakeClient([_Resp(text="broken"), _Resp(text="still broken")])
    with pytest.raises(engine.ReportParseError):
        engine.generate_report(SESSION, [], client=client, model="m")
