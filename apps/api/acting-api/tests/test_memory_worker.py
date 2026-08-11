"""연습이 끝난 뒤 기억을 뒤에서 갱신하는 워커.

여기서 지켜야 하는 것은 두 가지다 -- **배우가 고친 칸을 덮지 않는 것**, 그리고
**갱신이 실패해도 연습을 망치지 않는 것**. 둘 다 실패하면 조용히 망가지는 종류라
시험으로 못 박아 둔다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID, uuid4

from acting_api.memory_worker import MemoryUpdateWorker, should_update_memory


@dataclass
class _Operation:
    id: UUID
    session_id: UUID


@dataclass
class _MemoryItem:
    field: str
    value: str


@dataclass
class _Material:
    user_id: UUID
    practice_session_id: UUID
    goal: str = "합격하고 싶다"
    blockage_kind: str = "분석"
    sub_branch: str = "대사 분석"
    blockage_detail: str | None = None
    transcripts: tuple[str, ...] = ("나는 괜찮아.",)
    actor_messages: tuple[str, ...] = ("차분하게 하려고 했어요.",)


class _Store:
    def __init__(self, *, material=None, existing=(), actor_owned=()):
        self.user_id = uuid4()
        self.practice_session_id = uuid4()
        self._material = (
            material
            if material is not None
            else _Material(self.user_id, self.practice_session_id)
        )
        self._existing = list(existing)
        self._actor_owned = set(actor_owned)
        self.claimed = False
        self.writes: list[tuple[str, str]] = []
        self.completed: list[dict] = []
        self.failed: list[str] = []

    def claim_next_external_operation(self, *, kind, lease_token, lease_duration, now):
        assert kind == "memory_update"
        if self.claimed:
            return None
        self.claimed = True
        return _Operation(id=uuid4(), session_id=self.practice_session_id)

    def get_memory_update_material(self, *, practice_session_id):
        return self._material

    def list_actor_memory(self, user_id):
        return list(self._existing)

    def write_actor_memory_as_agent(
        self, *, user_id, field, value, source_practice_session_id, now
    ):
        name = field.value
        self.writes.append((name, value))
        if name in self._actor_owned:
            return None  # 배우가 고친 칸 -- 저장 계층이 건너뛴다
        return _MemoryItem(field=name, value=value)

    def complete_sync_operation(self, *, operation_id, lease_token, response_payload, now):
        self.completed.append(response_payload)
        return True

    def fail_external_operation(self, *, operation_id, lease_token, error_code, now):
        self.failed.append(error_code)
        return True


def _generate(payload):
    def generate(_system, _user):
        text = payload if isinstance(payload, str) else json.dumps(payload)
        return text, None

    return generate


def _run(store, payload):
    worker = MemoryUpdateWorker(store=store, generate=_generate(payload))
    return worker.run_once(now=datetime.now(timezone.utc))


def test_a_field_the_actor_edited_is_reported_as_not_written():
    """저장 계층이 건너뛴 칸을 '갱신했다' 고 보고하면 추적이 어긋난다."""
    store = _Store(actor_owned={"goal"})

    assert _run(store, {"goal": "새 목표", "speech_self": "차분하게"}) is True
    assert store.completed[0]["updated_fields"] == ["speech_self"]


def test_a_failing_update_does_not_fail_the_practice():
    """기억이 없다고 연습이 망가지면 안 된다."""

    class _Broken(_Store):
        def write_actor_memory_as_agent(self, **kwargs):
            raise RuntimeError("db down")

    store = _Broken()

    assert _run(store, {"goal": "새 목표"}) is True
    assert store.failed == ["memory_update_failed"]
    assert store.completed == []


def test_nothing_to_claim_returns_false():
    store = _Store()
    store.claimed = True

    assert _run(store, {}) is False


def test_missing_material_completes_without_writing():
    """연습이 지워졌어도 잡은 정상 종료해야 큐에 남지 않는다."""
    store = _Store()
    store.get_memory_update_material = lambda **_: None

    assert _run(store, {"goal": "새 목표"}) is True
    assert store.writes == []
    assert store.completed[0]["updated_fields"] == []


def test_existing_memory_is_passed_so_unchanged_fields_are_skipped():
    store = _Store(existing=[_MemoryItem(field="goal", value="합격하고 싶다")])

    _run(store, {"goal": "합격하고 싶다", "speech_actual": "「나는 괜찮아」"})

    assert [name for name, _ in store.writes] == ["speech_actual"]


def test_update_runs_on_the_first_practice_then_every_third():
    """첫 연습엔 바로 채워야 두 번째 연습부터 코치가 쓸 것이 생긴다."""
    ran = [n for n in range(0, 10) if should_update_memory(n)]

    assert ran == [1, 3, 6, 9]
