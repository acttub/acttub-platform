from __future__ import annotations

import hashlib
import hmac
import json
import os
import socket
import struct
import tempfile
import time
import unittest

from scripts.ai_pipeline_e2e import provider_attestation, provider_cleanup_runtime, secure_state


KEY = hashlib.sha256(b"offline-provider-cleanup-runtime-key").digest()
MEDIA_BYTE_COUNT = 913
MEDIA_HMAC = "hmac-sha256:" + hmac.new(KEY, b"offline-media", hashlib.sha256).hexdigest()
LOCATOR = "files/offline-provider-object"


def hmac_value(value: bytes) -> str:
    return "hmac-sha256:" + hmac.new(KEY, value, hashlib.sha256).hexdigest()


def event(
    service: str,
    ordinal: int,
    operation: str,
    *,
    media_hmac: str | None = None,
    media_byte_count: int = 0,
) -> dict[str, object]:
    label = f"{service}:{ordinal}:{operation}".encode("ascii")
    return {
        "schemaVersion": provider_attestation.EVENT_SCHEMA,
        "service": service,
        "ordinal": ordinal,
        "operation": operation,
        "success": True,
        "requestHmac": hmac_value(b"request:" + label),
        "responseHmac": hmac_value(b"response:" + label),
        "mediaHmac": media_hmac,
        "mediaByteCount": media_byte_count,
    }


def valid_event_stream() -> bytes:
    events = [
        event("summary", 0, "files_upload", media_hmac=MEDIA_HMAC, media_byte_count=MEDIA_BYTE_COUNT),
        event("agent", 0, "generate_content"),
        event("summary", 1, "files_get"),
        event("report", 0, "generate_content"),
        event("summary", 2, "generate_content"),
        event("summary", 3, "files_delete"),
    ]
    return b"".join(
        json.dumps(item, ensure_ascii=True, allow_nan=False, separators=(",", ":"), sort_keys=True).encode(
            "ascii"
        )
        + b"\n"
        for item in events
    )


def cleanup_frame(kind: str, locator: str = LOCATOR) -> bytes:
    encoded = json.dumps(
        {"kind": kind, "locator": locator},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return struct.pack("!I", len(encoded)) + encoded


def receive_ack(channel: socket.socket) -> dict[str, object]:
    channel.settimeout(2.0)
    size = struct.unpack("!I", channel.recv(4))[0]
    raw = bytearray()
    while len(raw) < size:
        chunk = channel.recv(size - len(raw))
        if not chunk:
            raise AssertionError("cleanup_ack_missing")
        raw.extend(chunk)
    return json.loads(bytes(raw).decode("ascii"))


class PrivateFiles:
    def __init__(self) -> None:
        self.root = tempfile.TemporaryDirectory(prefix="protected-provider-runtime-")
        os.chmod(self.root.name, 0o700)
        self.vault_fd = os.open(
            os.path.join(self.root.name, "vault"),
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC,
            0o600,
        )
        self.key_fd = os.open(
            os.path.join(self.root.name, "key"),
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC,
            0o600,
        )
        os.write(self.key_fd, KEY)
        os.fsync(self.key_fd)

    def close(self) -> None:
        os.close(self.vault_fd)
        os.close(self.key_fd)
        self.root.cleanup()


class ProviderCleanupRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.files = PrivateFiles()

    def tearDown(self) -> None:
        self.files.close()

    def runtime(self, *, channels: int = 1) -> provider_cleanup_runtime.ProviderCleanupRuntime:
        return provider_cleanup_runtime.ProviderCleanupRuntime(
            vault_fd=self.files.vault_fd,
            mac_key_fd=self.files.key_fd,
            expected_media_hmac=MEDIA_HMAC,
            expected_media_byte_count=MEDIA_BYTE_COUNT,
            cleanup_channel_count=channels,
        )

    @staticmethod
    def duplicate_cleanup(runtime: provider_cleanup_runtime.ProviderCleanupRuntime, index: int = 0) -> socket.socket:
        return socket.socket(fileno=os.dup(runtime.cleanup_fd(index)))

    def write_events(self, runtime: provider_cleanup_runtime.ProviderCleanupRuntime) -> None:
        raw = valid_event_stream()
        view = memoryview(raw)
        while view:
            written = os.write(runtime.event_fd(), view)
            self.assertGreater(written, 0)
            view = view[written:]

    def test_worker_drains_attests_and_idempotently_completes_provider_cleanup(self) -> None:
        runtime = self.runtime(channels=2)
        summary = self.duplicate_cleanup(runtime, 0)
        idle = self.duplicate_cleanup(runtime, 1)
        try:
            runtime.start()
            for _attempt in range(2):
                summary.sendall(cleanup_frame("plan"))
                self.assertEqual(receive_ack(summary), {"ok": True})
            for _attempt in range(2):
                summary.sendall(cleanup_frame("complete"))
                self.assertEqual(receive_ack(summary), {"ok": True})
            self.write_events(runtime)
            summary.close()
            idle.close()
            runtime.release_child_endpoints()
            first = runtime.finish(timeout_seconds=3.0)
            self.assertEqual(first["eventCount"], 6)
            self.assertEqual(first["providerCallCount"], 3)
            self.assertEqual(first["serviceEventCounts"], {"summary": 4, "agent": 1, "report": 1})
            first["eventCount"] = 999
            second = runtime.finish(timeout_seconds=3.0)
            self.assertEqual(second["eventCount"], 6)
            secure_state.CleanupVault(self.files.vault_fd).assert_complete()
        finally:
            summary.close()
            idle.close()
            runtime.close()
            runtime.close()

    def test_thread_exception_is_fixed_message_and_does_not_escape_raw_frame(self) -> None:
        runtime = self.runtime()
        child = self.duplicate_cleanup(runtime)
        try:
            runtime.start()
            child.sendall(cleanup_frame("malicious-operation", "secret-provider-locator"))
            child.close()
            runtime.release_child_endpoints()
            with self.assertRaisesRegex(
                provider_cleanup_runtime.ProviderCleanupRuntimeRejected,
                "^provider_cleanup_runtime_rejected$",
            ) as caught:
                runtime.finish(timeout_seconds=2.0)
            self.assertNotIn("secret-provider-locator", str(caught.exception))
        finally:
            child.close()
            runtime.close()

    def test_finish_timeout_aborts_worker_and_double_close_is_safe(self) -> None:
        runtime = self.runtime()
        held_child = self.duplicate_cleanup(runtime)
        runtime.start()
        runtime.release_child_endpoints()
        started = time.monotonic()
        try:
            with self.assertRaises(provider_cleanup_runtime.ProviderCleanupRuntimeRejected):
                runtime.finish(timeout_seconds=0.05)
            self.assertLess(time.monotonic() - started, 2.0)
        finally:
            held_child.close()
            runtime.close()
            runtime.close()

    def test_crash_leaves_durable_plan_for_descriptor_only_idempotent_recovery(self) -> None:
        runtime = self.runtime()
        child = self.duplicate_cleanup(runtime)
        try:
            runtime.start()
            child.sendall(cleanup_frame("plan"))
            self.assertEqual(receive_ack(child), {"ok": True})
            self.write_events(runtime)
            child.close()
            runtime.release_child_endpoints()
            with self.assertRaises(provider_cleanup_runtime.ProviderCleanupRuntimeRejected):
                runtime.finish(timeout_seconds=3.0)
        finally:
            child.close()
            runtime.close()

        seen: list[bytes] = []

        def recover(locator_fd: int) -> str:
            info = os.fstat(locator_fd)
            self.assertTrue(stat_is_private_regular(info.st_mode, info.st_uid))
            seen.append(os.read(locator_fd, 4096))
            return "deleted"

        self.assertEqual(
            provider_cleanup_runtime.recover_provider_cleanup(self.files.vault_fd, recover),
            1,
        )
        self.assertEqual(seen, [LOCATOR.encode("ascii")])
        self.assertEqual(
            provider_cleanup_runtime.recover_provider_cleanup(self.files.vault_fd, recover),
            0,
        )
        secure_state.CleanupVault(self.files.vault_fd).assert_complete()


def stat_is_private_regular(mode: int, uid: int) -> bool:
    import stat

    return stat.S_ISREG(mode) and stat.S_IMODE(mode) == 0o600 and uid == os.geteuid()


if __name__ == "__main__":
    unittest.main()
