"""Smoke startup and error reporting at the manager subprocess boundary."""
from pathlib import Path
from contextlib import redirect_stdout
import io
import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import smoke
import manage


class SmokeTest(unittest.TestCase):
    def manager(self, action="verify"):
        return [sys.executable, str(smoke.ROOT / "manage.py"), "--state-dir",
                "/tmp/private-NEVER-PRINT", action, "v1"]

    def test_failed_manager_reports_only_safe_stderr_and_action(self):
        for action in ("render", "apply", "verify", "capacity", "rollback"):
            with self.subTest(action=action):
                argv = self.manager(action)
                result = subprocess.CompletedProcess(argv, 1, "resolved-NEVER-PRINT",
                    "raw-NEVER-PRINT\nmonitoring: required scrape target missing or down\n"
                    "Authorization: Bearer NEVER-PRINT\n")
                with patch.object(smoke.subprocess, "run", return_value=result):
                    with self.assertRaises(RuntimeError) as error:
                        smoke.run(argv)
                self.assertEqual(str(error.exception), "manage.py " + action +
                    " failed: monitoring: required scrape target missing or down")

    def test_manager_without_safe_error_withholds_output(self):
        argv = self.manager()
        result = subprocess.CompletedProcess(argv, 1, "resolved-NEVER-PRINT", "raw-NEVER-PRINT")
        with patch.object(smoke.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(RuntimeError, r"^manage.py verify failed \(output withheld\)$"):
                smoke.run(argv)

    def test_manager_timeout_does_not_print_command_arguments(self):
        argv = self.manager()
        failure = subprocess.TimeoutExpired(argv, 1, output="raw-NEVER-PRINT", stderr="raw-NEVER-PRINT")
        with patch.object(smoke.subprocess, "run", side_effect=failure):
            with self.assertRaisesRegex(RuntimeError, r"^manage.py verify timed out \(output withheld\)$"):
                smoke.run(argv)

    def test_non_manager_cannot_supply_trusted_monitoring_error(self):
        argv = [sys.executable, "/tmp/manage.py", "verify", "v1"]
        result = subprocess.CompletedProcess(argv, 1, "", "monitoring: untrusted-NEVER-PRINT")
        with patch.object(smoke.subprocess, "run", return_value=result):
            with self.assertRaises(RuntimeError) as error:
                smoke.run(argv)
        self.assertNotIn("NEVER-PRINT", str(error.exception))

    def startup(self, self_scrape_after):
        """Run the real startup sequence and strict verify with a delayed self-scrape.

        App/collector health is already available. Only the first self-scrape
        is pending, just as independently scheduled scrape jobs can be at boot.
        Docker I/O and time are replaced; the smoke's ordering is unchanged.
        """
        class Verified(Exception):
            pass

        elapsed = 0
        verified = []

        def sleep(seconds):
            nonlocal elapsed
            elapsed += seconds

        def query(_release, expression):
            sample = {"metric": {"environment": "dev"}, "value": [0, "1"]}
            if expression == "up":
                targets = [("api", "dev"), ("db-health", ""), ("backup", ""), ("node", "shared")]
                if elapsed >= self_scrape_after:
                    targets.append(("prometheus", "shared"))
                return {"result": [{"metric": {"job": job, "environment": env}, "value": [0, "1"]}
                                   for job, env in targets]}
            if expression == '{environment="prod"}' or (
                    'job="prometheus"' in expression and elapsed < self_scrape_after):
                return {"result": []}
            return {"result": [sample]}

        def run(argv, **_kwargs):
            if argv[:2] == [sys.executable, str(smoke.ROOT / "manage.py")] and argv[-2] == "verify":
                # Exercise the production validator, not a weaker smoke-only verdict.
                manage.verify(Path("unused"))
                verified.append(elapsed)
                raise Verified
            if argv[:2] == ["docker", "info"]:
                return "/var/lib/docker"
            if argv[-1] == "/host/proc/1/mountinfo":
                return "1 0 0:1 / / rw - ext4 fixture rw\n"
            if argv[-3:] == ["config", "--format", "json"]:
                return json.dumps({"services": {"backup-exporter": {"image": "fixture-image"}},
                                   "networks": {}, "volumes": {}})
            if "/api/v1/query?" in argv[-1]:
                expression = parse_qs(urlparse(argv[-1]).query)["query"][0]
                return json.dumps({"status": "success", "data": query(None, expression)})
            return ""

        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()), \
                patch.dict(smoke.os.environ, MONITORING_SMOKE_API_IMAGE="fixture-api", MONITORING_SMOKE_WEB_IMAGE="fixture-web"), \
                patch.object(smoke.tempfile, "mkdtemp", return_value=directory), \
                patch.object(smoke, "run", side_effect=run), \
                patch.object(smoke.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)), \
                patch.object(smoke.time, "monotonic", side_effect=lambda: elapsed), \
                patch.object(smoke.time, "sleep", side_effect=sleep), \
                patch.object(manage, "validate"), \
                patch.object(manage, "read_config", return_value={"environments": {"dev": {}}, "data_mountpoint": "/"}), \
                patch.object(manage, "query", side_effect=query):
            if self_scrape_after < 100:
                with self.assertRaises(Verified):
                    smoke.main()
                self.assertEqual(verified, [self_scrape_after])
            else:
                with self.assertRaisesRegex(RuntimeError, "Prometheus self-scrape was not ready"):
                    smoke.main()
                self.assertEqual(verified, [])
                self.assertEqual(elapsed, 100)

    def test_startup_waits_for_initial_self_scrape_before_strict_verify(self):
        self.startup(self_scrape_after=2)

    def test_missing_self_scrape_still_fails_with_bounded_wait(self):
        self.startup(self_scrape_after=float("inf"))


if __name__ == "__main__":
    unittest.main()
