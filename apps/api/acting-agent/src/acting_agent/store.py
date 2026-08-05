from typing import Protocol

from acting_agent.schema import CoachSession
from acting_agent.summary_schema import ActorMaterial, ObservationPack


PracticeContext = tuple[ObservationPack | None, ActorMaterial, str, list[str]]


class SessionWriteConflict(RuntimeError):
    """Raised when a stale session snapshot would overwrite newer turns."""


class SessionStore(Protocol):
    def get_practice_context(
        self, practice_session_id: str
    ) -> PracticeContext | None: ...

    def create(self, session: CoachSession) -> CoachSession: ...

    def get(self, session_id: str) -> CoachSession | None: ...

    def save(self, session: CoachSession) -> CoachSession: ...


class InMemorySessionStore:
    def __init__(self):
        self._practices: dict[str, PracticeContext] = {}
        self._sessions: dict[str, CoachSession] = {}

    def add_practice_session(
        self,
        practice_session_id: str,
        observation_pack: ObservationPack | None,
        actor: ActorMaterial,
        sub_branch: str = "그 외",
        transcripts: list[str] | None = None,
    ) -> None:
        self._practices[practice_session_id] = (
            (
                observation_pack.model_copy(deep=True)
                if observation_pack is not None
                else None
            ),
            actor.model_copy(deep=True),
            sub_branch,
            list(transcripts or ()),
        )

    def get_practice_context(
        self, practice_session_id: str
    ) -> PracticeContext | None:
        context = self._practices.get(practice_session_id)
        if context is None:
            return None
        observation_pack, actor, sub_branch, transcripts = context
        return (
            (
                observation_pack.model_copy(deep=True)
                if observation_pack is not None
                else None
            ),
            actor.model_copy(deep=True),
            sub_branch,
            list(transcripts),
        )

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
