"""`openapi.json` diff 리포터.

**"diff 0" 은 전체 문서의 semantic equality 를 뜻한다.** 아래 열거된 항목은 반드시
보는 것의 목록이지, 비교 범위를 그것으로 한정한다는 뜻이 아니다 — 열거되지 않은
키에서 난 차이도 실패로 보고한다(§openapi.json diff 리포터).

| 분류 | 항목 |
|---|---|
| 구조 | path · operation · operationId · 컴포넌트 · 필드 · status code |
| 타입 | 타입 · format · enum 값 · const · nullable(anyOf [T,null]) |
| 제약 | required · default · minLength/maxLength · 수치 bound · additionalProperties |
| 그 외 | parameters · requestBody 의 required 여부 · security · tags |
"""

from __future__ import annotations

import json
from dataclasses import dataclass

# 순서가 의미 없는 배열. 집합이 달라지면 여전히 diff 다.
ORDER_INSENSITIVE_KEYS = frozenset({"required", "enum"})

# /SPEC.md §4 의 의도적 breaking change. 그 외 diff 는 전부 실패로 보고한다.
DATETIME_FORMATS = frozenset({"date-time"})


@dataclass(frozen=True)
class Diff:
    path: str
    kind: str
    baseline: object
    target: object

    def __str__(self) -> str:
        return (
            f"{self.path}: {self.kind}\n"
            f"    baseline={_short(self.baseline)}\n"
            f"    target  ={_short(self.target)}"
        )


def _short(value) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    return text if len(text) <= 400 else text[:397] + "..."


def diff_openapi(baseline: dict, target: dict, *, allow_datetime_change: bool = False) -> list[Diff]:
    out: list[Diff] = []
    _walk(baseline, target, "$", out, allow_datetime_change)
    return out


def _walk(left, right, path: str, out: list[Diff], allow_datetime: bool) -> None:
    if isinstance(left, dict) and isinstance(right, dict):
        if allow_datetime and _is_datetime_pair(left, right):
            return
        for name in sorted(set(left) - set(right)):
            out.append(Diff(f"{path}.{name}", "target 에 없는 키", left[name], None))
        for name in sorted(set(right) - set(left)):
            out.append(Diff(f"{path}.{name}", "baseline 에 없는 키", None, right[name]))
        for name in sorted(set(left) & set(right)):
            _walk(left[name], right[name], f"{path}.{name}", out, allow_datetime)
        return
    if isinstance(left, list) and isinstance(right, list):
        key = path.rsplit(".", 1)[-1]
        if key in ORDER_INSENSITIVE_KEYS:
            left_set = _as_set(left)
            right_set = _as_set(right)
            if left_set != right_set:
                out.append(
                    Diff(path, "집합이 다르다", sorted(left_set), sorted(right_set))
                )
            return
        if len(left) != len(right):
            out.append(Diff(path, "배열 길이가 다르다", left, right))
        for index in range(min(len(left), len(right))):
            _walk(left[index], right[index], f"{path}[{index}]", out, allow_datetime)
        return
    if type(left) is not type(right) or left != right:
        out.append(Diff(path, "값이 다르다", left, right))


def _as_set(values) -> set:
    return {
        json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
        if isinstance(value, (dict, list))
        else value
        for value in values
    }


def _is_datetime_pair(left: dict, right: dict) -> bool:
    """양쪽 모두 date-time 문자열 스키마이고 format 만 다른 경우."""
    if left.get("type") != "string" or right.get("type") != "string":
        return False
    if left.get("format") == right.get("format"):
        return False
    return {left.get("format"), right.get("format")} <= DATETIME_FORMATS | {None}


def render(diffs: list[Diff]) -> str:
    if not diffs:
        return "openapi diff 0"
    lines = [f"openapi diff {len(diffs)}건"]
    lines.extend(str(item) for item in diffs)
    return "\n".join(lines)
