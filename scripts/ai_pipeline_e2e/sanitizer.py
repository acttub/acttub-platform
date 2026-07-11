"""Allowlist-only evidence serialization and forbidden-data scanning."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Mapping

EVIDENCE_SCHEMA_VERSION = "protected-e2e-evidence.v1"
FORBIDDEN_CANARY = "ACTTUB_PROTECTED_E2E_FORBIDDEN_CANARY_V1"
_TOP_LEVEL_KEYS = frozenset({"schemaVersion", "caseId", "mode", "status", "assertions"})
_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")
_SHA256 = re.compile(r"^(?:sha256:)?[a-f0-9]{64}$")
_FORBIDDEN_PATTERNS = (
    ("canary", re.compile(re.escape(FORBIDDEN_CANARY))),
    ("url", re.compile(r"\bhttps?://[^\s\"']+", re.IGNORECASE)),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")),
    ("uuid", re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)),
    (
        "absolute_path",
        re.compile(
            r"(?:(?<![A-Za-z0-9._-])/(?!/)(?:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*)?|[A-Za-z]:[\\/](?:[^\s\"']+[\\/])*[^\s\"']+)",
            re.IGNORECASE,
        ),
    ),
    (
        "secret_assignment",
        re.compile(
            r"\b(?:[A-Z0-9_]*(?:API|AUTH|SERVICE|SECRET|PRIVATE|ACCESS|REFRESH|ANON|PASSWORD)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)?|GEMINI_API_KEY)\s*=",
            re.IGNORECASE,
        ),
    ),
    ("authorization", re.compile(r"\b(?:authorization\s*[:=]\s*bearer|service[_-]?role\s*[:=])", re.IGNORECASE)),
    ("signed_url", re.compile(r"(?:X-Amz-(?:Signature|Credential)|[?&](?:token|signature)=)", re.IGNORECASE)),
    ("media_filename", re.compile(r"(?:^|[\\/\s\"'])[^\\/\s\"']+\.(?:mp4|mov|m4v|quicktime)(?:$|[\s\"'])", re.IGNORECASE)),
    ("raw_payload_field", re.compile(r'"(?:body|content|rawResponse|responseBody|signedUrl|storagePath|mediaPath|summary|transcript|report|secret|token)"\s*:')),
    (
        "stack_trace",
        re.compile(
            r"(?:Traceback \(most recent call last\):|(?:\n|^)\s*File \"[^\"]+\", line \d+|(?:\n|^)\s*at\s+[^\n]+:\d+:\d+)",
            re.IGNORECASE,
        ),
    ),
)


def _load_case_ledger() -> tuple[dict[str, Any], ...]:
    raw = json.loads(Path(__file__).with_name("cases.json").read_text(encoding="utf-8"))
    if set(raw) != {"schemaVersion", "cases"} or raw["schemaVersion"] != "protected-e2e-cases.v1":
        raise RuntimeError("case_ledger_schema_invalid")
    if not isinstance(raw["cases"], list) or not raw["cases"]:
        raise RuntimeError("case_ledger_empty")
    seen: set[str] = set()
    cases: list[dict[str, Any]] = []
    for case in raw["cases"]:
        if set(case) != {"id", "allowedModes", "assertions"}:
            raise RuntimeError("case_ledger_case_invalid")
        if not isinstance(case["id"], str) or case["id"] in seen:
            raise RuntimeError("case_ledger_id_invalid")
        if (
            not isinstance(case["allowedModes"], list)
            or not case["allowedModes"]
            or len(case["allowedModes"]) != len(set(case["allowedModes"]))
            or not set(case["allowedModes"]).issubset({"scripted", "real"})
        ):
            raise RuntimeError("case_ledger_mode_invalid")
        if not isinstance(case["assertions"], list) or not case["assertions"]:
            raise RuntimeError("case_ledger_assertions_invalid")
        assertion_ids: set[str] = set()
        for assertion in case["assertions"]:
            expected = {"id", "kind", "equals"} if assertion.get("kind") == "count" else {"id", "kind"}
            if set(assertion) != expected or assertion.get("kind") not in {"boolean", "count", "hmac"}:
                raise RuntimeError("case_ledger_assertion_invalid")
            if (
                not isinstance(assertion["id"], str)
                or not assertion["id"]
                or assertion["id"] in assertion_ids
            ):
                raise RuntimeError("case_ledger_assertion_id_invalid")
            if assertion["kind"] == "count" and (type(assertion["equals"]) is not int or assertion["equals"] < 0):
                raise RuntimeError("case_ledger_count_invalid")
            assertion_ids.add(assertion["id"])
        seen.add(case["id"])
        cases.append(case)
    return tuple(cases)


CASE_LEDGER = _load_case_ledger()
CASE_IDS = tuple(case["id"] for case in CASE_LEDGER)
CASE_BY_ID = {case["id"]: case for case in CASE_LEDGER}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":"))


def require_sha256(value: Any, label: str = "sha256") -> str:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise ValueError(f"{label}_invalid")
    return value.removeprefix("sha256:")


def scan_forbidden_text(text: str) -> tuple[str, ...]:
    if not isinstance(text, str):
        raise TypeError("scan_input_must_be_string")
    return tuple(code for code, pattern in _FORBIDDEN_PATTERNS if pattern.search(text))


def assert_forbidden_scan_clean(text: str) -> None:
    findings = scan_forbidden_text(text)
    if findings:
        raise ValueError("forbidden_evidence:" + ",".join(findings))


def _require_exact_mapping(value: Any, keys: set[str] | frozenset[str], label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != set(keys):
        raise TypeError(f"{label}_keys_invalid")
    return value


def sanitize_evidence(value: Any) -> dict[str, Any]:
    evidence = _require_exact_mapping(value, _TOP_LEVEL_KEYS, "evidence")
    if evidence["schemaVersion"] != EVIDENCE_SCHEMA_VERSION:
        raise ValueError("evidence_schema_invalid")
    case = CASE_BY_ID.get(evidence["caseId"])
    if case is None:
        raise ValueError("evidence_case_invalid")
    if evidence["mode"] not in case["allowedModes"]:
        raise ValueError("evidence_mode_invalid")
    if evidence["status"] not in {"pass", "fail"}:
        raise ValueError("evidence_status_invalid")
    if not isinstance(evidence["assertions"], list) or len(evidence["assertions"]) != len(case["assertions"]):
        raise ValueError("evidence_assertions_invalid")

    sanitized_assertions: list[dict[str, Any]] = []
    for actual, expected in zip(evidence["assertions"], case["assertions"], strict=True):
        metric = expected["kind"]
        keys = {"id", "passed"} if metric == "boolean" else {"id", "passed", metric}
        assertion = _require_exact_mapping(actual, keys, "assertion")
        if assertion["id"] != expected["id"] or type(assertion["passed"]) is not bool:
            raise ValueError("assertion_identity_invalid")
        clean = {"id": assertion["id"], "passed": assertion["passed"]}
        if metric == "count":
            if type(assertion["count"]) is not int or assertion["count"] != expected["equals"]:
                raise ValueError("assertion_count_invalid")
            clean["count"] = assertion["count"]
        elif metric == "hmac":
            if not isinstance(assertion["hmac"], str) or _HMAC.fullmatch(assertion["hmac"]) is None:
                raise ValueError("assertion_hmac_invalid")
            clean["hmac"] = assertion["hmac"]
        sanitized_assertions.append(clean)

    passed_values = [assertion["passed"] for assertion in sanitized_assertions]
    if evidence["status"] == "pass" and not all(passed_values):
        raise ValueError("passing_evidence_contains_failure")
    if evidence["status"] == "fail" and all(passed_values):
        raise ValueError("failing_evidence_contains_no_failure")
    sanitized = {
        "schemaVersion": EVIDENCE_SCHEMA_VERSION,
        "caseId": case["id"],
        "mode": evidence["mode"],
        "status": evidence["status"],
        "assertions": sanitized_assertions,
    }
    assert_forbidden_scan_clean(canonical_json(sanitized))
    return sanitized


def sanitizer_canary_self_test() -> dict[str, bool]:
    valid = {
        "schemaVersion": EVIDENCE_SCHEMA_VERSION,
        "caseId": "SAFE-01",
        "mode": "scripted",
        "status": "pass",
        "assertions": [
            {"id": "production_actions", "passed": True, "count": 0},
            {"id": "forbidden_artifacts", "passed": True, "count": 0},
            {"id": "sanitizer_canary_blocked", "passed": True},
        ],
    }
    unknown_field_blocked = False
    try:
        sanitize_evidence({**valid, "content": FORBIDDEN_CANARY})
    except (TypeError, ValueError):
        unknown_field_blocked = True
    result = {
        "unknownFieldBlocked": unknown_field_blocked,
        "canaryDetected": "canary" in scan_forbidden_text(FORBIDDEN_CANARY),
        "validAccepted": sanitize_evidence(valid)["status"] == "pass",
    }
    if not all(result.values()):
        raise RuntimeError("sanitizer_self_test_failed")
    return result
