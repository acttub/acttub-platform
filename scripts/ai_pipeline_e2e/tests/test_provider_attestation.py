from __future__ import annotations

import hashlib
import hmac
import json
import tempfile
import unittest
from copy import deepcopy

from scripts.ai_pipeline_e2e import controller, provider_attestation


class ProviderAttestationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = hashlib.sha256(b"offline-provider-attestation-key").digest()
        self.media_byte_count = 913
        self.media_hmac = self.hmac_value(b"media-fixture")

    def hmac_value(self, value: bytes) -> str:
        return "hmac-sha256:" + hmac.new(self.key, value, hashlib.sha256).hexdigest()

    def event(
        self,
        service: str,
        ordinal: int,
        operation: str,
        *,
        media_hmac: str | None = None,
        media_byte_count: int = 0,
    ) -> dict[str, object]:
        label = f"{service}:{ordinal}:{operation}".encode("ascii")
        return {
            "schemaVersion": provider_attestation.EVENT_SCHEMA,
            "service": service,
            "ordinal": ordinal,
            "operation": operation,
            "success": True,
            "requestHmac": self.hmac_value(b"request:" + label),
            "responseHmac": self.hmac_value(b"response:" + label),
            "mediaHmac": media_hmac,
            "mediaByteCount": media_byte_count,
        }

    def valid_events(self) -> list[dict[str, object]]:
        return [
            self.event(
                "summary",
                0,
                "files_upload",
                media_hmac=self.media_hmac,
                media_byte_count=self.media_byte_count,
            ),
            self.event("agent", 0, "generate_content"),
            self.event("summary", 1, "files_get"),
            self.event("report", 0, "generate_content"),
            self.event("summary", 2, "generate_content"),
            self.event("summary", 3, "files_delete"),
        ]

    @staticmethod
    def encode(events: list[dict[str, object]]) -> bytes:
        return b"".join(
            json.dumps(event, ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":")).encode(
                "ascii"
            )
            + b"\n"
            for event in events
        )

    def attest_raw(
        self,
        raw: bytes,
        *,
        media_hmac: str | None = None,
        media_byte_count: int | None = None,
        key: bytes | None = None,
    ) -> dict[str, object]:
        with tempfile.TemporaryFile() as input_file, tempfile.TemporaryFile() as key_file:
            input_file.write(raw)
            key_file.write(self.key if key is None else key)
            input_file.flush()
            key_file.flush()
            return provider_attestation.attest_provider_events(
                input_fd=input_file.fileno(),
                mac_key_fd=key_file.fileno(),
                expected_media_hmac=self.media_hmac if media_hmac is None else media_hmac,
                expected_media_byte_count=(
                    self.media_byte_count if media_byte_count is None else media_byte_count
                ),
            )

    def attest(self, events: list[dict[str, object]], **kwargs: object) -> dict[str, object]:
        return self.attest_raw(self.encode(events), **kwargs)

    def assert_rejected(self, raw: bytes, **kwargs: object) -> None:
        with self.assertRaisesRegex(
            provider_attestation.ProviderAttestationRejected,
            "^provider_attestation_rejected$",
        ):
            self.attest_raw(raw, **kwargs)

    def test_valid_interleaved_stream_returns_only_hmac_and_bounded_aggregate_facts(self) -> None:
        result = self.attest(self.valid_events())
        self.assertEqual(result["schemaVersion"], provider_attestation.ATTESTATION_SCHEMA)
        self.assertEqual(result["eventCount"], 6)
        self.assertEqual(result["providerCallCount"], 3)
        self.assertEqual(result["serviceEventCounts"], {"summary": 4, "agent": 1, "report": 1})
        self.assertEqual(result["serviceGenerateCounts"], {"summary": 1, "agent": 1, "report": 1})
        self.assertRegex(result["eventTailHmac"], r"^hmac-sha256:[a-f0-9]{64}$")
        self.assertRegex(result["eventAggregateHmac"], r"^hmac-sha256:[a-f0-9]{64}$")

        serialized = json.dumps(result, sort_keys=True, separators=(",", ":")).casefold()
        for forbidden in (
            "requesthmac",
            "responsehmac",
            "raw",
            "path",
            "url",
            "providerid",
            "provider_id",
            "fileid",
        ):
            self.assertNotIn(forbidden, serialized)

        with tempfile.TemporaryFile() as key_file:
            key_file.write(self.key)
            key_file.flush()
            validated = controller.validate_real_attestation(result["realAttestation"], key_file.fileno())
        self.assertEqual(
            validated["providerAttestationHmac"],
            result["realAttestation"]["providerAttestationHmac"],
        )
        self.assertEqual(
            validated["mediaAttestationHmac"],
            result["realAttestation"]["mediaAttestationHmac"],
        )

    def test_valid_hmac_tamper_changes_authenticated_tail_and_aggregate(self) -> None:
        original = self.attest(self.valid_events())
        tampered_events = deepcopy(self.valid_events())
        tampered_events[1]["requestHmac"] = self.hmac_value(b"different-valid-request-hmac")
        tampered = self.attest(tampered_events)
        self.assertNotEqual(original["eventTailHmac"], tampered["eventTailHmac"])
        self.assertNotEqual(original["eventAggregateHmac"], tampered["eventAggregateHmac"])

    def test_malformed_hmac_partial_jsonl_and_non_ascii_fail_closed(self) -> None:
        malformed = self.valid_events()
        malformed[0]["responseHmac"] = "hmac-sha256:not-a-mac"
        self.assert_rejected(self.encode(malformed))
        self.assert_rejected(self.encode(self.valid_events()).removesuffix(b"\n"))
        self.assert_rejected(self.encode(self.valid_events())[:-8])
        self.assert_rejected(self.encode(self.valid_events()) + b"\xff\n")

    def test_duplicate_json_keys_duplicate_events_and_non_consecutive_ordinals_fail_closed(self) -> None:
        raw = self.encode(self.valid_events())
        duplicate_key = raw.replace(b'"ordinal":0', b'"ordinal":0,"ordinal":0', 1)
        self.assert_rejected(duplicate_key)

        duplicated = self.valid_events()
        duplicated.insert(1, deepcopy(duplicated[0]))
        self.assert_rejected(self.encode(duplicated))

        skipped = self.valid_events()
        skipped[2]["ordinal"] = 2
        self.assert_rejected(self.encode(skipped))

    def test_operation_order_missing_stage_and_missing_delete_fail_closed(self) -> None:
        wrong_service_operation = self.valid_events()
        wrong_service_operation[1]["operation"] = "files_upload"
        self.assert_rejected(self.encode(wrong_service_operation))

        delete_before_upload = self.valid_events()
        delete_before_upload[0]["operation"] = "files_delete"
        delete_before_upload[0]["mediaHmac"] = None
        delete_before_upload[0]["mediaByteCount"] = 0
        delete_before_upload[-1]["operation"] = "files_upload"
        delete_before_upload[-1]["mediaHmac"] = self.media_hmac
        delete_before_upload[-1]["mediaByteCount"] = self.media_byte_count
        self.assert_rejected(self.encode(delete_before_upload))

        missing_report_generate = [event for event in self.valid_events() if event["service"] != "report"]
        self.assert_rejected(self.encode(missing_report_generate))
        missing_delete = self.valid_events()[:-1]
        self.assert_rejected(self.encode(missing_delete))

    def test_media_hmac_and_exact_byte_count_are_bound_only_to_summary_upload(self) -> None:
        self.assert_rejected(self.encode(self.valid_events()), media_hmac=self.hmac_value(b"other-media"))
        self.assert_rejected(self.encode(self.valid_events()), media_byte_count=self.media_byte_count + 1)

        unexpected_media = self.valid_events()
        unexpected_media[4]["mediaHmac"] = self.media_hmac
        unexpected_media[4]["mediaByteCount"] = self.media_byte_count
        self.assert_rejected(self.encode(unexpected_media))

        boolean_count = self.valid_events()
        boolean_count[0]["mediaByteCount"] = True
        self.assert_rejected(self.encode(boolean_count))

    def test_unknown_raw_path_url_and_provider_identifier_fields_fail_closed(self) -> None:
        for field, value in (
            ("raw", "secret"),
            ("path", "/private/media"),
            ("url", "https://example.invalid/media"),
            ("providerId", "opaque-provider-id"),
        ):
            with self.subTest(field=field):
                events = self.valid_events()
                events[0][field] = value
                self.assert_rejected(self.encode(events))

    def test_max_plus_one_input_and_private_bounded_mac_key_fail_closed(self) -> None:
        oversized = b"x" * provider_attestation.MAX_PROVIDER_EVENTS_BYTES + b"\n"
        self.assert_rejected(oversized)
        self.assert_rejected(self.encode(self.valid_events()), key=b"too-short")
        self.assert_rejected(
            self.encode(self.valid_events()),
            key=b"k" * (provider_attestation.MAX_MAC_KEY_BYTES + 1),
        )

        with tempfile.TemporaryFile() as input_file:
            input_file.write(self.encode(self.valid_events()))
            input_file.flush()
            with self.assertRaises(provider_attestation.ProviderAttestationRejected):
                provider_attestation.attest_provider_events(
                    input_fd=input_file.fileno(),
                    mac_key_fd=2,
                    expected_media_hmac=self.media_hmac,
                    expected_media_byte_count=self.media_byte_count,
                )


if __name__ == "__main__":
    unittest.main()
