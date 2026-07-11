from __future__ import annotations

import hashlib
import hmac
import http.client
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
BROKER = ROOT / "scripts" / "ai_pipeline_e2e" / "browser_session_broker.mjs"
NODE = shutil.which("node")
if NODE is None:
    raise RuntimeError("node_unavailable")

ACCESS_TOKEN = "offline-access-token-canary.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
REFRESH_TOKEN = "offline-refresh-token-canary-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
PUBLISHABLE_KEY = "offline-publishable-key-canary-CCCCCCCCCCCCCCCCCCCCCCCCCCCC"
NONCE = "d" * 64


def unused_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


class BrokerProcess:
    def __init__(self, process: subprocess.Popen[bytes], receipt: socket.socket) -> None:
        self.process = process
        self.receipt = receipt

    def collect(self, *, timeout: float = 5) -> tuple[bytes, bytes, bytes]:
        stdout, stderr = self.process.communicate(timeout=timeout)
        self.receipt.settimeout(1)
        chunks: list[bytes] = []
        while True:
            try:
                chunk = self.receipt.recv(4096)
            except socket.timeout:
                break
            if not chunk:
                break
            chunks.append(chunk)
        self.receipt.close()
        return stdout, stderr, b"".join(chunks)


class BrowserSessionBrokerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = hashlib.sha256(b"offline-browser-session-broker-key").digest()

    def settings(
        self,
        *,
        broker_port: int | None = None,
        target_port: int | None = None,
        target_path: str = "/reports/offline-session",
        access_token: str = ACCESS_TOKEN,
        refresh_token: str = REFRESH_TOKEN,
    ) -> dict[str, object]:
        hostname = b"offlineproject.supabase.co"
        target_hmac = "hmac-sha256:" + hmac.new(
            self.key,
            b"acttub-platform-development-target.v1\0" + hostname,
            hashlib.sha256,
        ).hexdigest()
        return {
            "schemaVersion": "browser-session-handoff.v1",
            "supabaseUrl": "https://offlineproject.supabase.co",
            "publishableKey": PUBLISHABLE_KEY,
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "nonce": NONCE,
            "brokerPort": broker_port or unused_loopback_port(),
            "targetPort": target_port or unused_loopback_port(),
            "targetPath": target_path,
            "developmentTargetHmac": target_hmac,
        }

    @staticmethod
    def wrapper(input_fd: int, key_fd: int, receipt_fd: int, timeout_ms: int) -> bytes:
        source = f"""
          import crypto from "node:crypto";
          import {{ serveBrowserSessionBroker }} from {json.dumps(BROKER.as_uri())};
          let handedOffSession = null;
          const dependencyLoader = async () => ({{
            createServerClient(url, publishableKey, options) {{
              if (!url.startsWith("https://") || typeof publishableKey !== "string") throw new Error("stub");
              if (Object.keys(options).join(",") !== "cookies") throw new Error("stub");
              return {{
                auth: {{
                  async setSession(session) {{
                    handedOffSession = session;
                    const first = crypto.createHash("sha256").update(session.access_token).digest("hex");
                    const second = crypto.createHash("sha256").update(session.refresh_token).digest("hex");
                    options.cookies.setAll([
                      {{ name: "sb-offline-auth-token.0", value: first, options: {{ path: "/", sameSite: "lax", httpOnly: false, maxAge: 34560000 }} }},
                      {{ name: "sb-offline-auth-token.1", value: second, options: {{ path: "/", sameSite: "lax", httpOnly: false, maxAge: 34560000 }} }},
                    ]);
                    return {{ data: {{ session: {{ present: true }} }}, error: null }};
                  }},
                }},
              }};
            }},
            serializeCookie(name, value, options) {{
              if (handedOffSession.access_token !== "" || handedOffSession.refresh_token !== "") throw new Error("stub");
              if (options.path !== "/" || options.sameSite !== "lax" || options.httpOnly !== false) throw new Error("stub");
              return `${{name}}=${{value}}; Max-Age=${{options.maxAge}}; Path=/; SameSite=Lax`;
            }},
          }});
          let status = 0;
          try {{
            await serveBrowserSessionBroker({{
              inputFd: {input_fd},
              macKeyFd: {key_fd},
              receiptFd: {receipt_fd},
              timeoutMs: {timeout_ms},
              dependencyLoader,
            }});
          }} catch {{
            status = 70;
          }}
          process.exitCode = status;
        """
        return source.encode("utf-8")

    def launch(
        self,
        settings: dict[str, object],
        *,
        raw_input: bytes | None = None,
        timeout_ms: int = 1500,
        regular_input_file: bool = False,
    ) -> BrokerProcess:
        key_parent, key_child = socket.socketpair()
        receipt_parent, receipt_child = socket.socketpair()
        input_parent: socket.socket | None = None
        input_file: Any | None = None
        if regular_input_file:
            input_file = tempfile.TemporaryFile()
            input_file.write(raw_input or json.dumps(settings, separators=(",", ":")).encode("utf-8"))
            input_file.flush()
            input_fd = input_file.fileno()
        else:
            input_parent, input_child = socket.socketpair()
            input_fd = input_child.fileno()

        pass_fds = [input_fd, key_child.fileno(), receipt_child.fileno()]
        process = subprocess.Popen(
            (NODE, "--input-type=module"),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            pass_fds=tuple(pass_fds),
            close_fds=True,
            env={"PATH": os.defpath},
        )
        assert process.stdin is not None
        process.stdin.write(self.wrapper(input_fd, key_child.fileno(), receipt_child.fileno(), timeout_ms))
        process.stdin.close()
        key_child.close()
        receipt_child.close()
        key_parent.sendall(self.key)
        key_parent.shutdown(socket.SHUT_WR)
        key_parent.close()
        if input_parent is not None:
            input_child.close()
            input_parent.sendall(raw_input or json.dumps(settings, separators=(",", ":")).encode("utf-8"))
            input_parent.shutdown(socket.SHUT_WR)
            input_parent.close()
        if input_file is not None:
            input_file.close()
        return BrokerProcess(process, receipt_parent)

    @staticmethod
    def request(
        port: int,
        method: str,
        path: str,
        *,
        host: str | None = None,
        retries: int = 60,
    ) -> tuple[int, list[tuple[str, str]]]:
        last_error: OSError | None = None
        for _ in range(retries):
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=0.5)
            try:
                headers = {"Host": host} if host is not None else {}
                connection.request(method, path, headers=headers)
                response = connection.getresponse()
                result = response.status, response.getheaders()
                response.read()
                connection.close()
                return result
            except OSError as error:
                last_error = error
                connection.close()
                time.sleep(0.025)
        raise AssertionError("loopback_broker_unavailable") from last_error

    def assert_no_secret_artifacts(self, *artifacts: object) -> None:
        serialized = "\n".join(
            artifact.decode("utf-8", errors="replace") if isinstance(artifact, bytes) else str(artifact)
            for artifact in artifacts
        )
        for secret in (ACCESS_TOKEN, REFRESH_TOKEN, PUBLISHABLE_KEY):
            self.assertNotIn(secret, serialized)

    def test_one_get_sets_stubbed_ssr_cookies_redirects_and_emits_only_safe_receipt(self) -> None:
        settings = self.settings()
        broker = self.launch(settings)
        route = f"/__acttub_session/{NONCE}"
        broker.receipt.settimeout(0.05)
        with self.assertRaises(socket.timeout):
            broker.receipt.recv(1)
        status, headers = self.request(int(settings["brokerPort"]), "GET", route)
        stdout, stderr, raw_receipt = broker.collect()

        self.assertEqual(status, 302)
        self.assertEqual(broker.process.returncode, 0)
        self.assertEqual(stdout, b"")
        self.assertEqual(stderr, b"")
        header_map: dict[str, list[str]] = {}
        for name, value in headers:
            header_map.setdefault(name.casefold(), []).append(value)
        self.assertEqual(header_map["location"], [f"http://127.0.0.1:{settings['targetPort']}{settings['targetPath']}"])
        self.assertEqual(len(header_map["set-cookie"]), 2)
        self.assertEqual(header_map["cache-control"], ["no-store, max-age=0"])
        receipt = json.loads(raw_receipt)
        self.assertEqual(set(receipt), {"schemaVersion", "operation", "success", "resultHmac"})
        self.assertEqual(receipt["schemaVersion"], "browser-session-handoff-receipt.v1")
        self.assertEqual(receipt["operation"], "browser_session_handoff")
        self.assertIs(receipt["success"], True)
        self.assertRegex(receipt["resultHmac"], r"^hmac-sha256:[a-f0-9]{64}$")
        self.assert_no_secret_artifacts(route, headers, raw_receipt, stdout, stderr, broker.process.args, {"PATH": os.defpath})

        with self.assertRaises((ConnectionError, OSError, AssertionError)):
            self.request(int(settings["brokerPort"]), "GET", route, retries=2)

    def test_receipt_binds_tokens_without_returning_them(self) -> None:
        receipts: list[str] = []
        cookies: list[list[str]] = []
        for suffix in ("X", "Y"):
            settings = self.settings(
                access_token=ACCESS_TOKEN + suffix,
                refresh_token=REFRESH_TOKEN + suffix,
            )
            broker = self.launch(settings)
            status, headers = self.request(
                int(settings["brokerPort"]),
                "GET",
                f"/__acttub_session/{NONCE}",
            )
            stdout, stderr, raw_receipt = broker.collect()
            self.assertEqual((status, broker.process.returncode, stdout, stderr), (302, 0, b"", b""))
            receipts.append(json.loads(raw_receipt)["resultHmac"])
            cookies.append([value for name, value in headers if name.casefold() == "set-cookie"])
            self.assert_no_secret_artifacts(headers, raw_receipt, stdout, stderr)
        self.assertNotEqual(receipts[0], receipts[1])
        self.assertNotEqual(cookies[0], cookies[1])

    def test_wrong_method_route_query_or_host_consumes_the_broker_and_fails_silent(self) -> None:
        cases = (
            ("method", "POST", f"/__acttub_session/{NONCE}", None),
            ("route", "GET", "/__acttub_session/" + "e" * 64, None),
            ("query", "GET", f"/__acttub_session/{NONCE}?token=not-accepted", None),
            ("host", "GET", f"/__acttub_session/{NONCE}", "localhost"),
        )
        for label, method, route, host in cases:
            with self.subTest(label=label):
                settings = self.settings()
                broker = self.launch(settings)
                expected_host = f"{host}:{settings['brokerPort']}" if host else None
                status, headers = self.request(
                    int(settings["brokerPort"]),
                    method,
                    route,
                    host=expected_host,
                )
                stdout, stderr, raw_receipt = broker.collect()
                self.assertEqual(status, 404)
                self.assertEqual(broker.process.returncode, 70)
                self.assertEqual(stdout, b"")
                self.assertEqual(stderr, b"")
                self.assertEqual(raw_receipt, b"")
                self.assertFalse(any(name.casefold() in {"set-cookie", "location"} for name, _value in headers))
                self.assert_no_secret_artifacts(route, headers, raw_receipt, stdout, stderr, broker.process.args)

    def test_duplicate_unknown_token_path_and_regular_file_inputs_fail_closed(self) -> None:
        base = self.settings()
        canonical = json.dumps(base, separators=(",", ":"))
        duplicate = canonical[:-1] + ',"nonce":"' + "e" * 64 + '"}'
        unknown = json.dumps({**base, "unexpected": ACCESS_TOKEN}, separators=(",", ":")).encode("utf-8")
        token_path = self.settings(target_path=f"/reports/{ACCESS_TOKEN}")
        cases = (
            ("duplicate", duplicate.encode("utf-8"), base, False),
            ("unknown", unknown, base, False),
            ("token_path", None, token_path, False),
            ("regular_file", None, base, True),
        )
        for label, raw_input, settings, regular_file in cases:
            with self.subTest(label=label):
                broker = self.launch(
                    settings,
                    raw_input=raw_input,
                    regular_input_file=regular_file,
                    timeout_ms=200,
                )
                stdout, stderr, raw_receipt = broker.collect()
                self.assertEqual(broker.process.returncode, 70)
                self.assertEqual(stdout, b"")
                self.assertEqual(stderr, b"")
                self.assertEqual(raw_receipt, b"")
                self.assert_no_secret_artifacts(raw_receipt, stdout, stderr, broker.process.args)

    def test_unused_broker_expires_quickly_without_a_receipt_or_output(self) -> None:
        settings = self.settings()
        broker = self.launch(settings, timeout_ms=150)
        stdout, stderr, raw_receipt = broker.collect(timeout=3)
        self.assertEqual(broker.process.returncode, 70)
        self.assertEqual(stdout, b"")
        self.assertEqual(stderr, b"")
        self.assertEqual(raw_receipt, b"")
        self.assert_no_secret_artifacts(raw_receipt, stdout, stderr, broker.process.args)

    def test_import_is_inert_and_source_has_no_secret_or_artifact_channels(self) -> None:
        source = BROKER.read_text(encoding="utf-8")
        self.assert_no_secret_artifacts(source)
        for forbidden in (
            "console.",
            "process.env",
            "process.argv.slice",
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
        ):
            self.assertNotIn(forbidden, source)
        completed = subprocess.run(
            (NODE, "--input-type=module"),
            input=f"await import({json.dumps(BROKER.as_uri())});".encode("utf-8"),
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
