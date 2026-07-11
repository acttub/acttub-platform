from __future__ import annotations

import hashlib
import hmac
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from scripts.ai_pipeline_e2e import live_runner, secure_state


class LiveRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = hashlib.sha256(b"offline-live-runner-key").digest()

    @staticmethod
    def _frame(value: object) -> bytes:
        encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")
        return struct.pack("!I", len(encoded)) + encoded

    @staticmethod
    def _ack(channel: socket.socket) -> object:
        size = struct.unpack("!I", channel.recv(4))[0]
        return json.loads(channel.recv(size))

    def test_default_cli_is_dry_run_only_and_import_has_no_side_effect(self) -> None:
        source = Path(live_runner.__file__).read_text(encoding="utf-8")
        self.assertNotIn("requests.", source)
        self.assertNotIn("playwright", source.casefold())
        self.assertEqual(live_runner.offline_plan()["externalActions"], 0)
        completed = subprocess.run(
            [sys.executable, "-I", live_runner.__file__, "--dry-run"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={"PATH": os.defpath, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, b"")
        self.assertEqual(json.loads(completed.stdout)["productionActions"], 0)
        rejected = subprocess.run(
            [sys.executable, "-I", live_runner.__file__, "--live"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={"PATH": os.defpath, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.assertEqual(rejected.returncode, 64)
        self.assertEqual(rejected.stdout, b"")
        self.assertEqual(rejected.stderr, b"")

    def test_media_attestation_reads_only_fd_and_matches_child_domain(self) -> None:
        content = b"offline-media-bytes"
        with tempfile.TemporaryFile() as media, tempfile.TemporaryFile() as key:
            media.write(content)
            key.write(self.key)
            media.flush()
            key.flush()
            result = live_runner.media_attestation(media.fileno(), key.fileno())
        expected = hmac.new(self.key, live_runner.MEDIA_MAC_DOMAIN + content, hashlib.sha256).hexdigest()
        self.assertEqual(result["mediaContentHmac"], "hmac-sha256:" + expected)
        self.assertEqual(result["mediaByteCount"], len(content))
        self.assertEqual(set(result), {"mediaReadFromFd", "mediaByteCount", "mediaContentHmac"})

    def test_provider_event_drain_requires_complete_bounded_stream_and_private_empty_destination(self) -> None:
        event = b'{"safe":true}\n'
        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, event)
            os.close(write_fd)
            write_fd = -1
            with tempfile.NamedTemporaryFile() as destination:
                os.chmod(destination.name, 0o600)
                self.assertEqual(live_runner.drain_provider_events(read_fd, destination.fileno()), 1)
                destination.seek(0)
                self.assertEqual(destination.read(), event)
        finally:
            os.close(read_fd)
            if write_fd >= 0:
                os.close(write_fd)

        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, event.removesuffix(b"\n"))
            os.close(write_fd)
            write_fd = -1
            with tempfile.NamedTemporaryFile() as destination:
                os.chmod(destination.name, 0o600)
                with self.assertRaises(live_runner.LiveRunnerRejected):
                    live_runner.drain_provider_events(read_fd, destination.fileno())
        finally:
            os.close(read_fd)
            if write_fd >= 0:
                os.close(write_fd)

    def test_provider_cleanup_plan_is_durable_before_ack_and_completion_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as parent:
            os.chmod(parent, 0o700)
            state = secure_state.initialize_private_state(
                parent,
                "run-provider-cleanup",
                repository_roots=(os.path.realpath(os.getcwd()),),
            )
            parent_socket, child_socket = socket.socketpair()
            try:
                with tempfile.TemporaryFile() as key:
                    key.write(self.key)
                    key.flush()
                    broker = live_runner.ProviderCleanupBroker(
                        vault_fd=state.file_fd("cleanup-vault"),
                        mac_key_fd=key.fileno(),
                    )
                child_socket.sendall(self._frame({"kind": "plan", "locator": "provider-files/offline-id"}))
                broker.handle_once(parent_socket)
                self.assertEqual(self._ack(child_socket), {"ok": True})
                entries = secure_state.CleanupVault(state.file_fd("cleanup-vault")).entries()
                self.assertEqual(len(entries), 1)
                self.assertEqual(entries[0]["payload"]["resourceAlias"], "run-provider-file")
                child_socket.sendall(self._frame({"kind": "plan", "locator": "provider-files/offline-id"}))
                broker.handle_once(parent_socket)
                self.assertEqual(self._ack(child_socket), {"ok": True})
                self.assertEqual(len(secure_state.CleanupVault(state.file_fd("cleanup-vault")).entries()), 1)
                child_socket.sendall(self._frame({"kind": "complete", "locator": "provider-files/offline-id"}))
                broker.handle_once(parent_socket)
                self.assertEqual(self._ack(child_socket), {"ok": True})
                child_socket.sendall(self._frame({"kind": "complete", "locator": "provider-files/offline-id"}))
                broker.handle_once(parent_socket)
                self.assertEqual(self._ack(child_socket), {"ok": True})
                broker.assert_complete()
            finally:
                parent_socket.close()
                child_socket.close()
                state.close()

    def test_cleanup_broker_rejects_complete_before_plan_duplicate_keys_and_oversize(self) -> None:
        with tempfile.TemporaryDirectory() as parent:
            os.chmod(parent, 0o700)
            state = secure_state.initialize_private_state(
                parent,
                "run-provider-hostile",
                repository_roots=(os.path.realpath(os.getcwd()),),
            )
            try:
                with tempfile.TemporaryFile() as key:
                    key.write(self.key)
                    key.flush()
                    broker = live_runner.ProviderCleanupBroker(
                        vault_fd=state.file_fd("cleanup-vault"),
                        mac_key_fd=key.fileno(),
                    )
                duplicate = b'{"kind":"plan","kind":"complete","locator":"provider-files/id"}'
                for raw in (
                    self._frame({"kind": "complete", "locator": "provider-files/missing"}),
                    struct.pack("!I", len(duplicate)) + duplicate,
                    struct.pack("!I", live_runner.MAX_CLEANUP_FRAME_BYTES + 1),
                ):
                    with self.subTest(size=len(raw)):
                        parent_socket, child_socket = socket.socketpair()
                        try:
                            child_socket.sendall(raw)
                            with self.assertRaisesRegex(live_runner.LiveRunnerRejected, "^live_runner_rejected$"):
                                broker.handle_once(parent_socket)
                        finally:
                            parent_socket.close()
                            child_socket.close()
            finally:
                state.close()

    def test_managed_process_stops_entire_process_group(self) -> None:
        process = subprocess.Popen(
            [sys.executable, "-I", "-c", "import time; time.sleep(60)"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        managed = live_runner.ManagedProcess(process)
        managed.stop(timeout_seconds=1.0)
        self.assertIsNotNone(process.returncode)

    def test_loopback_client_bounds_headers_paths_and_response(self) -> None:
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        def serve() -> None:
            connection, _address = server.accept()
            try:
                request = connection.recv(4096)
                self.assertIn(b"GET /api/v1/probe HTTP/1.1", request)
                body = b'{"safe":true}'
                connection.sendall(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                    + str(len(body)).encode("ascii")
                    + b"\r\nConnection: close\r\n\r\n"
                    + body
                )
            finally:
                connection.close()
                server.close()

        thread = threading.Thread(target=serve)
        thread.start()
        status, body = live_runner.request_loopback_json(port=port, method="GET", path="/api/v1/probe")
        thread.join(timeout=2)
        self.assertEqual((status, body), (200, {"safe": True}))
        with self.assertRaises(live_runner.LiveRunnerRejected):
            live_runner.request_loopback_json(port=port, method="GET", path="https://external.invalid")
        with self.assertRaises(live_runner.LiveRunnerRejected):
            live_runner.request_loopback_json(
                port=port,
                method="GET",
                path="/api/v1/probe",
                headers={"authorization": "forbidden"},
            )


if __name__ == "__main__":
    unittest.main()
