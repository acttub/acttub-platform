from acting_report.store import InMemoryReportStore
from report_test_support import REPORT, SECOND_SESSION, SESSION


def test_context_lookup():
    store = InMemoryReportStore()
    store.seed_context("u1", SESSION)
    assert store.get_report_context(SESSION.session_id) == ("u1", SESSION)
    assert store.get_report_context(SECOND_SESSION.session_id) is None


def test_add_list_and_count_per_user():
    store = InMemoryReportStore()
    store.seed_context("u1", SESSION)
    assert store.add_report(SESSION.session_id, REPORT) is True
    assert store.count_reports("u1") == 1
    assert store.count_reports("u2") == 0
    record = store.list_reports("u1")[0]
    assert record.session_id == SESSION.session_id
    assert record.turns == SESSION.turns


def test_duplicate_session_report_rejected():
    store = InMemoryReportStore()
    store.seed_context("u1", SESSION)
    assert store.add_report(SESSION.session_id, REPORT) is True
    assert store.has_report(SESSION.session_id) is True
    assert store.add_report(SESSION.session_id, REPORT) is False
    assert store.count_reports("u1") == 1


def test_add_requires_seeded_context():
    store = InMemoryReportStore()
    assert store.add_report(SESSION.session_id, REPORT) is False
