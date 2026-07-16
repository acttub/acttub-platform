from datetime import datetime, timezone
from uuid import uuid4

from acting_agent.schema import CoachReply, CoachSession
from acting_agent.summary_schema import SceneSummary as AgentSceneSummary
from acting_agent.summary_schema import SubText as AgentSubText
from acting_api.security import hash_api_key
from acting_report.schema import ActingReport, BiggestProblem, ReportRecord
from acting_report.session_schema import CoachSession as ReportCoachSession
from acting_report.session_schema import CoachTurn as ReportCoachTurn
from acting_report.summary_schema import SceneSummary as ReportSceneSummary
from acting_report.summary_schema import SubText as ReportSubText
from acting_summary.schema import Anomaly, Observation, SceneSummary, SubText

SUMMARY_ID = "11111111-1111-4111-8111-111111111111"
SESSION_ID = "22222222-2222-4222-8222-222222222222"

SUBTEXT = SubText(situation="상황", character="인물", subtext="서브")
SUMMARY = SceneSummary(
    observation=Observation(
        timeline="t",
        dialogue="d",
        tempo="te",
        pitch="p",
        movement="m",
        expression="e",
        emotion="em",
    ),
    summary="s",
    intent_alignment="i",
    key_moment="00:10-00:15 절정 구간",
    key_dimension="템포",
    anomalies=[
        Anomaly(
            start="00:12",
            end="00:13",
            dimension="템포",
            what="1.2초 멈춤",
            why_odd="o",
            likely_cause="c",
            impact_on_intent="ii",
            overlaps_key_moment=True,
            on_key_dimension=True,
            intent_impact="반전",
            severity="high",
            severity_reason="key_moment 구간",
        )
    ],
)
AGENT_SUMMARY = AgentSceneSummary.model_validate(SUMMARY.model_dump(mode="json"))
REPORT_SUMMARY = ReportSceneSummary.model_validate(SUMMARY.model_dump(mode="json"))

COACH_QUESTION = CoachReply(
    action="probe_intent",
    utterance="그 멈춤, 의도한 거야?",
    focus_timestamp="00:12",
)
COACH_FOLLOWUP = CoachReply(action="dig_cause", utterance="그 순간 무슨 생각 했어?")

REPORT = ActingReport(
    headline="오늘은 멈춤의 이유를 스스로 찾아냈어",
    biggest_problem=BiggestProblem(
        start="00:12",
        end="00:13",
        dimension="템포",
        description="가장 중요한 순간에 말이 1.2초 멈추면서 흐름이 끊겼어",
    ),
    evidence="00:12에 1.2초 멈춤",
    self_discovery="대사 암기가 불안하면 감정이 끊긴다는 걸 찾아냈어",
    encouragement="원인을 바로 짚어낸 게 좋았어",
    next_step="대사만 소리 내서 세 번 통으로 말해보기",
    comparison="",
)


class FakeGatewayStore:
    def __init__(self, api_keys: dict[str, int] | None = None):
        self._key_limits = {
            hash_api_key(key): limit for key, limit in (api_keys or {}).items()
        }
        self._summaries: dict[str, dict] = {}
        self._sessions: dict[str, CoachSession] = {}
        self._reports: dict[str, ReportRecord] = {}
        self.closed = False

    def get_api_key_rate_limit(self, key_hash: str) -> int | None:
        return self._key_limits.get(key_hash)

    def create_summary(
        self,
        *,
        user_id: str,
        subtext: SubText,
        summary: SceneSummary,
        video_filename: str | None,
        video_size_bytes: int,
        was_compressed: bool,
        model: str,
    ) -> str:
        summary_id = str(uuid4())
        self.seed_summary(
            summary_id,
            user_id=user_id,
            summary=summary,
            subtext=subtext,
            video_filename=video_filename,
            video_size_bytes=video_size_bytes,
            was_compressed=was_compressed,
            model=model,
        )
        return summary_id

    def seed_summary(
        self,
        summary_id: str = SUMMARY_ID,
        *,
        user_id: str = "u1",
        summary: SceneSummary = SUMMARY,
        subtext: SubText = SUBTEXT,
        **metadata,
    ) -> str:
        self._summaries[summary_id] = {
            "user_id": user_id,
            "raw": summary.model_dump(mode="json"),
            "subtext": subtext.model_dump(mode="json"),
            **metadata,
        }
        return summary_id

    def get_summary(self, summary_id: str):
        record = self._summaries.get(summary_id)
        if record is None:
            return None
        return (
            AgentSceneSummary.model_validate(record["raw"]),
            AgentSubText.model_validate(record["subtext"]),
        )

    def create(self, session: CoachSession) -> CoachSession:
        self._sessions[session.session_id] = session.model_copy(deep=True)
        return session.model_copy(deep=True)

    def get(self, session_id: str) -> CoachSession | None:
        session = self._sessions.get(session_id)
        return session.model_copy(deep=True) if session else None

    def save(self, session: CoachSession) -> CoachSession:
        self._sessions[session.session_id] = session.model_copy(deep=True)
        return session.model_copy(deep=True)

    def get_report_context(self, session_id: str):
        session = self._sessions.get(session_id)
        if session is None:
            return None
        summary_record = self._summaries[session.summary_id]
        report_session = ReportCoachSession(
            session_id=session.session_id,
            summary=ReportSceneSummary.model_validate(summary_record["raw"]),
            subtext=ReportSubText.model_validate(summary_record["subtext"]),
            turns=[
                ReportCoachTurn(role=turn.role, text=turn.text)
                for turn in session.turns
            ],
            question_count=session.question_count,
            status=session.status,
            close_reason=session.close_reason,
        )
        return summary_record["user_id"], report_session

    def list_reports(self, user_id: str) -> list[ReportRecord]:
        return [
            record.model_copy(deep=True)
            for session_id, record in self._reports.items()
            if self._summaries[self._sessions[session_id].summary_id]["user_id"]
            == user_id
        ]

    def has_report(self, session_id: str) -> bool:
        return session_id in self._reports

    def add_report(self, session_id: str, report: ActingReport) -> bool:
        context = self.get_report_context(session_id)
        if context is None or self.has_report(session_id):
            return False
        _, session = context
        self._reports[session_id] = ReportRecord(
            created_at=datetime.now(timezone.utc).isoformat(),
            session_id=session_id,
            report=report,
            turns=session.turns,
        )
        return True

    def count_reports(self, user_id: str) -> int:
        return len(self.list_reports(user_id))

    def close(self) -> None:
        self.closed = True


class _Resp:
    def __init__(self, parsed=None, text=None):
        self.parsed, self.text = parsed, text


class _Models:
    def __init__(self, responses):
        self._responses, self.calls = list(responses), []

    def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))
        return self._responses.pop(0)


class FakeClient:
    def __init__(self, responses=()):
        self.models = _Models(responses)
