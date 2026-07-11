"""Parent-owned provider-event attestation and provider-file cleanup runtime."""

from __future__ import annotations

import copy
import os
import select
import socket
import stat
import tempfile
import threading
from collections.abc import Callable
from typing import Any

try:
    from .live_runner import ProviderCleanupBroker
    from .provider_attestation import MAX_PROVIDER_EVENTS_BYTES, attest_provider_events
    from .secure_state import CLEANUP_ALLOWED_OUTCOMES, CleanupVault
except ImportError:  # pragma: no cover - direct script import fallback
    from live_runner import ProviderCleanupBroker
    from provider_attestation import MAX_PROVIDER_EVENTS_BYTES, attest_provider_events
    from secure_state import CLEANUP_ALLOWED_OUTCOMES, CleanupVault

MAX_CLEANUP_CHANNELS = 8


class ProviderCleanupRuntimeRejected(ValueError):
    """A fixed-message failure that cannot expose provider locators or events."""

    def __init__(self) -> None:
        super().__init__("provider_cleanup_runtime_rejected")


def _reject() -> None:
    raise ProviderCleanupRuntimeRejected()


def _provider_plan_state(vault: CleanupVault) -> tuple[list[str], set[str]]:
    entries = vault.entries()
    plans = [
        entry["hash"]
        for entry in entries
        if entry["payload"]["kind"] == "plan"
        and entry["payload"]["resourceAlias"] == "run-provider-file"
    ]
    completed = {
        entry["payload"]["planHash"]
        for entry in entries
        if entry["payload"]["kind"] == "complete"
    }
    return plans, completed


def _cloexec_pipe() -> tuple[int, int]:
    try:
        read_fd, write_fd = os.pipe()
        os.set_inheritable(read_fd, False)
        os.set_inheritable(write_fd, False)
        return read_fd, write_fd
    except OSError:
        for fd in (locals().get("read_fd", -1), locals().get("write_fd", -1)):
            if fd >= 0:
                try:
                    os.close(fd)
                except OSError:
                    pass
        _reject()


def recover_provider_cleanup(vault_fd: int, handler: Callable[[int], str]) -> int:
    """Recover pending provider-file plans through private locator descriptors only."""

    if not callable(handler):
        _reject()
    try:
        vault = CleanupVault(vault_fd)
        plans, completed = _provider_plan_state(vault)
        recovered = 0
        allowed = CLEANUP_ALLOWED_OUTCOMES["delete_provider_file"]
        for plan_hash in plans:
            if plan_hash in completed:
                continue
            with tempfile.TemporaryFile() as locator_file:
                os.fchmod(locator_file.fileno(), 0o600)
                vault.copy_locator(plan_hash, locator_file.fileno())
                os.lseek(locator_file.fileno(), 0, os.SEEK_SET)
                outcome = handler(locator_file.fileno())
            if outcome not in allowed:
                _reject()
            vault.complete(plan_hash, outcome)
            recovered += 1
        return recovered
    except ProviderCleanupRuntimeRejected:
        raise
    except BaseException:
        _reject()


class ProviderCleanupRuntime:
    """Concurrently drain provider events and serve fsynced cleanup requests."""

    def __init__(
        self,
        *,
        vault_fd: int,
        mac_key_fd: int,
        expected_media_hmac: str,
        expected_media_byte_count: int,
        cleanup_channel_count: int = 1,
    ) -> None:
        if (
            type(cleanup_channel_count) is not int
            or not 1 <= cleanup_channel_count <= MAX_CLEANUP_CHANNELS
        ):
            _reject()
        try:
            self._vault = CleanupVault(vault_fd)
            self._broker = ProviderCleanupBroker(vault_fd=vault_fd, mac_key_fd=mac_key_fd)
            event_read, event_write = _cloexec_pipe()
            parents: list[socket.socket] = []
            children: list[socket.socket] = []
            for _index in range(cleanup_channel_count):
                parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
                parent.settimeout(1.0)
                child.settimeout(None)
                parents.append(parent)
                children.append(child)
        except BaseException:
            for channel in locals().get("parents", []):
                channel.close()
            for channel in locals().get("children", []):
                channel.close()
            for fd in (locals().get("event_read", -1), locals().get("event_write", -1)):
                if fd >= 0:
                    os.close(fd)
            _reject()
        self._mac_key_fd = mac_key_fd
        self._expected_media_hmac = expected_media_hmac
        self._expected_media_byte_count = expected_media_byte_count
        self._event_read = event_read
        self._event_write = event_write
        self._parents = parents
        self._children = children
        self._thread: threading.Thread | None = None
        self._worker_failed = False
        self._attestation: dict[str, Any] | None = None
        self._released = False
        self._closed = False
        self._finished = False

    def event_fd(self) -> int:
        if self._closed or self._released or self._event_write < 0:
            _reject()
        try:
            info = os.fstat(self._event_write)
        except OSError:
            _reject()
        if not stat.S_ISFIFO(info.st_mode):
            _reject()
        return self._event_write

    def cleanup_fd(self, index: int = 0) -> int:
        if (
            self._closed
            or self._released
            or type(index) is not int
            or not 0 <= index < len(self._children)
        ):
            _reject()
        fd = self._children[index].fileno()
        try:
            info = os.fstat(fd)
        except OSError:
            _reject()
        if fd <= 2 or not stat.S_ISSOCK(info.st_mode):
            _reject()
        return fd

    def start(self) -> None:
        if self._closed or self._thread is not None:
            _reject()

        def serve() -> None:
            channels = list(self._parents)
            event_open = True
            total = 0
            try:
                with tempfile.TemporaryFile() as event_file:
                    os.fchmod(event_file.fileno(), 0o600)
                    while channels or event_open:
                        inputs: list[int | socket.socket] = [*channels]
                        if event_open:
                            inputs.append(self._event_read)
                        ready, _, _ = select.select(inputs, [], [], 1.0)
                        if not ready:
                            continue
                        for item in ready:
                            if isinstance(item, socket.socket):
                                probe = item.recv(1, socket.MSG_PEEK)
                                if probe == b"":
                                    item.close()
                                    channels.remove(item)
                                else:
                                    self._broker.handle_once(item)
                            else:
                                chunk = os.read(self._event_read, 64 * 1024)
                                if not chunk:
                                    event_open = False
                                    os.close(self._event_read)
                                    self._event_read = -1
                                    continue
                                total += len(chunk)
                                if total > MAX_PROVIDER_EVENTS_BYTES:
                                    _reject()
                                view = memoryview(chunk)
                                while view:
                                    written = os.write(event_file.fileno(), view)
                                    if written <= 0:
                                        _reject()
                                    view = view[written:]
                    os.fsync(event_file.fileno())
                    os.lseek(event_file.fileno(), 0, os.SEEK_SET)
                    attestation = attest_provider_events(
                        input_fd=event_file.fileno(),
                        mac_key_fd=self._mac_key_fd,
                        expected_media_hmac=self._expected_media_hmac,
                        expected_media_byte_count=self._expected_media_byte_count,
                    )
                    plans, completed = _provider_plan_state(self._vault)
                    if not plans or any(plan_hash not in completed for plan_hash in plans):
                        _reject()
                    self._attestation = attestation
            except BaseException:
                self._worker_failed = True
            finally:
                for channel in channels:
                    try:
                        channel.close()
                    except OSError:
                        pass
                if self._event_read >= 0:
                    try:
                        os.close(self._event_read)
                    except OSError:
                        pass
                    self._event_read = -1

        self._thread = threading.Thread(
            target=serve,
            name="protected-provider-cleanup",
            daemon=True,
        )
        self._thread.start()

    def release_child_endpoints(self) -> None:
        if self._closed or self._released or self._thread is None:
            _reject()
        self._released = True
        for channel in self._children:
            try:
                channel.close()
            except OSError:
                pass
        if self._event_write >= 0:
            try:
                os.close(self._event_write)
            except OSError:
                pass
            self._event_write = -1

    def _abort(self) -> None:
        for channel in (*self._children, *self._parents):
            try:
                channel.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                channel.close()
            except OSError:
                pass
        for name in ("_event_write", "_event_read"):
            fd = getattr(self, name)
            if fd >= 0:
                try:
                    os.close(fd)
                except OSError:
                    pass
                setattr(self, name, -1)

    def finish(self, *, timeout_seconds: float = 120.0) -> dict[str, Any]:
        if self._finished:
            if self._attestation is None:
                _reject()
            return copy.deepcopy(self._attestation)
        if (
            self._closed
            or self._thread is None
            or not self._released
            or not isinstance(timeout_seconds, (int, float))
            or isinstance(timeout_seconds, bool)
            or not 0 < float(timeout_seconds) <= 300
        ):
            _reject()
        self._thread.join(float(timeout_seconds))
        if self._thread.is_alive():
            self._abort()
            self._thread.join(1.0)
            _reject()
        if self._worker_failed or self._attestation is None:
            _reject()
        self._finished = True
        return copy.deepcopy(self._attestation)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._abort()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(1.0)

    def __enter__(self) -> "ProviderCleanupRuntime":
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.close()


__all__ = [
    "MAX_CLEANUP_CHANNELS",
    "ProviderCleanupRuntime",
    "ProviderCleanupRuntimeRejected",
    "recover_provider_cleanup",
]
