from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import Engine, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from acting_agent.schema import CoachSession as AgentCoachSession
from acting_agent.schema import CoachTurn as AgentCoachTurn
from acting_agent.store import SessionWriteConflict
from acting_agent.summary_schema import SceneSummary as AgentSceneSummary
from acting_agent.summary_schema import SubText as AgentSubText
from acting_api.db.engine import create_db_engine, create_session_factory
from acting_api.db.models import (
    Anomaly as DbAnomaly,
    ApiKey,
    CloseReason,
    CoachSession as DbCoachSession,
    CoachTurn as DbCoachTurn,
    IntentImpact,
    Report as DbReport,
    Scene,
    SessionStatus,
    Severity,
    Summary,
    TurnRole,
    User,
)
from acting_report.schema import ActingReport, BiggestProblem, ReportRecord
from acting_report.session_schema import CoachSession as ReportCoachSession
from acting_report.session_schema import CoachTurn as ReportCoachTurn
from acting_report.summary_schema import SceneSummary as ReportSceneSummary
from acting_report.summary_schema import SubText as ReportSubText
from acting_summary.schema import SceneSummary as SummarySceneSummary
from acting_summary.schema import SubText as SummarySubText


@dataclass(frozen=True)
class ApiKeyRecord:
    id: UUID
    label: str
    rate_limit_per_min: int
    is_active: bool
    created_at: datetime
    revoked_at: datetime | None


@dataclass(frozen=True)
class _SessionData:
    session_id: UUID
    summary_id: UUID
    raw_summary: dict
    situation: str
    character: str
    subtext: str
    status: str
    close_reason: str
    turns: list[DbCoachTurn]

    @property
    def question_count(self) -> int:
        return sum(
            turn.role == TurnRole.AI and turn.action not in (None, "close")
            for turn in self.turns
        )


class PostgresStore:
    def __init__(self, engine: Engine):
        self._engine = engine
        self._session_factory: sessionmaker[Session] = create_session_factory(engine)

    @classmethod
    def from_url(cls, database_url: str) -> "PostgresStore":
        return cls(create_db_engine(database_url, pool_pre_ping=True))

    def close(self) -> None:
        self._engine.dispose()

    # ---- API keys ----

    def get_api_key_rate_limit(self, key_hash: str) -> int | None:
        with self._session_factory() as db:
            return db.scalar(
                select(ApiKey.rate_limit_per_min).where(
                    ApiKey.key_hash == key_hash,
                    ApiKey.is_active.is_(True),
                )
            )

    def create_api_key(
        self, *, key_hash: str, label: str, rate_limit_per_min: int
    ) -> ApiKeyRecord:
        row = ApiKey(
            id=uuid4(),
            key_hash=key_hash,
            label=label,
            rate_limit_per_min=rate_limit_per_min,
        )
        with self._session_factory.begin() as db:
            db.add(row)
        return self._api_key_record(row)

    def revoke_api_key(self, key_id: UUID) -> bool:
        with self._session_factory.begin() as db:
            result = db.execute(
                update(ApiKey)
                .where(ApiKey.id == key_id, ApiKey.is_active.is_(True))
                .values(is_active=False, revoked_at=datetime.now(timezone.utc))
            )
            return bool(result.rowcount)

    def list_api_keys(self) -> list[ApiKeyRecord]:
        with self._session_factory() as db:
            rows = db.scalars(select(ApiKey).order_by(ApiKey.created_at, ApiKey.id))
            return [self._api_key_record(row) for row in rows]

    @staticmethod
    def _api_key_record(row: ApiKey) -> ApiKeyRecord:
        return ApiKeyRecord(
            id=row.id,
            label=row.label,
            rate_limit_per_min=row.rate_limit_per_min,
            is_active=row.is_active,
            created_at=row.created_at,
            revoked_at=row.revoked_at,
        )

    # ---- summary ----

    def create_summary(
        self,
        *,
        user_id: str,
        subtext: SummarySubText,
        summary: SummarySceneSummary,
        video_filename: str | None,
        video_size_bytes: int,
        was_compressed: bool,
        model: str,
    ) -> str:
        summary_id = uuid4()
        raw = summary.model_dump(mode="json")
        with self._session_factory.begin() as db:
            internal_user_id = db.scalar(
                insert(User)
                .values(id=uuid4(), external_id=user_id)
                .on_conflict_do_nothing(index_elements=[User.external_id])
                .returning(User.id)
            )
            if internal_user_id is None:
                internal_user_id = db.scalar(
                    select(User.id).where(User.external_id == user_id)
                )
            scene_id = uuid4()
            scene = Scene(
                id=scene_id,
                user_id=internal_user_id,
                situation=subtext.situation,
                character=subtext.character,
                subtext=subtext.subtext,
                video_filename=video_filename,
                video_size_bytes=video_size_bytes,
                was_compressed=was_compressed,
                model=model,
            )
            db.add(scene)
            db.flush()
            summary_row = Summary(
                id=summary_id,
                scene_id=scene_id,
                observation=raw["observation"],
                summary=summary.summary,
                intent_alignment=summary.intent_alignment,
                key_moment=summary.key_moment,
                key_dimension=summary.key_dimension,
                raw=raw,
            )
            db.add(summary_row)
            db.flush()
            for sort_order, anomaly in enumerate(raw["anomalies"]):
                db.add(
                    DbAnomaly(
                        summary_id=summary_id,
                        sort_order=sort_order,
                        start_ts=anomaly["start"],
                        end_ts=anomaly["end"],
                        dimension=anomaly["dimension"],
                        what=anomaly["what"],
                        why_odd=anomaly["why_odd"],
                        likely_cause=anomaly["likely_cause"],
                        impact_on_intent=anomaly["impact_on_intent"],
                        overlaps_key_moment=anomaly["overlaps_key_moment"],
                        on_key_dimension=anomaly["on_key_dimension"],
                        intent_impact=IntentImpact(anomaly["intent_impact"]),
                        severity=Severity(anomaly["severity"]),
                        severity_reason=anomaly["severity_reason"],
                    )
                )
        return str(summary_id)

    def get_summary(
        self, summary_id: str
    ) -> tuple[AgentSceneSummary, AgentSubText] | None:
        with self._session_factory() as db:
            row = db.execute(
                select(
                    Summary.raw,
                    Scene.situation,
                    Scene.character,
                    Scene.subtext,
                )
                .join(Scene, Summary.scene_id == Scene.id)
                .where(Summary.id == UUID(summary_id))
            ).one_or_none()
            if row is None:
                return None
            raw, situation, character, subtext = row
            return (
                AgentSceneSummary.model_validate(raw),
                AgentSubText(
                    situation=situation,
                    character=character,
                    subtext=subtext,
                ),
            )

    # ---- coach ----

    def create(self, session: AgentCoachSession) -> AgentCoachSession:
        with self._session_factory.begin() as db:
            db.add(
                DbCoachSession(
                    id=UUID(session.session_id),
                    summary_id=UUID(session.summary_id),
                    status=SessionStatus(session.status),
                    close_reason=(
                        CloseReason(session.close_reason)
                        if session.close_reason
                        else None
                    ),
                )
            )
            for index, turn in enumerate(session.turns):
                db.add(self._coach_turn(UUID(session.session_id), index, turn))
        return session

    def get(self, session_id: str) -> AgentCoachSession | None:
        with self._session_factory() as db:
            data = self._load_session(db, UUID(session_id))
            if data is None:
                return None
            return AgentCoachSession(
                session_id=str(data.session_id),
                summary_id=str(data.summary_id),
                summary=AgentSceneSummary.model_validate(data.raw_summary),
                subtext=AgentSubText(
                    situation=data.situation,
                    character=data.character,
                    subtext=data.subtext,
                ),
                turns=[
                    AgentCoachTurn(
                        role=turn.role.value,
                        text=turn.text,
                        action=turn.action,
                        focus_timestamp=turn.focus_timestamp,
                    )
                    for turn in data.turns
                ],
                question_count=data.question_count,
                status=data.status,
                close_reason=data.close_reason,
            )

    def save(self, session: AgentCoachSession) -> AgentCoachSession:
        session_id = UUID(session.session_id)
        with self._session_factory.begin() as db:
            db_session = db.scalar(
                select(DbCoachSession)
                .where(DbCoachSession.id == session_id)
                .with_for_update()
            )
            if db_session is None:
                raise LookupError("session not found")
            stored_turns = list(
                db.scalars(
                    select(DbCoachTurn)
                    .where(DbCoachTurn.session_id == session_id)
                    .order_by(DbCoachTurn.turn_index)
                )
            )
            if len(session.turns) < len(stored_turns):
                raise SessionWriteConflict("session turns are stale")
            for stored, incoming in zip(stored_turns, session.turns, strict=False):
                if (
                    stored.role.value != incoming.role
                    or stored.text != incoming.text
                    or stored.action != incoming.action
                    or stored.focus_timestamp != incoming.focus_timestamp
                ):
                    raise SessionWriteConflict("session turns changed concurrently")
            if db_session.status == SessionStatus.CLOSED and (
                session.status != SessionStatus.CLOSED.value
                or len(session.turns) > len(stored_turns)
            ):
                raise SessionWriteConflict("closed session changed concurrently")
            for index in range(len(stored_turns), len(session.turns)):
                db.add(self._coach_turn(session_id, index, session.turns[index]))
            db_session.status = SessionStatus(session.status)
            db_session.close_reason = (
                CloseReason(session.close_reason) if session.close_reason else None
            )
            db_session.updated_at = datetime.now(timezone.utc)
        return session

    @staticmethod
    def _coach_turn(session_id: UUID, index: int, turn: AgentCoachTurn) -> DbCoachTurn:
        return DbCoachTurn(
            session_id=session_id,
            turn_index=index,
            role=TurnRole(turn.role),
            text=turn.text,
            action=turn.action,
            focus_timestamp=turn.focus_timestamp,
        )

    # ---- report ----

    def get_report_context(
        self, session_id: str
    ) -> tuple[str, ReportCoachSession] | None:
        with self._session_factory() as db:
            data = self._load_session(db, UUID(session_id))
            if data is None:
                return None
            external_id = db.scalar(
                select(User.external_id)
                .join(Scene, Scene.user_id == User.id)
                .join(Summary, Summary.scene_id == Scene.id)
                .where(Summary.id == data.summary_id)
            )
            return external_id, ReportCoachSession(
                session_id=str(data.session_id),
                summary=ReportSceneSummary.model_validate(data.raw_summary),
                subtext=ReportSubText(
                    situation=data.situation,
                    character=data.character,
                    subtext=data.subtext,
                ),
                turns=[
                    ReportCoachTurn(role=turn.role.value, text=turn.text)
                    for turn in data.turns
                ],
                question_count=data.question_count,
                status=data.status,
                close_reason=data.close_reason,
            )

    def has_report(self, session_id: str) -> bool:
        with self._session_factory() as db:
            return (
                db.scalar(
                    select(DbReport.id).where(DbReport.session_id == UUID(session_id))
                )
                is not None
            )

    def add_report(self, session_id: str, report: ActingReport) -> bool:
        db = self._session_factory()
        try:
            with db.begin():
                db.add(
                    DbReport(
                        id=uuid4(),
                        session_id=UUID(session_id),
                        headline=report.headline,
                        biggest_problem=report.biggest_problem.model_dump(mode="json"),
                        evidence=report.evidence,
                        self_discovery=report.self_discovery,
                        encouragement=report.encouragement,
                        next_step=report.next_step,
                        comparison=report.comparison,
                    )
                )
            return True
        except IntegrityError as exc:
            if self._is_duplicate_report_error(exc):
                return False
            raise
        finally:
            db.close()

    def count_reports(self, user_id: str) -> int:
        with self._session_factory() as db:
            return db.scalar(self._report_count_query(user_id)) or 0

    def list_reports(self, user_id: str) -> list[ReportRecord]:
        with self._session_factory() as db:
            reports = list(
                db.scalars(
                    select(DbReport)
                    .join(DbCoachSession, DbReport.session_id == DbCoachSession.id)
                    .join(Summary, DbCoachSession.summary_id == Summary.id)
                    .join(Scene, Summary.scene_id == Scene.id)
                    .join(User, Scene.user_id == User.id)
                    .where(User.external_id == user_id)
                    .order_by(DbReport.created_at, DbReport.id)
                )
            )
            turns_by_session: dict[UUID, list[DbCoachTurn]] = {
                report.session_id: [] for report in reports
            }
            if turns_by_session:
                turns = db.scalars(
                    select(DbCoachTurn)
                    .where(DbCoachTurn.session_id.in_(turns_by_session))
                    .order_by(DbCoachTurn.session_id, DbCoachTurn.turn_index)
                )
                for turn in turns:
                    turns_by_session[turn.session_id].append(turn)
            records = []
            for report in reports:
                records.append(
                    ReportRecord(
                        created_at=report.created_at.isoformat(),
                        session_id=str(report.session_id),
                        report=ActingReport(
                            headline=report.headline,
                            biggest_problem=BiggestProblem.model_validate(
                                report.biggest_problem
                            ),
                            evidence=report.evidence,
                            self_discovery=report.self_discovery,
                            encouragement=report.encouragement,
                            next_step=report.next_step,
                            comparison=report.comparison,
                        ),
                        turns=[
                            ReportCoachTurn(role=turn.role.value, text=turn.text)
                            for turn in turns_by_session[report.session_id]
                        ],
                    )
                )
            return records

    @staticmethod
    def _is_duplicate_report_error(exc: IntegrityError) -> bool:
        original = exc.orig
        diagnostic = getattr(original, "diag", None)
        return (
            getattr(original, "sqlstate", None) == "23505"
            and getattr(diagnostic, "constraint_name", None) == "reports_session_id_key"
        )

    @staticmethod
    def _report_count_query(user_id: str):
        return (
            select(func.count(DbReport.id))
            .join(DbCoachSession, DbReport.session_id == DbCoachSession.id)
            .join(Summary, DbCoachSession.summary_id == Summary.id)
            .join(Scene, Summary.scene_id == Scene.id)
            .join(User, Scene.user_id == User.id)
            .where(User.external_id == user_id)
        )

    @staticmethod
    def _load_session(db: Session, session_id: UUID) -> _SessionData | None:
        row = db.execute(
            select(
                DbCoachSession,
                Summary.raw,
                Scene.situation,
                Scene.character,
                Scene.subtext,
            )
            .join(Summary, DbCoachSession.summary_id == Summary.id)
            .join(Scene, Summary.scene_id == Scene.id)
            .where(DbCoachSession.id == session_id)
            .with_for_update(read=True, of=DbCoachSession)
        ).one_or_none()
        if row is None:
            return None
        db_session, raw, situation, character, subtext = row
        turns = list(
            db.scalars(
                select(DbCoachTurn)
                .where(DbCoachTurn.session_id == session_id)
                .order_by(DbCoachTurn.turn_index)
            )
        )
        return _SessionData(
            session_id=db_session.id,
            summary_id=db_session.summary_id,
            raw_summary=raw,
            situation=situation,
            character=character,
            subtext=subtext,
            status=db_session.status.value,
            close_reason=(
                db_session.close_reason.value if db_session.close_reason else ""
            ),
            turns=turns,
        )
