from __future__ import annotations

import hashlib
import json
import socket
import struct
import tempfile
import unittest

from scripts.ai_pipeline_e2e import bridge_protocol


class BridgeProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key_file = tempfile.TemporaryFile()
        self.key_file.write(hashlib.sha256(b"offline-bridge-key").digest())
        self.key_file.flush()
        self.request_id = "a" * 32
        self.nonce = "b" * 64

    def tearDown(self) -> None:
        self.key_file.close()

    def envelope(self, **overrides):
        values = {
            "kind": "request",
            "operation": "list_projects",
            "request_id": self.request_id,
            "nonce": self.nonce,
            "payload": {"bounded": True, "count": 1},
            "mac_key_fd": self.key_file.fileno(),
        }
        values.update(overrides)
        return bridge_protocol.create_envelope(**values)

    def test_round_trip_binds_payload_operation_request_and_nonce(self) -> None:
        envelope = self.envelope()
        verified = bridge_protocol.verify_envelope(
            envelope,
            mac_key_fd=self.key_file.fileno(),
            expected_kind="request",
            expected_operation="list_projects",
            seen_nonces=set(),
        )
        self.assertEqual(verified, envelope)
        for field, replacement in (
            ("operation", "list_migrations"),
            ("requestId", "c" * 32),
            ("nonce", "d" * 64),
            ("payload", {"bounded": False, "count": 1}),
        ):
            with self.subTest(field=field):
                tampered = {**envelope, field: replacement}
                with self.assertRaises(bridge_protocol.ProtocolRejected):
                    bridge_protocol.verify_envelope(tampered, mac_key_fd=self.key_file.fileno())

    def test_replay_unknown_operation_bad_key_and_bool_limits_fail_closed(self) -> None:
        envelope = self.envelope()
        seen: set[str] = set()
        bridge_protocol.verify_envelope(envelope, mac_key_fd=self.key_file.fileno(), seen_nonces=seen)
        with self.assertRaisesRegex(bridge_protocol.ProtocolRejected, "^BRIDGE_REPLAY$"):
            bridge_protocol.verify_envelope(envelope, mac_key_fd=self.key_file.fileno(), seen_nonces=seen)
        with self.assertRaisesRegex(bridge_protocol.ProtocolRejected, "^BRIDGE_OPERATION_DENIED$"):
            self.envelope(operation="arbitrary_sql")
        with self.assertRaises(bridge_protocol.ProtocolRejected):
            bridge_protocol.create_envelope(
                kind="request",
                operation="list_projects",
                request_id=self.request_id,
                nonce=self.nonce,
                payload={"bad": 1.5},
                mac_key_fd=self.key_file.fileno(),
            )
        with self.assertRaises(bridge_protocol.ProtocolRejected):
            self.envelope(mac_key_fd=0)

    def test_duplicate_key_oversize_truncation_and_bad_length_are_rejected(self) -> None:
        duplicate = b'{"schemaVersion":"x","schemaVersion":"y"}'
        left, right = socket.socketpair()
        try:
            right.sendall(struct.pack("!I", len(duplicate)) + duplicate)
            with self.assertRaises(bridge_protocol.ProtocolRejected):
                bridge_protocol.recv_frame(left)
        finally:
            left.close()
            right.close()

        left, right = socket.socketpair()
        try:
            right.sendall(struct.pack("!I", bridge_protocol.MAX_FRAME_BYTES + 1))
            with self.assertRaises(bridge_protocol.ProtocolRejected):
                bridge_protocol.recv_frame(left)
        finally:
            left.close()
            right.close()

        with self.assertRaises(bridge_protocol.ProtocolRejected):
            bridge_protocol.encode_frame("x" * (bridge_protocol.MAX_FRAME_BYTES + 1))

    def test_socket_frame_round_trip_and_safe_exception_surface(self) -> None:
        left, right = socket.socketpair()
        try:
            envelope = self.envelope()
            bridge_protocol.send_frame(left, envelope)
            self.assertEqual(bridge_protocol.recv_frame(right), envelope)
        finally:
            left.close()
            right.close()
        raw_marker = "https://invalid.example/private-token"
        malformed = json.dumps({"marker": raw_marker}).encode()
        left, right = socket.socketpair()
        try:
            right.sendall(struct.pack("!I", len(malformed)) + malformed)
            value = bridge_protocol.recv_frame(left)
            with self.assertRaises(bridge_protocol.ProtocolRejected) as captured:
                bridge_protocol.verify_envelope(value, mac_key_fd=self.key_file.fileno())
            self.assertEqual(str(captured.exception), "BRIDGE_BAD_FRAME")
            self.assertNotIn(raw_marker, str(captured.exception))
        finally:
            left.close()
            right.close()


if __name__ == "__main__":
    unittest.main()
