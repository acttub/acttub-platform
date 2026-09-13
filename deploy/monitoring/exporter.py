#!/usr/bin/env python3
"""Small HTTP collectors. Backup mode never receives AWS or database credentials."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import subprocess
import sys
from threading import Lock
import time
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

STATES = ("ok", "unreadable", "missing", "corrupt", "target_mismatch", "no_success", "unresolved_failure")


def backup_state(config: dict) -> tuple:
    try:
        with (Path(config["state_dir"]) / "status.json").open("rb") as source:
            raw = source.read(65537)
        if len(raw) > 65536:
            raise ValueError()
        state = json.loads(raw)
        if not isinstance(state, dict) or state.get("last_result") not in ("success", "running", "failed"):
            raise ValueError()
        for key in ("last_success_epoch", "last_attempt_epoch"):
            if key in state:
                value = state[key]
                # bool is an int in Python; reject it explicitly, including NaN/Infinity,
                # pre-2000 values and clocks more than five minutes in the future.
                if (type(value) not in (int, float) or not math.isfinite(value)
                        or not 946684800 <= value <= time.time() + 300):
                    raise ValueError()
        target = state.get("backup_target")
        if target is not None and not isinstance(target, str):
            raise ValueError()
    except FileNotFoundError:
        return "missing", 0, 0, 0, 0
    except OSError:
        return "unreadable", 0, 0, 0, 0
    except (ValueError, OverflowError):
        return "corrupt", 0, 0, 0, 0
    matches = int(target == config["target"])
    failure = int(state["last_result"] == "failed" or "last_error" in state)
    timestamp = state.get("last_success_epoch", 0) if matches else 0
    if target is not None and not matches:
        status = "target_mismatch"
    elif failure:
        status = "unresolved_failure"
    elif not timestamp:
        status = "no_success"
    else:
        status = "ok"
    return status, 1, matches, timestamp, failure


def backup_metrics(config: dict) -> str:
    lines = []
    for environment in ("dev", "prod"):
        status, readable, matches, timestamp, failure = backup_state(config[environment])
        for state in STATES:
            lines.append(f'acttub_backup_state{{environment="{environment}",state="{state}"}} {int(status == state)}')
        for name, value in [("state_read_success", readable), ("target_match", matches),
                            ("last_success_timestamp_seconds", timestamp), ("unresolved_failure", failure)]:
            lines.append(f'acttub_backup_{name}{{environment="{environment}"}} {value}')
    return "\n".join(lines) + "\n"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def probe_success(target: dict) -> bool:
    try:
        token = Path(target["token_file"]).read_text().strip()
        if not token:
            return False
        request = Request(target["url"], headers={"Authorization": "Bearer " + token})
        # Proxy env and redirects must never send monitoring credentials elsewhere.
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=3) as response:
            body = response.read(65537)
            if len(body) <= 65536:
                payload = json.loads(body)
                return response.status == 200 and isinstance(payload, dict) and payload.get("status") == "UP"
    except (OSError, ValueError, URLError):
        pass
    return False


def db_metrics(config: dict) -> str:
    lines = []
    for environment in ("dev", "prod"):
        start = time.monotonic()
        success = 0
        try:
            # socket timeout excludes DNS and can be prolonged by a slow trickle.
            # A short-lived process gives each probe a hard deadline and can be
            # killed/reaped without accumulating blocked DNS/HTTP threads.
            result = subprocess.run([sys.executable, "-B", str(Path(__file__).resolve()), "probe"],
                                    input=json.dumps(config[environment]), text=True, timeout=3,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            success = int(result.returncode == 0)
        except (OSError, subprocess.TimeoutExpired):
            pass
        lines.append(f'acttub_db_probe_success{{environment="{environment}"}} {success}')
        lines.append(f'acttub_db_probe_duration_seconds{{environment="{environment}"}} {time.monotonic() - start:.6f}')
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["backup", "db"])
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--listen", default="0.0.0.0")
    parser.add_argument("--port", default=9101, type=int)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    probe_lock = Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/metrics":
                self.send_error(404)
                return
            if args.mode == "db":
                if not probe_lock.acquire(blocking=False):
                    self.send_error(503, "probe already running")
                    return
                try:
                    body = db_metrics(config).encode()
                finally:
                    probe_lock.release()
            else:
                body = backup_metrics(config).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *_args):
            pass

    ThreadingHTTPServer((args.listen, args.port), Handler).serve_forever()


if __name__ == "__main__":
    if sys.argv[1:] == ["probe"]:
        sys.exit(0 if probe_success(json.load(sys.stdin)) else 1)
    main()
