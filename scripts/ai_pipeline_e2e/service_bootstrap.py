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
import socket
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
import hashlib
import hmac
import json
import os
import re
import select
import socket
import stat
import struct
import sys
from pathlib import Path

EVENT_SCHEMA = "protected-provider-event.v1"
EVENT_DOMAIN = b"acttub-protected-provider-event.v1\0"
MEDIA_DOMAIN = b"acttub-protected-media-content.v1\0"
FILE_NAME_DOMAIN = b"acttub-protected-provider-file-name.v1\0"
MAX_FINGERPRINT_BYTES = 1024 * 1024
MAX_MEDIA_BYTES = 8 * 1024 * 1024 * 1024
SERVICE_PATHS = {
    "summary": "/v1/summaries/generate",
    "agent": "/v1/agent/turn",
    "report": "/v1/reports/generate",
}

def fail():
    try:
        os.write(2, b"service_bootstrap_failed\n")
    finally:
        raise SystemExit(70)

def exact(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        fail()
    return value

def write_event(fd, data):
    if not data or len(data) > select.PIPE_BUF:
        fail()
    try:
        written = os.write(fd, data)
    except OSError:
        fail()
    if written != len(data):
        fail()

def canonical(value):
    return json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":"), sort_keys=True)

def fingerprint(key, domain, value):
    try:
        encoded = repr(value).encode("utf-8", "replace")
    except BaseException:
        encoded = type(value).__name__.encode("ascii", "replace")
    length = len(encoded)
    encoded = encoded[:MAX_FINGERPRINT_BYTES]
    return "hmac-sha256:" + hmac.new(
        key,
        EVENT_DOMAIN + domain.encode("ascii") + b"\0" + str(length).encode("ascii") + b"\0" + encoded,
        hashlib.sha256,
    ).hexdigest()

def file_hmac(key, filename):
    digest = hmac.new(key, MEDIA_DOMAIN, hashlib.sha256)
    count = 0
    with open(filename, "rb", buffering=0) as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            count += len(chunk)
            if count > MAX_MEDIA_BYTES:
                fail()
            digest.update(chunk)
    return "hmac-sha256:" + digest.hexdigest(), count

def provider_file_locator(key, expected_media_hmac):
    if not isinstance(key, bytes) or len(key) != 32:
        fail()
    if not isinstance(expected_media_hmac, str) or re.fullmatch(r"hmac-sha256:[a-f0-9]{64}", expected_media_hmac) is None:
        fail()
    opaque_id = hmac.new(
        key,
        FILE_NAME_DOMAIN + expected_media_hmac.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()[:40]
    return "files/" + opaque_id

def send_frame(channel, value):
    encoded = canonical(value).encode("utf-8")
    if not encoded or len(encoded) > 16384:
        fail()
    channel.sendall(struct.pack("!I", len(encoded)) + encoded)

def recv_exact(channel, size):
    chunks = []
    total = 0
    while total < size:
        chunk = channel.recv(size - total)
        if not chunk:
            fail()
        chunks.append(chunk)
        total += len(chunk)
    return b"".join(chunks)

def recv_frame(channel):
    size = struct.unpack("!I", recv_exact(channel, 4))[0]
    if not 1 <= size <= 4096:
        fail()
    try:
        value = json.loads(recv_exact(channel, size))
    except Exception:
        fail()
    if value != {"ok": True}:
        fail()

class AttestedModels:
    def __init__(self, delegate, emit):
        self._delegate = delegate
        self._emit = emit

    def generate_content(self, *args, **kwargs):
        response = self._delegate.generate_content(*args, **kwargs)
        self._emit("generate_content", (args, kwargs), response, None, 0)
        return response

    def __getattr__(self, name):
        return getattr(self._delegate, name)

class AttestedFiles:
    def __init__(self, delegate, emit, cleanup, key, expected_media_hmac):
        self._delegate = delegate
        self._emit = emit
        self._cleanup = cleanup
        self._key = key
        self._expected_media_hmac = expected_media_hmac
        self._planned_locator = None

    def upload(self, *args, **kwargs):
        if args or set(kwargs) != {"file"} or self._planned_locator is not None:
            fail()
        filename = kwargs["file"]
        if not isinstance(filename, str) or not filename:
            fail()
        media_hmac, byte_count = file_hmac(self._key, filename)
        if not hmac.compare_digest(media_hmac, self._expected_media_hmac):
            fail()
        locator = provider_file_locator(self._key, self._expected_media_hmac)
        self._planned_locator = locator
        send_frame(self._cleanup, {"kind": "plan", "locator": locator})
        recv_frame(self._cleanup)
        delegated_kwargs = {"file": filename, "config": {"name": locator}}
        response = self._delegate.upload(**delegated_kwargs)
        if getattr(response, "name", None) != locator:
            fail()
        self._emit("files_upload", ((), delegated_kwargs), response, media_hmac, byte_count)
        return response

    def get(self, *args, **kwargs):
        response = self._delegate.get(*args, **kwargs)
        self._emit("files_get", (args, kwargs), response, None, 0)
        return response

    def delete(self, *args, **kwargs):
        if args or set(kwargs) != {"name"} or kwargs["name"] != self._planned_locator:
            fail()
        response = self._delegate.delete(*args, **kwargs)
        locator = kwargs["name"]
        send_frame(self._cleanup, {"kind": "complete", "locator": locator})
        recv_frame(self._cleanup)
        self._emit("files_delete", (args, kwargs), response, None, 0)
        return response

    def __getattr__(self, name):
        return getattr(self._delegate, name)

class AttestedClient:
    def __init__(self, delegate, service, event_fd, cleanup, key, expected_media_hmac):
        self._delegate = delegate
        self._service = service
        self._event_fd = event_fd
        self._key = key
        self._ordinal = 0
        self.models = AttestedModels(delegate.models, self._emit)
        self.files = AttestedFiles(delegate.files, self._emit, cleanup, key, expected_media_hmac) if service == "summary" else delegate.files

    def _emit(self, operation, request, response, media_hmac, media_byte_count):
        event = {
            "schemaVersion": EVENT_SCHEMA,
            "service": self._service,
            "ordinal": self._ordinal,
            "operation": operation,
            "success": True,
            "requestHmac": fingerprint(self._key, self._service + ":" + operation + ":request", request),
            "responseHmac": fingerprint(self._key, self._service + ":" + operation + ":response", response),
            "mediaHmac": media_hmac,
            "mediaByteCount": media_byte_count,
        }
        self._ordinal += 1
        encoded = (canonical(event) + "\n").encode("ascii")
        write_event(self._event_fd, encoded)

    def __getattr__(self, name):
        return getattr(self._delegate, name)

class CanonicalOnlyApp:
    def __init__(self, app, service):
        self._app = app
        self._allowed = {"/health", SERVICE_PATHS[service]}

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http" and scope.get("path") not in self._allowed:
            body = b'{"error":{"code":"NOT_FOUND","message":"Not found."}}'
            await send({"type": "http.response.start", "status": 404, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode("ascii"))]})
            await send({"type": "http.response.body", "body": body})
            return
        await self._app(scope, receive, send)

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
    if len(sys.argv) != 5:
        fail()
    service = sys.argv[1]
    fd = 0
    port = int(sys.argv[2])
    event_fd = int(sys.argv[3])
    cleanup_fd = int(sys.argv[4])
    if service not in {"summary", "agent", "report"} or not 1024 <= port <= 65535:
        fail()
    for extra_fd, expected in ((event_fd, "fifo"), (cleanup_fd, "socket")):
        if extra_fd <= 2:
            fail()
        mode = os.fstat(extra_fd).st_mode
        if (expected == "fifo" and not stat.S_ISFIFO(mode)) or (expected == "socket" and not stat.S_ISSOCK(mode)):
            fail()
    data = read_fd(fd)
    if not isinstance(data, dict) or not isinstance(data.get("apiKey"), str) or not data["apiKey"] or not isinstance(data.get("model"), str) or not data["model"]:
        fail()
    key_hex = data.pop("attestationKeyHex", None)
    expected_media_hmac = data.pop("expectedMediaHmac", None)
    if not isinstance(key_hex, str) or re.fullmatch(r"[a-f0-9]{64}", key_hex) is None:
        fail()
    key = bytes.fromhex(key_hex)
    if service == "summary":
        if not isinstance(expected_media_hmac, str) or re.fullmatch(r"hmac-sha256:[a-f0-9]{64}", expected_media_hmac) is None:
            fail()
    elif expected_media_hmac is not None:
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
    from google import genai
    cleanup = socket.socket(fileno=cleanup_fd)
    client = AttestedClient(genai.Client(api_key=settings.api_key), service, event_fd, cleanup, key, expected_media_hmac)
    app = CanonicalOnlyApp(create_app(client=client, settings=settings), service)
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
    attestation_fd: int | None = None
    cleanup_fd: int | None = None
    output_disposition: str = "discard"
    access_logs: bool = False


def _validate_inheritable_source_fd(fd: Any) -> int:
    if type(fd) is not int or fd <= 2:
        raise TypeError("service_input_fd_invalid")
    info = os.fstat(fd)
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISFIFO(info.st_mode)):
        raise ValueError("service_input_fd_type_invalid")
    return fd


def _validate_provider_fds(attestation_fd: Any, cleanup_fd: Any, settings_fd: int) -> tuple[int, int]:
    if type(attestation_fd) is not int or type(cleanup_fd) is not int:
        raise TypeError("provider_attestation_fd_invalid")
    if len({settings_fd, attestation_fd, cleanup_fd}) != 3 or min(attestation_fd, cleanup_fd) <= 2:
        raise ValueError("provider_attestation_fd_invalid")
    if not stat.S_ISFIFO(os.fstat(attestation_fd).st_mode) or not stat.S_ISSOCK(os.fstat(cleanup_fd).st_mode):
        raise ValueError("provider_attestation_fd_type_invalid")
    return attestation_fd, cleanup_fd


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


def build_real_service_plan(
    service: str,
    *,
    settings_fd: int,
    port: int,
    attestation_fd: int,
    cleanup_fd: int,
) -> ProcessPlan:
    """Construct an explicit Settings/create_app command; never use dotenv or an app factory."""

    port = _validate_service_port(service, port)
    settings_fd = _validate_inheritable_source_fd(settings_fd)
    attestation_fd, cleanup_fd = _validate_provider_fds(attestation_fd, cleanup_fd, settings_fd)
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
            str(attestation_fd),
            str(cleanup_fd),
        ),
        input_fd=settings_fd,
        fd_mappings=((settings_fd, 0),),
        pass_fds=(attestation_fd, cleanup_fd),
        attestation_fd=attestation_fd,
        cleanup_fd=cleanup_fd,
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
    ):
        raise ValueError("unsafe_process_plan")
    if plan.mode == "real":
        if (
            plan.attestation_fd is None
            or plan.cleanup_fd is None
            or plan.pass_fds != (plan.attestation_fd, plan.cleanup_fd)
        ):
            raise ValueError("unsafe_process_plan")
        _validate_provider_fds(plan.attestation_fd, plan.cleanup_fd, plan.input_fd)
    elif plan.pass_fds or plan.attestation_fd is not None or plan.cleanup_fd is not None:
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
