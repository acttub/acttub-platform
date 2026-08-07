"""L3-b canonicality — 응답 하나만 보고 판정한다.

`sync_operations.py:_json_response` 는 `sort_keys=True` · 공백 없는 separator ·
`ensure_ascii=False` 를 명시한다. 자체 replay 동등(L3-a)만으로는 이걸 증명하지
못한다 — 키를 정렬하지 않는 구현도, 한글을 `\\uXXXX` 로 escape 하는 구현도,
그 방식을 최초 응답과 replay 에 **일관되게** 쓰기만 하면 바이트가 같기 때문이다.
"""

from __future__ import annotations

import json


def canonical_encode(value) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def canonicality_error(raw: bytes) -> str | None:
    """canonical 이면 None, 아니면 사람이 읽을 수 있는 사유."""
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        return f"JSON 으로 파싱되지 않는다: {exc}"
    expected = canonical_encode(parsed)
    if expected == raw:
        return None
    if json.dumps(parsed, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode() == raw:
        return "비ASCII 문자를 \\uXXXX 로 escape 했다 (ensure_ascii=False 여야 한다)"
    if canonical_encode(parsed) == _resorted(raw):
        return "키가 정렬되어 있지 않다 (sort_keys=True 여야 한다)"
    return "canonical 인코딩이 아니다 (키 정렬 · 공백 없는 separator · 비ASCII 원문 유지)"


def _resorted(raw: bytes) -> bytes:
    try:
        return canonical_encode(json.loads(raw))
    except ValueError:
        return b""
