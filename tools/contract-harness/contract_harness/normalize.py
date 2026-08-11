"""symbolic ID 정규화 · opaque 값 정책 · datetime 검증/마스킹.

순서가 계약이다(§datetime): **① 형식·의미 검증 → ② 마스킹 → ③ 교차 diff.**
①을 건너뛰면 `+00:00` 도, 밀리초 3자리도, 임의의 미래 시각도 통과한다.
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
DATETIME_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.(\d+))?(Z|[+-]\d{2}:\d{2})$"
)

DATETIME_SENTINEL = "<datetime>"
CURSOR_SENTINEL = "<cursor>"
ENV_SENTINEL = "<env>"

OPAQUE_TOKEN_KEYS = frozenset({"access_token", "refresh_token"})
OPAQUE_CURSOR_KEYS = frozenset({"next_cursor"})
OPAQUE_URL_KEYS = frozenset({"playback_url", "upload_url", "video_url"})
# 배포·환경마다 달라지는 값. 두 구현이 합의할 대상이 아니라 실행된 자리의 산물이라
# 값 자체는 비교하지 않는다 — 있는지/문자열인지만 본다.
ENV_VALUE_KEYS = frozenset({"commit", "db_size"})


class SymbolError(RuntimeError):
    pass


class SymbolTable:
    """값 기준 **단일** map (§구현 규약 ②).

    필드명별로 나누지 않는다 — 같은 코치 세션이 `session_id` 로도
    `coach_session_id` 로도 나타나므로 필드별로 나누면 같은 객체가 서로 다른
    심볼을 받는다.
    """

    def __init__(self) -> None:
        self._symbols: dict[str, str] = {}
        self._counters: dict[str, int] = {}

    def register(self, value, kind: str) -> str:
        if value is None:
            raise SymbolError(f"cannot register None as {kind}")
        key = str(value).lower()
        if key in self._symbols:
            return self._symbols[key]
        self._counters[kind] = self._counters.get(kind, 0) + 1
        symbol = f"${kind}_{self._counters[kind]}"
        self._symbols[key] = symbol
        return symbol

    def get(self, value: str) -> str | None:
        return self._symbols.get(value.lower())

    def substitute(self, text: str) -> str:
        def _replace(match: re.Match) -> str:
            symbol = self.get(match.group(0))
            return symbol if symbol is not None else match.group(0)

        return UUID_RE.sub(_replace, text)


@dataclass
class NormalizeResult:
    value: object
    datetime_forms: dict[str, str] = field(default_factory=dict)
    ttl_seconds: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


def _jwt_shape(token: str) -> dict | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        header = json.loads(_b64url(parts[0]))
        payload = json.loads(_b64url(parts[1]))
    except (ValueError, TypeError):
        return None
    if not isinstance(header, dict) or not isinstance(payload, dict):
        return None
    return {
        "__opaque__": "jwt",
        "header": dict(sorted(header.items())),
        "claim_keys": sorted(key for key in payload if key != "sub"),
        "iss": payload.get("iss"),
        "aud": payload.get("aud"),
        "token_type": payload.get("token_type"),
    }


def _b64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _path_segment_shape(segment: str) -> str:
    if not segment:
        return segment
    stem, dot, suffix = segment.partition(".")
    if UUID_RE.fullmatch(stem):
        return f"<uuid>{dot}{suffix}"
    if re.fullmatch(r"[0-9a-fA-F]{32}", stem):
        return f"<hex32>{dot}{suffix}"
    return segment


def url_shape(url: str) -> dict:
    parsed = urlsplit(url)
    path = "/".join(_path_segment_shape(part) for part in parsed.path.split("/"))
    return {
        "__opaque__": "url",
        "scheme": parsed.scheme,
        "host": parsed.netloc,
        "path": path,
        "query_keys": sorted(parse_qs(parsed.query, keep_blank_values=True)),
    }


def check_datetime(value: str, *, role: str, path: str) -> tuple[str, list[str]]:
    """형식 검증. 반환은 (offset form, errors)."""
    match = DATETIME_RE.match(value)
    errors: list[str] = []
    if match is None:
        return "invalid", [f"{path}: datetime 형식이 아니다: {value!r}"]
    fraction = match.group(4)
    offset = match.group(5)
    if fraction is not None and len(fraction) != 6:
        errors.append(
            f"{path}: 소수 자릿수가 {len(fraction)}자리다. 마이크로초 6자리여야 한다: {value!r}"
        )
    if role == "java":
        if offset != "Z":
            errors.append(f"{path}: java 백엔드는 Z 접미사여야 한다: {value!r}")
        if fraction is None:
            errors.append(f"{path}: java 백엔드는 마이크로초 6자리 고정이다: {value!r}")
    elif offset not in {"Z", "+00:00"}:
        errors.append(f"{path}: UTC 가 아니다: {value!r}")
    return offset, errors


def parse_datetime(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def ttl_expectations() -> dict[str, float]:
    """TTL 을 **소스 상수에서** 읽는다. 숫자를 박지 않는다(§기대값 소스).

    필드 이름 → 기대 TTL 초. 상대 순서만 보면 30분 TTL 을 1년으로 발급하는
    구현이 그대로 통과한다.
    """
    from acting_api.uploads import UPLOAD_INTENT_TTL

    return {"expires_at": UPLOAD_INTENT_TTL.total_seconds()}


# 요청 왕복·시계 오차를 흡수하는 여유. 30분 TTL 을 1년으로 바꾸는 것과는 자릿수가 다르다.
TTL_TOLERANCE_SEC = 120.0
# 생성 시각이 요청 시각보다 이만큼 넘게 미래면 계약 위반으로 본다.
FUTURE_INSTANT_TOLERANCE_SEC = 120.0
# 미래여야 하는 필드. 나머지 시각 필드는 요청 시각을 크게 넘으면 안 된다.
FUTURE_ALLOWED_KEYS = frozenset({"expires_at", "lease_expires_at"})


class Normalizer:
    def __init__(self, symbols: SymbolTable, *, role: str, sent_at: datetime | None):
        self.symbols = symbols
        self.role = role
        self.sent_at = sent_at
        self.datetime_forms: dict[str, str] = {}
        self.ttl_seconds: dict[str, int] = {}
        self.errors: list[str] = []
        self._ttl = ttl_expectations()

    def run(self, value) -> NormalizeResult:
        normalized = self._walk(value, "$")
        return NormalizeResult(
            value=normalized,
            datetime_forms=self.datetime_forms,
            ttl_seconds=self.ttl_seconds,
            errors=self.errors,
        )

    # -- 내부 --------------------------------------------------------------

    def _walk(self, value, path: str, *, key: str | None = None):
        if isinstance(value, dict):
            self._check_object_invariants(value, path)
            return {
                item_key: self._walk(item, f"{path}.{item_key}", key=item_key)
                for item_key, item in value.items()
            }
        if isinstance(value, list):
            return [
                self._walk(item, f"{path}[{index}]", key=key)
                for index, item in enumerate(value)
            ]
        if isinstance(value, str):
            return self._walk_string(value, path, key)
        return value

    def _check_object_invariants(self, value: dict, path: str) -> None:
        created = value.get("created_at")
        updated = value.get("updated_at")
        if isinstance(created, str) and isinstance(updated, str):
            left, right = parse_datetime(created), parse_datetime(updated)
            if left is not None and right is not None and right < left:
                self.errors.append(
                    f"{path}: updated_at 이 created_at 보다 앞선다 ({updated} < {created})"
                )
        expires = value.get("expires_at")
        if isinstance(expires, str) and self.sent_at is not None:
            moment = parse_datetime(expires)
            if moment is None:
                return
            if moment <= self.sent_at:
                self.errors.append(
                    f"{path}: expires_at 이 요청 시각보다 앞선다 "
                    f"({expires} <= {self.sent_at.isoformat()})"
                )
                return
            # TTL **길이**를 본다. 순서만 보면 30분을 1년으로 발급해도 통과한다.
            expected = self._ttl.get("expires_at")
            if expected is None:
                return
            actual = (moment - self.sent_at).total_seconds()
            self.ttl_seconds[f"{path}.expires_at"] = round(actual)
            if abs(actual - expected) > TTL_TOLERANCE_SEC:
                self.errors.append(
                    f"{path}.expires_at: TTL 이 {actual:.0f}초다. "
                    f"소스 상수(UPLOAD_INTENT_TTL)는 {expected:.0f}초 "
                    f"(허용오차 {TTL_TOLERANCE_SEC:.0f}초)"
                )

    def _check_instant_is_not_future(self, value: str, path: str, key: str) -> None:
        """생성·발생 시각이 요청 시각보다 한참 미래면 계약 위반이다."""
        if self.sent_at is None or key in FUTURE_ALLOWED_KEYS:
            return
        moment = parse_datetime(value)
        if moment is None:
            return
        ahead = (moment - self.sent_at).total_seconds()
        if ahead > FUTURE_INSTANT_TOLERANCE_SEC:
            self.errors.append(
                f"{path}: 시각이 요청 시각보다 {ahead:.0f}초 미래다 ({value})"
            )

    def _walk_string(self, value: str, path: str, key: str | None):
        # ① opaque — 값 자체를 교차 비교하지 않는다 (§opaque 값 정책)
        if key in OPAQUE_TOKEN_KEYS:
            shape = _jwt_shape(value)
            return shape if shape is not None else {"__opaque__": "token"}
        if key in OPAQUE_CURSOR_KEYS:
            return CURSOR_SENTINEL
        if key in OPAQUE_URL_KEYS:
            return url_shape(value)
        if key in ENV_VALUE_KEYS:
            return ENV_SENTINEL
        # ② datetime — 검증하고 나서 마스킹한다
        if DATETIME_RE.match(value):
            form, errors = check_datetime(value, role=self.role, path=path)
            self.datetime_forms[path] = form
            self.errors.extend(errors)
            self._check_instant_is_not_future(value, path, key or "")
            return DATETIME_SENTINEL
        # ③ symbolic ID
        substituted = self.symbols.substitute(value)
        leftover = UUID_RE.search(substituted)
        if leftover is not None:
            self.errors.append(
                f"{path}: 등록되지 않은 UUID {leftover.group(0)} — "
                "심볼은 생성 지점에서만 발급한다 (§구현 규약 ①)"
            )
        return substituted


def normalize(value, symbols: SymbolTable, *, role: str, sent_at=None) -> NormalizeResult:
    return Normalizer(symbols, role=role, sent_at=sent_at).run(value)
