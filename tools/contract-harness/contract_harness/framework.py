"""시나리오 실행 뼈대.

시나리오는 백엔드마다 **따로** 실행된다. 후속 요청에 실제로 보내는 값은 각
백엔드가 반환한 원본 ID 이고(§채택 방식 3), 심볼은 비교용 표현일 뿐 전송값이
아니다(§구현 규약 ③).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import quote

from acting_api.auth.jwt import ACCESS_TOKEN_TTL

from contract_harness import config as cfg
from contract_harness.normalize import SymbolTable

REQUEST_ID_NAMESPACE = uuid.UUID("6f9619ff-8b86-d011-b42d-00cf4fc964ff")


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def mint_access_token(user_id: str, *, issued_at: datetime, token_id: uuid.UUID) -> str:
    """Python 정본과 같은 header/claims/canonical JSON으로 HS256 access token을 만든다."""
    if issued_at.tzinfo is None:
        raise ValueError("issued_at must be timezone-aware")
    issued_at = issued_at.astimezone(timezone.utc)
    expires_at = issued_at + ACCESS_TOKEN_TTL
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": "acting-api",
        "aud": "acting-app",
        "sub": str(uuid.UUID(str(user_id))),
        "jti": str(token_id),
        "token_type": "access",
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }

    def encode(value: dict) -> str:
        return _b64url(
            json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
        )

    signing_input = f"{encode(header)}.{encode(payload)}".encode("ascii")
    signature = hmac.new(
        cfg.JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256
    ).digest()
    return f"{signing_input.decode('ascii')}.{_b64url(signature)}"


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
    def __init__(
        self,
        backend,
        symbols: SymbolTable,
        scenario: str,
        *,
        token_issued_at: datetime | None = None,
    ):
        self.backend = backend
        self.symbols = symbols
        self.scenario = scenario
        self.token_issued_at = token_issued_at or datetime.now(timezone.utc)
        self.steps: list[Step] = []
        self._db = None

    # -- 셋업용 DB 조작 ---------------------------------------------------

    @property
    def db(self):
        """대상 백엔드의 스키마에 직접 붙는 이름 붙은 조작 (`dbops.SchemaOps`)."""
        if self._db is None:
            from contract_harness.dbops import SchemaOps

            schema = getattr(self.backend, "schema", None)
            if schema is None:
                raise ScenarioAbort(
                    f"{self.backend.name} 백엔드의 스키마를 모른다 — "
                    "셋업용 DB 조작을 쓸 수 없다"
                )
            self._db = SchemaOps(schema)
        return self._db

    def db_op(self, step_id: str, operation: str, **kwargs) -> int:
        """DB 조작을 실행하고 rowcount 를 note 로 남긴다.

        rowcount 가 백엔드마다 다르면(한쪽에만 행이 있으면) 그 자체가 diff 다.
        """
        rowcount = getattr(self.db, operation)(**kwargs)
        self.note(step_id, {"operation": operation, "rowcount": rowcount})
        return rowcount

    def close(self) -> None:
        if self._db is not None:
            self._db.close()
            self._db = None

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
        token_id = uuid.uuid5(
            REQUEST_ID_NAMESPACE, f"{self.scenario}:access-token:{user_id}"
        )
        return mint_access_token(
            user_id, issued_at=self.token_issued_at, token_id=token_id
        )

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

    def record_response(
        self,
        step_id: str,
        *,
        method: str,
        template: str,
        response,
        expect_request_id: bool = False,
        canonical: bool = False,
        schema_check: bool = True,
    ) -> Step:
        """`ctx.call` 밖에서 얻은 응답(별도 스레드 등)을 같은 형태의 스텝으로 남긴다."""
        return self._append(
            Step(
                index=0,
                id=step_id,
                kind="http",
                method=method.lower(),
                template=template,
                path=template,
                status=response.status,
                headers=response.headers,
                body=response.body,
                parsed=response.json(),
                sent_at=response.sent_at,
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
