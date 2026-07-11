from __future__ import annotations

import hashlib
import hmac
import os
import tempfile
import types
import unittest
from unittest import mock

from scripts.ai_pipeline_e2e import live_process_orchestrator as subject
from scripts.ai_pipeline_e2e import secure_state
from scripts.ai_pipeline_e2e.sanitizer import CASE_IDS


HMAC = "hmac-sha256:" + "a" * 64


class _Popen:
    def __init__(self) -> None:
        self.status: int | None = None

    def wait(self, timeout: float) -> int:
        del timeout
        self.status = 0
        return 0

    def poll(self) -> int | None:
        return self.status


class _Protected:
    def __init__(self, readiness_fd: int, events: list[str]) -> None:
        self.process = _Popen()
        self._readiness_fd = readiness_fd
        self._events = events
        self.stopped = False

    def wait_ready(self, *, timeout_seconds: float) -> None:
        self._events.append("wait-ready")
        self._events.append(os.read(self._readiness_fd, 512).decode("ascii"))
        self._events.append("eof" if os.read(self._readiness_fd, 1) == b"" else "not-eof")
        os.close(self._readiness_fd)
        self._readiness_fd = -1
        self._events.append("deadline-ok" if timeout_seconds > 0 else "deadline-bad")

    def stop(self, *, timeout_seconds: float) -> None:
        del timeout_seconds
        self.stopped = True
        self._events.append("stop")
        if self._readiness_fd >= 0:
            os.close(self._readiness_fd)
            self._readiness_fd = -1


class LauncherTests(unittest.TestCase):
    def test_parent_certified_readiness_occurs_only_after_probe_and_preserves_sources(self) -> None:
        events: list[str] = []
        captured_sources: list[int] = []
        with tempfile.TemporaryDirectory() as cwd, tempfile.TemporaryFile() as capability:
            plan = subject.PrivateProcessPlan(
                argv=("/bin/sh", "-c", "exit 0"),
                cwd_alias="work",
                bindings=(subject.PrivateFdBinding(capability.fileno(), 3),),
            )
            launcher = subject.ProtectedPlanLauncher(
                cwd_aliases={"work": cwd},
                environment={},
            )

            def launch(spec: object, *, readiness_parent_fd: int) -> _Protected:
                events.append("launch")
                mappings = spec.fd_mappings  # type: ignore[attr-defined]
                captured_sources.extend(item.source_fd for item in mappings)
                readiness = next(item for item in mappings if item.purpose == "readiness")
                with self.assertRaises(OSError):
                    os.write(readiness.source_fd, b"forged")
                probe_fd = os.dup(readiness_parent_fd)
                os.set_blocking(probe_fd, False)
                with self.assertRaises(BlockingIOError):
                    os.read(probe_fd, 1)
                os.set_blocking(probe_fd, True)
                for item in mappings:
                    os.close(item.source_fd)
                return _Protected(probe_fd, events)

            def probe(_process: object, deadline: float) -> bool:
                self.assertGreater(deadline, 0)
                self.assertEqual(events, ["launch"])
                events.append("probe")
                return True

            with mock.patch.object(subject, "launch_protected_process", side_effect=launch):
                process = launcher.launch_parent_certified(
                    plan,
                    probe=probe,
                    deadline=subject.time.monotonic() + 2,
                )

            self.assertTrue(process.readiness_verified)
            self.assertEqual(
                events[:3],
                ["launch", "probe", "wait-ready"],
            )
            self.assertEqual(events[3].encode("ascii"), subject.DEFAULT_READINESS_FRAME)
            self.assertEqual(events[4:], ["eof", "deadline-ok"])
            os.fstat(capability.fileno())
            for duplicate in captured_sources:
                with self.assertRaises(OSError):
                    os.fstat(duplicate)

    def test_launcher_never_closes_a_consumed_descriptor_number_after_reuse(self) -> None:
        events: list[str] = []
        sentinel_fd = -1
        with (
            tempfile.TemporaryDirectory() as cwd,
            tempfile.TemporaryFile() as capability,
            tempfile.NamedTemporaryFile() as sentinel,
        ):
            plan = subject.PrivateProcessPlan(
                argv=("/bin/sh", "-c", "exit 0"),
                cwd_alias="work",
                bindings=(subject.PrivateFdBinding(capability.fileno(), 3),),
            )
            launcher = subject.ProtectedPlanLauncher(cwd_aliases={"work": cwd}, environment={})

            def launch(spec: object, *, readiness_parent_fd: int) -> _Protected:
                nonlocal sentinel_fd
                mappings = spec.fd_mappings  # type: ignore[attr-defined]
                consumed = mappings[0].source_fd
                os.close(consumed)
                sentinel_fd = os.open(sentinel.name, os.O_RDWR | os.O_CLOEXEC)
                self.assertEqual(sentinel_fd, consumed)
                for item in mappings[1:]:
                    os.close(item.source_fd)
                return _Protected(os.dup(readiness_parent_fd), events)

            try:
                with mock.patch.object(subject, "launch_protected_process", side_effect=launch):
                    launcher.launch_parent_certified(
                        plan,
                        probe=lambda _process, _deadline: True,
                        deadline=subject.time.monotonic() + 2,
                    )
                os.fstat(sentinel_fd)
            finally:
                if sentinel_fd >= 0:
                    os.close(sentinel_fd)

    def test_probe_failure_closes_writer_and_stops_process(self) -> None:
        events: list[str] = []
        holder: dict[str, _Protected] = {}
        with tempfile.TemporaryDirectory() as cwd, tempfile.TemporaryFile() as capability:
            launcher = subject.ProtectedPlanLauncher(cwd_aliases={"work": cwd}, environment={})
            plan = subject.PrivateProcessPlan(
                argv=("/bin/sh", "-c", "exit 0"),
                cwd_alias="work",
                bindings=(subject.PrivateFdBinding(capability.fileno(), 3),),
            )

            def launch(spec: object, *, readiness_parent_fd: int) -> _Protected:
                for item in spec.fd_mappings:  # type: ignore[attr-defined]
                    os.close(item.source_fd)
                holder["process"] = _Protected(os.dup(readiness_parent_fd), events)
                return holder["process"]

            with (
                mock.patch.object(subject, "launch_protected_process", side_effect=launch),
                self.assertRaises(subject.LiveProcessOrchestratorRejected),
            ):
                launcher.launch_parent_certified(
                    plan,
                    probe=lambda _process, _deadline: False,
                    deadline=subject.time.monotonic() + 2,
                )
        self.assertTrue(holder["process"].stopped)
        self.assertNotIn("wait-ready", events)

    def test_scripted_launch_rejects_provider_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as cwd, tempfile.TemporaryFile() as capability:
            launcher = subject.ProtectedPlanLauncher(cwd_aliases={"work": cwd}, environment={})
            plan = subject.PrivateProcessPlan(
                argv=("/bin/sh", "-c", "exit 0"),
                cwd_alias="work",
                bindings=(subject.PrivateFdBinding(capability.fileno(), 3),),
                provider_credentials=True,
            )
            with self.assertRaises(subject.LiveProcessOrchestratorRejected):
                launcher.launch_parent_certified(
                    plan,
                    probe=lambda _process, _deadline: True,
                    deadline=subject.time.monotonic() + 2,
                )

    def test_phase_driver_plans_have_exact_modes_and_fd_maps(self) -> None:
        files = [tempfile.TemporaryFile() for _ in range(9)]
        try:
            fds = [item.fileno() for item in files]
            provider = subject.real_provider_driver_plan(
                node="/bin/sh", settings_fd=fds[0], media_fd=fds[1],
                mac_key_fd=fds[2], receipt_fd=fds[3], cleanup_fd=fds[4],
            )
            isolated = subject.isolated_data_driver_plan(
                node="/bin/sh", settings_fd=fds[0], media_fd=fds[1],
                mac_key_fd=fds[2], receipt_fd=fds[3], main_locator_fd=fds[4],
                provider_receipt_fd=fds[5], cleanup_fd=fds[6],
            )
            browser = subject.browser_auth_driver_plan(
                node="/bin/sh", settings_fd=fds[0], mac_key_fd=fds[2],
                receipt_fd=fds[3], main_locator_fd=fds[4],
                provider_receipt_fd=fds[5], isolated_data_receipt_fd=fds[6],
                handoff_fd=fds[7], handoff_ack_fd=fds[8],
            )
            self.assertEqual(provider.argv[-1], "--live-provider")
            self.assertEqual(isolated.argv[-1], "--live-isolated-data")
            self.assertEqual(browser.argv[-1], "--live-browser-auth")
            self.assertEqual([item.child_fd for item in provider.bindings], [3, 4, 5, 6, 9])
            self.assertEqual([item.child_fd for item in isolated.bindings], [3, 4, 5, 6, 7, 8, 9])
            self.assertEqual([item.child_fd for item in browser.bindings], [3, 5, 6, 7, 8, 9, 10, 11])
        finally:
            for item in files:
                item.close()


class _Coordinator:
    def __init__(self, log: list[str], *, restart_case: str | None = None) -> None:
        self.log = log
        self.state = types.SimpleNamespace(
            completed_cases=(),
            development_target_hmac=HMAC,
        )
        if restart_case is None:
            self.cursor: dict[str, object] = {"kind": "action", "action": "prepare_services"}
        else:
            index = CASE_IDS.index(restart_case)
            self.state.completed_cases = CASE_IDS[:index]
            self.cursor = {"kind": "case", "caseId": restart_case, "mode": "scripted"}

    def action(self) -> dict[str, object]:
        return dict(self.cursor)

    def apply_event(self, event: dict[str, object]) -> None:
        kind = event["type"]
        self.log.append(f"event:{kind}")
        if kind == "SERVICES_READY":
            self.cursor = {"kind": "action", "action": "begin_scripted_cases"}
        elif kind == "BEGIN_SCRIPTED_CASES":
            self.cursor = {"kind": "case", "caseId": CASE_IDS[0], "mode": "scripted"}
        elif kind == "SCRIPTED_PHASE_CLEANED":
            self.cursor = {"kind": "action", "action": "begin_real_cases"}
        elif kind == "BEGIN_REAL_CASES":
            self.cursor = {"kind": "case", "caseId": CASE_IDS[19], "mode": "real"}
        elif kind == "REAL_PROVIDER_PHASE_CLEANED":
            self.cursor = {"kind": "case", "caseId": CASE_IDS[22], "mode": "scripted"}
        elif kind == "BEGIN_UI_PROBE":
            self.cursor = {"kind": "case", "caseId": "UI-01", "mode": "real"}
        else:
            raise AssertionError(kind)

    def record_case(self, case_id: str, mode: str, measurements: object, **kwargs: object) -> None:
        del measurements
        self.log.append(f"record:{case_id}")
        self.assert_cursor(case_id, mode)
        if case_id == "REAL-01":
            assert set(kwargs) == {"real_attestation", "mac_key_fd"}
        elif case_id == "UI-01":
            assert set(kwargs) == {"browser_result", "browser_payload"}
        else:
            assert kwargs == {}
        self.state.completed_cases = self.state.completed_cases + (case_id,)
        index = CASE_IDS.index(case_id) + 1
        if index == 19:
            self.cursor = {"kind": "action", "action": "cleanup_scripted_phase"}
        elif index == 22:
            self.cursor = {"kind": "action", "action": "cleanup_real_provider_phase"}
        elif index == 24:
            self.cursor = {"kind": "action", "action": "begin_ui_probe"}
        elif index == 25:
            self.cursor = {"kind": "action", "action": "verify_cleanup_and_retention"}
        else:
            next_mode = "real" if 19 <= index < 22 else "scripted"
            self.cursor = {"kind": "case", "caseId": CASE_IDS[index], "mode": next_mode}

    def assert_cursor(self, case_id: str, mode: str) -> None:
        assert self.cursor == {"kind": "case", "caseId": case_id, "mode": mode}


def _batch(ids: tuple[str, ...]) -> subject.ClosedCaseBatch:
    return subject.ClosedCaseBatch(tuple(
        subject.ClosedCase(item, "real" if item in CASE_IDS[19:22] else "scripted", {"ok": True})
        for item in ids
    ))


class _Adapter:
    def __init__(self, log: list[str], *, fail_provider: bool = False, coordinator: _Coordinator | None = None) -> None:
        self.log = log
        self.fail_provider = fail_provider
        self.coordinator = coordinator
        self.browser_deadline: float | None = None
        self.provider_output_fd: int | None = None

    def prepare_services(self, _launcher: object) -> dict[str, object]:
        self.log.append("prepare")
        return {"type": "SERVICES_READY", "explicitSettings": True, "createAppOnly": True, "scriptedServicesReady": True, "outputsDiscarded": True}

    def start_scripted(self, _launcher: object, _deadline: float) -> tuple[object, dict[str, object]]:
        self.log.append("start-scripted-no-provider")
        return object(), {"type": "BEGIN_SCRIPTED_CASES", "providerCredentialPresent": False, "scriptedPortsIsolated": True, "cleanupPlanned": True, "outputsDiscarded": True}

    def finish_scripted(self, _handle: object, _deadline: float) -> subject.ClosedCaseBatch:
        self.log.append("finish-scripted")
        return _batch(CASE_IDS[:19])

    def stop_scripted(self, _handle: object, _deadline: float) -> dict[str, object]:
        self.log.append("stop-scripted")
        return {"type": "SCRIPTED_PHASE_CLEANED", "processesStopped": True, "providerCredentialAbsent": True, "scriptedSessionsRemoved": True, "cleanupVaultConsistent": True}

    def resume_scripted_cases(self, _launcher: object, cursor: dict[str, object], _deadline: float) -> subject.ClosedCaseBatch:
        case_id = cursor["caseId"]
        assert isinstance(case_id, str) and case_id in CASE_IDS[:19]
        self.log.append("resume-scripted-cases:" + case_id)
        return _batch(CASE_IDS[CASE_IDS.index(case_id):19])

    def resume_scripted_cleanup(self, _launcher: object, _deadline: float) -> dict[str, object]:
        self.log.append("resume-scripted-cleanup")
        return {"type": "SCRIPTED_PHASE_CLEANED", "processesStopped": True, "providerCredentialAbsent": True, "scriptedSessionsRemoved": True, "cleanupVaultConsistent": True}

    def start_real_services(self, _launcher: object, _provider: object, _deadline: float) -> tuple[object, dict[str, object]]:
        self.log.append("start-real-services")
        return object(), {"type": "BEGIN_REAL_CASES", "scriptedProcessesStopped": True, "settingsFdsValidated": True, "mediaFdValidated": True, "portsDisjoint": True, "explicitSettings": True, "outputsDiscarded": True}

    def start_provider_driver(self, _launcher: object, _handle: object, _driver: object, _deadline: float) -> None:
        self.log.append("start-provider-driver")

    def finish_provider_driver(self, _handle: object, _deadline: float) -> subject.ClosedProviderDriverResult:
        self.log.append("finish-provider-driver")
        if self.fail_provider:
            raise RuntimeError("protected")
        assert self.provider_output_fd is not None
        return subject.ClosedProviderDriverResult(HMAC, self.provider_output_fd)

    def stop_real_services(self, _handle: object, _deadline: float) -> dict[str, object]:
        self.log.append("stop-real-services")
        return {"type": "REAL_PROVIDER_PHASE_CLEANED", "processesStopped": True, "providerCredentialAbsent": True, "portsReleased": True, "outputsDiscarded": True}

    def real_provider_cases(self, _handle: object, _attestation: object) -> subject.ClosedCaseBatch:
        self.log.append("close-provider-cases")
        return _batch(CASE_IDS[19:22])

    def start_isolated_summary(self, _launcher: object, _handle: object, _deadline: float) -> object:
        self.log.append("start-isolated-summary-no-provider")
        return object()

    def start_isolated_driver(self, _launcher: object, _handle: object, _driver: object, _deadline: float) -> None:
        self.log.append("start-isolated-driver")

    def finish_isolated_driver(self, _handle: object, _deadline: float) -> subject.ClosedCaseBatch:
        self.log.append("finish-isolated-driver")
        return _batch(CASE_IDS[22:24])

    def stop_isolated_summary(self, _handle: object, _deadline: float) -> None:
        self.log.append("stop-isolated-summary")

    def ui_probe_ready(self, _handle: object) -> bool:
        self.log.append("ui-ready")
        return True

    def run_browser_auth_broker_runner(self, _launcher: object, _handle: object, deadline: float) -> subject.ClosedBrowserResult:
        self.log.append("browser-auth-broker-runner")
        self.browser_deadline = deadline
        return subject.ClosedBrowserResult(
            {"reportSections": 6, "confirmedRendered": True, "notConfirmedRendered": True, "timestampSeekVerified": True, "refreshStable": True, "capturedArtifacts": 0, "resultHmac": HMAC},
            {"schemaVersion": "protected-browser-attestation.v1", "operation": "ui_probe", "resultHmac": HMAC, "success": True, "booleanCount": 3, "boundedCount": 2, "capturedArtifacts": 0},
            {"report_sections": 6, "confirmed_and_not_confirmed_rendered": True, "timestamp_seek_verified": True, "refresh_result_stable": True, "captured_visual_artifacts": 0, "ui_result_hmac": HMAC},
        )

    def stop_real(self, _handle: object, deadline: float) -> None:
        self.log.append("stop-real")
        assert deadline == self.browser_deadline

    def resume_real_through_ui(self, _launcher: object, cursor: dict[str, object], _deadline: float) -> subject.LocalProcessResult:
        self.log.append("resume-real:" + str(cursor.get("caseId", cursor.get("action"))))
        assert self.coordinator is not None
        self.coordinator.cursor = {"kind": "action", "action": "verify_cleanup_and_retention"}
        return subject.LocalProcessResult(True, True, True, 1, True)


class _ProviderRuntime:
    def __init__(self, log: list[str], **_kwargs: object) -> None:
        self.log = log

    def start(self) -> None: self.log.append("provider:start")
    def release_child_endpoints(self) -> None: self.log.append("provider:release")
    def finish(self, *, timeout_seconds: float) -> dict[str, object]:
        assert timeout_seconds > 0
        self.log.append("provider:finish")
        return {"realAttestation": {"closed": True}}
    def close(self) -> None: self.log.append("provider:close")


class _DriverRuntime:
    count = 0

    def __init__(self, log: list[str], **_kwargs: object) -> None:
        type(self).count += 1
        self.name = "provider-driver" if type(self).count % 2 else "isolated-driver"
        self.log = log

    def start(self) -> None: self.log.append(f"{self.name}:start")
    def release_child_endpoint(self) -> None: self.log.append(f"{self.name}:release")
    def finish(self, *, timeout_seconds: float) -> None:
        assert timeout_seconds > 0
        self.log.append(f"{self.name}:finish")
    def copy_pending_locator(self, *, plan_receipt_hmac: str, output_fd: int) -> None:
        assert plan_receipt_hmac == HMAC and output_fd > 2
        self.log.append("provider-driver:copy-locator")
    def commit_single_retained(self, **facts: bool) -> None:
        assert all(facts.values())
        self.log.append("provider-driver:retain")
    def assert_complete(self) -> None: self.log.append(f"{self.name}:assert-complete")
    def recover_pending(self, _handler: object) -> int:
        self.log.append(f"{self.name}:recover")
        return 1
    def close(self) -> None: self.log.append(f"{self.name}:close")


class SequencingTests(unittest.TestCase):
    def setUp(self) -> None:
        _DriverRuntime.count = 0
        self.stack = unittest.ExitStack() if hasattr(unittest, "ExitStack") else None

    def orchestrator(self, coordinator: _Coordinator, adapter: _Adapter, log: list[str]) -> tuple[subject.LocalLiveProcessOrchestrator, list[tempfile._TemporaryFileWrapper]]:
        files = [tempfile.TemporaryFile(), tempfile.TemporaryFile(), tempfile.TemporaryFile()]
        adapter.provider_output_fd = files[2].fileno()
        inputs = subject.RuntimeInputs(
            vault_fd=files[0].fileno(), mac_key_fd=files[1].fileno(),
            expected_media_hmac=HMAC, expected_media_byte_count=1,
            provider_cleanup_handler=lambda _fd: "absent",
            driver_cleanup_handler=lambda _alias, _fd: "absent",
        )
        launcher = object()
        orchestrator = subject.LocalLiveProcessOrchestrator(
            coordinator=coordinator, launcher=launcher, adapter=adapter,
            runtime_inputs=inputs,
            provider_runtime_factory=lambda **kwargs: _ProviderRuntime(log, **kwargs),
            driver_runtime_factory=lambda **kwargs: _DriverRuntime(log, **kwargs),
            provider_recovery=lambda _fd, _handler: log.append("provider:recover") or 0,
        )
        return orchestrator, files

    def test_full_order_and_parent_only_retention(self) -> None:
        log: list[str] = []
        coordinator = _Coordinator(log)
        adapter = _Adapter(log)
        orchestrator, files = self.orchestrator(coordinator, adapter, log)
        try:
            self.assertTrue(orchestrator.run_scripted_phase().scripted_complete)
            result = orchestrator.run_real_through_ui()
        finally:
            for item in files: item.close()
        self.assertEqual(result.retained_successes, 1)
        self.assertLess(log.index("stop-real-services"), log.index("provider:finish"))
        self.assertLess(log.index("provider:finish"), log.index("provider-driver:copy-locator"))
        self.assertLess(log.index("provider:finish"), log.index("record:REAL-01"))
        self.assertLess(log.index("provider-driver:finish"), log.index("provider-driver:copy-locator"))
        self.assertLess(log.index("record:REPLAY-01"), log.index("start-isolated-summary-no-provider"))
        self.assertLess(log.index("stop-isolated-summary"), log.index("record:RLS-01"))
        self.assertLess(log.index("event:BEGIN_UI_PROBE"), log.index("browser-auth-broker-runner"))
        self.assertLess(log.index("browser-auth-broker-runner"), log.index("record:UI-01"))
        self.assertLess(log.index("record:UI-01"), log.index("provider-driver:retain"))
        self.assertIn("isolated-driver:assert-complete", log)

    def test_failure_stops_processes_and_recovers_pending_locators(self) -> None:
        log: list[str] = []
        coordinator = _Coordinator(log)
        adapter = _Adapter(log, fail_provider=True)
        orchestrator, files = self.orchestrator(coordinator, adapter, log)
        try:
            orchestrator.run_scripted_phase()
            with self.assertRaises(subject.LiveProcessOrchestratorRejected):
                orchestrator.run_real_through_ui()
        finally:
            for item in files: item.close()
        self.assertIn("stop-real-services", log)
        self.assertIn("stop-real", log)
        self.assertIn("provider-driver:recover", log)
        self.assertIn("provider:recover", log)
        self.assertNotIn("provider-driver:retain", log)

    def test_provider_locator_output_rejects_runtime_fd_identity_aliases(self) -> None:
        for alias_index in (0, 1):
            with self.subTest(alias="vault" if alias_index == 0 else "mac-key"):
                log: list[str] = []
                coordinator = _Coordinator(log)
                adapter = _Adapter(log)
                orchestrator, files = self.orchestrator(coordinator, adapter, log)
                output_alias = os.dup(files[alias_index].fileno())
                adapter.provider_output_fd = output_alias
                try:
                    orchestrator.run_scripted_phase()
                    with self.assertRaises(subject.LiveProcessOrchestratorRejected):
                        orchestrator.run_real_through_ui()
                finally:
                    os.close(output_alias)
                    for item in files: item.close()
                self.assertNotIn("provider-driver:copy-locator", log)

    def test_restart_case_cursor_skips_persisted_cases(self) -> None:
        log: list[str] = []
        restart = CASE_IDS[7]
        coordinator = _Coordinator(log, restart_case=restart)
        adapter = _Adapter(log)
        orchestrator, files = self.orchestrator(coordinator, adapter, log)
        try:
            orchestrator.resume_scripted_phase(cursor=dict(coordinator.cursor))
        finally:
            for item in files: item.close()
        self.assertNotIn("event:BEGIN_SCRIPTED_CASES", log)
        self.assertEqual([item for item in log if item.startswith("record:")][0], f"record:{restart}")
        self.assertEqual(log[0], f"resume-scripted-cases:{restart}")
        self.assertNotIn("start-scripted-no-provider", log)
        self.assertNotIn("finish-scripted", log)
        self.assertNotIn("stop-scripted", log)
        self.assertIn("resume-scripted-cleanup", log)

    def test_fresh_scripted_entry_rejects_persisted_case_cursor(self) -> None:
        log: list[str] = []
        coordinator = _Coordinator(log, restart_case=CASE_IDS[3])
        adapter = _Adapter(log)
        orchestrator, files = self.orchestrator(coordinator, adapter, log)
        try:
            with self.assertRaises(subject.LiveProcessOrchestratorRejected):
                orchestrator.run_scripted_phase()
        finally:
            for item in files: item.close()
        self.assertNotIn("start-scripted-no-provider", log)
        self.assertNotIn("finish-scripted", log)

    def test_resume_scripted_cleanup_dispatches_only_cleanup_contract(self) -> None:
        log: list[str] = []
        coordinator = _Coordinator(log)
        coordinator.cursor = {"kind": "action", "action": "cleanup_scripted_phase"}
        adapter = _Adapter(log)
        orchestrator, files = self.orchestrator(coordinator, adapter, log)
        try:
            result = orchestrator.resume_scripted_phase(cursor=dict(coordinator.cursor))
        finally:
            for item in files: item.close()
        self.assertEqual(result, subject.LocalProcessResult(True, False, False, 0, True))
        self.assertEqual(log, ["resume-scripted-cleanup", "event:SCRIPTED_PHASE_CLEANED"])

    def test_resume_real_dispatches_each_durable_cursor_without_initial_phase_replay(self) -> None:
        cursors = (
            {"kind": "case", "caseId": "REAL-01", "mode": "real"},
            {"kind": "case", "caseId": "LINEAGE-01", "mode": "real"},
            {"kind": "case", "caseId": "REPLAY-01", "mode": "real"},
            {"kind": "action", "action": "cleanup_real_provider_phase"},
            {"kind": "case", "caseId": "RLS-01", "mode": "scripted"},
            {"kind": "case", "caseId": "DELETE-01", "mode": "scripted"},
            {"kind": "action", "action": "begin_ui_probe"},
            {"kind": "case", "caseId": "UI-01", "mode": "real"},
        )
        for index, cursor in enumerate(cursors):
            with self.subTest(cursor=cursor):
                log: list[str] = []
                coordinator = _Coordinator(log)
                coordinator.cursor = dict(cursor)
                adapter = _Adapter(log, coordinator=coordinator)
                orchestrator, files = self.orchestrator(coordinator, adapter, log)
                try:
                    result = orchestrator.resume_real_through_ui(cursor=dict(cursor))
                finally:
                    for item in files: item.close()
                self.assertEqual(result, subject.LocalProcessResult(True, True, True, 1, True))
                self.assertEqual(log, ["resume-real:" + str(cursor.get("caseId", cursor.get("action")))])
                self.assertNotIn("start-real-services", log)
                self.assertNotIn("start-provider-driver", log)


class CleanupVaultRegressionTests(unittest.TestCase):
    def test_copy_locator_rejects_vault_dup_and_replaces_stale_regular_content(self) -> None:
        locator = b"session-bundle:v1:main"
        key = hashlib.sha256(b"cleanup-vault-p1-key").digest()
        locator_hmac = "hmac-sha256:" + hmac.new(key, locator, hashlib.sha256).hexdigest()
        with (
            tempfile.NamedTemporaryFile() as vault_file,
            tempfile.TemporaryFile() as locator_file,
            tempfile.TemporaryFile() as key_file,
            tempfile.TemporaryFile() as output,
        ):
            for item in (vault_file, locator_file, key_file, output):
                os.fchmod(item.fileno(), 0o600)
            locator_file.write(locator)
            key_file.write(key)
            locator_file.flush()
            key_file.flush()
            vault = secure_state.CleanupVault(vault_file.fileno())
            plan_hash = vault.plan(
                resource_alias="real-success-session",
                resource_kind="practice_session",
                action="retain_session",
                locator_hmac=locator_hmac,
                locator_fd=locator_file.fileno(),
                hmac_key_fd=key_file.fileno(),
            )

            vault_alias = os.dup(vault_file.fileno())
            try:
                with self.assertRaisesRegex(ValueError, "^cleanup_vault_output_fd_alias$"):
                    vault.copy_locator(plan_hash, vault_alias)
            finally:
                os.close(vault_alias)
            self.assertEqual(len(vault.entries()), 1)

            stale = b"stale-content-that-must-not-survive-the-copy"
            output.write(stale)
            output.flush()
            vault.copy_locator(plan_hash, output.fileno())
            self.assertEqual(os.fstat(output.fileno()).st_size, len(locator))
            self.assertEqual(os.pread(output.fileno(), len(stale), 0), locator)


if __name__ == "__main__":
    unittest.main()
