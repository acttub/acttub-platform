"""백엔드 어댑터.

하네스가 백엔드에 요구하는 것은 HTTP 표면 + 제어 표면 5개뿐이다. 그 뒤를 어떻게
구현하는지는 백엔드별 자유다(§백엔드 adapter 계약).

- `fastapi`: 하네스가 `create_app(...)` 을 직접 불러 만든 앱을 in-process 로 띄운다.
- `java`: M1 시점에는 `/health` 뿐이므로 base URL 로 붙는 최소 구현이다.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx
from fastapi.testclient import TestClient

from contract_harness import config as cfg
from contract_harness.wrapper import BackendRuntime, HarnessASGI


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes
    sent_at: datetime
    received_at: datetime

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self):
        import json as _json

        if not self.body:
            return None
        try:
            return _json.loads(self.body)
        except ValueError:
            return None


class Backend:
    name: str
    role: str

    def request(self, method, path, *, json=None, headers=None, params=None) -> Response:
        raise NotImplementedError

    def control(self, name: str, **payload) -> dict:
        raise NotImplementedError

    def openapi(self) -> dict:
        raise NotImplementedError

    @contextlib.contextmanager
    def session(self):
        yield self

    def reset_state(self) -> None:
        pass


class FastapiBackend(Backend):
    role = "fastapi"

    def __init__(
        self,
        name: str,
        *,
        database_url: str,
        schema: str,
        profile: str = "default",
        mutation=None,
    ) -> None:
        self.name = name
        self.database_url = database_url
        self.schema = schema
        self.profile = profile
        self.mutation = mutation
        self.runtime: BackendRuntime | None = None
        self._client: TestClient | None = None

    @contextlib.contextmanager
    def session(self):
        """변조 패치를 건 채로 앱을 만들고 시나리오가 끝나면 되돌린다.

        두 백엔드가 같은 프로세스 안에 있으므로 동작 변조(monkeypatch)는 반드시
        해당 백엔드의 실행 구간에만 걸려 있어야 한다.
        """
        with contextlib.ExitStack() as stack:
            if self.mutation is not None and self.mutation.patch is not None:
                stack.enter_context(self.mutation.patch())
            runtime = BackendRuntime(
                database_url=self.database_url,
                schema=self.schema,
                profile=self.profile,
            )
            stack.callback(runtime.close)
            response_hook = (
                self.mutation.response_hook if self.mutation is not None else None
            )
            asgi = HarnessASGI(runtime, response_mutation=response_hook)
            client = stack.enter_context(TestClient(asgi, raise_server_exceptions=False))
            self.runtime = runtime
            self._client = client
            try:
                yield self
            finally:
                self.runtime = None
                self._client = None

    def request(self, method, path, *, json=None, headers=None, params=None) -> Response:
        assert self._client is not None, "backend session is not open"
        sent_at = datetime.now(timezone.utc)
        response = self._client.request(
            method, path, json=json, headers=headers, params=params
        )
        return Response(
            status=response.status_code,
            headers={key.lower(): value for key, value in response.headers.items()},
            body=response.content,
            sent_at=sent_at,
            received_at=datetime.now(timezone.utc),
        )

    def set_client_host(self, host: str) -> None:
        """IP 레이트리밋 키를 가르기 위해 요청 origin 을 바꾼다."""
        assert self._client is not None
        transport = self._client._transport
        transport.client = (host, 50000)

    def control(self, name: str, **payload) -> dict:
        assert name in cfg.CONTROL_SURFACE, f"unknown control surface: {name}"
        response = self.request(
            "POST", f"{cfg.CONTROL_PREFIX}/{name}", json=payload or {}
        )
        assert response.status == 200, f"control {name} failed: {response.text}"
        return response.json()

    def openapi(self) -> dict:
        assert self.runtime is not None
        return self.runtime.app.openapi()


class JavaBackend(Backend):
    """M1 시점 Java 는 `/health` 뿐이다 — 제어 표면 없이 붙기만 한다.

    제어 표면 5개를 만족시키는 것은 M4 의 일이며 그 요구사항은
    `spec/M4-llm.md` 로 넘어간다.
    """

    role = "java"

    def __init__(self, name: str, base_url: str) -> None:
        self.name = name
        self.base_url = base_url.rstrip("/")
        self._client: httpx.Client | None = None

    @contextlib.contextmanager
    def session(self):
        with httpx.Client(base_url=self.base_url, timeout=30) as client:
            self._client = client
            try:
                yield self
            finally:
                self._client = None

    def request(self, method, path, *, json=None, headers=None, params=None) -> Response:
        assert self._client is not None, "backend session is not open"
        sent_at = datetime.now(timezone.utc)
        response = self._client.request(
            method, path, json=json, headers=headers, params=params
        )
        return Response(
            status=response.status_code,
            headers={key.lower(): value for key, value in response.headers.items()},
            body=response.content,
            sent_at=sent_at,
            received_at=datetime.now(timezone.utc),
        )

    def control(self, name: str, **payload) -> dict:
        raise NotImplementedError(
            "java 백엔드의 제어 표면은 M4 범위다 (spec/M1-harness.md §백엔드 adapter 계약 ③)"
        )

    def openapi(self) -> dict:
        response = self.request("GET", "/v3/api-docs")
        return response.json()
