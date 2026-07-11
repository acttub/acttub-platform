"""Fail-closed aggregation for protected Gemini provider event pipes.

The child services emit only fixed-schema JSONL events.  This module validates
that stream and reduces it to HMAC attestations; raw requests, responses,
paths, URLs, and provider identifiers are never returned.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import stat
from collections.abc import Mapping
from typing import Any

try:
    from .sanitizer import canonical_json
except ImportError:  # pragma: no cover - direct script import fallback
    from sanitizer import canonical_json

EVENT_SCHEMA = "protected-provider-event.v1"
ATTESTATION_SCHEMA = "protected-provider-attestation.v1"
REAL_ATTESTATION_SCHEMA = "protected-real-attestation.v1"

MAX_PROVIDER_EVENTS_BYTES = 1024 * 1024
MAX_EVENT_LINE_BYTES = 4096
MAX_MAC_KEY_BYTES = 4096
MAX_MEDIA_BYTES = 8 * 1024 * 1024 * 1024

_SERVICES = ("summary", "agent", "report")
_EVENT_KEYS = frozenset(
    {
        "schemaVersion",
        "service",
        "ordinal",
        "operation",
        "success",
        "requestHmac",
        "responseHmac",
        "mediaHmac",
        "mediaByteCount",
    }
)
_OPERATIONS = {
    "summary": frozenset({"generate_content", "files_upload", "files_get", "files_delete"}),
    "agent": frozenset({"generate_content"}),
    "report": frozenset({"generate_content"}),
}
_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")
_GENESIS_TAIL = "hmac-sha256:" + "0" * 64
_EVENT_CHAIN_DOMAIN = b"acttub-protected-provider-event-chain.v1\0"
_EVENT_AGGREGATE_DOMAIN = b"acttub-protected-provider-event-aggregate.v1\0"
_REAL_PROVIDER_MAC_DOMAIN = b"acttub-protected-real-provider.v1\0"
_REAL_MEDIA_MAC_DOMAIN = b"acttub-protected-real-media.v1\0"


class ProviderAttestationRejected(ValueError):
    """A deliberately detail-free protected stream rejection."""


def _reject() -> None:
    raise ProviderAttestationRejected("provider_attestation_rejected")


def _read_bounded(fd: int, maximum: int, *, require_private_fd: bool) -> bytes:
    if type(fd) is not int or fd < 0 or (require_private_fd and fd <= 2):
        _reject()
    try:
        info = os.fstat(fd)
        if not (stat.S_ISREG(info.st_mode) or stat.S_ISFIFO(info.st_mode)):
            _reject()
        if stat.S_ISREG(info.st_mode):
            os.lseek(fd, 0, os.SEEK_SET)
        chunks: list[bytes] = []
        total = 0
        while total <= maximum:
            chunk = os.read(fd, min(65536, maximum + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                _reject()
    except ProviderAttestationRejected:
        raise
    except (OSError, OverflowError, ValueError):
        _reject()
    if total == 0:
        _reject()
    return b"".join(chunks)


def _read_mac_key(fd: int) -> bytes:
    key = _read_bounded(fd, MAX_MAC_KEY_BYTES, require_private_fd=True)
    if not 16 <= len(key) <= MAX_MAC_KEY_BYTES:
        _reject()
    return key


def _object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _reject()
        result[key] = value
    return result


def _is_hmac(value: Any) -> bool:
    return isinstance(value, str) and _HMAC.fullmatch(value) is not None


def _mac(key: bytes, domain: bytes, value: Mapping[str, Any]) -> str:
    digest = hmac.new(key, domain + canonical_json(dict(value)).encode("ascii"), hashlib.sha256)
    return "hmac-sha256:" + digest.hexdigest()


def _parse_jsonl(raw: bytes) -> list[dict[str, Any]]:
    if not raw.endswith(b"\n") or b"\r" in raw:
        _reject()
    try:
        raw.decode("ascii")
    except UnicodeDecodeError:
        _reject()
    lines = raw.split(b"\n")[:-1]
    if not lines or any(not line or len(line) + 1 > MAX_EVENT_LINE_BYTES for line in lines):
        _reject()

    events: list[dict[str, Any]] = []
    for line in lines:
        try:
            value = json.loads(line, object_pairs_hook=_object_without_duplicates)
        except ProviderAttestationRejected:
            raise
        except (json.JSONDecodeError, UnicodeDecodeError, TypeError, ValueError):
            _reject()
        if not isinstance(value, dict) or set(value) != _EVENT_KEYS:
            _reject()
        try:
            canonical = canonical_json(value).encode("ascii")
        except (TypeError, ValueError, UnicodeEncodeError):
            _reject()
        if not hmac.compare_digest(line, canonical):
            _reject()
        events.append(value)
    return events


def _validate_event(
    event: Mapping[str, Any],
    expected_ordinals: dict[str, int],
    expected_media_hmac: str,
    expected_media_byte_count: int,
) -> tuple[str, str]:
    service = event["service"]
    operation = event["operation"]
    ordinal = event["ordinal"]
    if (
        event["schemaVersion"] != EVENT_SCHEMA
        or service not in _SERVICES
        or not isinstance(operation, str)
        or operation not in _OPERATIONS[service]
        or type(ordinal) is not int
        or ordinal != expected_ordinals[service]
        or event["success"] is not True
        or not _is_hmac(event["requestHmac"])
        or not _is_hmac(event["responseHmac"])
    ):
        _reject()
    expected_ordinals[service] += 1

    media_hmac = event["mediaHmac"]
    media_byte_count = event["mediaByteCount"]
    if operation == "files_upload":
        if (
            service != "summary"
            or not _is_hmac(media_hmac)
            or not hmac.compare_digest(media_hmac, expected_media_hmac)
            or type(media_byte_count) is not int
            or media_byte_count != expected_media_byte_count
        ):
            _reject()
    elif media_hmac is not None or type(media_byte_count) is not int or media_byte_count != 0:
        _reject()
    return service, operation


def _real_attestation(
    key: bytes,
    *,
    provider_call_count: int,
    provider_event_count: int,
    provider_event_tail_hmac: str,
    provider_event_aggregate_hmac: str,
    media_hmac: str,
    media_byte_count: int,
) -> dict[str, Any]:
    provider_core = {
        "schemaVersion": REAL_ATTESTATION_SCHEMA,
        "serviceModes": {service: "real" for service in _SERVICES},
        "providerCredentialFdOnly": True,
        "providerCallCount": provider_call_count,
        "providerStagesObserved": list(_SERVICES),
        "providerEventCount": provider_event_count,
        "providerEventTailHmac": provider_event_tail_hmac,
        "providerEventAggregateHmac": provider_event_aggregate_hmac,
    }
    media_core = {
        "schemaVersion": REAL_ATTESTATION_SCHEMA,
        "mediaReadFromFd": True,
        "mediaByteCount": media_byte_count,
        "mediaContentHmac": media_hmac,
    }
    return {
        **provider_core,
        "mediaReadFromFd": True,
        "mediaByteCount": media_byte_count,
        "mediaContentHmac": media_hmac,
        "providerAttestationHmac": _mac(key, _REAL_PROVIDER_MAC_DOMAIN, provider_core),
        "mediaAttestationHmac": _mac(key, _REAL_MEDIA_MAC_DOMAIN, media_core),
    }


def attest_provider_events(
    *,
    input_fd: int,
    mac_key_fd: int,
    expected_media_hmac: str,
    expected_media_byte_count: int,
) -> dict[str, Any]:
    """Validate child JSONL events and return only protected aggregate facts."""

    if (
        not _is_hmac(expected_media_hmac)
        or type(expected_media_byte_count) is not int
        or not 0 < expected_media_byte_count <= MAX_MEDIA_BYTES
    ):
        _reject()
    key = _read_mac_key(mac_key_fd)
    raw = _read_bounded(input_fd, MAX_PROVIDER_EVENTS_BYTES, require_private_fd=False)
    events = _parse_jsonl(raw)

    expected_ordinals = {service: 0 for service in _SERVICES}
    event_counts = {service: 0 for service in _SERVICES}
    generate_counts = {service: 0 for service in _SERVICES}
    summary_upload_ordinals: list[int] = []
    summary_delete_ordinals: list[int] = []
    tail = _GENESIS_TAIL

    for sequence, event in enumerate(events):
        service, operation = _validate_event(
            event,
            expected_ordinals,
            expected_media_hmac,
            expected_media_byte_count,
        )
        event_counts[service] += 1
        if operation == "generate_content":
            generate_counts[service] += 1
        elif operation == "files_upload":
            summary_upload_ordinals.append(event["ordinal"])
        elif operation == "files_delete":
            summary_delete_ordinals.append(event["ordinal"])
        tail = _mac(
            key,
            _EVENT_CHAIN_DOMAIN,
            {"event": dict(event), "previousTailHmac": tail, "sequence": sequence},
        )

    if (
        any(event_counts[service] == 0 for service in _SERVICES)
        or any(generate_counts[service] < 1 for service in _SERVICES)
        or len(summary_upload_ordinals) != 1
        or len(summary_delete_ordinals) != 1
        or summary_delete_ordinals[0] <= summary_upload_ordinals[0]
    ):
        _reject()

    provider_call_count = sum(generate_counts.values())
    aggregate_core = {
        "schemaVersion": ATTESTATION_SCHEMA,
        "eventCount": len(events),
        "providerCallCount": provider_call_count,
        "serviceEventCounts": event_counts,
        "serviceGenerateCounts": generate_counts,
        "eventTailHmac": tail,
        "mediaHmac": expected_media_hmac,
        "mediaByteCount": expected_media_byte_count,
    }
    event_aggregate_hmac = _mac(key, _EVENT_AGGREGATE_DOMAIN, aggregate_core)
    return {
        **aggregate_core,
        "eventAggregateHmac": event_aggregate_hmac,
        "realAttestation": _real_attestation(
            key,
            provider_call_count=provider_call_count,
            provider_event_count=len(events),
            provider_event_tail_hmac=tail,
            provider_event_aggregate_hmac=event_aggregate_hmac,
            media_hmac=expected_media_hmac,
            media_byte_count=expected_media_byte_count,
        ),
    }


__all__ = [
    "ATTESTATION_SCHEMA",
    "EVENT_SCHEMA",
    "MAX_EVENT_LINE_BYTES",
    "MAX_PROVIDER_EVENTS_BYTES",
    "ProviderAttestationRejected",
    "attest_provider_events",
]
