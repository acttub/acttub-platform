from __future__ import annotations

import json
import os
import socket
import sys
import time
import unittest
from pathlib import Path

from scripts.ai_pipeline_e2e import protected_process


ROOT = Path(__file__).resolve().parents[3]


def cloexec_pipe() -> tuple[int, int]:
    read_fd, write_fd = os.pipe()
    os.set_inheritable(read_fd, False)
    os.set_inheritable(write_fd, False)
    return read_fd, write_fd


def receive_line(channel: socket.socket) -> dict[str, object]:
    raw = bytearray()
    channel.settimeout(3.0)
    while True:
        item = channel.recv(1)
        if item == b"\n":
            return json.loads(bytes(raw).decode("ascii"))
        if not item:
            raise AssertionError("receipt_missing")
        raw.extend(item)


class ProtectedProcessTests(unittest.TestCase):
    def test_fixed_fd_launch_has_clean_env_new_session_and_no_descriptor_leak(self) -> None:
        capability_read, capability_write = cloexec_pipe()
        os.write(capability_write, b"bounded-capability")
        os.close(capability_write)
        readiness_parent, readiness_child = socket.socketpair()
        receipt_parent, receipt_child = socket.socketpair()
        extra_read, extra_write = cloexec_pipe()
        os.set_inheritable(extra_read, True)
        readiness_child_fd = readiness_child.detach()
        receipt_child_fd = receipt_child.detach()
        child = None
        code = """
import json, os, socket, sys, time
extra_fd = int(sys.argv[1])
leaked = True
try:
    os.fstat(extra_fd)
except OSError:
    leaked = False
capability = os.read(0, 64).decode('ascii')
receipt = socket.socket(fileno=12)
receipt.sendall((json.dumps({
    'capability': capability,
    'cleanEnvironment': os.environ.get('LANG') == 'C' and not any(
        marker in key.upper()
        for key in os.environ
        for marker in ('API', 'SECRET', 'TOKEN', 'PASSWORD')
    ),
    'descriptorLeaked': leaked,
    'newSession': os.getsid(0) == os.getpid(),
}, ensure_ascii=True, separators=(',', ':'), sort_keys=True) + '\\n').encode('ascii'))
receipt.close()
readiness = socket.socket(fileno=11)
readiness.sendall(b'{"ready":true,"schemaVersion":"protected-process-readiness.v1"}\\n')
readiness.close()
time.sleep(60)
"""
        try:
            spec = protected_process.ProtectedProcessSpec(
                argv=(sys.executable, "-I", "-c", code, str(extra_read)),
                cwd=str(ROOT),
                fd_mappings=(
                    protected_process.FixedFdMapping(capability_read, 0, "capability"),
                    protected_process.FixedFdMapping(readiness_child_fd, 11, "readiness"),
                    protected_process.FixedFdMapping(receipt_child_fd, 12, "receipt"),
                ),
                environment={"LANG": "C"},
            )
            self.assertEqual(repr(spec), "ProtectedProcessSpec(<protected>)")
            child = protected_process.launch_protected_process(
                spec,
                readiness_parent_fd=readiness_parent.fileno(),
            )
            for consumed in (capability_read, readiness_child_fd, receipt_child_fd):
                with self.assertRaises(OSError):
                    os.fstat(consumed)
            child.wait_ready(timeout_seconds=3.0)
            self.assertEqual(
                receive_line(receipt_parent),
                {
                    "capability": "bounded-capability",
                    "cleanEnvironment": True,
                    "descriptorLeaked": False,
                    "newSession": True,
                },
            )
            child.stop(timeout_seconds=1.0)
            child.stop(timeout_seconds=1.0)
            self.assertIsNotNone(child.process.returncode)
            self.assertEqual(repr(child), "ProtectedProcess(<protected>)")
        finally:
            if child is not None:
                child.stop(timeout_seconds=1.0)
            readiness_parent.close()
            receipt_parent.close()
            for fd in (extra_read, extra_write):
                try:
                    os.close(fd)
                except OSError:
                    pass

    def _readiness_only_spec(self, child_fd: int, code: str) -> protected_process.ProtectedProcessSpec:
        return protected_process.ProtectedProcessSpec(
            argv=(sys.executable, "-I", "-c", code),
            cwd=str(ROOT),
            fd_mappings=(protected_process.FixedFdMapping(child_fd, 11, "readiness"),),
            environment={},
        )

    def test_premature_exit_and_wrong_frame_fail_closed_without_command_details(self) -> None:
        for code in (
            "raise SystemExit(7)",
            "import os; os.write(11, b'wrong\\n'); os.close(11)",
        ):
            with self.subTest(code=code):
                parent, child_socket = socket.socketpair()
                child_fd = child_socket.detach()
                process = protected_process.launch_protected_process(
                    self._readiness_only_spec(child_fd, code),
                    readiness_parent_fd=parent.fileno(),
                )
                try:
                    with self.assertRaisesRegex(
                        protected_process.ProtectedProcessRejected,
                        "^protected_process_rejected$",
                    ) as caught:
                        process.wait_ready(timeout_seconds=2.0)
                    self.assertEqual(str(caught.exception), "protected_process_rejected")
                    self.assertIsNotNone(process.process.returncode)
                finally:
                    process.stop(timeout_seconds=1.0)
                    parent.close()

    def test_readiness_timeout_terminates_child_and_stop_is_idempotent(self) -> None:
        parent, child_socket = socket.socketpair()
        child_fd = child_socket.detach()
        process = protected_process.launch_protected_process(
            self._readiness_only_spec(child_fd, "import time; time.sleep(60)"),
            readiness_parent_fd=parent.fileno(),
        )
        started = time.monotonic()
        try:
            with self.assertRaises(protected_process.ProtectedProcessRejected):
                process.wait_ready(timeout_seconds=0.1)
            self.assertLess(time.monotonic() - started, 2.0)
            self.assertIsNotNone(process.process.returncode)
            process.stop(timeout_seconds=1.0)
        finally:
            process.stop(timeout_seconds=1.0)
            parent.close()

    def test_malicious_environment_and_descriptor_types_are_rejected_before_spawn(self) -> None:
        parent, child_socket = socket.socketpair()
        child_fd = child_socket.detach()
        try:
            spec = protected_process.ProtectedProcessSpec(
                argv=(sys.executable, "-I", "-c", "raise SystemExit(0)"),
                cwd=str(ROOT),
                fd_mappings=(protected_process.FixedFdMapping(child_fd, 11, "readiness"),),
                environment={"GEMINI_API_KEY": "must-not-cross"},
            )
            with self.assertRaisesRegex(
                protected_process.ProtectedProcessRejected,
                "^protected_process_rejected$",
            ):
                protected_process.launch_protected_process(spec, readiness_parent_fd=parent.fileno())
            os.fstat(child_fd)
        finally:
            os.close(child_fd)
            parent.close()

        regular = os.open(__file__, os.O_RDONLY | os.O_CLOEXEC)
        parent, child_socket = socket.socketpair()
        child_fd = child_socket.detach()
        try:
            spec = protected_process.ProtectedProcessSpec(
                argv=(sys.executable, "-I", "-c", "raise SystemExit(0)"),
                cwd=str(ROOT),
                fd_mappings=(protected_process.FixedFdMapping(regular, 11, "readiness"),),
                environment={},
            )
            with self.assertRaises(protected_process.ProtectedProcessRejected):
                protected_process.launch_protected_process(spec, readiness_parent_fd=parent.fileno())

            valid_spec = self._readiness_only_spec(child_fd, "raise SystemExit(0)")
            os.set_inheritable(parent.fileno(), True)
            with self.assertRaises(protected_process.ProtectedProcessRejected):
                protected_process.launch_protected_process(
                    valid_spec,
                    readiness_parent_fd=parent.fileno(),
                )
            os.fstat(child_fd)
        finally:
            os.close(regular)
            os.close(child_fd)
            parent.close()


if __name__ == "__main__":
    unittest.main()
