"""Protected local process and provider-cleanup primitives for the live E2E.

Importing this module performs no filesystem, process, network, database, browser,
or provider action.  The executable surface defaults to an offline plan and the
live coordinator must receive sensitive values through already-open descriptors.
"""

from __future__ import annotations

import hashlib
import hmac
import http.client
import json
import os
import re
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from typing import Any, Mapping

try:
    from .sanitizer import canonical_json
    from .secure_state import CleanupVault
    from .service_bootstrap import ProcessPlan, subprocess_options
except ImportError:  # pragma: no cover - direct script import fallback
    sys.path.insert(0, os.path.dirname(__file__))
    from sanitizer import canonical_json
    from secure_state import CleanupVault
    from service_bootstrap import ProcessPlan, subprocess_options

MEDIA_MAC_DOMAIN = b"acttub-protected-media-content.v1\0"
MAX_MEDIA_BYTES = 8 * 1024 * 1024 * 1024
MAX_KEY_BYTES = 4096
MAX_CLEANUP_FRAME_BYTES = 4096
MAX_PROVIDER_EVENTS_BYTES = 1024 * 1024
MAX_HTTP_BODY_BYTES = 8 * 1024 * 1024
_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")
_API_PATH = re.compile(r"^/api/v1/[A-Za-z0-9_./-]{1,1000}$")
_SAFE_HEADERS = frozenset({"content-type", "cookie", "idempotency-key"})


class LiveRunnerRejected(ValueError):
    """Fixed-message protected-run rejection with no raw value interpolation."""


def _reject() -> None:
    raise LiveRunnerRejected("live_runner_rejected")


def _read_fd(fd: int, maximum: int, *, allow_fifo: bool = True) -> bytes:
    if type(fd) is not int or fd <= 2 or type(maximum) is not int or maximum < 1:
        _reject()
    try:
        info = os.fstat(fd)
        allowed = stat.S_ISREG(info.st_mode) or (allow_fifo and stat.S_ISFIFO(info.st_mode))
        if not allowed:
            _reject()
        if stat.S_ISREG(info.st_mode):
            os.lseek(fd, 0, os.SEEK_SET)
        chunks: list[bytes] = []
        total = 0
        while total <= maximum:
            chunk = os.read(fd, min(1024 * 1024, maximum + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                _reject()
        return b"".join(chunks)
    except LiveRunnerRejected:
        raise
    except (OSError, OverflowError, ValueError):
        _reject()


def _read_key(fd: int) -> bytes:
    key = _read_fd(fd, MAX_KEY_BYTES)
    if not 16 <= len(key) <= MAX_KEY_BYTES:
        _reject()
    return key


def media_attestation(media_fd: int, mac_key_fd: int) -> dict[str, Any]:
    """HMAC an inherited media descriptor without returning bytes or a path."""

    key = _read_key(mac_key_fd)
    if type(media_fd) is not int or media_fd <= 2:
        _reject()
    try:
        info = os.fstat(media_fd)
        if not stat.S_ISREG(info.st_mode):
            _reject()
        os.lseek(media_fd, 0, os.SEEK_SET)
        digest = hmac.new(key, MEDIA_MAC_DOMAIN, hashlib.sha256)
        byte_count = 0
        while byte_count <= MAX_MEDIA_BYTES:
            chunk = os.read(media_fd, min(1024 * 1024, MAX_MEDIA_BYTES + 1 - byte_count))
            if not chunk:
                break
            digest.update(chunk)
            byte_count += len(chunk)
            if byte_count > MAX_MEDIA_BYTES:
                _reject()
        os.lseek(media_fd, 0, os.SEEK_SET)
    except LiveRunnerRejected:
        raise
    except (OSError, OverflowError, ValueError):
        _reject()
    if byte_count == 0:
        _reject()
    return {
        "mediaReadFromFd": True,
        "mediaByteCount": byte_count,
        "mediaContentHmac": "hmac-sha256:" + digest.hexdigest(),
    }


def drain_provider_events(source_fd: int, destination_fd: int) -> int:
    """Copy a bounded complete event stream from an anonymous pipe to private state."""

    raw = _read_fd(source_fd, MAX_PROVIDER_EVENTS_BYTES)
    if not raw or not raw.endswith(b"\n"):
        _reject()
    try:
        info = os.fstat(destination_fd)
        if (
            type(destination_fd) is not int
            or destination_fd <= 2
            or not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_nlink != 1
        ):
            _reject()
        os.lseek(destination_fd, 0, os.SEEK_SET)
        if os.read(destination_fd, 1):
            _reject()
        os.lseek(destination_fd, 0, os.SEEK_SET)
        view = memoryview(raw)
        while view:
            written = os.write(destination_fd, view)
            if written <= 0:
                _reject()
            view = view[written:]
        os.fsync(destination_fd)
        os.lseek(destination_fd, 0, os.SEEK_SET)
    except LiveRunnerRejected:
        raise
    except (OSError, OverflowError, ValueError):
        _reject()
    return raw.count(b"\n")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _reject()
        result[key] = value
    return result


def _recv_exact(channel: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while total < size:
        chunk = channel.recv(size - total)
        if not chunk:
            _reject()
        chunks.append(chunk)
        total += len(chunk)
    return b"".join(chunks)


def _recv_cleanup_frame(channel: socket.socket) -> dict[str, str]:
    try:
        size = struct.unpack("!I", _recv_exact(channel, 4))[0]
        if not 1 <= size <= MAX_CLEANUP_FRAME_BYTES:
            _reject()
        raw = _recv_exact(channel, size)
        if raw.decode("utf-8").encode("utf-8") != raw:
            _reject()
        value = json.loads(raw, object_pairs_hook=_unique_object)
    except LiveRunnerRejected:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, OSError, struct.error, ValueError):
        _reject()
    if not isinstance(value, dict) or set(value) != {"kind", "locator"}:
        _reject()
    if value["kind"] not in {"plan", "complete"}:
        _reject()
    locator = value["locator"]
    if (
        not isinstance(locator, str)
        or not 1 <= len(locator.encode("utf-8")) <= MAX_CLEANUP_FRAME_BYTES
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in locator)
    ):
        _reject()
    return {"kind": value["kind"], "locator": locator}


def _send_cleanup_ack(channel: socket.socket) -> None:
    encoded = b'{"ok":true}'
    channel.sendall(struct.pack("!I", len(encoded)) + encoded)


class ProviderCleanupBroker:
    """Fsync provider-file cleanup plans before acknowledging the child proxy."""

    def __init__(self, *, vault_fd: int, mac_key_fd: int) -> None:
        self._vault = CleanupVault(vault_fd)
        self._key = _read_key(mac_key_fd)
        self._planned: dict[str, str] = {}
        self._completed: set[str] = set()
        for entry in self._vault.entries():
            payload = entry["payload"]
            if payload["kind"] == "plan" and payload["resourceAlias"] == "run-provider-file":
                self._planned[payload["locatorHmac"]] = entry["hash"]
            elif payload["kind"] == "complete":
                self._completed.add(payload["planHash"])

    def _locator_hmac(self, locator: bytes) -> str:
        return "hmac-sha256:" + hmac.new(self._key, locator, hashlib.sha256).hexdigest()

    def _plan(self, locator: bytes) -> None:
        locator_hmac = self._locator_hmac(locator)
        existing = self._planned.get(locator_hmac)
        if existing is not None:
            if existing in self._completed:
                _reject()
            return
        with tempfile.TemporaryFile() as locator_file, tempfile.TemporaryFile() as key_file:
            locator_file.write(locator)
            key_file.write(self._key)
            locator_file.flush()
            key_file.flush()
            plan_hash = self._vault.plan(
                resource_alias="run-provider-file",
                resource_kind="provider_file",
                action="delete_provider_file",
                locator_hmac=locator_hmac,
                locator_fd=locator_file.fileno(),
                hmac_key_fd=key_file.fileno(),
            )
        self._planned[locator_hmac] = plan_hash

    def _complete(self, locator: bytes) -> None:
        plan_hash = self._planned.get(self._locator_hmac(locator))
        if plan_hash is None:
            _reject()
        if plan_hash not in self._completed:
            self._vault.complete(plan_hash, "deleted")
            self._completed.add(plan_hash)

    def handle_once(self, channel: socket.socket) -> None:
        if not isinstance(channel, socket.socket) or not stat.S_ISSOCK(os.fstat(channel.fileno()).st_mode):
            _reject()
        frame = _recv_cleanup_frame(channel)
        locator = frame["locator"].encode("utf-8")
        if frame["kind"] == "plan":
            self._plan(locator)
        else:
            self._complete(locator)
        _send_cleanup_ack(channel)

    def assert_complete(self) -> None:
        self._vault.assert_complete()


@dataclass
class ManagedProcess:
    """A child process that is always terminated as its own process group."""

    process: subprocess.Popen[bytes]

    def stop(self, timeout_seconds: float = 10.0) -> None:
        if self.process.poll() is not None:
            return
        try:
            os.killpg(self.process.pid, signal.SIGTERM)
            self.process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            os.killpg(self.process.pid, signal.SIGKILL)
            self.process.wait(timeout=timeout_seconds)
        except ProcessLookupError:
            self.process.wait(timeout=timeout_seconds)

    def __enter__(self) -> "ManagedProcess":
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.stop()


def start_managed_process(plan: ProcessPlan, *, cwd: str, environment: Mapping[str, str]) -> ManagedProcess:
    """Launch an already-validated plan with no captured output or inherited group."""

    if not isinstance(cwd, str) or not os.path.isabs(cwd):
        _reject()
    try:
        info = os.stat(cwd, follow_symlinks=False)
        if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o022:
            _reject()
        options = subprocess_options(plan, environment)
        process = subprocess.Popen(cwd=cwd, start_new_session=True, **options)
    except LiveRunnerRejected:
        raise
    except (OSError, TypeError, ValueError):
        _reject()
    return ManagedProcess(process=process)


def _validate_loopback_port(port: Any) -> int:
    if type(port) is not int or not 1024 <= port <= 65535:
        _reject()
    return port


def request_loopback_json(
    *,
    port: int,
    method: str,
    path: str,
    payload: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
    timeout_seconds: float = 60.0,
) -> tuple[int, Any]:
    """Make one bounded in-memory platform API call; never persist response bodies."""

    port = _validate_loopback_port(port)
    if method not in {"GET", "POST", "PATCH", "DELETE"} or not isinstance(path, str) or _API_PATH.fullmatch(path) is None:
        _reject()
    if not isinstance(timeout_seconds, (int, float)) or not 0 < timeout_seconds <= 300:
        _reject()
    normalized_headers: dict[str, str] = {}
    for key, value in (headers or {}).items():
        lowered = key.casefold()
        if lowered not in _SAFE_HEADERS or not isinstance(value, str) or not value or "\n" in value or "\r" in value:
            _reject()
        normalized_headers[lowered] = value
    body = None
    if payload is not None:
        try:
            body = canonical_json(dict(payload)).encode("utf-8")
        except (TypeError, ValueError, UnicodeEncodeError):
            _reject()
        if len(body) > MAX_HTTP_BODY_BYTES:
            _reject()
        normalized_headers["content-type"] = "application/json"
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=float(timeout_seconds))
    try:
        connection.request(method, path, body=body, headers=normalized_headers)
        response = connection.getresponse()
        content_length = response.getheader("content-length")
        if content_length is not None and (not content_length.isdigit() or int(content_length) > MAX_HTTP_BODY_BYTES):
            _reject()
        raw = response.read(MAX_HTTP_BODY_BYTES + 1)
        if len(raw) > MAX_HTTP_BODY_BYTES:
            _reject()
        value = None if not raw else json.loads(raw, object_pairs_hook=_unique_object)
        return response.status, value
    except LiveRunnerRejected:
        raise
    except (OSError, TimeoutError, http.client.HTTPException, json.JSONDecodeError, UnicodeDecodeError, ValueError):
        _reject()
    finally:
        connection.close()


def wait_for_loopback_health(port: int, *, timeout_seconds: float = 30.0) -> None:
    port = _validate_loopback_port(port)
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1.0)
        try:
            connection.request("GET", "/health")
            response = connection.getresponse()
            response.read(64 * 1024)
            if response.status == 200:
                return
        except (OSError, TimeoutError, http.client.HTTPException):
            pass
        finally:
            connection.close()
        time.sleep(0.05)
    _reject()


def offline_plan() -> dict[str, Any]:
    """Return only fixed facts; this is the default executable behavior."""

    return {
        "schemaVersion": "protected-live-runner-plan.v1",
        "externalActions": 0,
        "productionActions": 0,
        "sensitiveInputs": "fd-only",
        "childOutputs": "discarded",
        "providerCleanupAck": "after-fsync",
        "browserArtifacts": 0,
    }


def _main(argv: list[str]) -> int:
    if argv != ["--dry-run"]:
        return 64
    sys.stdout.write(canonical_json(offline_plan()) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
