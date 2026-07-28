from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.dialects import postgresql

from acting_api.db.models import Report as DbReport
from acting_api.db.store import PostgresStore
from api_test_support import REPORT


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def __iter__(self):
        return iter(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None


class _Session:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, statement):
        self.statements.append(statement)
        return _Result(self.rows)


def _store_with_rows(rows):
    session = _Session(rows)
    store = PostgresStore.__new__(PostgresStore)
    store._session_factory = lambda: session
    return store, session


def _sql(statement) -> str:
    return str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


def _db_report(*, created_at):
    return DbReport(
        id=uuid4(),
        session_id=uuid4(),
        headline=REPORT.headline,
        biggest_problem=REPORT.biggest_problem.model_dump(mode="json"),
        evidence=REPORT.evidence,
        self_discovery=REPORT.self_discovery,
        encouragement=REPORT.encouragement,
        next_step=REPORT.next_step,
        comparison=REPORT.comparison,
        created_at=created_at,
    )


def test_list_reports_keeps_full_bodies_and_filters_hidden_practice_sessions():
    user_id = uuid4()
    practice_session_id = uuid4()
    report = _db_report(created_at=datetime(2026, 7, 20, tzinfo=timezone.utc))
    store, session = _store_with_rows([(report, practice_session_id)])

    records = store.list_reports(user_id)

    assert len(records) == 1
    assert records[0].practice_session_id == str(practice_session_id)
    assert records[0].report == REPORT
    assert "practice_sessions.hidden_at IS NULL" in _sql(session.statements[0])


def test_list_report_summaries_selects_slim_rows_and_filters_hidden_sessions():
    user_id = uuid4()
    practice_session_id = uuid4()
    created_at = datetime(2026, 7, 21, tzinfo=timezone.utc)
    store, session = _store_with_rows(
        [(practice_session_id, REPORT.headline, created_at)]
    )

    records = store.list_report_summaries(user_id)

    assert len(records) == 1
    assert records[0].practice_session_id == practice_session_id
    assert records[0].headline == REPORT.headline
    assert records[0].created_at == created_at
    statement_sql = _sql(session.statements[0])
    assert "practice_sessions.hidden_at IS NULL" in statement_sql
    assert "reports.evidence" not in statement_sql
    assert "reports.next_step" not in statement_sql


def test_report_detail_query_returns_body_and_object_key_in_one_latest_row_query():
    user_id = uuid4()
    practice_session_id = uuid4()
    created_at = datetime(2026, 7, 22, tzinfo=timezone.utc)
    object_key = f"users/{user_id}/latest.mp4"
    report = _db_report(created_at=created_at)
    store, session = _store_with_rows(
        [(report, practice_session_id, object_key)]
    )

    detail = store.get_report_detail_for_practice_session(
        user_id=user_id,
        practice_session_id=practice_session_id,
    )

    assert detail.practice_session_id == practice_session_id
    assert detail.created_at == created_at
    assert detail.report == REPORT
    assert detail.object_key == object_key
    assert len(session.statements) == 1
    statement_sql = _sql(session.statements[0])
    assert "practice_sessions.user_id" in statement_sql
    assert "practice_sessions.hidden_at IS NULL" in statement_sql
    assert "upload_intents.object_key" in statement_sql
    assert "ORDER BY reports.created_at DESC, reports.id DESC" in statement_sql
    assert "LIMIT 1" in statement_sql


def test_report_count_query_excludes_hidden_practice_sessions():
    statement_sql = _sql(PostgresStore._report_count_query(uuid4()))

    assert "practice_sessions.hidden_at IS NULL" in statement_sql


def test_report_count_query_counts_distinct_practice_sessions():
    # 한 practice_session에 리포트가 여럿이어도 서수·count가 부풀지 않도록 distinct.
    statement_sql = _sql(PostgresStore._report_count_query(uuid4())).lower()

    assert "count(distinct(practice_sessions.id))" in statement_sql


def test_report_count_query_anchors_from_on_reports():
    # count 컬럼이 practice_sessions만 참조하므로 FROM 앵커를 reports로 명시하지
    # 않으면 practice_sessions가 FROM에 두 번 들어가고 reports가 빠져 Postgres가
    # "missing FROM-clause entry for table reports"로 500을 낸다(regression).
    statement_sql = _sql(PostgresStore._report_count_query(uuid4()))

    assert "FROM reports" in statement_sql
    # practice_sessions는 JOIN 대상으로 정확히 한 번만 등장해야 한다.
    assert statement_sql.count("practice_sessions ON") <= 1


def test_list_report_summaries_dedupes_to_latest_report_per_practice_session():
    user_id = uuid4()
    practice_session_id = uuid4()
    older = datetime(2026, 7, 18, tzinfo=timezone.utc)
    newer = datetime(2026, 7, 20, tzinfo=timezone.utc)
    # 같은 practice_session의 리포트 2건(순서 무관) — 최신 1건만 남아야 한다.
    store, _ = _store_with_rows(
        [
            (practice_session_id, "오래된 헤드라인", older),
            (practice_session_id, "최신 헤드라인", newer),
        ]
    )

    records = store.list_report_summaries(user_id)

    assert len(records) == 1
    assert records[0].practice_session_id == practice_session_id
    assert records[0].headline == "최신 헤드라인"
    assert records[0].created_at == newer
