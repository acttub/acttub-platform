from __future__ import annotations

import os
import tempfile
import unittest

from scripts.ai_pipeline_e2e import case_evidence, sanitizer


HMAC = "hmac-sha256:" + "a" * 64


def passing_measurements(case_id: str) -> dict[str, object]:
    result: dict[str, object] = {}
    for assertion in sanitizer.CASE_BY_ID[case_id]["assertions"]:
        if assertion["kind"] == "boolean":
            result[assertion["id"]] = True
        elif assertion["kind"] == "count":
            result[assertion["id"]] = assertion["equals"]
        else:
            result[assertion["id"]] = HMAC
    return result


class CaseEvidenceTests(unittest.TestCase):
    def private_file(self):
        item = tempfile.NamedTemporaryFile()
        os.fchmod(item.fileno(), 0o600)
        return item

    def test_builds_only_exact_passing_measurements(self) -> None:
        evidence = case_evidence.build_passing_evidence(
            "REAL-01", "real", passing_measurements("REAL-01")
        )
        self.assertEqual(evidence["caseId"], "REAL-01")
        self.assertEqual(evidence["status"], "pass")

        hostile_values = (
            ("SAFE-01", "scripted", {**passing_measurements("SAFE-01"), "extra": True}),
            ("SAFE-01", "real", passing_measurements("SAFE-01")),
            ("SAFE-01", "scripted", {**passing_measurements("SAFE-01"), "sanitizer_canary_blocked": False}),
            ("SAFE-01", "scripted", {**passing_measurements("SAFE-01"), "production_actions": True}),
            ("REAL-01", "real", {**passing_measurements("REAL-01"), "provider_attestation_hmac": "bad"}),
        )
        for case_id, mode, values in hostile_values:
            with self.subTest(case_id=case_id, mode=mode), self.assertRaises(
                case_evidence.CaseEvidenceRejected
            ):
                case_evidence.build_passing_evidence(case_id, mode, values)

    def test_writer_is_ordered_fsynced_and_restartable(self) -> None:
        with self.private_file() as evidence_file:
            writer = case_evidence.CaseEvidenceWriter(evidence_file.fileno())
            first = sanitizer.CASE_IDS[0]
            self.assertEqual(writer.next_case_id, first)
            entry = writer.append(first, "scripted", passing_measurements(first))
            self.assertEqual(entry["sequence"], 0)
            os.lseek(evidence_file.fileno(), 0, os.SEEK_SET)
            self.assertTrue(os.read(evidence_file.fileno(), 4096).endswith(b"\n"))

            reopened = case_evidence.CaseEvidenceWriter(evidence_file.fileno())
            self.assertEqual(reopened.next_case_id, sanitizer.CASE_IDS[1])
            with self.assertRaises(case_evidence.CaseEvidenceRejected):
                reopened.append(first, "scripted", passing_measurements(first))

    def test_complete_requires_all_exact_cases_and_clean_scan(self) -> None:
        with self.private_file() as evidence_file:
            writer = case_evidence.CaseEvidenceWriter(evidence_file.fileno())
            with self.assertRaises(case_evidence.CaseEvidenceRejected):
                writer.assert_complete()
            for case_id in sanitizer.CASE_IDS:
                modes = sanitizer.CASE_BY_ID[case_id]["allowedModes"]
                mode = "real" if modes == ["real"] else "scripted"
                writer.append(case_id, mode, passing_measurements(case_id))
            writer.assert_complete()
            self.assertIsNone(writer.next_case_id)


if __name__ == "__main__":
    unittest.main()
