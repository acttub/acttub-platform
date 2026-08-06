"""외부 의존 스텁. 값은 전부 `fixtures/` 의 JSON 에서 온다.

네 주입점을 모두 막는다(§LLM 스텁): `analyzer`·`coach_generate`·`report_generate`·
`s3_storage`. 하나라도 열려 있으면 네트워크를 타서 비결정이 된다.

스텁의 분기는 **하네스가 제어하는 입력에 박힌 마커**로 고른다. 큐 순서에 묶어 두면
시나리오를 하나 끼워 넣을 때마다 무관한 케이스가 줄줄이 깨지기 때문이다. 호출 횟수는
그대로 세어 `stub-state` 로 노출하므로 "resume 인데 LLM 을 불렀다" 같은 위반은
호출 횟수 증분으로 잡힌다.
"""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

from acting_api.analysis_worker import AnalysisResult, UnsupportedMediaError
from acting_api.auth.providers import (
    InvalidIdentityToken,
    ProviderConfigurationError,
    ProviderIdentity,
)
from acting_api.storage import StoredObjectMetadata
from acting_summary import summarizer as summarizer_mod
from acting_summary.schema import ObservationPack

from contract_harness import config as cfg


def load_fixture(name: str) -> dict:
    return json.loads((cfg.FIXTURES_DIR / name).read_text(encoding="utf-8"))


LLM_FIXTURE = load_fixture("llm.json")
S3_FIXTURE = load_fixture("s3.json")
AUTH_FIXTURE = load_fixture("auth_providers.json")


# --- 시계 ----------------------------------------------------------------


class HarnessClock:
    """`advance-clock` 이 움직이는 시계.

    두 곳에 쓰인다. ① `create_app(clock=...)` 로 들어가는 monotonic — rate limiter
    의 fixed window 가 이걸 본다. ② 워커를 밖에서 구동할 때 넘기는 wall clock
    (`run_once(now=...)`) — lease 만료 판정이 이걸 본다.

    앱 내부의 `datetime.now(timezone.utc)` 는 주입점이 없어 움직이지 않는다.
    시간에 의존하는 검증은 전부 워커 경로(=넘겨줄 수 있는 곳)로 한정한다.
    """

    def __init__(self) -> None:
        self._offset = 0.0
        self._base = 1_000_000.0

    def monotonic(self) -> float:
        return self._base + self._offset

    def advance(self, seconds: float) -> float:
        self._offset += float(seconds)
        return self._offset

    @property
    def offset(self) -> float:
        return self._offset


# --- LLM -----------------------------------------------------------------


def _resolve_placeholders(value):
    if isinstance(value, str) and value == "$analysis_handoff":
        return LLM_FIXTURE["analysis_handoff"]
    if isinstance(value, dict):
        return {key: _resolve_placeholders(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_resolve_placeholders(item) for item in value]
    return value


@dataclass
class TextGeneratorStub:
    """`acting_llm.openai_client.generate_text` 와 같은 모양의 콜러블."""

    spec: dict
    name: str
    calls: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def __call__(self, system_instruction: str, prompt: str):
        from acting_llm.openai_client import TokenUsage

        with self.lock:
            self.calls += 1
        selected = self.spec["default"]
        for marker, response in self.spec.get("by_marker", {}).items():
            if marker in prompt:
                selected = response
                break
        selected = _resolve_placeholders(selected)
        text = (
            selected
            if isinstance(selected, str)
            else json.dumps(selected, ensure_ascii=False)
        )
        return text, TokenUsage(0, 0, 0)

    def state(self) -> dict:
        budget = int(self.spec.get("budget", 0))
        return {
            "calls": self.calls,
            "remaining": max(0, budget - self.calls),
            "budget": budget,
        }


# --- 영상 분석 -------------------------------------------------------------

ANALYZER_MARKERS = {
    "[[analyze:timeout]]": "timeout",
    "[[analyze:parse]]": "parse",
    "[[analyze:unsupported]]": "unsupported",
    "[[analyze:transient]]": "transient",
}
# 첫 시도만 실패하고 재분석에서 성공한다 — 재분석 멱등 전이를 밟기 위한 마커.
ANALYZER_FAIL_ONCE_MARKER = "[[analyze:failonce]]"


class AnalyzerStub:
    """`create_app(analyzer=...)` 자리. 워커가 부르는 유일한 외부 의존이다."""

    def __init__(self) -> None:
        self.calls = 0
        self.model = cfg.SUMMARY_MODEL
        self._fail_once_seen: set[str] = set()

    def analyze(self, video_path, session, *, duration_ms=None) -> AnalysisResult:
        self.calls += 1
        haystack = " ".join(
            str(getattr(session, field_name, "") or "")
            for field_name in ("situation", "character_context", "goal", "blockage_detail")
        )
        if ANALYZER_FAIL_ONCE_MARKER in haystack:
            key = str(getattr(session, "id", ""))
            if key not in self._fail_once_seen:
                self._fail_once_seen.add(key)
                self._raise("timeout")
        for marker, behaviour in ANALYZER_MARKERS.items():
            if marker in haystack:
                self._raise(behaviour)
        pack = ObservationPack.model_validate(LLM_FIXTURE["observation_pack"])
        transcripts = (
            tuple(LLM_FIXTURE["transcripts"])
            if session.blockage_kind == "분석"
            else ()
        )
        return AnalysisResult(
            observation_pack=pack,
            was_compressed=False,
            transcripts=transcripts,
        )

    @staticmethod
    def _raise(behaviour: str) -> None:
        if behaviour == "timeout":
            raise summarizer_mod.FileActiveTimeout("harness: file active timeout")
        if behaviour == "parse":
            raise summarizer_mod.SummaryParseError("harness: summary parse error")
        if behaviour == "unsupported":
            raise UnsupportedMediaError("harness: unsupported media")
        raise RuntimeError("harness: transient analyzer failure")

    def state(self) -> dict:
        return {"calls": self.calls}


# --- S3 -------------------------------------------------------------------


class StorageStub:
    """`create_app(s3_storage=...)` 자리. 실제 업로드는 하지 않는다."""

    def __init__(self) -> None:
        self.bucket = cfg.S3_BUCKET
        self.region = S3_FIXTURE["region"]
        self.calls: dict[str, int] = {}
        self._sizes: dict[str, int] = {}

    # 하네스는 intent 를 만들 때 크기를 알고 있으므로 그것을 기억해 HEAD 로 되돌려준다.
    def remember_size(self, object_key: str, size_bytes: int) -> None:
        self._sizes[object_key] = size_bytes

    def _count(self, name: str) -> None:
        self.calls[name] = self.calls.get(name, 0) + 1

    @staticmethod
    def _rule(rules, object_key: str) -> str | None:
        for rule in rules:
            if object_key.endswith(rule["object_key_suffix"]):
                return rule["result"]
        return None

    def _signature(self, verb: str, object_key: str, expires_in_sec: int) -> str:
        raw = f"{verb}|{self.bucket}|{object_key}|{expires_in_sec}".encode()
        return hashlib.sha256(raw).hexdigest()

    def _presign(self, verb: str, object_key: str, expires_in_sec: int) -> str:
        from botocore.exceptions import NoCredentialsError

        if object_key.endswith(S3_FIXTURE["credentials_error_suffix"]):
            # app.py:create_app 의 exception handler 가 503 storage_not_configured 로 바꾼다.
            raise NoCredentialsError()
        suffix = S3_FIXTURE["playback_presign_failure_suffix"]
        if verb == "GET" and object_key.endswith(suffix):
            raise RuntimeError("harness: presign failed")
        query = {
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": "HARNESSKEY/20260101/"
            f"{self.region}/s3/aws4_request",
            "X-Amz-Date": "20260101T000000Z",
            "X-Amz-Expires": str(expires_in_sec),
            "X-Amz-SignedHeaders": "host",
            "X-Amz-Signature": self._signature(verb, object_key, expires_in_sec),
        }
        encoded = "&".join(f"{key}={quote(value, safe='')}" for key, value in query.items())
        path = "/".join(quote(part, safe="") for part in object_key.split("/"))
        return f"https://s3.{self.region}.amazonaws.com/{self.bucket}/{path}?{encoded}"

    def presign_upload(self, *, object_key, mime_type, size_bytes, expires_in_sec):
        self._count("presign_upload")
        self.remember_size(object_key, size_bytes)
        return self._presign("PUT", object_key, expires_in_sec)

    def presign_playback(self, *, object_key, expires_in_sec):
        self._count("presign_playback")
        return self._presign("GET", object_key, expires_in_sec)

    def head(self, *, object_key: str) -> StoredObjectMetadata | None:
        self._count("head")
        result = self._rule(S3_FIXTURE["head_rules"], object_key)
        if result == "missing":
            return None
        default = S3_FIXTURE["default_object"]
        size = self._sizes.get(object_key, default["size_bytes"])
        if result == "size_mismatch":
            size += 1
        return StoredObjectMetadata(
            size_bytes=size,
            content_type=default["content_type"],
            etag=default["etag"],
        )

    def download_to_path(self, *, object_key: str, destination) -> StoredObjectMetadata:
        self._count("download_to_path")
        default = S3_FIXTURE["default_object"]
        size = self._sizes.get(object_key, default["size_bytes"])
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        filler = bytes([int(S3_FIXTURE["download_body_repeat_byte"])])
        path.write_bytes(filler * size)
        etag = default["etag"]
        if self._rule(S3_FIXTURE["download_rules"], object_key) == "etag_mismatch":
            etag = '"0000000000000000000000000000dead"'
        return StoredObjectMetadata(
            size_bytes=size,
            content_type=default["content_type"],
            etag=etag,
        )

    def delete(self, *, object_key: str) -> None:
        self._count("delete")

    def state(self) -> dict:
        return {"calls": dict(sorted(self.calls.items()))}


# --- 인증 provider ---------------------------------------------------------


class ProviderVerifierStub:
    def __init__(self, provider: str) -> None:
        self.provider = provider
        self.calls = 0

    def verify(self, id_token: str) -> ProviderIdentity:
        self.calls += 1
        if self.provider in AUTH_FIXTURE["unconfigured_providers"]:
            raise ProviderConfigurationError(f"{self.provider} is not configured")
        entry = AUTH_FIXTURE["tokens"].get(id_token)
        if entry is None:
            raise InvalidIdentityToken(f"unknown harness id_token: {id_token}")
        return ProviderIdentity(
            provider_uid=entry["provider_uid"],
            email=entry["email"],
            email_verified=entry["email_verified"],
        )


class WorkerPoolStub:
    """`create_app(analysis_worker=...)` 자리.

    `start()`/`stop()` 이 no-op 이라 contract 프로파일에서 백그라운드 스레드가 뜨지
    않는다. 내부 `AnalysisWorker` 는 그대로 노출해 제어 표면이 1틱씩 돌린다.
    """

    def __init__(self, worker) -> None:
        self.worker = worker
        self.started = 0
        self.stopped = 0

    def start(self) -> None:
        self.started += 1

    def stop(self) -> None:
        self.stopped += 1
