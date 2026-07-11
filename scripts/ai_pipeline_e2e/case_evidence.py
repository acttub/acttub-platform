"""Closed, pass-only case evidence writer for the protected live run.

The live adapters reduce their observations to booleans, exact counts, and
keyed HMACs.  This module accepts only that fixed vocabulary and appends cases
in the ledger order.  It deliberately has no generic metadata or message field
where identifiers, paths, provider output, or user content could be stored.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

try:
    from .sanitizer import CASE_BY_ID, CASE_IDS, EVIDENCE_SCHEMA_VERSION, sanitize_evidence
    from .secure_state import EvidenceChain
except ImportError:  # pragma: no cover - direct script import fallback
    from sanitizer import CASE_BY_ID, CASE_IDS, EVIDENCE_SCHEMA_VERSION, sanitize_evidence
    from secure_state import EvidenceChain


_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")


class CaseEvidenceRejected(ValueError):
    """Fixed-message rejection that never interpolates an untrusted value."""

    def __init__(self) -> None:
        super().__init__("case_evidence_rejected")


def _reject() -> None:
    raise CaseEvidenceRejected()


def build_passing_evidence(case_id: str, mode: str, measurements: Any) -> dict[str, Any]:
    """Build one sanitized passing record from exact safe measurements.

    Failed or ambiguous measurements are rejected rather than serialized.  A
    live run therefore cannot reach a sealed evidence chain by recording a
    failing assertion with a reassuring status string.
    """

    case = CASE_BY_ID.get(case_id)
    if case is None or mode not in case["allowedModes"] or not isinstance(measurements, Mapping):
        _reject()
    expected = case["assertions"]
    expected_ids = {item["id"] for item in expected}
    if set(measurements) != expected_ids:
        _reject()

    assertions: list[dict[str, Any]] = []
    for definition in expected:
        assertion_id = definition["id"]
        value = measurements[assertion_id]
        kind = definition["kind"]
        assertion: dict[str, Any] = {"id": assertion_id, "passed": True}
        if kind == "boolean":
            if value is not True:
                _reject()
        elif kind == "count":
            if type(value) is not int or value != definition["equals"]:
                _reject()
            assertion["count"] = value
        elif kind == "hmac":
            if not isinstance(value, str) or _HMAC.fullmatch(value) is None:
                _reject()
            assertion["hmac"] = value
        else:  # The committed case ledger is validated at sanitizer import.
            _reject()
        assertions.append(assertion)

    try:
        return sanitize_evidence(
            {
                "schemaVersion": EVIDENCE_SCHEMA_VERSION,
                "caseId": case_id,
                "mode": mode,
                "status": "pass",
                "assertions": assertions,
            }
        )
    except (TypeError, ValueError):
        _reject()


class CaseEvidenceWriter:
    """Append exact passing cases to an fsync-backed :class:`EvidenceChain`."""

    def __init__(self, evidence_fd: int) -> None:
        try:
            self._chain = EvidenceChain(evidence_fd)
            entries = self._chain.entries()
        except (OSError, TypeError, ValueError):
            _reject()
        if len(entries) > len(CASE_IDS):
            _reject()
        for index, entry in enumerate(entries):
            if entry["payload"]["caseId"] != CASE_IDS[index]:
                _reject()

    @property
    def next_case_id(self) -> str | None:
        count = len(self._chain.entries())
        return None if count == len(CASE_IDS) else CASE_IDS[count]

    def append(self, case_id: str, mode: str, measurements: Any) -> dict[str, Any]:
        if self.next_case_id != case_id:
            _reject()
        evidence = build_passing_evidence(case_id, mode, measurements)
        try:
            return self._chain.append(evidence)
        except (OSError, TypeError, ValueError):
            _reject()

    def entries(self) -> tuple[dict[str, Any], ...]:
        try:
            return self._chain.entries()
        except (OSError, TypeError, ValueError):
            _reject()

    def assert_complete(self) -> None:
        entries = self.entries()
        if len(entries) != len(CASE_IDS) or tuple(entry["payload"]["caseId"] for entry in entries) != CASE_IDS:
            _reject()
        try:
            self._chain.assert_forbidden_scan_clean()
        except (UnicodeDecodeError, TypeError, ValueError):
            _reject()
