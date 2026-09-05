#!/usr/bin/env python3
"""CLI의 성공 판정·실패 보존·건강 상태를 외부 명령 경계에서 검증한다."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

SCRIPT = Path(__file__).resolve().parents[1] / "backup.py"


class BackupCliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        shutil.copyfile(Path(__file__).with_name("fake_aws.py"), self.bin / "aws")
        (self.bin / "aws").chmod(0o755)
        (self.bin / "pg_dump").write_text(
            f"#!{sys.executable}\nimport os, pathlib, sys, time\n"
            "time.sleep(float(os.environ.get('FAKE_PG_DELAY', '0')))\n"
            "if os.environ.get('FAKE_PG_FAIL'): sys.exit(7)\n"
            "pathlib.Path(sys.argv[sys.argv.index('--file') + 1]).write_bytes(b'PGDMP-fixture')\n"
        )
        (self.bin / "pg_restore").write_text(f"#!{sys.executable}\n")
        for file in self.bin.iterdir():
            file.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "BACKUP_STATE_DIR": str(self.root / "state"),
            "BACKUP_S3_BUCKET": "acttub-db-backups",
            "BACKUP_S3_PREFIX": "prod/",
            "TZ": "Asia/Seoul",
            "FAKE_S3_DIR": str(self.root / "s3"),
            "PGHOST": "db", "PGUSER": "acttub", "PGDATABASE": "acttub",
            "PGPASSWORD": "MUST_NOT_LEAK",
            "AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "MUST_NOT_LEAK",
        }

    def run_cli(self, command, **env):
        return subprocess.run([sys.executable, str(SCRIPT), command], env={**self.env, **env}, capture_output=True, text=True, timeout=10)

    def state(self):
        return json.loads((self.root / "state" / "status.json").read_text())

    def test_success_requires_upload_and_remote_metadata_then_becomes_healthy(self):
        self.assertNotEqual(self.run_cli("health").returncode, 0)
        result = self.run_cli("once")
        self.assertEqual(result.returncode, 0, result.stderr)
        state = self.state()
        self.assertEqual(state["last_result"], "success")
        self.assertGreater(state["last_success_epoch"], 0)
        self.assertTrue(state["last_success_uri"].startswith("s3://acttub-db-backups/prod/"))
        self.assertEqual(self.run_cli("health").returncode, 0)
        self.assertEqual((self.root / "state" / "status.json").stat().st_mode & 0o777, 0o600)
        calls = [json.loads(line) for line in (self.root / "s3" / "calls.jsonl").read_text().splitlines()]
        self.assertEqual([call[:2] for call in calls], [["s3", "cp"], ["s3api", "head-object"]])
        self.assertIn("AES256", calls[0])

    def test_failed_upload_is_nonzero_unhealthy_and_preserves_previous_success(self):
        self.assertEqual(self.run_cli("once").returncode, 0)
        before = self.state()
        result = self.run_cli("once", FAKE_AWS_MODE="fail-upload")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("upload", result.stderr)
        self.assertNotIn("MUST_NOT_LEAK", result.stdout + result.stderr)
        self.assertEqual(self.state()["last_success_epoch"], before["last_success_epoch"])
        self.assertEqual(self.state()["last_success_uri"], before["last_success_uri"])
        self.assertEqual(self.state()["last_result"], "failed")
        self.assertNotEqual(self.run_cli("health").returncode, 0)
        self.assertEqual(self.run_cli("once").returncode, 0)
        self.assertEqual(self.run_cli("health").returncode, 0)

    def test_failed_dump_never_uploads(self):
        result = self.run_cli("once", FAKE_PG_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("dump", result.stderr)
        self.assertFalse((self.root / "s3" / "calls.jsonl").exists())

    def test_retry_stays_unhealthy_until_a_new_upload_succeeds(self):
        self.assertEqual(self.run_cli("once").returncode, 0)
        self.assertNotEqual(self.run_cli("once", FAKE_AWS_MODE="fail-upload").returncode, 0)
        process = subprocess.Popen([sys.executable, str(SCRIPT), "once"],
                                   env={**self.env, "FAKE_PG_DELAY": "1"},
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            for _ in range(100):
                if self.state()["last_result"] == "running":
                    break
                time.sleep(0.01)
            self.assertEqual(self.state()["last_result"], "running")
            during_retry = self.run_cli("health").returncode
            process.communicate(timeout=5)
            self.assertNotEqual(during_retry, 0)
            self.assertEqual(process.returncode, 0)
            self.assertEqual(self.run_cli("health").returncode, 0)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_missing_and_mismatched_remote_objects_are_not_success(self):
        for mode in ["fail-head", "corrupt-length", "corrupt-checksum"]:
            with self.subTest(mode=mode):
                result = self.run_cli("once", FAKE_AWS_MODE=mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.state()["last_result"], "failed")
                self.assertNotEqual(self.run_cli("health").returncode, 0)

    def test_stale_and_future_success_are_unhealthy(self):
        self.assertEqual(self.run_cli("once").returncode, 0)
        for epoch in [int(time.time()) - 27 * 3600, int(time.time()) + 3600]:
            state = self.state()
            state["last_success_epoch"] = epoch
            (self.root / "state" / "status.json").write_text(json.dumps(state))
            self.assertNotEqual(self.run_cli("health").returncode, 0)

    def test_changed_destination_requires_new_success(self):
        self.assertEqual(self.run_cli("once").returncode, 0)
        self.assertNotEqual(self.run_cli("health", BACKUP_S3_PREFIX="dev/").returncode, 0)
        self.assertNotEqual(self.run_cli("once", BACKUP_S3_PREFIX="dev/", FAKE_AWS_MODE="fail-upload").returncode, 0)
        self.assertEqual(self.state()["backup_target"], "s3://acttub-db-backups/prod/:acttub")

    def test_config_rejects_other_environment_prefix_and_invalid_schedule(self):
        for env in [{"BACKUP_S3_PREFIX": "../"}, {"BACKUP_S3_PREFIX": ""}, {"BACKUP_SCHEDULE": "25:00"}, {"BACKUP_S3_BUCKET": ""}]:
            with self.subTest(env=env):
                result = self.run_cli("once", **env)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / "s3" / "calls.jsonl").exists())

    def test_simultaneous_manual_backup_fails_without_changing_state(self):
        import fcntl
        self.assertEqual(self.run_cli("once").returncode, 0)
        before = self.state()
        with (self.root / "state" / "backup.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertNotEqual(self.run_cli("once").returncode, 0)
        self.assertEqual(self.state(), before)

    def test_scheduler_waits_for_manual_backup_then_completes_its_backup(self):
        manual = subprocess.Popen([sys.executable, str(SCRIPT), "once"],
                                  env={**self.env, "FAKE_PG_DELAY": "2"},
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        scheduler = None
        try:
            status = self.root / "state" / "status.json"
            for _ in range(100):
                if status.exists() and self.state()["last_result"] == "running":
                    break
                time.sleep(0.01)
            self.assertTrue(status.exists(), "manual backup did not start")
            self.assertEqual(self.state()["last_result"], "running")
            scheduler = subprocess.Popen([sys.executable, str(SCRIPT), "schedule"],
                                         env=self.env, stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE, text=True)
            # PID 1이 여기서 종료되면 Docker가 exec로 실행한 수동 백업까지 중단시킨다.
            time.sleep(0.3)
            self.assertIsNone(scheduler.poll(), "scheduler exited while manual backup held the lock")
            manual.communicate(timeout=5)
            self.assertEqual(manual.returncode, 0)
            for _ in range(300):
                if len(list((self.root / "s3").rglob("*.dump"))) >= 2 and self.state()["last_result"] == "success":
                    break
                time.sleep(0.01)
            self.assertEqual(len(list((self.root / "s3").rglob("*.dump"))), 2)
            self.assertEqual(self.run_cli("health").returncode, 0)
            self.assertIsNone(scheduler.poll())
        finally:
            manual.communicate(timeout=5)
            if scheduler is not None:
                scheduler.terminate()
                scheduler.communicate(timeout=5)


class ScheduleTest(unittest.TestCase):
    def test_next_run_uses_korean_calendar_before_and_after_four(self):
        spec = importlib.util.spec_from_file_location("backup", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        zone = ZoneInfo("Asia/Seoul")
        for now, expected in [("2026-09-06T03:59:00", "2026-09-06T04:00:00"), ("2026-09-06T04:00:00", "2026-09-07T04:00:00"), ("2026-09-06T23:59:00", "2026-09-07T04:00:00")]:
            with self.subTest(now=now):
                result = module.next_run(datetime.fromisoformat(now).replace(tzinfo=zone), "04:00")
                self.assertEqual(result, datetime.fromisoformat(expected).replace(tzinfo=zone))


if __name__ == "__main__":
    unittest.main()
