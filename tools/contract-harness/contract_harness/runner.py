"""시나리오 실행 · 3단 비교 · 커버리지 · manifest 대조."""

from __future__ import annotations

import json
import traceback
from dataclasses import dataclass, field

from contract_harness import config as cfg, dbsetup, manifest, seed
from contract_harness.backends import FastapiBackend, JavaBackend
from contract_harness.compare import Finding, SideResult, compare, coverage
from contract_harness.framework import ScenarioContext, ScenarioAbort
from contract_harness.inventory import success_response_models
from contract_harness.normalize import SymbolTable
from contract_harness.scenarios import BY_NAME, SCENARIOS
from contract_harness.scenarios.support import bootstrap_symbols

ADMIN_PATHS = ("/v2/admin/stats", "/v2/admin/sessions")


@dataclass
class RunResult:
    findings: list[Finding] = field(default_factory=list)
    executed: set = field(default_factory=set)
    steps_by_scenario: dict = field(default_factory=dict)
    baseline_steps_by_scenario: dict = field(default_factory=dict)
    openapi_by_profile: dict = field(default_factory=dict)
    scenarios_run: list = field(default_factory=list)

    def ok(self) -> bool:
        return not self.findings


def make_backend(name, schema, *, profile="default", mutation=None) -> FastapiBackend:
    return FastapiBackend(
        name,
        database_url=cfg.database_url(),
        schema=schema,
        profile=profile,
        mutation=mutation,
    )


def prepare_schemas(*, force: bool = False) -> None:
    url = cfg.database_url()
    for schema in (cfg.BASELINE_SCHEMA, cfg.TARGET_SCHEMA):
        dbsetup.ensure_schema(url, schema, force=force)


def _reset(schema: str) -> None:
    url = cfg.database_url()
    dbsetup.truncate(url, schema)
    seed.apply_seed(url, schema)


def verify_seed_parity() -> list[Finding]:
    """두 스키마 시드가 동일하고 고정 UUID 가 양쪽에서 같은지."""
    url = cfg.database_url()
    fingerprints = {}
    for schema in (cfg.BASELINE_SCHEMA, cfg.TARGET_SCHEMA):
        _reset(schema)
        fingerprints[schema] = dbsetup.seed_fingerprint(url, schema)
    if len(set(fingerprints.values())) != 1:
        return [
            Finding(
                "seed",
                "-",
                "-",
                f"두 스키마의 시드가 다르다: {fingerprints}",
            )
        ]
    return []


def run_side(scenario, backend, schema):
    _reset(schema)
    symbols = SymbolTable()
    bootstrap_symbols(symbols)
    abort = None
    with backend.session() as opened:
        ctx = ScenarioContext(opened, symbols, scenario.name)
        try:
            scenario.run(ctx)
        except ScenarioAbort as exc:
            abort = str(exc)
        except Exception as exc:  # noqa: BLE001 - 시나리오 실패를 발견으로 바꾼다
            abort = f"{exc!r}\n{traceback.format_exc()}"
        finally:
            ctx.close()
        openapi = opened.openapi()
    return SideResult(backend, ctx.steps, symbols, openapi), abort


def run_scenarios(
    scenarios,
    *,
    target_mutation=None,
    java_base_url: str | None = None,
) -> RunResult:
    result = RunResult()
    for scenario in scenarios:
        baseline_backend = make_backend(
            "baseline", cfg.BASELINE_SCHEMA, profile=scenario.profile
        )
        if java_base_url is not None:
            target_backend = JavaBackend("java", java_base_url)
        else:
            target_backend = make_backend(
                "target",
                cfg.TARGET_SCHEMA,
                profile=scenario.profile,
                mutation=target_mutation,
            )
        baseline_side, baseline_abort = run_side(
            scenario, baseline_backend, cfg.BASELINE_SCHEMA
        )
        if java_base_url is not None:
            target_side, target_abort = _run_java_side(scenario, target_backend)
        else:
            target_side, target_abort = run_side(
                scenario, target_backend, cfg.TARGET_SCHEMA
            )
        result.scenarios_run.append(scenario.name)
        # manifest·admin 스냅샷·unknown key 판정은 **검사 대상(target)** 을 본다.
        # baseline 을 보면 변조된 백엔드를 영원히 통과시킨다.
        result.steps_by_scenario[scenario.name] = target_side.steps
        result.baseline_steps_by_scenario[scenario.name] = baseline_side.steps
        result.openapi_by_profile.setdefault(scenario.profile, target_side.openapi)
        if baseline_abort is not None:
            result.findings.append(
                Finding("scenario", scenario.name, "-", f"baseline 중단: {baseline_abort}")
            )
        if target_abort is not None:
            result.findings.append(
                Finding("scenario", scenario.name, "-", f"target 중단: {target_abort}")
            )
        result.findings.extend(compare(scenario.name, baseline_side, target_side))
        result.executed |= coverage(baseline_side.steps)
    return result


def _run_java_side(scenario, backend):
    symbols = SymbolTable()
    bootstrap_symbols(symbols)
    abort = None
    with backend.session() as opened:
        ctx = ScenarioContext(opened, symbols, scenario.name)
        try:
            scenario.run(ctx)
        except ScenarioAbort as exc:
            abort = str(exc)
        except Exception as exc:  # noqa: BLE001
            abort = f"{exc!r}\n{traceback.format_exc()}"
        finally:
            ctx.close()
        try:
            openapi = opened.openapi() or {}
        except Exception:  # noqa: BLE001 - springdoc 이 아직 없을 수 있다
            openapi = {}
    return SideResult(backend, ctx.steps, symbols, openapi), abort


# --- 커버리지 --------------------------------------------------------------


def declared_operations(openapi: dict) -> set:
    return {
        (path, method)
        for path, item in openapi["paths"].items()
        for method in item
        if method
        in {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
    }


def coverage_report(result: RunResult) -> tuple[set, set, set]:
    """(선언된 operation, 2xx 로 실행된 것, 미실행)."""
    declared = set()
    for openapi in result.openapi_by_profile.values():
        declared |= declared_operations(openapi)
    executed = result.executed
    return declared, executed, declared - executed


# --- manifest 대조 ---------------------------------------------------------


def verify_manifest(result: RunResult) -> list[Finding]:
    findings: list[Finding] = []
    for case in manifest.CASES:
        steps = result.steps_by_scenario.get(case.scenario)
        if steps is None:
            continue
        step = next((item for item in steps if item.id == case.step), None)
        if step is None:
            findings.append(
                Finding(
                    "manifest",
                    case.scenario,
                    case.step,
                    f"{case.case_id}: manifest 가 가리키는 스텝이 실행되지 않았다",
                )
            )
            continue
        if step.status != case.status:
            findings.append(
                Finding(
                    "manifest",
                    case.scenario,
                    case.step,
                    f"{case.case_id}: 상태코드가 다르다 "
                    f"기대={case.status} 실제={step.status} body={step.body[:200]!r}",
                )
            )
        if case.detail is not None:
            actual = (step.parsed or {}).get("detail") if isinstance(step.parsed, dict) else None
            if actual != case.detail:
                findings.append(
                    Finding(
                        "manifest",
                        case.scenario,
                        case.step,
                        f"{case.case_id}: detail 이 다르다 "
                        f"기대={case.detail!r} 실제={actual!r}",
                    )
                )
    return findings


# --- admin 스냅샷 ----------------------------------------------------------


def verify_admin_snapshot(result: RunResult) -> list[Finding]:
    admin = result.openapi_by_profile.get("admin")
    if admin is None:
        return []
    default = result.openapi_by_profile.get("default")
    if default is None:
        # admin 시나리오만 돌렸을 때는 커밋된 스펙을 기준으로 삼는다.
        default = json.loads(cfg.COMMITTED_OPENAPI.read_text(encoding="utf-8"))
    added = set(admin["paths"]) - set(default["paths"])
    if added != set(ADMIN_PATHS):
        return [
            Finding(
                "admin-snapshot",
                "admin",
                "-",
                "admin 프로파일이 추가한 경로가 다르다 "
                f"기대={sorted(ADMIN_PATHS)} 실제={sorted(added)}",
            )
        ]
    return []


# --- 멱등 전이표 대조 -------------------------------------------------------

# AST 로 뽑은 전이표에서 도달 불가능한 것으로 manifest 가 명시 제외한 상태코드.
IDEMPOTENCY_EXCLUDED_STATUSES = {
    # practice_sessions.py:_idempotent_response 의 invalid_operation_state.
    # OperationStatus 4개가 모두 앞 분기에서 처리돼 도달할 수 없다(manifest.py 제외 사유).
    "invalid_operation_state": 409,
}


def verify_idempotency_transitions(result: RunResult) -> list[Finding]:
    """소스에서 뽑은 전이표의 상태코드가 실행으로 전부 관측되는지."""
    from contract_harness.inventory import idempotency_transitions

    table = idempotency_transitions()
    declared: set[int] = set()
    for rows in table.values():
        for row in rows:
            declared |= set(row["statuses"])
    declared |= {200, 202}  # 정상 경로는 조건문 밖에서 반환된다
    observed = {
        step.status
        for scenario in ("reanalyze", "worker-failure", "main-flow")
        for step in result.baseline_steps_by_scenario.get(scenario, [])
        if step.kind == "http"
        and step.template
        in {
            "/v2/practice-sessions",
            "/v2/practice-sessions/{session_id}/analyze",
        }
    }
    missing = declared - observed - set(IDEMPOTENCY_EXCLUDED_STATUSES.values())
    if missing:
        return [
            Finding(
                "idempotency",
                "-",
                "-",
                f"멱등 전이표가 선언한 상태코드 중 실행되지 않은 것: {sorted(missing)}",
            )
        ]
    return []


# --- 레이트리밋 오염 --------------------------------------------------------

RATE_LIMIT_SCENARIOS = {"rate-limiter"}


def verify_no_accidental_rate_limits(result: RunResult) -> list[Finding]:
    """본 시나리오는 레이트리밋에 걸리지 않아야 한다.

    양쪽이 똑같이 429 를 내면 diff 0 이라 통과해 버린다. 경계를 넘는 것은
    §rate limiter 시나리오만의 일이다.
    """
    findings: list[Finding] = []
    for scenario, steps in result.baseline_steps_by_scenario.items():
        if scenario in RATE_LIMIT_SCENARIOS:
            continue
        for step in steps:
            if step.kind == "http" and step.status == 429:
                findings.append(
                    Finding(
                        "rate-limit",
                        scenario,
                        step.id,
                        "본 시나리오가 레이트리밋(429)에 걸렸다 — 유저를 나눠 잘라야 한다",
                    )
                )
    return findings


# --- unknown key 정책 대조 --------------------------------------------------


def verify_unknown_keys(result: RunResult) -> list[Finding]:
    from contract_harness.inventory import allowed_unknown_key_operations
    from contract_harness.scenarios.edges import UNKNOWN_KEY_CASES

    default = result.openapi_by_profile.get("default")
    steps = result.steps_by_scenario.get("unknown-keys")
    if default is None or steps is None:
        return []
    allowed = allowed_unknown_key_operations(default)
    by_id = {step.id: step for step in steps}
    findings: list[Finding] = []
    declared = {
        f"{method} {template}" for _case, method, template, _params, _body in UNKNOWN_KEY_CASES
    }
    policy_keys = set(allowed) | {
        key
        for key in _all_request_body_operations(default)
    }
    missing = policy_keys - declared
    if missing:
        findings.append(
            Finding(
                "unknown-key",
                "unknown-keys",
                "-",
                f"요청 바디가 있는 operation 중 회귀 테스트가 없는 것: {sorted(missing)}",
            )
        )
    for case, method, template, _params, _body in UNKNOWN_KEY_CASES:
        step = by_id.get(f"unknown.{case}.verdict")
        if step is None:
            continue
        rejected = bool(step.note["extra_forbidden"])
        should_allow = f"{method} {template}" in allowed
        if should_allow and rejected:
            findings.append(
                Finding(
                    "unknown-key",
                    "unknown-keys",
                    case,
                    f"{method} {template} 는 openapi 상 unknown key 를 허용하는데 거부했다",
                )
            )
        if not should_allow and not rejected:
            findings.append(
                Finding(
                    "unknown-key",
                    "unknown-keys",
                    case,
                    f"{method} {template} 는 additionalProperties: false 인데 "
                    f"unknown key 를 통과시켰다 (status={step.note['status']})",
                )
            )
    return findings


def _all_request_body_operations(openapi: dict) -> set:
    from contract_harness.inventory import unknown_key_policy

    return set(unknown_key_policy(openapi))


# --- 요약 -----------------------------------------------------------------


def summarize(result: RunResult) -> str:
    lines = []
    by_layer: dict[str, int] = {}
    for finding in result.findings:
        by_layer[finding.layer] = by_layer.get(finding.layer, 0) + 1
    if not result.findings:
        lines.append("diff 0 — 전 시나리오에서 차이 없음")
    else:
        lines.append(f"차이 {len(result.findings)}건 " + json.dumps(by_layer, sort_keys=True))
    return "\n".join(lines)


def all_scenarios(only=None):
    if not only:
        return SCENARIOS
    selected = []
    for name in only:
        if name in BY_NAME:
            selected.append(BY_NAME[name])
            continue
        matched = [
            scenario
            for scenario in SCENARIOS
            if name.strip("/") in scenario.name
        ]
        if not matched:
            raise SystemExit(f"알 수 없는 시나리오: {name} (가능: {sorted(BY_NAME)})")
        selected.extend(matched)
    seen: dict[str, object] = {}
    for scenario in selected:
        seen.setdefault(scenario.name, scenario)
    return tuple(seen.values())


def response_matrix(openapi: dict) -> dict:
    return success_response_models(openapi)
