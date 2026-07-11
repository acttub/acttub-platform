"""Crash-safe parent coordinator for the protected development E2E.

External adapters perform the actual repository, MCP, process, provider, and
browser work. They return only closed controller events or sanitized
measurements. This module owns ordering, durable state, attestation chains,
and the pause/resume action cursor. Raw MCP values are brokered from file
descriptors and are never persisted or written to stdout.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import replace
from typing import Any, Callable, Mapping

try:
    from . import controller, mcp_bridge, mcp_queries, secure_state
    from .case_evidence import CaseEvidenceRejected, CaseEvidenceWriter, build_passing_evidence
    from .sanitizer import CASE_IDS, canonical_json
    from .secure_state import PrivateState, read_private_record
except ImportError:  # pragma: no cover - direct script import fallback
    import controller
    import mcp_bridge
    import mcp_queries
    import secure_state
    from case_evidence import CaseEvidenceRejected, CaseEvidenceWriter, build_passing_evidence
    from sanitizer import CASE_IDS, canonical_json
    from secure_state import PrivateState, read_private_record


SCHEMA_VERSION = "protected-live-coordinator.v2"
_STATE_DOMAIN = b"acttub-protected-live-coordinator-state.v2\0"
_PENDING_CASE_SCHEMA = "protected-live-coordinator-pending-case.v2"
_PENDING_CHAIN_SCHEMA = "protected-live-coordinator-pending-chain.v1"
_PENDING_UI_CASE_SCHEMA = "protected-live-coordinator-pending-ui-case.v1"
_GENESIS_HASH = "0" * 64
_HASH = frozenset("0123456789abcdef")


class LiveCoordinatorRejected(ValueError):
    """Fixed-message rejection with no event or external value interpolation."""

    def __init__(self) -> None:
        super().__init__("live_coordinator_rejected")


def _reject() -> None:
    raise LiveCoordinatorRejected()


def _read_key(fd: int) -> bytes:
    if type(fd) is not int or fd <= 2:
        _reject()
    try:
        size = os.fstat(fd).st_size
        if not 32 <= size <= 4096:
            _reject()
        key = os.pread(fd, size, 0)
    except (OSError, OverflowError, ValueError):
        _reject()
    if len(key) != size:
        _reject()
    return key


def _require_hash(value: Any) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in _HASH for character in value)
    ):
        _reject()
    return value


def _state_mac(key: bytes, controller_record: Mapping[str, Any], pending_operation: Any) -> str:
    semantic = {
        "schemaVersion": SCHEMA_VERSION,
        "controller": dict(controller_record),
        "pendingOperation": pending_operation,
    }
    return "hmac-sha256:" + hmac.new(
        key, _STATE_DOMAIN + canonical_json(semantic).encode("ascii"), hashlib.sha256
    ).hexdigest()


def _envelope(
    key: bytes,
    state: controller.ControllerState,
    pending_operation: Any = None,
) -> dict[str, Any]:
    record = controller.controller_state_record(state)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "controller": record,
        "pendingOperation": pending_operation,
        "stateMac": _state_mac(key, record, pending_operation),
    }


def _restore_envelope(value: Any, key: bytes) -> tuple[controller.ControllerState, Any]:
    if not isinstance(value, Mapping) or set(value) != {
        "schemaVersion", "controller", "pendingOperation", "stateMac"
    }:
        _reject()
    if value["schemaVersion"] != SCHEMA_VERSION or not isinstance(value["stateMac"], str):
        _reject()
    try:
        state = controller.restore_controller_state(value["controller"])
        expected = _state_mac(key, value["controller"], value["pendingOperation"])
    except (TypeError, ValueError):
        _reject()
    if not hmac.compare_digest(value["stateMac"], expected):
        _reject()
    return state, value["pendingOperation"]


def required_action(state: controller.ControllerState) -> dict[str, Any]:
    """Return the next closed action without identifiers, paths, or payloads."""

    if not isinstance(state, controller.ControllerState):
        _reject()
    direct = {
        "created": "verify_offline_foundation",
        "offline_verified": "initialize_private_state",
        "private_state_ready": "approve_development_target",
        "dev_target_approved": "inventory_development_target",
        "dev_target_verified": "inspect_migration_preflight",
        "migration_009_prepare_required": "prepare_migration_009",
        "migration_009_prepared": "dispatch_migration_009",
        "migration_009_in_flight": "attest_migration_009",
        "migration_009_unknown": "reconcile_migration_009",
        "migration_009_retry_required": "prepare_migration_009_retry",
        "migration_009_retry_prepared": "dispatch_migration_009_retry",
        "migration_009_attested": "prepare_migration_010",
        "migration_010_prepared": "dispatch_migration_010",
        "migration_010_in_flight": "attest_migration_010",
        "migration_010_unknown": "reconcile_migration_010",
        "migration_010_retry_required": "prepare_migration_010_retry",
        "migration_010_retry_prepared": "dispatch_migration_010_retry",
        "migration_010_attested": "inspect_migration_postflight",
        "migration_postflight_verified": "prepare_services",
        "services_ready": "begin_scripted_cases",
        "scripted_cleanup_pending": "cleanup_scripted_phase",
        "real_start_required": "begin_real_cases",
        "real_provider_cleanup_pending": "cleanup_real_provider_phase",
        "ui_probe_start_required": "begin_ui_probe",
        "cleanup_pending": "verify_cleanup_and_retention",
        "cleanup_verified": "seal_evidence",
        "evidence_sealed": "complete",
        "completed": "done",
    }
    action = direct.get(state.phase)
    if action is not None:
        return {"kind": "action", "action": action}
    phase_modes = {
        "scripted_cases_running": "scripted",
        "real_cases_running": "real",
        "isolated_data_cases_running": "scripted",
        "ui_case_running": "real",
    }
    mode = phase_modes.get(state.phase)
    if mode is None or not 0 <= state.next_case_index < len(CASE_IDS):
        _reject()
    return {"kind": "case", "caseId": CASE_IDS[state.next_case_index], "mode": mode}


def _sanitize_safe_results(kind: str, value: Any) -> tuple[dict[str, Any], ...]:
    if not isinstance(value, tuple) or not value:
        _reject()
    try:
        if kind == "mcp":
            return tuple(mcp_bridge._validate_public_result(item) for item in value)
        if kind == "browser" and len(value) == 1:
            return (controller.sanitize_browser_adapter_result(value[0]),)
    except (mcp_bridge.BridgeRejected, TypeError, ValueError):
        _reject()
    _reject()


def _sanitize_chain_payload(kind: str, value: Any) -> dict[str, Any]:
    try:
        if kind == "mcp":
            return secure_state._sanitize_mcp_attestation(value)
        if kind == "browser":
            return secure_state._sanitize_browser_attestation(value)
    except (TypeError, ValueError):
        _reject()
    _reject()


def _validate_safe_payload_bindings(
    kind: str,
    safe_results: tuple[dict[str, Any], ...],
    entries: tuple[Mapping[str, Any], ...],
) -> None:
    if len(safe_results) != len(entries):
        _reject()
    for safe, entry in zip(safe_results, entries, strict=True):
        payload = entry["payload"]
        result_hmac = safe.get("resultHmac")
        if not isinstance(result_hmac, str):
            _reject()
        if kind == "mcp":
            expected_success = "safeCode" not in safe
            if (
                payload["responseHmac"] != result_hmac
                or ("targetProjectHmac" in safe and payload["targetHmac"] != safe["targetProjectHmac"])
                or payload["success"] is not expected_success
                or payload["safeCode"] != safe.get("safeCode")
            ):
                _reject()
        elif (
            payload["resultHmac"] != result_hmac
            or payload["capturedArtifacts"] != safe["capturedArtifacts"]
            or payload["booleanCount"] != 3
            or payload["boundedCount"] != 2
        ):
            _reject()


def _predicted_entries(
    kind: str,
    before_count: int,
    before_tail: str,
    entries: Any,
) -> tuple[dict[str, Any], ...]:
    if not isinstance(entries, list) or not entries:
        _reject()
    sequence = before_count
    previous = before_tail
    predicted: list[dict[str, Any]] = []
    for candidate in entries:
        if not isinstance(candidate, Mapping) or set(candidate) != {
            "sequence", "previousHash", "payload", "hash"
        }:
            _reject()
        payload = _sanitize_chain_payload(kind, candidate["payload"])
        core = {"sequence": sequence, "previousHash": previous, "payload": payload}
        expected_hash = hashlib.sha256(canonical_json(core).encode("ascii")).hexdigest()
        clean = {**core, "hash": expected_hash}
        if dict(candidate) != clean:
            _reject()
        predicted.append(clean)
        sequence += 1
        previous = expected_hash
    return tuple(predicted)


def _evidence_fields(state: controller.ControllerState) -> tuple[Any, ...]:
    return (state.next_case_index, state.completed_cases, state.evidence_hashes)


class LiveCoordinator:
    """Own the durable controller cursor and all local chain boundaries."""

    def __init__(self, private_state: PrivateState) -> None:
        if not isinstance(private_state, PrivateState):
            _reject()
        self._private = private_state
        self._key = _read_key(private_state.file_fd("run-mac-key"))
        self._writer = CaseEvidenceWriter(private_state.file_fd("evidence"))
        try:
            self._mcp_chain = secure_state.McpAttestationChain(
                private_state.file_fd("mcp-attestations")
            )
            self._browser_chain = secure_state.BrowserAttestationChain(
                private_state.file_fd("browser-attestations")
            )
            state_fd = private_state.file_fd("state")
            if os.fstat(state_fd).st_size == 0:
                self._state = controller.new_controller()
                self._persist(self._state)
                pending = None
            else:
                self._state, pending = _restore_envelope(read_private_record(state_fd), self._key)
            if pending is not None:
                self._recover_pending_operation(pending)
            self._assert_alignment()
        except LiveCoordinatorRejected:
            raise
        except (CaseEvidenceRejected, OSError, TypeError, ValueError):
            _reject()

    @property
    def state(self) -> controller.ControllerState:
        return self._state

    def action(self) -> dict[str, Any]:
        return required_action(self._state)

    def _persist(self, state: controller.ControllerState, pending_operation: Any = None) -> None:
        try:
            self._private.write_record_atomic(
                "state", _envelope(self._key, state, pending_operation)
            )
        except (OSError, TypeError, ValueError):
            _reject()

    def _assert_alignment(self) -> None:
        evidence = self._writer.entries()
        mcp_entries = self._mcp_chain.entries()
        browser_entries = self._browser_chain.entries()
        if (
            len(evidence) != self._state.next_case_index
            or tuple(entry["payload"]["caseId"] for entry in evidence) != self._state.completed_cases
            or tuple(entry["hash"] for entry in evidence) != self._state.evidence_hashes
            or len(mcp_entries) != self._state.mcp_sequence + 1
            or (mcp_entries[-1]["hash"] if mcp_entries else _GENESIS_HASH)
            != self._state.mcp_tail_hash
            or (not browser_entries and self._state.browser_attestation_hash is not None)
            or (
                browser_entries
                and (
                    len(browser_entries) != 1
                    or self._state.browser_attestation_hash != browser_entries[-1]["hash"]
                )
            )
        ):
            _reject()

    def apply_event(self, event: Any) -> controller.ControllerState:
        """Apply a local event; chain-bearing transitions must use the WAL."""

        if not isinstance(event, Mapping) or event.get("type") == "CASE_RECORDED":
            _reject()
        try:
            next_state = replace(
                controller.transition(self._state, event),
                transition_sequence=self._state.transition_sequence + 1,
            )
            next_state = controller.restore_controller_state(
                controller.controller_state_record(next_state)
            )
        except (OSError, TypeError, ValueError):
            _reject()
        if (
            next_state.mcp_sequence != self._state.mcp_sequence
            or next_state.mcp_tail_hash != self._state.mcp_tail_hash
            or next_state.browser_attestation_hash != self._state.browser_attestation_hash
        ):
            _reject()
        self._persist(next_state)
        self._state = next_state
        self._assert_alignment()
        return next_state

    def _chain(self, kind: str) -> secure_state._HashChain:
        if kind == "mcp":
            return self._mcp_chain
        if kind == "browser":
            return self._browser_chain
        _reject()

    def _validate_next_chain_state(
        self,
        kind: str,
        before_count: int,
        before_tail: str,
        entries: tuple[Mapping[str, Any], ...],
        next_state: controller.ControllerState,
    ) -> None:
        if (
            next_state.transition_sequence != self._state.transition_sequence + 1
            or _evidence_fields(next_state) != _evidence_fields(self._state)
        ):
            _reject()
        final_hash = entries[-1]["hash"]
        if kind == "mcp":
            if (
                self._state.mcp_sequence != before_count - 1
                or self._state.mcp_tail_hash != before_tail
                or next_state.mcp_sequence != before_count + len(entries) - 1
                or next_state.mcp_tail_hash != final_hash
                or next_state.browser_attestation_hash != self._state.browser_attestation_hash
            ):
                _reject()
        elif (
            next_state.mcp_sequence != self._state.mcp_sequence
            or next_state.mcp_tail_hash != self._state.mcp_tail_hash
            or next_state.browser_attestation_hash != final_hash
        ):
            _reject()

    def commit_chain_transition(
        self,
        kind: str,
        safe_results: tuple[Any, ...],
        payloads: tuple[Any, ...],
        event: Any,
    ) -> controller.ControllerState:
        """Atomically bind one controller transition to an MCP/browser chain.

        Multiple MCP entries are previewed and committed as one transaction;
        callers must therefore bundle apply+postcondition+ledger together, while
        an UNKNOWN apply outcome is committed alone before reconciliation.
        """

        if kind not in {"mcp", "browser"} or not isinstance(payloads, tuple) or not payloads:
            _reject()
        cursor = self.action()
        if cursor.get("kind") != "action" or not isinstance(cursor.get("action"), str):
            _reject()
        chain = self._chain(kind)
        try:
            clean_results = _sanitize_safe_results(kind, safe_results)
            existing = chain.entries()
            before_count = len(existing)
            before_tail = existing[-1]["hash"] if existing else _GENESIS_HASH
            entries = chain.preview(payloads)
            _validate_safe_payload_bindings(kind, clean_results, entries)
            next_state = replace(
                controller.transition(self._state, event),
                transition_sequence=self._state.transition_sequence + 1,
            )
            next_state = controller.restore_controller_state(
                controller.controller_state_record(next_state)
            )
            self._validate_next_chain_state(
                kind, before_count, before_tail, entries, next_state
            )
            pending = {
                "schemaVersion": _PENDING_CHAIN_SCHEMA,
                "kind": kind,
                "action": cursor["action"],
                "beforeControllerDigest": controller.controller_state_digest(self._state),
                "beforeMcpCount": before_count,
                "beforeMcpTail": before_tail,
                "safeResults": list(clean_results),
                "entries": list(entries),
                "nextController": controller.controller_state_record(next_state),
            }
        except LiveCoordinatorRejected:
            raise
        except (mcp_bridge.BridgeRejected, OSError, TypeError, ValueError):
            _reject()

        self._persist(self._state, pending)
        try:
            for expected in entries:
                if chain.append(expected["payload"]) != expected:
                    _reject()
        except LiveCoordinatorRejected:
            raise
        except (OSError, TypeError, ValueError):
            _reject()
        self._persist(next_state)
        self._state = next_state
        self._assert_alignment()
        return next_state

    def record_case(
        self,
        case_id: str,
        mode: str,
        measurements: Any,
        *,
        real_attestation: Any = None,
        mac_key_fd: int | None = None,
        browser_result: Any = None,
        browser_payload: Any = None,
    ) -> controller.ControllerState:
        """Atomically advance one case across the evidence and state files."""

        if self.action() != {"kind": "case", "caseId": case_id, "mode": mode}:
            _reject()
        try:
            evidence = build_passing_evidence(case_id, mode, measurements)
            entries = self._writer.entries()
            previous_hash = entries[-1]["hash"] if entries else _GENESIS_HASH
            core = {"sequence": len(entries), "previousHash": previous_hash, "payload": evidence}
            entry = {
                **core,
                "hash": hashlib.sha256(canonical_json(core).encode("ascii")).hexdigest(),
            }
            event: dict[str, Any] = {
                "type": "CASE_RECORDED",
                "evidence": evidence,
                "evidenceHash": entry["hash"],
            }
            if case_id == "REAL-01":
                if mac_key_fd is None:
                    _reject()
                event.update({"realAttestation": real_attestation, "macKeyFd": mac_key_fd})
            elif real_attestation is not None or mac_key_fd is not None:
                _reject()
            browser_safe: dict[str, Any] | None = None
            browser_entry: dict[str, Any] | None = None
            if case_id == "UI-01":
                browser_safe = _sanitize_safe_results("browser", (browser_result,))[0]
                browser_entries = self._browser_chain.entries()
                if browser_entries:
                    _reject()
                browser_entry = self._browser_chain.preview((browser_payload,))[0]
                _validate_safe_payload_bindings("browser", (browser_safe,), (browser_entry,))
                assertion_hmac = next(
                    (
                        assertion.get("hmac")
                        for assertion in evidence["assertions"]
                        if assertion["id"] == "ui_result_hmac"
                    ),
                    None,
                )
                if assertion_hmac != browser_entry["payload"]["resultHmac"]:
                    _reject()
                event["browserEntry"] = browser_entry
            elif browser_result is not None or browser_payload is not None:
                _reject()
            next_state = replace(
                controller.transition(self._state, event),
                transition_sequence=self._state.transition_sequence + 1,
            )
            next_state = controller.restore_controller_state(
                controller.controller_state_record(next_state)
            )
            if case_id == "UI-01":
                if browser_safe is None or browser_entry is None:
                    _reject()
                pending = {
                    "schemaVersion": _PENDING_UI_CASE_SCHEMA,
                    "kind": "ui-case",
                    "action": case_id,
                    "beforeControllerDigest": controller.controller_state_digest(self._state),
                    "beforeEvidenceCount": len(entries),
                    "beforeEvidenceTail": previous_hash,
                    "beforeBrowserCount": 0,
                    "beforeBrowserTail": _GENESIS_HASH,
                    "browserSafeResult": browser_safe,
                    "evidenceEntry": entry,
                    "browserEntry": browser_entry,
                    "nextController": controller.controller_state_record(next_state),
                }
            else:
                pending = {
                    "schemaVersion": _PENDING_CASE_SCHEMA,
                    "kind": "case",
                    "action": case_id,
                    "beforeControllerDigest": controller.controller_state_digest(self._state),
                    "evidence": evidence,
                    "entry": entry,
                    "nextController": controller.controller_state_record(next_state),
                }
        except LiveCoordinatorRejected:
            raise
        except (CaseEvidenceRejected, OSError, TypeError, ValueError):
            _reject()

        self._persist(self._state, pending)
        try:
            if case_id == "UI-01":
                if browser_entry is None or self._browser_chain.append(browser_entry["payload"]) != browser_entry:
                    _reject()
            appended = self._writer.append(case_id, mode, measurements)
        except (CaseEvidenceRejected, OSError, TypeError, ValueError):
            _reject()
        if appended != entry:
            _reject()
        self._persist(next_state)
        self._state = next_state
        self._assert_alignment()
        return next_state

    def _recover_pending_operation(self, pending: Any) -> None:
        if not isinstance(pending, Mapping) or pending.get("kind") not in {
            "case", "ui-case", "mcp", "browser"
        }:
            _reject()
        if pending["kind"] == "case":
            self._recover_pending_case(pending)
        elif pending["kind"] == "ui-case":
            self._recover_pending_ui_case(pending)
        else:
            self._recover_pending_chain(pending)

    def _recover_pending_chain(self, pending: Mapping[str, Any]) -> None:
        expected_keys = {
            "schemaVersion", "kind", "action", "beforeControllerDigest",
            "beforeMcpCount", "beforeMcpTail", "safeResults", "entries", "nextController",
        }
        if set(pending) != expected_keys or pending["schemaVersion"] != _PENDING_CHAIN_SCHEMA:
            _reject()
        kind = pending["kind"]
        if kind not in {"mcp", "browser"}:
            _reject()
        cursor = self.action()
        if (
            cursor.get("kind") != "action"
            or pending["action"] != cursor.get("action")
            or pending["beforeControllerDigest"] != controller.controller_state_digest(self._state)
            or type(pending["beforeMcpCount"]) is not int
            or pending["beforeMcpCount"] < 0
        ):
            _reject()
        before_count = pending["beforeMcpCount"]
        before_tail = _require_hash(pending["beforeMcpTail"])
        try:
            safe_results = _sanitize_safe_results(kind, tuple(pending["safeResults"]))
            predicted = _predicted_entries(kind, before_count, before_tail, pending["entries"])
            _validate_safe_payload_bindings(kind, safe_results, predicted)
            next_state = controller.restore_controller_state(pending["nextController"])
            self._validate_next_chain_state(
                kind, before_count, before_tail, predicted, next_state
            )
            chain = self._chain(kind)
            current = chain.entries()
            if (
                len(current) < before_count
                or len(current) > before_count + len(predicted)
                or (current[before_count - 1]["hash"] if before_count else _GENESIS_HASH)
                != before_tail
            ):
                _reject()
            prefix_count = len(current) - before_count
            if tuple(current[before_count:]) != predicted[:prefix_count]:
                _reject()
            for expected in predicted[prefix_count:]:
                if chain.append(expected["payload"]) != expected:
                    _reject()
        except LiveCoordinatorRejected:
            raise
        except (IndexError, KeyError, OSError, TypeError, ValueError):
            _reject()
        self._persist(next_state)
        self._state = next_state

    def _recover_pending_ui_case(self, pending: Mapping[str, Any]) -> None:
        expected_keys = {
            "schemaVersion", "kind", "action", "beforeControllerDigest",
            "beforeEvidenceCount", "beforeEvidenceTail", "beforeBrowserCount",
            "beforeBrowserTail", "browserSafeResult", "evidenceEntry",
            "browserEntry", "nextController",
        }
        if (
            set(pending) != expected_keys
            or pending["schemaVersion"] != _PENDING_UI_CASE_SCHEMA
            or pending["kind"] != "ui-case"
            or pending["action"] != "UI-01"
            or pending["beforeControllerDigest"]
            != controller.controller_state_digest(self._state)
            or type(pending["beforeEvidenceCount"]) is not int
            or type(pending["beforeBrowserCount"]) is not int
            or pending["beforeEvidenceCount"] != self._state.next_case_index
            or pending["beforeBrowserCount"] != 0
            or self.action() != {"kind": "case", "caseId": "UI-01", "mode": "real"}
        ):
            _reject()
        before_evidence_count = pending["beforeEvidenceCount"]
        before_evidence_tail = _require_hash(pending["beforeEvidenceTail"])
        before_browser_tail = _require_hash(pending["beforeBrowserTail"])
        if before_browser_tail != _GENESIS_HASH:
            _reject()
        try:
            safe = _sanitize_safe_results("browser", (pending["browserSafeResult"],))
            browser_predicted = _predicted_entries(
                "browser", 0, before_browser_tail, [pending["browserEntry"]]
            )
            _validate_safe_payload_bindings("browser", safe, browser_predicted)
            evidence_entry = pending["evidenceEntry"]
            if not isinstance(evidence_entry, Mapping) or set(evidence_entry) != {
                "sequence", "previousHash", "payload", "hash"
            }:
                _reject()
            evidence = build_passing_evidence(
                evidence_entry["payload"]["caseId"],
                evidence_entry["payload"]["mode"],
                {
                    item["id"]: item.get("count", item.get("hmac", item["passed"]))
                    for item in evidence_entry["payload"]["assertions"]
                },
            )
            evidence_core = {
                "sequence": before_evidence_count,
                "previousHash": before_evidence_tail,
                "payload": evidence,
            }
            evidence_predicted = {
                **evidence_core,
                "hash": hashlib.sha256(
                    canonical_json(evidence_core).encode("ascii")
                ).hexdigest(),
            }
            if (
                evidence["caseId"] != "UI-01"
                or dict(evidence_entry) != evidence_predicted
                or next(
                    assertion.get("hmac")
                    for assertion in evidence["assertions"]
                    if assertion["id"] == "ui_result_hmac"
                )
                != browser_predicted[0]["payload"]["resultHmac"]
            ):
                _reject()
            next_state = controller.restore_controller_state(pending["nextController"])
            if (
                next_state.transition_sequence != self._state.transition_sequence + 1
                or next_state.next_case_index != before_evidence_count + 1
                or next_state.completed_cases != self._state.completed_cases + ("UI-01",)
                or next_state.evidence_hashes
                != self._state.evidence_hashes + (evidence_predicted["hash"],)
                or next_state.browser_attestation_hash != browser_predicted[0]["hash"]
                or next_state.mcp_sequence != self._state.mcp_sequence
                or next_state.mcp_tail_hash != self._state.mcp_tail_hash
            ):
                _reject()
            evidence_entries = self._writer.entries()
            browser_entries = self._browser_chain.entries()
            if (
                len(evidence_entries) not in {before_evidence_count, before_evidence_count + 1}
                or len(browser_entries) not in {0, 1}
                or (
                    evidence_entries[before_evidence_count - 1]["hash"]
                    if before_evidence_count
                    else _GENESIS_HASH
                )
                != before_evidence_tail
                or (browser_entries[-1]["hash"] if browser_entries else _GENESIS_HASH)
                not in {before_browser_tail, browser_predicted[0]["hash"]}
            ):
                _reject()
            evidence_delta = len(evidence_entries) - before_evidence_count
            browser_delta = len(browser_entries)
            if (browser_delta, evidence_delta) not in {(0, 0), (1, 0), (1, 1)}:
                _reject()
            if browser_delta and browser_entries[-1] != browser_predicted[0]:
                _reject()
            if evidence_delta and evidence_entries[-1] != evidence_predicted:
                _reject()
            measurements = {
                item["id"]: item.get("count", item.get("hmac", item["passed"]))
                for item in evidence["assertions"]
            }
            if browser_delta == 0:
                if self._browser_chain.append(browser_predicted[0]["payload"]) != browser_predicted[0]:
                    _reject()
            if evidence_delta == 0:
                if self._writer.append("UI-01", "real", measurements) != evidence_predicted:
                    _reject()
        except LiveCoordinatorRejected:
            raise
        except (CaseEvidenceRejected, IndexError, KeyError, OSError, StopIteration, TypeError, ValueError):
            _reject()
        self._persist(next_state)
        self._state = next_state

    def _recover_pending_case(self, pending: Mapping[str, Any]) -> None:
        if set(pending) != {
            "schemaVersion", "kind", "action", "beforeControllerDigest",
            "evidence", "entry", "nextController",
        } or pending["schemaVersion"] != _PENDING_CASE_SCHEMA:
            _reject()
        try:
            evidence = build_passing_evidence(
                pending["evidence"]["caseId"],
                pending["evidence"]["mode"],
                {
                    item["id"]: item.get("count", item.get("hmac", item["passed"]))
                    for item in pending["evidence"]["assertions"]
                },
            )
            if (
                evidence != pending["evidence"]
                or pending["action"] != evidence["caseId"]
                or pending["beforeControllerDigest"] != controller.controller_state_digest(self._state)
                or self.action() != {
                    "kind": "case", "caseId": evidence["caseId"], "mode": evidence["mode"]
                }
            ):
                _reject()
            next_state = controller.restore_controller_state(pending["nextController"])
            entry = pending["entry"]
            entries = self._writer.entries()
            expected_index = self._state.next_case_index
            expected_previous = entries[expected_index - 1]["hash"] if expected_index else _GENESIS_HASH
            if not isinstance(entry, Mapping) or set(entry) != {
                "sequence", "previousHash", "payload", "hash"
            }:
                _reject()
            if (
                entry["sequence"] != expected_index
                or entry["payload"] != evidence
                or entry["previousHash"] != expected_previous
                or next_state.next_case_index != expected_index + 1
                or next_state.completed_cases != self._state.completed_cases + (evidence["caseId"],)
                or next_state.evidence_hashes != self._state.evidence_hashes + (entry["hash"],)
                or next_state.transition_sequence != self._state.transition_sequence + 1
            ):
                _reject()
            expected_hash = hashlib.sha256(
                canonical_json({
                    "sequence": entry["sequence"],
                    "previousHash": entry["previousHash"],
                    "payload": entry["payload"],
                }).encode("ascii")
            ).hexdigest()
            if entry["hash"] != expected_hash:
                _reject()
            measurements = {
                item["id"]: item.get("count", item.get("hmac", item["passed"]))
                for item in evidence["assertions"]
            }
            if len(entries) == expected_index:
                if self._writer.append(evidence["caseId"], evidence["mode"], measurements) != dict(entry):
                    _reject()
            elif len(entries) != expected_index + 1 or entries[-1] != dict(entry):
                _reject()
        except LiveCoordinatorRejected:
            raise
        except (CaseEvidenceRejected, KeyError, OSError, TypeError, ValueError):
            _reject()
        self._persist(next_state)
        self._state = next_state

    def receipt(self) -> dict[str, Any]:
        if self._state.phase != "completed":
            _reject()
        try:
            value = controller.controller_receipt(
                self._state, self._private.file_fd("run-mac-key")
            )
            receipt_fd = self._private.file_fd("receipt")
            if os.fstat(receipt_fd).st_size:
                if read_private_record(receipt_fd) != value:
                    _reject()
                return value
            self._private.write_record_atomic("receipt", value)
            return value
        except LiveCoordinatorRejected:
            raise
        except (OSError, TypeError, ValueError):
            _reject()


def _read_step_frame(fd: int) -> str:
    if type(fd) is not int or fd < 0:
        _reject()
    data = bytearray()
    try:
        while len(data) <= 64:
            chunk = os.read(fd, 1)
            if not chunk:
                _reject()
            if chunk == b"\n":
                if not data:
                    _reject()
                return bytes(data).decode("ascii")
            data.extend(chunk)
    except (OSError, UnicodeDecodeError):
        _reject()
    _reject()


TransitionBuilder = Callable[
    [dict[str, Any]], tuple[tuple[Any, ...], Mapping[str, Any]]
]


def _commit_safe_exchange(
    coordinator: LiveCoordinator,
    safe: dict[str, Any],
    *,
    output_fd: int,
    transition_builder: TransitionBuilder,
) -> dict[str, Any]:
    if not isinstance(coordinator, LiveCoordinator) or not callable(transition_builder):
        _reject()
    try:
        payloads, event = transition_builder(dict(safe))
    except Exception:
        _reject()
    coordinator.commit_chain_transition("mcp", (safe,), payloads, event)
    try:
        mcp_bridge.write_public_result(output_fd, safe)
    except (mcp_bridge.BridgeRejected, OSError, TypeError, ValueError):
        _reject()
    return dict(safe)


def serve_mcp_exchange(
    coordinator: LiveCoordinator,
    *,
    expected_step: str,
    step_fd: int,
    adapter_fd: int,
    output_fd: int,
    transition_builder: TransitionBuilder,
    expected_target_capability_hmac: str | None = None,
    permit_ledger_fd: int | None = None,
) -> dict[str, Any]:
    """Broker and durably commit one MCP exchange before public output.

    The STEP frame and raw adapter envelope use distinct descriptors. The raw
    envelope is passed immediately to ``broker_adapter_envelope`` and is never
    materialized by this module.
    """

    if expected_step not in mcp_queries.CATALOG or _read_step_frame(step_fd) != expected_step:
        _reject()
    try:
        safe = mcp_bridge.broker_adapter_envelope(
            input_fd=adapter_fd,
            mac_key_fd=coordinator._private.file_fd("run-mac-key"),
            expected_target_capability_hmac=expected_target_capability_hmac,
            permit_ledger_fd=permit_ledger_fd,
        )
    except (mcp_bridge.BridgeRejected, OSError, TypeError, ValueError):
        _reject()
    return _commit_safe_exchange(
        coordinator, safe, output_fd=output_fd, transition_builder=transition_builder
    )


def recover_unknown_mcp_exchange(
    coordinator: LiveCoordinator,
    *,
    step: str,
    output_fd: int,
    transition_builder: TransitionBuilder,
    mac_key_fd: int,
    permit_ledger_fd: int,
    expected_target_hmac: str,
    target_capability_hmac: str,
    consume_hash: str,
    permit_hash: str,
    payload_sha256: str,
    case_id: str,
    idempotency_hmac: str,
    controller_state: str,
    controller_state_hash: str,
    controller_state_sequence: int,
) -> dict[str, Any]:
    """Recover one stranded apply dispatch as UNKNOWN, then commit it once."""

    try:
        safe = mcp_bridge.recover_pending_mutation_dispatch(
            step,
            mac_key_fd=mac_key_fd,
            permit_ledger_fd=permit_ledger_fd,
            expected_target_hmac=expected_target_hmac,
            target_capability_hmac=target_capability_hmac,
            consume_hash=consume_hash,
            permit_hash=permit_hash,
            payload_sha256=payload_sha256,
            case_id=case_id,
            idempotency_hmac=idempotency_hmac,
            controller_state=controller_state,
            controller_state_hash=controller_state_hash,
            controller_state_sequence=controller_state_sequence,
        )
    except (mcp_bridge.BridgeRejected, OSError, TypeError, ValueError):
        _reject()
    if safe.get("safeCode") != "MCP_ACTION_UNKNOWN":
        _reject()
    return _commit_safe_exchange(
        coordinator, safe, output_fd=output_fd, transition_builder=transition_builder
    )


def offline_plan() -> dict[str, Any]:
    return {
        "schemaVersion": "protected-live-coordinator-plan.v2",
        "externalActions": 0,
        "resumable": True,
        "stateAuthenticated": True,
        "caseWritesCrashSafe": True,
        "chainWritesCrashSafe": True,
        "rawAdapterDataPersisted": False,
    }


def _main(argv: list[str]) -> int:
    if argv != ["--dry-run"]:
        return 64
    os.write(1, (canonical_json(offline_plan()) + "\n").encode("ascii"))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(os.sys.argv[1:]))
