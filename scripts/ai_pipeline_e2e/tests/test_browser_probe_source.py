from __future__ import annotations

import hashlib
import hmac
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PROBE = ROOT / "scripts" / "ai_pipeline_e2e" / "browser_probe_source.mjs"
NODE = shutil.which("node")
if NODE is None:
    raise RuntimeError("node_unavailable")
RAW_CONTENT = "Bearer browser-token https://invalid.example/private cookie=raw-content"


class BrowserProbeSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = hashlib.sha256(b"offline-browser-probe-key").digest()

    def run_probe(
        self,
        *,
        section_suffix: str = "",
        mutate_after: bool = False,
        extra_observation_key: bool = False,
        wrong_binding: bool = False,
    ) -> tuple[subprocess.CompletedProcess[bytes], dict[str, object] | None]:
        with tempfile.TemporaryFile() as key_file, tempfile.TemporaryFile() as output_file:
            key_file.write(self.key)
            key_file.flush()
            session_id = "00000000-0000-4000-8000-000000000001"
            source_run_id = "00000000-0000-4000-8000-000000000002"
            binding_hmac = "hmac-sha256:" + hmac.new(
                self.key,
                b'acttub-browser-binding.v1\0["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002"]',
                hashlib.sha256,
            ).hexdigest()
            wrapper = f"""
              import {{ webcrypto }} from "node:crypto";
              import {{
                OBSERVE_SOURCE,
                ACTIVATE_SEEK_SOURCE,
                VIDEO_TIME_SOURCE,
                BINDING_IDENTIFIERS_SOURCE,
                createBrowserAttestation,
                deriveBrowserProbeKey,
                writeBrowserAttestation,
              }} from {json.dumps(PROBE.as_uri())};
              const rawMarker = {json.dumps(RAW_CONTENT)};
              const suffix = {json.dumps(section_suffix)};
              const sessionId = {json.dumps(session_id)};
              const sourceRunId = {json.dumps(source_run_id)};
              const masterKey = Buffer.from({json.dumps(self.key.hex())}, "hex");
              const expectedBindingHmac = {json.dumps("hmac-sha256:" + "0" * 64 if wrong_binding else binding_hmac)};
              const probeContext = {{
                schemaVersion: "protected-browser-probe-key-context.v1",
                developmentTargetHmac: "hmac-sha256:" + "d".repeat(64),
                browserTargetHmac: "hmac-sha256:" + "e".repeat(64),
                expectedBindingHmac,
              }};
              const probeKey = deriveBrowserProbeKey(masterKey, probeContext);
              const macKeyHex = probeKey.toString("hex");
              if (macKeyHex === masterKey.toString("hex")) throw new Error("probe");
              let seekClicks = 0;
              let changed = false;
              const section = (index) => ({{
                textContent: rawMarker + suffix + String(index) + (changed ? "changed" : ""),
                getAttribute(name) {{
                  if (name === "data-report-section") return "section-" + String(index);
                  if (name === "data-report-status") return index === 5 ? "not_confirmed" : "confirmed";
                  return null;
                }},
              }});
              const control = {{
                getAttribute(name) {{ return name === "data-seek-start-ms" ? "2500" : null; }},
                click() {{ seekClicks += 1; }},
              }};
              const video = {{ currentTime: 2.5 }};
              const document = {{
                querySelectorAll(selector) {{
                  if (selector === '[data-testid="pipeline-report"]') return [{{
                    getAttribute(name) {{
                      if (name === "data-report-session-id") return sessionId;
                      if (name === "data-report-source-run-id") return sourceRunId;
                      return null;
                    }},
                  }}];
                  if (selector === '[data-testid="pipeline-report-section"]') return Array.from({{ length: 6 }}, (_, index) => section(index));
                  if (selector === '[data-testid="pipeline-report-seek"]') return [control];
                  return [];
                }},
                querySelector(selector) {{
                  return selector === '[data-testid="pipeline-private-video"]' ? video : null;
                }},
              }};
              const evaluate = (source, argument) => Function(
                "document",
                "crypto",
                "TextEncoder",
                "argument",
                `return (${{source}})(argument)`,
              )(document, webcrypto, TextEncoder, argument);
              let status = 0;
              try {{
                const before = await evaluate(OBSERVE_SOURCE, macKeyHex);
                const binding = await evaluate(BINDING_IDENTIFIERS_SOURCE);
                const seekAction = await evaluate(ACTIVATE_SEEK_SOURCE);
                const videoResult = await evaluate(VIDEO_TIME_SOURCE);
                changed = {str(mutate_after).lower()};
                const after = await evaluate(OBSERVE_SOURCE, macKeyHex);
                if ({str(extra_observation_key).lower()}) before.unexpected = rawMarker;
                if (seekClicks !== 1) throw new Error(rawMarker);
                const result = createBrowserAttestation({{
                  before,
                  after,
                  seekAction,
                  video: videoResult,
                  binding,
                  expectedBindingHmac,
                  probeContext,
                  macKeyFd: {key_file.fileno()},
                }});
                writeBrowserAttestation({output_file.fileno()}, result);
              }} catch {{
                status = 70;
              }} finally {{
                probeKey.fill(0);
                masterKey.fill(0);
              }}
              process.exitCode = status;
            """
            completed = subprocess.run(
                (NODE, "--input-type=module"),
                input=wrapper.encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                pass_fds=(key_file.fileno(), output_file.fileno()),
                close_fds=True,
                env={"PATH": os.defpath},
                check=False,
                timeout=5,
            )
            output_file.seek(0)
            raw = output_file.read()
        return completed, json.loads(raw) if raw else None

    def test_offline_semantic_probe_emits_only_controller_compatible_attestation(self) -> None:
        completed, result = self.run_probe()
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, b"")
        self.assertEqual(completed.stderr, b"")
        self.assertEqual(set(result or {}), {
            "schemaVersion",
            "operation",
            "resultHmac",
            "success",
            "booleanCount",
            "boundedCount",
            "capturedArtifacts",
        })
        self.assertEqual(result["schemaVersion"], "protected-browser-attestation.v1")  # type: ignore[index]
        self.assertEqual(result["operation"], "ui_probe")  # type: ignore[index]
        self.assertIs(result["success"], True)  # type: ignore[index]
        self.assertEqual(result["booleanCount"], 3)  # type: ignore[index]
        self.assertEqual(result["boundedCount"], 2)  # type: ignore[index]
        self.assertEqual(result["capturedArtifacts"], 0)  # type: ignore[index]
        self.assertRegex(result["resultHmac"], r"^hmac-sha256:[a-f0-9]{64}$")  # type: ignore[arg-type,index]
        serialized = json.dumps(result, separators=(",", ":"))
        for forbidden in (RAW_CONTENT, "invalid.example", "browser-token", "cookie=", "section-0"):
            self.assertNotIn(forbidden, serialized)

    def test_result_hmac_binds_ephemeral_content_hmac_without_returning_content(self) -> None:
        first_completed, first = self.run_probe(section_suffix="first")
        second_completed, second = self.run_probe(section_suffix="second")
        self.assertEqual((first_completed.returncode, second_completed.returncode), (0, 0))
        self.assertNotEqual(first["resultHmac"], second["resultHmac"])  # type: ignore[index]
        self.assertNotIn("first", json.dumps(first))
        self.assertNotIn("second", json.dumps(second))

    def test_refresh_change_and_unknown_semantic_fields_fail_closed_and_silent(self) -> None:
        for label, options in (
            ("refresh_changed", {"mutate_after": True}),
            ("unknown_field", {"extra_observation_key": True}),
            ("wrong_real_session_binding", {"wrong_binding": True}),
        ):
            with self.subTest(label=label):
                completed, result = self.run_probe(**options)
                self.assertEqual(completed.returncode, 70)
                self.assertEqual(completed.stdout, b"")
                self.assertEqual(completed.stderr, b"")
                self.assertIsNone(result)

    def test_browser_sources_use_only_stable_semantic_selectors_and_forbid_capture_persistence(self) -> None:
        source = PROBE.read_text(encoding="utf-8")
        for selector in (
            'data-testid="pipeline-report"',
            'data-testid="pipeline-report-section"',
            'data-testid="pipeline-report-seek"',
            'data-testid="pipeline-private-video"',
            "protected-browser-binding-identifiers.v1",
        ):
            self.assertIn(selector, source)
        for forbidden in (
            ".screenshot(",
            ".snapshot(",
            ".trace(",
            "recordHar",
            "saveAs(",
            "console.",
            "document.body",
            "outerHTML",
            "innerHTML",
            "localStorage",
            "sessionStorage",
            "writeFile",
            "process.env",
            "process.argv",
            "process.stdout",
            "process.stderr",
        ):
            self.assertNotIn(forbidden, source)
        self.assertNotIn("src=", source)
        self.assertNotIn("cookie", source.casefold())
        self.assertNotIn('crypto.subtle.digest("SHA-256"', source)

    def test_import_is_inert_and_silent(self) -> None:
        completed = subprocess.run(
            (NODE, "--input-type=module"),
            input=f"await import({json.dumps(PROBE.as_uri())});".encode("utf-8"),
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
