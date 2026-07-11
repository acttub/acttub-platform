"""Durable, private cleanup broker for the real platform pipeline driver.

The driver sends one canonical JSON request and waits for one canonical JSON
acknowledgement. Raw locators are written only to ``CleanupVault`` and are
available to crash recovery solely through an already-open private descriptor.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import socket
import stat
import tempfile
import fcntl
from collections.abc import Callable, Mapping
from typing import Any

try:
    from .sanitizer import FORBIDDEN_CANARY, canonical_json
    from .secure_state import CLEANUP_ALLOWED_OUTCOMES, CLEANUP_PLAN_TYPES, CleanupVault
except ImportError:  # pragma: no cover - direct script import fallback
    from sanitizer import FORBIDDEN_CANARY, canonical_json
    from secure_state import CLEANUP_ALLOWED_OUTCOMES, CLEANUP_PLAN_TYPES, CleanupVault


MAX_FRAME_BYTES = 16 * 1024
MAX_KEY_BYTES = 4096
PLAN_SCHEMA = "cleanup-plan.v1"
PLAN_ACK_SCHEMA = "cleanup-plan-ack.v1"
COMPLETE_SCHEMA = "cleanup-complete.v1"
COMPLETE_ACK_SCHEMA = "cleanup-complete-ack.v1"
DRIVER_ALIASES = frozenset({"run-session-bundle", "temporary-rls-account"})

_RECEIPT_DOMAIN = b"acttub-driver-cleanup-receipt.v1\0"
_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE)
_EMAIL = re.compile(r"^acttub-e2e-[a-f0-9]{32}@example\.com$")
_STORAGE_PATH = re.compile(
    r"^users/([0-9a-f-]{36})/practice-sessions/([0-9a-f-]{36})/take\.(mp4|mov)$",
    re.IGNORECASE,
)


class DriverCleanupRejected(ValueError):
    """Fixed-message rejection that never includes a raw locator."""

    def __init__(self) -> None:
        super().__init__("driver_cleanup_rejected")


def _reject() -> None:
    raise DriverCleanupRejected()


def _read_key(fd: int) -> bytes:
    if type(fd) is not int or fd <= 2:
        _reject()
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_nlink not in {0, 1}
            or not fcntl.fcntl(fd, fcntl.F_GETFD) & fcntl.FD_CLOEXEC
        ):
            _reject()
        os.lseek(fd, 0, os.SEEK_SET)
        key = os.read(fd, MAX_KEY_BYTES + 1)
    except (OSError, ValueError):
        _reject()
    if not 32 <= len(key) <= MAX_KEY_BYTES:
        _reject()
    return key


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _reject()
        result[key] = value
    return result


def _read_canonical_frame(channel: socket.socket) -> dict[str, Any]:
    if not isinstance(channel, socket.socket) or not stat.S_ISSOCK(os.fstat(channel.fileno()).st_mode):
        _reject()
    raw = bytearray()
    previous_timeout = channel.gettimeout()
    try:
        channel.settimeout(30.0)
        while len(raw) <= MAX_FRAME_BYTES:
            item = channel.recv(1)
            if not item:
                _reject()
            if item == b"\n":
                break
            raw.extend(item)
        else:
            _reject()
        if not raw:
            _reject()
        parsed = json.loads(bytes(raw).decode("ascii"), object_pairs_hook=_unique_object)
        if not isinstance(parsed, dict) or canonical_json(parsed).encode("ascii") != bytes(raw):
            _reject()
        return parsed
    except DriverCleanupRejected:
        raise
    except (OSError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
        _reject()
    finally:
        raw[:] = b"\0" * len(raw)
        try:
            channel.settimeout(previous_timeout)
        except OSError:
            pass


def _send_frame(channel: socket.socket, value: Mapping[str, Any]) -> None:
    encoded = (canonical_json(dict(value)) + "\n").encode("ascii")
    if len(encoded) > MAX_FRAME_BYTES:
        _reject()
    try:
        channel.sendall(encoded)
    except OSError:
        _reject()


def _exact(value: Any, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != keys:
        _reject()
    return dict(value)


def _validate_locator(alias: str, value: Any) -> dict[str, str]:
    if alias == "temporary-rls-account":
        item = _exact(value, {"email"})
        if not isinstance(item["email"], str) or _EMAIL.fullmatch(item["email"]) is None:
            _reject()
        return item
    if alias == "run-session-bundle":
        item = _exact(value, {"uploadIntentId", "sessionId", "storagePath"})
        upload_intent_id = item["uploadIntentId"]
        session_id = item["sessionId"]
        storage_path = item["storagePath"]
        if (
            not isinstance(upload_intent_id, str)
            or _UUID.fullmatch(upload_intent_id) is None
            or not isinstance(session_id, str)
            or _UUID.fullmatch(session_id) is None
            or not isinstance(storage_path, str)
        ):
            _reject()
        path_match = _STORAGE_PATH.fullmatch(storage_path)
        if path_match is None or _UUID.fullmatch(path_match.group(1)) is None or not hmac.compare_digest(
            path_match.group(2).casefold(), session_id.casefold()
        ):
            _reject()
        return item
    _reject()


class DriverCleanupBroker:
    """Fsync cleanup plans/completions before acknowledging the live driver."""

    def __init__(self, *, vault_fd: int, mac_key_fd: int) -> None:
        self._vault = CleanupVault(vault_fd)
        self._key = _read_key(mac_key_fd)
        self._plans_by_receipt: dict[str, tuple[str, dict[str, Any]]] = {}
        self._plans_by_locator_hmac: dict[str, str] = {}
        self._completed: dict[str, str] = {}
        entries = self._vault.entries()
        for entry in entries:
            payload = entry["payload"]
            if payload["kind"] == "plan" and payload["resourceAlias"] in DRIVER_ALIASES:
                receipt = self._receipt(entry["hash"])
                if receipt in self._plans_by_receipt or payload["locatorHmac"] in self._plans_by_locator_hmac:
                    _reject()
                metadata = {
                    "resourceAlias": payload["resourceAlias"],
                    "resourceKind": payload["resourceKind"],
                    "action": payload["action"],
                    "locatorHmac": payload["locatorHmac"],
                }
                self._plans_by_receipt[receipt] = (entry["hash"], metadata)
                self._plans_by_locator_hmac[payload["locatorHmac"]] = receipt
            elif payload["kind"] == "complete":
                if payload["planHash"] in self._completed:
                    _reject()
                self._completed[payload["planHash"]] = payload["outcome"]

    def _receipt(self, plan_hash: str) -> str:
        digest = hmac.new(self._key, _RECEIPT_DOMAIN + plan_hash.encode("ascii"), hashlib.sha256).hexdigest()
        return "hmac-sha256:" + digest

    def _plan(self, frame: dict[str, Any]) -> dict[str, Any]:
        item = _exact(frame, {"schemaVersion", "operation", "resourceAlias", "locator", "outcomePolicy"})
        alias = item["resourceAlias"]
        if item["schemaVersion"] != PLAN_SCHEMA or item["operation"] != "plan" or alias not in DRIVER_ALIASES:
            _reject()
        plan_type = CLEANUP_PLAN_TYPES.get(alias)
        if plan_type is None:
            _reject()
        resource_kind, action = plan_type
        allowed_outcomes = CLEANUP_ALLOWED_OUTCOMES.get(action)
        policy = item["outcomePolicy"]
        if (
            allowed_outcomes is None
            or not isinstance(policy, list)
            or len(policy) != len(set(policy))
            or set(policy) != set(allowed_outcomes)
        ):
            _reject()
        locator = _validate_locator(alias, item["locator"])
        locator_bytes = canonical_json(locator).encode("ascii")
        if FORBIDDEN_CANARY.encode("ascii") in locator_bytes:
            _reject()
        locator_hmac = "hmac-sha256:" + hmac.new(self._key, locator_bytes, hashlib.sha256).hexdigest()
        existing_receipt = self._plans_by_locator_hmac.get(locator_hmac)
        if existing_receipt is not None:
            plan_hash, payload = self._plans_by_receipt[existing_receipt]
            if payload["resourceAlias"] != alias or plan_hash in self._completed:
                _reject()
            receipt = existing_receipt
        else:
            with tempfile.TemporaryFile() as locator_file, tempfile.TemporaryFile() as key_file:
                os.fchmod(locator_file.fileno(), 0o600)
                os.fchmod(key_file.fileno(), 0o600)
                locator_file.write(locator_bytes)
                key_file.write(self._key)
                locator_file.flush()
                key_file.flush()
                plan_hash = self._vault.plan(
                    resource_alias=alias,
                    resource_kind=resource_kind,
                    action=action,
                    locator_hmac=locator_hmac,
                    locator_fd=locator_file.fileno(),
                    hmac_key_fd=key_file.fileno(),
                )
            receipt = self._receipt(plan_hash)
            payload = {
                "resourceAlias": alias,
                "resourceKind": resource_kind,
                "action": action,
                "locatorHmac": locator_hmac,
            }
            self._plans_by_receipt[receipt] = (plan_hash, payload)
            self._plans_by_locator_hmac[locator_hmac] = receipt
        return {
            "schemaVersion": PLAN_ACK_SCHEMA,
            "operation": "plan",
            "resourceAlias": alias,
            "planReceiptHmac": receipt,
        }

    def _complete(self, frame: dict[str, Any]) -> dict[str, Any]:
        item = _exact(
            frame,
            {"schemaVersion", "operation", "resourceAlias", "planReceiptHmac", "outcome"},
        )
        receipt = item["planReceiptHmac"]
        alias = item["resourceAlias"]
        if (
            item["schemaVersion"] != COMPLETE_SCHEMA
            or item["operation"] != "complete"
            or alias not in DRIVER_ALIASES
            or not isinstance(receipt, str)
            or _HMAC.fullmatch(receipt) is None
        ):
            _reject()
        match = self._plans_by_receipt.get(receipt)
        if match is None:
            _reject()
        plan_hash, payload = match
        action = payload["action"]
        outcome = item["outcome"]
        if (
            payload["resourceAlias"] != alias
            or outcome not in CLEANUP_ALLOWED_OUTCOMES[action]
            or (alias == "run-session-bundle" and outcome == "retained")
        ):
            _reject()
        completed = self._completed.get(plan_hash)
        if completed is None:
            self._vault.complete(plan_hash, outcome)
            self._completed[plan_hash] = outcome
        elif completed != outcome:
            _reject()
        return {
            "schemaVersion": COMPLETE_ACK_SCHEMA,
            "operation": "complete",
            "resourceAlias": alias,
            "planReceiptHmac": receipt,
            "outcome": outcome,
        }

    def handle_once(self, channel: socket.socket) -> None:
        frame = _read_canonical_frame(channel)
        operation = frame.get("operation")
        if operation == "plan":
            acknowledgement = self._plan(frame)
        elif operation == "complete":
            acknowledgement = self._complete(frame)
        else:
            _reject()
        _send_frame(channel, acknowledgement)

    def pending_count(self) -> int:
        return sum(1 for plan_hash, _payload in self._plans_by_receipt.values() if plan_hash not in self._completed)

    def commit_single_retained(
        self,
        *,
        real_receipt_verified: bool,
        ui_verified: bool,
        controller_state_persisted: bool,
        development_target_verified: bool,
    ) -> None:
        """Allow only the parent coordinator to retain the one proven main session."""

        if not all(
            value is True
            for value in (
                real_receipt_verified,
                ui_verified,
                controller_state_persisted,
                development_target_verified,
            )
        ):
            _reject()
        pending = [
            (plan_hash, payload)
            for plan_hash, payload in self._plans_by_receipt.values()
            if plan_hash not in self._completed
        ]
        if len(pending) != 1 or pending[0][1]["resourceAlias"] != "run-session-bundle":
            _reject()
        plan_hash, _payload = pending[0]
        self._vault.complete(plan_hash, "retained")
        self._completed[plan_hash] = "retained"

    def copy_pending_locator(self, plan_receipt_hmac: str, output_fd: int) -> None:
        if not isinstance(plan_receipt_hmac, str) or _HMAC.fullmatch(plan_receipt_hmac) is None:
            _reject()
        match = self._plans_by_receipt.get(plan_receipt_hmac)
        if match is None or match[0] in self._completed:
            _reject()
        self._vault.copy_locator(match[0], output_fd)

    def recover_pending(self, handler: Callable[[str, int], str]) -> int:
        """Run descriptor-only recovery and durably complete each pending plan."""

        if not callable(handler):
            _reject()
        recovered = 0
        for _receipt, (plan_hash, payload) in tuple(self._plans_by_receipt.items()):
            if plan_hash in self._completed:
                continue
            with tempfile.TemporaryFile() as locator_file:
                os.fchmod(locator_file.fileno(), 0o600)
                self._vault.copy_locator(plan_hash, locator_file.fileno())
                os.lseek(locator_file.fileno(), 0, os.SEEK_SET)
                outcome = handler(payload["resourceAlias"], locator_file.fileno())
            if outcome == "retained" or outcome not in CLEANUP_ALLOWED_OUTCOMES[payload["action"]]:
                _reject()
            self._vault.complete(plan_hash, outcome)
            self._completed[plan_hash] = outcome
            recovered += 1
        return recovered

    def assert_complete(self) -> None:
        if self.pending_count() != 0:
            _reject()
        self._vault.assert_complete()
