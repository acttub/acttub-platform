"""`python -m contract_harness` 진입점."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from contract_harness import config as cfg, inventory, manifest, mutations, runner
from contract_harness.compare import Finding
from contract_harness.openapi_diff import diff_openapi, render


def _quiet_logs() -> None:
    """앱 로그는 하네스 출력이 아니다 — 실패 사유는 findings 로만 읽는다."""
    import logging
    import warnings

    warnings.filterwarnings("ignore")
    # create_app 이 매번 acting_api 로거를 INFO 로 되돌리므로 전역으로 끈다.
    # HARNESS_LOGS=1 이면 그대로 둔다.
    import os

    if os.environ.get("HARNESS_LOGS") != "1":
        logging.disable(logging.CRITICAL)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="contract_harness")
    parser.add_argument("--baseline", default="fastapi", choices=["fastapi"])
    parser.add_argument("--target", default="fastapi", choices=["fastapi", "java"])
    parser.add_argument("--java-base-url", default="http://127.0.0.1:8080")
    parser.add_argument(
        "--java-admin-base-url",
        help="ADMIN_OPS_TOKEN 을 준 contract 인스턴스 URL (admin 시나리오 전용)",
    )
    parser.add_argument(
        "--java-nostorage-base-url",
        help="contract,nostorage 프로파일 인스턴스 URL (no-storage 시나리오 전용)",
    )
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--mutation", action="append", default=[])
    parser.add_argument("--coverage", action="store_true")
    parser.add_argument("--check-manifest", action="store_true")
    parser.add_argument("--check-drift", action="store_true")
    parser.add_argument("--openapi-diff", nargs=2, metavar=("A", "B"))
    parser.add_argument("--dump-inventory", metavar="DIR")
    parser.add_argument("--rebuild-schemas", action="store_true")
    parser.add_argument(
        "--prepare-schemas",
        action="store_true",
        help="스키마 두 벌만 만들고 끝낸다 (java 인스턴스 기동 전에 돌린다)",
    )
    parser.add_argument("--verbose", action="store_true")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    _quiet_logs()

    if args.openapi_diff:
        return _openapi_diff(args)
    if args.check_manifest:
        return _check_manifest()
    if args.dump_inventory:
        return _dump_inventory(Path(args.dump_inventory))
    if args.prepare_schemas:
        return _prepare_schemas(args)
    if args.self_test:
        return _self_test(args)
    if args.coverage:
        return _run(args, coverage_only=True)
    if args.check_drift:
        return _check_drift(args)
    return _run(args)


def _prepare_schemas(args) -> int:
    """스키마 두 벌만 만들고 끝낸다.

    java 인스턴스는 contract 프로파일에서 flyway 를 끄고 `ddl-auto: validate` 로 뜨므로
    **스키마가 먼저 있어야 한다** — 없는 상태로 띄우면 셋 다 검증 실패로 죽는다. 그렇다고
    스키마를 만들자고 전 시나리오 실행을 한 번 돌리는 것은 의도가 드러나지 않는다.
    """
    started = time.monotonic()
    runner.prepare_schemas(force=args.rebuild_schemas)
    elapsed = time.monotonic() - started
    print(
        f"스키마 준비: {cfg.BASELINE_SCHEMA} · {cfg.TARGET_SCHEMA} "
        f"(alembic head, 소요 {elapsed:.1f}초)"
    )
    return 0


# --- 기본 실행 -------------------------------------------------------------


def _run(args, *, coverage_only: bool = False) -> int:
    started = time.monotonic()
    runner.prepare_schemas(force=args.rebuild_schemas)
    scenarios = runner.all_scenarios(args.only)
    java_base_url = args.java_base_url if args.target == "java" else None
    java_profile_base_urls = _java_profile_base_urls(args, scenarios)
    skipped: list[str] = []
    result_seed = runner.verify_seed_parity()
    result = runner.run_scenarios(
        scenarios,
        java_base_url=java_base_url,
        java_profile_base_urls=java_profile_base_urls,
    )
    result.findings.extend(result_seed)

    # 아래 검증은 **백엔드 종류와 무관하게** 돈다. java 라고 건너뛰면
    # "M1 하네스 전량 통과" 가 관문이 될 때 관문이 비어 있게 된다.
    result.findings.extend(runner.verify_manifest(result))
    result.findings.extend(runner.verify_admin_snapshot(result))
    result.findings.extend(runner.verify_unknown_keys(result))
    result.findings.extend(runner.verify_no_accidental_rate_limits(result))
    if not args.only:
        result.findings.extend(runner.verify_idempotency_transitions(result))
    # target 스펙 자체를 커밋된 계약과 semantic 비교한다. 별도 CLI 로만 두면
    # 판정 경로에 안 붙는다. `--only` 로 좁힌 실행에서는 밟은 경로만 본다.
    scope = None
    if args.only:
        scope = {template for template, _method in result.executed}
        skipped.append(
            f"openapi 계약 비교 — --only 실행이라 밟은 경로 {len(scope)}개만 본다"
        )
    result.findings.extend(runner.verify_openapi_contract(result, scope_to=scope))
    baseline_openapi = result.baseline_openapi_by_profile.get("default")
    if baseline_openapi is not None:
        drift = inventory.check_drift(baseline_openapi)
        for problem in drift.problems:
            result.findings.append(Finding("drift", "-", "-", problem))

    print(f"시나리오 {len(scenarios)}개: {', '.join(result.scenarios_run)}")
    for reason in skipped:
        print(f"  (건너뜀) {reason}")
    _print_findings(result.findings, args.verbose)

    declared, executed, missing = runner.coverage_report(result)
    print(
        f"\ncoverage: {len(executed)}/{len(declared)} operation 이 2xx 로 실행됐다"
    )
    if missing:
        print("미실행 operation:")
        for path, method in sorted(missing):
            print(f"  {method.upper()} {path}")
    elapsed = time.monotonic() - started
    print(f"\n소요 {elapsed:.1f}초")
    if coverage_only:
        return 0 if not missing else 1
    if missing and not args.only:
        result.findings.append(
            Finding("coverage", "-", "-", f"미실행 operation {len(missing)}개")
        )
    print(runner.summarize(result))
    return 0 if result.ok() else 1


def _java_profile_base_urls(args, scenarios) -> dict[str, str] | None:
    if args.target != "java":
        return None
    configured = {
        "admin": args.java_admin_base_url,
        "nostorage": args.java_nostorage_base_url,
    }
    required = {scenario.profile for scenario in scenarios} - {"default"}
    missing = sorted(profile for profile in required if not configured.get(profile))
    if missing:
        flags = ", ".join(f"--java-{profile}-base-url" for profile in missing)
        raise SystemExit(
            "java의 조건부 프로파일은 별도 인스턴스여야 한다. 빠진 인자: " + flags
        )
    selected = {profile: configured[profile] for profile in required}
    urls = [args.java_base_url, *selected.values()]
    if len({url.rstrip("/") for url in urls}) != len(urls):
        raise SystemExit(
            "기본·admin·nostorage Java URL은 서로 다른 Spring 인스턴스여야 한다"
        )
    return selected


def _print_findings(findings, verbose: bool) -> None:
    if not findings:
        print("차이 없음 (diff 0)")
        return
    print(f"차이 {len(findings)}건:")
    limit = len(findings) if verbose else 60
    for finding in findings[:limit]:
        print(f"  {finding}")
    if len(findings) > limit:
        print(f"  ... 그리고 {len(findings) - limit}건 더 (--verbose)")


# --- self-test -------------------------------------------------------------


def _self_test(args) -> int:
    started = time.monotonic()
    runner.prepare_schemas(force=args.rebuild_schemas)
    selected = [
        mutation
        for mutation in mutations.MUTATIONS
        if not args.mutation or mutation.name in args.mutation
    ]
    unknown = set(args.mutation) - {m.name for m in mutations.MUTATIONS}
    if unknown:
        raise SystemExit(f"알 수 없는 변조: {sorted(unknown)}")

    print(f"변조 {len(selected)}건을 각각 지정된 계층이 잡는지 확인한다\n")
    failures = []
    for mutation in selected:
        scenario = runner.BY_NAME[mutation.scenario]
        result = runner.run_scenarios([scenario], target_mutation=mutation)
        findings = list(result.findings)
        findings.extend(runner.verify_manifest(result))
        findings.extend(runner.verify_admin_snapshot(result))
        findings.extend(runner.verify_unknown_keys(result))
        fired = {finding.layer for finding in findings}
        caught = bool(fired & mutation.expected_layers)
        forbidden = fired & mutation.forbidden_layers
        status = "OK  " if caught and not forbidden else "FAIL"
        if not caught or forbidden:
            failures.append((mutation, fired, findings))
        print(
            f"  [{status}] {mutation.name:26s} {mutation.scenario:20s} "
            f"기대={sorted(mutation.expected_layers)} 실제={sorted(fired) or '없음'}"
        )
        if forbidden:
            print(f"          ! 걸리면 안 되는 계층이 걸렸다: {sorted(forbidden)}")
        if args.verbose:
            for finding in findings[:10]:
                print(f"          {finding}")

    print()
    if failures:
        print(f"변조 {len(failures)}건을 잡지 못했다:")
        for mutation, fired, findings in failures:
            print(f"  - {mutation.name}: 실제 계층={sorted(fired) or '없음'}")
            for finding in findings[:5]:
                print(f"      {finding}")
    else:
        print(f"변조 {len(selected)}건 전부 지정된 계층이 잡았다")
    print(f"소요 {time.monotonic() - started:.1f}초")
    return 0 if not failures else 1


# --- 보조 명령 -------------------------------------------------------------


def _check_manifest() -> int:
    report = manifest.check()
    print(f"오류 계약 inventory {len(report.inventory)}건 (AST 파싱)")
    print(f"  manifest 케이스 연결: {len(manifest.covered_keys())}건")
    print(f"  명시적 제외: {len(manifest.excluded_keys())}건")
    if report.stale_cases:
        print("\nmanifest 가 가리키지만 소스에 없는 항목:")
        for key in report.stale_cases:
            print(f"  {key}")
    if report.stale_exclusions:
        print("\n제외 목록이 가리키지만 소스에 없는 항목:")
        for key in report.stale_exclusions:
            print(f"  {key}")
    if report.unlinked:
        print(f"\n미연결 {len(report.unlinked)}건 — 하네스 실패:")
        for site in report.unlinked:
            print(f"  {site.key}  (route={site.route})")
    if report.ok():
        print("\n미연결 없음")
    return 0 if report.ok() else 1


def _check_drift(args) -> int:
    runner.prepare_schemas(force=args.rebuild_schemas)
    backend = runner.make_backend("baseline", cfg.BASELINE_SCHEMA)
    with backend.session() as opened:
        openapi = opened.openapi()
    report = inventory.check_drift(openapi)
    for problem in report.problems:
        print(f"  {problem}")
    print("드리프트 없음" if report.ok() else f"드리프트 {len(report.problems)}건")
    return 0 if report.ok() else 1


def _openapi_diff(args) -> int:
    left = json.loads(Path(args.openapi_diff[0]).read_text(encoding="utf-8"))
    right = json.loads(Path(args.openapi_diff[1]).read_text(encoding="utf-8"))
    diffs = diff_openapi(left, right)
    print(render(diffs))
    return 0 if not diffs else 1


def _dump_inventory(directory: Path) -> int:
    # 커밋된 스펙에서 만든다 — live 와 커밋본이 어긋나는지는 check_drift 가 본다.
    openapi = json.loads(cfg.COMMITTED_OPENAPI.read_text(encoding="utf-8"))
    directory.mkdir(parents=True, exist_ok=True)
    inventory.write_fixture(
        directory / "success-response-models.json",
        inventory.success_response_models(openapi),
    )
    inventory.write_fixture(
        directory / "response-component-shapes.json",
        inventory.response_component_shapes(openapi),
    )
    inventory.write_fixture(
        directory / "error-contract.json",
        [site.as_dict() for site in inventory.error_inventory()],
    )
    inventory.write_fixture(
        directory / "idempotency-transitions.json",
        inventory.idempotency_transitions(),
    )
    inventory.write_fixture(
        directory / "unknown-key-policy.json",
        inventory.unknown_key_policy(openapi),
    )
    print(f"inventory 를 {directory} 에 썼다")
    return 0


if __name__ == "__main__":
    sys.exit(main())
