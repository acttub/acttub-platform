"""시나리오 셋업용 **이름 붙은** DB 조작.

`db-projection` 이 이미 그렇듯 하네스는 대상 스키마에 직접 붙는다. 그래서 시계
주입점이 없어도 "만료된 upload intent" 나 "lease 를 빼앗긴 operation" 같은 상태를
결정적으로 만들 수 있다. 시각을 앞당기는 대신 **판정이 실제로 보는 DB 값**을 바꾼다
(`uploads.py:build_router.complete_intent` 는 `intent.expires_at <= now` 를 본다).

임의 SQL 을 노출하지 않는다 — 각 조작은 이름과 인자가 고정돼 있어야 Java 백엔드에도
같은 형태로 옮길 수 있다. 조작 결과(rowcount)는 시나리오가 note 로 기록하므로,
한쪽 백엔드에서만 행이 없으면 그 자체가 diff 로 잡힌다.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import text

from acting_api.db.engine import create_db_engine

from contract_harness import config as cfg
from contract_harness.dbsetup import scoped_url


class SchemaOps:
    def __init__(self, schema: str, database_url: str | None = None) -> None:
        self.schema = schema
        self._engine = create_db_engine(
            scoped_url(database_url or cfg.database_url(), schema)
        )

    def close(self) -> None:
        self._engine.dispose()

    def _execute(self, statement: str, parameters: dict) -> int:
        with self._engine.begin() as connection:
            return connection.execute(text(statement), parameters).rowcount

    # -- upload intent ----------------------------------------------------

    def expire_upload_intent(self, intent_id: str) -> int:
        """발급된 intent 를 과거로 만료시킨다. 만료 판정은 시계가 아니라 이 값을 본다."""
        return self._execute(
            "UPDATE upload_intents SET expires_at = :expires_at WHERE id = :id",
            {"id": UUID(intent_id), "expires_at": "2020-01-01T00:00:00+00:00"},
        )

    def inflate_upload_intent_size(self, intent_id: str) -> int:
        """이미 발급된 intent 의 크기를 현재 상한보다 크게 만든다.

        원본은 **이전 배포 데이터** 때문에 complete 에서 크기를 다시 검사한다
        (`uploads.py:build_router.complete_intent` 의 주석: "상한 하향 배포 전에
        발급된 pending intent 가 게이트를 우회하지 못하게 재검증한다"). 상한 자체를
        바꿀 수는 없지만, 그 상황이 남긴 **행**은 이렇게 만들 수 있다.
        상한은 소스 상수에서 읽는다 — 숫자를 박지 않는다.
        """
        from acting_api.uploads import MAX_UPLOAD_BYTES

        return self._execute(
            "UPDATE upload_intents SET size_bytes = :size WHERE id = :id",
            {"id": UUID(intent_id), "size": MAX_UPLOAD_BYTES + 1},
        )

    # -- external operation lease ------------------------------------------

    def steal_lease(self, request_id: str) -> int:
        """running operation 의 lease 를 다른 소유자에게 넘긴다.

        `db/store.py:PostgresStore._finish_external_operation` 이 lease token 을
        대조하므로, 처리 중인 요청은 완료 시점에 `LeaseOwnershipError` 를 만난다.
        """
        return self._execute(
            "UPDATE external_operations SET lease_token = :token"
            " WHERE request_id = :request_id AND status = 'running'::operation_status_t",
            {"request_id": UUID(request_id), "token": uuid4()},
        )

    # -- report / handoff ---------------------------------------------------

    def delete_practice_reports(self, practice_session_id: str) -> int:
        """저장된 리포트를 지운다 — 리포트 LLM 이 실제로 불리게 만든다.

        `reports.py:build_router.create_report` 와 `coaching.py:build_router.
        coach_confirm` 은 handoff 의 기존 리포트를 먼저 조회해 재사용하므로,
        이 행이 있으면 생성 경로를 밟지 않는다.
        """
        return self._execute(
            "DELETE FROM practice_reports WHERE practice_session_id = :id",
            {"id": UUID(practice_session_id)},
        )

    def insert_practice_report(
        self, practice_session_id: str, coach_session_id: str
    ) -> int:
        """그 handoff 에 대한 리포트 행을 밖에서 하나 만들어 둔다.

        `complete_practice_report_operation` 의 `ON CONFLICT (source_handoff_id)
        DO NOTHING` 이 실제로 걸리려면, 라우트가 "기존 리포트 없음"을 확인한 **뒤**
        행이 생겨야 한다. 요청을 스텁 게이트에 세워 두고 이 조작을 걸면 그 순서가
        결정적으로 만들어진다 — 동시 요청 두 개로 흉내 낼 필요가 없다.
        """
        import json as _json

        report = dict(
            _json.loads(
                (cfg.FIXTURES_DIR / "llm.json").read_text(encoding="utf-8")
            )["report"]["default"]
        )
        with self._engine.begin() as connection:
            handoff_id = connection.execute(
                text(
                    "SELECT id FROM coaching_handoffs WHERE coach_session_id = :id"
                    " ORDER BY created_at DESC, id DESC LIMIT 1"
                ),
                {"id": UUID(coach_session_id)},
            ).scalar_one()
            report["source_handoff_id"] = str(handoff_id)
            return connection.execute(
                text(
                    "INSERT INTO practice_reports (id, practice_session_id,"
                    " report_type, report_json, source_handoff_id)"
                    " VALUES (:id, :session_id, 'analysis', CAST(:report AS jsonb),"
                    " :handoff_id) ON CONFLICT (source_handoff_id) DO NOTHING"
                ),
                {
                    "id": uuid4(),
                    "session_id": UUID(practice_session_id),
                    "report": _json.dumps(report, ensure_ascii=False),
                    "handoff_id": handoff_id,
                },
            ).rowcount

    def inject_marker_into_handoff(self, coach_session_id: str, marker: str) -> int:
        """저장된 handoff 의 `coach_summary` 에 스텁 마커를 심는다.

        리포트 프롬프트는 이 handoff JSON 을 그대로 담으므로, 여기 심은 마커가
        `report_generate` 스텁에 전달된다.
        """
        return self._execute(
            "UPDATE coaching_handoffs SET handoff_json ="
            " jsonb_set(handoff_json, '{coach_summary}',"
            " to_jsonb(coalesce(handoff_json->>'coach_summary', '') || :marker))"
            " WHERE coach_session_id = :id",
            {"id": UUID(coach_session_id), "marker": f" {marker}"},
        )
