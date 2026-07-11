"""Protected local-process sequencing for the approved development E2E.

The module is deliberately import-inert.  Raw driver receipts stay behind the
``ClosedProcessAdapter`` boundary; this parent only sees closed case batches,
provider/browser attestations, and fixed controller events.
"""

from __future__ import annotations

import fcntl
import os
import re
import stat
import subprocess
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

try:
    from . import controller, service_bootstrap
    from .driver_cleanup_runtime import DriverCleanupRuntime
    from .live_coordinator import LiveCoordinator
    from .protected_process import (
        DEFAULT_READINESS_FRAME,
        FixedFdMapping,
        ProtectedProcess,
        ProtectedProcessSpec,
        launch_protected_process,
    )
    from .provider_cleanup_runtime import ProviderCleanupRuntime, recover_provider_cleanup
    from .sanitizer import CASE_IDS
except ImportError:  # pragma: no cover - direct script import fallback
    import controller
    import service_bootstrap
    from driver_cleanup_runtime import DriverCleanupRuntime
    from live_coordinator import LiveCoordinator
    from protected_process import (
        DEFAULT_READINESS_FRAME,
        FixedFdMapping,
        ProtectedProcess,
        ProtectedProcessSpec,
        launch_protected_process,
    )
    from provider_cleanup_runtime import ProviderCleanupRuntime, recover_provider_cleanup
    from sanitizer import CASE_IDS


MAX_PHASE_SECONDS = 300.0
MAX_BROWSER_SECONDS = 30.0
BROWSER_BROKER_READINESS_FRAME = (
    b'{"ready":true,"schemaVersion":"browser-session-broker-readiness.v1"}\n'
)
_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")
_PURPOSES = frozenset({"capability", "receipt"})
_SCRIPTED_CASES = CASE_IDS[:19]
_REAL_PROVIDER_CASES = CASE_IDS[19:22]
_ISOLATED_CASES = CASE_IDS[22:24]


class LiveProcessOrchestratorRejected(ValueError):
    """A fixed-message failure that cannot interpolate protected values."""

    def __init__(self) -> None:
        super().__init__("live_process_orchestrator_rejected")


def _reject() -> None:
    raise LiveProcessOrchestratorRejected()


def _remaining(deadline: float, *, maximum: float = MAX_PHASE_SECONDS) -> float:
    if not isinstance(deadline, (int, float)) or isinstance(deadline, bool):
        _reject()
    value = min(float(deadline) - time.monotonic(), maximum)
    if value <= 0:
        _reject()
    return value


def _close_fd(fd: int) -> None:
    if fd < 0:
        return
    try:
        os.close(fd)
    except OSError:
        pass


def _fd_identity(fd: int) -> tuple[int, int, int]:
    if type(fd) is not int or fd <= 2:
        _reject()
    try:
        info = os.fstat(fd)
    except OSError:
        _reject()
    return info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode)


def _close_fd_if_same(fd: int, identity: tuple[int, int, int]) -> None:
    """Close a locally owned FD only if its number was not reused."""

    try:
        if _fd_identity(fd) == identity:
            os.close(fd)
    except LiveProcessOrchestratorRejected:
        pass
    except OSError:
        pass


def _require_private_regular_rw(fd: int) -> tuple[int, int, int]:
    if type(fd) is not int or fd <= 2:
        _reject()
    try:
        info = os.fstat(fd)
        flags = fcntl.fcntl(fd, fcntl.F_GETFD)
        status = fcntl.fcntl(fd, fcntl.F_GETFL)
    except OSError:
        _reject()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.geteuid()
        or stat.S_IMODE(info.st_mode) != 0o600
        or info.st_nlink not in {0, 1}
        or not flags & fcntl.FD_CLOEXEC
        or status & os.O_ACCMODE != os.O_RDWR
    ):
        _reject()
    return info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode)


def _require_private_output_fd(
    output_fd: int,
    *,
    disjoint_fds: tuple[int, ...],
) -> None:
    if type(output_fd) is not int or output_fd <= 2 or output_fd in disjoint_fds:
        _reject()
    try:
        info = os.fstat(output_fd)
        flags = fcntl.fcntl(output_fd, fcntl.F_GETFD)
        status = fcntl.fcntl(output_fd, fcntl.F_GETFL)
    except OSError:
        _reject()
    regular = stat.S_ISREG(info.st_mode)
    fifo = stat.S_ISFIFO(info.st_mode)
    if (
        not (regular or fifo)
        or info.st_uid != os.geteuid()
        or stat.S_IMODE(info.st_mode) & 0o077
        or not flags & fcntl.FD_CLOEXEC
        or status & os.O_ACCMODE == os.O_RDONLY
        or (regular and info.st_nlink not in {0, 1})
        or _fd_identity(output_fd) in {_fd_identity(fd) for fd in disjoint_fds}
    ):
        _reject()


def _pipe() -> tuple[int, int]:
    try:
        read_fd, write_fd = os.pipe()
        os.set_inheritable(read_fd, False)
        os.set_inheritable(write_fd, False)
        return read_fd, write_fd
    except OSError:
        _close_fd(locals().get("read_fd", -1))
        _close_fd(locals().get("write_fd", -1))
        _reject()


def _write_exact(fd: int, value: bytes) -> None:
    view = memoryview(value)
    try:
        while view:
            written = os.write(fd, view)
            if written <= 0:
                _reject()
            view = view[written:]
    except LiveProcessOrchestratorRejected:
        raise
    except OSError:
        _reject()


@dataclass(frozen=True)
class PrivateFdBinding:
    source_fd: int
    child_fd: int
    purpose: str = "capability"

    def __post_init__(self) -> None:
        if (
            type(self.source_fd) is not int
            or self.source_fd <= 2
            or type(self.child_fd) is not int
            or not 0 <= self.child_fd <= 255
            or self.child_fd in {1, 2}
            or self.purpose not in _PURPOSES
        ):
            _reject()


@dataclass(frozen=True, repr=False)
class PrivateProcessPlan:
    argv: tuple[str, ...] = field(repr=False)
    cwd_alias: str = field(repr=False)
    bindings: tuple[PrivateFdBinding, ...] = field(repr=False)
    provider_credentials: bool = field(default=False, repr=False)

    def __post_init__(self) -> None:
        if (
            not isinstance(self.argv, tuple)
            or not self.argv
            or any(not isinstance(item, str) or not item or "\0" in item for item in self.argv)
            or not isinstance(self.cwd_alias, str)
            or not self.cwd_alias
            or not isinstance(self.bindings, tuple)
            or not self.bindings
            or any(not isinstance(item, PrivateFdBinding) for item in self.bindings)
            or len({item.source_fd for item in self.bindings}) != len(self.bindings)
            or len({item.child_fd for item in self.bindings}) != len(self.bindings)
            or type(self.provider_credentials) is not bool
        ):
            _reject()

    def __repr__(self) -> str:
        return "PrivateProcessPlan(<protected>)"


@dataclass(repr=False)
class CertifiedProcess:
    process: ProtectedProcess = field(repr=False)
    readiness_verified: bool = field(default=True, init=False)

    def __repr__(self) -> str:
        return "CertifiedProcess(<protected>)"

    def wait_exit(self, *, deadline: float) -> None:
        try:
            status = self.process.process.wait(timeout=_remaining(deadline))
        except (OSError, subprocess.TimeoutExpired):
            self.stop()
            _reject()
        if status != 0:
            _reject()

    def stop(self) -> None:
        try:
            self.process.stop(timeout_seconds=10.0)
        except BaseException:
            _reject()


Probe = Callable[[ProtectedProcess, float], bool]


class ProtectedPlanLauncher:
    """Translate private-FD plans while preserving every runtime-owned FD."""

    def __init__(self, *, cwd_aliases: Mapping[str, str], environment: Mapping[str, str]) -> None:
        if not isinstance(cwd_aliases, Mapping) or not isinstance(environment, Mapping):
            _reject()
        try:
            self._cwd_aliases = {
                alias: os.path.realpath(path)
                for alias, path in cwd_aliases.items()
                if isinstance(alias, str) and isinstance(path, str)
            }
            self._environment = dict(environment)
        except (OSError, TypeError, ValueError):
            _reject()
        if set(self._cwd_aliases) != set(cwd_aliases):
            _reject()

    def service_plan(self, plan: service_bootstrap.ProcessPlan) -> PrivateProcessPlan:
        try:
            options = service_bootstrap.subprocess_options(plan, self._environment)
            if options["stdout"] is not subprocess.DEVNULL or options["stderr"] is not subprocess.DEVNULL:
                _reject()
            bindings = [
                PrivateFdBinding(source, target)
                for source, target in plan.fd_mappings
            ]
            bindings.extend(
                PrivateFdBinding(source, source)
                for source in plan.pass_fds
            )
            return PrivateProcessPlan(
                argv=plan.command,
                cwd_alias=plan.cwd_alias,
                bindings=tuple(bindings),
                provider_credentials=plan.mode == "real",
            )
        except LiveProcessOrchestratorRejected:
            raise
        except (OSError, TypeError, ValueError):
            _reject()

    @staticmethod
    def _readiness_child_fd(plan: PrivateProcessPlan) -> int:
        occupied = {binding.child_fd for binding in plan.bindings}
        for candidate in range(255, 2, -1):
            if candidate not in occupied:
                return candidate
        _reject()

    def _launch(
        self,
        plan: PrivateProcessPlan,
        *,
        readiness_source_fd: int,
        readiness_parent_fd: int,
        readiness_child_fd: int,
        readiness_frame: bytes,
    ) -> ProtectedProcess:
        if plan.cwd_alias not in self._cwd_aliases:
            _reject()
        duplicates: dict[int, tuple[int, int, int]] = {}
        transferred = False
        try:
            mappings: list[FixedFdMapping] = []
            for binding in plan.bindings:
                duplicate = os.dup(binding.source_fd)
                os.set_inheritable(duplicate, False)
                duplicates[duplicate] = _fd_identity(duplicate)
                mappings.append(
                    FixedFdMapping(duplicate, binding.child_fd, binding.purpose)
                )
            readiness_duplicate = os.dup(readiness_source_fd)
            os.set_inheritable(readiness_duplicate, False)
            duplicates[readiness_duplicate] = _fd_identity(readiness_duplicate)
            mappings.append(
                FixedFdMapping(readiness_duplicate, readiness_child_fd, "readiness")
            )
            spec = ProtectedProcessSpec(
                argv=plan.argv,
                cwd=self._cwd_aliases[plan.cwd_alias],
                fd_mappings=tuple(mappings),
                environment=self._environment,
                readiness_frame=readiness_frame,
            )
            # ``launch_protected_process`` consumes every mapped source FD on
            # success.  Once it returns, this layer must never close those
            # descriptor numbers again.
            process = launch_protected_process(
                spec, readiness_parent_fd=readiness_parent_fd
            )
            transferred = True
            return process
        except LiveProcessOrchestratorRejected:
            raise
        except (OSError, TypeError, ValueError):
            _reject()
        finally:
            if not transferred:
                for duplicate, identity in duplicates.items():
                    _close_fd_if_same(duplicate, identity)

    def launch_parent_certified(
        self,
        plan: PrivateProcessPlan,
        *,
        probe: Probe,
        deadline: float,
        provider_credentials_allowed: bool = False,
    ) -> CertifiedProcess:
        if (
            not isinstance(plan, PrivateProcessPlan)
            or not callable(probe)
            or (plan.provider_credentials and not provider_credentials_allowed)
        ):
            _reject()
        read_fd = write_fd = child_read_fd = -1
        process: ProtectedProcess | None = None
        try:
            read_fd, write_fd = _pipe()
            child_read_fd = os.dup(read_fd)
            os.set_inheritable(child_read_fd, False)
            process = self._launch(
                plan,
                readiness_source_fd=child_read_fd,
                readiness_parent_fd=read_fd,
                readiness_child_fd=self._readiness_child_fd(plan),
                readiness_frame=DEFAULT_READINESS_FRAME,
            )
            _close_fd(read_fd)
            read_fd = -1
            _close_fd(child_read_fd)
            child_read_fd = -1
            if probe(process, float(deadline)) is not True:
                _reject()
            _write_exact(write_fd, DEFAULT_READINESS_FRAME)
            _close_fd(write_fd)
            write_fd = -1
            process.wait_ready(timeout_seconds=_remaining(deadline))
            return CertifiedProcess(process)
        except LiveProcessOrchestratorRejected:
            if process is not None:
                try:
                    process.stop(timeout_seconds=1.0)
                except BaseException:
                    pass
            raise
        except BaseException:
            if process is not None:
                try:
                    process.stop(timeout_seconds=1.0)
                except BaseException:
                    pass
            _reject()
        finally:
            _close_fd(read_fd)
            _close_fd(write_fd)
            _close_fd(child_read_fd)

    def launch_self_certified(
        self,
        plan: PrivateProcessPlan,
        *,
        readiness_child_fd: int,
        readiness_frame: bytes,
        deadline: float,
    ) -> CertifiedProcess:
        if (
            not isinstance(plan, PrivateProcessPlan)
            or plan.provider_credentials
            or readiness_child_fd in {item.child_fd for item in plan.bindings}
        ):
            _reject()
        read_fd = write_fd = -1
        process: ProtectedProcess | None = None
        try:
            read_fd, write_fd = _pipe()
            process = self._launch(
                plan,
                readiness_source_fd=write_fd,
                readiness_parent_fd=read_fd,
                readiness_child_fd=readiness_child_fd,
                readiness_frame=readiness_frame,
            )
            _close_fd(read_fd)
            read_fd = -1
            _close_fd(write_fd)
            write_fd = -1
            process.wait_ready(timeout_seconds=_remaining(deadline, maximum=MAX_BROWSER_SECONDS))
            return CertifiedProcess(process)
        except LiveProcessOrchestratorRejected:
            if process is not None:
                try:
                    process.stop(timeout_seconds=1.0)
                except BaseException:
                    pass
            raise
        except BaseException:
            if process is not None:
                try:
                    process.stop(timeout_seconds=1.0)
                except BaseException:
                    pass
            _reject()
        finally:
            _close_fd(read_fd)
            _close_fd(write_fd)


def scripted_driver_plan(
    *, node: str, settings_fd: int, mac_key_fd: int, receipt_fd: int
) -> PrivateProcessPlan:
    return PrivateProcessPlan(
        argv=(node, "scripts/ai_pipeline_e2e/scripted_case_driver.mjs", "--live"),
        cwd_alias="platform-detached-worktree",
        bindings=(
            PrivateFdBinding(settings_fd, 3),
            PrivateFdBinding(mac_key_fd, 4),
            PrivateFdBinding(receipt_fd, 5, "receipt"),
        ),
    )


def real_provider_driver_plan(
    *,
    node: str,
    settings_fd: int,
    media_fd: int,
    mac_key_fd: int,
    receipt_fd: int,
    cleanup_fd: int,
) -> PrivateProcessPlan:
    return PrivateProcessPlan(
        argv=(node, "scripts/ai_pipeline_e2e/real_pipeline_driver.mjs", "--live-provider"),
        cwd_alias="platform-detached-worktree",
        bindings=(
            PrivateFdBinding(settings_fd, 3),
            PrivateFdBinding(media_fd, 4),
            PrivateFdBinding(mac_key_fd, 5),
            PrivateFdBinding(receipt_fd, 6, "receipt"),
            PrivateFdBinding(cleanup_fd, 9),
        ),
    )


def isolated_data_driver_plan(
    *,
    node: str,
    settings_fd: int,
    media_fd: int,
    mac_key_fd: int,
    receipt_fd: int,
    main_locator_fd: int,
    provider_receipt_fd: int,
    cleanup_fd: int,
) -> PrivateProcessPlan:
    return PrivateProcessPlan(
        argv=(node, "scripts/ai_pipeline_e2e/real_pipeline_driver.mjs", "--live-isolated-data"),
        cwd_alias="platform-detached-worktree",
        bindings=(
            PrivateFdBinding(settings_fd, 3),
            PrivateFdBinding(media_fd, 4),
            PrivateFdBinding(mac_key_fd, 5),
            PrivateFdBinding(receipt_fd, 6, "receipt"),
            PrivateFdBinding(main_locator_fd, 7),
            PrivateFdBinding(provider_receipt_fd, 8),
            PrivateFdBinding(cleanup_fd, 9),
        ),
    )


def browser_auth_driver_plan(
    *,
    node: str,
    settings_fd: int,
    mac_key_fd: int,
    receipt_fd: int,
    main_locator_fd: int,
    provider_receipt_fd: int,
    isolated_data_receipt_fd: int,
    handoff_fd: int,
    handoff_ack_fd: int,
) -> PrivateProcessPlan:
    return PrivateProcessPlan(
        argv=(node, "scripts/ai_pipeline_e2e/real_pipeline_driver.mjs", "--live-browser-auth"),
        cwd_alias="platform-detached-worktree",
        bindings=(
            PrivateFdBinding(settings_fd, 3),
            PrivateFdBinding(mac_key_fd, 5),
            PrivateFdBinding(receipt_fd, 6, "receipt"),
            PrivateFdBinding(main_locator_fd, 7),
            PrivateFdBinding(provider_receipt_fd, 8),
            PrivateFdBinding(isolated_data_receipt_fd, 9),
            PrivateFdBinding(handoff_fd, 10),
            PrivateFdBinding(handoff_ack_fd, 11),
        ),
    )


def browser_broker_plan(
    *, node: str, input_fd: int, mac_key_fd: int, receipt_fd: int
) -> PrivateProcessPlan:
    return PrivateProcessPlan(
        argv=(node, "scripts/ai_pipeline_e2e/browser_session_broker.mjs"),
        cwd_alias="platform-detached-worktree",
        bindings=(
            PrivateFdBinding(input_fd, 3),
            PrivateFdBinding(mac_key_fd, 4),
            PrivateFdBinding(receipt_fd, 5, "receipt"),
        ),
    )


def browser_runner_plan(
    *,
    node: str,
    settings_fd: int,
    mac_key_fd: int,
    receipt_fd: int,
    binding_expectation_fd: int,
) -> PrivateProcessPlan:
    return PrivateProcessPlan(
        argv=(node, "scripts/ai_pipeline_e2e/browser_probe_runner.mjs"),
        cwd_alias="platform-detached-worktree",
        bindings=(
            PrivateFdBinding(settings_fd, 3),
            PrivateFdBinding(mac_key_fd, 4),
            PrivateFdBinding(receipt_fd, 5, "receipt"),
            PrivateFdBinding(binding_expectation_fd, 6),
        ),
    )


@dataclass(frozen=True, repr=False)
class ClosedCase:
    case_id: str
    mode: str
    measurements: Mapping[str, Any] = field(repr=False)

    def __repr__(self) -> str:
        return "ClosedCase(<protected>)"


@dataclass(frozen=True, repr=False)
class ClosedCaseBatch:
    cases: tuple[ClosedCase, ...] = field(repr=False)

    def __repr__(self) -> str:
        return "ClosedCaseBatch(<protected>)"


@dataclass(frozen=True, repr=False)
class ClosedBrowserResult:
    safe_result: Mapping[str, Any] = field(repr=False)
    payload: Mapping[str, Any] = field(repr=False)
    measurements: Mapping[str, Any] = field(repr=False)

    def __repr__(self) -> str:
        return "ClosedBrowserResult(<protected>)"


@dataclass(frozen=True, repr=False)
class ClosedProviderDriverResult:
    cleanup_plan_hmac: str = field(repr=False)
    main_locator_output_fd: int = field(repr=False)

    def __post_init__(self) -> None:
        if (
            not isinstance(self.cleanup_plan_hmac, str)
            or _HMAC.fullmatch(self.cleanup_plan_hmac) is None
            or type(self.main_locator_output_fd) is not int
            or self.main_locator_output_fd <= 2
        ):
            _reject()

    def __repr__(self) -> str:
        return "ClosedProviderDriverResult(<protected>)"


class ClosedProcessAdapter(Protocol):
    """Receipt-authenticating process adapter; no raw values cross this seam."""

    def prepare_services(self, launcher: ProtectedPlanLauncher) -> Mapping[str, Any]: ...
    def start_scripted(self, launcher: ProtectedPlanLauncher, deadline: float) -> tuple[Any, Mapping[str, Any]]: ...
    def finish_scripted(self, handle: Any, deadline: float) -> ClosedCaseBatch: ...
    def stop_scripted(self, handle: Any, deadline: float) -> Mapping[str, Any]: ...
    def resume_scripted_cases(self, launcher: ProtectedPlanLauncher, cursor: Mapping[str, Any], deadline: float) -> ClosedCaseBatch: ...
    def resume_scripted_cleanup(self, launcher: ProtectedPlanLauncher, deadline: float) -> Mapping[str, Any]: ...
    def start_real_services(self, launcher: ProtectedPlanLauncher, provider: ProviderCleanupRuntime, deadline: float) -> tuple[Any, Mapping[str, Any]]: ...
    def start_provider_driver(self, launcher: ProtectedPlanLauncher, handle: Any, driver: DriverCleanupRuntime, deadline: float) -> None: ...
    def finish_provider_driver(self, handle: Any, deadline: float) -> ClosedProviderDriverResult: ...
    def stop_real_services(self, handle: Any, deadline: float) -> Mapping[str, Any]: ...
    def real_provider_cases(self, handle: Any, provider_attestation: Mapping[str, Any]) -> ClosedCaseBatch: ...
    def start_isolated_summary(self, launcher: ProtectedPlanLauncher, handle: Any, deadline: float) -> Any: ...
    def start_isolated_driver(self, launcher: ProtectedPlanLauncher, handle: Any, driver: DriverCleanupRuntime, deadline: float) -> None: ...
    def finish_isolated_driver(self, handle: Any, deadline: float) -> ClosedCaseBatch: ...
    def stop_isolated_summary(self, handle: Any, deadline: float) -> None: ...
    def ui_probe_ready(self, handle: Any) -> bool: ...
    def run_browser_auth_broker_runner(self, launcher: ProtectedPlanLauncher, handle: Any, deadline: float) -> ClosedBrowserResult: ...
    def stop_real(self, handle: Any, deadline: float) -> None: ...
    def resume_real_through_ui(self, launcher: ProtectedPlanLauncher, cursor: Mapping[str, Any], deadline: float) -> LocalProcessResult: ...


@dataclass(frozen=True, repr=False)
class RuntimeInputs:
    vault_fd: int = field(repr=False)
    mac_key_fd: int = field(repr=False)
    expected_media_hmac: str = field(repr=False)
    expected_media_byte_count: int = field(repr=False)
    provider_cleanup_handler: Callable[[int], str] = field(repr=False)
    driver_cleanup_handler: Callable[[str, int], str] = field(repr=False)
    browser_timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        if (
            type(self.vault_fd) is not int
            or self.vault_fd <= 2
            or type(self.mac_key_fd) is not int
            or self.mac_key_fd <= 2
            or not isinstance(self.expected_media_hmac, str)
            or _HMAC.fullmatch(self.expected_media_hmac) is None
            or type(self.expected_media_byte_count) is not int
            or self.expected_media_byte_count <= 0
            or not callable(self.provider_cleanup_handler)
            or not callable(self.driver_cleanup_handler)
            or not isinstance(self.browser_timeout_seconds, (int, float))
            or isinstance(self.browser_timeout_seconds, bool)
            or not 0 < float(self.browser_timeout_seconds) <= MAX_BROWSER_SECONDS
        ):
            _reject()
        vault_identity = _require_private_regular_rw(self.vault_fd)
        mac_identity = _require_private_regular_rw(self.mac_key_fd)
        if self.vault_fd == self.mac_key_fd or vault_identity == mac_identity:
            _reject()

    def __repr__(self) -> str:
        return "RuntimeInputs(<protected>)"


@dataclass(frozen=True)
class LocalProcessResult:
    scripted_complete: bool
    real_complete: bool
    ui_complete: bool
    retained_successes: int
    readiness_verified: bool


class LocalLiveProcessOrchestrator:
    """Execute closed local phases in the controller's durable action order."""

    def __init__(
        self,
        *,
        coordinator: LiveCoordinator,
        launcher: ProtectedPlanLauncher,
        adapter: ClosedProcessAdapter,
        runtime_inputs: RuntimeInputs,
        provider_runtime_factory: Callable[..., ProviderCleanupRuntime] = ProviderCleanupRuntime,
        driver_runtime_factory: Callable[..., DriverCleanupRuntime] = DriverCleanupRuntime,
        provider_recovery: Callable[[int, Callable[[int], str]], int] = recover_provider_cleanup,
    ) -> None:
        if not all(
            callable(value)
            for value in (provider_runtime_factory, driver_runtime_factory, provider_recovery)
        ):
            _reject()
        self._coordinator = coordinator
        self._launcher = launcher
        self._adapter = adapter
        self._inputs = runtime_inputs
        self._provider_factory = provider_runtime_factory
        self._driver_factory = driver_runtime_factory
        self._provider_recovery = provider_recovery

    def _action(self) -> Mapping[str, Any]:
        try:
            value = self._coordinator.action()
        except BaseException:
            _reject()
        if not isinstance(value, Mapping):
            _reject()
        return value

    def _expect_action(self, action: str) -> None:
        if self._action() != {"kind": "action", "action": action}:
            _reject()

    @staticmethod
    def _closed_event(value: Mapping[str, Any], event_type: str, keys: set[str]) -> dict[str, Any]:
        if not isinstance(value, Mapping) or set(value) != {"type", *keys} or value.get("type") != event_type:
            _reject()
        return dict(value)

    def _record_batch(
        self,
        batch: ClosedCaseBatch,
        expected_ids: tuple[str, ...],
        *,
        real_attestation: Mapping[str, Any] | None = None,
    ) -> None:
        if (
            not isinstance(batch, ClosedCaseBatch)
            or tuple(item.case_id for item in batch.cases) != expected_ids
            or any(
                not isinstance(item, ClosedCase)
                or item.mode != ("real" if item.case_id in _REAL_PROVIDER_CASES else "scripted")
                or not isinstance(item.measurements, Mapping)
                for item in batch.cases
            )
        ):
            _reject()
        completed = tuple(getattr(self._coordinator.state, "completed_cases", ()))
        for item in batch.cases:
            if item.case_id in completed:
                continue
            if self._action() != {"kind": "case", "caseId": item.case_id, "mode": item.mode}:
                _reject()
            kwargs: dict[str, Any] = {}
            if item.case_id == "REAL-01":
                if real_attestation is None:
                    _reject()
                kwargs = {
                    "real_attestation": real_attestation,
                    "mac_key_fd": self._inputs.mac_key_fd,
                }
            try:
                self._coordinator.record_case(
                    item.case_id, item.mode, dict(item.measurements), **kwargs
                )
            except BaseException:
                _reject()

    def run_scripted_phase(self, *, timeout_seconds: float = 120.0) -> LocalProcessResult:
        if not isinstance(timeout_seconds, (int, float)) or not 0 < float(timeout_seconds) <= MAX_PHASE_SECONDS:
            _reject()
        deadline = time.monotonic() + float(timeout_seconds)
        if self._action() == {"kind": "action", "action": "prepare_services"}:
            event = self._closed_event(
                self._adapter.prepare_services(self._launcher),
                "SERVICES_READY",
                {"explicitSettings", "createAppOnly", "scriptedServicesReady", "outputsDiscarded"},
            )
            try:
                self._coordinator.apply_event(event)
            except BaseException:
                _reject()
        action = self._action()
        if action != {"kind": "action", "action": "begin_scripted_cases"}:
            _reject()
        handle: Any = None
        stopped = False
        success = False
        cleanup_event: Mapping[str, Any] | None = None
        try:
            handle, begin_event = self._adapter.start_scripted(self._launcher, deadline)
            event = self._closed_event(
                begin_event,
                "BEGIN_SCRIPTED_CASES",
                {"providerCredentialPresent", "scriptedPortsIsolated", "cleanupPlanned", "outputsDiscarded"},
            )
            if event["providerCredentialPresent"] is not False:
                _reject()
            self._coordinator.apply_event(event)
            batch = self._adapter.finish_scripted(handle, deadline)
            self._record_batch(batch, _SCRIPTED_CASES)
            cleanup_event = self._adapter.stop_scripted(handle, deadline)
            stopped = True
            self._expect_action("cleanup_scripted_phase")
            self._coordinator.apply_event(
                self._closed_event(
                    cleanup_event,
                    "SCRIPTED_PHASE_CLEANED",
                    {"processesStopped", "providerCredentialAbsent", "scriptedSessionsRemoved", "cleanupVaultConsistent"},
                )
            )
            success = True
            return LocalProcessResult(True, False, False, 0, True)
        except LiveProcessOrchestratorRejected:
            raise
        except BaseException:
            _reject()
        finally:
            if handle is not None and not stopped:
                try:
                    self._adapter.stop_scripted(handle, deadline)
                except BaseException:
                    pass
            if not success:
                # Never expose a callback error; the public failure stays fixed.
                pass

    def resume_scripted_phase(
        self,
        *,
        cursor: Mapping[str, Any],
        timeout_seconds: float = 120.0,
    ) -> LocalProcessResult:
        """Resume only the durable scripted cursor; never replay a committed event."""

        if (
            not isinstance(cursor, Mapping)
            or dict(cursor) != self._action()
            or not isinstance(timeout_seconds, (int, float))
            or not 0 < float(timeout_seconds) <= MAX_PHASE_SECONDS
        ):
            _reject()
        if cursor == {"kind": "action", "action": "cleanup_scripted_phase"}:
            deadline = time.monotonic() + float(timeout_seconds)
            try:
                event = self._closed_event(
                    self._adapter.resume_scripted_cleanup(self._launcher, deadline),
                    "SCRIPTED_PHASE_CLEANED",
                    {"processesStopped", "providerCredentialAbsent", "scriptedSessionsRemoved", "cleanupVaultConsistent"},
                )
                self._coordinator.apply_event(event)
            except LiveProcessOrchestratorRejected:
                raise
            except BaseException:
                _reject()
            self._expect_action("begin_real_cases")
            return LocalProcessResult(True, False, False, 0, True)
        if cursor == {"kind": "action", "action": "begin_scripted_cases"}:
            return self.run_scripted_phase(timeout_seconds=timeout_seconds)
        if not (
            cursor.get("kind") == "case"
            and cursor.get("mode") == "scripted"
            and cursor.get("caseId") in _SCRIPTED_CASES
        ):
            _reject()
        deadline = time.monotonic() + float(timeout_seconds)
        case_id = cursor["caseId"]
        expected_ids = _SCRIPTED_CASES[_SCRIPTED_CASES.index(case_id):]
        try:
            batch = self._adapter.resume_scripted_cases(
                self._launcher, dict(cursor), deadline
            )
            self._record_batch(batch, expected_ids)
            self._expect_action("cleanup_scripted_phase")
            cleanup_event = self._adapter.resume_scripted_cleanup(
                self._launcher, deadline
            )
            self._coordinator.apply_event(
                self._closed_event(
                    cleanup_event,
                    "SCRIPTED_PHASE_CLEANED",
                    {"processesStopped", "providerCredentialAbsent", "scriptedSessionsRemoved", "cleanupVaultConsistent"},
                )
            )
        except LiveProcessOrchestratorRejected:
            raise
        except BaseException:
            _reject()
        self._expect_action("begin_real_cases")
        return LocalProcessResult(True, False, False, 0, True)

    def resume_real_through_ui(
        self,
        *,
        cursor: Mapping[str, Any],
        timeout_seconds: float = 240.0,
    ) -> LocalProcessResult:
        """Delegate receipt-driven recovery for every post-BEGIN_REAL cursor."""

        allowed = isinstance(cursor, Mapping) and (
            (
                cursor.get("kind") == "case"
                and cursor.get("caseId") in {*_REAL_PROVIDER_CASES, *_ISOLATED_CASES, "UI-01"}
            )
            or dict(cursor) in (
                {"kind": "action", "action": "cleanup_real_provider_phase"},
                {"kind": "action", "action": "begin_ui_probe"},
            )
        )
        if (
            not isinstance(cursor, Mapping)
            or dict(cursor) != self._action()
            or not allowed
            or not isinstance(timeout_seconds, (int, float))
            or not 0 < float(timeout_seconds) <= MAX_PHASE_SECONDS
        ):
            _reject()
        deadline = time.monotonic() + float(timeout_seconds)
        try:
            result = self._adapter.resume_real_through_ui(
                self._launcher, dict(cursor), deadline
            )
        except BaseException:
            _reject()
        if (
            not isinstance(result, LocalProcessResult)
            or result != LocalProcessResult(True, True, True, 1, True)
        ):
            _reject()
        self._expect_action("verify_cleanup_and_retention")
        return result

    def run_real_through_ui(self, *, timeout_seconds: float = 240.0) -> LocalProcessResult:
        if not isinstance(timeout_seconds, (int, float)) or not 0 < float(timeout_seconds) <= MAX_PHASE_SECONDS:
            _reject()
        self._expect_action("begin_real_cases")
        deadline = time.monotonic() + float(timeout_seconds)
        provider: Any = None
        provider_driver: Any = None
        isolated_driver: Any = None
        handle: Any = None
        isolated: Any = None
        provider_released = provider_driver_released = isolated_driver_released = False
        services_stopped = real_stopped = isolated_stopped = False
        provider_finished = provider_driver_finished = isolated_driver_finished = retained = False
        original_failure = False
        try:
            provider = self._provider_factory(
                vault_fd=self._inputs.vault_fd,
                mac_key_fd=self._inputs.mac_key_fd,
                expected_media_hmac=self._inputs.expected_media_hmac,
                expected_media_byte_count=self._inputs.expected_media_byte_count,
                cleanup_channel_count=3,
            )
            provider_driver = self._driver_factory(
                vault_fd=self._inputs.vault_fd,
                mac_key_fd=self._inputs.mac_key_fd,
            )
            provider.start()
            provider_driver.start()
            handle, begin_event = self._adapter.start_real_services(
                self._launcher, provider, deadline
            )
            provider.release_child_endpoints()
            provider_released = True
            self._coordinator.apply_event(
                self._closed_event(
                    begin_event,
                    "BEGIN_REAL_CASES",
                    {"scriptedProcessesStopped", "settingsFdsValidated", "mediaFdValidated", "portsDisjoint", "explicitSettings", "outputsDiscarded"},
                )
            )
            self._adapter.start_provider_driver(
                self._launcher, handle, provider_driver, deadline
            )
            provider_driver.release_child_endpoint()
            provider_driver_released = True
            provider_result = self._adapter.finish_provider_driver(handle, deadline)
            if not isinstance(provider_result, ClosedProviderDriverResult):
                _reject()
            _require_private_output_fd(
                provider_result.main_locator_output_fd,
                disjoint_fds=(self._inputs.vault_fd, self._inputs.mac_key_fd),
            )
            provider_driver.finish(timeout_seconds=_remaining(deadline))
            provider_driver_finished = True
            cleanup_event = self._adapter.stop_real_services(handle, deadline)
            services_stopped = True
            provider_attestation = provider.finish(timeout_seconds=_remaining(deadline))
            provider_finished = True
            if (
                not isinstance(provider_attestation, Mapping)
                or not isinstance(provider_attestation.get("realAttestation"), Mapping)
            ):
                _reject()
            provider_driver.copy_pending_locator(
                plan_receipt_hmac=provider_result.cleanup_plan_hmac,
                output_fd=provider_result.main_locator_output_fd,
            )
            self._record_batch(
                self._adapter.real_provider_cases(handle, provider_attestation),
                _REAL_PROVIDER_CASES,
                real_attestation=provider_attestation["realAttestation"],
            )
            self._expect_action("cleanup_real_provider_phase")
            self._coordinator.apply_event(
                self._closed_event(
                    cleanup_event,
                    "REAL_PROVIDER_PHASE_CLEANED",
                    {"processesStopped", "providerCredentialAbsent", "portsReleased", "outputsDiscarded"},
                )
            )
            isolated = self._adapter.start_isolated_summary(
                self._launcher, handle, deadline
            )
            isolated_driver = self._driver_factory(
                vault_fd=self._inputs.vault_fd,
                mac_key_fd=self._inputs.mac_key_fd,
            )
            isolated_driver.start()
            self._adapter.start_isolated_driver(
                self._launcher, handle, isolated_driver, deadline
            )
            isolated_driver.release_child_endpoint()
            isolated_driver_released = True
            isolated_batch = self._adapter.finish_isolated_driver(handle, deadline)
            isolated_driver.finish(timeout_seconds=_remaining(deadline))
            isolated_driver_finished = True
            isolated_driver.assert_complete()
            self._adapter.stop_isolated_summary(isolated, deadline)
            isolated_stopped = True
            self._record_batch(isolated_batch, _ISOLATED_CASES)
            self._expect_action("begin_ui_probe")
            if self._adapter.ui_probe_ready(handle) is not True:
                _reject()
            self._coordinator.apply_event(
                {
                    "type": "BEGIN_UI_PROBE",
                    "platformRunning": True,
                    "aiServicesStopped": True,
                    "browserCaptureDisabled": True,
                }
            )
            browser_deadline = time.monotonic() + float(
                self._inputs.browser_timeout_seconds
            )
            browser = self._adapter.run_browser_auth_broker_runner(
                self._launcher, handle, browser_deadline
            )
            if not isinstance(browser, ClosedBrowserResult):
                _reject()
            if self._action() != {"kind": "case", "caseId": "UI-01", "mode": "real"}:
                _reject()
            self._coordinator.record_case(
                "UI-01",
                "real",
                dict(browser.measurements),
                browser_result=dict(browser.safe_result),
                browser_payload=dict(browser.payload),
            )
            # The adapter receives one deadline for the fresh auth process,
            # broker readiness, browser runner, and auth receipt validation.
            self._adapter.stop_real(handle, browser_deadline)
            real_stopped = True
            state = self._coordinator.state
            controller_persisted = self._action() == {
                "kind": "action", "action": "verify_cleanup_and_retention"
            }
            if not controller_persisted or getattr(state, "development_target_hmac", None) is None:
                _reject()
            provider_driver.commit_single_retained(
                real_receipt_verified=True,
                ui_verified=True,
                controller_state_persisted=True,
                development_target_verified=True,
            )
            retained = True
            provider_driver.assert_complete()
            return LocalProcessResult(True, True, True, 1, True)
        except LiveProcessOrchestratorRejected:
            original_failure = True
            raise
        except BaseException:
            original_failure = True
            _reject()
        finally:
            if isolated is not None and not isolated_stopped:
                try:
                    self._adapter.stop_isolated_summary(isolated, deadline)
                except BaseException:
                    pass
            if handle is not None and not services_stopped:
                try:
                    self._adapter.stop_real_services(handle, deadline)
                except BaseException:
                    pass
            if handle is not None and not real_stopped:
                try:
                    self._adapter.stop_real(handle, deadline)
                except BaseException:
                    pass
            if provider is not None:
                if not provider_released:
                    try:
                        provider.release_child_endpoints()
                        provider_released = True
                    except BaseException:
                        pass
                if not provider_finished:
                    try:
                        provider.finish(timeout_seconds=1.0)
                        provider_finished = True
                    except BaseException:
                        pass
                try:
                    provider.close()
                except BaseException:
                    pass
            if isolated_driver is not None:
                if not isolated_driver_released:
                    try:
                        isolated_driver.release_child_endpoint()
                        isolated_driver_released = True
                    except BaseException:
                        pass
                if not isolated_driver_finished:
                    try:
                        isolated_driver.finish(timeout_seconds=1.0)
                        isolated_driver_finished = True
                    except BaseException:
                        pass
                if original_failure and isolated_driver_finished:
                    try:
                        isolated_driver.recover_pending(self._inputs.driver_cleanup_handler)
                    except BaseException:
                        pass
                try:
                    isolated_driver.close()
                except BaseException:
                    pass
            if provider_driver is not None:
                if not provider_driver_released:
                    try:
                        provider_driver.release_child_endpoint()
                        provider_driver_released = True
                    except BaseException:
                        pass
                if not provider_driver_finished:
                    try:
                        provider_driver.finish(timeout_seconds=1.0)
                        provider_driver_finished = True
                    except BaseException:
                        pass
                if original_failure and provider_driver_finished and not retained:
                    try:
                        provider_driver.recover_pending(self._inputs.driver_cleanup_handler)
                    except BaseException:
                        pass
                try:
                    provider_driver.close()
                except BaseException:
                    pass
            if original_failure:
                try:
                    self._provider_recovery(
                        self._inputs.vault_fd,
                        self._inputs.provider_cleanup_handler,
                    )
                except BaseException:
                    pass


__all__ = [
    "BROWSER_BROKER_READINESS_FRAME",
    "CertifiedProcess",
    "ClosedBrowserResult",
    "ClosedCase",
    "ClosedCaseBatch",
    "ClosedProviderDriverResult",
    "ClosedProcessAdapter",
    "LiveProcessOrchestratorRejected",
    "LocalLiveProcessOrchestrator",
    "LocalProcessResult",
    "PrivateFdBinding",
    "PrivateProcessPlan",
    "ProtectedPlanLauncher",
    "RuntimeInputs",
    "browser_broker_plan",
    "browser_auth_driver_plan",
    "browser_runner_plan",
    "isolated_data_driver_plan",
    "real_provider_driver_plan",
    "scripted_driver_plan",
]
