"""normalize · canonical · jsonschema_lite · inventory 단위 테스트."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timezone

import pytest

from contract_harness import config as cfg, jsonschema_lite
from contract_harness.canonical import canonical_encode, canonicality_error
from contract_harness.inventory import (
    allowed_unknown_key_operations,
    error_inventory,
    idempotency_transitions,
    response_component_shapes,
    success_response_models,
)
from contract_harness.manifest import check as manifest_check
from contract_harness.normalize import SymbolTable, normalize


@pytest.fixture(scope="module")
def committed() -> dict:
    return json.loads(cfg.COMMITTED_OPENAPI.read_text(encoding="utf-8"))


# --- canonical -------------------------------------------------------------


def test_canonical_accepts_sorted_compact_utf8():
    raw = canonical_encode({"b": 1, "a": "한글"})
    assert raw == b'{"a":"\xed\x95\x9c\xea\xb8\x80","b":1}'
    assert canonicality_error(raw) is None


def test_canonical_rejects_unsorted_keys():
    raw = json.dumps({"b": 1, "a": 2}, separators=(",", ":")).encode()
    assert "정렬" in canonicality_error(raw)


def test_canonical_rejects_ascii_escape():
    raw = json.dumps({"a": "한글"}, sort_keys=True, separators=(",", ":")).encode()
    assert "escape" in canonicality_error(raw)


def test_canonical_rejects_whitespace():
    raw = json.dumps({"a": 1, "b": 2}, sort_keys=True).encode()
    assert canonicality_error(raw) is not None


# --- symbolic ID -----------------------------------------------------------


def test_unregistered_uuid_fails_instead_of_getting_a_new_symbol():
    symbols = SymbolTable()
    result = normalize({"id": "11111111-1111-4111-8111-111111111111"}, symbols, role="fastapi")
    assert result.errors and "등록되지 않은 UUID" in result.errors[0]


def test_same_value_gets_one_symbol_across_field_names():
    symbols = SymbolTable()
    value = "11111111-1111-4111-8111-111111111111"
    symbols.register(value, "coach_session")
    result = normalize(
        {"session_id": value, "coach_session_id": value}, symbols, role="fastapi"
    )
    assert result.value == {
        "session_id": "$coach_session_1",
        "coach_session_id": "$coach_session_1",
    }


def test_harness_access_token_round_trips_through_real_python_jwt_service():
    from acting_api.auth.jwt import ACCESS_TOKEN_TTL, JwtService
    from contract_harness.framework import ScenarioContext, mint_access_token

    issued_at = datetime(2026, 8, 8, 12, 34, 56, tzinfo=timezone.utc)
    user_id = uuid.UUID("11111111-1111-4111-8111-111111111111")
    token_id = uuid.UUID("22222222-2222-4222-8222-222222222222")
    token = mint_access_token(
        str(user_id), issued_at=issued_at, token_id=token_id
    )

    encoded_header = token.split(".")[0]
    padded_header = encoded_header + "=" * (-len(encoded_header) % 4)
    assert json.loads(base64.urlsafe_b64decode(padded_header)) == {
        "alg": "HS256",
        "typ": "JWT",
    }
    claims = JwtService(cfg.JWT_SECRET).decode_access_token(
        token, now=issued_at
    )
    assert claims.user_id == user_id
    assert claims.token_id == token_id
    assert claims.expires_at == issued_at + ACCESS_TOKEN_TTL

    baseline = ScenarioContext(
        object(), SymbolTable(), "profile", token_issued_at=issued_at
    )
    target = ScenarioContext(
        object(), SymbolTable(), "profile", token_issued_at=issued_at
    )
    assert baseline.token(str(user_id)) == target.token(str(user_id))


def test_harness_clock_reset_invalidates_process_local_rate_limit_window():
    from acting_api.ratelimit import RateLimiter
    from contract_harness.stubs import HarnessClock

    clock = HarnessClock()
    limiter = RateLimiter(clock=clock.monotonic)
    assert limiter.allow("caller", 1) is True
    assert limiter.allow("caller", 1) is False
    clock.advance(60)
    assert limiter.allow("caller", 1) is True
    assert limiter.allow("caller", 1) is False

    clock.reset()
    assert clock.offset == 0.0
    assert limiter.allow("caller", 1) is True


# --- datetime --------------------------------------------------------------


def test_datetime_is_validated_before_masking():
    symbols = SymbolTable()
    result = normalize(
        {"created_at": "2026-01-01T00:00:00.123+00:00"}, symbols, role="fastapi"
    )
    assert result.value == {"created_at": "<datetime>"}
    assert any("소수 자릿수" in error for error in result.errors)


def test_java_role_requires_z_suffix():
    symbols = SymbolTable()
    result = normalize(
        {"created_at": "2026-01-01T00:00:00.123456+00:00"}, symbols, role="java"
    )
    assert any("Z 접미사" in error for error in result.errors)
    assert not normalize(
        {"created_at": "2026-01-01T00:00:00.123456Z"}, symbols, role="java"
    ).errors


def test_updated_before_created_is_flagged():
    symbols = SymbolTable()
    result = normalize(
        {
            "created_at": "2026-01-02T00:00:00.000000Z",
            "updated_at": "2026-01-01T00:00:00.000000Z",
        },
        symbols,
        role="fastapi",
    )
    assert any("updated_at" in error for error in result.errors)


# --- opaque ----------------------------------------------------------------


def test_cursor_is_opaque_but_type_is_kept():
    symbols = SymbolTable()
    result = normalize(
        {"next_cursor": "abc", "other": None}, symbols, role="fastapi"
    )
    assert result.value == {"next_cursor": "<cursor>", "other": None}


def test_presign_url_is_compared_by_structure():
    symbols = SymbolTable()
    url = (
        "https://s3.ap-northeast-2.amazonaws.com/bucket/users/"
        "11111111-1111-4111-8111-111111111111/uploads/"
        "22222222-2222-4222-8222-222222222222.mp4?X-Amz-Signature=deadbeef"
    )
    shape = normalize({"playback_url": url}, symbols, role="fastapi").value
    assert shape["playback_url"]["path"] == "/bucket/users/<uuid>/uploads/<uuid>.mp4"
    assert shape["playback_url"]["query_keys"] == ["X-Amz-Signature"]


# --- jsonschema_lite -------------------------------------------------------


def test_additional_properties_false_is_enforced(committed):
    schema = {"$ref": "#/components/schemas/HealthResponse"}
    payload = {
        "status": "ok",
        "services": ["summary"],
        "model": "m",
        "keep_alive": False,
        "commit": "abc",
    }
    assert jsonschema_lite.validate(payload, schema, committed) == []
    assert jsonschema_lite.validate({**payload, "extra": 1}, schema, committed)
    assert jsonschema_lite.validate(
        {key: value for key, value in payload.items() if key != "commit"},
        schema,
        committed,
    )


def test_booleans_are_not_integers(committed):
    assert jsonschema_lite.validate(True, {"type": "integer"}, committed)
    assert jsonschema_lite.validate(1, {"type": "integer"}, committed) == []


# --- inventory -------------------------------------------------------------


def test_inventory_is_generated_from_openapi_not_hardcoded(committed):
    models = success_response_models(committed)
    assert models["get /health 200"] == "HealthResponse"
    shapes = response_component_shapes(committed)
    assert shapes["HealthResponse"]["additional_properties"] is False


def test_unknown_key_allow_set_comes_from_openapi(committed):
    allowed = allowed_unknown_key_operations(committed)
    # 숫자를 박지 않는다 — 집합이 openapi 에서 생성된다는 것만 확인한다.
    assert "post /v2/auth/login" in allowed
    assert "post /v2/practice-sessions" not in allowed


def test_error_inventory_catches_multiline_detail():
    sites = error_inventory()
    details = {site.detail for site in sites}
    assert "report already exists for practice session" in details
    assert "practice session not found" in details
    assert "practice_session_not_found" in details


def test_error_inventory_includes_non_route_errors():
    sites = error_inventory()
    categories = {site.category for site in sites}
    assert "pydantic_validator" in categories
    assert "exception_handler" in categories
    assert any(
        site.symbol.endswith("current_user") and site.status == 401 for site in sites
    )


def test_every_inventory_item_is_linked_or_excluded():
    report = manifest_check()
    assert report.unlinked == []
    assert report.stale_cases == []
    assert report.stale_exclusions == []


def test_idempotency_transitions_are_extracted():
    table = idempotency_transitions()
    conditions = {
        row["condition"]
        for rows in table.values()
        for row in rows
    }
    assert any("succeeded" in condition for condition in conditions)
    assert any("failed" in condition for condition in conditions)


# --- 커밋된 inventory 스냅샷 드리프트 ----------------------------------------


def test_committed_inventory_snapshot_matches_regeneration(committed, tmp_path):
    """`--dump-inventory` 결과가 커밋본과 같아야 한다.

    커밋된 스냅샷은 사람이 리뷰하는 용도이고, 실제 판정은 언제나 실행 시점의
    생성물이 한다. 둘이 어긋나면 스냅샷이 낡은 것이므로 여기서 알린다.
    """
    from contract_harness.inventory import unknown_key_policy, write_fixture

    directory = cfg.HARNESS_ROOT.parent / "inventory"
    expected = {
        "success-response-models.json": success_response_models(committed),
        "response-component-shapes.json": response_component_shapes(committed),
        "error-contract.json": [site.as_dict() for site in error_inventory()],
        "idempotency-transitions.json": idempotency_transitions(),
        "unknown-key-policy.json": unknown_key_policy(committed),
    }
    for name, payload in expected.items():
        write_fixture(tmp_path / name, payload)
        assert (tmp_path / name).read_text(encoding="utf-8") == (
            directory / name
        ).read_text(encoding="utf-8"), f"{name} 스냅샷이 낡았다 (--dump-inventory 로 재생성)"


def test_in_flight_and_expiry_contracts_are_executed_not_excluded():
    """이 둘은 제외 사유가 성립하지 않는다 — 실행 케이스로만 유지한다.

    409 `request is still processing` 은 LLM 스텁 게이트가, 409
    `upload_intent_expired` 는 DB 값 조작이 결정적으로 만든다. 다시 제외 목록으로
    돌아가면 여기서 실패한다.
    """
    from contract_harness.manifest import API, covered_keys, excluded_keys, key

    must_execute = {
        key(f"{API}/sync_operations.py", "_existing_operation_response", 409,
            "request is still processing"),
        key(f"{API}/coaching.py", "build_router.coach_start", 409,
            "request is still processing"),
        key(f"{API}/coaching.py", "build_router.coach_reply", 409,
            "request is still processing"),
        key(f"{API}/coaching.py", "build_router.coach_confirm", 409,
            "request is still processing"),
        key(f"{API}/reports.py", "build_router.create_report", 409,
            "request is still processing"),
        key(f"{API}/uploads.py", "build_router.complete_intent", 409,
            "upload_intent_expired"),
    }
    covered = covered_keys()
    excluded = set(excluded_keys())
    assert must_execute <= covered
    assert not (must_execute & excluded)


# --- TTL 길이·미래 시각 (상대 순서만 보면 못 잡는 것들) ----------------------


def _sent_at():
    from datetime import datetime, timezone

    return datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_ttl_length_is_checked_against_source_constant():
    from datetime import timedelta

    from acting_api.uploads import UPLOAD_INTENT_TTL
    from contract_harness.normalize import normalize

    sent = _sent_at()
    ok = (sent + UPLOAD_INTENT_TTL).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")
    assert not normalize(
        {"expires_at": ok}, SymbolTable(), role="fastapi", sent_at=sent
    ).errors
    one_year = (sent + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")
    errors = normalize(
        {"expires_at": one_year}, SymbolTable(), role="fastapi", sent_at=sent
    ).errors
    assert any("TTL" in error for error in errors)


def test_future_created_at_is_rejected():
    from contract_harness.normalize import normalize

    errors = normalize(
        {"created_at": "2099-01-01T00:00:00.000000+00:00"},
        SymbolTable(),
        role="fastapi",
        sent_at=_sent_at(),
    ).errors
    assert any("미래" in error for error in errors)


def test_expires_at_is_allowed_to_be_in_the_future():
    from acting_api.uploads import UPLOAD_INTENT_TTL
    from contract_harness.normalize import normalize

    sent = _sent_at()
    value = (sent + UPLOAD_INTENT_TTL).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")
    assert not normalize(
        {"expires_at": value}, SymbolTable(), role="fastapi", sent_at=sent
    ).errors


# --- presign 서명 인자 -------------------------------------------------------


def test_object_key_shape_keeps_the_user_segment():
    from contract_harness.stubs import StorageStub

    shape = StorageStub.object_key_shape(
        "users/11111111-1111-4111-8111-111111111111/uploads/deadbeef.mp4"
    )
    assert shape == "users/11111111-1111-4111-8111-111111111111/uploads/<file>.mp4"


def test_presign_calls_record_signing_arguments():
    from contract_harness.stubs import StorageStub

    stub = StorageStub()
    stub.presign_upload(
        object_key="users/11111111-1111-4111-8111-111111111111/uploads/a.mp4",
        mime_type="video/mp4",
        size_bytes=4096,
        expires_in_sec=1800,
    )
    call = stub.state()["presign_calls"][0]
    assert call["http_method"] == "PUT"
    assert call["content_type"] == "video/mp4"
    assert call["content_length"] == 4096
    assert call["expires_in_sec"] == 1800
    assert "11111111-1111-4111-8111-111111111111" in call["object_key"]


# --- java 대상 판정 경로 -----------------------------------------------------


def test_coverage_declared_comes_from_baseline_not_target():
    """target 문서에서 operation 을 빼도 기준이 줄어들지 않아야 한다."""
    from contract_harness.runner import RunResult, coverage_report

    result = RunResult()
    result.baseline_openapi_by_profile["default"] = {
        "paths": {"/a": {"get": {}}, "/b": {"get": {}}}
    }
    result.openapi_by_profile["default"] = {"paths": {"/a": {"get": {}}}}
    result.executed = {("/a", "get")}
    declared, executed, missing = coverage_report(result)
    assert declared == {("/a", "get"), ("/b", "get")}
    assert missing == {("/b", "get")}


def test_scoped_openapi_slice_keeps_reachable_components():
    from contract_harness.runner import _scoped_document

    document = {
        "openapi": "3.1.0",
        "paths": {
            "/health": {
                "get": {
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/H"}
                                }
                            }
                        }
                    }
                }
            },
            "/other": {"get": {}},
        },
        "components": {"schemas": {"H": {"type": "object"}, "Unused": {}}},
    }
    scoped = _scoped_document(document, {"/health"})
    assert set(scoped["paths"]) == {"/health"}
    assert set(scoped["components"]["schemas"]) == {"H"}


# --- 204 후속 관측 · 동시 확정 케이스가 제외로 돌아가지 않는지 ---------------


def test_previously_unreachable_contracts_are_executed_not_excluded():
    from contract_harness.manifest import API, covered_keys, excluded_keys, key

    must_execute = {
        key(f"{API}/uploads.py", "build_router.complete_intent", 413,
            "upload_too_large"),
        key(f"{API}/coaching.py", "build_router.coach_reply", 409,
            "session changed concurrently"),
        key(f"{API}/coaching.py", "build_router.coach_confirm", 409,
            "report already exists"),
        key(f"{API}/reports.py", "build_router.create_report", 409,
            "report already exists"),
        key(f"{API}/coaching.py", "build_router.coach_confirm", 502, "str(exc)"),
        key(f"{API}/reports.py", "build_router.create_report", 502, "str(exc)"),
    }
    assert must_execute <= covered_keys()
    assert not (must_execute & set(excluded_keys()))


# --- 게이트가 제어 표면 경유인지 (spec/M4-llm.md §G) -------------------------


def test_scenarios_never_touch_the_in_process_runtime():
    """시나리오가 `backend.runtime` 을 잡으면 Java 백엔드에서 AttributeError 다.

    `backends.py:JavaBackend` 에는 `runtime` 속성이 없다. 이 검사가 없으면 게이트
    헬퍼가 다시 in-process 전용으로 돌아가도 fastapi↔fastapi 실행은 초록이라
    아무도 모른다 — M4 진입 점검이 실제로 그렇게 발견했다.

    문자열 검색이 아니라 AST 로 본다. 산문과 docstring 이 `runtime` 을 설명하는
    것까지 잡으면 검사가 못 쓰게 된다.
    """
    import ast
    import pathlib

    from contract_harness import scenarios

    root = pathlib.Path(scenarios.__file__).parent
    offenders = []
    for path in sorted(root.glob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr == "runtime":
                offenders.append(f"{path.name}:{node.lineno}")
    assert not offenders, (
        f"시나리오가 in-process runtime 을 직접 잡는다: {offenders}. "
        "게이트 조작은 contract_harness.scenarios.gate 를 거친다"
    )


def test_gate_helpers_only_speak_the_control_surface():
    """게이트 헬퍼는 `stub-state` 제어 하나만 쓴다 — 백엔드 종류를 몰라야 한다."""
    from contract_harness.scenarios import gate

    seen = []

    class FakeBackend:
        # `runtime` 을 일부러 두지 않는다. JavaBackend 와 같은 모양이다.
        def control(self, name, **payload):
            seen.append((name, payload))
            return {"coach_generate": {"in_block": True, "in_block_count": 2}}

    class FakeCtx:
        backend = FakeBackend()

    ctx = FakeCtx()
    blocked, state = gate.poll_until_blocked(ctx, "coach_generate", count=2, timeout=1)
    gate.release(ctx, "coach_generate")
    gate.rearm(ctx, "coach_generate")
    gate.release(ctx)

    assert blocked and state["in_block_count"] == 2
    assert {name for name, _ in seen} == {"stub-state"}
    assert ("stub-state", {"release": True, "stub": "coach_generate"}) in seen
    assert ("stub-state", {"rearm": True, "stub": "coach_generate"}) in seen
    # 이름 없이 부르면 게이트 있는 스텁 전부가 대상이다.
    assert ("stub-state", {"release": True}) in seen


def test_gate_polling_is_not_recorded_as_a_scenario_step():
    """폴링을 기록하면 백엔드마다 폴링 횟수가 달라 스텝 수가 갈린다."""
    import inspect

    from contract_harness.scenarios import gate

    source = inspect.getsource(gate)
    assert "ctx.backend.control" in source
    assert "ctx.control(" not in source


def test_backend_client_host_uses_the_same_header_signal_for_both_adapters():
    from contract_harness.backends import FastapiBackend, JavaBackend

    backends = (
        FastapiBackend("fastapi", database_url="unused", schema="unused"),
        JavaBackend("java", "http://127.0.0.1:8099"),
    )
    for backend in backends:
        backend.set_client_host("10.0.0.9")
        assert backend._request_headers({"Authorization": "Bearer token"}) == {
            "Authorization": "Bearer token",
            cfg.CLIENT_HOST_HEADER: "10.0.0.9",
        }

    from contract_harness.wrapper import HarnessASGI

    scope = {
        "headers": [(cfg.CLIENT_HOST_HEADER.lower().encode(), b"10.0.0.9")],
        "client": ("testclient", 50000),
    }
    rewritten = HarnessASGI._with_contract_client(scope)
    assert rewritten["client"] == ("10.0.0.9", 50000)
    assert scope["client"] == ("testclient", 50000)


def test_java_conditional_profiles_require_and_select_separate_instances():
    from types import SimpleNamespace

    from contract_harness.cli import _java_profile_base_urls
    from contract_harness.scenarios import BY_NAME

    args = SimpleNamespace(
        target="java",
        java_base_url="http://127.0.0.1:8099",
        java_admin_base_url="http://127.0.0.1:8100",
        java_nostorage_base_url="http://127.0.0.1:8101",
    )
    assert _java_profile_base_urls(
        args, [BY_NAME["health"], BY_NAME["admin"], BY_NAME["no-storage"]]
    ) == {
        "admin": "http://127.0.0.1:8100",
        "nostorage": "http://127.0.0.1:8101",
    }

    args.java_nostorage_base_url = None
    with pytest.raises(SystemExit, match="--java-nostorage-base-url"):
        _java_profile_base_urls(args, [BY_NAME["no-storage"]])


def test_seed_consent_documents_match_committed_manifest():
    """harness 시드와 `consent_docs/manifest.json` 은 같은 문서 집합이어야 한다.

    앱은 startup 에 manifest 를 읽어 아직 없는 문서를 발행한다(`seed_consent_documents`).
    시드가 옛 버전을 넣어 두면 앱이 새 버전을 **추가로** 발행하고, 그 문서는 시드 유저가
    동의한 적이 없어 필수 동의가 하나 빈다. 그러면 전 시나리오가 403 consent_required 로
    중단되고, 새 문서 id 가 기동마다 달라져 self-identity diff 까지 터진다.

    2026-08-11 privacy v4 로 올리면서 실제로 그렇게 깨졌다(diff 201건). seed.py 주석이
    이 결합을 산문으로만 적어 두고 있어서 아무도 막지 못했다.
    """
    manifest_path = cfg.ACTING_API_ROOT / "consent_docs" / "manifest.json"
    committed = [
        (item["type"], item["version"], item["file"], item["title"], item["required"])
        for item in json.loads(manifest_path.read_text(encoding="utf-8"))
    ]
    seeded = [
        (doc_type, version, filename, title, required)
        for _id, doc_type, version, filename, title, required in cfg.SEED_CONSENT_DOCUMENTS
    ]
    assert seeded == committed
