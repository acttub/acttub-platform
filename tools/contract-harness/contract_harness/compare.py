"""3단 비교 + datetime 검증 + 헤더 검증.

| 층 | 대상 | 방법 |
|---|---|---|
| L1 | 전 응답 | `openapi.json` 컴포넌트로 strict 검증 |
| L2 | 전 응답 | 마스킹·symbolic 치환 후 구조 비교(키 존재 여부까지) |
| L3-a | 멱등 replay | 각 백엔드 **안에서** 최초 응답 bytes == replay bytes |
| L3-b | 전 sync operation 응답 | `raw == canonical_encode(parse(raw))` |
"""

from __future__ import annotations

from dataclasses import dataclass

from contract_harness import jsonschema_lite
from contract_harness.canonical import canonicality_error
from contract_harness.normalize import SymbolTable, normalize

JSON_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}


@dataclass
class Finding:
    layer: str
    scenario: str
    step: str
    message: str

    def __str__(self) -> str:
        return f"[{self.layer}] {self.scenario}/{self.step}: {self.message}"


def response_schema(openapi: dict, template: str, method: str, status: int):
    path_item = openapi.get("paths", {}).get(template)
    if not path_item:
        return None
    operation = path_item.get(method)
    if not operation:
        return None
    response = operation.get("responses", {}).get(str(status))
    if not response:
        return None
    content = response.get("content", {}).get("application/json")
    if not content:
        return None
    return content.get("schema")


def _schema_applies(step) -> bool:
    """L1 을 걸 수 있는 응답인지.

    오류 계약은 `openapi.json` 에 없다(/SPEC.md §6-2). 스펙의 422 는 FastAPI 가
    자동 생성한 `HTTPValidationError`(detail 이 배열)뿐이라, `HTTPException(422,
    "request_fingerprint_mismatch")` 처럼 문자열 detail 을 내는 응답을 거기에 대고
    검증하면 원본 구현이 영원히 위반으로 잡힌다. 그건 백엔드 간 차이가 아니다.
    """
    if step.status is None:
        return False
    if 200 <= step.status < 300:
        return True
    if step.status == 422 and isinstance(step.parsed, dict):
        return isinstance(step.parsed.get("detail"), list)
    return False


def _diff(left, right, path: str, out: list[str]) -> None:
    if type(left) is not type(right) and not (
        isinstance(left, (int, float))
        and isinstance(right, (int, float))
        and not isinstance(left, bool)
        and not isinstance(right, bool)
    ):
        out.append(f"{path}: 타입이 다르다 baseline={type(left).__name__} target={type(right).__name__}")
        return
    if isinstance(left, dict):
        missing = sorted(set(left) - set(right))
        extra = sorted(set(right) - set(left))
        for name in missing:
            out.append(f"{path}.{name}: target 에 키가 없다 (baseline={left[name]!r})")
        for name in extra:
            out.append(f"{path}.{name}: baseline 에 없는 키가 target 에 있다 (target={right[name]!r})")
        for name in sorted(set(left) & set(right)):
            _diff(left[name], right[name], f"{path}.{name}", out)
        return
    if isinstance(left, list):
        if len(left) != len(right):
            out.append(f"{path}: 길이가 다르다 baseline={len(left)} target={len(right)}")
        for index in range(min(len(left), len(right))):
            _diff(left[index], right[index], f"{path}[{index}]", out)
        return
    if left != right:
        out.append(f"{path}: 값이 다르다 baseline={left!r} target={right!r}")


def structural_diff(left, right) -> list[str]:
    out: list[str] = []
    _diff(left, right, "$", out)
    return out


class SideResult:
    """한 백엔드에 대한 시나리오 실행 결과."""

    def __init__(self, backend, steps, symbols: SymbolTable, openapi: dict):
        self.backend = backend
        self.steps = steps
        self.symbols = symbols
        self.openapi = openapi

    @property
    def role(self) -> str:
        return self.backend.role


def _normalize_step(step, side: SideResult):
    if step.kind == "http":
        payload = step.parsed
    else:
        payload = step.note
    return normalize(payload, side.symbols, role=side.role, sent_at=step.sent_at)


def compare(scenario: str, baseline: SideResult, target: SideResult) -> list[Finding]:
    findings: list[Finding] = []
    baseline_ids = [step.id for step in baseline.steps]
    target_ids = [step.id for step in target.steps]
    if baseline_ids != target_ids:
        findings.append(
            Finding(
                "sequence",
                scenario,
                "-",
                f"스텝 시퀀스가 다르다\n  baseline={baseline_ids}\n  target={target_ids}",
            )
        )
        return findings

    raw_by_id = {"baseline": {}, "target": {}}
    for step in baseline.steps:
        raw_by_id["baseline"][step.id] = step
    for step in target.steps:
        raw_by_id["target"][step.id] = step

    for left, right in zip(baseline.steps, target.steps):
        findings.extend(_compare_step(scenario, left, right, baseline, target, raw_by_id))
    return findings


def _compare_step(scenario, left, right, baseline, target, raw_by_id) -> list[Finding]:
    findings: list[Finding] = []
    step_id = left.id

    if left.kind == "http":
        if left.status != right.status:
            findings.append(
                Finding(
                    "status",
                    scenario,
                    step_id,
                    f"상태코드가 다르다 baseline={left.status} target={right.status}",
                )
            )
        # L1 — 각 백엔드를 자기 스펙으로 검증한다
        for side_name, step, side in (
            ("baseline", left, baseline),
            ("target", right, target),
        ):
            if not step.schema_check or not _schema_applies(step):
                continue
            schema = response_schema(side.openapi, step.template, step.method, step.status)
            if schema is None:
                continue
            errors = jsonschema_lite.validate(step.parsed, schema, side.openapi)
            for error in errors:
                findings.append(
                    Finding("L1", scenario, step_id, f"{side_name} 스키마 위반 — {error}")
                )
        # 헤더
        if left.expect_request_id:
            for side_name, step in (("baseline", left), ("target", right)):
                if "x-request-id" not in step.headers:
                    findings.append(
                        Finding(
                            "header",
                            scenario,
                            step_id,
                            f"{side_name} 응답에 X-Request-Id 헤더가 없다",
                        )
                    )
            if left.headers.get("x-request-id") != right.headers.get("x-request-id"):
                findings.append(
                    Finding(
                        "header",
                        scenario,
                        step_id,
                        "X-Request-Id 헤더 값이 다르다 "
                        f"baseline={left.headers.get('x-request-id')!r} "
                        f"target={right.headers.get('x-request-id')!r}",
                    )
                )
        # L3-a
        if left.replay_of is not None:
            for side_name, step, table in (
                ("baseline", left, raw_by_id["baseline"]),
                ("target", right, raw_by_id["target"]),
            ):
                origin = table.get(step.replay_of)
                if origin is None:
                    continue
                if origin.body != step.body:
                    findings.append(
                        Finding(
                            "L3-a",
                            scenario,
                            step_id,
                            f"{side_name} 멱등 replay 가 최초 응답과 바이트가 다르다\n"
                            f"    최초={origin.body!r}\n    replay={step.body!r}",
                        )
                    )
        # L3-b
        if left.canonical:
            for side_name, step in (("baseline", left), ("target", right)):
                if not step.body:
                    continue
                error = canonicality_error(step.body)
                if error is not None:
                    findings.append(
                        Finding("L3-b", scenario, step_id, f"{side_name}: {error}")
                    )

    # datetime → 검증 후 마스킹 → L2
    left_norm = _normalize_step(left, baseline)
    right_norm = _normalize_step(right, target)
    for side_name, result in (("baseline", left_norm), ("target", right_norm)):
        for error in result.errors:
            layer = "symbol" if "등록되지 않은 UUID" in error else "datetime"
            findings.append(Finding(layer, scenario, step_id, f"{side_name}: {error}"))

    for path, form in left_norm.datetime_forms.items():
        other = right_norm.datetime_forms.get(path)
        if other is None:
            continue
        if other == form:
            continue
        if target.role == "java" and other == "Z":
            # /SPEC.md §4 의 의도적 breaking change — 유일한 예외
            continue
        findings.append(
            Finding(
                "datetime",
                scenario,
                step_id,
                f"{path}: datetime 표기가 다르다 baseline={form} target={other}",
            )
        )

    for message in structural_diff(left_norm.value, right_norm.value):
        findings.append(Finding("L2", scenario, step_id, message))
    return findings


def coverage(steps) -> set[tuple[str, str]]:
    return {
        (step.template, step.method)
        for step in steps
        if step.kind == "http"
        and step.status is not None
        and 200 <= step.status < 300
        and step.template is not None
    }
