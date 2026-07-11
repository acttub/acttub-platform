from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest import mock

from scripts.ai_pipeline_e2e import controller, live_coordinator, live_session, secure_state
from scripts.ai_pipeline_e2e.case_evidence import CaseEvidenceWriter
from scripts.ai_pipeline_e2e.sanitizer import CASE_BY_ID, CASE_IDS


ROOT = Path(__file__).resolve().parents[3]
MODULE = ROOT / "scripts" / "ai_pipeline_e2e" / "live_session.py"
HMAC = "hmac-sha256:" + "a" * 64
SHA = "b" * 64


class FirstActionAdapter:
    def __init__(self, *, hostile: object | None = None) -> None:
        self.calls: list[str] = []
        self.hostile = hostile

    def event(self, action: str, _state: object) -> object:
        self.calls.append(action)
        if self.hostile is not None:
            if isinstance(self.hostile, BaseException):
                raise self.hostile
            return self.hostile
        if action == "verify_offline_foundation":
            return {
                "type": "OFFLINE_FOUNDATION_VERIFIED",
                "manifestVerified": True,
                "manifestDigest": SHA,
                "sanitizerSelfTestPassed": True,
            }
        if action == "initialize_private_state":
            return {
                "type": "PRIVATE_STATE_INITIALIZED",
                "permissionsVerified": True,
                "fdContractVerified": True,
            }
        raise AssertionError("unexpected_action")


class StaticMcpAdapter:
    def __init__(self, request: object) -> None:
        self.value = request
        self.calls: list[str] = []

    def request(self, action: str, _state: object) -> object:
        self.calls.append(action)
        return self.value


class ResumeProbe:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object] | None]] = []

    def run_scripted_phase(self, *, timeout_seconds: float = 120.0) -> object:
        del timeout_seconds
        self.calls.append(("run-scripted", None))
        raise RuntimeError("stop")

    def resume_scripted_phase(self, *, cursor: dict[str, object], timeout_seconds: float = 120.0) -> object:
        del timeout_seconds
        self.calls.append(("resume-scripted", dict(cursor)))
        raise RuntimeError("stop")

    def run_real_through_ui(self, *, timeout_seconds: float = 240.0) -> object:
        del timeout_seconds
        self.calls.append(("run-real", None))
        raise RuntimeError("stop")

    def resume_real_through_ui(self, *, cursor: dict[str, object], timeout_seconds: float = 240.0) -> object:
        del timeout_seconds
        self.calls.append(("resume-real", dict(cursor)))
        raise RuntimeError("stop")


def private_file(contents: bytes = b"") -> object:
    item = tempfile.TemporaryFile()
    os.fchmod(item.fileno(), 0o600)
    item.write(contents)
    item.flush()
    item.seek(0)
    return item


def batch_step(step: str, resources: list[object]) -> live_session.McpBatchStep:
    step_file = private_file((step + "\n").encode("ascii"))
    adapter_file = private_file()
    output_file = private_file()
    resources.extend((step_file, adapter_file, output_file))
    permit_fd = None
    if step.startswith("apply_migration_"):
        permit = private_file()
        resources.append(permit)
        permit_fd = permit.fileno()  # type: ignore[attr-defined]
    return live_session.McpBatchStep(
        step,
        step_file.fileno(),  # type: ignore[attr-defined]
        adapter_file.fileno(),  # type: ignore[attr-defined]
        output_file.fileno(),  # type: ignore[attr-defined]
        permit_ledger_fd=permit_fd,
    )


def sample_value(key: str) -> object:
    if key.endswith("Fd"):
        return 20
    if key in {
        "manifestVerified", "sanitizerSelfTestPassed", "permissionsVerified", "fdContractVerified",
        "mcpOnly", "reconciliationRequired", "effectPresent", "targetMatched", "payloadMatched",
        "explicitSettings", "createAppOnly", "scriptedServicesReady", "outputsDiscarded",
        "scriptedPortsIsolated", "cleanupPlanned", "processesStopped", "providerCredentialAbsent",
        "scriptedSessionsRemoved", "cleanupVaultConsistent", "scriptedProcessesStopped",
        "settingsFdsValidated", "mediaFdValidated", "portsDisjoint", "portsReleased",
        "platformRunning", "aiServicesStopped", "browserCaptureDisabled", "cleanupVaultComplete",
        "orphanCountsZero",
    }:
        return True
    if key == "providerCredentialPresent":
        return False
    if key in {"productionActionCount"}:
        return 0
    if key == "version":
        return "009"
    if key == "action":
        return "apply_migration_009"
    if key == "caseId":
        return "DB-02"
    if key == "manifestDigest" or key == "payloadSha256":
        return SHA
    if key.casefold().endswith("hmac"):
        return HMAC
    if key.casefold().endswith("hash"):
        return SHA
    if key in {"ledger", "mcpEntries", "evidenceEntries", "browserEntries"}:
        return []
    return {}


def seed_cursor(parent: str, run_name: str, *, phase: str, next_case_index: int) -> None:
    private = secure_state.initialize_private_state(
        parent, run_name, repository_roots=(str(ROOT),)
    )
    try:
        writer = CaseEvidenceWriter(private.file_fd("evidence"))
        for case_id in CASE_IDS[:next_case_index]:
            measurements: dict[str, object] = {}
            for assertion in CASE_BY_ID[case_id]["assertions"]:
                if assertion["kind"] == "boolean":
                    measurements[assertion["id"]] = True
                elif assertion["kind"] == "count":
                    measurements[assertion["id"]] = assertion["equals"]
                else:
                    measurements[assertion["id"]] = HMAC
            writer.append(
                case_id,
                controller.EXPECTED_CASE_MODES[case_id],
                measurements,
            )
        evidence = writer.entries()
        observed_real = next_case_index > CASE_IDS.index("REAL-01")
        state = controller.ControllerState(
            phase=phase,
            next_case_index=next_case_index,
            completed_cases=CASE_IDS[:next_case_index],
            evidence_hashes=tuple(entry["hash"] for entry in evidence),
            manifest_verified=True,
            production_negative_verified=True,
            actual_gemini_observed=observed_real,
            actual_media_observed=observed_real,
            manifest_digest="sha256:" + SHA,
            scripted_phase_cleaned=phase != "scripted_cleanup_pending",
            real_phase_started=phase != "scripted_cleanup_pending",
            transition_sequence=40 + next_case_index,
            provider_attestation_hmac=HMAC if observed_real else None,
            media_attestation_hmac=HMAC if observed_real else None,
        )
        state = controller.restore_controller_state(controller.controller_state_record(state))
        key_fd = private.file_fd("run-mac-key")
        key = os.pread(key_fd, os.fstat(key_fd).st_size, 0)
        private.write_record_atomic("state", live_coordinator._envelope(key, state))
    finally:
        private.close()


class LiveSessionTests(unittest.TestCase):
    def make_parent(self, stack: unittest.mock._patch | None = None) -> tempfile.TemporaryDirectory[str]:
        del stack
        parent = tempfile.TemporaryDirectory()
        os.chmod(parent.name, 0o700)
        return parent

    def test_import_is_inert_and_cli_is_dry_run_only(self) -> None:
        source = MODULE.read_text(encoding="utf-8")
        for forbidden in ("os.environ", "getenv(", "subprocess", "socket", "requests", "playwright"):
            self.assertNotIn(forbidden, source)
        completed = subprocess.run(
            (sys.executable, "-I", str(MODULE), "--dry-run"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            env={"PATH": os.defpath, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.assertEqual((completed.returncode, completed.stderr), (0, b""))
        self.assertEqual(json.loads(completed.stdout), live_session.offline_plan())
        self.assertEqual(live_session.offline_plan()["externalActions"], 0)
        self.assertIs(live_session.offline_plan()["resumable"], False)
        self.assertIs(live_session.offline_plan()["restartCursorValidation"], True)
        for argv in ((), ("--live",), ("--dry-run", "extra")):
            rejected = subprocess.run(
                (sys.executable, "-I", str(MODULE), *argv),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                env={"PATH": os.defpath, "PYTHONDONTWRITEBYTECODE": "1"},
            )
            self.assertEqual((rejected.returncode, rejected.stdout, rejected.stderr), (64, b"", b""))

    def test_every_non_case_event_contract_is_exact_and_allowlist_only(self) -> None:
        self.assertNotIn("done", live_session.EVENT_CONTRACTS)
        self.assertNotIn("CASE_RECORDED", {
            event_type
            for variants in live_session.EVENT_CONTRACTS.values()
            for event_type in variants
        })
        for action, variants in live_session.EVENT_CONTRACTS.items():
            for event_type, keys in variants.items():
                with self.subTest(action=action, event_type=event_type):
                    event = {"type": event_type, **{key: sample_value(key) for key in keys}}
                    self.assertEqual(live_session.build_controller_event(action, event), event)
                    missing = dict(event)
                    if keys:
                        missing.pop(next(iter(keys)))
                        with self.assertRaisesRegex(live_session.LiveSessionRejected, "^live_session_rejected$"):
                            live_session.build_controller_event(action, missing)
                    with self.assertRaises(live_session.LiveSessionRejected):
                        live_session.build_controller_event(action, {**event, "unknown": True})
        with self.assertRaises(live_session.LiveSessionRejected):
            live_session.build_controller_event("unknown_action", {"type": "COMPLETE"})
        with self.assertRaises(live_session.LiveSessionRejected):
            live_session.build_controller_event("complete", {"type": "UNKNOWN"})

    def test_event_builder_rejects_raw_or_unsafe_material_at_any_depth(self) -> None:
        base = {
            "type": "OFFLINE_FOUNDATION_VERIFIED",
            "manifestVerified": True,
            "manifestDigest": SHA,
            "sanitizerSelfTestPassed": True,
        }
        hostile = (
            {**base, "manifestDigest": "https://example.invalid/private"},
            {**base, "manifestDigest": "/private/machine/path"},
            {**base, "manifestDigest": "11111111-1111-4111-8111-111111111111"},
            {
                "type": "DEV_TARGET_VERIFIED",
                "proof": {"accessToken": "hidden"},
                "mcpEntries": [],
                "approvalFd": 10,
                "macKeyFd": 11,
            },
        )
        for value in hostile:
            action = "inventory_development_target" if value["type"] == "DEV_TARGET_VERIFIED" else "verify_offline_foundation"
            with self.subTest(action=action):
                with self.assertRaisesRegex(live_session.LiveSessionRejected, "^live_session_rejected$"):
                    live_session.build_controller_event(action, value)

    def test_create_close_resume_advances_without_repeating_committed_action(self) -> None:
        with self.make_parent() as parent:
            first = FirstActionAdapter()
            session = live_session.LiveSession.create(
                parent,
                "run-live-session-resume",
                repository_roots=(str(ROOT),),
                action_adapter=first,
            )
            try:
                self.assertEqual(session.action(), {"kind": "action", "action": "verify_offline_foundation"})
                public = session.step()
                self.assertEqual(public, {
                    "schemaVersion": live_session.SCHEMA_VERSION,
                    "advanced": True,
                    "action": "verify_offline_foundation",
                })
                self.assertEqual(first.calls, ["verify_offline_foundation"])
                self.assertEqual(session.action(), {"kind": "action", "action": "initialize_private_state"})
                state_text = os.pread(
                    session.coordinator._private.file_fd("state"),
                    os.fstat(session.coordinator._private.file_fd("state")).st_size,
                    0,
                ).decode("ascii")
                self.assertNotIn(parent, state_text)
                self.assertNotIn("run-live-session-resume", state_text)
            finally:
                session.close()

            resumed_adapter = FirstActionAdapter()
            resumed = live_session.LiveSession.resume(
                parent,
                "run-live-session-resume",
                repository_roots=(str(ROOT),),
                action_adapter=resumed_adapter,
            )
            try:
                self.assertEqual(resumed.action(), {"kind": "action", "action": "initialize_private_state"})
                resumed.step()
                self.assertEqual(resumed_adapter.calls, ["initialize_private_state"])
                self.assertEqual(resumed.coordinator.state.phase, "private_state_ready")
            finally:
                resumed.close()

    def test_reopen_dispatches_every_persisted_process_cursor_to_resume_only(self) -> None:
        cursors = (
            ("scripted_cleanup_pending", 19, {"kind": "action", "action": "cleanup_scripted_phase"}, "resume-scripted"),
            ("real_cases_running", 19, {"kind": "case", "caseId": "REAL-01", "mode": "real"}, "resume-real"),
            ("real_cases_running", 20, {"kind": "case", "caseId": "LINEAGE-01", "mode": "real"}, "resume-real"),
            ("real_cases_running", 21, {"kind": "case", "caseId": "REPLAY-01", "mode": "real"}, "resume-real"),
            ("real_provider_cleanup_pending", 22, {"kind": "action", "action": "cleanup_real_provider_phase"}, "resume-real"),
            ("isolated_data_cases_running", 22, {"kind": "case", "caseId": "RLS-01", "mode": "scripted"}, "resume-real"),
            ("isolated_data_cases_running", 23, {"kind": "case", "caseId": "DELETE-01", "mode": "scripted"}, "resume-real"),
            ("ui_probe_start_required", 24, {"kind": "action", "action": "begin_ui_probe"}, "resume-real"),
            ("ui_case_running", 24, {"kind": "case", "caseId": "UI-01", "mode": "real"}, "resume-real"),
        )
        for index, (phase, case_index, cursor, method) in enumerate(cursors):
            with self.subTest(phase=phase, cursor=cursor), self.make_parent() as parent:
                run_name = f"run-resume-cursor-{index}"
                seed_cursor(parent, run_name, phase=phase, next_case_index=case_index)
                process = ResumeProbe()
                session = live_session.LiveSession.resume(
                    parent,
                    run_name,
                    repository_roots=(str(ROOT),),
                    action_adapter=FirstActionAdapter(),
                    process_phases=process,
                )
                try:
                    self.assertEqual(session.action(), cursor)
                    with self.assertRaisesRegex(live_session.LiveSessionRejected, "^live_session_rejected$"):
                        session.step()
                    self.assertEqual(process.calls, [(method, cursor)])
                    self.assertEqual(session.action(), cursor)
                finally:
                    session.close()

    def test_adapter_failures_and_unknown_outputs_are_fixed_and_do_not_commit(self) -> None:
        hostile_values = (
            ValueError("access-token-would-have-leaked"),
            {"type": "OFFLINE_FOUNDATION_VERIFIED", "manifestVerified": True},
            {
                "type": "OFFLINE_FOUNDATION_VERIFIED",
                "manifestVerified": True,
                "manifestDigest": "https://example.invalid/raw",
                "sanitizerSelfTestPassed": True,
            },
            {"type": "OFFLINE_FOUNDATION_VERIFIED", "manifestVerified": True, "manifestDigest": SHA, "sanitizerSelfTestPassed": True, "extra": True},
        )
        for index, hostile in enumerate(hostile_values):
            with self.subTest(index=index), self.make_parent() as parent:
                session = live_session.LiveSession.create(
                    parent,
                    f"run-hostile-{index}",
                    repository_roots=(str(ROOT),),
                    action_adapter=FirstActionAdapter(hostile=hostile),
                )
                try:
                    with self.assertRaisesRegex(live_session.LiveSessionRejected, "^live_session_rejected$"):
                        session.step()
                    self.assertEqual(session.action(), {"kind": "action", "action": "verify_offline_foundation"})
                finally:
                    session.close()

    def test_mcp_action_specs_are_private_exact_and_immutable(self) -> None:
        files = [private_file() for _ in range(4)]
        try:
            serve_args = {
                "expected_step": "inventory_projects",
                "step_fd": files[0].fileno(),
                "adapter_fd": files[1].fileno(),
                "output_fd": files[2].fileno(),
                "expected_target_capability_hmac": None,
                "permit_ledger_fd": None,
            }
            action = live_session.McpAction("serve", serve_args, lambda _safe: (({"operation": "list_projects"},), {}))
            self.assertEqual(repr(action), "McpAction(<protected>)")
            serve_args["expected_step"] = "tampered"
            self.assertEqual(action.arguments["expected_step"], "inventory_projects")
            recover_args = {
                "step": "apply_migration_009",
                "output_fd": files[0].fileno(),
                "mac_key_fd": files[1].fileno(),
                "permit_ledger_fd": files[2].fileno(),
                "expected_target_hmac": HMAC,
                "target_capability_hmac": HMAC,
                "consume_hash": SHA,
                "permit_hash": SHA,
                "payload_sha256": SHA,
                "case_id": "DB-02",
                "idempotency_hmac": HMAC,
                "controller_state": "migration_009_in_flight",
                "controller_state_hash": "sha256:" + SHA,
                "controller_state_sequence": 4,
            }
            self.assertEqual(repr(live_session.McpAction("recover", recover_args, lambda _safe: (({},), {}))), "McpAction(<protected>)")
            for bad in (
                {**recover_args, "case_id": "RAW-01"},
                {**recover_args, "controller_state": "https://example.invalid/raw"},
                {**serve_args, "expected_step": "unknown"},
                {**serve_args, "step_fd": files[1].fileno()},
            ):
                mode = "recover" if "case_id" in bad else "serve"
                with self.assertRaises(live_session.LiveSessionRejected):
                    live_session.McpAction(mode, bad, lambda _safe: (({},), {}))
        finally:
            for item in files:
                item.close()

    def test_mcp_request_fds_reject_private_state_and_dup_identity_aliases(self) -> None:
        files = [private_file(b"inventory_projects\n"), private_file(), private_file()]
        try:
            with self.make_parent() as parent:
                adapter = StaticMcpAdapter(None)
                session = live_session.LiveSession.create(
                    parent, "run-mcp-owned-alias", repository_roots=(str(ROOT),),
                    action_adapter=FirstActionAdapter(), mcp_adapter=adapter,
                )
                output_alias = os.dup(session._private.file_fd("run-mac-key"))
                try:
                    adapter.value = live_session.McpAction("serve", {
                        "expected_step": "inventory_projects",
                        "step_fd": files[0].fileno(),
                        "adapter_fd": files[1].fileno(),
                        "output_fd": output_alias,
                        "expected_target_capability_hmac": None,
                        "permit_ledger_fd": None,
                    }, lambda _safe: (({},), {}))
                    with (
                        mock.patch.object(live_session, "serve_mcp_exchange") as served,
                        self.assertRaisesRegex(live_session.LiveSessionRejected, "^live_session_rejected$"),
                    ):
                        session.step()
                    served.assert_not_called()
                    self.assertEqual(session.action(), {"kind": "action", "action": "verify_offline_foundation"})
                finally:
                    os.close(output_alias)
                    session.close()

            with self.make_parent() as parent:
                session = live_session.LiveSession.create(
                    parent, "run-mcp-dup-alias", repository_roots=(str(ROOT),),
                    action_adapter=FirstActionAdapter(),
                )
                permit_alias = os.dup(files[2].fileno())
                resources: list[object] = []
                try:
                    apply_step_file = private_file(b"apply_migration_009\n")
                    apply_adapter = private_file()
                    resources.extend((apply_step_file, apply_adapter))
                    first = live_session.McpBatchStep(
                        "apply_migration_009",
                        apply_step_file.fileno(),
                        apply_adapter.fileno(),
                        files[2].fileno(),
                        permit_ledger_fd=permit_alias,
                    )
                    remaining = tuple(batch_step(step, resources) for step in (
                        "postcondition_009", "migration_ledger_after_009",
                    ))
                    request = live_session.McpBatchAction(
                        (first, *remaining), lambda _safe: (({}, {}, {}), {}),
                    )
                    with (
                        mock.patch.object(live_session.mcp_bridge, "broker_adapter_envelope") as brokered,
                        self.assertRaisesRegex(live_session.LiveSessionRejected, "^live_session_rejected$"),
                    ):
                        session._execute_mcp_batch("attest_migration_009", request)
                    brokered.assert_not_called()
                finally:
                    os.close(permit_alias)
                    session.close()
                    for item in resources:
                        item.close()  # type: ignore[attr-defined]
        finally:
            for item in files:
                item.close()

    def test_mcp_request_fds_reject_wrong_access_direction(self) -> None:
        files = [private_file(b"inventory_projects\n"), private_file()]
        read_fd, write_fd = os.pipe()
        try:
            request = live_session.McpAction("serve", {
                "expected_step": "inventory_projects",
                "step_fd": files[0].fileno(),
                "adapter_fd": files[1].fileno(),
                "output_fd": read_fd,
                "expected_target_capability_hmac": None,
                "permit_ledger_fd": None,
            }, lambda _safe: (({},), {}))
            with self.make_parent() as parent:
                session = live_session.LiveSession.create(
                    parent, "run-mcp-access", repository_roots=(str(ROOT),),
                    action_adapter=FirstActionAdapter(), mcp_adapter=StaticMcpAdapter(request),
                )
                try:
                    with self.assertRaisesRegex(live_session.LiveSessionRejected, "^live_session_rejected$"):
                        session.step()
                finally:
                    session.close()
        finally:
            os.close(read_fd)
            os.close(write_fd)
            for item in files:
                item.close()

    def test_attestation_batch_brokers_three_results_then_commits_before_distinct_outputs(self) -> None:
        resources: list[object] = []
        steps = tuple(batch_step(step, resources) for step in (
            "apply_migration_009", "postcondition_009", "migration_ledger_after_009",
        ))
        events: list[str] = []

        def transition(safe: tuple[dict[str, object], ...]) -> tuple[tuple[object, ...], dict[str, object]]:
            self.assertEqual(len(safe), 3)
            event_type = "MIGRATION_ATTESTED"
            event = {
                "type": event_type,
                **{
                    key: sample_value(key)
                    for key in live_session.EVENT_CONTRACTS["attest_migration_009"][event_type]
                },
            }
            return tuple({"operation": step.expected_step, "responseHmac": HMAC} for step in steps), event

        request = live_session.McpBatchAction(steps, transition)
        safe_results = (
            {
                "effectPresent": True, "migrationOrdinal": 9, "productionActionCount": 0,
                "targetProjectHmac": HMAC, "developmentTargetHmac": HMAC,
                "targetCapabilityHmac": HMAC, "permitHash": "sha256:" + SHA,
                "consumeHash": "sha256:" + SHA, "dispatchHash": "sha256:" + SHA,
                "payloadSha256": "sha256:" + SHA, "resultHmac": HMAC,
            },
            {"effectPresent": True, "checkCount": 12, "productionActionCount": 0, "targetProjectHmac": HMAC, "resultHmac": HMAC},
            {"ledgerExact": True, "migrationCount": 9, "productionActionCount": 0, "targetProjectHmac": HMAC, "resultHmac": HMAC},
        )
        try:
            with self.make_parent() as parent:
                session = live_session.LiveSession.create(
                    parent, "run-batch-success", repository_roots=(str(ROOT),),
                    action_adapter=FirstActionAdapter(),
                )
                try:
                    def broker(**_kwargs: object) -> dict[str, object]:
                        events.append("broker")
                        return dict(safe_results[len([item for item in events if item == "broker"]) - 1])

                    def commit(*_args: object, **_kwargs: object) -> None:
                        events.append("commit")

                    def write(output_fd: int, _safe: object) -> None:
                        events.append(f"write:{output_fd}")

                    with (
                        mock.patch.object(live_session.mcp_bridge, "broker_adapter_envelope", side_effect=broker) as brokered,
                        mock.patch.object(session.coordinator, "commit_chain_transition", side_effect=commit) as committed,
                        mock.patch.object(live_session.mcp_bridge, "write_public_result", side_effect=write) as written,
                    ):
                        session._execute_mcp_batch("attest_migration_009", request)
                    self.assertEqual(brokered.call_count, 3)
                    self.assertEqual(committed.call_count, 1)
                    self.assertEqual(written.call_count, 3)
                    self.assertEqual(events[:4], ["broker", "broker", "broker", "commit"])
                    output_fds = [call.args[0] for call in written.call_args_list]
                    self.assertEqual(output_fds, [step.output_fd for step in steps])
                    self.assertEqual(len(output_fds), len(set(output_fds)))
                finally:
                    session.close()
        finally:
            for item in resources:
                item.close()  # type: ignore[attr-defined]

    def test_attestation_unknown_commits_only_apply_and_never_reads_later_fds(self) -> None:
        resources: list[object] = []
        steps = tuple(batch_step(step, resources) for step in (
            "apply_migration_010", "postcondition_010", "migration_ledger_post",
        ))

        def transition(safe: tuple[dict[str, object], ...]) -> tuple[tuple[object, ...], dict[str, object]]:
            self.assertEqual(len(safe), 1)
            event_type = "MIGRATION_UNKNOWN"
            event = {
                "type": event_type,
                **{
                    key: sample_value(key)
                    for key in live_session.EVENT_CONTRACTS["attest_migration_010"][event_type]
                },
            }
            return ({"operation": "apply_migration", "responseHmac": HMAC},), event

        request = live_session.McpBatchAction(steps, transition)
        unknown = {
            "safeCode": "MCP_ACTION_UNKNOWN", "productionActionCount": 0,
            "targetProjectHmac": HMAC, "developmentTargetHmac": HMAC,
            "targetCapabilityHmac": HMAC, "permitHash": "sha256:" + SHA,
            "consumeHash": "sha256:" + SHA, "dispatchHash": "sha256:" + SHA,
            "payloadSha256": "sha256:" + SHA, "resultHmac": HMAC,
        }
        try:
            with self.make_parent() as parent:
                session = live_session.LiveSession.create(
                    parent, "run-batch-unknown", repository_roots=(str(ROOT),),
                    action_adapter=FirstActionAdapter(),
                )
                try:
                    with (
                        mock.patch.object(live_session.mcp_bridge, "broker_adapter_envelope", return_value=unknown) as brokered,
                        mock.patch.object(session.coordinator, "commit_chain_transition") as committed,
                        mock.patch.object(live_session.mcp_bridge, "write_public_result") as written,
                    ):
                        session._execute_mcp_batch("attest_migration_010", request)
                    self.assertEqual(brokered.call_count, 1)
                    self.assertEqual(committed.call_args.args[1][0]["safeCode"], "MCP_ACTION_UNKNOWN")
                    self.assertEqual(written.call_count, 1)
                    self.assertEqual(written.call_args.args[0], steps[0].output_fd)
                    self.assertEqual(os.lseek(steps[1].step_fd, 0, os.SEEK_CUR), 0)
                    self.assertEqual(os.lseek(steps[2].step_fd, 0, os.SEEK_CUR), 0)
                finally:
                    session.close()
        finally:
            for item in resources:
                item.close()  # type: ignore[attr-defined]

    def test_reconciliation_selects_ledger_from_effect_without_reading_alternate(self) -> None:
        cases = (
            ("009", False, "migration_ledger_pre"),
            ("009", True, "migration_ledger_after_009"),
            ("010", False, "migration_ledger_after_009"),
            ("010", True, "migration_ledger_post"),
        )
        for index, (version, effect_present, expected_ledger) in enumerate(cases):
            with self.subTest(version=version, effect_present=effect_present):
                resources: list[object] = []
                false_steps = live_session.mcp_queries.RECONCILIATION_STEPS[version][False]
                true_steps = live_session.mcp_queries.RECONCILIATION_STEPS[version][True]
                steps = tuple(batch_step(step, resources) for step in false_steps)
                alternate = batch_step(true_steps[1], resources)

                def transition(safe: tuple[dict[str, object], ...]) -> tuple[tuple[object, ...], dict[str, object]]:
                    self.assertEqual(len(safe), 2)
                    event_type = "MIGRATION_RECONCILED"
                    event = {
                        "type": event_type,
                        **{
                            key: sample_value(key)
                            for key in live_session.EVENT_CONTRACTS[f"reconcile_migration_{version}"][event_type]
                        },
                    }
                    event["effectPresent"] = effect_present
                    return (
                        {"operation": steps[0].expected_step, "responseHmac": HMAC},
                        {"operation": expected_ledger, "responseHmac": HMAC},
                    ), event

                request = live_session.McpBatchAction(steps, transition, alternate)
                post = {"effectPresent": effect_present, "checkCount": 12, "productionActionCount": 0, "targetProjectHmac": HMAC, "resultHmac": HMAC}
                ledger = {"ledgerExact": True, "migrationCount": 9, "productionActionCount": 0, "targetProjectHmac": HMAC, "resultHmac": HMAC}
                try:
                    with self.make_parent() as parent:
                        session = live_session.LiveSession.create(
                            parent, f"run-reconcile-{index}", repository_roots=(str(ROOT),),
                            action_adapter=FirstActionAdapter(),
                        )
                        selected = alternate if effect_present else steps[1]
                        unused = steps[1] if effect_present else alternate
                        try:
                            with (
                                mock.patch.object(live_session.mcp_bridge, "broker_adapter_envelope", side_effect=(post, ledger)) as brokered,
                                mock.patch.object(session.coordinator, "commit_chain_transition"),
                                mock.patch.object(live_session.mcp_bridge, "write_public_result") as written,
                            ):
                                session._execute_mcp_batch(f"reconcile_migration_{version}", request)
                            self.assertEqual([call.kwargs["input_fd"] for call in brokered.call_args_list], [steps[0].adapter_fd, selected.adapter_fd])
                            self.assertEqual([call.args[0] for call in written.call_args_list], [steps[0].output_fd, selected.output_fd])
                            self.assertEqual(os.lseek(unused.step_fd, 0, os.SEEK_CUR), 0)
                        finally:
                            session.close()
                finally:
                    for item in resources:
                        item.close()  # type: ignore[attr-defined]

    def test_session_routes_mcp_through_serve_and_guards_transition_builder(self) -> None:
        files = [private_file() for _ in range(3)]
        try:
            def builder(_safe: dict[str, object]) -> tuple[tuple[object, ...], dict[str, object]]:
                return (({"operation": "list_projects", "success": True},), {
                    "type": "OFFLINE_FOUNDATION_VERIFIED",
                    "manifestVerified": True,
                    "manifestDigest": SHA,
                    "sanitizerSelfTestPassed": True,
                })

            request = live_session.McpAction("serve", {
                "expected_step": "inventory_projects",
                "step_fd": files[0].fileno(),
                "adapter_fd": files[1].fileno(),
                "output_fd": files[2].fileno(),
                "expected_target_capability_hmac": None,
                "permit_ledger_fd": None,
            }, builder)
            with self.make_parent() as parent:
                session = live_session.LiveSession.create(
                    parent,
                    "run-mcp-seam",
                    repository_roots=(str(ROOT),),
                    action_adapter=FirstActionAdapter(),
                    mcp_adapter=StaticMcpAdapter(request),
                )

                def fake_serve(coordinator: object, **kwargs: object) -> dict[str, object]:
                    payloads, event = kwargs["transition_builder"]({"safeCode": "SAFE"})  # type: ignore[index,operator]
                    self.assertEqual(payloads[0]["operation"], "list_projects")
                    coordinator.apply_event(event)  # type: ignore[attr-defined]
                    return {"schemaVersion": "safe-mcp.v1", "success": True}

                try:
                    with mock.patch.object(live_session, "serve_mcp_exchange", side_effect=fake_serve) as called:
                        session.step()
                    self.assertEqual(called.call_count, 1)
                    self.assertEqual(session.coordinator.state.phase, "offline_verified")
                finally:
                    session.close()
        finally:
            for item in files:
                item.close()

    def test_session_routes_unknown_mcp_recovery_through_private_fd_seam(self) -> None:
        files = [private_file() for _ in range(3)]
        try:
            with self.make_parent() as parent:
                adapter = StaticMcpAdapter(None)
                session = live_session.LiveSession.create(
                    parent,
                    "run-mcp-recovery-seam",
                    repository_roots=(str(ROOT),),
                    action_adapter=FirstActionAdapter(),
                    mcp_adapter=adapter,
                )
                adapter.value = live_session.McpAction("recover", {
                    "step": "apply_migration_009",
                    "output_fd": files[0].fileno(),
                    "mac_key_fd": session._private.file_fd("run-mac-key"),
                    "permit_ledger_fd": files[2].fileno(),
                    "expected_target_hmac": HMAC,
                    "target_capability_hmac": HMAC,
                    "consume_hash": SHA,
                    "permit_hash": SHA,
                    "payload_sha256": SHA,
                    "case_id": "DB-02",
                    "idempotency_hmac": HMAC,
                    "controller_state": "migration_009_in_flight",
                    "controller_state_hash": "sha256:" + SHA,
                    "controller_state_sequence": 4,
                }, lambda _safe: (({"operation": "apply_migration", "success": False},), {
                    "type": "OFFLINE_FOUNDATION_VERIFIED",
                    "manifestVerified": True,
                    "manifestDigest": SHA,
                    "sanitizerSelfTestPassed": True,
                }))

                def fake_recover(coordinator: object, **kwargs: object) -> dict[str, object]:
                    _payloads, event = kwargs["transition_builder"]({"safeCode": "MCP_ACTION_UNKNOWN"})  # type: ignore[index,operator]
                    coordinator.apply_event(event)  # type: ignore[attr-defined]
                    return {"schemaVersion": "safe-mcp.v1", "safeCode": "MCP_ACTION_UNKNOWN"}

                try:
                    with mock.patch.object(live_session, "recover_unknown_mcp_exchange", side_effect=fake_recover) as called:
                        session.step()
                    self.assertEqual(called.call_count, 1)
                    self.assertEqual(session.coordinator.state.phase, "offline_verified")
                finally:
                    session.close()
        finally:
            for item in files:
                item.close()

    def test_recovery_rejects_mac_key_alias_instead_of_exact_private_binding(self) -> None:
        files = [private_file() for _ in range(2)]
        try:
            with self.make_parent() as parent:
                adapter = StaticMcpAdapter(None)
                session = live_session.LiveSession.create(
                    parent,
                    "run-mcp-recovery-key-alias",
                    repository_roots=(str(ROOT),),
                    action_adapter=FirstActionAdapter(),
                    mcp_adapter=adapter,
                )
                key_alias = os.dup(session._private.file_fd("run-mac-key"))
                try:
                    adapter.value = live_session.McpAction("recover", {
                        "step": "apply_migration_009",
                        "output_fd": files[0].fileno(),
                        "mac_key_fd": key_alias,
                        "permit_ledger_fd": files[1].fileno(),
                        "expected_target_hmac": HMAC,
                        "target_capability_hmac": HMAC,
                        "consume_hash": SHA,
                        "permit_hash": SHA,
                        "payload_sha256": SHA,
                        "case_id": "DB-02",
                        "idempotency_hmac": HMAC,
                        "controller_state": "migration_009_in_flight",
                        "controller_state_hash": "sha256:" + SHA,
                        "controller_state_sequence": 4,
                    }, lambda _safe: (({},), {}))
                    with (
                        mock.patch.object(live_session, "recover_unknown_mcp_exchange") as recovered,
                        self.assertRaisesRegex(live_session.LiveSessionRejected, "^live_session_rejected$"),
                    ):
                        session.step()
                    recovered.assert_not_called()
                finally:
                    os.close(key_alias)
                    session.close()
        finally:
            for item in files:
                item.close()

    def test_process_result_surface_matches_live_process_orchestrator(self) -> None:
        @dataclass
        class Result:
            scripted_complete: bool
            real_complete: bool
            ui_complete: bool
            retained_successes: int
            readiness_verified: bool

        live_session.LiveSession._process_result(Result(True, False, False, 0, True), real=False)
        live_session.LiveSession._process_result(Result(True, True, True, 1, True), real=True)
        for hostile in (
            Result(True, True, False, 1, True),
            {"scripted_complete": True, "real_complete": False},
            {"scripted_complete": True, "real_complete": False, "ui_complete": False, "retained_successes": 0, "readiness_verified": True, "path": "/raw"},
        ):
            with self.assertRaisesRegex(live_session.LiveSessionRejected, "^live_session_rejected$"):
                live_session.LiveSession._process_result(hostile, real=False)


if __name__ == "__main__":
    unittest.main()
