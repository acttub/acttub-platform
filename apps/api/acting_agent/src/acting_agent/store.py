from typing import Protocol

from acting_agent.schema import CoachSession
from acting_agent.summary_schema import SceneSummary, SubText


SummaryContext = tuple[SceneSummary, SubText]


class SessionWriteConflict(RuntimeError):
    """Raised when a stale session snapshot would overwrite newer turns."""


class SessionStore(Protocol):
    def get_summary(self, summary_id: str) -> SummaryContext | None: ...

    def create(self, session: CoachSession) -> CoachSession: ...

    def get(self, session_id: str) -> CoachSession | None: ...

    def save(self, session: CoachSession) -> CoachSession: ...


class InMemorySessionStore:
    def __init__(self):
        self._summaries: dict[str, SummaryContext] = {}
        self._sessions: dict[str, CoachSession] = {}

    def add_summary(
        self, summary_id: str, summary: SceneSummary, subtext: SubText
    ) -> None:
        self._summaries[summary_id] = (
            summary.model_copy(deep=True),
            subtext.model_copy(deep=True),
        )

    def get_summary(self, summary_id: str) -> SummaryContext | None:
        context = self._summaries.get(summary_id)
        if context is None:
            return None
        summary, subtext = context
        return summary.model_copy(deep=True), subtext.model_copy(deep=True)

    def create(self, session: CoachSession) -> CoachSession:
        stored = session.model_copy(deep=True)
        self._sessions[session.session_id] = stored
        return stored.model_copy(deep=True)

    def get(self, session_id: str) -> CoachSession | None:
        session = self._sessions.get(session_id)
        return session.model_copy(deep=True) if session is not None else None

    def save(self, session: CoachSession) -> CoachSession:
        stored = session.model_copy(deep=True)
        self._sessions[session.session_id] = stored
        return stored.model_copy(deep=True)
