"""Authenticated, bounded frames for protected live-run bridge processes."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import socket
import stat
import struct
from collections.abc import Mapping, MutableSet
from typing import Any

MAX_FRAME_BYTES = 1024 * 1024
MAX_STRING_BYTES = 512 * 1024
MAX_DEPTH = 16
MAX_COLLECTION_ITEMS = 4096
SCHEMA_VERSION = "protected-bridge-envelope.v1"
OPERATIONS = frozenset(
    {
        "list_projects",
        "list_migrations",
        "apply_009",
        "apply_010",
        "check_009",
        "check_010",
        "check_optional_note",
        "check_orphans",
        "auth_session",
        "create_temp_user",
        "delete_temp_user",
        "upload_media",
        "storage_absence",
        "ui_probe",
    }
)
SAFE_CODES = frozenset(
    {
        "BRIDGE_BAD_FRAME",
        "BRIDGE_BAD_MAC",
        "BRIDGE_REPLAY",
        "BRIDGE_OPERATION_DENIED",
        "BRIDGE_OPERATION_FAILED",
        "BRIDGE_UNKNOWN",
    }
)
_KINDS = frozenset({"request", "response"})
_HEX_32 = re.compile(r"^[a-f0-9]{32}$")
_HEX_64 = re.compile(r"^[a-f0-9]{64}$")
_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")
_MAC_DOMAIN = b"acttub-protected-bridge-envelope.v1\0"


class ProtocolRejected(ValueError):
    """Fixed-code rejection that never interpolates raw frame data."""

    def __init__(self, safe_code: str = "BRIDGE_BAD_FRAME") -> None:
        self.safe_code = safe_code if safe_code in SAFE_CODES else "BRIDGE_BAD_FRAME"
        super().__init__(self.safe_code)


def _reject(code: str = "BRIDGE_BAD_FRAME") -> None:
    raise ProtocolRejected(code)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _reject()
        result[key] = value
    return result


def _loads(raw: bytes) -> Any:
    try:
        return json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=lambda _value: _reject(),
        )
    except ProtocolRejected:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError, TypeError):
        _reject()


def _validate_tree(value: Any, depth: int = 0) -> None:
    if depth > MAX_DEPTH:
        _reject()
    if value is None or type(value) in {bool, int}:
        return
    if isinstance(value, str):
        if "\0" in value or len(value.encode("utf-8")) > MAX_STRING_BYTES:
            _reject()
        return
    if isinstance(value, list):
        if len(value) > MAX_COLLECTION_ITEMS:
            _reject()
        for item in value:
            _validate_tree(item, depth + 1)
        return
    if isinstance(value, Mapping):
        if len(value) > MAX_COLLECTION_ITEMS:
            _reject()
        for key, item in value.items():
            if not isinstance(key, str) or not key or len(key.encode("utf-8")) > 256 or "\0" in key:
                _reject()
            _validate_tree(item, depth + 1)
        return
    _reject()


def canonical_json(value: Any) -> str:
    _validate_tree(value)
    try:
        return json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":"), sort_keys=True)
    except (TypeError, ValueError, RecursionError):
        _reject()


def _read_key(fd: int) -> bytes:
    if type(fd) is not int or fd <= 2:
        _reject()
    try:
        info = os.fstat(fd)
    except OSError:
        _reject()
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISFIFO(info.st_mode)):
        _reject()
    if stat.S_ISREG(info.st_mode):
        try:
            os.lseek(fd, 0, os.SEEK_SET)
        except OSError:
            _reject()
    chunks: list[bytes] = []
    total = 0
    try:
        while total <= 4096:
            chunk = os.read(fd, min(4097 - total, 4096))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
    except OSError:
        _reject()
    key = b"".join(chunks)
    if not 16 <= len(key) <= 4096:
        _reject()
    return key


def _payload_hmac(key: bytes, payload: Any) -> str:
    return "hmac-sha256:" + hmac.new(
        key,
        b"payload\0" + canonical_json(payload).encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


def _envelope_mac(key: bytes, core: Mapping[str, Any]) -> str:
    return "hmac-sha256:" + hmac.new(
        key,
        _MAC_DOMAIN + canonical_json(dict(core)).encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


def create_envelope(
    *,
    kind: str,
    operation: str,
    request_id: str,
    nonce: str,
    payload: Any,
    mac_key_fd: int,
) -> dict[str, Any]:
    if kind not in _KINDS or operation not in OPERATIONS:
        _reject("BRIDGE_OPERATION_DENIED")
    if not isinstance(request_id, str) or _HEX_32.fullmatch(request_id) is None:
        _reject()
    if not isinstance(nonce, str) or _HEX_64.fullmatch(nonce) is None:
        _reject()
    _validate_tree(payload)
    key = _read_key(mac_key_fd)
    core = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": kind,
        "operation": operation,
        "requestId": request_id,
        "nonce": nonce,
        "payload": payload,
        "payloadHmac": _payload_hmac(key, payload),
    }
    return {**core, "envelopeMac": _envelope_mac(key, core)}


def verify_envelope(
    value: Any,
    *,
    mac_key_fd: int,
    expected_kind: str | None = None,
    expected_operation: str | None = None,
    seen_nonces: MutableSet[str] | None = None,
) -> dict[str, Any]:
    keys = {
        "schemaVersion",
        "kind",
        "operation",
        "requestId",
        "nonce",
        "payload",
        "payloadHmac",
        "envelopeMac",
    }
    if not isinstance(value, Mapping) or set(value) != keys:
        _reject()
    item = dict(value)
    if (
        item["schemaVersion"] != SCHEMA_VERSION
        or item["kind"] not in _KINDS
        or item["operation"] not in OPERATIONS
        or not isinstance(item["requestId"], str)
        or _HEX_32.fullmatch(item["requestId"]) is None
        or not isinstance(item["nonce"], str)
        or _HEX_64.fullmatch(item["nonce"]) is None
        or not isinstance(item["payloadHmac"], str)
        or _HMAC.fullmatch(item["payloadHmac"]) is None
        or not isinstance(item["envelopeMac"], str)
        or _HMAC.fullmatch(item["envelopeMac"]) is None
    ):
        _reject()
    if expected_kind is not None and item["kind"] != expected_kind:
        _reject()
    if expected_operation is not None and item["operation"] != expected_operation:
        _reject("BRIDGE_OPERATION_DENIED")
    _validate_tree(item["payload"])
    key = _read_key(mac_key_fd)
    core = {key_name: item[key_name] for key_name in keys - {"envelopeMac"}}
    if not hmac.compare_digest(item["payloadHmac"], _payload_hmac(key, item["payload"])):
        _reject("BRIDGE_BAD_MAC")
    if not hmac.compare_digest(item["envelopeMac"], _envelope_mac(key, core)):
        _reject("BRIDGE_BAD_MAC")
    if seen_nonces is not None:
        if item["nonce"] in seen_nonces:
            _reject("BRIDGE_REPLAY")
        seen_nonces.add(item["nonce"])
    return item


def encode_frame(value: Any) -> bytes:
    encoded = canonical_json(value).encode("ascii")
    if not encoded or len(encoded) > MAX_FRAME_BYTES:
        _reject()
    return struct.pack("!I", len(encoded)) + encoded


def _recv_exact(channel: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while total < size:
        try:
            chunk = channel.recv(size - total)
        except OSError:
            _reject()
        if not chunk:
            _reject()
        chunks.append(chunk)
        total += len(chunk)
    return b"".join(chunks)


def recv_frame(channel: socket.socket) -> Any:
    if not isinstance(channel, socket.socket):
        _reject()
    size = struct.unpack("!I", _recv_exact(channel, 4))[0]
    if not 1 <= size <= MAX_FRAME_BYTES:
        _reject()
    return _loads(_recv_exact(channel, size))


def send_frame(channel: socket.socket, value: Any) -> None:
    if not isinstance(channel, socket.socket):
        _reject()
    try:
        channel.sendall(encode_frame(value))
    except OSError:
        _reject()
