"""Fail-closed child launcher with explicit fixed-descriptor capabilities.

The public launcher never places the target command in its own process argv and
never captures child output.  A tiny, silent bootstrap receives the command on
an anonymous pipe, remaps only the declared descriptors, and then ``execve``s
the target in a new session with a freshly constructed environment.
"""

from __future__ import annotations

import fcntl
import json
import os
import select
import signal
import stat
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

DEFAULT_READINESS_FRAME = b'{"ready":true,"schemaVersion":"protected-process-readiness.v1"}\n'
MAX_BOOTSTRAP_BYTES = 16 * 1024
MAX_READINESS_BYTES = 512
MAX_CHILD_FD = 255
MAX_ARGUMENTS = 256
ALLOWED_ENVIRONMENT_KEYS = frozenset(
    {
        "HOME",
        "LANG",
        "LC_ALL",
        "NO_PROXY",
        "PATH",
        "PYTHONDONTWRITEBYTECODE",
        "PYTHONUNBUFFERED",
        "PYTHONUTF8",
        "TMPDIR",
        "TZ",
        "UV_OFFLINE",
    }
)
_PURPOSES = frozenset({"capability", "readiness", "receipt"})
_BOOTSTRAP_ARGUMENT = "--protected-process-child"


class ProtectedProcessRejected(ValueError):
    """A fixed-message failure that cannot interpolate commands or secrets."""

    def __init__(self) -> None:
        super().__init__("protected_process_rejected")


def _reject() -> None:
    raise ProtectedProcessRejected()


@dataclass(frozen=True)
class FixedFdMapping:
    """Transfer one parent descriptor to one exact child descriptor number."""

    source_fd: int
    child_fd: int
    purpose: str


@dataclass(frozen=True, repr=False)
class ProtectedProcessSpec:
    """Sensitive launch inputs are deliberately omitted from ``repr``."""

    argv: tuple[str, ...] = field(repr=False)
    cwd: str = field(repr=False)
    fd_mappings: tuple[FixedFdMapping, ...] = field(repr=False)
    environment: Mapping[str, str] = field(default_factory=dict, repr=False)
    readiness_frame: bytes = field(default=DEFAULT_READINESS_FRAME, repr=False)

    def __repr__(self) -> str:
        return "ProtectedProcessSpec(<protected>)"


def _validate_environment(value: Mapping[str, str]) -> dict[str, str]:
    if not isinstance(value, Mapping) or set(value) - ALLOWED_ENVIRONMENT_KEYS:
        _reject()
    clean: dict[str, str] = {}
    for key, item in value.items():
        if (
            not isinstance(key, str)
            or not isinstance(item, str)
            or len(item.encode("utf-8")) > 4096
            or "\0" in item
            or "\r" in item
            or "\n" in item
        ):
            _reject()
        clean[key] = item
    return clean


def _validate_executable(argv: Sequence[str]) -> tuple[str, ...]:
    if not isinstance(argv, tuple) or not 1 <= len(argv) <= MAX_ARGUMENTS:
        _reject()
    if any(not isinstance(item, str) or not item or "\0" in item for item in argv):
        _reject()
    executable = argv[0]
    if not os.path.isabs(executable):
        _reject()
    try:
        resolved = os.path.realpath(executable)
        info = os.stat(resolved, follow_symlinks=False)
    except OSError:
        _reject()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid not in {0, os.geteuid()}
        or info.st_mode & 0o022
        or not info.st_mode & 0o111
    ):
        _reject()
    normalized = (resolved, *argv[1:])
    try:
        encoded = json.dumps(normalized, ensure_ascii=True, separators=(",", ":")).encode("ascii")
    except (TypeError, UnicodeEncodeError, ValueError):
        _reject()
    if len(encoded) > MAX_BOOTSTRAP_BYTES // 2:
        _reject()
    return normalized


def _validate_cwd(value: str) -> str:
    if not isinstance(value, str) or not os.path.isabs(value):
        _reject()
    try:
        resolved = os.path.realpath(value)
        info = os.stat(resolved, follow_symlinks=False)
    except OSError:
        _reject()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022:
        _reject()
    return resolved


def _fd_kind_allowed(fd: int, purpose: str) -> bool:
    try:
        mode = os.fstat(fd).st_mode
    except OSError:
        return False
    if purpose == "readiness":
        return stat.S_ISSOCK(mode) or stat.S_ISFIFO(mode)
    if purpose == "receipt":
        return stat.S_ISSOCK(mode) or stat.S_ISFIFO(mode) or stat.S_ISREG(mode)
    return stat.S_ISSOCK(mode) or stat.S_ISFIFO(mode) or stat.S_ISREG(mode)


def _validate_mappings(value: tuple[FixedFdMapping, ...]) -> tuple[FixedFdMapping, ...]:
    if not isinstance(value, tuple) or not value:
        _reject()
    source_fds: set[int] = set()
    child_fds: set[int] = set()
    readiness_count = 0
    for item in value:
        if (
            not isinstance(item, FixedFdMapping)
            or type(item.source_fd) is not int
            or item.source_fd <= 2
            or type(item.child_fd) is not int
            or not 0 <= item.child_fd <= MAX_CHILD_FD
            or item.child_fd in {1, 2}
            or (item.child_fd == 0 and item.purpose != "capability")
            or item.purpose not in _PURPOSES
            or item.source_fd in source_fds
            or item.child_fd in child_fds
            or not _fd_kind_allowed(item.source_fd, item.purpose)
        ):
            _reject()
        source_fds.add(item.source_fd)
        child_fds.add(item.child_fd)
        readiness_count += item.purpose == "readiness"
    if readiness_count != 1:
        _reject()
    return value


def _validate_readiness_parent(fd: int, mappings: tuple[FixedFdMapping, ...]) -> int:
    if type(fd) is not int or fd <= 2 or fd in {item.source_fd for item in mappings}:
        _reject()
    try:
        info = os.fstat(fd)
        flags = fcntl.fcntl(fd, fcntl.F_GETFD)
    except OSError:
        _reject()
    if not (stat.S_ISSOCK(info.st_mode) or stat.S_ISFIFO(info.st_mode)) or not flags & fcntl.FD_CLOEXEC:
        _reject()
    try:
        duplicate = os.dup(fd)
        os.set_inheritable(duplicate, False)
    except OSError:
        _reject()
    return duplicate


def _validate_readiness_frame(value: bytes) -> bytes:
    if (
        not isinstance(value, bytes)
        or not 1 <= len(value) <= MAX_READINESS_BYTES
        or not value.endswith(b"\n")
        or value.count(b"\n") != 1
        or b"\r" in value
    ):
        _reject()
    try:
        value.decode("ascii")
    except UnicodeDecodeError:
        _reject()
    return value


def _write_all(fd: int, value: bytes) -> None:
    view = memoryview(value)
    try:
        while view:
            written = os.write(fd, view)
            if written <= 0:
                _reject()
            view = view[written:]
    except OSError:
        _reject()


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


@dataclass(repr=False)
class ProtectedProcess:
    """Own one new-session child and its parent-side readiness descriptor."""

    process: subprocess.Popen[bytes] = field(repr=False)
    readiness_fd: int = field(repr=False)
    readiness_frame: bytes = field(repr=False)
    _ready: bool = field(default=False, init=False, repr=False)
    _stopped: bool = field(default=False, init=False, repr=False)

    def __repr__(self) -> str:
        return "ProtectedProcess(<protected>)"

    def _close_readiness(self) -> None:
        if self.readiness_fd >= 0:
            try:
                os.close(self.readiness_fd)
            except OSError:
                pass
            self.readiness_fd = -1

    def wait_ready(self, *, timeout_seconds: float = 30.0) -> None:
        if self._ready:
            return
        if (
            self._stopped
            or self.readiness_fd < 0
            or not isinstance(timeout_seconds, (int, float))
            or isinstance(timeout_seconds, bool)
            or not 0 < float(timeout_seconds) <= 300
        ):
            _reject()
        deadline = time.monotonic() + float(timeout_seconds)
        raw = bytearray()
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self.stop(timeout_seconds=1.0)
                    _reject()
                ready, _, _ = select.select([self.readiness_fd], [], [], min(remaining, 0.05))
                if not ready:
                    if self.process.poll() is not None:
                        self.stop(timeout_seconds=1.0)
                        _reject()
                    continue
                chunk = os.read(self.readiness_fd, MAX_READINESS_BYTES + 1 - len(raw))
                if not chunk:
                    break
                raw.extend(chunk)
                if len(raw) > MAX_READINESS_BYTES:
                    self.stop(timeout_seconds=1.0)
                    _reject()
            if bytes(raw) != self.readiness_frame or self.process.poll() is not None:
                self.stop(timeout_seconds=1.0)
                _reject()
            self._ready = True
        except ProtectedProcessRejected:
            raise
        except (OSError, OverflowError, ValueError):
            self.stop(timeout_seconds=1.0)
            _reject()
        finally:
            raw[:] = b"\0" * len(raw)
            self._close_readiness()

    def stop(self, *, timeout_seconds: float = 10.0) -> None:
        if self._stopped:
            return
        if (
            not isinstance(timeout_seconds, (int, float))
            or isinstance(timeout_seconds, bool)
            or not 0 < float(timeout_seconds) <= 60
        ):
            _reject()
        self._stopped = True
        self._close_readiness()
        if self.process.poll() is not None:
            return
        try:
            os.killpg(self.process.pid, signal.SIGTERM)
            self.process.wait(timeout=float(timeout_seconds))
        except subprocess.TimeoutExpired:
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                self.process.wait(timeout=float(timeout_seconds))
            except (subprocess.TimeoutExpired, OSError):
                _reject()
        except ProcessLookupError:
            try:
                self.process.wait(timeout=float(timeout_seconds))
            except (subprocess.TimeoutExpired, OSError):
                _reject()
        except OSError:
            _reject()

    def __enter__(self) -> "ProtectedProcess":
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.stop()


def launch_protected_process(spec: ProtectedProcessSpec, *, readiness_parent_fd: int) -> ProtectedProcess:
    """Consume mapped child endpoints and launch a silent, detached target."""

    if not isinstance(spec, ProtectedProcessSpec):
        _reject()
    argv = _validate_executable(spec.argv)
    cwd = _validate_cwd(spec.cwd)
    mappings = _validate_mappings(spec.fd_mappings)
    environment = _validate_environment(spec.environment)
    readiness_frame = _validate_readiness_frame(spec.readiness_frame)
    readiness_duplicate = _validate_readiness_parent(readiness_parent_fd, mappings)
    config_read = -1
    config_write = -1
    process: subprocess.Popen[bytes] | None = None
    try:
        config_read, config_write = _cloexec_pipe()
        configuration = json.dumps(
            {
                "argv": list(argv),
                "fdMappings": [[item.source_fd, item.child_fd] for item in mappings],
                "schemaVersion": "protected-process-bootstrap.v1",
            },
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("ascii")
        if not 1 <= len(configuration) <= MAX_BOOTSTRAP_BYTES:
            _reject()
        bootstrap = os.path.realpath(__file__)
        process = subprocess.Popen(
            [sys.executable, bootstrap, _BOOTSTRAP_ARGUMENT, str(config_read)],
            cwd=cwd,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            pass_fds=tuple(item.source_fd for item in mappings) + (config_read,),
            start_new_session=True,
        )
        os.close(config_read)
        config_read = -1
        _write_all(config_write, configuration)
        os.close(config_write)
        config_write = -1
        return ProtectedProcess(
            process=process,
            readiness_fd=readiness_duplicate,
            readiness_frame=readiness_frame,
        )
    except ProtectedProcessRejected:
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=1.0)
            except (OSError, subprocess.TimeoutExpired):
                pass
        try:
            os.close(readiness_duplicate)
        except OSError:
            pass
        raise
    except (OSError, TypeError, ValueError):
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=1.0)
            except (OSError, subprocess.TimeoutExpired):
                pass
        try:
            os.close(readiness_duplicate)
        except OSError:
            pass
        _reject()
    finally:
        for fd in (config_read, config_write, *(item.source_fd for item in mappings)):
            if fd >= 0:
                try:
                    os.close(fd)
                except OSError:
                    pass


def _read_bootstrap_configuration(fd: int) -> tuple[list[str], list[tuple[int, int]]]:
    if type(fd) is not int or fd <= 2:
        raise RuntimeError
    raw = bytearray()
    while len(raw) <= MAX_BOOTSTRAP_BYTES:
        chunk = os.read(fd, min(4096, MAX_BOOTSTRAP_BYTES + 1 - len(raw)))
        if not chunk:
            break
        raw.extend(chunk)
    if not raw or len(raw) > MAX_BOOTSTRAP_BYTES:
        raise RuntimeError
    value = json.loads(bytes(raw).decode("ascii"))
    if not isinstance(value, dict) or set(value) != {"argv", "fdMappings", "schemaVersion"}:
        raise RuntimeError
    if value["schemaVersion"] != "protected-process-bootstrap.v1":
        raise RuntimeError
    argv = value["argv"]
    raw_mappings = value["fdMappings"]
    if (
        not isinstance(argv, list)
        or not argv
        or any(not isinstance(item, str) or not item for item in argv)
        or not isinstance(raw_mappings, list)
        or not raw_mappings
    ):
        raise RuntimeError
    mappings: list[tuple[int, int]] = []
    for item in raw_mappings:
        if (
            not isinstance(item, list)
            or len(item) != 2
            or any(type(number) is not int for number in item)
            or item[0] <= 2
            or not 0 <= item[1] <= MAX_CHILD_FD
            or item[1] in {1, 2}
        ):
            raise RuntimeError
        mappings.append((item[0], item[1]))
    return argv, mappings


def _child_bootstrap(config_fd: int) -> None:
    """Silent child-only remap; every failure exits with a fixed status."""

    try:
        argv, mappings = _read_bootstrap_configuration(config_fd)
        os.close(config_fd)
        minimum = max(target for _source, target in mappings) + 1
        scratch: list[tuple[int, int]] = []
        for source, target in mappings:
            duplicate = fcntl.fcntl(source, fcntl.F_DUPFD_CLOEXEC, minimum)
            scratch.append((duplicate, target))
        targets = {target for _source, target in mappings}
        for duplicate, target in scratch:
            os.dup2(duplicate, target, inheritable=True)
        for duplicate, _target in scratch:
            os.close(duplicate)
        for source, _target in mappings:
            if source not in targets:
                os.close(source)
        os.execve(argv[0], argv, dict(os.environ))
    except BaseException:
        os._exit(70)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == _BOOTSTRAP_ARGUMENT:
        try:
            _child_bootstrap(int(sys.argv[2]))
        except BaseException:
            os._exit(70)
    os._exit(70)


__all__ = [
    "ALLOWED_ENVIRONMENT_KEYS",
    "DEFAULT_READINESS_FRAME",
    "FixedFdMapping",
    "ProtectedProcess",
    "ProtectedProcessRejected",
    "ProtectedProcessSpec",
    "launch_protected_process",
]
