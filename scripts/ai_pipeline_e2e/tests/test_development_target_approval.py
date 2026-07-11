from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

from scripts.ai_pipeline_e2e import (
    controller,
    development_target_approval,
    mcp_bridge,
    sanitizer,
    secure_state,
)


DEVELOPMENT_REF = "abcdefghijklmnopqrst"
ALTERNATE_REF = "tsrqponmlkjihgfedcba"
DEVELOPMENT_URL = f"https://{DEVELOPMENT_REF}.supabase.co".encode("ascii")
MANIFEST_DIGEST = "sha256:" + "a" * 64
CONTROLLER_STATE_HASH = "sha256:" + "b" * 64
CONTROLLER_STATE_SEQUENCE = 2


def project(project_ref: str) -> dict[str, object]:
    return {
        "id": project_ref,
        "organization_id": "00000000-0000-4000-8000-000000000001",
        "organization_slug": "synthetic-organization",
        "name": "synthetic-project",
        "region": "ap-northeast-2",
        "status": "ACTIVE_HEALTHY",
        "database": {
            "host": f"db.{project_ref}.supabase.co",
            "version": "15.8.1.001",
            "postgres_engine": "15",
            "release_channel": "ga",
        },
        "created_at": "2026-07-11T00:00:00.000Z",
    }


def call_tool_result(payload: object) -> bytes:
    inner = json.dumps(payload, separators=(",", ":"))
    return json.dumps(
        {"content": [{"type": "text", "text": inner}], "isError": False},
        separators=(",", ":"),
    ).encode("ascii")


def inventory_receipt(
    key_fd: int,
    target_hmac: str,
    projects: list[dict[str, object]],
) -> dict[str, object]:
    with tempfile.TemporaryFile() as input_file:
        input_file.write(call_tool_result(projects))
        input_file.flush()
        return mcp_bridge.broker_call_tool_result(
            "inventory_projects",
            expected_project_ref_hmac=target_hmac,
            input_fd=input_file.fileno(),
            mac_key_fd=key_fd,
        )


def mcp_entry(target_hmac: str, result_hmac: str) -> dict[str, object]:
    payload = {
        "schemaVersion": "protected-mcp-attestation.v2",
        "operation": "list_projects",
        "targetHmac": target_hmac,
        "permitHash": None,
        "consumeHash": None,
        "dispatchHash": None,
        "safeReceiptHmac": None,
        "requestHash": "c" * 64,
        "responseHmac": result_hmac,
        "preconditionHash": target_hmac,
        "postconditionHash": target_hmac,
        "success": True,
        "schemaValid": True,
        "developmentMatch": True,
        "productionAction": False,
        "safeCode": None,
    }
    core = {"sequence": 0, "previousHash": "0" * 64, "payload": payload}
    return {
        **core,
        "hash": hashlib.sha256(sanitizer.canonical_json(core).encode("ascii")).hexdigest(),
    }


class PrivateRun:
    def __init__(self, run_name: str = "run-target01") -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="protected-target-approval-")
        os.chmod(self.temporary.name, 0o700)
        self.run_name = run_name
        self.state = secure_state.initialize_private_state(
            self.temporary.name,
            run_name,
            repository_roots=(str(Path.cwd()),),
        )

    def pin(self) -> dict[str, object]:
        with tempfile.TemporaryFile() as target_file:
            target_file.write(DEVELOPMENT_URL)
            target_file.flush()
            return development_target_approval.pin_authorized_development_target(
                approval_fd=self.state.file_fd("development-target-approval"),
                target_url_fd=target_file.fileno(),
                mac_key_fd=self.state.file_fd("run-mac-key"),
                manifest_digest=MANIFEST_DIGEST,
                controller_state_hash=CONTROLLER_STATE_HASH,
                controller_state_sequence=CONTROLLER_STATE_SEQUENCE,
            )

    def close(self) -> None:
        self.state.close()
        self.temporary.cleanup()


class DevelopmentTargetApprovalTests(unittest.TestCase):
    def test_pin_is_immutable_mac_bound_and_contains_no_raw_target(self) -> None:
        run = PrivateRun()
        try:
            receipt = run.pin()
            self.assertTrue(receipt["approved"])
            self.assertTrue(receipt["pinnedBeforeNetwork"])
            self.assertEqual(receipt["mcpEntryCountAtPin"], 0)
            self.assertEqual(receipt["networkActionCountAtPin"], 0)
            self.assertRegex(str(receipt["targetHmac"]), r"^hmac-sha256:[a-f0-9]{64}$")
            self.assertEqual(
                receipt["targetHmac"],
                mcp_bridge.project_ref_hmac(
                    os.pread(run.state.file_fd("run-mac-key"), 32, 0),
                    DEVELOPMENT_REF,
                ),
            )
            persisted = os.pread(
                run.state.file_fd("development-target-approval"),
                os.fstat(run.state.file_fd("development-target-approval")).st_size,
                0,
            )
            self.assertNotIn(DEVELOPMENT_REF.encode("ascii"), persisted)
            self.assertNotIn(DEVELOPMENT_URL, persisted)
            self.assertNotIn(MANIFEST_DIGEST.encode("ascii"), persisted)
            self.assertNotIn(CONTROLLER_STATE_HASH.encode("ascii"), persisted)
            with self.assertRaises(development_target_approval.DevelopmentTargetApprovalRejected):
                run.pin()
        finally:
            run.close()

    def test_wrong_key_forgery_and_binding_changes_fail_closed(self) -> None:
        run = PrivateRun()
        try:
            run.pin()
            verify_args = {
                "approval_fd": run.state.file_fd("development-target-approval"),
                "mac_key_fd": run.state.file_fd("run-mac-key"),
                "expected_manifest_digest": MANIFEST_DIGEST,
                "expected_controller_state_hash": CONTROLLER_STATE_HASH,
                "expected_controller_state_sequence": CONTROLLER_STATE_SEQUENCE,
            }
            for mismatch in (
                {"expected_manifest_digest": "sha256:" + "d" * 64},
                {"expected_controller_state_hash": "sha256:" + "e" * 64},
                {"expected_controller_state_sequence": CONTROLLER_STATE_SEQUENCE + 1},
            ):
                with self.subTest(mismatch=tuple(mismatch)):
                    with self.assertRaises(
                        development_target_approval.DevelopmentTargetApprovalRejected
                    ):
                        development_target_approval.verify_development_target_approval(
                            **{**verify_args, **mismatch}
                        )

            with tempfile.TemporaryFile() as wrong_key_file:
                wrong_key_file.write(hashlib.sha256(b"wrong-run-key").digest())
                wrong_key_file.flush()
                with self.assertRaises(
                    development_target_approval.DevelopmentTargetApprovalRejected
                ):
                    development_target_approval.verify_development_target_approval(
                        **{**verify_args, "mac_key_fd": wrong_key_file.fileno()}
                    )

            approval_fd = run.state.file_fd("development-target-approval")
            record = json.loads(os.pread(approval_fd, os.fstat(approval_fd).st_size, 0))
            record["targetHmac"] = "hmac-sha256:" + "f" * 64
            encoded = (sanitizer.canonical_json(record) + "\n").encode("ascii")
            os.ftruncate(approval_fd, 0)
            os.pwrite(approval_fd, encoded, 0)
            os.fsync(approval_fd)
            with self.assertRaises(
                development_target_approval.DevelopmentTargetApprovalRejected
            ):
                development_target_approval.verify_development_target_approval(**verify_args)
        finally:
            run.close()

    def test_reopen_verifies_the_same_private_approval(self) -> None:
        run = PrivateRun("run-target02")
        try:
            pinned = run.pin()
            parent = run.temporary.name
            run.state.close()
            reopened = secure_state.reopen_private_state(
                parent,
                run.run_name,
                repository_roots=(str(Path.cwd()),),
            )
            run.state = reopened
            verified = development_target_approval.verify_development_target_approval(
                approval_fd=reopened.file_fd("development-target-approval"),
                mac_key_fd=reopened.file_fd("run-mac-key"),
                expected_manifest_digest=MANIFEST_DIGEST,
                expected_controller_state_hash=CONTROLLER_STATE_HASH,
                expected_controller_state_sequence=CONTROLLER_STATE_SEQUENCE,
            )
            self.assertEqual(verified, pinned)
        finally:
            run.close()

    def test_inventory_accepts_one_approved_target_in_any_order_and_denies_all_others(self) -> None:
        run = PrivateRun("run-target03")
        try:
            approval = run.pin()
            key_fd = run.state.file_fd("run-mac-key")
            approved = str(approval["targetHmac"])
            inventories = (
                [project(DEVELOPMENT_REF), project(ALTERNATE_REF)],
                [project(ALTERNATE_REF), project(DEVELOPMENT_REF)],
            )
            receipts = [inventory_receipt(key_fd, approved, items) for items in inventories]
            for receipt in receipts:
                self.assertTrue(receipt["developmentVerified"])
                self.assertTrue(receipt["productionNegativeVerified"])
                self.assertEqual(receipt["inventoryProjectCount"], 2)
                self.assertEqual(receipt["deniedOtherProjectCount"], 1)
                self.assertEqual(receipt["productionActionCount"], 0)
                self.assertEqual(receipt["targetProjectHmac"], approved)

            attacks = (
                [project(ALTERNATE_REF)],
                [project(DEVELOPMENT_REF), project(DEVELOPMENT_REF)],
            )
            for inventory in attacks:
                with self.subTest(size=len(inventory)):
                    with self.assertRaisesRegex(
                        mcp_bridge.BridgeRejected, "^MCP_TARGET_MISMATCH$"
                    ):
                        inventory_receipt(key_fd, approved, inventory)
        finally:
            run.close()

    def test_controller_rejects_target_swap_and_accepts_bound_inventory_receipt(self) -> None:
        run = PrivateRun("run-target04")
        try:
            approval = run.pin()
            key_fd = run.state.file_fd("run-mac-key")
            approval_fd = run.state.file_fd("development-target-approval")
            approved = str(approval["targetHmac"])
            receipt = inventory_receipt(
                key_fd,
                approved,
                [project(DEVELOPMENT_REF), project(ALTERNATE_REF)],
            )
            entry = mcp_entry(approved, str(receipt["resultHmac"]))
            proof = {
                "source": "supabase_mcp",
                "environment": "development",
                "approvalMac": approval["approvalMac"],
                "inventoryProjectHmac": receipt["targetProjectHmac"],
                "inventoryResultHmac": receipt["resultHmac"],
                "inventoryProjectCount": receipt["inventoryProjectCount"],
                "deniedOtherProjectCount": receipt["deniedOtherProjectCount"],
                "productionActionCount": receipt["productionActionCount"],
                "mcpAttestationHash": entry["hash"],
            }
            verify_args = {
                "approval_fd": approval_fd,
                "mac_key_fd": key_fd,
                "expected_manifest_digest": MANIFEST_DIGEST,
                "expected_approved_target_hmac": approved,
            }
            verified = controller.assert_development_target(proof, (entry,), **verify_args)
            self.assertTrue(verified["developmentVerified"])
            self.assertTrue(verified["productionNegativeVerified"])

            alternate_hmac = mcp_bridge.project_ref_hmac(
                os.pread(key_fd, 32, 0), ALTERNATE_REF
            )
            swapped_receipt = inventory_receipt(
                key_fd,
                alternate_hmac,
                [project(DEVELOPMENT_REF), project(ALTERNATE_REF)],
            )
            swapped_entry = mcp_entry(
                alternate_hmac, str(swapped_receipt["resultHmac"])
            )
            swapped_proof = {
                **proof,
                "inventoryProjectHmac": alternate_hmac,
                "inventoryResultHmac": swapped_receipt["resultHmac"],
                "mcpAttestationHash": swapped_entry["hash"],
            }
            with self.assertRaisesRegex(ValueError, "^development_target_not_proven$"):
                controller.assert_development_target(
                    swapped_proof, (swapped_entry,), **verify_args
                )
            with self.assertRaisesRegex(ValueError, "^development_target_not_proven$"):
                controller.assert_development_target(
                    {**proof, "approvalMac": "hmac-sha256:" + "0" * 64},
                    (entry,),
                    **verify_args,
                )
        finally:
            run.close()

    def test_controller_transition_verifies_the_private_approval_before_target_state(self) -> None:
        run = PrivateRun("run-target05")
        try:
            state = controller.ControllerState(
                phase="private_state_ready",
                manifest_verified=True,
                manifest_digest=MANIFEST_DIGEST,
                transition_sequence=CONTROLLER_STATE_SEQUENCE,
            )
            with tempfile.TemporaryFile() as target_file:
                target_file.write(DEVELOPMENT_URL)
                target_file.flush()
                approval = development_target_approval.pin_authorized_development_target(
                    approval_fd=run.state.file_fd("development-target-approval"),
                    target_url_fd=target_file.fileno(),
                    mac_key_fd=run.state.file_fd("run-mac-key"),
                    manifest_digest=MANIFEST_DIGEST,
                    controller_state_hash=controller.controller_state_digest(state),
                    controller_state_sequence=CONTROLLER_STATE_SEQUENCE,
                )
            receipt = inventory_receipt(
                run.state.file_fd("run-mac-key"),
                str(approval["targetHmac"]),
                [project(DEVELOPMENT_REF), project(ALTERNATE_REF)],
            )
            entry = mcp_entry(
                str(approval["targetHmac"]), str(receipt["resultHmac"])
            )
            proof = {
                "source": "supabase_mcp",
                "environment": "development",
                "approvalMac": approval["approvalMac"],
                "inventoryProjectHmac": receipt["targetProjectHmac"],
                "inventoryResultHmac": receipt["resultHmac"],
                "inventoryProjectCount": receipt["inventoryProjectCount"],
                "deniedOtherProjectCount": receipt["deniedOtherProjectCount"],
                "productionActionCount": receipt["productionActionCount"],
                "mcpAttestationHash": entry["hash"],
            }
            inventory_event = {
                "type": "DEV_TARGET_VERIFIED",
                "proof": proof,
                "mcpEntries": (entry,),
                "approvalFd": run.state.file_fd("development-target-approval"),
                "macKeyFd": run.state.file_fd("run-mac-key"),
            }
            with self.assertRaises((TypeError, ValueError)):
                controller.transition(state, inventory_event)
            approved_state = controller.transition(
                state,
                {
                    "type": "DEV_TARGET_APPROVED",
                    "approvalFd": run.state.file_fd("development-target-approval"),
                    "macKeyFd": run.state.file_fd("run-mac-key"),
                },
            )
            self.assertEqual(approved_state.phase, "dev_target_approved")
            self.assertFalse(approved_state.production_negative_verified)
            self.assertEqual(approved_state.development_target_hmac, approval["targetHmac"])
            self.assertEqual(
                controller.restore_controller_state(
                    controller.controller_state_record(approved_state)
                ),
                approved_state,
            )
            verified = controller.transition(
                approved_state,
                inventory_event,
            )
            self.assertEqual(verified.phase, "dev_target_verified")
            self.assertTrue(verified.production_negative_verified)
            self.assertEqual(verified.development_target_hmac, approval["targetHmac"])
        finally:
            run.close()


if __name__ == "__main__":
    unittest.main()
