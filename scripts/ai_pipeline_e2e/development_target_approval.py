"""Private, durable approval for the user-authorized development target.

The raw Supabase URL and project reference enter through a private descriptor
and are never persisted or returned.  The immutable record contains only
keyed opaque bindings plus safe booleans and counts.  A controller must verify
the record against its pre-network state before accepting MCP inventory proof.
"""

from __future__ import annotations

import fcntl
import hashlib
import hmac
import json
import os
import re
import stat
from collections.abc import Mapping
from typing import Any

try:
    from .sanitizer import assert_forbidden_scan_clean, canonical_json, require_sha256
except ImportError:  # pragma: no cover - direct script import fallback
    from sanitizer import assert_forbidden_scan_clean, canonical_json, require_sha256


SCHEMA_VERSION = "protected-development-target-approval.v1"
RUN_MAC_KEY_BYTES = 32
MAX_TARGET_URL_BYTES = 256
MAX_APPROVAL_RECORD_BYTES = 4096
FILE_MODE = 0o600

_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")
_TARGET_URL = re.compile(rb"^https://([a-z0-9]{20})\.supabase\.co/?$")
_PROJECT_DOMAIN = b"acttub-protected-supabase-project-ref.v1\0"
_MANIFEST_BINDING_DOMAIN = b"acttub-protected-development-target-manifest.v1\0"
_CONTROLLER_BINDING_DOMAIN = b"acttub-protected-development-target-controller.v1\0"
_APPROVAL_MAC_DOMAIN = b"acttub-protected-development-target-approval.v1\0"

_CORE_KEYS = frozenset(
    {
        "schemaVersion",
        "targetHmac",
        "manifestBindingHmac",
        "controllerBindingHmac",
        "controllerStateSequence",
        "pinnedBeforeNetwork",
        "mcpEntryCountAtPin",
        "networkActionCountAtPin",
    }
)
_RECORD_KEYS = _CORE_KEYS | {"approvalMac"}


class DevelopmentTargetApprovalRejected(ValueError):
    """Fixed rejection that never includes raw target material."""

    def __init__(self) -> None:
        super().__init__("development_target_approval_invalid")


def _reject() -> None:
    raise DevelopmentTargetApprovalRejected()


def _require_private_regular_fd(fd: Any, *, writable: bool = False) -> int:
    if type(fd) is not int or fd < 0:
        _reject()
    try:
        info = os.fstat(fd)
        descriptor_flags = fcntl.fcntl(fd, fcntl.F_GETFD)
        access_mode = fcntl.fcntl(fd, fcntl.F_GETFL) & os.O_ACCMODE
    except OSError:
        _reject()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.geteuid()
        or stat.S_IMODE(info.st_mode) != FILE_MODE
        or info.st_nlink not in {0, 1}
        or not descriptor_flags & fcntl.FD_CLOEXEC
        or (writable and access_mode not in {os.O_WRONLY, os.O_RDWR})
    ):
        _reject()
    return fd


def _read_regular_fd(fd: int, maximum: int) -> bytes:
    _require_private_regular_fd(fd)
    try:
        size = os.fstat(fd).st_size
        if size < 1 or size > maximum:
            _reject()
        raw = os.pread(fd, size, 0)
    except OSError:
        _reject()
    if len(raw) != size:
        _reject()
    return raw


def _read_mac_key(fd: int) -> bytes:
    raw = _read_regular_fd(fd, RUN_MAC_KEY_BYTES)
    if len(raw) != RUN_MAC_KEY_BYTES:
        _reject()
    return raw


def _hmac(key: bytes, domain: bytes, value: bytes) -> str:
    return "hmac-sha256:" + hmac.new(key, domain + value, hashlib.sha256).hexdigest()


def _target_hmac(key: bytes, project_ref: bytes) -> str:
    return _hmac(key, _PROJECT_DOMAIN, project_ref)


def _manifest_binding(key: bytes, manifest_digest: str) -> str:
    digest = "sha256:" + require_sha256(manifest_digest, "development_target_manifest")
    return _hmac(key, _MANIFEST_BINDING_DOMAIN, digest.encode("ascii"))


def _controller_binding(key: bytes, controller_state_hash: str, sequence: int) -> str:
    digest = "sha256:" + require_sha256(
        controller_state_hash, "development_target_controller_state"
    )
    if type(sequence) is not int or sequence < 0:
        _reject()
    return _hmac(
        key,
        _CONTROLLER_BINDING_DOMAIN,
        digest.encode("ascii") + b"\0" + str(sequence).encode("ascii"),
    )


def _approval_mac(key: bytes, core: Mapping[str, Any]) -> str:
    return _hmac(key, _APPROVAL_MAC_DOMAIN, canonical_json(dict(core)).encode("ascii"))


def _write_all(fd: int, data: bytes) -> None:
    offset = 0
    while offset < len(data):
        try:
            written = os.write(fd, data[offset:])
        except OSError:
            _reject()
        if written <= 0:
            _reject()
        offset += written


def _loads_unique(raw: bytes) -> Any:
    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for name, value in pairs:
            if name in result:
                _reject()
            result[name] = value
        return result

    try:
        return json.loads(
            raw.decode("ascii"),
            object_pairs_hook=unique_object,
            parse_constant=lambda _constant: _reject(),
        )
    except DevelopmentTargetApprovalRejected:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        _reject()


def _validate_record(value: Any, key: bytes) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != _RECORD_KEYS:
        _reject()
    record = dict(value)
    if (
        record["schemaVersion"] != SCHEMA_VERSION
        or not isinstance(record["targetHmac"], str)
        or _HMAC.fullmatch(record["targetHmac"]) is None
        or not isinstance(record["manifestBindingHmac"], str)
        or _HMAC.fullmatch(record["manifestBindingHmac"]) is None
        or not isinstance(record["controllerBindingHmac"], str)
        or _HMAC.fullmatch(record["controllerBindingHmac"]) is None
        or type(record["controllerStateSequence"]) is not int
        or record["controllerStateSequence"] < 0
        or record["pinnedBeforeNetwork"] is not True
        or type(record["mcpEntryCountAtPin"]) is not int
        or record["mcpEntryCountAtPin"] != 0
        or type(record["networkActionCountAtPin"]) is not int
        or record["networkActionCountAtPin"] != 0
        or not isinstance(record["approvalMac"], str)
        or _HMAC.fullmatch(record["approvalMac"]) is None
    ):
        _reject()
    core = {name: record[name] for name in _CORE_KEYS}
    if not hmac.compare_digest(_approval_mac(key, core), record["approvalMac"]):
        _reject()
    return record


def _safe_receipt(record: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "approved": True,
        "pinnedBeforeNetwork": True,
        "targetHmac": record["targetHmac"],
        "manifestBindingHmac": record["manifestBindingHmac"],
        "controllerBindingHmac": record["controllerBindingHmac"],
        "controllerStateSequence": record["controllerStateSequence"],
        "mcpEntryCountAtPin": 0,
        "networkActionCountAtPin": 0,
        "approvalMac": record["approvalMac"],
    }


def pin_authorized_development_target(
    *,
    approval_fd: int,
    target_url_fd: int,
    mac_key_fd: int,
    manifest_digest: str,
    controller_state_hash: str,
    controller_state_sequence: int,
) -> dict[str, Any]:
    """Durably pin one private local target before any MCP/network action."""

    _require_private_regular_fd(approval_fd, writable=True)
    key = _read_mac_key(mac_key_fd)
    target_url = _read_regular_fd(target_url_fd, MAX_TARGET_URL_BYTES)
    match = _TARGET_URL.fullmatch(target_url)
    if match is None:
        _reject()
    core = {
        "schemaVersion": SCHEMA_VERSION,
        "targetHmac": _target_hmac(key, match.group(1)),
        "manifestBindingHmac": _manifest_binding(key, manifest_digest),
        "controllerBindingHmac": _controller_binding(
            key, controller_state_hash, controller_state_sequence
        ),
        "controllerStateSequence": controller_state_sequence,
        "pinnedBeforeNetwork": True,
        "mcpEntryCountAtPin": 0,
        "networkActionCountAtPin": 0,
    }
    record = {**core, "approvalMac": _approval_mac(key, core)}
    encoded_text = canonical_json(record)
    assert_forbidden_scan_clean(encoded_text)
    encoded = (encoded_text + "\n").encode("ascii")
    if len(encoded) > MAX_APPROVAL_RECORD_BYTES:
        _reject()

    fcntl.flock(approval_fd, fcntl.LOCK_EX)
    try:
        if os.fstat(approval_fd).st_size != 0:
            _reject()
        os.lseek(approval_fd, 0, os.SEEK_SET)
        _write_all(approval_fd, encoded)
        os.fsync(approval_fd)
    except OSError:
        _reject()
    finally:
        fcntl.flock(approval_fd, fcntl.LOCK_UN)
    return _safe_receipt(record)


def verify_development_target_approval(
    *,
    approval_fd: int,
    mac_key_fd: int,
    expected_manifest_digest: str,
    expected_controller_state_hash: str,
    expected_controller_state_sequence: int,
) -> dict[str, Any]:
    """Verify an immutable approval after restart without exposing its target."""

    _require_private_regular_fd(approval_fd)
    key = _read_mac_key(mac_key_fd)
    fcntl.flock(approval_fd, fcntl.LOCK_SH)
    try:
        raw = _read_regular_fd(approval_fd, MAX_APPROVAL_RECORD_BYTES)
    finally:
        fcntl.flock(approval_fd, fcntl.LOCK_UN)
    if not raw.endswith(b"\n") or raw.count(b"\n") != 1:
        _reject()
    record = _validate_record(_loads_unique(raw[:-1]), key)
    expected_manifest_binding = _manifest_binding(key, expected_manifest_digest)
    expected_controller_binding = _controller_binding(
        key,
        expected_controller_state_hash,
        expected_controller_state_sequence,
    )
    if (
        record["controllerStateSequence"] != expected_controller_state_sequence
        or not hmac.compare_digest(
            record["manifestBindingHmac"], expected_manifest_binding
        )
        or not hmac.compare_digest(
            record["controllerBindingHmac"], expected_controller_binding
        )
    ):
        _reject()
    return _safe_receipt(record)


def verify_pinned_development_target_approval(
    *,
    approval_fd: int,
    mac_key_fd: int,
    expected_manifest_digest: str,
    expected_target_hmac: str,
) -> dict[str, Any]:
    """Reverify the immutable pre-network approval while reconciling inventory."""

    if not isinstance(expected_target_hmac, str) or _HMAC.fullmatch(expected_target_hmac) is None:
        _reject()
    _require_private_regular_fd(approval_fd)
    key = _read_mac_key(mac_key_fd)
    fcntl.flock(approval_fd, fcntl.LOCK_SH)
    try:
        raw = _read_regular_fd(approval_fd, MAX_APPROVAL_RECORD_BYTES)
    finally:
        fcntl.flock(approval_fd, fcntl.LOCK_UN)
    if not raw.endswith(b"\n") or raw.count(b"\n") != 1:
        _reject()
    record = _validate_record(_loads_unique(raw[:-1]), key)
    if (
        not hmac.compare_digest(
            record["manifestBindingHmac"],
            _manifest_binding(key, expected_manifest_digest),
        )
        or not hmac.compare_digest(record["targetHmac"], expected_target_hmac)
    ):
        _reject()
    return _safe_receipt(record)
