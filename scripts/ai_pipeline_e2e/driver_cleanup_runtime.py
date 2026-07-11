"""Parent-owned lifecycle for the real driver cleanup socket and crash recovery."""

from __future__ import annotations

import os
import socket
import stat
import threading
from collections.abc import Callable

try:
    from .driver_cleanup_broker import DriverCleanupBroker, DriverCleanupRejected
except ImportError:  # pragma: no cover - direct script import fallback
    from driver_cleanup_broker import DriverCleanupBroker, DriverCleanupRejected


class DriverCleanupRuntimeRejected(ValueError):
    def __init__(self) -> None:
        super().__init__("driver_cleanup_runtime_rejected")


def _reject() -> None:
    raise DriverCleanupRuntimeRejected()


class DriverCleanupRuntime:
    """Serve FD9 requests, then either recover every plan or retain one proven main."""

    def __init__(self, *, vault_fd: int, mac_key_fd: int) -> None:
        self._broker = DriverCleanupBroker(vault_fd=vault_fd, mac_key_fd=mac_key_fd)
        self._parent, self._child = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        self._parent.settimeout(None)
        self._child.settimeout(None)
        self._thread: threading.Thread | None = None
        self._serve_error: BaseException | None = None
        self._served = False
        self._closed = False

    def child_fd(self) -> int:
        if self._closed or self._child.fileno() < 0:
            _reject()
        info = os.fstat(self._child.fileno())
        if not stat.S_ISSOCK(info.st_mode):
            _reject()
        return self._child.fileno()

    def start(self) -> None:
        if self._closed or self._thread is not None:
            _reject()

        def serve() -> None:
            try:
                while True:
                    probe = self._parent.recv(1, socket.MSG_PEEK)
                    if probe == b"":
                        break
                    self._broker.handle_once(self._parent)
            except BaseException as error:
                self._serve_error = error
            finally:
                self._served = True

        self._thread = threading.Thread(target=serve, name="protected-driver-cleanup", daemon=True)
        self._thread.start()

    def release_child_endpoint(self) -> None:
        if self._closed or self._thread is None or self._child.fileno() < 0:
            _reject()
        self._child.close()

    def finish(self, *, timeout_seconds: float = 120.0) -> None:
        if (
            self._closed
            or self._thread is None
            or self._child.fileno() >= 0
            or not isinstance(timeout_seconds, (int, float))
            or not 0 < timeout_seconds <= 300
        ):
            _reject()
        self._thread.join(float(timeout_seconds))
        if self._thread.is_alive():
            self._parent.close()
            self._thread.join(1.0)
            _reject()
        if self._serve_error is not None:
            _reject()
        if not self._served:
            _reject()

    def recover_pending(self, handler: Callable[[str, int], str]) -> int:
        if not self._served or self._closed:
            _reject()
        try:
            return self._broker.recover_pending(handler)
        except DriverCleanupRejected:
            _reject()

    def copy_pending_locator(self, *, plan_receipt_hmac: str, output_fd: int) -> None:
        """Copy one pending locator only through a caller-owned private descriptor."""

        if not self._served or self._closed or type(output_fd) is not int or output_fd <= 2:
            _reject()
        try:
            self._broker.copy_pending_locator(plan_receipt_hmac, output_fd)
        except (DriverCleanupRejected, OSError):
            _reject()

    def commit_single_retained(
        self,
        *,
        real_receipt_verified: bool,
        ui_verified: bool,
        controller_state_persisted: bool,
        development_target_verified: bool,
    ) -> None:
        if not self._served or self._closed:
            _reject()
        try:
            self._broker.commit_single_retained(
                real_receipt_verified=real_receipt_verified,
                ui_verified=ui_verified,
                controller_state_persisted=controller_state_persisted,
                development_target_verified=development_target_verified,
            )
        except DriverCleanupRejected:
            _reject()

    def assert_complete(self) -> None:
        if not self._served or self._closed:
            _reject()
        try:
            self._broker.assert_complete()
        except DriverCleanupRejected:
            _reject()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for channel in (self._child, self._parent):
            try:
                channel.close()
            except OSError:
                pass

    def __enter__(self) -> "DriverCleanupRuntime":
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.close()
