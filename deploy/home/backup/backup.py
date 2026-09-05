#!/usr/bin/env python3
"""매일 PostgreSQL custom dump를 S3에 보관한다. once / schedule / health."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


class BackupError(Exception):
    """시크릿이나 외부 명령 출력을 포함하지 않는 운영 오류."""


class BackupBusy(BackupError):
    """다른 백업이 잠금을 보유 중이다. 예약 실행만 종료하지 않고 기다린다."""


def config() -> dict:
    bucket = os.environ.get("BACKUP_S3_BUCKET", "")
    prefix = os.environ.get("BACKUP_S3_PREFIX", "")
    schedule = os.environ.get("BACKUP_SCHEDULE", "04:00")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket):
        raise BackupError("BACKUP_S3_BUCKET is missing or invalid")
    if prefix not in ("dev/", "prod/"):
        raise BackupError("BACKUP_S3_PREFIX must be dev/ or prod/")
    if not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", schedule):
        raise BackupError("BACKUP_SCHEDULE must be HH:MM")
    return {"bucket": bucket, "prefix": prefix, "schedule": schedule,
            "target": f"s3://{bucket}/{prefix}:{os.environ.get('PGDATABASE', '')}",
            "state_dir": Path(os.environ.get("BACKUP_STATE_DIR", "/var/lib/acttub-backup"))}


def read_state(cfg: dict) -> dict:
    try:
        state = json.loads((cfg["state_dir"] / "status.json").read_text())
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(cfg: dict, state: dict) -> None:
    # 같은 파일시스템의 rename: 쓰는 중인 JSON을 health가 읽지 않는다.
    with tempfile.NamedTemporaryFile(mode="w", dir=cfg["state_dir"], delete=False) as file:
        json.dump(state, file)
        file.flush()
        os.fsync(file.fileno())
    os.replace(file.name, cfg["state_dir"] / "status.json")


def healthy(cfg: dict, state: dict) -> bool:
    timestamp = state.get("last_success_epoch")
    return (state.get("backup_target") == cfg["target"]
            and state.get("last_result") in ("success", "running")
            # 재시도 시작만으로 이전 실패를 지우지 않는다. 성공 업로드 뒤에만 last_error가 사라진다.
            and "last_error" not in state
            and isinstance(timestamp, (int, float))
            and 0 <= time.time() - timestamp <= 26 * 3600)


def run_command(stage: str, command: list[str]) -> bytes:
    try:
        # pg_dump나 aws stderr에는 자격증명·DB 내용이 포함될 수 있다. 단계·종료 코드만 남긴다.
        return subprocess.run(command, check=True, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, timeout=900).stdout
    except subprocess.CalledProcessError as error:
        raise BackupError(f"{stage} failed (exit {error.returncode})") from None
    except subprocess.TimeoutExpired:
        raise BackupError(f"{stage} timed out (900 seconds)") from None
    except OSError:
        raise BackupError(f"{stage} could not start") from None


def backup_once(cfg: dict) -> None:
    cfg["state_dir"].mkdir(parents=True, exist_ok=True, mode=0o700)
    with (cfg["state_dir"] / "backup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupBusy("another backup is running") from None
        state = read_state(cfg)
        state.update(last_attempt_epoch=int(time.time()), last_result="running")
        write_state(cfg, state)
        try:
            # 파일은 디스크에 쓰고 업로드한다. 파이프로 연결해 dump 실패가 성공으로 읽히지 않게 한다.
            with tempfile.TemporaryDirectory(prefix="acttub-backup-") as tmp:
                dump = Path(tmp) / "database.dump"
                run_command("dump", ["pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--file", str(dump)])
                if not dump.is_file() or dump.stat().st_size == 0:
                    raise BackupError("dump is empty")
                run_command("archive validation", ["pg_restore", "--list", str(dump)])
                with dump.open("rb") as file:
                    checksum = hashlib.file_digest(file, "sha256").hexdigest()
                key = cfg["prefix"] + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S.%fZ.dump")
                uri = f"s3://{cfg['bucket']}/{key}"
                aws_options = ["--cli-connect-timeout", "10", "--cli-read-timeout", "60"]
                run_command("upload", ["aws", "s3", "cp", str(dump), uri, "--only-show-errors",
                                       "--sse", "AES256", "--metadata", f"sha256={checksum}", *aws_options])
                raw = run_command("remote verification", ["aws", "s3api", "head-object", "--bucket", cfg["bucket"],
                                                          "--key", key, "--output", "json", *aws_options])
                try:
                    remote = json.loads(raw)
                    matches = remote["ContentLength"] == dump.stat().st_size and remote["Metadata"]["sha256"] == checksum
                except (ValueError, KeyError, TypeError):
                    matches = False
                if not matches:
                    raise BackupError("remote verification size or checksum metadata mismatch")
                state.update(last_success_epoch=int(time.time()), last_success_uri=uri,
                             last_success_sha256=checksum, last_result="success", backup_target=cfg["target"])
                state.pop("last_error", None)
                write_state(cfg, state)
                print(f"backup success {uri}", flush=True)
        except (BackupError, OSError) as error:
            message = str(error) if isinstance(error, BackupError) else "backup local storage failed"
            state.update(last_result="failed", last_error=message)
            write_state(cfg, state)
            raise BackupError(message) from None


def next_run(now: datetime, schedule: str) -> datetime:
    hour, minute = map(int, schedule.split(":"))
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return target if target > now else target + timedelta(days=1)


def backup_when_available(cfg: dict) -> None:
    while True:
        try:
            backup_once(cfg)
            return
        except BackupBusy:
            # PID 1을 살려 둬 같은 컨테이너에서 exec로 시작한 수동 백업이 중단되지 않게 한다.
            time.sleep(1)


def schedule_backups(cfg: dict) -> None:
    zone = ZoneInfo("Asia/Seoul")
    state = read_state(cfg)
    # 최초 기동·실패·오래된 백업 또는 서버 정지 중 놓친 04:00 실행을 바로 보충한다.
    latest_due = next_run(datetime.now(zone), cfg["schedule"]) - timedelta(days=1)
    if not healthy(cfg, state) or state["last_success_epoch"] < latest_due.timestamp():
        backup_when_available(cfg)
    while True:
        target = next_run(datetime.now(zone), cfg["schedule"])
        print(f"next backup {target.isoformat()}", flush=True)
        while (remaining := target.timestamp() - time.time()) > 0:
            time.sleep(min(60, remaining))
        # 실패하면 exit 1. Docker 재시작은 실패 흔적을 보존하며 다시 백업한다.
        backup_when_available(cfg)


def main() -> int:
    os.umask(0o077)
    os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
    os.environ.setdefault("AWS_RETRY_MODE", "standard")
    os.environ.setdefault("AWS_MAX_ATTEMPTS", "3")
    os.environ.setdefault("AWS_PAGER", "")
    os.environ.setdefault("PGCONNECT_TIMEOUT", "10")
    command = sys.argv[1] if len(sys.argv) == 2 else "schedule" if len(sys.argv) == 1 else ""
    try:
        cfg = config()
        if command == "health":
            return 0 if healthy(cfg, read_state(cfg)) else 1
        if command == "once":
            backup_once(cfg)
        elif command == "schedule":
            schedule_backups(cfg)
        else:
            raise BackupError("usage: backup.py [schedule|once|health]")
        return 0
    except (BackupError, OSError) as error:
        message = str(error) if isinstance(error, BackupError) else "backup local storage failed"
        print(f"backup error: {message}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
