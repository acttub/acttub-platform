from acting_report.store import FileReportStore
from support import PREV_RECORD


def test_empty_store(tmp_path):
    store = FileReportStore(tmp_path / "reports.json")
    assert store.list("u1") == []
    assert store.latest("u1") is None


def test_add_and_list_per_user(tmp_path):
    store = FileReportStore(tmp_path / "reports.json")
    store.add("u1", PREV_RECORD)
    assert len(store.list("u1")) == 1
    assert store.list("u2") == []


def test_persists_across_instances(tmp_path):
    path = tmp_path / "reports.json"
    FileReportStore(path).add("u1", PREV_RECORD)
    reopened = FileReportStore(path)
    assert reopened.latest("u1").session_id == "sid0"


def test_latest_is_last_added(tmp_path):
    store = FileReportStore(tmp_path / "reports.json")
    store.add("u1", PREV_RECORD)
    second = PREV_RECORD.model_copy(update={"session_id": "sid1"})
    store.add("u1", second)
    assert store.latest("u1").session_id == "sid1"
