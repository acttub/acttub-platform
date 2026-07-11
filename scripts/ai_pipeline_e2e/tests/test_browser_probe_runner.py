from __future__ import annotations

import hashlib
import hmac
import json
import os
import shutil
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
RUNNER = ROOT / "scripts" / "ai_pipeline_e2e" / "browser_probe_runner.mjs"
PROBE = ROOT / "scripts" / "ai_pipeline_e2e" / "browser_probe_source.mjs"
NODE = shutil.which("node")
if NODE is None:
    raise RuntimeError("node_unavailable")

PROJECT_REF = "a" * 20
NONCE = "b" * 64
BROKER_PORT = 32101
TARGET_PORT = 32102
SESSION_ID = "00000000-0000-4000-8000-000000000001"
SOURCE_RUN_ID = "00000000-0000-4000-8000-000000000002"
RAW_CANARY = "Bearer browser-runner-token https://invalid.example/private?cookie=raw"


class BrowserProbeRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = hashlib.sha256(b"offline-browser-runner-key").digest()

    def mac(self, domain: bytes, payload: bytes) -> str:
        return "hmac-sha256:" + hmac.new(self.key, domain + payload, hashlib.sha256).hexdigest()

    def expected_binding_hmac(self) -> str:
        return self.mac(
            b"acttub-browser-binding.v1\0",
            json.dumps([SESSION_ID, SOURCE_RUN_ID], separators=(",", ":")).encode("ascii"),
        )

    def settings(self, **updates: object) -> dict[str, object]:
        development_target = self.mac(
            b"acttub-protected-supabase-project-ref.v1\0",
            PROJECT_REF.encode("ascii"),
        )
        target_semantic = json.dumps(
            [development_target, BROKER_PORT, TARGET_PORT, NONCE],
            separators=(",", ":"),
        ).encode("ascii")
        browser_target = self.mac(
            b"acttub-protected-browser-target.v1\0",
            target_semantic,
        )
        value: dict[str, object] = {
            "schemaVersion": "protected-browser-runner-settings.v1",
            "developmentProjectRef": PROJECT_REF,
            "developmentTargetHmac": development_target,
            "browserTargetHmac": browser_target,
            "nonce": NONCE,
            "brokerPort": BROKER_PORT,
            "targetPort": TARGET_PORT,
        }
        value.update(updates)
        return value

    @staticmethod
    def wrapper(
        settings_fd: int,
        key_fd: int,
        receipt_fd: int,
        binding_fd: int,
        options: dict[str, object],
        probe_binding_hmac: str,
        master_key_hex: str,
        probe_key_hex: str,
    ) -> bytes:
        return f"""
          import {{
            BrowserRunnerFailure,
            TARGET_ASSERTION_SOURCE,
            runProtectedBrowserProbe,
          }} from {json.dumps(RUNNER.as_uri())};
          import {{
            ACTIVATE_SEEK_SOURCE,
            BINDING_IDENTIFIERS_SOURCE,
            OBSERVE_SOURCE,
            VIDEO_TIME_SOURCE,
          }} from {json.dumps(PROBE.as_uri())};

          const options = {json.dumps(options, separators=(",", ":"))};
          const PROJECT_REF = {json.dumps(PROJECT_REF)};
          const TARGET_PORT = {TARGET_PORT};
          const SESSION_ID = {json.dumps(SESSION_ID)};
          const state = {{
            routeHandler: null,
            websocketHandler: null,
            routeContractValid: true,
            launchOptionsValid: false,
            contextOptionsValid: false,
            gotoCount: 0,
            reloadCount: 0,
            waitCount: 0,
            observeCount: 0,
            bindingCount: 0,
            targetAssertionCount: 0,
            actionCount: 0,
            videoCount: 0,
            contextClosed: false,
            browserClosed: false,
          }};
          const contentHmac = "hmac-sha256:" + "c".repeat(64);
          const changedContentHmac = "hmac-sha256:" + "d".repeat(64);
          const bindingHmac = {json.dumps(probe_binding_hmac)};
          const masterKeyHex = {json.dumps(master_key_hex)};
          const probeKeyHex = {json.dumps(probe_key_hex)};

          const observation = (after) => ({{
            schemaVersion: "protected-browser-observation.v1",
            reportRootCount: 1,
            reportSectionCount: 6,
            confirmedCount: options.missingNotConfirmed ? 6 : 5,
            notConfirmedCount: options.missingNotConfirmed ? 0 : 1,
            timestampSeekControlCount: 1,
            seekTargetMs: 2500,
            contentHmac: after && options.mutateAfter ? changedContentHmac : contentHmac,
            bindingHmac,
          }});
          const useRoute = async (rawTarget, expectedAction, navigation = false) => {{
            let action = "";
            await state.routeHandler({{
              request() {{ return {{
                url() {{ return rawTarget; }},
                method() {{ return "GET"; }},
                isNavigationRequest() {{ return navigation; }},
              }}; }},
              async continue() {{ action = "continue"; }},
              async abort(reason) {{ if (reason !== "blockedbyclient") state.routeContractValid = false; action = "abort"; }},
            }});
            if (action !== expectedAction) state.routeContractValid = false;
          }};
          const page = {{
            async goto(rawTarget, gotoOptions) {{
              state.gotoCount += 1;
              if (Object.keys(gotoOptions).sort().join(",") !== "timeout,waitUntil" || gotoOptions.waitUntil !== "domcontentloaded") state.routeContractValid = false;
              await useRoute(rawTarget, "continue", true);
              await useRoute(`http://127.0.0.1:${{TARGET_PORT}}/_next/static/offline.js`, "continue");
              await useRoute(`https://${{PROJECT_REF}}.supabase.co/storage/v1/object/sign/private`, "continue");
              if (options.externalRequest) await useRoute({json.dumps(RAW_CANARY)}, "abort");
              if (options.websocketRequest) await state.websocketHandler({{
                async close(closeOptions) {{
                  if (closeOptions.code !== 1008 || closeOptions.reason !== "blocked") state.routeContractValid = false;
                }},
              }});
            }},
            async reload(reloadOptions) {{
              state.reloadCount += 1;
              if (reloadOptions.waitUntil !== "domcontentloaded") state.routeContractValid = false;
              await useRoute(`http://127.0.0.1:${{TARGET_PORT}}/practice/history/${{SESSION_ID}}`, "continue");
            }},
            async waitForSelector(selector, selectorOptions) {{
              if (!selector.startsWith('[data-testid="pipeline-') || selectorOptions.state !== "attached") state.routeContractValid = false;
              state.waitCount += 1;
              return {{}};
            }},
            async evaluate(source, argument) {{
              if (source === TARGET_ASSERTION_SOURCE) {{
                state.targetAssertionCount += 1;
                if (argument !== TARGET_PORT) state.routeContractValid = false;
                return !options.badFinalTarget;
              }}
              if (source === OBSERVE_SOURCE) {{
                state.observeCount += 1;
                if (!/^[a-f0-9]{{64}}$/u.test(argument) || argument === masterKeyHex || argument !== probeKeyHex) state.routeContractValid = false;
                return observation(state.reloadCount > 0);
              }}
              if (source === BINDING_IDENTIFIERS_SOURCE) {{
                state.bindingCount += 1;
                return {{
                  schemaVersion: "protected-browser-binding-identifiers.v1",
                  sessionId: options.badBindingIdentifiers ? "rejected" : SESSION_ID,
                  sourceRunId: {json.dumps(SOURCE_RUN_ID)},
                }};
              }}
              if (source === ACTIVATE_SEEK_SOURCE) {{
                state.actionCount += 1;
                return {{ schemaVersion: "protected-browser-action.v1", activated: !options.seekFailed }};
              }}
              if (source === VIDEO_TIME_SOURCE) {{
                state.videoCount += 1;
                return {{
                  schemaVersion: "protected-browser-video-time.v1",
                  available: true,
                  currentTimeMs: options.badVideoTime ? 9000 : 2500,
                }};
              }}
              throw new Error("fake_source_rejected");
            }},
          }};
          const context = {{
            async route(pattern, handler) {{
              if (pattern !== "**/*" || typeof handler !== "function") state.routeContractValid = false;
              state.routeHandler = handler;
            }},
            async routeWebSocket(pattern, handler) {{
              if (pattern !== "**/*" || typeof handler !== "function") state.routeContractValid = false;
              state.websocketHandler = handler;
            }},
            async newPage() {{ return page; }},
            pages() {{ return options.extraPage ? [page, {{}}] : [page]; }},
            async close() {{ state.contextClosed = true; if (options.closeFailed) throw new Error("close"); }},
          }};
          const browser = {{
            async newContext(contextOptions) {{
              state.contextOptionsValid = Object.keys(contextOptions).sort().join(",") === "acceptDownloads,serviceWorkers" &&
                contextOptions.acceptDownloads === false && contextOptions.serviceWorkers === "block";
              return context;
            }},
            async close() {{ state.browserClosed = true; }},
          }};
          const dependencyLoader = async () => ({{
            chromium: {{
              async launch(launchOptions) {{
                state.launchOptionsValid = Object.keys(launchOptions).sort().join(",") === "headless,timeout" && launchOptions.headless === true;
                return browser;
              }},
            }},
          }});

          let status = 0;
          try {{
            const receipt = await runProtectedBrowserProbe({{
              settingsFd: {settings_fd},
              macKeyFd: {key_fd},
              receiptFd: {receipt_fd},
              bindingExpectationFd: {binding_fd},
              timeoutMs: 1000,
              dependencyLoader,
            }});
            const validReceipt = Object.keys(receipt).sort().join(",") === "booleanCount,boundedCount,capturedArtifacts,operation,resultHmac,schemaVersion,success";
            const validFlow = state.routeContractValid && state.launchOptionsValid && state.contextOptionsValid &&
              state.gotoCount === 1 && state.reloadCount === 1 && state.waitCount === 4 &&
              state.observeCount === 2 && state.bindingCount === 1 && state.targetAssertionCount === 2 && state.actionCount === 1 && state.videoCount === 1;
            if (!validReceipt || !validFlow || !state.contextClosed || !state.browserClosed || options.expectFailure) status = 91;
          }} catch (error) {{
            const fixed = error instanceof BrowserRunnerFailure && error.safeCode === "BROWSER_PROBE_RUNNER_FAILED" && error.message === "BROWSER_PROBE_RUNNER_FAILED";
            status = fixed && options.expectFailure ? 70 : 91;
          }}
          process.exitCode = status;
        """.encode("utf-8")

    def run_runner(
        self,
        *,
        settings: dict[str, object] | None = None,
        raw_settings: bytes | None = None,
        binding_expectation: dict[str, object] | None = None,
        raw_binding_expectation: bytes | None = None,
        binding_stream: bool = False,
        withhold_binding: bool = False,
        output_mode: int = 0o600,
        **options: object,
    ) -> tuple[subprocess.CompletedProcess[bytes], dict[str, object] | None]:
        actual_settings = settings or self.settings()
        options_payload = {"expectFailure": False, **options}
        expected_binding_hmac = str(
            (binding_expectation or {}).get("expectedBindingHmac", self.expected_binding_hmac())
        )
        probe_semantic = json.dumps(
            [
                actual_settings.get("developmentTargetHmac"),
                actual_settings.get("browserTargetHmac"),
                expected_binding_hmac,
            ],
            separators=(",", ":"),
        ).encode("ascii")
        probe_key = hmac.new(
            self.key,
            b"acttub-protected-browser-probe-subkey.v1\0" + probe_semantic,
            hashlib.sha256,
        ).digest()
        probe_binding = "hmac-sha256:" + hmac.new(
            probe_key,
            b"acttub-browser-binding.v1\0"
            + json.dumps([SESSION_ID, SOURCE_RUN_ID], separators=(",", ":")).encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        wrapper = lambda settings_fd, key_fd, receipt_fd, binding_fd: self.wrapper(
            settings_fd,
            key_fd,
            receipt_fd,
            binding_fd,
            options_payload,
            probe_binding,
            self.key.hex(),
            probe_key.hex(),
        )
        binding_frame = raw_binding_expectation or json.dumps(
            binding_expectation
            or {
                "schemaVersion": "protected-browser-binding-expectation.v1",
                "expectedBindingHmac": expected_binding_hmac,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        with (
            tempfile.TemporaryFile() as settings_file,
            tempfile.TemporaryFile() as key_file,
            tempfile.TemporaryFile() as receipt_file,
            tempfile.TemporaryFile() as binding_file,
        ):
            settings_file.write(raw_settings or json.dumps(actual_settings, separators=(",", ":")).encode("utf-8"))
            settings_file.flush()
            key_file.write(self.key)
            key_file.flush()
            binding_file.write(binding_frame)
            binding_file.flush()
            os.fchmod(receipt_file.fileno(), output_mode)
            binding_parent: socket.socket | None = None
            binding_child: socket.socket | None = None
            binding_fd = binding_file.fileno()
            if binding_stream:
                binding_parent, binding_child = socket.socketpair()
                binding_fd = binding_child.fileno()
                if not withhold_binding:
                    binding_parent.sendall(binding_frame)
                    binding_parent.shutdown(socket.SHUT_WR)
            try:
                completed = subprocess.run(
                    (NODE, "--input-type=module"),
                    input=wrapper(
                        settings_file.fileno(),
                        key_file.fileno(),
                        receipt_file.fileno(),
                        binding_fd,
                    ),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    pass_fds=(
                        settings_file.fileno(),
                        key_file.fileno(),
                        receipt_file.fileno(),
                        binding_fd,
                    ),
                    close_fds=True,
                    env={"PATH": os.defpath},
                    check=False,
                    timeout=5,
                )
            finally:
                if binding_parent is not None:
                    binding_parent.close()
                if binding_child is not None:
                    binding_child.close()
            receipt_file.seek(0)
            raw_receipt = receipt_file.read()
        return completed, json.loads(raw_receipt) if raw_receipt else None

    def assert_silent_fixed_failure(self, **options: object) -> None:
        completed, receipt = self.run_runner(expectFailure=True, **options)
        self.assertEqual(completed.returncode, 70)
        self.assertEqual(completed.stdout, b"")
        self.assertEqual(completed.stderr, b"")
        self.assertIsNone(receipt)

    def test_fake_playwright_runs_one_time_handoff_reload_seek_and_safe_receipt(self) -> None:
        completed, receipt = self.run_runner()
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, b"")
        self.assertEqual(completed.stderr, b"")
        rejected_argument = subprocess.run(
            (NODE, str(RUNNER), "unexpected"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={"PATH": os.defpath},
            check=False,
            timeout=5,
        )
        self.assertEqual(rejected_argument.returncode, 70)
        self.assertEqual(rejected_argument.stdout, b"")
        self.assertEqual(rejected_argument.stderr, b"")
        self.assertEqual(
            set(receipt or {}),
            {
                "schemaVersion",
                "operation",
                "resultHmac",
                "success",
                "booleanCount",
                "boundedCount",
                "capturedArtifacts",
            },
        )
        self.assertEqual(receipt["schemaVersion"], "protected-browser-attestation.v1")  # type: ignore[index]
        self.assertEqual(receipt["operation"], "ui_probe")  # type: ignore[index]
        self.assertIs(receipt["success"], True)  # type: ignore[index]
        self.assertEqual(receipt["booleanCount"], 3)  # type: ignore[index]
        self.assertEqual(receipt["boundedCount"], 2)  # type: ignore[index]
        self.assertEqual(receipt["capturedArtifacts"], 0)  # type: ignore[index]
        self.assertRegex(str(receipt["resultHmac"]), r"^hmac-sha256:[a-f0-9]{64}$")  # type: ignore[index]
        serialized = json.dumps(receipt, separators=(",", ":"))
        for forbidden in (RAW_CANARY, PROJECT_REF, NONCE, SESSION_ID, SOURCE_RUN_ID):
            self.assertNotIn(forbidden, serialized)

    def test_target_capability_and_private_output_fail_closed_before_receipt(self) -> None:
        wrong_development = self.settings(developmentTargetHmac="hmac-sha256:" + "e" * 64)
        wrong_browser_target = self.settings(browserTargetHmac="hmac-sha256:" + "f" * 64)
        wrong_binding = {
            "schemaVersion": "protected-browser-binding-expectation.v1",
            "expectedBindingHmac": "hmac-sha256:" + "9" * 64,
        }
        for label, options in (
            ("development_target", {"settings": wrong_development}),
            ("browser_target", {"settings": wrong_browser_target}),
            ("binding_expectation", {"binding_expectation": wrong_binding}),
            ("output_permissions", {"output_mode": 0o644}),
        ):
            with self.subTest(label=label):
                self.assert_silent_fixed_failure(**options)

    def test_duplicate_unknown_and_non_loopback_semantics_fail_closed(self) -> None:
        canonical = json.dumps(self.settings(), separators=(",", ":"))
        duplicate = (canonical[:-1] + f',"nonce":"{"c" * 64}"}}').encode("utf-8")
        unknown = json.dumps({**self.settings(), "unexpected": RAW_CANARY}, separators=(",", ":")).encode("utf-8")
        for label, options in (
            ("duplicate", {"raw_settings": duplicate}),
            ("unknown", {"raw_settings": unknown}),
            ("binding_duplicate", {"raw_binding_expectation": b'{"schemaVersion":"protected-browser-binding-expectation.v1","expectedBindingHmac":"hmac-sha256:' + b"1" * 64 + b'","expectedBindingHmac":"hmac-sha256:' + b"2" * 64 + b'"}'}),
            ("bad_final_target", {"badFinalTarget": True}),
            ("external_request", {"externalRequest": True}),
            ("websocket_request", {"websocketRequest": True}),
        ):
            with self.subTest(label=label):
                self.assert_silent_fixed_failure(**options)

    def test_binding_expectation_stream_is_supported_and_silently_times_out(self) -> None:
        completed, receipt = self.run_runner(binding_stream=True)
        self.assertEqual(completed.returncode, 0)
        self.assertEqual((completed.stdout, completed.stderr), (b"", b""))
        self.assertIsNotNone(receipt)
        self.assert_silent_fixed_failure(binding_stream=True, withhold_binding=True)

    def test_changed_report_missing_status_seek_video_popup_and_close_fail_closed(self) -> None:
        for label, options in (
            ("changed_report", {"mutateAfter": True}),
            ("missing_not_confirmed", {"missingNotConfirmed": True}),
            ("binding_identifiers", {"badBindingIdentifiers": True}),
            ("seek_failed", {"seekFailed": True}),
            ("video_tolerance", {"badVideoTime": True}),
            ("popup", {"extraPage": True}),
            ("close", {"closeFailed": True}),
        ):
            with self.subTest(label=label):
                self.assert_silent_fixed_failure(**options)

    def test_source_has_no_artifact_or_ambient_input_channels_and_import_is_inert(self) -> None:
        source = RUNNER.read_text(encoding="utf-8")
        for forbidden in (
            "console.",
            "process.env",
            "process.argv[2]",
            "process.stdout",
            "process.stderr",
            "localStorage",
            "sessionStorage",
            "writeFile",
            ".screenshot(",
            ".snapshot(",
            ".trace(",
            "recordHar",
            "saveAs(",
            "accessToken",
            "refreshToken",
            "targetPath",
        ):
            self.assertNotIn(forbidden, source)
        self.assertNotIn('key.toString("hex")', source)
        self.assertIn("deriveBrowserProbeKey(key, probeContext)", source)
        self.assertLess(source.index("page.goto(handoffTarget"), source.index("readBindingExpectation(bindingExpectationFd"))
        completed = subprocess.run(
            (NODE, "--input-type=module"),
            input=f"await import({json.dumps(RUNNER.as_uri())});".encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={"PATH": os.defpath},
            check=False,
            timeout=5,
        )
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, b"")
        self.assertEqual(completed.stderr, b"")

if __name__ == "__main__":
    unittest.main()
