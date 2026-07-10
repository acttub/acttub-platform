from acting_agent.schema import CoachSession


class InMemorySessionStore:
    def __init__(self):
        self._sessions: dict[str, CoachSession] = {}

    def create(self, session: CoachSession) -> CoachSession:
        self._sessions[session.session_id] = session
        return session

    def get(self, session_id: str) -> CoachSession | None:
        return self._sessions.get(session_id)

    def save(self, session: CoachSession) -> CoachSession:
        self._sessions[session.session_id] = session
        return session
