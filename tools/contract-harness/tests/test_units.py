"""normalize · canonical · jsonschema_lite · inventory 단위 테스트."""

from __future__ import annotations

import json

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
