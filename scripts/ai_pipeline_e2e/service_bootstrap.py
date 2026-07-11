"""Command construction for explicit real AI bootstraps and FD-scripted services.

This module never launches a process at import time. The live adapter must resolve a
clean detached worktree alias and use ``subprocess.DEVNULL`` for every stdio stream.
"""

from __future__ import annotations

import hashlib
import http.server
import json
import os
import re
import shutil
import socketserver
import stat
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, Mapping

SERVICES = ("summary", "agent", "report")
PLATFORM_MODES = ("build", "start")
SERVICE_PATHS = {
    "summary": "/v1/summaries/generate",
    "agent": "/v1/agent/turn",
    "report": "/v1/reports/generate",
}
MAX_SETTINGS_BYTES = 64 * 1024
MAX_SCRIPT_BYTES = 8 * 1024 * 1024
MAX_REQUEST_BYTES = 4 * 1024 * 1024
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_CHILD_ENV_KEYS = frozenset(
    {
        "PATH",
        "HOME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "TZ",
        "PYTHONDONTWRITEBYTECODE",
        "PYTHONUNBUFFERED",
        "PYTHONUTF8",
        "UV_OFFLINE",
        "NO_PROXY",
    }
)

EXPLICIT_SETTINGS_BOOTSTRAP = r'''
import json
import os
import re
import sys
from pathlib import Path

def fail():
    try:
        os.write(2, b"service_bootstrap_failed\n")
    finally:
        raise SystemExit(70)

def exact(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        fail()
    return value

def read_fd(fd):
    try:
        os.lseek(fd, 0, os.SEEK_SET)
    except OSError:
        pass
    chunks = []
    total = 0
    while True:
        chunk = os.read(fd, min(65536 + 1 - total, 8192))
        if not chunk:
            break
        total += len(chunk)
        if total > 65536:
            fail()
        chunks.append(chunk)
    os.close(fd)
    def exact_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail()
            result[key] = value
        return result
    try:
        return json.loads(b"".join(chunks), object_pairs_hook=exact_object)
    except Exception:
        fail()

def main():
    if len(sys.argv) != 3:
        fail()
    service = sys.argv[1]
    fd = 0
    port = int(sys.argv[2])
    if service not in {"summary", "agent", "report"} or not 1024 <= port <= 65535:
        fail()
    data = read_fd(fd)
    if not isinstance(data, dict) or not isinstance(data.get("apiKey"), str) or not data["apiKey"] or not isinstance(data.get("model"), str) or not data["model"]:
        fail()
    if service == "summary":
        data = exact(data, {"apiKey", "model", "allowedSupabaseHosts", "storageBucket", "maxVideoDurationMs", "maxDownloadBytes", "downloadTimeoutSeconds"})
        if (
            not isinstance(data["allowedSupabaseHosts"], list)
            or len(data["allowedSupabaseHosts"]) != 1
            or re.fullmatch(r"[a-z0-9]+\.supabase\.co", data["allowedSupabaseHosts"][0]) is None
            or data["storageBucket"] != "practice-videos"
            or data["maxVideoDurationMs"] != 300000
            or not isinstance(data["maxDownloadBytes"], int)
            or not 1 <= data["maxDownloadBytes"] <= 314572800
            or not isinstance(data["downloadTimeoutSeconds"], int)
            or not 1 <= data["downloadTimeoutSeconds"] <= 300
        ):
            fail()
        from acting_summary.app import create_app
        from acting_summary.config import Settings
        settings = Settings(
            api_key=data["apiKey"], model=data["model"],
            allowed_supabase_hosts=tuple(data["allowedSupabaseHosts"]),
            storage_bucket=data["storageBucket"],
            max_video_duration_ms=data["maxVideoDurationMs"],
            max_download_bytes=data["maxDownloadBytes"],
            download_timeout_seconds=data["downloadTimeoutSeconds"],
        )
    elif service == "agent":
        data = exact(data, {"apiKey", "model", "maxQuestions"})
        if data["maxQuestions"] != 10:
            fail()
        from acting_agent.app import create_app
        from acting_agent.config import Settings
        settings = Settings(api_key=data["apiKey"], model=data["model"], max_questions=data["maxQuestions"])
    else:
        data = exact(data, {"apiKey", "model"})
        from acting_report.app import create_app
        from acting_report.config import Settings
        settings = Settings(api_key=data["apiKey"], model=data["model"], store_path=Path(os.devnull))
    app = create_app(settings=settings)
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=port, access_log=False, log_config=None)

try:
    main()
except SystemExit:
    raise
except BaseException:
    fail()
'''.strip()


@dataclass(frozen=True)
class ProcessPlan:
    service: str
    mode: str
    cwd_alias: str
    command: tuple[str, ...]
    input_fd: int
    fd_mappings: tuple[tuple[int, int], ...]
    pass_fds: tuple[int, ...]
    output_disposition: str = "discard"
    access_logs: bool = False


def _validate_inheritable_source_fd(fd: Any) -> int:
    if type(fd) is not int or fd <= 2:
        raise TypeError("service_input_fd_invalid")
    info = os.fstat(fd)
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISFIFO(info.st_mode)):
        raise ValueError("service_input_fd_type_invalid")
    return fd


def _validate_service_port(service: str, port: Any) -> int:
    if service not in SERVICES:
        raise ValueError("service_invalid")
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError("service_port_invalid")
    return port


def _resolve_executable(name: str) -> str:
    candidate = shutil.which(name)
    if candidate is None:
        raise ValueError("service_executable_missing")
    resolved = os.path.realpath(candidate)
    info = os.stat(resolved, follow_symlinks=False)
    if not stat.S_ISREG(info.st_mode) or not os.access(resolved, os.X_OK) or info.st_mode & 0o022:
        raise ValueError("service_executable_untrusted")
    return resolved


def build_real_service_plan(service: str, *, settings_fd: int, port: int) -> ProcessPlan:
    """Construct an explicit Settings/create_app command; never use dotenv or an app factory."""

    port = _validate_service_port(service, port)
    settings_fd = _validate_inheritable_source_fd(settings_fd)
    return ProcessPlan(
        service=service,
        mode="real",
        cwd_alias=f"{service}-detached-worktree",
        command=(
            _resolve_executable("uv"),
            "run",
            "--offline",
            "python",
            "-I",
            "-c",
            EXPLICIT_SETTINGS_BOOTSTRAP,
            service,
            str(port),
        ),
        input_fd=settings_fd,
        fd_mappings=((settings_fd, 0),),
        pass_fds=(),
    )


def build_scripted_service_plan(service: str, *, script_fd: int, port: int) -> ProcessPlan:
    port = _validate_service_port(service, port)
    script_fd = _validate_inheritable_source_fd(script_fd)
    return ProcessPlan(
        service=service,
        mode="scripted",
        cwd_alias="platform-detached-worktree",
        command=(
            os.path.realpath(sys.executable),
            "-I",
            "scripts/ai_pipeline_e2e/service_bootstrap.py",
            "--scripted",
            service,
            str(port),
        ),
        input_fd=script_fd,
        fd_mappings=((script_fd, 0),),
        pass_fds=(),
    )


def build_platform_plan(mode: str, *, settings_fd: int, port: int | None = None) -> ProcessPlan:
    """Construct the same-process Next bootstrap with settings supplied only on FD 0."""

    if mode not in PLATFORM_MODES:
        raise ValueError("platform_mode_invalid")
    settings_fd = _validate_inheritable_source_fd(settings_fd)
    if mode == "start":
        if type(port) is not int or not 1024 <= port <= 65535:
            raise ValueError("platform_port_invalid")
        suffix = (str(port),)
    else:
        if port is not None:
            raise ValueError("platform_build_port_forbidden")
        suffix = ()
    return ProcessPlan(
        service="platform",
        mode=mode,
        cwd_alias="platform-detached-worktree",
        command=(_resolve_executable("node"), "scripts/ai_pipeline_e2e/platform_bootstrap.mjs", mode, *suffix),
        input_fd=settings_fd,
        fd_mappings=((settings_fd, 0),),
        pass_fds=(),
    )


def subprocess_options(plan: ProcessPlan, clean_environment: Mapping[str, str]) -> dict[str, Any]:
    """Return safe spawn options but deliberately omit cwd resolution and process launch."""

    if (
        not isinstance(plan, ProcessPlan)
        or plan.output_disposition != "discard"
        or plan.access_logs
        or plan.fd_mappings != ((plan.input_fd, 0),)
        or plan.pass_fds
    ):
        raise ValueError("unsafe_process_plan")
    if not isinstance(clean_environment, Mapping) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in clean_environment.items()
    ):
        raise TypeError("clean_environment_invalid")
    if set(clean_environment) - _CHILD_ENV_KEYS:
        raise ValueError("clean_environment_key_forbidden")
    required = {
        "PATH": os.defpath,
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUNBUFFERED": "1",
        "PYTHONUTF8": "1",
        "UV_OFFLINE": "1",
        "NO_PROXY": "127.0.0.1,localhost",
    }
    if any(clean_environment.get(key) != value for key, value in required.items()):
        raise ValueError("clean_environment_safety_flag_invalid")
    for key in ("HOME", "TMPDIR"):
        if key not in clean_environment:
            continue
        resolved = os.path.realpath(clean_environment[key])
        info = os.stat(resolved, follow_symlinks=False)
        if (
            resolved != clean_environment[key]
            or not stat.S_ISDIR(info.st_mode)
            or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) & 0o077
        ):
            raise ValueError("clean_environment_private_directory_invalid")
    return {
        "args": plan.command,
        "stdin": plan.input_fd,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
        "pass_fds": plan.pass_fds,
        "env": dict(clean_environment),
    }


def _read_fd_bounded(fd: int, maximum: int) -> bytes:
    if type(fd) is not int or (fd != 0 and fd <= 2):
        raise TypeError("service_input_fd_invalid")
    info = os.fstat(fd)
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISFIFO(info.st_mode)):
        raise ValueError("service_input_fd_type_invalid")
    try:
        os.lseek(fd, 0, os.SEEK_SET)
    except OSError:
        pass
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = os.read(fd, min(8192, maximum + 1 - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > maximum:
            raise ValueError("fd_payload_too_large")
    return b"".join(chunks)


def parse_scripted_config(fd: int, service: str) -> list[dict[str, Any]]:
    if service not in SERVICES:
        raise ValueError("scripted_service_invalid")
    try:
        def exact_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("scripted_config_duplicate_key")
                result[key] = value
            return result

        data = json.loads(_read_fd_bounded(fd, MAX_SCRIPT_BYTES), object_pairs_hook=exact_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("scripted_config_invalid") from error
    if not isinstance(data, Mapping) or set(data) != {"schemaVersion", "service", "exchanges"}:
        raise ValueError("scripted_config_keys_invalid")
    if data["schemaVersion"] != "protected-scripted-service.v1" or data["service"] != service:
        raise ValueError("scripted_config_identity_invalid")
    if not isinstance(data["exchanges"], list) or not data["exchanges"]:
        raise ValueError("scripted_exchanges_invalid")
    exchanges: list[dict[str, Any]] = []
    for exchange in data["exchanges"]:
        if not isinstance(exchange, Mapping) or set(exchange) != {"method", "path", "requestSha256", "status", "response"}:
            raise ValueError("scripted_exchange_keys_invalid")
        if (
            exchange["method"] != "POST"
            or exchange["path"] != SERVICE_PATHS[service]
            or not isinstance(exchange["requestSha256"], str)
            or _SHA256.fullmatch(exchange["requestSha256"]) is None
            or type(exchange["status"]) is not int
            or not 100 <= exchange["status"] <= 599
            or not isinstance(exchange["response"], (Mapping, list))
        ):
            raise ValueError("scripted_exchange_invalid")
        exchanges.append(dict(exchange))
    return exchanges


class _QuietThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = False


class _ScriptedHandler(http.server.BaseHTTPRequestHandler):
    server: Any

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def log_error(self, _format: str, *_args: object) -> None:
        return

    def _json(self, status: int, payload: Any) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler contract
        if self.path == "/health":
            self._json(200, {"status": "ok"})
        else:
            self._json(404, {"error": {"code": "NOT_FOUND"}})

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler contract
        try:
            content_length = int(self.headers.get("content-length", "-1"))
        except ValueError:
            content_length = -1
        if not 0 <= content_length <= MAX_REQUEST_BYTES:
            self._json(413, {"error": {"code": "REQUEST_REJECTED"}})
            return
        body = self.rfile.read(content_length)
        if not self.server.exchanges:
            self._json(409, {"error": {"code": "SCRIPT_EXHAUSTED"}})
            return
        exchange = self.server.exchanges[0]
        digest = hashlib.sha256(body).hexdigest()
        if self.command != exchange["method"] or self.path != exchange["path"] or digest != exchange["requestSha256"]:
            self._json(409, {"error": {"code": "SCRIPT_MISMATCH"}})
            return
        self.server.exchanges.pop(0)
        self._json(exchange["status"], exchange["response"])


def serve_scripted(service: str, fd: int, port: int) -> None:
    """Serve a private-FD script on loopback with no access or payload logging."""

    port = _validate_service_port(service, port)
    exchanges = parse_scripted_config(fd, service)
    server = _QuietThreadingServer(("127.0.0.1", port), _ScriptedHandler)
    server.exchanges = exchanges
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()


def _main(argv: list[str]) -> int:
    if len(argv) != 4 or argv[1] != "--scripted":
        return 64
    try:
        serve_scripted(argv[2], 0, int(argv[3]))
        return 0
    except BaseException:
        return 70


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv))
