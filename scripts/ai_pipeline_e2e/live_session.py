"""Import-inert, crash-resumable master session for the protected live E2E.

The session owns only already-closed controller events and descriptor seams.
It never reads credentials, environment variables, raw MCP values, or process
receipts.  Local process work is delegated to the same two-method surface
implemented by ``LocalLiveProcessOrchestrator``.
"""

from __future__ import annotations

import os
import re
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Protocol

try:
    from . import controller, mcp_bridge, mcp_queries, secure_state
    from .live_coordinator import (
        LiveCoordinator,
        recover_unknown_mcp_exchange,
        required_action,
        serve_mcp_exchange,
    )
    from .sanitizer import assert_forbidden_scan_clean, canonical_json
except ImportError:  # pragma: no cover - direct script fallback
    sys.path.insert(0, os.path.dirname(__file__))
    import controller
    import mcp_bridge
    import mcp_queries
    import secure_state
    from live_coordinator import (
        LiveCoordinator,
        recover_unknown_mcp_exchange,
        required_action,
        serve_mcp_exchange,
    )
    from sanitizer import assert_forbidden_scan_clean, canonical_json


SCHEMA_VERSION = "protected-live-session.v1"
_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")
_SHA = re.compile(r"^(?:sha256:)?[a-f0-9]{64}$")
_FORBIDDEN_KEYS = frozenset({
    "accesstoken", "refreshtoken", "token", "secret", "password", "apikey",
    "servicerolekey", "publishablekey", "url", "supabaseurl", "locator",
    "storagepath", "mediapath", "targetpath", "sessionid", "userid",
    "uploadintentid", "projectref", "email", "content", "body", "rawresponse",
    "responsebody", "signedurl", "summary", "transcript", "report", "rawcontent",
    "absolutepath", "secretvalue", "credential",
})


class LiveSessionRejected(ValueError):
    def __init__(self) -> None:
        super().__init__("live_session_rejected")


def _reject() -> None:
    raise LiveSessionRejected()


def _safe_tree(value: Any) -> None:
    def visit(item: Any) -> None:
        if isinstance(item, Mapping):
            for key, child in item.items():
                normalized = "".join(character for character in key.casefold() if character.isalnum()) if isinstance(key, str) else ""
                if (
                    not normalized
                    or normalized in _FORBIDDEN_KEYS
                    or normalized.endswith(("accesstoken", "refreshtoken", "secretvalue", "rawcontent", "responsebody", "signedurl", "storagepath", "mediapath", "targetpath", "locator"))
                ):
                    _reject()
                visit(child)
        elif isinstance(item, (list, tuple)):
            for child in item:
                visit(child)
        elif item is not None and type(item) not in {str, int, bool}:
            _reject()

    visit(value)
    try:
        assert_forbidden_scan_clean(canonical_json(value))
    except (TypeError, ValueError):
        _reject()


_EVENT_CONTRACTS: dict[str, dict[str, frozenset[str]]] = {
    "verify_offline_foundation": {"OFFLINE_FOUNDATION_VERIFIED": frozenset({"manifestVerified", "manifestDigest", "sanitizerSelfTestPassed"})},
    "initialize_private_state": {"PRIVATE_STATE_INITIALIZED": frozenset({"permissionsVerified", "fdContractVerified"})},
    "approve_development_target": {"DEV_TARGET_APPROVED": frozenset({"approvalFd", "macKeyFd"})},
    "inventory_development_target": {"DEV_TARGET_VERIFIED": frozenset({"proof", "mcpEntries", "approvalFd", "macKeyFd"})},
    "inspect_migration_preflight": {"MIGRATION_PREFLIGHT_VERIFIED": frozenset({"ledger", "ledgerHmac", "mcpEntry"})},
    "prepare_migration_009": {"MIGRATION_PREPARED": frozenset({"version", "targetHmac", "payloadSha256", "payloadBindingHmac", "mcpOnly", "productionActionCount"})},
    "prepare_migration_009_retry": {"MIGRATION_PREPARED": frozenset({"version", "targetHmac", "payloadSha256", "payloadBindingHmac", "mcpOnly", "productionActionCount"})},
    "prepare_migration_010": {"MIGRATION_PREPARED": frozenset({"version", "targetHmac", "payloadSha256", "payloadBindingHmac", "mcpOnly", "productionActionCount"})},
    "prepare_migration_010_retry": {"MIGRATION_PREPARED": frozenset({"version", "targetHmac", "payloadSha256", "payloadBindingHmac", "mcpOnly", "productionActionCount"})},
    "dispatch_migration_009": {"MIGRATION_PERMIT_CONSUMED": frozenset({"version", "action", "consumeHash", "targetHmac", "payloadSha256", "caseId", "idempotencyHmac", "permitLedgerFd", "macKeyFd"})},
    "dispatch_migration_009_retry": {"MIGRATION_PERMIT_CONSUMED": frozenset({"version", "action", "consumeHash", "targetHmac", "payloadSha256", "caseId", "idempotencyHmac", "permitLedgerFd", "macKeyFd"})},
    "dispatch_migration_010": {"MIGRATION_PERMIT_CONSUMED": frozenset({"version", "action", "consumeHash", "targetHmac", "payloadSha256", "caseId", "idempotencyHmac", "permitLedgerFd", "macKeyFd"})},
    "dispatch_migration_010_retry": {"MIGRATION_PERMIT_CONSUMED": frozenset({"version", "action", "consumeHash", "targetHmac", "payloadSha256", "caseId", "idempotencyHmac", "permitLedgerFd", "macKeyFd"})},
    "attest_migration_009": {},
    "attest_migration_010": {},
    "reconcile_migration_009": {"MIGRATION_RECONCILED": frozenset({"version", "consumeHash", "dispatchHash", "safeReceiptHmac", "targetHmac", "postconditionMcpEntry", "ledgerMcpEntry", "effectPresent", "ledger", "ledgerHmac", "permitLedgerFd", "macKeyFd", "productionActionCount"})},
    "reconcile_migration_010": {"MIGRATION_RECONCILED": frozenset({"version", "consumeHash", "dispatchHash", "safeReceiptHmac", "targetHmac", "postconditionMcpEntry", "ledgerMcpEntry", "effectPresent", "ledger", "ledgerHmac", "permitLedgerFd", "macKeyFd", "productionActionCount"})},
    "inspect_migration_postflight": {"MIGRATION_POSTFLIGHT_VERIFIED": frozenset({"ledger", "ledgerHmac", "mcpEntry"})},
    "prepare_services": {"SERVICES_READY": frozenset({"explicitSettings", "createAppOnly", "scriptedServicesReady", "outputsDiscarded"})},
    "begin_scripted_cases": {"BEGIN_SCRIPTED_CASES": frozenset({"providerCredentialPresent", "scriptedPortsIsolated", "cleanupPlanned", "outputsDiscarded"})},
    "cleanup_scripted_phase": {"SCRIPTED_PHASE_CLEANED": frozenset({"processesStopped", "providerCredentialAbsent", "scriptedSessionsRemoved", "cleanupVaultConsistent"})},
    "begin_real_cases": {"BEGIN_REAL_CASES": frozenset({"scriptedProcessesStopped", "settingsFdsValidated", "mediaFdValidated", "portsDisjoint", "explicitSettings", "outputsDiscarded"})},
    "cleanup_real_provider_phase": {"REAL_PROVIDER_PHASE_CLEANED": frozenset({"processesStopped", "providerCredentialAbsent", "portsReleased", "outputsDiscarded"})},
    "begin_ui_probe": {"BEGIN_UI_PROBE": frozenset({"platformRunning", "aiServicesStopped", "browserCaptureDisabled"})},
    "verify_cleanup_and_retention": {"CLEANUP_VERIFIED": frozenset({"cleanupVaultComplete", "retention", "orphanCountsZero"})},
    "seal_evidence": {"EVIDENCE_SEALED": frozenset({"evidenceEntries", "mcpEntries", "browserEntries", "manifest"})},
    "complete": {"COMPLETE": frozenset()},
}
_ATTEST_KEYS = {
    "MIGRATION_UNKNOWN": frozenset({"version", "consumeHash", "dispatchHash", "safeReceiptHmac", "reconciliationRequired", "mcpEntry", "permitLedgerFd", "macKeyFd"}),
    "MIGRATION_ATTESTED": frozenset({"version", "consumeHash", "dispatchHash", "safeReceiptHmac", "targetHmac", "applyMcpEntry", "postconditionMcpEntry", "ledgerMcpEntry", "effectPresent", "ledger", "ledgerHmac", "targetMatched", "payloadMatched", "permitLedgerFd", "macKeyFd", "productionActionCount"}),
}
_EVENT_CONTRACTS["attest_migration_009"] = _ATTEST_KEYS
_EVENT_CONTRACTS["attest_migration_010"] = _ATTEST_KEYS
EVENT_CONTRACTS = MappingProxyType({
    action: MappingProxyType(dict(variants)) for action, variants in _EVENT_CONTRACTS.items()
})


def build_controller_event(action: str, value: Any) -> dict[str, Any]:
    variants = _EVENT_CONTRACTS.get(action)
    if variants is None or not isinstance(value, Mapping):
        _reject()
    event_type = value.get("type")
    keys = variants.get(event_type)
    if keys is None or set(value) != {"type", *keys}:
        _reject()
    event = dict(value)
    _safe_tree(event)
    return event


class ClosedActionAdapter(Protocol):
    def event(self, action: str, state: controller.ControllerState) -> Mapping[str, Any]: ...


class ClosedProcessPhases(Protocol):
    def run_scripted_phase(self, *, timeout_seconds: float = 120.0) -> Any: ...
    def resume_scripted_phase(self, *, cursor: Mapping[str, Any], timeout_seconds: float = 120.0) -> Any: ...
    def run_real_through_ui(self, *, timeout_seconds: float = 240.0) -> Any: ...
    def resume_real_through_ui(self, *, cursor: Mapping[str, Any], timeout_seconds: float = 240.0) -> Any: ...


TransitionBuilder = Callable[[dict[str, Any]], tuple[tuple[Any, ...], Mapping[str, Any]]]


@dataclass(frozen=True, repr=False)
class McpAction:
    mode: str
    arguments: Mapping[str, Any] = field(repr=False)
    transition_builder: TransitionBuilder = field(repr=False)

    def __post_init__(self) -> None:
        if self.mode not in {"serve", "recover"} or not callable(self.transition_builder):
            _reject()
        expected = (
            {"expected_step", "step_fd", "adapter_fd", "output_fd", "expected_target_capability_hmac", "permit_ledger_fd"}
            if self.mode == "serve" else
            {"step", "output_fd", "mac_key_fd", "permit_ledger_fd", "expected_target_hmac", "target_capability_hmac", "consume_hash", "permit_hash", "payload_sha256", "case_id", "idempotency_hmac", "controller_state", "controller_state_hash", "controller_state_sequence"}
        )
        if not isinstance(self.arguments, Mapping) or set(self.arguments) != expected:
            _reject()
        arguments = dict(self.arguments)
        step = arguments["expected_step" if self.mode == "serve" else "step"]
        if step not in mcp_queries.CATALOG:
            _reject()
        fd_keys = ("step_fd", "adapter_fd", "output_fd") if self.mode == "serve" else ("output_fd", "mac_key_fd", "permit_ledger_fd")
        fds = [arguments[key] for key in fd_keys]
        if any(type(fd) is not int or fd <= 2 for fd in fds) or len(set(fds)) != len(fds):
            _reject()
        if self.mode == "serve":
            optional_fd = arguments["permit_ledger_fd"]
            optional_hmac = arguments["expected_target_capability_hmac"]
            if optional_fd is not None and (type(optional_fd) is not int or optional_fd <= 2 or optional_fd in fds):
                _reject()
            if optional_hmac is not None and (not isinstance(optional_hmac, str) or _HMAC.fullmatch(optional_hmac) is None):
                _reject()
        else:
            if arguments["case_id"] != "DB-02" or type(arguments["controller_state_sequence"]) is not int or arguments["controller_state_sequence"] < 0:
                _reject()
            for key in ("expected_target_hmac", "target_capability_hmac", "idempotency_hmac"):
                if not isinstance(arguments[key], str) or _HMAC.fullmatch(arguments[key]) is None:
                    _reject()
            for key in ("consume_hash", "permit_hash", "payload_sha256", "controller_state_hash"):
                if not isinstance(arguments[key], str) or _SHA.fullmatch(arguments[key]) is None:
                    _reject()
            if not isinstance(arguments["controller_state"], str) or not arguments["controller_state"]:
                _reject()
        _safe_tree(arguments)
        object.__setattr__(self, "arguments", MappingProxyType(arguments))

    def __repr__(self) -> str:
        return "McpAction(<protected>)"


BatchTransitionBuilder = Callable[
    [tuple[dict[str, Any], ...]],
    tuple[tuple[Any, ...], Mapping[str, Any]],
]


@dataclass(frozen=True, repr=False)
class McpBatchStep:
    expected_step: str
    step_fd: int = field(repr=False)
    adapter_fd: int = field(repr=False)
    output_fd: int = field(repr=False)
    expected_target_capability_hmac: str | None = field(default=None, repr=False)
    permit_ledger_fd: int | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        spec = mcp_queries.CATALOG.get(self.expected_step)
        if (
            spec is None
            or type(self.step_fd) is not int
            or type(self.adapter_fd) is not int
            or type(self.output_fd) is not int
            or self.step_fd <= 2
            or self.adapter_fd <= 2
            or self.output_fd <= 2
            or len({self.step_fd, self.adapter_fd, self.output_fd}) != 3
            or (
                self.expected_target_capability_hmac is not None
                and (
                    not isinstance(self.expected_target_capability_hmac, str)
                    or _HMAC.fullmatch(self.expected_target_capability_hmac) is None
                )
            )
            or (
                self.permit_ledger_fd is not None
                and (
                    type(self.permit_ledger_fd) is not int
                    or self.permit_ledger_fd <= 2
                    or self.permit_ledger_fd in {self.step_fd, self.adapter_fd, self.output_fd}
                )
            )
            or spec.mutation != (self.permit_ledger_fd is not None)
        ):
            _reject()

    def __repr__(self) -> str:
        return "McpBatchStep(<protected>)"


@dataclass(frozen=True, repr=False)
class McpBatchAction:
    steps: tuple[McpBatchStep, ...]
    transition_builder: BatchTransitionBuilder = field(repr=False)
    alternate_step: McpBatchStep | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        if (
            not isinstance(self.steps, tuple)
            or len(self.steps) not in {2, 3}
            or any(not isinstance(step, McpBatchStep) for step in self.steps)
            or len({step.expected_step for step in self.steps}) != len(self.steps)
            or len({step.step_fd for step in self.steps}) != len(self.steps)
            or len({step.adapter_fd for step in self.steps}) != len(self.steps)
            or len({step.output_fd for step in self.steps}) != len(self.steps)
            or self.alternate_step is not None and not isinstance(self.alternate_step, McpBatchStep)
            or not callable(self.transition_builder)
        ):
            _reject()
        candidates = (*self.steps, *((self.alternate_step,) if self.alternate_step else ()))
        descriptor_values = [
            fd
            for step in candidates
            for fd in (step.step_fd, step.adapter_fd, step.output_fd, step.permit_ledger_fd)
            if fd is not None
        ]
        if len(descriptor_values) != len(set(descriptor_values)):
            _reject()

    def __repr__(self) -> str:
        return "McpBatchAction(<protected>)"


class ClosedMcpAdapter(Protocol):
    def request(self, action: str, state: controller.ControllerState) -> McpAction | McpBatchAction | None: ...


_ATTEST_BATCH_STEPS = {
    "attest_migration_009": ("apply_migration_009", "postcondition_009", "migration_ledger_after_009"),
    "attest_migration_010": ("apply_migration_010", "postcondition_010", "migration_ledger_post"),
}


class LiveSession:
    def __init__(self, private_state: secure_state.PrivateState, *, action_adapter: ClosedActionAdapter,
                 mcp_adapter: ClosedMcpAdapter | None = None, process_phases: ClosedProcessPhases | None = None) -> None:
        if not isinstance(private_state, secure_state.PrivateState) or not callable(getattr(action_adapter, "event", None)):
            _reject()
        self._private = private_state
        self._actions = action_adapter
        self._mcp = mcp_adapter
        self._process = process_phases
        try:
            self._coordinator = LiveCoordinator(private_state)
        except BaseException:
            private_state.close()
            _reject()

    @classmethod
    def create(cls, parent_directory: str, run_name: str, *, repository_roots: tuple[str, ...], action_adapter: ClosedActionAdapter,
               mcp_adapter: ClosedMcpAdapter | None = None, process_phases: ClosedProcessPhases | None = None) -> "LiveSession":
        try:
            private = secure_state.initialize_private_state(parent_directory, run_name, repository_roots=repository_roots)
        except BaseException:
            _reject()
        return cls(private, action_adapter=action_adapter, mcp_adapter=mcp_adapter, process_phases=process_phases)

    @classmethod
    def resume(cls, parent_directory: str, run_name: str, *, repository_roots: tuple[str, ...], action_adapter: ClosedActionAdapter,
               mcp_adapter: ClosedMcpAdapter | None = None, process_phases: ClosedProcessPhases | None = None) -> "LiveSession":
        try:
            private = secure_state.reopen_private_state(parent_directory, run_name, repository_roots=repository_roots)
        except BaseException:
            _reject()
        return cls(private, action_adapter=action_adapter, mcp_adapter=mcp_adapter, process_phases=process_phases)

    @property
    def coordinator(self) -> LiveCoordinator:
        return self._coordinator

    def close(self) -> None:
        self._private.close()

    def __enter__(self) -> "LiveSession":
        return self

    def __exit__(self, _kind: object, _value: object, _traceback: object) -> None:
        self.close()

    def __repr__(self) -> str:
        return "LiveSession(<protected>)"

    def action(self) -> dict[str, Any]:
        try:
            action = required_action(self._coordinator.state)
            _safe_tree(action)
            return action
        except LiveSessionRejected:
            raise
        except BaseException:
            _reject()

    def _guarded_builder(self, action: str, builder: TransitionBuilder) -> TransitionBuilder:
        def guarded(safe: dict[str, Any]) -> tuple[tuple[Any, ...], Mapping[str, Any]]:
            try:
                payloads, event = builder(dict(safe))
            except BaseException:
                _reject()
            if not isinstance(payloads, tuple) or not payloads:
                _reject()
            _safe_tree(payloads)
            return payloads, build_controller_event(action, event)
        return guarded

    def _mcp_request(self, action: str) -> McpAction | McpBatchAction | None:
        if self._mcp is None:
            return None
        try:
            request = self._mcp.request(action, self._coordinator.state)
        except BaseException:
            _reject()
        if request is not None and not isinstance(request, (McpAction, McpBatchAction)):
            _reject()
        if request is not None:
            self._validate_mcp_request_fds(request)
        return request

    def _validate_mcp_request_fds(self, request: McpAction | McpBatchAction) -> None:
        """Validate every external descriptor before reading any request data."""

        try:
            if isinstance(request, McpAction):
                arguments = request.arguments
                if request.mode == "serve":
                    permit = arguments["permit_ledger_fd"]
                    self._private.validate_external_fds(
                        read_fds=(arguments["step_fd"], arguments["adapter_fd"]),
                        write_fds=(arguments["output_fd"],),
                        private_rw_fds=(() if permit is None else (permit,)),
                    )
                else:
                    if arguments["mac_key_fd"] != self._private.file_fd("run-mac-key"):
                        _reject()
                    self._private.validate_external_fds(
                        write_fds=(arguments["output_fd"],),
                        private_rw_fds=(arguments["permit_ledger_fd"],),
                    )
                return
            candidates = (
                *request.steps,
                *((request.alternate_step,) if request.alternate_step is not None else ()),
            )
            self._private.validate_external_fds(
                read_fds=tuple(
                    fd
                    for step in candidates
                    for fd in (step.step_fd, step.adapter_fd)
                ),
                write_fds=tuple(step.output_fd for step in candidates),
                private_rw_fds=tuple(
                    step.permit_ledger_fd
                    for step in candidates
                    if step.permit_ledger_fd is not None
                ),
            )
        except BaseException:
            _reject()

    def _execute_mcp_batch(self, action: str, request: McpBatchAction) -> None:
        self._validate_mcp_request_fds(request)
        attestation_steps = _ATTEST_BATCH_STEPS.get(action)
        version = action.removeprefix("reconcile_migration_") if action.startswith("reconcile_migration_") else None
        reconciliation = mcp_queries.RECONCILIATION_STEPS.get(version) if version else None
        expected = attestation_steps or (reconciliation[False] if reconciliation else None)
        if tuple(step.expected_step for step in request.steps) != expected:
            _reject()
        if reconciliation:
            if request.alternate_step is None or request.alternate_step.expected_step != reconciliation[True][1]:
                _reject()
        elif request.alternate_step is not None:
            _reject()

        def broker(step: McpBatchStep) -> dict[str, Any]:
            if self._read_step_frame(step.step_fd) != step.expected_step:
                _reject()
            try:
                return mcp_bridge.broker_adapter_envelope(
                    input_fd=step.adapter_fd,
                    mac_key_fd=self._private.file_fd("run-mac-key"),
                    expected_target_capability_hmac=step.expected_target_capability_hmac,
                    permit_ledger_fd=step.permit_ledger_fd,
                )
            except BaseException:
                _reject()

        try:
            used_steps = [request.steps[0]]
            safe_results_list = [broker(request.steps[0])]
            first = safe_results_list[0]
            if attestation_steps:
                if first.get("safeCode") == "MCP_ACTION_UNKNOWN":
                    pass
                elif first.get("safeCode") is None and first.get("effectPresent") is True:
                    for step in request.steps[1:]:
                        used_steps.append(step)
                        safe_results_list.append(broker(step))
                else:
                    _reject()
            else:
                if type(first.get("effectPresent")) is not bool:
                    _reject()
                selected = request.alternate_step if first["effectPresent"] else request.steps[1]
                if selected is None:
                    _reject()
                used_steps.append(selected)
                safe_results_list.append(broker(selected))
            safe_results = tuple(safe_results_list)
            payloads, event = request.transition_builder(
                tuple(dict(safe) for safe in safe_results)
            )
        except LiveSessionRejected:
            raise
        except BaseException:
            _reject()
        if not isinstance(payloads, tuple) or len(payloads) != len(safe_results):
            _reject()
        _safe_tree(safe_results)
        _safe_tree(payloads)
        clean_event = build_controller_event(action, event)
        if attestation_steps and len(safe_results) == 1 and clean_event["type"] != "MIGRATION_UNKNOWN":
            _reject()
        if attestation_steps and len(safe_results) == 3 and clean_event["type"] != "MIGRATION_ATTESTED":
            _reject()
        if reconciliation and (
            clean_event["type"] != "MIGRATION_RECONCILED"
            or clean_event["effectPresent"] is not safe_results[0]["effectPresent"]
        ):
            _reject()
        try:
            self._coordinator.commit_chain_transition("mcp", safe_results, payloads, clean_event)
            for step, safe in zip(used_steps, safe_results, strict=True):
                mcp_bridge.write_public_result(step.output_fd, safe)
        except BaseException:
            _reject()

    @staticmethod
    def _read_step_frame(fd: int) -> str:
        if type(fd) is not int or fd <= 2:
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
        except LiveSessionRejected:
            raise
        except (OSError, UnicodeDecodeError):
            _reject()
        _reject()

    @staticmethod
    def _process_result(value: Any, *, real: bool) -> None:
        fields = {"scripted_complete", "real_complete", "ui_complete", "retained_successes", "readiness_verified"}
        if isinstance(value, Mapping):
            record = dict(value)
        else:
            try:
                record = vars(value)
            except TypeError:
                _reject()
        expected = {
            "scripted_complete": True, "real_complete": real, "ui_complete": real,
            "retained_successes": 1 if real else 0, "readiness_verified": True,
        }
        if set(record) != fields or record != expected:
            _reject()
        if any(type(record[key]) is not bool for key in ("scripted_complete", "real_complete", "ui_complete", "readiness_verified")) or type(record["retained_successes"]) is not int:
            _reject()
        _safe_tree(record)

    def _run_process_phase(self, cursor: Mapping[str, Any]) -> None:
        if self._process is None:
            _reject()
        phase = self._coordinator.state.phase
        scripted = phase in {"migration_postflight_verified", "services_ready", "scripted_cases_running", "scripted_cleanup_pending"}
        real = phase in {"real_start_required", "real_cases_running", "real_provider_cleanup_pending", "isolated_data_cases_running", "ui_probe_start_required", "ui_case_running"}
        try:
            if scripted:
                if phase == "migration_postflight_verified":
                    result = self._process.run_scripted_phase(timeout_seconds=120.0)
                else:
                    result = self._process.resume_scripted_phase(
                        cursor=dict(cursor), timeout_seconds=120.0
                    )
            elif real:
                if phase == "real_start_required":
                    result = self._process.run_real_through_ui(timeout_seconds=240.0)
                else:
                    result = self._process.resume_real_through_ui(
                        cursor=dict(cursor), timeout_seconds=240.0
                    )
            else:
                _reject()
        except LiveSessionRejected:
            raise
        except BaseException:
            _reject()
        self._process_result(result, real=real)
        expected = {"kind": "action", "action": "verify_cleanup_and_retention" if real else "begin_real_cases"}
        if self.action() != expected or self.action() == dict(cursor):
            _reject()

    def step(self) -> dict[str, Any]:
        cursor = self.action()
        if cursor == {"kind": "action", "action": "done"}:
            return {"schemaVersion": SCHEMA_VERSION, "advanced": False, "action": "done"}
        phase = self._coordinator.state.phase
        if cursor.get("kind") == "case" or phase in {
            "migration_postflight_verified", "services_ready", "scripted_cases_running", "scripted_cleanup_pending",
            "real_start_required", "real_cases_running", "real_provider_cleanup_pending", "isolated_data_cases_running",
            "ui_probe_start_required", "ui_case_running",
        }:
            self._run_process_phase(cursor)
        else:
            action = cursor.get("action")
            if not isinstance(action, str):
                _reject()
            request = self._mcp_request(action)
            try:
                if request is not None:
                    if isinstance(request, McpBatchAction):
                        self._execute_mcp_batch(action, request)
                    else:
                        if action in {*_ATTEST_BATCH_STEPS, "reconcile_migration_009", "reconcile_migration_010"} and request.mode != "recover":
                            _reject()
                        arguments = dict(request.arguments)
                        arguments["transition_builder"] = self._guarded_builder(action, request.transition_builder)
                        if request.mode == "serve":
                            safe = serve_mcp_exchange(self._coordinator, **arguments)
                        else:
                            safe = recover_unknown_mcp_exchange(self._coordinator, **arguments)
                        _safe_tree(safe)
                else:
                    event = build_controller_event(action, self._actions.event(action, self._coordinator.state))
                    self._coordinator.apply_event(event)
            except LiveSessionRejected:
                raise
            except BaseException:
                _reject()
            if self.action() == cursor:
                _reject()
        result = {"schemaVersion": SCHEMA_VERSION, "advanced": True, "action": cursor.get("action", "case")}
        _safe_tree(result)
        return result

    def run(self, *, maximum_steps: int = 128) -> dict[str, Any]:
        if type(maximum_steps) is not int or not 1 <= maximum_steps <= 256:
            _reject()
        for _ in range(maximum_steps):
            if self.action() == {"kind": "action", "action": "done"}:
                try:
                    receipt = self._coordinator.receipt()
                    _safe_tree(receipt)
                    return receipt
                except BaseException:
                    _reject()
            self.step()
        _reject()


def offline_plan() -> dict[str, Any]:
    return {
        "schemaVersion": "protected-live-session-plan.v1",
        "externalActions": 0,
        "productionActions": 0,
        "environmentRead": False,
        "credentialValuesAccepted": False,
        "privateDescriptorSeams": True,
        "resumable": False,
        "restartCursorValidation": True,
    }


def _main(argv: list[str]) -> int:
    if argv != ["--dry-run"]:
        return 64
    os.write(1, (canonical_json(offline_plan()) + "\n").encode("ascii"))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(os.sys.argv[1:]))
