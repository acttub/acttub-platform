from acting_report.schema import ActingReport, ReportRecord
from support import PREV_RECORD, REPORT


def test_report_roundtrip():
    dumped = REPORT.model_dump_json()
    loaded = ActingReport.model_validate_json(dumped)
    assert loaded == REPORT


def test_comparison_defaults_empty():
    assert REPORT.comparison == ""


def test_record_roundtrip():
    loaded = ReportRecord.model_validate(PREV_RECORD.model_dump())
    assert loaded.session_id == "sid0"
    assert loaded.report.biggest_problem.dimension == "시선"
