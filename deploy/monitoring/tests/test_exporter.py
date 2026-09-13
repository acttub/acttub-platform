"""Exporter contract: controlled state files / management HTTP -> real metrics HTTP."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread
from urllib.error import HTTPError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


class ExporterHTTPTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.path = Path(self.work.name)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]

    def start(self, mode="backup", config=None):
        cfg = self.path / "config.json"
        cfg.write_text(json.dumps(config or {
            "dev": {"state_dir": str(self.path), "target": "s3://test-backups/dev/:acttub"},
            "prod": {"state_dir": str(self.path / "prod"), "target": "s3://test-backups/prod/:acttub"},
        }))
        self.process = subprocess.Popen(
            [sys.executable, str(ROOT / "exporter.py"), mode, "--config", str(cfg),
             "--listen", "127.0.0.1", "--port", str(self.port)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env={"PATH": os.environ["PATH"]},
        )
        self.addCleanup(self.stop)
        for _ in range(100):
            if self.process.poll() is not None:
                self.fail("exporter exited before HTTP became available")
            try:
                return self.metrics()
            except OSError:
                time.sleep(0.02)
        self.fail("exporter did not serve HTTP")

    def stop(self):
        self.process.terminate()
        self.process.wait(timeout=5)

    def metrics(self):
        with urlopen(f"http://127.0.0.1:{self.port}/metrics", timeout=10) as response:
            return response.read().decode()

    def test_missing_state_is_not_a_success(self):
        body = self.start()
        self.assertIn('acttub_backup_state{environment="dev",state="missing"} 1\n', body)
        self.assertIn('acttub_backup_state_read_success{environment="dev"} 0\n', body)
        self.assertIn('acttub_backup_last_success_timestamp_seconds{environment="dev"} 0\n', body)

    def test_state_changes_are_observed_without_restart_or_sensitive_labels(self):
        self.start()
        timestamp = int(time.time()) - 3600
        valid = {"backup_target": "s3://test-backups/dev/:acttub", "last_result": "success",
                 "last_success_epoch": timestamp, "last_success_uri": "s3://private-object",
                 "last_success_sha256": "private-hash"}
        cases = [
            (valid, "ok", timestamp, 1, 1, 0),
            ({**valid, "last_result": "failed", "last_error": "private-error"},
             "unresolved_failure", timestamp, 1, 1, 1),
            ({**valid, "last_result": "running", "last_error": "private-error"},
             "unresolved_failure", timestamp, 1, 1, 1),
            ({**valid, "backup_target": "s3://other/prod/:acttub"}, "target_mismatch", 0, 1, 0, 0),
            ({"last_result": "running"}, "no_success", 0, 1, 0, 0),
            ({"last_result": "failed", "last_error": "private-error"},
             "unresolved_failure", 0, 1, 0, 1),
            ([], "corrupt", 0, 0, 0, 0),
            ({**valid, "last_result": "unexpected"}, "corrupt", 0, 0, 0, 0),
        ]
        for value in [True, False, float("nan"), float("inf"), -1, 0, time.time() + 3600, "123"]:
            cases.append(({**valid, "last_success_epoch": value}, "corrupt", 0, 0, 0, 0))
        for state, status, success_time, readable, target_match, failure in cases:
            with self.subTest(state=state):
                (self.path / "status.json").write_text(json.dumps(state))
                body = self.metrics()
                self.assertIn(f'acttub_backup_state{{environment="dev",state="{status}"}} 1\n', body)
                for name, expected in [("last_success_timestamp_seconds", success_time),
                                       ("state_read_success", readable), ("target_match", target_match),
                                       ("unresolved_failure", failure)]:
                    self.assertIn(f'acttub_backup_{name}{{environment="dev"}} {expected}\n', body)
                for secret in ["private-", "s3://", "backup_target="]:
                    self.assertNotIn(secret, body)
        (self.path / "status.json").write_text("{broken")
        self.assertIn('state="corrupt"} 1\n', self.metrics())

    @unittest.skipIf(os.getuid() == 0, "permission denial requires an unprivileged HTTP exporter")
    def test_unreadable_state_is_distinct_from_missing(self):
        state = self.path / "status.json"
        state.write_text("{}")
        state.chmod(0)
        self.addCleanup(state.chmod, 0o600)
        self.assertIn('state="unreadable"} 1\n', self.start())

    def test_db_probe_checks_authenticated_health_and_never_follows_redirects(self):
        replies = {"status": 200, "body": b'{"status":"UP"}'}
        requests = []
        slow_started = Event()

        class Health(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get("Authorization")))
                self.send_response(replies["status"])
                self.send_header("Location", "/other-destination")
                self.end_headers()
                try:
                    if replies.get("slow"):
                        slow_started.set()
                        for byte in replies["body"]:
                            self.wfile.write(bytes([byte]))
                            self.wfile.flush()
                            time.sleep(0.3)
                    else:
                        self.wfile.write(replies["body"])
                except OSError:
                    pass

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Health)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        Thread(target=server.serve_forever, daemon=True).start()
        token = self.path / "token"
        token.write_text("probe-test-token")
        target = {"url": f"http://127.0.0.1:{server.server_port}/actuator/health/db", "token_file": str(token)}
        self.start("db", {"dev": target, "prod": target})
        for code, body, expected in [(200, b'{"status":"UP"}', 1), (503, b'{"status":"DOWN"}', 0),
                                     (200, b'{"status":"DOWN"}', 0), (200, b'not-json', 0),
                                     (401, b'{}', 0), (302, b'{"status":"UP"}', 0)]:
            replies.update(status=code, body=body)
            metrics = self.metrics()
            self.assertIn(f'acttub_db_probe_success{{environment="dev"}} {expected}\n', metrics)
            self.assertIn('acttub_db_probe_duration_seconds{environment="dev"}', metrics)
            self.assertNotIn("probe-test-token", metrics)
        self.assertTrue(requests)
        self.assertTrue(all(path == "/actuator/health/db" and auth == "Bearer probe-test-token"
                            for path, auth in requests))
        # Frequent bytes defeat a socket's inactivity timeout. The whole probe
        # must still have a deadline, including DNS and response-body reading.
        replies.update(status=200, body=b'{"status":"UP"}', slow=True)
        start = time.monotonic()
        results = []
        request_thread = Thread(target=lambda: results.append(self.metrics()), daemon=True)
        request_thread.start()
        self.addCleanup(request_thread.join, 8)
        self.assertTrue(slow_started.wait(2), "slow upstream HTTP probe did not start")
        with self.assertRaises(HTTPError) as busy:
            self.metrics()
        self.assertEqual(busy.exception.code, 503)
        request_thread.join(7)
        self.assertEqual(len(results), 1)
        metrics = results[0]
        self.assertLess(time.monotonic() - start, 7)
        self.assertIn('acttub_db_probe_success{environment="dev"} 0\n', metrics)


if __name__ == "__main__":
    unittest.main()
