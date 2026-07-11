from __future__ import annotations

import hashlib
import hmac
import json
import os
import tempfile
import unittest
from dataclasses import replace
from unittest import mock

from scripts.ai_pipeline_e2e import (
    case_evidence,
    controller,
    live_coordinator,
    mcp_bridge,
    mcp_queries,
    sanitizer,
    secure_state,
)


HEX = "a" * 64
HEX_B = "b" * 64
HEX_C = "c" * 64
HEX_D = "d" * 64
HMAC_A = "hmac-sha256:" + HEX
HMAC_B = "hmac-sha256:" + HEX_B
HMAC_C = "hmac-sha256:" + HEX_C
HMAC_D = "hmac-sha256:" + HEX_D


def passing_measurements(case_id: str) -> dict[str, object]:
    result: dict[str, object] = {}
    for assertion in sanitizer.CASE_BY_ID[case_id]["assertions"]:
        if assertion["kind"] == "boolean":
            result[assertion["id"]] = True
        elif assertion["kind"] == "count":
            result[assertion["id"]] = assertion["equals"]
        else:
            result[assertion["id"]] = "hmac-sha256:" + HEX
    return result


def mcp_payload(
    operation: str,
    *,
    target_hmac: str = HMAC_A,
    response_hmac: str = HMAC_C,
    precondition_hmac: str = HMAC_B,
    postcondition_hmac: str = HMAC_D,
    request_hash: str = HEX,
) -> dict[str, object]:
    return {
        "schemaVersion": "protected-mcp-attestation.v2",
        "operation": operation,
        "targetHmac": target_hmac,
        "permitHash": None,
        "consumeHash": None,
        "dispatchHash": None,
        "safeReceiptHmac": None,
        "requestHash": "sha256:" + request_hash,
        "responseHmac": response_hmac,
        "preconditionHash": precondition_hmac,
        "postconditionHash": postcondition_hmac,
        "success": True,
        "schemaValid": True,
        "developmentMatch": True,
        "productionAction": False,
        "safeCode": None,
    }


def ledger_safe(result_hmac: str = HMAC_C, target_hmac: str = HMAC_A) -> dict[str, object]:
    return {
        "ledgerExact": True,
        "migrationCount": len(controller.MIGRATION_PRE_LEDGER),
        "productionActionCount": 0,
        "targetProjectHmac": target_hmac,
        "resultHmac": result_hmac,
    }


def call_tool_result(payload: object) -> dict[str, object]:
    return {
        "content": [{"type": "text", "text": json.dumps(payload, separators=(",", ":"))}],
        "isError": False,
    }


def migrations(names: tuple[str, ...]) -> list[dict[str, str]]:
    return [
        {"version": f"20260711{index:06d}", "name": name}
        for index, name in enumerate(names, 1)
    ]


def browser_safe() -> dict[str, object]:
    return {
        "reportSections": 6,
        "confirmedRendered": True,
        "notConfirmedRendered": True,
        "timestampSeekVerified": True,
        "refreshStable": True,
        "capturedArtifacts": 0,
        "resultHmac": HMAC_A,
    }


def browser_payload() -> dict[str, object]:
    return {
        "schemaVersion": "protected-browser-attestation.v1",
        "operation": "ui_probe",
        "resultHmac": HMAC_A,
        "success": True,
        "booleanCount": 3,
        "boundedCount": 2,
        "capturedArtifacts": 0,
    }


class LiveCoordinatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        os.chmod(self.temporary.name, 0o700)
        self.repository = tempfile.TemporaryDirectory()
        self.state = secure_state.initialize_private_state(
            self.temporary.name,
            "run-offline-coordinator",
            repository_roots=(self.repository.name,),
        )

    def tearDown(self) -> None:
        self.state.close()
        self.repository.cleanup()
        self.temporary.cleanup()

    def seed_development_target(self) -> live_coordinator.LiveCoordinator:
        chain = secure_state.McpAttestationChain(self.state.file_fd("mcp-attestations"))
        first = chain.append(
            mcp_payload(
                "list_projects",
                response_hmac=HMAC_B,
                precondition_hmac=HMAC_A,
                postcondition_hmac=HMAC_A,
            )
        )
        initial = controller.ControllerState(
            phase="dev_target_verified",
            manifest_verified=True,
            production_negative_verified=True,
            manifest_digest="sha256:" + HEX,
            development_mcp_attestation_hash=first["hash"],
            development_target_hmac=HMAC_A,
            development_target_capability_hmac=HMAC_B,
            mcp_sequence=0,
            mcp_tail_hash=first["hash"],
            transition_sequence=4,
        )
        key = os.pread(self.state.file_fd("run-mac-key"), 32, 0)
        self.state.write_record_atomic("state", live_coordinator._envelope(key, initial))
        return live_coordinator.LiveCoordinator(self.state)

    def seed_ui_case(self) -> live_coordinator.LiveCoordinator:
        writer = case_evidence.CaseEvidenceWriter(self.state.file_fd("evidence"))
        for case_id in sanitizer.CASE_IDS[:-1]:
            definition = sanitizer.CASE_BY_ID[case_id]
            mode = "real" if definition["allowedModes"] == ["real"] else "scripted"
            writer.append(case_id, mode, passing_measurements(case_id))
        entries = writer.entries()
        initial = controller.ControllerState(
            phase="ui_case_running",
            next_case_index=len(sanitizer.CASE_IDS) - 1,
            completed_cases=sanitizer.CASE_IDS[:-1],
            evidence_hashes=tuple(entry["hash"] for entry in entries),
            manifest_verified=True,
            production_negative_verified=True,
            actual_gemini_observed=True,
            actual_media_observed=True,
            manifest_digest="sha256:" + HEX,
            scripted_phase_cleaned=True,
            real_phase_started=True,
            transition_sequence=50,
            provider_attestation_hmac=HMAC_B,
            media_attestation_hmac=HMAC_C,
        )
        key = os.pread(self.state.file_fd("run-mac-key"), 32, 0)
        self.state.write_record_atomic("state", live_coordinator._envelope(key, initial))
        return live_coordinator.LiveCoordinator(self.state)

    @staticmethod
    def preflight_event(
        coordinator: live_coordinator.LiveCoordinator,
        payload: dict[str, object],
    ) -> dict[str, object]:
        entry = coordinator._mcp_chain.preview((payload,))[0]
        return {
            "type": "MIGRATION_PREFLIGHT_VERIFIED",
            "ledger": controller.MIGRATION_PRE_LEDGER,
            "ledgerHmac": HMAC_D,
            "mcpEntry": entry,
        }

    def test_action_cursor_and_authenticated_state_reopen(self) -> None:
        coordinator = live_coordinator.LiveCoordinator(self.state)
        self.assertEqual(coordinator.action()["action"], "verify_offline_foundation")
        coordinator.apply_event({
            "type": "OFFLINE_FOUNDATION_VERIFIED",
            "manifestVerified": True,
            "manifestDigest": HEX,
            "sanitizerSelfTestPassed": True,
        })
        self.assertEqual(coordinator.state.phase, "offline_verified")
        self.assertEqual(coordinator.action()["action"], "initialize_private_state")

        reopened = live_coordinator.LiveCoordinator(self.state)
        self.assertEqual(reopened.state, coordinator.state)
        record = secure_state.read_private_record(self.state.file_fd("state"))
        self.assertEqual(
            set(record),
            {"schemaVersion", "controller", "pendingOperation", "stateMac"},
        )
        self.assertEqual(record["schemaVersion"], "protected-live-coordinator.v2")

    def test_case_commit_recovers_crash_after_evidence_fsync(self) -> None:
        initial = controller.ControllerState(
            phase="scripted_cases_running",
            manifest_verified=True,
            production_negative_verified=True,
            manifest_digest="sha256:" + HEX,
            migration_attestation_hashes=(HEX, "b" * 64),
            transition_sequence=30,
        )
        key = os.pread(self.state.file_fd("run-mac-key"), 32, 0)
        self.state.write_record_atomic("state", live_coordinator._envelope(key, initial))
        coordinator = live_coordinator.LiveCoordinator(self.state)
        original = coordinator._writer.append

        def crash_after_append(case_id, mode, measurements):
            original(case_id, mode, measurements)
            raise OSError("offline crash")

        coordinator._writer.append = crash_after_append
        case_id = sanitizer.CASE_IDS[0]
        with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
            coordinator.record_case(case_id, "scripted", passing_measurements(case_id))

        recovered = live_coordinator.LiveCoordinator(self.state)
        self.assertEqual(recovered.state.next_case_index, 1)
        self.assertEqual(recovered.state.completed_cases, (case_id,))
        self.assertEqual(recovered.action()["caseId"], sanitizer.CASE_IDS[1])
        self.assertEqual(len(case_evidence.CaseEvidenceWriter(self.state.file_fd("evidence")).entries()), 1)

    def test_tampered_state_and_non_case_bypass_fail_closed(self) -> None:
        coordinator = live_coordinator.LiveCoordinator(self.state)
        with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
            coordinator.apply_event({"type": "CASE_RECORDED"})

        record = secure_state.read_private_record(self.state.file_fd("state"))
        record["stateMac"] = "hmac-sha256:" + "f" * 64
        encoded = (json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
        fd = self.state.file_fd("state")
        os.ftruncate(fd, 0)
        os.pwrite(fd, encoded, 0)
        os.fsync(fd)
        with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
            live_coordinator.LiveCoordinator(self.state)

    def test_mcp_chain_transition_commits_controller_and_chain_together(self) -> None:
        coordinator = self.seed_development_target()
        payload = mcp_payload("inspect_migrations")
        event = self.preflight_event(coordinator, payload)

        next_state = coordinator.commit_chain_transition(
            "mcp", (ledger_safe(),), (payload,), event
        )

        self.assertEqual(next_state.phase, "migration_009_prepare_required")
        self.assertEqual(next_state.mcp_sequence, 1)
        self.assertEqual(
            next_state.mcp_tail_hash,
            secure_state.McpAttestationChain(
                self.state.file_fd("mcp-attestations")
            ).entries()[-1]["hash"],
        )
        record = secure_state.read_private_record(self.state.file_fd("state"))
        self.assertIsNone(record["pendingOperation"])

    def test_apply_event_rejects_chain_bearing_transition(self) -> None:
        coordinator = self.seed_development_target()
        payload = mcp_payload("inspect_migrations")
        event = self.preflight_event(coordinator, payload)

        with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
            coordinator.apply_event(event)

        self.assertEqual(coordinator.state.phase, "dev_target_verified")
        self.assertEqual(len(coordinator._mcp_chain.entries()), 1)

    def test_chain_recovery_appends_only_missing_predicted_suffix(self) -> None:
        coordinator = self.seed_development_target()
        payloads = (
            mcp_payload("inspect_migrations", response_hmac=HMAC_A, request_hash=HEX),
            mcp_payload("inspect_migrations", response_hmac=HMAC_C, request_hash=HEX_C),
            mcp_payload("inspect_migrations", response_hmac=HMAC_D, request_hash=HEX_D),
        )
        safe_results = (
            ledger_safe(HMAC_A),
            ledger_safe(HMAC_C),
            ledger_safe(HMAC_D),
        )
        preview = coordinator._mcp_chain.preview(payloads)
        synthetic_next = replace(
            coordinator.state,
            phase="migration_009_prepare_required",
            mcp_sequence=preview[-1]["sequence"],
            mcp_tail_hash=preview[-1]["hash"],
        )
        original_append = coordinator._mcp_chain.append
        append_count = 0

        def crash_on_second(payload):
            nonlocal append_count
            appended = original_append(payload)
            append_count += 1
            if append_count == 2:
                raise OSError("synthetic crash")
            return appended

        coordinator._mcp_chain.append = crash_on_second
        with mock.patch.object(controller, "transition", return_value=synthetic_next):
            with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
                coordinator.commit_chain_transition(
                    "mcp", safe_results, payloads, {"type": "SYNTHETIC"}
                )

        recovered = live_coordinator.LiveCoordinator(self.state)
        self.assertEqual(recovered.state, replace(synthetic_next, transition_sequence=5))
        self.assertEqual(tuple(recovered._mcp_chain.entries()[-3:]), preview)
        record = secure_state.read_private_record(self.state.file_fd("state"))
        self.assertIsNone(record["pendingOperation"])

    def test_chain_recovery_rejects_valid_but_divergent_prefix(self) -> None:
        coordinator = self.seed_development_target()
        payload = mcp_payload("inspect_migrations")
        event = self.preflight_event(coordinator, payload)
        coordinator._mcp_chain.append = mock.Mock(side_effect=OSError("synthetic crash"))
        with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
            coordinator.commit_chain_transition(
                "mcp", (ledger_safe(),), (payload,), event
            )

        secure_state.McpAttestationChain(
            self.state.file_fd("mcp-attestations")
        ).append(mcp_payload("inspect_migrations", response_hmac=HMAC_D))
        with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
            live_coordinator.LiveCoordinator(self.state)

    def test_authenticated_pending_chain_semantic_tamper_fails_closed(self) -> None:
        coordinator = self.seed_development_target()
        payload = mcp_payload("inspect_migrations")
        event = self.preflight_event(coordinator, payload)
        coordinator._mcp_chain.append = mock.Mock(side_effect=OSError("synthetic crash"))
        with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
            coordinator.commit_chain_transition(
                "mcp", (ledger_safe(),), (payload,), event
            )
        record = secure_state.read_private_record(self.state.file_fd("state"))
        pending = record["pendingOperation"]
        self.assertEqual(
            set(pending),
            {
                "schemaVersion", "kind", "action", "beforeControllerDigest",
                "beforeMcpCount", "beforeMcpTail", "safeResults", "entries",
                "nextController",
            },
        )
        key = os.pread(self.state.file_fd("run-mac-key"), 32, 0)
        mutations = []
        wrong_digest = json.loads(json.dumps(pending))
        wrong_digest["beforeControllerDigest"] = "sha256:" + HEX_B
        mutations.append(wrong_digest)
        wrong_count = json.loads(json.dumps(pending))
        wrong_count["beforeMcpCount"] = 0
        mutations.append(wrong_count)
        wrong_tail = json.loads(json.dumps(pending))
        wrong_tail["beforeMcpTail"] = HEX_B
        mutations.append(wrong_tail)
        wrong_sequence = json.loads(json.dumps(pending))
        wrong_sequence["nextController"]["transitionSequence"] += 1
        mutations.append(wrong_sequence)
        changed_evidence = json.loads(json.dumps(pending))
        changed_evidence["nextController"].update(
            {
                "nextCaseIndex": 1,
                "completedCases": [sanitizer.CASE_IDS[0]],
                "evidenceHashes": [HEX_B],
            }
        )
        mutations.append(changed_evidence)
        for changed in mutations:
            with self.subTest(field_count=len(changed)):
                self.state.write_record_atomic(
                    "state", live_coordinator._envelope(key, coordinator.state, changed)
                )
                with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
                    live_coordinator.LiveCoordinator(self.state)

    def test_ui_case_atomically_binds_browser_evidence_and_controller(self) -> None:
        coordinator = self.seed_ui_case()
        expected_browser = coordinator._browser_chain.preview((browser_payload(),))[0]
        state = coordinator.record_case(
            "UI-01",
            "real",
            passing_measurements("UI-01"),
            browser_result=browser_safe(),
            browser_payload=browser_payload(),
        )
        self.assertEqual(state.phase, "cleanup_pending")
        self.assertEqual(state.browser_attestation_hash, expected_browser["hash"])
        self.assertEqual(coordinator._browser_chain.entries(), (expected_browser,))
        self.assertEqual(len(coordinator._writer.entries()), len(sanitizer.CASE_IDS))

    def test_ui_case_recovers_browser_first_crash_before_evidence(self) -> None:
        coordinator = self.seed_ui_case()
        coordinator._writer.append = mock.Mock(side_effect=OSError("synthetic crash"))
        with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
            coordinator.record_case(
                "UI-01",
                "real",
                passing_measurements("UI-01"),
                browser_result=browser_safe(),
                browser_payload=browser_payload(),
            )
        self.assertEqual(len(coordinator._browser_chain.entries()), 1)
        self.assertEqual(len(coordinator._writer.entries()), len(sanitizer.CASE_IDS) - 1)

        recovered = live_coordinator.LiveCoordinator(self.state)
        self.assertEqual(recovered.state.phase, "cleanup_pending")
        self.assertEqual(len(recovered._browser_chain.entries()), 1)
        self.assertEqual(len(recovered._writer.entries()), len(sanitizer.CASE_IDS))

    def test_ui_case_recovery_rejects_evidence_before_browser_prefix(self) -> None:
        coordinator = self.seed_ui_case()
        coordinator._browser_chain.append = mock.Mock(side_effect=OSError("synthetic crash"))
        measurements = passing_measurements("UI-01")
        with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
            coordinator.record_case(
                "UI-01",
                "real",
                measurements,
                browser_result=browser_safe(),
                browser_payload=browser_payload(),
            )
        case_evidence.CaseEvidenceWriter(
            self.state.file_fd("evidence")
        ).append("UI-01", "real", measurements)
        with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
            live_coordinator.LiveCoordinator(self.state)

    def test_one_exchange_brokers_raw_then_commits_before_safe_output(self) -> None:
        coordinator = self.seed_development_target()
        raw = {
            "schemaVersion": mcp_bridge.ADAPTER_SCHEMA_VERSION,
            "step": "migration_ledger_pre",
            "targetProjectHmac": HMAC_A,
            "targetCapabilityHmac": HMAC_B,
            "callToolResult": call_tool_result(migrations(mcp_queries.MIGRATION_PRE_LEDGER)),
        }
        with (
            tempfile.TemporaryFile() as step_file,
            tempfile.TemporaryFile() as adapter_file,
            tempfile.TemporaryFile() as output_file,
        ):
            step_file.write(b"migration_ledger_pre\n")
            adapter_file.write(json.dumps(raw, separators=(",", ":")).encode("ascii"))
            step_file.seek(0)
            adapter_file.seek(0)
            original_commit = coordinator.commit_chain_transition

            def build_transition(safe):
                payload = mcp_payload(
                    "inspect_migrations", response_hmac=safe["resultHmac"]
                )
                return (payload,), self.preflight_event(coordinator, payload)

            def commit_before_output(*args, **kwargs):
                self.assertEqual(os.pread(output_file.fileno(), 4096, 0), b"")
                return original_commit(*args, **kwargs)

            with mock.patch.object(
                coordinator, "commit_chain_transition", side_effect=commit_before_output
            ):
                safe = live_coordinator.serve_mcp_exchange(
                    coordinator,
                    expected_step="migration_ledger_pre",
                    step_fd=step_file.fileno(),
                    adapter_fd=adapter_file.fileno(),
                    output_fd=output_file.fileno(),
                    transition_builder=build_transition,
                    expected_target_capability_hmac=HMAC_B,
                )
            output_file.seek(0)
            self.assertEqual(json.loads(output_file.read()), safe)
        self.assertEqual(coordinator.state.phase, "migration_009_prepare_required")

    def test_mcp_exchange_never_outputs_when_commit_fails(self) -> None:
        coordinator = self.seed_development_target()
        raw = {
            "schemaVersion": mcp_bridge.ADAPTER_SCHEMA_VERSION,
            "step": "migration_ledger_pre",
            "targetProjectHmac": HMAC_A,
            "targetCapabilityHmac": HMAC_B,
            "callToolResult": call_tool_result(migrations(mcp_queries.MIGRATION_PRE_LEDGER)),
        }
        with (
            tempfile.TemporaryFile() as step_file,
            tempfile.TemporaryFile() as adapter_file,
            tempfile.TemporaryFile() as output_file,
        ):
            step_file.write(b"migration_ledger_pre\n")
            adapter_file.write(json.dumps(raw, separators=(",", ":")).encode("ascii"))
            step_file.seek(0)
            adapter_file.seek(0)
            with mock.patch.object(
                coordinator,
                "commit_chain_transition",
                side_effect=live_coordinator.LiveCoordinatorRejected(),
            ):
                with self.assertRaises(live_coordinator.LiveCoordinatorRejected):
                    live_coordinator.serve_mcp_exchange(
                        coordinator,
                        expected_step="migration_ledger_pre",
                        step_fd=step_file.fileno(),
                        adapter_fd=adapter_file.fileno(),
                        output_fd=output_file.fileno(),
                        transition_builder=lambda _safe: ((), {}),
                        expected_target_capability_hmac=HMAC_B,
                    )
            self.assertEqual(os.pread(output_file.fileno(), 4096, 0), b"")

    def test_unknown_exchange_uses_existing_dispatch_recovery_before_output(self) -> None:
        coordinator = self.seed_development_target()
        safe = {
            "safeCode": "MCP_ACTION_UNKNOWN",
            "productionActionCount": 0,
            "targetProjectHmac": HMAC_A,
            "developmentTargetHmac": HMAC_A,
            "targetCapabilityHmac": HMAC_B,
            "permitHash": "sha256:" + HEX,
            "consumeHash": "sha256:" + HEX_B,
            "dispatchHash": "sha256:" + HEX_C,
            "payloadSha256": "sha256:" + HEX_D,
            "resultHmac": HMAC_C,
        }
        with tempfile.TemporaryFile() as output_file:
            def commit_before_output(*_args, **_kwargs):
                self.assertEqual(os.pread(output_file.fileno(), 4096, 0), b"")
                return coordinator.state

            with (
                mock.patch.object(
                    mcp_bridge,
                    "recover_pending_mutation_dispatch",
                    return_value=safe,
                ) as recovered,
                mock.patch.object(
                    coordinator,
                    "commit_chain_transition",
                    side_effect=commit_before_output,
                ),
            ):
                receipt = live_coordinator.recover_unknown_mcp_exchange(
                    coordinator,
                    step="apply_migration_009",
                    output_fd=output_file.fileno(),
                    transition_builder=lambda _safe: ((), {}),
                    mac_key_fd=self.state.file_fd("run-mac-key"),
                    permit_ledger_fd=self.state.file_fd("mutation-permits"),
                    expected_target_hmac=HMAC_A,
                    target_capability_hmac=HMAC_B,
                    consume_hash=HEX_B,
                    permit_hash=HEX,
                    payload_sha256=HEX_D,
                    case_id="DB-02",
                    idempotency_hmac=HMAC_D,
                    controller_state="migration_009_prepared",
                    controller_state_hash=HEX,
                    controller_state_sequence=5,
                )
            recovered.assert_called_once()
            output_file.seek(0)
            self.assertEqual(json.loads(output_file.read()), receipt)

    def test_offline_executable_has_no_live_default(self) -> None:
        plan = live_coordinator.offline_plan()
        self.assertEqual(plan["externalActions"], 0)
        self.assertTrue(plan["caseWritesCrashSafe"])


if __name__ == "__main__":
    unittest.main()
