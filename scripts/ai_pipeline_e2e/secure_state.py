"""POSIX-safe private state, write-ahead cleanup, and hash-chained evidence."""

from __future__ import annotations

import fcntl
import hashlib
import hmac
import json
import os
import re
import stat
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping

try:
    from .sanitizer import (
        FORBIDDEN_CANARY,
        assert_forbidden_scan_clean,
        canonical_json,
        require_sha256,
        sanitize_evidence,
    )
except ImportError:  # pragma: no cover - direct script import fallback
    from sanitizer import FORBIDDEN_CANARY, assert_forbidden_scan_clean, canonical_json, require_sha256, sanitize_evidence

DIRECTORY_MODE = 0o700
FILE_MODE = 0o600
SAFE_CREATE_FLAGS = os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
SAFE_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
GENESIS_HASH = "0" * 64
MAX_PRIVATE_FILE_BYTES = 16 * 1024 * 1024
_RUN_NAME = re.compile(r"^run-[a-z0-9][a-z0-9-]{7,63}$")
_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")

PRIVATE_FILE_LAYOUT: Mapping[str, tuple[str, bytes]] = {
    "run-mac-key": ("run-mac.key", b""),
    "state": ("state.json", b""),
    "manifest": ("hash-manifest.json", b""),
    "mcp-attestations": ("mcp-attestations.jsonl", b""),
    "provider-attestations": ("provider-attestations.jsonl", b""),
    "browser-attestations": ("browser-attestations.jsonl", b""),
    "bridge-wal": ("bridge.wal", b""),
    "cleanup-vault": ("cleanup.vault", b""),
    "mutation-permits": ("mutation.wal", b""),
    "evidence": ("evidence.jsonl", b""),
    "lock": ("run.lock", b"locked\n"),
    "receipt": ("receipt.json", b""),
}

RUN_MAC_KEY_BYTES = 32

SENSITIVE_FD_ALIASES = frozenset(
    {"media", "platform-settings", "summary-settings", "agent-settings", "report-settings"}
)
CLEANUP_PLAN_TYPES: Mapping[str, tuple[str, str]] = {
    "temporary-rls-account": ("auth_user", "delete_auth_user"),
    "run-provider-file": ("provider_file", "delete_provider_file"),
    "real-success-session": ("practice_session", "retain_session"),
    "transient-session": ("practice_session", "delete_session"),
    "run-upload-intent": ("upload_intent", "delete_upload_intent"),
    "run-storage-object": ("storage_object", "delete_storage_object"),
    "run-deletion-request": ("deletion_request", "reconcile_deletion_request"),
    "run-ai-run": ("ai_run", "delete_ai_run"),
    "run-session-bundle": ("session_bundle", "reconcile_session_bundle"),
}
RESOURCE_ALIASES = frozenset(CLEANUP_PLAN_TYPES)
RESOURCE_KINDS = frozenset(kind for kind, _action in CLEANUP_PLAN_TYPES.values())
CLEANUP_ACTIONS = frozenset(action for _kind, action in CLEANUP_PLAN_TYPES.values())
CLEANUP_ALLOWED_OUTCOMES: Mapping[str, frozenset[str]] = {
    "delete_auth_user": frozenset({"deleted", "absent", "not_created"}),
    "delete_provider_file": frozenset({"deleted", "absent", "not_created"}),
    "delete_session": frozenset({"deleted", "absent", "not_created"}),
    "delete_storage_object": frozenset({"deleted", "absent", "not_created"}),
    "delete_upload_intent": frozenset({"deleted", "absent", "not_created"}),
    "delete_ai_run": frozenset({"deleted", "absent", "not_created"}),
    "reconcile_deletion_request": frozenset({"reconciled", "absent"}),
    "reconcile_session_bundle": frozenset({"retained", "deleted", "absent", "not_created"}),
    "retain_session": frozenset({"retained"}),
}
CLEANUP_OUTCOMES = frozenset(
    outcome for allowed_outcomes in CLEANUP_ALLOWED_OUTCOMES.values() for outcome in allowed_outcomes
)
MCP_OPERATIONS = frozenset(
    {"list_projects", "inspect_migrations", "apply_migration", "sql_check", "auth_admin", "storage_check"}
)
MCP_SAFE_CODES = frozenset(
    {"MCP_TARGET_MISMATCH", "MCP_SCHEMA_INVALID", "MCP_OPERATION_FAILED", "MCP_ACTION_UNKNOWN"}
)
MUTATION_ACTIONS = frozenset({"apply_migration_009", "apply_migration_010"})
MUTATION_OPERATIONS = frozenset({"apply_migration"})
MUTATION_CASE_IDS = frozenset({"DB-02"})
MUTATION_STATES = frozenset(
    {
        "migration_009_prepared",
        "migration_009_retry_prepared",
        "migration_010_prepared",
        "migration_010_retry_prepared",
    }
)
MUTATION_OUTCOMES = frozenset({"attested", "unknown"})
MIN_MUTATION_PERMIT_TTL_NS = 1_000_000
MAX_MUTATION_PERMIT_TTL_NS = 300_000_000_000
_MUTATION_PERMIT_MAC_DOMAIN = b"acttub-protected-mutation-permit.v1\0"
_MUTATION_DISPATCH_MAC_DOMAIN = b"acttub-protected-mutation-dispatch.v1\0"
_MUTATION_OUTCOME_MAC_DOMAIN = b"acttub-protected-mutation-outcome.v1\0"


def _mode(fd: int) -> int:
    return stat.S_IMODE(os.fstat(fd).st_mode)


def _require_private_regular_fd(fd: Any) -> int:
    if type(fd) is not int or fd < 0:
        raise TypeError("private_fd_invalid")
    info = os.fstat(fd)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.geteuid()
        or stat.S_IMODE(info.st_mode) != FILE_MODE
        or info.st_nlink != 1
    ):
        raise ValueError("private_fd_not_secure_regular_file")
    if not fcntl.fcntl(fd, fcntl.F_GETFD) & fcntl.FD_CLOEXEC:
        raise ValueError("private_fd_cloexec_missing")
    return fd


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise OSError("private_write_failed")
        view = view[written:]


def _read_all(fd: int) -> bytes:
    info = os.fstat(fd)
    if info.st_size > MAX_PRIVATE_FILE_BYTES:
        raise ValueError("private_file_too_large")
    chunks: list[bytes] = []
    offset = 0
    while offset < info.st_size:
        chunk = os.pread(fd, min(64 * 1024, info.st_size - offset), offset)
        if not chunk:
            break
        chunks.append(chunk)
        offset += len(chunk)
    return b"".join(chunks)


def _assert_outside_repositories(parent_real: str, run_name: str, repository_roots: tuple[str, ...]) -> None:
    target = os.path.join(parent_real, run_name)
    for root in repository_roots:
        repository = os.path.realpath(root)
        try:
            if os.path.commonpath((target, repository)) == repository:
                raise ValueError("private_state_must_be_outside_repository")
        except ValueError as error:
            if str(error) == "private_state_must_be_outside_repository":
                raise
            continue


@dataclass
class PrivateState:
    """Open descriptors only; no state path is retained or returned."""

    root_fd: int
    temp_fd: int
    files: dict[str, int]

    def file_fd(self, alias: str) -> int:
        if alias not in self.files:
            raise KeyError("private_file_alias_invalid")
        return _require_private_regular_fd(self.files[alias])

    def close(self) -> None:
        for fd in tuple(self.files.values()) + (self.temp_fd, self.root_fd):
            try:
                os.close(fd)
            except OSError:
                pass
        self.files.clear()

    def write_record_atomic(self, alias: str, value: Any) -> None:
        """Atomically replace the manifest or receipt through the held directory FD."""

        if alias not in {"state", "manifest", "receipt"}:
            raise ValueError("atomic_record_alias_invalid")
        filename = PRIVATE_FILE_LAYOUT[alias][0]
        pending = f".{filename}.pending"
        encoded_text = canonical_json(value)
        assert_forbidden_scan_clean(encoded_text)
        encoded = (encoded_text + "\n").encode("ascii")
        if len(encoded) > MAX_PRIVATE_FILE_BYTES:
            raise ValueError("atomic_record_too_large")
        if alias in {"manifest", "receipt"} and _read_all(self.file_fd(alias)):
            raise ValueError("immutable_record_already_written")
        pending_fd = os.open(pending, SAFE_CREATE_FLAGS, FILE_MODE, dir_fd=self.root_fd)
        try:
            _write_all(pending_fd, encoded)
            os.fsync(pending_fd)
        finally:
            os.close(pending_fd)
        os.replace(pending, filename, src_dir_fd=self.root_fd, dst_dir_fd=self.root_fd)
        os.fsync(self.root_fd)
        os.close(self.files[alias])
        replacement = os.open(filename, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=self.root_fd)
        _require_private_regular_fd(replacement)
        self.files[alias] = replacement

    def __enter__(self) -> "PrivateState":
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.close()


def initialize_private_state(
    parent_directory: str,
    run_name: str,
    *,
    repository_roots: tuple[str, ...],
) -> PrivateState:
    """Create one exclusive 0700 run directory and fixed 0600 state files."""

    if not isinstance(parent_directory, str) or not os.path.isabs(parent_directory):
        raise TypeError("private_parent_must_be_absolute")
    if not isinstance(repository_roots, tuple) or not repository_roots:
        raise TypeError("repository_roots_required")
    if _RUN_NAME.fullmatch(run_name) is None:
        raise ValueError("private_run_name_invalid")

    parent_real = os.path.realpath(parent_directory)
    _assert_outside_repositories(parent_real, run_name, repository_roots)
    parent_fd = os.open(parent_real, SAFE_DIRECTORY_FLAGS)
    parent_info = os.fstat(parent_fd)
    if (
        not stat.S_ISDIR(parent_info.st_mode)
        or parent_info.st_uid != os.geteuid()
        or stat.S_IMODE(parent_info.st_mode) & 0o077
    ):
        os.close(parent_fd)
        raise ValueError("private_parent_not_owner_only_directory")

    root_fd = -1
    temp_fd = -1
    file_fds: dict[str, int] = {}
    created_root = False
    old_umask = os.umask(0o077)
    try:
        os.mkdir(run_name, DIRECTORY_MODE, dir_fd=parent_fd)
        created_root = True
        root_fd = os.open(run_name, SAFE_DIRECTORY_FLAGS, dir_fd=parent_fd)
        root_info = os.fstat(root_fd)
        if root_info.st_uid != os.geteuid() or root_info.st_nlink < 2 or _mode(root_fd) != DIRECTORY_MODE:
            raise ValueError("private_root_mode_invalid")
        os.mkdir("tmp", DIRECTORY_MODE, dir_fd=root_fd)
        temp_fd = os.open("tmp", SAFE_DIRECTORY_FLAGS, dir_fd=root_fd)
        temp_info = os.fstat(temp_fd)
        if temp_info.st_uid != os.geteuid() or temp_info.st_nlink < 2 or _mode(temp_fd) != DIRECTORY_MODE:
            raise ValueError("private_temp_mode_invalid")
        for alias, (filename, initial) in PRIVATE_FILE_LAYOUT.items():
            fd = os.open(filename, SAFE_CREATE_FLAGS, FILE_MODE, dir_fd=root_fd)
            file_info = os.fstat(fd)
            if (
                not stat.S_ISREG(file_info.st_mode)
                or file_info.st_uid != os.geteuid()
                or _mode(fd) != FILE_MODE
                or file_info.st_nlink != 1
            ):
                os.close(fd)
                raise ValueError("private_file_mode_invalid")
            if not fcntl.fcntl(fd, fcntl.F_GETFD) & fcntl.FD_CLOEXEC:
                os.close(fd)
                raise ValueError("private_file_cloexec_missing")
            content = os.urandom(RUN_MAC_KEY_BYTES) if alias == "run-mac-key" else initial
            if alias == "run-mac-key" and len(content) != RUN_MAC_KEY_BYTES:
                os.close(fd)
                raise ValueError("run_mac_key_generation_failed")
            _write_all(fd, content)
            os.fsync(fd)
            file_fds[alias] = fd
        fcntl.flock(file_fds["lock"], fcntl.LOCK_EX | fcntl.LOCK_NB)
        expected_names = {"tmp", *(filename for filename, _initial in PRIVATE_FILE_LAYOUT.values())}
        if set(os.listdir(root_fd)) != expected_names:
            raise ValueError("private_layout_invalid")
        os.fsync(root_fd)
        os.fsync(parent_fd)
        return PrivateState(root_fd=root_fd, temp_fd=temp_fd, files=file_fds)
    except BaseException:
        for fd in file_fds.values():
            try:
                os.close(fd)
            except OSError:
                pass
        if root_fd >= 0:
            for filename, _initial in PRIVATE_FILE_LAYOUT.values():
                try:
                    os.unlink(filename, dir_fd=root_fd)
                except OSError:
                    pass
            try:
                os.rmdir("tmp", dir_fd=root_fd)
            except OSError:
                pass
        for fd in (temp_fd, root_fd):
            if fd >= 0:
                try:
                    os.close(fd)
                except OSError:
                    pass
        if created_root:
            try:
                os.rmdir(run_name, dir_fd=parent_fd)
            except OSError:
                pass
        raise
    finally:
        os.umask(old_umask)
        os.close(parent_fd)


def _recover_atomic_pending(root_fd: int) -> None:
    names = set(os.listdir(root_fd))
    for alias in ("state", "manifest", "receipt"):
        filename = PRIVATE_FILE_LAYOUT[alias][0]
        pending = f".{filename}.pending"
        if pending not in names:
            continue
        pending_fd = os.open(pending, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root_fd)
        try:
            info = os.fstat(pending_fd)
            raw = _read_all(pending_fd)
            valid = (
                stat.S_ISREG(info.st_mode)
                and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == FILE_MODE
                and info.st_nlink == 1
                and raw.endswith(b"\n")
                and raw.count(b"\n") == 1
            )
            if valid:
                text = raw.decode("ascii").rstrip("\n")
                assert_forbidden_scan_clean(text)
                valid = isinstance(json.loads(text), dict)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            valid = False
        finally:
            os.close(pending_fd)
        if valid:
            os.replace(pending, filename, src_dir_fd=root_fd, dst_dir_fd=root_fd)
            os.fsync(root_fd)
        else:
            os.unlink(pending, dir_fd=root_fd)


def reopen_private_state(
    parent_directory: str,
    run_name: str,
    *,
    repository_roots: tuple[str, ...],
) -> PrivateState:
    """Reopen a crashed run, recover atomic records, and reacquire its exclusive lock."""

    if not isinstance(parent_directory, str) or not os.path.isabs(parent_directory):
        raise TypeError("private_parent_must_be_absolute")
    if _RUN_NAME.fullmatch(run_name) is None:
        raise ValueError("private_run_name_invalid")
    parent_real = os.path.realpath(parent_directory)
    _assert_outside_repositories(parent_real, run_name, repository_roots)
    parent_fd = os.open(parent_real, SAFE_DIRECTORY_FLAGS)
    root_fd = -1
    temp_fd = -1
    files: dict[str, int] = {}
    try:
        parent_info = os.fstat(parent_fd)
        if (
            not stat.S_ISDIR(parent_info.st_mode)
            or parent_info.st_uid != os.geteuid()
            or stat.S_IMODE(parent_info.st_mode) & 0o077
        ):
            raise ValueError("private_parent_not_owner_only_directory")
        root_fd = os.open(run_name, SAFE_DIRECTORY_FLAGS, dir_fd=parent_fd)
        root_info = os.fstat(root_fd)
        if (
            not stat.S_ISDIR(root_info.st_mode)
            or root_info.st_uid != os.geteuid()
            or root_info.st_nlink < 2
            or stat.S_IMODE(root_info.st_mode) != DIRECTORY_MODE
        ):
            raise ValueError("private_root_invalid")
        lock_name = PRIVATE_FILE_LAYOUT["lock"][0]
        lock_fd = os.open(lock_name, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root_fd)
        _require_private_regular_fd(lock_fd)
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        files["lock"] = lock_fd
        _recover_atomic_pending(root_fd)
        expected_names = {"tmp", *(filename for filename, _initial in PRIVATE_FILE_LAYOUT.values())}
        if set(os.listdir(root_fd)) != expected_names:
            raise ValueError("private_layout_invalid")
        temp_fd = os.open("tmp", SAFE_DIRECTORY_FLAGS, dir_fd=root_fd)
        temp_info = os.fstat(temp_fd)
        if (
            not stat.S_ISDIR(temp_info.st_mode)
            or temp_info.st_uid != os.geteuid()
            or temp_info.st_nlink < 2
            or stat.S_IMODE(temp_info.st_mode) != DIRECTORY_MODE
        ):
            raise ValueError("private_temp_invalid")
        for alias, (filename, _initial) in PRIVATE_FILE_LAYOUT.items():
            if alias == "lock":
                continue
            fd = os.open(filename, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root_fd)
            _require_private_regular_fd(fd)
            if alias == "run-mac-key" and os.fstat(fd).st_size != RUN_MAC_KEY_BYTES:
                os.close(fd)
                raise ValueError("run_mac_key_invalid")
            files[alias] = fd
        return PrivateState(root_fd=root_fd, temp_fd=temp_fd, files=files)
    except BaseException:
        for fd in files.values():
            try:
                os.close(fd)
            except OSError:
                pass
        for fd in (temp_fd, root_fd):
            if fd >= 0:
                try:
                    os.close(fd)
                except OSError:
                    pass
        raise
    finally:
        os.close(parent_fd)


def validate_sensitive_fds(value: Any) -> dict[str, int]:
    """Reject secret/media values and paths; accept only the exact fixed FD aliases."""

    if not isinstance(value, Mapping) or set(value) != SENSITIVE_FD_ALIASES:
        raise TypeError("sensitive_fd_contract_invalid")
    validated: dict[str, int] = {}
    seen: set[int] = set()
    for alias in sorted(SENSITIVE_FD_ALIASES):
        fd = value[alias]
        if type(fd) is not int or fd <= 2 or fd in seen:
            raise TypeError("sensitive_fd_invalid")
        info = os.fstat(fd)
        if not (stat.S_ISREG(info.st_mode) or stat.S_ISFIFO(info.st_mode)):
            raise ValueError("sensitive_fd_type_invalid")
        validated[alias] = fd
        seen.add(fd)
    return validated


def read_private_record(fd: int) -> dict[str, Any]:
    _require_private_regular_fd(fd)
    raw = _read_all(fd)
    if not raw.endswith(b"\n") or raw.count(b"\n") != 1:
        raise ValueError("private_record_frame_invalid")
    try:
        text = raw.decode("ascii").rstrip("\n")
        assert_forbidden_scan_clean(text)
        value = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("private_record_invalid") from error
    if not isinstance(value, dict):
        raise ValueError("private_record_not_object")
    return value


class _HashChain:
    def __init__(self, fd: int, sanitizer: Callable[[Any], dict[str, Any]]) -> None:
        self._fd = _require_private_regular_fd(fd)
        self._sanitize = sanitizer
        self._recover_partial_tail()

    def _recover_partial_tail(self) -> None:
        """Drop only a non-newline-terminated crash tail, then verify the chain."""

        fcntl.flock(self._fd, fcntl.LOCK_EX)
        try:
            raw = _read_all(self._fd)
            if raw and not raw.endswith(b"\n"):
                boundary = raw.rfind(b"\n") + 1
                os.ftruncate(self._fd, boundary)
                os.fsync(self._fd)
            self._entries_unlocked()
        finally:
            fcntl.flock(self._fd, fcntl.LOCK_UN)

    def _entries_unlocked(self) -> list[dict[str, Any]]:
        raw = _read_all(self._fd)
        if not raw:
            return []
        try:
            lines = raw.decode("ascii").splitlines()
        except UnicodeDecodeError as error:
            raise ValueError("hash_chain_encoding_invalid") from error
        previous = GENESIS_HASH
        entries: list[dict[str, Any]] = []
        for sequence, line in enumerate(lines):
            entry = json.loads(line)
            if not isinstance(entry, Mapping) or set(entry) != {"sequence", "previousHash", "payload", "hash"}:
                raise ValueError("hash_chain_entry_invalid")
            payload = self._sanitize(entry["payload"])
            core = {"sequence": sequence, "previousHash": previous, "payload": payload}
            expected_hash = hashlib.sha256(canonical_json(core).encode("ascii")).hexdigest()
            if entry["sequence"] != sequence or entry["previousHash"] != previous or entry["hash"] != expected_hash:
                raise ValueError("hash_chain_mismatch")
            clean_entry = {**core, "hash": expected_hash}
            entries.append(clean_entry)
            previous = expected_hash
        return entries

    def entries(self) -> tuple[dict[str, Any], ...]:
        fcntl.flock(self._fd, fcntl.LOCK_SH)
        try:
            return tuple(self._entries_unlocked())
        finally:
            fcntl.flock(self._fd, fcntl.LOCK_UN)

    def append(self, payload: Any) -> dict[str, Any]:
        clean_payload = self._sanitize(payload)
        fcntl.flock(self._fd, fcntl.LOCK_EX)
        try:
            entries = self._entries_unlocked()
            core = {
                "sequence": len(entries),
                "previousHash": entries[-1]["hash"] if entries else GENESIS_HASH,
                "payload": clean_payload,
            }
            entry = {**core, "hash": hashlib.sha256(canonical_json(core).encode("ascii")).hexdigest()}
            line = (canonical_json(entry) + "\n").encode("ascii")
            os.lseek(self._fd, 0, os.SEEK_END)
            _write_all(self._fd, line)
            os.fsync(self._fd)
            return entry
        finally:
            fcntl.flock(self._fd, fcntl.LOCK_UN)


class EvidenceChain(_HashChain):
    def __init__(self, fd: int) -> None:
        super().__init__(fd, sanitize_evidence)

    def assert_forbidden_scan_clean(self) -> None:
        assert_forbidden_scan_clean(_read_all(self._fd).decode("ascii"))


def _sanitize_mcp_attestation(value: Any) -> dict[str, Any]:
    keys = {
        "schemaVersion",
        "operation",
        "targetHmac",
        "permitHash",
        "consumeHash",
        "dispatchHash",
        "safeReceiptHmac",
        "requestHash",
        "responseHmac",
        "preconditionHash",
        "postconditionHash",
        "success",
        "schemaValid",
        "developmentMatch",
        "productionAction",
        "safeCode",
    }
    if not isinstance(value, Mapping) or set(value) != keys:
        raise TypeError("mcp_attestation_keys_invalid")
    if (
        value["schemaVersion"] != "protected-mcp-attestation.v2"
        or value["operation"] not in MCP_OPERATIONS
        or not isinstance(value["targetHmac"], str)
        or _HMAC.fullmatch(value["targetHmac"]) is None
        or not isinstance(value["requestHash"], str)
        or not isinstance(value["responseHmac"], str)
        or _HMAC.fullmatch(value["responseHmac"]) is None
        or not isinstance(value["preconditionHash"], str)
        or _HMAC.fullmatch(value["preconditionHash"]) is None
        or not isinstance(value["postconditionHash"], str)
        or _HMAC.fullmatch(value["postconditionHash"]) is None
        or type(value["success"]) is not bool
        or type(value["schemaValid"]) is not bool
        or type(value["developmentMatch"]) is not bool
        or value["productionAction"] is not False
    ):
        raise ValueError("mcp_attestation_invalid")
    require_sha256(value["requestHash"], "mcp_request_hash")
    if value["permitHash"] is not None:
        require_sha256(value["permitHash"], "mcp_permit_hash")
    mutation_bindings = (
        value["permitHash"],
        value["consumeHash"],
        value["dispatchHash"],
        value["safeReceiptHmac"],
    )
    if value["operation"] == "apply_migration":
        if any(binding is None for binding in mutation_bindings):
            raise ValueError("mcp_mutation_binding_missing")
        require_sha256(value["consumeHash"], "mcp_consume_hash")
        require_sha256(value["dispatchHash"], "mcp_dispatch_hash")
        if (
            not isinstance(value["safeReceiptHmac"], str)
            or _HMAC.fullmatch(value["safeReceiptHmac"]) is None
            or not hmac.compare_digest(value["safeReceiptHmac"], value["responseHmac"])
        ):
            raise ValueError("mcp_mutation_receipt_invalid")
    elif any(binding is not None for binding in mutation_bindings):
        raise ValueError("mcp_read_only_mutation_binding_forbidden")
    if value["success"]:
        if value["schemaValid"] is not True or value["developmentMatch"] is not True or value["safeCode"] is not None:
            raise ValueError("mcp_success_attestation_invalid")
    elif value["safeCode"] not in MCP_SAFE_CODES:
        raise ValueError("mcp_failure_safe_code_invalid")
    return dict(value)


class McpAttestationChain(_HashChain):
    def __init__(self, fd: int) -> None:
        super().__init__(fd, _sanitize_mcp_attestation)


def _sanitize_browser_attestation(value: Any) -> dict[str, Any]:
    keys = {
        "schemaVersion",
        "operation",
        "resultHmac",
        "success",
        "booleanCount",
        "boundedCount",
        "capturedArtifacts",
    }
    if not isinstance(value, Mapping) or set(value) != keys:
        raise TypeError("browser_attestation_keys_invalid")
    if (
        value["schemaVersion"] != "protected-browser-attestation.v1"
        or value["operation"] != "ui_probe"
        or not isinstance(value["resultHmac"], str)
        or _HMAC.fullmatch(value["resultHmac"]) is None
        or value["success"] is not True
        or type(value["booleanCount"]) is not int
        or not 1 <= value["booleanCount"] <= 64
        or type(value["boundedCount"]) is not int
        or not 0 <= value["boundedCount"] <= 64
        or type(value["capturedArtifacts"]) is not int
        or value["capturedArtifacts"] != 0
    ):
        raise ValueError("browser_attestation_invalid")
    return dict(value)


class BrowserAttestationChain(_HashChain):
    def __init__(self, fd: int) -> None:
        super().__init__(fd, _sanitize_browser_attestation)


def _sanitize_mutation_permit_record(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping) or value.get("kind") not in {
        "issue",
        "consume",
        "dispatch",
        "outcome",
        "reconcile",
    }:
        raise TypeError("mutation_permit_record_invalid")
    kind = value["kind"]
    if kind == "issue":
        if set(value) != {
            "kind",
            "operation",
            "action",
            "developmentTargetHmac",
            "developmentTargetCapabilityHmac",
            "payloadSha256",
            "caseId",
            "idempotencyHmac",
            "requiredState",
            "controllerStateHash",
            "controllerStateSequence",
            "issuedMonotonicNs",
            "expiresMonotonicNs",
            "nonceCommitment",
            "permitMac",
        }:
            raise TypeError("mutation_permit_issue_keys_invalid")
        if (
            value["operation"] not in MUTATION_OPERATIONS
            or value["action"] not in MUTATION_ACTIONS
            or value["caseId"] not in MUTATION_CASE_IDS
            or value["requiredState"] not in MUTATION_STATES
            or value["action"].removeprefix("apply_migration_") not in value["requiredState"]
            or not isinstance(value["developmentTargetHmac"], str)
            or _HMAC.fullmatch(value["developmentTargetHmac"]) is None
            or not isinstance(value["developmentTargetCapabilityHmac"], str)
            or _HMAC.fullmatch(value["developmentTargetCapabilityHmac"]) is None
            or not isinstance(value["idempotencyHmac"], str)
            or _HMAC.fullmatch(value["idempotencyHmac"]) is None
            or type(value["controllerStateSequence"]) is not int
            or value["controllerStateSequence"] < 0
            or type(value["issuedMonotonicNs"]) is not int
            or value["issuedMonotonicNs"] < 0
            or type(value["expiresMonotonicNs"]) is not int
            or value["expiresMonotonicNs"] <= value["issuedMonotonicNs"]
            or value["expiresMonotonicNs"] - value["issuedMonotonicNs"] < MIN_MUTATION_PERMIT_TTL_NS
            or value["expiresMonotonicNs"] - value["issuedMonotonicNs"] > MAX_MUTATION_PERMIT_TTL_NS
            or not isinstance(value["permitMac"], str)
            or _HMAC.fullmatch(value["permitMac"]) is None
        ):
            raise ValueError("mutation_permit_issue_invalid")
        require_sha256(value["payloadSha256"], "mutation_payload")
        require_sha256(value["controllerStateHash"], "mutation_controller_state")
        require_sha256(value["nonceCommitment"], "mutation_nonce_commitment")
        return dict(value)
    if kind == "consume":
        if set(value) != {
            "kind",
            "permitHash",
            "operation",
            "action",
            "developmentTargetHmac",
            "developmentTargetCapabilityHmac",
            "payloadSha256",
            "caseId",
            "idempotencyHmac",
            "controllerState",
            "controllerStateHash",
            "controllerStateSequence",
            "consumedMonotonicNs",
        }:
            raise TypeError("mutation_permit_consume_keys_invalid")
        if (
            not isinstance(value["permitHash"], str)
            or re.fullmatch(r"[a-f0-9]{64}", value["permitHash"]) is None
            or value["operation"] not in MUTATION_OPERATIONS
            or value["action"] not in MUTATION_ACTIONS
            or value["caseId"] not in MUTATION_CASE_IDS
            or value["controllerState"] not in MUTATION_STATES
            or value["action"].removeprefix("apply_migration_") not in value["controllerState"]
            or not isinstance(value["developmentTargetHmac"], str)
            or _HMAC.fullmatch(value["developmentTargetHmac"]) is None
            or not isinstance(value["developmentTargetCapabilityHmac"], str)
            or _HMAC.fullmatch(value["developmentTargetCapabilityHmac"]) is None
            or not isinstance(value["idempotencyHmac"], str)
            or _HMAC.fullmatch(value["idempotencyHmac"]) is None
            or type(value["controllerStateSequence"]) is not int
            or value["controllerStateSequence"] < 0
            or type(value["consumedMonotonicNs"]) is not int
            or value["consumedMonotonicNs"] < 0
        ):
            raise ValueError("mutation_permit_consume_invalid")
        require_sha256(value["payloadSha256"], "mutation_payload")
        require_sha256(value["controllerStateHash"], "mutation_controller_state")
        return dict(value)
    if kind == "dispatch":
        if set(value) != {
            "kind",
            "consumeHash",
            "permitHash",
            "operation",
            "action",
            "developmentTargetHmac",
            "developmentTargetCapabilityHmac",
            "payloadSha256",
            "caseId",
            "idempotencyHmac",
            "controllerState",
            "controllerStateHash",
            "controllerStateSequence",
            "dispatchedMonotonicNs",
            "authorizationMac",
        }:
            raise TypeError("mutation_permit_dispatch_keys_invalid")
        if (
            not isinstance(value["consumeHash"], str)
            or re.fullmatch(r"[a-f0-9]{64}", value["consumeHash"]) is None
            or not isinstance(value["permitHash"], str)
            or re.fullmatch(r"[a-f0-9]{64}", value["permitHash"]) is None
            or value["operation"] not in MUTATION_OPERATIONS
            or value["action"] not in MUTATION_ACTIONS
            or value["caseId"] not in MUTATION_CASE_IDS
            or value["controllerState"] not in MUTATION_STATES
            or value["action"].removeprefix("apply_migration_") not in value["controllerState"]
            or not isinstance(value["developmentTargetHmac"], str)
            or _HMAC.fullmatch(value["developmentTargetHmac"]) is None
            or not isinstance(value["developmentTargetCapabilityHmac"], str)
            or _HMAC.fullmatch(value["developmentTargetCapabilityHmac"]) is None
            or not isinstance(value["idempotencyHmac"], str)
            or _HMAC.fullmatch(value["idempotencyHmac"]) is None
            or type(value["controllerStateSequence"]) is not int
            or value["controllerStateSequence"] < 0
            or type(value["dispatchedMonotonicNs"]) is not int
            or value["dispatchedMonotonicNs"] < 0
            or not isinstance(value["authorizationMac"], str)
            or _HMAC.fullmatch(value["authorizationMac"]) is None
        ):
            raise ValueError("mutation_permit_dispatch_invalid")
        require_sha256(value["payloadSha256"], "mutation_payload")
        require_sha256(value["controllerStateHash"], "mutation_controller_state")
        return dict(value)
    if kind == "outcome":
        if set(value) != {
            "kind",
            "consumeHash",
            "dispatchHash",
            "safeReceiptHmac",
            "outcome",
            "outcomeMac",
        }:
            raise TypeError("mutation_permit_outcome_keys_invalid")
        if (
            not isinstance(value["consumeHash"], str)
            or re.fullmatch(r"[a-f0-9]{64}", value["consumeHash"]) is None
            or not isinstance(value["dispatchHash"], str)
            or re.fullmatch(r"[a-f0-9]{64}", value["dispatchHash"]) is None
            or not isinstance(value["safeReceiptHmac"], str)
            or _HMAC.fullmatch(value["safeReceiptHmac"]) is None
            or value["outcome"] not in MUTATION_OUTCOMES
            or not isinstance(value["outcomeMac"], str)
            or _HMAC.fullmatch(value["outcomeMac"]) is None
        ):
            raise ValueError("mutation_permit_outcome_invalid")
        return dict(value)
    if set(value) != {"kind", "consumeHash", "effectPresent"}:
        raise TypeError("mutation_permit_reconcile_keys_invalid")
    if (
        not isinstance(value["consumeHash"], str)
        or re.fullmatch(r"[a-f0-9]{64}", value["consumeHash"]) is None
        or type(value["effectPresent"]) is not bool
    ):
        raise ValueError("mutation_permit_reconcile_invalid")
    return dict(value)


class MutationPermitLedger(_HashChain):
    """Issue, consume, and dispatch short-lived MAC-authenticated mutation permits."""

    def __init__(self, fd: int) -> None:
        super().__init__(fd, _sanitize_mutation_permit_record)

    @staticmethod
    def _read_mac_key(mac_key_fd: int) -> bytes:
        key = _read_external_fd(mac_key_fd, 4096)
        if len(key) < 32:
            raise ValueError("mutation_permit_mac_key_invalid")
        return key

    @staticmethod
    def _mac(
        key: bytes,
        payload: Mapping[str, Any],
        *,
        wal_sequence: int,
        wal_previous_hash: str,
    ) -> str:
        binding = {
            "schemaVersion": "protected-mutation-permit.v1",
            "walSequence": wal_sequence,
            "walPreviousHash": wal_previous_hash,
            "permit": {name: field for name, field in payload.items() if name != "permitMac"},
        }
        digest = hmac.new(
            key,
            _MUTATION_PERMIT_MAC_DOMAIN + canonical_json(binding).encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        return f"hmac-sha256:{digest}"

    @staticmethod
    def _dispatch_mac(key: bytes, payload: Mapping[str, Any]) -> str:
        binding = {
            "schemaVersion": "protected-mutation-dispatch.v1",
            "dispatch": {
                name: field for name, field in payload.items() if name != "authorizationMac"
            },
        }
        digest = hmac.new(
            key,
            _MUTATION_DISPATCH_MAC_DOMAIN + canonical_json(binding).encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        return f"hmac-sha256:{digest}"

    @staticmethod
    def _outcome_mac(key: bytes, payload: Mapping[str, Any]) -> str:
        binding = {
            "schemaVersion": "protected-mutation-outcome.v1",
            "outcome": {
                name: field for name, field in payload.items() if name != "outcomeMac"
            },
        }
        digest = hmac.new(
            key,
            _MUTATION_OUTCOME_MAC_DOMAIN + canonical_json(binding).encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        return f"hmac-sha256:{digest}"

    @staticmethod
    def _append_unlocked(fd: int, entries: list[dict[str, Any]], payload: dict[str, Any]) -> dict[str, Any]:
        core = {
            "sequence": len(entries),
            "previousHash": entries[-1]["hash"] if entries else GENESIS_HASH,
            "payload": payload,
        }
        entry = {**core, "hash": hashlib.sha256(canonical_json(core).encode("ascii")).hexdigest()}
        os.lseek(fd, 0, os.SEEK_END)
        _write_all(fd, (canonical_json(entry) + "\n").encode("ascii"))
        os.fsync(fd)
        return entry

    @classmethod
    def _verify_consumption_entries(
        cls,
        entries: tuple[dict[str, Any], ...] | list[dict[str, Any]],
        key: bytes,
        consume_hash: str,
        *,
        operation: str,
        action: str,
        development_target_hmac: str,
        development_target_capability_hmac: str,
        payload_sha256: str,
        case_id: str,
        idempotency_hmac: str,
        controller_state: str,
        controller_state_hash: str,
        controller_state_sequence: int,
    ) -> dict[str, Any]:
        entry_by_hash = {entry["hash"]: entry for entry in entries}
        consume = entry_by_hash.get(consume_hash)
        if consume is None or consume["payload"].get("kind") != "consume":
            raise ValueError("mutation_permit_consume_missing")
        payload = consume["payload"]
        expected = {
            "kind": "consume",
            "permitHash": payload["permitHash"],
            "operation": operation,
            "action": action,
            "developmentTargetHmac": development_target_hmac,
            "developmentTargetCapabilityHmac": development_target_capability_hmac,
            "payloadSha256": f"sha256:{require_sha256(payload_sha256, 'mutation_payload')}",
            "caseId": case_id,
            "idempotencyHmac": idempotency_hmac,
            "controllerState": controller_state,
            "controllerStateHash": f"sha256:{require_sha256(controller_state_hash, 'mutation_controller_state')}",
            "controllerStateSequence": controller_state_sequence,
            "consumedMonotonicNs": payload["consumedMonotonicNs"],
        }
        if payload != expected:
            raise ValueError("mutation_permit_consume_binding_mismatch")
        issue = entry_by_hash.get(payload["permitHash"])
        if issue is None or issue["payload"].get("kind") != "issue":
            raise ValueError("mutation_permit_issue_missing")
        issued = issue["payload"]
        expected_issue_fields = {
            "operation": operation,
            "action": action,
            "developmentTargetHmac": development_target_hmac,
            "developmentTargetCapabilityHmac": development_target_capability_hmac,
            "payloadSha256": expected["payloadSha256"],
            "caseId": case_id,
            "idempotencyHmac": idempotency_hmac,
            "requiredState": controller_state,
            "controllerStateHash": expected["controllerStateHash"],
            "controllerStateSequence": controller_state_sequence,
        }
        if any(issued[name] != value for name, value in expected_issue_fields.items()):
            raise ValueError("mutation_permit_issue_binding_mismatch")
        if not issued["issuedMonotonicNs"] <= payload["consumedMonotonicNs"] < issued["expiresMonotonicNs"]:
            raise ValueError("mutation_permit_consumption_time_invalid")
        expected_mac = cls._mac(
            key,
            issued,
            wal_sequence=issue["sequence"],
            wal_previous_hash=issue["previousHash"],
        )
        if not hmac.compare_digest(expected_mac, issued["permitMac"]):
            raise ValueError("mutation_permit_mac_invalid")
        return {
            "verified": True,
            "permitHash": payload["permitHash"],
            "consumeHash": consume_hash,
            "controllerStateSequence": controller_state_sequence,
            "consumePayload": payload,
            "expiresMonotonicNs": issued["expiresMonotonicNs"],
        }

    def issue(
        self,
        *,
        operation: str,
        action: str,
        development_target_hmac: str,
        development_target_capability_hmac: str,
        payload_sha256: str,
        case_id: str,
        idempotency_hmac: str,
        required_state: str,
        controller_state_hash: str,
        controller_state_sequence: int,
        ttl_ns: int,
        mac_key_fd: int,
    ) -> str:
        if type(ttl_ns) is not int:
            raise TypeError("mutation_permit_ttl_invalid")
        key = self._read_mac_key(mac_key_fd)
        issued_at = time.monotonic_ns()
        nonce = os.urandom(32)
        if len(nonce) != 32:
            raise RuntimeError("mutation_permit_nonce_unavailable")
        payload = {
            "kind": "issue",
            "operation": operation,
            "action": action,
            "developmentTargetHmac": development_target_hmac,
            "developmentTargetCapabilityHmac": development_target_capability_hmac,
            "payloadSha256": f"sha256:{require_sha256(payload_sha256, 'mutation_payload')}",
            "caseId": case_id,
            "idempotencyHmac": idempotency_hmac,
            "requiredState": required_state,
            "controllerStateHash": f"sha256:{require_sha256(controller_state_hash, 'mutation_controller_state')}",
            "controllerStateSequence": controller_state_sequence,
            "issuedMonotonicNs": issued_at,
            "expiresMonotonicNs": issued_at + ttl_ns,
            "nonceCommitment": f"sha256:{hashlib.sha256(nonce).hexdigest()}",
        }
        fcntl.flock(self._fd, fcntl.LOCK_EX)
        try:
            entries = self._entries_unlocked()
            issues = [entry for entry in entries if entry["payload"]["kind"] == "issue"]
            if any(entry["payload"]["idempotencyHmac"] == idempotency_hmac for entry in issues):
                raise ValueError("mutation_permit_idempotency_reused")
            if issues and controller_state_sequence <= max(
                entry["payload"]["controllerStateSequence"] for entry in issues
            ):
                raise ValueError("mutation_permit_state_sequence_not_advanced")
            previous_hash = entries[-1]["hash"] if entries else GENESIS_HASH
            payload["permitMac"] = self._mac(
                key,
                payload,
                wal_sequence=len(entries),
                wal_previous_hash=previous_hash,
            )
            clean_payload = _sanitize_mutation_permit_record(payload)
            return self._append_unlocked(self._fd, entries, clean_payload)["hash"]
        finally:
            fcntl.flock(self._fd, fcntl.LOCK_UN)

    def consume(
        self,
        permit_hash: str,
        *,
        operation: str,
        action: str,
        development_target_hmac: str,
        development_target_capability_hmac: str,
        payload_sha256: str,
        case_id: str,
        idempotency_hmac: str,
        controller_state: str,
        controller_state_hash: str,
        controller_state_sequence: int,
        mac_key_fd: int,
    ) -> str:
        key = self._read_mac_key(mac_key_fd)
        consumed_at = time.monotonic_ns()
        consume_payload = _sanitize_mutation_permit_record(
            {
                "kind": "consume",
                "permitHash": permit_hash,
                "operation": operation,
                "action": action,
                "developmentTargetHmac": development_target_hmac,
                "developmentTargetCapabilityHmac": development_target_capability_hmac,
                "payloadSha256": f"sha256:{require_sha256(payload_sha256, 'mutation_payload')}",
                "caseId": case_id,
                "idempotencyHmac": idempotency_hmac,
                "controllerState": controller_state,
                "controllerStateHash": f"sha256:{require_sha256(controller_state_hash, 'mutation_controller_state')}",
                "controllerStateSequence": controller_state_sequence,
                "consumedMonotonicNs": consumed_at,
            }
        )
        fcntl.flock(self._fd, fcntl.LOCK_EX)
        try:
            entries = self._entries_unlocked()
            issues = {entry["hash"]: entry for entry in entries if entry["payload"]["kind"] == "issue"}
            consumed = {entry["payload"]["permitHash"] for entry in entries if entry["payload"]["kind"] == "consume"}
            issue = issues.get(permit_hash)
            if issue is None or permit_hash in consumed:
                raise ValueError("mutation_permit_unavailable")
            issued_payload = issue["payload"]
            expected_binding = {
                "operation": consume_payload["operation"],
                "action": consume_payload["action"],
                "developmentTargetHmac": consume_payload["developmentTargetHmac"],
                "developmentTargetCapabilityHmac": consume_payload[
                    "developmentTargetCapabilityHmac"
                ],
                "payloadSha256": consume_payload["payloadSha256"],
                "caseId": consume_payload["caseId"],
                "idempotencyHmac": consume_payload["idempotencyHmac"],
                "requiredState": consume_payload["controllerState"],
                "controllerStateHash": consume_payload["controllerStateHash"],
                "controllerStateSequence": consume_payload["controllerStateSequence"],
            }
            if any(issued_payload[name] != field for name, field in expected_binding.items()):
                raise ValueError("mutation_permit_binding_mismatch")
            if consumed_at < issued_payload["issuedMonotonicNs"] or consumed_at >= issued_payload["expiresMonotonicNs"]:
                raise ValueError("mutation_permit_expired")
            expected_mac = self._mac(
                key,
                issued_payload,
                wal_sequence=issue["sequence"],
                wal_previous_hash=issue["previousHash"],
            )
            if not hmac.compare_digest(expected_mac, issued_payload["permitMac"]):
                raise ValueError("mutation_permit_mac_invalid")
            return self._append_unlocked(self._fd, entries, consume_payload)["hash"]
        finally:
            fcntl.flock(self._fd, fcntl.LOCK_UN)

    def verify_consumption(
        self,
        consume_hash: str,
        *,
        operation: str,
        action: str,
        development_target_hmac: str,
        development_target_capability_hmac: str,
        payload_sha256: str,
        case_id: str,
        idempotency_hmac: str,
        controller_state: str,
        controller_state_hash: str,
        controller_state_sequence: int,
        mac_key_fd: int,
    ) -> dict[str, Any]:
        key = self._read_mac_key(mac_key_fd)
        entries = self.entries()
        verified = self._verify_consumption_entries(
            entries,
            key,
            consume_hash,
            operation=operation,
            action=action,
            development_target_hmac=development_target_hmac,
            development_target_capability_hmac=development_target_capability_hmac,
            payload_sha256=payload_sha256,
            case_id=case_id,
            idempotency_hmac=idempotency_hmac,
            controller_state=controller_state,
            controller_state_hash=controller_state_hash,
            controller_state_sequence=controller_state_sequence,
        )
        return {name: verified[name] for name in ("verified", "permitHash", "consumeHash", "controllerStateSequence")}

    def authorize_dispatch(
        self,
        consume_hash: str,
        *,
        permit_hash: str,
        operation: str,
        action: str,
        development_target_hmac: str,
        development_target_capability_hmac: str,
        payload_sha256: str,
        case_id: str,
        idempotency_hmac: str,
        controller_state: str,
        controller_state_hash: str,
        controller_state_sequence: int,
        mac_key_fd: int,
    ) -> dict[str, Any]:
        """Durably authorize exactly one external mutation dispatch."""

        key = self._read_mac_key(mac_key_fd)
        dispatched_at = time.monotonic_ns()
        fcntl.flock(self._fd, fcntl.LOCK_EX)
        try:
            entries = self._entries_unlocked()
            if any(
                entry["payload"].get("kind") == "dispatch"
                and entry["payload"].get("consumeHash") == consume_hash
                for entry in entries
            ):
                raise ValueError("mutation_dispatch_unavailable")
            verified = self._verify_consumption_entries(
                entries,
                key,
                consume_hash,
                operation=operation,
                action=action,
                development_target_hmac=development_target_hmac,
                development_target_capability_hmac=development_target_capability_hmac,
                payload_sha256=payload_sha256,
                case_id=case_id,
                idempotency_hmac=idempotency_hmac,
                controller_state=controller_state,
                controller_state_hash=controller_state_hash,
                controller_state_sequence=controller_state_sequence,
            )
            if verified["permitHash"] != permit_hash:
                raise ValueError("mutation_dispatch_permit_mismatch")
            consumed_at = verified["consumePayload"]["consumedMonotonicNs"]
            if not consumed_at <= dispatched_at < verified["expiresMonotonicNs"]:
                raise ValueError("mutation_dispatch_time_invalid")
            dispatch_payload = {
                "kind": "dispatch",
                "consumeHash": consume_hash,
                "permitHash": permit_hash,
                "operation": operation,
                "action": action,
                "developmentTargetHmac": development_target_hmac,
                "developmentTargetCapabilityHmac": development_target_capability_hmac,
                "payloadSha256": f"sha256:{require_sha256(payload_sha256, 'mutation_payload')}",
                "caseId": case_id,
                "idempotencyHmac": idempotency_hmac,
                "controllerState": controller_state,
                "controllerStateHash": f"sha256:{require_sha256(controller_state_hash, 'mutation_controller_state')}",
                "controllerStateSequence": controller_state_sequence,
                "dispatchedMonotonicNs": dispatched_at,
            }
            dispatch_payload["authorizationMac"] = self._dispatch_mac(key, dispatch_payload)
            clean_payload = _sanitize_mutation_permit_record(dispatch_payload)
            dispatch = self._append_unlocked(self._fd, entries, clean_payload)
            return {
                "verified": True,
                "permitHash": permit_hash,
                "consumeHash": consume_hash,
                "dispatchHash": dispatch["hash"],
                "developmentTargetCapabilityHmac": development_target_capability_hmac,
            }
        finally:
            fcntl.flock(self._fd, fcntl.LOCK_UN)

    def verify_dispatch(
        self,
        dispatch_hash: str,
        *,
        consume_hash: str,
        permit_hash: str,
        operation: str,
        action: str,
        development_target_hmac: str,
        development_target_capability_hmac: str,
        payload_sha256: str,
        mac_key_fd: int,
    ) -> dict[str, Any]:
        key = self._read_mac_key(mac_key_fd)
        entries = self.entries()
        payload = self._verify_dispatch_entries(entries, key, dispatch_hash)
        expected_public_binding = {
            "consumeHash": consume_hash,
            "permitHash": permit_hash,
            "operation": operation,
            "action": action,
            "developmentTargetHmac": development_target_hmac,
            "developmentTargetCapabilityHmac": development_target_capability_hmac,
            "payloadSha256": f"sha256:{require_sha256(payload_sha256, 'mutation_payload')}",
        }
        if any(payload[name] != value for name, value in expected_public_binding.items()):
            raise ValueError("mutation_dispatch_binding_mismatch")
        return {
            "verified": True,
            "permitHash": permit_hash,
            "consumeHash": consume_hash,
            "dispatchHash": dispatch_hash,
            "developmentTargetCapabilityHmac": development_target_capability_hmac,
        }

    @classmethod
    def _verify_dispatch_entries(
        cls,
        entries: tuple[dict[str, Any], ...] | list[dict[str, Any]],
        key: bytes,
        dispatch_hash: str,
    ) -> dict[str, Any]:
        entry_by_hash = {entry["hash"]: entry for entry in entries}
        dispatch = entry_by_hash.get(dispatch_hash)
        if dispatch is None or dispatch["payload"].get("kind") != "dispatch":
            raise ValueError("mutation_dispatch_missing")
        payload = dispatch["payload"]
        verified_consumption = cls._verify_consumption_entries(
            entries,
            key,
            payload["consumeHash"],
            operation=payload["operation"],
            action=payload["action"],
            development_target_hmac=payload["developmentTargetHmac"],
            development_target_capability_hmac=payload["developmentTargetCapabilityHmac"],
            payload_sha256=payload["payloadSha256"],
            case_id=payload["caseId"],
            idempotency_hmac=payload["idempotencyHmac"],
            controller_state=payload["controllerState"],
            controller_state_hash=payload["controllerStateHash"],
            controller_state_sequence=payload["controllerStateSequence"],
        )
        if not (
            verified_consumption["consumePayload"]["consumedMonotonicNs"]
            <= payload["dispatchedMonotonicNs"]
            < verified_consumption["expiresMonotonicNs"]
        ):
            raise ValueError("mutation_dispatch_time_invalid")
        if not hmac.compare_digest(cls._dispatch_mac(key, payload), payload["authorizationMac"]):
            raise ValueError("mutation_dispatch_mac_invalid")
        return payload

    @classmethod
    def _recovery_dispatches_unlocked(
        cls,
        entries: tuple[dict[str, Any], ...] | list[dict[str, Any]],
        key: bytes,
    ) -> tuple[dict[str, Any], ...]:
        outcomes: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
        for entry in entries:
            payload = entry["payload"]
            if payload.get("kind") != "outcome":
                continue
            consume_hash = payload["consumeHash"]
            if consume_hash in outcomes:
                raise ValueError("mutation_recovery_outcome_ambiguous")
            dispatch = cls._verify_dispatch_entries(entries, key, payload["dispatchHash"])
            if (
                dispatch["consumeHash"] != consume_hash
                or not hmac.compare_digest(cls._outcome_mac(key, payload), payload["outcomeMac"])
            ):
                raise ValueError("mutation_recovery_outcome_invalid")
            outcomes[consume_hash] = (entry, payload)

        dispatches: list[dict[str, Any]] = []
        seen_consumptions: set[str] = set()
        for entry in entries:
            payload = entry["payload"]
            if payload.get("kind") != "dispatch":
                continue
            dispatch_hash = entry["hash"]
            verified = cls._verify_dispatch_entries(entries, key, dispatch_hash)
            consume_hash = verified["consumeHash"]
            if consume_hash in seen_consumptions:
                raise ValueError("mutation_recovery_dispatch_ambiguous")
            seen_consumptions.add(consume_hash)
            outcome_record = outcomes.get(consume_hash)
            if outcome_record is None:
                outcome_entry = None
                outcome = None
            else:
                outcome_entry, outcome = outcome_record
            if outcome is not None and outcome["dispatchHash"] != dispatch_hash:
                raise ValueError("mutation_recovery_outcome_dispatch_mismatch")
            dispatches.append(
                {
                    "dispatchHash": dispatch_hash,
                    "consumeHash": consume_hash,
                    "permitHash": verified["permitHash"],
                    "operation": verified["operation"],
                    "action": verified["action"],
                    "developmentTargetHmac": verified["developmentTargetHmac"],
                    "developmentTargetCapabilityHmac": verified[
                        "developmentTargetCapabilityHmac"
                    ],
                    "payloadSha256": require_sha256(
                        verified["payloadSha256"], "mutation_payload"
                    ),
                    "caseId": verified["caseId"],
                    "idempotencyHmac": verified["idempotencyHmac"],
                    "controllerState": verified["controllerState"],
                    "controllerStateHash": require_sha256(
                        verified["controllerStateHash"], "mutation_controller_state"
                    ),
                    "controllerStateSequence": verified["controllerStateSequence"],
                    "outcome": None if outcome is None else outcome["outcome"],
                    "outcomeHash": None if outcome_entry is None else outcome_entry["hash"],
                    "safeReceiptHmac": None
                    if outcome is None
                    else outcome["safeReceiptHmac"],
                }
            )
        if not set(outcomes).issubset(seen_consumptions):
            raise ValueError("mutation_recovery_orphan_outcome")
        return tuple(dispatches)

    def recovery_dispatches(self, *, mac_key_fd: int) -> tuple[dict[str, Any], ...]:
        """Enumerate MAC-verified dispatches and their exact durable outcome state."""

        key = self._read_mac_key(mac_key_fd)
        fcntl.flock(self._fd, fcntl.LOCK_SH)
        try:
            return self._recovery_dispatches_unlocked(self._entries_unlocked(), key)
        finally:
            fcntl.flock(self._fd, fcntl.LOCK_UN)

    def pending_dispatches(self, *, mac_key_fd: int) -> tuple[dict[str, Any], ...]:
        """Enumerate only MAC-verified dispatches without a durable outcome."""

        return tuple(
            dispatch
            for dispatch in self.recovery_dispatches(mac_key_fd=mac_key_fd)
            if dispatch["outcome"] is None
        )

    def recover_unknown_outcome(
        self,
        *,
        dispatch_hash: str,
        consume_hash: str,
        permit_hash: str,
        operation: str,
        action: str,
        development_target_hmac: str,
        development_target_capability_hmac: str,
        payload_sha256: str,
        case_id: str,
        idempotency_hmac: str,
        controller_state: str,
        controller_state_hash: str,
        controller_state_sequence: int,
        safe_receipt_hmac: str,
        mac_key_fd: int,
    ) -> dict[str, Any]:
        """Durably record or replay one exact UNKNOWN dispatch outcome."""

        key = self._read_mac_key(mac_key_fd)
        expected = {
            "dispatchHash": require_sha256(dispatch_hash, "mutation_dispatch"),
            "consumeHash": require_sha256(consume_hash, "mutation_consume"),
            "permitHash": require_sha256(permit_hash, "mutation_permit"),
            "operation": operation,
            "action": action,
            "developmentTargetHmac": development_target_hmac,
            "developmentTargetCapabilityHmac": development_target_capability_hmac,
            "payloadSha256": require_sha256(payload_sha256, "mutation_payload"),
            "caseId": case_id,
            "idempotencyHmac": idempotency_hmac,
            "controllerState": controller_state,
            "controllerStateHash": require_sha256(
                controller_state_hash, "mutation_controller_state"
            ),
            "controllerStateSequence": controller_state_sequence,
        }
        raw_outcome = {
            "kind": "outcome",
            "consumeHash": expected["consumeHash"],
            "dispatchHash": expected["dispatchHash"],
            "safeReceiptHmac": safe_receipt_hmac,
            "outcome": "unknown",
        }
        raw_outcome["outcomeMac"] = self._outcome_mac(key, raw_outcome)
        outcome_payload = _sanitize_mutation_permit_record(raw_outcome)
        fcntl.flock(self._fd, fcntl.LOCK_EX)
        try:
            entries = self._entries_unlocked()
            dispatches = self._recovery_dispatches_unlocked(entries, key)
            matches = [
                dispatch
                for dispatch in dispatches
                if dispatch["dispatchHash"] == expected["dispatchHash"]
            ]
            if len(matches) != 1:
                raise ValueError("mutation_recovery_dispatch_unavailable")
            dispatch = matches[0]
            if any(dispatch[name] != value for name, value in expected.items()):
                raise ValueError("mutation_recovery_binding_mismatch")
            if dispatch["outcome"] is not None:
                if (
                    dispatch["outcome"] != "unknown"
                    or dispatch["safeReceiptHmac"] != safe_receipt_hmac
                    or dispatch["outcomeHash"] is None
                ):
                    raise ValueError("mutation_recovery_already_finalized")
                return {
                    "verified": True,
                    "dispatchHash": dispatch["dispatchHash"],
                    "consumeHash": dispatch["consumeHash"],
                    "outcomeHash": dispatch["outcomeHash"],
                    "safeReceiptHmac": dispatch["safeReceiptHmac"],
                    "replayed": True,
                }
            outcome_entry = self._append_unlocked(self._fd, entries, outcome_payload)
            return {
                "verified": True,
                "dispatchHash": dispatch["dispatchHash"],
                "consumeHash": dispatch["consumeHash"],
                "outcomeHash": outcome_entry["hash"],
                "safeReceiptHmac": safe_receipt_hmac,
                "replayed": False,
            }
        finally:
            fcntl.flock(self._fd, fcntl.LOCK_UN)

    def record_outcome(
        self,
        consume_hash: str,
        outcome: str,
        *,
        dispatch_hash: str,
        safe_receipt_hmac: str,
        mac_key_fd: int,
    ) -> str:
        key = self._read_mac_key(mac_key_fd)
        raw_outcome = {
            "kind": "outcome",
            "consumeHash": consume_hash,
            "dispatchHash": dispatch_hash,
            "safeReceiptHmac": safe_receipt_hmac,
            "outcome": outcome,
        }
        raw_outcome["outcomeMac"] = self._outcome_mac(key, raw_outcome)
        outcome_payload = _sanitize_mutation_permit_record(raw_outcome)
        fcntl.flock(self._fd, fcntl.LOCK_EX)
        try:
            entries = self._entries_unlocked()
            try:
                dispatch = self._verify_dispatch_entries(entries, key, dispatch_hash)
            except (TypeError, ValueError):
                raise ValueError("mutation_outcome_unavailable") from None
            outcomes = {
                entry["payload"]["consumeHash"]
                for entry in entries
                if entry["payload"]["kind"] == "outcome"
            }
            if dispatch["consumeHash"] != consume_hash or consume_hash in outcomes:
                raise ValueError("mutation_outcome_unavailable")
            return self._append_unlocked(self._fd, entries, outcome_payload)["hash"]
        finally:
            fcntl.flock(self._fd, fcntl.LOCK_UN)

    def verify_outcome(
        self,
        consume_hash: str,
        expected_outcome: str,
        *,
        mac_key_fd: int,
    ) -> dict[str, Any]:
        if expected_outcome not in MUTATION_OUTCOMES:
            raise ValueError("mutation_outcome_invalid")
        entries = self.entries()
        matches = [
            entry
            for entry in entries
            if entry["payload"].get("kind") == "outcome"
            and entry["payload"].get("consumeHash") == consume_hash
        ]
        if len(matches) != 1 or matches[0]["payload"]["outcome"] != expected_outcome:
            raise ValueError("mutation_outcome_not_verified")
        payload = matches[0]["payload"]
        key = self._read_mac_key(mac_key_fd)
        dispatch = self._verify_dispatch_entries(entries, key, payload["dispatchHash"])
        if (
            dispatch["consumeHash"] != consume_hash
            or not hmac.compare_digest(self._outcome_mac(key, payload), payload["outcomeMac"])
        ):
            raise ValueError("mutation_outcome_not_verified")
        return {
            "verified": True,
            "outcomeHash": matches[0]["hash"],
            "outcome": expected_outcome,
            "dispatchHash": payload["dispatchHash"],
            "safeReceiptHmac": payload["safeReceiptHmac"],
        }

    def reconcile(self, consume_hash: str, *, effect_present: bool) -> str:
        entries = self.entries()
        unknown = {
            entry["payload"]["consumeHash"]
            for entry in entries
            if entry["payload"]["kind"] == "outcome" and entry["payload"]["outcome"] == "unknown"
        }
        reconciled = {entry["payload"]["consumeHash"] for entry in entries if entry["payload"]["kind"] == "reconcile"}
        if consume_hash not in unknown or consume_hash in reconciled:
            raise ValueError("mutation_reconciliation_unavailable")
        return self.append({"kind": "reconcile", "consumeHash": consume_hash, "effectPresent": effect_present})["hash"]

    def verify_reconciliation(
        self,
        consume_hash: str,
        *,
        effect_present: bool,
        mac_key_fd: int,
    ) -> dict[str, Any]:
        outcome = self.verify_outcome(
            consume_hash,
            "unknown",
            mac_key_fd=mac_key_fd,
        )
        entries = self.entries()
        matches = [
            entry
            for entry in entries
            if entry["payload"].get("kind") == "reconcile"
            and entry["payload"].get("consumeHash") == consume_hash
        ]
        if len(matches) != 1 or matches[0]["payload"]["effectPresent"] is not effect_present:
            raise ValueError("mutation_reconciliation_not_verified")
        return {
            "verified": True,
            "reconciliationHash": matches[0]["hash"],
            "effectPresent": effect_present,
            "dispatchHash": outcome["dispatchHash"],
            "safeReceiptHmac": outcome["safeReceiptHmac"],
        }


def _read_external_fd(fd: int, maximum: int) -> bytes:
    if type(fd) is not int or fd <= 2:
        raise TypeError("external_fd_invalid")
    info = os.fstat(fd)
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISFIFO(info.st_mode)):
        raise ValueError("external_fd_type_invalid")
    if stat.S_ISREG(info.st_mode):
        os.lseek(fd, 0, os.SEEK_SET)
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = os.read(fd, min(4096, maximum + 1 - size))
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
        if size > maximum:
            raise ValueError("external_fd_too_large")
    return b"".join(chunks)


def _validate_cleanup_locator(locator: bytes) -> None:
    try:
        value = locator.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("cleanup_vault_locator_encoding_invalid") from error
    if (
        not value
        or len(value) > 4096
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)
        or FORBIDDEN_CANARY in value
        or "://" in value
        or "?" in value
        or "#" in value
        or re.search(r"\b(?:bearer|token|signature|credential)\b", value, re.IGNORECASE)
        or re.search(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b", value)
        or re.match(r"^(?:/|[A-Za-z]:[\\/])", value)
    ):
        raise ValueError("cleanup_vault_locator_forbidden")


def _sanitize_cleanup_vault_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping) or value.get("kind") not in {"plan", "complete"}:
        raise TypeError("cleanup_vault_record_invalid")
    if value["kind"] == "complete":
        if set(value) != {"kind", "planHash", "outcome"}:
            raise TypeError("cleanup_vault_complete_keys_invalid")
        if (
            not isinstance(value["planHash"], str)
            or re.fullmatch(r"[a-f0-9]{64}", value["planHash"]) is None
            or value["outcome"] not in CLEANUP_OUTCOMES
        ):
            raise ValueError("cleanup_vault_complete_invalid")
        return dict(value)
    if set(value) != {
        "kind",
        "resourceAlias",
        "resourceKind",
        "action",
        "locatorHmac",
        "locatorHex",
    }:
        raise TypeError("cleanup_vault_plan_keys_invalid")
    if (
        value["resourceAlias"] not in RESOURCE_ALIASES
        or (value["resourceKind"], value["action"]) != CLEANUP_PLAN_TYPES.get(value["resourceAlias"])
        or not isinstance(value["locatorHmac"], str)
        or _HMAC.fullmatch(value["locatorHmac"]) is None
        or not isinstance(value["locatorHex"], str)
        or re.fullmatch(r"(?:[a-f0-9]{2})+", value["locatorHex"]) is None
    ):
        raise ValueError("cleanup_vault_plan_invalid")
    return dict(value)


class CleanupVault(_HashChain):
    """Write-ahead cleanup plan and raw locator vault; locator bytes never return."""

    def __init__(self, fd: int) -> None:
        super().__init__(fd, _sanitize_cleanup_vault_payload)

    def plan(
        self,
        *,
        resource_alias: str,
        resource_kind: str,
        action: str,
        locator_hmac: str,
        locator_fd: int,
        hmac_key_fd: int,
    ) -> str:
        """Persist and fsync a cleanup locator before the corresponding external action."""

        locator = _read_external_fd(locator_fd, 16 * 1024)
        key = _read_external_fd(hmac_key_fd, 4096)
        if not locator or not key:
            raise ValueError("cleanup_vault_fd_empty")
        _validate_cleanup_locator(locator)
        calculated = "hmac-sha256:" + hmac.new(key, locator, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calculated, locator_hmac):
            raise ValueError("cleanup_vault_hmac_mismatch")
        return self.append(
            {
                "kind": "plan",
                "resourceAlias": resource_alias,
                "resourceKind": resource_kind,
                "action": action,
                "locatorHmac": locator_hmac,
                "locatorHex": locator.hex(),
            }
        )["hash"]

    def copy_locator(self, plan_hash: str, output_fd: int) -> None:
        if type(output_fd) is not int or output_fd <= 2:
            raise TypeError("cleanup_vault_output_fd_invalid")
        output_info = os.fstat(output_fd)
        private_regular = (
            stat.S_ISREG(output_info.st_mode)
            and stat.S_IMODE(output_info.st_mode) == FILE_MODE
            and output_info.st_nlink in {0, 1}
            and output_info.st_uid == os.geteuid()
        )
        if not stat.S_ISFIFO(output_info.st_mode) and not private_regular:
            raise ValueError("cleanup_vault_output_fd_not_private")
        entries = self.entries()
        plans = {entry["hash"]: entry["payload"] for entry in entries if entry["payload"]["kind"] == "plan"}
        completed = {entry["payload"]["planHash"] for entry in entries if entry["payload"]["kind"] == "complete"}
        match = plans.get(plan_hash)
        if match is None or plan_hash in completed:
            raise ValueError("cleanup_vault_plan_missing")
        _write_all(output_fd, bytes.fromhex(match["locatorHex"]))

    def complete(self, plan_hash: str, outcome: str) -> str:
        entries = self.entries()
        plans = {entry["hash"]: entry["payload"] for entry in entries if entry["payload"]["kind"] == "plan"}
        completed = {entry["payload"]["planHash"] for entry in entries if entry["payload"]["kind"] == "complete"}
        plan = plans.get(plan_hash)
        if plan is None or plan_hash in completed:
            raise ValueError("cleanup_vault_completion_unavailable")
        if outcome not in CLEANUP_ALLOWED_OUTCOMES[plan["action"]]:
            raise ValueError("cleanup_vault_outcome_invalid")
        return self.append({"kind": "complete", "planHash": plan_hash, "outcome": outcome})["hash"]

    def assert_complete(self) -> None:
        entries = self.entries()
        plans = {entry["hash"] for entry in entries if entry["payload"]["kind"] == "plan"}
        completed = [entry["payload"]["planHash"] for entry in entries if entry["payload"]["kind"] == "complete"]
        if len(completed) != len(set(completed)) or plans != set(completed):
            raise ValueError("cleanup_vault_incomplete")
