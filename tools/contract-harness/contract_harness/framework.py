"""시나리오 실행 뼈대.

시나리오는 백엔드마다 **따로** 실행된다. 후속 요청에 실제로 보내는 값은 각
백엔드가 반환한 원본 ID 이고(§채택 방식 3), 심볼은 비교용 표현일 뿐 전송값이
아니다(§구현 규약 ③).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import quote

from contract_harness.normalize import SymbolTable

REQUEST_ID_NAMESPACE = uuid.UUID("6f9619ff-8b86-d011-b42d-00cf4fc964ff")


@dataclass
class Step:
    index: int
    id: str
    kind: str
    method: str | None = None
    template: str | None = None
    path: str | None = None
    status: int | None = None
    headers: dict = field(default_factory=dict)
    body: bytes = b""
    parsed: object = None
    sent_at: datetime | None = None
    replay_of: str | None = None
    canonical: bool = False
    expect_request_id: bool = False
    note: object = None
    schema_check: bool = True


class ScenarioAbort(RuntimeError):
    """시나리오가 더 진행할 수 없다. 실패로 보고하되 나머지 시나리오는 계속 돈다."""


class ScenarioContext:
    def __init__(self, backend, symbols: SymbolTable, scenario: str):
        self.backend = backend
        self.symbols = symbols
        self.scenario = scenario
        self.steps: list[Step] = []

    # -- 심볼 -------------------------------------------------------------

    def register(self, value, kind: str) -> str:
        return self.symbols.register(value, kind)

    def request_id(self, tag: str) -> str:
        """양쪽 백엔드가 같은 값을 쓰는 결정적 X-Request-Id."""
        value = str(uuid.uuid5(REQUEST_ID_NAMESPACE, f"{self.scenario}:{tag}"))
        self.symbols.register(value, "request")
        return value

    def token(self, user_id: str) -> str:
        """Python 이 발급하고 양쪽이 소비하는 access token (§채택 방식 4)."""
        service = self.backend.runtime.jwt_service
        return service.issue_access_token(uuid.UUID(str(user_id))).value

    def auth(self, user_id: str, **extra) -> dict:
        return {"Authorization": f"Bearer {self.token(user_id)}", **extra}

    # -- 스텝 -------------------------------------------------------------

    def _append(self, step: Step) -> Step:
        step.index = len(self.steps)
        self.steps.append(step)
        return step

    def call(
        self,
        step_id: str,
        method: str,
        template: str,
        *,
        path_params: dict | None = None,
        json=None,
        headers: dict | None = None,
        params: dict | None = None,
        replay_of: str | None = None,
        canonical: bool = False,
        expect_request_id: bool = False,
        schema_check: bool = True,
    ) -> Step:
        path = template
        for name, value in (path_params or {}).items():
            path = path.replace("{" + name + "}", quote(str(value), safe=""))
        response = self.backend.request(
            method.upper(), path, json=json, headers=headers, params=params
        )
        return self._append(
            Step(
                index=0,
                id=step_id,
                kind="http",
                method=method.lower(),
                template=template,
                path=path,
                status=response.status,
                headers=response.headers,
                body=response.body,
                parsed=response.json(),
                sent_at=response.sent_at,
                replay_of=replay_of,
                canonical=canonical,
                expect_request_id=expect_request_id,
                schema_check=schema_check,
            )
        )

    def control(self, step_id: str, name: str, **payload) -> dict:
        result = self.backend.control(name, **payload)
        self._append(
            Step(index=0, id=step_id, kind="control", note={"control": name, "result": result},
                 sent_at=datetime.now(timezone.utc))
        )
        return result

    def note(self, step_id: str, data) -> None:
        self._append(
            Step(index=0, id=step_id, kind="note", note=data,
                 sent_at=datetime.now(timezone.utc))
        )


@dataclass
class Scenario:
    name: str
    run: object
    profile: str = "default"
    description: str = ""
    needs_control_surface: bool = True
