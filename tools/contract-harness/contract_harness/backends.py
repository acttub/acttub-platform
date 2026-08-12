"""백엔드 어댑터.

하네스가 백엔드에 요구하는 것은 HTTP 표면 + 공통 제어 표면뿐이다. 그 뒤를 어떻게
구현하는지는 백엔드별 자유다(§백엔드 adapter 계약).

- `fastapi`: 하네스가 `create_app(...)` 을 직접 불러 만든 앱을 in-process 로 띄운다.
- `java`: 외부 Spring Boot contract 프로파일의 base URL 로 붙는다.
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

    def __init__(self) -> None:
        self._client_host: str | None = None

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

    def set_client_host(self, host: str) -> None:
        """계약 실행기가 보낸 신뢰 가능한 요청 origin 을 다음 요청들에 싣는다."""
        self._client_host = host

    def _request_headers(self, headers) -> dict[str, str] | None:
        merged = dict(headers or {})
        if self._client_host is not None:
            merged[cfg.CLIENT_HOST_HEADER] = self._client_host
        return merged or None


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
        super().__init__()
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
            method, path, json=json, headers=self._request_headers(headers), params=params
        )
        return Response(
            status=response.status_code,
            headers={key.lower(): value for key, value in response.headers.items()},
            body=response.content,
            sent_at=sent_at,
            received_at=datetime.now(timezone.utc),
        )

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
    """외부에서 실행 중인 Spring Boot contract 프로파일에 붙는다."""

    role = "java"

    def __init__(self, name: str, base_url: str, *, profile: str = "default") -> None:
        super().__init__()
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.profile = profile
        self.schema = cfg.TARGET_SCHEMA
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
            method, path, json=json, headers=self._request_headers(headers), params=params
        )
        return Response(
            status=response.status_code,
            headers={key.lower(): value for key, value in response.headers.items()},
            body=response.content,
            sent_at=sent_at,
            received_at=datetime.now(timezone.utc),
        )

    def control(self, name: str, **payload) -> dict:
        assert name in cfg.CONTROL_SURFACE, f"unknown control surface: {name}"
        response = self.request(
            "POST", f"{cfg.CONTROL_PREFIX}/{name}", json=payload or {}
        )
        assert response.status == 200, f"control {name} failed: {response.text}"
        return response.json()

    def openapi(self) -> dict:
        response = self.request("GET", "/v3/api-docs")
        return response.json()
