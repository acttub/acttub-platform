from datetime import datetime, timezone
from typing import Protocol

from acting_report.schema import ActingReport, ReportRecord
from acting_report.session_schema import CoachSession


class ReportStore(Protocol):
    def get_report_context(
        self, session_id: str
    ) -> tuple[str, CoachSession] | None: ...

    def list_reports(self, user_id: str) -> list[ReportRecord]: ...

    def has_report(self, session_id: str) -> bool: ...

    def add_report(self, session_id: str, report: ActingReport) -> bool: ...

    def count_reports(self, user_id: str) -> int: ...


class InMemoryReportStore:
    """DB-free fake that mirrors the report router's persistence contract."""

    def __init__(self):
        self._contexts: dict[str, tuple[str, CoachSession]] = {}
        self._records: dict[str, ReportRecord] = {}

    def seed_context(self, user_id: str, session: CoachSession) -> None:
        self._contexts[session.session_id] = (user_id, session)

    def get_report_context(self, session_id: str) -> tuple[str, CoachSession] | None:
        return self._contexts.get(session_id)

    def list_reports(self, user_id: str) -> list[ReportRecord]:
        return [
            record
            for session_id, record in self._records.items()
            if self._contexts[session_id][0] == user_id
        ]

    def has_report(self, session_id: str) -> bool:
        return session_id in self._records

    def add_report(self, session_id: str, report: ActingReport) -> bool:
        context = self._contexts.get(session_id)
        if context is None or self.has_report(session_id):
            return False
        _, session = context
        self._records[session_id] = ReportRecord(
            created_at=datetime.now(timezone.utc).isoformat(),
            session_id=session_id,
            report=report,
            turns=session.turns,
        )
        return True

    def count_reports(self, user_id: str) -> int:
        return len(self.list_reports(user_id))
