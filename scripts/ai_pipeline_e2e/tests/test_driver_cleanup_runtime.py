from __future__ import annotations

import json
import os
import socket
import tempfile
import unittest

from scripts.ai_pipeline_e2e import driver_cleanup_runtime, secure_state


KEY = b"R" * 32
SESSION_LOCATOR = {
    "uploadIntentId": "10000000-0000-4000-8000-000000000001",
    "sessionId": "20000000-0000-4000-8000-000000000002",
    "storagePath": "users/30000000-0000-4000-8000-000000000003/practice-sessions/20000000-0000-4000-8000-000000000002/take.mp4",
}


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n").encode("ascii")


def receive(channel: socket.socket) -> dict[str, object]:
    raw = bytearray()
    while True:
        item = channel.recv(1)
        if item == b"\n":
            return json.loads(bytes(raw).decode("ascii"))
        if not item:
            raise AssertionError("cleanup_ack_missing")
        raw.extend(item)


class PrivateFiles:
    def __init__(self) -> None:
        self.root = tempfile.TemporaryDirectory(prefix="protected-cleanup-runtime-")
        self.vault_fd = os.open(os.path.join(self.root.name, "vault"), os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o600)
        self.key_fd = os.open(os.path.join(self.root.name, "key"), os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o600)
        os.write(self.key_fd, KEY)
        os.fsync(self.key_fd)

    def close(self) -> None:
        os.close(self.vault_fd)
        os.close(self.key_fd)
        self.root.cleanup()


class DriverCleanupRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.files = PrivateFiles()

    def tearDown(self) -> None:
        self.files.close()

    def runtime_and_child(self) -> tuple[driver_cleanup_runtime.DriverCleanupRuntime, socket.socket]:
        runtime = driver_cleanup_runtime.DriverCleanupRuntime(
            vault_fd=self.files.vault_fd,
            mac_key_fd=self.files.key_fd,
        )
        child = socket.socket(fileno=os.dup(runtime.child_fd()))
        runtime.start()
        runtime.release_child_endpoint()
        return runtime, child

    def plan_main(self, child: socket.socket) -> dict[str, object]:
        child.sendall(canonical({
            "schemaVersion": "cleanup-plan.v1",
            "operation": "plan",
            "resourceAlias": "run-session-bundle",
            "locator": SESSION_LOCATOR,
            "outcomePolicy": sorted(secure_state.CLEANUP_ALLOWED_OUTCOMES["reconcile_session_bundle"]),
        }))
        return receive(child)

    def test_parent_commits_only_one_fully_verified_retained_session(self) -> None:
        runtime, child = self.runtime_and_child()
        try:
            self.plan_main(child)
            child.close()
            runtime.finish(timeout_seconds=2)
            with self.assertRaises(driver_cleanup_runtime.DriverCleanupRuntimeRejected):
                runtime.commit_single_retained(
                    real_receipt_verified=True,
                    ui_verified=False,
                    controller_state_persisted=True,
                    development_target_verified=True,
                )
            runtime.commit_single_retained(
                real_receipt_verified=True,
                ui_verified=True,
                controller_state_persisted=True,
                development_target_verified=True,
            )
            runtime.assert_complete()
        finally:
            runtime.close()

    def test_crash_recovery_receives_locator_only_by_private_fd_and_cannot_retain(self) -> None:
        runtime, child = self.runtime_and_child()
        seen: list[dict[str, object]] = []
        try:
            self.plan_main(child)
            child.close()
            runtime.finish(timeout_seconds=2)

            def recover(alias: str, locator_fd: int) -> str:
                self.assertEqual(alias, "run-session-bundle")
                raw = os.read(locator_fd, 16 * 1024)
                seen.append(json.loads(raw.decode("ascii")))
                return "deleted"

            self.assertEqual(runtime.recover_pending(recover), 1)
            self.assertEqual(seen, [SESSION_LOCATOR])
            runtime.assert_complete()
        finally:
            runtime.close()

    def test_recovery_rejects_retained_outcome(self) -> None:
        runtime, child = self.runtime_and_child()
        try:
            self.plan_main(child)
            child.close()
            runtime.finish(timeout_seconds=2)
            with self.assertRaises(driver_cleanup_runtime.DriverCleanupRuntimeRejected):
                runtime.recover_pending(lambda _alias, _locator_fd: "retained")
        finally:
            runtime.close()


if __name__ == "__main__":
    unittest.main()
