from __future__ import annotations

import json
import os
import socket
import tempfile
import unittest
from pathlib import Path

from scripts.ai_pipeline_e2e import driver_cleanup_broker, secure_state
from scripts.ai_pipeline_e2e.sanitizer import canonical_json


KEY = b"driver-cleanup-broker-test-key-v1"
USER_ID = "00000000-0000-4000-8000-000000000101"
SESSION_ID = "00000000-0000-4000-8000-000000000102"
INTENT_ID = "00000000-0000-4000-8000-000000000103"


class PrivateFiles:
    def __init__(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.vault_fd = os.open(
            root / "cleanup.vault",
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC,
            0o600,
        )
        self.key_fd = os.open(
            root / "mac.key",
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC,
            0o600,
        )
        os.write(self.key_fd, KEY)
        os.fsync(self.key_fd)

    def close(self) -> None:
        os.close(self.vault_fd)
        os.close(self.key_fd)
        self.directory.cleanup()


def session_plan() -> dict[str, object]:
    return {
        "schemaVersion": "cleanup-plan.v1",
        "operation": "plan",
        "resourceAlias": "run-session-bundle",
        "locator": {
            "uploadIntentId": INTENT_ID,
            "sessionId": SESSION_ID,
            "storagePath": f"users/{USER_ID}/practice-sessions/{SESSION_ID}/take.mp4",
        },
        "outcomePolicy": ["retained", "deleted", "absent", "not_created"],
    }


def exchange(
    broker: driver_cleanup_broker.DriverCleanupBroker,
    frame: dict[str, object],
) -> dict[str, object]:
    parent, child = socket.socketpair()
    try:
        child.settimeout(1)
        child.sendall((canonical_json(frame) + "\n").encode("ascii"))
        broker.handle_once(parent)
        raw = bytearray()
        while not raw.endswith(b"\n"):
            raw.extend(child.recv(4096))
        return json.loads(raw)
    finally:
        parent.close()
        child.close()


class DriverCleanupBrokerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.files = PrivateFiles()
        self.broker = driver_cleanup_broker.DriverCleanupBroker(
            vault_fd=self.files.vault_fd,
            mac_key_fd=self.files.key_fd,
        )

    def tearDown(self) -> None:
        self.files.close()

    def test_session_bundle_plan_and_completion_are_fsynced_before_exact_acks(self) -> None:
        plan = session_plan()
        plan_ack = exchange(self.broker, plan)
        self.assertEqual(
            set(plan_ack),
            {"schemaVersion", "operation", "resourceAlias", "planReceiptHmac"},
        )
        self.assertEqual(plan_ack["schemaVersion"], "cleanup-plan-ack.v1")
        self.assertRegex(str(plan_ack["planReceiptHmac"]), r"^hmac-sha256:[a-f0-9]{64}$")
        self.assertNotIn(SESSION_ID, canonical_json(plan_ack))
        self.assertEqual(self.broker.pending_count(), 1)

        complete = {
            "schemaVersion": "cleanup-complete.v1",
            "operation": "complete",
            "resourceAlias": "run-session-bundle",
            "planReceiptHmac": plan_ack["planReceiptHmac"],
            "outcome": "deleted",
        }
        complete_ack = exchange(self.broker, complete)
        self.assertEqual(
            complete_ack,
            {
                "schemaVersion": "cleanup-complete-ack.v1",
                "operation": "complete",
                "resourceAlias": "run-session-bundle",
                "planReceiptHmac": plan_ack["planReceiptHmac"],
                "outcome": "deleted",
            },
        )
        self.assertEqual(self.broker.pending_count(), 0)
        self.broker.assert_complete()
        self.assertEqual(len(secure_state.CleanupVault(self.files.vault_fd).entries()), 2)

    def test_child_cannot_retain_session_bundle_but_parent_can_after_all_gates(self) -> None:
        plan_ack = exchange(self.broker, session_plan())
        with self.assertRaises(driver_cleanup_broker.DriverCleanupRejected):
            exchange(
                self.broker,
                {
                    "schemaVersion": "cleanup-complete.v1",
                    "operation": "complete",
                    "resourceAlias": "run-session-bundle",
                    "planReceiptHmac": plan_ack["planReceiptHmac"],
                    "outcome": "retained",
                },
            )
        self.broker.commit_single_retained(
            real_receipt_verified=True,
            ui_verified=True,
            controller_state_persisted=True,
            development_target_verified=True,
        )
        self.broker.assert_complete()

    def test_restart_and_lost_ack_retries_are_idempotent_but_conflicts_fail_closed(self) -> None:
        plan = session_plan()
        first_ack = exchange(self.broker, plan)
        self.assertEqual(exchange(self.broker, plan), first_ack)
        restarted = driver_cleanup_broker.DriverCleanupBroker(
            vault_fd=self.files.vault_fd,
            mac_key_fd=self.files.key_fd,
        )
        self.assertEqual(exchange(restarted, plan), first_ack)
        completion = {
            "schemaVersion": "cleanup-complete.v1",
            "operation": "complete",
            "resourceAlias": "run-session-bundle",
            "planReceiptHmac": first_ack["planReceiptHmac"],
            "outcome": "deleted",
        }
        first_complete = exchange(restarted, completion)
        restarted_again = driver_cleanup_broker.DriverCleanupBroker(
            vault_fd=self.files.vault_fd,
            mac_key_fd=self.files.key_fd,
        )
        self.assertEqual(exchange(restarted_again, completion), first_complete)
        conflicting = {**completion, "outcome": "retained"}
        with self.assertRaisesRegex(
            driver_cleanup_broker.DriverCleanupRejected,
            "^driver_cleanup_rejected$",
        ):
            exchange(restarted_again, conflicting)

    def test_pending_locator_is_available_only_to_descriptor_recovery(self) -> None:
        plan_ack = exchange(self.broker, session_plan())
        recovered_aliases: list[str] = []

        def recover(alias: str, locator_fd: int) -> str:
            recovered_aliases.append(alias)
            raw = os.read(locator_fd, 4096)
            locator = json.loads(raw)
            self.assertEqual(locator["sessionId"], SESSION_ID)
            self.assertEqual(locator["uploadIntentId"], INTENT_ID)
            return "absent"

        restarted = driver_cleanup_broker.DriverCleanupBroker(
            vault_fd=self.files.vault_fd,
            mac_key_fd=self.files.key_fd,
        )
        self.assertEqual(restarted.recover_pending(recover), 1)
        self.assertEqual(recovered_aliases, ["run-session-bundle"])
        self.assertEqual(restarted.pending_count(), 0)
        restarted.assert_complete()
        with tempfile.TemporaryFile() as output:
            with self.assertRaisesRegex(
                driver_cleanup_broker.DriverCleanupRejected,
                "^driver_cleanup_rejected$",
            ):
                restarted.copy_pending_locator(str(plan_ack["planReceiptHmac"]), output.fileno())

    def test_crash_after_receipt_write_recovers_pending_session_as_deleted(self) -> None:
        exchange(self.broker, session_plan())
        with tempfile.TemporaryFile() as receipt_file:
            os.fchmod(receipt_file.fileno(), 0o600)
            receipt_file.write(b'{"completed":true,"schemaVersion":"real-pipeline-receipt.v1"}\n')
            receipt_file.flush()
            os.fsync(receipt_file.fileno())

        restarted = driver_cleanup_broker.DriverCleanupBroker(
            vault_fd=self.files.vault_fd,
            mac_key_fd=self.files.key_fd,
        )
        recovered: list[str] = []

        def delete_pending(alias: str, locator_fd: int) -> str:
            self.assertEqual(alias, "run-session-bundle")
            self.assertTrue(os.read(locator_fd, 4096))
            recovered.append(alias)
            return "deleted"

        self.assertEqual(restarted.recover_pending(delete_pending), 1)
        self.assertEqual(recovered, ["run-session-bundle"])
        self.assertEqual(restarted.pending_count(), 0)
        restarted.assert_complete()
        entries = secure_state.CleanupVault(self.files.vault_fd).entries()
        self.assertEqual(entries[-1]["payload"]["outcome"], "deleted")

    def test_hostile_policy_locator_and_framing_fail_before_vault_write(self) -> None:
        cases = []
        wrong_policy = session_plan()
        wrong_policy["outcomePolicy"] = ["retained"]
        cases.append(wrong_policy)
        wrong_path = session_plan()
        wrong_path["locator"] = {
            **wrong_path["locator"],
            "storagePath": f"users/{USER_ID}/practice-sessions/{INTENT_ID}/take.mp4",
        }
        cases.append(wrong_path)
        for frame in cases:
            with self.subTest(frame=frame["outcomePolicy"]):
                with self.assertRaisesRegex(
                    driver_cleanup_broker.DriverCleanupRejected,
                    "^driver_cleanup_rejected$",
                ):
                    exchange(self.broker, frame)
        parent, child = socket.socketpair()
        try:
            child.sendall(b'{"operation":"plan","operation":"plan"}\n')
            with self.assertRaisesRegex(
                driver_cleanup_broker.DriverCleanupRejected,
                "^driver_cleanup_rejected$",
            ):
                self.broker.handle_once(parent)
        finally:
            parent.close()
            child.close()
        self.assertEqual(secure_state.CleanupVault(self.files.vault_fd).entries(), ())

    def test_temporary_account_plan_uses_closed_locator_and_outcome_contract(self) -> None:
        plan = {
            "schemaVersion": "cleanup-plan.v1",
            "operation": "plan",
            "resourceAlias": "temporary-rls-account",
            "locator": {"email": "acttub-e2e-0123456789abcdef0123456789abcdef@example.com"},
            "outcomePolicy": ["deleted", "absent", "not_created"],
        }
        plan_ack = exchange(self.broker, plan)
        complete_ack = exchange(
            self.broker,
            {
                "schemaVersion": "cleanup-complete.v1",
                "operation": "complete",
                "resourceAlias": "temporary-rls-account",
                "planReceiptHmac": plan_ack["planReceiptHmac"],
                "outcome": "deleted",
            },
        )
        self.assertEqual(complete_ack["outcome"], "deleted")
        self.broker.assert_complete()


if __name__ == "__main__":
    unittest.main()
