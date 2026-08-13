"""연습이 끝난 뒤 배우 기억을 뒤에서 갱신한다.

연습 마무리 응답 안에서 처리하지 않는 이유는 속도다. 그 화면은 이미 성적표를
만드느라 느린데 거기에 모델 호출을 하나 더 얹으면 배우가 그만큼 더 기다린다.
분석이 쓰던 작업 큐에 종류만 하나 더해 얹었다 -- lease·재시도·실패 처리가 이미
거기 있다.

**기억 갱신이 실패해도 연습은 정상이다.** 그래서 실패해도 연습 상태를 건드리지
않는다(`fail_session` 기본값 False). 배우 입장에서 기억은 있으면 좋은 것이지,
없다고 연습이 망가질 것은 아니다.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from acting_agent.memory_extract import (
    MemoryMaterial,
    extract_memory_updates,
)
from acting_api.db.models import ActorMemoryField
from acting_api.db.store import LeaseOwnershipError

logger = logging.getLogger(__name__)


class MemoryUpdateWorker:
    def __init__(
        self,
        *,
        store,
        generate,
        lease_duration: timedelta = timedelta(minutes=5),
    ):
        self.store = store
        self.generate = generate
        self.lease_duration = lease_duration

    def run_once(self, *, now: datetime | None = None) -> bool:
        """큐에서 하나 집어 처리한다. 집을 게 없으면 False."""
        now = now or datetime.now(timezone.utc)
        lease_token = uuid4()
        operation = self.store.claim_next_external_operation(
            kind="memory_update",
            lease_token=lease_token,
            lease_duration=self.lease_duration,
            now=now,
        )
        if operation is None:
            return False

        try:
            written = self._update(operation, now=now)
            self.store.complete_sync_operation(
                operation_id=operation.id,
                lease_token=lease_token,
                response_payload={
                    "practice_session_id": str(operation.session_id),
                    "updated_fields": written,
                },
                now=now,
            )
        except LeaseOwnershipError:
            logger.warning("기억 갱신 lease 를 잃었다: %s", operation.id)
        except Exception:
            logger.warning("기억 갱신 실패: %s", operation.id, exc_info=True)
            try:
                # 연습 자체는 건드리지 않는다 -- 기억이 없다고 연습이 실패한 것은 아니다.
                self.store.fail_external_operation(
                    operation_id=operation.id,
                    lease_token=lease_token,
                    error_code="memory_update_failed",
                    now=now,
                )
            except LeaseOwnershipError:
                logger.warning("기억 갱신 실패 처리 중 lease 를 잃었다: %s", operation.id)
        return True

    def sweep(self) -> None:
        """주기 청소는 없다. 분석이 쓰던 작업 풀을 그대로 쓰기 위한 자리다."""

    def _update(self, operation, *, now: datetime) -> list[str]:
        material = self.store.get_memory_update_material(
            practice_session_id=operation.session_id
        )
        if material is None:
            logger.info("기억 갱신 재료가 없다(연습이 지워졌을 수 있다): %s", operation.id)
            return []

        existing = {
            item.field: item.value
            for item in self.store.list_actor_memory(material.user_id)
        }
        extraction = extract_memory_updates(
            MemoryMaterial(
                goal=material.goal,
                blockage_kind=material.blockage_kind,
                sub_branch=material.sub_branch,
                blockage_detail=material.blockage_detail,
                transcripts=material.transcripts,
                actor_messages=material.actor_messages,
                existing=existing,
            ),
            generate=self.generate,
        )

        written: list[str] = []
        for name, value in extraction.updates.items():
            item = self.store.write_actor_memory_as_agent(
                user_id=material.user_id,
                field=ActorMemoryField(name),
                value=value,
                source_practice_session_id=material.practice_session_id,
                now=now,
            )
            # None 이면 배우가 직접 고친 칸이라 저장 계층이 건너뛴 것이다.
            if item is not None:
                written.append(name)
        return written


def should_update_memory(confirmed_practice_count: int, *, every: int = 3) -> bool:
    """이번 연습 뒤에 기억을 갱신할 차례인지.

    첫 연습에는 바로 채운다 -- 그래야 두 번째 연습부터 코치가 쓸 것이 생긴다.
    그 뒤로는 몇 번에 한 번만 돈다. 매번 돌리면 한 번의 이상한 대화가 곧장
    기억이 되고, 모델 호출도 연습 수만큼 는다.
    """
    if confirmed_practice_count <= 0:
        return False
    if confirmed_practice_count == 1:
        return True
    return confirmed_practice_count % every == 0
