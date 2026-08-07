"""diff 리포터 단위 테스트.

§diff 리포터 표의 **전 항목**을 각각 감지하는지, 그리고 열거되지 않은 키의 차이도
보고하는지(=부분 비교가 아님)를 증명한다.
"""

from __future__ import annotations

import copy
import json

import pytest

from contract_harness import config as cfg
from contract_harness.openapi_diff import diff_openapi


@pytest.fixture(scope="module")
def committed() -> dict:
    return json.loads(cfg.COMMITTED_OPENAPI.read_text(encoding="utf-8"))


def test_self_comparison_is_diff_zero(committed):
    assert diff_openapi(committed, copy.deepcopy(committed)) == []


def _mutate(document: dict, apply) -> dict:
    copied = copy.deepcopy(document)
    apply(copied)
    return copied


# --- 구조 -----------------------------------------------------------------


def test_detects_removed_path(committed):
    changed = _mutate(committed, lambda doc: doc["paths"].pop("/health"))
    assert any("/health" in item.path for item in diff_openapi(committed, changed))


def test_detects_added_path(committed):
    changed = _mutate(
        committed, lambda doc: doc["paths"].update({"/v2/new": {"get": {}}})
    )
    assert any("/v2/new" in item.path for item in diff_openapi(committed, changed))


def test_detects_removed_operation(committed):
    changed = _mutate(committed, lambda doc: doc["paths"]["/v2/me"].pop("patch"))
    assert diff_openapi(committed, changed)


def test_detects_changed_operation_id(committed):
    def apply(doc):
        doc["paths"]["/health"]["get"]["operationId"] = "renamed"

    changed = _mutate(committed, apply)
    diffs = diff_openapi(committed, changed)
    assert any("operationId" in item.path for item in diffs)


def test_detects_removed_component(committed):
    changed = _mutate(
        committed, lambda doc: doc["components"]["schemas"].pop("HealthResponse")
    )
    assert diff_openapi(committed, changed)


def test_detects_removed_field(committed):
    def apply(doc):
        doc["components"]["schemas"]["HealthResponse"]["properties"].pop("commit")

    assert diff_openapi(committed, _mutate(committed, apply))


def test_detects_removed_status_code(committed):
    def apply(doc):
        doc["paths"]["/v2/practice-sessions"]["post"]["responses"].pop("202")

    assert diff_openapi(committed, _mutate(committed, apply))


# --- 타입 -----------------------------------------------------------------


def test_detects_changed_type(committed):
    def apply(doc):
        doc["components"]["schemas"]["HealthResponse"]["properties"]["commit"][
            "type"
        ] = "integer"

    diffs = diff_openapi(committed, _mutate(committed, apply))
    assert any(item.path.endswith(".type") for item in diffs)


def test_detects_changed_format(committed):
    def apply(doc):
        target = doc["components"]["schemas"]["ConsentDocument"]["properties"][
            "published_at"
        ]
        target["format"] = "date"

    diffs = diff_openapi(committed, _mutate(committed, apply))
    assert any(item.path.endswith(".format") for item in diffs)


def test_detects_changed_enum_set(committed):
    schemas = json.loads(cfg.COMMITTED_OPENAPI.read_text(encoding="utf-8"))["components"][
        "schemas"
    ]
    name = next(
        key
        for key, value in schemas.items()
        if any("enum" in str(prop) for prop in value.get("properties", {}).values())
    )

    def apply(doc):
        properties = doc["components"]["schemas"][name]["properties"]
        for prop in properties.values():
            if isinstance(prop.get("enum"), list):
                prop["enum"] = prop["enum"] + ["HARNESS_EXTRA"]
                return
            for branch in prop.get("anyOf", []):
                if isinstance(branch.get("enum"), list):
                    branch["enum"] = branch["enum"] + ["HARNESS_EXTRA"]
                    return

    diffs = diff_openapi(committed, _mutate(committed, apply))
    assert any("집합이 다르다" in item.kind for item in diffs)


def test_detects_changed_const(committed):
    def apply(doc):
        doc["components"]["schemas"]["HealthResponse"]["properties"]["status"][
            "const"
        ] = "not-ok"

    diffs = diff_openapi(committed, _mutate(committed, apply))
    assert any(item.path.endswith(".const") for item in diffs)


def test_detects_nullable_change(committed):
    def apply(doc):
        properties = doc["components"]["schemas"]["AuthUser"]["properties"]
        properties["email"] = {"type": "string", "title": "Email"}

    assert diff_openapi(committed, _mutate(committed, apply))


# --- 제약 -----------------------------------------------------------------


def test_detects_required_set_change(committed):
    def apply(doc):
        doc["components"]["schemas"]["HealthResponse"]["required"] = [
            name
            for name in doc["components"]["schemas"]["HealthResponse"]["required"]
            if name != "commit"
        ]

    diffs = diff_openapi(committed, _mutate(committed, apply))
    assert any("집합이 다르다" in item.kind for item in diffs)


def test_required_order_only_is_not_a_diff(committed):
    def apply(doc):
        schema = doc["components"]["schemas"]["HealthResponse"]
        schema["required"] = list(reversed(schema["required"]))

    assert diff_openapi(committed, _mutate(committed, apply)) == []


def test_enum_order_only_is_not_a_diff(committed):
    def apply(doc):
        for schema in doc["components"]["schemas"].values():
            for prop in schema.get("properties", {}).values():
                if isinstance(prop.get("enum"), list) and len(prop["enum"]) > 1:
                    prop["enum"] = list(reversed(prop["enum"]))

    assert diff_openapi(committed, _mutate(committed, apply)) == []


def test_detects_default_change(committed):
    def apply(doc):
        doc["components"]["schemas"]["PostWriteRequest"]["properties"]["anonymous"][
            "default"
        ] = True

    diffs = diff_openapi(committed, _mutate(committed, apply))
    assert any(item.path.endswith(".default") for item in diffs)


def test_detects_max_length_change(committed):
    def apply(doc):
        doc["components"]["schemas"]["PostWriteRequest"]["properties"]["title"][
            "maxLength"
        ] = 1000

    diffs = diff_openapi(committed, _mutate(committed, apply))
    assert any(item.path.endswith(".maxLength") for item in diffs)


def test_detects_numeric_bound_change(committed):
    def apply(doc):
        doc["components"]["schemas"]["UploadIntentRequest"]["properties"][
            "size_bytes"
        ]["exclusiveMinimum"] = 10

    diffs = diff_openapi(committed, _mutate(committed, apply))
    assert diffs


def test_detects_additional_properties_change(committed):
    def apply(doc):
        doc["components"]["schemas"]["PostWriteRequest"]["additionalProperties"] = True

    diffs = diff_openapi(committed, _mutate(committed, apply))
    assert any(item.path.endswith(".additionalProperties") for item in diffs)


# --- 그 외 ----------------------------------------------------------------


def test_detects_parameter_change(committed):
    def apply(doc):
        doc["paths"]["/v2/community/posts"]["get"]["parameters"][0]["required"] = True

    assert diff_openapi(committed, _mutate(committed, apply))


def test_detects_request_body_required_change(committed):
    def apply(doc):
        doc["paths"]["/v2/auth/login"]["post"]["requestBody"]["required"] = False

    diffs = diff_openapi(committed, _mutate(committed, apply))
    assert any("requestBody" in item.path for item in diffs)


def test_detects_security_change(committed):
    def apply(doc):
        doc["paths"]["/v2/me"]["get"]["security"] = []

    assert diff_openapi(committed, _mutate(committed, apply))


def test_detects_tags_change(committed):
    def apply(doc):
        doc["paths"]["/v2/me"]["get"]["tags"] = ["renamed"]

    assert diff_openapi(committed, _mutate(committed, apply))


# --- 부분 비교가 아님을 증명한다 --------------------------------------------


def test_detects_change_in_unlisted_key(committed):
    """§diff 리포터 표에 열거되지 않은 키(info.title, summary, description)."""

    for apply in (
        lambda doc: doc["info"].__setitem__("title", "renamed"),
        lambda doc: doc["paths"]["/health"]["get"].__setitem__("summary", "바뀐 요약"),
        lambda doc: doc["components"]["schemas"]["HealthResponse"].__setitem__(
            "description", "설명이 생겼다"
        ),
        lambda doc: doc.__setitem__("openapi", "3.0.0"),
    ):
        assert diff_openapi(committed, _mutate(committed, apply)), apply
